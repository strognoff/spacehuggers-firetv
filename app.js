/*
    Javascript Space Game
    By Frank Force 2021

*/

'use strict';

const clampCamera = !debug;
const lowGraphicsSettings = glOverlay = !window['chrome']; // only chromium uses high settings
// Camera scale: 36px per world unit on start, 32px default for a wider TV-friendly view.
const startCameraScale = 4*9;
const defaultCameraScale = 4*8;
const maxPlayers = 4;

const team_none = 0;
const team_player = 1;
const team_enemy = 2;
const APP_VERSION = '1.0.61';

let updateWindowSize, renderWindowSize, gameplayWindowSize;
let minDeadTime = 0;
let cameraShake = 0;
let pauseMenuOption  = 0;     // 0=Resume 1=Music 2=Restart 3=About
let pauseAboutScreen = false; // shows about overlay within pause

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
    list.push({ name: name || 'AAA', score: score|0, level: level|0, date: Date.now() });
    list.sort((a,b)=> b.score - a.score);
    saveHighScores(list.slice(0, HS_MAX));
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
            nameEntryActive = false;
            nameEntryBuffer = '';
            resetGame();
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
    mainContext.save();
    mainContext.font = `bold ${size}px impact`;
    mainContext.textAlign = align;
    mainContext.textBaseline = 'middle';
    mainContext.fillStyle = color;
    mainContext.shadowColor = 'rgba(0,0,0,0.8)';
    mainContext.shadowBlur = 4;
    mainContext.fillText(txt, x, y);
    mainContext.restore();
};
const hudMonoText = (txt, x, y, size, color='#fff', align='left', bold=0) => {
    mainContext.save();
    mainContext.font = `${bold ? '700' : '500'} ${size}px monospace`;
    mainContext.textAlign = align;
    mainContext.textBaseline = 'middle';
    mainContext.fillStyle = color;
    mainContext.shadowColor = color;
    mainContext.shadowBlur = bold ? 8 : 4;
    mainContext.fillText(txt, x, y);
    mainContext.restore();
};
// angular bracket HUD frame: 4 corner brackets, dim fill, no full outline
const hudFrame = (x, y, w, h, color, alpha=.15) => {
    const inset = 2;
    const ix = x + inset, iy = y + inset, iw = w - inset*2, ih = h - inset*2;
    const bracket = min(18, iw * .22, ih * .45);
    mainContext.save();
    mainContext.fillStyle = `rgba(0,0,0,${alpha})`;
    mainContext.fillRect(ix, iy, iw, ih);
    mainContext.strokeStyle = color;
    mainContext.lineWidth = 1.5;
    mainContext.shadowColor = color;
    mainContext.shadowBlur = 8;
    mainContext.beginPath();
    mainContext.moveTo(ix, iy + bracket); mainContext.lineTo(ix, iy); mainContext.lineTo(ix + bracket, iy);
    mainContext.moveTo(ix + iw - bracket, iy); mainContext.lineTo(ix + iw, iy); mainContext.lineTo(ix + iw, iy + bracket);
    mainContext.moveTo(ix + iw, iy + ih - bracket); mainContext.lineTo(ix + iw, iy + ih); mainContext.lineTo(ix + iw - bracket, iy + ih);
    mainContext.moveTo(ix + bracket, iy + ih); mainContext.lineTo(ix, iy + ih); mainContext.lineTo(ix, iy + ih - bracket);
    mainContext.stroke();
    mainContext.restore();
};

