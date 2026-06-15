/*
    Javascript Space Game
    By Frank Force 2021

*/

'use strict';

// Polyfill CanvasRenderingContext2D.roundRect for Fire TV WebView / Chromium < 99.
// Without this, every pause sub-screen (Achievements, Stats, Scoreboard, About)
// throws "TypeError: mainContext.roundRect is not a function" and crashes.
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
        const radius = Math.min(typeof r === 'number' ? r : (Array.isArray(r) ? r[0] : 0), w / 2, h / 2);
        this.moveTo(x + radius, y);
        this.lineTo(x + w - radius, y);
        this.arcTo(x + w, y,     x + w, y + radius,     radius);
        this.lineTo(x + w, y + h - radius);
        this.arcTo(x + w, y + h, x + w - radius, y + h, radius);
        this.lineTo(x + radius, y + h);
        this.arcTo(x,     y + h, x,     y + h - radius, radius);
        this.lineTo(x, y + radius);
        this.arcTo(x,     y,     x + radius, y,          radius);
        this.closePath();
        return this;
    };
}

const clampCamera = !debug;
// Fire TV / Android WebView: window.chrome is truthy in Chromium-based WebViews
// (same as desktop Chrome), so !window['chrome'] is always false there and
// lowGraphicsSettings would wrongly be false — causing expensive canvas shadowBlur
// on every HUD text call → GPU memory pressure → WebGL context loss.
// Detect Android WebView explicitly via the user-agent ('wv' token or 'Android')
// so Fire TV gets lowGraphicsSettings=true and all shadowBlur is suppressed.
const _isAndroidWebView = /Android/.test(navigator.userAgent);
const lowGraphicsSettings = glOverlay = _isAndroidWebView || !window['chrome'];
// Camera scale: 18px per world unit on start, 16px default — 2x zoom-out
// Zoom: 2x from the zoomed-out 18/16 values — restores original 36/32 scale.
const startCameraScale = 2*18;
const defaultCameraScale = 2*16;
const maxPlayers = 4;

const team_none = 0;
const team_player = 1;
const team_enemy = 2;
const APP_VERSION = '1.0.121';

let updateWindowSize, renderWindowSize, gameplayWindowSize;
let minDeadTime = 0;
let cameraShake = 0;
let pauseMenuOption  = 0;     // 0=Resume 1=Music 2=Restart 3=About
let pauseAboutScreen = false; // shows about overlay within pause

// IMPROVEMENT 1.1: "area clear" gate — BonusBox only ends the level after
// all enemies are dead. Set in appRenderPost once per frame, read by
// BonusBox.collideWithObject to decide whether the box is "armed".
let areaClear = 0;

// IMPROVEMENT 1.2: secondary objective types. HUNT is the default
// (clear all enemies, then break the box — the areaClear flag). SURVIVE
// keeps the box locked until the survival timer expires. COLLECT locks
// the box until 3 stashes are gathered. Each level picks one.
const OBJECTIVE_HUNT    = 0;  // areaClear = no enemies left
const OBJECTIVE_SURVIVE = 1;  // areaClear = survive timer elapsed
const OBJECTIVE_COLLECT = 2;  // areaClear = all stashes collected
let objectiveType = OBJECTIVE_HUNT;
let surviveTimer = 0;          // counts down while playing
let surviveGoal  = 30;          // seconds to survive
let stashesRequired = 3;        // number of stashes to collect
let stashesCollected = 0;

// IMPROVEMENT 1.3: a reference to the live BonusBox so we can draw an
// off-screen direction arrow at the screen edge. Set by BonusBox on
// creation, cleared on destroy.
let bonusBoxRef = null;

// IMPROVEMENT 2.2: 2-frame hit-pause. When > 0, appUpdate short-circuits so
// the world "freezes" briefly after the player takes damage. The engine's
// physics tick still runs but per-frame input is skipped, giving the
// classic "ouch" beat.
let hitPauseFrames = 0;

// IMPROVEMENT 2.3: friendly name of whatever killed the player on the
// current life. Set in Player.damage when a lethal hit lands, read by
// the GAME OVER panel.
let lastKillerName = '';

// IMPROVEMENT 4.2: per-level personal best time, stored in localStorage
// keyed by level number. On level clear, beats the saved best → flash
// "NEW BEST" indicator and persist the new record.
const LB_KEY = 'spacehuggers.levelbests';
let levelBestTime = 0;     // seconds, 0 = no record
let newBestFlag = 0;       // set to 1 when the current run beat the record

// IMPROVEMENT 4.4: "LEVEL N" title card shown for 1.5s at the start of
// each level. Decremented in appUpdate; rendered in appRenderPost.
let levelTitleTimer = 0;
let levelTitleObjective = '';   // human-readable objective hint

