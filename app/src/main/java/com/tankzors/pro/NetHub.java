package com.tankzors.pro;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The local network game, the same as on iPhone (TankzorsPro/GameViewController.swift, NetHub):
 * the host opens a WebSocket server (port 47700) and announces it as the DNS-SD service "_tankzors._tcp";
 * the others find it and connect. iPhones and Android phones on the same Wi-Fi play together.
 * This class only moves text messages; the game itself runs in the page.
 *
 * Commands from the page (JSON): host, info, browse, stopBrowse, join, joinIP, send, kick, stop.
 * Events to the page (window.__net): hosting, rooms, join, leave, connected, closed, msg, error.
 */
final class NetHub {
    static final String SERVICE_TYPE = "_tankzors._tcp";
    static final int DEFAULT_PORT = 47700;
    private static final String TAG = "TankzorsNet";

    private final MainActivity act;
    private final NsdManager nsd;
    private final WifiManager.MulticastLock mlock;
    private final ExecutorService io = Executors.newCachedThreadPool();
    private final Object lock = new Object();

    // host side
    private ServerSocket server;
    private final Map<Integer, WebSocketConn> clients = new ConcurrentHashMap<>();
    private int nextId = 1;
    private String roomName = "";
    private String roomInfo = "";
    private NsdManager.RegistrationListener registration;
    private long infoAt;
    private boolean infoPending;

    // client side
    private WebSocketConn connection;
    private boolean connected;

    // browsing
    private NsdManager.DiscoveryListener discovery;
    private final Map<String, Room> rooms = Collections.synchronizedMap(new LinkedHashMap<>());
    private final Map<String, Room> known = new ConcurrentHashMap<>();   // kept after browsing: reconnecting by name
    private final ArrayDeque<NsdServiceInfo> resolveQueue = new ArrayDeque<>();
    private boolean resolving;
    private int generation;          // stale callbacks of an older session are ignored

    static final class Room { String name; String host; int port; String info = ""; }

    NetHub(MainActivity act) {
        this.act = act;
        nsd = (NsdManager) act.getSystemService(Context.NSD_SERVICE);
        WifiManager wifi = (WifiManager) act.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        WifiManager.MulticastLock l = null;
        if (wifi != null) { l = wifi.createMulticastLock("tankzors"); l.setReferenceCounted(false); }
        mlock = l;
    }

    // ------------------------------------------------------------------ commands

    void command(JSONObject o) {
        String op = o.optString("op");
        switch (op) {
            case "host": io.execute(() -> host(o.optString("name", "Игра"), o.optString("info", ""))); break;
            case "info": updateInfo(o.optString("info", "")); break;
            case "browse": browse(true); break;
            case "stopBrowse": browse(false); break;
            case "join": {
                String key = o.optString("key", "");
                Room r = rooms.get(key);
                if (r == null) r = known.get(key);
                if (r == null) { emit(ev("closed").put2("reason", "игра больше не найдена")); return; }
                final Room room = r;
                io.execute(() -> connect(room.host, room.port));
                break;
            }
            case "joinIP": {
                String ip = o.optString("ip", "").trim();
                int port = o.optInt("port", DEFAULT_PORT);
                if (ip.isEmpty()) { emit(ev("closed").put2("reason", "неверный адрес")); return; }
                io.execute(() -> connect(ip, port));
                break;
            }
            case "send": {
                String data = o.optString("data", "");
                int to = o.optInt("to", -1);
                WebSocketConn c = connection;
                byte[] utf8 = data.getBytes(StandardCharsets.UTF_8);       // once, for every phone
                if (c != null) c.sendUtf8(utf8);
                else if (to == -1) { for (WebSocketConn k : clients.values()) k.sendUtf8(utf8); }
                else { WebSocketConn k = clients.get(to); if (k != null) k.sendUtf8(utf8); }
                break;
            }
            case "kick": { WebSocketConn k = clients.get(o.optInt("to", -1)); if (k != null) k.close(); break; }
            case "stop": stopAll(); break;
            default: break;
        }
    }