// Render the name-entry overlay. Replaces the GAME OVER panel while active.
const drawNameEntry = ()=>
{
    const cw = mainCanvas.width, ch = mainCanvas.height;
    const cx = cw/2, cy = ch/2;
    // dim
    mainContext.fillStyle = 'rgba(0,0,0,.78)';
    mainContext.fillRect(0, 0, cw, ch);
    // panel
    mainContext.save();
    mainContext.fillStyle = 'rgba(10,10,30,0.95)';
    mainContext.beginPath();
    mainContext.roundRect(cx - 320, cy - 230, 640, 460, 20);
    mainContext.fill();
    mainContext.strokeStyle = '#665';
    mainContext.lineWidth = 2;
    mainContext.stroke();
    mainContext.restore();

    hudText('NEW HIGH SCORE!', cx, cy - 195, 32, '#ffe066', 'center');
    hudText('Score: ' + nameEntryFinalScore + '   \u00B7   Level ' + nameEntryFinalLevel,
            cx, cy - 155, 18, '#aaa', 'center');

    // buffer display — three slots, fills with typed chars
    const slotW = 60, slotH = 70, slotGap = 12;
    const slotsTotalW = slotW * 3 + slotGap * 2;
    const slotY = cy - 110;
    const slotX0 = cx - slotsTotalW/2;
    for (let i = 0; i < 3; i++)
    {
        const sx = slotX0 + i * (slotW + slotGap);
        mainContext.save();
        mainContext.fillStyle = 'rgba(255,255,255,0.05)';
        mainContext.beginPath();
        mainContext.roundRect(sx, slotY, slotW, slotH, 8);
        mainContext.fill();
        mainContext.strokeStyle = '#556';
        mainContext.lineWidth = 1;
        mainContext.stroke();
        mainContext.restore();
        const ch = nameEntryBuffer[i];
        if (ch) hudText(ch, sx + slotW/2, slotY + slotH/2, 44, '#ffe066', 'center');
    }
    // typing hint
    const hint = nameEntryBuffer.length === 0
        ? 'Pick letters to enter your name'
        : (nameEntryBuffer.length < 3 ? (3 - nameEntryBuffer.length) + ' more letter' + (3 - nameEntryBuffer.length === 1 ? '' : 's') + ' (or OK to confirm \"' + nameEntryBuffer + '\")'
                                     : 'Press OK to save');
    hudText(hint, cx, cy - 18, 16, '#8ef', 'center');

    // keyboard grid
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
            mainContext.save();
            mainContext.fillStyle = sel ? 'rgba(255,224,102,0.25)' : 'rgba(255,255,255,0.06)';
            mainContext.beginPath();
            mainContext.roundRect(kx, ky, keyW, keyH, 8);
            mainContext.fill();
            mainContext.strokeStyle = sel ? '#ffe066' : '#445';
            mainContext.lineWidth = sel ? 2 : 1;
            mainContext.stroke();
            mainContext.restore();
            // use a smaller font for BKSP so the glyph fits
            const isBksp = label === '\u232B';
            hudText(label || '', kx + keyW/2, ky + keyH/2, isBksp ? 24 : 28,
                    sel ? '#ffe066' : '#ddd', 'center');
        }
    }

    hudText('D-Pad Navigate   OK Select   \u232B Backspace   (3 letters max)',
            cx, cy + 200, 14, 'rgba(140,140,170,0.8)', 'center');
};

