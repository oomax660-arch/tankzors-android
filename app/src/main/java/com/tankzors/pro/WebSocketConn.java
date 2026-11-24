package com.tankzors.pro;

import android.util.Base64;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Locale;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicLong;

/**
 * A minimal WebSocket (RFC 6455) connection over a plain socket: text messages, ping/pong, close.
 * Both ends: the host's server side and the joining client side. It speaks with the iPhone app's
 * Network.framework WebSocket too, so iPhones and Android phones play together.
 *
 * Sending never blocks the caller (the page calls in through the JavaScript bridge, and a blocked
 * write would freeze the host's whole game when one phone's Wi-Fi stalls): frames go into a queue that
 * a writer thread empties. A phone that stops reading for too long (several seconds of snapshots
 * piled up) is disconnected; the game brings it back by itself.
 */
final class WebSocketConn {
    interface Listener {
        void onText(String text);
        void onClosed(String why);
    }

    private static final String GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final int MAX_MESSAGE = 8 * 1024 * 1024;
    private static final SecureRandom RND = new SecureRandom();
    private static final long MAX_BACKLOG = 3L * 1024 * 1024;     // ~10 s of snapshots for a phone that stopped reading
    private static final byte[] END = new byte[0];

    private final Socket socket;
    private final InputStream in;
    private final OutputStream out;
    private final boolean mask;          // clients mask their frames, servers do not
    private volatile boolean closed;
    private final LinkedBlockingQueue<byte[]> outq = new LinkedBlockingQueue<>();
    private final AtomicLong backlog = new AtomicLong();

    private WebSocketConn(Socket s, InputStream in, boolean mask) throws IOException {
        this.socket = s;
        this.in = in;
        this.out = new BufferedOutputStream(s.getOutputStream(), 32768);
        this.mask = mask;
        s.setTcpNoDelay(true);
        Thread w = new Thread(this::writeLoop, "ws-writer");
        w.setDaemon(true);
        w.start();
    }

    // ------------------------------------------------------------------ handshakes

    /** Host side: read the client's HTTP upgrade request and answer 101. */
    static WebSocketConn serverHandshake(Socket s) throws IOException {
        s.setSoTimeout(7000);
        InputStream in = new BufferedInputStream(s.getInputStream(), 32768);
        String head = readHead(in);
        String key = header(head, "sec-websocket-key");
        if (key == null) throw new IOException("not a websocket request");
        String accept = acceptFor(key);
        String resp = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n";
        OutputStream o = s.getOutputStream();
        o.write(resp.getBytes(StandardCharsets.US_ASCII));
        o.flush();
        s.setSoTimeout(0);
        return new WebSocketConn(s, in, false);
    }

    /** Joining side: send the upgrade request and check the answer. */
    static WebSocketConn clientHandshake(Socket s, String hostPort) throws IOException {
        s.setSoTimeout(7000);
        byte[] k = new byte[16];
        RND.nextBytes(k);
        String key = Base64.encodeToString(k, Base64.NO_WRAP);
        String req = "GET / HTTP/1.1\r\nHost: " + hostPort + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                + "Sec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n\r\n";
        OutputStream o = s.getOutputStream();
        o.write(req.getBytes(StandardCharsets.US_ASCII));
        o.flush();
        InputStream in = new BufferedInputStream(s.getInputStream(), 32768);
        String head = readHead(in);
        if (!head.startsWith("HTTP/1.1 101") && !head.startsWith("HTTP/1.0 101")) throw new IOException("host refused: " + head.split("\r\n")[0]);
        String acc = header(head, "sec-websocket-accept");
        if (acc == null || !acc.trim().equals(acceptFor(key))) throw new IOException("bad handshake");
        s.setSoTimeout(0);
        return new WebSocketConn(s, in, true);
    }

