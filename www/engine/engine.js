/*
    LittleJS - The Little JavaScript Game Engine That Can - By Frank Force 2021

    Engine Features
    - Engine and debug system are separate from game code
    - Object oriented with base class engine object
    - Engine handles core update loop
    - Base class object handles update, physics, collision, rendering, etc
    - Engine helper classes and functions like Vector2, Color, and Timer
    - Super fast rendering system for tile sheets
    - Sound effects audio with zzfx and music with zzfxm
    - Input processing system with gamepad and touchscreen support
    - Tile layer rendering and collision system
    - Particle effect system
    - Automatically calls appInit(), appUpdate(), appUpdatePost(), appRender(), appRenderPost()
    - Debug tools and debug rendering system
    - Call engineInit() to start it up!
*/

'use strict';

///////////////////////////////////////////////////////////////////////////////
// engine config

const engineName = 'LittleJS';
const engineVersion = 'v0.74';
const FPS = 60, timeDelta = 1/FPS;
const defaultFont = 'arial'; // font used for text rendering
const maxWidth = 1920, maxHeight = 1200; // up to 1080p and 16:10 (used only when fixedWidth=0)
// Fire TV port: lock to 1920x1080 with built-in letterbox CSS in engineFrame()
//const fixedWidth = 0; // native resolution
//const fixedWidth = 1280, fixedHeight = 720; // 720p
//const fixedWidth = 128,  fixedHeight = 128; // PICO-8
//const fixedWidth = 240,  fixedHeight = 136; // TIC-80
// Fire TV port: 720p internal resolution, upscaled via CSS to the 1080p display.
// 1280x720 = 2.25x fewer pixels than 1920x1080 — significantly faster, especially
// with the Canvas2D fallback path that some Fire TV WebViews need.
const fixedWidth = 1280, fixedHeight = 720; // 720p internal, 1080p display via CSS scale

// tile sheet settings
//const defaultTilesFilename = 'a.png'; // everything goes in one tile sheet
const defaultTileSize = vec2(16); // default size of tiles in pixels
const tileBleedShrinkFix = .3;    // prevent tile bleeding from neighbors
const pixelated = 1;              // use crisp pixels for pixel art

///////////////////////////////////////////////////////////////////////////////
// core engine

const gravity = -.01;
let mainCanvas=0, mainContext=0, mainCanvasSize=vec2();
let engineObjects=[], engineCollideObjects=[];
var _renderOrderDirty = 1; // set to 1 whenever renderOrder changes; cleared after sort
let frame=0, time=0, realTime=0, paused=0, frameTimeLastMS=0, frameTimeBufferMS=0, debugFPS=0;

// Fire TV Media-Remote state (set by keydown listener, consumed by app code)
let tapFireRequested = 0;
const consumeTapFire = ()=> { const v = tapFireRequested; tapFireRequested = 0; return v; };
const togglePause    = ()=> { paused = !paused; if (paused) clearInput(); };
let cameraPos=vec2(), cameraScale=4*max(defaultTileSize.x, defaultTileSize.y);
let tileImageSize, tileImageSizeInverse, shrinkTilesX, shrinkTilesY, drawCount;
let glContextLost = 0;     // set when the WebGL context is lost, cleared on restore
let glContextLostTime = 0; // timestamp (ms) when context was lost, for unrecoverable-reset timeout