// IMPROVEMENT 6.1: 3-step tutorial overlay shown on the very first run.
// Persisted in localStorage so the user only sees it once. Each step
// is shown for ~3.5s before the next one auto-advances.
const TUT_KEY = 'spacehuggers.tutorialDone';
const TUT_STEPS = [
    [ '← →  Move      ↑  Jump',                                 'Use the D-Pad to move. Up to jump.' ],
    [ 'Z  Shoot   X  Roll   C  Grenade',                        'Shoot enemies, roll through bullets, throw grenades.' ],
    [ 'Find and shoot the glowing box to clear the level',       'Clear all enemies first — then the box will open.' ],
];
let tutStep = -1;          // -1 = inactive, 0..2 = current step
let tutStepTime = 0;       // seconds remaining on the current step
let tutActive = 0;         // 1 while the tutorial is visible
const isTutorialDone = ()=>
{
    try { return localStorage.getItem(TUT_KEY) === '1' ? 1 : 0; }
    catch (e) { return 0; }
};
const startTutorial = ()=>
{
    if (isTutorialDone()) return;
    tutStep = 0;
    tutStepTime = 3.5;
    tutActive = 1;
};
const advanceTutorial = ()=>
{
    ++tutStep;
    if (tutStep >= TUT_STEPS.length)
    {
        tutActive = 0;
        tutStep = -1;
        try { localStorage.setItem(TUT_KEY, '1'); } catch (e) {}
    }
    else
        tutStepTime = 3.5;
};
const loadLevelBests = ()=>
{
    try
    {
        const raw = localStorage.getItem(LB_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : {};
    }
    catch (e) { return {}; }
};
const saveLevelBests = (b)=>
{
    try { localStorage.setItem(LB_KEY, JSON.stringify(b)); }
    catch (e) { /* best-effort */ }
};

// IMPROVEMENT 3.3: kill streak / combo counter. Increments on each enemy
// kill, resets on player damage. Surfaces a 1.5s floating "x3 STREAK!"
// banner when crossing thresholds (3, 5, 10). The banner float-up uses
// a free-floating `hudText` decoupled from world position.
let streakCount = 0;
let streakTimer = 0;
let streakBannerText = '';
let streakBannerTime = 0;

// IMPROVEMENT 5.1: per-weapon stats (bullets fired, hits, kills, damage
// dealt) accumulated across the current run. Indexed by weaponType
// (0=pistol, 1=shotgun, 2=plasma). Reset in resetGame.
const weaponStats = [
    { fired: 0, hits: 0, kills: 0, damage: 0 },
    { fired: 0, hits: 0, kills: 0, damage: 0 },
    { fired: 0, hits: 0, kills: 0, damage: 0 },
];
let pauseStatsScreen = false;  // sub-screen flag for the STATS overlay

// IMPROVEMENT 5.4: Achievements. Each entry has a stable key, a friendly
// label, a description, and a check function (called on relevant events).
// Unlocked IDs are stored in localStorage so they persist across runs.
const ACH_KEY = 'spacehuggers.achievements';
const ACHIEVEMENTS = [
    { id: 'first_blood', name: 'First Blood',   desc: 'Kill your first enemy.' },
    { id: 'combo_5',     name: 'Combo Breaker', desc: 'Reach a 5-kill streak.' },
    { id: 'combo_10',    name: 'Unstoppable',   desc: 'Reach a 10-kill streak.' },
    { id: 'boxed_10',    name: 'Boxed Up',      desc: 'Break 10 bonus boxes.' },
    { id: 'speed_demon', name: 'Speed Demon',   desc: 'Clear a level in under 30 seconds.' },
    { id: 'boss_slayer', name: 'Boss Slayer',   desc: 'Defeat a level boss.' },
    { id: 'fireproof',   name: 'Fireproof',     desc: 'Survive being on fire without dying.' },
    { id: 'marathon',    name: 'Marathon',      desc: 'Reach level 20.' },
];
const unlockedAchievements = (()=>
{
    try
    {
        const raw = localStorage.getItem(ACH_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : {};
    }
    catch (e) { return {}; }
})();
const saveAchievements = ()=>
{
    try { localStorage.setItem(ACH_KEY, JSON.stringify(unlockedAchievements)); }
    catch (e) { /* best-effort */ }
};
const unlockAchievement = (id, name)=>
{
    if (unlockedAchievements[id]) return 0;
    unlockedAchievements[id] = Date.now();
    saveAchievements();
    achievementToastName = name;
    achievementToastTime = 3;
    return 1;
};
let pauseAchScreen   = false;
let achievementToastName = '';
let achievementToastTime = 0;
let bonusBoxBreakCount = 0;     // tally for the "boxed up" achievement

// IMPROVEMENT 6.5: floating "+100" damage popups. Bounded array of small
// text/position records spawned on enemy kill. Decayed in appUpdate, drawn
// in appRenderPost using world-to-screen coords. Each popup is one record.
const _killPopups = [];         // { pos:Vector2, value:number, time:number, lifetime:number, color:Color }
const spawnKillPopup = (pos, value, color)=>
{
    _killPopups.push({ pos: pos.copy(), value: value, time: 0.8, lifetime: 0.8, color: color || '#ffb347' });
};

// ── High score / scoreboard state ────────────────────────────────────────────
// Persisted top-10 list. Stored as JSON in localStorage under one key. The
// WebView can clear localStorage under memory pressure, so this is best-effort
// — the scoreboard degrades gracefully to empty if storage is wiped.
const HS_KEY = 'spacehuggers.highscores';
const HS_MAX = 10;
let pauseScoreboardScreen = false; // sub-screen flag (mirrors pauseAboutScreen)
let nameEntryActive = false;      // on-screen keyboard open after qualifying run
let nameEntryBuffer = '';         // 1..3 chars typed so far
let nameEntryRow = 0, nameEntryCol = 0; // cursor on the keyboard grid
let nameEntryFinalScore = 0;      // score being recorded (for prompt text)
let nameEntryFinalLevel = 0;      // level reached (for prompt text)

const loadHighScores = ()=>
{
    try
    {
        const raw = localStorage.getItem(HS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch (e) { return []; }
};

const saveHighScores = (list)=>
{
    try { localStorage.setItem(HS_KEY, JSON.stringify(list)); }
    catch (e) { /* storage full or denied — best-effort */ }
};

// Returns true if the score qualifies for the top 10. The list passed in is
// the *current* list; a new score always qualifies if the list is shorter
// than HS_MAX, or if it beats the lowest entry.
const qualifiesForHighScore = (score, list)=>
    list.length < HS_MAX || (list.length && score > list[list.length-1].score);

const addHighScore = (name, score, level)=>
{
    const list = loadHighScores();
    // IMPROVEMENT 5.2: tag the entry with whether it was a daily run, so the
    // scoreboard can flag "DAILY" scores separately.
    list.push({ name: name || 'AAA', score: score|0, level: level|0, date: Date.now(),
                daily: isDailyMode() ? 1 : 0 });
    list.sort((a,b)=> b.score - a.score);
    saveHighScores(list.slice(0, HS_MAX));
};

// Shared restart path for modal UI flows (GAME OVER / name entry). Unlike the
// pause-menu restart, these confirmations happen while the death overlay is
// still being rendered, so restarting immediately in the same frame can race
// the Fire TV WebGL fallback path and leave the app on a white screen. Clear
// the consumed input now, then defer resetGame() to the next animation frame.
let restartQueued = false;
const queueGameRestart = ()=>
{
    if (restartQueued)
        return;

    restartQueued            = true;
    nameEntryActive          = false;
    nameEntryBuffer          = '';
    _nameEntryHintLen        = -1;   // reset hint cache so next session starts fresh
    pauseAboutScreen         = false;
    pauseScoreboardScreen    = false;
    _cachedHighScores        = null;
    clearInput();

    requestAnimationFrame(() =>
    {
        // Fire TV / Canvas2D fallback: paint a solid black frame before
        // resetGame() destroys the tile layers. This prevents the one-frame
        // window where the sky gradient has been nulled but the new
        // pendingApplyArt guard hasn't activated yet, which otherwise
        // renders as a white screen on the Canvas2D fallback path.
        mainContext.fillStyle = '#000';
        mainContext.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
        _skyGradient = null; // invalidate here, after the black frame is painted
        restartQueued = false;
        resetGame();
    });
};

// ── On-screen keyboard for name entry ────────────────────────────────────────
// 3 rows × 10 columns. Row 2 last cell is BACKSPACE.
// Using a flat layout (D-pad navigates row-major) keeps the input code simple.
const KBD_ROWS = 3, KBD_COLS = 10;
const KBD_ROW0 = ['A','B','C','D','E','F','G','H','I','J'];
const KBD_ROW1 = ['K','L','M','N','O','P','Q','R','S','T'];
const KBD_ROW2 = ['U','V','W','X','Y','Z','7','8','9','\u232B']; // last = backspace

// Look up the key under (row, col). Returns null if out of range.
const kbdKey = (r, c)=>
{
    if (c < 0 || c >= KBD_COLS) return null;
    if (r === 0) return KBD_ROW0[c];
    if (r === 1) return KBD_ROW1[c];
    if (r === 2) return KBD_ROW2[c];
    return null;
};

// Handle D-pad / OK input while nameEntryActive is true. Should be called
// once per frame from the update path. Consumes input via clearInput().
const updateNameEntry = ()=>
{
    if (keyWasPressed(38) || gamepadWasPressed(12)) // Up
    {
        nameEntryRow = (nameEntryRow - 1 + KBD_ROWS) % KBD_ROWS;
        clearInput();
    }
    else if (keyWasPressed(40) || gamepadWasPressed(13)) // Down
    {
        nameEntryRow = (nameEntryRow + 1) % KBD_ROWS;
        clearInput();
    }
    else if (keyWasPressed(37) || gamepadWasPressed(14)) // Left
    {
        nameEntryCol = (nameEntryCol - 1 + KBD_COLS) % KBD_COLS;
        clearInput();
    }
    else if (keyWasPressed(39) || gamepadWasPressed(15)) // Right
    {
        nameEntryCol = (nameEntryCol + 1) % KBD_COLS;
        clearInput();
    }
    else if (keyWasPressed(8) || keyWasPressed(46)) // Backspace / Delete
    {
        nameEntryBuffer = nameEntryBuffer.slice(0, -1);
        clearInput();
    }
    else if (keyWasPressed(13) || keyWasPressed(90) || keyWasPressed(32) ||
             keyWasPressed(91) || gamepadWasPressed(0))  // OK
    {
        const key = kbdKey(nameEntryRow, nameEntryCol);
        // Snapshot fullness BEFORE we may append — confirmation only triggers
        // when the buffer was already full, so the 3rd character gets at least
        // one rendered frame before the game resets.
        const wasAlreadyFull = nameEntryBuffer.length >= 3;
        if (key === '\u232B')
        {
            // Backspace
            nameEntryBuffer = nameEntryBuffer.slice(0, -1);
        }
        else if (key && nameEntryBuffer.length < 3)
        {
            nameEntryBuffer += key;
        }
        // Confirm only when the buffer was full *before* this keypress (i.e.
        // the user pressed OK on a completed 3-letter name).
        if (wasAlreadyFull && nameEntryBuffer.length >= 3)
        {
            addHighScore(nameEntryBuffer, nameEntryFinalScore, nameEntryFinalLevel);
            queueGameRestart();
            return;
        }
        clearInput();
    }
};

// ── HUD helpers (module-scope so drawNameEntry and appRenderPost can both use them) ──
const hudPill = (x, y, w, h, alpha=0.55) => {
    mainContext.save();
    mainContext.fillStyle = `rgba(0,0,0,${alpha})`;
    mainContext.beginPath();
    mainContext.roundRect(x, y, w, h, h/2);
    mainContext.fill();
    mainContext.restore();
};
const hudText = (txt, x, y, size, color='#fff', align='left') => {
    const _pf = mainContext.fillStyle, _pa = mainContext.textAlign,
          _pb = mainContext.textBaseline, _pfo = mainContext.font,
          _psc = mainContext.shadowColor, _psb = mainContext.shadowBlur;
    mainContext.font          = `bold ${size}px impact`;
    mainContext.textAlign     = align;
    mainContext.textBaseline  = 'middle';
    mainContext.fillStyle     = color;
    mainContext.shadowColor   = 'rgba(0,0,0,0.95)';
    mainContext.shadowBlur    = lowGraphicsSettings ? 0 : 10;
    mainContext.fillText(txt, x, y);
    mainContext.fillStyle     = _pf;
    mainContext.textAlign     = _pa;
    mainContext.textBaseline  = _pb;
    mainContext.font          = _pfo;
    mainContext.shadowColor   = _psc;
    mainContext.shadowBlur    = _psb;
};
const hudMonoText = (txt, x, y, size, color='#fff', align='left', bold=0) => {
    const _pf = mainContext.fillStyle, _pa = mainContext.textAlign,
          _pb = mainContext.textBaseline, _pfo = mainContext.font,
          _psc = mainContext.shadowColor, _psb = mainContext.shadowBlur;
    mainContext.font          = `${bold ? '700' : '500'} ${size}px monospace`;
    mainContext.textAlign     = align;
    mainContext.textBaseline  = 'middle';
    mainContext.fillStyle     = color;
    mainContext.shadowColor   = color;
    mainContext.shadowBlur    = lowGraphicsSettings ? 0 : (bold ? 8 : 4);
    mainContext.fillText(txt, x, y);
    mainContext.fillStyle     = _pf;
    mainContext.textAlign     = _pa;
    mainContext.textBaseline  = _pb;
    mainContext.font          = _pfo;
    mainContext.shadowColor   = _psc;
    mainContext.shadowBlur    = _psb;
};
// angular bracket HUD frame: 4 corner brackets, dim fill, no full outline
const hudFrame = (x, y, w, h, color, alpha=.65) => {
    const inset = 2;
    const ix = x + inset, iy = y + inset, iw = w - inset*2, ih = h - inset*2;
    const bracket = min(18, iw * .22, ih * .45);
    const _pf = mainContext.fillStyle, _ps = mainContext.strokeStyle,
          _plw = mainContext.lineWidth, _psc = mainContext.shadowColor,
          _psb = mainContext.shadowBlur;
    mainContext.fillStyle   = `rgba(0,0,0,${alpha})`;
    mainContext.fillRect(ix, iy, iw, ih);
    mainContext.strokeStyle = color;
    mainContext.lineWidth   = 1.5;
    mainContext.shadowColor = color;
    mainContext.shadowBlur  = lowGraphicsSettings ? 0 : 8;
    mainContext.beginPath();
    mainContext.moveTo(ix, iy + bracket); mainContext.lineTo(ix, iy); mainContext.lineTo(ix + bracket, iy);
    mainContext.moveTo(ix + iw - bracket, iy); mainContext.lineTo(ix + iw, iy); mainContext.lineTo(ix + iw, iy + bracket);
    mainContext.moveTo(ix + iw, iy + ih - bracket); mainContext.lineTo(ix + iw, iy + ih); mainContext.lineTo(ix + iw - bracket, iy + ih);
    mainContext.moveTo(ix + bracket, iy + ih); mainContext.lineTo(ix, iy + ih); mainContext.lineTo(ix, iy + ih - bracket);
    mainContext.stroke();
    mainContext.fillStyle   = _pf;
    mainContext.strokeStyle = _ps;
    mainContext.lineWidth   = _plw;
    mainContext.shadowColor = _psc;
    mainContext.shadowBlur  = _psb;
};

// Hint string cache for drawNameEntry — rebuilt only when the buffer changes,
// not every frame.  On Fire TV string concatenation allocates heap strings
// which trigger incremental GC and cause sustained frame drops.
let _nameEntryHintCache = '';
let _nameEntryHintLen   = -1;   // buffer length that produced the cached hint

// Render the name-entry overlay. Replaces the GAME OVER panel while active.
const drawNameEntry = ()=>
{
    const cw = mainCanvas.width, ch = mainCanvas.height;
    const cx = cw/2, cy = ch/2;
    // dim
    mainContext.fillStyle = 'rgba(0,0,0,.78)';
    mainContext.fillRect(0, 0, cw, ch);
    // panel — single save/restore for the whole panel, no per-key saves
    mainContext.save();
    mainContext.fillStyle = 'rgba(10,10,30,0.95)';
    mainContext.beginPath();
    mainContext.roundRect(cx - 320, cy - 230, 640, 460, 20);
    mainContext.fill();
    mainContext.strokeStyle = '#665';
    mainContext.lineWidth = 2;
    mainContext.shadowBlur = 0;   // never blur here — Fire TV software-renders shadow
    mainContext.stroke();
    mainContext.restore();

    hudText('NEW HIGH SCORE!', cx, cy - 195, 32, '#ffe066', 'center');
    hudText('Score: ' + nameEntryFinalScore + '   \u00B7   Level ' + nameEntryFinalLevel,
            cx, cy - 155, 18, '#aaa', 'center');

    // buffer display — three slots (no save/restore per slot)
    const slotW = 60, slotH = 70, slotGap = 12;
    const slotsTotalW = slotW * 3 + slotGap * 2;
    const slotY = cy - 110;
    const slotX0 = cx - slotsTotalW/2;
    mainContext.lineWidth = 1;
    mainContext.strokeStyle = '#556';
    for (let i = 0; i < 3; i++)
    {
        const sx = slotX0 + i * (slotW + slotGap);
        mainContext.fillStyle = 'rgba(255,255,255,0.05)';
        mainContext.beginPath();
        mainContext.roundRect(sx, slotY, slotW, slotH, 8);
        mainContext.fill();
        mainContext.stroke();
        const sc = nameEntryBuffer[i];
        if (sc) hudText(sc, sx + slotW/2, slotY + slotH/2, 44, '#ffe066', 'center');
    }

    // Hint string — cached by buffer length so no string allocation per frame.
    const bufLen = nameEntryBuffer.length;
    if (bufLen !== _nameEntryHintLen)
    {
        _nameEntryHintLen = bufLen;
        if (bufLen === 0)
            _nameEntryHintCache = 'Pick letters to enter your name';
        else if (bufLen < 3)
        {
            const rem = 3 - bufLen;
            _nameEntryHintCache = rem + ' more letter' + (rem === 1 ? '' : 's') +
                                  ' (or OK to confirm "' + nameEntryBuffer + '")';
        }
        else
            _nameEntryHintCache = 'Press OK to save';
    }
    hudText(_nameEntryHintCache, cx, cy - 18, 16, '#8ef', 'center');

    // keyboard grid — no save()/restore() per key (33 pairs → 0 pairs per frame).
    // Directly set the properties that change per key instead.
    const keyW = 48, keyH = 48, keyGap = 8;
    const gridW = keyW * KBD_COLS + keyGap * (KBD_COLS - 1);
    const gridX0 = cx - gridW/2;
    const gridY = cy + 18;
    for (let r = 0; r < KBD_ROWS; r++)
    {
        for (let c = 0; c < KBD_COLS; c++)
        {
            const kx = gridX0 + c * (keyW + keyGap);
            const ky = gridY + r * (keyH + keyGap);
            const sel = (r === nameEntryRow && c === nameEntryCol);
            const label = kbdKey(r, c);
            mainContext.fillStyle   = sel ? 'rgba(255,224,102,0.25)' : 'rgba(255,255,255,0.06)';
            mainContext.strokeStyle = sel ? '#ffe066' : '#445';
            mainContext.lineWidth   = sel ? 2 : 1;
            mainContext.beginPath();
            mainContext.roundRect(kx, ky, keyW, keyH, 8);
            mainContext.fill();
            mainContext.stroke();
            hudText(label || '', kx + keyW/2, ky + keyH/2,
                    label === '\u232B' ? 24 : 28,
                    sel ? '#ffe066' : '#ddd', 'center');
        }
    }

    hudText('D-Pad Navigate   OK Select   \u232B Backspace   (3 letters max)',
            cx, cy + 200, 14, 'rgba(140,140,170,0.8)', 'center');
};

// IMPROVEMENT 6.3: track whether the user explicitly paused (Play/Pause
// button, P key) so the engine's `window.onfocus = ()=> paused = 0`
// doesn't auto-unpause the game when the user clicks back. The override
// is installed in a microtask after the engine's own onfocus handler.
let userExplicitlyPaused = 0;

// FIX 1.5: Cache window-size Vector2 allocations — recompute only when canvas or scale changes
let _lastCanvasW = 0, _lastCanvasH = 0, _lastCamScale = 0;
// FIX 2.6: Cache sky LinearGradient — recreate only when canvas height changes
let _skyGradient = null, _skyGradientH = 0;
// FIX 7.1: Cache scoreboard data — don't read localStorage every frame
let _cachedHighScores = null;
// FIX 8.5: Cache the bottom-of-screen controller-hint label — the input mode
// only changes when the user switches input device, not per frame.
let _hudHintLabel = '[Z] Shoot  [X] Roll  [C] Grenade  WASD/D-Pad Move  [P] Pause';
let _hudHintLabelMode = 0;
// Cache for the pause-menu inner-highlight gradient — createLinearGradient()
// allocates a CanvasGradient object; calling it every frame while paused was
// a steady source of GC pressure on Fire TV.
let _pauseGrad = null, _pauseGradPY = NaN;

engineInit(

///////////////////////////////////////////////////////////////////////////////
()=> // appInit
{
    resetGame();
    cameraScale = startCameraScale;
    // IMPROVEMENT 4.4: show the level title card immediately on first level.
    levelTitleTimer = 1.5;
    // IMPROVEMENT 1.2: set the initial objective (HUNT is the default for
    // level 1; later levels pick randomly in nextLevel).
    objectiveType = OBJECTIVE_HUNT;
    levelTitleObjective = 'CLEAR ALL ENEMIES — THEN BREAK THE BOX';
    // IMPROVEMENT 6.1: kick off the first-run tutorial (no-op on subsequent runs).
    startTutorial();

    // IMPROVEMENT 6.3: install a guard on the engine's window.onfocus so
    // the auto-unpause doesn't fire when the user explicitly paused. Done
    // in a setTimeout(0) so it runs AFTER the engine's own onfocus handler
    // inside tileImage.onload (which is what clobbers our override).
    setTimeout(()=> {
        window.onfocus = ()=> { if (!userExplicitlyPaused) paused = 0; };
    }, 0);

    // IMPROVEMENT 6.3: capture phase 2 listener (runs after the engine's
    // togglePause) that mirrors the user's explicit pause state into our
    // flag. Engine sets togglePause for keys 179 (Fire TV Play/Pause) and
    // 80 (P) — we set the flag after those run.
    window.addEventListener('keydown', (e)=>
    {
        if (e.keyCode === 179 || e.keyCode === 80)
            setTimeout(()=> { userExplicitlyPaused = paused; }, 0);
    }, false);
},

///////////////////////////////////////////////////////////////////////////////
()=> // appUpdate
{
    // IMPROVEMENT 2.2: short hit-pause after the player takes damage. We
    // skip this frame's input processing but still let the engine tick
    // physics / render — gives a 2-frame "ouch" beat without desyncing
    // the world simulation.
    if (hitPauseFrames > 0)
    {
        --hitPauseFrames;
        return;
    }

    // If the on-screen name-entry keyboard is up, it owns all input until the
    // name is confirmed. Run it first so it can clearInput() and prevent the
    // restart trigger / player movement from also firing this frame. We still
    // let the rest of the update run (camera/window sizes, world tick) so the
    // background keeps rendering behind the keyboard overlay.
    if (nameEntryActive)
        updateNameEntry();

    // FIX 1.5: Only recompute window-size vectors when canvas or scale changes
    if (mainCanvas.width !== _lastCanvasW || mainCanvas.height !== _lastCanvasH || cameraScale !== _lastCamScale) {
        _lastCanvasW = mainCanvas.width; _lastCanvasH = mainCanvas.height; _lastCamScale = cameraScale;
        const _sz = vec2(mainCanvas.width, mainCanvas.height);
        renderWindowSize   = _sz.scale(1/cameraScale).add(vec2(5));
        updateWindowSize   = _sz.scale(1/defaultCameraScale).add(vec2(30));
        gameplayWindowSize = _sz.scale(1/defaultCameraScale);
    }
    //debugRect(cameraPos, maxGameplayCameraSize);
    //debugRect(cameraPos, updateWindowSize);

    if (debug)
    {
        randSeeded(randSeeded(randSeeded(randSeed = Date.now()))); // set random seed for debug mode stuf
        if (keyWasPressed(81))
            new Enemy(mousePosWorld);

        if (keyWasPressed(84))
        {
            //for(let i=30;i--;)
                new Prop(mousePosWorld);
        }

        if (keyWasPressed(69))
            explosion(mousePosWorld);

        if (keyIsDown(89))
        {
            let e = new ParticleEmitter(mousePosWorld);

            // test
            e.collideTiles = 1;
            //e.tileIndex=7;
            e.emitSize = 2;
            e.colorStartA = new Color(1,1,1,1);
            e.colorStartB = new Color(0,1,1,1);
            e.colorEndA = new Color(0,0,1,0);
            e.colorEndB = new Color(0,.5,1,0);
            e.emitConeAngle = .1;
            e.particleTime = 1
            e.speed = .3
            e.elasticity = .1
            e.gravityScale = 1;
            //e.additive = 1;
            e.angle = -PI;
        }

        if (mouseWheel) // mouse zoom
            cameraScale = clamp(cameraScale*(1-mouseWheel/10), defaultTileSize.x*16, defaultTileSize.x/16);
                    
        //if (keyWasPressed(77))
        //    playSong([[[,0,219,,,,,1.1,,-.1,-50,-.05,-.01,1],[2,0,84,,,.1,,.7,,,,.5,,6.7,1,.05]],[[[0,-1,1,0,5,0],[1,1,8,8,0,3]]],[0,0,0,0],90]) // music test

        if (keyWasPressed(77))
            players[0].pos = mousePosWorld;

        /*if (keyWasPressed(32))
        {
            skyParticles && skyParticles.destroy();
            tileLayer.destroy();
            tileBackgroundLayer.destroy();
            tileParallaxLayers.forEach((tileParallaxLayer)=>tileParallaxLayer.destroy());
            randomizeLevelParams();
            applyArtToLevel();
        }*/
        if (keyWasPressed(78))
            nextLevel();
    }

    // restart if no lives left
    minDeadTime = 1e3;
    for(const player of players)
        minDeadTime = min(minDeadTime, player && player.isDead() ? player.deadTimer.get() : 0);

    // IMPROVEMENT 3.3: kill-streak decay. If the player goes 4 seconds
    // without a kill, the streak resets. The banner fades in appRenderPost.
    if (streakTimer > 0)
    {
        streakTimer -= timeDelta;
        if (streakTimer <= 0)
            streakCount = 0;
    }
    if (streakBannerTime > 0)
        streakBannerTime = max(0, streakBannerTime - timeDelta);

    // IMPROVEMENT 4.4: countdown the level title card so it auto-fades.
    if (levelTitleTimer > 0)
        levelTitleTimer = max(0, levelTitleTimer - timeDelta);

    // IMPROVEMENT 1.2: SURVIVE objective timer. Counts down each frame
    // while the player is alive and the level hasn't ended.
    if (objectiveType === OBJECTIVE_SURVIVE && surviveTimer > 0
        && players[0] && !players[0].isDead() && !levelEndTimer.isSet())
    {
        surviveTimer = max(0, surviveTimer - timeDelta);
    }

    // IMPROVEMENT 6.1: tutorial step timer. Each step auto-advances after
    // ~3.5s; the last step marks the tutorial as done in localStorage.
    if (tutActive)
    {
        tutStepTime -= timeDelta;
        if (tutStepTime <= 0)
            advanceTutorial();
    }

    // Fire TV: also accept OK (raw 13) and the tap-fire mapped key (91)
    // as restart triggers, since on the remote the user has no Z/Space/GpadA.
    // Skip the restart while the name-entry keyboard is up — it owns OK input.
    if (!nameEntryActive && minDeadTime > 3 && (keyWasPressed(90) || keyWasPressed(32) || keyWasPressed(13) || keyWasPressed(91) || keyWasPressed(82) || gamepadWasPressed(0)))
    {
        // If the run's score qualifies for the top 10, intercept the reset
        // and route the player through the on-screen name-entry keyboard
        // instead. Confirming the name then proceeds to reset.
        const finalScore = score + levelScore;
        if (qualifiesForHighScore(finalScore, loadHighScores()))
        {
            nameEntryActive   = true;
            nameEntryBuffer   = '';
            nameEntryRow      = 0;
            nameEntryCol      = 0;
            nameEntryFinalScore = finalScore;
            nameEntryFinalLevel = level;
            clearInput();  // consume the OK press so it doesn't fire inside updateNameEntry() next frame
        }
        else
        {
            queueGameRestart();
            return;
        }
    }

    // advance to next level only on explicit OK/confirm press
    if (levelEndTimer.isSet() && !paused && !(minDeadTime > 3 && playerLives <= 0))
    {
        if (keyWasPressed(13) || keyWasPressed(90) || keyWasPressed(32) || keyWasPressed(91) ||
            keyWasPressed(78) || gamepadWasPressed(0))
        {
            nextLevel();
            clearInput();
        }
    }
},

///////////////////////////////////////////////////////////////////////////////
()=> // appUpdatePost
{
    // Flush deferred tile-cascade destroys (replaces TileCascadeDestroy EngineObjects)
    processCascadeQueue();

    // Fire TV: Phase 2 of level setup — applyArtToLevel() deferred 3 frames
    // after generateLevel() so the GPU can release old TileLayer canvas
    // SharedImage mailboxes before we allocate new large ones (prevents Skia
    // OOM → EGL_BAD_PARAMETER → WebGL context loss on level transition).
    // pendingApplyArt counts down 3→1 while we wait, then fires at 0.
    // Do NOT count down while the GL context is lost — finishLevelSetup()
    // would bake TileLayers with a dead GL context, producing blank canvases.
    if (pendingApplyArt)
    {
        if (glContextLost)
            return;
        if (--pendingApplyArt)
            return;
        finishLevelSetup();
        return;
    }

    // Fire TV: continue trying to generate a valid level. nextLevel() sets
    // pendingLevelGenerate when it couldn't find one in a few tries — we
    // resume here on the next frame, after the GPU has had a chance to
    // release the previous level's textures. Bail after 20 frames so we
    // don't get stuck.
    if (pendingLevelGenerate)
    {
        if (++pendingLevelGenerate > 20)
            pendingLevelGenerate = 0;
        else
        {
            pendingLevelGenerate = 0;
            nextLevel();
            return;
        }
    }

    // Don't lerp on the frame finishLevelSetup() is about to fire — that
    // function snaps cameraPos to the spawn point in appUpdatePost(), but
    // appUpdate() runs first. If we lerp here with stale/origin coords we
    // undo the snap before it has any effect, causing a 1-frame camera jump.
    if (!pendingApplyArt && players.length == 1)
    {
        const player = players[0];
        if (!player.isDead())
        {
            // Fire TV / wide-screen fix: the original formula was
            // clamp(aliveTime/2), which is 0 on level start and ramps to 1
            // over 2 seconds. That meant the player was off-screen below
            // the camera for the first ~1s. Floor the lerp at 0.1 so the
            // camera starts following immediately, but still eases in.
            const lerp = max(.1, clamp(player.getAliveTime()/2));
            cameraPos = cameraPos.lerp(player.pos, lerp);
        }
    }
    else
    {
        // camera follows average pos of living players
        let posTotal = vec2();
        let playerCount = 0;
        let cameraOffset = 1;
        for(const player of players)
        {
            if (player && !player.isDead())
            {
                ++playerCount;
                posTotal = posTotal.add(player.pos.add(vec2(0,cameraOffset)));
            }
        }

        if (playerCount)
            cameraPos = cameraPos.lerp(posTotal.scale(1/playerCount), .2);
    }

    // spawn players if they don't exist
    for(let i = maxPlayers;i--;)
    {
        if (!players[i] && (gamepadWasPressed(0, i)||gamepadWasPressed(1, i)))
        {
            ++playerLives;
            new Player(checkpointPos, i);
        }
    }
    
    // clamp to bottom and sides of level
    if (clampCamera)
    {
        const w = mainCanvas.width/2/cameraScale+1;
        const h = mainCanvas.height/2/cameraScale+2;
        cameraPos.y = max(cameraPos.y, h);
        if (w*2 < tileCollisionSize.x)
            cameraPos.x = clamp(cameraPos.x, tileCollisionSize.x - w, w);
    }

    // trauma-decay screen shake — FIX 1.7: mutate cameraPos directly (no vec2 alloc)
    if (cameraShake > 0) {
        const shakeAmt = cameraShake * cameraShake;
        cameraPos.x += (Math.random()*2-1) * shakeAmt * 0.5;
        cameraPos.y += (Math.random()*2-1) * shakeAmt * 0.5;
        cameraShake = max(0, cameraShake - 0.05);
    }

    updateParallaxLayers();

    updateSky();
},

///////////////////////////////////////////////////////////////////////////////
()=> // appRender
{
    // Fire TV / level-transition flash: generateLevel() destroyed the old
    // TileLayers in appLevel.js:542 and finishLevelSetup() hasn't recreated
    // the new ones yet (pendingApplyArt window, appUpdatePost at app.js:462).
    // Without this, the new level's light-gray sky is rendered for ~83 ms
    // with no terrain underneath, which reads as a white screen on TVs.
    if (pendingApplyArt)
    {
        mainContext.fillStyle = '#000';
        mainContext.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
        return;
    }

    // FIX 2.6: Cache sky gradient — only recreate when canvas height changes
    if (!_skyGradient || mainCanvas.height !== _skyGradientH) {
        _skyGradientH = mainCanvas.height;
        _skyGradient  = mainContext.createLinearGradient(0, 0, 0, mainCanvas.height);
        _skyGradient.addColorStop(0, levelSkyColor.rgba());
        _skyGradient.addColorStop(1, levelSkyHorizonColor.rgba());
    }
    mainContext.fillStyle = _skyGradient;
    //mainContext.fillStyle = levelSkyColor.rgba();
    mainContext.fillRect(0,0,mainCanvas.width, mainCanvas.height);

    drawStars();

    // Fire TV / controller hint: show a small key-binding strip in the
    // bottom-left of the canvas. Switches between gamepad glyphs, the
    // Fire TV remote, and keyboard labels depending on the last input used.
    // Perf 8.5: cache the label string — input mode changes at most once per
    // session, so re-evaluating three ternaries per frame is wasted work.
    {
        const w = mainCanvas.width, h = mainCanvas.height;
        if (_hudHintLabelMode !== (isUsingFireTVRemote ? 2 : isUsingGamepad ? 1 : 0))
        {
            _hudHintLabelMode = isUsingFireTVRemote ? 2 : isUsingGamepad ? 1 : 0;
            _hudHintLabel = isUsingFireTVRemote
                ? 'D-Pad Move  OK Shoot   \u275A\u275A Pause   \u23EA Grenade   \u23E9 Roll   (hold 3s after death to restart, press at level end to skip)'
                : isUsingGamepad
                    ? '[A] Shoot    [B] Roll    [X] Grenade    [Y] Thrust    D-Pad Move'
                    : '[Z] Shoot  [X] Roll  [C] Grenade  WASD/D-Pad Move  [P] Pause';
        }
        mainContext.save();
        mainContext.globalAlpha = .7;
        mainContext.font = '24px arial';
        mainContext.textBaseline = 'top';
        mainContext.fillStyle = '#fff';
        mainContext.shadowColor = 'rgba(0,0,0,0.95)';
        mainContext.shadowBlur = lowGraphicsSettings ? 0 : 8;
        mainContext.fillText(_hudHintLabel, 16, h - 36);
        mainContext.restore();
    }

    // IMPROVEMENT 1.3: draw an off-screen direction arrow toward the BonusBox
    // when the player is too far away. Pure screen-space draw — 3 rects, zero
    // object allocations, no per-frame cost when the box is on-screen.
    if (bonusBoxRef && !bonusBoxRef.destroyed && players[0] && !players[0].destroyed)
    {
        const box = bonusBoxRef;
        const p   = players[0];
        const dx  = box.pos.x - p.pos.x;
        const dy  = box.pos.y - p.pos.y;
        const dist = Math.hypot(dx, dy);
        // Only show the arrow beyond 22 world units (the box already has its
        // own pulsing beacon when you're close).
        if (dist > 22)
        {
            // Project box position into screen space; if it's on-screen, skip.
            const screenBox = worldToScreen(box.pos);
            const onScreen = screenBox.x > 40 && screenBox.x < mainCanvas.width - 40
                          && screenBox.y > 40 && screenBox.y < mainCanvas.height - 40;
            if (!onScreen)
            {
                // Clamp arrow to canvas edge along the line from screen-center to box.
                const cx = mainCanvas.width / 2;
                const cy = mainCanvas.height / 2;
                const ang = Math.atan2(screenBox.y - cy, screenBox.x - cx);
                const margin = 60;
                const maxX = cx - margin;
                const maxY = cy - margin;
                // Find intersection of the ray (cx,cy) + t*(cos,sin) with the
                // smaller of the horizontal/vertical bounds.
                const tX = ang !== 0 ? Math.abs(maxX / Math.cos(ang)) : 1e9;
                const tY = ang !== 0 ? Math.abs(maxY / Math.sin(ang)) : 1e9;
                const t = Math.min(tX, tY, 1e9) * .92;
                const ax = cx + Math.cos(ang) * t;
                const ay = cy + Math.sin(ang) * t;
                const pulse = .6 + .4 * Math.sin(time * 4);

                mainContext.save();
                mainContext.translate(ax, ay);
                mainContext.rotate(ang);
                mainContext.fillStyle = `rgba(255, 224, 102, ${pulse})`;
                mainContext.shadowColor = 'rgba(255, 224, 102, 0.9)';
                mainContext.shadowBlur = lowGraphicsSettings ? 0 : 10;
                // Triangle pointing along +X (right) — rotation aligns it to the box.
                mainContext.beginPath();
                mainContext.moveTo(18, 0);
                mainContext.lineTo(-8, -12);
                mainContext.lineTo(-2, 0);
                mainContext.lineTo(-8, 12);
                mainContext.closePath();
                mainContext.fill();
                mainContext.restore();

                // "BOX" label below the arrow.
                mainContext.save();
                mainContext.font = 'bold 16px impact';
                mainContext.textAlign = 'center';
                mainContext.textBaseline = 'middle';
                mainContext.fillStyle = `rgba(255, 224, 102, ${pulse})`;
                mainContext.shadowColor = 'rgba(0,0,0,0.95)';
                mainContext.shadowBlur = lowGraphicsSettings ? 0 : 6;
                mainContext.fillText('BOX', ax, ay + 26);
                mainContext.restore();
            }
        }
    }
},

///////////////////////////////////////////////////////////////////////////////
()=> // appRenderPost
{
    //let minAliveTime = 9;
    //for(const player of players)
    //    minAliveTime = min(minAliveTime, player.getAliveTime());

    //const livesPercent = percent(minAliveTime, 5, 4)
    //const s = 8;
    //const offset = 100*livesPercent;
    //mainContext.drawImage(tileImage, 32, 8, s, s, 32, mainCanvas.height-90, s*9, s*9);
    mainContext.textAlign = 'center';

    // check if any enemies left
    let enemiesCount = 0;
    for (const enemy of liveEnemies)
    {
        if (!enemy || enemy.destroyed || enemy.team != team_enemy || enemy.isDead())
            continue;

        ++enemiesCount;
        // IMPROVEMENT 4.3: indicators are now enemy-type-aware. Size scales
        // with threat (weak = small, elite = large + pulsing ring). Color
        // still comes from the enemy's own color tint.
        const t = enemy.type || 0;
        const threat = t === 3 ? 1.6 : t >= 2 ? 1.3 : t === 4 ? 1.25 : 1;
        const pos = vec2(mainCanvas.width/2 + (enemy.pos.x - cameraPos.x)*30,mainCanvas.height-20);
        drawRectScreenSpace(pos, enemy.size.scale(20 * threat), enemy.color.scale(1, .6));
        if (t === 3) // elite — pulsing red ring around indicator
        {
            const ringPulse = .5 + .5 * Math.sin(time * 6);
            drawRectScreenSpace(pos, vec2(20 * (threat + .4 + ringPulse * .25)),
                new Color(1, .2, .2, .25 + ringPulse * .35));
        }
    }

    // IMPROVEMENT 1.1: do NOT auto-end the level when all enemies die. The
    // BonusBox is the finale — it's gated on `areaClear` below. We still want
    // to track the "all enemies dead" state for the HUD ("AREA CLEAR" text) and
    // for the BonusBox gate, so we expose it as a module flag.
    // IMPROVEMENT 1.2: the areaClear condition depends on the level's
    // objective type (HUNT / SURVIVE / COLLECT). The survive timer and
    // stash tally are also updated here.
    let _areaClear = 0;
    if (!enemiesCount && !levelEndTimer.isSet() && !pendingApplyArt &&
        players.length > 0 && players[0] && !players[0].destroyed)
    {
        if (objectiveType === OBJECTIVE_HUNT)
            _areaClear = 1;
        else if (objectiveType === OBJECTIVE_SURVIVE)
            _areaClear = surviveTimer <= 0 ? 1 : 0;
        else if (objectiveType === OBJECTIVE_COLLECT)
            _areaClear = stashesCollected >= stashesRequired ? 1 : 0;
    }
    areaClear = _areaClear;

    // hudPill / hudText are defined at module scope (above drawNameEntry)

    const pad = 14, cw = mainCanvas.width, ch = mainCanvas.height;
    const frameH = 60;
    const labelColor = 'rgba(255,255,255,0.72)';
    const bracketColor = '#7fdbff';
    const totalScore = score + levelScore;

    // Draw a single heart icon centered at (cx, cy) with half-width `s`.
    // Used by the LIVES panel — a row of N hearts replaces the numeric counter.
    const drawHeart = (cx, cy, s, color, alpha = 1) =>
    {
        mainContext.save();
        mainContext.globalAlpha = alpha;
        mainContext.fillStyle = color;
        mainContext.shadowColor = color;
        mainContext.shadowBlur = lowGraphicsSettings ? 0 : 6;
        mainContext.beginPath();
        // Two bezier lobes form the top of the heart, meeting at the bottom point.
        mainContext.moveTo(cx, cy + s * .35);
        mainContext.bezierCurveTo(cx - s * .55, cy - s * .05, cx - s * .55, cy - s * .55, cx, cy - s * .30);
        mainContext.bezierCurveTo(cx + s * .55, cy - s * .55, cx + s * .55, cy - s * .05, cx, cy + s * .35);
        mainContext.closePath();
        mainContext.fill();
        mainContext.restore();
    };

    const drawHudPanel = (x, y, w, label, value, color, align='left') =>
    {
        hudFrame(x, y, w, frameH, bracketColor);
        const accentW = w * .3;
        const accentY = y + frameH - 10;
        mainContext.save();
        mainContext.strokeStyle = color;
        mainContext.lineWidth = 1.5;
        mainContext.shadowColor = color;
        mainContext.shadowBlur = lowGraphicsSettings ? 0 : 8;
        mainContext.beginPath();
        if (align == 'center')
        {
            mainContext.moveTo(x + (w - accentW)/2, accentY);
            mainContext.lineTo(x + (w + accentW)/2, accentY);
        }
        else if (align == 'right')
        {
            mainContext.moveTo(x + w - 14 - accentW, accentY);
            mainContext.lineTo(x + w - 14, accentY);
        }
        else
        {
            mainContext.moveTo(x + 14, accentY);
            mainContext.lineTo(x + 14 + accentW, accentY);
        }
        mainContext.stroke();
        mainContext.restore();

        const textX = align == 'center' ? x + w/2 : align == 'right' ? x + w - 14 : x + 14;
        hudMonoText(label, textX, y + 18, 16, labelColor, align);
        hudMonoText(String(value), textX, y + 38, 24, color, align, 1);
    };

    // ── Score panel — top left ────────────────────────────────────────────────
    drawHudPanel(pad, pad, 240, 'SCORE', totalScore, '#ffb347');

    // ── Level panel — top center ──────────────────────────────────────────────
    // IMPROVEMENT 5.2: add a small "DAILY" badge when the run is in daily mode.
    {
        const lvlLabel = isDailyMode() ? ('LEVEL ' + level + ' \u2605DAILY') : 'LEVEL';
        drawHudPanel(cw/2 - 90, pad, 180, lvlLabel, level, isDailyMode() ? '#ffe066' : '#7fdbff', 'center');
    }

    // ── Lives panel — top right ───────────────────────────────────────────────
    // Replaces the numeric lives counter with a row of heart icons. Each heart
    // is a solid red shape when "alive" and a dim outline when "lost" (only
    // the first `playerLives` hearts are filled; extras are dim).
    {
        const lx = cw - pad - 170, ly = pad, lw = 170;
        hudFrame(lx, ly, lw, frameH, bracketColor);
        hudMonoText('LIVES', lx + 14, ly + 18, 16, labelColor, 'left');
        // accent stripe under the value (right-aligned), same shape drawHudPanel uses
        const lAccentW = lw * .3, lAccentY = ly + frameH - 10;
        mainContext.save();
        mainContext.strokeStyle = '#ff5050';
        mainContext.lineWidth = 1.5;
        mainContext.shadowColor = '#ff5050';
        mainContext.shadowBlur = lowGraphicsSettings ? 0 : 8;
        mainContext.beginPath();
        mainContext.moveTo(lx + lw - 14 - lAccentW, lAccentY);
        mainContext.lineTo(lx + lw - 14, lAccentY);
        mainContext.stroke();
        mainContext.restore();
        // heart row — right-aligned, sized to fit up to 5 hearts inside the panel.
        // Past 5 we append a small "+N" indicator so the row never overflows.
        const heartCount = Math.max(0, playerLives | 0);
        const maxInPanel = 5;
        const heartSize = heartCount <= maxInPanel ? 18 : 14;
        const heartGap  = 6;
        const showCount = Math.min(heartCount, maxInPanel);
        const rowW = showCount * heartSize + (showCount - 1) * heartGap
                   + (heartCount > maxInPanel ? 18 : 0);
        let hx = lx + lw - 14 - rowW;
        const hy = ly + frameH / 2 + 2;
        for (let i = 0; i < showCount; ++i)
        {
            drawHeart(hx + heartSize / 2, hy, heartSize, '#ff5050', 1);
            hx += heartSize + heartGap;
        }
        if (heartCount > maxInPanel)
        {
            hudMonoText('+' + (heartCount - maxInPanel), hx + 10, hy + 5, 16, '#ff5050', 'left');
        }
    }

    // ── Threats panel — bottom center ─────────────────────────────────────────
    // Always shows the count of enemies the player still has to kill. The box
    // being unlocked is communicated by the count reaching 0 and the panel
    // turning yellow; the locked/unlocked sound effect on BonusBox hits is the
    // explicit feedback when the player tries to break it early.
    let threatsLabel = 'ENEMIES', threatsValue = '', threatsColor = '#ffb347';
    if (objectiveType === OBJECTIVE_HUNT)
    {
        threatsValue = enemiesCount + ' REMAINING';
        threatsColor = enemiesCount > 0 ? '#7fff7f' : (areaClear ? '#ffe066' : '#ff5050');
    }
    else if (objectiveType === OBJECTIVE_SURVIVE)
    {
        threatsValue = surviveTimer > 0 ? (surviveTimer | 0) + 's LEFT' : 'SURVIVED!';
        threatsColor = surviveTimer > 0 ? '#ff5050' : '#7fff7f';
    }
    else if (objectiveType === OBJECTIVE_COLLECT)
    {
        threatsValue = stashesCollected + ' / ' + stashesRequired + ' STASHES';
        threatsColor = stashesCollected >= stashesRequired ? '#7fff7f' : '#7fdbff';
    }
    drawHudPanel(cw/2 - 140, ch - pad - frameH, 280, threatsLabel, threatsValue, threatsColor, 'center');

    // IMPROVEMENT 4.1: weapon indicator — shows current weapon below the
    // LIVES panel. Pistol = white, Shotgun = orange, Plasma = cyan.
    if (players[0] && players[0].weapon)
    {
        const wpn = players[0].weapon;
        const wx = cw - pad - 170;
        const wy = pad + frameH + 8;          // right side, below LIVES
        const wpnColor = wpn.weaponType === 2 ? '#0ff'
                       : wpn.weaponType === 1 ? '#f80'
                                                : '#fff';
        const wpnName  = wpn.weaponType === 2 ? 'PLASMA'
                       : wpn.weaponType === 1 ? 'SHOTGUN'
                                                : 'PISTOL';
        drawHudPanel(wx, wy, 170, 'WEAPON', wpnName, wpnColor, 'right');
    }

    // ── Kills panel — bottom left (during play) ───────────────────────────────
    if (levelKills > 0)
        drawHudPanel(pad, ch - pad - frameH, 220, 'KILLS', levelKills + '  +' + levelScore, '#ffffff');

    // IMPROVEMENT 4.5: small "Checkpoint X / Y" indicator below the KILLS
    // panel. Counts the live Checkpoint objects in engineObjects each frame
    // (typical count is 3-5, so the cost is trivial).
    {
        let ckTotal = 0, ckIndex = 0;
        for (const o of engineObjects) {
            if (o && o.isCheckpoint) {
                ++ckTotal;
                if (o === activeCheckpoint) ckIndex = ckTotal;
            }
        }
        if (ckTotal > 0)
        {
            const lbl = ckIndex > 0 ? ('CHECKPOINT ' + ckIndex + ' / ' + ckTotal) : 'CHECKPOINT — / ' + ckTotal;
            const val = ckIndex > 0 ? ('#' + ckIndex) : 'not yet';
            const c   = ckIndex > 0 ? '#7fdbff' : 'rgba(140,140,170,0.7)';
            drawHudPanel(pad, ch - pad - frameH - 70, 220, lbl, val, c);
        }
    }

    // ── Time panel — bottom right (during play, mirrors KILLS) ───────────────
    // Shows the single counter the player is currently running: elapsed time
    // in this level. The personal-best comparison was dropped because the
    // "/ 0:38" suffix overflowed the panel on narrow screens.
    if (!levelEndTimer.isSet()) {
        const elapsed = Math.max(0, time - levelStartTime) | 0;
        const mm = (elapsed / 60) | 0;
        const ss = String(elapsed % 60).padStart(2, '0');
        const newBestPulse = newBestFlag > 0 ? .5 + .5 * Math.sin(time * 6) : 0;
        const value = newBestFlag > 0 ? mm + ':' + ss + '  NEW BEST' : mm + ':' + ss;
        drawHudPanel(cw - pad - 130, ch - pad - frameH, 130, 'TIME', value,
                     newBestFlag > 0 ? `rgba(255, 224, 102, ${newBestPulse})` : '#7fdbff', 'right');
        if (newBestFlag > 0)
            newBestFlag = max(0, newBestFlag - timeDelta * 0.5); // ~2s flash
    }

    // ── LEVEL CLEAR overlay panel — stays until player presses OK ────────────
    if (typeof levelEndTimer !== 'undefined' && levelEndTimer.isSet()) {
        // dim the background
        mainContext.fillStyle = 'rgba(0,0,0,0.6)';
        mainContext.fillRect(0, 0, cw, ch);

        const ox = cw/2, oy = ch/2;
        // Taller panel when there is a time bonus to show
        const panelH = levelTimeBonus > 0 ? 260 : 220;
        mainContext.save();
        mainContext.fillStyle = 'rgba(0,0,0,0.82)';
        mainContext.beginPath();
        mainContext.roundRect(ox - 280, oy - 110, 560, panelH, 20);
        mainContext.fill();
        // gold divider line
        mainContext.strokeStyle = '#ffe066';
        mainContext.lineWidth = 2;
        mainContext.beginPath();
        mainContext.moveTo(ox - 220, oy + 10);
        mainContext.lineTo(ox + 220, oy + 10);
        mainContext.stroke();
        mainContext.restore();
        hudText('LEVEL CLEAR!', ox, oy - 48, 52, '#ffe066', 'center');
        hudText('Kills: ' + levelKills + '     Score: +' + levelScore, ox, oy + 40, 28, '#fff', 'center');
        if (levelTimeBonus > 0)
            hudText('+ TIME BONUS  ' + levelTimeBonus, ox, oy + 76, 22, '#7fdbff', 'center');
        // pulsing prompt — pushed down when bonus line is present
        const pulse = .6 + .4 * Math.sin(Date.now() / 400);
        hudText('Press OK to continue', ox, oy + (levelTimeBonus > 0 ? 116 : 80), 22, `rgba(180,220,255,${pulse})`, 'center');
    }

    // fade only during level-start transition (not while end screen is shown)
    const fade = levelEndTimer.isSet() ? 0 : percent(levelTimer.get(), .5, 2);
    drawRect(cameraPos, vec2(1e3), new Color(0,0,0,fade))

    // IMPROVEMENT 5.4: decay the achievement unlock toast.
    if (achievementToastTime > 0)
        achievementToastTime = max(0, achievementToastTime - timeDelta);

    // IMPROVEMENT 6.5: decay kill popups (rises 0.6 units, fades over 0.8s).
    for (let i = _killPopups.length - 1; i >= 0; --i)
    {
        _killPopups[i].time -= timeDelta;
        if (_killPopups[i].time <= 0)
            _killPopups.splice(i, 1);
    }

    // ── Pause menu ────────────────────────────────────────────────────────────
    if (paused)
    {
        const MENU_ITEMS = 7;  // IMPROVEMENT 5.1 + 5.4: STATS and ACHIEVEMENTS sub-screens
        // IMPORTANT: clearInput() after every action — when paused the engine
        // never clears keyWasPressed flags so without it actions fire every frame.
        if (keyWasPressed(38) || gamepadWasPressed(12))
        {
            if (pauseAboutScreen || pauseScoreboardScreen || pauseStatsScreen || pauseAchScreen)
                { pauseAboutScreen = pauseScoreboardScreen = pauseStatsScreen = pauseAchScreen = false; }
            else { pauseMenuOption = (pauseMenuOption - 1 + MENU_ITEMS) % MENU_ITEMS; }
            clearInput();
        }
        else if (keyWasPressed(40) || gamepadWasPressed(13))
        {
            if (!pauseAboutScreen && !pauseScoreboardScreen && !pauseStatsScreen && !pauseAchScreen)
                pauseMenuOption = (pauseMenuOption + 1) % MENU_ITEMS;
            clearInput();
        }
        else if (keyWasPressed(13) || keyWasPressed(90) || keyWasPressed(32) || keyWasPressed(91) || gamepadWasPressed(0))
        {
            if (pauseAboutScreen)
            {
                pauseAboutScreen = false;
            }
            else if (pauseScoreboardScreen)
            {
                pauseScoreboardScreen = false;
            }
            else if (pauseStatsScreen)
            {
                pauseStatsScreen = false;
            }
            else if (pauseAchScreen)
            {
                pauseAchScreen = false;
            }
            else if (pauseMenuOption === 0)
            {
                pauseAboutScreen = pauseScoreboardScreen = pauseStatsScreen = pauseAchScreen = false;
                togglePause();
            }
            else if (pauseMenuOption === 1)
            {
                setMusicMute(musicMuted ? 0 : 1);
            }
            else if (pauseMenuOption === 2)
            {
                pauseAboutScreen = pauseScoreboardScreen = pauseStatsScreen = pauseAchScreen = false;
                togglePause();
                resetGame();
            }
            else if (pauseMenuOption === 3)
            {
                pauseAboutScreen = pauseScoreboardScreen = pauseStatsScreen = pauseAchScreen = false;
                pauseStatsScreen = true;
            }
            else if (pauseMenuOption === 4)
            {
                pauseAboutScreen = pauseScoreboardScreen = pauseStatsScreen = pauseAchScreen = false;
                pauseScoreboardScreen = true;
                _cachedHighScores = loadHighScores();
            }
            else if (pauseMenuOption === 5)
            {
                pauseAboutScreen = pauseScoreboardScreen = pauseStatsScreen = pauseAchScreen = false;
                pauseAchScreen = true; // open achievements
            }
            else if (pauseMenuOption === 6)
            {
                pauseAboutScreen = pauseScoreboardScreen = pauseStatsScreen = pauseAchScreen = false;
                pauseAboutScreen = true;
            }
            clearInput();
        }

        const cx = mainCanvas.width/2, cy = mainCanvas.height/2;

        // dim backdrop
        mainContext.fillStyle = 'rgba(0,0,0,0.75)';
        mainContext.fillRect(0, 0, mainCanvas.width, mainCanvas.height);

        if (pauseScoreboardScreen)
        {
            // ── Scoreboard sub-screen ─────────────────────────────────────────
            mainContext.save();
            mainContext.fillStyle = 'rgba(5,5,20,0.95)';
            mainContext.beginPath();
            mainContext.roundRect(cx - 300, cy - 240, 600, 480, 20);
            mainContext.fill();
            mainContext.strokeStyle = '#665';
            mainContext.lineWidth = 2;
            mainContext.stroke();
            mainContext.restore();

            hudText('HIGH SCORES', cx, cy - 200, 36, '#ffe066', 'center');
            // gold divider
            mainContext.save();
            mainContext.strokeStyle = '#553';
            mainContext.lineWidth = 1;
            mainContext.beginPath();
            mainContext.moveTo(cx - 240, cy - 165);
            mainContext.lineTo(cx + 240, cy - 165);
            mainContext.stroke();
            mainContext.restore();

            // FIX 7.1: Use cached scores — populated when screen opens, not every frame
            const list = _cachedHighScores || [];
            if (list.length === 0)
            {
                hudText('No scores yet \u2014 beat a level to get on the board!', cx, cy + 10, 18, '#aaa', 'center');
            }
            else
            {
                // Column headers
                hudText('#',     cx - 240, cy - 130, 16, '#888', 'left');
                hudText('NAME',  cx - 200, cy - 130, 16, '#888', 'left');
                hudText('SCORE', cx +  60, cy - 130, 16, '#888', 'right');
                hudText('LEVEL', cx + 180, cy - 130, 16, '#888', 'right');
                // Up to HS_MAX rows
                const rowH = 32;
                const startY = cy - 100;
                for (let i = 0; i < list.length; i++)
                {
                    const entry = list[i];
                    const ry = startY + i * rowH;
                    const rank = (i + 1).toString().padStart(2, '0');
                    const rowColor = i === 0 ? '#ffe066' : (i < 3 ? '#fff' : '#ccc');
                    if (i === 0)
                    {
                        // Highlight #1 with a subtle band
                        mainContext.save();
                        mainContext.fillStyle = 'rgba(255,224,102,0.10)';
                        mainContext.beginPath();
                        mainContext.roundRect(cx - 260, ry - 14, 520, rowH - 4, 6);
                        mainContext.fill();
                        mainContext.restore();
                    }
                    hudText(rank,                  cx - 240, ry, 22, rowColor, 'left');
                    hudText(entry.name,            cx - 200, ry, 24, rowColor, 'left');
                    if (entry.daily) hudText('\u2605', cx - 168, ry, 22, '#ffe066', 'left');
                    hudText(entry.score,           cx +  60, ry, 22, rowColor, 'right');
                    hudText('Lv ' + entry.level,   cx + 180, ry, 20, rowColor, 'right');
                }
            }

            const pulse = .5 + .5 * Math.sin(Date.now() / 500);
            hudText('Press OK to go back', cx, cy + 200, 18, `rgba(150,190,255,${pulse})`, 'center');
        }
        else if (pauseAboutScreen)
        {
            // ── About sub-screen ──────────────────────────────────────────────
            mainContext.save();
            mainContext.fillStyle = 'rgba(5,5,20,0.95)';
            mainContext.beginPath();
            mainContext.roundRect(cx - 310, cy - 190, 620, 380, 20);
            mainContext.fill();
            mainContext.strokeStyle = '#ffe066';
            mainContext.lineWidth = 2;
            mainContext.stroke();
            mainContext.restore();

            hudText('SPACE HUGGERS', cx, cy - 145, 36, '#ffe066', 'center');

            // gold divider
            mainContext.save();
            mainContext.strokeStyle = '#334';
            mainContext.lineWidth = 1;
            mainContext.beginPath();
            mainContext.moveTo(cx - 240, cy - 115);
            mainContext.lineTo(cx + 240, cy - 115);
            mainContext.stroke();
            mainContext.restore();

            hudText('Original game', cx, cy - 88, 18, '#aaa', 'center');
            hudText('Frank Force', cx, cy - 64, 22, '#fff', 'center');
            hudText('X: @KilledByAPixel', cx, cy - 42, 16, '#8ef', 'center');

            // IMPROVEMENT 6.4: controls list embedded in the About screen.
            mainContext.save();
            mainContext.strokeStyle = '#334';
            mainContext.lineWidth = 1;
            mainContext.beginPath();
            mainContext.moveTo(cx - 240, cy - 16);
            mainContext.lineTo(cx + 240, cy - 16);
            mainContext.stroke();
            mainContext.restore();

            hudText('CONTROLS', cx, cy + 4, 16, '#7fdbff', 'center');
            hudText('Keyboard:  WASD/Arrows = Move  Z = Shoot  X = Roll',       cx, cy +  26, 13, '#fff', 'center');
            hudText('C = Grenade  R = Rewind  P / Esc = Pause  Enter = OK',     cx, cy +  44, 13, '#fff', 'center');
            hudText('Fire TV:   D-Pad = Move  OK = Shoot  Play = Pause',       cx, cy +  62, 13, '#fff', 'center');
            hudText('Rewind = Grenade  FastFwd = Roll',                       cx, cy +  80, 13, '#fff', 'center');
            hudText('Gamepad:  D-Pad = Move  A = Shoot  B = Roll  X = Grenade',cx, cy +  98, 13, '#fff', 'center');

            // bottom divider + credits
            mainContext.save();
            mainContext.strokeStyle = '#334';
            mainContext.lineWidth = 1;
            mainContext.beginPath();
            mainContext.moveTo(cx - 240, cy + 112);
            mainContext.lineTo(cx + 240, cy + 112);
            mainContext.stroke();
            mainContext.restore();

            hudText('Fire TV port \u2014 Jeff Cechinel', cx, cy + 132, 14, '#aaa', 'center');
            hudText('Version ' + APP_VERSION + '   \u00B7   Music: ' + (currentMusicStyleName || 'calm mix'),
                   cx, cy + 152, 13, '#8aa', 'center');

            const pulse = .5 + .5 * Math.sin(Date.now() / 500);
            hudText('Press OK to go back', cx, cy + 180, 18, `rgba(150,190,255,${pulse})`, 'center');
        }
        else if (pauseStatsScreen)
        {
            // IMPROVEMENT 5.1: per-weapon stats sub-screen.
            mainContext.save();
            mainContext.fillStyle = 'rgba(5,5,20,0.95)';
            mainContext.beginPath();
            mainContext.roundRect(cx - 300, cy - 200, 600, 400, 20);
            mainContext.fill();
            mainContext.strokeStyle = '#7fdbff';
            mainContext.lineWidth = 2;
            mainContext.stroke();
            mainContext.restore();

            hudText('STATS', cx, cy - 158, 36, '#7fdbff', 'center');
            // gold divider
            mainContext.save();
            mainContext.strokeStyle = '#335';
            mainContext.lineWidth = 1;
            mainContext.beginPath();
            mainContext.moveTo(cx - 240, cy - 122);
            mainContext.lineTo(cx + 240, cy - 122);
            mainContext.stroke();
            mainContext.restore();

            // column headers
            hudText('WEAPON',   cx - 220, cy - 86, 18, '#888', 'left');
            hudText('FIRED',    cx -  60, cy - 86, 18, '#888', 'right');
            hudText('HITS',     cx +  20, cy - 86, 18, '#888', 'right');
            hudText('KILLS',    cx + 100, cy - 86, 18, '#888', 'right');
            hudText('DAMAGE',   cx + 220, cy - 86, 18, '#888', 'right');

            const wpnNames = ['PISTOL', 'SHOTGUN', 'PLASMA'];
            const wpnColor = ['#fff', '#f80', '#0ff'];
            const rowH = 48;
            for (let i = 0; i < 3; ++i)
            {
                const ry = cy - 56 + i * rowH;
                const s = weaponStats[i];
                const acc = s.fired > 0 ? Math.round(s.hits / s.fired * 100) : 0;
                hudText(wpnNames[i], cx - 220, ry, 22, wpnColor[i], 'left');
                hudText(String(s.fired),  cx -  60, ry, 22, '#fff', 'right');
                hudText(String(s.hits),   cx +  20, ry, 22, '#fff', 'right');
                hudText(String(s.kills),  cx + 100, ry, 22, '#fff', 'right');
                hudText(String(s.damage), cx + 220, ry, 22, '#fff', 'right');
                hudText(acc + '% accuracy', cx - 220, ry + 22, 14, 'rgba(180,200,220,0.7)', 'left');
            }

            const pulse = .5 + .5 * Math.sin(Date.now() / 500);
            hudText('Press OK to go back', cx, cy + 160, 18, `rgba(150,190,255,${pulse})`, 'center');
        }
        else if (pauseAchScreen)
        {
            // IMPROVEMENT 5.4: achievements sub-screen — list of all 8
            // achievements with a check mark next to the unlocked ones.
            mainContext.save();
            mainContext.fillStyle = 'rgba(5,5,20,0.95)';
            mainContext.beginPath();
            mainContext.roundRect(cx - 300, cy - 220, 600, 440, 20);
            mainContext.fill();
            mainContext.strokeStyle = '#ffe066';
            mainContext.lineWidth = 2;
            mainContext.stroke();
            mainContext.restore();

            hudText('ACHIEVEMENTS', cx, cy - 178, 36, '#ffe066', 'center');
            mainContext.save();
            mainContext.strokeStyle = '#553';
            mainContext.lineWidth = 1;
            mainContext.beginPath();
            mainContext.moveTo(cx - 240, cy - 142);
            mainContext.lineTo(cx + 240, cy - 142);
            mainContext.stroke();
            mainContext.restore();

            const unlockedCount = Object.keys(unlockedAchievements).length;
            hudText(unlockedCount + ' / ' + ACHIEVEMENTS.length + ' unlocked',
                    cx, cy - 110, 16, 'rgba(180,180,200,0.8)', 'center');

            const rowH = 38;
            for (let i = 0; i < ACHIEVEMENTS.length; ++i)
            {
                const a = ACHIEVEMENTS[i];
                const ry = cy - 84 + i * rowH;
                const got = unlockedAchievements[a.id];
                const c = got ? '#ffe066' : 'rgba(140,140,170,0.55)';
                hudText(got ? '\u2713' : '\u00B7',  cx - 260, ry, 22, got ? '#7fff7f' : '#666', 'left');
                hudText(a.name, cx - 230, ry, 20, c, 'left');
                hudText(a.desc, cx - 230, ry + 18, 12, 'rgba(180,200,220,0.65)', 'left');
            }

            const pulse = .5 + .5 * Math.sin(Date.now() / 500);
            hudText('Press OK to go back', cx, cy + 200, 18, `rgba(150,190,255,${pulse})`, 'center');
        }
        else
        {
            // ── Main pause panel — compact sidebar style ───────────────────────
            // Layout constants — all derived so the panel auto-sizes to its items.
            const items = [
                { icon: '\u25B6', label: 'Resume',       sub: '',                                  color: '#e8e8ff' },
                { icon: '\u266A', label: 'Music',        sub: musicMuted ? 'OFF' : 'ON',           color: musicMuted ? '#f88' : '#7fff7f' },
                { icon: '\u21BA', label: 'Restart',      sub: '',                                  color: '#ffaaaa' },
                { icon: '\u25A6', label: 'Stats',        sub: '',                                  color: '#7fdbff' },
                { icon: '\u2605', label: 'Scoreboard',   sub: '',                                  color: '#ffc85e' },
                { icon: '\u25CE', label: 'Achievements', sub: Object.keys(unlockedAchievements).length + '/' + ACHIEVEMENTS.length, color: '#ffe066' },
                { icon: '\u2139', label: 'About',        sub: '',                                  color: '#a8daff' },
            ];

            const ROW_H   = 42;   // height of each menu row
            const PAD_X   = 22;   // horizontal inner padding
            const PAD_TOP = 52;   // space above first row (header)
            const PAD_BOT = 36;   // space below last row (hint)
            const PW      = 290;  // panel width
            const PH      = PAD_TOP + items.length * ROW_H + PAD_BOT;
            const px      = cx - PW / 2;   // panel left edge
            const py      = cy - PH / 2;   // panel top edge

            // Panel background — dark glass with a subtle blue tint
            mainContext.save();
            mainContext.fillStyle = 'rgba(6,8,22,0.94)';
            mainContext.beginPath();
            mainContext.roundRect(px, py, PW, PH, 14);
            mainContext.fill();
            // thin border
            mainContext.strokeStyle = 'rgba(80,100,160,0.6)';
            mainContext.lineWidth = 1.5;
            mainContext.stroke();
            mainContext.restore();

            // Subtle inner-highlight fade — gradient cached so createLinearGradient()
            // is not called every frame while the pause menu is open.
            if (!_pauseGrad || _pauseGradPY !== py) {
                _pauseGradPY = py;
                _pauseGrad = mainContext.createLinearGradient(px, py, px, py + PH * 0.35);
                _pauseGrad.addColorStop(0, 'rgba(255,255,255,0.04)');
                _pauseGrad.addColorStop(1, 'rgba(255,255,255,0)');
            }
            mainContext.save();
            mainContext.fillStyle = _pauseGrad;
            mainContext.beginPath();
            mainContext.roundRect(px + 1, py + 1, PW - 2, PH * 0.35, 13);
            mainContext.fill();
            mainContext.restore();

            // Header — "II PAUSED" with a thin cyan top-bar accent
            mainContext.save();
            mainContext.fillStyle = '#7fdbff';
            mainContext.fillRect(px + PAD_X, py + 10, 28, 3);   // left accent tick
            mainContext.fillRect(px + PW - PAD_X - 28, py + 10, 28, 3); // right accent tick
            mainContext.restore();
            hudText('II  PAUSED', cx, py + 28, 18, 'rgba(180,210,255,0.9)', 'center');

            // Thin divider under header
            mainContext.save();
            mainContext.strokeStyle = 'rgba(80,100,160,0.45)';
            mainContext.lineWidth = 1;
            mainContext.beginPath();
            mainContext.moveTo(px + PAD_X, py + PAD_TOP - 6);
            mainContext.lineTo(px + PW - PAD_X, py + PAD_TOP - 6);
            mainContext.stroke();
            mainContext.restore();

            // Menu rows
            items.forEach((item, idx) => {
                const ry  = py + PAD_TOP + idx * ROW_H;
                const sel = pauseMenuOption === idx;
                const mid = ry + ROW_H / 2;

                if (sel) {
                    // Selected row: subtle fill + left neon accent bar
                    mainContext.save();
                    mainContext.fillStyle = 'rgba(127,219,255,0.08)';
                    mainContext.beginPath();
                    mainContext.roundRect(px + 6, ry + 3, PW - 12, ROW_H - 6, 7);
                    mainContext.fill();
                    // left accent bar — neon cyan glow
                    mainContext.fillStyle = '#7fdbff';
                    mainContext.shadowColor = '#7fdbff';
                    mainContext.shadowBlur  = lowGraphicsSettings ? 0 : 8;
                    mainContext.fillRect(px + 6, ry + 7, 3, ROW_H - 14);
                    mainContext.restore();
                }

                // Icon (monospace, dim when not selected)
                hudText(item.icon, px + PAD_X + 14, mid, 16,
                        sel ? '#7fdbff' : 'rgba(140,160,200,0.55)', 'center');

                // Label
                hudText(item.label, px + PAD_X + 28, mid, sel ? 18 : 17,
                        sel ? '#ffe066' : item.color, 'left');

                // Sub-label badge (e.g. ON/OFF, 2/8)
                if (item.sub) {
                    const badgeX = px + PW - PAD_X;
                    const badgeColor = idx === 1
                        ? (musicMuted ? 'rgba(255,120,120,0.85)' : 'rgba(120,255,140,0.85)')
                        : 'rgba(180,200,230,0.7)';
                    hudText(item.sub, badgeX, mid, 13, badgeColor, 'right');
                }

                // Selection arrow
                if (sel)
                    hudText('\u203A', px + PW - PAD_X + 2, mid, 18, 'rgba(127,219,255,0.7)', 'right');
            });

            // Hint strip at the bottom of the panel
            hudText('Menuboard.Online \u2014 Stream Media for Hotels, Restaurants, Salons, GYM and Media Agencies',
                    cx, py + PH - 28, 10, 'rgba(255,224,102,0.55)', 'center');
            hudText('\u2191\u2193  Navigate     OK  Select',
                    cx, py + PH - 14, 11, 'rgba(110,130,170,0.65)', 'center');
        }
    }

    // IMPROVEMENT 6.2: GAME OVER panel is now drawn independently of the
    // pause-menu branch, so it stays visible even when the user has
    // pressed pause while dying. Drawn after the pause menu so it sits
    // on top of the dim backdrop in the layered-modal pattern.
    if (minDeadTime > 1 && playerLives <= 0)
    {
        const cx = mainCanvas.width / 2, cy = mainCanvas.height / 2;
        // dim backdrop (slightly stronger than the LEVEL CLEAR one so the
        // GAME OVER panel always reads first even with a pause menu behind)
        mainContext.fillStyle = 'rgba(0,0,0,0.78)';
        mainContext.fillRect(0, 0, mainCanvas.width, mainCanvas.height);

        // panel background — no shadowBlur on stroke (software-rendered on Fire TV every frame)
        mainContext.save();
        mainContext.fillStyle = 'rgba(10,10,30,0.95)';
        mainContext.beginPath();
        mainContext.roundRect(cx - 280, cy - 200, 560, 400, 20);
        mainContext.fill();
        mainContext.strokeStyle = '#b8860b';
        mainContext.lineWidth = 2.5;
        mainContext.shadowBlur = 0;
        mainContext.stroke();
        mainContext.restore();

        // title
        hudText('GAME OVER', cx, cy - 148, 64, '#ff4444', 'center');

        // gold divider
        mainContext.save();
        mainContext.strokeStyle = '#665500';
        mainContext.lineWidth = 1;
        mainContext.beginPath();
        mainContext.moveTo(cx - 220, cy - 104);
        mainContext.lineTo(cx + 220, cy - 104);
        mainContext.stroke();
        mainContext.restore();

        // stats
        const finalScore = score + levelScore;
        hudText('SCORE',        cx - 60, cy - 68, 16, '#888', 'right');
        hudText(finalScore,     cx - 44, cy - 68, 28, '#ffb347', 'left');
        hudText('LEVEL',        cx - 60, cy - 28, 16, '#888', 'right');
        hudText(level,          cx - 44, cy - 28, 28, '#7fdbff', 'left');
        hudText('KILLS',        cx - 60, cy + 12, 16, '#888', 'right');
        hudText(totalKills + levelKills, cx - 44, cy + 12, 28, '#ffffff', 'left');
        // IMPROVEMENT 2.3: tell the player what killed them — learning moment.
        hudText('Killed by:',  cx - 110, cy + 40, 16, '#a88', 'right');
        hudText(lastKillerName || 'unknown', cx - 94, cy + 40, 16, '#ffb347', 'left');

        // gold divider
        mainContext.save();
        mainContext.strokeStyle = '#665500';
        mainContext.lineWidth = 1;
        mainContext.beginPath();
        mainContext.moveTo(cx - 220, cy + 48);
        mainContext.lineTo(cx + 220, cy + 48);
        mainContext.stroke();
        mainContext.restore();

        // pulsing prompt
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 520);
        hudText('Press OK to play again', cx, cy + 86, 26, `rgba(255,224,102,${pulse})`, 'center');
        // The engine's remapFireTV() maps both Enter/OK (13) and the Fire TV
        // Rewind button to keyCode 82/91, so list each unique restart key once.
        hudText('(OK \u00B7 Z \u00B7 Space \u00B7 R \u00B7 Gamepad A)', cx, cy + 124, 16, 'rgba(140,140,170,0.7)', 'center');
    }

    // On-screen name-entry keyboard (active after a qualifying game-over run).
    // Drawn last so it covers everything — same modal-priority pattern as
    // the GAME OVER overlay above.
    if (nameEntryActive)
        drawNameEntry();

    // IMPROVEMENT 3.3: kill-streak banner — fades + pops in when the player
    // crosses a streak threshold. Drawn after every other overlay so it
    // sits on top of the HUD without being covered by panels.
    if (streakBannerTime > 0 && streakBannerText)
    {
        const t = streakBannerTime;
        const fade = t < 0.4 ? t / 0.4 : 1;
        const pop  = 1 + max(0, 0.15 - t) * 0.6;
        const cw = mainCanvas.width, ch = mainCanvas.height;
        const y = ch * 0.22 - (1.5 - t) * 20;
        hudText(streakBannerText, cw / 2, y, 38 * pop, `rgba(255, 240, 120, ${fade})`, 'center');
        if (streakCount >= 3)
            hudText('combo: ' + streakCount, cw / 2, y + 28, 18, `rgba(255, 255, 255, ${fade * 0.75})`, 'center');
    }

    // IMPROVEMENT 4.4: "LEVEL N" title card, fades in fast, holds, fades out
    // over the last 0.5s. Includes the objective hint so new players learn
    // that they need to clear enemies before the box ends the level.
    if (levelTitleTimer > 0)
    {
        const cw = mainCanvas.width, ch = mainCanvas.height;
        // 0.15s fade-in, 0.5s fade-out.
        const fadeIn  = min(1, (1.5 - levelTitleTimer) / .15);
        const fadeOut = levelTitleTimer < .5 ? levelTitleTimer / .5 : 1;
        const alpha = fadeIn * fadeOut;
        const pop = fadeIn < 1 ? 1 + (1 - fadeIn) * .4 : 1;
        // Dim backdrop
        mainContext.save();
        mainContext.fillStyle = `rgba(0, 0, 0, ${alpha * 0.45})`;
        mainContext.fillRect(0, 0, cw, ch);
        mainContext.restore();
        // Title
        hudText('LEVEL ' + level, cw / 2, ch * .40, 72 * pop, `rgba(255, 224, 102, ${alpha})`, 'center');
        // Gold accent line
        if (alpha > .3)
        {
            mainContext.save();
            mainContext.strokeStyle = `rgba(255, 224, 102, ${alpha * .8})`;
            mainContext.lineWidth = 2;
            mainContext.beginPath();
            mainContext.moveTo(cw / 2 - 100, ch * .40 + 44);
            mainContext.lineTo(cw / 2 + 100, ch * .40 + 44);
            mainContext.stroke();
            mainContext.restore();
        }
        // Objective hint
        hudText(levelTitleObjective, cw / 2, ch * .40 + 70, 22, `rgba(255, 255, 255, ${alpha * .85})`, 'center');
    }

    // IMPROVEMENT 5.4: achievement unlock toast — slides in from the right
    // and fades out over its 3-second lifetime. Drawn after every other
    // overlay so it sits on top of the HUD.
    if (achievementToastTime > 0 && achievementToastName)
    {
        const cw = mainCanvas.width, ch = mainCanvas.height;
        const t = achievementToastTime;
        const fade = t < 0.5 ? t / 0.5 : 1;
        const slide = max(0, 0.3 - t) * 200;
        const x = cw - 220 + slide;
        const y = ch * 0.12;
        mainContext.save();
        mainContext.fillStyle = `rgba(20, 20, 30, ${fade * 0.85})`;
        mainContext.beginPath();
        mainContext.roundRect(x - 200, y - 12, 200, 60, 10);
        mainContext.fill();
        mainContext.strokeStyle = `rgba(255, 224, 102, ${fade})`;
        mainContext.lineWidth = 2;
        mainContext.stroke();
        mainContext.restore();
        hudText('UNLOCKED', x - 190, y,     12, `rgba(255, 224, 102, ${fade})`,  'left');
        hudText(achievementToastName, x - 190, y + 18, 22, `rgba(255, 255, 255, ${fade})`, 'left');
    }

    // IMPROVEMENT 6.5: kill popups — floating "+N" text that rises and fades
    // from the kill location. Each popup is one text draw in world space.
    if (_killPopups.length)
    {
        for (let i = 0; i < _killPopups.length; ++i)
        {
            const p   = _killPopups[i];
            const t   = p.time / p.lifetime;        // 1 → 0
            const lift = (1 - t) * 0.7;             // rise 0.7 world units
            const worldPos = vec2(p.pos.x, p.pos.y + lift);
            // draw at world position, scaled by cameraScale
            const sp = worldToScreen(worldPos);
            const size  = 18 * (1 + (1 - t) * .25);
            const color = p.color.startsWith('rgba') ? p.color
                : (p.color.startsWith('#')
                    ? p.color + ((t * 255) | 0).toString(16).padStart(2, '0')
                    : p.color);
            mainContext.save();
            mainContext.font = `bold ${size}px impact`;
            mainContext.textAlign = 'center';
            mainContext.textBaseline = 'middle';
            mainContext.fillStyle = color;
            mainContext.shadowColor = 'rgba(0,0,0,0.95)';
            mainContext.shadowBlur = lowGraphicsSettings ? 0 : 5;
            mainContext.fillText('+' + p.value, sp.x, sp.y);
            mainContext.restore();
        }
    }

    // IMPROVEMENT 6.1: tutorial overlay — bottom-of-screen banner for the
    // current step. Step counter in the corner so the player knows it's
    // multi-step. Drawn last so it sits on top of every other overlay.
    if (tutActive && tutStep >= 0 && tutStep < TUT_STEPS.length)
    {
        const cw = mainCanvas.width, ch = mainCanvas.height;
        const [label, desc] = TUT_STEPS[tutStep];
        const t = tutStepTime;
        const fade = min(1, (3.5 - t) / .25) * min(1, t / .25);
        const boxH = 110;
        const boxY = ch - boxH - 30;
        mainContext.save();
        mainContext.fillStyle = `rgba(10, 20, 30, ${fade * 0.9})`;
        mainContext.beginPath();
        mainContext.roundRect(cw / 2 - 320, boxY, 640, boxH, 14);
        mainContext.fill();
        mainContext.strokeStyle = `rgba(127, 219, 255, ${fade})`;
        mainContext.lineWidth = 2;
        mainContext.stroke();
        mainContext.restore();
        // Step counter
        hudText('STEP ' + (tutStep + 1) + ' / ' + TUT_STEPS.length,
                cw / 2 - 300, boxY + 12, 13, `rgba(127, 219, 255, ${fade * 0.85})`, 'left');
        // Controls
        hudText(label, cw / 2, boxY + 42, 28, `rgba(255, 255, 255, ${fade})`, 'center');
        // Description
        hudText(desc, cw / 2, boxY + 76, 16, `rgba(200, 220, 240, ${fade * 0.85})`, 'center');
    }
});

///////////////////////////////////////////////////////////////////////////////
// Visibility / lifecycle handler
// On Fire TV (and Android WebView in general) the EGL/WebGL context is
// suspended when the app goes to background.  When it returns there are a
// few frames where the GL and 2D canvas states are inconsistent, producing
// a visible flash.  Pausing immediately on hide stops the WebGL render loop
// before that can happen, so the app returns to a static pause panel instead.
document.addEventListener('visibilitychange', () =>
{
    if (document.hidden)
    {
        // App went to background — pause right away.
        // Reset the pause menu so the user returns to a clean screen.
        if (typeof paused !== 'undefined' && !paused)
        {
            togglePause();
            pauseMenuOption     = 0;
            pauseAboutScreen    = false;
            pauseScoreboardScreen = false;
            // Cancel any pending name entry so the user doesn't return to a
            // frozen keyboard. The score is lost on dismissal — acceptable
            // because the user explicitly backgrounded the app.
            if (nameEntryActive)
            {
                nameEntryActive = false;
                nameEntryBuffer = '';
            }
        }
    }
    else
    {
        // App returned to foreground.
        // Android/Fire TV suspends the AudioContext while backgrounded;
        // resume it so music and sound effects work immediately.
        if (typeof audioContext !== 'undefined' && audioContext &&
            audioContext.state === 'suspended')
            audioContext.resume().catch(() => {});
    }
});
