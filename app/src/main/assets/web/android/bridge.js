/* Android shell bridge.
 *
 * The page talks to its native shell the iOS way: window.webkit.messageHandlers.<name>.postMessage(...).
 * Inside the Android app (window.AndroidBridge is injected by MainActivity) this file builds the same object
 * on top of AndroidBridge, so the game, the saves, the haptics and the network game need no changes.
 * The on-screen controls, the settings and the help are drawn by android/touch.js (HTML, like the iOS overlay).
 *
 * Desktop test: open index.html?android=1 — a fake bridge is used (saves in localStorage, network off).
 * Must be loaded in <head>, before every other script.
 */
'use strict';
(function () {
  const params = new URLSearchParams(location.search);
  const AB = window.AndroidBridge || (params.has('android') ? {
    // the fake shell for testing in a desktop browser
    post(name, body) { if (name === 'rms') try { localStorage.setItem('fake.rms', body); } catch (e) {} },
    loadRms() { try { return localStorage.getItem('fake.rms'); } catch (e) { return null; } },
    haptic() {},
  } : null);
  if (!AB) return;

  window.__ANDROID__ = true;
  window.__TOUCH_UI__ = true;

  // the settings of the shell (the iOS app keeps them in UserDefaults)
  const DEF = { lang: 'rus', sfx: true, haptic: true, opacity: 0.85, scale: 1.0, leftHanded: false, quality: 10, screenControls: true, fixedJoystick: false, helpShown: false, unlockAll: true };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('native.settings') || '{}') || {}; } catch (e) {}
  const S = Object.assign({}, DEF, saved);
  window.__NATIVE_PREFS__ = S;
  window.__saveNativePrefs = () => { try { localStorage.setItem('native.settings', JSON.stringify(window.__NATIVE_PREFS__)); } catch (e) {} };
  window.__NATIVE_SETTINGS__ = { lang: S.lang, sfx: S.sfx, haptic: S.haptic, quality: S.quality, screenControls: S.screenControls, unlockAll: S.unlockAll };

  // saved games
  try { const r = AB.loadRms(); if (r) window.__NATIVE_RMS__ = String(r); } catch (e) {}

  const post = (name) => ({
    postMessage(m) {
      const s = typeof m === 'string' ? m : JSON.stringify(m);
      if (name === 'mode' && window.TouchUI) window.TouchUI.setMode(s);
      if (name === 'haptic') { if (!(window.__NATIVE_PREFS__ || S).haptic) return; try { AB.haptic(Number(m) || 0); } catch (e) {} return; }
      try { AB.post(name, s); } catch (e) {}
    },
  });
  window.webkit = window.webkit || {};
  window.webkit.messageHandlers = { mode: post('mode'), net: post('net'), rms: post('rms'), haptic: post('haptic') };
  // the network game needs the real shell
  if (!window.AndroidBridge) delete window.webkit.messageHandlers.net;
})();
