package com.spacehuggers.firetv;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.KeyEvent;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/**
 * MainActivity with a media-key shim and renderer-crash recovery.
 *
 * --- Media key shim ---
 * The Amazon WebView (Chromium-derived) consumes the Fire TV remote's
 * FastForward / Rewind / Stop / Play-Pause buttons via its internal
 * MediaSession pipeline before any keydown event reaches the JS layer.
 * That means the JS code in www/ never sees them, so the in-game remap
 * table in engine/engineInput.js can't translate them.
 *
 * The fix is to synthesize real DOM KeyboardEvents via evaluateJavascript()
 * rather than re-dispatching a native KeyEvent. dispatchKeyEvent() still
 * routes through the WebView's internal MediaSession handler on Amazon's
 * Chromium fork, so the JS onkeydown listener never fires. Injecting the
 * event directly via JS bypasses that pipeline entirely.
 *
 * We also override onKeyUp so the engine's keyWasPressed flag works
 * correctly (it requires both a keydown and a keyup to register a press).
 *
 * Forwarded keycodes (Android KeyEvent constants → JS keyCode):
 *   KEYCODE_MEDIA_REWIND       (89)  → 89
 *   KEYCODE_MEDIA_FAST_FORWARD (90)  → 90
 *   KEYCODE_MEDIA_STOP         (86)  → 86
 *   KEYCODE_MEDIA_PLAY_PAUSE   (102) → 102
 *
 * Returning true from onKeyDown/onKeyUp tells Android we consumed the
 * event, so the system MediaSession handler never sees it.
 *
 * --- Renderer crash / white screen recovery ---
 * When the sandboxed GPU/renderer process is killed by the OS (OOM or
 * GL_UNKNOWN_CONTEXT_RESET_KHR), Android WebView fires onRenderProcessGone().
 * Without overriding it the default behaviour crashes the Activity, and the
 * user sees a white screen until the launcher restarts the app.
 *
 * We subclass BridgeWebViewClient (instead of the raw WebViewClient) so that
 * Capacitor's URL-interception, JS-bridge injection, and plugin listener
 * chain all remain intact. We then override only the three methods we need
 * (onPageStarted, onPageFinished, onRenderProcessGone) and always call
 * super so the bridge keeps functioning correctly.
 *
 * The overlay strategy:
 *  1. Keep the Activity alive.
 *  2. Show a black overlay View during the reload so the user never sees
 *     white while the new renderer process starts and the page reloads.
 *  3. Remove the overlay once the page has finished loading.
 *
 * We also set the WebView background to transparent/black programmatically
 * in onCreate() because XML layout attributes (android:background) are
 * reset when the GPU surface is destroyed and recreated.
 */
public class MainActivity extends BridgeActivity
{
    /** Black overlay shown during WebView reload after a renderer crash. */
    private View reloadOverlay;

    @Override
    protected void onCreate(Bundle savedInstanceState)
    {
        super.onCreate(savedInstanceState);

        // Set the Activity window background to black so any gap between
        // the splash screen, the WebView first paint, and renderer restarts
        // shows black rather than the system default white.
        getWindow().getDecorView().setBackgroundColor(Color.BLACK);

        // Apply programmatically — XML android:background is not reliable
        // after a GPU surface reset (renderer process crash + restart).
        WebView webView = (bridge != null) ? bridge.getWebView() : null;
        if (webView != null)
        {
            webView.setBackgroundColor(Color.BLACK);

            // Install a subclass of BridgeWebViewClient so Capacitor's
            // URL-interception and JS-bridge injection chain stays intact.
            // We only add overlay management on top.
            webView.setWebViewClient(new BridgeWebViewClient(bridge)
            {
                @Override
                public void onPageStarted(WebView view, String url,
                        android.graphics.Bitmap favicon)
                {
                    // Show the black overlay while the page is reloading so
                    // the user never sees the white blank WebView surface.
                    if (reloadOverlay != null)
                        reloadOverlay.setVisibility(View.VISIBLE);
                    super.onPageStarted(view, url, favicon);
                }

                @Override
                public void onPageFinished(WebView view, String url)
                {
                    super.onPageFinished(view, url);
                    // Re-apply black background after each page load — the
                    // renderer recreates the surface on reload and can reset it.
                    view.setBackgroundColor(Color.BLACK);
                    // Hide the overlay now that content is painted.
                    if (reloadOverlay != null)
                        reloadOverlay.setVisibility(View.GONE);
                }

                @Override
                public boolean onRenderProcessGone(WebView view,
                        RenderProcessGoneDetail detail)
                {
                    // The sandboxed renderer process died (OOM or GPU reset).
                    // Show the black overlay immediately so the user sees black
                    // instead of white while we reload.
                    if (reloadOverlay != null)
                        reloadOverlay.setVisibility(View.VISIBLE);

                    // Let the bridge handle its own listener chain first.
                    // BridgeWebViewClient.onRenderProcessGone calls super and
                    // notifies registered listeners, but returns false by
                    // default (meaning "crash the Activity"). We ignore its
                    // return value and handle the crash ourselves below.
                    super.onRenderProcessGone(view, detail);

                    // Reload the page — this starts a fresh renderer process.
                    // onPageFinished will hide the overlay once content is ready.
                    view.reload();

                    // Return true = we handled it; Activity stays alive.
                    return true;
                }
            });
        }

        // Create the black overlay and add it on top of everything.
        // It starts GONE so it doesn't cover the normal first load.
        reloadOverlay = new View(this);
        reloadOverlay.setBackgroundColor(Color.BLACK);
        reloadOverlay.setVisibility(View.GONE);
        addContentView(reloadOverlay,
            new android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** Inject a DOM KeyboardEvent into the JS layer for a media key. */
    private void injectKeyEvent(int keyCode, boolean isDown)
    {
        WebView webView = this.bridge != null ? this.bridge.getWebView() : null;
        if (webView == null) return;

        // Build a minimal KeyboardEvent init. We pass the raw Android keyCode
        // as the JS keyCode so the existing remapFireTV() table in
        // engineInput.js can translate it to the correct game action.
        final String type    = isDown ? "keydown" : "keyup";
        final String js =
            "(function(){" +
            "  var e = new KeyboardEvent('" + type + "', {" +
            "    bubbles: true, cancelable: true, keyCode: " + keyCode + "," +
            "    which: " + keyCode +
            "  });" +
            "  Object.defineProperty(e,'keyCode',{get:function(){return " + keyCode + ";},configurable:true});" +
            "  document.dispatchEvent(e);" +
            "})();";

        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event)
    {
        if (keyCode == KeyEvent.KEYCODE_MEDIA_REWIND
         || keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD
         || keyCode == KeyEvent.KEYCODE_MEDIA_STOP
         || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
        {
            injectKeyEvent(keyCode, true);
            return true; // consumed — prevent system MediaSession from handling
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event)
    {
        if (keyCode == KeyEvent.KEYCODE_MEDIA_REWIND
         || keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD
         || keyCode == KeyEvent.KEYCODE_MEDIA_STOP
         || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
        {
            injectKeyEvent(keyCode, false);
            return true; // consumed
        }
        return super.onKeyUp(keyCode, event);
    }
}
