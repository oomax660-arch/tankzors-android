/* Page glue: full-screen layout / screen adaptation, overlay controls, settings, lifecycle. */
'use strict';

(function () {
const $ = (s) => document.querySelector(s);
const body = document.body;
const params = new URLSearchParams(location.search);
const CFG = Object.assign({ width: 240, height: 320 }, window.GAME_CONFIG || {});
if (params.has('h')) CFG.height = +params.get('h');
const W = CFG.width, H = CFG.height;
const lcd = $('#lcd'), screen = $('#screen'), pad = $('#pad'), probe = $('#safe-probe');

const store = {
  get(k, d) { try { const v = localStorage.getItem('ui:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('ui:' + k, JSON.stringify(v)); } catch (e) {} },
};
// Inside the iOS app the controls are native (Swift); the page only renders the game.
const NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mode);
const NS = window.__NATIVE_SETTINGS__ || {};
if (NATIVE) document.body.classList.add('native');
const S = {
  pad: store.get('pad', true),
  num: store.get('num', false),
  alpha: store.get('alpha', 75),
  sfx: NS.sfx !== undefined ? !!NS.sfx : store.get('sfx', true),
  haptic: NS.haptic !== undefined ? !!NS.haptic : store.get('haptic', true),
  size: store.get('size', 100),
  lang: params.get('lang') || NS.lang || store.get('lang', 'rus'),
};
function applySettings() {
  body.classList.toggle('nopad', !S.pad);
  body.classList.toggle('num', S.num);
  $('#btn-num').classList.toggle('on', S.num);
  document.documentElement.style.setProperty('--alpha', String(S.alpha / 100));
  document.documentElement.style.setProperty('--ks', String(S.size / 100));
}
applySettings();

/* ------------------------------------------------------------ layout: the game always fills the screen */
function insets() {
  const cs = getComputedStyle(probe);
  return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Logical (game-visible) screen size. The game reads getWidth()/getHeight() every frame and lays
// itself out, so it gets the real aspect ratio of the screen.
let LW = W, LH = H;
function layout() {
  const vw = window.innerWidth, vh = window.innerHeight, ins = insets();
  const land = vw > vh;
  body.classList.toggle('landscape', land);
  // portrait: keep clear of the Dynamic Island / notch, use the area behind the home indicator.
  // landscape: keep clear of the notch on the side.
  const top = land ? 0 : ins.t, left = land ? ins.l : 0, right = land ? ins.r : 0;
  const areaW = vw - left - right, areaH = vh - top;
  if (!land) {
    LW = W; LH = clamp(Math.round(W * areaH / areaW), H, CFG.maxHeight || 500);
  } else {
    LH = CFG.landscapeHeight || 240;
    LW = clamp(Math.round(LH * areaW / areaH), CFG.landscapeMinWidth || 240, CFG.maxWidth || 320);
  }
  if (CFG.fixedSize) { LW = W; LH = H; }
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(areaW / LW, areaH / LH);
  const sw = Math.floor(LW * scale * dpr) / dpr, sh = Math.floor(LH * scale * dpr) / dpr;
  const sx = left + (areaW - sw) / 2, sy = top + (land ? (areaH - sh) / 2 : 0);
  Object.assign(screen.style, { left: sx + 'px', top: sy + 'px', width: sw + 'px', height: sh + 'px' });
  if (host && host.lcd) host.resize(LW, LH);
}
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 60));

/* ------------------------------------------------------------ host */
let host = null;
const unlockAudio = () => { if (host) host.audio.unlock(); };
document.addEventListener('pointerdown', unlockAudio, true);
document.addEventListener('touchend', unlockAudio, true);
document.addEventListener('keydown', unlockAudio, true);

/* ------------------------------------------------------------ touches on the game itself */
// In a mission touches go straight to the game (it supports them there).
// In menus the game is key-only: a tap on a line selects it, a vertical swipe scrolls.
let activePtr = null, menuGesture = null;
function toGame(e) {
  const r = lcd.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) * LW / r.width), y = Math.floor((e.clientY - r.top) * LH / r.height);
  return [clamp(x, 0, LW - 1), clamp(y, 0, LH - 1)];
}
lcd.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!host || activePtr !== null) return;
  activePtr = e.pointerId; try { lcd.setPointerCapture(e.pointerId); } catch (er) {}
  if (host.inGame) { menuGesture = null; host.pointer('press', ...toGame(e)); host.setEngine(true); return; }
  menuGesture = { y0: e.clientY, last: e.clientY, moved: false, pt: toGame(e) };
});
lcd.addEventListener('pointermove', (e) => {
  if (!host || e.pointerId !== activePtr) return;
  if (!menuGesture) { host.pointer('drag', ...toGame(e)); return; }
  const step = 22;
  while (Math.abs(e.clientY - menuGesture.last) >= step) {
    const up = e.clientY < menuGesture.last;   // finger moves up -> content scrolls down
    host.key('press', up ? -2 : -1); host.key('release', up ? -2 : -1);
    menuGesture.last += up ? -step : step; menuGesture.moved = true;
  }
});
const lcdUp = (e) => {
  if (!host || e.pointerId !== activePtr) return;
  activePtr = null;
  if (!menuGesture) { host.pointer('release', ...toGame(e)); host.setEngine(false); return; }
  const g = menuGesture; menuGesture = null;
  if (g.moved || e.type === 'pointercancel') return;
  const [x, y] = g.pt;
  const shop = host.screenKind === 'shop';
  // workshop: first tap selects an item, a second tap on the selected item buys it
  host.menuTap(x, y, { fire: !shop, onSelected: shop ? () => { if (host.bridge && host.bridge.haptic && S.haptic) host.bridge.haptic.postMessage(-2); return host.buyOnce(true); } : null }).then((handled) => {
    if (!handled) { host.pointer('press', x, y); host.pointer('release', x, y); }   // e.g. the sound on/off icons
  });
};
lcd.addEventListener('pointerup', lcdUp);
lcd.addEventListener('pointercancel', lcdUp);

