/* Host runtime: wires the JVM + MIDP natives to the page (screen, input, storage, audio, iOS bridge). */
'use strict';

(function (global) {
const { VM, STATE } = global.JVM;

const KEY = { UP: -1, DOWN: -2, LEFT: -3, RIGHT: -4, FIRE: -5, LSK: -6, RSK: -7, CLEAR: -8 };

function b64ToBytes(b64) {
  const s = atob(b64); const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

function parseManifest(text) {
  const props = {}; let last = null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith(' ') && last) { props[last] += raw.substring(1); continue; }
    const i = raw.indexOf(':'); if (i <= 0) continue;
    last = raw.substring(0, i).trim(); props[last] = raw.substring(i + 1).trim();
  }
  return props;
}

class Host {
  constructor(opts) {
    this.opts = opts;
    this.W = opts.width || 240; this.H = opts.height || 320;
    this.files = {}; this.images = {}; this.imagesBySize = new Map();
    this.queue = []; this.repaintPending = false; this.current = null; this.midlet = null;
    this.keyStates = 0; this.logLines = [];
    this.audio = opts.audio || new global.MidiSynth.Synth();
    this.rms = {};
    this.exited = false;
    this.bridge = (global.webkit && global.webkit.messageHandlers) ? global.webkit.messageHandlers : null;
  }

  log(...a) {
    const line = a.join(' ');
    this.logLines.push(line); if (this.logLines.length > 400) this.logLines.shift();
    if (this.opts.debug) console.log(line);
  }

  /* ---------------- resources ---------------- */
  async load(fileMap) {
    for (const k in fileMap) this.files[k] = typeof fileMap[k] === 'string' ? b64ToBytes(fileMap[k]) : fileMap[k];
    const mf = this.files['META-INF/MANIFEST.MF'];
    this.appProps = mf ? parseManifest(new TextDecoder().decode(mf)) : {};
    const jobs = [];
    for (const name in this.files) {
      if (!/\.png$/i.test(name)) continue;
      jobs.push(this.decodePNG(name, this.files[name]).catch(e => this.log('[host] png decode failed ' + name + ' ' + e)));
    }
    await Promise.all(jobs);
  }

  async decodePNG(name, bytes) {
    const blob = new Blob([bytes], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    let src;
    try {
      src = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im); im.onerror = () => rej(new Error('decode'));
        im.src = url;
      });
    } catch (e) {
      if (!global.createImageBitmap) throw e;
      src = await createImageBitmap(blob);
    } finally { URL.revokeObjectURL(url); }
    const w = src.width, h = src.height;
    const c = this.makeCanvas(w, h); c.getContext('2d').drawImage(src, 0, 0);
    const rec = { canvas: c, w, h, bytes, alpha: null, name };
    this.images[name] = rec;
    const k = bytes.length;
    if (!this.imagesBySize.has(k)) this.imagesBySize.set(k, []);
    this.imagesBySize.get(k).push(rec);
  }

  imageByBytes(bytes) {
    const list = this.imagesBySize.get(bytes.length); if (!list) return null;
    outer: for (const r of list) { for (let i = 0; i < bytes.length; i++) if ((r.bytes[i] & 0xff) !== (bytes[i] & 0xff)) continue outer; return r; }
    return null;
  }

  alphaMask(img) {
    const rec = img.__rec || (img.__rec = { canvas: img.__c, w: img.__w, h: img.__h });
    if (rec.alpha && !img.__mutable) return rec.alpha;
    const d = img.__c.getContext('2d').getImageData(0, 0, img.__w, img.__h).data;
    const a = new Uint8Array(img.__w * img.__h);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    rec.alpha = a; return a;
  }

  makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined' && this.opts.offscreen) return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c;
  }

  getResource(name) {
    const n = global.MIDP.normRes(name);
    // a mission map is being loaded: the AI path grids (n.b / n.c) are allocated lazily with the size of
    // the map that was loaded first and never resized, so a wider or taller map later on crashed the
    // mission start (ArrayIndexOutOfBounds). Drop them here; the game re-creates them for the new map.
    // n.b has no size checks anywhere (loops use the map size), but n.c(II) uses it without allocating it first:
    // give it a fresh grid big enough for any map (100 cells). n.c is checked against its own length,
    // so it must have the exact size: it is re-created lazily for the new map.
    if (/^\d{3}\.map$/.test(n)) { const vm = this.vm, nc = vm && vm.classes.get('n'); if (nc) { nc.statics['b:[[I'] = vm.newMultiArray('[[I', [100, 100], 0); nc.statics['c:[[I'] = null; } }
    if (n === 'lang.cfg' && this.opts.language) return Host.encodeLangCfg(this.opts.language);
    if (this.opts.language === 'rus' && /\.map$/.test(n) && global.MAP_I18N && global.MAP_I18N[n]) {
      this.__mapCache = this.__mapCache || {};
      if (!this.__mapCache[n]) this.__mapCache[n] = Host.patchMap(this.files[n], global.MAP_I18N[n]);
      return this.__mapCache[n];
    }
    return this.files[n] || null;
  }

  /** Replace length-prefixed UTF-16BE strings inside a level file (mission briefings) with translations. */
  static patchMap(bytes, items) {
    const out = []; let pos = 0;
    const list = items.filter(it => it.ru).sort((a, b) => a.off - b.off);
    for (const it of list) {
      const plen = it.kind === 'u16' ? 2 : 1;
      const oldLen = it.en.length * 2;
      for (let i = pos; i < it.off - plen; i++) out.push(bytes[i]);
      const L = it.ru.length * 2;
      if (it.kind === 'u16') out.push((L >> 8) & 255, L & 255);
      else { if (L > 255) return bytes; out.push(L); }
      for (let i = 0; i < it.ru.length; i++) { const c = it.ru.charCodeAt(i); out.push(c >> 8, c & 255); }
      pos = it.off + oldLen;
    }
    for (let i = pos; i < bytes.length; i++) out.push(bytes[i]);
    return Uint8Array.from(out);
  }

  /** lang.cfg is "<lang>;0;0;0;" with byte[i] = char + 66 + i. The game has built-in Russian ("rus"). */
  static encodeLangCfg(lang) {
    const s = lang + ';0;0;0;';
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = (s.charCodeAt(i) + 66 + i) & 0xff;
    return b;
  }

  readStreamByte(s) {
    if (s.__buf) return s.__pos < s.__count ? s.__buf[s.__pos++] & 0xff : -1;
    if (s.__in) return this.readStreamByte(s.__in);
    return -1;
  }

  /* ---------------- storage (RMS) ---------------- */
  loadRMS() {
    let data = null;
    try { if (global.__NATIVE_RMS__) data = JSON.parse(global.__NATIVE_RMS__); } catch (e) {}
    if (!data) { try { data = JSON.parse(localStorage.getItem(this.storageKey()) || 'null'); } catch (e) {} }
    this.rms = data || {};
  }
  storageKey() { return 'j2me-rms:' + (this.appProps['MIDlet-Name'] || 'app'); }
  saveRMS() {
    clearTimeout(this.__saveT);
    this.__saveT = setTimeout(() => this.flushRMS(), 150);
  }
  flushRMS() {
    clearTimeout(this.__saveT);
    const json = JSON.stringify(this.rms);
    try { localStorage.setItem(this.storageKey(), json); } catch (e) {}
    if (this.bridge && this.bridge.rms) this.bridge.rms.postMessage(json);
  }

  /* ---------------- display ---------------- */
  setupScreen(lcd) {
    this.setQuality(this.opts.quality || 10);   // sets hq/fx before the screen exists
    this.lcd = lcd;
    const k = this.hq ? 2 : 1; lcd.width = this.W * k; lcd.height = this.H * k;
    this.lcdCtx = lcd.getContext('2d'); this.lcdCtx.imageSmoothingEnabled = false;
    this.gl2x = this.opts.gpuScale2x === false ? null : this.makeGL2x();
    this.back = this.makeCanvas(this.W, this.H);
    // CPU-readable until the GPU upscaler wins the benchmark (see presentScale2x)
    this.backCtx = this.back.getContext('2d', { willReadFrequently: true });
    this.backCtx.fillStyle = '#000'; this.backCtx.fillRect(0, 0, this.W, this.H);
    this.measureCtx = this.makeCanvas(4, 4).getContext('2d');
  }
  /** Change the logical screen size at runtime (MIDP sizeChanged). */
  resize(w, h) {
    if (w === this.W && h === this.H) return;
    this.W = w; this.H = h;
    const old = this.back;
    const k = this.hq ? 2 : 1;
    this.lcd.width = w * k; this.lcd.height = h * k; this.lcdCtx.imageSmoothingEnabled = false;
    this.back = this.makeCanvas(w, h); this.backCtx = this.back.getContext('2d', { willReadFrequently: !this.__gpuBack });
    this.backCtx.fillStyle = '#000'; this.backCtx.fillRect(0, 0, w, h);
    this.backCtx.drawImage(old, 0, 0);
    this.screenG = null;
    if (this.current && this.isCanvas(this.current)) this.postEvent({ type: 'call', obj: this.current, nameDesc: 'sizeChanged(II)V', args: [w, h] });
    this.repaintPending = true;
  }
  screenGraphics() {
    if (!this.screenG) this.screenG = this.makeGraphics(this.backCtx, this.W, this.H, null);
    return this.screenG;
  }
  present() {
    if (this.hq) this.presentScale2x(); else this.lcdCtx.drawImage(this.back, 0, 0);
    this.frames = (this.frames || 0) + 1;
    // the game lowers its graphics level whenever FPS < F (17), e.g. while a level is loading,
    // and then switches off tank tracks, lighting and clouds: disable the "lower" threshold
    this.inGameNow = this.inGame;
    if (this.opts.unlockAll && (this.frames % 15) === 0) this.unlockResearch();
    this.hideExchange();
    this.capStock();
    this.applyQuality();
    this.drawGlows(this.menuInfo && this.menuInfo.glows);
    // the joystick is 4-way "screen" control: keep the game's control mode on "screen" (m.l = 1)
    if (this.opts.screenControls !== false) { const m = this.vm.classes.get('m'); if (m && m.statics['l:Z'] === 0) m.statics['l:Z'] = 1; }
    // first screen ("sound on/off?"): answer "on" automatically
    if (!this.__autoSound && this.frames > 3 && this.menuInfo && !this.menuInfo.hl && this.opts.autoSound !== false) {
      this.__autoSound = true;
      setTimeout(() => { if (!this.gameSound) { this.key('press', -7); this.key('release', -7); } }, 300);
    }
    if (this.presentWaiters && this.presentWaiters.length) { const w = this.presentWaiters; this.presentWaiters = []; w.forEach(f => f()); }
  }

  isCanvas(d) { return d && this.vm.isInstance(d, 'javax/microedition/lcdui/Canvas'); }

  setCurrent(d) {
    if (d === null || d === this.current) { if (d) this.repaintPending = true; return; }
    if (!this.isCanvas(d)) { this.log('[host] setCurrent non-canvas ' + this.vm.classOf(d).name + ' (ignored)'); return; }
    const old = this.current;
    if (old && this.isCanvas(old)) this.postEvent({ type: 'call', obj: old, nameDesc: 'hideNotify()V' });
    this.current = d;
    this.postEvent({ type: 'call', obj: d, nameDesc: 'showNotify()V' });
    this.repaintPending = true;
  }

  startPaint(t) {
    const g = this.screenGraphics();
    this.resetGraphics(g);
    this.painting = true;
    this.frameInfo = { rows: {}, hl: null, imgs: {}, glows: null };
    this.vm.callVirtual(t, this.current, 'paint(Ljavax/microedition/lcdui/Graphics;)V', [g], () => {
      this.painting = false;
      this.menuInfo = this.frameInfo; this.frameInfo = null;
      this.present();
    });
  }

  /**
   * Graphics quality 1..10: 1-7 = the game's own graphics levels, 8 = + Scale2x smoothing,
   * 9 = + glow around shots/explosions and screen shake, 10 = + soft tank shadows.
   */
  setQuality(q) {
    this.quality = Math.max(1, Math.min(10, q | 0));
    this.fx = { glow: this.quality >= 9, shadows: this.quality >= 10, shake: this.quality >= 9 };
    const hq = this.quality >= 8;
    if (this.lcd && hq !== this.hq) {
      this.hq = hq; const k = hq ? 2 : 1;
      this.lcd.width = this.W * k; this.lcd.height = this.H * k; this.lcdCtx.imageSmoothingEnabled = false;
    } else this.hq = hq;
  }
  applyQuality() {
    if (!this.fpsObj || this.quality === undefined) return;
    const lvl = Math.min(7, this.quality);
    // the game changes its level by FPS: switch that off in both directions
    this.fpsObj['c.F:I'] = 0;
    this.fpsObj['c.E:I'] = 100000;
    // only outside a mission: level objects (clouds, lighting) are created when a mission loads
    if (!this.inGame) { const m = this.vm.classes.get('m'); if (m) m.statics['a:I'] = lvl; }
  }
  drawGlows(glows) {
    if (!glows || !glows.length || !this.fx || !this.fx.glow) return;
    const c = this.lcdCtx, k = this.hq ? 2 : 1, t = performance.now() / 1000;
    const RING = ['255,230,60', '255,50,40', '60,120,255', '60,170,255', '60,255,80'];
    c.save(); c.globalCompositeOperation = 'lighter';
    for (const [x, y, kind, w, fr] of glows) {
      let r, col, a;
      switch (kind) {
        case 1: r = 13; col = '255,200,100'; a = 0.75 * (0.85 + Math.random() * 0.3); break;       // shot, flickers
        case 3: r = 26; col = '90,170,255'; a = 0.9 * (0.8 + Math.random() * 0.4); break;          // plasma hit
        case 6: {                                                                                   // plasma bolt in flight
          const fl = 0.85 + Math.random() * 0.3;
          this.glowBlob(c, x * k, y * k, 30 * k, '40,110,255', 0.95 * fl);    // wide blue halo
          r = 11; col = '160,210,255'; a = 1.0 * fl; break;                    // hot white-blue core
        }
        case 7: r = 14; col = '255,60,50'; a = 0.7 * (0.85 + Math.random() * 0.3); break;          // enemy laser
        case 2: r = Math.max(20, w * 1.25); col = '255,150,50'; a = 0.65 * (0.85 + Math.random() * 0.3); break; // explosion
        case 4: {                                                                                   // tank rings: pulse
          r = w * 0.95; col = RING[fr] || RING[0];
          a = 0.28 + 0.16 * Math.sin(t * 4.2 + x * 0.05 + y * 0.03); break;
        }
        case 5: r = w * 0.9; col = '255,240,170'; a = 0.22 + 0.14 * Math.sin(t * 3 + x * 0.1); break; // pick-ups shimmer
        default: continue;
      }
      this.glowBlob(c, x * k, y * k, r * k, col, a);
    }
    c.restore();
  }
  glowBlob(c, x, y, r, col, a) {
    if (a > 1) a = 1;
    const gr = c.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(' + col + ',' + a.toFixed(3) + ')');
    gr.addColorStop(0.45, 'rgba(' + col + ',' + (a * 0.45).toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(' + col + ',0)');
    c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /**
   * "All weapons unlocked": raise every research (m.c / m.d, index 1..9) to its maximum so the
   * workshop sells everything for coins. Max levels: shells 8, artillery 5, rockets 2, mines 2,
   * dynamite 3, armour 3, force field 4, air strike 3, allied tanks 3.
   */
  unlockResearch() {
    const m = this.vm.classes.get('m'); if (!m) return;
    const MAX = [0, 8, 5, 2, 2, 3, 3, 4, 3, 3];
    for (const key of ['c:[C', 'd:[C']) {
      const a = m.statics[key];
      if (!a || a.length < MAX.length) continue;
      for (let i = 1; i < MAX.length; i++) if (a[i] < MAX[i]) a[i] = MAX[i];
    }
  }

  /**
   * Workshop: the "Exchange office" section (coins/stars for SMS) is not drawn any more (patched
   * in the .jar). Its items 0..3 are blanked here so the game's UP/DOWN skips them, and the
   * selection starts on the first real item (5, "Round"; 4 is the separator line).
   */
  hideExchange() {
    const m = this.vm.classes.get('m'); if (!m) return;
    const p = m.statics['a:Lp;']; if (!p) return;
    for (const k of ['p.a:[Ljava/lang/String;', 'p.c:[Ljava/lang/String;', 'p.d:[Ljava/lang/String;']) {
      const a = p[k];
      if (a && a.length > 5 && a[0] !== '') for (let i = 0; i < 4; i++) a[i] = '';
    }
    // move off the hidden rows with a real DOWN press, so the selection bar slides in as usual
    if (p['p.a:I'] === 1 && p['p.e:I'] >= 0 && p['p.e:I'] < 5 && !this.__exDown) {
      p['p.e:I'] = 4; this.__exDown = true;
      this.key('press', -2); this.key('release', -2);
      setTimeout(() => { this.__exDown = false; }, 150);
    }
  }

  /**
   * Workshop stock: every kind of ammunition holds at most 99 (shells and plasma are limited in the patched
   * .jar; the explosives have no limit in the original). Anything over 99 is taken back and paid back.
   * Stock m.a[k]: 1..6 shells, 7..15 explosives (workshop rows k + 5, prices p.b[row]); money m.l.
   */
  capStock() {
    const m = this.vm.classes.get('m'); if (!m) return;
    const a = m.statics['a:[C'], p = m.statics['a:Lp;'];
    if (!a || a.length < 16) return;
    const price = p && p['p.b:[I'];
    for (let k = 1; k <= 15; k++) {
      if (a[k] <= 99) continue;
      if (k >= 7 && price && price[k + 5] > 0 && typeof m.statics['l:I'] === 'number') m.statics['l:I'] += (a[k] - 99) * price[k + 5];
      a[k] = 99;
    }
  }

  /** Workshop from anywhere in a mission: open the pause menu and pick "Workshop". */
  async openWorkshop() {
    if (this.menuBusy || !this.inGame) return;
    this.key('press', -6); this.key('release', -6);
    for (let i = 0; i < 10 && (this.inGame || !this.menuInfo || !this.menuInfo.hl); i++) await this.waitPresent(120);
    const info = this.menuInfo;
    if (!info || !info.hl) return;
    const rows = Object.keys(info.rows).map(Number).sort((a, b) => a - b);
    if (rows.length > 1) await this.menuTap(120, rows[1] + 6);
  }

  /**
   * Scale2x on the GPU (WebGL2 fragment shader): the same EPX rule as presentScale2x below,
   * pixel for pixel, without reading the frame back to the CPU every frame.
   */
  makeGL2x() {
    try {
      const cv = document.createElement('canvas');
      const gl = cv.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
      if (!gl) return null;
      const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
        in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float; precision highp int;
        uniform highp sampler2D t; uniform ivec2 sz; out vec4 o;
        vec4 px(int x, int y) { return texelFetch(t, ivec2(clamp(x, 0, sz.x - 1), clamp(y, 0, sz.y - 1)), 0); }
        void main() {
          ivec2 q = ivec2(gl_FragCoord.xy); q.y = sz.y * 2 - 1 - q.y;
          int x = q.x >> 1, y = q.y >> 1, sx = q.x & 1, sy = q.y & 1;
          vec4 P = px(x, y), A = px(x, y - 1), D = px(x, y + 1), C = px(x - 1, y), B = px(x + 1, y);
          vec4 e = P;
          if (A != D && C != B) {
            if (sx == 0 && sy == 0) { if (C == A) e = A; }
            else if (sx == 1 && sy == 0) { if (A == B) e = B; }
            else if (sx == 0 && sy == 1) { if (D == C) e = C; }
            else { if (B == D) e = D; }
          }
          o = vec4(e.rgb, 1.0);
        }`));
      gl.bindAttribLocation(prog, 0, 'p');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      return { cv, gl, uSz: gl.getUniformLocation(prog, 'sz') };
    } catch (e) { this.log('[host] GPU Scale2x unavailable: ' + e.message); return null; }
  }
  presentGL2x() {
    const g = this.gl2x, gl = g.gl, W = this.W, H = this.H;
    if (gl.isContextLost()) { this.gl2x = null; return false; }
    if (g.cv.width !== W * 2 || g.cv.height !== H * 2) { g.cv.width = W * 2; g.cv.height = H * 2; }
    gl.viewport(0, 0, W * 2, H * 2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.back);
    gl.uniform2i(g.uSz, W, H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.lcdCtx.drawImage(g.cv, 0, 0);
    return true;
  }

  /** Scale2x (EPX) upscaling: smooth diagonals and curves while keeping the pixel art sharp. */
  presentScale2x() {
    if (this.gl2x) {
      // pick the faster upscaler on this device: time both on alternate in-game frames
      if (!this.__s2pick) {
        if (!this.inGameNow) { this.presentScale2xCPU(); return; }
        const b = this.__s2b || (this.__s2b = { gl: [], cpu: [] });
        const useGl = b.gl.length <= b.cpu.length;
        const t = performance.now();
        if (useGl) { if (!this.presentGL2x()) { this.__s2pick = 'cpu'; this.presentScale2xCPU(); return; } }
        else this.presentScale2xCPU();
        (useGl ? b.gl : b.cpu).push(performance.now() - t);
        if (b.cpu.length >= 40) {
          const med = (a) => a.slice(5).sort((x, y) => x - y)[(a.length - 5) >> 1];
          const g = med(b.gl), c = med(b.cpu);
          this.__s2pick = g < c * 0.8 ? 'gl' : 'cpu';
          this.log('[host] Scale2x: GPU ' + g.toFixed(2) + ' ms, CPU ' + c.toFixed(2) + ' ms -> ' + this.__s2pick);
          if (this.__s2pick === 'cpu') this.gl2x = null;
          else this.useGpuBack();
        }
        return;
      }
      if (this.presentGL2x()) return;
    }
    this.presentScale2xCPU();
  }
  /** The back buffer is now only read by the GPU: recreate it without CPU read-back. */
  useGpuBack() {
    this.__gpuBack = true;
    const old = this.back;
    this.back = this.makeCanvas(this.W, this.H);
    this.backCtx = this.back.getContext('2d', { willReadFrequently: false });
    this.backCtx.drawImage(old, 0, 0);
    // keep the same Graphics object (the game may hold it): move it onto the new context
    const g = this.screenG;
    if (g) { while (g.__saved > 0) { g.__ctx.restore(); g.__saved--; } g.__ctx = this.backCtx; this.resetGraphics(g); }
  }
  presentScale2xCPU() {
    const W = this.W, H = this.H;
    const src = this.backCtx.getImageData(0, 0, W, H);
    const s = new Uint32Array(src.data.buffer);
    if (!this.__s2 || this.__s2.width !== W * 2 || this.__s2.height !== H * 2) this.__s2 = this.lcdCtx.createImageData(W * 2, H * 2);
    const d = new Uint32Array(this.__s2.data.buffer);
    const W2 = W * 2;
    for (let y = 0; y < H; y++) {
      const row = y * W, up = (y > 0 ? y - 1 : y) * W, dn = (y < H - 1 ? y + 1 : y) * W;
      const o = y * 2 * W2;
      for (let x = 0; x < W; x++) {
        const P = s[row + x];
        const A = s[up + x], D = s[dn + x];
        const C = s[row + (x > 0 ? x - 1 : x)], B = s[row + (x < W - 1 ? x + 1 : x)];
        let e0 = P, e1 = P, e2 = P, e3 = P;
        if (A !== D && C !== B) {
          if (C === A) e0 = A;
          if (A === B) e1 = B;
          if (D === C) e2 = C;
          if (B === D) e3 = D;
        }
        const i = o + x * 2;
        d[i] = e0; d[i + 1] = e1; d[i + W2] = e2; d[i + W2 + 1] = e3;
      }
    }
    this.lcdCtx.putImageData(this.__s2, 0, 0);
  }

  /** True while the game world (LayerManager) is being drawn, i.e. during a mission. */
  get inGame() { return performance.now() - (this.lastWorldPaint || 0) < 700; }

  waitPresent(ms) {
    return new Promise((res) => { const t = setTimeout(res, ms || 250); (this.presentWaiters || (this.presentWaiters = [])).push(() => { clearTimeout(t); res(); }); });
  }

  async tapKey(code) {
    this.key('press', code);
    await new Promise(r => setTimeout(r, 35));
    this.key('release', code);
    // wait until the selection bar stops its slide animation
    let last = null, same = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 350) {
      await this.waitPresent(80);
      const i = this.menuInfo, y = i && i.hl ? i.hl.y : null;
      if (y === last) { if (++same >= 2) break; } else { same = 0; last = y; }
    }
  }

  /**
   * Touch support for the game's key-only menus: find the tapped text line, move the selection
   * bar there with UP/DOWN (following the line if the list scrolls) and press OK.
   * The selected line is drawn with a different glyph set, so a line is recognised by its
   * glyph pattern only while it is NOT selected: once it disappears from the unselected lines,
   * it is the selected one.
   */
  async menuTap(x, y, opts) {
    const fire = !opts || opts.fire !== false;
    const info = this.menuInfo;
    if (!info || !info.hl) return false;
    const sig = (row) => row.slice().sort((a, b) => a[0] - b[0]).map(e => e[1] + '@' + e[0]).join(',');
    const rowsOf = (inf) => Object.keys(inf.rows).map(Number).sort((p, q) => p - q);
    const selRow = (inf) => { let best = null, bd = 1e9; for (const ry of rowsOf(inf)) { const d = Math.abs(ry - (inf.hl.y + 3)); if (d < bd) { bd = d; best = ry; } } return bd <= 8 ? best : null; };
    let target = null, bd = 1e9;
    for (const ry of rowsOf(info)) { const d = Math.abs(ry + 6 - y); if (d < bd) { bd = d; target = ry; } }
    if (target === null || bd > 9) return false;
    if (this.menuBusy) return true;
    this.menuBusy = true;
    try {
      if (target === selRow(info)) {
        if (fire) await this.tapKey(-5);
        else if (opts && opts.onSelected) await opts.onSelected();
        return true;
      }
      // fast path: send all the UP/DOWN presses at once (menu lines are mostly selectable),
      // the slow loop below then only corrects the rest
      const rs = rowsOf(info), si = rs.indexOf(selRow(info)), ti = rs.indexOf(target);
      if (si >= 0 && ti >= 0) {
        const n = Math.abs(ti - si), code = ti > si ? -2 : -1;
        for (let k = 0; k < n; k++) { this.key('press', code); this.key('release', code); }
        await this.waitPresent(120);
        await this.waitPresent(120);
      }
      const want = sig(info.rows[target]).replace(/@\d+/g, '');   // glyphs only (x may shift when scrolling)
      let flips = 0, lastDir = 0, stuck = 0;
      for (let i = 0; i < 60; i++) {
        const inf = this.menuInfo; if (!inf || !inf.hl) break;
        const sel = selRow(inf);
        let ty = null;
        for (const ry of rowsOf(inf)) if (ry !== sel && sig(inf.rows[ry]).replace(/@\d+/g, '') === want) { ty = ry; break; }
        if (this.opts.debug) this.log('[menuTap] hl=' + inf.hl.y + ' sel=' + sel + ' targetNow=' + ty);
        if (ty === null) { if (fire) await this.tapKey(-5); break; }      // the wanted line is the selected one
        const dir = ty > inf.hl.y ? -2 : -1;
        if (lastDir && dir !== lastDir && ++flips > 2) break;   // line is not selectable
        lastDir = dir;
        const before = inf.hl.y;
        await this.tapKey(dir);
        const a = this.menuInfo;
        const snap = (q) => rowsOf(q).map(ry => ry + ':' + sig(q.rows[ry])).join('|');
        if (a && a.hl && a.hl.y === before && snap(a) === snap(inf)) { if (++stuck >= 2) break; } else stuck = 0;
      }
    } finally { this.menuBusy = false; }
    return true;
  }

  /** 'game' during a mission, 'shop' in the workshop, otherwise 'menu'. */
  get screenKind() {
    if (this.inGame) return 'game';
    const i = this.menuInfo;
    // workshop list: section icons, no big tank picture (that one is on menus / item descriptions)
    if (i && i.imgs && i.imgs['icons.png'] && !i.imgs['menu_pict.png'] && i.hl) return 'shop';
    return 'menu';
  }

  /** Workshop: buy one; if nothing changed (item not researched yet / no coins), show the item's
   *  description, where the game explains why. */
  async buyOnce(inside) {
    if (this.menuBusy && !inside) return;
    const own = !this.menuBusy;
    this.menuBusy = true;
    try {
      const snap = () => { const i = this.menuInfo; return i ? Object.keys(i.rows).map(y => y + ':' + i.rows[y].map(e => e[1]).join('.')).join('|') : ''; };
      const before = snap();
      await this.tapKey(-4);
      if (snap() === before) await this.tapKey(-5);
    } finally { if (own) this.menuBusy = false; }
  }

  /** Workshop: press "buy" (RIGHT) until nothing changes any more (stock full or out of coins). */
  async buyMax() {
    if (this.menuBusy) return;
    this.menuBusy = true;
    try {
      const snap = () => { const i = this.menuInfo; return i ? Object.keys(i.rows).map(y => y + ':' + i.rows[y].map(e => e[1]).join('.')).join('|') : ''; };
      const m = this.vm.classes.get('m'), P = m && m.statics['a:Lp;'];
      for (let n = 0; n < 12; n++) {
        const before = snap();
        await this.tapKey(-4);
        if (snap() === before) break;
        // explosives come one at a time: after one real purchase (research and money checked by the game)
        // buy the rest up to 99 at once, at the same price
        const e = P && P['p.e:I'], a = m.statics['a:[C'], price = P && P['p.b:[I'];
        if (e >= 12 && e <= 20 && a && price && price[e] > 0 && typeof m.statics['l:I'] === 'number') {
          const k = e - 5, cnt = Math.max(0, Math.min(99 - a[k], Math.floor(m.statics['l:I'] / price[e])));
          a[k] += cnt; m.statics['l:I'] -= cnt * price[e];
          break;
        }
      }
    } finally { this.menuBusy = false; }
  }

  /* ---------------- sound effects (the original game only has music) ---------------- */
  get sfxOn() { return this.opts.sfx !== false && this.gameSound && (this.gameVolume === undefined || this.gameVolume > 0); }
  onSpriteCreated(name) {
    if (!this.sfxOn || this.paused) return;
    const now = performance.now(); this.__sfxT = this.__sfxT || {};
    const kind = name === 'bullets.png' ? 'shot'
      : name === 'expl_small.png' ? 'boom'
      : /^expl_big/.test(name) ? 'bigboom'
      : name === 'expl_plasma.png' ? 'plasma' : null;
    if (!kind) return;
    if (now - (this.__sfxT[kind] || 0) < (kind === 'shot' ? 70 : 90)) return;
    this.__sfxT[kind] = now;
    const vol = (this.gameVolume === undefined ? 100 : this.gameVolume) / 100;
    this.audio.sfx(kind, vol);
    if (kind === 'bigboom' && this.opts.haptic !== false && this.bridge && this.bridge.haptic) this.bridge.haptic.postMessage(-3);
    if ((kind === 'bigboom' || kind === 'boom') && this.fx && this.fx.shake && this.lcd) {
      const amp = kind === 'bigboom' ? 3 : 1.2;
      const el = this.lcd; let n = 0;
      const step = () => { n++; if (n > 6) { el.style.transform = ''; return; }
        el.style.transform = 'translate(' + ((Math.random() - 0.5) * amp * 2).toFixed(1) + 'px,' + ((Math.random() - 0.5) * amp * 2).toFixed(1) + 'px)'; setTimeout(step, 30); };
      step();
    }
  }
  setEngine(on) {
    const want = !!on && this.sfxOn && !this.paused && this.inGame;
    if (want === this.__engine) return;
    this.__engine = want;
    this.audio.engine(want, (this.gameVolume === undefined ? 100 : this.gameVolume) / 100);
  }

  serviceRepaints(t) {
    if (!this.repaintPending || !this.isCanvas(this.current) || this.painting) return;
    this.repaintPending = false;
    this.startPaint(t);
  }

  /* ---------------- events ---------------- */
  postEvent(e) { this.queue.push(e); if (this.kick) this.kick(); }

  pump() {
    const et = this.eventThread;
    if (et.frame || this.exited) return;
    if (this.queue.length) {
      const e = this.queue.shift();
      const cur = this.current;
      switch (e.type) {
        case 'key':
          if (!cur) return;
          this.vm.callVirtual(et, cur, e.kind === 'press' ? 'keyPressed(I)V' : e.kind === 'release' ? 'keyReleased(I)V' : 'keyRepeated(I)V', [e.code]);
          break;
        case 'pointer':
          if (!cur) return;
          this.vm.callVirtual(et, cur, e.kind === 'press' ? 'pointerPressed(II)V' : e.kind === 'release' ? 'pointerReleased(II)V' : 'pointerDragged(II)V', [e.x, e.y]);
          break;
        case 'call':
          this.vm.callVirtual(et, e.obj, e.nameDesc, e.args || []);
          break;
      }
      return;
    }
    if (this.repaintPending && this.isCanvas(this.current) && !this.painting) {
      this.repaintPending = false;
      this.startPaint(et);
    }
  }

  key(kind, code) {
    if (kind === 'press') this.keyStates |= this.stateBit(code);
    else if (kind === 'release') this.keyStates &= ~this.stateBit(code);
    this.postEvent({ type: 'key', kind, code });
  }
  pointer(kind, x, y) {
    // coalesce drags
    if (kind === 'drag') { const last = this.queue[this.queue.length - 1]; if (last && last.type === 'pointer' && last.kind === 'drag') { last.x = x; last.y = y; return; } }
    this.postEvent({ type: 'pointer', kind, x, y });
  }
  stateBit(code) { const a = this.gameAction(code); return a ? (1 << a) : 0; }

  gameAction(k) {
    switch (k) {
      case KEY.UP: case 50: return 1;
      case KEY.DOWN: case 56: return 6;
      case KEY.LEFT: case 52: return 2;
      case KEY.RIGHT: case 54: return 5;
      case KEY.FIRE: case 53: return 8;
      case 55: return 9; case 57: return 10; case 42: return 11; case 35: return 12;
      default: return 0;
    }
  }
  keyCodeForAction(a) { return ({ 1: KEY.UP, 6: KEY.DOWN, 2: KEY.LEFT, 5: KEY.RIGHT, 8: KEY.FIRE, 9: 55, 10: 57, 11: 42, 12: 35 })[a] || 0; }
  keyName(k) {
    const names = { [-1]: 'Up', [-2]: 'Down', [-3]: 'Left', [-4]: 'Right', [-5]: 'Select', [-6]: 'Left Soft', [-7]: 'Right Soft', [-8]: 'Clear', 42: '*', 35: '#' };
    if (k >= 48 && k <= 57) return String.fromCharCode(k);
    return names[k] || ('Key ' + k);
  }

  vibrate(ms) {
    if (ms <= 0) return;
    if (this.bridge && this.bridge.haptic) this.bridge.haptic.postMessage(ms);
    else if (navigator.vibrate) navigator.vibrate(ms);
  }

  onExit() {
    this.log('[host] notifyDestroyed');
    this.exited = true;
    this.audio.stopAll();
    if (this.opts.onExit) this.opts.onExit();
  }

  /* ---------------- boot ---------------- */
  boot() {
    const vm = this.vm = new VM(this.files, { log: (...a) => this.log(...a), debug: this.opts.debug, onSlice: () => this.pump() });
    this.loadRMS();
    const env = {
      log: (...a) => this.log(...a),
      getResource: (n) => {
        const b = this.getResource(n);
        return b ? vm.bytesToJava(b) : null;
      },
      properties: Object.assign({
        'microedition.platform': 'Nokia6300/07.21',
        'microedition.configuration': 'CLDC-1.1',
        'microedition.profiles': 'MIDP-2.0',
        'microedition.locale': 'en-US',
        'microedition.encoding': 'UTF-8',
        'microedition.media.version': '1.1',
        'supports.mixing': 'false',
        'device.model': '6300',
      }, this.opts.properties || {}),
      hiddenClasses: new Set(['javax/bluetooth/LocalDevice']),
      postEvent: (e) => this.postEvent(e),
      exit: () => this.onExit(),
    };
    global.CLDC.installCLDC(vm, env);
    // remember the game's main loop object (class c): it holds the FPS thresholds
    try { const cc = vm.loadClass('c'); if (cc.fields.some(f => f.name === 'F' && f.desc === 'I')) cc.watch = (o) => { this.fpsObj = o; }; } catch (e) {}
    global.MIDP.installMIDP(vm, this);

    this.eventThread = vm.newThread('event');
    this.eventThread.isEventThread = true;
    this.eventThread.state = STATE.IDLE;

    const mainName = (this.appProps['MIDlet-1'] || '').split(',').map(s => s.trim())[2];
    if (!mainName) throw new Error('No MIDlet-1 in manifest');
    const mt = vm.newThread('main');
    const mc = vm.loadClass(mainName.replace(/\./g, '/'));
    const midlet = vm.newObject(mc);
    this.midlet = midlet;
    vm.pushCall(mt, vm.findMethod(mc, '<init>()V'), midlet, [], () => {
      vm.callVirtual(mt, midlet, 'startApp()V', []);
    });
    vm.initClass(mt, mc);
    this.running = true;
    // Timer-driven scheduler: sleeping Java threads wake exactly on time (not on display frames),
    // so the game reaches its intended 25 fps and its auto graphics level stays high.
    const chan = new MessageChannel();
    let pending = false, timer = 0;
    const kick = () => { if (!pending) { pending = true; chan.port2.postMessage(0); } };
    this.kick = kick;
    chan.port1.onmessage = () => {
      pending = false; clearTimeout(timer);
      if (!this.running) return;
      if (this.paused) { timer = setTimeout(kick, 100); return; }
      vm.schedule(this.opts.sliceMs || 10);
      const wake = vm.nextWake();
      const now = performance.now();
      if (wake <= now || this.queue.length || (this.repaintPending && !this.eventThread.frame)) kick();
      else timer = setTimeout(kick, Math.min(50, Math.max(0, wake - now - 0.5)));
    };
    kick();
  }

  pause() {
    if (this.paused || !this.current) return;
    this.setEngine(false);
    this.paused = true;
    this.audio.suspend();
    this.postEvent({ type: 'call', obj: this.current, nameDesc: 'hideNotify()V' });
    this.vm.schedule(20);
  }
  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.audio.resume();
    if (this.current) this.postEvent({ type: 'call', obj: this.current, nameDesc: 'showNotify()V' });
    this.repaintPending = true;
  }
}

global.J2MEHost = { Host, KEY };
})(typeof window !== 'undefined' ? window : globalThis);
