package com.tankzors.pro;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.view.DisplayCutout;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Tankzors Pro for Android: the game (a J2ME runtime written in JavaScript, shared with the iPhone app)
 * runs in a full-screen WebView. This activity only provides what the page cannot do itself:
 * saved games on disk, vibration, the network game (NetHub), the phone's Back key, gamepads,
 * the camera cut-out (safe areas) and the app lifecycle. The on-screen controls are drawn by the page
 * (web/android/touch.js), with the same layout as on iPhone.
 */
public class MainActivity extends Activity {
    static final String TAG = "Tankzors";
    static final String START_URL = "file:///android_asset/web/index.html";

    private WebView web;
    private FrameLayout root;
    private NetHub net;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private File saveFile;
    private Vibrator vibrator;
    private float[] safe = new float[4];   // top, right, bottom, left in CSS px

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        saveFile = new File(getFilesDir(), "rms.json");
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);

        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        w.setBackgroundDrawable(null);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        createWebView();
        net = new NetHub(this);
        hideSystemBars();
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            readCutout(insets);
            return insets;
        });
        web.loadUrl(START_URL);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void createWebView() {
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setHapticFeedbackEnabled(false);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);                       // the system font size must not scale the page
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // stay inside the bundled page
                return !request.getUrl().toString().startsWith("file:///android_asset/");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pushSafeArea();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // the system killed the page (memory): start it again, the saves are on disk
                Log.w(TAG, "web process gone, reloading");
                root.removeView(web);
                web.destroy();
                createWebView();
                web.loadUrl(START_URL);
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    }

    /** Runs JavaScript in the page (from any thread). */
    void js(final String source) {
        ui.post(() -> { if (web != null) web.evaluateJavascript(source, null); });
    }

    // ------------------------------------------------------------------ full screen and the camera cut-out

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    private void readCutout(WindowInsets insets) {
        float d = getResources().getDisplayMetrics().density;
        float t = 0, r = 0, b = 0, l = 0;
        if (Build.VERSION.SDK_INT >= 28) {
            DisplayCutout c = insets.getDisplayCutout();
            if (c != null) { t = c.getSafeInsetTop(); r = c.getSafeInsetRight(); b = c.getSafeInsetBottom(); l = c.getSafeInsetLeft(); }
        }
        safe = new float[]{t / d, r / d, b / d, l / d};
        pushSafeArea();
    }

    /** The page lays out its controls with --sat/--sar/--sab/--sal (env(safe-area-inset-*) on iPhone). */
    private void pushSafeArea() {
        final String src = "(function(){var s=document.documentElement.style;"
                + "s.setProperty('--sat','" + safe[0] + "px');s.setProperty('--sar','" + safe[1] + "px');"
                + "s.setProperty('--sab','" + safe[2] + "px');s.setProperty('--sal','" + safe[3] + "px');"
                + "window.dispatchEvent(new Event('resize'));})()";
        js(src);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onPause() {
        super.onPause();
        js("window.__host && __host.flushRMS && __host.flushRMS(); window.__appPause && window.__appPause()");
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemBars();
        js("window.__appResume && window.__appResume(); window.__audioKick && window.__audioKick()");
    }

    @Override
    protected void onDestroy() {
        net.stopAll();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    // ------------------------------------------------------------------ keys: Back, gamepads, keyboards

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        if (code == KeyEvent.KEYCODE_BACK) {
            if (e.getAction() == KeyEvent.ACTION_UP) js("window.__androidBack && window.__androidBack()");
            return true;
        }
        int k = gameKey(code);
        if (k != 0) {
            if (e.getRepeatCount() == 0) {
                boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
                if (e.getAction() == KeyEvent.ACTION_DOWN || e.getAction() == KeyEvent.ACTION_UP)
                    js("window.__nk && __nk(" + k + "," + (down ? 1 : 0) + ")");
            }
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    /** Gamepad / keyboard -> the game's key codes (the same ones the on-screen buttons send). */
    private static int gameKey(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP: case KeyEvent.KEYCODE_W: return -1;
            case KeyEvent.KEYCODE_DPAD_DOWN: case KeyEvent.KEYCODE_S: return -2;
            case KeyEvent.KEYCODE_DPAD_LEFT: case KeyEvent.KEYCODE_A: return -3;
            case KeyEvent.KEYCODE_DPAD_RIGHT: case KeyEvent.KEYCODE_D: return -4;
            case KeyEvent.KEYCODE_BUTTON_A: case KeyEvent.KEYCODE_DPAD_CENTER: case KeyEvent.KEYCODE_SPACE: case KeyEvent.KEYCODE_ENTER: return -5;
            case KeyEvent.KEYCODE_BUTTON_START: case KeyEvent.KEYCODE_ESCAPE: return -6;
            case KeyEvent.KEYCODE_BUTTON_SELECT: return -7;
            case KeyEvent.KEYCODE_BUTTON_X: return 42;      // supplies / upgrades
            case KeyEvent.KEYCODE_BUTTON_Y: return 55;      // repair
            case KeyEvent.KEYCODE_BUTTON_L1: return 48;     // reverse / build
            case KeyEvent.KEYCODE_BUTTON_R1: return 57;     // radar / bots
            case KeyEvent.KEYCODE_BUTTON_B: return -6;
            default: return 0;
        }
    }

    // ------------------------------------------------------------------ the page's bridge (window.AndroidBridge)

    final class Bridge {
        /** window.webkit.messageHandlers.<name>.postMessage(body), see web/android/bridge.js */
        @JavascriptInterface
        public void post(String name, String body) {
            if (name == null || body == null) return;
            switch (name) {
                case "rms": writeSaves(body); break;
                case "net":
                    try { net.command(new JSONObject(body)); } catch (Exception ex) { Log.w(TAG, "net: " + ex); }
                    break;
                case "mode": break;           // the on-screen controls live in the page
                default: break;
            }
        }

        @JavascriptInterface
        public String loadRms() {
            if (!saveFile.exists()) return null;
            try (FileInputStream in = new FileInputStream(saveFile)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                return new String(out.toByteArray(), StandardCharsets.UTF_8);
            } catch (Exception ex) {
                Log.w(TAG, "load saves: " + ex);
                return null;
            }
        }

        /** -1 key click, -2 medium, -3 big explosion, >0 Display.vibrate(ms) of the game */
        @JavascriptInterface
        public void haptic(int ms) {
            vibrate(ms);
        }
    }

    private synchronized void writeSaves(String json) {
        File tmp = new File(getFilesDir(), "rms.json.tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (Exception ex) {
            Log.w(TAG, "save: " + ex);
            return;
        }
        if (!tmp.renameTo(saveFile)) Log.w(TAG, "save: rename failed");
    }

    @SuppressWarnings("deprecation")
    private void vibrate(int ms) {
        if (vibrator == null || !vibrator.hasVibrator()) return;
        long len; int amp;
        if (ms == -3) { len = 45; amp = 255; }
        else if (ms == -2) { len = 18; amp = 140; }
        else if (ms < 0) { len = 9; amp = 80; }
        else if (ms > 0) { len = Math.min(ms, 400); amp = 200; }
        else return;
        if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createOneShot(len, amp));
        else vibrator.vibrate(len);
    }
}