/* ------------------------------------------------------------ overlay keys */
const held = new Map(); // pointerId -> button
const tick = () => { if (S.haptic && host && host.bridge && host.bridge.haptic) host.bridge.haptic.postMessage(-1); };
const moving = new Set();
function engineCheck() { if (host) host.setEngine(moving.size > 0); }
function press(btn) {
  if (!host) return; btn.classList.add('pressed'); host.key('press', +btn.dataset.k); tick();
  if (btn.classList.contains('d') && !btn.classList.contains('ok')) { moving.add(btn); engineCheck(); }
}
function release(btn) {
  if (!host) return; btn.classList.remove('pressed'); host.key('release', +btn.dataset.k);
  if (moving.delete(btn)) engineCheck();
}
pad.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.k'); if (!btn) return;
  e.preventDefault(); e.stopPropagation();
  try { btn.setPointerCapture(e.pointerId); } catch (er) {}
  held.set(e.pointerId, btn); press(btn);
});
pad.addEventListener('pointermove', (e) => {
  // slide a finger across the d-pad without lifting it
  const cur = held.get(e.pointerId); if (!cur || !cur.classList.contains('d')) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const nb = el && el.closest && el.closest('.dpad .k');
  if (nb && nb !== cur) { release(cur); held.set(e.pointerId, nb); press(nb); }
});
const padUp = (e) => { const b = held.get(e.pointerId); if (b) { release(b); held.delete(e.pointerId); } };
pad.addEventListener('pointerup', padUp);
pad.addEventListener('pointercancel', padUp);
pad.addEventListener('contextmenu', (e) => e.preventDefault());
pad.addEventListener('click', (e) => { const b = e.target.closest('.mb'); if (b && window.__nmenu) window.__nmenu(b.dataset.a); });

let numTaps = [];
$('#btn-num').addEventListener('click', () => {
  const now = Date.now(); numTaps = numTaps.filter(t => now - t < 1500); numTaps.push(now);
  if (numTaps.length >= 5) { numTaps = []; toggleLog(); return; }
  S.num = !S.num; store.set('num', S.num); applySettings();
});
$('#btn-pad').addEventListener('click', () => { S.pad = false; store.set('pad', false); applySettings(); });
$('#btn-show-pad').addEventListener('click', () => { S.pad = true; store.set('pad', true); applySettings(); });

