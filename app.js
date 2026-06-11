/*
    Javascript Space Game
    By Frank Force 2021

*/

'use strict';

const clampCamera = !debug;
const lowGraphicsSettings = glOverlay = !window['chrome']; // only chromium uses high settings
// Camera scale: 36px per world unit — shows ~35 tiles wide on 1280px canvas.
const startCameraScale = 4*9;
const defaultCameraScale = 4*9;
const maxPlayers = 4;

const team_none = 0;
const team_player = 1;
const team_enemy = 2;

let updateWindowSize, renderWindowSize, gameplayWindowSize;
let minDeadTime = 0;
let cameraShake = 0;
let pauseMenuOption  = 0;     // 0=Resume 1=Music 2=Restart 3=About
let pauseAboutScreen = false; // shows about overlay within pause

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
    if (minDeadTime > 3 && (keyWasPressed(90) || keyWasPressed(32) || keyWasPressed(13) || keyWasPressed(91) || gamepadWasPressed(0)) || keyWasPressed(82))
        resetGame();

    // advance to next level only on explicit OK/confirm press
    if (levelEndTimer.isSet() && !paused && !(minDeadTime > 3 && playerLives <= 0))
    {
        if (keyWasPressed(13) || keyWasPressed(90) || keyWasPressed(32) || keyWasPressed(91) ||
            keyWasPressed(78) || gamepadWasPressed(0))
            nextLevel();
    }
},

