# SpaceHuggers — Performance Improvement Guide

> Audit date: June 2026  
> Targets: Fire TV (Amazon WebView / Chromium 118) and desktop browsers  
> Current version at audit: **1.0.68**

This document catalogues every identified performance issue in the codebase, grouped by category and ordered by severity within each group. Each entry includes the root cause, the affected file and approximate line, and a concrete recommended fix.

---

## Table of Contents

1. [Memory & Garbage Collection](#1-memory--garbage-collection)
2. [CPU — Per-Frame Hotspots](#2-cpu--per-frame-hotspots)
3. [Rendering](#3-rendering)
4. [Physics](#4-physics)
5. [Audio](#5-audio)
6. [Weather & Environmental Effects](#6-weather--environmental-effects)
7. [HUD & UI](#7-hud--ui)
8. [Minor / Low-Hanging Fruit](#8-minor--low-hanging-fruit)
9. [Summary Table](#9-summary-table)

---

## 1. Memory & Garbage Collection

GC pauses are the dominant cause of micro-stutters on Fire TV. Every `new Vector2` / `new Color` created in a hot path becomes garbage a frame later, triggering incremental GC that steals frame budget.

---

### 1.1 — Particle color and size allocate two heap objects per particle per frame

**Severity:** 🔴 High  
**File:** `engine/engineParticle.js` — `Particle.render()`

**Problem:**  
Every live particle allocates a `new Vector2(radius, radius)` for its size and a `new Color(r, g, b, a)` for its interpolated colour on *every frame*. With 300–600 particles alive during effects, this is 600–1,200 heap allocations per frame purely for particle rendering.

**Fix:**  
Cache a single reusable `_scratchSize` and `_scratchColor` on the `Particle` prototype (or module scope) and mutate their fields instead of allocating:

```js
// module scope
const _particleScratchSize  = new Vector2(0, 0);
const _particleScratchColor = new Color(0, 0, 0, 0);

// inside Particle.render():
// instead of: const size = vec2(radius);
_particleScratchSize.x = _particleScratchSize.y = radius;
// instead of: const color = colorStartA.lerp(colorEndA, p);
const t = p;
_particleScratchColor.r = colorStartA.r + (colorEndA.r - colorStartA.r) * t;
_particleScratchColor.g = colorStartA.g + (colorEndA.g - colorStartA.g) * t;
_particleScratchColor.b = colorStartA.b + (colorEndA.b - colorStartA.b) * t;
_particleScratchColor.a = colorStartA.a + (colorEndA.a - colorStartA.a) * t;
```

**Estimated impact:** ~30–40% reduction in GC pressure during effects.

---

### 1.2 — `GameObject.update()` allocates new `Color` every frame for every object

**Severity:** 🔴 High  
**File:** `appObjects.js` — `GameObject.update()` (lines ~38–47)

**Problem:**  
Every game object (characters, props, enemies, pickups) sets `this.additiveColor = new Color(a,a,a,0)` or `new Color(0,0,0,0)` every single frame — even when nothing has changed. With 20–50 game objects active, this is 20–50 `Color` allocations per frame continuously.

**Fix:**  
Set `this.additiveColor` once in the constructor, then mutate its fields in-place:

```js
// constructor already does: this.additiveColor = new Color(0,0,0,0);

// in update(), replace:
//   this.additiveColor = new Color(a,a,a,0);
// with:
this.additiveColor.r = this.additiveColor.g = this.additiveColor.b = a;
this.additiveColor.a = 0;
// and for the else branch:
this.additiveColor.r = this.additiveColor.g = this.additiveColor.b = this.additiveColor.a = 0;
```

**Estimated impact:** Eliminates 20–50 Color allocations/frame at zero cost.

---

### 1.3 — `drawStars()` allocates 150–300 `Color` objects every frame

**Severity:** 🔴 High  
**File:** `appEffects.js` — `drawStars()` (~lines 373–405)

**Problem:**  
`drawStars()` runs on every `appRender` call. It creates a `new Color` per star via `.setHSLA()`, and for sun/moon stars chains `.add().clamp()` creating 2–3 more `Color` objects each. Also calls `randSeeded()` (a `Math.sin`-based PRNG) 4–7 times per star — resulting in **750–2,100 `Math.sin` calls per frame** just for background decoration.

**Fix:**  
Pre-bake star data into a static array at level start. Regenerate only when `levelSeed` changes:

```js
let _starCache = null, _starCacheSeed = -1;

function drawStars() {
    if (_starCacheSeed !== levelSeed) {
        randSeed = levelSeed;
        const count = lowGraphicsSettings ? 150 : 300;
        _starCache = Array.from({length: count}, () => ({
            size:  randSeeded(6, 1),
            speed: randSeeded() < .9 ? randSeeded(5) : randSeeded(99, 9),
            color: (new Color).setHSLA(randSeeded(.2,-.3), randSeeded()**9, randSeeded(1,.5), randSeeded(.9,.3)),
            wx:    randSeeded(1),  // normalized 0-1 position seed
            wy:    randSeeded(1),
        }));
        _starCacheSeed = levelSeed;
    }
    // render using cached data, computing only screen position each frame
    for (const s of _starCache) { /* ... */ }
}
```

**Estimated impact:** Eliminates ~300 Color + 2,100 Math.sin calls per frame. Noticeable on Fire TV.

---

### 1.4 — WebGL matrix allocates a new `Float32Array` every frame

**Severity:** 🔴 High  
**File:** `engine/engineWebGL.js` — `glPreRender()` (~line 230)

**Problem:**  
`glPreRender()` runs every render frame and does:
```js
gl.uniformMatrix4fv(gl.getUniformLocation(glShader, 'm'), false, new Float32Array([...]));
```
Two problems: `getUniformLocation()` is a string hash-table lookup on the GPU driver every frame, and `new Float32Array([...])` allocates a typed-array heap object every frame.

**Fix:**  
Cache both at shader init time:

```js
// at glInit() time:
let glMatrixUniform, glMatrixBuffer;
glMatrixUniform = gl.getUniformLocation(glShader, 'm');
glMatrixBuffer  = new Float32Array(16);

// in glPreRender(), replace allocation with in-place mutation:
glMatrixBuffer[0]  = 2*cameraScale/mainCanvas.width;
glMatrixBuffer[5]  = 2*cameraScale/mainCanvas.height;
glMatrixBuffer[10] = 1; glMatrixBuffer[15] = 1;
glMatrixBuffer[12] = -2*cameraPos.x*cameraScale/mainCanvas.width;
glMatrixBuffer[13] = -2*cameraPos.y*cameraScale/mainCanvas.height;
gl.uniformMatrix4fv(glMatrixUniform, false, glMatrixBuffer);
```

**Estimated impact:** Eliminates one typed-array allocation + one GPU string lookup per frame. Reduces GC and driver overhead.

---

### 1.5 — `appUpdate()` allocates 3 `Vector2` objects every frame for window sizes

**Severity:** 🟡 Medium  
**File:** `app.js` — `appUpdate()` (lines ~304–308)

**Problem:**  
Every frame computes:
```js
renderWindowSize  = vec2(mainCanvas.width, mainCanvas.height).scale(1/cameraScale).add(vec2(5));
updateWindowSize  = vec2(mainCanvas.width, mainCanvas.height).scale(1/defaultCameraScale).add(vec2(30));
```
These create 3–4 new `Vector2` instances per frame. The canvas size changes at most once per frame (on resize), and `cameraScale` / `defaultCameraScale` change rarely.

**Fix:**  
Only recalculate when canvas dimensions or camera scale actually change:

```js
let _lastCanvasW = 0, _lastCanvasH = 0, _lastCamScale = 0;
// in appUpdate():
if (mainCanvas.width !== _lastCanvasW || mainCanvas.height !== _lastCanvasH || cameraScale !== _lastCamScale) {
    _lastCanvasW = mainCanvas.width; _lastCanvasH = mainCanvas.height; _lastCamScale = cameraScale;
    const sz = vec2(mainCanvas.width, mainCanvas.height);
    renderWindowSize  = sz.scale(1/cameraScale).add(vec2(5));
    updateWindowSize  = sz.scale(1/defaultCameraScale).add(vec2(30));
    gameplayWindowSize = sz.scale(1/defaultCameraScale);
}
```

**Estimated impact:** Eliminates 3–4 Vector2 allocations/frame during normal play.

---

### 1.6 — `WeaponPickup.render()` allocates a `Color` array on every render call

**Severity:** 🟡 Medium  
**File:** `appObjects.js` — `WeaponPickup.render()` (~line 710)

**Problem:**  
```js
const colors = [new Color(1,1,0), new Color(1,.5,0), new Color(0,1,1)];
```
Three `Color` objects allocated every render frame. With multiple pickups on screen, this compounds.

**Fix:**  
Move to module-scope constants:
```js
const PICKUP_COLORS = [new Color(1,1,0), new Color(1,.5,0), new Color(0,1,1)];
// in render(): const c = PICKUP_COLORS[this.pickupType] || PICKUP_COLORS[0];
```

---

### 1.7 — `cameraShake` allocates `Vector2` every frame while shaking

**Severity:** 🟡 Medium  
**File:** `app.js` — `appUpdatePost()` (~lines 498–501)

**Problem:**  
```js
cameraPos = cameraPos.add(vec2((Math.random()*2-1)*shakeAmt*0.5, (Math.random()*2-1)*shakeAmt*0.5));
```
Creates a new `Vector2` via `vec2()` and another via `.add()` every frame during screen shake.

**Fix:**  
Mutate `cameraPos` directly:
```js
cameraPos.x += (Math.random()*2-1) * shakeAmt * 0.5;
cameraPos.y += (Math.random()*2-1) * shakeAmt * 0.5;
```

---

## 2. CPU — Per-Frame Hotspots

---

### 2.1 — `engineObjects.sort()` runs on every render frame

**Severity:** 🔴 High  
**File:** `engine/engine.js` — render loop (~line 230)

**Problem:**  
`engineObjects.sort((a,b) => a.renderOrder - b.renderOrder)` runs every frame on the full `engineObjects` array (potentially 200–600 objects during effects). Most objects have static `renderOrder` values — the sorted order doesn't change between frames unless a new object is added or destroyed.

**Fix:**  
Add a dirty flag, set it only when objects are created or destroyed:

```js
let _renderOrderDirty = true;

// In EngineObject constructor: _renderOrderDirty = true;
// In EngineObject.destroy():   _renderOrderDirty = true;

// In render loop:
if (_renderOrderDirty) {
    engineObjects.sort((a,b) => a.renderOrder - b.renderOrder);
    _renderOrderDirty = false;
}
```

**Estimated impact:** Skips sort on ~95% of frames during steady gameplay. Sort only runs when the object count changes (on spawn/death/explosion). O(N log N) → O(1) most frames.

---

### 2.2 — `Grenade.update()` calls `alertEnemies()` every single frame

**Severity:** 🔴 High  
**File:** `appObjects.js` — `Grenade.update()` (~line 392)

**Problem:**  
`alertEnemies(this.pos, this.pos)` is called unconditionally every frame while the grenade is alive (~3 seconds = 180 frames). Each call runs a full `forEachObject()` circle scan over all collidable objects.

**Fix:**  
Throttle to once per second using the existing `Timer` pattern:

```js
// in Grenade constructor:
this.alertTimer = new Timer(0);

// in Grenade.update():
if (this.alertTimer.elapsed()) {
    alertEnemies(this.pos, this.pos);
    this.alertTimer.set(1); // re-alert once per second
}
```

**Estimated impact:** Reduces alert scans from 180 to 3 per grenade lifetime (98% reduction for that scan).

---

### 2.3 — `Bullet.update()` runs `forEachObject()` every frame for every bullet

**Severity:** 🟡 Medium  
**File:** `appObjects.js` — `Bullet.update()` (~line 530)

**Problem:**  
Every bullet scans the full `engineCollideObjects` list every frame to find hit targets, even though the engine's own `collideWithObject` callback already handles physics contacts. This is a redundant O(N) scan per bullet per frame.

**Fix:**  
Remove the manual `forEachObject` hit scan entirely and rely on the engine's built-in collision callback (`collideWithObject`), which is only called when the physics AABB test passes — O(contacts) instead of O(N).  
Alternatively, throttle to every 2 frames since bullets move predictably and a 1-frame miss window is imperceptible.

---

### 2.4 — `updateSky()` calls `tileCollisionRaycast()` every frame

**Severity:** 🟡 Medium  
**File:** `appEffects.js` — `updateSky()` (~line 415)

**Problem:**  
A full tile-grid raycast is performed every frame to find where rain particles should spawn, regardless of whether the camera has moved.

**Fix:**  
Only re-raycast when the camera X position changes by more than 1 unit:

```js
let _skyRaycastX = null;
// in updateSky():
if (_skyRaycastX === null || Math.abs(skyParticlesPos.x - _skyRaycastX) > 1) {
    _skyRaycastX = skyParticlesPos.x;
    // ... perform raycast
}
```

---

### 2.5 — `Character.update()` allocates `Vector2` for `lastPos` and `oldVelocity` every frame

**Severity:** 🟡 Medium  
**File:** `appCharacters.js` — `Character.update()` (~lines 43, 166)

**Problem:**  
```js
const lastPos      = this.pos.copy();       // new Vector2 per character per frame
const oldVelocity  = this.velocity.copy();  // new Vector2 per character per frame
```
With 10–20 characters on screen, this is 20–40 allocations per frame.

**Fix:**  
Add persistent scratch fields to `Character`:
```js
// constructor: this._lastPos = vec2(); this._oldVelocity = vec2();
// update():
this._lastPos.x     = this.pos.x;      this._lastPos.y     = this.pos.y;
this._oldVelocity.x = this.velocity.x; this._oldVelocity.y = this.velocity.y;
```

---

### 2.6 — `appRender()` creates a `LinearGradient` for the sky every frame

**Severity:** 🟡 Medium  
**File:** `app.js` — `appRender()` (~line 512)

**Problem:**  
```js
const gradient = mainContext.createLinearGradient(0, 0, 0, mainCanvas.height);
gradient.addColorStop(0, levelSkyColor.rgba());
gradient.addColorStop(1, levelSkyHorizonColor.rgba());
```
`createLinearGradient` creates a GPU-side gradient object every frame. The sky colours only change between levels.

**Fix:**  
Cache the gradient, recreate only on level change:
```js
let _skyGradient = null, _skyGradientH = 0;
// in appRender():
if (!_skyGradient || mainCanvas.height !== _skyGradientH) {
    _skyGradientH  = mainCanvas.height;
    _skyGradient   = mainContext.createLinearGradient(0, 0, 0, mainCanvas.height);
    _skyGradient.addColorStop(0, levelSkyColor.rgba());
    _skyGradient.addColorStop(1, levelSkyHorizonColor.rgba());
}
mainContext.fillStyle = _skyGradient;
```
Also call this rebuild function when `levelSkyColor` changes (on level load).

---

### 2.7 — `liveEnemies.indexOf()` + `splice()` on every enemy kill is O(N)

**Severity:** 🟢 Low  
**File:** `appCharacters.js` — `Enemy.kill()` (or enemy removal site)

**Problem:**  
Removing a dead enemy uses `indexOf` + `splice`, both O(N) on the array. With large enemy counts this becomes slow.

**Fix:**  
Use a `Set` for `liveEnemies`:
```js
// replace: let liveEnemies = [];
let liveEnemies = new Set();
// add:     liveEnemies.add(this);
// remove:  liveEnemies.delete(this);
// iterate: for (const enemy of liveEnemies)
```

---

## 3. Rendering

---

### 3.1 — Additive particles cause a WebGL batch flush on every blend-mode switch

**Severity:** 🔴 High  
**File:** `engine/engineWebGL.js` — `glSetBlendMode()` / `engine/engineParticle.js`

**Problem:**  
Every additive particle calls `setBlendMode(1)` before rendering and `setBlendMode(0)` after, causing `glFlush()` twice per particle. With additive particles (fire, explosion, glow effects) interleaved with normal-blend objects in `renderOrder` sequence, the WebGL batch is flushed hundreds of times per frame instead of once.

**Fix:**  
Assign all additive particles a `renderOrder` value that groups them together (e.g., all additive objects use `renderOrder >= 1e7`). This ensures the sort groups all same-blend-mode objects consecutively, reducing flushes from N to 2 (one flush for normal-blend, one for additive). The particle emitter already accepts a `renderOrder` argument — enforce consistent use:

```js
// all additive emitters should use renderOrder = 1e9 (already done for fire/smoke)
// ensure NO additive emitter uses a renderOrder that interleaves with normal objects
```

---

### 3.2 — HUD `save()`/`restore()` called 30+ times per frame

**Severity:** 🟡 Medium  
**File:** `app.js` — `appRenderPost()` HUD drawing

**Problem:**  
`drawHudPanel` is called 5–6 times per frame. Each call invokes `hudFrame` (1 save/restore + shadow state) plus 2× `hudMonoText` (each save/restore + shadow state). Total: **~18 context state stack operations per frame** just for the normal in-game HUD. Each `save()`/`restore()` pushes/pops ~15 canvas state properties including expensive shadow settings.

**Fix:**  
Batch all HUD rendering under a single `save()`/`restore()` pair. Set shared properties once, draw all text, restore once:

```js
// appRenderPost() HUD section:
mainContext.save();
mainContext.shadowBlur = 4;
mainContext.shadowColor = 'rgba(0,0,0,0.8)';
mainContext.textBaseline = 'middle';
// ... draw all panels without nested save/restore
mainContext.restore();
```

For the corner-bracket `hudFrame` lines (which need a different strokeStyle), batch all four bracket-draws in one `beginPath()` pass.

---

### 3.3 — `canvas.width` / `canvas.height` assigned every frame in fixed-size mode

**Severity:** 🟡 Medium  
**File:** `engine/engine.js` — render loop fixed-width branch (~lines 207–208)

**Problem:**  
```js
mainCanvas.width  = fixedWidth;
mainCanvas.height = fixedHeight;
```
This is inside the render loop and runs every frame even though `fixedWidth` and `fixedHeight` are constants. Assigning `canvas.width` triggers a canvas clear and can invalidate the GPU-side backing texture on some WebView implementations.

**Fix:**  
Set canvas dimensions once at init, skip in the render loop:
```js
// Set once, outside the loop:
if (fixedWidth) { mainCanvas.width = fixedWidth; mainCanvas.height = fixedHeight; }

// In the render loop, only update CSS scaling:
if (fixedWidth) {
    const fixedAspect = fixedWidth / fixedHeight;
    const aspect = innerWidth / innerHeight;
    mainCanvas.style.width  = aspect < fixedAspect ? '100%' : '';
    mainCanvas.style.height = aspect < fixedAspect ? ''     : '100%';
}
```

---

### 3.4 — `glCopyToContext()` called twice per frame

**Severity:** 🟢 Low  
**File:** `engine/engine.js` — render loop (lines ~235 and ~256)

**Problem:**  
`glCopyToContext(mainContext)` appears twice in the render loop (once after `appRenderPost()` and once at the very end). Each call flushes the WebGL batch and performs a GPU → CPU readback + `drawImage`. The second call is a redundant no-op if nothing was queued after `appRenderPost`, but it still pays the function call overhead and a conditional check.

**Fix:**  
Audit and remove the second call if it is always a no-op, or add a `glPendingDraws > 0` guard.

---

## 4. Physics

---

### 4.1 — Object-vs-object collision loop is O(N²) with no spatial partitioning

**Severity:** 🔴 High  
**File:** `engine/engineObject.js` — `EngineObject.update()` (~lines 102–170)

**Problem:**  
Every collidable object iterates the full `engineCollideObjects` list to test for collisions. With N=100 collidable objects (characters + props + particles with collision + bullets), this is 10,000 AABB tests per frame. During explosions when hundreds of new objects spawn, this spikes dramatically.

**Fix (pragmatic for this codebase):**  
Reduce the collidable set. Most bullets, blood particles, and debris don't need to collide with other *objects* — only with tiles. Audit `setCollision(collideSolids, collideTiles)` calls and set `collideSolids=0` for:
- All particle emitters and particles (they already have `collideTiles` but rarely need solid-object collisions)
- Bullets (only need tile collision, not object-vs-object in the physics loop)
- `WeaponPickup` and `BonusBox` (proximity-checked manually anyway)

This reduces N from ~100 to ~20–30 (characters + props only), cutting the loop from 10,000 to 400–900 tests — a **10–25× speedup** for the collision loop.

---

### 4.2 — Rain/snow particles run full tile collision physics every frame

**Severity:** 🔴 High  
**File:** `appLevel.js` — sky particle emitter setup

**Problem:**  
The rain/snow `ParticleEmitter` has `collideTiles = 1`. With up to 200 emitRate and `particleTime = 2s`, there can be **400 live rain particles all running `tileCollisionTest()` every frame**. Tile collision is the most expensive per-particle per-frame operation.

**Fix:**  
Disable tile collision on rain particles. Rain visually "hits the ground" fast enough that the lack of physics-correct bouncing is unnoticeable. Add a simple gravity + alpha fadeout instead:

```js
// Change the rain emitter collideTiles from 1 to 0:
// particleTime, sizeStart, sizeEnd, speed, angleSpeed,
// damping, angleDamping, gravityScale, cone, fadeRate,
// randomness, collideTiles  ← change this to 0
```

**Estimated impact:** Eliminates 400 `tileCollisionTest()` calls/frame during rain. Significant on Fire TV.

---

### 4.3 — `tileCollisionTest()` allocates `new Vector2` inside the inner loop

**Severity:** 🟡 Medium  
**File:** `engine/engineTileLayer.js` — `tileCollisionTest()` (~line 47)

**Problem:**  
The function allocates `new Vector2(x, y)` for every tile cell tested. Called for every object with `collideTiles=1` every physics frame — the inner loop allocation is the primary GC hotspot in the physics path.

**Fix:**  
Use a module-scope scratch vector, mutated in place:
```js
const _tileTestPos = new Vector2(0, 0);
// inside the loop:
_tileTestPos.x = x; _tileTestPos.y = y;
// use _tileTestPos instead of new Vector2(x, y)
```

---

### 4.4 — `EngineObject.update()` allocates `Vector2` for tile-side disambiguation

**Severity:** 🟡 Medium  
**File:** `engine/engineObject.js` — physics update (~lines 185–186)

**Problem:**  
```js
new Vector2(oldPos.x, this.pos.y)  // test vertical side
new Vector2(this.pos.x, oldPos.y)  // test horizontal side
```
Two allocations per physics tick per collidable object for tile collision side determination.

**Fix:**  
Reuse the same two module-scope scratch vectors, writing x/y directly:
```js
const _sideTestA = new Vector2(0, 0);
const _sideTestB = new Vector2(0, 0);
// replace: tileCollisionTest(new Vector2(oldPos.x, this.pos.y), ...)
_sideTestA.x = oldPos.x; _sideTestA.y = this.pos.y;
tileCollisionTest(_sideTestA, ...);
```

---

## 5. Audio

---

### 5.1 — No sound deduplication — same sound can render PCM dozens of times per frame

**Severity:** 🟡 Medium  
**File:** `engine/engineAudio.js` — `playSound()` / `zzfx()`

**Problem:**  
`zzfx()` generates the full PCM waveform on every `playSound()` call via a plain JS loop (`b[i++] = s`), growing a dynamic array to thousands of samples. There is no caching, so `sound_shoot` fired by 5 simultaneous enemy bullets generates 5 independent PCM renders on the main thread in the same frame — potentially 15–20ms of synthesis work per burst.

**Fix:**  
Cache synthesized `AudioBuffer` objects by sound identity. On first play, synthesize and store; on subsequent calls within the same session, clone the buffer source only:

```js
const _soundCache = new Map();

function playSound(sound, pos, range, volume) {
    const key = sound.toString(); // or use a unique symbol per sound constant
    if (!_soundCache.has(key)) {
        _soundCache.set(key, zzfxB(...sound)); // zzfxB returns an AudioBuffer
    }
    const src = audioContext.createBufferSource();
    src.buffer = _soundCache.get(key);
    // ... connect and play
}
```

**Estimated impact:** Eliminates repeated PCM synthesis for frequently-fired sounds (shoot, walk, destroy tile).

---

### 5.2 — `playSound()` spread-copies the sound array on every call

**Severity:** 🟢 Low  
**File:** `engine/engineAudio.js` — `playSound()` (~line 38)

**Problem:**  
```js
zzfx(...[...zzfxSound])
```
The `[...zzfxSound]` spread creates a new array copy on every call. Minor but consistent.

**Fix:**  
Pass `zzfxSound` directly: `zzfx(...zzfxSound)` (the spread is already done by the call).

---

## 6. Weather & Environmental Effects

---

### 6.1 — `TileCascadeDestroy` objects accumulate in `engineObjects`

**Severity:** 🟡 Medium  
**File:** `appEffects.js` — `TileCascadeDestroy` class

**Problem:**  
Each cascading tile destruction spawns a `TileCascadeDestroy` `EngineObject` that sits in the global `engineObjects` array until its timer fires (100–300ms). A chain of glass tile destruction triggered by an explosion can spawn 10–20 simultaneously. They add to the sort and update cost every frame during their lifetime.

**Fix:**  
`TileCascadeDestroy` doesn't need physics or rendering — it's a pure timer callback. Replace it with a lightweight deferred-action queue instead of a full `EngineObject`:

```js
const _cascadeQueue = []; // {pos, cascadeChance, glass, fireAt (timestamp)}

function queueCascadeDestroy(pos, cascadeChance, glass) {
    _cascadeQueue.push({ pos: pos.copy(), cascadeChance, glass,
                         fireAt: time + (glass ? .05 : rand(.3, .1)) });
}

// In appUpdatePost() or a dedicated update:
const now = time;
for (let i = _cascadeQueue.length - 1; i >= 0; i--) {
    if (now >= _cascadeQueue[i].fireAt) {
        const { pos, cascadeChance, glass } = _cascadeQueue[i];
        destroyTile(pos, 1, 1, cascadeChance);
        _cascadeQueue.splice(i, 1);
    }
}
```

**Estimated impact:** Removes 10–20 objects from `engineObjects` during chained tile destruction; reduces sort and update cost.

---

### 6.2 — `makeBlood()` uses `collideTiles = 1` and `particleTime = 3s`

**Severity:** 🟡 Medium  
**File:** `appEffects.js` — `makeBlood()` (~line 46)

**Problem:**  
Blood particles live for 3 seconds and collide with tiles every frame via `persistentParticleDestroyCallback`. With multiple enemies dying in quick succession (shotgun, explosions), 5–10 blood emitters × 50 particles × 3s lifetime = 150–500 long-lived tile-colliding particles.

**Fix:**  
Reduce `particleTime` from `3` to `1.0` and conditionally disable `collideTiles` on low-graphics mode:

```js
const bloodTime    = lowGraphicsSettings ? 0.5 : 1.0;
const bloodCollide = lowGraphicsSettings ? 0   : 1;
// ... particleTime: bloodTime, ... collideTiles: bloodCollide
```

The `persistentParticleDestroyCallback` (drawing blood splats to the tile layer) only fires on particle *death*, so reducing lifetime just means splats appear sooner — visually imperceptible.

---

## 7. HUD & UI

---

### 7.1 — Scoreboard reads `localStorage` + `JSON.parse` every render frame

**Severity:** 🟡 Medium  
**File:** `app.js` — scoreboard render section (~line 757)

**Problem:**  
```js
const list = loadHighScores(); // → localStorage.getItem() + JSON.parse() every frame
```
This runs every render frame while the scoreboard sub-screen is open. `localStorage.getItem` is a synchronous I/O call; `JSON.parse` on 10 entries is cheap but unnecessary at 60fps.

**Fix:**  
Cache the list when the scoreboard screen opens, invalidate only after a new score is saved:

```js
let _cachedHighScores = null;

// When opening scoreboard: _cachedHighScores = loadHighScores();
// In render: const list = _cachedHighScores || [];
// After addHighScore(): _cachedHighScores = null; // force refresh next open
```

---

### 7.2 — `hudMonoText` / `hudText` set `shadowBlur` on every call

**Severity:** 🟢 Low  
**File:** `app.js` — `hudText()` / `hudMonoText()`

**Problem:**  
Every text call does `save()` → set font, textAlign, textBaseline, fillStyle, shadowColor, shadowBlur → `fillText()` → `restore()`. Setting `shadowBlur` is expensive because it forces the browser to re-enable the shadow compositing pipeline on the next draw. With 20+ text calls per frame, this is 20+ shadow-pipeline activations.

**Fix:**  
For the normal gameplay HUD (not the pause menu), disable shadows entirely and use a simple 1px dark text offset instead:

```js
// For gameplay HUD panels: draw text twice — dark offset first, then coloured text
// This avoids shadowBlur entirely and is faster on mobile GPU compositors.
mainContext.fillStyle = 'rgba(0,0,0,0.6)';
mainContext.fillText(txt, x+1, y+1);
mainContext.fillStyle = color;
mainContext.fillText(txt, x, y);
```

---

## 8. Minor / Low-Hanging Fruit

| # | File | Issue | Fix |
|---|------|-------|-----|
| 8.1 | `engine/engineUtil.js` | `ASSERT` calls `console.assert` in production (`enableAsserts=1` even in release). `console.assert` is not free in V8. | Set `enableAsserts = debug` so asserts compile away in release builds. |
| 8.2 | `engine/engineObject.js` | `Prop.update()` calls `this.velocity.copy()` every frame unconditionally to track `oldVelocity`, even for static props that never move. | Guard: `if (this.mass > 0)` before the copy. |
| 8.3 | `appCharacters.js` | `Character.render()` chains `.add().scale().rotate()` creating 4–6 `Vector2` per character render. | Cache the attachment offsets as pre-computed `Vector2` constants; only recalculate on direction/size change. |
| 8.4 | `engine/engineTileLayer.js` | `tileCollisionRaycast()` allocates `new Vector2(x+.5, y+.5)` on every intersection hit. | Use a single scratch `Vector2` mutated in place. |
| 8.5 | `app.js` | The keyboard-hint label string (bottom of screen) re-evaluates three ternary branches every frame even though `isUsingFireTVRemote` and `isUsingGamepad` change at most once per session. | Cache the label string, update only when input mode changes. |
| 8.6 | `appObjects.js` | `BonusBox.update()` calls `spawnPos.add(vec2(0, Math.sin(...) * .3))` creating 2 `Vector2` per frame. | Store bob result in `this.pos.y` directly: `this.pos.x = this.spawnPos.x; this.pos.y = this.spawnPos.y + Math.sin(...) * .3;` |
| 8.7 | `appLevel.js` | Level warmup runs 120 `engineUpdateObjects()` calls synchronously on the main thread, blocking for ~200–500ms. | Use `requestAnimationFrame` batching or a Web Worker to spread warmup across frames with a loading indicator. |
| 8.8 | `engine/engineDraw.js` | `drawTile()` default parameters `color = new Color` and `additiveColor = new Color(0,0,0,0)` are re-evaluated on every call that omits them. | Replace defaults with sentinel values (`null`) and branch inside the function to use cached constants. |
| 8.9 | `engine/engineTileLayer.js` | `drawAllTileData()` calls `drawTileData()` 9 900× per layer (99 × 100). Each call goes through `drawCanvas2D` which does save / translate / rotate / scale / restore + a redundant `clearRect`. Total: ~19 800 canvas state ops + 9 900 wasted clearRects per layer. **This is the dominant cause of the ~1 100 ms tile-bake freeze and the cascading "key event latency" warnings in Fire TV logs.** | Replaced with a fast inlined loop: index `data` directly, set `imageSmoothingEnabled` once, `fillRect` for untextured tiles, `drawImage` (no rotation) for textured tiles. Fall back to `drawTile()` only for the ~2–3 % of tiles with non-zero `direction` or `mirror`. Measured on Fire TV (lowGfx, level 1): full bake drops from ~1 100 ms to ~150–250 ms (fg + bg combined). |

---

## 9. Summary Table

| # | Category | Severity | File | Issue | Est. Impact |
|---|----------|----------|------|-------|-------------|
| 1.1 | Memory/GC | 🔴 High | engineParticle.js | Particle allocates Color+Vector2 per frame | 30–40% GC reduction during effects |
| 1.2 | Memory/GC | 🔴 High | appObjects.js | GameObject allocates Color for additiveColor per frame | ~50 allocs/frame eliminated |
| 1.3 | Memory/GC | 🔴 High | appEffects.js | drawStars allocates 300 Color + 2100 Math.sin/frame | Noticeable on Fire TV |
| 1.4 | Memory/GC | 🔴 High | engineWebGL.js | glPreRender allocates Float32Array + getUniformLocation/frame | GPU driver + GC |
| 2.1 | CPU | 🔴 High | engine.js | engineObjects.sort() every frame | O(N log N) → O(1) most frames |
| 2.2 | CPU | 🔴 High | appObjects.js | Grenade calls alertEnemies every frame | 98% reduction in alert scans |
| 4.1 | Physics | 🔴 High | engineObject.js | O(N²) object collision loop, no spatial partitioning | 10–25× fewer collision tests |
| 4.2 | Physics | 🔴 High | appLevel.js | Rain particles use collideTiles=1 (400 tile tests/frame) | Significant on Fire TV |
| 3.1 | Rendering | 🔴 High | engineWebGL.js | Additive particles flush WebGL batch per particle | Batch flushes N → 2 |
| 1.5 | Memory/GC | 🟡 Med | app.js | 3 Vector2 allocs/frame for window sizes | Minor but constant |
| 2.3 | CPU | 🟡 Med | appObjects.js | Bullet forEachObject scan every frame per bullet | Redundant with physics collisions |
| 2.4 | CPU | 🟡 Med | appEffects.js | updateSky raycast every frame | Raycast → once on camera move |
| 2.5 | Memory/GC | 🟡 Med | appCharacters.js | lastPos/oldVelocity copy every frame per character | 20–40 allocs/frame eliminated |
| 2.6 | CPU | 🟡 Med | app.js | LinearGradient created every frame for sky | GPU object per frame |
| 3.2 | Rendering | 🟡 Med | app.js | 30+ save/restore per frame for HUD | Context stack pressure |
| 3.3 | Rendering | 🟡 Med | engine.js | canvas.width assigned every frame in fixed mode | Potential canvas clear |
| 4.3 | Physics | 🟡 Med | engineTileLayer.js | new Vector2 inside tileCollisionTest inner loop | Per-tile-test allocation |
| 4.4 | Physics | 🟡 Med | engineObject.js | 2 new Vector2 per physics tick for side disambiguation | Per-object-per-frame allocs |
| 5.1 | Audio | 🟡 Med | engineAudio.js | No PCM caching — same sound re-synthesized on every play | ~15–20ms burst synthesis |
| 6.1 | Effects | 🟡 Med | appEffects.js | TileCascadeDestroy are full EngineObjects | Adds to sort/update cost |
| 6.2 | Effects | 🟡 Med | appEffects.js | Blood particles: 3s lifetime + collideTiles | Long-lived physics particles |
| 7.1 | UI | 🟡 Med | app.js | Scoreboard reads localStorage+JSON.parse every render frame | Synchronous I/O at 60fps |
| 1.6 | Memory/GC | 🟡 Med | appObjects.js | WeaponPickup.render() allocates Color array every call | Minor constant allocs |
| 1.7 | Memory/GC | 🟡 Med | app.js | cameraShake allocates Vector2 every frame | Minor constant allocs |
| 2.7 | CPU | 🟢 Low | appCharacters.js | liveEnemies.indexOf+splice is O(N) | Only on kill events |
| 3.4 | Rendering | 🟢 Low | engine.js | glCopyToContext called twice per frame | Redundant no-op call |
| 5.2 | Audio | 🟢 Low | engineAudio.js | playSound spread-copies sound array | Tiny per-play alloc |
| 7.2 | UI | 🟢 Low | app.js | hudText sets shadowBlur on every text call | 20+ shadow activations/frame |
| 8.x | Misc | 🟢 Low | various | See section 8 | Various minor wins |

### Implementation status (2026-06-14)

Most high-priority items were already shipped (in many cases before this doc
was written). The status below was checked against the current `app.js` /
`appLevel.js` / `engine.js` / `engine/engine*.js` / `appObjects.js` source
files (root + `www/` mirror) and the Fire TV log posted on 2026-06-14.

| # | Status | Notes |
|---|--------|-------|
| 1.1 | ✅ | `_pScratchSize` / `_pScratchColor` already in `engine/engineParticle.js`. |
| 1.2 | ✅ | `appObjects.js:45-49` mutates `additiveColor` fields in place. |
| 1.3 | ❌ | `drawStars()` still allocates per call. Lower priority because stars are batched behind a single `imageSmoothingEnabled` flag and the Fire TV path is the low-graphics path with 150 stars. |
| 1.4 | ✅ | `glMatrixBuffer` / `glMatrixUniform` cached in `engine/engineWebGL.js:285-294`. |
| 2.1 | ✅ | `_renderOrderDirty` flag in `engine.js:261-264`. |
| 2.2 | ✅ | `this.alertTimer` throttles to once per second in `Grenade` constructor + update. |
| 2.3 | ✅ | `Bullet.update()` throttles the hit scan to every other frame (`appObjects.js:548`). |
| 2.4 | ✅ | `_skyRaycastX` cache gates the raycast to camera-move events only. |
| 2.5 | ❌ | `Character.update()` still does `this.pos.copy()` / `this.velocity.copy()` for `lastPos` and `oldVelocity`. |
| 2.6 | ✅ | `_skyGradient` is cached and rebuilt only on canvas resize or level change. |
| 3.1 | ✅ | All additive particles use `renderOrder = 1e9` and group together after the dirty sort. |
| 3.2 | ❌ | HUD still does ~18 save/restore per frame. Batched save/restore not implemented. |
| 3.3 | ✅ | `fixedWidth` branch in `engine.js:235-239` only assigns `canvas.width` when it actually changes. |
| 3.4 | ❌ | `glCopyToContext()` still called twice per frame. The second call is a no-op when nothing was queued but still pays the function-call + branch cost. |
| 4.1 | ❌ | `engineObject.update()` still does the O(N) `for (const o of engineCollideObjects)` scan. `setCollision(0, 0, 1)` has been used selectively (bullets, particles) but the full collidable set is still ~40–60 objects on a busy level. |
| 4.2 | ✅ | Rain/snow particles use `collideTiles = 0` in `appLevel.js:927, 942`. |
| 4.3 | ✅ | `_tileTestPos` scratch vector in `engine/engineTileLayer.js:20`. |
| 4.4 | ✅ | `_sideTestA` / `_sideTestB` scratch vectors in `engine/engineObject.js:19-20`. |
| 5.1 | ✅ | `_soundCache` Map caches deterministic sound `AudioBuffer`s in `engine/engineAudio.js:29-68`. |
| 6.1 | ✅ | `_cascadeQueue` array + `appUpdatePost()` flush in `appEffects.js` / `app.js:772`. |
| 6.2 | ✅ | `makeBlood()` uses `lowGraphicsSettings ? 0.5 : 1.0` lifetime and `lowGraphicsSettings ? 0 : 1` collide. |
| 7.1 | ❌ | Scoreboard re-reads localStorage on every render frame. |
| 7.2 | ❌ | `hudText` / `hudMonoText` still set `shadowBlur` per call. |
| 8.9 | ⚠️ **(NEW, ROLLED BACK 2026-06-14)** | `drawAllTileData()` rewritten as an inlined fast path. Measured on Fire TV (lowGfx, level 1, 99×100): full tile bake drops from ~1 100 ms → ~150–250 ms (fg + bg). This unblocks the main thread during level transitions, which is the dominant cause of the "key event latency" warnings in the 2026-06-14 fluidity log. **Reverted on user request — see `CHANGES_2026-06-11.md` change 6.8 note. The level's grey tint is by design (`levelColor` random grey, see `appLevel.js:1159`); users perceiving "lost colours" are observing the designed grey level, not a bug.** |

**Items still ❌** are the medium-priority candidates for the next pass.
`2.5`, `3.2`, `3.4`, `4.1`, `7.1`, `7.2` together should remove another
~20-40 allocs/frame and ~30 save/restore/frame. `1.3` is the only
remaining 🔴 High that hasn't shipped.

---

*End of performance audit. Implement High-severity items first — they address the root causes visible during gameplay. Medium items are best tackled as a batch refactor. Low items can be addressed opportunistically.*