const tileImage = new Image(); // the tile image used by everything
function engineInit(appInit, appUpdate, appUpdatePost, appRender, appRenderPost)
{
    // init engine when tiles load
    tileImage.onload = ()=>
    {
        // save tile image info
        tileImageSizeInverse = vec2(1).divide(tileImageSize = vec2(tileImage.width, tileImage.height));
        debug && (tileImage.onload=()=>ASSERT(1)); // tile sheet can not reloaded
        shrinkTilesX = tileBleedShrinkFix/tileImageSize.x;
        shrinkTilesY = tileBleedShrinkFix/tileImageSize.y;

        // setup html
        document.body.appendChild(mainCanvas = document.createElement('canvas'));
        document.body.style = 'margin:0;overflow:hidden;background:#000';
        mainCanvas.style = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);image-rendering:crisp-edges;image-rendering:pixelated';          // pixelated rendering
        mainContext = mainCanvas.getContext('2d');

        // TEMP DEBUG: confirms the engine JS is running on the device. If
        // you don't see this in adb logcat, the WebView isn't executing
        // www/app.js at all (different problem — likely APK stale or
        // WebGL init failure). Remove once media keys are confirmed.
        console.log('[firetv-boot] engine init, webGL=' + (glEnable ? 1 : 0) + ', lowGraphics=' + (lowGraphicsSettings ? 1 : 0) + ', hasChrome=' + (!!window['chrome'] ? 1 : 0));

        // Global JS error trap — logs uncaught exceptions to adb logcat before
        // the renderer process dies. Without this, renderer crashes produce no
        // JS-level evidence in the log, only the aw_browser_terminator entry.
        window.onerror = (msg, src, line, col, err) =>
        {
            console.error('[firetv-jserr] ' + msg + ' @ ' + src + ':' + line + ':' + col
                + (err && err.stack ? '\n' + err.stack : ''));
            return false; // don't suppress default handling
        };
        window.onunhandledrejection = (e) =>
        {
            console.error('[firetv-jserr] unhandledrejection: ' + (e.reason || e));
        };

        debugInit();
        // Fire TV: WebGL GPU-process crashes on some devices. If glInit
        // throws, the engine disables itself and falls back to Canvas2D.
        try { glInit(); }
        catch (e)
        {
            console.warn('WebGL init failed, falling back to Canvas2D:', e);
            glDisable();
        }
        appInit();

        // Fire TV / mobile: pause when the WebView is backgrounded or
        // loses visibility, and resume when foregrounded.
        // (use addEventListener rather than setting onvisibilitychange directly,
        // which throws ReferenceError in some WebViews.)
        document.addEventListener('visibilitychange', ()=> paused = document.hidden, false);
        window.onblur  = ()=> paused = 1;
        window.onfocus = ()=> paused = 0;

        // Fire TV Media Remote: Play/Pause (179) toggles the pause overlay,
        // OK / Enter (13) requests a single tap-fire for player 0.
        // Capture-phase listener so it runs before the engine's normal
        // keydown handler in engineInput.js.
        window.addEventListener('keydown', (e)=>
        {
            if (e.keyCode === 179 || e.keyCode === 80) // 179=Fire TV Play/Pause, 80=P
            {
                e.preventDefault();
                togglePause();
            }
            else if (e.keyCode === 13)
            {
                e.preventDefault();
                tapFireRequested = 1;
            }
        }, true);

        engineUpdate();
    };

    // main update loop
    const engineUpdate = (frameTimeMS=0)=>
    {
        requestAnimationFrame(engineUpdate);
        
        if (!document.hasFocus())
            inputData[0].length = 0; // clear input when lost focus

        // prepare to update time
        const realFrameTimeDeltaMS = frameTimeMS - frameTimeLastMS;
        let frameTimeDeltaMS = realFrameTimeDeltaMS;
        frameTimeLastMS = frameTimeMS;
        realTime = frameTimeMS / 1e3;
        if (debug)
            frameTimeDeltaMS *= keyIsDown(107) ? 5 : keyIsDown(109) ? .2 : 1;
        if (!paused)
            frameTimeBufferMS += frameTimeDeltaMS;

        // skip the game update while WebGL context is lost so we don't
        // keep allocating textures the GPU can't accept.
        if (glContextLost)
        {
            // Fire TV: GL_UNKNOWN_CONTEXT_RESET_KHR (GPU robustness reset) kills
            // the GPU process and never fires webglcontextrestored. After 2 seconds
            // with no restore, treat the context as unrecoverable and permanently
            // fall back to Canvas2D so the game keeps running.
            if (performance.now() - glContextLostTime > 2000)
            {
                console.warn('[firetv] WebGL context unrecoverable, falling back to Canvas2D');
                glDisable();
                glContextLost = 0;
                glContextLostTime = 0;
                // The TileLayer canvases were baked while the GL context was dying and
                // may be blank/garbage. Now that glEnable=0, redraw() uses Canvas2D.
                // Defer 500ms so the GPU driver finishes tearing down the lost EGL
                // context before Canvas2D allocates new GPU-backed canvas textures —
                // calling redraw() immediately triggers a second GL_OUT_OF_MEMORY burst
                // as Skia tries to upload the (still too large) canvas to the GPU.
                setTimeout(() => {
                    if (typeof tileLayer !== 'undefined' && tileLayer && !tileLayer.destroyed)
                        tileLayer.redraw();
                    if (typeof tileBackgroundLayer !== 'undefined' && tileBackgroundLayer && !tileBackgroundLayer.destroyed)
                        tileBackgroundLayer.redraw();
                }, 500);
            }
            else
            {
                mainContext.fillStyle = '#000';
                mainContext.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
                return;
            }
        }

        // update frame
        mousePosWorld = screenToWorld(mousePosScreen);
        updateGamepads();

        // apply time delta smoothing, improves smoothness of framerate in some browsers
        let deltaSmooth = 0;
        if (frameTimeBufferMS < 0 && frameTimeBufferMS > -9)
        {
            // force an update each frame if time is close enough (not just a fast refresh rate)
            deltaSmooth = frameTimeBufferMS;
            frameTimeBufferMS = 0;
            //debug && frameTimeBufferMS < 0 && console.log('time smoothing: ' + -deltaSmooth);
        }
        //debug && frameTimeBufferMS < 0 && console.log('skipped frame! ' + -frameTimeBufferMS);

        // clamp incase of extra long frames (slow framerate)
        frameTimeBufferMS = min(frameTimeBufferMS, 50);
        
        // update the frame
        for (;frameTimeBufferMS >= 0; frameTimeBufferMS -= 1e3 / FPS)
        {
            // main frame update
            appUpdate();
            engineUpdateObjects();
            appUpdatePost();
            debugUpdate();

            // update input
            for(let deviceInputData of inputData)
                deviceInputData.map(k=> k.r = k.p = 0);
            mouseWheel = 0;
        }

        // add the smoothing back in
        frameTimeBufferMS += deltaSmooth;

        if (fixedWidth)
        {
            // Only assign when dimensions actually change — assigning canvas.width
            // clears the canvas and can invalidate the GPU backing texture on WebView.
            if (mainCanvas.width !== fixedWidth || mainCanvas.height !== fixedHeight)
            {
                mainCanvas.width  = fixedWidth;
                mainCanvas.height = fixedHeight;
            }

            // fit to window width if smaller
            const fixedAspect = fixedWidth / fixedHeight;
            const aspect = innerWidth / innerHeight;
            mainCanvas.style.width = aspect < fixedAspect ? '100%' : '';
            mainCanvas.style.height = aspect < fixedAspect ? '' : '100%';
        }
        else
        {
            // fill the window
            mainCanvas.width = min(innerWidth, maxWidth);
            mainCanvas.height = min(innerHeight, maxHeight);
        }

        // save canvas size
        mainCanvasSize = vec2(mainCanvas.width, mainCanvas.height);
        mainContext.imageSmoothingEnabled = !pixelated; // disable smoothing for pixel art

        // render sort then render while removing destroyed objects
        glPreRender(mainCanvas.width, mainCanvas.height);
        appRender();
        if (_renderOrderDirty) {
            engineObjects.sort((a,b)=> a.renderOrder - b.renderOrder);
            _renderOrderDirty = 0;
        }
        for(const o of engineObjects)
            o.destroyed || o.render();
        glCopyToContext(mainContext);
        appRenderPost();
        debugRender();

        if (showWatermark)
        {
            // update fps
            debugFPS = lerp(.05, 1e3/(realFrameTimeDeltaMS||1), debugFPS);
            mainContext.textAlign = 'right';
            mainContext.textBaseline = 'top';
            mainContext.font = '1em monospace';
            mainContext.fillStyle = '#000';
            const text = engineName + ' ' + engineVersion + ' / ' 
                + drawCount + ' / ' + engineObjects.length + ' / ' + debugFPS.toFixed(1);
            mainContext.fillText(text, mainCanvas.width-3, 3);
            mainContext.fillStyle = '#fff';
            mainContext.fillText(text, mainCanvas.width-2,2);
            drawCount = 0;
        }

        // copy anything left in the buffer if necessary
        glCopyToContext(mainContext);
    }

    //tileImage.src = 'tiles.png';
    tileImage.src = 