    private static String readHead(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int state = 0;
        while (true) {
            int c = in.read();
            if (c < 0) throw new EOFException("connection closed during the handshake");
            b.write(c);
            if (b.size() > 16384) throw new IOException("handshake too long");
            // \r\n\r\n
            state = (c == '\r' && (state == 0 || state == 2)) ? state + 1 : (c == '\n' && (state == 1 || state == 3)) ? state + 1 : 0;
            if (state == 4) break;
        }
        return new String(b.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private static String header(String head, String name) {
        for (String line : head.split("\r\n")) {
            int i = line.indexOf(':');
            if (i > 0 && line.substring(0, i).trim().toLowerCase(Locale.ROOT).equals(name)) return line.substring(i + 1).trim();
        }
        return null;
    }

    static String acceptFor(String key) {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-1");
            byte[] d = sha.digest((key.trim() + GUID).getBytes(StandardCharsets.US_ASCII));
            return Base64.encodeToString(d, Base64.NO_WRAP);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // ------------------------------------------------------------------ sending

    void sendText(String text) {
        if (!closed) sendUtf8(text.getBytes(StandardCharsets.UTF_8));
    }

    /** the same message to several phones: encoded once */
    void sendUtf8(byte[] utf8) {
        if (!closed) enqueue(frame(0x1, utf8));
    }

    private void enqueue(byte[] f) {
        if (backlog.addAndGet(f.length) > MAX_BACKLOG) { close(); return; }      // it stopped reading: let it reconnect
        outq.offer(f);
    }

    private byte[] frame(int opcode, byte[] payload) {
        int n = payload.length;
        int head = 2 + (n < 126 ? 0 : n < 65536 ? 2 : 8) + (mask ? 4 : 0);
        byte[] f = new byte[head + n];
        int i = 0;
        f[i++] = (byte) (0x80 | opcode);
        int m = mask ? 0x80 : 0;
        if (n < 126) f[i++] = (byte) (m | n);
        else if (n < 65536) { f[i++] = (byte) (m | 126); f[i++] = (byte) (n >>> 8); f[i++] = (byte) n; }
        else { f[i++] = (byte) (m | 127); for (int k = 7; k >= 0; k--) f[i++] = (byte) (k >= 4 ? 0 : n >>> (8 * k)); }
        if (mask) {
            byte[] key = new byte[4];
            RND.nextBytes(key);
            System.arraycopy(key, 0, f, i, 4); i += 4;
            for (int k = 0; k < n; k++) f[i + k] = (byte) (payload[k] ^ key[k & 3]);
        } else System.arraycopy(payload, 0, f, i, n);
        return f;
    }

    private void writeLoop() {
        try {
            for (;;) {
                byte[] f = outq.take();
                if (f == END) break;
                backlog.addAndGet(-f.length);
                out.write(f);
                if (outq.isEmpty()) out.flush();
            }
            out.flush();
        } catch (IOException | InterruptedException ignored) {
        } finally {
            closed = true;
            try { socket.close(); } catch (IOException ignored) { }
        }
    }

    // ------------------------------------------------------------------ receiving

    /** Reads messages on the calling thread until the connection ends. */
    void readLoop(Listener l) {
        String why = "closed";
        ByteArrayOutputStream msg = new ByteArrayOutputStream();
        int msgOp = 0;
        try {
            while (!closed) {
                int b0 = in.read();
                if (b0 < 0) break;
                int b1 = readByte();
                boolean fin = (b0 & 0x80) != 0;
                int op = b0 & 0x0f;
                boolean masked = (b1 & 0x80) != 0;
                long len = b1 & 0x7f;
                if (len == 126) len = (readByte() << 8) | readByte();
                else if (len == 127) { len = 0; for (int i = 0; i < 8; i++) len = (len << 8) | readByte(); }
                if (len < 0 || len > MAX_MESSAGE) throw new IOException("message too big");
                byte[] key = null;
                if (masked) { key = new byte[4]; readFully(key); }
                byte[] p = new byte[(int) len];
                readFully(p);
                if (key != null) for (int i = 0; i < p.length; i++) p[i] ^= key[i & 3];
                switch (op) {
                    case 0x0:           // continuation
                    case 0x1:           // text
                    case 0x2:           // binary (treated as text)
                        if (op != 0) { msg.reset(); msgOp = op; }
                        msg.write(p);
                        if (msg.size() > MAX_MESSAGE) throw new IOException("message too big");
                        if (fin && msgOp != 0) { l.onText(new String(msg.toByteArray(), StandardCharsets.UTF_8)); msg.reset(); msgOp = 0; }
                        break;
                    case 0x8:           // close: answer and finish
                        close();
                        return;
                    case 0x9:           // ping -> pong
                        if (!closed) enqueue(frame(0xA, p));
                        break;
                    default:            // pong and others
                        break;
                }
            }
        } catch (IOException e) {
            why = closed ? "closed" : e.getMessage() == null ? "io" : e.getMessage();
        } finally {
            close();
            l.onClosed(why);
        }
    }

    private int readByte() throws IOException {
        int b = in.read();
        if (b < 0) throw new EOFException();
        return b;
    }

    private void readFully(byte[] b) throws IOException {
        int off = 0;
        while (off < b.length) {
            int n = in.read(b, off, b.length - off);
            if (n < 0) throw new EOFException();
            off += n;
        }
    }

    /** A close frame after what is already queued, then the socket closes (at once if the other side is stuck). */
    void close() {
        synchronized (this) {
            if (closed) return;
            closed = true;
        }
        outq.offer(frame(0x8, new byte[0]));
        outq.offer(END);
        Thread t = new Thread(() -> {
            try { Thread.sleep(1500); } catch (InterruptedException ignored) { }
            try { socket.close(); } catch (IOException ignored) { }
        }, "ws-close");
        t.setDaemon(true);
        t.start();
    }
}
