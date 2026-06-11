/*
    Javascript Space Game
    By Frank Force 2021

*/

'use strict';

const clampCamera = !debug;
const lowGraphicsSettings = glOverlay = !window['chrome']; // only chromium uses high settings
// Fire TV: scale 56 (was 64) — gives the player more presence on a 16:9
// 720p canvas and reduces the "lost in the level" feeling.
const startCameraScale = 4*14;
const defaultCameraScale = 4*14;
const maxPlayers = 4;

const team_none = 0;
const team_player = 1;
const team_enemy = 2;

let updateWindowSize, renderWindowSize, gameplayWindowSize;

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
    let minDeadTime = 1e3;
    for(const player of players)
        minDeadTime = min(minDeadTime, player && player.isDead() ? player.deadTimer.get() : 0);

    // Fire TV: also accept OK (raw 13) and the tap-fire mapped key (91)
    // as restart triggers, since on the remote the user has no Z/Space/GpadA.
    if (minDeadTime > 3 && (keyWasPressed(90) || keyWasPressed(32) || keyWasPressed(13) || keyWasPressed(91) || gamepadWasPressed(0)) || keyWasPressed(82))
        resetGame();

    if (levelEndTimer.get() > 3)
        nextLevel();
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
    const p = percent(gameTimer.get(), 8, 10);

    //mainContext.globalCompositeOperation = 'difference';
    mainContext.fillStyle = new Color(0,0,0,p).rgba();
    if (p > 0)
    {
        //mainContext.fillStyle = (new Color).setHSLA(time/3,1,.5,p).rgba();
        mainContext.font = '1.5in impact';
        mainContext.fillText('SPACE HUGGERS', mainCanvas.width/2, 140);
    }

    mainContext.font = '.5in impact';
    p > 0 && mainContext.fillText('A JS13K Game by Frank Force',mainCanvas.width/2, 210);

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

    mainContext.fillStyle = new Color(0,0,0).rgba();
    mainContext.fillText('Level ' + level + '      Lives ' + playerLives + '      Enemies ' + enemiesCount, mainCanvas.width/2, mainCanvas.height-40);

    // fade in level transition
    const fade = levelEndTimer.isSet() ? percent(levelEndTimer.get(), 3, 1) : percent(levelTimer.get(), .5, 2);
    drawRect(cameraPos, vec2(1e3), new Color(0,0,0,fade))

    // Fire TV pause overlay (drawn last so it covers everything)
    if (paused)
    {
        mainContext.fillStyle = 'rgba(0,0,0,.6)';
        mainContext.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
        mainContext.fillStyle = '#fff';
        mainContext.font = 'bold 96px arial';
        mainContext.textAlign = 'center';
        mainContext.textBaseline = 'middle';
        mainContext.fillText('PAUSED', mainCanvas.width/2, mainCanvas.height/2 - 40);
        mainContext.font = '32px arial';
        mainContext.fillText('Press Play/Pause on your Fire TV remote to resume', mainCanvas.width/2, mainCanvas.height/2 + 40);
        mainContext.textBaseline = 'top';
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