`data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAABABAMAAAAg+GJMAAAAJ1BMVEUAAAD///+AgID/AAAAAACJT6T/dwBIG11mlD2i91azs7PZ2dlAQEA9UPniAAAAAXRSTlMAQObYZgAAAoRJREFUeNqsk8dZw0AQhWfNiHDbARfgVAB0sNI3LTgcfSLcbasC0o0j6panHIYMT+FX+p8y/UdECJnNJlTn6PJnft4wEvHFasCkis2JakItl9dpemjZxgniywInnhX2hWAxXug0NIwKcduwjRTpF8hVLp7PJDSEuE5X24ofFZAQV7cAEZtDQ4jLJcSKgzuAXD8DDuVDdGOFmWjNaPN0v1zdPtU0BTSIi8cQY60ZPWcQ715r2oIzeqFupBQbZqVY0xY8PT1RN6zIh7QP8TTL+lcwmiE1megkRagif1DgvB8WsAILbQpYgZ2aD8kWsGLMUSybdfMpm1tgDRiJzfr7P5MteGufDpXchoE4jGcKj32C2oBKsM5jlPUlT4VKyN9TdFuSwKsfqrLHTcE5ucQgKL8H+GZW2n0YZptZKUXSXhIUic4nfa4OXrPPNmXTxI8BwzCBFcP6DjGxfwFmmwIwBv548/sccBJqPGRK10uYu5YCtRkD/r3xc8AEELDOk6ZAn3OHXR7h19D8OAckE3ukFiAkyb7V+lPXAqecd/8DYCSAkAGK+r37W3fhDZYCQqg4ICS/HKjNQsACbuYYRHLmHLh1BFfRHikKevd0dwATAQzTW3Dv7n8DKCrsZSF51wLh2hssfCOGQTLoegvZrn/j0iIlVEyKLSDjk0VaWGVjZERCQpHLqwywcEzIlbCChLArx1SbpQBgjITB5+f88l6bw+tLnbzW2eZWJQGEOMwKk3hz4JQnuy8FIH4tw+T2QNkNzSmeA0eA7T0BgFMc8mQox9qsCiQIY+AwDO/bNSOk4zaMIxxyvi8AMAW2xwcH1o+w/hHXf+P6RVq/yo86pjXn/PT09LTsL3dlHSBbTLmdAAAAAElFTkSuQmCC`;
}