///////////////////////////////////////////////////////////////////////////////
()=> // appUpdatePost
{
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
            ? 'D-Pad Move  OK Shoot   \u275A\u275A Pause   \u23EA Restart   \u23E9 Next'
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
    for (const o of engineCollideObjects)
    {
        if (o.isCharacter && o.team  == team_enemy)
        {
            ++enemiesCount;
            const pos = vec2(mainCanvas.width/2 + (o.pos.x - cameraPos.x)*30,mainCanvas.height-20);
            drawRectScreenSpace(pos, o.size.scale(20), o.color.scale(1,.6));
        }
    }

    if (!enemiesCount && !levelEndTimer.isSet())
        levelEndTimer.set();

    // ── HUD helpers ───────────────────────────────────────────────────────────
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

    const pad = 14, pillH = 40, cw = mainCanvas.width, ch = mainCanvas.height;
    const totalScore = score + levelScore;

    // ── Score pill — top left ──────────────────────────────────────────────────
    hudPill(pad, pad, 230, pillH);
    hudText('⭐ ' + totalScore, pad + 18, pad + pillH/2, 22, '#ffe066');

    // ── Level pill — top center ────────────────────────────────────────────────
    hudPill(cw/2 - 90, pad, 180, pillH);
    hudText('LEVEL  ' + level, cw/2, pad + pillH/2, 22, '#8ef', 'center');

    // ── Lives pill — top right ─────────────────────────────────────────────────
    hudPill(cw - pad - 160, pad, 160, pillH);
    hudText('♥  ' + Math.max(0, playerLives), cw - pad - 18, pad + pillH/2, 22, '#f66', 'right');

    // ── Enemies pill — bottom center ──────────────────────────────────────────
    const enemyLabel = enemiesCount > 0 ? '👾 ' + enemiesCount + ' remaining' : '✓ Area clear';
    const enemyColor = enemiesCount > 0 ? '#f96' : '#6f6';
    hudPill(cw/2 - 130, ch - pad - pillH, 260, pillH);
    hudText(enemyLabel, cw/2, ch - pad - pillH/2, 20, enemyColor, 'center');

    // ── Level-kills pill — bottom left (during play) ───────────────────────────
    if (levelKills > 0) {
        hudPill(pad, ch - pad - pillH, 200, pillH);
        hudText('☠ ' + levelKills + ' kills  +' + levelScore, pad + 18, ch - pad - pillH/2, 18, '#ccc');
    }

    // ── LEVEL CLEAR overlay panel — stays until player presses OK ────────────
    if (typeof levelEndTimer !== 'undefined' && levelEndTimer.isSet()) {
        // dim the background
        mainContext.fillStyle = 'rgba(0,0,0,0.6)';
        mainContext.fillRect(0, 0, cw, ch);

        const ox = cw/2, oy = ch/2;
        mainContext.save();
        mainContext.fillStyle = 'rgba(0,0,0,0.82)';
        mainContext.beginPath();
        mainContext.roundRect(ox - 280, oy - 110, 560, 220, 20);
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
        // pulsing prompt
        const pulse = .6 + .4 * Math.sin(Date.now() / 400);
        hudText('Press OK to continue', ox, oy + 80, 22, `rgba(180,220,255,${pulse})`, 'center');
    }

    // fade only during level-start transition (not while end screen is shown)
    const fade = levelEndTimer.isSet() ? 0 : percent(levelTimer.get(), .5, 2);
    drawRect(cameraPos, vec2(1e3), new Color(0,0,0,fade))

    // ── Pause menu ────────────────────────────────────────────────────────────
    if (paused)
    {
        const MENU_ITEMS = 4;
        // IMPORTANT: clearInput() after every action — when paused the engine
        // never clears keyWasPressed flags so without it actions fire every frame.
        if (keyWasPressed(38) || gamepadWasPressed(12))
        {
            if (pauseAboutScreen) { pauseAboutScreen = false; }
            else { pauseMenuOption = (pauseMenuOption - 1 + MENU_ITEMS) % MENU_ITEMS; }
            clearInput();
        }
        else if (keyWasPressed(40) || gamepadWasPressed(13))
        {
            if (!pauseAboutScreen)
                pauseMenuOption = (pauseMenuOption + 1) % MENU_ITEMS;
            clearInput();
        }
        else if (keyWasPressed(13) || keyWasPressed(90) || keyWasPressed(32) || keyWasPressed(91) || gamepadWasPressed(0))
        {
            if (pauseAboutScreen)
            {
                pauseAboutScreen = false; // back from about
            }
            else if (pauseMenuOption === 0)
            {
                pauseAboutScreen = false;
                togglePause(); // resume
            }
            else if (pauseMenuOption === 1)
            {
                setMusicMute(musicMuted ? 0 : 1); // toggle music
            }
            else if (pauseMenuOption === 2)
            {
                pauseAboutScreen = false;
                togglePause();
                resetGame(); // restart
            }
            else if (pauseMenuOption === 3)
            {
                pauseAboutScreen = true; // open about
            }
            clearInput();
        }

        const cx = mainCanvas.width/2, cy = mainCanvas.height/2;

        // dim backdrop
        mainContext.fillStyle = 'rgba(0,0,0,0.75)';
        mainContext.fillRect(0, 0, mainCanvas.width, mainCanvas.height);

        if (pauseAboutScreen)
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

            const pulse = .5 + .5 * Math.sin(Date.now() / 500);
            hudText('Press OK to go back', cx, cy + 148, 18, `rgba(150,190,255,${pulse})`, 'center');
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
                { label: '\u2139\uFE0F  About',                                   color: '#adf'  },
            ];
            items.forEach((item, idx) => {
                const iy  = cy - 78 + idx * 68;
                const sel = pauseMenuOption === idx;
                if (sel) {
                    mainContext.save();
                    mainContext.fillStyle = 'rgba(255,255,255,0.10)';
                    mainContext.beginPath();
                    mainContext.roundRect(cx - 220, iy - 24, 440, 48, 10);
                    mainContext.fill();
                    mainContext.restore();
                }
                hudText((sel ? '\u203A ' : '  ') + item.label, cx, iy, 28,
                        sel ? '#ffe066' : item.color, 'center');
            });

            hudText('\u2191\u2193 Navigate   OK Confirm', cx, cy + 185, 18, 'rgba(140,140,170,0.8)', 'center');
        }
    }

    // Fire TV / game-over overlay: shown when all players are dead and
    // lives are exhausted. Tells the user which button restarts the game,
    // since on the remote the keyboard hints (Z/Space) don't apply.
    else if (minDeadTime > 1 && playerLives <= 0)
    {
        mainContext.fillStyle = 'rgba(0,0,0,.55)';
        mainContext.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
        mainContext.fillStyle = '#f55';
        mainContext.font = 'bold 120px impact';
        mainContext.textAlign = 'center';
        mainContext.textBaseline = 'middle';
        mainContext.fillText('GAME OVER', mainCanvas.width/2, mainCanvas.height/2 - 60);
        mainContext.fillStyle = '#fff';
        mainContext.font = '40px arial';
        mainContext.fillText('Press OK  \u2014  or Rewind  \u2014  to restart', mainCanvas.width/2, mainCanvas.height/2 + 40);
        mainContext.font = '28px arial';
        mainContext.fillStyle = '#aaa';
        mainContext.fillText('(Keyboard: Z, Space, or R  \u00B7  Gamepad: A)', mainCanvas.width/2, mainCanvas.height/2 + 90);
        mainContext.textBaseline = 'top';
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
            pauseMenuOption  = 0;
            pauseAboutScreen = false;
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