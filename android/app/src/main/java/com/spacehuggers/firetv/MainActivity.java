package com.spacehuggers.firetv;

import android.view.KeyEvent;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * MainActivity with a media-key shim.
 *
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
 */
public class MainActivity extends BridgeActivity
{
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
