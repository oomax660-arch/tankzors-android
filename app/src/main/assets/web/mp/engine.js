/* Multiplayer battle simulation. Runs on the host only; the others get snapshots (see snapshot()).
 * Grid of 20 px cells like the original game; tanks move in 4 directions, turrets aim freely.
 */
'use strict';
(function () {
const CELL = 20, HALF = 10, TR = 8;                       // tank half-size (16 px body in a 20 px lane)
const DT = 1 / 30;
const T = { EMPTY: 0, CRATE: 1, CONCRETE: 2, ARMOR: 3, HEDGE: 4, TREE: 5, STRUCT: 6 };
const TILE_HP = [0, 3, 10, 0, 0, 0, 0];
const SOLID_TANK = [false, true, true, true, true, true, true];
const SOLID_SHOT = [false, true, true, true, false, true, true];
const AI_TEAM = 5, WILD_TEAM = 6;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];        // 0 up, 1 right, 2 down, 3 left

/* Damage is in the original game's units: a shell takes 1 HP. A light tank needs 6 hits. */
const KINDS = {
  light:    { hp: 6,  speed: 72,  reload: 0.42, dmg: 1, shot: 250, splash: 0 },
  heavy:    { hp: 12, speed: 50,  reload: 0.55, dmg: 1, shot: 240, splash: 0, pierce: 1 },
  siege:    { hp: 8,  speed: 54,  reload: 1.1,  dmg: 2, shot: 210, splash: 1 },
  kamikaze: { hp: 4,  speed: 96,  reload: 9,    dmg: 0, shot: 0,   splash: 0, boom: 7 },
  rapid:    { hp: 5,  speed: 68,  reload: 0.16, dmg: 1, shot: 265, splash: 0 },          // «скорострел»: очередь снарядов
  fast:     { hp: 5,  speed: 128, reload: 0.5,  dmg: 1, shot: 260, splash: 0 },          // «быстроход»: очень быстро ездит
  builder:  { hp: 6,  speed: 100, reload: 0.7,  dmg: 1, shot: 240, splash: 0 },          // «строитель»: собирает монеты и укрепляет базу
  brain:    { hp: 10, speed: 82,  reload: 0.3,  dmg: 1, shot: 270, splash: 0, pierce: 1 }, // «интеллектуал»: планирует атаки и командует ботами
  // hybrids: two bots in one hull (expensive)
  fastHeavy:  { hp: 12, speed: 118, reload: 0.5,  dmg: 1, shot: 255, splash: 0, pierce: 1 },   // «Таран»: быстроход + тяжёлый
  rapidHeavy: { hp: 13, speed: 56,  reload: 0.17, dmg: 1, shot: 262, splash: 0, pierce: 1 },   // «Крепость»: скорострел + тяжёлый
  fastRapid:  { hp: 6,  speed: 122, reload: 0.17, dmg: 1, shot: 265, splash: 0 },              // «Шквал»: быстроход + скорострел
  titan:      { hp: 16, speed: 112, reload: 0.17, dmg: 1, shot: 270, splash: 0, pierce: 1 },   // «Титан»: все три сразу
  rogue:      { hp: 16, speed: 288, reload: 0.35, dmg: 1, shot: 300, splash: 0, pierce: 1 },   // «мошенник»: вчетверо быстрее лёгкого, собирает всё
};
const HYBRIDS = { botFastHeavy: ['fastHeavy', 'Таран'], botRapidHeavy: ['rapidHeavy', 'Крепость'], botFastRapid: ['fastRapid', 'Шквал'], botTitan: ['titan', 'Титан'] };
const BOTLEVEL = [
  { think: 0.34, aim: 3, dodge: 0.1, fireMul: 1.4, lead: false, hpMul: 0.85 },
  { think: 0.2, aim: 4, dodge: 0.45, fireMul: 1.1, lead: false, hpMul: 1.0 },
  { think: 0.12, aim: 5, dodge: 0.8, fireMul: 1.0, lead: true, hpMul: 1.15 },
];
/* ---- progression: everybody starts equal and grows during the battle ----
 * XP (damage, kills, building, objectives) -> level 1..10 -> one skill point per level.
 * 5 skills x 3 steps = 15 steps, but only 9 points: a player has to choose a role
 * (tank / engineer / commander). Coins buy tanks, buildings and bots; levels and skills unlock them. */
const XP_LEVELS = [0, 50, 120, 210, 320, 450, 600, 780, 1000, 1250];     // XP needed for level i+1
const MAX_LEVEL = 10;
const SKILLS = [
  { id: 'armor', name: 'Броня', steps: ['+20% прочности', '+40% прочности', '+60% прочности, ремкомплект чинит 75%'] },
  { id: 'engine', name: 'Двигатель', steps: ['+8% скорости', '+16% скорости', '+24% скорости, бонусы действуют дольше'] },
  { id: 'gun', name: 'Орудие', steps: ['перезарядка −10%', 'перезарядка −20%', 'перезарядка −25%, снаряды пробивают встречные'] },
  { id: 'eng', name: 'Инженер', steps: ['стройка −15%, +1 пушка', 'стройка −30%, стены крепче', 'стройка −40%, +2 пушки, ремонт радара вдвое дешевле'] },
  { id: 'cmd', name: 'Командир', steps: ['+2 бота', '+2 бота, тяжёлые боты', '+2 бота, ваши боты крепче и метче'] },
];
const TANKS = {
  light: { name: 'Лёгкий', lvl: 1, cost: 0, about: 'быстрый, слабая броня' },
  fast: { name: 'Быстроход', lvl: 2, cost: 70, about: 'почти вдвое быстрее, броня чуть слабее' },
  rapid: { name: 'Скорострел', lvl: 3, cost: 100, about: 'стреляет очередями, броня чуть слабее' },
  heavy: { name: 'Тяжёлый', lvl: 3, cost: 120, about: 'вдвое крепче, медленнее, снаряды пробивают встречные' },
  siege: { name: 'Осадный', lvl: 5, cost: 200, about: 'ракеты с взрывом по площади, долгая перезарядка' },
  fastRapid: { name: 'Гибрид «Шквал»', lvl: 5, cost: 260, about: 'быстроход + скорострел: почти вдвое быстрее и стреляет очередями' },
  fastHeavy: { name: 'Гибрид «Таран»', lvl: 6, cost: 320, about: 'быстроход + тяжёлый: броня тяжёлого на скорости быстрохода' },
  rapidHeavy: { name: 'Гибрид «Крепость»', lvl: 6, cost: 340, about: 'скорострел + тяжёлый: самая толстая броня и очереди, но медленный' },
  titan: { name: 'Гибрид «Титан»', lvl: 8, cost: 600, about: 'все три сразу: крепкий, быстрый, бьёт очередями' },
};
const BUILD = [
  { id: 'crate', name: 'Ящик', cost: 5, lvl: 1, about: 'дешёвая стена, 4 попадания' },
  { id: 'concrete', name: 'Бетон', cost: 15, lvl: 2, about: 'прочная стена, 14 попаданий' },
  { id: 'wild', name: 'Дикий бот', cost: 15, lvl: 2, about: 'бьёт всех подряд — и вас тоже' },
  { id: 'bot', name: 'Бот-союзник', cost: 40, lvl: 2, about: 'лёгкий танк под вашим командованием' },
  { id: 'turret', name: 'Пушка', cost: 50, lvl: 3, about: 'сама стреляет по врагам рядом' },
  { id: 'botRapid', name: 'Бот-скорострел', cost: 55, lvl: 3, about: 'стреляет очередями, но броня слабая' },
  { id: 'botFast', name: 'Бот-быстроход', cost: 45, lvl: 3, about: 'носится почти вдвое быстрее, хорош для захвата флага' },
  { id: 'botHeavy', name: 'Тяжёлый бот', cost: 80, lvl: 4, cmd: 2, about: 'вдвое крепче обычного бота' },
  { id: 'botBrain', name: 'Бот-интеллектуал', cost: 120, lvl: 4, about: 'самый умный: строит план атаки (обход с двух флангов в обход пушек, сбор и общий удар), командует вашими ботами и сосредотачивает огонь. Один на игрока' },
  { id: 'botBuilder', name: 'Бот-строитель', cost: 50, lvl: 2, about: 'быстро ездит, собирает монеты и сам укрепляет вашу базу стенами — проходы оставляет' },
  { id: 'botFastRapid', name: 'Гибрид «Шквал»', cost: 180, lvl: 4, hybrid: true, about: 'быстроход + скорострел: носится почти вдвое быстрее и стреляет очередями' },
  { id: 'botFastHeavy', name: 'Гибрид «Таран»', cost: 220, lvl: 4, hybrid: true, about: 'быстроход + тяжёлый: броня тяжёлого на скорости быстрохода, снаряды пробивают встречные' },
  { id: 'botRapidHeavy', name: 'Гибрид «Крепость»', cost: 240, lvl: 5, hybrid: true, about: 'скорострел + тяжёлый: самая толстая броня и очереди снарядов, но медленный' },
  { id: 'botTitan', name: 'Гибрид «Титан»', cost: 420, lvl: 6, hybrid: true, about: 'быстроход + тяжёлый + скорострел сразу: крепкий, быстрый и бьёт очередями' },
  { id: 'botRogue', name: 'Бот-мошенник', cost: 300, lvl: 4, about: 'носится вчетверо быстрее, сам ищет по всей карте монеты, ящики, звёзды и сбросы и приносит ВДВОЕ больше денег. Крепкая броня, обходит врагов, отстреливается. Не больше двух' },
];
/* ---- arsenal: everything the campaign's workshop sells, bought with coins at your own base ----
 * icon = frame of icons.png (19 px). Every kind of ammunition holds up to 99. */
const WEAPONS = [
  { id: 'shell',   name: 'Снаряд', icon: 4, lvl: 1, cost: 0, pack: 0, cap: 0, type: 'shot', about: 'обычный снаряд танка, не кончается' },
  { id: 'plasma',  name: 'Плазма', icon: 5, lvl: 1, cost: 8, pack: 10, cap: 99, type: 'shot', dmg: 1, reload: 0.75, speed: 1.3, vis: 2, about: 'урон 1, перезарядка на четверть быстрее, летит быстрее' },
  { id: 'vplasma', name: 'Фиолетовая плазма', icon: 7, lvl: 1, cost: 14, pack: 10, cap: 99, type: 'shot', dmg: 1, reload: 0.85, speed: 1.2, vis: 10, bounce: 4, about: 'урон 1, ОТСКАКИВАЕТ от стен (до 4 раз) — бейте из-за угла' },
  { id: 'dshell',  name: 'Двойной снаряд', icon: 6, lvl: 2, cost: 12, pack: 10, cap: 99, type: 'shot', dmg: 2, pierce: 1, vis: 4, about: 'урон 2; при встрече со снарядом гибнет только один из двух' },
  { id: 'dplasma', name: 'Двойная плазма', icon: 7, lvl: 2, cost: 16, pack: 10, cap: 99, type: 'shot', dmg: 2, pierce: 1, reload: 0.75, speed: 1.3, vis: 5, about: 'урон 2 и быстрая перезарядка' },
  { id: 'ap',      name: 'Бронебойный', icon: 15, lvl: 3, cost: 20, pack: 5, cap: 99, type: 'shot', dmg: 3, pierce: 2, vis: 6, about: 'урон 3; встречный снаряд отнимает 1, но бронебойный летит дальше' },
  { id: 'ap2',     name: 'Усиленный бронебойный', icon: 16, lvl: 4, cost: 30, pack: 5, cap: 99, type: 'shot', dmg: 5, pierce: 3, vis: 6, about: 'урон 5, пробивает встречные снаряды' },
  { id: 'art',     name: 'Артиллерия', icon: 9, lvl: 2, cost: 20, pack: 3, cap: 99, type: 'art', dmg: 5, r: 1.5, range: 5, about: 'летит НАД стенами на 5 клеток вперёд, взрыв по площади, уничтожает мины' },
  { id: 'warhead', name: 'Боеголовка', icon: 8, lvl: 3, cost: 24, pack: 2, cap: 99, type: 'rocket', dmg: 6, r: 1.5, about: 'ракета на любую дальность, мощный взрыв; бетон и ежи не берёт' },
  { id: 'guided',  name: 'Управляемая ракета', icon: 17, lvl: 4, cost: 60, pack: 1, cap: 99, type: 'guided', dmg: 8, r: 1.5, about: 'рулите стрелками, повторный «огонь» — подрыв. Сносит бетон с одного взрыва и единственное ломает БРОНЕПЛИТЫ' },
  { id: 'mine5',   name: 'Мина ТМД-5', icon: 10, lvl: 1, cost: 12, pack: 3, cap: 99, type: 'mine', dmg: 4, about: 'ставится под танк; враги её не видят (кроме тепловизора)' },
  { id: 'mine9',   name: 'Мина ТМД-9', icon: 18, lvl: 3, cost: 20, pack: 3, cap: 99, type: 'mine', dmg: 7, about: 'мощная мина' },
  { id: 'dyn70',   name: 'Динамит x70', icon: 11, lvl: 2, cost: 14, pack: 2, cap: 99, type: 'dyn', dmg: 4, r: 1.5, about: 'взрыв через 5 с; рушит ящики, ежи и мины' },
  { id: 'dyn100',  name: 'Динамит x100', icon: 19, lvl: 3, cost: 22, pack: 2, cap: 99, type: 'dyn', dmg: 6, r: 2, about: 'взрыв через 5 с, больше площадь' },
  { id: 'dyn160',  name: 'Динамит x160', icon: 20, lvl: 4, cost: 35, pack: 2, cap: 99, type: 'dyn', dmg: 9, r: 3, about: 'огромный взрыв через 5 с' },
  { id: 'air',     name: 'Авиаудар', icon: 22, lvl: 4, cost: 50, pack: 1, cap: 99, type: 'air', dmg: 4, r: 1.5, about: 'бомбардировщик кладёт 5 бомб по диагонали перед танком; нужен радар' },
  { id: 'boost',   name: 'Ускорение', icon: 13, lvl: 1, cost: 10, pack: 2, cap: 99, type: 'boost', about: '8 с едете быстрее и быстрее стреляете' },
  { id: 'hplasma', name: 'Плазма-охотник', icon: 23, lvl: 5, cost: 160, pack: 1, cap: 99, type: 'homing', dmg: 7, about: 'САМАЯ МОЩНАЯ: один выстрел — 4 заряда, они сами находят врагов (даже за стеной) и бьют наповал' },
  { id: 'freeze',  name: 'Заморозка', icon: 12, lvl: 3, cost: 40, pack: 1, cap: 99, type: 'freeze', about: 'враги, пушки и их снаряды в 8 клетках замирают на 4 с' },
];
const GEAR = [
  { id: 'kit',      name: 'Ремкомплект', icon: 26, lvl: 1, cost: 8, max: 5, about: 'ремонт вдали от базы кнопкой «ремонт»: +50% прочности' },
  { id: 'tarmor',   name: 'Временная броня', icon: 24, lvl: 1, cost: 8, max: 5, about: '+1 брони (золотая полоска): броня светится и принимает удары первой; при гибели теряется 1' },
  { id: 'parmor',   name: 'Постоянная броня', icon: 25, lvl: 2, cost: 25, max: 4, about: '+1 брони навсегда — не пропадает при гибели' },
  { id: 'field',    name: 'Силовое поле', icon: 23, lvl: 2, cost: 15, max: 6, about: '+1 синей прочности; поле само восстанавливается, при гибели пропадает' },
  { id: 'radar',    name: 'Радар', icon: 28, lvl: 1, cost: 20, max: 1, about: 'враги на мини-карте; нужен для авиаудара' },
  { id: 'thermo',   name: 'Тепловизор', icon: 29, lvl: 2, cost: 20, max: 3, about: 'чужие мины видно дальше: 2 клетки + 1 за уровень' },
  { id: 'chassis',  name: 'Улучшенное шасси', icon: 21, lvl: 3, cost: 50, max: 1, about: '+2 брони, танк на 10% быстрее, ускорение и заморозка дольше' },
  { id: 'life',     name: 'Запасная жизнь', icon: 2, lvl: 2, cost: 25, max: 2, about: 'после гибели — сразу снова в бою, броня и поле сохраняются' },
  { id: 'interest', name: 'Доп. процент', icon: 1, lvl: 1, cost: 30, max: 3, about: 'раз в минуту +5% к вашим монетам за уровень (до 10●)' },
];
const WIDX = {}; WEAPONS.forEach((w, i) => { WIDX[w.id] = i; });
const START_COINS = 20;
const SIZE_K = [1.15, 1.7, 2.3, 3.0];            // map size: маленькая, средняя, большая, огромная
const AMMO_CAP = 99;
const MAP_TARGET = [26, 44, 62, 84];
const ROGUE_BAG = 8;                            // the rogue carries this many coins, then takes them home (×2)             // campaign maps as battlefields: about this many cells across                             // every kind of ammunition: up to 99
const ORDERS = ['attack', 'defend', 'follow'];
const ORDER_NAMES = { attack: 'атака', defend: 'оборона', follow: 'за мной' };

function rng(seed) { let s = seed >>> 0 || 1; return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* =============================================================== maps */
class Grid {
  constructor(w, h) {
    this.W = w; this.H = h;
    this.t = new Uint8Array(w * h);       // tile type
    this.hp = new Int16Array(w * h);
    this.g = new Uint8Array(w * h);       // ground frame (ground.png)
    this.v = new Uint8Array(w * h);       // wall variant
    this.sid = new Int32Array(w * h).fill(-1);   // structure id on the cell
    this.own = new Int8Array(w * h);             // team + 1 that built this wall (0 = part of the map)
  }
  in(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  at(x, y) { return this.in(x, y) ? this.t[y * this.W + x] : T.ARMOR; }
  set(x, y, type, v) {
    if (!this.in(x, y)) return;
    const i = y * this.W + x; this.t[i] = type; this.hp[i] = TILE_HP[type]; this.v[i] = v || 0; this.own[i] = 0;
  }
}

function makeGround(G, theme, r) {
  // like the campaign maps: random base tiles, small single details and 2x2 pieces (sand patches, grass tufts)
  const desert = theme === 'desert';
  const base = desert ? [55, 56, 57, 58, 59] : [0, 1, 2, 3, 4, 5];
  const single = desert ? [75, 76, 77, 78, 82, 83, 86, 88] : [6, 7, 8, 9, 22, 100, 101, 104, 105];
  const quads = desert ? [] : [[10, 11, 12, 13], [14, 15, 16, 17], [18, 19, 20, 21]];
  for (let i = 0; i < G.W * G.H; i++) G.g[i] = r() < 0.04 ? single[(r() * single.length) | 0] : base[(r() * base.length) | 0];
  const n = quads.length ? Math.round(G.W * G.H / 60) : 0;
  for (let k = 0; k < n; k++) {
    const q = quads[(r() * quads.length) | 0], x = (r() * (G.W - 1)) | 0, y = (r() * (G.H - 1)) | 0;
    G.g[y * G.W + x] = q[0]; G.g[y * G.W + x + 1] = q[1]; G.g[(y + 1) * G.W + x] = q[2]; G.g[(y + 1) * G.W + x + 1] = q[3];
  }
}
function border(G) {
  for (let x = 0; x < G.W; x++) { G.set(x, 0, T.TREE); G.set(x, G.H - 1, T.TREE); }
  for (let y = 0; y < G.H; y++) { G.set(0, y, T.TREE); G.set(G.W - 1, y, T.TREE); }
}
/* ---- campaign maps as battlefields: the game's NNN.map files */
function campaignMapBytes(n) {
  const F = (typeof window !== 'undefined' && window.GAME_FILES) || {};
  const b64 = F[String(n).padStart(3, '0') + '.map'];
  if (!b64) return null;
  const bin = atob(b64), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
function parseCampaignMap(d) {
  try {
    let i = 2; const n = d[i]; i += 1;
    let title = ''; for (let k = 0; k + 1 < n; k += 2) title += String.fromCharCode((d[i + k] << 8) | d[i + k + 1]);
    i += n;
    const W = d[i], H = d[i + 1], pn = d[i + 2]; i += 3 + pn + 1;
    const tiles = d.subarray(i, i + W * H);
    if (tiles.length < W * H) return null;
    return { W, H, title, tiles };
  } catch (e) { return null; }
}
/** the campaign maps big enough for a battle: [{n, W, H}] */
function campaignMaps() {
  const out = [];
  for (let n = 0; n < 60; n++) { const d = campaignMapBytes(n); if (!d) continue; const m = parseCampaignMap(d); if (m && m.W >= 14 && m.H >= 14) out.push({ n, W: m.W, H: m.H, tiles: m.tiles }); }
  return out;
}
function rect(G, x0, y0, x1, y1, type, fillGate) {
  for (let x = x0; x <= x1; x++) { G.set(x, y0, type); G.set(x, y1, type); }
  for (let y = y0; y <= y1; y++) { G.set(x0, y, type); G.set(x1, y, type); }
}
function clearArea(G, x0, y0, x1, y1) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (G.in(x, y) && G.at(x, y) !== T.TREE) G.set(x, y, T.EMPTY); }
/** scatter symmetric obstacles: `sym` maps one cell to its symmetric copies */
function scatter(G, r, n, sym, keepOut) {
  const types = [T.CRATE, T.CRATE, T.CRATE, T.CONCRETE, T.CONCRETE, T.HEDGE, T.ARMOR];
  for (let k = 0; k < n; k++) {
    const type = types[(r() * types.length) | 0];
    const len = 1 + ((r() * 3) | 0), horiz = r() < 0.5;
    const x0 = 1 + ((r() * (G.W - 2)) | 0), y0 = 1 + ((r() * (G.H - 2)) | 0);
    for (let i = 0; i < len; i++) {
      const x = x0 + (horiz ? i : 0), y = y0 + (horiz ? 0 : i);
      for (const [sx, sy] of sym(x, y)) if (G.in(sx, sy) && G.at(sx, sy) === T.EMPTY && !keepOut(sx, sy)) G.set(sx, sy, type, (r() * 2) | 0);
    }
  }
}

/* =============================================================== game */
class Game {
  /**
   * cfg: {mode, size: 0..2, theme, botLevel: 0..2, bots, waves, truce, wild, ff, seed}
   * roster: [{pid, name, team, kind}]
   */
  constructor(cfg, roster) {
    this.cfg = Object.assign({ mode: 'defense', size: 1, theme: 'grass', botLevel: 1, bots: 2, waves: 10, truce: 120, wild: false, ff: false, startLevel: 1, xpRate: 1, seed: Date.now() & 0xffff }, cfg);
    this.r = rng(this.cfg.seed);
    this.time = 0; this.nextId = 1;
    this.tanks = []; this.bullets = []; this.structs = []; this.pickups = []; this.flags = [];
    this.mines = []; this.dyns = []; this.planes = [];
    this.players = new Map(); this.events = []; this.tileChanges = new Map();
    this.flowCache = new Map(); this.tilesDirty = true;
    this.over = null;
    this.feed = [];
    this.teamInfo = {};       // team -> {hq, spawns:[], score, alive}
    this.botSlots = [];       // permanent bots that come back after a while
    this.lv = BOTLEVEL[clamp(this.cfg.botLevel | 0, 0, 2)];
    const n = roster.length;
    this.nPlayers = n;
    const M = { defense: this.genDefense, assault: this.genAssault, bases: this.genBases, ctf: this.genCTF, ffa: this.genFFA }[this.cfg.mode] || this.genDefense;
    M.call(this, roster);
    for (const p of roster) this.addPlayer(p);
    this.modeInit();
  }

  /* ------------------------------------------------ helpers */
  id() { return this.nextId++; }
  ev(e) { this.events.push(e); }
  say(text, team) { this.ev({ e: 'msg', text, team: team === undefined ? -1 : team }); }
  tileChanged(i) { this.tileChanges.set(i, 1); this.tilesDirty = true; }
  cellOf(x) { return Math.floor(x / CELL); }
  hostile(a, b) {
    if (a === b) return a === WILD_TEAM;
    return true;
  }
  addTeam(team) { if (!this.teamInfo[team]) this.teamInfo[team] = { hq: null, spawns: [], score: 0, out: false }; return this.teamInfo[team]; }

  /* ------------------------------------------------ map generators */
  /* maps are big: «средняя» is what used to be the largest, «огромная» and «гигантская» are 2.5-3 times that */
  sizeFor(base) { return Math.round(base * SIZE_K[clamp(this.cfg.size | 0, 0, SIZE_K.length - 1)]) + Math.max(0, this.nPlayers - 2) * 3; }

  genDefense(roster) {
    const W = this.sizeFor(20), H = this.sizeFor(26), r = this.r;
    const G = this.G = new Grid(W, H); makeGround(G, this.cfg.theme, r); border(G);
    const cx = (W >> 1) - 1, hy = H - 4;
    const keep = (x, y) => (Math.abs(x - cx) < 5 && y > H - 9) || y < 4 || Math.abs(x - (W >> 1)) < 2;
    scatter(G, r, (W * H) / 24 | 0, (x, y) => [[x, y], [W - 1 - x, y]], keep);
    // the base: HQ inside a crate ring with three openings
    rect(G, cx - 3, hy - 3, cx + 4, H - 1, T.CRATE);
    clearArea(G, cx - 2, hy - 2, cx + 3, H - 2);
    G.set(cx, hy - 3, T.EMPTY); G.set(cx + 1, hy - 3, T.EMPTY); G.set(cx - 3, hy, T.EMPTY); G.set(cx + 4, hy, T.EMPTY);
    for (let x = 0; x < W; x++) G.set(x, H - 1, T.TREE);
    const ti = this.addTeam(0);
    ti.hq = this.addStruct('hq', cx, hy, 0);
    ti.spawns = [[cx - 2, hy - 2], [cx + 3, hy - 2], [cx - 2, hy + 1], [cx + 3, hy + 1]];
    const ai = this.addTeam(AI_TEAM);
    ai.spawns = [];
    const nSp = Math.max(3, Math.round(W / 14));
    for (let k = 0; k < nSp; k++) ai.spawns.push([Math.round(2 + (W - 5) * k / (nSp - 1)), 1]);
    for (const [x, y] of ai.spawns) clearArea(G, x - 1, y, x + 1, y + 2);
  }

  genAssault(roster) {
    const W = this.sizeFor(30), H = this.sizeFor(40), r = this.r;
    const G = this.G = new Grid(W, H); makeGround(G, this.cfg.theme, r); border(G);
    const cx = (W >> 1) - 1;
    // AI fortress in the north: outer concrete ring with armour bastions, inner crate ring, HQ in the middle
    const fw = Math.min(W - 7, 36), fx0 = (W - fw) >> 1, fx1 = fx0 + fw, fy0 = 2, fy1 = Math.round(Math.min(H * 0.42, 26));
    const keep = (x, y) => (y <= fy1 + 2 && x >= fx0 - 2 && x <= fx1 + 2) || y > H - 8;
    scatter(G, r, (W * H) / 30 | 0, (x, y) => [[x, y], [W - 1 - x, y]], keep);
    rect(G, fx0, fy0, fx1, fy1, T.CONCRETE);
    for (const [x, y] of [[fx0, fy0], [fx1, fy0], [fx0, fy1], [fx1, fy1]]) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (G.in(x + dx, y + dy) && G.at(x + dx, y + dy) !== T.TREE) G.set(x + dx, y + dy, T.ARMOR);
    const ix0 = fx0 + 4, ix1 = fx1 - 4, iy0 = fy0 + 3, iy1 = fy1 - 3;
    rect(G, ix0, iy0, ix1, iy1, T.CRATE);
    // gates: south (wide), east, west; inner gates offset so there is no straight line to the HQ
    const gates = [[cx, fy1], [cx + 1, fy1], [cx + 2, fy1], [cx - 1, fy1], [fx0, (fy0 + fy1) >> 1], [fx1, (fy0 + fy1) >> 1]];
    for (const [x, y] of gates) G.set(x, y, T.EMPTY);
    G.set(ix0 + 2, iy1, T.EMPTY); G.set(ix1 - 2, iy1, T.EMPTY); G.set(ix0, iy0 + 2, T.EMPTY); G.set(ix1, iy0 + 2, T.EMPTY);
    // inner yard: a few concrete pillboxes
    for (let k = 0; k < 6; k++) { const x = ix0 + 2 + ((r() * (ix1 - ix0 - 4)) | 0), y = iy0 + 2 + ((r() * (iy1 - iy0 - 4)) | 0); if (Math.abs(x - cx) > 2 || Math.abs(y - ((iy0 + iy1) >> 1)) > 2) G.set(x, y, T.CONCRETE); }
    const ai = this.addTeam(AI_TEAM);
    const hqy = (iy0 + iy1) >> 1;
    clearArea(G, cx - 1, hqy - 1, cx + 2, hqy + 2);
    ai.hq = this.addStruct('hq', cx, hqy, AI_TEAM, 100 + 30 * this.nPlayers);
    ai.spawns = [[cx - 3, hqy], [cx + 4, hqy], [cx, iy0 + 1]];
    // turrets: at the gates and on the walls' inner side
    const tp = [[cx - 2, fy1 - 1], [cx + 3, fy1 - 1], [fx0 + 2, ((fy0 + fy1) >> 1) - 2], [fx1 - 2, ((fy0 + fy1) >> 1) + 2], [ix0 + 1, iy1 - 1], [ix1 - 1, iy1 - 1], [cx - 3, hqy - 2], [cx + 4, hqy + 2]];
    const nT = Math.min(tp.length, 4 + this.nPlayers + this.cfg.botLevel);
    for (let k = 0; k < nT; k++) { const [x, y] = tp[k]; G.set(x, y, T.EMPTY); this.addStruct('turret', x, y, AI_TEAM); }
    // guard posts for the defenders
    this.guardPosts = [[cx, fy1 - 2], [cx + 1, fy1 - 2], [fx0 + 2, (fy0 + fy1) >> 1], [fx1 - 2, (fy0 + fy1) >> 1], [ix0 + 2, iy1 - 2], [ix1 - 2, iy1 - 2], [cx - 2, hqy + 2], [cx + 3, hqy - 1], [cx, iy0 + 1], [ix0 + 2, iy0 + 2]];
    // players' camp in the south with a small HQ
    const py = H - 4;
    clearArea(G, cx - 4, py - 3, cx + 5, H - 2);
    const ti = this.addTeam(0);
    ti.hq = this.addStruct('hq', cx, py, 0, 50);
    ti.spawns = [[cx - 3, py], [cx + 4, py], [cx - 3, py - 2], [cx + 4, py - 2]];
    for (const [x, y] of [[cx - 4, py - 3], [cx + 5, py - 3], [cx - 4, py + 1], [cx + 5, py + 1]]) G.set(x, y, T.CRATE);
    // the fortress blueprint (the AI rebuilds it)
    this.blueprint = [];
    for (let y = fy0 - 1; y <= fy1 + 1; y++) for (let x = fx0 - 1; x <= fx1 + 1; x++) { const t = G.at(x, y); if (t === T.CRATE || t === T.CONCRETE) this.blueprint.push([x, y, t]); }
    this.fort = { x0: fx0, y0: fy0, x1: fx1, y1: fy1 };
  }

  teamsOf(roster) { return Array.from(new Set(roster.map(p => p.team))).sort(); }

  genBases(roster) {
    const teams = this.teamsOf(roster);
    const nt = Math.max(2, teams.length);
    const r = this.r, cg = this.campaignGrid();
    let W, H, G;
    if (cg) { G = this.G = cg; W = G.W; H = G.H; }
    else { const S = this.sizeFor(nt > 2 ? 30 : 26); W = S; H = nt > 2 ? S : S + 8; G = this.G = new Grid(W, H); makeGround(G, this.cfg.theme, r); border(G); }
    // HQ corners: 2 teams -> north/south, 3-4 -> corners (4-fold symmetry)
    const spots = nt > 2 ? [[4, 4], [W - 6, H - 6], [W - 6, 4], [4, H - 6]] : [[(W >> 1) - 1, 3], [(W >> 1) - 1, H - 5]];
    const sym = nt > 2 ? (x, y) => [[x, y], [W - 1 - x, y], [x, H - 1 - y], [W - 1 - x, H - 1 - y]] : (x, y) => [[x, y], [W - 1 - x, H - 1 - y]];
    const near = (x, y) => spots.some(([sx, sy]) => Math.abs(x - sx - 0.5) < 5 && Math.abs(y - sy - 0.5) < 5);
    if (!cg) scatter(G, r, (W * H) / 30 | 0, sym, near);
    const allTeams = teams.length >= 2 ? teams : [teams[0] || 0, (teams[0] || 0) === 0 ? 1 : 0];
    allTeams.forEach((team, i) => {
      const [x, y] = spots[i];
      clearArea(G, x - 3, y - 3, x + 4, y + 4);
      // a small starting wall around each HQ
      for (const [dx, dy] of [[-2, -2], [-1, -2], [2, -2], [3, -2], [-2, 3], [-1, 3], [2, 3], [3, 3]]) G.set(x + dx, y + dy, T.CRATE);
      const ti = this.addTeam(team);
      ti.hq = this.addStruct('hq', x, y, team, 85);
      // one starting turret in front of every base
      const tx = x + (x < W / 2 ? 3 : -2), ty = y + (y < H / 2 ? 3 : -2);
      if (G.in(tx, ty)) { G.set(tx, ty, T.EMPTY); this.addStruct('turret', tx, ty, team); }
      ti.spawns = [[x - 2, y], [x + 3, y], [x, y - 2], [x + 1, y + 3]].filter(([sx, sy]) => G.in(sx, sy));
      for (const [sx, sy] of ti.spawns) G.set(sx, sy, T.EMPTY);
    });
    this.mid = [W >> 1, H >> 1];
    clearArea(G, (W >> 1) - 2, (H >> 1) - 2, (W >> 1) + 1, (H >> 1) + 1);
    if (cg) this.openUp();
  }

  genCTF(roster) {
    const r = this.r, cg = this.campaignGrid();
    let W, H, G;
    if (cg) { G = this.G = cg; W = G.W; H = G.H; }
    else { W = this.sizeFor(34); H = this.sizeFor(20); G = this.G = new Grid(W, H); makeGround(G, this.cfg.theme, r); border(G); }
    const keep = (x, y) => (x < 7 || x > W - 8) && Math.abs(y - (H >> 1)) < 4;
    if (!cg) scatter(G, r, (W * H) / 22 | 0, (x, y) => [[x, y], [W - 1 - x, y]], keep);
    const fy = H >> 1;
    [[3, 0], [W - 4, 1]].forEach(([fx, team]) => {
      clearArea(G, fx - 2, fy - 3, fx + 2, fy + 3);
      for (const dy of [-3, 3]) for (let dx = -2; dx <= 2; dx++) G.set(fx + dx, fy + dy, T.CONCRETE);
      const ti = this.addTeam(team);
      ti.spawns = [[fx, fy - 2], [fx, fy + 2], [fx + (team ? -2 : 2), fy - 1], [fx + (team ? -2 : 2), fy + 1]];
      this.flags.push({ team, hx: fx * CELL + HALF, hy: fy * CELL + HALF, x: fx * CELL + HALF, y: fy * CELL + HALF, carrier: 0, dropT: 0 });
    });
    if (cg) this.openUp();
  }

  genFFA(roster) {
    const r = this.r, cg = this.campaignGrid();
    let G, SW, SH;
    if (cg) { G = this.G = cg; SW = G.W; SH = G.H; }
    else { const S = this.sizeFor(26); SW = SH = S; G = this.G = new Grid(S, S); makeGround(G, this.cfg.theme, r); border(G);
      scatter(G, r, (S * S) / 18 | 0, (x, y) => [[x, y], [S - 1 - x, y], [x, S - 1 - y], [S - 1 - x, S - 1 - y]], () => false); }
    this.ffaSpawns = [];
    for (let k = 0; k < 16; k++) {
      const x = 2 + ((r() * (SW - 4)) | 0), y = 2 + ((r() * (SH - 4)) | 0);
      clearArea(G, x - 1, y - 1, x + 1, y + 1); this.ffaSpawns.push([x, y]);
    }
    if (cg) this.openUp();
  }

  /** a map of the campaign as the battlefield (cfg.map = 'c:N'), or null */
  campaignGrid() {
    const m = /^c:(\d+)$/.exec(this.cfg.map || '');
    if (!m) return null;
    const d = campaignMapBytes(+m[1]); if (!d) return null;
    const pm = parseCampaignMap(d); if (!pm) return null;
    const { W: w0, H: h0, tiles } = pm;
    // the campaign maps are small (16-30 cells): a bigger battlefield repeats the map side by side,
    // with the trees on the joints cleared so every copy is open to the next
    const want = MAP_TARGET[clamp(this.cfg.size | 0, 0, MAP_TARGET.length - 1)] + Math.max(0, this.nPlayers - 2) * 3;
    const nx = Math.max(1, Math.min(4, Math.round(want / w0))), ny = Math.max(1, Math.min(4, Math.round(want / h0)));
    const W = w0 * nx, H = h0 * ny;
    const G = new Grid(W, H);
    let sand = 0, grass = 0;
    for (const c of tiles) { if (c >= 55 && c <= 99) sand++; else if (c < 106) grass++; }
    const desert = sand > grass;
    this.cfg.theme = desert ? 'desert' : 'grass';
    const base = desert ? [55, 56, 57, 58, 59] : [0, 1, 2, 3, 4, 5];
    for (let i = 0; i < W * H; i++) {
      const x = i % W, y = (i / W) | 0, lx = x % w0, ly = y % h0, c = tiles[ly * w0 + lx];
      G.g[i] = c < 106 ? c : base[(this.r() * base.length) | 0];
      const joint = (nx > 1 && ((lx === 0 && x > 0) || (lx === w0 - 1 && x < W - 1))) || (ny > 1 && ((ly === 0 && y > 0) || (ly === h0 - 1 && y < H - 1)));
      if (c >= 129 && c <= 136) { const f = c - 129; G.set(x, y, T.CRATE, f & 1); G.hp[i] = f < 2 ? 3 : f < 4 ? 2 : 1; }
      else if (c === 137 || c === 138 || c === 139) G.set(x, y, T.CONCRETE, c === 138 ? 1 : 0);
      else if (c === 140 || c === 141) G.set(x, y, joint ? T.CONCRETE : T.ARMOR, 0);
      else if (c >= 142 && c <= 146) { if (joint) G.g[i] = base[(this.r() * base.length) | 0]; else G.set(x, y, T.TREE, 0); }
    }
    return G;
  }
  /** after placing bases on a campaign map: make sure every open cell is reachable (break walls that close pockets) */
  openUp() {
    const G = this.G, W = G.W, H = G.H, N = W * H;
    const pass = (i) => G.t[i] === T.EMPTY || G.t[i] === T.STRUCT;
    for (let round = 0; round < 40; round++) {
      const comp = new Int32Array(N).fill(-1); const sizes = [];
      for (let s0 = 0; s0 < N; s0++) {
        if (comp[s0] >= 0 || !pass(s0)) continue;
        const id = sizes.length, q = [s0]; comp[s0] = id; let n = 0;
        while (q.length) { const i = q.pop(); n++; const x = i % W, y = (i / W) | 0; for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (comp[j] < 0 && pass(j)) { comp[j] = id; q.push(j); } } }
        sizes.push(n);
      }
      if (sizes.length <= 1) return;
      const main = sizes.indexOf(Math.max(...sizes));
      // the smallest pocket: open the wall between it and the main area (crates first)
      let done = false;
      for (let i = 0; i < N && !done; i++) {
        if (comp[i] < 0 || comp[i] === main) continue;
        const x = i % W, y = (i / W) | 0;
        for (const [dx, dy] of DIRS) {
          const wx = x + dx, wy = y + dy, ox = x + 2 * dx, oy = y + 2 * dy;
          if (!G.in(ox, oy) || !G.in(wx, wy)) continue;
          if (comp[oy * W + ox] === main && G.at(wx, wy) !== T.TREE && G.at(wx, wy) !== T.STRUCT) { G.set(wx, wy, T.EMPTY); done = true; break; }
        }
      }
      if (!done) { for (let i = 0; i < N; i++) if (comp[i] >= 0 && comp[i] !== main && G.t[i] === T.EMPTY) { G.set(i % W, (i / W) | 0, T.ARMOR); G.t[i] = T.TREE; } return; }
    }
  }
  /* ------------------------------------------------ structures */
  addStruct(type, cx, cy, team, hp) {
    const G = this.G, size = type === 'hq' ? 2 : 1;
    const s = { id: this.id(), type, cx, cy, size, team, hp: hp || (type === 'hq' ? 70 : 10), maxhp: 0, ang: Math.PI / 2, reload: 0, built: 0, owner: 0 };
    s.maxhp = s.hp;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
      const i = (cy + dy) * G.W + cx + dx; G.t[i] = T.STRUCT; G.hp[i] = 0; G.sid[i] = s.id; this.tileChanged(i);
    }
    s.x = (cx + size / 2) * CELL; s.y = (cy + size / 2) * CELL;
    this.structs.push(s);
    return s;
  }
  destroyStruct(s, by) {
    const G = this.G;
    for (let dy = 0; dy < s.size; dy++) for (let dx = 0; dx < s.size; dx++) {
      const i = (s.cy + dy) * G.W + s.cx + dx; G.t[i] = T.EMPTY; G.sid[i] = -1; this.tileChanged(i);
    }
    this.structs.splice(this.structs.indexOf(s), 1);
    s.dead = true;
    this.ev({ e: 'boom', x: s.x, y: s.y, s: s.type === 'hq' ? 3 : 2 });
    if (s.type === 'hq') this.hqDestroyed(s, by);
  }
  structById(id) { for (const s of this.structs) if (s.id === id) return s; return null; }

  /* ------------------------------------------------ players & tanks */
  addPlayer(p) {
    const pl = { pid: p.pid, name: String(p.name || 'Игрок').slice(0, 14), team: p.team | 0, kind: KINDS[p.kind] ? p.kind : 'light',
      coins: 0, kills: 0, deaths: 0, score: 0, built: 0, tank: null, respawn: 0.5, out: false, sel: 0, order: 0, input: { d: -1, f: false }, bot: !!p.bot, lastRepair: -9,
      xp: 0, level: 1, sp: 0, skills: { armor: 0, engine: 0, gun: 0, eng: 0, cmd: 0 }, owned: { light: true },
      ammo: {}, gear: {}, w: 'shell', lastF: false, interestT: 60 };
    pl.kind = 'light';                                    // everybody starts on the light tank
    const sl = clamp(this.cfg.startLevel | 0 || 1, 1, MAX_LEVEL);
    pl.level = sl; pl.sp = sl - 1; pl.xp = XP_LEVELS[sl - 1];
    if (this.cfg.mode === 'ffa') pl.team = 10 + this.players.size;     // everybody alone
    if (this.cfg.mode === 'defense' || this.cfg.mode === 'assault') pl.team = 0;
    if (this.cfg.mode === 'ctf') pl.team = pl.team % 2;
    this.addTeam(pl.team);
    pl.coins = START_COINS;                                // nobody starts rich: at most 20 coins
    this.players.set(p.pid, pl);
    return pl;
  }
  spawnPointFor(team) {
    const ti = this.teamInfo[team];
    let pts = ti && ti.spawns.length ? ti.spawns : null;
    if (this.cfg.mode === 'ffa') pts = this.ffaSpawns;
    if (!pts) return [2, 2];
    // the spawn point farthest from enemies that is free
    let best = pts[0], bestD = -1;
    for (const [x, y] of pts) {
      if (this.G.at(x, y) !== T.EMPTY || this.tankAt(x * CELL + HALF, y * CELL + HALF, null)) continue;
      let d = 1e9;
      for (const t of this.tanks) if (t.team !== team) d = Math.min(d, Math.abs(t.x - x * CELL) + Math.abs(t.y - y * CELL));
      if (this.cfg.mode !== 'ffa') d = this.r() * 10;
      if (d > bestD) { bestD = d; best = [x, y]; }
    }
    return best;
  }
  spawnTank(opts) {
    const k = KINDS[opts.kind] || KINDS.light;
    const hpMul = opts.bot ? this.lv.hpMul : 1;
    const t = { id: this.id(), x: opts.cx * CELL + HALF, y: opts.cy * CELL + HALF, dir: opts.dir === undefined ? (opts.cy < this.G.H / 2 ? 2 : 0) : opts.dir,
      kind: opts.kind, team: opts.team, pid: opts.pid || 0, owner: opts.owner || 0, name: opts.name || '', bot: !!opts.bot,
      hp: Math.round(k.hp * hpMul * (opts.hpMul || 1)), maxhp: 0, reload: 0.4, moving: false, prot: opts.prot === undefined ? 2 : opts.prot,
      speedT: 0, shieldT: 0, flag: -1, ai: null, lastHit: 0, lastBy: 0 };
    t.maxhp = t.hp;
    if (t.bot) t.ai = { role: opts.role || 'attack', home: opts.home || [opts.cx, opts.cy], think: 0, want: -1, fire: false, stuckT: 0, lx: t.x, ly: t.y, dodgeT: 0, dodgeDir: -1, tgt: 0, guard: opts.guard };
    this.tanks.push(t);
    this.ev({ e: 'spawn', x: t.x, y: t.y });
    return t;
  }
  tankById(id) { for (const t of this.tanks) if (t.id === id) return t; return null; }
  tankAt(x, y, except) {
    for (const t of this.tanks) if (t !== except && Math.abs(t.x - x) < TR * 2 && Math.abs(t.y - y) < TR * 2) return t;
    return null;
  }
  killTank(t, by, why) {
    const i = this.tanks.indexOf(t); if (i < 0) return;
    this.tanks.splice(i, 1);
    t.dead = true;
    if (t.kind === 'rogue' && t.ai && t.ai.bag > 0) {               // its bag bursts: the coins are anybody's now
      const cx = this.cellOf(t.x), cy = this.cellOf(t.y);
      for (let k = 0, n = t.ai.bag; k < n * 4 && t.ai.bag > 0; k++) { const before = this.pickups.length; this.addPickup('coin', cx + ((this.r() * 5) | 0) - 2, cy + ((this.r() * 5) | 0) - 2); if (this.pickups.length > before) t.ai.bag--; }
      const own = this.players.get(t.owner); if (own) this.ev({ e: 'msg', text: 'Мошенника подбили — его монеты рассыпались!', to: own.pid });
    }
    this.ev({ e: 'boom', x: t.x, y: t.y, s: t.kind === 'heavy' || t.kind === 'kamikaze' || KINDS[t.kind].hp >= 12 ? 2 : 1 });
    if (t.flag >= 0) this.dropFlag(t);
    const killer = by && this.players.get(by.pid);
    const victim = t.pid ? this.players.get(t.pid) : null;
    if (victim) {
      victim.deaths++; victim.tank = null; victim.respawn = this.respawnTime();
      const g = victim.gear;
      if (g.life > 0) { g.life--; victim.respawn = 0.4; this.ev({ e: 'msg', text: 'Запасная жизнь! Осталось: ' + g.life, to: victim.pid }); }
      else { if (g.tarmor > 0) g.tarmor--; g.field = 0; }
    }
    const tough = t.kind === 'rogue' ? 12 : t.kind === 'titan' ? 14 : t.kind === 'fastHeavy' || t.kind === 'rapidHeavy' ? 9 : t.kind === 'fastRapid' ? 6 : t.kind === 'heavy' || t.kind === 'siege' ? 5 : t.kind === 'rapid' || t.kind === 'fast' ? 3 : 0;
    if (victim) victim.streak = 0;
    if (killer && by.team !== t.team) {
      killer.kills++;
      // kill streaks and the bounty on the leader
      if (victim) {
        killer.streak = (killer.streak || 0) + 1;
        if (killer.streak === 3) { killer.coins += 20; this.say('🔥 ' + killer.name + ': серия из 3 побед! (+20●)'); }
        if (killer.streak === 5) { killer.coins += 40; this.say('💥 ' + killer.name + ' неудержим: 5 побед подряд! (+40●, поле +2)'); killer.gear.field = Math.min(6, (killer.gear.field | 0) + 2); if (killer.tank) this.applyStats(killer.tank, killer, true); }
        if (victim.crown) { killer.coins += 30; this.say('👑 ' + killer.name + ' сбил лидера ' + victim.name + '! (+30●)'); }
      }
      killer.coins += victim ? 20 : 8;
      killer.score += victim ? 3 : 1;
      this.gainXP(killer, victim ? 30 : 10 + tough);
    }
    if (by && by.owner && !killer && by.team !== t.team) {   // a hired bot's kill pays its owner and makes it a veteran
      const own = this.players.get(by.owner);
      if (own) { own.coins += victim ? 10 : 3; this.gainXP(own, (victim ? 30 : 10 + tough) * 0.5); }
      const bt = this.tankById(by.id);
      if (bt && bt.vet !== undefined && bt.vet < 3) { bt.vet++; this.applyBotStats(bt, own); bt.hp = bt.maxhp; this.ev({ e: 'msg', text: 'Ваш бот стал ветераном ' + '★'.repeat(bt.vet), to: by.owner }); }
    }
    if (victim || (killer && t.bot && t.owner)) this.feed.push({ k: by ? (by.name || '') : '', v: t.name || '', kt: by ? by.team : -1, vt: t.team, at: this.time });
    if (victim || killer) this.ev({ e: 'kill', k: by ? (by.name || botName(by)) : '', v: t.name || botName(t), kt: by ? by.team : -1, vt: t.team });
    // loot
    if (t.bot && this.r() < 0.35) this.addPickup(this.r() < 0.45 ? 'coin' : this.r() < 0.35 ? 'box' : this.r() < 0.5 ? 'repair' : ['speed', 'shield', 'star', 'freeze'][(this.r() * 4) | 0], this.cellOf(t.x), this.cellOf(t.y));
    if (this.cfg.mode === 'ffa' && killer) this.checkFFA();
  }
  respawnTime() { return { defense: 6, assault: 6, bases: 5, ctf: 3, ffa: 3 }[this.cfg.mode] || 4; }

  /* ------------------------------------------------ pickups */
  addPickup(type, cx, cy) {
    if (!this.G.in(cx, cy) || this.G.at(cx, cy) !== T.EMPTY) return;
    for (const p of this.pickups) if (p.cx === cx && p.cy === cy) return;
    this.pickups.push({ id: this.id(), type, cx, cy, ttl: type === 'coin' ? 50 : 35 }); this.pickV = (this.pickV | 0) + 1;
  }

  /* ------------------------------------------------ progression */
  gainXP(p, n, why) {
    if (!p || p.bot || n <= 0) return;
    p.xp += n * (this.cfg.xpRate || 1);
    while (p.level < MAX_LEVEL && p.xp >= XP_LEVELS[p.level]) {
      p.level++; p.sp++;
      if (p.tank) { p.tank.hp = p.tank.maxhp; p.tank.lvl = p.level; }
      this.ev({ e: 'level', to: p.pid, lvl: p.level, name: p.name });
      this.ev({ e: 'msg', text: 'Уровень ' + p.level + '! Есть очко навыка — откройте «Улучшения»', to: p.pid });
    }
  }
  /** player tank stats from the tank type and the skills */
  applyStats(t, p, keepFrac) {
    const k = KINDS[t.kind], sk = p.skills;
    const frac = keepFrac ? t.hp / t.maxhp : 1;
    const g = p.gear;
    t.maxhp = Math.round(k.hp * (1 + 0.2 * sk.armor));
    t.hp = Math.max(1, Math.round(t.maxhp * frac));
    // bought armour is a separate layer over the hull: it takes the hits first and does not grow back
    t.armorMax = (g.tarmor || 0) + (g.parmor || 0) + (g.chassis ? 2 : 0);
    if (!keepFrac || t.armor === undefined) t.armor = t.armorMax;
    t.armor = Math.min(t.armor, t.armorMax);
    t.fieldMax = g.field || 0;
    if (!keepFrac || t.field === undefined) t.field = t.fieldMax;
    t.field = Math.min(t.field, t.fieldMax);
    t.speedMul = (1 + 0.08 * sk.engine) * (g.chassis ? 1.1 : 1);
    t.reloadMul = [1, 0.9, 0.8, 0.75][sk.gun];
    t.dmgAdd = 0; t.pierceAdd = sk.gun >= 3 ? 1 : 0;
    t.lvl = p.level;
  }
  /** hired bots: the owner's "Commander" skill and the bot's own veteran rank */
  applyBotStats(b, owner) {
    const cmd = owner ? owner.skills.cmd : 0, vet = b.vet || 0;
    const k = KINDS[b.kind];
    const frac = b.maxhp ? b.hp / b.maxhp : 1;
    b.maxhp = Math.round(k.hp * (1 + (cmd >= 3 ? 0.25 : 0) + 0.15 * vet));
    b.hp = Math.max(1, Math.round(b.maxhp * frac));
    b.reloadMul = (cmd >= 3 ? 0.85 : 1) * (1 - 0.07 * vet);
    b.dmgAdd = 0; b.pierceAdd = vet >= 3 ? 1 : 0;
    if (b.kind === 'rogue') { b.armorMax = 4; if (b.armor === undefined) b.armor = 4; }      // a gold armour layer over the hull
  }
  buildCost(p, item) { return Math.max(1, Math.round(item.cost * [1, 0.85, 0.7, 0.6][p.skills.eng])); }
  botCap(p) { return 2 + 2 * p.skills.cmd + (p.level >= 5 ? 1 : 0); }
  turretCap(p) { return 1 + (p.skills.eng >= 1 ? 1 : 0) + (p.skills.eng >= 3 ? 2 : 0); }
  /** why an item cannot be used yet ('' = available) */
  locked(p, item) {
    if (p.level < item.lvl) return 'нужен уровень ' + item.lvl;
    if (item.cmd && p.skills.cmd < item.cmd) return 'нужен «Командир ' + ['', 'I', 'II', 'III'][item.cmd] + '»';
    return '';
  }
  nearBase(p, t) {
    if (this.cfg.mode === 'ffa') return true;
    const ti = this.teamInfo[p.team];
    if (!ti) return true;
    if (ti.hq && !ti.hq.dead && Math.abs(t.x - ti.hq.x) < CELL * 7 && Math.abs(t.y - ti.hq.y) < CELL * 7) return true;
    return (ti.spawns || []).some(([x, y]) => Math.abs(t.x - (x * CELL + HALF)) < CELL * 5 && Math.abs(t.y - (y * CELL + HALF)) < CELL * 5);
  }

  /* ------------------------------------------------ inputs */
  input(pid, inp) {
    const p = this.players.get(pid); if (!p) return;
    p.input.d = inp.d === undefined ? -1 : inp.d;
    p.input.f = !!inp.f;
    if (inp.a) for (const a of inp.a) this.action(p, a);
  }
  action(p, a) {
    const t = p.tank;
    const canBuild = this.cfg.mode === 'defense' || this.cfg.mode === 'assault' || this.cfg.mode === 'bases';
    if (a === 'next' || a === 'prev') {
      if (!canBuild) return;
      for (let k = 0; k < BUILD.length; k++) { p.sel = (p.sel + (a === 'next' ? 1 : BUILD.length - 1)) % BUILD.length; if (!this.locked(p, BUILD[p.sel])) break; }
      return;
    }
    if (typeof a === 'string' && a.startsWith('sel:')) {
      const i = a.slice(4) | 0, item = BUILD[i]; if (!item || !canBuild) return;
      const why = this.locked(p, item); if (why) { this.ev({ e: 'msg', text: item.name + ': ' + why, to: p.pid }); return; }
      p.sel = i; return;
    }
    if (typeof a === 'string' && a.startsWith('skill:')) {
      const id = a.slice(6); if (!(id in p.skills)) return;
      if (p.sp <= 0) { this.ev({ e: 'msg', text: 'Нет очков навыков — наберите опыт', to: p.pid }); return; }
      if (p.skills[id] >= 3) return;
      p.skills[id]++; p.sp--;
      if (p.tank) this.applyStats(p.tank, p, true);
      if (id === 'cmd') for (const b of this.tanks) if (b.owner === p.pid && b.team === p.team) this.applyBotStats(b, p);
      this.ev({ e: 'msg', text: SKILLS.find(x => x.id === id).name + ' ' + ['', 'I', 'II', 'III'][p.skills[id]] + ' изучен', to: p.pid });
      return;
    }
    if (typeof a === 'string' && a.startsWith('tank:')) {
      const kind = a.slice(5), info = TANKS[kind]; if (!info) return;
      if (p.level < info.lvl) { this.ev({ e: 'msg', text: info.name + ' танк: нужен уровень ' + info.lvl, to: p.pid }); return; }
      if (!p.owned[kind] && p.coins < info.cost) { this.ev({ e: 'msg', text: 'Не хватает монет: нужно ' + info.cost, to: p.pid }); return; }
      if (p.tank && !this.nearBase(p, p.tank)) { this.ev({ e: 'msg', text: 'Танк меняют на базе — подъедьте к своему радару или точке возрождения', to: p.pid }); return; }
      if (!p.owned[kind]) { p.coins -= info.cost; p.owned[kind] = true; }
      p.kind = kind;
      if (p.tank) { p.tank.kind = kind; this.applyStats(p.tank, p, false); this.ev({ e: 'build', x: p.tank.x, y: p.tank.y }); }
      this.ev({ e: 'msg', text: info.name.startsWith('Гибрид') ? 'Вы пересели в ' + info.name.replace('Гибрид', 'гибрид') : 'Теперь у вас ' + info.name.toLowerCase() + ' танк', to: p.pid });
      return;
    }
    if (a === 'w:next' || a === 'w:prev') {
      const n = WEAPONS.length; let i = WIDX[p.w] || 0;
      for (let k = 0; k < n; k++) { i = (i + (a === 'w:next' ? 1 : n - 1)) % n; if (i === 0 || (p.ammo[WEAPONS[i].id] | 0) > 0) break; }
      p.w = WEAPONS[i].id; return;
    }
    if (typeof a === 'string' && a.startsWith('w:')) {
      const id = a.slice(2); if (!(id in WIDX)) return;
      if (id !== 'shell' && !(p.ammo[id] > 0)) { this.ev({ e: 'msg', text: WEAPONS[WIDX[id]].name + ': нет боезапаса — купите в «Арсенале»', to: p.pid }); return; }
      p.w = id; return;
    }
    if (typeof a === 'string' && a.startsWith('buy:')) { this.buy(p, a.slice(4)); return; }
    if (typeof a === 'string' && a.startsWith('buymax:')) { this.buy(p, a.slice(7), true); return; }
    if (a === 'order') { p.order = (p.order + 1) % ORDERS.length; this.ev({ e: 'msg', text: 'Ваши боты: ' + ORDER_NAMES[ORDERS[p.order]], to: p.pid }); for (const b of this.tanks) if (b.owner === p.pid && b.ai && b.ai.role !== 'builder' && b.ai.role !== 'rogue') { b.ai.role = ORDERS[p.order]; } return; }
    if (!t) return;
    if (a === 'repair') {
      if (this.time - p.lastRepair < 2) return;
      const ti = this.teamInfo[p.team];
      const hq = ti && ti.hq && !ti.hq.dead ? ti.hq : null;
      const hqCost = p.skills.eng >= 3 ? 10 : 20;
      if (hq && Math.abs(t.x - hq.x) < CELL * 4 && Math.abs(t.y - hq.y) < CELL * 4 && hq.hp < hq.maxhp && p.coins >= hqCost) {
        p.coins -= hqCost; hq.hp = Math.min(hq.maxhp, hq.hp + 10); p.lastRepair = this.time; this.ev({ e: 'repair', x: hq.x, y: hq.y }); this.gainXP(p, 4); return;
      }
      const lost = t.maxhp - t.hp, fieldLost = (t.fieldMax || 0) - (t.field || 0) + (t.armorMax || 0) - (t.armor || 0);
      // your own bots near you are repaired too (the campaign's "ally repair")
      const mates = this.tanks.filter(b => b.owner === p.pid && b.team === p.team && b.hp < b.maxhp && Math.abs(b.x - t.x) < CELL * 5 && Math.abs(b.y - t.y) < CELL * 5);
      if (lost <= 0 && fieldLost <= 0) {
        if (!mates.length) { this.ev({ e: 'msg', text: 'Танк цел', to: p.pid }); return; }
        const b = mates[0];
        if (this.nearBase(p, t)) { const c = Math.max(2, Math.ceil((b.maxhp - b.hp) * 1.2)); if (p.coins < c) { this.ev({ e: 'msg', text: 'Ремонт бота: нужно ' + c + '●', to: p.pid }); return; } p.coins -= c; b.hp = b.maxhp; }
        else { if (!(p.gear.kit > 0)) { this.ev({ e: 'msg', text: 'Бота чинят ремкомплектом или на базе', to: p.pid }); return; } p.gear.kit--; b.hp = Math.min(b.maxhp, b.hp + Math.ceil(b.maxhp / 2)); }
        p.lastRepair = this.time; this.ev({ e: 'repair', x: b.x, y: b.y }); this.ev({ e: 'msg', text: 'Бот отремонтирован', to: p.pid });
        return;
      }
      if (this.nearBase(p, t)) {
        // the workshop: cheaper than kits and restores the force field too
        const cost = Math.max(2, Math.ceil(lost * 1.2) + fieldLost);
        if (p.coins < cost) { this.ev({ e: 'msg', text: 'Ремонт на базе: нужно ' + cost + '●', to: p.pid }); return; }
        p.coins -= cost; t.hp = t.maxhp; t.field = t.fieldMax || 0; t.armor = t.armorMax || 0;
      } else {
        if (lost <= 0 && (t.armor || 0) >= (t.armorMax || 0)) { this.ev({ e: 'msg', text: 'Поле восстановится само или на базе', to: p.pid }); return; }
        if (!(p.gear.kit > 0)) { this.ev({ e: 'msg', text: 'Нет ремкомплектов — купите в «Арсенале» или чинитесь на базе', to: p.pid }); return; }
        p.gear.kit--;
        if (lost > 0) t.hp = Math.min(t.maxhp, t.hp + Math.ceil(t.maxhp * (p.skills.armor >= 3 ? 0.75 : 0.5)));
        else t.armor = t.armorMax;                        // the hull is whole: the kit patches the armour
      }
      p.lastRepair = this.time; this.ev({ e: 'repair', x: t.x, y: t.y });
      return;
    }
    if (a === 'place' && canBuild) {
      const item = BUILD[p.sel];
      const why = this.locked(p, item); if (why) { this.ev({ e: 'msg', text: item.name + ': ' + why, to: p.pid }); return; }
      const cost = this.buildCost(p, item);
      if (p.coins < cost) { this.ev({ e: 'msg', text: 'Не хватает монет: нужно ' + cost, to: p.pid }); return; }
      const [dx, dy] = DIRS[t.dir];
      const cx = this.cellOf(t.x) + dx, cy = this.cellOf(t.y) + dy;
      const G = this.G;
      if (item.id === 'bot' || item.id === 'botHeavy' || item.id === 'botRapid' || item.id === 'botFast' || item.id === 'botBuilder' || item.id === 'botBrain' || item.id === 'wild' || item.id === 'botRogue' || HYBRIDS[item.id]) {
        if (item.id === 'botBrain' && this.tanks.some(b => b.owner === p.pid && b.kind === 'brain')) { this.ev({ e: 'msg', text: 'Интеллектуал у вас уже есть — он один', to: p.pid }); return; }
        if (item.id === 'botRogue' && this.tanks.filter(b => b.owner === p.pid && b.kind === 'rogue').length >= 2) { this.ev({ e: 'msg', text: 'Мошенников уже два — больше нельзя', to: p.pid }); return; }
        let sx = cx, sy = cy;
        if (G.at(sx, sy) !== T.EMPTY || this.tankAt(sx * CELL + HALF, sy * CELL + HALF, null)) { sx = this.cellOf(t.x) - dx; sy = this.cellOf(t.y) - dy; }
        if (G.at(sx, sy) !== T.EMPTY || this.tankAt(sx * CELL + HALF, sy * CELL + HALF, null)) { this.ev({ e: 'msg', text: 'Нет места для бота', to: p.pid }); return; }
        const own = this.tanks.filter(b => b.owner === p.pid && b.team === p.team).length;
        if (item.id !== 'wild' && own >= this.botCap(p)) { this.ev({ e: 'msg', text: 'Ботов уже ' + own + ' из ' + this.botCap(p) + ' — прокачайте «Командира»', to: p.pid }); return; }
        p.coins -= cost; this.gainXP(p, 5);
        if (item.id === 'wild') {
          const rr = this.r();
          this.spawnTank({ cx: sx, cy: sy, kind: rr < 0.25 ? 'kamikaze' : rr < 0.45 ? 'rapid' : rr < 0.65 ? 'fast' : 'light', team: WILD_TEAM, bot: true, role: 'wild', name: 'дикий', owner: p.pid, prot: 1, dir: t.dir });
          this.ev({ e: 'msg', text: p.name + ' выпустил дикого бота!', to: -1 });
        } else {
          const hy = HYBRIDS[item.id];
          const rogue = item.id === 'botRogue';
          const b = this.spawnTank({ cx: sx, cy: sy, kind: hy ? hy[0] : rogue ? 'rogue' : { botHeavy: 'heavy', botRapid: 'rapid', botFast: 'fast', botBuilder: 'builder', botBrain: 'brain' }[item.id] || 'light', team: p.team, bot: true, role: item.id === 'botBuilder' ? 'builder' : rogue ? 'rogue' : ORDERS[p.order], owner: p.pid, name: item.id === 'botBrain' ? 'Интеллектуал' : hy ? hy[1] + ' · ' + p.name : rogue ? 'мошенник · ' + p.name : 'бот ' + p.name, home: this.homeOf(p.team, sx, sy), prot: 1, dir: t.dir });
          if (rogue) this.say('💰 ' + p.name + ' выпустил мошенника — он соберёт монеты по всей карте', p.team);
          if (hy) this.say('⚙️ ' + p.name + ' собрал гибрид «' + hy[1] + '»!', p.team);
          b.ai.leader = p.pid; b.vet = 0; this.applyBotStats(b, p);
        }
        return;
      }
      if (G.at(cx, cy) !== T.EMPTY || this.tankAt(cx * CELL + HALF, cy * CELL + HALF, null) || this.pickups.some(q => q.cx === cx && q.cy === cy)) { this.ev({ e: 'msg', text: 'Сюда нельзя строить', to: p.pid }); return; }
      if (this.flags.some(f => this.cellOf(f.hx) === cx && this.cellOf(f.hy) === cy)) return;
      if (item.id === 'turret') {
        const mine = this.structs.filter(q => q.type === 'turret' && q.owner === p.pid).length;
        if (mine >= this.turretCap(p)) { this.ev({ e: 'msg', text: 'Пушек уже ' + mine + ' из ' + this.turretCap(p) + ' — прокачайте «Инженера»', to: p.pid }); return; }
      }
      p.coins -= cost; p.built++;
      if (item.id === 'turret') { const s = this.addStruct('turret', cx, cy, p.team, p.skills.eng >= 2 ? 15 : 10); s.owner = p.pid; s.ang = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][t.dir]; this.gainXP(p, 10); }
      else {
        G.set(cx, cy, item.id === 'crate' ? T.CRATE : T.CONCRETE, (this.r() * 2) | 0); G.own[cy * G.W + cx] = p.team + 1;
        if (p.skills.eng >= 2) G.hp[cy * G.W + cx] = Math.round(G.hp[cy * G.W + cx] * 1.5);       // engineers build sturdier walls
        this.tileChanged(cy * G.W + cx); this.gainXP(p, item.id === 'crate' ? 2 : 4);
      }
      this.ev({ e: 'build', x: cx * CELL + HALF, y: cy * CELL + HALF });
    }
  }
  /** the arsenal: ammunition packs and equipment, sold at your own base */
  shopPrice(p, item) { return !p.tank || this.nearBase(p, p.tank) ? item.cost : Math.ceil(item.cost * 1.5); }
  ammoCap(p, w) { return w.cap ? AMMO_CAP : 0; }
  buy(p, id, max) {
    const say = (text) => this.ev({ e: 'msg', text, to: p.pid });
    const w = id in WIDX ? WEAPONS[WIDX[id]] : null, g = w ? null : GEAR.find(x => x.id === id);
    const item = w || g; if (!item || (w && !w.pack)) return;
    if (p.level < item.lvl) { say(item.name + ': нужен уровень ' + item.lvl); return; }
    // at your own base the price is as listed; anywhere else it is delivered for 50% more
    const cost = this.shopPrice(p, item);
    if (p.coins < cost) { say('Не хватает монет: нужно ' + cost + (cost > item.cost ? ' (вдали от базы +50%)' : '')); return; }
    if (w) {
      if (w.type === 'air' && !p.gear.radar) { say('Для авиаудара нужен радар'); return; }
      const have = p.ammo[id] | 0, cap = this.ammoCap(p, w);
      if (have >= cap) { say(w.name + ': полный запас (' + cap + ')'); return; }
      // "buy max": as many packs as fit and as the coins allow
      let packs = 0;
      do { p.coins -= cost; p.ammo[id] = Math.min(cap, (p.ammo[id] | 0) + w.pack); packs++; } while (max && p.coins >= cost && p.ammo[id] < cap);
      if (p.w === 'shell') p.w = id;
      say(w.name + ': ' + p.ammo[id] + ' из ' + cap + (packs > 1 ? ' (куплено ' + packs + ' уп. за ' + packs * cost + '●)' : ''));
    } else {
      const lv = p.gear[id] | 0;
      if (lv >= g.max) { say(g.name + ': уже максимум'); return; }
      p.coins -= cost; p.gear[id] = lv + 1;
      const t = p.tank;
      if (t && (id === 'tarmor' || id === 'parmor' || id === 'chassis')) { this.applyStats(t, p, true); t.armor = Math.min(t.armorMax, (t.armor || 0) + (id === 'chassis' ? 2 : 1)); }
      if (t && id === 'field') { t.fieldMax = p.gear.field; t.field = Math.min(t.fieldMax, (t.field || 0) + 1); }
      say(g.name + (g.max > 1 ? ': ' + p.gear[id] + ' из ' + g.max : ' установлен'));
    }
    this.ev({ e: 'buy', to: p.pid });
    if (p.tank) this.ev({ e: 'build', x: p.tank.x, y: p.tank.y });
  }
  homeOf(team, fx, fy) { const ti = this.teamInfo[team]; return ti && ti.hq ? [ti.hq.cx, ti.hq.cy + 2] : [fx, fy]; }

  /* ------------------------------------------------ mode setup / rules */
  modeInit() {
    const c = this.cfg, n = this.nPlayers;
    this.status = '';
    if (c.mode === 'defense') {
      this.wave = 0; this.waveState = 'build'; this.waveT = 25; this.toSpawn = 0; this.spawnT = 0;
      this.allyBots('defend');
      this.say('Оборона базы: продержитесь ' + c.waves + ' волн. Стройте укрепления между волнами!');
    } else if (c.mode === 'assault') {
      this.ai = { coins: 60, income: 1.2 + 0.7 * n, defCap: 3 + 2 * n + c.botLevel, attackT: 70, rebuildT: 6 };
      for (let k = 0; k < this.ai.defCap; k++) this.spawnDefender(k);
      this.allyBots('attack');
      this.say('Штурм крепости: уничтожьте радар противника. Крепость защищается и восстанавливает стены!');
    } else if (c.mode === 'bases') {
      this.truceT = c.truce;
      this.coinT = 0; this.wildT = 40;
      // helper bots for every team
      for (const team of Object.keys(this.teamInfo).map(Number)) {
        if (team >= AI_TEAM) continue;
        for (let k = 0; k < (c.bots | 0); k++) {
          const ti = this.teamInfo[team], [x, y] = ti.spawns[k % ti.spawns.length];
          this.addBot({ cx: x, cy: y, kind: k === 2 && c.bots >= 3 ? 'brain' : k % 3 === 2 ? 'heavy' : 'light', team, bot: true, role: k % 2 || k === 2 ? 'attack' : 'defend', name: k === 2 && c.bots >= 3 ? 'Стратег' : 'бот', home: this.homeOf(team, x, y) }, 10);
        }
      }
      this.say(c.truce > 0 ? 'Базы: ' + Math.round(c.truce / 60 * 10) / 10 + ' мин перемирия — укрепляйтесь. Потом война!' : 'Базы: уничтожьте радары соперников!');
    } else if (c.mode === 'ctf') {
      this.scoreLimit = 3; this.timeLimit = 600;
      for (const team of [0, 1]) for (let k = 0; k < (c.bots | 0); k++) {
        const ti = this.teamInfo[team], [x, y] = ti.spawns[k % ti.spawns.length];
        this.addBot({ cx: x, cy: y, kind: k === 2 ? 'brain' : k % 3 === 2 ? 'heavy' : 'light', team, bot: true, role: k % 3 === 0 ? 'ctfDefend' : 'ctfAttack', name: k === 2 ? 'Стратег' : 'бот', home: [x, y] }, 4);
      }
      this.say('Захват флага: принесите флаг противника к своему флагу. До ' + this.scoreLimit + ' очков.');
    } else if (c.mode === 'ffa') {
      this.fragLimit = 15; this.timeLimit = 480;
      for (let k = 0; k < (c.bots | 0); k++) { const [x, y] = this.spawnPointFor(-1); this.addBot({ cx: x, cy: y, kind: ['light', 'rapid', 'heavy', 'fast', 'siege'][k % 5], team: 20 + k, bot: true, role: 'hunt', name: 'бот ' + (k + 1) }, 4); }
      this.say('Схватка: каждый сам за себя. До ' + this.fragLimit + ' побед.');
    }
  }

  /** a permanent bot: respawns `delay` seconds after it dies (while its team is still in the game) */
  addBot(opts, delay) {
    const slot = { opts, delay: delay || this.respawnTime() + 2, t: 0, tank: null };
    this.botSlots.push(slot);
    this.spawnSlot(slot);
    return slot;
  }
  spawnSlot(slot) {
    const o = slot.opts;
    let x, y;
    if (slot.tank === null && o.cx !== undefined) { x = o.cx; y = o.cy; }
    else [x, y] = this.spawnPointFor(o.team >= 20 ? -1 : o.team);
    if (this.G.at(x, y) !== T.EMPTY || this.tankAt(x * CELL + HALF, y * CELL + HALF, null)) { slot.t = 1; slot.tank = 0; return; }
    slot.tank = this.spawnTank(Object.assign({}, o, { cx: x, cy: y }));
  }
  slotStep(dt) {
    for (const slot of this.botSlots) {
      if (slot.tank && !slot.tank.dead) continue;
      const ti = this.teamInfo[slot.opts.team];
      if (ti && ti.out) continue;
      if (slot.tank) { slot.tank = 0; slot.t = slot.delay; }
      slot.t -= dt;
      if (slot.t <= 0) this.spawnSlot(slot);
    }
  }
  /** helper bots on the players' side in the co-op modes */
  allyBots(role) {
    const ti = this.teamInfo[0]; if (!ti) return;
    for (let k = 0; k < (this.cfg.bots | 0); k++) {
      const [x, y] = ti.spawns[(k + 1) % ti.spawns.length];
      this.addBot({ cx: x, cy: y, kind: k % 3 === 2 ? 'heavy' : 'light', team: 0, bot: true, role: k % 2 ? 'defend' : role, name: 'союзник', home: this.homeOf(0, x, y), prot: 3 }, 12);
    }
  }
  spawnDefender(k) {
    const ti = this.teamInfo[AI_TEAM]; if (!ti || !ti.hq || ti.hq.dead) return;
    const posts = this.guardPosts || [[ti.hq.cx, ti.hq.cy + 2]];
    const used = new Set(this.tanks.filter(t => t.ai && t.ai.guard).map(t => t.ai.guard.join(',')));
    const post = posts.find(p => !used.has(p.join(','))) || posts[k % posts.length];
    const [sx, sy] = ti.spawns[(k + (this.r() * 3 | 0)) % ti.spawns.length];
    if (this.G.at(sx, sy) !== T.EMPTY || this.tankAt(sx * CELL + HALF, sy * CELL + HALF, null)) return;
    const kinds = ['light', 'heavy', 'rapid', 'siege', 'light', 'fast'];
    this.spawnTank({ cx: sx, cy: sy, kind: kinds[k % kinds.length], team: AI_TEAM, bot: true, role: 'guard', guard: post, home: post, name: 'страж' });
  }

  hqDestroyed(s, by) {
    const ti = this.teamInfo[s.team];
    if (ti) ti.out = true;
    const m = this.cfg.mode;
    if (m === 'defense' || m === 'assault') {
      if (s.team === AI_TEAM) this.finish(0, 'Радар противника уничтожен! Победа!');
      else this.finish(AI_TEAM, 'Ваш радар уничтожен. Поражение.');
    } else if (m === 'bases') {
      const name = this.teamName(s.team);
      this.say('Радар команды «' + name + '» уничтожен!');
      for (const t of this.tanks.slice()) if (t.team === s.team && t.bot) this.killTank(t, null);
      const alive = Object.entries(this.teamInfo).filter(([team, i]) => +team < AI_TEAM && i.hq && !i.out);
      if (alive.length <= 1) this.finish(alive.length ? +alive[0][0] : -1, alive.length ? 'Победила команда «' + this.teamName(+alive[0][0]) + '»!' : 'Ничья');
    }
  }
  teamName(team) {
    const names = ['Жёлтые', 'Синие', 'Зелёные', 'Голубые'];
    if (team >= 10 && team < 20) { for (const p of this.players.values()) if (p.team === team) return p.name; }
    return team === AI_TEAM ? 'Противник' : team === WILD_TEAM ? 'Дикие' : names[team] || ('Команда ' + team);
  }
  finish(winTeam, text) {
    if (this.over) return;
    const table = Array.from(this.players.values()).map(p => ({ name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, score: p.score, built: p.built, win: p.team === winTeam }));
    this.over = { winTeam, text, table, at: this.time };
    this.ev({ e: 'over', winTeam, text, table });
  }
  checkFFA() {
    for (const p of this.players.values()) if (p.kills >= this.fragLimit) this.finish(p.team, p.name + ' побеждает в схватке!');
  }

  /* ------------------------------------------------ main step */
  step() {
    const dt = DT;
    this.time += dt;
    if (this.over) { for (const t of this.tanks) t.moving = false; this.bullets.length = 0; return; }
    this.modeStep(dt);
    // players: respawn and control
    for (const p of this.players.values()) {
      if (!p.tank || p.tank.dead) {
        p.tank = null;
        if (p.out) continue;
        const ti = this.teamInfo[p.team];
        if (this.cfg.mode === 'bases' && ti && ti.out) { p.out = true; continue; }
        p.respawn -= dt;
        if (p.respawn <= 0) {
          const [x, y] = this.spawnPointFor(p.team);
          p.tank = this.spawnTank({ cx: x, cy: y, kind: p.kind, team: p.team, pid: p.pid, name: p.name, bot: p.bot, role: 'hunt' });
          this.applyStats(p.tank, p, false);
        }
        continue;
      }
      if (!p.bot) { p.tank.want = p.input.d; p.tank.fire = p.input.f; }
    }
    // interest on the savings
    for (const p of this.players.values()) if (p.gear.interest) {
      p.interestT -= dt;
      if (p.interestT <= 0) { p.interestT = 60; const add = Math.min(10, Math.floor(p.coins * 0.05 * p.gear.interest)); if (add > 0) { p.coins += add; this.ev({ e: 'msg', text: 'Проценты: +' + add + '●', to: p.pid }); } }
    }
    this.slotStep(dt);
    if (!this.noPlan) for (const t of this.tanks) if (t.ai && t.kind === 'brain') { t.ai.planT = (t.ai.planT || 0) - dt; if (t.ai.planT <= 0) { t.ai.planT = 1; this.brainPlan(t); } }
    for (const t of this.tanks) if (t.ai) this.think(t, dt);
    this.extrasStep(dt);
    for (const t of this.tanks.slice()) this.moveTank(t, dt);
    for (const s of this.structs.slice()) if (s.type === 'turret') this.turretStep(s, dt);
    this.bulletStep(dt);
    this.armsStep(dt);
    this.pickupStep(dt);
    if (this.flags.length) this.flagStep(dt);
  }

  modeStep(dt) {
    const c = this.cfg, n = this.nPlayers;
    if (c.mode === 'defense') {
      if (this.waveState === 'build') {
        this.waveT -= dt;
        this.status = (this.wave ? 'Волна ' + this.wave + ' отбита. ' : '') + 'Следующая волна через ' + Math.ceil(this.waveT) + ' с';
        if (this.waveT <= 0) {
          this.wave++; this.waveState = 'fight';
          this.toSpawn = Math.round((4 + this.wave * 2) * (0.7 + 0.45 * n) * (0.8 + 0.2 * c.botLevel));
          this.spawnT = 0;
          this.say('Волна ' + this.wave + ' из ' + c.waves + '!');
          this.ev({ e: 'wave' });
        }
      } else {
        const alive = this.tanks.filter(t => t.team === AI_TEAM).length;
        this.status = 'Волна ' + this.wave + '/' + c.waves + ' · врагов: ' + (alive + this.toSpawn);
        this.spawnT -= dt;
        const cap = 3 + 2 * n + this.wave;
        if (this.toSpawn > 0 && this.spawnT <= 0 && alive < cap) {
          const ti = this.teamInfo[AI_TEAM];
          const [x, y] = ti.spawns[(this.r() * ti.spawns.length) | 0];
          if (!this.tankAt(x * CELL + HALF, y * CELL + HALF, null)) {
            const w = this.wave, roll = this.r();
            const kind = w >= 7 && roll < 0.04 + (w - 7) * 0.01 ? 'fastHeavy' : w >= 3 && roll < 0.1 + w * 0.01 ? 'kamikaze' : w >= 4 && roll < 0.24 + w * 0.015 ? 'siege' : w >= 2 && roll < 0.4 + w * 0.02 ? 'heavy'
              : w >= 2 && roll < 0.55 + w * 0.02 ? 'rapid' : roll < 0.7 ? 'fast' : 'light';
            const brain = w >= 4 && !this.tanks.some(q => q.team === AI_TEAM && q.kind === 'brain');
            const role = kind === 'kamikaze' ? 'attack' : this.r() < 0.35 ? 'hunt' : 'attack';
            if (brain) { this.spawnTank({ cx: x, cy: y, kind: 'brain', team: AI_TEAM, bot: true, role: 'attack', name: 'Генерал', hpMul: 1 + w * 0.04, dir: 2 }); this.say('🧠 У врага появился Генерал — он ведёт волну по плану'); }
            else this.spawnTank({ cx: x, cy: y, kind, team: AI_TEAM, bot: true, role, name: '', hpMul: 1 + w * 0.04, dir: 2 });
            this.toSpawn--;
            this.spawnT = Math.max(0.6, 2.4 - w * 0.12 - n * 0.2);
          } else this.spawnT = 0.5;
        }
        if (this.toSpawn <= 0 && alive === 0) {
          if (this.wave >= c.waves) { this.finish(0, 'Все ' + c.waves + ' волн отбиты! Победа!'); return; }
          this.waveState = 'build'; this.waveT = 18;
          for (const p of this.players.values()) { p.coins += 35 + this.wave * 8; this.gainXP(p, 15 + this.wave * 2); }
          this.say('Волна отбита! +' + (35 + this.wave * 8) + ' монет. Укрепляйтесь!');
        }
      }
    } else if (c.mode === 'assault') {
      const ai = this.ai, ti = this.teamInfo[AI_TEAM];
      if (!ti.hq || ti.hq.dead) return;
      ai.coins += ai.income * dt;
      const defenders = this.tanks.filter(t => t.team === AI_TEAM && t.ai && t.ai.role === 'guard').length;
      // 1. keep the garrison full
      if (defenders < ai.defCap && ai.coins >= 25) { ai.coins -= 25; this.spawnDefender(defenders + (this.r() * 4 | 0)); }
      // 2. rebuild the walls and turrets
      ai.rebuildT -= dt;
      if (ai.rebuildT <= 0 && ai.coins >= 8) {
        ai.rebuildT = Math.max(1.2, 4 - n * 0.5);
        const G = this.G;
        const miss = this.blueprint.filter(([x, y, t]) => G.at(x, y) === T.EMPTY && !this.tankAt(x * CELL + HALF, y * CELL + HALF, null));
        if (miss.length) {
          const [x, y, t] = miss[(this.r() * miss.length) | 0];
          G.set(x, y, t); this.tileChanged(y * G.W + x); ai.coins -= t === T.CONCRETE ? 10 : 5;
          this.ev({ e: 'build', x: x * CELL + HALF, y: y * CELL + HALF });
        }
      }
      // 3. repair the HQ slowly
      if (ti.hq.hp < ti.hq.maxhp && ai.coins > 40) { ti.hq.hp = Math.min(ti.hq.maxhp, ti.hq.hp + dt * (0.6 + 0.2 * n)); ai.coins -= dt * 2; }
      // 4. counter-attacks
      ai.attackT -= dt;
      if (ai.attackT <= 0) {
        ai.attackT = 75 - Math.min(35, n * 8 + c.botLevel * 6);
        const squad = 2 + n + c.botLevel;
        for (let k = 0; k < squad; k++) {
          const [x, y] = ti.spawns[k % ti.spawns.length];
          if (this.tankAt(x * CELL + HALF, y * CELL + HALF, null)) continue;
          const rr = this.r();
          this.spawnTank({ cx: x, cy: y, kind: k === 0 ? (c.botLevel >= 1 ? 'brain' : 'heavy') : rr < 0.2 ? 'kamikaze' : rr < 0.4 ? 'rapid' : rr < 0.6 ? 'fast' : 'light', team: AI_TEAM, bot: true, role: 'attack', name: k === 0 && c.botLevel >= 1 ? 'Генерал' : '' });
        }
        this.say('Противник контратакует!');
      }
      const hq = ti.hq;
      this.status = 'Радар противника: ' + Math.ceil(hq.hp / hq.maxhp * 100) + '% · гарнизон: ' + defenders;
    } else if (c.mode === 'bases') {
      if (this.truceT > 0) { this.truceT -= dt; this.status = 'Перемирие: ' + fmtTime(this.truceT); if (this.truceT <= 0) { this.say('Перемирие закончилось. В атаку!'); this.ev({ e: 'wave' }); } }
      else this.status = 'Война · уничтожьте чужие радары';
      this.coinT -= dt;
      if (this.coinT <= 0) {
        this.coinT = 1.5;
        for (const p of this.players.values()) if (!p.out) p.coins += 1;
        if (this.r() < 0.45) { const [mx, my] = this.mid; this.addPickup('coin', mx - 3 + (this.r() * 6 | 0), my - 3 + (this.r() * 6 | 0)); }
      }
      if (c.wild && this.truceT <= 0) {
        this.wildT -= dt;
        if (this.wildT <= 0) {
          this.wildT = 35 - c.botLevel * 5;
          const [mx, my] = this.mid;
          const rr = this.r();
          if (!this.tankAt(mx * CELL, my * CELL, null)) this.spawnTank({ cx: mx, cy: my, kind: rr < 0.25 ? 'heavy' : rr < 0.4 ? 'kamikaze' : rr < 0.6 ? 'rapid' : rr < 0.8 ? 'fast' : 'light', team: WILD_TEAM, bot: true, role: 'wild', name: 'дикий' });
        }
      }
    } else if (c.mode === 'ctf') {
      this.timeLimit -= dt;
      const s0 = this.teamInfo[0].score, s1 = this.teamInfo[1].score;
      this.status = 'Жёлтые ' + s0 + ' : ' + s1 + ' Синие · ' + fmtTime(this.timeLimit);
      if (this.timeLimit <= 0) this.finish(s0 === s1 ? -1 : s0 > s1 ? 0 : 1, s0 === s1 ? 'Время вышло. Ничья!' : 'Время вышло. Победили ' + (s0 > s1 ? 'Жёлтые' : 'Синие') + '!');
    } else if (c.mode === 'ffa') {
      this.timeLimit -= dt;
      let best = null; for (const p of this.players.values()) if (!best || p.kills > best.kills) best = p;
      this.status = 'Схватка · лидер: ' + (best ? best.name + ' (' + best.kills + ')' : '—') + ' · ' + fmtTime(this.timeLimit);
      if (this.timeLimit <= 0) this.finish(best ? best.team : -1, 'Время вышло. Победил ' + (best ? best.name : '—') + '!');
    }
  }

  /* ------------------------------------------------ movement */
  solidForTank(cx, cy) { return SOLID_TANK[this.G.at(cx, cy)]; }
  boxFree(x, y, self) {
    const x0 = Math.floor((x - TR) / CELL), x1 = Math.floor((x + TR - 0.01) / CELL);
    const y0 = Math.floor((y - TR) / CELL), y1 = Math.floor((y + TR - 0.01) / CELL);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (this.solidForTank(cx, cy)) return false;
    for (const o of this.tanks) if (o !== self && Math.abs(o.x - x) < TR * 2 && Math.abs(o.y - y) < TR * 2) {
      // allow separating from a tank we already overlap with
      if (Math.abs(o.x - self.x) < TR * 2 && Math.abs(o.y - self.y) < TR * 2 && (Math.abs(o.x - x) + Math.abs(o.y - y)) > (Math.abs(o.x - self.x) + Math.abs(o.y - self.y))) continue;
      return false;
    }
    return true;
  }
  moveTank(t, dt) {
    if (t.frozenT > 0) { t.frozenT -= dt; t.moving = false; if (t.prot > 0) t.prot -= dt; return; }
    if (t.fieldMax > 0 && t.field < t.fieldMax) {          // the force field grows back, faster on a healthy tank
      t.fieldT = (t.fieldT || 0) + dt;
      if (t.fieldT >= 4.5 - 2.5 * (t.hp / t.maxhp)) { t.fieldT = 0; t.field++; }
    }
    if (t.guiding) {                                        // steering a guided missile: the tank stands still
      const b = this.bullets.find(q => q.id === t.guiding);
      if (!b) t.guiding = 0;
      else {
        if (t.prot > 0) t.prot -= dt;
        if (t.reload > 0) t.reload -= dt;
        t.moving = false;
        const d = t.want;
        if (d >= 0 && d !== (b.dir + 2) % 4 && d !== b.dir) { b.dir = d; b.vx = DIRS[d][0] * b.sp; b.vy = DIRS[d][1] * b.sp; }
        if (!t.fire) b.released = true;
        else if (b.released && b.age > 0.3) this.bulletBoom(b, b.x, b.y, true);
        return;
      }
    }
    if (t.prot > 0) t.prot -= dt;
    if (t.speedT > 0) t.speedT -= dt;
    if (t.shieldT > 0) t.shieldT -= dt;
    if (t.reload > 0) t.reload -= dt;
    const k = KINDS[t.kind];
    const d = t.want === undefined ? -1 : t.want;
    t.moving = false;
    if (d >= 0) {
      if (t.dir !== d) {
        // turning: snap to the lane so the tank fits between walls
        t.dir = d;
      }
      const sp = k.speed * (t.speedMul || 1) * (t.speedT > 0 ? 1.45 : 1) * dt;
      const [dx, dy] = DIRS[d];
      // lane assist: pull the other coordinate to the cell centre
      if (dx) { const c = Math.floor(t.y / CELL) * CELL + HALF, off = c - t.y; if (Math.abs(off) > 0.01) { const m = clamp(off, -sp, sp); if (this.boxFree(t.x, t.y + m, t)) t.y += m; } }
      else { const c = Math.floor(t.x / CELL) * CELL + HALF, off = c - t.x; if (Math.abs(off) > 0.01) { const m = clamp(off, -sp, sp); if (this.boxFree(t.x + m, t.y, t)) t.x += m; } }
      const nx = t.x + dx * sp, ny = t.y + dy * sp;
      if (this.boxFree(nx, ny, t)) { t.x = nx; t.y = ny; t.moving = true; }
      else {
        // slide up to the obstacle
        let lo = 0, hi = sp;
        for (let i = 0; i < 5; i++) { const m = (lo + hi) / 2; if (this.boxFree(t.x + dx * m, t.y + dy * m, t)) lo = m; else hi = m; }
        if (lo > 0.05) { t.x += dx * lo; t.y += dy * lo; t.moving = true; }
      }
    }
    // kamikaze: blow up next to an enemy or a structure
    if (t.kind === 'kamikaze') {
      let hit = false;
      for (const o of this.tanks) if (o !== t && this.hostile(t.team, o.team) && Math.abs(o.x - t.x) < 22 && Math.abs(o.y - t.y) < 22) hit = true;
      for (const s of this.structs) if (this.hostile(t.team, s.team) && Math.abs(s.x - t.x) < 12 + s.size * 10 && Math.abs(s.y - t.y) < 12 + s.size * 10) hit = true;
      if (hit) { this.explode(t.x, t.y, 1.6, k.boom, t); this.killTank(t, null); return; }
    }
    if (t.fire && t.reload <= 0 && k.shot) this.fire(t);
  }
  fire(t) {
    const k = KINDS[t.kind];
    const p = t.pid && !t.bot ? this.players.get(t.pid) : null;
    let w = WEAPONS[0];
    if (p && p.w !== 'shell') {
      if ((p.ammo[p.w] | 0) > 0) w = WEAPONS[WIDX[p.w]];
      else { p.w = 'shell'; this.ev({ e: 'msg', text: 'Боезапас кончился — снова обычные снаряды', to: p.pid }); }
    }
    const boost = t.speedT > 0 ? 0.75 : 1;
    t.reload = k.reload * (t.reloadMul || 1) * (t.bot && !t.owner ? this.lv.fireMul : 1) * boost;
    const [dx, dy] = DIRS[t.dir];
    const use = () => { p.ammo[w.id]--; if (p.ammo[w.id] <= 0) { delete p.ammo[w.id]; p.w = 'shell'; this.ev({ e: 'msg', text: w.name + ' — последний', to: p.pid }); } };
    const cx = this.cellOf(t.x), cy = this.cellOf(t.y);
    if (w.type === 'shot') {
      const sp = k.shot * (w.speed || 1);
      t.reload *= w.reload || 1;
      const vis = t.kind === 'siege' && !w.vis ? 1 : w.vis !== undefined ? w.vis : t.team === AI_TEAM ? 3 : 0;
      this.bullets.push({ id: this.id(), x: t.x + dx * 11, y: t.y + dy * 11, vx: dx * sp, vy: dy * sp, team: t.team, owner: t.id, pid: t.pid, dmg: Math.max(k.dmg, w.dmg || 0) + (t.dmgAdd || 0), splash: k.splash, ttl: w.bounce ? 3.2 : 2.2, kind: vis,
        pierce: (w.pierce || 0) + (k.pierce || 0) + (t.pierceAdd || 0), bounce: w.bounce || 0, age: 0 });
      this.ev({ e: 'shot', x: t.x, y: t.y, k: vis === 2 || vis === 5 || vis === 10 ? 2 : t.kind === 'siege' ? 1 : 0 });
      if (w.id !== 'shell') use();
      return;
    }
    // special weapons: only players have them
    t.reload = Math.max(t.reload, 0.6);
    if (w.type === 'art') {
      const G = this.G, range = w.range + (p.level >= 8 ? 1 : 0);
      const tx = clamp(cx + dx * range, 1, G.W - 2) * CELL + HALF, ty = clamp(cy + dy * range, 1, G.H - 2) * CELL + HALF;
      const T = Math.max(0.45, Math.hypot(tx - t.x, ty - t.y) / 170);
      this.bullets.push({ id: this.id(), art: true, x: t.x, y: t.y, sx: t.x, sy: t.y, tx, ty, T, age: 0, z: 0, vx: dx, vy: dy, team: t.team, owner: t.id, pid: t.pid, dmg: w.dmg, r: w.r, ttl: 9, kind: 7 });
      this.ev({ e: 'shot', x: t.x, y: t.y, k: 1 });
    } else if (w.type === 'rocket' || w.type === 'guided') {
      const g = w.type === 'guided', sp = g ? 135 : 190;
      const b = { id: this.id(), rocket: true, guided: g, x: t.x + dx * 11, y: t.y + dy * 11, vx: dx * sp, vy: dy * sp, sp, dir: t.dir, team: t.team, owner: t.id, pid: t.pid, dmg: w.dmg, r: w.r, ttl: g ? 12 : 6, kind: g ? 9 : 8, age: 0, released: false };
      this.bullets.push(b);
      if (g) { t.guiding = b.id; this.ev({ e: 'msg', text: 'Ракета: рулите стрелками, «огонь» — подрыв', to: p.pid }); }
      this.ev({ e: 'shot', x: t.x, y: t.y, k: 1 });
    } else if (w.type === 'homing') {
      // four charges fan out and each one hunts its own target
      const foes = this.tanks.filter(o => this.hostile(t.team, o.team) && o.team !== t.team && !this.truceBlocks(t.team, o.team))
        .sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y));
      const a0 = Math.atan2(dy, dx);
      [-0.95, -0.32, 0.32, 0.95].forEach((da, i) => {
        const a = a0 + da, tg = foes.length ? foes[i % foes.length] : null;
        this.bullets.push({ id: this.id(), homing: true, x: t.x + dx * 10, y: t.y + dy * 10, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, team: t.team, owner: t.id, pid: t.pid, dmg: w.dmg, ttl: 6, kind: 11, tgt: tg ? tg.id : 0, age: 0 });
      });
      this.ev({ e: 'shot', x: t.x, y: t.y, k: 2 });
    } else if (w.type === 'mine') {
      if (this.mines.some(m => m.cx === cx && m.cy === cy)) { this.ev({ e: 'msg', text: 'Здесь уже стоит мина', to: p.pid }); return; }
      this.mines.push({ id: this.id(), cx, cy, team: t.team, pid: t.pid, owner: t.id, dmg: w.dmg, big: w.id === 'mine9' ? 1 : 0, arm: 1 });
      this.ev({ e: 'build', x: t.x, y: t.y });
    } else if (w.type === 'dyn') {
      if (this.dyns.some(m => m.cx === cx && m.cy === cy)) return;
      this.dyns.push({ id: this.id(), cx, cy, team: t.team, pid: t.pid, owner: t.id, dmg: w.dmg, r: w.r, t: 5 });
      this.ev({ e: 'build', x: t.x, y: t.y });
    } else if (w.type === 'air') {
      if (!p.gear.radar) { this.ev({ e: 'msg', text: 'Для авиаудара нужен радар', to: p.pid }); return; }
      const D = [[1, -1], [1, 1], [-1, 1], [-1, -1]][t.dir], u = [D[0] / Math.SQRT2, D[1] / Math.SQRT2];
      const drops = []; for (let i = 0; i < 5; i++) drops.push([t.x + u[0] * (34 + i * 30), t.y + u[1] * (34 + i * 30)]);
      this.planes.push({ id: this.id(), x: t.x - u[0] * 320, y: t.y - u[1] * 320, ux: u[0], uy: u[1], dir: t.dir, team: t.team, pid: t.pid, owner: t.id, dmg: w.dmg, r: w.r, drops, next: 0, left: 900 });
      this.ev({ e: 'plane', x: t.x, y: t.y });
      this.say((p.name || '') + ' вызвал авиаудар!');
    } else if (w.type === 'boost') {
      t.speedT = (8 + (p.gear.chassis ? 3 : 0)) * (this.cfg.theme === 'desert' ? 1.33 : 1);
      this.ev({ e: 'pick', x: t.x, y: t.y, k: 'speed', to: t.pid });
    } else if (w.type === 'freeze') {
      this.freezeAround(t, 8 * CELL, 4 + (p.gear.chassis ? 2 : 0));
    }
    use();
  }
  freezeAround(t, R, T) {
    for (const o of this.tanks) if (o !== t && this.hostile(t.team, o.team) && o.team !== t.team && Math.hypot(o.x - t.x, o.y - t.y) < R) { o.frozenT = T; o.moving = false; }
    for (const s2 of this.structs) if (s2.type === 'turret' && this.hostile(t.team, s2.team) && s2.team !== t.team && Math.hypot(s2.x - t.x, s2.y - t.y) < R) s2.frozenT = T;
    for (const b of this.bullets) if (this.hostile(t.team, b.team) && b.team !== t.team && Math.hypot(b.x - t.x, b.y - t.y) < R) b.frozenT = T;
    this.ev({ e: 'freeze', x: t.x, y: t.y });
  }
  /** a supply box: a random pack, as the campaign's crates ("Damn! There is nothing here!" included) */
  openBox(t, p) {
    if (!p || !t.pid) { t.hp = Math.min(t.maxhp, t.hp + 2); return; }
    const say = (text) => this.ev({ e: 'msg', text: 'Ящик: ' + text, to: p.pid });
    const roll = this.r();
    if (roll < 0.1) { say('чёрт! пусто'); return; }
    if (roll < 0.2) { p.gear.kit = Math.min(5, (p.gear.kit | 0) + 1); say('ремкомплект'); return; }
    if (roll < 0.28 && t.fieldMax !== undefined) { p.gear.field = Math.min(6, (p.gear.field | 0) + 1); t.fieldMax = p.gear.field; t.field = Math.min(t.fieldMax, (t.field || 0) + 1); say('силовое поле +1'); return; }
    const pool = WEAPONS.filter(w => w.pack && w.type !== 'air' && w.lvl <= p.level + 2);
    const w = pool[(this.r() * pool.length) | 0];
    const n = Math.max(1, Math.ceil(w.pack / 2)), cap = this.ammoCap(p, w);
    p.ammo[w.id] = Math.min(cap, (p.ammo[w.id] | 0) + n);
    say(w.name + ' — ' + n + ' шт.');
  }
  /** mines, dynamite and bombers */
  armsStep(dt) {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      if (m.arm > 0) { m.arm -= dt; continue; }
      const x = m.cx * CELL + HALF, y = m.cy * CELL + HALF;
      const hit = this.tanks.find(o => this.hostile(m.team, o.team) && o.team !== m.team && Math.abs(o.x - x) < 11 && Math.abs(o.y - y) < 11);
      if (hit) { this.mines.splice(i, 1); this.explode(x, y, 1, m.dmg, this.tankById(m.owner) || { team: m.team, pid: m.pid, id: 0 }, { crater: true }); }
    }
    for (let i = this.dyns.length - 1; i >= 0; i--) {
      const d = this.dyns[i]; d.t -= dt;
      if (d.t <= 0) { this.dyns.splice(i, 1); this.explode(d.cx * CELL + HALF, d.cy * CELL + HALF, d.r, d.dmg, this.tankById(d.owner) || { team: d.team, pid: d.pid, id: 0 }, { hedge: true, mines: true }); }
    }
    for (let i = this.planes.length - 1; i >= 0; i--) {
      const pl = this.planes[i], sp = 170 * dt;
      pl.x += pl.ux * sp; pl.y += pl.uy * sp; pl.left -= sp;
      while (pl.next < pl.drops.length) {
        const [bx, by] = pl.drops[pl.next];
        if ((bx - pl.x) * pl.ux + (by - pl.y) * pl.uy > 0) break;
        pl.next++;
        this.explode(bx, by, pl.r, pl.dmg, this.tankById(pl.owner) || { team: pl.team, pid: pl.pid, id: 0 }, { hedge: true, mines: true });
      }
      if (pl.left <= 0) this.planes.splice(i, 1);
    }
  }
  /** a homing plasma charge: turns towards its target, flies over walls, one hit */
  homingStep(b, dt) {
    b.ttl -= dt;
    if (b.ttl <= 0) { this.killBullet(b); this.ev({ e: 'hit', x: b.x, y: b.y }); return; }
    let tg = b.tgt ? this.tankById(b.tgt) : null;
    if (!tg || tg.dead) {
      let best = null, bd = 16 * CELL;
      const claimed = new Set(this.bullets.filter(q => q.homing && q !== b).map(q => q.tgt));
      for (const o of this.tanks) if (this.hostile(b.team, o.team) && o.team !== b.team) { const d = Math.hypot(o.x - b.x, o.y - b.y) + (claimed.has(o.id) ? 120 : 0); if (d < bd) { bd = d; best = o; } }
      tg = best; b.tgt = best ? best.id : 0;
    }
    const sp = Math.min(260, 150 + b.age * 60);
    let a = Math.atan2(b.vy, b.vx);
    if (tg && b.age > 0.15) {
      const want = Math.atan2(tg.y - b.y, tg.x - b.x);
      const da = ((want - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      a += clamp(da, -6 * dt, 6 * dt);
    }
    b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (!this.G.in(Math.floor(b.x / CELL), Math.floor(b.y / CELL))) { this.killBullet(b); return; }
    for (const o of this.tanks) {
      if (!this.hostile(b.team, o.team) || o.team === b.team) continue;
      if (Math.abs(o.x - b.x) < TR + 2 && Math.abs(o.y - b.y) < TR + 2) { this.hitTank(o, b.dmg, b); this.ev({ e: 'boom', x: b.x, y: b.y, s: 1 }); this.killBullet(b); return; }
    }
    for (const st of this.structs) if (this.hostile(b.team, st.team) && st.team !== b.team && Math.abs(st.x - b.x) < st.size * 10 && Math.abs(st.y - b.y) < st.size * 10) { this.hitStruct(st, b.dmg, b); this.ev({ e: 'boom', x: b.x, y: b.y, s: 1 }); this.killBullet(b); return; }
  }
  killBullet(b) { const i = this.bullets.indexOf(b); if (i >= 0) this.bullets.splice(i, 1); b.dead = true; }
  /** a rocket / artillery shell / guided missile goes off */
  bulletBoom(b, x, y, guidedHit) {
    const i = this.bullets.indexOf(b); if (i >= 0) this.bullets.splice(i, 1);
    b.dead = true;
    const owner = this.tankById(b.owner);
    if (owner && owner.guiding === b.id) owner.guiding = 0;
    const by = owner || { team: b.team, pid: b.pid, id: 0 };
    if (b.guided) this.explode(x, y, b.r, b.dmg, by, { hedge: true, mines: true, breakAll: true });
    else if (b.art) this.explode(x, y, b.r, b.dmg, by, { mines: true });
    else this.explode(x, y, b.r, b.dmg, by, { noConcrete: true, mines: true });
  }

  /* ------------------------------------------------ bullets */
  bulletStep(dt) {
    const G = this.G;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (b.frozenT > 0) { b.frozenT -= dt; continue; }
      b.age = (b.age || 0) + dt;
      if (b.homing) { this.homingStep(b, dt); continue; }
      if (b.art) {                                          // artillery flies over everything
        const f = Math.min(1, b.age / b.T);
        b.x = b.sx + (b.tx - b.sx) * f; b.y = b.sy + (b.ty - b.sy) * f; b.z = Math.sin(Math.PI * f) * 34;
        if (f >= 1) this.bulletBoom(b, b.tx, b.ty);
        continue;
      }
      b.ttl -= dt;
      if (b.rocket && b.ttl <= 0) { this.bulletBoom(b, b.x, b.y); continue; }
      const steps = 3, sx = b.vx * dt / steps, sy = b.vy * dt / steps;
      let dead = b.ttl <= 0;
      for (let s = 0; s < steps && !dead; s++) {
        b.x += sx; b.y += sy;
        const cx = Math.floor(b.x / CELL), cy = Math.floor(b.y / CELL);
        if (!G.in(cx, cy)) { dead = true; break; }
        // tanks (a guided missile flies over them)
        if (!b.guided) for (const t of this.tanks) {
          if (t.id === b.owner && !(b.bounce !== undefined && b.age > 0.3 && this.cfg.ff)) continue;
          if (b.rocket && Math.abs(t.x - b.x) < TR + 1 && Math.abs(t.y - b.y) < TR + 1) { if (this.hostile(b.team, t.team) || this.cfg.ff) { this.bulletBoom(b, b.x, b.y); dead = true; break; } continue; }
          if (Math.abs(t.x - b.x) < TR + 1 && Math.abs(t.y - b.y) < TR + 1) {
            // shots fly THROUGH your own side (players and bots) — unless friendly fire is on
            if (!this.hostile(b.team, t.team) && !this.cfg.ff) continue;
            this.hitTank(t, b.dmg, b);
            if (b.splash) this.explode(b.x, b.y, 1, b.dmg, this.tankById(b.owner) || { team: b.team, pid: b.pid });
            else this.ev({ e: 'hit', x: b.x, y: b.y });
            dead = true; break;
          }
        }
        if (dead) break;
        const tt = G.t[cy * G.W + cx];
        if (b.rocket && (SOLID_SHOT[tt] || (b.guided && tt === T.HEDGE))) {
          if (tt === T.STRUCT && !b.guided) { const st = this.structById(G.sid[cy * G.W + cx]); if (st && !this.hostile(b.team, st.team) && !this.cfg.ff) continue; }
          this.bulletBoom(b, b.x, b.y, true); dead = true; break;
        }
        if (SOLID_SHOT[tt] && b.bounce > 0 && tt !== T.STRUCT) {
          // violet plasma: bounces off the wall; it turns aside where it can (a real ricochet), else straight back
          b.x -= sx; b.y -= sy; b.bounce--;
          const d = b.vx > 0 ? 1 : b.vx < 0 ? 3 : b.vy > 0 ? 2 : 0, sp = Math.hypot(b.vx, b.vy);
          const bx = Math.floor(b.x / CELL), by = Math.floor(b.y / CELL);
          const side = (d % 2 ? [0, 2] : [1, 3]).filter(k2 => !SOLID_SHOT[G.at(bx + DIRS[k2][0], by + DIRS[k2][1])]);
          let nd;
          if (side.length) {
            // prefer the side where an enemy stands
            const foe = (k2) => this.tanks.some(o => this.hostile(b.team, o.team) && o.team !== b.team && Math.sign(o.x - b.x) === DIRS[k2][0] && Math.sign(o.y - b.y) === DIRS[k2][1] && (DIRS[k2][0] ? Math.abs(o.y - b.y) < 12 : Math.abs(o.x - b.x) < 12));
            const good = side.filter(foe);
            nd = (good.length ? good : side)[(b.id + b.bounce) % (good.length || side.length)];
            // snap onto the lane of the new direction
            if (nd % 2) b.y = by * CELL + HALF; else b.x = bx * CELL + HALF;
          } else nd = (d + 2) % 4;
          b.vx = DIRS[nd][0] * sp; b.vy = DIRS[nd][1] * sp;
          b.ttl = Math.max(b.ttl, 1.2);
          this.ev({ e: 'ricochet', x: b.x, y: b.y });
          break;
        }
        if (tt === T.STRUCT && !this.cfg.ff) { const st = this.structById(G.sid[cy * G.W + cx]); if (st && !this.hostile(b.team, st.team)) continue; }   // and through your own radar and guns
        if (SOLID_SHOT[tt]) {
          const i2 = cy * G.W + cx;
          if (tt === T.STRUCT) { const st = this.structById(G.sid[i2]); if (st) this.hitStruct(st, b.dmg, b); }
          else if (tt === T.CRATE || tt === T.CONCRETE) this.hitTile(cx, cy, b.dmg);
          if (b.splash) this.explode(b.x - sx, b.y - sy, 1, b.dmg, this.tankById(b.owner) || { team: b.team, pid: b.pid });
          else this.ev({ e: 'hit', x: b.x - sx, y: b.y - sy });
          dead = true;
        }
      }
      if (dead && !b.dead) this.bullets.splice(i, 1);
    }
    // shells meet in the air: the weaker one is gone, double and armour-piercing ones go on
    const B = this.bullets;
    for (let i = 0; i < B.length; i++) {
      const a = B[i]; if (a.art || a.rocket || a.homing || a.dead) continue;
      for (let j = i + 1; j < B.length; j++) {
        const c = B[j]; if (c.art || c.rocket || c.homing || c.dead || a.team === c.team) continue;
        if (Math.abs(a.x - c.x) > 7 || Math.abs(a.y - c.y) > 7) continue;
        for (const q of [a, c]) { if (q.pierce > 0) { q.pierce--; q.dmg = Math.max(1, q.dmg - 1); } else q.dead = true; }
        this.ev({ e: 'hit', x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 });
        if (a.dead) break;
      }
    }
    if (B.some(q => q.dead)) this.bullets = B.filter(q => !q.dead);
  }
  truceBlocks(attTeam, defTeam) { return this.cfg.mode === 'bases' && this.truceT > 0 && attTeam !== defTeam && attTeam < AI_TEAM && defTeam < AI_TEAM; }
  hitTank(t, dmg, b) {
    if (t.prot > 0 || this.truceBlocks(b.team, t.team)) return;
    if (t.shieldT > 0) { t.shAcc = (t.shAcc || 0) + dmg / 3; dmg = Math.floor(t.shAcc); t.shAcc -= dmg; if (dmg <= 0) { this.ev({ e: 'field', x: t.x, y: t.y }); return; } }
    if (t.field > 0) { const a = Math.min(t.field, dmg); t.field -= a; dmg -= a; t.fieldT = 0; this.ev({ e: 'field', x: t.x, y: t.y }); if (dmg <= 0) return; }
    if (t.armor > 0) { const a = Math.min(t.armor, dmg); t.armor -= a; dmg -= a; this.ev({ e: 'armor', x: t.x, y: t.y }); if (dmg <= 0) { t.lastHit = this.time; return; } }
    t.hp -= dmg; t.lastHit = this.time;
    const by = this.tankById(b.owner) || (b.pid ? { pid: b.pid, team: b.team, name: (this.players.get(b.pid) || {}).name } : null);
    if (by && this.hostile(by.team, t.team) && by.team !== t.team) {
      if (by.pid) this.gainXP(this.players.get(by.pid), Math.min(dmg, Math.max(0, t.hp + dmg)) * 2);
      else if (by.owner) this.gainXP(this.players.get(by.owner), Math.min(dmg, Math.max(0, t.hp + dmg)));
    }
    if (t.ai && by) { t.ai.tgt = by.id || 0; t.ai.hurt = this.time; }
    if (t.hp <= 0) this.killTank(t, by);
  }
  hitStruct(s, dmg, b) {
    if (!this.hostile(b.team, s.team) && !this.cfg.ff) return;
    if (this.truceBlocks(b.team, s.team)) return;
    s.hp -= dmg;
    if (s.type === 'hq') {
      this.ev({ e: 'hqhit', team: s.team });
      if (s.team === AI_TEAM && this.ai) this.ai.alarm = this.time;
      const ti = this.teamInfo[s.team], att = b && b.owner > 0 ? this.tankById(b.owner) : null;
      if (ti) { ti.alarm = this.time; if (att) ti.alarmAt = [this.cellOf(att.x), this.cellOf(att.y), att.id]; }
    }
    if (s.hp <= 0) {
      const p = b.pid && this.players.get(b.pid); if (p) { p.coins += s.type === 'hq' ? 100 : 15; p.score += s.type === 'hq' ? 10 : 2; this.gainXP(p, s.type === 'hq' ? 80 : 15); }
      this.destroyStruct(s, b);
    }
  }
  hitTile(cx, cy, dmg) {
    const G = this.G, i = cy * G.W + cx;
    G.hp[i] -= dmg;
    if (G.hp[i] <= 0) {
      const wasCrate = G.t[i] === T.CRATE;
      G.t[i] = T.EMPTY; G.hp[i] = 0; this.crater(cx, cy); this.ev({ e: 'crumble', x: cx * CELL + HALF, y: cy * CELL + HALF });
      if (wasCrate && this.r() < 0.12) this.addPickup(this.r() < 0.5 ? 'box' : this.r() < 0.5 ? 'coin' : 'star', cx, cy);
    }
    this.tileChanged(i);
  }
  explode(x, y, radius, dmg, by, opt) {
    opt = opt || {};
    this.ev({ e: 'boom', x, y, s: radius >= 2.5 ? 3 : radius > 1.3 ? 2 : 1 });
    if (radius >= 1 && (opt.mines || opt.hedge || opt.breakAll || radius >= 1.5 || opt.crater)) this.craterLater = [Math.floor(x / CELL), Math.floor(y / CELL)];
    const R = radius * CELL;
    for (const t of this.tanks.slice()) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < R + TR) { if (!by || this.hostile(by.team, t.team) || this.cfg.ff || by.kind === 'kamikaze') this.hitTank(t, Math.max(1, Math.round(dmg * (1 - d / (R + TR * 2)))), { team: by ? by.team : -1, owner: by ? by.id : 0, pid: by ? by.pid : 0 }); }
    }
    if (opt.mines) for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      if ((!by || m.team !== by.team) && Math.hypot(m.cx * CELL + HALF - x, m.cy * CELL + HALF - y) < R + HALF) { this.mines.splice(i, 1); this.ev({ e: 'hit', x: m.cx * CELL + HALF, y: m.cy * CELL + HALF }); }
    }
    const hitS = new Set();
    const c0 = Math.floor((x - R) / CELL), c1 = Math.floor((x + R) / CELL), r0 = Math.floor((y - R) / CELL), r1 = Math.floor((y + R) / CELL);
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const tt = this.G.at(cx, cy);
      if (Math.hypot((cx + 0.5) * CELL - x, (cy + 0.5) * CELL - y) > R + HALF) continue;
      const near = Math.abs(cx * CELL + HALF - x) < CELL * 1.2 && Math.abs(cy * CELL + HALF - y) < CELL * 1.2 && (Math.abs(cx * CELL + HALF - x) < CELL * 0.6 || Math.abs(cy * CELL + HALF - y) < CELL * 0.6);
      if (opt.breakAll && near && (tt === T.CONCRETE || tt === T.ARMOR || tt === T.CRATE || tt === T.HEDGE)) { this.breakTile(cx, cy); continue; }
      if (opt.hedge && tt === T.HEDGE) { this.breakTile(cx, cy); continue; }
      if (tt === T.CRATE || (tt === T.CONCRETE && !opt.noConcrete)) this.hitTile(cx, cy, Math.ceil(dmg / 2));
      else if (tt === T.STRUCT) { const st = this.structById(this.G.sid[cy * this.G.W + cx]); if (st && !st.dead && !hitS.has(st)) { hitS.add(st); this.hitStruct(st, dmg * 2, { team: by ? by.team : -1, pid: by ? by.pid : 0, owner: by ? by.id : 0 }); } }
    }
    if (this.craterLater) { const [qx, qy] = this.craterLater; this.craterLater = null; this.crater(qx, qy); }
  }

  crater(cx, cy) {
    const G = this.G; if (!G.in(cx, cy)) return;
    const i = cy * G.W + cx;
    if (G.t[i] !== T.EMPTY) return;
    const sand = (G.g[i] >= 55 && G.g[i] <= 99) || this.cfg.theme === 'desert';
    G.g[i] = (sand ? [79, 80, 81] : [52, 53, 54])[(this.r() * 3) | 0];
    this.tileChanged(i);
  }
  breakTile(cx, cy) {
    const G = this.G; if (!G.in(cx, cy)) return;
    const i = cy * G.W + cx; G.t[i] = T.EMPTY; G.hp[i] = 0; this.crater(cx, cy); this.tileChanged(i);
    this.ev({ e: 'crumble', x: cx * CELL + HALF, y: cy * CELL + HALF });
  }
  /* ------------------------------------------------ turrets */
  turretStep(s, dt) {
    if (s.frozenT > 0) { s.frozenT -= dt; return; }
    if (s.reload > 0) s.reload -= dt;
    const range = (7 + this.cfg.botLevel) * CELL;
    let best = null, bd = range;
    for (const t of this.tanks) {
      if (!this.hostile(s.team, t.team) || this.truceBlocks(s.team, t.team)) continue;
      const d = Math.hypot(t.x - s.x, t.y - s.y);
      if (d < bd && this.los(s.x, s.y, t.x, t.y, true)) { bd = d; best = t; }
    }
    if (!best) return;
    let tx = best.x, ty = best.y;
    if (s.team === AI_TEAM && this.lv.lead && best.moving) { const k = KINDS[best.kind]; const tt = bd / 230; tx += DIRS[best.dir][0] * k.speed * tt; ty += DIRS[best.dir][1] * k.speed * tt; }
    const want = Math.atan2(ty - s.y, tx - s.x);
    let da = ((want - s.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    s.ang += clamp(da, -3.2 * dt, 3.2 * dt);
    if (Math.abs(da) < 0.18 && s.reload <= 0) {
      s.reload = s.team === AI_TEAM ? 1.25 - this.cfg.botLevel * 0.15 : 1.0;
      const sp = 230;
      this.bullets.push({ id: this.id(), x: s.x + Math.cos(s.ang) * 12, y: s.y + Math.sin(s.ang) * 12, vx: Math.cos(s.ang) * sp, vy: Math.sin(s.ang) * sp, team: s.team, owner: -s.id, pid: s.owner || 0, dmg: 1, splash: 0, ttl: 2, kind: s.team === AI_TEAM ? 3 : 2, pierce: 0, age: 0 });
      this.ev({ e: 'shot', x: s.x, y: s.y, k: 0 });
    }
  }
  /** line of sight between two points: walls (except hedgehogs) block it; `crates` = crates block too */
  los(x0, y0, x1, y1, crates) {
    const G = this.G, d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 8);
    for (let i = 1; i < n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      const tt = G.at(Math.floor(x / CELL), Math.floor(y / CELL));
      if (tt === T.STRUCT) { const st = this.structById(G.sid[Math.floor(y / CELL) * G.W + Math.floor(x / CELL)]); if (st && (Math.hypot(st.x - x1, st.y - y1) > 30)) return false; continue; }
      if (SOLID_SHOT[tt] && (crates || tt !== T.CRATE)) return false;
    }
    return true;
  }

  /* ------------------------------------------------ pickups / flags */
  pickupStep(dt) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.ttl -= dt;
      if (p.ttl <= 0) { this.pickups.splice(i, 1); this.pickV = (this.pickV | 0) + 1; continue; }
      const px = p.cx * CELL + HALF, py = p.cy * CELL + HALF;
      for (const t of this.tanks) {
        if (Math.abs(t.x - px) > 14 || Math.abs(t.y - py) > 14) continue;
        if (t.bot && !t.owner && p.type === 'coin') continue;          // only players and their own bots take coins
        const pl = t.pid ? this.players.get(t.pid) : t.owner ? this.players.get(t.owner) : null;
        const rogue = t.kind === 'rogue' && t.ai;
        if (rogue && p.type === 'coin' && (t.ai.bag | 0) >= ROGUE_BAG) continue;          // the bag is full: home first
        if (p.type === 'coin') {
          if (t.kind === 'builder' && t.ai) { t.purse = (t.purse || 0) + 6; if (pl) pl.coins += 4; }      // the builder keeps some for the walls
          else if (rogue) t.ai.bag = (t.ai.bag | 0) + 1;                                            // the rogue: into the bag, paid double at home
          else if (pl) pl.coins += 10;
          if (pl && !t.pid && !rogue) this.ev({ e: 'msg', text: 'Ваш бот принёс монеты (+' + (t.kind === 'builder' ? 4 : 10) + '●)', to: pl.pid });
        }
        else if (rogue && p.type === 'box') { if (pl) { this.openBox({ pid: pl.pid }, pl); this.openBox({ pid: pl.pid }, pl); } }
        else if (rogue && p.type === 'drop') { if (pl) { pl.coins += 80; for (let k = 0; k < 4; k++) this.openBox({ pid: pl.pid }, pl); this.ev({ e: 'msg', text: 'Мошенник утащил сброс припасов: +80● и груз', to: pl.pid }); } }
        else if (p.type === 'repair') t.hp = Math.min(t.maxhp, t.hp + Math.ceil(t.maxhp * 0.6));
        else if (p.type === 'speed') t.speedT = pl && t.pid && pl.skills.engine >= 3 ? 18 : 10;
        else if (p.type === 'shield') t.shieldT = pl && t.pid && pl.skills.engine >= 3 ? 18 : 10;
        else if (p.type === 'freeze') this.freezeAround(t, 8 * CELL, 6);                      // the hourglass: longer than the bought freeze
        else if (p.type === 'star') { if (pl) { this.gainXP(pl, 25); this.ev({ e: 'msg', text: 'Звезда: +25 опыта', to: pl.pid }); } }
        else if (p.type === 'box') this.openBox(t, pl);
        else if (p.type === 'drop') { if (pl) { pl.coins += 40; this.ev({ e: 'msg', text: 'Сброс: +40● и редкий груз', to: pl.pid }); for (let k = 0; k < 3; k++) this.openBox(t, pl); this.say((pl.name || 'Бот') + ' забрал сброс припасов!'); } else t.hp = t.maxhp; }
        this.ev({ e: 'pick', x: px, y: py, k: p.type, to: t.pid || 0 });
        this.pickups.splice(i, 1); this.pickV = (this.pickV | 0) + 1;
        break;
      }
    }
    // pickups appear all over the map, more on bigger maps; most of them are coins, sometimes a whole pile
    const G = this.G, area = Math.max(1, G.W * G.H / 900);
    const def = this.cfg.mode === 'defense';
    const rate = def ? (this.waveState === 'fight' ? 0.1 : 0.07) : 0.15 + 0.05 * this.nPlayers;
    const most = Math.min(120, Math.round((def ? 18 : 14 + 4 * this.nPlayers) * area));
    let budget = rate * area * dt;
    while (budget > 0 && this.pickups.length < most) {
      if (this.r() >= Math.min(1, budget)) break;
      budget -= 1;
      const at = this.freeCell(def ? 0.7 : 1); if (!at) break;
      const type = ['coin', 'coin', 'coin', 'coin', 'coin', 'coin', 'repair', 'speed', 'shield', 'box', 'box', 'star', 'freeze'][(this.r() * 13) | 0];
      if (type === 'coin' && this.r() < 0.3) {                    // a pile of coins
        const n = 3 + ((this.r() * 3) | 0);
        for (let k = 0; k < n * 3 && n > 0; k++) { const dx = ((this.r() * 5) | 0) - 2, dy = ((this.r() * 5) | 0) - 2; this.addPickup('coin', at[0] + dx, at[1] + dy); }
      } else this.addPickup(type, at[0], at[1]);
    }
  }
  /** a random empty cell (in defense: the upper part, where the waves come from) */
  freeCell(hFrac) {
    const G = this.G;
    for (let k = 0; k < 12; k++) {
      const x = 1 + ((this.r() * (G.W - 2)) | 0), y = 1 + ((this.r() * ((G.H - 2) * (hFrac || 1))) | 0);
      if (G.at(x, y) === T.EMPTY && !this.pickups.some(p => p.cx === x && p.cy === y)) return [x, y];
    }
    return null;
  }
  flagStep(dt) {
    for (const f of this.flags) {
      if (f.carrier) {
        const t = this.tankById(f.carrier);
        if (!t) { f.carrier = 0; f.dropT = 15; continue; }
        f.x = t.x; f.y = t.y;
        // captured?
        const own = this.flags.find(g => g.team === t.team);
        if (own && !own.carrier && own.x === own.hx && own.y === own.hy && Math.abs(t.x - own.hx) < 16 && Math.abs(t.y - own.hy) < 16) {
          this.teamInfo[t.team].score++;
          f.carrier = 0; t.flag = -1; f.x = f.hx; f.y = f.hy;
          const p = this.players.get(t.pid); if (p) { p.score += 5; p.coins += 30; this.gainXP(p, 40); }
          this.say((t.name || 'Бот') + ' приносит флаг! Счёт ' + this.teamInfo[0].score + ':' + this.teamInfo[1].score);
          this.ev({ e: 'capture', team: t.team });
          if (this.teamInfo[t.team].score >= this.scoreLimit) this.finish(t.team, 'Победили ' + this.teamName(t.team) + '!');
        }
        continue;
      }
      const home = f.x === f.hx && f.y === f.hy;
      if (!home) { f.dropT -= dt; if (f.dropT <= 0) { f.x = f.hx; f.y = f.hy; this.say('Флаг ' + (f.team ? 'синих' : 'жёлтых') + ' вернулся на базу'); } }
      for (const t of this.tanks) {
        if (Math.abs(t.x - f.x) > 14 || Math.abs(t.y - f.y) > 14) continue;
        if (t.team === f.team) { if (!home) { f.x = f.hx; f.y = f.hy; this.say((t.name || 'Бот') + ' вернул свой флаг'); this.gainXP(this.players.get(t.pid), 10); } }
        else if (t.flag < 0 && (t.team === 0 || t.team === 1)) { f.carrier = t.id; t.flag = f.team; this.say((t.name || 'Бот') + ' взял флаг ' + (f.team ? 'синих' : 'жёлтых') + '!'); this.ev({ e: 'flag' }); break; }
      }
    }
  }
  dropFlag(t) { const f = this.flags.find(g => g.carrier === t.id); if (f) { f.carrier = 0; f.dropT = 15; f.x = Math.floor(t.x / CELL) * CELL + HALF; f.y = Math.floor(t.y / CELL) * CELL + HALF; t.flag = -1; } }

  /* =============================================================== bot AI */
  /** Dijkstra distance field from target cells; walls cost more (bots shoot through them) */
  flow(key, targets, team, limit) {
    if (this.flowCache.size > 120) { let n = 0; for (const k of this.flowCache.keys()) { this.flowCache.delete(k); if (++n >= 40) break; } }   // drop the oldest
    key = key + '#' + team;
    const c = this.flowCache.get(key);
    if (c && (this.time - c.at < 0.7 || (!this.tilesDirty && this.time - c.at < 3))) return c.d;
    const G = this.G, W = G.W, N = W * G.H;
    const d = c && c.d.length === N ? c.d : new Int32Array(N);
    d.fill(1e9);
    // Dijkstra on a typed binary heap (no allocations: big maps have 10 000 cells)
    if (!this.hpK || this.hpK.length < N * 4) { this.hpK = new Int32Array(N * 4); this.hpV = new Int32Array(N * 4); }
    const hk = this.hpK, hv = this.hpV; let hn = 0;
    const push = (i, v) => {
      let j = hn++;
      while (j > 0) { const p = (j - 1) >> 1; if (hv[p] <= v) break; hk[j] = hk[p]; hv[j] = hv[p]; j = p; }
      hk[j] = i; hv[j] = v;
    };
    const t = G.t, own = G.own, sid = G.sid, H = G.H, mine = team + 1;
    const scost = new Map();
    for (const [x, y] of targets) if (G.in(x, y)) { const i = y * W + x; d[i] = 0; push(i, 0); }
    while (hn > 0) {
      const i = hk[0], v = hv[0];
      // pop: move the last one down from the top
      const li = hk[--hn], lv = hv[hn];
      if (hn > 0) {
        let j = 0;
        for (;;) { const a = 2 * j + 1; if (a >= hn) break; const b2 = a + 1; const m = b2 < hn && hv[b2] < hv[a] ? b2 : a; if (hv[m] >= lv) break; hk[j] = hk[m]; hv[j] = hv[m]; j = m; }
        hk[j] = li; hv[j] = lv;
      }
      if (v > d[i]) continue;
      if (limit && v > limit) break;                                 // a short errand (a coin nearby): no need to search the whole map
      const x = i % W, y = (i - x) / W;
      for (let k = 0; k < 4; k++) {
        const nx = x + DIRS[k][0], ny = y + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx, tt = t[j];
        let cost = tt === T.EMPTY ? 10 : tt === T.CRATE ? 34 : tt === T.CONCRETE ? 110 : -1;
        if (cost > 10 && own[j] === mine) cost = -1;              // our own walls: go round them
        if (tt === T.STRUCT) {
          const id = sid[j]; let c2 = scost.get(id);
          if (c2 === undefined) { const st = this.structById(id); c2 = st && this.hostile(team, st.team) ? 60 : -1; scost.set(id, c2); }
          cost = c2;
        }
        if (cost < 0) continue;
        const nv = v + cost;
        if (nv < d[j]) { d[j] = nv; if (hn < hk.length) push(j, nv); }
      }
    }
    this.flowCache.delete(key); this.flowCache.set(key, { d, at: this.time });
    return d;
  }
  /** enemy HQ / structures as a flow target for `team` */
  attackTargets(team) {
    const out = [];
    for (const s of this.structs) if (s.type === 'hq' && this.hostile(team, s.team) && s.team !== WILD_TEAM) {
      for (let dy = -1; dy <= s.size; dy++) for (let dx = -1; dx <= s.size; dx++) out.push([s.cx + dx, s.cy + dy]);
    }
    return out;
  }
  think(t, dt) {
    if (t.ai.role === 'rogue') { this.rogueThink(t, dt); return; }
    const ai = t.ai, lv = this.lv;
    ai.think -= dt;
    if (ai.dodgeT > 0) { ai.dodgeT -= dt; t.want = ai.dodgeDir; }
    // stuck detection
    if (t.want >= 0 && !t.moving) ai.stuckT += dt; else ai.stuckT = Math.max(0, ai.stuckT - dt * 2);
    if (ai.think > 0) return;
    ai.think = lv.think * (0.7 + this.r() * 0.6);
    t.fire = false;
    // stuck for a while (a tank or a wall in the way): side-step, shoot what is in front
    if (ai.stuckT > 1.2) {
      ai.stuckT = 0;
      const side = t.want % 2 === 0 ? [1, 3] : [0, 2];
      const free = side.filter(d => !this.solidForTank(this.cellOf(t.x) + DIRS[d][0], this.cellOf(t.y) + DIRS[d][1]));
      ai.dodgeT = 0.6; ai.dodgeDir = free.length ? free[(this.r() * free.length) | 0] : (t.want + 2) % 4; t.want = ai.dodgeDir;
      t.fire = !this.friendlyInLine(t);
      return;
    }

    // a squad order from an intellectual
    const cmd = ai.cmd && ai.cmd.until > this.time && this.tankById(ai.cmd.brain) ? ai.cmd : null;
    if (!cmd) ai.cmd = null;
    // 1. a target in sight? (bots on an errand only fight what is close)
    const errand = cmd ? (cmd.phase === 'strike' || cmd.phase === 'cover' ? 9 : cmd.retreat ? 2 : cmd.phase === 'regroup' ? 4 : 6) : t.flag >= 0 ? 2.5 : ai.role === 'builder' ? 3 : ai.role === 'ctfAttack' ? 5 : ai.role === 'attack' && t.kind !== 'kamikaze' ? 8 : 0;
    const enemy = this.pickEnemy(t, errand);
    if (enemy && this.engage(t, enemy)) return;

    // 2. dodge incoming shells
    if (ai.dodgeT <= 0 && this.r() < (t.kind === 'brain' ? 0.9 : lv.dodge)) {
      for (const b of this.bullets) {
        if (!this.hostile(b.team, t.team)) continue;
        const towards = (b.vx > 0 && b.x < t.x) || (b.vx < 0 && b.x > t.x) || (b.vy > 0 && b.y < t.y) || (b.vy < 0 && b.y > t.y);
        const inLine = (b.vx !== 0 && Math.abs(b.y - t.y) < 10) || (b.vy !== 0 && Math.abs(b.x - t.x) < 10);
        if (towards && inLine && Math.hypot(b.x - t.x, b.y - t.y) < 90) {
          const opts = b.vx !== 0 ? [0, 2] : [1, 3];
          const d = opts[(this.r() * 2) | 0];
          ai.dodgeT = 0.35; ai.dodgeDir = d; t.want = d; return;
        }
      }
    }

    // 3. strategic movement
    let goal = null, key = null;
    let role = ai.role;
    // our base is being hit: everybody close enough (and the defenders from anywhere) goes for the attacker
    const tiA = this.teamInfo[t.team];
    if (tiA && tiA.alarm && this.time - tiA.alarm < 7 && tiA.hq && !tiA.hq.dead && t.flag < 0 && role !== 'builder' && role !== 'wild'
        && (role === 'guard' || role === 'defend' || Math.abs(t.x - tiA.hq.x) + Math.abs(t.y - tiA.hq.y) < 16 * CELL)) {
      const at = tiA.alarmAt && this.tankById(tiA.alarmAt[2]);
      if (at) { const ax = this.cellOf(at.x), ay = this.cellOf(at.y); goal = [[ax, ay]]; key = 'al' + t.team + ':' + (ax >> 1) + ',' + (ay >> 1); }
      else { const hq = tiA.hq; goal = [[hq.cx - 1, hq.cy + 2], [hq.cx + 2, hq.cy + 2], [hq.cx - 1, hq.cy - 1], [hq.cx + 2, hq.cy - 1]]; key = 'hqd' + t.team; }
      this.followFlow(t, this.flow(key, goal, t.team)); return;
    }
    if (role === 'builder') { this.builderThink(t); return; }
    if (cmd && cmd.goals && cmd.goals.length) {
      const cx = this.cellOf(t.x), cy = this.cellOf(t.y);
      const near = cmd.goals.some(([x, y]) => Math.abs(x - cx) + Math.abs(y - cy) <= (cmd.phase === 'strike' ? 0 : 2));
      if (near && cmd.phase !== 'strike') { this.patrol(t, [cx, cy]); t.want = this.r() < 0.6 ? -1 : t.want; return; }       // hold at the meeting point
      this.followFlow(t, this.flow(cmd.key, cmd.goals, t.team)); return;
    }
    // hired bots now and then run for a coin lying near them
    if (t.owner && t.flag < 0) {
      const c = this.nearCoin(t, ai.fetch ? 9 : 6);
      if (c && (ai.fetch === c.id || this.r() < 0.35)) { ai.fetch = c.id; this.followFlow(t, this.flow('c' + c.cx + ',' + c.cy, [[c.cx, c.cy]], t.team, 400)); return; }
      ai.fetch = 0;
    }
    if (role === 'attack' && this.cfg.mode === 'bases' && this.truceT > 0) role = 'defend';     // nobody attacks during the truce
    if (role === 'guard' || role === 'defend') {
      const h = ai.guard || ai.home;
      // the HQ is under attack: everybody to the HQ
      const alarm = this.ai && this.ai.alarm && this.time - this.ai.alarm < 6 && t.team === AI_TEAM;
      const ti = this.teamInfo[t.team];
      if (alarm && ti.hq && !ti.hq.dead) { goal = [[ti.hq.cx - 1, ti.hq.cy + 2], [ti.hq.cx + 2, ti.hq.cy + 2], [ti.hq.cx - 1, ti.hq.cy - 1]]; key = 'hqd' + t.team; }
      else {
        const cx = this.cellOf(t.x), cy = this.cellOf(t.y);
        if (Math.abs(cx - h[0]) + Math.abs(cy - h[1]) <= 2) { this.patrol(t, h); return; }
        goal = [h]; key = 'g' + h.join(',');
      }
    } else if (role === 'follow' && ai.leader) {
      const lp = this.players.get(ai.leader), lt = lp && lp.tank;
      if (lt) { const lx = this.cellOf(lt.x), ly = this.cellOf(lt.y); if (Math.abs(lx - this.cellOf(t.x)) + Math.abs(ly - this.cellOf(t.y)) <= 3) { this.patrol(t, [lx, ly]); return; } goal = [[lx, ly]]; key = 'p' + ai.leader; }
    } else if (role === 'ctfAttack' || role === 'ctfDefend') {
      const own = this.flags.find(f => f.team === t.team), their = this.flags.find(f => f.team !== t.team);
      if (t.flag >= 0) { goal = [[this.cellOf(own.hx), this.cellOf(own.hy)]]; key = 'fh' + t.team; }
      else if (own && (own.x !== own.hx || own.y !== own.hy)) { goal = [[this.cellOf(own.x), this.cellOf(own.y)]]; key = 'fo' + t.team + ':' + this.cellOf(own.x) + ',' + this.cellOf(own.y); }
      else if (role === 'ctfAttack' && their && their.carrier) {
        // a team-mate carries their flag: escort him home
        const c = this.tankById(their.carrier), cx = this.cellOf(c.x), cy = this.cellOf(c.y);
        if (Math.abs(cx - this.cellOf(t.x)) + Math.abs(cy - this.cellOf(t.y)) <= 2) { this.patrol(t, [cx, cy]); return; }
        goal = [[cx, cy]]; key = 'fe' + t.team + ':' + cx + ',' + cy;
      }
      else if (role === 'ctfAttack' && their && !ai.wpDone && this.ctfWaypoint(t)) {
        // go round by a random lane, not head-on through the middle
        const w = ai.wp;
        if (Math.abs(w[0] - this.cellOf(t.x)) + Math.abs(w[1] - this.cellOf(t.y)) <= 2) ai.wpDone = true;
        goal = [w]; key = 'w' + w.join(',');
      }
      else if (role === 'ctfAttack' && their) { goal = [[this.cellOf(their.x), this.cellOf(their.y)]]; key = 'ft' + t.team + ':' + this.cellOf(their.x) + ',' + this.cellOf(their.y); }
      else { const h = ai.home; if (Math.abs(this.cellOf(t.x) - h[0]) + Math.abs(this.cellOf(t.y) - h[1]) <= 3) { this.patrol(t, h); return; } goal = [h]; key = 'g' + h.join(','); }
    }
    if (!goal && (role === 'attack' || role === 'defend')) {
      const tg = this.attackTargets(t.team);
      if (tg.length) { goal = tg; key = 'hq' + t.team; }
    }
    if (!goal) {
      // hunt the nearest enemy tank
      let best = null, bd = 1e9;
      for (const o of this.tanks) if (this.hostile(t.team, o.team) && !this.truceBlocks(t.team, o.team)) { const d = Math.abs(o.x - t.x) + Math.abs(o.y - t.y); if (d < bd) { bd = d; best = o; } }
      if (best) { const bx = this.cellOf(best.x), by = this.cellOf(best.y); goal = [[bx, by]]; key = 'h' + ((bx >> 1) * 1000 + (by >> 1)); }
      else { this.patrol(t, [this.cellOf(t.x), this.cellOf(t.y)]); return; }
    }
    this.followFlow(t, this.flow(key, goal, t.team));
  }
  ctfWaypoint(t) {
    const ai = t.ai, G = this.G;
    if (ai.wp) return true;
    if (ai.wp === null) return false;
    const mid = G.W >> 1, lanes = [];
    for (let y = 2; y < G.H - 2; y++) for (let x = mid - 3; x <= mid + 3; x++) if (!this.solidForTank(x, y)) lanes.push([x, y]);
    if (!lanes.length || this.r() < 0.25) { ai.wp = null; return false; }
    // prefer the edges of the map: a flank
    lanes.sort((a, b) => Math.abs(b[1] - G.H / 2) - Math.abs(a[1] - G.H / 2));
    ai.wp = lanes[(this.r() * Math.max(1, lanes.length * 0.5)) | 0];
    return true;
  }
  /* ---------------- the intellectual: squad tactics ----------------
   * every second: who is in my squad, what do we attack, by which two ways (around enemy turrets),
   * where do we meet before the strike; then everybody strikes at once and fires at the same enemy.
   * Badly damaged members are sent back to the base to be repaired (the base heals). */
  brainPlan(b) {
    const ai = b.ai, G = this.G, me = b.team;
    const sq = this.tanks.filter(o => o.ai && o !== b && o.team === me && o.flag < 0 && o.kind !== 'builder' && o.ai.role !== 'guard' && o.ai.role !== 'wild' && o.ai.role !== 'defend' && o.ai.role !== 'ctfDefend'
      && (b.owner ? o.owner === b.owner : !o.owner) && Math.abs(o.x - b.x) + Math.abs(o.y - b.y) < 30 * CELL);
    const team = [b, ...sq];
    const say = (text) => { if (this.time - (ai.saidT || -99) > 3) { ai.saidT = this.time; this.say('🧠 ' + (b.name || 'Интеллектуал') + ': ' + text, me); } };
    const ti = this.teamInfo[me];
    // the wounded go home (if there is a home that heals)
    const home = ti && ti.hq && !ti.hq.dead ? [[ti.hq.cx - 1, ti.hq.cy + 2], [ti.hq.cx + 2, ti.hq.cy - 1], [ti.hq.cx - 1, ti.hq.cy - 1], [ti.hq.cx + 2, ti.hq.cy + 2]] : null;
    const healthy = [];
    for (const o of team) {
      if (home && o.hp < o.maxhp * 0.34 && o !== b) { o.ai.cmd = { brain: b.id, goals: home, key: 'home' + me, retreat: true, phase: 'retreat', until: this.time + 6 }; if (!o.ai.saidRet) { o.ai.saidRet = 1; say((o.pid ? o.name : botName(o)) + ', отходи на базу чиниться'); } }
      else { o.ai.saidRet = 0; healthy.push(o); }
    }
    // the target
    const tgt = this.brainTarget(b);
    if (!tgt) { ai.plan = null; for (const o of healthy) if (o !== b) o.ai.cmd = null; return; }
    let P = ai.plan;
    const same = P && P.key === tgt.key;
    if (!same || P.phase === 'done' || this.time - P.at > 45) {
      // new plan: two routes around the enemy's guns, a meeting point on each
      const routes = this.brainRoutes(b, tgt, healthy);
      P = ai.plan = { key: tgt.key, at: this.time, phase: tgt.moving ? 'strike' : 'gather', strikeAt: this.time, routes, tgt, struck: 0 };
      if (tgt.moving) { if (healthy.length > 1) say('цель — ' + tgt.name + ': берём в клещи, бьём с разных сторон, не встаём с ним в одну линию лоб в лоб'); }
      else if (healthy.length > 1) say(routes.length > 1 ? 'план: идём двумя группами в обход пушек — слева и справа, собираемся у цели и бьём разом. Цель: ' + tgt.name : 'план: собираемся у цели и бьём все вместе. Цель: ' + tgt.name);
    }
    P.tgt = tgt;
    // gather -> strike: when most of us are at the meeting points (or waited long enough)
    if (P.phase === 'gather') {
      let at = 0;
      healthy.forEach((o, i) => { const r = P.routes[i % P.routes.length]; if (r && Math.abs(this.cellOf(o.x) - r.meet[0]) + Math.abs(this.cellOf(o.y) - r.meet[1]) <= 3) at++; });
      // strike when most of us are there and we are enough (or waited too long)
      const enough = healthy.length >= Math.min(4, 1 + sq.length);
      if ((at >= Math.max(2, Math.ceil(healthy.length * 0.75)) && enough) || this.time - P.at > 30 || (healthy.length <= 1 && this.time - P.at > 8)) { P.phase = 'strike'; P.strikeAt = this.time; if (healthy.length > 1) say('все на месте — в атаку! Огонь по одной цели'); }
    } else if (P.phase === 'strike' && this.time - P.strikeAt > 28) P.phase = 'done';
    // the focus: the enemy that hurts us most right now near the target or near us
    let focus = 0, fb = 1e9;
    for (const o of this.tanks) if (this.hostile(me, o.team) && o.team !== me && !this.truceBlocks(me, o.team)) {
      let d = 1e9; for (const m of healthy) d = Math.min(d, Math.abs(o.x - m.x) + Math.abs(o.y - m.y));
      if (d > 9 * CELL) continue;
      // the one we kill fastest: few HP left, many of us already have a clear line to it
      let lines = 0; for (const m of healthy) if ((Math.abs(m.x - o.x) < 10 || Math.abs(m.y - o.y) < 10) && this.los(m.x, m.y, o.x, o.y, true)) lines++;
      const sc = d * 0.5 + (o.hp + (o.armor || 0) + (o.field || 0)) * 40 - lines * 60 - (o.pid ? 20 : 0) - (o.kind === 'brain' ? 60 : 0);
      if (sc < fb) { fb = sc; focus = o.id; }
    }
    if (focus && focus !== ai.lastFocus && P.phase === 'strike') { ai.lastFocus = focus; const f = this.tankById(focus); if (f && f.pid) say('огонь по ' + f.name + '!'); }
    // crossfire: in the fight every member takes its own firing position in line with the focus target,
    // from different sides, where no other enemy has a clear shot at it
    const F = focus ? this.tankById(focus) : null;
    const spots = new Map();
    if (F && P.phase === 'strike' && !tgt.moving && !this.noSpots) {
      const used = [];
      for (const o of healthy) {
        if (Math.abs(o.x - F.x) + Math.abs(o.y - F.y) > 12 * CELL) continue;
        const sp = this.firingSpot(o, F, used);
        if (sp) { spots.set(o.id, sp); used.push(sp); }
      }
    }
    healthy.forEach((o, i) => {
      const r = P.routes[i % P.routes.length];
      const sp = spots.get(o.id);
      if (sp) { o.ai.cmd = { brain: b.id, goals: [[sp.x, sp.y]], key: 'fs' + sp.x + ',' + sp.y, phase: 'strike', hold: true, focus, until: this.time + 2 }; return; }
      if (P.phase === 'gather' && r) o.ai.cmd = { brain: b.id, goals: [r.meet], key: 'm' + r.meet.join(','), phase: 'gather', focus, until: this.time + 3 };
      else if (o === b && r && healthy.length > 2) o.ai.cmd = { brain: b.id, goals: [r.meet], key: 'm' + r.meet.join(','), phase: 'cover', focus, until: this.time + 3 };   // the commander covers from behind
      else if (tgt.moving) {
        // a fight in the field: everybody fights as usual but fires at the same enemy, and nobody fights alone
        let mate = null, md = 1e9; for (const q of healthy) if (q !== o) { const d = Math.abs(q.x - o.x) + Math.abs(q.y - o.y); if (d < md) { md = d; mate = q; } }
        const foesNear = this.tanks.filter(e => this.hostile(me, e.team) && e.team !== me && Math.abs(e.x - o.x) + Math.abs(e.y - o.y) < 7 * CELL).length;
        const alone = !this.noRegroup && mate && md > 6 * CELL && foesNear >= 2;
        o.ai.cmd = alone ? { brain: b.id, goals: [[this.cellOf(mate.x), this.cellOf(mate.y)]], key: 'rg' + mate.id, phase: 'regroup', focus, until: this.time + 2 }
          : { brain: b.id, goals: null, phase: 'strike', focus, until: this.time + 3 };
      }
      else o.ai.cmd = { brain: b.id, goals: tgt.cells, key: 'st' + tgt.key, phase: 'strike', focus, until: this.time + 3 };
    });
  }
  /** the best cell near `o` to shoot at `F` from: in its row or column with a clear line, 2-6 cells away,
   * not in the line of fire of other enemies, not on a line another member already takes */
  firingSpot(o, F, used) {
    const G = this.G, W = G.W, N = W * G.H;
    const ox = this.cellOf(o.x), oy = this.cellOf(o.y), fx = this.cellOf(F.x), fy = this.cellOf(F.y);
    const foes = this.tanks.filter(q => q !== F && this.hostile(o.team, q.team) && q.team !== o.team && Math.abs(q.x - o.x) + Math.abs(q.y - o.y) < 14 * CELL);
    const guns = this.structs.filter(st => st.type === 'turret' && this.hostile(o.team, st.team) && st.team !== o.team);
    const clear = (x0, y0, x1, y1) => { const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0); let x = x0 + dx, y = y0 + dy; while (x !== x1 || y !== y1) { const tt = G.at(x, y); if (tt !== T.EMPTY && tt !== T.HEDGE) return false; x += dx; y += dy; } return true; };
    // a small BFS from the member (steps), up to 8 cells
    const dist = new Map([[oy * W + ox, 0]]), q = [[ox, oy]];
    for (let h = 0; h < q.length; h++) { const [x, y] = q[h], d0 = dist.get(y * W + x); if (d0 >= 8) continue; for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy, j = ny * W + nx; if (!G.in(nx, ny) || dist.has(j) || G.at(nx, ny) !== T.EMPTY) continue; dist.set(j, d0 + 1); q.push([nx, ny]); } }
    let best = null, bs = 1e9;
    for (const [j, steps] of dist) {
      const x = j % W, y = (j / W) | 0;
      if (x !== fx && y !== fy) continue;
      const far = Math.abs(x - fx) + Math.abs(y - fy);
      if (far < 2 || far > 6 || !clear(x, y, fx, fy)) continue;
      if (this.tanks.some(t => t !== o && this.cellOf(t.x) === x && this.cellOf(t.y) === y)) continue;
      // never the same cell as a squad mate, and never behind a mate on the same line (he would block the shot)
      if (used.some(u => (u.x === x && u.y === y) || (u.x === x && x === fx && Math.sign(u.y - fy) === Math.sign(y - fy)) || (u.y === y && y === fy && Math.sign(u.x - fx) === Math.sign(x - fx)))) continue;
      let exp = 0;
      for (const e of foes) { const ex = this.cellOf(e.x), ey = this.cellOf(e.y); if ((ex === x || ey === y) && Math.abs(ex - x) + Math.abs(ey - y) <= 8 && clear(ex, ey, x, y)) exp++; }
      for (const gn of guns) if (Math.hypot(gn.cx - x, gn.cy - y) < 7 && this.los(gn.x, gn.y, x * CELL + HALF, y * CELL + HALF, true)) exp++;
      const side = x === fx ? (y < fy ? 0 : 2) : (x < fx ? 3 : 1);
      const crowd = used.filter(u => u.side === side).length;
      const sc = steps * 1.5 + exp * 7 + crowd * 6 + Math.abs(far - 4);
      if (sc < bs) { bs = sc; best = { x, y, side }; }
    }
    return best;
  }
  /** what the squad attacks: enemy HQ (or a turret in the way), the enemy flag, the enemy flag carrier, or the weakest group of enemies */
  brainTarget(b) {
    const me = b.team, m = this.cfg.mode;
    if (m === 'bases' && this.truceT > 0) return null;
    if (m === 'ctf') {
      const own = this.flags.find(f => f.team === me), their = this.flags.find(f => f.team !== me);
      if (own && own.carrier) { const c = this.tankById(own.carrier); if (c) return { key: 'carrier' + c.id, name: 'вор нашего флага', cells: [[this.cellOf(c.x), this.cellOf(c.y)]] }; }
      if (their && !their.carrier) return { key: 'flag' + their.team, name: 'вражеский флаг', cells: [[this.cellOf(their.x), this.cellOf(their.y)]] };
    }
    let best = null, bd = 1e9;
    for (const st of this.structs) if (st.type === 'hq' && this.hostile(me, st.team) && st.team !== me && st.team !== WILD_TEAM && !st.dead) {
      const d = Math.abs(st.x - b.x) + Math.abs(st.y - b.y); if (d < bd) { bd = d; best = st; }
    }
    if (best) {
      const cells = []; for (let dy = -1; dy <= best.size; dy++) for (let dx = -1; dx <= best.size; dx++) if (this.G.at(best.cx + dx, best.cy + dy) === T.EMPTY) cells.push([best.cx + dx, best.cy + dy]);
      return { key: 'hq' + best.id, name: 'радар', cells: cells.length ? cells : [[best.cx, best.cy + best.size]], x: best.x, y: best.y };
    }
    // no buildings: the enemy tank with most enemies around it gets... no — the weakest, loneliest one
    let pick = null, ps = 1e9;
    for (const o of this.tanks) if (this.hostile(me, o.team) && o.team !== me) {
      let friends = 0; for (const q of this.tanks) if (q !== o && q.team === o.team && Math.abs(q.x - o.x) + Math.abs(q.y - o.y) < 6 * CELL) friends++;
      let sx = 0, n = 0; for (const q of this.tanks) if (q.team === me && q.ai && q.ai.cmd && q.ai.cmd.brain === b.id) { sx += Math.abs(q.x - o.x) + Math.abs(q.y - o.y); n++; }
      const sc = (n ? sx / n : Math.abs(o.x - b.x) + Math.abs(o.y - b.y)) + friends * 90 + (o.hp + (o.armor || 0)) * 30 - (o.pid ? 40 : 0);
      if (sc < ps) { ps = sc; pick = o; }
    }
    const keep = b.ai.huntId && this.tankById(b.ai.huntId);
    if (keep && !keep.dead && Math.abs(keep.x - b.x) + Math.abs(keep.y - b.y) < 22 * CELL) pick = keep;
    if (pick) { b.ai.huntId = pick.id; return { key: 'hunt' + pick.id, name: pick.name || botName(pick), cells: [[this.cellOf(pick.x), this.cellOf(pick.y)]], moving: true }; }
    return null;
  }
  /** two approach routes: meeting points on the left and on the right of the straight line, avoiding the enemy guns */
  brainRoutes(b, tgt, squad) {
    const G = this.G, W = G.W, me = b.team;
    const dT = this.flow('bt' + tgt.key, tgt.cells, me);
    const sx = squad.reduce((a, o) => a + o.x, 0) / squad.length, sy = squad.reduce((a, o) => a + o.y, 0) / squad.length;
    const [tx, ty] = tgt.cells[0];
    const vx = tx - sx / CELL, vy = ty - sy / CELL, L = Math.hypot(vx, vy) || 1;
    const nx = -vy / L, ny = vx / L;
    const guns = this.structs.filter(st => st.type === 'turret' && this.hostile(me, st.team) && st.team !== me);
    const danger = (x, y) => guns.reduce((a, g) => a + (Math.hypot(g.cx - x, g.cy - y) < 7.5 ? 1 : 0), 0);
    // the meeting point: 9-14 cells from the target, out of turret range — wait there out of sight, then strike together
    const meets = [];
    for (let i = 0; i < W * G.H; i++) {
      const v = dT[i]; if (v < 90 || v > 150 || G.t[i] !== T.EMPTY) continue;
      const x = i % W, y = (i / W) | 0;
      const side = (x - tx) * nx + (y - ty) * ny;           // left (<0) or right (>0) of the line
      const back = (x - tx) * (-vx / L) + (y - ty) * (-vy / L);   // how much it is on our side of the target
      // not in sight of the target and its guards is better (walls between)
      const seen = this.los(x * CELL + HALF, y * CELL + HALF, tx * CELL + HALF, ty * CELL + HALF, true) ? 25 : 0;
      meets.push({ x, y, side, sc: danger(x, y) * 60 + seen - back * 3 + Math.abs(v - 115) * 0.25 });
    }
    const pick = (f) => { let m = null; for (const c of meets) if (f(c) && (!m || c.sc < m.sc)) m = c; return m; };
    const left = pick(c => c.side < -1.5), right = pick(c => c.side > 1.5);
    const out = [];
    if (left) out.push({ meet: [left.x, left.y] });
    if (right) out.push({ meet: [right.x, right.y] });
    if (!out.length) { const any = pick(() => true); if (any) out.push({ meet: [any.x, any.y] }); }
    if (squad.length < 3 && out.length > 1) out.length = 1;   // two or fewer: one group
    return out.length ? out : [{ meet: tgt.cells[0] }];
  }
  /* ---------------- extra fun ---------------- */
  extrasStep(dt) {
    // the base heals its own: tanks near their radar slowly repair
    if ((this.healT = (this.healT || 0) - dt) <= 0) {
      this.healT = 1.5;
      for (const t of this.tanks) {
        const ti = this.teamInfo[t.team]; const hq = ti && ti.hq;
        if (!hq || hq.dead || t.hp >= t.maxhp) continue;
        if (Math.abs(t.x - hq.x) < 4 * CELL && Math.abs(t.y - hq.y) < 4 * CELL && this.time - (t.lastHit || 0) > 3) { t.hp++; this.ev({ e: 'heal', x: t.x, y: t.y }); }
      }
    }
    // supply drop: a plane drops a big crate somewhere; whoever gets there first
    if (this.cfg.mode !== 'defense' || this.waveState === 'build') {
      this.dropT = (this.dropT === undefined ? 50 + this.r() * 30 : this.dropT) - dt;
      if (this.dropT <= 0) {
        this.dropT = 70 + this.r() * 40;
        const G = this.G;
        for (let k = 0; k < 40; k++) {
          const x = 2 + ((this.r() * (G.W - 4)) | 0), y = 2 + ((this.r() * (G.H - 4)) | 0);
          if (G.at(x, y) !== T.EMPTY || this.pickups.some(p => p.cx === x && p.cy === y)) continue;
          this.pickups.push({ id: this.id(), type: 'drop', cx: x, cy: y, ttl: 60 }); this.pickV = (this.pickV | 0) + 1;
          this.ev({ e: 'drop', x: x * CELL + HALF, y: y * CELL + HALF });
          this.say('📦 Сброс припасов! Большой ящик упал на карте — он отмечен на мини-карте');
          break;
        }
      }
    }
  }
  nearCoin(t, R) {
    let best = null, bd = R + 0.5;
    const cx = this.cellOf(t.x), cy = this.cellOf(t.y);
    for (const p of this.pickups) if (p.type === 'coin' || (p.type === 'box' && t.kind !== 'builder')) { const d = Math.abs(p.cx - cx) + Math.abs(p.cy - cy); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  /**
   * The rogue: four times as fast as a light tank, so it steers every step (a decision every quarter second).
   * It goes after whatever lies on the map — coins first, then supply drops, boxes, stars — anywhere, choosing
   * by the real path length and keeping away from enemy tanks and guns; hurt, it picks up a repair kit or
   * goes home to heal; with nothing left to collect it scouts the map instead of waiting at the base.
   * It shoots enemies in front of it but never stops to fight.
   */
  rogueThink(t, dt) {
    const ai = t.ai, G = this.G;
    const cx = this.cellOf(t.x), cy = this.cellOf(t.y);
    const owner = this.players.get(t.owner);
    const tiH = this.teamInfo[t.team], hqH = tiH && tiH.hq && !tiH.hq.dead ? tiH.hq : null;
    // at home with a bag: cash it in, double
    if (ai.bag > 0 && (!hqH || (Math.abs(cx - hqH.cx - 0.5) <= 3 && Math.abs(cy - hqH.cy - 0.5) <= 3))) {
      if (owner) { owner.coins += ai.bag * 20; this.ev({ e: 'msg', text: '💰 Мошенник сдал ' + ai.bag + ' мон. — вдвое: +' + ai.bag * 20 + '●', to: owner.pid }); this.ev({ e: 'pick', x: t.x, y: t.y, k: 'coin', to: owner.pid }); }
      ai.bag = 0; ai.rt = 0;
    }
    if (t.want >= 0 && !t.moving) ai.stuckT += dt; else ai.stuckT = Math.max(0, ai.stuckT - dt * 2);
    if (ai.dodgeT > 0) { ai.dodgeT -= dt; t.want = ai.dodgeDir; t.fire = true; return; }
    if (ai.stuckT > 0.5) {                                 // wedged (a tank in the way): a quick step aside, a new decision
      ai.stuckT = 0; ai.rt = 0;
      const side = (t.want >= 0 ? t.want : t.dir) % 2 === 0 ? [1, 3] : [0, 2];
      const free = side.filter(d => !this.solidForTank(cx + DIRS[d][0], cy + DIRS[d][1]));
      ai.dodgeT = 0.2; ai.dodgeDir = free.length ? free[(this.r() * free.length) | 0] : ((t.want >= 0 ? t.want : t.dir) + 2) % 4; t.want = ai.dodgeDir;
      return;
    }
    // shoot an enemy right in front (within 7 cells) without slowing down
    t.fire = false;
    const [fx, fy] = DIRS[t.dir];
    for (const o of this.tanks) {
      if (o === t || !this.hostile(t.team, o.team) || o.team === t.team || this.truceBlocks(t.team, o.team)) continue;
      const rx = o.x - t.x, ry = o.y - t.y;
      if ((fx && Math.sign(rx) === fx && Math.abs(ry) < 12 && Math.abs(rx) < 7 * CELL) || (fy && Math.sign(ry) === fy && Math.abs(rx) < 12 && Math.abs(ry) < 7 * CELL)) { t.fire = true; break; }
    }
    ai.rt = (ai.rt || 0) - dt;
    const tgt = ai.goalPick ? this.pickups.find(p => p.id === ai.goalPick) : null;
    if (ai.goalPick && !tgt) ai.rt = 0;                      // somebody took it: decide again at once
    if (ai.goal && Math.abs(ai.goal[0] - cx) + Math.abs(ai.goal[1] - cy) <= (ai.goalPick ? 0 : 1)) ai.rt = 0;
    if (ai.rt <= 0) {
      ai.rt = 0.25;
      ai.goal = null; ai.goalPick = 0;
      // danger: enemy tanks and guns nearby
      const foes = this.tanks.filter(o => this.hostile(t.team, o.team) && o.team !== t.team && !this.truceBlocks(t.team, o.team)).map(o => [this.cellOf(o.x), this.cellOf(o.y), 4]);
      for (const s2 of this.structs) if (s2.type === 'turret' && this.hostile(t.team, s2.team) && s2.team !== t.team) foes.push([s2.cx, s2.cy, 6]);
      const danger = (x, y) => { let d = 0; for (const [ex, ey, r] of foes) { const m = Math.abs(ex - x) + Math.abs(ey - y); if (m <= r) d += (r + 1 - m) * 6; } return d; };
      const hurt = t.hp < t.maxhp * 0.4;
      const ti = this.teamInfo[t.team], hq = ti && ti.hq && !ti.hq.dead ? ti.hq : null;
      this.flowCache.delete('rgd' + t.id + '#' + t.team);           // distances from where it is right now
      const D = this.flow('rgd' + t.id, [[cx, cy]], t.team);
      const VAL = { coin: 10, drop: 70, box: 6, star: 5, repair: hurt ? 30 : 1, speed: 2, shield: 2, freeze: 1 };
      const claimed = new Set(this.tanks.filter(o => o !== t && o.ai && o.ai.goalPick).map(o => o.ai.goalPick));
      let best = null, bs = 1e9;
      for (const p of this.pickups) {
        if (claimed.has(p.id)) continue;
        const dist = D[p.cy * G.W + p.cx]; if (dist >= 1e9) continue;
        const sc = (dist / 10 + 3 + danger(p.cx, p.cy)) / (VAL[p.type] || 1);
        if (sc < bs) { bs = sc; best = p; }
      }
      const full = (ai.bag | 0) >= ROGUE_BAG;
      if (full && best && best.type === 'coin') best = null;                                            // no room for coins: other things only
      if (full && best === null) {
        let b2 = null, s2 = 1e9;                                                                       // anything but coins on the way?
        for (const p of this.pickups) { if (p.type === 'coin' || claimed.has(p.id)) continue; const dist = D[p.cy * G.W + p.cx]; if (dist >= 1e9 || dist > 120) continue; const sc = dist / 10 + danger(p.cx, p.cy); if (sc < s2) { s2 = sc; b2 = p; } }
        best = b2;
      }
      const goHome = hq && ((hurt && (!best || best.type !== 'repair')) || (full && !best) || (!best && ai.bag > 0));
      if (goHome) ai.goal = [hq.cx + (t.id % 2 ? -1 : 2), hq.cy + 1];          // home: to heal or to hand the coins in
      else if (best) { ai.goal = [best.cx, best.cy]; ai.goalPick = best.id; }
      else {
        // nothing to pick up: scout somewhere far, where coins will turn up
        if (!ai.scout || Math.abs(ai.scout[0] - cx) + Math.abs(ai.scout[1] - cy) <= 2 || this.time > (ai.scoutT || 0)) {
          let pick = null, far = -1;
          for (let k = 0; k < 6; k++) { const c = this.freeCell(1); if (!c) continue; const d2 = D[c[1] * G.W + c[0]]; if (d2 < 1e9 && d2 - danger(c[0], c[1]) * 10 > far) { far = d2 - danger(c[0], c[1]) * 10; pick = c; } }
          ai.scout = pick; ai.scoutT = this.time + 12;
        }
        ai.goal = ai.scout;
      }
    }
    if (!ai.goal) { t.want = -1; return; }
    const [gx, gy] = ai.goal;
    if (gx === cx && gy === cy) { t.want = -1; return; }
    this.followFlow(t, this.flow('rg:' + gx + ',' + gy, [[gx, gy]], t.team));
    if (ai.dodgeT > 0) ai.dodgeT = Math.min(ai.dodgeT, 0.25);
  }
  /** the builder: collects coins, then walls the base in rings that always keep gates open */
  builderThink(t) {
    const ai = t.ai, G = this.G;
    const coin = this.nearCoin(t, 14);
    const cost = (t.purse || 0) >= 20 ? 15 : 5;
    if (ai.spot && (G.at(ai.spot[0], ai.spot[1]) !== T.EMPTY)) ai.spot = null;
    if (!ai.spot && (t.purse || 0) >= 5 && (!ai.spotT || this.time > ai.spotT)) {
      ai.spot = this.buildSpot(t.team); ai.spotT = this.time + 3;
      // nothing left to build: what is over 30 goes to the owner
      const own = this.players.get(t.owner);
      if (!ai.spot && t.purse > 30 && own) { own.coins += t.purse - 30; this.ev({ e: 'msg', text: 'Строитель отдал вам ' + (t.purse - 30) + '●', to: own.pid }); t.purse = 30; }
    }
    if (coin && (!ai.spot || Math.abs(coin.cx - this.cellOf(t.x)) + Math.abs(coin.cy - this.cellOf(t.y)) < 4)) {
      this.followFlow(t, this.flow('c' + coin.cx + ',' + coin.cy, [[coin.cx, coin.cy]], t.team)); return;
    }
    if (ai.spot) {
      const [sx, sy] = ai.spot, cx = this.cellOf(t.x), cy = this.cellOf(t.y);
      if (Math.abs(sx - cx) + Math.abs(sy - cy) === 1 && !this.tankAt(sx * CELL + HALF, sy * CELL + HALF, null) && this.safeToWall(sx, sy, t.team)) {
        G.set(sx, sy, cost === 15 ? T.CONCRETE : T.CRATE, (this.r() * 2) | 0); G.own[sy * G.W + sx] = t.team + 1; this.tileChanged(sy * G.W + sx);
        t.purse -= cost; ai.spot = null;
        this.ev({ e: 'build', x: sx * CELL + HALF, y: sy * CELL + HALF });
        const own = this.players.get(t.owner); if (own) this.gainXP(own, 1);
        return;
      }
      if (Math.abs(sx - cx) + Math.abs(sy - cy) <= 1) { ai.spot = null; ai.spotT = this.time + 1; this.patrol(t, [cx, cy]); return; }   // cannot build there now: another place
      const goals = [[sx + 1, sy], [sx - 1, sy], [sx, sy + 1], [sx, sy - 1]].filter(([x, y]) => G.in(x, y) && G.at(x, y) === T.EMPTY);
      if (goals.length) { this.followFlow(t, this.flow('bs' + sx + ',' + sy, goals, t.team)); return; }
      ai.spot = null;
    }
    const ti = this.teamInfo[t.team], h = ti && ti.hq && !ti.hq.dead ? [ti.hq.cx, ti.hq.cy + 3] : ai.home;
    if (Math.abs(this.cellOf(t.x) - h[0]) + Math.abs(this.cellOf(t.y) - h[1]) <= 3) this.patrol(t, h);
    else this.followFlow(t, this.flow('g' + h.join(','), [h], t.team));
  }
  /** a free cell on a ring around our radar; the middle of every side stays open (gates) */
  buildSpot(team) {
    const ti = this.teamInfo[team], G = this.G;
    if (!ti || !ti.hq || ti.hq.dead) return null;
    const hx = ti.hq.cx, hy = ti.hq.cy;                 // the radar takes hx..hx+1, hy..hy+1
    for (const R of [3, 5]) {
      const cells = [];
      for (let x = hx - R; x <= hx + 1 + R; x++) for (let y = hy - R; y <= hy + 1 + R; y++) {
        const ring = (x === hx - R || x === hx + 1 + R || y === hy - R || y === hy + 1 + R);
        if (!ring) continue;
        const along = (x === hx - R || x === hx + 1 + R) ? y - hy : x - hx;      // 0..1 = in line with the radar
        if (along >= -1 && along <= 2) continue;          // the gates: 4 cells wide in the middle of each side
        if (G.in(x, y) && G.at(x, y) === T.EMPTY) cells.push([x, y]);
      }
      for (let k = cells.length - 1; k > 0; k--) { const j = (this.r() * (k + 1)) | 0; [cells[k], cells[j]] = [cells[j], cells[k]]; }
      for (const [x, y] of cells) if (this.safeToWall(x, y, team)) return [x, y];
    }
    return null;
  }
  /** a wall here must not cut anything off (no closed rings, no trapped tanks) nor sit on a spawn, a pickup or a flag */
  safeToWall(x, y, team) {
    const G = this.G;
    if (G.at(x, y) !== T.EMPTY) return false;
    for (const ti of Object.values(this.teamInfo)) for (const [sx, sy] of ti.spawns || []) if (Math.abs(sx - x) + Math.abs(sy - y) <= 1) return false;
    if (this.pickups.some(p => p.cx === x && p.cy === y)) return false;
    if (this.flags.some(f => this.cellOf(f.hx) === x && this.cellOf(f.hy) === y)) return false;
    if (this.mines.some(m => m.cx === x && m.cy === y)) return false;
    // every open cell that could be reached before must still be reachable
    const W = G.W, H = G.H, N = W * H, free = (i) => G.t[i] === T.EMPTY;
    const count = (block) => {
      const seen = new Uint8Array(N); let start = -1;
      for (let i = 0; i < N; i++) if (free(i) && i !== block) { start = i; break; }
      if (start < 0) return 0;
      const q = [start]; seen[start] = 1; let n = 0;
      while (q.length) { const i = q.pop(); n++; const cx = i % W, cy = (i / W) | 0;
        for (const [dx, dy] of DIRS) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (!seen[j] && j !== block && free(j)) { seen[j] = 1; q.push(j); } } }
      return n;
    };
    let total = 0; for (let i = 0; i < N; i++) if (free(i)) total++;
    return count(y * W + x) === total - 1;
  }
  patrol(t, h) {
    const ai = t.ai;
    if (ai.stuckT > 0.6 || this.r() < 0.25 || t.want < 0) {
      const opts = [0, 1, 2, 3].filter(d => { const nx = this.cellOf(t.x) + DIRS[d][0], ny = this.cellOf(t.y) + DIRS[d][1]; return !this.solidForTank(nx, ny) && Math.abs(nx - h[0]) + Math.abs(ny - h[1]) <= 3; });
      t.want = opts.length ? opts[(this.r() * opts.length) | 0] : -1;
      ai.stuckT = 0;
    }
    if (this.r() < 0.08) t.want = -1;
  }
  followFlow(t, d) {
    const G = this.G, W = G.W, ai = t.ai;
    const cx = this.cellOf(t.x), cy = this.cellOf(t.y);
    const here = d[cy * W + cx];
    let best = -1, bv = here;
    // a tank standing still in the next cell: go round it if the detour is short
    const parked = (nx, ny) => this.tanks.some(o => o !== t && !o.moving && this.cellOf(o.x) === nx && this.cellOf(o.y) === ny);
    let blocked = false;
    for (let k = 0; k < 4; k++) {
      const nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
      if (!G.in(nx, ny)) continue;
      const raw = d[ny * W + nx], pk = raw < here && parked(nx, ny);
      if (pk) { blocked = true; continue; }
      if (raw < bv) { bv = raw; best = k; }
    }
    if (best < 0 && blocked) {                          // the way is blocked by a parked tank: step aside
      let sv = 1e9;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
        if (!G.in(nx, ny) || parked(nx, ny)) continue;
        const v = d[ny * W + nx];
        if (v <= here + 10 && v < sv && G.at(nx, ny) === T.EMPTY) { sv = v; best = k; }
      }
    }
    if (best < 0) { t.want = -1; return; }
    const nx = cx + DIRS[best][0], ny = cy + DIRS[best][1];
    const tt = G.at(nx, ny);
    if ((tt === T.CRATE || tt === T.CONCRETE) && G.own[ny * W + nx] === t.team + 1) { t.want = -1; return; }
    if (tt === T.CRATE || tt === T.CONCRETE || (tt === T.STRUCT && this.structById(G.sid[ny * W + nx]))) {
      // a wall on the way: face it and shoot (but never our own structures)
      if (tt === T.STRUCT) { const st = this.structById(G.sid[ny * W + nx]); if (st && !this.hostile(t.team, st.team)) { t.want = -1; return; } }
      if (t.dir !== best) t.want = best; else { t.want = -1; t.fire = !this.friendlyInLine(t); }
      return;
    }
    // stuck behind a tank: shoot (if enemy) or wiggle
    if (ai.stuckT > 0.9) {
      ai.stuckT = 0;
      const side = best % 2 === 0 ? [1, 3] : [0, 2];
      ai.dodgeT = 0.45; ai.dodgeDir = side[(this.r() * 2) | 0]; t.want = ai.dodgeDir; t.fire = !this.friendlyInLine(t);
      return;
    }
    t.want = best;
  }
  pickEnemy(t, errand) {
    const range = errand ? errand * CELL : (t.team === AI_TEAM && t.ai.role === 'guard' ? 9 : 8) * CELL + this.cfg.botLevel * CELL;
    let best = null, bs = 1e9;
    const prefer = t.ai.tgt && this.time - (t.ai.hurt || 0) < 4 ? t.ai.tgt : 0;
    const focus = t.ai.cmd && t.ai.cmd.until > this.time ? t.ai.cmd.focus : 0;
    for (const o of this.tanks) {
      if (o === t || !this.hostile(t.team, o.team) || this.truceBlocks(t.team, o.team)) continue;
      const d = Math.hypot(o.x - t.x, o.y - t.y);
      if (d > range) continue;
      if (!this.los(t.x, t.y, o.x, o.y, false)) continue;
      let s = d - (o.id === prefer ? 60 : 0) - (o.id === focus ? (this.focusBonus !== undefined ? this.focusBonus : 45) : 0);
      if (this.lv.lead) s -= (o.maxhp - o.hp) * 3;         // focus the weakest on "smart"
      if (o.pid) s -= 40;                                   // players are more interesting than bots
      if (s < bs) { bs = s; best = o; }
    }
    if (!best && t.kind !== 'kamikaze') {
      // enemy structures in range (turrets, HQ)
      for (const s of this.structs) {
        if (!this.hostile(t.team, s.team) || s.team === WILD_TEAM || this.truceBlocks(t.team, s.team)) continue;
        const d = Math.hypot(s.x - t.x, s.y - t.y);
        if (d < range && d < bs && this.los(t.x, t.y, s.x, s.y, false)) { bs = d; best = s; }
      }
    }
    return best;
  }
  /** returns true if the bot is busy fighting `o` */
  engage(t, o) {
    if (t.kind === 'kamikaze') { // ram it
      const d = this.flow('k' + (this.cellOf(o.x) >> 1) + ',' + (this.cellOf(o.y) >> 1), [[this.cellOf(o.x), this.cellOf(o.y)]], t.team);
      this.followFlow(t, d); return true;
    }
    let tx = o.x, ty = o.y;
    if ((this.lv.lead || t.kind === 'brain') && o.moving && o.dir !== undefined) { const k = KINDS[o.kind] || { speed: 0 }; const tt = Math.hypot(o.x - t.x, o.y - t.y) / 240; tx += DIRS[o.dir][0] * k.speed * tt; ty += DIRS[o.dir][1] * k.speed * tt; }
    const dx = tx - t.x, dy = ty - t.y, aim = (t.kind === 'brain' ? 5 : this.lv.aim) + (o.size ? o.size * 8 : 0);
    if (Math.abs(dx) <= aim || Math.abs(dy) <= aim) {
      const d = Math.abs(dx) <= aim ? (dy < 0 ? 0 : 2) : (dx < 0 ? 3 : 1);
      if (t.dir !== d) t.want = d;
      else {
        t.want = -1;
        t.fire = !this.friendlyInLine(t);
        // head-on with an enemy that shoots back: the shells meet in the air and nobody wins — leave the line
        const headOn = o.dir === (d + 2) % 4 && o.fire !== false && o.kind !== undefined && (Math.abs(dx) <= aim || Math.abs(dy) <= aim);
        t.ai.headOn = headOn ? (t.ai.headOn || 0) + this.lv.think : 0;
        if (t.ai.headOn > (t.kind === 'brain' || t.ai.cmd ? 1.2 : 2.6)) {
          t.ai.headOn = 0;
          const side = d % 2 ? [0, 2] : [1, 3];
          const free = side.filter(k => !this.solidForTank(this.cellOf(t.x) + DIRS[k][0], this.cellOf(t.y) + DIRS[k][1]) && !this.tankAt((this.cellOf(t.x) + DIRS[k][0]) * CELL + HALF, (this.cellOf(t.y) + DIRS[k][1]) * CELL + HALF, t));
          if (free.length) { t.ai.dodgeT = 0.55; t.ai.dodgeDir = free[(this.r() * free.length) | 0]; t.want = t.ai.dodgeDir; t.fire = false; return true; }
        }
        // siege keeps its distance, light tanks close in a little
        const dist = Math.hypot(dx, dy);
        if (t.kind === 'siege' && dist < 3 * CELL) t.want = (d + 2) % 4;
        else if (dist > 3.5 * CELL && t.kind !== 'siege' && t.kind !== 'builder' && !(t.ai.cmd && t.ai.cmd.hold) && this.r() < 0.7) t.want = d;      // close in
      }
      return true;
    }
    // not aligned: step to the axis that is closer
    const along = Math.abs(dx) < Math.abs(dy) ? (dx < 0 ? 3 : 1) : (dy < 0 ? 0 : 2);
    const nx = this.cellOf(t.x) + DIRS[along][0], ny = this.cellOf(t.y) + DIRS[along][1];
    if (!this.solidForTank(nx, ny)) { t.want = along; return true; }
    return false;
  }
  /** a friend (tank or building) would be hit first by a shot fired now (an enemy closer in the line shields him) */
  friendlyInLine(t) {
    if (!this.cfg.ff) return false;                     // shots pass through allies: nothing to hold fire for
    const [dx, dy] = DIRS[t.dir];
    let friend = 1e9, foe = 1e9;
    const along = (x, y, w) => {
      const rx = x - t.x, ry = y - t.y;
      if (dx && Math.sign(rx) === dx && Math.abs(ry) < w && Math.abs(rx) < 200) return Math.abs(rx);
      if (dy && Math.sign(ry) === dy && Math.abs(rx) < w && Math.abs(ry) < 200) return Math.abs(ry);
      return -1;
    };
    for (const o of this.tanks) {
      if (o === t) continue;
      const d = along(o.x, o.y, 12); if (d < 0) continue;
      if (this.hostile(t.team, o.team)) foe = Math.min(foe, d); else friend = Math.min(friend, d);
    }
    for (const s of this.structs) {
      const d = along(s.x, s.y, s.size * 10 + 2); if (d < 0) continue;
      if (this.hostile(t.team, s.team)) foe = Math.min(foe, d); else friend = Math.min(friend, d);
    }
    return friend < foe;
  }

  /* =============================================================== network snapshot */
  /** full map for the start message */
  mapData() {
    const G = this.G;
    const b64 = (a) => { let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
    return { W: G.W, H: G.H, t: b64(G.t), g: b64(G.g), v: b64(G.v), hp: Array.from(G.hp), theme: this.cfg.theme };
  }
  snapshot() {
    const G = this.G;
    const r = (v) => Math.round(v * 10) / 10;
    const s = {
      t: Math.round(this.time * 1000) / 1000,
      crown: (() => { let best = null; for (const p of this.players.values()) { p.crown = false; if (p.kills >= 3 && (!best || p.kills > best.kills)) best = p; } if (best) best.crown = true; return best ? best.pid : 0; })(),
      k: this.tanks.map(t => [t.id, r(t.x), r(t.y), t.dir, t.hp, t.maxhp, KIND_IDX[t.kind], t.team, (t.moving ? 1 : 0) | (t.prot > 0 ? 2 : 0) | (t.flag >= 0 ? 4 : 0) | (t.shieldT > 0 ? 8 : 0) | (t.speedT > 0 ? 16 : 0) | (t.bot ? 32 : 0) | (t.frozenT > 0 ? 64 : 0) | (t.guiding ? 128 : 0), t.pid, t.owner, t.name, t.lvl || 0, t.vet || 0, t.field || 0, t.fieldMax || 0, t.armor || 0, t.armorMax || 0]),
      b: this.bullets.map(b => [b.id, r(b.x), r(b.y), r(b.vx), r(b.vy), b.kind, b.z ? r(b.z) : 0, b.frozenT > 0 ? 1 : 0]),
      // tanks also carry their armour (index 16/17) — see the k list above
      m: this.mines.map(m => [m.id, m.cx, m.cy, m.team, m.big]),
      d: this.dyns.map(d => [d.id, d.cx, d.cy, Math.ceil(d.t)]),
      a: this.planes.map(q => [q.id, r(q.x), r(q.y), q.dir]),
      s: this.structs.map(st => [st.id, st.type === 'hq' ? 0 : 1, st.cx, st.cy, Math.ceil(st.hp), st.maxhp, st.team, Math.round(st.ang * 100) / 100]),
      // pickups only when they changed (there can be a hundred of them on a big map), and now and then anyway
      p: this.pickV !== this.sentPickV || (this.snapN = (this.snapN | 0) + 1) % 20 === 0 ? this.pickups.map(p => [p.id, PICK_IDX[p.type], p.cx, p.cy]) : undefined,
      f: this.flags.map(f => [f.team, r(f.x), r(f.y), f.carrier ? 1 : 0]),
      pl: Array.from(this.players.values()).map(p => [p.pid, p.coins, p.kills, p.deaths, p.tank ? p.tank.id : 0, p.tank ? 0 : Math.max(0, Math.ceil(p.respawn)), p.sel, p.order, p.out ? 1 : 0, p.score, p.built,
        Math.floor(p.xp), p.level, p.sp, SKILLS.map(k => p.skills[k.id]).join(''), KIND_IDX[p.kind], Object.keys(TANKS).reduce((m, k, i) => m | (p.owned[k] ? 1 << i : 0), 0), this.botCap(p), this.turretCap(p),
        this.tanks.filter(b => b.owner === p.pid && b.team === p.team).length, this.structs.filter(q => q.type === 'turret' && q.owner === p.pid).length, this.nearBase(p, p.tank || { x: -999, y: -999 }) ? 1 : 0,
        WIDX[p.w] | 0, WEAPONS.map(w => p.ammo[w.id] | 0).join(','), GEAR.map(g => p.gear[g.id] | 0).join(',')]),
      st: this.status,
      tc: Array.from(this.tileChanges.keys()).map(i => [i, G.t[i], G.hp[i], G.v[i], G.g[i]]),
      e: this.events,
    };
    if (this.teamInfo[0] && this.cfg.mode === 'ctf') s.sc = [this.teamInfo[0].score, this.teamInfo[1].score];
    this.tileChanges.clear(); this.events = []; this.tilesDirty = false; this.sentPickV = this.pickV;
    if (s.p === undefined) delete s.p;
    return s;
  }
  /** a new player joins a running battle */
  lateJoin(pid, name) {
    let team = 0;
    const m = this.cfg.mode;
    const teams = Array.from(this.players.values()).filter(q => !q.bot).map(q => q.team);
    if (m === 'ctf') team = teams.filter(x => x === 0).length <= teams.filter(x => x === 1).length ? 0 : 1;
    else if (m === 'bases') { const alive = Object.keys(this.teamInfo).map(Number).filter(x => x < AI_TEAM && this.teamInfo[x].hq && !this.teamInfo[x].hq.dead); const cnt = (x) => teams.filter(y => y === x).length; alive.sort((a, b) => cnt(a) - cnt(b)); team = alive.length ? alive[0] : 0; }
    const p = this.addPlayer({ pid, name, team });
    p.respawn = 1;
    this.say(p.name + ' вступает в бой');
    return p;
  }
  /** a player that dropped out comes back: he gets his tank, coins and arsenal back from the bot */
  rejoin(oldPid, newPid, name) {
    const p = this.players.get(oldPid); if (!p) return null;
    this.players.delete(oldPid);
    p.pid = newPid; p.bot = false; p.name = name; p.input = { d: -1, f: false };
    this.players.set(newPid, p);
    if (p.tank) { p.tank.pid = newPid; p.tank.bot = false; p.tank.ai = null; p.tank.name = name; }
    for (const t of this.tanks) { if (t.owner === oldPid) t.owner = newPid; if (t.ai && t.ai.leader === oldPid) t.ai.leader = newPid; }
    for (const s of this.structs) if (s.owner === oldPid) s.owner = newPid;
    for (const q of [...this.mines, ...this.dyns, ...this.planes, ...this.bullets]) if (q.pid === oldPid) q.pid = newPid;
    this.say(name + ' вернулся в бой');
    return p;
  }
  /** a player left: a bot takes over the tank */
  playerLeft(pid) {
    const p = this.players.get(pid); if (!p) return;
    p.bot = true;
    const was = p.name;
    p.baseName = was; p.leftAt = this.time;
    p.name += ' (бот)';
    if (p.tank) { p.tank.bot = true; p.tank.name = p.name; p.tank.ai = { role: this.cfg.mode === 'ctf' ? 'ctfAttack' : 'hunt', home: [this.cellOf(p.tank.x), this.cellOf(p.tank.y)], think: 0, want: -1, stuckT: 0, dodgeT: 0, dodgeDir: -1, tgt: 0 }; }
    this.say(was + ' отключился — его танком управляет бот');
  }
}
function botName(t) { return { heavy: 'тяжёлый', siege: 'осадный', kamikaze: 'камикадзе', rapid: 'скорострел', fast: 'быстроход', builder: 'строитель', brain: 'интеллектуал' }[t.kind] || 'танк'; }
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
const KIND_IDX = { light: 0, heavy: 1, siege: 2, kamikaze: 3, rapid: 4, fast: 5, builder: 6, brain: 7, fastHeavy: 8, rapidHeavy: 9, fastRapid: 10, titan: 11, rogue: 12 };
const PICK_IDX = { coin: 0, repair: 1, speed: 2, shield: 3, freeze: 4, star: 5, box: 6, drop: 7 };

window.MPEngine = { campaignMaps, Game, CELL, T, BUILD, WEAPONS, GEAR, WIDX, START_COINS, SKILLS, TANKS, XP_LEVELS, MAX_LEVEL, ORDERS, ORDER_NAMES, KINDS, AI_TEAM, WILD_TEAM, DT, fmtTime, KIND_NAMES: ['light', 'heavy', 'siege', 'kamikaze', 'rapid', 'fast', 'builder', 'brain', 'fastHeavy', 'rapidHeavy', 'fastRapid', 'titan', 'rogue'], AMMO_CAP, HYBRIDS, PICK_NAMES: ['coin', 'repair', 'speed', 'shield', 'freeze', 'star', 'box', 'drop'] };
if (typeof module !== 'undefined') module.exports = window.MPEngine;
})();
