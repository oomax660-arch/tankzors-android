/* Minimal General-MIDI-ish synthesizer on WebAudio, used for MMAPI Players. */
'use strict';

(function (global) {

function parseMidi(b) {
  let p = 0;
  const u32 = () => { const v = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0; p += 4; return v; };
  const u16 = () => { const v = b[p] << 8 | b[p + 1]; p += 2; return v; };
  const vlq = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80 && p < b.length); return v; };
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'MThd') throw new Error('not midi');
  p = 4; const hl = u32(); const fmt = u16(), ntr = u16(), div = u16(); p = 8 + hl;
  const events = [];
  for (let tr = 0; tr < ntr && p < b.length; tr++) {
    while (p < b.length && String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]) !== 'MTrk') p++;
    if (p >= b.length) break;
    p += 4; const len = u32(); const end = Math.min(b.length, p + len);
    let tick = 0, rs = 0, seq = 0;
    while (p < end) {
      tick += vlq();
      let st = b[p];
      if (st & 0x80) { p++; if (st < 0xf0) rs = st; } else st = rs;
      if (st === 0xff) {
        const type = b[p++]; const l = vlq();
        if (type === 0x51 && l === 3) events.push({ tick, tr, seq: seq++, k: 'tempo', v: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] });
        p += l;
        if (type === 0x2f) break;
      } else if (st === 0xf0 || st === 0xf7) { const l = vlq(); p += l; }
      else {
        const hi = st & 0xf0, ch = st & 0x0f;
        const a = b[p++]; const c2 = (hi === 0xc0 || hi === 0xd0) ? 0 : b[p++];
        events.push({ tick, tr, seq: seq++, k: hi, ch, a, b: c2 });
      }
    }
    p = end;
  }
  events.sort((x, y) => x.tick - y.tick || (x.k === 'tempo' ? -1 : y.k === 'tempo' ? 1 : 0) || x.tr - y.tr || x.seq - y.seq);
  // ticks -> seconds
  let tempo = 500000, lastTick = 0, lastSec = 0;
  const tps = div & 0x8000 ? null : div;
  const sec = (tick) => tps ? lastSec + (tick - lastTick) * tempo / 1e6 / tps : tick / 1000;
  const prog = new Array(16).fill(0), vol = new Array(16).fill(100), expr = new Array(16).fill(127);
  const open = new Map(); const notes = []; let endSec = 0;
  for (const e of events) {
    const s = sec(e.tick);
    if (e.k === 'tempo') { lastSec = s; lastTick = e.tick; tempo = e.v || 500000; continue; }
    endSec = Math.max(endSec, s);
    if (e.k === 0x90 && e.b > 0) {
      const key = e.ch * 128 + e.a;
      if (open.has(key)) { const n = open.get(key); n.t1 = s; open.delete(key); }
      const n = { t0: s, t1: -1, ch: e.ch, note: e.a, vel: e.b / 127 * (vol[e.ch] / 127) * (expr[e.ch] / 127), prog: prog[e.ch] };
      notes.push(n); open.set(key, n);
    } else if (e.k === 0x80 || (e.k === 0x90 && e.b === 0)) {
      const key = e.ch * 128 + e.a; const n = open.get(key);
      if (n) { n.t1 = s; open.delete(key); }
    } else if (e.k === 0xc0) prog[e.ch] = e.a;
    else if (e.k === 0xb0) { if (e.a === 7) vol[e.ch] = e.b; else if (e.a === 11) expr[e.ch] = e.b; }
  }
  for (const n of open.values()) n.t1 = endSec;
  for (const n of notes) if (n.t1 <= n.t0) n.t1 = n.t0 + 0.08;
  notes.sort((a, b) => a.t0 - b.t0);
  return { notes, duration: Math.max(endSec, notes.length ? notes[notes.length - 1].t1 : 0) };
}

