/* MIDP 2.0 (lcdui, lcdui.game, rms, media, midlet, io, wma) implemented on top of Canvas2D / WebAudio. */
'use strict';

(function (global) {
const { STATE } = global.JVM;

// lcdui constants
const HCENTER = 1, VCENTER = 2, LEFT = 4, RIGHT = 8, TOP = 16, BOTTOM = 32, BASELINE = 64;

function installMIDP(vm, host) {
  const N = (name, sup, ifs, methods, statics, opts) => vm.defineNative(name, sup, ifs, methods, statics, opts);
  const I = (name, sup) => N(name, null, sup ? [sup] : [], {}, {}, { isInterface: true });
  const thr = (c, m) => vm.jthrowObj(c, m);

  /* =========================================================== MIDlet */
  N('javax/microedition/midlet/MIDlet', 'java/lang/Object', [], {
    '<init>()V': (t, o) => { host.midlet = o; },
    'getAppProperty(Ljava/lang/String;)Ljava/lang/String;': (t, o, k) => (k in host.appProps ? host.appProps[k] : null),
    'notifyDestroyed()V': () => host.onExit(),
    'notifyPaused()V': () => {},
    'resumeRequest()V': () => {},
    'platformRequest(Ljava/lang/String;)Z': (t, o, url) => { host.log('[midlet] platformRequest ' + url); return 0; },
    'checkPermission(Ljava/lang/String;)I': () => 0,
    'startApp()V': () => {}, 'pauseApp()V': () => {}, 'destroyApp(Z)V': () => {},
  });
  N('javax/microedition/midlet/MIDletStateChangeException', 'java/lang/Exception', [], {});

  /* =========================================================== Display */
  N('javax/microedition/lcdui/Display', 'java/lang/Object', [], {
    's getDisplay(Ljavax/microedition/midlet/MIDlet;)Ljavax/microedition/lcdui/Display;': () => {
      if (!host.display) host.display = vm.newObjectByName('javax/microedition/lcdui/Display');
      return host.display;
    },
    'setCurrent(Ljavax/microedition/lcdui/Displayable;)V': (t, d, x) => host.setCurrent(x),
    'setCurrent(Ljavax/microedition/lcdui/Alert;Ljavax/microedition/lcdui/Displayable;)V': (t, d, a, x) => host.setCurrent(x),
    'getCurrent()Ljavax/microedition/lcdui/Displayable;': () => host.current,
    'vibrate(I)Z': (t, d, ms) => { host.vibrate(ms); return 1; },
    'flashBacklight(I)Z': () => 1,
    'numColors()I': () => 16777216,
    'numAlphaLevels()I': () => 256,
    'isColor()Z': () => 1,
    'callSerially(Ljava/lang/Runnable;)V': (t, d, r) => host.postEvent({ type: 'call', obj: r, nameDesc: 'run()V' }),
  });

  const displayableMethods = {
    '<init>()V': () => {},
    'addCommand(Ljavax/microedition/lcdui/Command;)V': (t, d, c) => { (d.__cmds = d.__cmds || []).push(c); },
    'removeCommand(Ljavax/microedition/lcdui/Command;)V': (t, d, c) => { if (d.__cmds) d.__cmds = d.__cmds.filter(x => x !== c); },
    'setCommandListener(Ljavax/microedition/lcdui/CommandListener;)V': (t, d, l) => { d.__listener = l; },
    'isShown()Z': (t, d) => (host.current === d ? 1 : 0),
    'setTitle(Ljava/lang/String;)V': () => {},
    'getTitle()Ljava/lang/String;': () => null,
    'setTicker(Ljavax/microedition/lcdui/Ticker;)V': () => {},
    'getWidth()I': () => host.W,
    'getHeight()I': () => host.H,
  };
  N('javax/microedition/lcdui/Displayable', 'java/lang/Object', [], displayableMethods);
  N('javax/microedition/lcdui/Screen', 'javax/microedition/lcdui/Displayable', [], {});
  N('javax/microedition/lcdui/Alert', 'javax/microedition/lcdui/Screen', [], {
    '<init>(Ljava/lang/String;)V': (t, a, s) => { a.__title = s; },
    '<init>(Ljava/lang/String;Ljava/lang/String;Ljavax/microedition/lcdui/Image;Ljavax/microedition/lcdui/AlertType;)V': (t, a, s, txt) => { a.__title = s; a.__text = txt; },
    'setTimeout(I)V': () => {},
    'setString(Ljava/lang/String;)V': (t, a, s) => { a.__text = s; },
    'setType(Ljavax/microedition/lcdui/AlertType;)V': () => {},
  }, { FOREVER: -2 });
  N('javax/microedition/lcdui/AlertType', 'java/lang/Object', [], {}, {}, {
    clinit: (vm, c) => { for (const k of ['ALARM', 'CONFIRMATION', 'ERROR', 'INFO', 'WARNING']) c.statics[k] = vm.newObject(c); } });
  N('javax/microedition/lcdui/Command', 'java/lang/Object', [], {
    '<init>(Ljava/lang/String;II)V': (t, c, l, type, p) => { c.__label = l; c.__type = type; },
    '<init>(Ljava/lang/String;Ljava/lang/String;II)V': (t, c, l, ll, type, p) => { c.__label = l; c.__type = type; },
    'getLabel()Ljava/lang/String;': (t, c) => c.__label,
    'getCommandType()I': (t, c) => c.__type,
  });
  I('javax/microedition/lcdui/CommandListener');

  /* =========================================================== Canvas */
  const noop = () => {};
  N('javax/microedition/lcdui/Canvas', 'javax/microedition/lcdui/Displayable', [], {
    '<init>()V': (t, c) => { c.__full = false; },
    'getWidth()I': () => host.W,
    'getHeight()I': () => host.H,
    'repaint()V': (t, c) => { if (host.current === c) { host.repaintPending = true; if (host.kick) host.kick(); } },
    'repaint(IIII)V': (t, c) => { if (host.current === c) host.repaintPending = true; },
    'serviceRepaints()V': (t, c) => host.serviceRepaints(t),
    'setFullScreenMode(Z)V': (t, c, b) => { c.__full = !!b; },
    'hasPointerEvents()Z': () => 1,
    'hasPointerMotionEvents()Z': () => 1,
    'hasRepeatEvents()Z': () => 1,
    'isDoubleBuffered()Z': () => 1,
    'getGameAction(I)I': (t, c, k) => host.gameAction(k),
    'getKeyCode(I)I': (t, c, a) => host.keyCodeForAction(a),
    'getKeyName(I)Ljava/lang/String;': (t, c, k) => host.keyName(k),
    'paint(Ljavax/microedition/lcdui/Graphics;)V': noop,
    'keyPressed(I)V': noop, 'keyReleased(I)V': noop, 'keyRepeated(I)V': noop,
    'pointerPressed(II)V': noop, 'pointerReleased(II)V': noop, 'pointerDragged(II)V': noop,
    'showNotify()V': noop, 'hideNotify()V': noop, 'sizeChanged(II)V': noop,
  }, { UP: 1, DOWN: 6, LEFT: 2, RIGHT: 5, FIRE: 8, GAME_A: 9, GAME_B: 10, GAME_C: 11, GAME_D: 12,
    KEY_NUM0: 48, KEY_NUM1: 49, KEY_NUM2: 50, KEY_NUM3: 51, KEY_NUM4: 52, KEY_NUM5: 53, KEY_NUM6: 54, KEY_NUM7: 55, KEY_NUM8: 56, KEY_NUM9: 57, KEY_STAR: 42, KEY_POUND: 35 });
  N('javax/microedition/lcdui/game/GameCanvas', 'javax/microedition/lcdui/Canvas', [], {
    '<init>(Z)V': (t, c) => { c.__full = false; },
    'getGraphics()Ljavax/microedition/lcdui/Graphics;': (t, c) => host.screenGraphics(),
    'flushGraphics()V': () => host.present(),
    'flushGraphics(IIII)V': () => host.present(),
    'getKeyStates()I': () => host.keyStates,
  });

  /* =========================================================== Font */
  const FONT_PX = { 8: 12, 0: 15, 16: 18 }; // SIZE_SMALL, SIZE_MEDIUM, SIZE_LARGE -> px
  function mkFont(face, style, size) {
    const key = face + ':' + style + ':' + size;
    host.fonts = host.fonts || {};
    if (host.fonts[key]) return host.fonts[key];
    const f = vm.newObjectByName('javax/microedition/lcdui/Font');
    f.__face = face; f.__style = style; f.__size = size;
    const px = FONT_PX[size] || 15;
    f.__px = px;
    f.__css = ((style & 2) ? 'italic ' : '') + ((style & 1) ? 'bold ' : '') + px + 'px ' + (face === 32 ? 'monospace' : 'Arial, Helvetica, sans-serif');
    f.__height = px + 3;
    f.__ascent = Math.round(px * 0.95);
    host.fonts[key] = f;
    return f;
  }
  const measure = (f, s) => { const c = host.measureCtx; c.font = f.__css; return Math.round(c.measureText(s).width); };
  N('javax/microedition/lcdui/Font', 'java/lang/Object', [], {
    's getFont(III)Ljavax/microedition/lcdui/Font;': (t, a, b, c) => mkFont(a, b, c),
    's getDefaultFont()Ljavax/microedition/lcdui/Font;': () => mkFont(0, 0, 0),
    's getFont(I)Ljavax/microedition/lcdui/Font;': () => mkFont(0, 0, 0),
    'getHeight()I': (t, f) => f.__height,
    'getBaselinePosition()I': (t, f) => f.__ascent,
    'getFace()I': (t, f) => f.__face, 'getStyle()I': (t, f) => f.__style, 'getSize()I': (t, f) => f.__size,
    'isBold()Z': (t, f) => (f.__style & 1 ? 1 : 0),
    'stringWidth(Ljava/lang/String;)I': (t, f, s) => measure(f, s),
    'charWidth(C)I': (t, f, c) => measure(f, String.fromCharCode(c)),
    'substringWidth(Ljava/lang/String;II)I': (t, f, s, o, n) => measure(f, s.substr(o, n)),
    'charsWidth([CII)I': (t, f, a, o, n) => measure(f, String.fromCharCode(...a.subarray(o, o + n))),
  }, { FACE_SYSTEM: 0, FACE_MONOSPACE: 32, FACE_PROPORTIONAL: 64, STYLE_PLAIN: 0, STYLE_BOLD: 1, STYLE_ITALIC: 2, STYLE_UNDERLINED: 4, SIZE_SMALL: 8, SIZE_MEDIUM: 0, SIZE_LARGE: 16 });

  /* =========================================================== Image */
  function wrapImage(rec, mutable) {
    const img = vm.newObjectByName('javax/microedition/lcdui/Image');
    img.__c = rec.canvas; img.__w = rec.w; img.__h = rec.h; img.__mutable = !!mutable; img.__rec = rec;
    return img;
  }
  function newMutable(w, h) {
    const c = host.makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    return wrapImage({ canvas: c, w, h }, true);
  }
  function imageFromBytes(bytes, name) {
    const rec = (name && host.images[normRes(name)]) || host.imageByBytes(bytes);
    if (!rec) throw thr('java/io/IOException', 'Cannot decode image' + (name ? ' ' + name : ''));
    return wrapImage(rec, false);
  }
  N('javax/microedition/lcdui/Image', 'java/lang/Object', [], {
    's createImage(Ljava/lang/String;)Ljavax/microedition/lcdui/Image;': (t, name) => {
      const rec = host.images[normRes(name)];
      if (!rec) throw thr('java/io/IOException', name);
      return wrapImage(rec, false);
    },
    's createImage(Ljava/io/InputStream;)Ljavax/microedition/lcdui/Image;': (t, s) => {
      if (s === null) throw thr('java/lang/NullPointerException', null);
      const base = s.__buf ? s : s.__in;
      if (base && base.__res && base.__pos === 0) { base.__pos = base.__count; return imageFromBytes(null, base.__res); }
      const bytes = [];
      for (;;) { const b = host.readStreamByte(s); if (b < 0) break; bytes.push(b); }
      return imageFromBytes(Uint8Array.from(bytes), null);
    },
    's createImage([BII)Ljavax/microedition/lcdui/Image;': (t, a, off, n) => imageFromBytes(Uint8Array.from(a.subarray(off, off + n), x => x & 0xff), null),
    's createImage(II)Ljavax/microedition/lcdui/Image;': (t, w, h) => newMutable(w, h),
    's createImage(Ljavax/microedition/lcdui/Image;)Ljavax/microedition/lcdui/Image;': (t, src) => (src.__mutable ? copyRegion(src, 0, 0, src.__w, src.__h, 0) : src),
    's createImage(Ljavax/microedition/lcdui/Image;IIIII)Ljavax/microedition/lcdui/Image;': (t, src, x, y, w, h, tr) => copyRegion(src, x, y, w, h, tr),
    's createRGBImage([IIIZ)Ljavax/microedition/lcdui/Image;': (t, rgb, w, h, alpha) => {
      const c = host.makeCanvas(w, h); const ctx = c.getContext('2d');
      const id = ctx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const p = rgb[i];
        id.data[i * 4] = (p >> 16) & 255; id.data[i * 4 + 1] = (p >> 8) & 255; id.data[i * 4 + 2] = p & 255;
        id.data[i * 4 + 3] = alpha ? (p >>> 24) : 255;
      }
      ctx.putImageData(id, 0, 0);
      return wrapImage({ canvas: c, w, h }, false);
    },
    'getWidth()I': (t, i) => i.__w,
    'getHeight()I': (t, i) => i.__h,
    'isMutable()Z': (t, i) => (i.__mutable ? 1 : 0),
    'getGraphics()Ljavax/microedition/lcdui/Graphics;': (t, i) => {
      if (!i.__mutable) throw thr('java/lang/IllegalStateException', null);
      return makeGraphics(i.__c.getContext('2d'), i.__w, i.__h, i);
    },
    'getRGB([IIIIIII)V': (t, i, rgb, off, scan, x, y, w, h) => {
      const d = i.__c.getContext('2d').getImageData(x, y, w, h).data;
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const k = (r * w + c) * 4;
        rgb[off + r * scan + c] = (d[k + 3] << 24) | (d[k] << 16) | (d[k + 1] << 8) | d[k + 2];
      }
    },
  });
  function copyRegion(src, x, y, w, h, tr) {
    const rw = (tr & 4) ? h : w, rh = (tr & 4) ? w : h;
    const c = host.makeCanvas(rw, rh); const ctx = c.getContext('2d');
    drawTransformed(ctx, src.__c, x, y, w, h, tr, 0, 0);
    return wrapImage({ canvas: c, w: rw, h: rh }, false);
  }

  /* =========================================================== Graphics */
  function makeGraphics(ctx, w, h, target) {
    const g = vm.newObjectByName('javax/microedition/lcdui/Graphics');
    g.__ctx = ctx; g.__tw = w; g.__th = h; g.__target = target || null;
    resetGraphics(g);
    return g;
  }
  function resetGraphics(g) {
    g.__tx = 0; g.__ty = 0;
    g.__cx = 0; g.__cy = 0; g.__cw = g.__tw; g.__ch = g.__th;
    g.__color = 0; g.__font = mkFont(0, 0, 0); g.__stroke = 0;
    const ctx = g.__ctx;
    while (g.__saved > 0) { ctx.restore(); g.__saved--; }
    g.__saved = 0;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
    g.__clipFull = true;
  }
  host.makeGraphics = makeGraphics;
  host.resetGraphics = resetGraphics;
  function applyClip(g) {
    const ctx = g.__ctx;
    if (g.__saved > 0) { ctx.restore(); g.__saved--; }
    const full = g.__cx <= 0 && g.__cy <= 0 && g.__cx + g.__cw >= g.__tw && g.__cy + g.__ch >= g.__th;
    g.__clipFull = full;
    if (!full) {
      ctx.save(); g.__saved++;
      ctx.beginPath(); ctx.rect(g.__cx, g.__cy, Math.max(0, g.__cw), Math.max(0, g.__ch)); ctx.clip();
    }
    setColor(g, g.__color);
  }
  function setColor(g, c) {
    g.__color = c & 0xffffff;
    const s = '#' + (0x1000000 | g.__color).toString(16).substring(1);
    g.__ctx.fillStyle = s; g.__ctx.strokeStyle = s;
  }
  function clipEmpty(g) { return g.__cw <= 0 || g.__ch <= 0; }
  function anchorX(x, w, a) { return (a & HCENTER) ? x - (w >> 1) : (a & RIGHT) ? x - w : x; }
  function anchorY(y, h, a) { return (a & VCENTER) ? y - (h >> 1) : (a & BOTTOM) ? y - h : y; }
  function drawLinePx(ctx, x1, y1, x2, y2) {
    if (x1 === x2) { const a = Math.min(y1, y2); ctx.fillRect(x1, a, 1, Math.abs(y2 - y1) + 1); return; }
    if (y1 === y2) { const a = Math.min(x1, x2); ctx.fillRect(a, y1, Math.abs(x2 - x1) + 1, 1); return; }
    let dx = Math.abs(x2 - x1), dy = -Math.abs(y2 - y1), sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1, err = dx + dy;
    for (let i = 0; i < 4096; i++) {
      ctx.fillRect(x1, y1, 1, 1);
      if (x1 === x2 && y1 === y2) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x1 += sx; }
      if (e2 <= dx) { err += dx; y1 += sy; }
    }
  }
  function arcPath(ctx, x, y, w, h, start, arc) {
    const cx = x + w / 2, cy = y + h / 2;
    const a0 = -start * Math.PI / 180, a1 = -(start + arc) * Math.PI / 180;
    ctx.beginPath();
    if (Math.abs(arc) >= 360) { ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); return; }
    ctx.moveTo(cx, cy);
    ctx.ellipse(cx, cy, Math.max(0, w / 2), Math.max(0, h / 2), 0, a0, a1, arc > 0);
    ctx.closePath();
  }
  function textBase(g, a) { return (a & BOTTOM) ? 'bottom' : (a & BASELINE) ? 'alphabetic' : 'top'; }
  function drawText(g, s, x, y, a) {
    if (clipEmpty(g) || !s) return;
    const ctx = g.__ctx; const f = g.__font;
    ctx.font = f.__css;
    const w = Math.round(ctx.measureText(s).width);
    let dx = x + g.__tx;
    if (a & HCENTER) dx -= w >> 1; else if (a & RIGHT) dx -= w;
    let dy = y + g.__ty;
    if (a & BOTTOM) dy -= f.__height; else if (a & BASELINE) dy -= f.__ascent;
    ctx.textBaseline = 'top';
    ctx.fillText(s, dx, dy + 1);
  }
  N('javax/microedition/lcdui/Graphics', 'java/lang/Object', [], {
    'setColor(I)V': (t, g, c) => setColor(g, c),
    'setColor(III)V': (t, g, r, gg, b) => setColor(g, ((r & 255) << 16) | ((gg & 255) << 8) | (b & 255)),
    'getColor()I': (t, g) => g.__color,
    'getRedComponent()I': (t, g) => (g.__color >> 16) & 255,
    'getGreenComponent()I': (t, g) => (g.__color >> 8) & 255,
    'getBlueComponent()I': (t, g) => g.__color & 255,
    'setGrayScale(I)V': (t, g, v) => setColor(g, (v << 16) | (v << 8) | v),
    'getGrayScale()I': (t, g) => g.__color & 255,
    'setFont(Ljavax/microedition/lcdui/Font;)V': (t, g, f) => { g.__font = f || mkFont(0, 0, 0); },
    'getFont()Ljavax/microedition/lcdui/Font;': (t, g) => g.__font,
    'setStrokeStyle(I)V': (t, g, s) => { g.__stroke = s; },
    'getStrokeStyle()I': (t, g) => g.__stroke,
    'translate(II)V': (t, g, x, y) => { g.__tx += x; g.__ty += y; },
    'getTranslateX()I': (t, g) => g.__tx,
    'getTranslateY()I': (t, g) => g.__ty,
    'getClipX()I': (t, g) => g.__cx - g.__tx,
    'getClipY()I': (t, g) => g.__cy - g.__ty,
    'getClipWidth()I': (t, g) => g.__cw,
    'getClipHeight()I': (t, g) => g.__ch,
    'setClip(IIII)V': (t, g, x, y, w, h) => {
      let x0 = x + g.__tx, y0 = y + g.__ty, x1 = x0 + w, y1 = y0 + h;
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(g.__tw, x1); y1 = Math.min(g.__th, y1);
      g.__cx = x0; g.__cy = y0; g.__cw = x1 - x0; g.__ch = y1 - y0; applyClip(g);
    },
    'clipRect(IIII)V': (t, g, x, y, w, h) => {
      const x0 = Math.max(g.__cx, x + g.__tx), y0 = Math.max(g.__cy, y + g.__ty);
      const x1 = Math.min(g.__cx + g.__cw, x + g.__tx + w), y1 = Math.min(g.__cy + g.__ch, y + g.__ty + h);
      g.__cx = x0; g.__cy = y0; g.__cw = x1 - x0; g.__ch = y1 - y0; applyClip(g);
    },
    'fillRect(IIII)V': (t, g, x, y, w, h) => { if (w > 0 && h > 0 && !clipEmpty(g)) g.__ctx.fillRect(x + g.__tx, y + g.__ty, w, h); },
    'drawRect(IIII)V': (t, g, x, y, w, h) => {
      if (w < 0 || h < 0 || clipEmpty(g)) return;
      const c = g.__ctx; x += g.__tx; y += g.__ty;
      c.fillRect(x, y, w + 1, 1); c.fillRect(x, y + h, w + 1, 1); c.fillRect(x, y, 1, h + 1); c.fillRect(x + w, y, 1, h + 1);
    },
    'drawLine(IIII)V': (t, g, x1, y1, x2, y2) => { if (!clipEmpty(g)) drawLinePx(g.__ctx, x1 + g.__tx, y1 + g.__ty, x2 + g.__tx, y2 + g.__ty); },
    'fillRoundRect(IIIIII)V': (t, g, x, y, w, h, aw, ah) => {
      if (clipEmpty(g)) return;
      const c = g.__ctx; c.beginPath();
      if (c.roundRect) c.roundRect(x + g.__tx, y + g.__ty, w, h, [Math.min(aw, w) / 2]); else c.rect(x + g.__tx, y + g.__ty, w, h);
      c.fill();
    },
    'drawRoundRect(IIIIII)V': (t, g, x, y, w, h, aw, ah) => {
      if (clipEmpty(g)) return;
      const c = g.__ctx; c.beginPath(); c.lineWidth = 1;
      if (c.roundRect) c.roundRect(x + g.__tx + 0.5, y + g.__ty + 0.5, w, h, [Math.min(aw, w) / 2]); else c.rect(x + g.__tx + 0.5, y + g.__ty + 0.5, w, h);
      c.stroke();
    },
    'fillArc(IIIIII)V': (t, g, x, y, w, h, s, a) => { if (clipEmpty(g)) return; arcPath(g.__ctx, x + g.__tx, y + g.__ty, w, h, s, a); g.__ctx.fill(); },
    'drawArc(IIIIII)V': (t, g, x, y, w, h, s, a) => {
      if (clipEmpty(g)) return;
      const c = g.__ctx; const cx = x + g.__tx + w / 2 + 0.5, cy = y + g.__ty + h / 2 + 0.5;
      c.beginPath(); c.lineWidth = 1;
      c.ellipse(cx, cy, w / 2, h / 2, 0, -s * Math.PI / 180, -(s + a) * Math.PI / 180, a > 0);
      c.stroke();
    },
    'fillTriangle(IIIIII)V': (t, g, x1, y1, x2, y2, x3, y3) => {
      if (clipEmpty(g)) return;
      const c = g.__ctx, tx = g.__tx, ty = g.__ty;
      c.beginPath(); c.moveTo(x1 + tx + 0.5, y1 + ty + 0.5); c.lineTo(x2 + tx + 0.5, y2 + ty + 0.5); c.lineTo(x3 + tx + 0.5, y3 + ty + 0.5); c.closePath(); c.fill();
    },
    'drawString(Ljava/lang/String;III)V': (t, g, s, x, y, a) => drawText(g, s, x, y, a),
    'drawSubstring(Ljava/lang/String;IIIII)V': (t, g, s, o, n, x, y, a) => drawText(g, s.substr(o, n), x, y, a),
    'drawChar(CIII)V': (t, g, c, x, y, a) => drawText(g, String.fromCharCode(c), x, y, a),
    'drawChars([CIIIII)V': (t, g, arr, o, n, x, y, a) => drawText(g, String.fromCharCode(...arr.subarray(o, o + n)), x, y, a),
    'drawImage(Ljavax/microedition/lcdui/Image;III)V': (t, g, img, x, y, a) => {
      if (img === null) throw thr('java/lang/NullPointerException', null);
      if (clipEmpty(g)) return;
      if (!g.__target && host.frameInfo && img.__rec && img.__rec.name) host.frameInfo.imgs[img.__rec.name] = 1;
      g.__ctx.drawImage(img.__c, anchorX(x, img.__w, a) + g.__tx, anchorY(y, img.__h, a) + g.__ty);
    },
    'drawRegion(Ljavax/microedition/lcdui/Image;IIIIIIII)V': (t, g, img, sx, sy, w, h, tr, x, y, a) => {
      if (clipEmpty(g) || w <= 0 || h <= 0) return;
      const rw = (tr & 4) ? h : w, rh = (tr & 4) ? w : h;
      drawTransformed(g.__ctx, img.__c, sx, sy, w, h, tr, anchorX(x, rw, a) + g.__tx, anchorY(y, rh, a) + g.__ty);
    },
    'drawRGB([IIIIIIIZ)V': (t, g, rgb, off, scan, x, y, w, h, alpha) => {
      if (clipEmpty(g) || w <= 0 || h <= 0) return;
      const c = host.makeCanvas(w, h); const cx = c.getContext('2d'); const id = cx.createImageData(w, h);
      for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
        const p = rgb[off + r * scan + q], k = (r * w + q) * 4;
        id.data[k] = (p >> 16) & 255; id.data[k + 1] = (p >> 8) & 255; id.data[k + 2] = p & 255; id.data[k + 3] = alpha ? (p >>> 24) : 255;
      }
      cx.putImageData(id, 0, 0);
      g.__ctx.drawImage(c, x + g.__tx, y + g.__ty);
    },
    'copyArea(IIIIIII)V': (t, g, sx, sy, w, h, dx, dy, a) => {
      const c = host.makeCanvas(w, h); c.getContext('2d').drawImage(g.__ctx.canvas, sx + g.__tx, sy + g.__ty, w, h, 0, 0, w, h);
      g.__ctx.drawImage(c, anchorX(dx, w, a) + g.__tx, anchorY(dy, h, a) + g.__ty);
    },
    'getDisplayColor(I)I': (t, g, c) => c,
  }, { HCENTER, VCENTER, LEFT, RIGHT, TOP, BOTTOM, BASELINE, SOLID: 0, DOTTED: 1 });

  // Sprite transforms: 0 NONE, 1 MIRROR_ROT180, 2 MIRROR, 3 ROT180, 4 MIRROR_ROT270, 5 ROT90, 6 ROT270, 7 MIRROR_ROT90
  function drawTransformed(ctx, src, sx, sy, w, h, tr, dx, dy) {
    if (tr === 0) { ctx.drawImage(src, sx, sy, w, h, dx, dy, w, h); return; }
    ctx.save();
    const rw = (tr & 4) ? h : w, rh = (tr & 4) ? w : h;
    ctx.translate(dx + rw / 2, dy + rh / 2);
    switch (tr) {
      case 1: ctx.rotate(Math.PI); ctx.scale(-1, 1); break;
      case 2: ctx.scale(-1, 1); break;
      case 3: ctx.rotate(Math.PI); break;
      case 4: ctx.rotate(3 * Math.PI / 2); ctx.scale(-1, 1); break;
      case 5: ctx.rotate(Math.PI / 2); break;
      case 6: ctx.rotate(3 * Math.PI / 2); break;
      case 7: ctx.rotate(Math.PI / 2); ctx.scale(-1, 1); break;
    }
    ctx.drawImage(src, sx, sy, w, h, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /* =========================================================== lcdui.game */
  const layerBase = {
    'getX()I': (t, l) => l.__x, 'getY()I': (t, l) => l.__y,
    'getWidth()I': (t, l) => l.__w, 'getHeight()I': (t, l) => l.__h,
    'setPosition(II)V': (t, l, x, y) => { l.__x = x; l.__y = y; },
    'move(II)V': (t, l, dx, dy) => { l.__x = (l.__x + dx) | 0; l.__y = (l.__y + dy) | 0; },
    'isVisible()Z': (t, l) => (l.__vis ? 1 : 0),
    'setVisible(Z)V': (t, l, v) => { l.__vis = !!v; },
  };
  N('javax/microedition/lcdui/game/Layer', 'java/lang/Object', [], layerBase);

  function initSprite(s, img, fw, fh) {
    if (host.onSpriteCreated && img.__rec && img.__rec.name) host.onSpriteCreated(img.__rec.name);
    if (fw <= 0 || fh <= 0 || img.__w % fw !== 0 || img.__h % fh !== 0) throw thr('java/lang/IllegalArgumentException', 'frame size');
    s.__x = 0; s.__y = 0; s.__vis = true;
    s.__img = img; s.__fw = fw; s.__fh = fh; s.__w = fw; s.__h = fh;
    s.__cols = img.__w / fw; s.__nraw = s.__cols * (img.__h / fh);
    s.__seq = null; s.__fi = 0;
    s.__refX = 0; s.__refY = 0; s.__tr = 0;
    s.__colX = 0; s.__colY = 0; s.__colW = fw; s.__colH = fh;
  }
  const seqLen = (s) => (s.__seq ? s.__seq.length : s.__nraw);
  const rawFrame = (s) => (s.__seq ? s.__seq[s.__fi] : s.__fi);
  function spriteSrc(s) { const r = rawFrame(s); return [(r % s.__cols) * s.__fw, Math.floor(r / s.__cols) * s.__fh]; }
  function spritePaint(g, s) {
    if (!s.__vis || clipEmpty(g)) return;
    const [sx, sy] = spriteSrc(s);
    if (!g.__target && host.fx && host.inGameNow) {
      const nm = s.__img.__rec && s.__img.__rec.name;
      if (nm) {
        const cx = s.__x + g.__tx + s.__fw / 2, cy = s.__y + g.__ty + s.__fh / 2;
        // soft shadow under tanks (quality 10)
        if (host.fx.shadows && /^tank_/.test(nm)) {
          const c = g.__ctx; c.save();
          c.fillStyle = 'rgba(0,0,0,0.28)';
          c.beginPath(); c.ellipse(cx + 2.5, cy + 3.5, s.__fw * 0.42, s.__fh * 0.4, 0, 0, Math.PI * 2); c.fill();
          c.restore();
        }
        // glow around shots and explosions (quality 9+), drawn later at full resolution
        if (host.fx.glow && host.frameInfo) {
          // bullets.png frames: 0-3 shell, 4-7 plasma bolt, 8-11 rocket, 12 shadow, 13-16 enemy laser,
          // 17-18 artillery crosshair (no glow), 19-22 muzzle flash / artillery shell
          const bf = nm === 'bullets.png' ? rawFrame(s) : -1;
          const kind = bf >= 0 ? (bf >= 4 && bf <= 7 ? 6 : bf >= 13 && bf <= 16 ? 7 : bf === 12 || bf === 17 || bf === 18 ? 0 : 1)
            : nm === 'expl_plasma.png' ? 3 : /^expl_/.test(nm) ? 2
            : nm === 'rings.png' ? 4 : nm === 'powerups.png' ? 5 : 0;
          if (kind) (host.frameInfo.glows || (host.frameInfo.glows = [])).push([cx, cy, kind, s.__fw, rawFrame(s)]);
        }
      }
    }
    if (!g.__target && host.frameInfo) {
      // remember menu text rows + selection bar, so taps on menu items can be turned into key presses
      const nm = s.__img.__rec && s.__img.__rec.name, X = s.__x + g.__tx, Y = s.__y + g.__ty;
      if (nm) host.frameInfo.imgs[nm] = 1;
      if (host.debugSprites && nm && /tank/.test(nm)) (host.frameInfo.spr || (host.frameInfo.spr = [])).push(nm + '#' + rawFrame(s) + '@' + X + ',' + Y);
      if (nm === 'font.png') { const r = host.frameInfo.rows; (r[Y] || (r[Y] = [])).push([X, rawFrame(s)]); }
      else if (nm === 'billets.png' && s.__fw >= 60) host.frameInfo.hl = { x: X, y: Y, w: s.__fw, h: s.__fh };
    }
    drawTransformed(g.__ctx, s.__img.__c, sx, sy, s.__fw, s.__fh, s.__tr, s.__x + g.__tx, s.__y + g.__ty);
  }
  function colRect(s) {
    // only TRANS_NONE / mirror-aware approximations
    return [s.__x + s.__colX, s.__y + s.__colY, s.__colW, s.__colH];
  }
  function alphaAt(img, x, y) {
    const a = host.alphaMask(img);
    if (x < 0 || y < 0 || x >= img.__w || y >= img.__h) return 0;
    return a[y * img.__w + x];
  }
  function spriteOpaqueAt(s, wx, wy) {
    const [sx, sy] = spriteSrc(s);
    let lx = wx - s.__x, ly = wy - s.__y;
    if (lx < 0 || ly < 0 || lx >= s.__fw || ly >= s.__fh) return false;
    if (s.__tr === 2) lx = s.__fw - 1 - lx;
    else if (s.__tr === 3) { lx = s.__fw - 1 - lx; ly = s.__fh - 1 - ly; }
    return alphaAt(s.__img, sx + lx, sy + ly) > 0;
  }
  function rectIntersect(a, b) {
    const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]);
    const x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
    return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
  }
  N('javax/microedition/lcdui/game/Sprite', 'javax/microedition/lcdui/game/Layer', [], {
    '<init>(Ljavax/microedition/lcdui/Image;)V': (t, s, img) => initSprite(s, img, img.__w, img.__h),
    '<init>(Ljavax/microedition/lcdui/Image;II)V': (t, s, img, fw, fh) => initSprite(s, img, fw, fh),
    '<init>(Ljavax/microedition/lcdui/game/Sprite;)V': (t, s, o) => {
      for (const k of ['__x', '__y', '__vis', '__img', '__fw', '__fh', '__w', '__h', '__cols', '__nraw', '__fi', '__refX', '__refY', '__tr', '__colX', '__colY', '__colW', '__colH']) s[k] = o[k];
      s.__seq = o.__seq ? o.__seq.slice() : null;
    },
    'setFrame(I)V': (t, s, i) => { if (i < 0 || i >= seqLen(s)) throw thr('java/lang/IndexOutOfBoundsException', String(i)); s.__fi = i; },
    'getFrame()I': (t, s) => s.__fi,
    'nextFrame()V': (t, s) => { s.__fi = (s.__fi + 1) % seqLen(s); },
    'prevFrame()V': (t, s) => { s.__fi = (s.__fi - 1 + seqLen(s)) % seqLen(s); },
    'getFrameSequenceLength()I': (t, s) => seqLen(s),
    'getRawFrameCount()I': (t, s) => s.__nraw,
    'setFrameSequence([I)V': (t, s, seq) => { s.__seq = seq ? Array.from(seq) : null; s.__fi = 0; },
    'setImage(Ljavax/microedition/lcdui/Image;II)V': (t, s, img, fw, fh) => {
      const keepSeq = s.__seq, x = s.__x, y = s.__y, vis = s.__vis, tr = s.__tr;
      initSprite(s, img, fw, fh); s.__x = x; s.__y = y; s.__vis = vis; s.__tr = tr;
      if (keepSeq && Math.max(...keepSeq) < s.__nraw) s.__seq = keepSeq;
    },
    'defineReferencePixel(II)V': (t, s, x, y) => { s.__refX = x; s.__refY = y; },
    'setRefPixelPosition(II)V': (t, s, x, y) => { s.__x = x - s.__refX; s.__y = y - s.__refY; },
    'getRefPixelX()I': (t, s) => s.__x + s.__refX,
    'getRefPixelY()I': (t, s) => s.__y + s.__refY,
    'setTransform(I)V': (t, s, tr) => { s.__tr = tr; if (tr & 4) { s.__w = s.__fh; s.__h = s.__fw; } else { s.__w = s.__fw; s.__h = s.__fh; } },
    'defineCollisionRectangle(IIII)V': (t, s, x, y, w, h) => { s.__colX = x; s.__colY = y; s.__colW = w; s.__colH = h; },
    'paint(Ljavax/microedition/lcdui/Graphics;)V': (t, s, g) => spritePaint(g, s),
    'collidesWith(Ljavax/microedition/lcdui/game/Sprite;Z)Z': (t, s, o, px) => {
      if (!s.__vis || !o.__vis) return 0;
      const r = rectIntersect(colRect(s), colRect(o));
      if (!r) return 0;
      if (!px) return 1;
      for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) if (spriteOpaqueAt(s, x, y) && spriteOpaqueAt(o, x, y)) return 1;
      return 0;
    },
    'collidesWith(Ljavax/microedition/lcdui/game/TiledLayer;Z)Z': (t, s, tl, px) => {
      if (!s.__vis || !tl.__vis) return 0;
      const r = rectIntersect(colRect(s), [tl.__x, tl.__y, tl.__w, tl.__h]);
      if (!r) return 0;
      const c0 = Math.floor((r[0] - tl.__x) / tl.__tw), c1 = Math.floor((r[2] - 1 - tl.__x) / tl.__tw);
      const r0 = Math.floor((r[1] - tl.__y) / tl.__th), r1 = Math.floor((r[3] - 1 - tl.__y) / tl.__th);
      for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
        let cell = tl.__cells[row * tl.__cols + col];
        if (cell < 0) cell = tl.__anim[-cell - 1] || 0;
        if (cell === 0) continue;
        if (!px) return 1;
        const tx0 = tl.__x + col * tl.__tw, ty0 = tl.__y + row * tl.__th;
        const sx = ((cell - 1) % tl.__icols) * tl.__tw, sy = Math.floor((cell - 1) / tl.__icols) * tl.__th;
        const ax0 = Math.max(r[0], tx0), ay0 = Math.max(r[1], ty0), ax1 = Math.min(r[2], tx0 + tl.__tw), ay1 = Math.min(r[3], ty0 + tl.__th);
        for (let y = ay0; y < ay1; y++) for (let x = ax0; x < ax1; x++)
          if (spriteOpaqueAt(s, x, y) && alphaAt(tl.__img, sx + x - tx0, sy + y - ty0) > 0) return 1;
      }
      return 0;
    },
    'collidesWith(Ljavax/microedition/lcdui/Image;IIZ)Z': (t, s, img, ix, iy, px) => {
      if (!s.__vis) return 0;
      const r = rectIntersect(colRect(s), [ix, iy, img.__w, img.__h]);
      if (!r) return 0;
      if (!px) return 1;
      for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) if (spriteOpaqueAt(s, x, y) && alphaAt(img, x - ix, y - iy) > 0) return 1;
      return 0;
    },
  }, { TRANS_NONE: 0, TRANS_MIRROR_ROT180: 1, TRANS_MIRROR: 2, TRANS_ROT180: 3, TRANS_MIRROR_ROT270: 4, TRANS_ROT90: 5, TRANS_ROT270: 6, TRANS_MIRROR_ROT90: 7 });

  function tiledPaint(g, tl) {
    if (!tl.__vis || clipEmpty(g)) return;
    const ox = tl.__x + g.__tx, oy = tl.__y + g.__ty;
    const c0 = Math.max(0, Math.floor((g.__cx - ox) / tl.__tw)), c1 = Math.min(tl.__cols - 1, Math.floor((g.__cx + g.__cw - 1 - ox) / tl.__tw));
    const r0 = Math.max(0, Math.floor((g.__cy - oy) / tl.__th)), r1 = Math.min(tl.__rows - 1, Math.floor((g.__cy + g.__ch - 1 - oy) / tl.__th));
    const ctx = g.__ctx, src = tl.__img.__c, tw = tl.__tw, th = tl.__th, ic = tl.__icols;
    for (let r = r0; r <= r1; r++) {
      const base = r * tl.__cols;
      for (let c = c0; c <= c1; c++) {
        let cell = tl.__cells[base + c];
        if (cell < 0) cell = tl.__anim[-cell - 1] || 0;
        if (cell === 0) continue;
        const k = cell - 1;
        ctx.drawImage(src, (k % ic) * tw, Math.floor(k / ic) * th, tw, th, ox + c * tw, oy + r * th, tw, th);
      }
    }
  }
  N('javax/microedition/lcdui/game/TiledLayer', 'javax/microedition/lcdui/game/Layer', [], {
    '<init>(IILjavax/microedition/lcdui/Image;II)V': (t, tl, cols, rows, img, tw, th) => {
      tl.__x = 0; tl.__y = 0; tl.__vis = true;
      tl.__cols = cols; tl.__rows = rows; tl.__tw = tw; tl.__th = th;
      tl.__w = cols * tw; tl.__h = rows * th;
      tl.__img = img; tl.__icols = Math.floor(img.__w / tw);
      tl.__cells = new Int32Array(cols * rows); tl.__anim = [];
    },
    'setCell(III)V': (t, tl, c, r, v) => {
      if (c < 0 || r < 0 || c >= tl.__cols || r >= tl.__rows) throw thr('java/lang/IndexOutOfBoundsException', c + ',' + r);
      tl.__cells[r * tl.__cols + c] = v;
    },
    'getCell(II)I': (t, tl, c, r) => {
      if (c < 0 || r < 0 || c >= tl.__cols || r >= tl.__rows) throw thr('java/lang/IndexOutOfBoundsException', c + ',' + r);
      return tl.__cells[r * tl.__cols + c];
    },
    'fillCells(IIIII)V': (t, tl, c, r, nc, nr, v) => {
      if (c < 0 || r < 0 || c + nc > tl.__cols || r + nr > tl.__rows) throw thr('java/lang/IndexOutOfBoundsException', null);
      for (let y = r; y < r + nr; y++) for (let x = c; x < c + nc; x++) tl.__cells[y * tl.__cols + x] = v;
    },
    'createAnimatedTile(I)I': (t, tl, v) => { tl.__anim.push(v); return -tl.__anim.length; },
    'setAnimatedTile(II)V': (t, tl, i, v) => { tl.__anim[-i - 1] = v; },
    'getAnimatedTile(I)I': (t, tl, i) => tl.__anim[-i - 1],
    'getColumns()I': (t, tl) => tl.__cols, 'getRows()I': (t, tl) => tl.__rows,
    'getCellWidth()I': (t, tl) => tl.__tw, 'getCellHeight()I': (t, tl) => tl.__th,
    'setStaticTileSet(Ljavax/microedition/lcdui/Image;II)V': (t, tl, img, tw, th) => { tl.__img = img; tl.__tw = tw; tl.__th = th; tl.__icols = Math.floor(img.__w / tw); },
    'paint(Ljavax/microedition/lcdui/Graphics;)V': (t, tl, g) => tiledPaint(g, tl),
  });

  function paintLayer(t, g, l) {
    if (l.__cells) return tiledPaint(g, l);
    const m = vm.findVirtual(vm.classOf(l), 'paint(Ljavax/microedition/lcdui/Graphics;)V');
    if (m.native) m.native(t, l, g);
    else { if (!host.__warnedLayerPaint) { host.__warnedLayerPaint = true; host.log('[midp] custom Layer.paint not supported, using Sprite paint'); } spritePaint(g, l); }
  }
  N('javax/microedition/lcdui/game/LayerManager', 'java/lang/Object', [], {
    '<init>()V': (t, lm) => { lm.__layers = []; lm.__vx = 0; lm.__vy = 0; lm.__vw = 0x7fffffff; lm.__vh = 0x7fffffff; },
    'append(Ljavax/microedition/lcdui/game/Layer;)V': (t, lm, l) => { const i = lm.__layers.indexOf(l); if (i >= 0) lm.__layers.splice(i, 1); lm.__layers.push(l); },
    'insert(Ljavax/microedition/lcdui/game/Layer;I)V': (t, lm, l, idx) => {
      const i = lm.__layers.indexOf(l); if (i >= 0) { lm.__layers.splice(i, 1); }
      if (idx < 0 || idx > lm.__layers.length) throw thr('java/lang/IndexOutOfBoundsException', String(idx));
      lm.__layers.splice(idx, 0, l);
    },
    'remove(Ljavax/microedition/lcdui/game/Layer;)V': (t, lm, l) => { const i = lm.__layers.indexOf(l); if (i >= 0) lm.__layers.splice(i, 1); },
    'getLayerAt(I)Ljavax/microedition/lcdui/game/Layer;': (t, lm, i) => { if (i < 0 || i >= lm.__layers.length) throw thr('java/lang/IndexOutOfBoundsException', String(i)); return lm.__layers[i]; },
    'getSize()I': (t, lm) => lm.__layers.length,
    'setViewWindow(IIII)V': (t, lm, x, y, w, h) => { lm.__vx = x; lm.__vy = y; lm.__vw = w; lm.__vh = h; },
    'paint(Ljavax/microedition/lcdui/Graphics;II)V': (t, lm, g, x, y) => {
      if (!g.__target) host.lastWorldPaint = performance.now();
      const saved = [g.__tx, g.__ty, g.__cx, g.__cy, g.__cw, g.__ch];
      // clip to the view window
      const x0 = Math.max(g.__cx, x + g.__tx), y0 = Math.max(g.__cy, y + g.__ty);
      const x1 = Math.min(g.__cx + g.__cw, x + g.__tx + Math.min(lm.__vw, 100000)), y1 = Math.min(g.__cy + g.__ch, y + g.__ty + Math.min(lm.__vh, 100000));
      g.__cx = x0; g.__cy = y0; g.__cw = x1 - x0; g.__ch = y1 - y0; applyClip(g);
      g.__tx += x - lm.__vx; g.__ty += y - lm.__vy;
      for (let i = lm.__layers.length - 1; i >= 0; i--) {
        const l = lm.__layers[i];
        if (l.__vis) paintLayer(t, g, l);
      }
      [g.__tx, g.__ty, g.__cx, g.__cy, g.__cw, g.__ch] = saved; applyClip(g);
    },
  });

  /* =========================================================== RMS */
  const RS = 'javax/microedition/rms/RecordStore';
  N('javax/microedition/rms/RecordStoreException', 'java/lang/Exception', [], {});
  N('javax/microedition/rms/RecordStoreNotFoundException', 'javax/microedition/rms/RecordStoreException', [], {});
  N('javax/microedition/rms/RecordStoreNotOpenException', 'javax/microedition/rms/RecordStoreException', [], {});
  N('javax/microedition/rms/RecordStoreFullException', 'javax/microedition/rms/RecordStoreException', [], {});
  N('javax/microedition/rms/InvalidRecordIDException', 'javax/microedition/rms/RecordStoreException', [], {});
  const db = () => host.rms;
  const store = (rs) => { const s = db()[rs.__name]; if (!s || !rs.__open) throw thr('javax/microedition/rms/RecordStoreNotOpenException', rs.__name); return s; };
  const rec = (s, id) => { const r = s.recs[id]; if (r === undefined) throw thr('javax/microedition/rms/InvalidRecordIDException', String(id)); return r; };
  const toB64 = (a, off, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(a[off + i] & 0xff); return btoa(s); };
  const fromB64 = (b) => { const s = atob(b); const a = vm.newArray('[B', s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; };
  N(RS, 'java/lang/Object', [], {
    's openRecordStore(Ljava/lang/String;Z)Ljavax/microedition/rms/RecordStore;': (t, name, create) => {
      if (!db()[name]) {
        if (!create) throw thr('javax/microedition/rms/RecordStoreNotFoundException', name);
        db()[name] = { next: 1, recs: {}, ver: 0 }; host.saveRMS();
      }
      // MIDP: one shared instance per name with an open counter
      host.rmsOpen = host.rmsOpen || {};
      let rs = host.rmsOpen[name];
      if (!rs) { rs = vm.newObjectByName(RS); rs.__name = name; rs.__count = 0; host.rmsOpen[name] = rs; }
      rs.__count++; rs.__open = true;
      return rs;
    },
    's deleteRecordStore(Ljava/lang/String;)V': (t, name) => {
      if (!db()[name]) throw thr('javax/microedition/rms/RecordStoreNotFoundException', name);
      if (host.rmsOpen && host.rmsOpen[name] && host.rmsOpen[name].__open) throw thr('javax/microedition/rms/RecordStoreException', 'store is open');
      delete db()[name]; if (host.rmsOpen) delete host.rmsOpen[name]; host.saveRMS();
    },
    's listRecordStores()[Ljava/lang/String;': () => {
      const k = Object.keys(db()); if (!k.length) return null;
      const a = vm.newArray('[Ljava/lang/String;', k.length); k.forEach((x, i) => { a[i] = x; }); return a;
    },
    'closeRecordStore()V': (t, rs) => { store(rs); if (--rs.__count <= 0) { rs.__count = 0; rs.__open = false; } },
    'getName()Ljava/lang/String;': (t, rs) => rs.__name,
    'addRecord([BII)I': (t, rs, a, off, n) => { const s = store(rs); const id = s.next++; s.recs[id] = a ? toB64(a, off, n) : ''; s.ver++; host.saveRMS(); return id; },
    'setRecord(I[BII)V': (t, rs, id, a, off, n) => { const s = store(rs); rec(s, id); s.recs[id] = a ? toB64(a, off, n) : ''; s.ver++; host.saveRMS(); },
    'deleteRecord(I)V': (t, rs, id) => { const s = store(rs); rec(s, id); delete s.recs[id]; s.ver++; host.saveRMS(); },
    'getRecord(I)[B': (t, rs, id) => { const s = store(rs); const r = rec(s, id); return r === '' ? null : fromB64(r); },
    'getRecord(I[BI)I': (t, rs, id, buf, off) => { const s = store(rs); const a = fromB64(rec(s, id)); for (let i = 0; i < a.length; i++) buf[off + i] = a[i]; return a.length; },
    'getRecordSize(I)I': (t, rs, id) => { const s = store(rs); return atob(rec(s, id)).length; },
    'getNumRecords()I': (t, rs) => Object.keys(store(rs).recs).length,
    'getNextRecordID()I': (t, rs) => store(rs).next,
    'getSize()I': (t, rs) => { const s = store(rs); let n = 0; for (const k in s.recs) n += atob(s.recs[k]).length + 8; return n; },
    'getSizeAvailable()I': () => 1024 * 1024,
    'getVersion()I': (t, rs) => store(rs).ver,
    'getLastModified()J': () => BigInt(Date.now()),
    'enumerateRecords(Ljavax/microedition/rms/RecordFilter;Ljavax/microedition/rms/RecordComparator;Z)Ljavax/microedition/rms/RecordEnumeration;': (t, rs) => {
      const e = vm.newObjectByName('javax/microedition/rms/RecordEnumerationImpl');
      e.__rs = rs; e.__ids = Object.keys(store(rs).recs).map(Number).sort((a, b) => a - b); e.__i = 0; return e;
    },
  });
  I('javax/microedition/rms/RecordEnumeration');
  N('javax/microedition/rms/RecordEnumerationImpl', 'java/lang/Object', ['javax/microedition/rms/RecordEnumeration'], {
    'hasNextElement()Z': (t, e) => (e.__i < e.__ids.length ? 1 : 0),
    'nextRecordId()I': (t, e) => e.__ids[e.__i++],
    'nextRecord()[B': (t, e) => fromB64(store(e.__rs).recs[e.__ids[e.__i++]]),
    'numRecords()I': (t, e) => e.__ids.length,
    'reset()V': (t, e) => { e.__i = 0; },
    'destroy()V': () => {},
  });

  /* =========================================================== media */
  I('javax/microedition/media/Controllable');
  N('javax/microedition/media/Player', null, ['javax/microedition/media/Controllable'], {}, {}, { isInterface: true });
  I('javax/microedition/media/Control');
  N('javax/microedition/media/control/VolumeControl', null, ['javax/microedition/media/Control'], {}, {}, { isInterface: true });
  I('javax/microedition/media/PlayerListener');
  N('javax/microedition/media/MediaException', 'java/lang/Exception', [], {});
  const P = 'javax/microedition/media/PlayerImpl';
  function makePlayer(bytes, type) {
    const p = vm.newObjectByName(P);
    p.__h = host.audio.create(bytes, type || ''); p.__state = 200; p.__loops = 1;
    return p;
  }
  N('javax/microedition/media/Manager', 'java/lang/Object', [], {
    's createPlayer(Ljava/io/InputStream;Ljava/lang/String;)Ljavax/microedition/media/Player;': (t, s, type) => {
      const bytes = [];
      for (;;) { const b = host.readStreamByte(s); if (b < 0) break; bytes.push(b); }
      return makePlayer(Uint8Array.from(bytes), type);
    },
    's createPlayer(Ljava/lang/String;)Ljavax/microedition/media/Player;': (t, loc) => {
      const bytes = host.getResource(loc.replace(/^resource:/, ''));
      if (!bytes) throw thr('javax/microedition/media/MediaException', loc);
      return makePlayer(bytes, '');
    },
    's playTone(III)V': (t, note, dur, vol) => host.audio.tone(note, dur, vol),
    's getSupportedContentTypes(Ljava/lang/String;)[Ljava/lang/String;': () => { const a = vm.newArray('[Ljava/lang/String;', 2); a[0] = 'audio/midi'; a[1] = 'audio/x-tone-seq'; return a; },
  });
  N(P, 'java/lang/Object', ['javax/microedition/media/Player'], {
    'realize()V': (t, p) => { if (p.__state < 300) p.__state = 300; },
    'prefetch()V': (t, p) => { if (p.__state < 400) p.__state = 400; },
    'start()V': (t, p) => { host.audio.start(p.__h, p.__loops); p.__state = 400; p.__playing = true; host.gameSound = true; },
    'stop()V': (t, p) => { host.audio.stop(p.__h); p.__playing = false; },
    'close()V': (t, p) => { host.audio.close(p.__h); p.__state = 0; },
    'deallocate()V': (t, p) => { host.audio.stop(p.__h); },
    'getState()I': (t, p) => (host.audio.isPlaying(p.__h) ? 400 : p.__state === 400 ? 300 : p.__state),
    'setLoopCount(I)V': (t, p, n) => { p.__loops = n; },
    'getMediaTime()J': (t, p) => BigInt(Math.floor(host.audio.time(p.__h) * 1e6)),
    'setMediaTime(J)J': (t, p, us) => { host.audio.seek(p.__h, Number(us) / 1e6); return us; },
    'getDuration()J': (t, p) => BigInt(Math.floor(host.audio.duration(p.__h) * 1e6)),
    'getContentType()Ljava/lang/String;': () => 'audio/midi',
    'addPlayerListener(Ljavax/microedition/media/PlayerListener;)V': () => {},
    'removePlayerListener(Ljavax/microedition/media/PlayerListener;)V': () => {},
    'getControl(Ljava/lang/String;)Ljavax/microedition/media/Control;': (t, p, name) => {
      if (name && name.indexOf('VolumeControl') >= 0) {
        const v = vm.newObjectByName('javax/microedition/media/control/VolumeControlImpl'); v.__p = p; return v;
      }
      return null;
    },
    'getControls()[Ljavax/microedition/media/Control;': () => vm.newArray('[Ljavax/microedition/media/Control;', 0),
  });
  N('javax/microedition/media/control/VolumeControlImpl', 'java/lang/Object', ['javax/microedition/media/control/VolumeControl'], {
    'setLevel(I)I': (t, v, l) => { l = Math.max(0, Math.min(100, l)); host.audio.volume(v.__p.__h, l); host.gameVolume = l; return l; },
    'getLevel()I': (t, v) => host.audio.getVolume(v.__p.__h),
    'setMute(Z)V': (t, v, m) => host.audio.mute(v.__p.__h, !!m),
    'isMuted()Z': () => 0,
  });

  /* =========================================================== io / wma (offline) */
  I('javax/microedition/io/Connection');
  N('javax/microedition/io/ConnectionNotFoundException', 'java/io/IOException', [], {});
  N('javax/microedition/io/Connector', 'java/lang/Object', [], {
    's open(Ljava/lang/String;)Ljavax/microedition/io/Connection;': (t, url) => { host.log('[io] blocked connection ' + url); throw thr('javax/microedition/io/ConnectionNotFoundException', 'offline: ' + url); },
    's open(Ljava/lang/String;I)Ljavax/microedition/io/Connection;': (t, url) => { host.log('[io] blocked connection ' + url); throw thr('javax/microedition/io/ConnectionNotFoundException', 'offline: ' + url); },
    's open(Ljava/lang/String;IZ)Ljavax/microedition/io/Connection;': (t, url) => { host.log('[io] blocked connection ' + url); throw thr('javax/microedition/io/ConnectionNotFoundException', 'offline: ' + url); },
  }, { READ: 1, WRITE: 2, READ_WRITE: 3 });
  I('javax/microedition/io/HttpConnection', 'javax/microedition/io/Connection');
  I('javax/wireless/messaging/MessageListener');
  I('javax/wireless/messaging/Message');
  I('javax/wireless/messaging/TextMessage', 'javax/wireless/messaging/Message');
  I('javax/wireless/messaging/MessageConnection', 'javax/microedition/io/Connection');
}

function normRes(name) { return name.replace(/^\/+/, ''); }

global.MIDP = { installMIDP, normRes };
})(typeof window !== 'undefined' ? window : globalThis);