/* ------------------------------------------------------------ settings sheet */
function seg(id, value, onPick) {
  const el = $(id);
  const paint = (v) => el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(v)));
  paint(value);
  el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; paint(b.dataset.v); onPick(b.dataset.v); });
}
const startLang = S.lang;
seg('#set-lang', S.lang, (v) => { S.lang = v; store.set('lang', v); $('#lang-note').hidden = v === startLang; });
seg('#set-haptic', S.haptic ? 1 : 0, (v) => { S.haptic = v === '1'; store.set('haptic', S.haptic); });
seg('#set-sfx', S.sfx ? 1 : 0, (v) => { S.sfx = v === '1'; store.set('sfx', S.sfx); if (host) { host.opts.sfx = S.sfx; host.setEngine(false); } });
seg('#set-pad', S.pad ? 1 : 0, (v) => { S.pad = v === '1'; store.set('pad', S.pad); applySettings(); });
const op = $('#set-op'), size = $('#set-size');
op.value = S.alpha; size.value = S.size;
op.addEventListener('input', () => { S.alpha = +op.value; store.set('alpha', S.alpha); applySettings(); });
size.addEventListener('input', () => { S.size = +size.value; store.set('size', S.size); applySettings(); });
function openSettings() {
  $('#settings').hidden = false;
  if (host) host.pause();
}
function closeSettings() {
  $('#settings').hidden = true;
  if (S.lang !== startLang) {
    if (host) host.flushRMS();
    setTimeout(() => location.reload(), 250);
    return;
  }
  if (host) host.resume();
}
$('#btn-set').addEventListener('click', openSettings);
$('#set-close').addEventListener('click', closeSettings);
$('#settings').addEventListener('click', (e) => { if (e.target.id === 'settings') closeSettings(); });

/* ------------------------------------------------------------ hardware keyboard (simulator / iPad) */
const KEYMAP = {
  ArrowUp: -1, ArrowDown: -2, ArrowLeft: -3, ArrowRight: -4, Enter: -5, ' ': -5,
  F1: -6, q: -6, Q: -6, F2: -7, w: -7, W: -7, Backspace: -8, Escape: -7,
  '0': 48, '1': 49, '2': 50, '3': 51, '4': 52, '5': 53, '6': 54, '7': 55, '8': 56, '9': 57, '*': 42, '#': 35,
};
const down = new Set();
document.addEventListener('keydown', (e) => {
  if (e.key === 'L' && e.shiftKey) { toggleLog(); return; }
  const k = KEYMAP[e.key]; if (k === undefined || !host) return;
  e.preventDefault();
  if (down.has(k)) { host.key('repeat', k); return; }
  down.add(k); host.key('press', k);
  if (k <= -1 && k >= -4) host.setEngine(true);
});
document.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.key]; if (k === undefined || !host) return;
  down.delete(k); host.key('release', k);
  if (![...down].some(x => x <= -1 && x >= -4)) host.setEngine(false);
});

/* ------------------------------------------------------------ debug log */
function toggleLog() {
  const el = $('#log');
  el.hidden = !el.hidden;
  if (!el.hidden && host) el.textContent = host.logLines.join('\n') || '(empty)';
}
$('#log').addEventListener('click', toggleLog);

/* ------------------------------------------------------------ lifecycle */
document.addEventListener('visibilitychange', () => { if (!host) return; if (document.hidden) host.pause(); else if ($('#settings').hidden && !window.__mpActive) host.resume(); });
window.__appPause = () => host && host.pause();
// the app came back / an audio interruption ended (sent by the iOS side) or the page became visible again
window.__audioKick = () => { if (!host) return; host.audio.kick(); };
document.addEventListener('visibilitychange', () => { if (!document.hidden && window.__mpActive && host) { host.audio.held = false; host.audio.kick(); } });
window.__appResume = () => host && $('#settings').hidden && !window.__mpActive && host.resume();
{ const b = document.getElementById('btn-mp'); if (b) b.addEventListener('click', () => window.MP && window.MP.open()); }
window.addEventListener('error', (e) => { if (host) host.log('[page] ' + (e.message || e)); });

