/*
 * Tiny JVM (CLDC 1.1 level) written in JavaScript.
 * Runs original, unmodified J2ME bytecode from a .jar.
 *
 * Value model:
 *   int/short/byte/char/boolean -> JS number (int32)
 *   float/double               -> JS number (float via Math.fround)
 *   long                       -> BigInt (always kept in signed 64-bit range)
 *   java.lang.String           -> JS string primitive
 *   objects                    -> JS object { __cls: JClass, "<Owner>.<field>": value, ... }
 *   arrays                     -> typed arrays / JS arrays with a `__t` tag ("[I", "[Lfoo;", ...)
 * Stack and local slots follow the JVM spec exactly: long/double take two slots
 * (the second one is an unused filler), so dup/pop/swap work literally.
 */
'use strict';

(function (global) {

const RUN = 0, SLEEP = 1, WAIT = 2, MONITOR = 3, REACQ = 4, DEAD = 5, IDLE = 6;
const L64 = (v) => BigInt.asIntN(64, v);

class JavaThrow {
  constructor(obj) { this.obj = obj; }
}

/* ---------------------------------------------------------------- class file */

function mutf8(b, off, len) {
  let s = '', i = off; const end = off + len;
  while (i < end) {
    const c = b[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if ((c & 0xe0) === 0xc0) s += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else { const c2 = b[i++], c3 = b[i++]; s += String.fromCharCode(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f)); }
  }
  return s;
}

function parseDesc(desc) {
  // returns { args: ['I','J','L..;','[..'], argSlots, ret }
  const args = []; let i = 1, slots = 0;
  while (desc[i] !== ')') {
    let st = i;
    while (desc[i] === '[') i++;
    if (desc[i] === 'L') i = desc.indexOf(';', i);
    i++;
    const a = desc.substring(st, i);
    args.push(a);
    slots += (a === 'J' || a === 'D') ? 2 : 1;
  }
  const ret = desc.substring(i + 1);
  return { args, argSlots: slots, ret };
}

function retKind(ret) { return ret === 'V' ? 0 : (ret === 'J' || ret === 'D') ? 2 : 1; }

function parseClass(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 8;
  const u1 = () => b[p++];
  const u2 = () => { const v = dv.getUint16(p); p += 2; return v; };
  const u4 = () => { const v = dv.getUint32(p); p += 4; return v; };
  const n = u2();
  const cp = new Array(n);
  for (let i = 1; i < n; i++) {
    const tag = u1();
    switch (tag) {
      case 1: { const len = u2(); cp[i] = { t: 1, v: mutf8(b, p, len) }; p += len; break; }
      case 3: cp[i] = { t: 3, v: dv.getInt32(p) }; p += 4; break;
      case 4: cp[i] = { t: 4, v: dv.getFloat32(p) }; p += 4; break;
      case 5: cp[i] = { t: 5, v: BigInt.asIntN(64, (BigInt(dv.getUint32(p)) << 32n) | BigInt(dv.getUint32(p + 4))) }; p += 8; i++; break;
      case 6: cp[i] = { t: 6, v: dv.getFloat64(p) }; p += 8; i++; break;
      case 7: cp[i] = { t: 7, ni: u2() }; break;
      case 8: cp[i] = { t: 8, si: u2() }; break;
      case 9: case 10: case 11: cp[i] = { t: tag, ci: u2(), nti: u2() }; break;
      case 12: cp[i] = { t: 12, ni: u2(), di: u2() }; break;
      default: throw new Error('Bad constant pool tag ' + tag + ' at ' + i);
    }
  }
  for (let i = 1; i < n; i++) {
    const e = cp[i]; if (!e) continue;
    if (e.t === 7) e.name = cp[e.ni].v;
    else if (e.t === 8) e.v = cp[e.si].v;
  }
  for (let i = 1; i < n; i++) {
    const e = cp[i]; if (!e) continue;
    if (e.t === 9 || e.t === 10 || e.t === 11) {
      e.cls = cp[e.ci].name;
      const nt = cp[e.nti];
      e.name = cp[nt.ni].v; e.desc = cp[nt.di].v;
    }
  }
  const access = u2();
  const name = cp[u2()].name;
  const si = u2();
  const superName = si ? cp[si].name : null;
  const ifc = u2(); const interfaces = [];
  for (let i = 0; i < ifc; i++) interfaces.push(cp[u2()].name);
  const fields = [];
  const fc = u2();
  for (let i = 0; i < fc; i++) {
    const acc = u2(), fname = cp[u2()].v, fdesc = cp[u2()].v;
    const ac = u2(); let constVal;
    for (let k = 0; k < ac; k++) {
      const an = cp[u2()].v, al = u4();
      if (an === 'ConstantValue') constVal = cp[dv.getUint16(p)].v;
      p += al;
    }
    fields.push({ access: acc, name: fname, desc: fdesc, constVal });
  }
  const methods = [];
  const mc = u2();
  for (let i = 0; i < mc; i++) {
    const acc = u2(), mname = cp[u2()].v, mdesc = cp[u2()].v;
    const ac = u2(); let codeInfo = null;
    for (let k = 0; k < ac; k++) {
      const an = cp[u2()].v, al = u4(); const end = p + al;
      if (an === 'Code') {
        const maxStack = u2(), maxLocals = u2(), clen = u4();
        const code = b.subarray(p, p + clen); p += clen;
        const el = u2(); const exc = [];
        for (let j = 0; j < el; j++) {
          const st = u2(), en = u2(), h = u2(), ct = u2();
          exc.push({ start: st, end: en, handler: h, type: ct ? cp[ct].name : null });
        }
        codeInfo = { maxStack, maxLocals, code, exc };
      }
      p = end;
    }
    methods.push({ access: acc, name: mname, desc: mdesc, codeInfo });
  }
  return { access, name, superName, interfaces, fields, methods, cp };
}

/* ---------------------------------------------------------------- classes */

class JClass {
  constructor(vm, name) {
    this.vm = vm; this.name = name;
    this.superName = null; this.superClass = null; this.interfaces = [];
    this.methods = new Map(); this.statics = Object.create(null);
    this.fields = []; this.state = 0; this.cp = null; this.isNative = false;
    this.vcache = new Map(); this.icache = new Map(); this.template = null;
    this.isInterface = false;
  }
  addMethod(m) { m.cls = this; this.methods.set(m.name + m.desc, m); }
}

function makeMethod(name, desc, access, codeInfo, nativeFn) {
  const d = parseDesc(desc);
  const m = {
    name, desc, nameDesc: name + desc, access,
    isStatic: (access & 0x0008) !== 0, isSync: (access & 0x0020) !== 0,
    isAbstract: (access & 0x0400) !== 0,
    args: d.args, argSlots: d.argSlots, ret: d.ret, rk: retKind(d.ret),
    code: null, maxLocals: 0, exc: null, native: nativeFn || null, cls: null,
  };
  if (codeInfo) { m.code = codeInfo.code; m.maxLocals = codeInfo.maxLocals; m.exc = codeInfo.exc; }
  return m;
}

/* ---------------------------------------------------------------- threads */

class GThread {
  constructor(vm, name) {
    this.vm = vm; this.id = ++vm.threadSeq; this.name = name || ('thread-' + this.id);
    this.frames = []; this.frame = null; this.state = RUN;
    this.wakeAt = 0; this.waitObj = null; this.waitCount = 0; this.blockedOn = null;
    this.pendingThrow = null; this.interrupted = false; this.javaThread = null;
  }
}

/* ---------------------------------------------------------------- VM */

class VM {
  constructor(files, opts) {
    this.files = files;          // { "name": Uint8Array }
    this.opts = opts || {};
    this.classes = new Map();
    this.natives = new Map();    // name -> spec
    this.threads = [];
    this.threadSeq = 0;
    this.objSeq = 0;
    this.log = this.opts.log || ((...a) => console.log(...a));
    this.debug = !!this.opts.debug;
    this.ARR_CLASS = null;
  }

  /* ---- native class registration ---- */
  defineNative(name, superName, interfaces, methods, statics, opts) {
    this.natives.set(name, { name, superName, interfaces: interfaces || [], methods: methods || {}, statics: statics || {}, opts: opts || {} });
  }

  getClassOrNull(name) {
    try { return this.loadClass(name); } catch (e) { if (e instanceof JavaThrow) return null; throw e; }
  }

  loadClass(name) {
    let c = this.classes.get(name);
    if (c) return c;
    if (name[0] === '[') {
      c = new JClass(this, name); c.isNative = true; c.superName = 'java/lang/Object';
      c.superClass = this.loadClass('java/lang/Object'); c.state = 2;
      this.classes.set(name, c); return c;
    }
    const spec = this.natives.get(name);
    if (spec) {
      c = new JClass(this, name); c.isNative = true;
      this.classes.set(name, c);
      c.superName = spec.superName;
      c.interfaces = spec.interfaces;
      c.isInterface = !!spec.opts.isInterface;
      if (spec.superName) c.superClass = this.loadClass(spec.superName);
      for (const key in spec.methods) {
        let k = key.trim(), access = 0x0001;
        if (k.startsWith('s ')) { access |= 0x0008; k = k.substring(2); }
        const pi = k.indexOf('(');
        const m = makeMethod(k.substring(0, pi), k.substring(pi), access | 0x0100, null, spec.methods[key]);
        c.addMethod(m);
      }
      for (const k in spec.statics) c.statics[k] = spec.statics[k];
      c.state = spec.opts.clinit ? 0 : 2;
      if (spec.opts.clinit) c.nativeClinit = spec.opts.clinit;
      return c;
    }
    const bytes = this.files[name + '.class'];
    if (!bytes) throw this.jthrowObj('java/lang/NoClassDefFoundError', name);
    const cf = parseClass(bytes);
    c = new JClass(this, name);
    this.classes.set(name, c);
    c.cp = cf.cp; c.superName = cf.superName; c.interfaces = cf.interfaces;
    c.isInterface = (cf.access & 0x0200) !== 0;
    c.fields = cf.fields;
    if (cf.superName) c.superClass = this.loadClass(cf.superName);
    for (const f of cf.fields) {
      if (f.access & 0x0008) {
        c.statics[f.name + ':' + f.desc] = f.constVal !== undefined ? f.constVal : this.defaultValue(f.desc);
      }
    }
    for (const mm of cf.methods) c.addMethod(makeMethod(mm.name, mm.desc, mm.access, mm.codeInfo, null));
    return c;
  }

  defaultValue(desc) {
    switch (desc[0]) {
      case 'J': return 0n;
      case 'L': case '[': return null;
      default: return 0;
    }
  }

  fieldTemplate(c) {
    if (c.template) return c.template;
    const t = c.superClass ? this.fieldTemplate(c.superClass).slice() : [];
    for (const f of c.fields) if (!(f.access & 0x0008)) t.push([c.name + '.' + f.name + ':' + f.desc, this.defaultValue(f.desc)]);
    c.template = t; return t;
  }

  newObject(c) {
    const o = { __cls: c };
    const t = c.template || this.fieldTemplate(c);
    for (let i = 0; i < t.length; i++) o[t[i][0]] = t[i][1];
    if (c.watch) c.watch(o);
    return o;
  }

  newObjectByName(name) { return this.newObject(this.loadClass(name)); }

  classOf(v) {
    if (typeof v === 'string') return this.loadClass('java/lang/String');
    if (v.__cls) return v.__cls;
    if (v.__t) return this.loadClass(v.__t);
    if (v instanceof JClass) return this.loadClass('java/lang/Class');
    throw new Error('classOf: not a Java value');
  }

  isSubclassOf(c, name) {
    if (c.name === name) return true;
    let r = c.icache.get(name);
    if (r !== undefined) return r;
    r = false;
    if (c.superClass && this.isSubclassOf(c.superClass, name)) r = true;
    if (!r) for (const iname of c.interfaces) {
      if (iname === name) { r = true; break; }
      const ic = this.getClassOrNull(iname);
      if (ic && this.isSubclassOf(ic, name)) { r = true; break; }
    }
    c.icache.set(name, r);
    return r;
  }

  isInstance(v, name) {
    if (v === null || v === undefined) return false;
    if (name === 'java/lang/Object') return true;
    if (typeof v === 'string') return name === 'java/lang/String';
    if (v.__t) {
      if (name[0] !== '[') return false;
      if (v.__t === name) return true;
      return v.__t[1] === '[' || v.__t[1] === 'L' ? name[1] === '[' || name[1] === 'L' : false;
    }
    if (v.__cls) return this.isSubclassOf(v.__cls, name);
    return false;
  }

  findMethod(c, nameDesc) {
    for (let k = c; k; k = k.superClass) {
      const m = k.methods.get(nameDesc);
      if (m && (m.code || m.native)) return m;
    }
    return null;
  }

  findVirtual(c, nameDesc) {
    let m = c.vcache.get(nameDesc);
    if (m) return m;
    m = this.findMethod(c, nameDesc);
    if (!m && nameDesc !== 'toString()Ljava/lang/String;') m = this.findMethod(this.loadClass('java/lang/Object'), nameDesc);
    if (!m) throw this.jthrowObj('java/lang/AbstractMethodError', c.name + '.' + nameDesc);
    c.vcache.set(nameDesc, m);
    return m;
  }

  /* ---- arrays ---- */
  newArray(tag, n) {
    if (n < 0) throw this.jthrowObj('java/lang/NegativeArraySizeException', String(n));
    let a;
    switch (tag) {
      case '[Z': case '[B': a = new Int8Array(n); break;
      case '[C': a = new Uint16Array(n); break;
      case '[S': a = new Int16Array(n); break;
      case '[I': a = new Int32Array(n); break;
      case '[F': a = new Float32Array(n); break;
      case '[D': a = new Float64Array(n); break;
      case '[J': a = typeof BigInt64Array !== 'undefined' ? new BigInt64Array(n) : new Array(n).fill(0n); break;
      default: a = new Array(n).fill(null);
    }
    a.__t = tag;
    return a;
  }

  newMultiArray(tag, dims, d) {
    const n = dims[d];
    const a = this.newArray(tag, n);
    if (d + 1 < dims.length) for (let i = 0; i < n; i++) a[i] = this.newMultiArray(tag.substring(1), dims, d + 1);
    return a;
  }

  bytesToJava(u8) { const a = new Int8Array(u8.length); a.set(u8); a.__t = '[B'; return a; }

  /* ---- exceptions ---- */
  jthrowObj(cname, msg) {
    const c = this.loadClass(cname);
    const o = this.newObject(c);
    o.__msg = (msg === undefined) ? null : msg;
    return new JavaThrow(o);
  }

  toJavaThrow(e) {
    if (e instanceof JavaThrow) return e;
    if (e instanceof TypeError) {
      if (this.debug) this.log('[jvm] JS TypeError -> NullPointerException:', e.message, e.stack);
      return this.jthrowObj('java/lang/NullPointerException', null);
    }
    if (e instanceof RangeError) {
      this.log('[jvm] RangeError', e.message, e.stack);
      return this.jthrowObj('java/lang/OutOfMemoryError', e.message);
    }
    this.log('[jvm] internal error', e && e.stack || e);
    return this.jthrowObj('java/lang/RuntimeException', String(e && e.message || e));
  }

  /* ---- monitors ---- */
  monitorEnter(t, o) {
    let m = o.__mon;
    if (!m) { o.__mon = { owner: t, count: 1 }; return true; }
    if (m.owner === null || m.owner === t) { m.owner = t; m.count++; return true; }
    t.state = MONITOR; t.blockedOn = o;
    return false;
  }

  monitorExit(t, o) {
    const m = o.__mon;
    if (!m || m.owner !== t) return;
    if (--m.count <= 0) { m.count = 0; m.owner = null; }
  }

  wait(t, o, ms) {
    const m = o.__mon;
    if (!m || m.owner !== t) throw this.jthrowObj('java/lang/IllegalMonitorStateException', null);
    t.waitCount = m.count; m.count = 0; m.owner = null;
    t.state = WAIT; t.waitObj = o;
    t.wakeAt = ms > 0 ? performance.now() + ms : Infinity;
  }

  notify(o, all) {
    for (const t of this.threads) {
      if (t.state === WAIT && t.waitObj === o) {
        t.state = REACQ;
        if (!all) return;
      }
    }
  }

  /* ---- threads ---- */
  newThread(name) {
    const t = new GThread(this, name);
    this.threads.push(t);
    return t;
  }

  makeFrame(m, self, args) {
    const l = new Array(Math.max(m.maxLocals, m.argSlots + 1));
    let k = 0;
    if (!m.isStatic) l[k++] = self;
    for (let i = 0; i < m.args.length; i++) {
      l[k++] = args[i];
      if (m.args[i] === 'J' || m.args[i] === 'D') l[k++] = undefined;
    }
    return { m, code: m.code, cp: m.cls.cp, cls: m.cls, l, s: [], sp: 0, pc: 0, discard: false, onReturn: null, syncObj: null };
  }

  /** Push a Java call onto thread t (used by natives for callbacks). Result is discarded. */
  pushCall(t, m, self, args, onReturn) {
    if (m.native) {
      const r = m.native(t, ...(m.isStatic ? args : [self, ...args]));
      if (onReturn) onReturn(r);
      return;
    }
    const f = this.makeFrame(m, self, args || []);
    f.discard = true; f.onReturn = onReturn || null;
    if (m.isSync) {
      const so = m.isStatic ? m.cls : self;
      if (!this.monitorEnter(t, so)) { t.state = RUN; t.blockedOn = null; /* best effort */ so.__mon.count++; }
      f.syncObj = so;
    }
    t.frames.push(f); t.frame = f;
    if (t.state === IDLE || t.state === DEAD) t.state = RUN;
  }

  callVirtual(t, obj, nameDesc, args, onReturn) {
    const m = this.findVirtual(this.classOf(obj), nameDesc);
    this.pushCall(t, m, obj, args || [], onReturn);
  }

  startJavaThread(jt) {
    const t = this.newThread('java-' + (this.threadSeq + 1));
    t.javaThread = jt; jt.__gthread = t;
    const m = this.findVirtual(this.classOf(jt), 'run()V');
    this.pushCall(t, m, jt, [], null);
    return t;
  }

  /* ---- class initialisation ---- */
  initClass(t, c) {
    if (c.state !== 0) return false;
    const chain = [];
    for (let k = c; k && k.state === 0; k = k.superClass) chain.push(k);
    let pushed = false;
    for (const k of chain) {
      k.state = 1;
      if (k.nativeClinit) { k.nativeClinit(this, k); k.state = 2; continue; }
      const cl = k.methods.get('<clinit>()V');
      if (cl && cl.code) {
        const f = this.makeFrame(cl, null, []);
        f.discard = true;
        f.onReturn = () => { k.state = 2; };
        t.frames.push(f); t.frame = f; pushed = true;
      } else k.state = 2;
    }
    return pushed;
  }

  /* ---- constant pool resolution ---- */
  resolveClassRef(cp, idx) {
    const e = cp[idx];
    if (e.rc) return e.rc;
    e.rc = this.loadClass(e.name);
    return e.rc;
  }

  resolveField(cp, idx, isStatic) {
    const e = cp[idx];
    if (e.rf) return e.rf;
    let c = this.loadClass(e.cls);
    let decl = null;
    for (let k = c; k; k = k.superClass) {
      if (isStatic) {
        if (k.isNative ? (e.name in k.statics) : k.fields.some(f => f.name === e.name && f.desc === e.desc && (f.access & 0x0008))) { decl = k; break; }
      } else {
        if (k.fields.some(f => f.name === e.name && f.desc === e.desc && !(f.access & 0x0008))) { decl = k; break; }
      }
      // interfaces may hold static constants
      if (isStatic) for (const iname of k.interfaces) {
        const ic = this.getClassOrNull(iname);
        if (ic && !ic.isNative && ic.fields.some(f => f.name === e.name)) { decl = ic; break; }
      }
      if (decl) break;
    }
    if (!decl) throw this.jthrowObj('java/lang/NoSuchFieldError', e.cls + '.' + e.name);
    const wide = e.desc === 'J' || e.desc === 'D';
    const skey = decl.isNative ? e.name : e.name + ':' + e.desc;
    e.rf = { cls: decl, key: decl.name + '.' + e.name + ':' + e.desc, name: skey, wide };
    return e.rf;
  }

  resolveMethodRef(cp, idx) {
    const e = cp[idx];
    if (e.rm) return e.rm;
    const d = parseDesc(e.desc);
    e.rm = { clsName: e.cls, name: e.name, desc: e.desc, nameDesc: e.name + e.desc, argSlots: d.argSlots, args: d.args, rk: retKind(d.ret), cls: null, m: null };
    return e.rm;
  }

  /* ---- exception unwinding ---- */
  unwind(t, ex, ipc) {
    const exObj = ex.obj;
    let first = true;
    while (t.frames.length) {
      const f = t.frame;
      const pc = first ? ipc : f.pc - 1;
      first = false;
      if (f.m.exc) {
        for (const h of f.m.exc) {
          if (pc >= h.start && pc < h.end && (h.type === null || this.isInstance(exObj, h.type))) {
            f.sp = 0; f.s[f.sp++] = exObj; f.pc = h.handler;
            return true;
          }
        }
      }
      if (f.syncObj) this.monitorExit(t, f.syncObj);
      t.frames.pop();
      t.frame = t.frames.length ? t.frames[t.frames.length - 1] : null;
      if (f.onReturn) { try { f.onReturn(undefined, exObj); } catch (e) { this.log(e); } }
    }
    const c = exObj && exObj.__cls ? exObj.__cls.name : '?';
    this.log('[jvm] Uncaught exception in ' + t.name + ': ' + c + (exObj && exObj.__msg ? ' : ' + exObj.__msg : ''));
    t.state = t.isEventThread ? IDLE : DEAD;
    if (this.opts.onUncaught) this.opts.onUncaught(t, exObj);
    return false;
  }

  /* ---------------------------------------------------------------- interpreter */
  run(t, budget) {
    if (t.state !== RUN || !t.frame) return;
    let f = t.frame;
    let code = f.code, l = f.l, s = f.s, sp = f.sp, pc = f.pc, cp = f.cp;
    let ipc = pc;
    const vm = this;

    if (t.pendingThrow) {
      const ex = t.pendingThrow; t.pendingThrow = null;
      if (!this.unwind(t, ex, f.pc - 1)) return;
      f = t.frame; code = f.code; l = f.l; s = f.s; sp = f.sp; pc = f.pc; cp = f.cp;
    }

    for (;;) {
      try {
        while (budget-- > 0) {
          ipc = pc;
          const op = code[pc++];
          switch (op) {
            case 0x00: break;
            case 0x01: s[sp++] = null; break;
            case 0x02: case 0x03: case 0x04: case 0x05: case 0x06: case 0x07: case 0x08:
              s[sp++] = op - 3; break;
            case 0x09: s[sp++] = 0n; s[sp++] = undefined; break;
            case 0x0a: s[sp++] = 1n; s[sp++] = undefined; break;
            case 0x0b: s[sp++] = 0; break;
            case 0x0c: s[sp++] = 1; break;
            case 0x0d: s[sp++] = 2; break;
            case 0x0e: s[sp++] = 0; s[sp++] = undefined; break;
            case 0x0f: s[sp++] = 1; s[sp++] = undefined; break;
            case 0x10: s[sp++] = (code[pc++] << 24) >> 24; break;
            case 0x11: s[sp++] = ((code[pc] << 8) | code[pc + 1]) << 16 >> 16; pc += 2; break;
            case 0x12: case 0x13: {
              let idx;
              if (op === 0x12) idx = code[pc++]; else { idx = (code[pc] << 8) | code[pc + 1]; pc += 2; }
              const e = cp[idx];
              if (e.t === 7) s[sp++] = vm.classObject(vm.resolveClassRef(cp, idx));
              else s[sp++] = e.v;
              break;
            }
            case 0x14: { const idx = (code[pc] << 8) | code[pc + 1]; pc += 2; s[sp++] = cp[idx].v; s[sp++] = undefined; break; }
            case 0x15: case 0x17: case 0x19: s[sp++] = l[code[pc++]]; break;
            case 0x16: case 0x18: s[sp++] = l[code[pc++]]; s[sp++] = undefined; break;
            case 0x1a: case 0x1b: case 0x1c: case 0x1d: s[sp++] = l[op - 0x1a]; break;
            case 0x1e: case 0x1f: case 0x20: case 0x21: s[sp++] = l[op - 0x1e]; s[sp++] = undefined; break;
            case 0x22: case 0x23: case 0x24: case 0x25: s[sp++] = l[op - 0x22]; break;
            case 0x26: case 0x27: case 0x28: case 0x29: s[sp++] = l[op - 0x26]; s[sp++] = undefined; break;
            case 0x2a: case 0x2b: case 0x2c: case 0x2d: s[sp++] = l[op - 0x2a]; break;
            // array loads
            case 0x2e: case 0x30: case 0x32: case 0x33: case 0x34: case 0x35: {
              const i = s[--sp], a = s[--sp];
              if ((i >>> 0) >= a.length) throw vm.jthrowObj('java/lang/ArrayIndexOutOfBoundsException', String(i));
              s[sp++] = a[i]; break;
            }
            case 0x2f: case 0x31: {
              const i = s[--sp], a = s[--sp];
              if ((i >>> 0) >= a.length) throw vm.jthrowObj('java/lang/ArrayIndexOutOfBoundsException', String(i));
              s[sp++] = a[i]; s[sp++] = undefined; break;
            }
            case 0x36: case 0x38: case 0x3a: l[code[pc++]] = s[--sp]; break;
            case 0x37: case 0x39: sp -= 2; l[code[pc++]] = s[sp]; break;
            case 0x3b: case 0x3c: case 0x3d: case 0x3e: l[op - 0x3b] = s[--sp]; break;
            case 0x3f: case 0x40: case 0x41: case 0x42: sp -= 2; l[op - 0x3f] = s[sp]; break;
            case 0x43: case 0x44: case 0x45: case 0x46: l[op - 0x43] = s[--sp]; break;
            case 0x47: case 0x48: case 0x49: case 0x4a: sp -= 2; l[op - 0x47] = s[sp]; break;
            case 0x4b: case 0x4c: case 0x4d: case 0x4e: l[op - 0x4b] = s[--sp]; break;
            // array stores
            case 0x4f: case 0x51: case 0x53: case 0x54: case 0x55: case 0x56: {
              const v = s[--sp], i = s[--sp], a = s[--sp];
              if ((i >>> 0) >= a.length) throw vm.jthrowObj('java/lang/ArrayIndexOutOfBoundsException', String(i));
              a[i] = v; break;
            }
            case 0x50: case 0x52: {
              sp -= 2; const v = s[sp]; const i = s[--sp], a = s[--sp];
              if ((i >>> 0) >= a.length) throw vm.jthrowObj('java/lang/ArrayIndexOutOfBoundsException', String(i));
              a[i] = v; break;
            }
            // stack
            case 0x57: sp--; break;
            case 0x58: sp -= 2; break;
            case 0x59: s[sp] = s[sp - 1]; sp++; break;
            case 0x5a: { const v1 = s[sp - 1], v2 = s[sp - 2]; s[sp - 2] = v1; s[sp - 1] = v2; s[sp] = v1; sp++; break; }
            case 0x5b: { const v1 = s[sp - 1], v2 = s[sp - 2], v3 = s[sp - 3]; s[sp - 3] = v1; s[sp - 2] = v3; s[sp - 1] = v2; s[sp] = v1; sp++; break; }
            case 0x5c: s[sp] = s[sp - 2]; s[sp + 1] = s[sp - 1]; sp += 2; break;
            case 0x5d: { const v1 = s[sp - 1], v2 = s[sp - 2], v3 = s[sp - 3];
              s[sp - 3] = v2; s[sp - 2] = v1; s[sp - 1] = v3; s[sp] = v2; s[sp + 1] = v1; sp += 2; break; }
            case 0x5e: { const v1 = s[sp - 1], v2 = s[sp - 2], v3 = s[sp - 3], v4 = s[sp - 4];
              s[sp - 4] = v2; s[sp - 3] = v1; s[sp - 2] = v4; s[sp - 1] = v3; s[sp] = v2; s[sp + 1] = v1; sp += 2; break; }
            case 0x5f: { const v = s[sp - 1]; s[sp - 1] = s[sp - 2]; s[sp - 2] = v; break; }
            // int arithmetic
            case 0x60: { const b = s[--sp]; s[sp - 1] = (s[sp - 1] + b) | 0; break; }
            case 0x64: { const b = s[--sp]; s[sp - 1] = (s[sp - 1] - b) | 0; break; }
            case 0x68: { const b = s[--sp]; s[sp - 1] = Math.imul(s[sp - 1], b); break; }
            case 0x6c: { const b = s[--sp]; if (b === 0) throw vm.jthrowObj('java/lang/ArithmeticException', '/ by zero'); s[sp - 1] = (s[sp - 1] / b) | 0; break; }
            case 0x70: { const b = s[--sp]; if (b === 0) throw vm.jthrowObj('java/lang/ArithmeticException', '/ by zero'); s[sp - 1] = (s[sp - 1] % b) | 0; break; }
            case 0x74: s[sp - 1] = (-s[sp - 1]) | 0; break;
            case 0x78: { const b = s[--sp]; s[sp - 1] = s[sp - 1] << b; break; }
            case 0x7a: { const b = s[--sp]; s[sp - 1] = s[sp - 1] >> b; break; }
            case 0x7c: { const b = s[--sp]; s[sp - 1] = (s[sp - 1] >>> b) | 0; break; }
            case 0x7e: { const b = s[--sp]; s[sp - 1] = s[sp - 1] & b; break; }
            case 0x80: { const b = s[--sp]; s[sp - 1] = s[sp - 1] | b; break; }
            case 0x82: { const b = s[--sp]; s[sp - 1] = s[sp - 1] ^ b; break; }
            // long arithmetic (value at sp-2, filler at sp-1)
            case 0x61: { sp -= 2; const b = s[sp]; s[sp - 2] = L64(s[sp - 2] + b); break; }
            case 0x65: { sp -= 2; const b = s[sp]; s[sp - 2] = L64(s[sp - 2] - b); break; }
            case 0x69: { sp -= 2; const b = s[sp]; s[sp - 2] = L64(s[sp - 2] * b); break; }
            case 0x6d: { sp -= 2; const b = s[sp]; if (b === 0n) throw vm.jthrowObj('java/lang/ArithmeticException', '/ by zero'); s[sp - 2] = L64(s[sp - 2] / b); break; }
            case 0x71: { sp -= 2; const b = s[sp]; if (b === 0n) throw vm.jthrowObj('java/lang/ArithmeticException', '/ by zero'); s[sp - 2] = s[sp - 2] % b; break; }
            case 0x75: s[sp - 2] = L64(-s[sp - 2]); break;
            case 0x79: { const b = s[--sp]; s[sp - 2] = L64(s[sp - 2] << BigInt(b & 63)); break; }
            case 0x7b: { const b = s[--sp]; s[sp - 2] = s[sp - 2] >> BigInt(b & 63); break; }
            case 0x7d: { const b = s[--sp]; s[sp - 2] = L64(BigInt.asUintN(64, s[sp - 2]) >> BigInt(b & 63)); break; }
            case 0x7f: { sp -= 2; const b = s[sp]; s[sp - 2] = L64(s[sp - 2] & b); break; }
            case 0x81: { sp -= 2; const b = s[sp]; s[sp - 2] = L64(s[sp - 2] | b); break; }
            case 0x83: { sp -= 2; const b = s[sp]; s[sp - 2] = L64(s[sp - 2] ^ b); break; }
            // float
            case 0x62: { const b = s[--sp]; s[sp - 1] = Math.fround(s[sp - 1] + b); break; }
            case 0x66: { const b = s[--sp]; s[sp - 1] = Math.fround(s[sp - 1] - b); break; }
            case 0x6a: { const b = s[--sp]; s[sp - 1] = Math.fround(s[sp - 1] * b); break; }
            case 0x6e: { const b = s[--sp]; s[sp - 1] = Math.fround(s[sp - 1] / b); break; }
            case 0x72: { const b = s[--sp]; s[sp - 1] = Math.fround(s[sp - 1] % b); break; }
            case 0x76: s[sp - 1] = -s[sp - 1]; break;
            // double
            case 0x63: { sp -= 2; const b = s[sp]; s[sp - 2] = s[sp - 2] + b; break; }
            case 0x67: { sp -= 2; const b = s[sp]; s[sp - 2] = s[sp - 2] - b; break; }
            case 0x6b: { sp -= 2; const b = s[sp]; s[sp - 2] = s[sp - 2] * b; break; }
            case 0x6f: { sp -= 2; const b = s[sp]; s[sp - 2] = s[sp - 2] / b; break; }
            case 0x73: { sp -= 2; const b = s[sp]; s[sp - 2] = s[sp - 2] % b; break; }
            case 0x77: s[sp - 2] = -s[sp - 2]; break;
            case 0x84: { const i = code[pc++]; l[i] = (l[i] + ((code[pc++] << 24) >> 24)) | 0; break; }
            // conversions
            case 0x85: s[sp - 1] = BigInt(s[sp - 1]); s[sp++] = undefined; break;
            case 0x86: s[sp - 1] = Math.fround(s[sp - 1]); break;
            case 0x87: s[sp++] = undefined; break;
            case 0x88: sp--; s[sp - 1] = Number(BigInt.asIntN(32, s[sp - 1])); break;
            case 0x89: sp--; s[sp - 1] = Math.fround(Number(s[sp - 1])); break;
            case 0x8a: s[sp - 2] = Number(s[sp - 2]); break;
            case 0x8b: s[sp - 1] = f2i(s[sp - 1]); break;
            case 0x8c: s[sp - 1] = f2l(s[sp - 1]); s[sp++] = undefined; break;
            case 0x8d: s[sp++] = undefined; break;
            case 0x8e: sp--; s[sp - 1] = f2i(s[sp - 1]); break;
            case 0x8f: s[sp - 2] = f2l(s[sp - 2]); break;
            case 0x90: sp--; s[sp - 1] = Math.fround(s[sp - 1]); break;
            case 0x91: s[sp - 1] = (s[sp - 1] << 24) >> 24; break;
            case 0x92: s[sp - 1] = s[sp - 1] & 0xffff; break;
            case 0x93: s[sp - 1] = (s[sp - 1] << 16) >> 16; break;
            // compares
            case 0x94: { sp -= 2; const b = s[sp]; sp -= 2; const a = s[sp]; s[sp++] = a < b ? -1 : a > b ? 1 : 0; break; }
            case 0x95: case 0x96: { const b = s[--sp], a = s[--sp];
              s[sp++] = (a !== a || b !== b) ? (op === 0x95 ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0; break; }
            case 0x97: case 0x98: { sp -= 2; const b = s[sp]; sp -= 2; const a = s[sp];
              s[sp++] = (a !== a || b !== b) ? (op === 0x97 ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0; break; }
            // branches
            case 0x99: case 0x9a: case 0x9b: case 0x9c: case 0x9d: case 0x9e: {
              const v = s[--sp]; let c;
              switch (op) { case 0x99: c = v === 0; break; case 0x9a: c = v !== 0; break; case 0x9b: c = v < 0; break;
                case 0x9c: c = v >= 0; break; case 0x9d: c = v > 0; break; default: c = v <= 0; }
              if (c) pc = ipc + (((code[pc] << 8) | code[pc + 1]) << 16 >> 16); else pc += 2;
              break;
            }
            case 0x9f: case 0xa0: case 0xa1: case 0xa2: case 0xa3: case 0xa4: {
              const b = s[--sp], a = s[--sp]; let c;
              switch (op) { case 0x9f: c = a === b; break; case 0xa0: c = a !== b; break; case 0xa1: c = a < b; break;
                case 0xa2: c = a >= b; break; case 0xa3: c = a > b; break; default: c = a <= b; }
              if (c) pc = ipc + (((code[pc] << 8) | code[pc + 1]) << 16 >> 16); else pc += 2;
              break;
            }
            case 0xa5: case 0xa6: {
              const b = s[--sp], a = s[--sp];
              const eq = a === b || (a == null && b == null);
              if (eq === (op === 0xa5)) pc = ipc + (((code[pc] << 8) | code[pc + 1]) << 16 >> 16); else pc += 2;
              break;
            }
            case 0xa7: pc = ipc + (((code[pc] << 8) | code[pc + 1]) << 16 >> 16); break;
            case 0xa8: s[sp++] = pc + 2; pc = ipc + (((code[pc] << 8) | code[pc + 1]) << 16 >> 16); break;
            case 0xa9: pc = l[code[pc]]; break;
            case 0xaa: {
              pc = (pc + 3) & ~3;
              const def = r4(code, pc), lo = r4(code, pc + 4), hi = r4(code, pc + 8);
              const v = s[--sp];
              if (v < lo || v > hi) pc = ipc + def;
              else pc = ipc + r4(code, pc + 12 + (v - lo) * 4);
              break;
            }
            case 0xab: {
              pc = (pc + 3) & ~3;
              const def = r4(code, pc), np = r4(code, pc + 4);
              const v = s[--sp];
              let target = def;
              let lo = 0, hi = np - 1;
              while (lo <= hi) {
                const mid = (lo + hi) >> 1; const k = r4(code, pc + 8 + mid * 8);
                if (k === v) { target = r4(code, pc + 12 + mid * 8); break; }
                if (k < v) lo = mid + 1; else hi = mid - 1;
              }
              pc = ipc + target;
              break;
            }
            // returns
            case 0xac: case 0xad: case 0xae: case 0xaf: case 0xb0: case 0xb1: {
              let rv, rk = 0;
              if (op === 0xad || op === 0xaf) { sp -= 2; rv = s[sp]; rk = 2; }
              else if (op !== 0xb1) { rv = s[--sp]; rk = 1; }
              if (f.syncObj) vm.monitorExit(t, f.syncObj);
              t.frames.pop();
              const done = f;
              const caller = t.frames.length ? t.frames[t.frames.length - 1] : null;
              t.frame = caller;
              if (caller && !done.discard) {
                if (rk === 1) caller.s[caller.sp++] = rv; else if (rk === 2) { caller.s[caller.sp++] = rv; caller.s[caller.sp++] = undefined; }
              }
              if (done.onReturn) done.onReturn(rv);
              if (!t.frames.length) { t.frame = null; t.state = t.isEventThread ? IDLE : DEAD; return; }
              t.frame = t.frames[t.frames.length - 1];
              if (t.state !== RUN) return;
              f = t.frame; code = f.code; l = f.l; s = f.s; sp = f.sp; pc = f.pc; cp = f.cp;
              break;
            }
            // fields
            case 0xb2: case 0xb3: {
              const idx = (code[pc] << 8) | code[pc + 1]; pc += 2;
              const r = vm.resolveField(cp, idx, true);
              const c = r.cls;
              if (c.state === 0 && vm.initClass(t, c)) {
                pc = ipc; f.pc = pc; f.sp = sp;
                f = t.frame; code = f.code; l = f.l; s = f.s; sp = f.sp; pc = f.pc; cp = f.cp;
                break;
              }
              if (op === 0xb2) { s[sp++] = c.statics[r.name]; if (r.wide) s[sp++] = undefined; }
              else { if (r.wide) sp--; c.statics[r.name] = s[--sp]; }
              break;
            }
            case 0xb4: {
              const idx = (code[pc] << 8) | code[pc + 1]; pc += 2;
              const r = cp[idx].rf || vm.resolveField(cp, idx, false);
              const o = s[sp - 1];
              s[sp - 1] = o[r.key];
              if (r.wide) s[sp++] = undefined;
              break;
            }
            case 0xb5: {
              const idx = (code[pc] << 8) | code[pc + 1]; pc += 2;
              const r = cp[idx].rf || vm.resolveField(cp, idx, false);
              if (r.wide) sp--;
              const v = s[--sp]; const o = s[--sp];
              o[r.key] = v;
              break;
            }
            // invokes
            case 0xb6: case 0xb7: case 0xb8: case 0xb9: {
              const idx = (code[pc] << 8) | code[pc + 1]; pc += 2;
              if (op === 0xb9) pc += 2;
              const r = cp[idx].rm || vm.resolveMethodRef(cp, idx);
              let m, self = null;
              const nargs = r.argSlots + (op === 0xb8 ? 0 : 1);
              const base = sp - nargs;
              if (op === 0xb8) {
                if (!r.m) { const c = vm.loadClass(r.clsName); r.m = vm.findMethod(c, r.nameDesc); if (!r.m) throw vm.jthrowObj('java/lang/NoSuchMethodError', r.clsName + '.' + r.nameDesc); }
                m = r.m;
                if (m.cls.state === 0 && vm.initClass(t, m.cls)) {
                  pc = ipc; f.pc = pc; f.sp = sp;
                  f = t.frame; code = f.code; l = f.l; s = f.s; sp = f.sp; pc = f.pc; cp = f.cp;
                  break;
                }
              } else {
                self = s[base];
                if (self === null || self === undefined) throw vm.jthrowObj('java/lang/NullPointerException', r.nameDesc);
                if (op === 0xb7) {
                  if (!r.m) { const c = vm.loadClass(r.clsName); r.m = vm.findMethod(c, r.nameDesc); if (!r.m) throw vm.jthrowObj('java/lang/NoSuchMethodError', r.clsName + '.' + r.nameDesc); }
                  m = r.m;
                } else {
                  if (self.__t && r.name === 'clone') { s[base] = cloneArray(self); sp = base + 1; break; }
                  m = vm.findVirtual(vm.classOf(self), r.nameDesc);
                }
              }
              if (m.native) {
                const args = [];
                let k = base + (op === 0xb8 ? 0 : 1);
                for (let i = 0; i < m.args.length; i++) {
                  args.push(s[k]);
                  k += (m.args[i] === 'J' || m.args[i] === 'D') ? 2 : 1;
                }
                sp = base;
                f.pc = pc; f.sp = sp;
                const rv = m.isStatic ? m.native(t, ...args) : m.native(t, self, ...args);
                if (m.rk === 1) s[sp++] = rv; else if (m.rk === 2) { s[sp++] = rv; s[sp++] = undefined; }
                else if (rv !== undefined && rv !== null && typeof rv === 'object' && rv.__replaceSelf) {
                  // String constructor: replace the placeholder everywhere in this frame
                  const str = rv.value;
                  for (let i = 0; i < sp; i++) if (s[i] === self) s[i] = str;
                  for (let i = 0; i < l.length; i++) if (l[i] === self) l[i] = str;
                }
                f.sp = sp;
                if (t.frame !== f || t.state !== RUN) {
                  if (t.state !== RUN) return;
                  f = t.frame; code = f.code; l = f.l; s = f.s; sp = f.sp; pc = f.pc; cp = f.cp;
                }
                break;
              }
              // Java method
              let syncObj = null;
              if (m.isSync) {
                syncObj = m.isStatic ? m.cls : self;
                if (!vm.monitorEnter(t, syncObj)) { pc = ipc; f.pc = pc; f.sp = sp; return; }
              }
              const nl = new Array(m.maxLocals > nargs ? m.maxLocals : nargs);
              for (let i = 0; i < nargs; i++) nl[i] = s[base + i];
              sp = base;
              f.pc = pc; f.sp = sp;
              const nf = { m, code: m.code, cp: m.cls.cp, cls: m.cls, l: nl, s: [], sp: 0, pc: 0, discard: false, onReturn: null, syncObj };
              t.frames.push(nf);
              if (t.frames.length > 2000) throw vm.jthrowObj('java/lang/StackOverflowError', null);
              t.frame = f = nf;
              code = f.code; l = f.l; s = f.s; sp = 0; pc = 0; cp = f.cp;
              break;
            }
            case 0xbb: {
              const idx = (code[pc] << 8) | code[pc + 1]; pc += 2;
              const c = cp[idx].rc || vm.resolveClassRef(cp, idx);
              if (c.state === 0 && vm.initClass(t, c)) {
                pc = ipc; f.pc = pc; f.sp = sp;
                f = t.frame; code = f.code; l = f.l; s = f.s; sp = f.sp; pc = f.pc; cp = f.cp;
                break;
              }
              s[sp++] = c.name === 'java/lang/String' ? { __strPlaceholder: true, __cls: c } : vm.newObject(c);
              break;
            }
            case 0xbc: {
              const tc = code[pc++];
              s[sp - 1] = vm.newArray(PRIM_TAGS[tc], s[sp - 1]);
              break;
            }
            case 0xbd: {
              const idx = (code[pc] << 8) | code[pc + 1]; pc += 2;
              const n = cp[idx].name;
              s[sp - 1] = vm.newArray(n[0] === '[' ? '[' + n : '[L' + n + ';', s[sp - 1]);
              break;
            }
            case 0xbe: s[sp - 1] = s[sp - 1].length; break;
            case 0xbf: {
              const o = s[--sp];
              if (o === null || o === undefined) throw vm.jthrowObj('java/lang/NullPointerException', null);
              throw new JavaThrow(o);
            }
            case 0xc0: {
              const idx = (code[pc] << 8) | code[pc + 1]; pc += 2;
              const v = s[sp - 1];
              if (v !== null && v !== undefined && !vm.isInstance(v, cp[idx].name))
                throw vm.jthrowObj('java/lang/ClassCastException', cp[idx].name);
              break;
            }
            case 0xc1: {
              const idx = (code[pc] << 8) | code[pc + 1]; pc += 2;
              s[sp - 1] = vm.isInstance(s[sp - 1], cp[idx].name) ? 1 : 0;
              break;
            }
            case 0xc2: {
              const o = s[sp - 1];
              if (o === null || o === undefined) throw vm.jthrowObj('java/lang/NullPointerException', null);
              if (typeof o === 'string') { sp--; break; }
              if (!vm.monitorEnter(t, o)) { pc = ipc; f.pc = pc; f.sp = sp; return; }
              sp--;
              break;
            }
            case 0xc3: {
              const o = s[--sp];
              if (o === null || o === undefined) throw vm.jthrowObj('java/lang/NullPointerException', null);
              if (typeof o !== 'string') vm.monitorExit(t, o);
              break;
            }
            case 0xc4: {
              const op2 = code[pc++];
              const idx = (code[pc] << 8) | code[pc + 1]; pc += 2;
              switch (op2) {
                case 0x15: case 0x17: case 0x19: s[sp++] = l[idx]; break;
                case 0x16: case 0x18: s[sp++] = l[idx]; s[sp++] = undefined; break;
                case 0x36: case 0x38: case 0x3a: l[idx] = s[--sp]; break;
                case 0x37: case 0x39: sp -= 2; l[idx] = s[sp]; break;
                case 0xa9: pc = l[idx]; break;
                case 0x84: { const c = ((code[pc] << 8) | code[pc + 1]) << 16 >> 16; pc += 2; l[idx] = (l[idx] + c) | 0; break; }
                default: throw new Error('bad wide op ' + op2);
              }
              break;
            }
            case 0xc5: {
              const idx = (code[pc] << 8) | code[pc + 1]; pc += 2;
              const nd = code[pc++];
              const dims = [];
              for (let i = 0; i < nd; i++) dims.unshift(s[--sp]);
              s[sp++] = vm.newMultiArray(cp[idx].name, dims, 0);
              break;
            }
            case 0xc6: { const v = s[--sp]; if (v === null || v === undefined) pc = ipc + (((code[pc] << 8) | code[pc + 1]) << 16 >> 16); else pc += 2; break; }
            case 0xc7: { const v = s[--sp]; if (v !== null && v !== undefined) pc = ipc + (((code[pc] << 8) | code[pc + 1]) << 16 >> 16); else pc += 2; break; }
            case 0xc8: pc = ipc + r4(code, pc); break;
            case 0xc9: s[sp++] = pc + 4; pc = ipc + r4(code, pc); break;
            default:
              throw new Error('Unsupported opcode 0x' + op.toString(16) + ' in ' + f.cls.name + '.' + f.m.nameDesc + ' @' + ipc);
          }
        }
        f.pc = pc; f.sp = sp;
        return;
      } catch (e) {
        if (!(e instanceof JavaThrow) && e instanceof Error && /Unsupported opcode|bad wide/.test(e.message)) throw e;
        const jt = vm.toJavaThrow(e);
        if (vm.debug && jt.obj && jt.obj.__cls) vm.log('[jvm] throw ' + jt.obj.__cls.name + ' ' + (jt.obj.__msg || '') + ' in ' + (t.frame ? t.frame.cls.name + '.' + t.frame.m.nameDesc + '@' + ipc : '?'));
        // the throwing frame is always the current one (natives never push frames before throwing)
        if (t.frame === f) { f.pc = pc; f.sp = sp; }
        else ipc = t.frame ? t.frame.pc - 1 : 0;
        if (!vm.unwind(t, jt, ipc)) return;
        if (t.state !== RUN) return;
        f = t.frame; code = f.code; l = f.l; s = f.s; sp = f.sp; pc = f.pc; cp = f.cp;
      }
    }
  }

  classObject(c) { return c; }

  /* ---------------------------------------------------------------- scheduler */
  /** Run runnable threads for up to `ms` milliseconds. Returns true if work remains. */
  schedule(ms) {
    const start = performance.now();
    const deadline = start + ms;
    let any = true;
    while (any && performance.now() < deadline) {
      any = false;
      const now = performance.now();
      for (let i = 0; i < this.threads.length; i++) {
        const t = this.threads[i];
        switch (t.state) {
          case SLEEP:
            if (now >= t.wakeAt) t.state = RUN;
            break;
          case WAIT:
            if (now >= t.wakeAt) t.state = REACQ;
            break;
          case MONITOR: {
            const m = t.blockedOn.__mon;
            if (!m || m.owner === null || m.owner === t) { t.state = RUN; t.blockedOn = null; }
            break;
          }
        }
        if (t.state === REACQ) {
          const o = t.waitObj; const m = o.__mon;
          if (!m || m.owner === null) {
            if (!m) o.__mon = { owner: t, count: t.waitCount };
            else { m.owner = t; m.count = t.waitCount; }
            t.state = RUN; t.waitObj = null;
            if (t.interrupted) { t.interrupted = false; t.pendingThrow = this.jthrowObj('java/lang/InterruptedException', null); }
          }
        }
        if (t.state === RUN && t.frame) {
          this.run(t, 4000);
          any = true;
        }
      }
      if (this.opts.onSlice) this.opts.onSlice();
    }
    // drop dead threads
    if (this.threads.some(t => t.state === DEAD)) this.threads = this.threads.filter(t => t.state !== DEAD);
    return any;
  }

  nextWake() {
    let w = Infinity;
    for (const t of this.threads) {
      if (t.state === RUN && t.frame) return 0;
      if ((t.state === SLEEP || t.state === WAIT) && t.wakeAt < w) w = t.wakeAt;
    }
    return w;
  }
}

const PRIM_TAGS = { 4: '[Z', 5: '[C', 6: '[F', 7: '[D', 8: '[B', 9: '[S', 10: '[I', 11: '[J' };

function r4(code, p) { return (code[p] << 24) | (code[p + 1] << 16) | (code[p + 2] << 8) | code[p + 3]; }

function f2i(x) {
  if (x !== x) return 0;
  if (x >= 2147483647) return 2147483647;
  if (x <= -2147483648) return -2147483648;
  return x < 0 ? Math.ceil(x) | 0 : Math.floor(x) | 0;
}

function f2l(x) {
  if (x !== x) return 0n;
  if (x >= 9223372036854775807) return 9223372036854775807n;
  if (x <= -9223372036854775808) return -9223372036854775808n;
  return BigInt(Math.trunc(x));
}

function cloneArray(a) { const b = a.slice(); b.__t = a.__t; return b; }

global.JVM = { VM, JClass, JavaThrow, GThread, parseDesc, mutf8, cloneArray,
  STATE: { RUN, SLEEP, WAIT, MONITOR, REACQ, DEAD, IDLE } };

})(typeof window !== 'undefined' ? window : globalThis);