function engineUpdateObjects()
{
    // recursive object update
    const updateObject = (o)=>
    {
        if (!o.destroyed)
        {
            o.update();
            for(const child of o.children)
                updateObject(child);
        }
    }
    for(const o of engineObjects)
        o.parent || updateObject(o);
    // In-place removal — avoids allocating a new array every frame (60x/sec GC pressure).
    let _j = 0;
    for (let _i = 0; _i < engineObjects.length; _i++)
        if (!engineObjects[_i].destroyed) engineObjects[_j++] = engineObjects[_i];
    engineObjects.length = _j;
    _j = 0;
    for (let _i = 0; _i < engineCollideObjects.length; _i++)
        if (!engineCollideObjects[_i].destroyed) engineCollideObjects[_j++] = engineCollideObjects[_i];
    engineCollideObjects.length = _j;
    time = ++frame / FPS;
}

function forEachObject(pos, size=0, callbackFunction=(o)=>1, collideObjectsOnly=1)
{
    const objectList = collideObjectsOnly ? engineCollideObjects : engineObjects;
    if (!size)
    {
        // no overlap test
        for (const o of objectList)
            callbackFunction(o);
    }
    else if (size.x != undefined)
    {
        // aabb test
        for (const o of objectList)
            isOverlapping(pos, size, o.pos, o.size) && callbackFunction(o);
    }
    else
    {
        // circle test
        const sizeSquared = size**2;
        for (const o of objectList)
            pos.distanceSquared(o.pos) < sizeSquared && callbackFunction(o);
    }
}