/* ------------------------------------------------------------ API for the native controls (Swift) */
const nativeArrows = new Set();
window.__nk = (code, down) => {
  if (window.__mpActive && window.MP) { window.MP.key(code, !!down); return; }
  if (!host) return;
  host.key(down ? 'press' : 'release', code);
  if (code <= -1 && code >= -4) {
    if (down) nativeArrows.add(code); else nativeArrows.delete(code);
    host.setEngine(nativeArrows.size > 0);
  }
};
window.__nmenu = (action) => {
  if (action === 'mp') { if (window.MP) window.MP.open(); return; }
  if (window.__mpActive && window.MP) { window.MP.menu(action); return; }
  if (!host) return;
  const tap = (c) => { host.key('press', c); setTimeout(() => host.key('release', c), 40); };
  switch (action) {
    case 'left': tap(-3); break;
    case 'right': if (host.screenKind === 'shop') host.buyOnce(); else tap(-4); break;
    case 'up': tap(-1); break;
    case 'down': tap(-2); break;
    case 'ok': tap(-5); break;
    case 'back': tap(-6); break;
    case 'buyMax': host.buyMax(); break;
    case 'workshop': host.openWorkshop(); break;
  }
};
window.__nset = (o) => {
  if (!host || !o) return;
  if ('sfx' in o) { S.sfx = !!o.sfx; host.opts.sfx = S.sfx; host.setEngine(false); }
  if ('haptic' in o) { S.haptic = !!o.haptic; host.opts.haptic = S.haptic; }
  if ('quality' in o) { host.setQuality(o.quality); host.present(); }
  if ('screenControls' in o) host.opts.screenControls = !!o.screenControls;
  if ('unlockAll' in o) host.opts.unlockAll = !!o.unlockAll;
};
window.__screenKind = () => (host ? host.screenKind : 'menu');

/* ------------------------------------------------------------ boot */
async function boot() {
  layout();
  if (!window.GAME_FILES) { $('#loading').textContent = 'Нет данных игры (game_data.js)'; return; }
  host = new window.J2MEHost.Host({
    width: LW, height: LH,
    debug: params.has('debug'),
    language: S.lang,
    sfx: S.sfx,
    haptic: S.haptic,
    quality: NS.quality || store.get('quality', 10),
    unlockAll: NS.unlockAll !== undefined ? !!NS.unlockAll : store.get('unlockAll', true),
    screenControls: NS.screenControls !== undefined ? !!NS.screenControls : true,
    properties: Object.assign({ 'microedition.locale': S.lang === 'rus' ? 'ru-RU' : 'en-US' }, CFG.properties || {}),
    onExit: () => {
      const el = $('#loading');
      el.innerHTML = '<div style="text-align:center"><div style="margin-bottom:18px;color:#888">' + (S.lang === 'rus' ? 'Игра закрыта' : 'Game closed') +
        '</div><button id="btn-restart" style="padding:14px 28px;font-size:17px;border-radius:24px;background:#5a1a14;color:#fff">' +
        (S.lang === 'rus' ? 'Запустить заново' : 'Restart') + '</button></div>';
      el.style.display = 'flex';
      $('#btn-restart').addEventListener('click', () => location.reload());
    },
  });
  window.__host = host;
  try {
    await host.load(window.GAME_FILES);
    host.setupScreen(lcd);
    host.boot();
    layout();
    let lastKind = null;
    const poll = () => {
      if (window.__mpActive) { lastKind = null; requestAnimationFrame(poll); return; }
      const kind = host.screenKind;
      if (kind !== lastKind) {
        lastKind = kind;
        body.classList.toggle('ingame', kind === 'game');
        body.classList.toggle('shop', kind === 'shop');
        if (kind !== 'game') { host.setEngine(false); moving.clear(); }
        if (NATIVE) window.webkit.messageHandlers.mode.postMessage(kind);
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
    $('#loading').style.display = 'none';
  } catch (e) {
    $('#loading').textContent = 'Ошибка запуска: ' + (e && e.message || e);
    console.error(e);
  }
}
boot();
})();