    // ------------------------------------------------------------------ host

    private void host(String name, String info) {
        stopAll();
        final int gen;
        synchronized (lock) { gen = ++generation; roomName = name; roomInfo = info; }
        ServerSocket ss = null;
        try {
            ss = new ServerSocket();
            ss.setReuseAddress(true);
            try { ss.bind(new InetSocketAddress(DEFAULT_PORT)); }
            catch (IOException busy) { ss.close(); ss = new ServerSocket(); ss.setReuseAddress(true); ss.bind(new InetSocketAddress(0)); }   // the usual port is taken: any port
        } catch (IOException e) {
            emit(ev("hosting").put2("ok", false).put2("msg", "не удалось открыть порт: " + e.getMessage()));
            return;
        }
        synchronized (lock) { server = ss; }
        final int port = ss.getLocalPort();
        if (mlock != null) mlock.acquire();
        register(name, info, port);
        JSONArray ips = new JSONArray();
        for (String ip : localIPv4()) ips.put(port == DEFAULT_PORT ? ip : ip + ":" + port);
        emit(ev("hosting").put2("ok", true).put2("ips", ips).put2("port", port));
        final ServerSocket srv = ss;
        io.execute(() -> {
            while (!srv.isClosed()) {
                try {
                    Socket s = srv.accept();
                    io.execute(() -> accept(s, gen));
                } catch (IOException e) { break; }
            }
        });
    }

    private void accept(Socket s, int gen) {
        WebSocketConn c;
        try { c = WebSocketConn.serverHandshake(s); }
        catch (IOException e) { try { s.close(); } catch (IOException ignored) {} return; }
        final int id;
        synchronized (lock) {
            if (gen != generation || server == null) { c.close(); return; }
            id = nextId++;
            clients.put(id, c);
        }
        emit(ev("join").put2("id", id));
        c.readLoop(new WebSocketConn.Listener() {
            @Override public void onText(String text) { emit(ev("msg").put2("from", id).put2("data", text)); }
            @Override public void onClosed(String why) {
                if (clients.remove(id) != null) emit(ev("leave").put2("id", id));
            }
        });
    }

    private void register(String name, String info, int port) {
        if (nsd == null) return;
        NsdServiceInfo si = new NsdServiceInfo();
        si.setServiceName(name);
        si.setServiceType(SERVICE_TYPE);
        si.setPort(port);
        si.setAttribute("info", info.length() > 120 ? info.substring(0, 120) : info);
        NsdManager.RegistrationListener l = new NsdManager.RegistrationListener() {
            @Override public void onRegistrationFailed(NsdServiceInfo i, int err) { Log.w(TAG, "register failed " + err); }
            @Override public void onUnregistrationFailed(NsdServiceInfo i, int err) { }
            @Override public void onServiceRegistered(NsdServiceInfo i) { Log.i(TAG, "announced as " + i.getServiceName()); }
            @Override public void onServiceUnregistered(NsdServiceInfo i) { }
        };
        synchronized (lock) { registration = l; }
        try { nsd.registerService(si, NsdManager.PROTOCOL_DNS_SD, l); } catch (Exception e) { Log.w(TAG, "register: " + e); }
    }

    private void unregister() {
        NsdManager.RegistrationListener l;
        synchronized (lock) { l = registration; registration = null; }
        if (l != null && nsd != null) try { nsd.unregisterService(l); } catch (Exception ignored) { }
    }

