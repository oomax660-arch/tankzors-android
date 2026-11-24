/* Multiplayer mode: screens (home, room, battle, results), the host loop and the client side. */
'use strict';
(function () {
const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const Net = window.MPNet, Eng = () => window.MPEngine, R = () => window.MPRender;
const HOST_PID = 100;
const store = { get(k, d) { try { const v = localStorage.getItem('mp:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('mp:' + k, JSON.stringify(v)); } catch (e) {} } };
const NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mode);

const MODES = [
  { id: 'defense', name: 'Оборона базы', desc: 'Вместе против волн ботов. Между волнами стройте стены и пушки.', teams: false },
  { id: 'assault', name: 'Штурм крепости', desc: 'Вместе против огромной базы умных ботов. Чем вас больше, тем она сильнее.', teams: false },
  { id: 'bases', name: 'Базы', desc: 'У каждого своя база. Копите монеты, стройтесь, нанимайте ботов — и сами решайте, когда нападать.', teams: true },
  { id: 'ctf', name: 'Захват флага', desc: 'Две команды. Утащите чужой флаг к своему. Боты помогают обеим сторонам.', teams: 2 },
  { id: 'ffa', name: 'Схватка', desc: 'Каждый сам за себя, вместе с ботами. До 15 побед.', teams: false },
];
const TEAM_COLORS = ['#ffd84a', '#6aa8ff', '#6fe26f', '#5fe8f0'];
const TEAM_NAMES = ['Жёлтые', 'Синие', 'Зелёные', 'Голубые'];
const KIND_LABEL = { light: 'Лёгкий', heavy: 'Тяжёлый', siege: 'Осадный' };
const DEFAULTS = { mode: 'defense', size: 1, theme: 'grass', botLevel: 1, bots: 2, waves: 10, truce: 120, wild: true, ff: false, startLevel: 1, xpRate: 1, map: 'gen' };

/* ------------------------------------------------------------ DOM */
function buildDom() {
  const root = document.createElement('div');
  root.id = 'mp'; root.hidden = true;
  root.innerHTML = `
  <div class="scr" id="mp-home">
    <h1>Сетевая игра</h1>
    <div class="sub">2–4 игрока по Wi‑Fi. Боты, базы, стройка, флаги.</div>
    <div class="card">
      <div class="muted" style="margin-bottom:6px">Ваш ник — его видят над танком</div>
      <input type="text" id="mp-name" maxlength="14" autocomplete="off" autocorrect="off" spellcheck="false">
    </div>
    <button class="main" id="mp-create">Создать игру</button>
    <h2>Игры рядом <span class="scan" id="mp-scan"></span></h2>
    <div class="rooms" id="mp-rooms"><div class="muted">Ищем…</div></div>
    <div class="err" id="mp-homeerr"></div>
    <div class="card hint">
      <b>Как подключиться — без IP и настроек.</b> Включите на всех телефонах <b>Wi‑Fi и Bluetooth</b> (общая сеть не обязательна — телефоны находят друг друга напрямую).
      Один жмёт «Создать игру», у остальных она сама появляется в списке — жмите «Войти».
      Подойдёт и общий Wi‑Fi, и Режим модема. Связь пропала — игра сама переподключит, а вы вернётесь в свой танк. Войти можно и в уже идущий бой.<br>
      При первом запуске iPhone спросит доступ к локальной сети — разрешите.
    </div>
    <details class="ipbox"><summary>Не видно игру? Подключиться по IP</summary>
      <div class="row" style="margin-top:6px"><input type="text" id="mp-ip" placeholder="IP создателя, напр. 172.20.10.1"><button class="small" id="mp-ipgo" style="flex:0 0 auto">Подключиться</button></div>
    </details>
    <button class="ghost" id="mp-solo">Играть одному с ботами</button>
    <button class="ghost" id="mp-exit">Назад к кампании</button>
  </div>

  <div class="scr" id="mp-room" hidden>
    <div class="row" style="align-items:flex-start"><div><h1 id="mp-rname">Комната</h1><div class="sub" id="mp-rsub"></div></div>
      <button class="small" id="mp-leave" style="flex:0 0 auto;margin-top:8px">Выйти</button></div>
    <div class="ipline" id="mp-ipline" hidden></div>
    <div class="roomcols"><div class="colA">
    <h2>Режим</h2>
    <div class="modes" id="mp-modes"></div>
    <h2>Настройки</h2>
    <div class="card" id="mp-opts"></div>
    </div><div class="colB">
    <h2>Игроки <span class="muted" id="mp-pcount"></span></h2>
    <div class="plist" id="mp-players"></div>
    <div class="card">
      <div class="opt" id="mp-teamrow"><span>Моя команда</span><div class="teams" id="mp-team"></div></div>
      <div class="hint" style="padding-top:6px">Все начинают одинаково — на лёгком танке. В бою копите <b>опыт</b> (урон, победы, стройка, задания) и <b>монеты</b>.
        Каждый уровень даёт очко навыка: <b>Броня, Двигатель, Орудие, Инженер, Командир</b> — всё сразу не прокачать, выбирайте роль.
        Тяжёлый танк открывается с 3-го уровня, осадный — с 5-го; пушки, тяжёлые боты и число ботов зависят от уровня и навыков.</div>
    </div>
    <div class="sticky">
      <div class="err" id="mp-roomerr"></div>
      <button class="main" id="mp-go">Готов</button>
    </div>
    </div></div>
  </div>

  <div id="mp-battle" hidden>
    <canvas id="mp-cv"></canvas>
    <div id="mp-hud">
      <div class="top"><div class="status" id="mp-status"></div></div>
      <div class="coins" id="mp-coins"></div>
      <div class="hpbar" id="mp-hp"></div>
      <div class="build" id="mp-build"></div>
      <div class="lvl" id="mp-lvl"></div>
      <div class="weapon" id="mp-weapon"><button class="wprev" id="mp-wprev">‹</button><span id="mp-wname"></span><button class="wnext" id="mp-wnext">›</button></div>
      <div class="feed" id="mp-feed"></div>
      <div class="center" id="mp-center"></div>
      <div class="dead" id="mp-dead"></div>
      <canvas id="mp-mini"></canvas>
      <button id="mp-pausebtn">≡ меню</button>
      <div id="mp-keys">стрелки — ехать · пробел — огонь · A / S — оружие · Q — улучшения и арсенал · W — следующая постройка · E — построить · R — ремонт · B — приказ ботам · M — карта · Esc — меню</div>
    </div>
    <div class="overlay" id="mp-up" hidden><div class="box up">
      <div class="uphead"><div><b id="mp-uplvl"></b><div class="xpbar"><i id="mp-upxp"></i></div><span class="muted" id="mp-upxpt"></span></div>
        <div class="upcoins" id="mp-upcoins"></div><button class="upx" id="mp-upx" aria-label="Закрыть">✕</button></div>
      <div class="tabs" id="mp-tabs"><button data-t="skills" class="on">Навыки</button><button data-t="tank">Танк</button><button data-t="build">Стройка</button><button data-t="shop">Арсенал</button></div>
      <div id="mp-upbody"></div>
      <button class="main" id="mp-upclose">Готово</button>
    </div></div>
    <div class="overlay" id="mp-pause" hidden><div class="box">
      <div class="result">Пауза</div>
      <div class="muted" style="text-align:center;margin-bottom:8px">Игра идёт дальше — остальные играют</div>
      <div id="mp-ptable"></div>
      <button class="main" id="mp-resume">Продолжить</button>
      <button class="ghost" id="mp-toroom" hidden>Закончить бой — всех в комнату</button>
      <button class="ghost" id="mp-quit">Выйти из боя</button>
    </div></div>
    <div class="overlay" id="mp-over" hidden><div class="box">
      <div class="result" id="mp-otext"></div>
      <div id="mp-otable"></div>
      <button class="main" id="mp-again">В комнату</button>
      <div class="muted" id="mp-owait" style="text-align:center;margin-top:8px" hidden>Ждём создателя игры…</div>
      <button class="ghost" id="mp-oquit">Выйти</button>
    </div></div>
  </div>`;
  document.body.appendChild(root);
  return root;
}

/* ------------------------------------------------------------ controller */
const MP = {
  active: false, role: null, pid: 0, room: null, game: null, view: null, sfx: true,
  input: { dirs: [], f: false, a: [] }, lastSent: '', lastSendT: 0,

  init() {
    if (this.root) return;
    this.root = buildDom();
    $('#mp-name').value = store.get('name', 'Танкист' + (Math.random() * 90 + 10 | 0));
    $('#mp-name').addEventListener('change', () => store.set('name', this.myName()));
    $('#mp-create').onclick = () => this.create(false);
    $('#mp-solo').onclick = () => this.create(true);
    $('#mp-exit').onclick = () => this.close();
    $('#mp-ipgo').onclick = () => { const ip = $('#mp-ip').value.trim(); if (!ip) return; store.set('ip', ip); this.joinRoom(null, ip); };
    $('#mp-ip').value = store.get('ip', '');
    $('#mp-leave').onclick = () => this.leaveRoom();
    $('#mp-go').onclick = () => this.goPressed();
    $('#mp-resume').onclick = () => { $('#mp-pause').hidden = true; };
    $('#mp-pausebtn').onclick = () => this.togglePause();
    $('#mp-quit').onclick = () => this.leaveRoom();
    $('#mp-toroom').onclick = () => { if (this.role === 'host') { $('#mp-pause').hidden = true; this.backToRoom(); } };
    $('#mp-again').onclick = () => { if (this.role === 'host') this.backToRoom(); };
    $('#mp-oquit').onclick = () => this.leaveRoom();
    $('#mp-mini').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.toggleMap(); });
    for (const id of ['#mp-coins', '#mp-build', '#mp-lvl']) $(id).addEventListener('pointerdown', (e) => { e.stopPropagation(); this.toggleUp(true); });
    $('#mp-wprev').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.weapon('w:prev'); });
    $('#mp-wnext').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.weapon('w:next'); });
    $('#mp-wname').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.upTab = 'shop'; this.toggleUp(true); });
    $('#mp-upclose').onclick = () => this.toggleUp(false);
    $('#mp-upx').onclick = () => this.toggleUp(false);
    for (const b of document.querySelectorAll('#mp-tabs button')) b.onclick = () => { this.upTab = b.dataset.t; this.renderUp(true); };
    Net.on((e) => this.onNet(e));
    window.addEventListener('keydown', (e) => this.kbd(e, true));
    window.addEventListener('keyup', (e) => this.kbd(e, false));
    window.addEventListener('resize', () => { this.hudShift(); if (this.view) this.view.draw(); });
    this.hudShift();
  },
  weapon(a) { if (!this.input) return; this.input.a.push(a); this.sendInput(true); this.haptic(-1); },
  icon(i, big, tint) { return '<i class="ico' + (big ? ' big' : '') + '" style="background-position:' + (-i * (big ? 38 : 28)) + 'px 0' + (tint ? ';filter:hue-rotate(55deg) saturate(1.5)' : '') + '"></i>'; },
  myName() { return ($('#mp-name').value || '').trim().slice(0, 14) || 'Игрок'; },
  /** the app's top buttons sit in the top corners: beside the camera notch when the safe area is tall (iPhone),
   *  else in a row under its edge, where the battle's status line would be — move the HUD down under them */
  hudShift() {
    let shift = 0;
    if (NATIVE && window.innerHeight > window.innerWidth) {
      const pr = document.getElementById('safe-probe');
      const sat = pr ? parseFloat(getComputedStyle(pr).paddingTop) || 0 : 0;
      if (sat < 40) shift = Math.max(8, sat + 6) + 34 + 6 - (sat + 6);
    }
    document.documentElement.style.setProperty('--hudshift', shift + 'px');
  },
  nativeMode(m) { if (NATIVE) try { window.webkit.messageHandlers.mode.postMessage(m); } catch (e) {} },
  haptic(n) { try { if (window.webkit && window.webkit.messageHandlers.haptic) window.webkit.messageHandlers.haptic.postMessage(n); } catch (e) {} },

  /* ---------------- open / close ---------------- */
  open() {
    this.init();
    this.active = true; window.__mpActive = true;
    if (window.__appPause) window.__appPause();
    // the campaign is paused: keep its music silent but let the battle sounds play
    const a = window.__host && window.__host.audio;
    if (a) { this.mutedPlayers = []; for (const p of a.players.values()) if (p.gain) { this.mutedPlayers.push([p, p.gain.gain.value]); p.gain.gain.value = 0; } try { a.resume(); } catch (e) {} }
    this.root.hidden = false;
    // in the network game the campaign is paused, but its audio must keep running for the battle sounds
    if (a) { a.held = false; a.kick(); }
    if (!this.audioTap) { this.audioTap = true; this.root.addEventListener('pointerdown', () => { const au = window.__host && window.__host.audio; if (au && this.active) { au.held = false; au.kick(); } }, true); }
    this.show('home');
    this.nativeMode('overlay');
    Net.reset();
    Net.browse(true);
    this.renderRooms([]);
  },
  close() {
    Net.browse(false); Net.stop();
    this.stopLoop();
    this.active = false; window.__mpActive = false;
    this.role = null; this.room = null; this.game = null; this.view = null;
    this.root.hidden = true;
    for (const [p, v] of this.mutedPlayers || []) if (p.gain) p.gain.gain.value = v;
    this.mutedPlayers = [];
    const h = window.__host;
    this.nativeMode(h ? h.screenKind : 'menu');
    if (window.__appResume) window.__appResume();
  },
  show(which) {
    for (const id of ['home', 'room', 'battle']) $('#mp-' + id).hidden = id !== which;
    this.screen = which;
    this.nativeMode(which === 'battle' ? 'mp' : 'overlay');
    if (which !== 'battle') { $('#mp-pause').hidden = true; $('#mp-over').hidden = true; }
  },

  /* ---------------- rooms list ---------------- */
  renderRooms(list) {
    const el = $('#mp-rooms');
    if (!Net.available) { el.innerHTML = '<div class="muted">Поиск игр работает в приложении на iPhone. Для проверки в браузере запустите tools/mp_relay.js и откройте страницу с ?mpws=ws://localhost:8090</div>'; return; }
    const sc = $('#mp-scan'); if (sc) sc.textContent = '· поиск идёт';
    if (!list.length) { el.innerHTML = '<div class="muted">Пока никого. Попросите друга создать игру или создайте свою — список обновляется сам.</div>'; return; }
    el.innerHTML = '';
    for (const r of list) {
      const d = document.createElement('div'); d.className = 'room';
      d.innerHTML = '<div style="flex:1"><b>' + esc(r.name) + '</b><span>' + esc(r.info || '') + '</span></div><button class="small main2">Войти</button>';
      d.onclick = () => this.joinRoom(r.key);
      el.appendChild(d);
    }
  },

  /* ---------------- host: create a room ---------------- */
  create(solo) {
    store.set('name', this.myName());
    Net.browse(false);
    this.role = 'host'; this.pid = HOST_PID; this.solo = solo;
    const st = Object.assign({}, DEFAULTS, store.get('settings', {}));
    this.room = { name: solo ? 'Тренировка с ботами' : 'Игра ' + this.myName(), host: HOST_PID, settings: st, players: [], ips: [], inGame: false };
    this.room.players.push({ pid: HOST_PID, name: this.myName(), kind: store.get('kind', 'light'), team: 0, ready: true });
    if (solo) { Net.hostLocal(); } else Net.host(this.room.name, this.roomInfo());
    this.show('room');
    this.renderRoom();
  },
  roomInfo() { const m = MODES.find(x => x.id === this.room.settings.mode); return (m ? m.name : '') + ' · игроков: ' + this.room.players.length + '/4'; },
  broadcastRoom() {
    if (this.role !== 'host') return;
    Net.send(-1, { t: 'room', room: this.publicRoom() });
    if (Net.backend.kind === 'native') Net.backend.post({ op: 'info', info: this.roomInfo() });
    else if (Net.backend.kind === 'ws' && Net.backend.sock && Net.backend.sock.readyState === 1) Net.backend.sock.send(JSON.stringify({ op: 'info', info: this.roomInfo() }));
    this.renderRoom();
  },
  publicRoom() { const r = this.room; return { name: r.name, host: r.host, settings: r.settings, players: r.players, ips: r.ips, inGame: r.inGame }; },

  /* ---------------- client: join ---------------- */
  joinRoom(key, ip, tries) {
    store.set('name', this.myName());
    Net.browse(false);
    this.role = 'client'; this.pid = 0; this.room = null;
    this.lastJoin = { key, ip }; this.joinTries = tries || 0;
    $('#mp-homeerr').textContent = 'Подключаемся…' + (tries ? ' (попытка ' + (tries + 1) + ')' : '');
    this.connectNow();
    clearTimeout(this.joinTimer);
    this.joinTimer = setTimeout(() => { if (this.role === 'client' && !this.room) this.joinFailed('нет ответа'); }, 7000);
  },
  connectNow() { const j = this.lastJoin; if (!j) return; if (j.ip) { const [h, p] = j.ip.split(':'); Net.joinIP(h, +p || 47700); } else Net.join(j.key); },
  /** the first tries failed: try again a couple of times before giving up */
  joinFailed(why) {
    clearTimeout(this.joinTimer);
    Net.stop();
    if (this.lastJoin && this.joinTries < 2) { const j = this.lastJoin; setTimeout(() => { if (this.role === 'client' && !this.room) this.joinRoom(j.key, j.ip, this.joinTries + 1); }, 700); return; }
    $('#mp-homeerr').textContent = 'Не удалось подключиться (' + why + '). Проверьте, что Wi‑Fi и Bluetooth включены, а доступ к локальной сети разрешён.';
    this.role = null; Net.browse(true);
  },
  /** the connection dropped during the game: reconnect quietly, the host gives us our tank back */
  reconnect(why) {
    this.recon = (this.recon || 0) + 1;
    if (this.recon > 8 || !this.lastJoin) { this.recon = 0; this.leaveRoom(); $('#mp-homeerr').textContent = 'Игра закрыта: ' + why; return; }
    if (this.screen === 'battle') this.center('Связь пропала — переподключаемся…');
    else $('#mp-roomerr').textContent = 'Связь пропала — переподключаемся…';
    clearTimeout(this.reconT);
    this.reconT = setTimeout(() => { if (this.role !== 'client') return; Net.stop(); this.reconnecting = true; this.connectNow(); }, 900 + this.recon * 300);
  },
  leaveRoom() {
    if (this.role === 'host' && this.room && !this.solo) Net.send(-1, { t: 'bye' });
    this.stopLoop();
    Net.stop();
    this.role = null; this.room = null; this.game = null; this.view = null;
    Net.reset();
    this.show('home');
    Net.browse(true);
  },

  /* ---------------- network events ---------------- */
  onNet(e) {
    if (!this.active) return;
    if (e.t === 'rooms') { if (this.screen === 'home') this.renderRooms(e.list || []); return; }
    if (this.role === 'host') {
      if (e.t === 'hosting') { if (!e.ok) { $('#mp-roomerr').textContent = 'Не удалось открыть комнату: ' + (e.msg || ''); return; } this.room.ips = e.ips || []; this.renderRoom(); return; }
      if (e.t === 'join') { Net.send(e.id, { t: 'welcome', pid: e.id }); return; }
      if (e.t === 'leave') {
        const i = this.room.players.findIndex(p => p.pid === e.id);
        if (i >= 0) {
          const p = this.room.players[i];
          if (this.game) this.game.playerLeft(e.id);
          if (!this.room.inGame) this.room.players.splice(i, 1);
          else this.room.players.splice(i, 1);
          if (!this.game) this.toast(p.name + ' отключился');
          this.broadcastRoom();
        }
        return;
      }
      if (e.t === 'msg') { let m; try { m = JSON.parse(e.data); } catch (er) { return; } this.hostMsg(e.from, m); return; }
    } else if (this.role === 'client') {
      if (e.t === 'connected') { Net.send(0, { t: 'hello', name: this.myName(), kind: store.get('kind', 'light') }); return; }
      if (e.t === 'closed' || e.t === 'error') {
        const why = e.reason || e.msg || 'связь потеряна';
        if (this.screen === 'home') { this.joinFailed(why); return; }
        if (/закрыл|closed by host/.test(why)) { this.leaveRoom(); $('#mp-homeerr').textContent = 'Игра закрыта: ' + why; return; }
        this.reconnect(why); return;
      }
      if (e.t === 'msg') { let m; try { m = JSON.parse(e.data); } catch (er) { return; } this.clientMsg(m); }
    }
  },
  hostMsg(from, m) {
    const r = this.room;
    if (m.t === 'hello') {
      if (r.inGame && this.game) { this.joinRunning(from, m); return; }
      if (r.inGame) { Net.send(from, { t: 'kick', reason: 'игра уже идёт' }); return; }
      if (r.players.length >= 4) { Net.send(from, { t: 'kick', reason: 'комната заполнена (4 игрока)' }); return; }
      let name = String(m.name || 'Игрок').slice(0, 14);
      while (r.players.some(p => p.name === name)) name = name.slice(0, 12) + (Math.random() * 9 + 1 | 0);
      r.players.push({ pid: from, name, kind: ['light', 'heavy', 'siege'].includes(m.kind) ? m.kind : 'light', team: this.freeTeam(), ready: false });
      this.toast(name + ' подключился');
      this.broadcastRoom();
    } else if (m.t === 'set') {
      const p = r.players.find(q => q.pid === from); if (!p || r.inGame) return;
      if (m.kind && ['light', 'heavy', 'siege'].includes(m.kind)) p.kind = m.kind;
      if (m.team !== undefined) { p.team = Math.max(0, Math.min(3, m.team | 0)); if (r.settings.mode !== 'ctf') delete p.team4; }
      if (m.ready !== undefined) p.ready = !!m.ready;
      this.broadcastRoom();
    } else if (m.t === 'in') {
      if (this.game) this.game.input(from, m);
    }
  },
  joinRunning(from, m) {
    const r = this.room, g = this.game;
    const name = String(m.name || 'Игрок').slice(0, 14);
    // the same player coming back after a drop takes his own tank back
    let p = Array.from(g.players.values()).find(q => q.bot && q.baseName === name && !r.players.some(x => x.pid === q.pid));
    if (p) g.rejoin(p.pid, from, name);
    else {
      if (r.players.length >= 4) { Net.send(from, { t: 'kick', reason: 'в бою уже 4 игрока' }); return; }
      let nm = name; while (Array.from(g.players.values()).some(q => q.name === nm)) nm = nm.slice(0, 12) + (Math.random() * 9 + 1 | 0);
      p = g.lateJoin(from, nm);
    }
    r.players.push({ pid: from, name: p.name, kind: 'light', team: p.team, ready: true });
    const start = this.startMsg();
    if (this.view) this.view.roster = start.roster;
    Net.send(from, { t: 'room', room: this.publicRoom() });
    Net.send(from, start);
    this.toast(p.name + ' в бою');
    this.broadcastRoom();
  },
  startMsg() {
    const g = this.game, spawns = [];
    for (const [team, ti] of Object.entries(g.teamInfo)) for (const [x, y] of ti.spawns || []) spawns.push([x, y, +team]);
    return { t: 'start', cfg: g.cfg, roster: Array.from(g.players.values()).map(p => ({ pid: p.pid, name: p.name, team: p.team, kind: p.kind })), map: g.mapData(), spawns };
  },
  /** the battlefield: a new random map or any campaign map, with small previews */
  mapPicker(opts, st, host) {
    const E = Eng();
    if (!this.cmaps) { try { this.cmaps = E.campaignMaps(); } catch (e) { this.cmaps = []; } }
    const row = document.createElement('div'); row.className = 'opt mapopt';
    row.innerHTML = '<span>Поле боя</span>';
    const strip = document.createElement('div'); strip.className = 'mapstrip';
    const add = (id, label, draw) => {
      if (!host && st.map !== id) return;
      const b = document.createElement('button'); b.className = 'mapc' + (st.map === id ? ' on' : '');
      const c = document.createElement('canvas'); c.width = 64; c.height = 64; draw(c.getContext('2d'));
      b.appendChild(c); const t = document.createElement('div'); t.textContent = label; b.appendChild(t);
      if (host) b.onclick = () => { st.map = id; this.saveSettings(); this.broadcastRoom(); };
      strip.appendChild(b);
    };
    add('gen', 'Новая', (x) => { x.fillStyle = '#3b5a26'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#ffe3c4'; x.font = 'bold 34px sans-serif'; x.textAlign = 'center'; x.fillText('?', 32, 45); });
    for (const cm of this.cmaps) add('c:' + cm.n, 'Миссия ' + (cm.n + 1), (x) => this.drawThumb(x, cm));
    row.appendChild(strip);
    opts.appendChild(row);
    if (host) setTimeout(() => { const on = strip.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' }); }, 0);
  },
  drawThumb(x, cm) {
    const s = 64 / Math.max(cm.W, cm.H), ox = (64 - cm.W * s) / 2, oy = (64 - cm.H * s) / 2;
    x.fillStyle = '#111'; x.fillRect(0, 0, 64, 64);
    for (let i = 0; i < cm.W * cm.H; i++) {
      const c = cm.tiles[i];
      x.fillStyle = c >= 129 && c <= 136 ? '#7a5530' : c >= 137 && c <= 139 ? '#9a9a90' : c >= 140 && c <= 141 ? '#4a5560' : c >= 142 && c <= 146 ? '#173a17' : (c >= 55 && c <= 99) ? '#8a7448' : '#3b5a26';
      x.fillRect(ox + (i % cm.W) * s, oy + ((i / cm.W) | 0) * s, Math.ceil(s), Math.ceil(s));
    }
  },
  freeTeam() { const used = this.room.players.map(p => p.team); for (let t = 0; t < 4; t++) if (!used.includes(t)) return t; return 0; },
  clientMsg(m) {
    if (m.t === 'welcome') { this.pid = m.pid; clearTimeout(this.joinTimer); clearTimeout(this.reconT); if (this.recon) { this.recon = 0; this.center(''); $('#mp-roomerr').textContent = ''; } return; }
    if (m.t === 'bye') { this.lastJoin = null; this.leaveRoom(); $('#mp-homeerr').textContent = 'Создатель закрыл игру'; return; }
    if (m.t === 'kick') { this.leaveRoom(); $('#mp-homeerr').textContent = 'Нельзя войти: ' + m.reason; return; }
    if (m.t === 'room') {
      const first = !this.room || this.screen === 'home';
      this.room = m.room;
      if (first) { $('#mp-homeerr').textContent = ''; this.show('room'); }
      if (this.screen === 'battle' && !m.room.inGame) { this.view = null; this.stopLoop(); this.show('room'); }
      this.renderRoom();
      return;
    }
    if (m.t === 'start') { this.reconnecting = false; this.startView(m); return; }
    if (m.t === 'snap') { if (this.view) this.view.applySnap(m.s, performance.now()); return; }
  },

  /* ---------------- room screen ---------------- */
  renderRoom() {
    const r = this.room; if (!r || this.screen !== 'room') return;
    const host = this.role === 'host';
    const st = r.settings;
    const mode = MODES.find(x => x.id === st.mode) || MODES[0];
    $('#mp-rname').textContent = r.name;
    $('#mp-rsub').textContent = host ? (this.solo ? 'Только вы и боты' : 'Вы создатель игры') : 'Создатель: ' + ((r.players.find(p => p.pid === r.host) || {}).name || '');
    const ipl = $('#mp-ipline');
    ipl.hidden = !(host && !this.solo);
    if (host && !this.solo) ipl.innerHTML = r.ips && r.ips.length ? 'Для подключения по IP: <b>' + r.ips.map(esc).join('</b> или <b>') + '</b>' : 'Комната открывается…';
    // modes
    const mel = $('#mp-modes'); mel.innerHTML = '';
    for (const md of MODES) {
      if (!host && md.id !== st.mode) continue;
      const b = document.createElement('button'); b.className = 'mode' + (md.id === st.mode ? ' on' : '');
      b.innerHTML = '<b>' + md.name + '</b><span>' + md.desc + '</span>';
      if (host) b.onclick = () => { st.mode = md.id; this.fixTeams(); this.saveSettings(); this.broadcastRoom(); };
      mel.appendChild(b);
    }
    mel.style.gridTemplateColumns = host ? '' : '1fr';
    // options
    const opts = $('#mp-opts'); opts.innerHTML = '';
    const seg = (label, key, values, show) => {
      if (show === false) return;
      const row = document.createElement('div'); row.className = 'opt';
      row.innerHTML = '<span>' + label + '</span><div class="seg' + (host ? '' : ' ro') + '"></div>';
      const sg = row.querySelector('.seg');
      for (const [v, t] of values) {
        const b = document.createElement('button'); b.textContent = t; if (st[key] === v) b.className = 'on';
        if (host) b.onclick = () => { st[key] = v; this.saveSettings(); this.broadcastRoom(); };
        sg.appendChild(b);
      }
      opts.appendChild(row);
    };
    const m = st.mode;
    const canPick = m === 'ffa' || m === 'bases' || m === 'ctf';
    if (!canPick && st.map !== 'gen') st.map = 'gen';
    if (canPick) this.mapPicker(opts, st, host);
    seg('Карта', 'size', [[0, 'малая'], [1, 'средняя'], [2, 'большая'], [3, 'огромная']]);
    if (st.map === 'gen' || !canPick) seg('Местность', 'theme', [['grass', 'лес'], ['desert', 'пустыня']]);
    seg('Боты', 'botLevel', [[0, 'лёгкие'], [1, 'обычные'], [2, 'умные']]);
    seg(m === 'defense' || m === 'assault' ? 'Боты-союзники' : m === 'ffa' ? 'Ботов в схватке' : 'Ботов в каждой команде', 'bots', m === 'ffa' ? [[0, '0'], [2, '2'], [4, '4'], [6, '6']] : [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4']]);
    seg('Волн', 'waves', [[5, '5'], [10, '10'], [15, '15'], [20, '20']], m === 'defense');
    seg('Перемирие в начале', 'truce', [[0, 'нет'], [60, '1 мин'], [120, '2 мин'], [180, '3 мин'], [300, '5 мин']], m === 'bases');
    seg('Дикие боты в центре', 'wild', [[true, 'да'], [false, 'нет']], m === 'bases');
    seg('Начальный уровень', 'startLevel', [[1, '1'], [3, '3'], [5, '5']]);
    seg('Прокачка', 'xpRate', [[1, 'обычная'], [2, 'быстрая']]);
    seg('Огонь по своим', 'ff', [[false, 'нет'], [true, 'да']]);
    // players
    $('#mp-pcount').textContent = r.players.length + '/4';
    const pl = $('#mp-players'); pl.innerHTML = '';
    for (const p of r.players) {
      const d = document.createElement('div'); d.className = 'pl';
      const teamDot = mode.teams ? '<div class="dot" style="background:' + TEAM_COLORS[p.team] + '"></div>' : '<div class="dot" style="background:' + TEAM_COLORS[0] + '"></div>';
      d.innerHTML = teamDot + '<div class="nm">' + esc(p.name) + (p.pid === this.pid ? ' <span class="muted">(вы)</span>' : '') + '</div>' +
        '<span class="rd' + (p.ready ? '' : ' no') + '">' + (p.pid === r.host ? 'создатель' : p.ready ? 'готов' : 'не готов') + '</span>';
      pl.appendChild(d);
    }
    // my tank / team
    const me = r.players.find(p => p.pid === this.pid);
    $('#mp-teamrow').hidden = !mode.teams;
    const tel = $('#mp-team'); tel.innerHTML = '';
    const nTeams = mode.teams === 2 ? 2 : 4;
    for (let t = 0; t < nTeams; t++) {
      const b = document.createElement('button'); b.style.background = TEAM_COLORS[t]; b.title = TEAM_NAMES[t]; if (me && me.team === t) b.className = 'on';
      b.onclick = () => this.setMine({ team: t }); tel.appendChild(b);
    }
    // go button
    const go = $('#mp-go');
    if (host) {
      const notReady = r.players.filter(p => !p.ready && p.pid !== r.host);
      go.textContent = 'Начать бой';
      go.disabled = notReady.length > 0;
      $('#mp-roomerr').textContent = notReady.length ? 'Ждём готовности: ' + notReady.map(p => p.name).join(', ') : this.teamWarning();
    } else {
      go.disabled = false;
      go.textContent = me && me.ready ? 'Не готов' : 'Готов';
      $('#mp-roomerr').textContent = me && me.ready ? 'Ждём, когда создатель начнёт бой…' : '';
    }
  },
  teamWarning() {
    const st = this.room.settings, m = MODES.find(x => x.id === st.mode);
    if (m.teams && new Set(this.room.players.map(p => p.team)).size < 2) return st.mode === 'ctf' ? 'Все в одной команде — вторую соберут боты' : 'Все в одной команде — против вас будет база ботов';
    return '';
  },
  fixTeams() {
    const st = this.room.settings;
    // capture the flag has two teams; the colour each player chose for the other modes comes back afterwards
    if (st.mode === 'ctf') for (const p of this.room.players) { if (p.team4 === undefined) p.team4 = p.team; p.team = p.team % 2; }
    else for (const p of this.room.players) if (p.team4 !== undefined) { p.team = p.team4; delete p.team4; }
  },
  setMine(o) {
    if (o.kind) store.set('kind', o.kind);
    if (this.role === 'host') { const me = this.room.players.find(p => p.pid === this.pid); Object.assign(me, o); if (o.team !== undefined && this.room.settings.mode !== 'ctf') delete me.team4; this.broadcastRoom(); }
    else Net.send(0, Object.assign({ t: 'set' }, o));
  },
  saveSettings() { store.set('settings', this.room.settings); },
  goPressed() {
    if (this.role === 'host') this.startGame();
    else { const me = this.room && this.room.players.find(p => p.pid === this.pid); Net.send(0, { t: 'set', ready: !(me && me.ready) }); }
  },

  /* ---------------- host: the battle ---------------- */
  startGame() {
    const r = this.room, st = r.settings;
    this.fixTeams();
    const roster = r.players.map(p => ({ pid: p.pid, name: p.name, team: st.mode === 'ctf' ? p.team % 2 : p.team, kind: p.kind }));
    const cfg = Object.assign({}, st, { seed: (Math.random() * 1e9) | 0 });
    let game;
    try { game = new (Eng().Game)(cfg, roster); } catch (e) { $('#mp-roomerr').textContent = 'Ошибка: ' + e.message; console.error(e); return; }
    this.game = game;
    r.inGame = true;
    const spawns = [];
    for (const [team, ti] of Object.entries(game.teamInfo)) for (const [x, y] of ti.spawns || []) spawns.push([x, y, +team]);
    const start = { t: 'start', cfg, roster: Array.from(game.players.values()).map(p => ({ pid: p.pid, name: p.name, team: p.team, kind: p.kind })), map: game.mapData(), spawns };
    Net.send(-1, start);
    this.broadcastRoom();
    this.startView(start);
    this.stepAcc = 0; this.lastT = performance.now(); this.stepN = 0;
    this.hostTimer = setInterval(() => this.hostTick(), 1000 / 60);
  },
  hostTick() {
    const g = this.game; if (!g) return;
    const now = performance.now();
    this.stepAcc += Math.min(0.25, (now - this.lastT) / 1000); this.lastT = now;
    const DT = Eng().DT;
    while (this.stepAcc >= DT) {
      this.stepAcc -= DT;
      g.input(this.pid, this.localInput());
      g.step(); this.stepN++;
      {
        const s = g.snapshot();
        if (this.room.players.length > 1 || Net.backend.kind !== 'local') Net.send(-1, '{"t":"snap","s":' + JSON.stringify(s) + '}');
        if (this.view) this.view.applySnap(s, now);
      }
    }
  },
  stopLoop() { clearInterval(this.hostTimer); this.hostTimer = null; cancelAnimationFrame(this.raf); this.raf = 0; clearInterval(this.inTimer); this.inTimer = null; },
  backToRoom() {
    this.stopLoop();
    this.game = null; this.view = null;
    this.room.inGame = false;
    // the next round with the same friends: whoever played stays ready, the host can start again at once
    for (const p of this.room.players) if (p.pid !== this.room.host) p.ready = true;
    // players that left during the battle are gone now
    this.show('room');
    this.broadcastRoom();
  },

  /* ---------------- both: battle view ---------------- */
  startView(start) {
    R().Assets.load().then(() => {
      this.view = new (R().View)($('#mp-cv'), this.pid);
      this.view.isHost = this.role === 'host';
      if (!this.iconsSet) { this.iconsSet = true; const F = window.GAME_FILES || {}; document.documentElement.style.setProperty('--mp-icons', 'url(data:image/png;base64,' + (F['icons.png'] || '') + ')'); }
      this.view.setStart(start);
      this.cfg = start.cfg;
      this.show('battle');
      $('#mp-feed').innerHTML = ''; $('#mp-center').innerHTML = '';
      this.input = { dirs: [], f: false, a: [] };
      this.lastOver = null;
      const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
      cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(loop);
      if (this.role === 'client') { clearInterval(this.inTimer); this.inTimer = setInterval(() => this.sendInput(false), 100); }
      const mode = MODES.find(x => x.id === start.cfg.mode);
      this.center(mode ? mode.name : 'Бой!');
    });
  },
  frame() {
    const v = this.view; if (!v) return;
    v.draw();
    const me = v.me, s = v.last;
    if (!s) return;
    $('#mp-status').textContent = s.st || '';
    const buildable = ['defense', 'assault', 'bases'].includes(this.cfg.mode);
    if (me) {
      $('#mp-coins').textContent = '● ' + me.coins + '   ⚔ ' + me.kills;
      const L = Eng().XP_LEVELS, lv = me.level;
      const frac = lv >= Eng().MAX_LEVEL ? 1 : (me.xp - L[lv - 1]) / (L[lv] - L[lv - 1]);
      $('#mp-lvl').innerHTML = 'Ур. ' + lv + ' <span class="xpbar"><i style="width:' + Math.round(frac * 100) + '%"></i></span>' + (me.sp ? ' <b class="sp">+' + me.sp + '</b>' : '');
      const B = Eng().BUILD[me.sel];
      const bel = $('#mp-build');
      bel.hidden = !buildable;
      if (buildable) { const cost = this.costFor(me, B); bel.innerHTML = 'Строить: <b>' + B.name + '</b> <span class="' + (me.coins < cost ? 'no' : '') + '">' + cost + '●</span><br><span class="muted">боты ' + me.bots + '/' + me.botCap + ': ' + Eng().ORDER_NAMES[Eng().ORDERS[me.order]] + '</span>'; }
      const mt = s.k.find(q => q[9] === this.pid);
      let hph = '';
      if (mt) { const hp = mt[4], mx = mt[5], f = mt[14] || 0, fm = mt[15] || 0, ar = mt[16] || 0, am = mt[17] || 0; const n = Math.min(24, mx); for (let i = 0; i < n; i++) hph += '<i class="' + (i < Math.ceil(hp * n / mx) ? (hp / mx > 0.34 ? 'g' : 'r') : '') + '"></i>'; for (let i = 0; i < am; i++) hph += '<i class="' + (i < ar ? 'a' : 'ae') + '"></i>'; for (let i = 0; i < fm; i++) hph += '<i class="' + (i < f ? 'b' : '') + '"></i>'; }
      if (hph !== this.lastHp) { this.lastHp = hph; $('#mp-hp').innerHTML = hph; }
      const W = Eng().WEAPONS[me.w] || Eng().WEAPONS[0];
      const wtxt = this.icon(W.icon, false, W.id === 'vplasma' || W.id === 'hplasma') + ' ' + W.name + (me.w ? ' <b>' + (me.ammo[me.w] || 0) + '</b>' : '');
      if (wtxt !== this.lastW) { this.lastW = wtxt; $('#mp-wname').innerHTML = wtxt; }
      if (!$('#mp-up').hidden && performance.now() - (this.upT || 0) > 300) { this.upT = performance.now(); this.renderUp(); }
      const dead = $('#mp-dead');
      if (!me.tank) dead.textContent = me.out ? 'Ваша база уничтожена — вы наблюдаете' : (this.lastOver ? '' : 'Возрождение через ' + me.respawn + ' с');
      else dead.textContent = '';
    }
    v.drawMini($('#mp-mini'));
    // the host may have already decided the game (late snapshot)
  },
  onEvent(e) {
    if (e.e === 'msg' && (e.to === undefined || e.to === -1 || e.to === this.pid)) {
      // team talk (the intellectual's orders): only for that team
      if (e.team !== undefined && e.team >= 0 && this.view && e.team !== this.view.myTeam()) return;
      this.feedLine(e.text);
    }
    else if (e.e === 'kill') this.feedLine('<span style="color:' + R().teamColor(e.kt) + '">' + esc(e.k || '?') + '</span> ✕ <span style="color:' + R().teamColor(e.vt) + '">' + esc(e.v || '?') + '</span>', true);
    else if (e.e === 'wave') { this.center('В атаку!'); this.haptic(-2); }
    else if (e.e === 'capture' || e.e === 'flag') this.haptic(-2);
    else if (e.e === 'over') this.showOver(e);
  },
  feedLine(html, raw) {
    const el = $('#mp-feed'); if (!el) return;
    const d = document.createElement('div'); d.innerHTML = raw ? html : esc(html);
    el.appendChild(d);
    while (el.children.length > 5) el.removeChild(el.firstChild);
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 6200);
  },
  center(text) { const el = $('#mp-center'); el.innerHTML = '<div>' + esc(text) + '</div>'; },
  toast(text) { if (this.screen === 'battle') this.feedLine(text); },
  showOver(e) {
    this.lastOver = e;
    $('#mp-otext').textContent = e.text;
    $('#mp-otable').innerHTML = this.tableHtml(e.table);
    $('#mp-over').hidden = false;
    $('#mp-again').hidden = this.role !== 'host';
    $('#mp-owait').hidden = this.role === 'host';
    this.haptic(-3);
  },
  tableHtml(rows) {
    rows = rows.slice().sort((a, b) => b.score - a.score || b.kills - a.kills);
    return '<table><tr><th>Игрок</th><th>Побед</th><th>Смертей</th><th>Построек</th><th>Очки</th></tr>' +
      rows.map(r => '<tr><td class="' + (r.win ? 'win' : '') + '"><span style="color:' + R().teamColor(r.team) + '">●</span> ' + esc(r.name) + '</td><td>' + r.kills + '</td><td>' + r.deaths + '</td><td>' + r.built + '</td><td>' + r.score + '</td></tr>').join('') + '</table>';
  },
  costFor(me, item) { return Math.max(1, Math.round(item.cost * [1, 0.85, 0.7, 0.6][me.skills.eng])); },
  lockFor(me, item) {
    if (me.level < item.lvl) return 'с ' + item.lvl + '-го уровня';
    if (item.cmd && me.skills.cmd < item.cmd) return 'нужен «Командир ' + ['', 'I', 'II', 'III'][item.cmd] + '»';
    return '';
  },
  /** the "Upgrades" window: skills, tanks, buildings */
  toggleUp(show) {
    const el = $('#mp-up');
    const open = show === undefined ? el.hidden : show;
    if (open && !(this.view && this.view.me)) return;
    el.hidden = !open;
    if (open) { this.input.dirs = []; this.input.f = false; this.sendInput(true); this.renderUp(true); }
    this.nativeMode(open ? 'overlay' : 'mp');
  },
  act(a) { this.input.a.push(a); this.sendInput(true); setTimeout(() => this.renderUp(), 150); },
  renderUp(force) {
    const me = this.view && this.view.me; if (!me || $('#mp-up').hidden) return;
    // rebuild only when something shown changed: a rebuild under a finger would swallow the tap
    const sig = JSON.stringify(me) + '|' + (this.upTab || 'skills');
    if (sig === this.upSig && !force) return;
    this.upSig = sig;
    const E = Eng(), L = E.XP_LEVELS, lv = me.level;
    $('#mp-uplvl').textContent = 'Уровень ' + lv + (me.sp ? ' · очков навыков: ' + me.sp : '');
    const frac = lv >= E.MAX_LEVEL ? 1 : (me.xp - L[lv - 1]) / (L[lv] - L[lv - 1]);
    $('#mp-upxp').style.width = Math.round(frac * 100) + '%';
    $('#mp-upxpt').textContent = lv >= E.MAX_LEVEL ? 'максимальный уровень' : 'опыт ' + me.xp + ' / ' + L[lv];
    $('#mp-upcoins').textContent = '● ' + me.coins;
    const tab = this.upTab || 'skills';
    for (const b of document.querySelectorAll('#mp-tabs button')) b.classList.toggle('on', b.dataset.t === tab);
    const buildable = ['defense', 'assault', 'bases'].includes(this.cfg.mode);
    $('#mp-tabs button[data-t=build]').hidden = !buildable;
    const body = $('#mp-upbody'); body.innerHTML = '';
    const row = (html, btn, onclick, dis) => {
      const d = document.createElement('div'); d.className = 'uprow';
      d.innerHTML = '<div class="uptext">' + html + '</div>';
      if (btn) { const b = document.createElement('button'); b.className = 'small' + (dis ? ' dis' : ''); b.textContent = btn; b.onclick = (e) => { e.stopPropagation(); if (!dis) onclick(); else this.haptic(-1); }; d.appendChild(b); }
      body.appendChild(d);
    };
    if (tab === 'skills') {
      for (const sk of E.SKILLS) {
        const n = me.skills[sk.id];
        const pips = [0, 1, 2].map(i => '<i class="pip' + (i < n ? ' on' : '') + '"></i>').join('');
        const next = n < 3 ? sk.steps[n] : 'изучено полностью';
        row('<b>' + sk.name + '</b> ' + pips + '<br><span class="muted">' + (n < 3 ? 'дальше: ' : '') + esc(next) + '</span>', n < 3 ? '+ изучить' : null, () => this.act('skill:' + sk.id), !me.sp);
      }
      if (!me.sp) body.insertAdjacentHTML('beforeend', '<div class="muted" style="margin-top:6px">Очки навыков дают за новые уровни. Опыт — за урон по врагам, победы, стройку, починку радара и задания.</div>');
    } else if (tab === 'tank') {
      const names = Object.keys(E.TANKS);
      names.forEach((k, i) => {
        const T = E.TANKS[k], owned = i === 0 || (me.owned & (1 << i));
        const cur = E.KIND_NAMES[me.kind] === k;
        const lock = lv < T.lvl ? 'с ' + T.lvl + '-го уровня' : '';
        const label = cur ? 'выбран' : owned ? 'сесть' : T.cost + '●';
        row('<b>' + T.name + '</b>' + (lock ? ' <span class="no">' + lock + '</span>' : '') + '<br><span class="muted">' + T.about + '</span>', label, () => this.act('tank:' + k), cur || !!lock || (!owned && me.coins < T.cost));
      });
      body.insertAdjacentHTML('beforeend', '<div class="muted" style="margin-top:6px">' + (me.nearBase ? 'Вы на базе — можно пересесть.' : 'Пересесть можно только у своей базы (радар или точка возрождения).') + ' Купленный танк остаётся вашим.</div>');
    } else if (tab === 'shop') {
      // the arsenal: sections, cards with a big icon, the price and what you have
      const chassis = me.gear.chassis > 0, far = !me.nearBase;
      const price = (c) => far ? Math.ceil(c * 1.5) : c;
      const SECT = [['shot', 'Снаряды', (W) => W.type === 'shot'], ['boom', 'Взрывчатка', (W) => ['art', 'rocket', 'guided', 'mine', 'dyn', 'air'].includes(W.type)],
        ['spec', 'Особое', (W) => ['homing', 'boost', 'freeze'].includes(W.type)], ['gear', 'Снаряжение', null]];
      const sec = this.shopSec || 'shot';
      const head = document.createElement('div'); head.className = 'shophead';
      head.innerHTML = '<div class="where ' + (far ? 'far' : 'base') + '">' + (far ? '🚚 Вдали от базы: доставка +50% к цене' : '🏠 Вы на базе — обычные цены') + '</div>';
      const chips = document.createElement('div'); chips.className = 'chips';
      for (const [id, name] of SECT) { const c = document.createElement('button'); c.textContent = name; c.className = id === sec ? 'on' : ''; c.onclick = (e) => { e.stopPropagation(); this.shopSec = id; this.renderUp(true); }; chips.appendChild(c); }
      head.appendChild(chips); body.appendChild(head);
      const grid = document.createElement('div'); grid.className = 'shopgrid'; body.appendChild(grid);
      // compact cards: icon, name and stock on top, two lines of description (tap the card for all of it), buttons
      const card = (html, btnText, onBuy, dis, extraBtn, maxBtn) => {
        const d = document.createElement('div'); d.className = 'scard' + (dis ? ' dim' : '');
        d.innerHTML = html;
        d.onclick = () => d.classList.toggle('open');
        const row = document.createElement('div'); row.className = 'sbtns';
        const b = document.createElement('button'); b.className = 'buy' + (dis ? ' dis' : ''); b.innerHTML = btnText;
        b.onclick = (e) => { e.stopPropagation(); if (dis) this.haptic(-1); onBuy(); };
        row.appendChild(b);
        if (maxBtn) row.appendChild(maxBtn);
        d.appendChild(row);
        if (extraBtn) d.querySelector('.top').appendChild(extraBtn);
        grid.appendChild(d);
      };
      if (sec !== 'gear') {
        const test = SECT.find(x => x[0] === sec)[2];
        E.WEAPONS.forEach((W, i) => {
          if (!test(W)) return;
          const have = me.ammo[i] || 0, cap = W.cap ? E.AMMO_CAP : 0;
          const lock = lv < W.lvl ? 'с ' + W.lvl + '-го уровня' : W.id === 'air' && !me.gear.radar ? 'нужен радар' : '';
          const sel = me.w === i, cost = price(W.cost);
          const html = '<div class="top">' + this.icon(W.icon, false, W.id === 'vplasma' || W.id === 'hplasma') + '<div class="nm"><b>' + W.name + '</b>' +
            '<div class="cnt">' + (i ? have + ' / ' + cap : '∞') + (sel ? ' · <span class="selw">в стволе</span>' : '') + '</div></div></div>' +
            '<div class="about">' + W.about + '</div>' + (lock ? '<div class="lock">🔒 ' + lock + '</div>' : '');
          let sb = null;
          if (!sel && (i === 0 || have > 0)) { sb = document.createElement('button'); sb.className = 'pick'; sb.textContent = 'в ствол'; sb.onclick = (e) => { e.stopPropagation(); this.act('w:' + W.id); }; }
          if (!i) { const d = document.createElement('div'); d.className = 'scard'; d.innerHTML = html; if (sb) d.querySelector('.top').appendChild(sb); d.onclick = () => d.classList.toggle('open'); grid.appendChild(d); return; }
          const full = have >= cap, dis = !!lock || full || me.coins < cost;
          let mb = null;
          if (!full && !lock && me.coins >= cost * 2) {
            const packs = Math.min(Math.ceil((cap - have) / W.pack), Math.floor(me.coins / cost));
            if (packs > 1) { mb = document.createElement('button'); mb.className = 'max'; mb.innerHTML = 'макс<small>' + Math.min(cap, have + packs * W.pack) + ' шт.</small>'; mb.onclick = (e) => { e.stopPropagation(); this.act('buymax:' + W.id); }; }
          }
          card(html, full ? 'полный' : '+' + W.pack + ' · <b>' + cost + '●</b>', () => this.act('buy:' + W.id), dis, sb, mb);
        });
      } else {
        E.GEAR.forEach((G) => {
          const n = me.gear[G.id] || 0, full = n >= G.max, cost = price(G.cost);
          const lock = lv < G.lvl ? 'с ' + G.lvl + '-го уровня' : '';
          const html = '<div class="top">' + this.icon(G.icon, false) + '<div class="nm"><b>' + G.name + '</b><div class="cnt">' + (G.max > 1 ? n + ' / ' + G.max : n ? 'есть' : 'нет') + '</div></div></div>' +
            '<div class="about">' + G.about + '</div>' + (lock ? '<div class="lock">🔒 ' + lock + '</div>' : '');
          card(html, full ? 'максимум' : '<b>' + cost + '●</b>', () => this.act('buy:' + G.id), !!lock || full || me.coins < cost);
        });
      }
    } else {
      // the same compact cards as the arsenal: walls and guns, then bots, then the expensive hybrids
      body.insertAdjacentHTML('beforeend', '<div class="muted bhint">Выбранное ставится кнопкой «строить» — в клетку перед танком. Ботов: ' + me.bots + ' из ' + me.botCap + ', пушек: ' + me.turrets + ' из ' + me.turretCap + '</div>');
      const groups = [['Стены и пушки', (B) => ['crate', 'concrete', 'turret'].includes(B.id)], ['Боты', (B) => !B.hybrid && !['crate', 'concrete', 'turret'].includes(B.id)], ['Гибриды — два бота в одном корпусе', (B) => B.hybrid]];
      for (const [title, test] of groups) {
        body.insertAdjacentHTML('beforeend', '<div class="upsec">' + title + '</div>');
        const grid = document.createElement('div'); grid.className = 'shopgrid'; body.appendChild(grid);
        E.BUILD.forEach((B, i) => {
          if (!test(B)) return;
          const lock = this.lockFor(me, B), cost = this.costFor(me, B), sel = me.sel === i;
          const d = document.createElement('div'); d.className = 'scard' + (lock ? ' dim' : '') + (sel ? ' sel' : '') + (B.hybrid ? ' hyb' : '');
          d.innerHTML = '<div class="top"><div class="nm"><b>' + B.name + '</b><div class="cnt' + (me.coins < cost ? ' no' : '') + '">' + cost + '●</div></div></div>' +
            '<div class="about">' + B.about + '</div>' + (lock ? '<div class="lock">🔒 ' + lock + '</div>' : '');
          d.onclick = () => d.classList.toggle('open');
          const row2 = document.createElement('div'); row2.className = 'sbtns';
          const b = document.createElement('button'); b.className = 'buy' + (sel || lock ? ' dis' : ''); b.textContent = sel ? 'выбрано ✓' : 'выбрать';
          b.onclick = (e) => { e.stopPropagation(); if (sel || lock) { this.haptic(-1); return; } this.act('sel:' + i); };
          row2.appendChild(b); d.appendChild(row2); grid.appendChild(d);
        });
      }
    }
  },
  togglePause() {
    const p = $('#mp-pause');
    if (p.hidden) {
      const s = this.view && this.view.last;
      const rows = s ? s.pl.map(q => { const r = (this.view.roster || []).find(x => x.pid === q[0]) || {}; return { name: r.name || '?', team: r.team, kills: q[2], deaths: q[3], built: q[10] || 0, score: q[9], win: false }; }) : [];
      $('#mp-ptable').innerHTML = this.tableHtml(rows);
      $('#mp-toroom').hidden = this.role !== 'host';
    }
    p.hidden = !p.hidden;
  },
  toggleMap() { if (this.view) this.view.bigMap = !this.view.bigMap; },

  /* ---------------- controls ---------------- */
  localInput() {
    const i = this.input;
    const out = { d: i.dirs.length ? i.dirs[i.dirs.length - 1] : -1, f: i.f, a: i.a };
    i.a = [];
    return out;
  },
  sendInput(force) {
    if (this.role !== 'client') return;
    const i = this.input;
    const d = i.dirs.length ? i.dirs[i.dirs.length - 1] : -1;
    const key = d + ',' + (i.f ? 1 : 0);
    const now = performance.now();
    if (!force && !i.a.length && key === this.lastSent && now - this.lastSendT < 400) return;
    Net.send(0, { t: 'in', d, f: i.f, a: i.a });
    i.a = []; this.lastSent = key; this.lastSendT = now;
  },
  dirOf(code) { return { [-1]: 0, [-4]: 1, [-2]: 2, [-3]: 3 }[code]; },
  key(code, down) {
    if (!this.active) return;
    if (this.screen !== 'battle') return;
    const i = this.input, d = this.dirOf(code);
    if (d !== undefined) {
      i.dirs = i.dirs.filter(x => x !== d);
      if (down) i.dirs.push(d);
    } else if (code === -5) {
      // the iPhone fire button re-presses itself every 0.2 s (the campaign fires once per press);
      // a release followed at once by a press is not a release here (it would set off a guided missile)
      clearTimeout(this.fireUpT);
      if (down) { if (i.f) return; i.f = true; }
      else { this.fireUpT = setTimeout(() => { i.f = false; this.sendInput(true); }, 90); return; }
    }
    else if (down) {
      if (code === 42) { this.toggleUp(); return; }
      const act = { 35: 'next', 48: 'place', 55: 'repair', 57: 'order', [-7]: 'w:next', 65: 'w:prev', 83: 'w:next' }[code];
      if (act) i.a.push(act);
      if (code === -6) this.togglePause();
      if (code === 51) this.toggleMap();
    }
    this.sendInput(true);
  },
  menu(action) {
    if (!this.active) return false;
    if (action === 'workshop') { this.toggleMap(); return true; }
    return true;
  },
  kbd(e, down) {
    if (!this.active || this.screen !== 'battle') return;
    if (e.target && e.target.tagName === 'INPUT') return;
    const map = { ArrowUp: -1, ArrowDown: -2, ArrowLeft: -3, ArrowRight: -4, ' ': -5, Enter: -5, q: 42, w: 35, e: 48, r: 55, b: 57, Escape: -6, m: 51, a: 65, s: 83 };
    const k = map[e.key] !== undefined ? map[e.key] : map[e.key && e.key.toLowerCase()];
    if (k === undefined) return;
    e.preventDefault();
    if (e.repeat) return;
    this.key(k, down);
  },
};

window.MP = MP;
})();
