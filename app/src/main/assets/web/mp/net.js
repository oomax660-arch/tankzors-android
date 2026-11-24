/* Network transport for the multiplayer mode.
 *
 * One phone creates the room (the "host"); the others join it. The host runs the whole battle,
 * the others send their controls and draw what the host sends.
 *
 * Two back-ends with the same events:
 *  - native: the iOS app (Network.framework): Bonjour room discovery + WebSocket server/client,
 *    reached through window.webkit.messageHandlers.net; events come back via window.__net(evt).
 *  - ws: plain browser WebSocket to tools/mp_relay.js (desktop testing, ?mpws=ws://host:port).
 *
 * Events (Net.on(fn)):
 *   {t:'hosting', ok, ips:[..], port}     host: room is open
 *   {t:'rooms', list:[{key, name, info}]}  browse result (repeated while browsing)
 *   {t:'join', id}  {t:'leave', id}       host: a player connected / disconnected
 *   {t:'connected'}                        client: connected to the host
 *   {t:'closed', reason}                   client: connection lost / host: room closed
 *   {t:'msg', from, data}                  a message (host: from a client id; client: from 0 = host)
 *   {t:'error', msg}
 */
'use strict';
(function () {
  const listeners = new Set();
  const emit = (e) => { for (const f of Array.from(listeners)) { try { f(e); } catch (err) { console.error(err); } } };
  window.__net = (e) => emit(typeof e === 'string' ? JSON.parse(e) : e);

  const params = new URLSearchParams(location.search);
  const NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.net);
  const WSURL = params.get('mpws');

  /* ---------------- native (iOS) ---------------- */
  const nativeBackend = {
    kind: 'native',
    post(o) { window.webkit.messageHandlers.net.postMessage(JSON.stringify(o)); },
    host(name, info) { this.post({ op: 'host', name, info }); },
    browse(on) { this.post({ op: on ? 'browse' : 'stopBrowse' }); },
    join(key) { this.post({ op: 'join', key }); },
    joinIP(ip, port) { this.post({ op: 'joinIP', ip, port: port || 47700 }); },
    send(to, data) { this.post({ op: 'send', to, data }); },
    stop() { this.post({ op: 'stop' }); },
  };

  /* ---------------- browser WebSocket to tools/mp_relay.js ---------------- */
  const wsBackend = {
    kind: 'ws',
    sock: null, role: null, browseTimer: null,
    open(role, roomKey) {
      this.close();
      this.role = role;
      const s = new WebSocket(WSURL + '/?role=' + role + (roomKey ? '&room=' + encodeURIComponent(roomKey) : ''));
      this.sock = s;
      s.onmessage = (m) => { const e = JSON.parse(m.data); emit(e); };
      s.onclose = () => { if (this.sock === s) { this.sock = null; emit({ t: 'closed', reason: 'связь потеряна' }); } };
      s.onerror = () => emit({ t: 'error', msg: 'нет связи с ' + WSURL });
      return s;
    },
    close() { if (this.sock) { const s = this.sock; this.sock = null; try { s.close(); } catch (e) {} } },
    host(name, info) { const s = this.open('host'); s.onopen = () => s.send(JSON.stringify({ op: 'host', name, info })); },
    browse(on) {
      clearInterval(this.browseTimer); this.browseTimer = null;
      if (!on) return;
      const poll = () => fetch(WSURL.replace(/^ws/, 'http') + '/rooms').then(r => r.json()).then(list => emit({ t: 'rooms', list })).catch(() => emit({ t: 'rooms', list: [] }));
      poll(); this.browseTimer = setInterval(poll, 1500);
    },
    join(key) { this.open('client', key); },
    joinIP() { this.open('client', ''); },
    send(to, data) { if (this.sock && this.sock.readyState === 1) this.sock.send(JSON.stringify({ op: 'send', to, data })); },
    stop() { this.browse(false); this.close(); },
  };

  /* ---------------- loopback (no network: play alone with bots) ---------------- */
  const loopBackend = {
    kind: 'local',
    host() { setTimeout(() => emit({ t: 'hosting', ok: true, ips: [], port: 0 }), 0); },
    browse() {}, join() {}, joinIP() {}, send() {}, stop() {},
  };

  const Net = {
    native: NATIVE,
    available: NATIVE || !!WSURL,
    backend: NATIVE ? nativeBackend : WSURL ? wsBackend : loopBackend,
    on(f) { listeners.add(f); return () => listeners.delete(f); },
    host(name, info) { this.backend.host(name, info || ''); },
    hostLocal() { this.backend = loopBackend; this.backend.host(); },
    reset() { this.backend = NATIVE ? nativeBackend : WSURL ? wsBackend : loopBackend; },
    browse(on) { this.backend.browse(on); },
    join(key) { this.backend.join(key); },
    joinIP(ip, port) { this.backend.joinIP(ip, port); },
    /** host: to = client id or -1 for everybody; client: to is ignored (always the host) */
    send(to, obj) { this.backend.send(to, typeof obj === 'string' ? obj : JSON.stringify(obj)); },
    stop() { this.backend.stop(); },
  };
  window.MPNet = Net;
})();