    /** The room line in the others' lists (mode, players). Re-announcing costs, so at most every 2 s. */
    private void updateInfo(String info) {
        synchronized (lock) {
            if (server == null || info.equals(roomInfo)) return;
            roomInfo = info;
            if (infoPending) return;
            infoPending = true;
        }
        long wait = Math.max(0, 2000 - (System.currentTimeMillis() - infoAt));
        io.execute(() -> {
            try { Thread.sleep(wait); } catch (InterruptedException ignored) { }
            String name, inf; int port;
            synchronized (lock) {
                infoPending = false;
                if (server == null) return;
                name = roomName; inf = roomInfo; port = server.getLocalPort();
            }
            infoAt = System.currentTimeMillis();
            unregister();
            register(name, inf, port);
        });
    }

    // ------------------------------------------------------------------ browse

    private void browse(boolean on) {
        stopDiscovery();
        if (!on || nsd == null) return;
        rooms.clear();
        if (mlock != null) mlock.acquire();
        NsdManager.DiscoveryListener l = new NsdManager.DiscoveryListener() {
            @Override public void onStartDiscoveryFailed(String t, int err) { emit(ev("error").put2("msg", "поиск игр: ошибка " + err)); }
            @Override public void onStopDiscoveryFailed(String t, int err) { }
            @Override public void onDiscoveryStarted(String t) { emitRooms(); }
            @Override public void onDiscoveryStopped(String t) { }
            @Override public void onServiceFound(NsdServiceInfo si) { queueResolve(si); }
            @Override public void onServiceLost(NsdServiceInfo si) {
                rooms.remove(dnsUnescape(si.getServiceName()));
                emitRooms();
            }
        };
        synchronized (lock) { discovery = l; }
        try { nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, l); }
        catch (Exception e) { emit(ev("error").put2("msg", "поиск игр: " + e.getMessage())); }
    }

    private void stopDiscovery() {
        NsdManager.DiscoveryListener l;
        synchronized (lock) { l = discovery; discovery = null; resolveQueue.clear(); }
        if (l != null && nsd != null) try { nsd.stopServiceDiscovery(l); } catch (Exception ignored) { }
    }

    /** NsdManager resolves one service at a time (before Android 14): a queue. */
    private void queueResolve(NsdServiceInfo si) {
        synchronized (lock) {
            if (discovery == null) return;
            resolveQueue.add(si);
            if (resolving) return;
            resolving = true;
        }
        resolveNext();
    }

    @SuppressWarnings("deprecation")
    private void resolveNext() {
        NsdServiceInfo si;
        synchronized (lock) {
            si = resolveQueue.poll();
            if (si == null) { resolving = false; return; }
        }
        try {
            nsd.resolveService(si, new NsdManager.ResolveListener() {
                @Override public void onResolveFailed(NsdServiceInfo s, int err) { resolveNext(); }
                @Override public void onServiceResolved(NsdServiceInfo s) {
                    Room r = new Room();
                    r.name = dnsUnescape(s.getServiceName());
                    InetAddress a = s.getHost();
                    r.host = a == null ? null : a.getHostAddress();
                    r.port = s.getPort();
                    Map<String, byte[]> attrs = s.getAttributes();
                    if (attrs != null && attrs.get("info") != null) r.info = new String(attrs.get("info"), StandardCharsets.UTF_8);
                    if (r.host != null) {
                        boolean live; synchronized (lock) { live = discovery != null; }
                        if (live) rooms.put(r.name, r);
                        known.put(r.name, r);
                        emitRooms();
                    }
                    resolveNext();
                }
            });
        } catch (Exception e) {
            resolveNext();
        }
    }

    private void emitRooms() {
        JSONArray list = new JSONArray();
        synchronized (rooms) {
            for (Room r : rooms.values()) {
                try { list.put(new JSONObject().put("key", r.name).put("name", r.name).put("info", r.info)); } catch (Exception ignored) { }
            }
        }
        emit(ev("rooms").put2("list", list));
    }

    /** DNS-SD names may come with \DDD escapes (UTF-8 bytes, spaces...). */
    static String dnsUnescape(String s) {
        if (s == null || s.indexOf('\\') < 0) return s;
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] b = s.getBytes(StandardCharsets.UTF_8);
        for (int i = 0; i < b.length; i++) {
            if (b[i] == '\\' && isDigit(b, i + 1) && isDigit(b, i + 2) && isDigit(b, i + 3)) {
                out.write((b[i + 1] - '0') * 100 + (b[i + 2] - '0') * 10 + (b[i + 3] - '0'));
                i += 3;
            } else if (b[i] == '\\' && i + 1 < b.length) { out.write(b[i + 1]); i++; }
            else out.write(b[i]);
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private static boolean isDigit(byte[] b, int i) { return i < b.length && b[i] >= '0' && b[i] <= '9'; }

    // ------------------------------------------------------------------ client

    private void connect(String host, int port) {
        stopAll();
        final int gen;
        synchronized (lock) { gen = ++generation; connected = false; }
        WebSocketConn c;
        try {
            Socket s = new Socket();
            s.connect(new InetSocketAddress(host, port), 7000);
            c = WebSocketConn.clientHandshake(s, host + ":" + port);
        } catch (IOException e) {
            boolean live; synchronized (lock) { live = gen == generation; }
            if (live) emit(ev("closed").put2("reason", "не удаётся подключиться (" + e.getMessage() + ")"));
            return;
        }
        synchronized (lock) {
            if (gen != generation) { c.close(); return; }
            connection = c; connected = true;
        }
        emit(ev("connected"));
        final WebSocketConn conn = c;
        c.readLoop(new WebSocketConn.Listener() {
            @Override public void onText(String text) { emit(ev("msg").put2("from", 0).put2("data", text)); }
            @Override public void onClosed(String why) {
                boolean mine;
                synchronized (lock) { mine = connection == conn; if (mine) { connection = null; connected = false; } }
                if (mine) emit(ev("closed").put2("reason", "связь потеряна"));
            }
        });
    }

    // ------------------------------------------------------------------ stop

    void stopAll() {
        ServerSocket ss; WebSocketConn c; List<WebSocketConn> cl;
        synchronized (lock) {
            generation++;
            ss = server; server = null;
            c = connection; connection = null; connected = false;
            cl = new ArrayList<>(clients.values()); clients.clear();
            nextId = 1;
        }
        unregister();
        stopDiscovery();
        if (ss != null) try { ss.close(); } catch (IOException ignored) { }
        if (c != null) c.close();
        for (WebSocketConn k : cl) k.close();
        if (mlock != null && mlock.isHeld()) mlock.release();
    }

    // ------------------------------------------------------------------ helpers

    /** IPv4 addresses of the Wi-Fi / hotspot interfaces, for joining by IP. */
    static List<String> localIPv4() {
        List<String> out = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> it = NetworkInterface.getNetworkInterfaces();
            while (it != null && it.hasMoreElements()) {
                NetworkInterface ni = it.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                String n = ni.getName();
                if (n.startsWith("rmnet") || n.startsWith("ccmni") || n.startsWith("pdp") || n.startsWith("v4-") || n.startsWith("dummy") || n.startsWith("tun")) continue;
                Enumeration<InetAddress> as = ni.getInetAddresses();
                while (as.hasMoreElements()) {
                    InetAddress a = as.nextElement();
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) out.add(a.getHostAddress());
                }
            }
        } catch (Exception ignored) { }
        return out;
    }

    private static Ev ev(String t) { return new Ev(t); }

    private void emit(Ev e) {
        act.js("window.__net && window.__net(" + e.o.toString() + ")");
    }

    /** A small JSONObject wrapper whose put does not throw. */
    static final class Ev {
        final JSONObject o = new JSONObject();
        Ev(String t) { put2("t", t); }
        Ev put2(String k, Object v) { try { o.put(k, v); } catch (Exception ignored) { } return this; }
    }

    @SuppressWarnings("unused")
    private static boolean isAtLeast(int sdk) { return Build.VERSION.SDK_INT >= sdk; }
}
