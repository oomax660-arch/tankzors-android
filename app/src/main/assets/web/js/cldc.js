/* CLDC 1.1 core library (java.lang, java.util, java.io) implemented natively for the JS JVM. */
'use strict';

(function (global) {
const { JavaThrow, STATE } = global.JVM;

function installCLDC(vm, env) {
  const N = (name, sup, ifs, methods, statics, opts) => vm.defineNative(name, sup, ifs, methods, statics, opts);
  const thr = (c, m) => vm.jthrowObj(c, m);
  const jstr = (v) => javaToString(vm, v);
  const byteArr = (n) => vm.newArray('[B', n);

  /* ---------------- java.lang.Object ---------------- */
  N('java/lang/Object', null, [], {
    '<init>()V': () => {},
    'hashCode()I': (t, o) => identityHash(vm, o),
    'equals(Ljava/lang/Object;)Z': (t, o, x) => (o === x ? 1 : 0),
    'toString()Ljava/lang/String;': (t, o) => defaultToString(vm, o),
    'getClass()Ljava/lang/Class;': (t, o) => vm.classOf(o),
    'notify()V': (t, o) => vm.notify(o, false),
    'notifyAll()V': (t, o) => vm.notify(o, true),
    'wait()V': (t, o) => vm.wait(t, o, 0),
    'wait(J)V': (t, o, ms) => vm.wait(t, o, Number(ms)),
  });

  /* ---------------- java.lang.Class ---------------- */
  N('java/lang/Class', 'java/lang/Object', [], {
    's forName(Ljava/lang/String;)Ljava/lang/Class;': (t, name) => {
      const n = name.replace(/\./g, '/');
      const c = vm.getClassOrNull(n);
      if (!c || (env.hiddenClasses && env.hiddenClasses.has(n))) throw thr('java/lang/ClassNotFoundException', name);
      return c;
    },
    'getName()Ljava/lang/String;': (t, c) => c.name.replace(/\//g, '.'),
    'getResourceAsStream(Ljava/lang/String;)Ljava/io/InputStream;': (t, c, name) => {
      const bytes = env.getResource(name);
      if (!bytes) return null;
      const s = vm.newObjectByName('java/io/ByteArrayInputStream');
      s.__buf = bytes; s.__pos = 0; s.__mark = 0; s.__count = bytes.length; s.__res = name;
      return s;
    },
    'newInstance()Ljava/lang/Object;': (t, c) => {
      const o = vm.newObject(c);
      vm.pushCall(t, vm.findMethod(c, '<init>()V'), o, []);
      return o;
    },
    'isInstance(Ljava/lang/Object;)Z': (t, c, o) => vm.isInstance(o, c.name) ? 1 : 0,
    'toString()Ljava/lang/String;': (t, c) => 'class ' + c.name.replace(/\//g, '.'),
  });

  /* ---------------- Throwables ---------------- */
  N('java/lang/Throwable', 'java/lang/Object', [], {
    '<init>()V': (t, o) => { o.__msg = null; },
    '<init>(Ljava/lang/String;)V': (t, o, m) => { o.__msg = m; },
    'getMessage()Ljava/lang/String;': (t, o) => o.__msg === undefined ? null : o.__msg,
    'toString()Ljava/lang/String;': (t, o) => o.__cls.name.replace(/\//g, '.') + (o.__msg != null ? ': ' + o.__msg : ''),
    'printStackTrace()V': (t, o) => env.log('[java] ' + o.__cls.name + (o.__msg != null ? ': ' + o.__msg : '')),
  });
  const ex = (name, sup) => N(name, sup, [], {});
  ex('java/lang/Exception', 'java/lang/Throwable');
  ex('java/lang/Error', 'java/lang/Throwable');
  ex('java/lang/RuntimeException', 'java/lang/Exception');
  ex('java/lang/ArithmeticException', 'java/lang/RuntimeException');
  ex('java/lang/IndexOutOfBoundsException', 'java/lang/RuntimeException');
  ex('java/lang/ArrayIndexOutOfBoundsException', 'java/lang/IndexOutOfBoundsException');
  ex('java/lang/StringIndexOutOfBoundsException', 'java/lang/IndexOutOfBoundsException');
  ex('java/lang/ArrayStoreException', 'java/lang/RuntimeException');
  ex('java/lang/ClassCastException', 'java/lang/RuntimeException');
  ex('java/lang/NullPointerException', 'java/lang/RuntimeException');
  ex('java/lang/NegativeArraySizeException', 'java/lang/RuntimeException');
  ex('java/lang/IllegalArgumentException', 'java/lang/RuntimeException');
  ex('java/lang/NumberFormatException', 'java/lang/IllegalArgumentException');
  ex('java/lang/IllegalStateException', 'java/lang/RuntimeException');
  ex('java/lang/IllegalMonitorStateException', 'java/lang/RuntimeException');
  ex('java/lang/SecurityException', 'java/lang/RuntimeException');
  ex('java/lang/InterruptedException', 'java/lang/Exception');
  ex('java/lang/ClassNotFoundException', 'java/lang/Exception');
  ex('java/lang/InstantiationException', 'java/lang/Exception');
  ex('java/lang/IllegalAccessException', 'java/lang/Exception');
  ex('java/lang/VirtualMachineError', 'java/lang/Error');
  ex('java/lang/OutOfMemoryError', 'java/lang/VirtualMachineError');
  ex('java/lang/StackOverflowError', 'java/lang/VirtualMachineError');
  ex('java/lang/LinkageError', 'java/lang/Error');
  ex('java/lang/NoClassDefFoundError', 'java/lang/LinkageError');
  ex('java/lang/NoSuchFieldError', 'java/lang/LinkageError');
  ex('java/lang/NoSuchMethodError', 'java/lang/LinkageError');
  ex('java/lang/AbstractMethodError', 'java/lang/LinkageError');
  ex('java/io/IOException', 'java/lang/Exception');
  ex('java/io/EOFException', 'java/io/IOException');
  ex('java/io/InterruptedIOException', 'java/io/IOException');
  ex('java/io/UnsupportedEncodingException', 'java/io/IOException');
  ex('java/util/NoSuchElementException', 'java/lang/RuntimeException');
  ex('java/util/EmptyStackException', 'java/lang/RuntimeException');

  /* ---------------- java.lang.String ---------------- */
  const strIdx = (s, i) => { if (i < 0 || i >= s.length) throw thr('java/lang/StringIndexOutOfBoundsException', String(i)); };
  N('java/lang/String', 'java/lang/Object', [], {
    '<init>()V': (t, o) => ({ __replaceSelf: true, value: '' }),
    '<init>(Ljava/lang/String;)V': (t, o, s) => ({ __replaceSelf: true, value: s }),
    '<init>([C)V': (t, o, a) => ({ __replaceSelf: true, value: charsToStr(a, 0, a.length) }),
    '<init>([CII)V': (t, o, a, off, n) => ({ __replaceSelf: true, value: charsToStr(a, off, n) }),
    '<init>([B)V': (t, o, a) => ({ __replaceSelf: true, value: utf8Decode(a, 0, a.length) }),
    '<init>([BII)V': (t, o, a, off, n) => ({ __replaceSelf: true, value: utf8Decode(a, off, n) }),
    '<init>([BLjava/lang/String;)V': (t, o, a, enc) => ({ __replaceSelf: true, value: decodeBytes(a, 0, a.length, enc) }),
    '<init>(Ljava/lang/StringBuffer;)V': (t, o, sb) => ({ __replaceSelf: true, value: sb.__s }),
    'length()I': (t, s) => s.length,
    'charAt(I)C': (t, s, i) => { strIdx(s, i); return s.charCodeAt(i); },
    'equals(Ljava/lang/Object;)Z': (t, s, o) => (s === o ? 1 : 0),
    'equalsIgnoreCase(Ljava/lang/String;)Z': (t, s, o) => (o != null && s.toLowerCase() === o.toLowerCase() ? 1 : 0),
    'hashCode()I': (t, s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; },
    'compareTo(Ljava/lang/String;)I': (t, s, o) => {
      const n = Math.min(s.length, o.length);
      for (let i = 0; i < n; i++) { const d = s.charCodeAt(i) - o.charCodeAt(i); if (d) return d; }
      return s.length - o.length;
    },
    'concat(Ljava/lang/String;)Ljava/lang/String;': (t, s, o) => s + o,
    'endsWith(Ljava/lang/String;)Z': (t, s, o) => (s.endsWith(o) ? 1 : 0),
    'startsWith(Ljava/lang/String;)Z': (t, s, o) => (s.startsWith(o) ? 1 : 0),
    'startsWith(Ljava/lang/String;I)Z': (t, s, o, i) => (s.startsWith(o, i) ? 1 : 0),
    'indexOf(I)I': (t, s, c) => s.indexOf(String.fromCharCode(c)),
    'indexOf(II)I': (t, s, c, from) => s.indexOf(String.fromCharCode(c), Math.max(0, from)),
    'indexOf(Ljava/lang/String;)I': (t, s, o) => s.indexOf(o),
    'indexOf(Ljava/lang/String;I)I': (t, s, o, from) => s.indexOf(o, Math.max(0, from)),
    'lastIndexOf(I)I': (t, s, c) => s.lastIndexOf(String.fromCharCode(c)),
    'lastIndexOf(II)I': (t, s, c, from) => s.lastIndexOf(String.fromCharCode(c), from),
    'replace(CC)Ljava/lang/String;': (t, s, a, b) => s.split(String.fromCharCode(a)).join(String.fromCharCode(b)),
    'substring(I)Ljava/lang/String;': (t, s, a) => { if (a < 0 || a > s.length) throw thr('java/lang/StringIndexOutOfBoundsException', String(a)); return s.substring(a); },
    'substring(II)Ljava/lang/String;': (t, s, a, b) => { if (a < 0 || b > s.length || a > b) throw thr('java/lang/StringIndexOutOfBoundsException', a + ',' + b); return s.substring(a, b); },
    'toCharArray()[C': (t, s) => { const a = vm.newArray('[C', s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; },
    'getChars(II[CI)V': (t, s, b, e, dst, d) => { for (let i = b; i < e; i++) dst[d + i - b] = s.charCodeAt(i); },
    'getBytes()[B': (t, s) => vm.bytesToJava(utf8Encode(s)),
    'toUpperCase()Ljava/lang/String;': (t, s) => s.toUpperCase(),
    'toLowerCase()Ljava/lang/String;': (t, s) => s.toLowerCase(),
    'trim()Ljava/lang/String;': (t, s) => { let a = 0, b = s.length; while (a < b && s.charCodeAt(a) <= 32) a++; while (b > a && s.charCodeAt(b - 1) <= 32) b--; return s.substring(a, b); },
    'toString()Ljava/lang/String;': (t, s) => s,
    'intern()Ljava/lang/String;': (t, s) => s,
    's valueOf(I)Ljava/lang/String;': (t, i) => String(i),
    's valueOf(J)Ljava/lang/String;': (t, i) => i.toString(),
    's valueOf(C)Ljava/lang/String;': (t, c) => String.fromCharCode(c),
    's valueOf(Z)Ljava/lang/String;': (t, b) => (b ? 'true' : 'false'),
    's valueOf(F)Ljava/lang/String;': (t, f) => floatToString(f, true),
    's valueOf(D)Ljava/lang/String;': (t, f) => floatToString(f, false),
    's valueOf([C)Ljava/lang/String;': (t, a) => charsToStr(a, 0, a.length),
    's valueOf(Ljava/lang/Object;)Ljava/lang/String;': (t, o) => jstr(o),
  });

  /* ---------------- StringBuffer ---------------- */
  const SB = 'java/lang/StringBuffer';
  const sbApp = (t, o, v) => { o.__s += v; return o; };
  N(SB, 'java/lang/Object', [], {
    '<init>()V': (t, o) => { o.__s = ''; },
    '<init>(I)V': (t, o) => { o.__s = ''; },
    '<init>(Ljava/lang/String;)V': (t, o, s) => { o.__s = s; },
    'append(C)Ljava/lang/StringBuffer;': (t, o, c) => sbApp(t, o, String.fromCharCode(c)),
    'append(I)Ljava/lang/StringBuffer;': (t, o, i) => sbApp(t, o, String(i)),
    'append(J)Ljava/lang/StringBuffer;': (t, o, i) => sbApp(t, o, i.toString()),
    'append(Z)Ljava/lang/StringBuffer;': (t, o, b) => sbApp(t, o, b ? 'true' : 'false'),
    'append(F)Ljava/lang/StringBuffer;': (t, o, f) => sbApp(t, o, floatToString(f, true)),
    'append(D)Ljava/lang/StringBuffer;': (t, o, f) => sbApp(t, o, floatToString(f, false)),
    'append(Ljava/lang/String;)Ljava/lang/StringBuffer;': (t, o, s) => sbApp(t, o, s === null ? 'null' : s),
    'append(Ljava/lang/Object;)Ljava/lang/StringBuffer;': (t, o, s) => sbApp(t, o, jstr(s)),
    'append([C)Ljava/lang/StringBuffer;': (t, o, a) => sbApp(t, o, charsToStr(a, 0, a.length)),
    'charAt(I)C': (t, o, i) => { strIdx(o.__s, i); return o.__s.charCodeAt(i); },
    'delete(II)Ljava/lang/StringBuffer;': (t, o, a, b) => { o.__s = o.__s.substring(0, a) + o.__s.substring(Math.min(b, o.__s.length)); return o; },
    'deleteCharAt(I)Ljava/lang/StringBuffer;': (t, o, i) => { strIdx(o.__s, i); o.__s = o.__s.substring(0, i) + o.__s.substring(i + 1); return o; },
    'insert(IC)Ljava/lang/StringBuffer;': (t, o, i, c) => { o.__s = o.__s.substring(0, i) + String.fromCharCode(c) + o.__s.substring(i); return o; },
    'insert(ILjava/lang/String;)Ljava/lang/StringBuffer;': (t, o, i, s) => { o.__s = o.__s.substring(0, i) + s + o.__s.substring(i); return o; },
    'insert(II)Ljava/lang/StringBuffer;': (t, o, i, v) => { o.__s = o.__s.substring(0, i) + String(v) + o.__s.substring(i); return o; },
    'length()I': (t, o) => o.__s.length,
    'setCharAt(IC)V': (t, o, i, c) => { strIdx(o.__s, i); o.__s = o.__s.substring(0, i) + String.fromCharCode(c) + o.__s.substring(i + 1); },
    'setLength(I)V': (t, o, n) => { o.__s = n <= o.__s.length ? o.__s.substring(0, n) : o.__s + '\0'.repeat(n - o.__s.length); },
    'reverse()Ljava/lang/StringBuffer;': (t, o) => { o.__s = o.__s.split('').reverse().join(''); return o; },
    'toString()Ljava/lang/String;': (t, o) => o.__s,
  });

  /* ---------------- boxes, Math, Character ---------------- */
  N('java/lang/Integer', 'java/lang/Object', [], {
    '<init>(I)V': (t, o, v) => { o.__v = v; },
    'intValue()I': (t, o) => o.__v,
    'toString()Ljava/lang/String;': (t, o) => String(o.__v),
    'equals(Ljava/lang/Object;)Z': (t, o, x) => (x && x.__cls === o.__cls && x.__v === o.__v ? 1 : 0),
    'hashCode()I': (t, o) => o.__v,
    's parseInt(Ljava/lang/String;)I': (t, s) => parseIntJ(s, 10),
    's parseInt(Ljava/lang/String;I)I': (t, s, r) => parseIntJ(s, r),
    's valueOf(Ljava/lang/String;)Ljava/lang/Integer;': (t, s) => { const o = vm.newObjectByName('java/lang/Integer'); o.__v = parseIntJ(s, 10); return o; },
    's toString(I)Ljava/lang/String;': (t, i) => String(i),
    's toString(II)Ljava/lang/String;': (t, i, r) => i.toString(r),
    's toHexString(I)Ljava/lang/String;': (t, i) => (i >>> 0).toString(16),
  }, { MAX_VALUE: 2147483647, MIN_VALUE: -2147483648 });
  function parseIntJ(s, r) {
    if (s === null || !/^[+-]?[0-9a-zA-Z]+$/.test(s)) throw thr('java/lang/NumberFormatException', s);
    const v = parseInt(s, r);
    if (isNaN(v) || v > 2147483647 || v < -2147483648 || !validDigits(s, r)) throw thr('java/lang/NumberFormatException', s);
    return v | 0;
  }
  function validDigits(s, r) { const d = s.replace(/^[+-]/, '').toLowerCase(); for (const ch of d) { const v = parseInt(ch, 36); if (isNaN(v) || v >= r) return false; } return true; }
  N('java/lang/Long', 'java/lang/Object', [], {
    '<init>(J)V': (t, o, v) => { o.__v = v; },
    'longValue()J': (t, o) => o.__v,
    's parseLong(Ljava/lang/String;)J': (t, s) => { try { return BigInt.asIntN(64, BigInt(s.trim())); } catch (e) { throw thr('java/lang/NumberFormatException', s); } },
    'toString()Ljava/lang/String;': (t, o) => o.__v.toString(),
  });
  N('java/lang/Double', 'java/lang/Object', [], {
    '<init>(D)V': (t, o, v) => { o.__v = v; },
    'intValue()I': (t, o) => f2iJ(o.__v),
    'doubleValue()D': (t, o) => o.__v,
    'toString()Ljava/lang/String;': (t, o) => floatToString(o.__v, false),
  });
  N('java/lang/Float', 'java/lang/Object', [], {
    '<init>(F)V': (t, o, v) => { o.__v = v; },
    'intValue()I': (t, o) => f2iJ(o.__v),
    'floatValue()F': (t, o) => o.__v,
  });
  N('java/lang/Boolean', 'java/lang/Object', [], {
    '<init>(Z)V': (t, o, v) => { o.__v = v; },
    'booleanValue()Z': (t, o) => o.__v,
  });
  N('java/lang/Character', 'java/lang/Object', [], {
    '<init>(C)V': (t, o, v) => { o.__v = v; },
    'charValue()C': (t, o) => o.__v,
    's isDigit(C)Z': (t, c) => (c >= 48 && c <= 57 ? 1 : 0),
    's isUpperCase(C)Z': (t, c) => { const s = String.fromCharCode(c); return s !== s.toLowerCase() ? 1 : 0; },
    's isLowerCase(C)Z': (t, c) => { const s = String.fromCharCode(c); return s !== s.toUpperCase() ? 1 : 0; },
    's toUpperCase(C)C': (t, c) => String.fromCharCode(c).toUpperCase().charCodeAt(0),
    's toLowerCase(C)C': (t, c) => String.fromCharCode(c).toLowerCase().charCodeAt(0),
    's digit(CI)I': (t, c, r) => { const v = parseInt(String.fromCharCode(c), 36); return isNaN(v) || v >= r ? -1 : v; },
  });
  N('java/lang/Math', 'java/lang/Object', [], {
    's abs(I)I': (t, a) => (a < 0 ? (-a) | 0 : a),
    's abs(J)J': (t, a) => (a < 0n ? BigInt.asIntN(64, -a) : a),
    's abs(F)F': (t, a) => Math.abs(a),
    's abs(D)D': (t, a) => Math.abs(a),
    's max(II)I': (t, a, b) => (a > b ? a : b),
    's min(II)I': (t, a, b) => (a < b ? a : b),
    's max(JJ)J': (t, a, b) => (a > b ? a : b),
    's min(JJ)J': (t, a, b) => (a < b ? a : b),
    's max(DD)D': (t, a, b) => Math.max(a, b),
    's min(DD)D': (t, a, b) => Math.min(a, b),
    's sin(D)D': (t, a) => Math.sin(a),
    's cos(D)D': (t, a) => Math.cos(a),
    's tan(D)D': (t, a) => Math.tan(a),
    's sqrt(D)D': (t, a) => Math.sqrt(a),
    's ceil(D)D': (t, a) => Math.ceil(a),
    's floor(D)D': (t, a) => Math.floor(a),
    's toRadians(D)D': (t, a) => a * Math.PI / 180,
    's toDegrees(D)D': (t, a) => a * 180 / Math.PI,
  });

  /* ---------------- System / Runtime ---------------- */
  const out = vm.newObjectByName.bind(vm);
  N('java/io/PrintStream', 'java/lang/Object', [], {
    'println(Ljava/lang/String;)V': (t, o, s) => env.log('[java] ' + s),
    'println(Ljava/lang/Object;)V': (t, o, s) => env.log('[java] ' + jstr(s)),
    'println(I)V': (t, o, s) => env.log('[java] ' + s),
    'println()V': () => {},
    'print(Ljava/lang/String;)V': (t, o, s) => env.log('[java] ' + s),
  });
  N('java/lang/System', 'java/lang/Object', [], {
    's currentTimeMillis()J': () => BigInt(Date.now()),
    's gc()V': () => {},
    's getProperty(Ljava/lang/String;)Ljava/lang/String;': (t, k) => (k in env.properties ? env.properties[k] : null),
    's arraycopy(Ljava/lang/Object;ILjava/lang/Object;II)V': (t, src, sp, dst, dp, n) => {
      if (src === null || dst === null) throw thr('java/lang/NullPointerException', null);
      if (n < 0 || sp < 0 || dp < 0 || sp + n > src.length || dp + n > dst.length) throw thr('java/lang/ArrayIndexOutOfBoundsException', null);
      if (src === dst && sp < dp) for (let i = n - 1; i >= 0; i--) dst[dp + i] = src[sp + i];
      else for (let i = 0; i < n; i++) dst[dp + i] = src[sp + i];
    },
    's identityHashCode(Ljava/lang/Object;)I': (t, o) => identityHash(vm, o),
    's exit(I)V': () => env.exit && env.exit(),
  }, {}, { clinit: (vm, c) => { c.statics.out = out('java/io/PrintStream'); c.statics.err = c.statics.out; } });
  N('java/lang/Runtime', 'java/lang/Object', [], {
    's getRuntime()Ljava/lang/Runtime;': () => { if (!env.__rt) env.__rt = vm.newObjectByName('java/lang/Runtime'); return env.__rt; },
    'freeMemory()J': () => BigInt(env.freeMemory || 6 * 1024 * 1024),
    'totalMemory()J': () => BigInt(env.totalMemory || 8 * 1024 * 1024),
    'gc()V': () => {},
  });

  /* ---------------- Threads ---------------- */
  N('java/lang/Runnable', null, [], {}, {}, { isInterface: true });
  N('java/lang/Thread', 'java/lang/Object', ['java/lang/Runnable'], {
    '<init>()V': (t, o) => { o.__target = null; },
    '<init>(Ljava/lang/Runnable;)V': (t, o, r) => { o.__target = r; },
    '<init>(Ljava/lang/Runnable;Ljava/lang/String;)V': (t, o, r) => { o.__target = r; },
    '<init>(Ljava/lang/String;)V': (t, o) => { o.__target = null; },
    'start()V': (t, o) => {
      if (o.__gthread) throw thr('java/lang/IllegalThreadStateException', null);
      vm.startJavaThread(o);
    },
    'run()V': (t, o) => { if (o.__target) vm.callVirtual(t, o.__target, 'run()V', []); },
    'isAlive()Z': (t, o) => (o.__gthread && o.__gthread.state !== STATE.DEAD ? 1 : 0),
    'interrupt()V': (t, o) => {
      const g = o.__gthread; if (!g) return;
      if (g.state === STATE.SLEEP) { g.state = STATE.RUN; g.pendingThrow = thr('java/lang/InterruptedException', null); }
      else if (g.state === STATE.WAIT) { g.interrupted = true; g.state = STATE.REACQ; }
      else g.interrupted = true;
    },
    'setPriority(I)V': () => {},
    'getPriority()I': () => 5,
    'join()V': (t, o) => {
      const g = o.__gthread; if (!g || g.state === STATE.DEAD) return;
      // poll-join: sleep a bit and re-check by re-executing is not possible; approximate with a short sleep
      t.state = STATE.SLEEP; t.wakeAt = performance.now() + 20;
    },
    's sleep(J)V': (t, ms) => {
      if (t.interrupted) { t.interrupted = false; throw thr('java/lang/InterruptedException', null); }
      t.state = STATE.SLEEP; t.wakeAt = performance.now() + Math.max(0, Number(ms));
    },
    's yield()V': (t) => { t.state = STATE.SLEEP; t.wakeAt = 0; },
    's activeCount()I': () => vm.threads.filter(g => g.state !== STATE.DEAD && !g.isEventThread).length,
    's currentThread()Ljava/lang/Thread;': (t) => {
      if (!t.javaThread) { const o = vm.newObjectByName('java/lang/Thread'); o.__gthread = t; t.javaThread = o; }
      return t.javaThread;
    },
  });
  ex('java/lang/IllegalThreadStateException', 'java/lang/IllegalArgumentException');
  N('java/util/TimerTask', 'java/lang/Object', ['java/lang/Runnable'], {
    '<init>()V': (t, o) => { o.__cancelled = false; },
    'cancel()Z': (t, o) => { const r = !o.__cancelled; o.__cancelled = true; if (o.__timer) o.__timer.cancelTask(o); return r ? 1 : 0; },
    'scheduledExecutionTime()J': () => BigInt(Date.now()),
  });
  N('java/util/Timer', 'java/lang/Object', [], {
    '<init>()V': (t, o) => { o.__tasks = []; },
    'schedule(Ljava/util/TimerTask;J)V': (t, o, task, d) => timerSchedule(o, task, Number(d), 0),
    'schedule(Ljava/util/TimerTask;JJ)V': (t, o, task, d, p) => timerSchedule(o, task, Number(d), Number(p)),
    'scheduleAtFixedRate(Ljava/util/TimerTask;JJ)V': (t, o, task, d, p) => timerSchedule(o, task, Number(d), Number(p)),
    'cancel()V': (t, o) => { for (const tk of o.__tasks) tk.__cancelled = true; o.__tasks = []; },
  });
  function timerSchedule(timer, task, delay, period) {
    timer.__tasks.push(task); task.__cancelled = false;
    const tick = () => {
      if (task.__cancelled) return;
      env.postEvent({ type: 'call', obj: task, nameDesc: 'run()V' });
      if (period > 0) setTimeout(tick, period);
    };
    setTimeout(tick, delay);
  }

  /* ---------------- java.util ---------------- */
  const vecIdx = (o, i, n) => { if (i < 0 || i >= (n === undefined ? o.__v.length : n)) throw thr('java/lang/ArrayIndexOutOfBoundsException', String(i)); };
  const jequals = (a, b) => a === b || (a !== null && b !== null && a.__cls && b.__cls && a.__cls === b.__cls && a.__v !== undefined && a.__v === b.__v);
  N('java/util/Vector', 'java/lang/Object', [], {
    '<init>()V': (t, o) => { o.__v = []; },
    '<init>(I)V': (t, o) => { o.__v = []; },
    '<init>(II)V': (t, o) => { o.__v = []; },
    'addElement(Ljava/lang/Object;)V': (t, o, e) => { o.__v.push(e); },
    'elementAt(I)Ljava/lang/Object;': (t, o, i) => { vecIdx(o, i); return o.__v[i]; },
    'firstElement()Ljava/lang/Object;': (t, o) => { if (!o.__v.length) throw thr('java/util/NoSuchElementException', null); return o.__v[0]; },
    'lastElement()Ljava/lang/Object;': (t, o) => { if (!o.__v.length) throw thr('java/util/NoSuchElementException', null); return o.__v[o.__v.length - 1]; },
    'indexOf(Ljava/lang/Object;)I': (t, o, e) => o.__v.findIndex(x => jequals(e, x)),
    'contains(Ljava/lang/Object;)Z': (t, o, e) => (o.__v.some(x => jequals(e, x)) ? 1 : 0),
    'insertElementAt(Ljava/lang/Object;I)V': (t, o, e, i) => { vecIdx(o, i, o.__v.length + 1); o.__v.splice(i, 0, e); },
    'setElementAt(Ljava/lang/Object;I)V': (t, o, e, i) => { vecIdx(o, i); o.__v[i] = e; },
    'removeElementAt(I)V': (t, o, i) => { vecIdx(o, i); o.__v.splice(i, 1); },
    'removeAllElements()V': (t, o) => { o.__v.length = 0; },
    'removeElement(Ljava/lang/Object;)Z': (t, o, e) => { const i = o.__v.findIndex(x => jequals(e, x)); if (i < 0) return 0; o.__v.splice(i, 1); return 1; },
    'size()I': (t, o) => o.__v.length,
    'isEmpty()Z': (t, o) => (o.__v.length ? 0 : 1),
    'copyInto([Ljava/lang/Object;)V': (t, o, a) => { for (let i = 0; i < o.__v.length; i++) a[i] = o.__v[i]; },
    'setSize(I)V': (t, o, n) => { while (o.__v.length < n) o.__v.push(null); o.__v.length = n; },
  });
  N('java/util/Stack', 'java/util/Vector', [], {
    '<init>()V': (t, o) => { o.__v = []; },
    'push(Ljava/lang/Object;)Ljava/lang/Object;': (t, o, e) => { o.__v.push(e); return e; },
    'pop()Ljava/lang/Object;': (t, o) => { if (!o.__v.length) throw thr('java/util/EmptyStackException', null); return o.__v.pop(); },
    'peek()Ljava/lang/Object;': (t, o) => { if (!o.__v.length) throw thr('java/util/EmptyStackException', null); return o.__v[o.__v.length - 1]; },
    'empty()Z': (t, o) => (o.__v.length ? 0 : 1),
  });
  N('java/util/Hashtable', 'java/lang/Object', [], {
    '<init>()V': (t, o) => { o.__m = new Map(); },
    '<init>(I)V': (t, o) => { o.__m = new Map(); },
    'put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;': (t, o, k, v) => { const key = hkey(k); const old = o.__m.get(key); o.__m.set(key, [k, v]); return old ? old[1] : null; },
    'get(Ljava/lang/Object;)Ljava/lang/Object;': (t, o, k) => { const e = o.__m.get(hkey(k)); return e ? e[1] : null; },
    'remove(Ljava/lang/Object;)Ljava/lang/Object;': (t, o, k) => { const key = hkey(k); const e = o.__m.get(key); o.__m.delete(key); return e ? e[1] : null; },
    'containsKey(Ljava/lang/Object;)Z': (t, o, k) => (o.__m.has(hkey(k)) ? 1 : 0),
    'size()I': (t, o) => o.__m.size,
    'clear()V': (t, o) => o.__m.clear(),
  });
  function hkey(k) { if (typeof k === 'string') return 's:' + k; if (k && k.__v !== undefined) return 'v:' + k.__cls.name + ':' + String(k.__v); return k; }

  N('java/util/Random', 'java/lang/Object', [], {
    '<init>()V': (t, o) => { o.__seed = (BigInt(Date.now()) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n); },
    '<init>(J)V': (t, o, s) => { o.__seed = (s ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n); },
    'setSeed(J)V': (t, o, s) => { o.__seed = (s ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n); },
    'nextInt()I': (t, o) => rndNext(o, 32),
    'nextInt(I)I': (t, o, n) => {
      if (n <= 0) throw thr('java/lang/IllegalArgumentException', null);
      if ((n & -n) === n) return Number((BigInt(n) * BigInt(rndNext(o, 31))) >> 31n);
      let bits, val;
      do { bits = rndNext(o, 31); val = bits % n; } while (bits - val + (n - 1) < 0 || bits - val + (n - 1) > 2147483647);
      return val;
    },
    'nextLong()J': (t, o) => BigInt.asIntN(64, (BigInt(rndNext(o, 32)) << 32n) + BigInt(rndNext(o, 32))),
    'nextFloat()F': (t, o) => rndNext(o, 24) / (1 << 24),
    'nextDouble()D': (t, o) => (rndNext(o, 26) * 134217728 + rndNext(o, 27)) / 9007199254740992,
  });
  function rndNext(o, bits) {
    o.__seed = (o.__seed * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n);
    return Number(BigInt.asIntN(32, o.__seed >> BigInt(48 - bits)));
  }
  N('java/util/Calendar', 'java/lang/Object', [], {
    's getInstance()Ljava/util/Calendar;': () => vm.newObjectByName('java/util/Calendar'),
    'get(I)I': (t, o, f) => { const d = new Date(); switch (f) { case 1: return d.getFullYear(); case 2: return d.getMonth(); case 5: return d.getDate(); case 11: return d.getHours(); case 12: return d.getMinutes(); case 13: return d.getSeconds(); default: return 0; } },
  });

  /* ---------------- java.io ---------------- */
  // generic byte read from any native input stream
  function rd(s) {
    if (s.__buf) { return s.__pos < s.__count ? s.__buf[s.__pos++] & 0xff : -1; }
    if (s.__in) return rd(s.__in);
    return -1;
  }
  function avail(s) { if (s.__buf) return s.__count - s.__pos; if (s.__in) return avail(s.__in); return 0; }
  function readInto(s, a, off, n) {
    if (n === 0) return 0;
    let i = 0;
    for (; i < n; i++) { const b = rd(s); if (b < 0) break; a[off + i] = b; }
    return i === 0 ? -1 : i;
  }
  const rdx = (s) => { const b = rd(s); if (b < 0) throw thr('java/io/EOFException', null); return b; };
  const baseStream = s => (s.__buf ? s : s.__in ? baseStream(s.__in) : s);

  N('java/io/InputStream', 'java/lang/Object', [], {
    '<init>()V': () => {},
    'read()I': (t, s) => rd(s),
    'read([B)I': (t, s, a) => readInto(s, a, 0, a.length),
    'read([BII)I': (t, s, a, off, n) => readInto(s, a, off, n),
    'available()I': (t, s) => avail(s),
    'close()V': () => {},
    'reset()V': (t, s) => { const b = baseStream(s); if (b.__buf) b.__pos = b.__mark; },
    'mark(I)V': (t, s) => { const b = baseStream(s); if (b.__buf) b.__mark = b.__pos; },
    'markSupported()Z': (t, s) => (baseStream(s).__buf ? 1 : 0),
    'skip(J)J': (t, s, n) => { let k = 0n; while (k < n && rd(s) >= 0) k++; return k; },
  });
  N('java/io/ByteArrayInputStream', 'java/io/InputStream', [], {
    '<init>([B)V': (t, s, a) => { s.__buf = a; s.__pos = 0; s.__mark = 0; s.__count = a.length; },
    '<init>([BII)V': (t, s, a, off, n) => { s.__buf = a; s.__pos = off; s.__mark = off; s.__count = Math.min(off + n, a.length); },
  });
  N('java/io/DataInputStream', 'java/io/InputStream', [], {
    '<init>(Ljava/io/InputStream;)V': (t, s, i) => { s.__in = i; },
    'readBoolean()Z': (t, s) => (rdx(s) ? 1 : 0),
    'readByte()B': (t, s) => (rdx(s) << 24) >> 24,
    'readUnsignedByte()I': (t, s) => rdx(s),
    'readChar()C': (t, s) => ((rdx(s) << 8) | rdx(s)) & 0xffff,
    'readShort()S': (t, s) => (((rdx(s) << 8) | rdx(s)) << 16) >> 16,
    'readUnsignedShort()I': (t, s) => ((rdx(s) << 8) | rdx(s)),
    'readInt()I': (t, s) => (rdx(s) << 24) | (rdx(s) << 16) | (rdx(s) << 8) | rdx(s),
    'readLong()J': (t, s) => { let v = 0n; for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(rdx(s)); return BigInt.asIntN(64, v); },
    'readFloat()F': (t, s) => { const dv = new DataView(new ArrayBuffer(4)); for (let i = 0; i < 4; i++) dv.setUint8(i, rdx(s)); return dv.getFloat32(0); },
    'readDouble()D': (t, s) => { const dv = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) dv.setUint8(i, rdx(s)); return dv.getFloat64(0); },
    'readFully([B)V': (t, s, a) => { for (let i = 0; i < a.length; i++) a[i] = rdx(s); },
    'readFully([BII)V': (t, s, a, off, n) => { for (let i = 0; i < n; i++) a[off + i] = rdx(s); },
    'skipBytes(I)I': (t, s, n) => { let k = 0; while (k < n && rd(s) >= 0) k++; return k; },
    'readUTF()Ljava/lang/String;': (t, s) => {
      const n = (rdx(s) << 8) | rdx(s);
      const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = rdx(s);
      return global.JVM.mutf8(b, 0, n);
    },
  });
  N('java/io/Reader', 'java/lang/Object', [], { 'close()V': () => {} });
  N('java/io/InputStreamReader', 'java/io/Reader', [], {
    '<init>(Ljava/io/InputStream;)V': (t, r, i) => { r.__in = i; r.__enc = 'UTF-8'; },
    '<init>(Ljava/io/InputStream;Ljava/lang/String;)V': (t, r, i, e) => { r.__in = i; r.__enc = (e || 'UTF-8').toUpperCase(); },
    'read()I': (t, r) => readChar(r),
    'read([CII)I': (t, r, a, off, n) => { let i = 0; for (; i < n; i++) { const c = readChar(r); if (c < 0) break; a[off + i] = c; } return i === 0 && n > 0 ? -1 : i; },
    'close()V': () => {},
  });
  function readChar(r) {
    if (r.__pend !== undefined) { const c = r.__pend; r.__pend = undefined; return c; }
    const s = r.__in;
    if (r.__enc === 'UTF-16BE' || r.__enc === 'UTF-16') { const a = rd(s); if (a < 0) return -1; const b = rd(s); return ((a << 8) | (b & 0xff)) & 0xffff; }
    if (r.__enc === 'UTF-16LE') { const a = rd(s); if (a < 0) return -1; const b = rd(s); return ((b << 8) | a) & 0xffff; }
    if (r.__enc === 'ISO-8859-1' || r.__enc === 'ISO8859_1' || r.__enc === 'US-ASCII') return rd(s);
    const c = rd(s); if (c < 0) return -1;
    if (c < 0x80) return c;
    if ((c & 0xe0) === 0xc0) return ((c & 0x1f) << 6) | (rd(s) & 0x3f);
    if ((c & 0xf0) === 0xe0) return ((c & 0x0f) << 12) | ((rd(s) & 0x3f) << 6) | (rd(s) & 0x3f);
    return c;
  }

  // output
  N('java/io/OutputStream', 'java/lang/Object', [], {
    '<init>()V': () => {},
    'write(I)V': (t, o, b) => wr(o, b),
    'write([B)V': (t, o, a) => { for (let i = 0; i < a.length; i++) wr(o, a[i]); },
    'write([BII)V': (t, o, a, off, n) => { for (let i = 0; i < n; i++) wr(o, a[off + i]); },
    'flush()V': () => {},
    'close()V': (t, o) => { if (o.__onClose) o.__onClose(); },
  });
  function wr(o, b) { if (o.__bytes) o.__bytes.push(b & 0xff); else if (o.__out) wr(o.__out, b); }
  N('java/io/ByteArrayOutputStream', 'java/io/OutputStream', [], {
    '<init>()V': (t, o) => { o.__bytes = []; },
    '<init>(I)V': (t, o) => { o.__bytes = []; },
    'toByteArray()[B': (t, o) => vm.bytesToJava(Uint8Array.from(o.__bytes)),
    'toString()Ljava/lang/String;': (t, o) => utf8Decode(Uint8Array.from(o.__bytes), 0, o.__bytes.length),
    'size()I': (t, o) => o.__bytes.length,
    'reset()V': (t, o) => { o.__bytes.length = 0; },
  });
  const w16 = (o, v) => { wr(o, v >> 8); wr(o, v); };
  const w32 = (o, v) => { wr(o, v >> 24); wr(o, v >> 16); wr(o, v >> 8); wr(o, v); };
  N('java/io/DataOutputStream', 'java/io/OutputStream', [], {
    '<init>(Ljava/io/OutputStream;)V': (t, o, out) => { o.__out = out; },
    'writeBoolean(Z)V': (t, o, v) => wr(o, v ? 1 : 0),
    'writeByte(I)V': (t, o, v) => wr(o, v),
    'writeChar(I)V': (t, o, v) => w16(o, v),
    'writeShort(I)V': (t, o, v) => w16(o, v),
    'writeInt(I)V': (t, o, v) => w32(o, v),
    'writeLong(J)V': (t, o, v) => { const u = BigInt.asUintN(64, v); w32(o, Number(u >> 32n) | 0); w32(o, Number(u & 0xffffffffn) | 0); },
    'writeUTF(Ljava/lang/String;)V': (t, o, s) => { const b = mutf8Encode(s); w16(o, b.length); for (const x of b) wr(o, x); },
    'writeChars(Ljava/lang/String;)V': (t, o, s) => { for (let i = 0; i < s.length; i++) w16(o, s.charCodeAt(i)); },
    'flush()V': () => {},
    'close()V': (t, o) => { if (o.__out && o.__out.__onClose) o.__out.__onClose(); },
  });
}

/* ---------------- helpers ---------------- */
function identityHash(vm, o) {
  if (typeof o === 'string') { let h = 0; for (let i = 0; i < o.length; i++) h = (Math.imul(31, h) + o.charCodeAt(i)) | 0; return h; }
  if (o.__hash === undefined) o.__hash = (++vm.objSeq * 2654435761) | 0;
  return o.__hash;
}
function defaultToString(vm, o) {
  if (typeof o === 'string') return o;
  const c = vm.classOf(o);
  return c.name.replace(/\//g, '.') + '@' + (identityHash(vm, o) >>> 0).toString(16);
}
function javaToString(vm, v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v;
  if (v.__s !== undefined && v.__cls && v.__cls.name === 'java/lang/StringBuffer') return v.__s;
  if (v.__v !== undefined && v.__cls && /^java\/lang\/(Integer|Long|Boolean|Character|Double|Float)$/.test(v.__cls.name)) {
    if (v.__cls.name === 'java/lang/Character') return String.fromCharCode(v.__v);
    if (v.__cls.name === 'java/lang/Boolean') return v.__v ? 'true' : 'false';
    return String(v.__v);
  }
  if (v.__msg !== undefined) return v.__cls.name.replace(/\//g, '.') + (v.__msg != null ? ': ' + v.__msg : '');
  return defaultToString(vm, v);
}
function charsToStr(a, off, n) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(a[off + i]); return s; }
function utf8Decode(a, off, n) {
  const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = a[off + i];
  try { return new TextDecoder('utf-8').decode(u); } catch (e) { return charsToStr(u, 0, n); }
}
function decodeBytes(a, off, n, enc) {
  const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = a[off + i];
  const e = (enc || 'utf-8').toLowerCase();
  try { return new TextDecoder(e === 'iso8859_1' ? 'iso-8859-1' : e).decode(u); } catch (er) { return utf8Decode(a, off, n); }
}
function utf8Encode(s) { return new TextEncoder().encode(s); }
function mutf8Encode(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 1 && c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}
function f2iJ(x) { if (x !== x) return 0; if (x >= 2147483647) return 2147483647; if (x <= -2147483648) return -2147483648; return Math.trunc(x) | 0; }
function floatToString(f, isFloat) {
  if (f !== f) return 'NaN';
  if (f === Infinity) return 'Infinity';
  if (f === -Infinity) return '-Infinity';
  if (Number.isInteger(f) && Math.abs(f) < 1e7) return f.toFixed(1);
  return String(isFloat ? parseFloat(f.toPrecision(8)) : f);
}

global.CLDC = { installCLDC, javaToString };
})(typeof window !== 'undefined' ? window : globalThis);