class Synth {
  constructor() {
    this.ctx = null; this.players = new Map(); this.seq = 0; this.masterVol = 0.5; this.muted = false;
    this.noise = null;
  }
  ensure() {
    if (this.ctx) return this.ctx;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = this.masterVol;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate; const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return this.ctx;
  }
  unlock() { const c = this.ensure(); if (c && c.state !== 'running') c.resume(); }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.masterVol; }

  create(bytes, type) {
    const id = ++this.seq;
    let song = null;
    try { song = parseMidi(bytes); } catch (e) { song = { notes: [], duration: 0 }; }
    this.players.set(id, { song, loopsLeft: 1, playing: false, t0: 0, idx: 0, offset: 0, vol: 100, gain: null, voices: new Set(), timer: null });
    return id;
  }
  start(id, loops) {
    const p = this.players.get(id); if (!p) return;
    const ctx = this.ensure(); if (!ctx) return;
    this.stop(id, true);
    p.loopsLeft = loops === -1 ? Infinity : Math.max(1, loops);
    p.gain = ctx.createGain(); p.gain.gain.value = p.mute ? 0 : p.vol / 100; p.gain.connect(this.master);
    p.playing = true;
    p.t0 = ctx.currentTime + 0.05 - p.offset; p.idx = p.song.notes.findIndex(n => n.t0 >= p.offset); if (p.idx < 0) p.idx = p.song.notes.length;
    const tick = () => this.pump(id);
    p.timer = setInterval(tick, 60); tick();
  }
  pump(id) {
    const p = this.players.get(id); if (!p || !p.playing) return;
    const ctx = this.ctx; const ahead = ctx.currentTime + 0.35; const notes = p.song.notes;
    while (p.idx < notes.length && p.t0 + notes[p.idx].t0 < ahead) { this.voice(p, notes[p.idx], p.t0); p.idx++; }
    const songEnd = p.t0 + Math.max(p.song.duration, 0.1);
    if (p.idx >= notes.length && ctx.currentTime >= songEnd - 0.3) {
      if (--p.loopsLeft > 0 && p.song.duration > 0.2) { p.t0 = songEnd; p.idx = 0; }
      else if (ctx.currentTime >= songEnd) { p.playing = false; clearInterval(p.timer); p.offset = 0; }
    }
  }
  voice(p, n, base) {
    const ctx = this.ctx; const t0 = Math.max(ctx.currentTime, base + n.t0); const t1 = Math.max(t0 + 0.03, base + n.t1);
    const g = ctx.createGain(); g.connect(p.gain);
    const v = Math.min(1, n.vel) * 0.22;
    let src;
    if (n.ch === 9) {
      const k = n.note;
      if (k === 35 || k === 36) {
        src = ctx.createOscillator(); src.type = 'sine';
        src.frequency.setValueAtTime(150, t0); src.frequency.exponentialRampToValueAtTime(40, t0 + 0.15);
        g.gain.setValueAtTime(v * 2.2, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
        src.connect(g); src.start(t0); src.stop(t0 + 0.22);
      } else {
        src = ctx.createBufferSource(); src.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        const hat = k === 42 || k === 44 || k === 46, cym = k === 49 || k === 51 || k === 52 || k === 55 || k === 57 || k === 59;
        f.type = hat || cym ? 'highpass' : 'bandpass'; f.frequency.value = hat ? 7000 : cym ? 5000 : 1800;
        const len = k === 46 ? 0.25 : hat ? 0.06 : cym ? 0.8 : 0.16;
        g.gain.setValueAtTime(v * (hat ? 0.8 : 1.4), t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + len);
        src.connect(f); f.connect(g); src.start(t0, Math.random() * 0.5); src.stop(t0 + len + 0.02);
      }
    } else {
      const pr = n.prog; const fam = pr >> 3;
      src = ctx.createOscillator();
      const freq = 440 * Math.pow(2, (n.note - 69) / 12);
      src.frequency.value = freq;
      let type = 'triangle', decay = 0, sustain = 0.8, lp = 0;
      switch (fam) {
        case 0: type = 'triangle'; decay = 0.6; sustain = 0.25; break;           // piano
        case 1: type = 'sine'; decay = 0.4; sustain = 0.1; break;                // chromatic perc
        case 2: type = 'square'; sustain = 0.6; lp = 2500; break;                // organ
        case 3: type = 'sawtooth'; decay = 0.5; sustain = 0.3; lp = 2200; break; // guitar
        case 4: type = 'triangle'; decay = 0.3; sustain = 0.7; break;            // bass
        case 5: case 6: type = 'sawtooth'; sustain = 0.75; lp = 1800; break;     // strings / ensemble
        case 7: type = 'sawtooth'; sustain = 0.8; lp = 2600; break;              // brass
        case 8: case 9: type = 'square'; sustain = 0.7; lp = 3000; break;        // reed / pipe
        case 10: type = 'square'; sustain = 0.85; break;                         // synth lead
        case 11: type = 'triangle'; sustain = 0.9; break;                        // pad
        default: type = 'triangle'; decay = 0.4; sustain = 0.4;
      }
      src.type = type;
      let out = src;
      if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; src.connect(f); out = f; }
      out.connect(g);
      const vv = v * (type === 'square' || type === 'sawtooth' ? 0.55 : 1);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vv, t0 + 0.008);
      if (decay) g.gain.setTargetAtTime(vv * sustain, t0 + 0.01, decay / 3);
      else g.gain.setValueAtTime(vv * sustain, t0 + 0.02);
      g.gain.setTargetAtTime(0.0001, t1, 0.04);
      src.start(t0); src.stop(t1 + 0.25);
    }
    p.voices.add(src);
    src.onended = () => { p.voices.delete(src); try { g.disconnect(); } catch (e) {} };
  }
  stop(id, keepOffset) {
    const p = this.players.get(id); if (!p) return;
    if (p.playing && this.ctx && !keepOffset) p.offset = Math.max(0, Math.min(p.song.duration, this.ctx.currentTime - p.t0));
    p.playing = false; if (p.timer) clearInterval(p.timer); p.timer = null;
    for (const v of p.voices) { try { v.stop(); } catch (e) {} }
    p.voices.clear();
    if (p.gain) { try { p.gain.disconnect(); } catch (e) {} p.gain = null; }
  }
  close(id) { this.stop(id); this.players.delete(id); }
  isPlaying(id) { const p = this.players.get(id); return !!(p && p.playing); }
  time(id) { const p = this.players.get(id); if (!p) return 0; return p.playing && this.ctx ? Math.max(0, this.ctx.currentTime - p.t0) % Math.max(p.song.duration, 0.001) : p.offset; }
  seek(id, s) { const p = this.players.get(id); if (!p) return; p.offset = Math.max(0, s); if (p.playing) { const l = p.loopsLeft; this.start(id, l === Infinity ? -1 : l); } }
  duration(id) { const p = this.players.get(id); return p ? p.song.duration : 0; }
  volume(id, l) { const p = this.players.get(id); if (!p) return; p.vol = l; if (p.gain) p.gain.gain.value = p.mute ? 0 : l / 100; }
  getVolume(id) { const p = this.players.get(id); return p ? p.vol : 100; }
  mute(id, m) { const p = this.players.get(id); if (!p) return; p.mute = m; if (p.gain) p.gain.gain.value = m ? 0 : p.vol / 100; }
  tone(note, dur, vol) {
    const ctx = this.ensure(); if (!ctx) return;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'square'; o.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
    g.gain.value = (vol / 100) * 0.15; o.connect(g); g.connect(this.master);
    o.start(); o.stop(ctx.currentTime + dur / 1000);
  }
  /* ---- synthesized sound effects (the original game has none) ---- */
  sfxBus() {
    const ctx = this.ensure(); if (!ctx) return null;
    if (!this.sfxGain) { this.sfxGain = ctx.createGain(); this.sfxGain.gain.value = 0.9; this.sfxGain.connect(this.master); }
    return ctx;
  }
  noiseBurst(t, dur, type, freq, q, vol, endFreq) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q || 0.7;
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxGain);
    src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.05);
  }
  thump(t, f0, f1, dur, vol, type) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.05);
  }
  sfx(kind, vol) {
    const ctx = this.sfxBus(); if (!ctx) return;
    if (ctx.state !== 'running') {
      // the system stopped the audio (call, home screen, Control Centre...): wake it and play the sound then
      if (this.held) return;
      if (!this.waking) { this.waking = true; ctx.resume().then(() => { this.waking = false; }, () => { this.waking = false; }); }
      const due = performance.now();
      ctx.resume().then(() => { if (ctx.state === 'running' && performance.now() - due < 250) this.sfx(kind, vol); }, () => {});
      return;
    }
    const t = ctx.currentTime + 0.005, v = Math.max(0.05, vol === undefined ? 1 : vol);
    switch (kind) {
      case 'shot':
        this.noiseBurst(t, 0.13, 'bandpass', 1500, 0.9, 0.55 * v, 500);
        this.thump(t, 190, 60, 0.11, 0.5 * v);
        break;
      case 'plasma':
        this.thump(t, 1200, 180, 0.18, 0.18 * v, 'square');
        this.noiseBurst(t, 0.1, 'highpass', 3000, 0.7, 0.15 * v);
        break;
      case 'boom':
        this.noiseBurst(t, 0.45, 'lowpass', 1400, 0.8, 0.8 * v, 180);
        this.thump(t, 120, 38, 0.3, 0.8 * v);
        break;
      case 'bigboom':
        this.noiseBurst(t, 1.1, 'lowpass', 900, 0.8, 1.0 * v, 90);
        this.thump(t, 90, 28, 0.7, 1.0 * v);
        this.noiseBurst(t + 0.05, 0.5, 'bandpass', 2500, 0.6, 0.25 * v, 600);
        break;
      case 'coin':
        this.thump(t, 1320, 1300, 0.07, 0.16 * v, 'square');
        this.thump(t + 0.07, 1760, 1740, 0.12, 0.16 * v, 'square');
        break;
      case 'pick':
        this.thump(t, 660, 990, 0.12, 0.16 * v, 'triangle');
        break;
      case 'level':
        [523, 659, 784, 1046].forEach((f, i) => this.thump(t + i * 0.08, f, f, 0.16, 0.15 * v, 'square'));
        break;
      case 'alarm':
        for (let i = 0; i < 3; i++) this.thump(t + i * 0.22, 880, 600, 0.18, 0.16 * v, 'sawtooth');
        break;
    }
  }
  engine(on, vol) {
    const ctx = this.sfxBus(); if (!ctx) return;
    const t = ctx.currentTime;
    if (!this.eng) {
      const out = ctx.createGain(); out.gain.value = 0; out.connect(this.sfxGain);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 2;
      const trem = ctx.createGain(); trem.gain.value = 0.6;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 13; const lfoG = ctx.createGain(); lfoG.gain.value = 0.4;
      lfo.connect(lfoG); lfoG.connect(trem.gain);
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 52;
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55.5;
      const rumble = ctx.createBufferSource(); rumble.buffer = this.noise; rumble.loop = true;
      const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 180; const rg = ctx.createGain(); rg.gain.value = 0.5;
      o1.connect(lp); o2.connect(lp); rumble.connect(rf); rf.connect(rg); rg.connect(lp);
      lp.connect(trem); trem.connect(out);
      o1.start(); o2.start(); lfo.start(); rumble.start();
      this.eng = { out, o1, o2 };
    }
    const e = this.eng, v = Math.max(0.05, vol === undefined ? 1 : vol);
    e.out.gain.cancelScheduledValues(t);
    e.out.gain.setTargetAtTime(on ? 0.22 * v : 0, t, on ? 0.06 : 0.12);
    e.o1.frequency.setTargetAtTime(on ? 62 : 52, t, 0.3);
    e.o2.frequency.setTargetAtTime(on ? 66 : 55.5, t, 0.3);
  }

  stopAll() { for (const id of this.players.keys()) this.stop(id); if (this.eng) this.engine(false); }
  suspend() { this.held = true; if (this.ctx) this.ctx.suspend(); }
  resume() { this.held = false; if (this.ctx) this.ctx.resume(); }
  /** wake the audio after the system stopped it (not after our own pause) */
  kick() { const c = this.ensure(); if (c && !this.held && c.state !== 'running') c.resume(); }
}

global.MidiSynth = { Synth, parseMidi };
})(typeof window !== 'undefined' ? window : globalThis);
