/* On-screen controls for the Android app — the same layout and behaviour as the native iOS overlay
 * (TankzorsPro/ControlsView.swift): a floating joystick, the fire button with auto-fire, supplies, the quick
 * column (reverse / repair / radar / workshop), the soft keys, settings, the network button, the menu and shop bars.
 * Also the settings sheet and "How to play" (SettingsView.swift). Talks to the page like the native shell:
 * __nk(code, down), __nmenu(action), __nset({...}), __appPause / __appResume.
 * Active only when android/bridge.js set window.__TOUCH_UI__.
 */
'use strict';
(function () {
  if (!window.__TOUCH_UI__) return;
  const P = window.__NATIVE_PREFS__;
  const $ = (s, r) => (r || document).querySelector(s);
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

  /* ---------------- icons (stroke drawings in the spirit of the SF Symbols used on iPhone) ---------------- */
  const SVG = (p, fill) => '<svg viewBox="0 0 24 24" fill="' + (fill ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  const I = {
    scope: SVG('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><path d="M12 1.8v4.4M12 17.8v4.4M1.8 12h4.4M17.8 12h4.4"/>'),
    box: SVG('<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" fill="currentColor" fill-opacity=".25"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9M7.8 5.2l8.5 4.6"/>'),
    uturn: SVG('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>'),
    bandage: SVG('<rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-40 12 12)" fill="currentColor" fill-opacity=".25"/><path d="M10 10.5h.01M12.5 12h.01M11 13.5h.01M13.5 10.5h.01"/>'),
    radar: SVG('<circle cx="12" cy="12" r="1.8" fill="currentColor"/><path d="M8.2 15.8a5.4 5.4 0 010-7.6M15.8 8.2a5.4 5.4 0 010 7.6M5.2 18.8a9.6 9.6 0 010-13.6M18.8 5.2a9.6 9.6 0 010 13.6"/>'),
    wrench: SVG('<path d="M14.7 6.3a4 4 0 00-5.4 5.4L3.5 17.5l3 3 5.8-5.8a4 4 0 005.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" fill="currentColor" fill-opacity=".25"/>'),
    chevL: SVG('<path d="M15 5l-7 7 7 7"/>'),
    chevR: SVG('<path d="M9 5l7 7-7 7"/>'),
    gear: SVG('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
    wifi: SVG('<path d="M2.5 9a14 14 0 0119 0M5.8 12.5a9 9 0 0112.4 0M9.2 16a4 4 0 015.6 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/>'),
    minus: SVG('<circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".25"/><path d="M8 12h8"/>'),
    plus: SVG('<circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".25"/><path d="M8 12h8M12 8v8"/>'),
    info: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'),
    cart: SVG('<path d="M3 4h2l2.4 11h10.2L20 7H7"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/><path d="M12 9v4M10 11h4"/>'),
    stick: SVG('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>'),
    hand: SVG('<path d="M9 11V5.5a1.5 1.5 0 013 0V11M12 10V4.5a1.5 1.5 0 013 0V11M15 10.5V6.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-1a6 6 0 01-5-2.7L3.6 15a1.5 1.5 0 012.5-1.7L9 16V11"/>'),
  };

  /* ---------------- buttons ---------------- */
  const root = h('div', 'tz-root'); root.id = 'tz-root';
  document.body.appendChild(root);
  function button(opts) {
    const b = h('div', 'tz-btn tz-' + (opts.style || 'glass'));
    const body = h('div', 'tz-body');
    if (opts.icon) body.appendChild(h('span', 'tz-ico', I[opts.icon]));
    const title = h('span', 'tz-title', opts.title || ''); if (!opts.title) title.style.display = 'none';
    body.appendChild(title);
    b.appendChild(body);
    const cap = h('div', 'tz-cap', opts.caption || ''); if (!opts.caption) cap.style.display = 'none';
    b.appendChild(cap);
    const badge = h('div', 'tz-badge', opts.key || ''); if (!opts.key) badge.style.display = 'none';
    b.appendChild(badge);
    b.iconScale = opts.iconScale || 0.42;
    b.setCaption = (t) => { cap.textContent = t; cap.style.display = t ? '' : 'none'; };
    b.setTitle = (t) => { title.textContent = t; title.style.display = t ? '' : 'none'; };
    b.setBadge = (t) => { badge.textContent = t || ''; badge.style.display = t ? '' : 'none'; };
    b.hasCaption = () => cap.style.display !== 'none';
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { b.setPointerCapture(e.pointerId); } catch (er) {}
      b.classList.add('down'); b.pid = e.pointerId;
      if (b.onPress) b.onPress();
    });
    const up = (e) => { if (b.pid !== e.pointerId) return; b.pid = null; b.classList.remove('down'); if (b.onRelease) b.onRelease(); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    root.appendChild(b);
    return b;
  }
  const haptic = (n) => { if (!P.haptic) return; const hb = window.webkit && window.webkit.messageHandlers.haptic; if (hb) hb.postMessage(n); };
  const key = (code, down) => { if (window.__nk) window.__nk(code, down ? 1 : 0); };
  const menu = (a) => { if (window.__nmenu) window.__nmenu(a); };

  const joy = h('div', 'tz-joy'); root.appendChild(joy);
  const jBase = h('div', 'tz-jbase', '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="48.5" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="1.5"/><path d="M50 3l7 8h-14zM50 97l7-8h-14zM3 50l8 7v-14zM97 50l-8 7v-14z" fill="rgba(255,255,255,.55)"/></svg>');
  const jKnob = h('div', 'tz-jknob');
  joy.appendChild(jBase); joy.appendChild(jKnob);

  const fire = button({ icon: 'scope', style: 'fire', iconScale: 0.4 });
  const supplies = button({ icon: 'box', caption: 'припасы/отмена', key: '✱', iconScale: 0.36 });
  const reverse = button({ icon: 'uturn', caption: 'задний ход', key: '0', iconScale: 0.36 });
  const repair = button({ icon: 'bandage', caption: 'ремонт', key: '7', iconScale: 0.36 });
  const radar = button({ icon: 'radar', caption: 'радар', key: '9', iconScale: 0.36 });
  const look = button({ icon: 'wrench', caption: 'мастерская', iconScale: 0.36 });
  const leftSoft = button({ icon: 'chevL', title: 'меню', style: 'pill', iconScale: 0.4 });
  const rightSoft = button({ title: 'выбор  ›', style: 'pill' });
  const gear = button({ icon: 'gear', style: 'pill', iconScale: 0.5 });
  const netButton = button({ icon: 'wifi', title: ' Сеть', style: 'pill', iconScale: 0.5 });
  const shopButtons = [button({ icon: 'minus', title: 'Продать', style: 'sell', iconScale: 0.5 }), button({ icon: 'info', title: 'Инфо', style: 'pill', iconScale: 0.5 }),
    button({ icon: 'plus', title: 'Купить', style: 'buy', iconScale: 0.5 }), button({ icon: 'cart', title: 'Макс.', style: 'buy', iconScale: 0.5 })];
  const gameViews = [joy, fire, supplies, reverse, repair, radar, look];

  /* ---------------- wiring (as ControlsView.wire) ---------------- */
  const hold = (b, code) => { b.onPress = () => { haptic(-1); key(code, true); }; b.onRelease = () => key(code, false); };
  const tap = (b, code) => { b.onPress = () => { haptic(-1); key(code, true); }; b.onRelease = () => setTimeout(() => key(code, false), 40); };
  let autofire = null;
  // fire: holding it keeps shooting (the campaign fires once per key press)
  fire.onPress = () => { haptic(-2); key(-5, true); clearInterval(autofire); autofire = setInterval(() => { key(-5, false); key(-5, true); }, 200); };
  fire.onRelease = () => { clearInterval(autofire); autofire = null; key(-5, false); };
  tap(supplies, 42); hold(reverse, 48); tap(repair, 55); tap(radar, 57);
  look.onPress = () => haptic(-1); look.onRelease = () => menu('workshop');
  tap(leftSoft, -6); tap(rightSoft, -7);
  gear.onPress = () => haptic(-1); gear.onRelease = () => openSettings();
  netButton.onPress = () => haptic(-1); netButton.onRelease = () => menu('mp');
  ['left', 'ok', 'right', 'buyMax'].forEach((a, i) => { shopButtons[i].onPress = () => haptic(-1); shopButtons[i].onRelease = () => menu(a); });

  /* ---------------- floating joystick (JoystickView) ---------------- */
  const J = { radius: 62, rest: { x: 0, y: 0 }, area: { x0: 0, x1: 0, y0: 0, y1: 0 }, pid: null, origin: null, dir: null };
  function placeStick(cx, cy, kx, ky) {
    jBase.style.transform = 'translate(' + (cx - J.radius) + 'px,' + (cy - J.radius) + 'px)';
    const k = J.radius * 0.82;
    jKnob.style.transform = 'translate(' + (cx + kx - k / 2) + 'px,' + (cy + ky - k / 2) + 'px)';
  }
  function setActive(on) { joy.classList.toggle('active', on); }
  function setDir(d) {
    if (d === J.dir) return;
    if (J.dir !== null) key(J.dir, false);
    J.dir = d;
    if (d !== null) { key(d, true); haptic(-1); }
  }
  joy.addEventListener('pointerdown', (e) => {
    if (J.pid !== null) return;
    e.preventDefault(); try { joy.setPointerCapture(e.pointerId); } catch (er) {}
    J.pid = e.pointerId;
    const r = joy.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    J.origin = P.fixedJoystick ? { x: J.rest.x, y: J.rest.y } : { x: Math.min(Math.max(px, J.area.x0), J.area.x1), y: Math.min(Math.max(py, J.area.y0), J.area.y1) };
    placeStick(J.origin.x, J.origin.y, 0, 0); setActive(true); joy.classList.remove('home');
    move(px, py);
  });
  function move(px, py) {
    const vx = px - J.origin.x, vy = py - J.origin.y, mag = Math.hypot(vx, vy), lim = J.radius * 0.62;
    const s = mag > lim ? lim / mag : 1;
    placeStick(J.origin.x, J.origin.y, vx * s, vy * s);
    updateDir(vx, vy, mag);
  }
  joy.addEventListener('pointermove', (e) => { if (e.pointerId !== J.pid) return; const r = joy.getBoundingClientRect(); move(e.clientX - r.left, e.clientY - r.top); });
  const jUp = (e) => { if (e.pointerId !== J.pid) return; J.pid = null; setDir(null); joy.classList.add('home'); placeStick(J.rest.x, J.rest.y, 0, 0); setActive(false); };
  joy.addEventListener('pointerup', jUp); joy.addEventListener('pointercancel', jUp);
  function resetJoy() { J.pid = null; setDir(null); placeStick(J.rest.x, J.rest.y, 0, 0); setActive(false); }
  function updateDir(vx, vy, mag) {
    const R = J.radius;
    if (mag <= R * 0.16) { if (mag < R * 0.08) setDir(null); return; }
    const cur = J.dir;
    if (cur !== null) {
      const opp = { [-1]: -2, [-2]: -1, [-3]: -4, [-4]: -3 }[cur];
      const wants = cur === -1 ? vy > 0 && Math.abs(vy) >= Math.abs(vx) * 0.6 : cur === -2 ? vy < 0 && Math.abs(vy) >= Math.abs(vx) * 0.6
        : cur === -3 ? vx > 0 && Math.abs(vx) >= Math.abs(vy) * 0.6 : vx < 0 && Math.abs(vx) >= Math.abs(vy) * 0.6;
      if (wants) { setDir(opp); return; }
    }
    const vert = cur === -1 || cur === -2, horz = cur === -3 || cur === -4, bias = 1.3;
    const horizontal = vert ? Math.abs(vx) > Math.abs(vy) * bias : horz ? Math.abs(vx) * bias > Math.abs(vy) : Math.abs(vx) > Math.abs(vy);
    setDir(horizontal ? (vx > 0 ? -4 : -3) : (vy > 0 ? -2 : -1));
  }

  /* ---------------- modes (modeChanged / applyVisibility) ---------------- */
  let mode = 'menu';
  function setMode(m) {
    if (!['game', 'menu', 'shop', 'mp', 'overlay'].includes(m) || m === mode) return;
    mode = m;
    const net = m === 'mp';
    supplies.setCaption(net ? 'улучшения' : 'припасы/отмена'); supplies.setBadge(net ? null : '✱');
    reverse.setCaption(net ? 'строить' : 'задний ход'); reverse.setBadge(net ? null : '0');
    repair.setCaption('ремонт'); repair.setBadge(net ? null : '7');
    radar.setCaption(net ? 'боты' : 'радар'); radar.setBadge(net ? null : '9');
    look.setCaption(net ? 'карта' : 'мастерская');
    rightSoft.setTitle(net ? 'оружие  ›' : 'выбор  ›');
    if (m !== 'game' && m !== 'mp') { resetJoy(); if (autofire) { clearInterval(autofire); autofire = null; key(-5, false); } }
    applyVisibility();
    layout();
  }
  function show(el, on, alpha) { el.style.opacity = on ? String(alpha) : '0'; el.style.pointerEvents = on ? 'auto' : 'none'; el.style.visibility = on ? 'visible' : 'hidden'; }
  function applyVisibility() {
    const play = mode === 'game' || mode === 'mp', a = P.opacity;
    for (const v of gameViews) show(v, play, a);
    for (const v of shopButtons) show(v, mode === 'shop', 1);
    for (const v of [leftSoft, rightSoft, gear]) show(v, mode !== 'overlay', Math.max(0.8, a));
    show(netButton, mode === 'menu', Math.max(0.8, a));
  }

  /* ---------------- layout (ControlsView.layoutSubviews) ---------------- */
  const probe = document.getElementById('safe-probe');
  function safe() {
    const cs = probe ? getComputedStyle(probe) : null;
    return cs ? { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 } : { t: 0, r: 0, b: 0, l: 0 };
  }
  function frame(el, x, y, w, hh) { el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.width = w + 'px'; el.style.height = hh + 'px'; }
  function bodyFrame(b, x, y, w, hh) {
    // the round/pill body is (w x hh); the caption hangs below it
    frame(b, x, y, w, hh + (b.hasCaption() ? 14 : 0));
    const body = b.querySelector('.tz-body'); body.style.width = w + 'px'; body.style.height = hh + 'px';
    const radius = b.classList.contains('tz-pill') || b.classList.contains('tz-buy') || b.classList.contains('tz-sell') ? Math.min(hh / 2, 14) : hh / 2;
    body.style.borderRadius = radius + 'px';
    const ico = body.querySelector('.tz-ico'), title = body.querySelector('.tz-title');
    const hasTitle = title.style.display !== 'none';
    if (ico) { const sz = hasTitle ? hh * 0.5 : Math.max(10, hh * b.iconScale) * 1.25; ico.style.width = sz + 'px'; ico.style.height = sz + 'px'; }
  }
  function layout() {
    const s = P.scale, sf = safe();
    const W = window.innerWidth, H = window.innerHeight;
    const bottom = H - Math.max(sf.b, 12) - 14, rightEdge = W - sf.r - 16, leftEdge = sf.l + 16;
    const mirror = P.leftHanded;
    const mx = (x, w) => mirror ? W - x - w : x;
    const f = 104 * s;
    bodyFrame(fire, mx(rightEdge - f, f), bottom - f - 16, f, f);
    const sp = 60 * s;
    bodyFrame(supplies, mx(rightEdge - f - 14 - sp, sp), bottom - sp - 4, sp, sp);
    // quick actions: a column above fire in portrait; in landscape a row above fire going inwards,
    // and a second column on small screens where four do not fit one above the other
    const q = 52 * s, qStep = q + 22, quick = [reverse, repair, radar, look];
    const firstY = bottom - f - 16 - 18 - q - 14, topLimit = Math.max(sf.t, 0) + 34 + 22, colX = rightEdge - f / 2 - q / 2;
    if (W > H) quick.forEach((b, i) => bodyFrame(b, mx(colX - i * (q + 20), q), firstY, q, q));
    else {
      const fit = Math.max(1, Math.floor((firstY - topLimit) / qStep) + 1);
      quick.forEach((b, i) => bodyFrame(b, mx(colX - Math.floor(i / fit) * (q + 22), q), firstY - (i % fit) * qStep, q, q));
    }
    // floating joystick zone: lower part of the other half of the screen
    const zoneTop = H * 0.36, zoneW = W * 0.5;
    frame(joy, mirror ? W - zoneW : 0, zoneTop, zoneW, H - zoneTop);
    J.radius = 62 * s;
    const d = J.radius * 2; jBase.style.width = d + 'px'; jBase.style.height = d + 'px';
    const k = J.radius * 0.82; jKnob.style.width = k + 'px'; jKnob.style.height = k + 'px';
    const sign = mirror ? -1 : 1;
    const restX = (mirror ? W - leftEdge : leftEdge) + sign * (J.radius + 14), restY = bottom - J.radius - 10;
    J.rest = { x: restX - (mirror ? W - zoneW : 0), y: restY - zoneTop };
    const r = J.radius;
    const ax0 = mirror ? zoneW * 0.3 : r + 6, ax1 = mirror ? zoneW - r - 6 : zoneW * 0.7, ay1 = J.rest.y + 10;
    J.area = { x0: ax0, x1: Math.max(ax0 + 1, ax1), y0: Math.max(r, ay1 - r * 2.2), y1: ay1 };
    if (J.pid === null) placeStick(J.rest.x, J.rest.y, 0, 0);
    // top bar: beside the camera cut-out in portrait, top corners in landscape
    const barH = 34, barY = sf.t >= 40 ? (sf.t - barH) / 2 : Math.max(8, sf.t + 6);
    bodyFrame(leftSoft, sf.l + 10, barY, 86, barH);
    bodyFrame(rightSoft, W - sf.r - 10 - 86, barY, 86, barH);
    bodyFrame(gear, W - sf.r - 10 - 86 - 8 - barH, barY, barH, barH);
    bodyFrame(netButton, sf.l + 10, barY + barH + 10, 86, barH);
    // workshop bar: four equal buttons across the bottom
    const gap = 8, avail = W - sf.l - sf.r - 24, bw = Math.min(130, (avail - gap * 3) / 4), tot = bw * 4 + gap * 3;
    shopButtons.forEach((b, i) => bodyFrame(b, (W - tot) / 2 + i * (bw + gap), bottom - 48, bw, 48));
  }
  window.addEventListener('resize', () => setTimeout(layout, 30));
  window.addEventListener('orientationchange', () => setTimeout(layout, 120));

  /* ---------------- settings sheet (SettingsView) ---------------- */
  const sheet = h('div', 'tz-sheet-wrap'); sheet.hidden = true;
  sheet.innerHTML = '<div class="tz-sheet"><div class="tz-head"><b>Настройки</b><button class="tz-done">Готово</button></div><div class="tz-form"></div></div>';
  document.body.appendChild(sheet);
  const form = $('.tz-form', sheet);
  let langAtOpen = P.lang;
  const qualityText = (q) => q <= 3 ? 'Экономно: без лишних эффектов.' : q <= 6 ? 'Следы гусениц, освещение.' : q === 7 ? 'Всё, что есть в оригинале: следы, освещение, облака.'
    : q === 8 ? '+ сглаживание пикселей (двойное разрешение без «мыла»).' : q === 9 ? '+ свечение снарядов и взрывов, встряска от взрывов.' : 'Максимум: + мягкие тени под танками.';
  function renderForm() {
    form.innerHTML = '';
    const sec = (title, footer) => { const s = h('div', 'tz-sec'); if (title) s.appendChild(h('div', 'tz-sech', title)); const box = h('div', 'tz-box'); s.appendChild(box); if (footer) s.appendChild(h('div', 'tz-foot', footer)); form.appendChild(s); return box; };
    const toggle = (box, label, k, after) => {
      const row = h('label', 'tz-row', '<span>' + label + '</span><input type="checkbox" class="tz-sw"' + (P[k] ? ' checked' : '') + '>');
      row.querySelector('input').addEventListener('change', (e) => { P[k] = e.target.checked; changed(); if (after) after(); });
      box.appendChild(row);
    };
    const slider = (box, label, k, min, max, step, fmt) => {
      const row = h('div', 'tz-row tz-col', '<div class="tz-rl"><span>' + label + '</span><span class="tz-val"></span></div><input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + P[k] + '">');
      const val = row.querySelector('.tz-val'), inp = row.querySelector('input');
      const upd = () => { val.textContent = fmt ? fmt(+inp.value) : ''; };
      inp.addEventListener('input', () => { P[k] = +inp.value; upd(); changed(true); });
      upd(); box.appendChild(row); return row;
    };
    let box = sec('Язык игры', 'Смена языка перезапускает игру, сохранения остаются.');
    const segRow = h('div', 'tz-seg', '<button data-v="rus">Русский</button><button data-v="eng">English</button>');
    for (const b of segRow.querySelectorAll('button')) { b.classList.toggle('on', b.dataset.v === P.lang); b.onclick = () => { P.lang = b.dataset.v; changed(); renderForm(); }; }
    box.appendChild(segRow);
    box = sec('Графика', '');
    const qRow = slider(box, 'Качество', 'quality', 1, 10, 1, (v) => v + ' из 10');
    const qFoot = h('div', 'tz-foot', qualityText(P.quality)); box.parentNode.appendChild(qFoot);
    qRow.querySelector('input').addEventListener('input', () => { qFoot.textContent = qualityText(P.quality); });
    box = sec('Мастерская', 'Всё оружие и снаряжение продаётся сразу за монеты, без исследований за звёзды.');
    toggle(box, 'Всё оружие открыто', 'unlockAll');
    box = sec('Звук и отклик', '');
    toggle(box, 'Звуки выстрелов, взрывов и мотора', 'sfx');
    toggle(box, 'Вибрация', 'haptic');
    box = sec('Кнопки', '«По экрану»: джойстик вверх — танк едет вверх. Если выключить — вверх значит «вперёд, куда смотрит пушка».');
    slider(box, 'Непрозрачность', 'opacity', 0.3, 1, 0.05);
    slider(box, 'Размер', 'scale', 0.8, 1.3, 0.05);
    toggle(box, 'Джойстик справа (для левши)', 'leftHanded');
    toggle(box, 'Неподвижный джойстик', 'fixedJoystick');
    toggle(box, 'Направления по экрану', 'screenControls');
    box = sec('', '');
    const hb = h('button', 'tz-link', 'Как играть'); hb.onclick = () => openHelp(); box.appendChild(hb);
  }
  function changed(live) {
    window.__saveNativePrefs();
    applyVisibility(); layout();
    if (window.__nset) window.__nset({ sfx: P.sfx, haptic: P.haptic, quality: P.quality, screenControls: P.screenControls, unlockAll: P.unlockAll });
  }
  function openSettings() {
    if (!sheet.hidden) return;
    langAtOpen = P.lang;
    if (window.__appPause) window.__appPause();
    renderForm(); sheet.hidden = false;
  }
  function closeSettings() {
    sheet.hidden = true;
    if (P.lang !== langAtOpen) {
      // flush the saves, then restart the game in the new language
      try { if (window.__host) window.__host.flushRMS(); } catch (e) {}
      setTimeout(() => location.reload(), 300);
    } else if (window.__appResume) window.__appResume();
  }
  $('.tz-done', sheet).onclick = closeSettings;
  sheet.addEventListener('pointerdown', (e) => { if (e.target === sheet) closeSettings(); });

  /* ---------------- how to play (HelpView) ---------------- */
  const HELP = [
    ['stick', null, 'Джойстик', 'Коснитесь левой нижней части экрана и ведите пальцем — танк поедет туда же.'],
    ['scope', null, 'Огонь', 'Красная кнопка. Держите — танк стреляет очередью.'],
    ['box', '✱', 'Припасы / Отмена', 'Список: ремкомплект, ускорение, заморозка и др. Выбор — джойстиком вверх/вниз, подтвердить — огнём. Если игра пишет «Отмена: ✱» — жмите эту кнопку.'],
    ['bandage', '7', 'Ремонт', 'Чинит танк ремкомплектом. Если ремонт не нужен — отмените кнопкой ✱.'],
    ['uturn', '0', 'Задний ход', 'Держите, чтобы ехать назад, не разворачиваясь.'],
    ['radar', '9', 'Радар', 'Показывает врагов на карте (если куплен).'],
    ['wrench', null, 'Мастерская', 'Работает на своей базе (там, где начали). Тап по товару — выбрать, ещё тап — купить, «Макс.» — до упора. Если включено «Всё оружие открыто» (по умолчанию) — покупается всё, на что хватает монет.'],
    ['chevL', null, 'меню', 'Пауза и выход назад в любом экране. Кнопка «Назад» телефона делает то же самое.'],
    ['wifi', null, 'Сеть', 'Игра вдвоём–вчетвером по Wi‑Fi: с другими Android и с iPhone в одной сети.'],
    ['hand', null, 'Меню игры', 'Просто нажимайте на пункты. Длинный текст листается пальцем.'],
  ];
  const help = h('div', 'tz-sheet-wrap tz-help'); help.hidden = true;
  help.innerHTML = '<div class="tz-sheet"><div class="tz-head"><b>Как играть</b><button class="tz-done">Понятно</button></div><div class="tz-list">' +
    HELP.map(([ic, k, t, x]) => '<div class="tz-hi"><div class="tz-hic">' + I[ic] + (k ? '<span class="tz-hk">' + k + '</span>' : '') + '</div><div><b>' + t + '</b><div>' + x + '</div></div></div>').join('') + '</div></div>';
  document.body.appendChild(help);
  let helpPaused = false;
  function openHelp() { if (sheet.hidden && window.__appPause) { window.__appPause(); helpPaused = true; } help.hidden = false; }
  function closeHelp() { help.hidden = true; if (helpPaused && sheet.hidden && window.__appResume) window.__appResume(); helpPaused = false; }
  $('.tz-done', help).onclick = closeHelp;

  /* ---------------- the phone's Back key (sent by the shell) ---------------- */
  window.__androidBack = () => {
    if (!help.hidden) { closeHelp(); return true; }
    if (!sheet.hidden) { closeSettings(); return true; }
    key(-6, true); setTimeout(() => key(-6, false), 40);
    return true;
  };

  window.TouchUI = { setMode, layout, openSettings, openHelp, get mode() { return mode; } };
  document.body.classList.add('touchui');
  applyVisibility(); layout();
  if (!P.helpShown) { P.helpShown = true; window.__saveNativePrefs(); setTimeout(openHelp, 900); }
})();