engineInit(

///////////////////////////////////////////////////////////////////////////////
()=> // appInit 
{
    resetGame();
    cameraScale = startCameraScale;
},

///////////////////////////////////////////////////////////////////////////////
()=> // appUpdate
{
    // If the on-screen name-entry keyboard is up, it owns all input until the
    // name is confirmed. Run it first so it can clearInput() and prevent the
    // restart trigger / player movement from also firing this frame. We still
    // let the rest of the update run (camera/window sizes, world tick) so the
    // background keeps rendering behind the keyboard overlay.
    if (nameEntryActive)
        updateNameEntry();

    const cameraSize = vec2(mainCanvas.width, mainCanvas.height).scale(1/cameraScale);
    renderWindowSize = cameraSize.add(vec2(5));

    gameplayWindowSize = vec2(mainCanvas.width, mainCanvas.height).scale(1/defaultCameraScale);
    updateWindowSize = gameplayWindowSize.add(vec2(30));
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

    // Fire TV: also accept OK (raw 13) and the tap-fire mapped key (91)
    // as restart triggers, since on the remote the user has no Z/Space/GpadA.
    // Skip the restart while the name-entry keyboard is up — it owns OK input.
    if (!nameEntryActive && minDeadTime > 3 && (keyWasPressed(90) || keyWasPressed(32) || keyWasPressed(13) || keyWasPressed(91) || gamepadWasPressed(0)) || keyWasPressed(82))
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
        }
        else
        {
            resetGame();
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

    if (players.length == 1)
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

    // trauma-decay screen shake
    if (cameraShake > 0) {
        const shakeAmt = cameraShake * cameraShake;
        cameraPos = cameraPos.add(vec2((Math.random()*2-1)*shakeAmt*0.5, (Math.random()*2-1)*shakeAmt*0.5));
        cameraShake = max(0, cameraShake - 0.05);
    }

    updateParallaxLayers();

    updateSky();
},

///////////////////////////////////////////////////////////////////////////////
()=> // appRender
{
    const gradient = mainContext.createLinearGradient(0,0,0,mainCanvas.height);
    gradient.addColorStop(0,levelSkyColor.rgba());
    gradient.addColorStop(1,levelSkyHorizonColor.rgba());
    mainContext.fillStyle = gradient;
    //mainContext.fillStyle = levelSkyColor.rgba();
    mainContext.fillRect(0,0,mainCanvas.width, mainCanvas.height);

    drawStars();

    // Fire TV / controller hint: show a small key-binding strip in the
    // bottom-left of the canvas. Switches between gamepad glyphs, the
    // Fire TV remote, and keyboard labels depending on the last input used.
    {
        const w = mainCanvas.width, h = mainCanvas.height;
        mainContext.save();
        mainContext.globalAlpha = .7;
        mainContext.font = '24px arial';
        mainContext.textBaseline = 'top';
        mainContext.fillStyle = '#fff';
        const label = isUsingFireTVRemote
            ? 'D-Pad Move  OK Shoot   \u275A\u275A Pause   \u23EA Grenade   \u23E9 Roll   (hold 3s after death to restart, press at level end to skip)'
            : isUsingGamepad
                ? '[A] Shoot    [B] Roll    [X] Grenade    [Y] Thrust    D-Pad Move'
                : '[Z] Shoot  [X] Roll  [C] Grenade  WASD/D-Pad Move';
        mainContext.fillText(label, 16, h - 36);
        mainContext.restore();
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
        const pos = vec2(mainCanvas.width/2 + (enemy.pos.x - cameraPos.x)*30,mainCanvas.height-20);
        drawRectScreenSpace(pos, enemy.size.scale(20), enemy.color.scale(1,.6));
    }

    if (!enemiesCount && !levelEndTimer.isSet())
        levelEndTimer.set();

    // hudPill / hudText are defined at module scope (above drawNameEntry)

    const pad = 14, cw = mainCanvas.width, ch = mainCanvas.height;
    const frameH = 60;
    const labelColor = 'rgba(255,255,255,0.72)';
    const bracketColor = '#7fdbff';
    const totalScore = score + levelScore;
    const drawHudPanel = (x, y, w, label, value, color, align='left') =>
    {
        hudFrame(x, y, w, frameH, bracketColor);
        const accentW = w * .3;
        const accentY = y + frameH - 10;
        mainContext.save();
        mainContext.strokeStyle = color;
        mainContext.lineWidth = 1.5;
        mainContext.shadowColor = color;
        mainContext.shadowBlur = 8;
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
    drawHudPanel(cw/2 - 90, pad, 180, 'LEVEL', level, '#7fdbff', 'center');

    // ── Lives panel — top right ───────────────────────────────────────────────
    drawHudPanel(cw - pad - 170, pad, 170, 'LIVES', Math.max(0, playerLives), '#ff5050', 'right');

    // ── Threats panel — bottom center ─────────────────────────────────────────
    const threatsValue = enemiesCount > 0 ? enemiesCount + ' REMAINING' : 'AREA CLEAR';
    const threatsColor = enemiesCount > 0 ? '#7fff7f' : '#ffb347';
    drawHudPanel(cw/2 - 140, ch - pad - frameH, 280, 'THREATS', threatsValue, threatsColor, 'center');

    // ── Kills panel — bottom left (during play) ───────────────────────────────
    if (levelKills > 0)
        drawHudPanel(pad, ch - pad - frameH, 220, 'KILLS', levelKills + '  +' + levelScore, '#ffffff');

    // ── Time panel — bottom right (during play, mirrors KILLS) ───────────────
    if (!levelEndTimer.isSet()) {
        const elapsed = Math.max(0, time - levelStartTime) | 0;
        const mm = (elapsed / 60) | 0;
        const ss = String(elapsed % 60).padStart(2, '0');
        drawHudPanel(cw - pad - 180, ch - pad - frameH, 180, 'TIME', mm + ':' + ss, '#7fdbff', 'right');
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

    // ── Pause menu ────────────────────────────────────────────────────────────
    if (paused)
    {
        const MENU_ITEMS = 5;
        // IMPORTANT: clearInput() after every action — when paused the engine
        // never clears keyWasPressed flags so without it actions fire every frame.
        if (keyWasPressed(38) || gamepadWasPressed(12))
        {
            if (pauseAboutScreen || pauseScoreboardScreen) { pauseAboutScreen = pauseScoreboardScreen = false; }
            else { pauseMenuOption = (pauseMenuOption - 1 + MENU_ITEMS) % MENU_ITEMS; }
            clearInput();
        }
        else if (keyWasPressed(40) || gamepadWasPressed(13))
        {
            if (!pauseAboutScreen && !pauseScoreboardScreen)
                pauseMenuOption = (pauseMenuOption + 1) % MENU_ITEMS;
            clearInput();
        }
        else if (keyWasPressed(13) || keyWasPressed(90) || keyWasPressed(32) || keyWasPressed(91) || gamepadWasPressed(0))
        {
            if (pauseAboutScreen)
            {
                pauseAboutScreen = false; // back from about
            }
            else if (pauseScoreboardScreen)
            {
                pauseScoreboardScreen = false; // back from scoreboard
            }
            else if (pauseMenuOption === 0)
            {
                pauseAboutScreen = pauseScoreboardScreen = false;
                togglePause(); // resume
            }
            else if (pauseMenuOption === 1)
            {
                setMusicMute(musicMuted ? 0 : 1); // toggle music
            }
            else if (pauseMenuOption === 2)
            {
                pauseAboutScreen = pauseScoreboardScreen = false;
                togglePause();
                resetGame(); // restart
            }
            else if (pauseMenuOption === 3)
            {
                pauseAboutScreen = pauseScoreboardScreen = false;
                pauseScoreboardScreen = true; // open scoreboard
            }
            else if (pauseMenuOption === 4)
            {
                pauseAboutScreen = false;
                pauseAboutScreen = true; // open about
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

            const list = loadHighScores();
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

            hudText('Original game', cx, cy - 82, 18, '#aaa', 'center');
            hudText('Frank Force', cx, cy - 52, 26, '#fff', 'center');
            hudText('X: @KilledByAPixel', cx, cy - 24, 20, '#8ef', 'center');

            mainContext.save();
            mainContext.strokeStyle = '#334';
            mainContext.lineWidth = 1;
            mainContext.beginPath();
            mainContext.moveTo(cx - 240, cy + 10);
            mainContext.lineTo(cx + 240, cy + 10);
            mainContext.stroke();
            mainContext.restore();

            hudText('Add-ons & Fire TV port', cx, cy + 40, 18, '#aaa', 'center');
            hudText('Jeff Cechinel', cx, cy + 68, 26, '#fff', 'center');
            hudText('X: @Cechineljeff', cx, cy + 96, 20, '#8ef', 'center');
            hudText('Version ' + APP_VERSION, cx, cy + 126, 18, '#aaa', 'center');
            hudText('Music: ' + (currentMusicStyleName || 'calm mix'), cx, cy + 148, 18, '#8aa', 'center');

            const pulse = .5 + .5 * Math.sin(Date.now() / 500);
            hudText('Press OK to go back', cx, cy + 170, 18, `rgba(150,190,255,${pulse})`, 'center');
        }
        else
        {
            // ── Main pause panel ──────────────────────────────────────────────
            mainContext.save();
            mainContext.fillStyle = 'rgba(10,10,30,0.92)';
            mainContext.beginPath();
            mainContext.roundRect(cx - 280, cy - 210, 560, 420, 20);
            mainContext.fill();
            mainContext.strokeStyle = '#445';
            mainContext.lineWidth = 2;
            mainContext.stroke();
            mainContext.restore();

            hudText('PAUSED', cx, cy - 158, 52, '#fff', 'center');

            // gold divider under title
            mainContext.save();
            mainContext.strokeStyle = '#334';
            mainContext.lineWidth = 1;
            mainContext.beginPath();
            mainContext.moveTo(cx - 220, cy - 122);
            mainContext.lineTo(cx + 220, cy - 122);
            mainContext.stroke();
            mainContext.restore();

            const items = [
                { label: '\u25B6  Resume',                                        color: '#fff'  },
                { label: (musicMuted ? '\uD83D\uDD07  Music: OFF' : '\uD83D\uDD0A  Music: ON'), color: musicMuted ? '#f88' : '#8f8' },
                { label: '\u21BA  Restart Game',                                  color: '#faa'  },
                { label: '\uD83C\uDFC6  Scoreboard',                              color: '#fc6'  },
                { label: '\u2139\uFE0F  About',                                   color: '#adf'  },
            ];
            items.forEach((item, idx) => {
                const iy  = cy - 100 + idx * 58;
                const sel = pauseMenuOption === idx;
                if (sel) {
                    mainContext.save();
                    mainContext.fillStyle = 'rgba(255,255,255,0.10)';
                    mainContext.beginPath();
                    mainContext.roundRect(cx - 220, iy - 22, 440, 44, 10);
                    mainContext.fill();
                    mainContext.restore();
                }
                hudText((sel ? '\u203A ' : '  ') + item.label, cx, iy, 26,
                        sel ? '#ffe066' : item.color, 'center');
            });

            hudText('\u2191\u2193 Navigate   OK Confirm', cx, cy + 188, 18, 'rgba(140,140,170,0.8)', 'center');
        }
    }

    // Fire TV / game-over overlay: shown when all players are dead and
    // lives are exhausted. Tells the user which button restarts the game,
    // since on the remote the keyboard hints (Z/Space) don't apply.
    else if (minDeadTime > 1 && playerLives <= 0)
    {
        const cx = mainCanvas.width / 2, cy = mainCanvas.height / 2;
        // dim backdrop
        mainContext.fillStyle = 'rgba(0,0,0,0.72)';
        mainContext.fillRect(0, 0, mainCanvas.width, mainCanvas.height);

        // panel background
        mainContext.save();
        mainContext.fillStyle = 'rgba(10,10,30,0.95)';
        mainContext.beginPath();
        mainContext.roundRect(cx - 280, cy - 200, 560, 400, 20);
        mainContext.fill();
        mainContext.strokeStyle = '#b8860b';
        mainContext.lineWidth = 2.5;
        mainContext.shadowColor = '#ffe066';
        mainContext.shadowBlur = 14;
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
        hudText('(Z, Space, R  \u00B7  Gamepad A  \u00B7  Rewind)', cx, cy + 124, 16, 'rgba(140,140,170,0.7)', 'center');
    }

    // On-screen name-entry keyboard (active after a qualifying game-over run).
    // Drawn last so it covers everything — same modal-priority pattern as
    // the GAME OVER overlay above.
    if (nameEntryActive)
        drawNameEntry();
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
