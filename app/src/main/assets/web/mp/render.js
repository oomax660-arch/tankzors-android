/* Multiplayer view: draws the battle from host snapshots with the original game's graphics. */
'use strict';
(function () {
const CELL = 20;
const E = () => window.MPEngine;
const TEAM_RING = { 0: 0, 1: 2, 2: 4, 3: 3, 5: 1, 6: 1 };            // rings.png: 0 yellow, 1 red, 2 blue, 3 cyan, 4 green
const TEAM_COLOR = { 0: '#ffd84a', 1: '#6aa8ff', 2: '#6fe26f', 3: '#5fe8f0', 5: '#ff5a4a', 6: '#ff8a3a' };
const teamColor = (t) => TEAM_COLOR[t] || (t >= 10 ? ['#ffd84a', '#6aa8ff', '#6fe26f', '#5fe8f0', '#ff9be0', '#ffffff', '#c8a2ff', '#ffb36a'][t % 8] : '#ff5a4a');
const teamRing = (t) => (t in TEAM_RING ? TEAM_RING[t] : t >= 20 ? 1 : [0, 2, 4, 3, 1][t % 5]);
const KIND_IMG = ['tank_light.png', 'tank_heavy.png', 'tank_siege.png', 'tank_kamikaze.png', 'tank_rapid', 'tank_fast', 'tank_builder', 'tank_brain', 'tank_fh', 'tank_rh', 'tank_fr', 'tank_titan', 'tank_rogue'];
/* All the original sprite sheets turn the same way: frame 0 faces DOWN, 4 LEFT, 8 UP, 12 RIGHT
 * (16 frames, clockwise). The engine's directions are 0 up, 1 right, 2 down, 3 left. */
const DIR_FRAME16 = [8, 12, 0, 4];
const DIR_FRAME4 = [2, 3, 0, 1];           // bullets.png groups of 4: down, left, up, right
const angFrame16 = (a) => ((Math.round((a - Math.PI / 2) / (Math.PI / 8)) % 16) + 16) % 16;
/* tracks.png: 0-3 horizontal, 4-7 vertical (fading), corners 8 top+left, 11 top+right, 14 bottom+right, 17 bottom+left (3 fades each) */
const TRACK = { 'L,R': 0, 'R,L': 0, 'T,B': 4, 'B,T': 4, 'L,T': 8, 'T,L': 8, 'R,T': 11, 'T,R': 11, 'B,R': 14, 'R,B': 14, 'B,L': 17, 'L,B': 17 };
const EDGE_OF_DIR = ['T', 'R', 'B', 'L'], OPP = { T: 'B', B: 'T', L: 'R', R: 'L' };

/* ------------------------------------------------------------ assets */
const Assets = {
  img: {}, ready: null,
  load() {
    if (this.ready) return this.ready;
    const names = ['ground.png', 'walls.png', 'tank_light.png', 'tank_heavy.png', 'tank_siege.png', 'tank_kamikaze.png', 'turret.png', 'rings.png',
      'big_builds.png', 'buildings.png', 'powerups.png', 'bullets.png', 'expl_small.png', 'expl_big.png', 'spikes.png', 'health_red.png', 'health_yell.png', 'tracks.png',
      'mines.png', 'aircrafts.png', 'icons.png', 'expl_big_plasma.png', 'clouds.png'];
    const F = window.GAME_FILES || {};
    this.ready = Promise.all(names.map(n => new Promise((res) => {
      const im = new Image();
      im.onload = () => res(); im.onerror = () => res();
      im.src = 'data:image/png;base64,' + (F[n] || '');
      this.img[n] = im;
    }))).then(() => {
      // the two new bots are repainted original sprites; the ricochet plasma is a violet one
      const grey = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) < 46;
      this.img.tank_rapid = this.tint(this.img['tank_heavy.png'], (r, g, b) => grey(r, g, b) ? [r * 1.06 + 14, g * 0.84, b * 0.72] : [r, g, b]);
      this.img.tank_fast = this.tint(this.img['tank_light.png'], (r, g, b) => grey(r, g, b) ? [r * 0.72, g * 1.06 + 18, b * 0.72] : [r, g, b]);
      this.img.tank_builder = this.tint(this.img['tank_light.png'], (r, g, b) => grey(r, g, b) ? [r * 1.08 + 30, g * 1.0 + 22, b * 0.5] : [r, g, b]);
      this.img.tank_brain = this.tint(this.img['tank_heavy.png'], (r, g, b) => grey(r, g, b) ? [r * 0.62, g * 0.86 + 10, b * 1.12 + 34] : [r * 0.7, g * 0.9, b * 1.3 + 30]);
      // hybrids: the heavy hull in the colours of its halves (green = fast, crimson = rapid), the light one for «Шквал», gold for «Титан»
      this.img.tank_fh = this.tint(this.img['tank_heavy.png'], (r, g, b) => grey(r, g, b) ? [r * 0.55, g * 1.1 + 26, b * 0.5 + 6] : [r * 0.8, g * 1.15, b * 0.7]);
      this.img.tank_rh = this.tint(this.img['tank_heavy.png'], (r, g, b) => grey(r, g, b) ? [r * 1.12 + 26, g * 0.5, b * 0.62 + 18] : [r * 1.1, g * 0.8, b * 0.85]);
      this.img.tank_fr = this.tint(this.img['tank_light.png'], (r, g, b) => grey(r, g, b) ? [r * 1.1 + 34, g * 0.95 + 10, b * 0.3] : [r * 1.15, g * 0.9, b * 0.6]);
      this.img.tank_titan = this.tint(this.img['tank_heavy.png'], (r, g, b) => grey(r, g, b) ? [r * 1.15 + 46, g * 1.02 + 30, b * 0.42] : [r * 1.25 + 10, g * 1.05, b * 0.55]);
      // the rogue: a dark violet light tank
      this.img.tank_rogue = this.tint(this.img['tank_light.png'], (r, g, b) => grey(r, g, b) ? [r * 0.62 + 22, g * 0.4, b * 0.85 + 46] : [r * 0.9 + 10, g * 0.7, b * 1.1 + 20]);
      this.img.bullets_v = this.tint(this.img['bullets.png'], (r, g, b) => b > r + 25 ? [b * 0.62 + r * 0.25, g * 0.35, b] : [r, g, b]);
    });
    return this.ready;
  },
  tint(img, f) {
    const c = document.createElement('canvas'); c.width = img.width || 1; c.height = img.height || 1;
    const x = c.getContext('2d'); try { x.drawImage(img, 0, 0); } catch (e) { return img; }
    const d = x.getImageData(0, 0, c.width, c.height), a = d.data;
    for (let i = 0; i < a.length; i += 4) { if (!a[i + 3]) continue; const o = f(a[i], a[i + 1], a[i + 2]); a[i] = Math.min(255, o[0]); a[i + 1] = Math.min(255, o[1]); a[i + 2] = Math.min(255, o[2]); }
    x.putImageData(d, 0, 0);
    return c;
  },
};

/* ------------------------------------------------------------ view */
class View {
  constructor(canvas, myPid) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.myPid = myPid;
    this.snaps = []; this.map = null;
    this.fx = []; this.trk = new Map(); this.tstate = new Map();
    this.turn = new Map();         // tank id -> displayed frame (smooth turning)
    this.bigMap = false;
    this.cam = { x: 0, y: 0 };
    this.lastDraw = performance.now();
    this.names = new Map();
    this.spawns = [];
  }
  setStart(st) {
    const m = st.map;
    const un = (s) => { const b = atob(s), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
    this.map = { W: m.W, H: m.H, t: un(m.t), g: un(m.g), v: un(m.v), hp: Int16Array.from(m.hp), theme: m.theme };
    this.cfg = st.cfg; this.roster = st.roster; this.spawns = st.spawns || [];
    this.groundCanvas = null; this.miniDirty = true;
    this.snaps = []; this.fx = []; this.trk = new Map(); this.tstate = new Map();
    this.buildGround();
  }
  buildGround() {
    const m = this.map, G = Assets.img['ground.png'];
    const c = document.createElement('canvas'); c.width = m.W * CELL; c.height = m.H * CELL;
    const x = c.getContext('2d');
    for (let i = 0; i < m.W * m.H; i++) { const f = m.g[i]; x.drawImage(G, f * 20, 0, 20, 20, (i % m.W) * CELL, ((i / m.W) | 0) * CELL, 20, 20); }
    // spawn pads
    const B = Assets.img['buildings.png'];
    for (const [cx, cy, team] of this.spawns) x.drawImage(B, (team === 5 ? 1 : 0) * 20, 0, 20, 20, cx * CELL, cy * CELL, 20, 20);
    this.groundCanvas = c;
  }
  applySnap(s, now) {
    const m = this.map;
    if (s.p) this.lastP = s.p; else s.p = this.lastP || [];          // pickups come only when they change
    if (s.tc.length) this.miniDirty = true;
    for (const [i, t, hp, v, g] of s.tc) {
      m.t[i] = t; m.hp[i] = hp; m.v[i] = v;
      if (g !== undefined && g !== m.g[i]) { m.g[i] = g; if (this.groundCanvas) this.groundCanvas.getContext('2d').drawImage(Assets.img['ground.png'], g * 20, 0, 20, 20, (i % m.W) * CELL, ((i / m.W) | 0) * CELL, 20, 20); }
    }
    // place the snapshot on the local clock by the host's own time: no network jitter in the motion
    const est = now - s.t * 1000;
    // average out timer and network jitter; follow a real change of the delay quickly
    this.off = this.off === undefined || Math.abs(est - this.off) > 120 ? est : this.off + (est - this.off) * 0.08;
    s.at = s.t * 1000 + this.off;
    if (this.snaps.length && s.at <= this.snaps[this.snaps.length - 1].at) s.at = this.snaps[this.snaps.length - 1].at + 1;
    this.snaps.push(s);
    if (this.snaps.length > 10) this.snaps.shift();
    for (const e of s.e) this.event(e, now);
    this.last = s;
    const me = s.pl.find(p => p[0] === this.myPid);
    this.me = me ? { coins: me[1], kills: me[2], deaths: me[3], tank: me[4], respawn: me[5], sel: me[6], order: me[7], out: me[8], score: me[9], built: me[10],
      xp: me[11], level: me[12], sp: me[13], skills: (() => { const o = {}; E().SKILLS.forEach((k, i) => { o[k.id] = +String(me[14])[i] || 0; }); return o; })(),
      kind: me[15], owned: me[16], botCap: me[17], turretCap: me[18], bots: me[19], turrets: me[20], nearBase: !!me[21],
      w: me[22] | 0, ammo: String(me[23] || '').split(',').map(Number), gear: (() => { const o = {}; const v = String(me[24] || '').split(','); E().GEAR.forEach((g, i) => { o[g.id] = +v[i] || 0; }); return o; })() } : null;
  }
  event(e, now) {
    // battle sounds: only the "sounds" switch in the settings counts (not whether the campaign has played music yet)
    const sfx = (k, v) => { const h = window.__host; if (h && h.audio && h.opts.sfx !== false && (!window.MP || window.MP.sfx)) try { const gv = h.gameVolume > 0 ? 0.5 + h.gameVolume / 200 : 1; h.audio.sfx(k, (v === undefined ? 0.8 : v) * gv); } catch (er) {} };
    const near = (x, y) => { const d = Math.hypot(x - this.cam.x, y - this.cam.y); return d < 260 ? 1 - d / 320 : 0; };
    switch (e.e) {
      case 'boom': this.fx.push({ k: 'big', x: e.x, y: e.y, t: now, s: e.s }); { const v = near(e.x, e.y); if (v) sfx(e.s >= 2 ? 'bigboom' : 'boom', v); if (v > 0.5 && e.s >= 2 && window.MP) window.MP.haptic(-3); } break;
      case 'hit': case 'crumble': this.fx.push({ k: 'small', x: e.x, y: e.y, t: now }); { const v = near(e.x, e.y); if (v) sfx('boom', v * 0.5); } break;
      case 'shot': { const v = near(e.x, e.y); if (v) sfx(e.k ? 'plasma' : 'shot', v * 0.7); } break;
      case 'spawn': this.fx.push({ k: 'ring', x: e.x, y: e.y, t: now }); break;
      case 'build': case 'repair': this.fx.push({ k: 'spark', x: e.x, y: e.y, t: now }); break;
      case 'pick': this.fx.push({ k: 'spark', x: e.x, y: e.y, t: now }); if (e.to === this.myPid) sfx(e.k === 'coin' ? 'coin' : 'pick', 0.7); break;
      case 'freeze': this.fx.push({ k: 'freeze', x: e.x, y: e.y, t: now }); sfx('plasma', 0.9); break;
      case 'field': this.fx.push({ k: 'field', x: e.x, y: e.y, t: now }); break;
      case 'armor': this.fx.push({ k: 'spark', x: e.x, y: e.y, t: now }); break;
      case 'heal': this.fx.push({ k: 'heal', x: e.x, y: e.y, t: now }); break;
      case 'drop': this.fx.push({ k: 'ring', x: e.x, y: e.y, t: now }); sfx('level', 0.6); break;
      case 'level': if (e.to === this.myPid) sfx('level', 0.9); break;
      case 'hqhit': if (e.team === this.myTeam() && now - (this.alarmT || 0) > 4000) { this.alarmT = now; sfx('alarm', 0.7); } break;
      case 'ricochet': this.fx.push({ k: 'spark', x: e.x, y: e.y, t: now }); { const v = near(e.x, e.y); if (v) sfx('plasma', v * 0.35); } break;
      case 'plane': sfx('bigboom', 0.25); break;
    }
    if (window.MP) window.MP.onEvent(e);
  }

  /* interpolated entity lists */
  frameState(now) {
    const S = this.snaps;
    if (!S.length) return null;
    // the host draws straight from its own simulation (one step behind); the others wait a bit for the network
    const delay = this.isHost ? 45 : 70;
    const rt = now - delay;
    let a = S[0], b = S[S.length - 1];
    for (let i = S.length - 1; i > 0; i--) if (S[i - 1].at <= rt) { a = S[i - 1]; b = S[i]; break; }
    const span = b.at - a.at;
    const f = span > 0 ? Math.max(0, Math.min(1.2, (rt - a.at) / span)) : 1;
    const prevK = new Map(a.k.map(t => [t[0], t]));
    const tanks = b.k.map(t => {
      const p = prevK.get(t[0]);
      const x = p ? p[1] + (t[1] - p[1]) * f : t[1], y = p ? p[2] + (t[2] - p[2]) * f : t[2];
      return { id: t[0], x, y, dir: t[3], hp: t[4], maxhp: t[5], kind: t[6], team: t[7], fl: t[8], pid: t[9], owner: t[10], name: t[11], lvl: t[12], vet: t[13], field: t[14] || 0, fieldMax: t[15] || 0, armor: t[16] || 0, armorMax: t[17] || 0 };
    });
    // my own tank: no waiting, the newest state carried forward a little (it answers the stick at once)
    const L = S[S.length - 1], L0 = S.length > 1 ? S[S.length - 2] : null;
    const mineT = L.k.find(t => t[9] === this.myPid);
    if (mineT) {
      const i = tanks.findIndex(t => t.id === mineT[0]);
      const p0 = L0 && L0.k.find(t => t[0] === mineT[0]);
      let x = mineT[1], y = mineT[2];
      if (p0 && (mineT[8] & 1) && L.at > L0.at) { const k = Math.max(0, Math.min(45, now - L.at)) / (L.at - L0.at); x += (mineT[1] - p0[1]) * k; y += (mineT[2] - p0[2]) * k; }
      // glide to it (no jumps when a newer state corrects the guess); teleports (respawn) snap
      const o = this.own;
      if (o && o.id === mineT[0] && Math.abs(o.x - x) + Math.abs(o.y - y) < 24) {
        const a = 1 - Math.exp(-Math.max(0.001, (now - o.t) / 1000) * 22);
        x = o.x + (x - o.x) * a; y = o.y + (y - o.y) * a;
      }
      this.own = { id: mineT[0], x, y, t: now };
      if (i >= 0) { tanks[i].x = x; tanks[i].y = y; tanks[i].dir = mineT[3]; tanks[i].fl = mineT[8]; }
    }
    const prevB = new Map(a.b.map(q => [q[0], q]));
    const bullets = b.b.map(q => { const p = prevB.get(q[0]); return { x: p ? p[1] + (q[1] - p[1]) * f : q[1], y: p ? p[2] + (q[2] - p[2]) * f : q[2], vx: q[3], vy: q[4], k: q[5], z: p ? (p[6] || 0) + ((q[6] || 0) - (p[6] || 0)) * f : q[6] || 0, fz: q[7] }; });
    const prevA = new Map((a.a || []).map(q => [q[0], q]));
    const planes = (b.a || []).map(q => { const p = prevA.get(q[0]); return { x: p ? p[1] + (q[1] - p[1]) * f : q[1], y: p ? p[2] + (q[2] - p[2]) * f : q[2], dir: q[3] }; });
    return { tanks, bullets, structs: b.s, picks: b.p, flags: b.f, mines: b.m || [], dyns: b.d || [], planes, snap: b };
  }

  draw() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastDraw) / 1000); this.lastDraw = now;
    const cv = this.cv, ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (!this.map || !this.groundCanvas) return;
    const st = this.frameState(now);
    if (!st) return;
    const m = this.map;
    // camera: my tank, else an ally, else the map centre
    const mine = st.tanks.find(t => t.pid === this.myPid);
    let fx = this.cam.x, fy = this.cam.y;
    if (mine) { fx = mine.x; fy = mine.y; }
    else if (!this.camInit) { fx = m.W * CELL / 2; fy = m.H * CELL / 2; }
    else { const myTeam = this.myTeam(); const ally = st.tanks.find(t => t.team === myTeam && t.pid); if (ally) { fx = ally.x; fy = ally.y; } }
    this.camInit = true;
    // zoom: 12 cells across in portrait (as the campaign: 240 px), 11 cells high in landscape
    const land = W > H;
    let scale = land ? H / (11 * CELL) : W / (12 * CELL);
    if (this.bigMap) scale = Math.min(W / (m.W * CELL), H / (m.H * CELL)) * 0.98;
    const vw = W / scale, vh = H / scale;
    const k = 1 - Math.pow(0.0005, dt);           // smooth camera
    this.cam.x += (fx - this.cam.x) * (this.bigMap ? 1 : k); this.cam.y += (fy - this.cam.y) * (this.bigMap ? 1 : k);
    let cx = this.cam.x - vw / 2, cy = this.cam.y - vh / 2;
    const mw = m.W * CELL, mh = m.H * CELL;
    cx = mw <= vw ? (mw - vw) / 2 : Math.max(0, Math.min(mw - vw, cx));
    cy = mh <= vh ? (mh - vh) / 2 : Math.max(-30, Math.min(mh - vh + 30, cy));
    if (this.shake > 0) { this.shake -= dt; cx += (Math.random() - 0.5) * 3; cy += (Math.random() - 0.5) * 3; }
    // the world is drawn 1:1 (original pixels) into a buffer, then upscaled like the campaign (Scale2x)
    const ox = Math.floor(cx), oy = Math.floor(cy);
    const ww = Math.ceil(vw) + 2, wh = Math.ceil(vh) + 2;
    if (!this.wc) { this.wc = document.createElement('canvas'); this.wctx = this.wc.getContext('2d'); }
    if (this.wc.width !== ww || this.wc.height !== wh) { this.wc.width = ww; this.wc.height = wh; }
    const screen = ctx, myTeam = this.myTeam();
    {
    const ctx = this.wctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, ww, wh);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, -ox, -oy);
    // ground
    ctx.drawImage(this.groundCanvas, 0, 0);
    // tracks: one mark per cell, fading in steps like the original
    this.updateTracks(st.tanks, now);
    const TRK = Assets.img['tracks.png'];
    for (const [i, q] of this.trk) {
      const age = (now - q.t) / 1000, corner = q.f >= 8;
      const step = Math.floor(age / (corner ? 4 : 3));
      if (step > (corner ? 2 : 3)) { this.trk.delete(i); continue; }
      ctx.drawImage(TRK, (q.f + step) * 20, 0, 20, 20, (i % m.W) * CELL, ((i / m.W) | 0) * CELL, 20, 20);
    }
    const c0 = Math.max(0, Math.floor(cx / CELL)), c1 = Math.min(m.W - 1, Math.floor((cx + vw) / CELL));
    const r0 = Math.max(0, Math.floor(cy / CELL)), r1 = Math.min(m.H - 1, Math.floor((cy + vh) / CELL));
    // pickups and flags (under tanks)
    const PU = Assets.img['powerups.png'], an = Math.floor(now / 160) % 3;
    for (const [, type, px, py] of st.picks) {
      if (type === 7) {                                 // supply drop: a big crate with a beacon
        const X = px * CELL + 10, Y = py * CELL + 10, k = 1.5 + 0.08 * Math.sin(now / 160);
        ctx.globalCompositeOperation = 'lighter'; this.glow(ctx, X, Y, 22, '255,210,90', 0.35 + 0.15 * Math.sin(now / 200)); ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(PU, 18 * 20, 0, 20, 20, X - 10 * k, Y - 10 * k, 20 * k, 20 * k);
        continue;
      }
      const base = [15, 9, 0, 3, 6, 12, 18][type] || 0; ctx.drawImage(PU, (base + (type === 6 ? an % 2 : an)) * 20, 0, 20, 20, px * CELL, py * CELL - 2 + Math.sin(now / 300 + px) * 1.5, 20, 20); }
    // mines: ours always, the enemy's only close by (thermo vision sees further)
    const MI = Assets.img['mines.png'];
    const meT = st.tanks.find(t => t.pid === this.myPid);
    const seeR = (2 + ((this.me && this.me.gear && this.me.gear.thermo) || 0)) * CELL + 4;
    for (const [, mx, my, team, big] of st.mines) {
      const x = mx * CELL, y = my * CELL;
      const ours = team === myTeam;
      if (!ours && !(meT && Math.abs(meT.x - x - 10) < seeR && Math.abs(meT.y - y - 10) < seeR)) continue;
      ctx.drawImage(MI, (ours ? big : 2) * 20, 0, 20, 20, x, y, 20, 20);
    }
    for (const [, dx2, dy2, left] of st.dyns) {
      ctx.drawImage(MI, (3 + (Math.floor(now / (left <= 2 ? 90 : 220)) % 2)) * 20, 0, 20, 20, dx2 * CELL, dy2 * CELL, 20, 20);
    }
    // walls
    this.drawWalls(ctx, c0, c1, r0, r1);
    // cloud shadows drift over the ground, as in the campaign
    const clouds = this.clouds(now);
    const CL = Assets.img['clouds.png'];
    ctx.globalAlpha = 0.5;
    for (const c of clouds) ctx.drawImage(CL, (c.f * 2 + 1) * 120, 0, 120, 80, Math.round(c.x + 34), Math.round(c.y + 46), 120, 80);
    ctx.globalAlpha = 1;
    // structures
    const RG = Assets.img['rings.png'], BB = Assets.img['big_builds.png'], TU = Assets.img['turret.png'];
    for (const [id, type, sx, sy, hp, maxhp, team, ang] of st.structs) {
      if (type === 0) {
        const x = sx * CELL, y = sy * CELL;
        ctx.globalAlpha = 0.55; ctx.drawImage(RG, teamRing(team) * 28, 0, 28, 28, x - 4, y - 4, 48, 48); ctx.globalAlpha = 1;
        ctx.drawImage(BB, 0, 0, 40, 40, x, y, 40, 40);
        this.bar(ctx, x + 20, y - 3, hp / maxhp, team, 34);
      } else {
        const x = sx * CELL + 10, y = sy * CELL + 10;
        ctx.globalAlpha = 0.5; ctx.drawImage(RG, teamRing(team) * 28, 0, 28, 28, x - 12, y - 12, 24, 24); ctx.globalAlpha = 1;
        const fr = angFrame16(ang);
        ctx.drawImage(TU, fr * 22, 0, 22, 26, x - 11, y - 15, 22, 26);
        if (hp < maxhp) this.bar(ctx, x, y - 16, hp / maxhp, team, 18);
      }
    }
    for (const [team, x, y, carried] of st.flags) {
      if (carried) continue;
      ctx.drawImage(Assets.img['buildings.png'], (team ? 2 : 4) * 20, 0, 20, 20, x - 6, y - 14, 20, 20);
    }
    // tanks
    for (const t of st.tanks) {
      const img = Assets.img[KIND_IMG[t.kind] || KIND_IMG[0]];
      const target = DIR_FRAME16[t.dir];
      let fr = this.turn.has(t.id) ? this.turn.get(t.id) : target;
      let dd = ((target - fr + 24) % 16) - 8;
      if (dd !== 0) fr = (fr + Math.sign(dd) * Math.min(Math.abs(dd), dt * 70) + 16) % 16;
      this.turn.set(t.id, fr);
      ctx.globalAlpha = t.fl & 2 ? 0.35 + 0.25 * Math.sin(now / 60) : 0.55;
      ctx.drawImage(RG, teamRing(t.team) * 28, 0, 28, 28, t.x - 13, t.y - 13, 26, 26);
      ctx.globalAlpha = 1;
      ctx.drawImage(img, (Math.round(fr) % 16) * 24, 0, 24, 24, Math.round(t.x) - 12, Math.round(t.y) - 12, 24, 24);
      if (t.fl & 64) { ctx.fillStyle = 'rgba(150,220,255,0.35)'; ctx.fillRect(Math.round(t.x) - 11, Math.round(t.y) - 11, 22, 22); ctx.strokeStyle = 'rgba(200,240,255,0.9)'; ctx.lineWidth = 1; ctx.strokeRect(Math.round(t.x) - 11.5, Math.round(t.y) - 11.5, 23, 23); }
      if (t.armor > 0) {
        ctx.globalCompositeOperation = 'lighter';
        this.glow(ctx, t.x, t.y, 17, '255,205,110', 0.22 + 0.12 * t.armor / Math.max(1, t.armorMax) + 0.05 * Math.sin(now / 200));
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(255,220,140,' + (0.45 + 0.35 * t.armor / Math.max(1, t.armorMax)) + ')'; ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(t.x) - 12.5, Math.round(t.y) - 12.5, 25, 25);
      }
      if (t.field > 0) { ctx.strokeStyle = 'rgba(80,150,255,' + (0.35 + 0.45 * t.field / Math.max(1, t.fieldMax)) + ')'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(t.x, t.y, 13.5, 0, Math.PI * 2); ctx.stroke(); }
      if (t.fl & 8) { ctx.strokeStyle = 'rgba(120,255,140,' + (0.5 + 0.3 * Math.sin(now / 90)) + ')'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(t.x, t.y, 13, 0, Math.PI * 2); ctx.stroke(); }
      if (t.fl & 4) ctx.drawImage(Assets.img['buildings.png'], (t.team === 0 ? 2 : 4) * 20, 0, 20, 20, t.x - 2, t.y - 22, 14, 14);
      this.bar(ctx, t.x, t.y - 15, t.hp / t.maxhp, t.team === myTeam ? 0 : 1, 18);
      let by = Math.round(t.y) - 18;
      if (t.armorMax > 0) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(Math.round(t.x) - 9, by, 18, 2); ctx.fillStyle = '#ffd27a'; ctx.fillRect(Math.round(t.x) - 9, by, Math.round(18 * t.armor / t.armorMax), 2); by -= 3; }
      if (t.fieldMax > 0) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(Math.round(t.x) - 9, by, 18, 2); ctx.fillStyle = '#4f9bff'; ctx.fillRect(Math.round(t.x) - 9, by, Math.round(18 * t.field / t.fieldMax), 2); }
    }
    // bullets
    const BUo = Assets.img['bullets.png'];
    for (const b of st.bullets) {
      const d = Math.abs(b.vx) > Math.abs(b.vy) ? (b.vx > 0 ? 1 : 3) : (b.vy > 0 ? 2 : 0);
      // kinds: 0 shell, 1 rocket, 2 plasma, 3 enemy laser, 4 double shell, 5 double plasma, 6 armour-piercing, 7 artillery, 8 warhead, 9 guided
      const base = [0, 8, 4, 13, 0, 4, 0, 0, 8, 8, 4][b.k] || 0;
      const BU = b.k === 10 ? Assets.img.bullets_v : BUo;
      const fr = base + DIR_FRAME4[d], X = Math.round(b.x) - 12, Y = Math.round(b.y) - 12;
      if (b.k === 11) {                                 // the homing plasma: a violet orb with a tail
        const sp = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / sp, uy = b.vy / sp;
        for (let k2 = 3; k2 >= 1; k2--) { ctx.fillStyle = 'rgba(170,90,255,' + (0.18 * (4 - k2)) + ')'; ctx.beginPath(); ctx.arc(b.x - ux * k2 * 4, b.y - uy * k2 * 4, 3.2 - k2 * 0.5, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#e8d2ff'; ctx.beginPath(); ctx.arc(b.x, b.y, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#a45cff'; ctx.lineWidth = 1; ctx.stroke();
        continue;
      }
      if (b.k === 7) {                                  // artillery: the shadow on the ground, the shell up in the air
        ctx.globalAlpha = 0.6; ctx.drawImage(BU, 12 * 24, 0, 24, 24, X, Y, 24, 24); ctx.globalAlpha = 1;
        ctx.drawImage(BU, fr * 24, 0, 24, 24, X, Y - Math.round(b.z), 24, 24);
      } else if (b.k === 4 || b.k === 5) {             // two shells side by side
        const ox = d % 2 ? 0 : 3, oy = d % 2 ? 3 : 0;
        ctx.drawImage(BU, fr * 24, 0, 24, 24, X - ox, Y - oy, 24, 24); ctx.drawImage(BU, fr * 24, 0, 24, 24, X + ox, Y + oy, 24, 24);
      } else if (b.k === 6) {                           // armour-piercing: a long heavy shell
        const ox = d % 2 ? 4 : 0, oy = d % 2 ? 0 : 4;
        ctx.drawImage(BU, fr * 24, 0, 24, 24, X - ox, Y - oy, 24, 24); ctx.drawImage(BU, fr * 24, 0, 24, 24, X, Y, 24, 24);
      } else ctx.drawImage(BU, fr * 24, 0, 24, 24, X, Y, 24, 24);
      if (b.fz) { ctx.strokeStyle = 'rgba(200,240,255,0.8)'; ctx.lineWidth = 1; ctx.strokeRect(X + 7.5, Y + 7.5, 9, 9); }
    }
    // effects
    const ES = Assets.img['expl_small.png'], EB = Assets.img['expl_big.png'];
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i], age = (now - f.t) / 1000;
      if (f.k === 'small') { const n = Math.floor(age * 30); if (n >= 17) { this.fx.splice(i, 1); continue; } ctx.drawImage(ES, n * 15, 0, 15, 15, f.x - 7.5, f.y - 7.5, 15, 15); }
      else if (f.k === 'big') { const n = Math.floor(age * 26); if (n >= 28) { this.fx.splice(i, 1); continue; } const s = f.s >= 3 ? 70 : f.s >= 2 ? 50 : 35; ctx.drawImage(EB, n * 35, 0, 35, 35, f.x - s / 2, f.y - s / 2, s, s); if (n === 1 && f.s >= 2) this.shake = 0.25; }
      else if (f.k === 'ring') { if (age > 0.6) { this.fx.splice(i, 1); continue; } ctx.strokeStyle = 'rgba(255,255,255,' + (0.8 - age) + ')'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(f.x, f.y, 6 + age * 30, 0, Math.PI * 2); ctx.stroke(); }
      else if (f.k === 'freeze') { if (age > 0.7) { this.fx.splice(i, 1); continue; } ctx.strokeStyle = 'rgba(170,230,255,' + (0.9 - age * 1.2) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(f.x, f.y, 10 + age * 210, 0, Math.PI * 2); ctx.stroke(); }
      else if (f.k === 'field') { if (age > 0.3) { this.fx.splice(i, 1); continue; } ctx.strokeStyle = 'rgba(90,160,255,' + (1 - age * 3) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(f.x, f.y, 13 + age * 12, 0, Math.PI * 2); ctx.stroke(); }
      else if (f.k === 'heal') { if (age > 0.8) { this.fx.splice(i, 1); continue; } ctx.fillStyle = 'rgba(120,255,140,' + (1 - age * 1.2) + ')'; ctx.fillRect(f.x - 1, f.y - 14 - age * 12 - 3, 2, 6); ctx.fillRect(f.x - 3, f.y - 14 - age * 12 - 1, 6, 2); }
      else if (f.k === 'spark') { if (age > 0.5) { this.fx.splice(i, 1); continue; } ctx.fillStyle = 'rgba(255,240,160,' + (1 - age * 2) + ')'; for (let j = 0; j < 6; j++) { const a = j * 1.05 + f.t; ctx.fillRect(f.x + Math.cos(a) * age * 30 - 1, f.y + Math.sin(a) * age * 30 - 1, 2, 2); } }
    }
    // glow (additive) for shots and explosions
    ctx.globalCompositeOperation = 'lighter';
    for (const b of st.bullets) this.glow(ctx, b.x, b.y - (b.z || 0), b.k === 2 || b.k === 5 ? 16 : b.k >= 8 ? 14 : 11, ['255,200,110', '255,150,60', '70,140,255', '255,60,50', '255,200,110', '70,140,255', '255,120,60', '255,170,90', '255,140,60', '120,200,255', '190,90,255', '175,95,255'][b.k] || '255,200,110', 0.55);
    for (const f of this.fx) if (f.k === 'big') { const age = (now - f.t) / 1000; if (age < 0.5) this.glow(ctx, f.x, f.y, f.s >= 2 ? 45 : 28, '255,150,50', 0.7 * (1 - age * 2)); }
    ctx.globalCompositeOperation = 'source-over';
    // the clouds themselves, over everything on the ground
    ctx.globalAlpha = 0.8;
    for (const c of clouds) ctx.drawImage(CL, c.f * 2 * 120, 0, 120, 80, Math.round(c.x), Math.round(c.y), 120, 80);
    ctx.globalAlpha = 1;
    // bombers: the shadow on the ground, the plane above everything (sprite nose points up-right)
    const AC = Assets.img['aircrafts.png'];
    for (const q of st.planes) {
      for (const [fr, ox, oy, al] of [[1, 26, 34, 0.45], [0, 0, 0, 1]]) {
        ctx.save(); ctx.globalAlpha = al; ctx.translate(Math.round(q.x + ox), Math.round(q.y + oy)); ctx.rotate(q.dir * Math.PI / 2);
        ctx.drawImage(AC, fr * 84, 0, 84, 84, -42, -42, 84, 84); ctx.restore();
      }
    }
    }
    // upscale the 1:1 world to the screen
    screen.setTransform(1, 0, 0, 1, 0, 0);
    screen.imageSmoothingEnabled = false;
    const src = this.scale2x(ww, wh);
    const k2 = src === this.wc ? 1 : 2;
    screen.drawImage(src, 0, 0, ww * k2, wh * k2, Math.round((ox - cx) * scale), Math.round((oy - cy) * scale), Math.round(ww * scale), Math.round(wh * scale));
    // names: small, crisp, above the health bars (drawn at screen resolution)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const fs = Math.max(9, Math.round(scale * 4.2));
    ctx.font = '600 ' + fs + 'px -apple-system, "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, fs / 4);
    for (const t of st.tanks) {
      let label = t.name || '';
      if (!label) continue;
      if (t.pid && t.lvl) label = t.lvl + ' · ' + label;                       // level next to the nick
      if (t.pid && st.snap.crown === t.pid) label = '👑 ' + label;               // the leader: a bounty on his head
      if (t.kind === 7) label = '🧠 ' + label;
      else if (t.kind >= 8 && t.kind <= 11) label = '⚙️ ' + label;
      else if (t.kind === 12) label = '💰 ' + label;
      else if (t.vet) label = '★'.repeat(t.vet) + ' ' + label;                 // veteran bots
      if (t.fl & 32 && !t.pid && t.team !== myTeam && t.team !== 6 && t.kind !== 7) continue;       // nameless enemy bots
      const sx = (t.x - cx) * scale, sy = (t.y - 18 - cy) * scale;
      if (sx < -50 || sx > W + 50 || sy < -20 || sy > H + 20) continue;
      ctx.globalAlpha = t.pid ? 0.95 : 0.7;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(label, sx, sy);
      ctx.fillStyle = t.pid === this.myPid ? '#ffffff' : teamColor(t.team); ctx.fillText(label, sx, sy);
    }
    ctx.globalAlpha = 1;
    this.st = st; this.view = { cx, cy, vw, vh, scale };
  }
  /** Scale2x on the GPU with the campaign's own shader (falls back to the plain 1:1 buffer) */
  scale2x(ww, wh) {
    if (this.g2 === undefined) {
      const h = window.__host;
      this.g2 = h && h.makeGL2x ? h.makeGL2x.call({ log() {} }) : null;
    }
    const g = this.g2; if (!g) return this.wc;
    if (ww > 1600 || wh > 1600) return this.wc;                 // the whole-map view of a giant map: plain pixels
    const gl = g.gl;
    if (gl.isContextLost()) { this.g2 = null; return this.wc; }
    if (g.cv.width !== ww * 2 || g.cv.height !== wh * 2) { g.cv.width = ww * 2; g.cv.height = wh * 2; }
    gl.viewport(0, 0, ww * 2, wh * 2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.wc);
    gl.uniform2i(g.uSz, ww, wh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return g.cv;
  }
  /** a few slow clouds per map (the same on every phone: they only depend on the map and the clock) */
  clouds(now) {
    const m = this.map, W = m.W * CELL + 300, H = m.H * CELL;
    const n = Math.max(2, Math.round(m.W * m.H / 260));
    const out = [], t = now / 1000;
    for (let i = 0; i < n; i++) {
      const a = Math.sin(i * 12.9898 + m.W * 78.233) * 43758.5453, r = a - Math.floor(a);
      const b = Math.sin(i * 39.346 + m.H * 11.135) * 24634.6345, q = b - Math.floor(b);
      const x = ((r * W + t * (5 + q * 4)) % W) - 150, y = q * (H + 60) - 60;
      out.push({ x, y, f: i % 3 });
    }
    return out;
  }
  /** lay one track mark per cell when a tank leaves it: straight or a corner, by where it came in and went out */
  updateTracks(tanks, now) {
    const m = this.map, seen = new Set();
    const lay = (cell, f) => { if (m.t[cell] === 0) this.trk.set(cell, { f, t: now }); };
    for (const t of tanks) {
      seen.add(t.id);
      if (t.kind === 3) continue;                                         // hover tanks (kamikaze) leave no tracks
      const cx = Math.floor(t.x / CELL), cy = Math.floor(t.y / CELL), cell = cy * m.W + cx;
      const s = this.tstate.get(t.id);
      const fx = t.x / CELL - cx, fy = t.y / CELL - cy;
      const past = [fy <= 0.5, fx >= 0.5, fy >= 0.5, fx <= 0.5][t.dir];   // the tank's centre has passed the middle of the cell
      if (!s) { this.tstate.set(t.id, { cell, cx, cy, inE: null }); continue; }
      if (s.cell === cell) { if ((t.fl & 1) && past && !this.trk.has(cell)) lay(cell, t.dir % 2 ? 0 : 4); continue; }
      const dx = cx - s.cx, dy = cy - s.cy;
      if (Math.abs(dx) + Math.abs(dy) === 1) {
        const out = dx > 0 ? 'R' : dx < 0 ? 'L' : dy > 0 ? 'B' : 'T';
        let inE = s.inE || OPP[out];
        if (inE === out) inE = OPP[out];
        const f = TRACK[inE + ',' + out];
        if (f !== undefined) lay(s.cell, f);

        this.tstate.set(t.id, { cell, cx, cy, inE: OPP[out] });
      } else this.tstate.set(t.id, { cell, cx, cy, inE: null });
    }
    for (const id of this.tstate.keys()) if (!seen.has(id)) this.tstate.delete(id);
  }
  drawWalls(ctx, c0, c1, r0, r1) {
    const m = this.map, WL = Assets.img['walls.png'], SP = Assets.img['spikes.png'];
    const T = E().T;
    for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) {
      const i = y * m.W + x, t = m.t[i]; if (!t || t === T.STRUCT) continue;
      const v = m.v[i], X = x * CELL, Y = y * CELL;
      if (t === T.CRATE) { const hp = m.hp[i]; const fr = hp >= 4 ? v : hp === 3 ? 2 + v : hp === 2 ? 4 + v : 6 + v; ctx.drawImage(WL, fr * 20, 0, 20, 20, X, Y, 20, 20); }
      else if (t === T.CONCRETE) { ctx.drawImage(WL, (8 + v) * 20, 0, 20, 20, X, Y, 20, 20); const hp = m.hp[i]; if (hp < 14) { ctx.fillStyle = 'rgba(0,0,0,' + (0.42 * (1 - hp / 14)).toFixed(2) + ')'; ctx.fillRect(X, Y, 20, 20); } }
      else if (t === T.ARMOR) ctx.drawImage(WL, 11 * 20, 0, 20, 20, X, Y, 20, 20);
      else if (t === T.TREE) ctx.drawImage(WL, (m.theme === 'desert' ? 13 + (i * 7) % 2 : 15 + (i * 7) % 3) * 20, 0, 20, 20, X, Y, 20, 20);
      else if (t === T.HEDGE) ctx.drawImage(SP, (i % 3) * 20, 0, 20, 20, X, Y, 20, 20);
    }
  }
  bar(ctx, x, y, f, team, w) {
    const img = Assets.img[team === 0 ? 'health_yell.png' : 'health_red.png'];
    const n = Math.max(0, Math.min(11, Math.round(f * 11)));
    ctx.drawImage(img, n * 24, 0, 24, 4, x - w / 2, y, w, 3);
  }
  glow(ctx, x, y, r, col, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(' + col + ',' + a.toFixed(2) + ')'); g.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  myTeam() { if (!this.last) return 0; const t = this.last.k.find(q => q[9] === this.myPid); if (t) return t[7]; const r = this.roster && this.roster.find(p => p.pid === this.myPid); return r ? r.team : 0; }

  /** small map in the corner */
  drawMini(c) {
    if (!this.map || !this.st) return;
    const m = this.map, x = c.getContext('2d');
    const s = Math.max(1, Math.floor(Math.min(c.width / m.W, c.height / m.H)));
    if (c._w !== m.W * s || c._h !== m.H * s) { c.width = m.W * s; c.height = m.H * s; c._w = c.width; c._h = c.height; }
    const T = E().T;
    // the terrain is drawn once into its own canvas and again only when walls change (big maps have 10 000 cells)
    if (!this.miniT || this.miniT.width !== c.width || this.miniT.height !== c.height || this.miniDirty) {
      if (!this.miniT) this.miniT = document.createElement('canvas');
      this.miniT.width = c.width; this.miniT.height = c.height; this.miniDirty = false;
      const y = this.miniT.getContext('2d');
      const col = { [T.CRATE]: '#7a5530', [T.CONCRETE]: '#9a9a90', [T.ARMOR]: '#4a5560', [T.HEDGE]: '#3a3a3a', [T.TREE]: '#173a17' };
      y.fillStyle = m.theme === 'desert' ? '#8a7448' : '#3b5a26'; y.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < m.W * m.H; i++) { const t = m.t[i]; if (t && col[t]) { y.fillStyle = col[t]; y.fillRect((i % m.W) * s, ((i / m.W) | 0) * s, s, s); } }
    }
    x.clearRect(0, 0, c.width, c.height); x.drawImage(this.miniT, 0, 0);
    for (const [, type, sx, sy, , , team] of this.st.structs) { x.fillStyle = teamColor(team); x.fillRect(sx * s, sy * s, s * (type === 0 ? 2 : 1), s * (type === 0 ? 2 : 1)); }
    const myTeam = this.myTeam();
    const radar = this.me && this.me.gear && this.me.gear.radar;
    for (const t of this.st.tanks) { if (!radar && t.team !== myTeam && t.pid !== this.myPid) continue; x.fillStyle = t.pid === this.myPid ? '#fff' : teamColor(t.team); const r = t.pid ? s * 1.6 : s * 1.1; x.fillRect(t.x / CELL * s - r / 2, t.y / CELL * s - r / 2, r, r); }
    for (const [, type, px, py] of this.st.picks) if (type === 7 && Math.floor(performance.now() / 300) % 2) { x.fillStyle = '#ffd84a'; x.fillRect(px * s - s, py * s - s, s * 3, s * 3); }
    for (const [team, fx, fy] of this.st.flags) { x.fillStyle = team ? '#6aa8ff' : '#ffd84a'; x.fillRect(fx / CELL * s - s, fy / CELL * s - s * 2, s * 1.2, s * 2); }
    if (this.view && !this.bigMap) { x.strokeStyle = 'rgba(255,255,255,0.6)'; x.lineWidth = 1; x.strokeRect(this.view.cx / CELL * s, this.view.cy / CELL * s, this.view.vw / CELL * s, this.view.vh / CELL * s); }
  }
}

window.MPRender = { View, Assets, teamColor };
})();
