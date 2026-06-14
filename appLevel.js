/*
    Javascript Space Game
    By Frank Force 2021

*/

'use strict';

const tileType_ladder  = -1;
const tileType_empty   = 0;
const tileType_solid   = 1;
const tileType_dirt    = 2;
const tileType_base    = 3;
const tileType_pipeH   = 4;
const tileType_pipeV   = 5;
const tileType_glass   = 6;
const tileType_baseBack= 7;
const tileType_window  = 8;

const tileRenderOrder = -1e3;
const tileBackgroundRenderOrder = -2e3;

function normalizeTerrainColor(color)
{
    const minChannel = min(color.r, color.g, color.b);
    const maxChannel = max(color.r, color.g, color.b);
    const luminance = (color.r + color.g + color.b) / 3;
    const saturation = maxChannel - minChannel;

    // Keep terrain away from washed-out white/gray so tile detail stays visible.
    if (luminance > .42)
        color = color.scale(.42 / luminance, 1);
    if (saturation < .12)
    {
        const tint = randColor(new Color(.18,.16,.2), new Color(.32,.3,.36));
        color = color.lerp(tint, .35);
    }
    return color.clamp();
}

// level objects
let players=[], playerLives, tileLayer, tileBackgroundLayer, totalKills;
let liveEnemies = new Set();
let currentMusicStyle = 0, currentMusicStyleName = '';
let score = 0, levelScore = 0, levelKills = 0, levelStartTime = 0, levelTimeBonus = 0;

// Procedural ZzFXM music generator — produces a unique track each call.
// Uses Math.random() so it never affects the seeded level-generation RNG.
function generateMusic() {
    const rng = Math.random.bind(Math);
    const ri  = n => Math.floor(rng() * n);
    const B = 16;

    const buildTrack = (style)=>
    {
        const scaleNotes = style.scales[ri(style.scales.length)];
        const root = style.rootMin + ri(style.rootRange);
        const bpm  = style.bpmMin + ri(style.bpmSteps) * style.bpmStep;

        // Convert scale degree → absolute ZzFXM note number
        const sn = (degree, octave = 0) => {
            const len = scaleNotes.length;
            const d   = ((degree % len) + len) % len;
            const o   = Math.floor(degree / len);
            return root + scaleNotes[d] + (octave + o) * 12;
        };

        const instruments = [
            style.makeLead(rng),
            style.makeBass(rng),
            style.makePad(rng),
            style.makePerc(rng),
        ];

        const genLead = chordRoot => {
            const ch = [0, style.leadPan || 0];
            let last = 0;
            for (let i = 0; i < B; i++) {
                const strongBeat = (i & 3) === 0;
                const weakBeat   = (i & 3) === 2;
                if (strongBeat || (weakBeat && rng() < style.leadWeakChance) || rng() < style.leadFreeChance) {
                    const deg = strongBeat ? chordRoot + ri(style.leadStrongSpan) : chordRoot + ri(style.leadWeakSpan);
                    const oct = rng() < style.leadHighOctaveChance ? 1 : 0;
                    const n   = sn(deg, oct);
                    ch.push(n !== last ? n : 0);
                    last = n;
                } else {
                    ch.push(0);
                }
            }
            return ch;
        };

        const genBass = chordRoot => {
            const ch = [1, 0];
            for (let i = 0; i < B; i++) {
                if      ((i & 7) === 0)               ch.push(sn(chordRoot, -1));
                else if ((i & 7) === 4 && rng()<style.bassAnswerChance)
                                                     ch.push(sn(chordRoot + style.bassAnswerOffset, -1));
                else if (rng() < style.bassWalkChance) ch.push(sn(chordRoot + style.bassWalkOffset, -1));
                else                                   ch.push(0);
            }
            return ch;
        };

        const genPad = chordRoot => {
            const ch = [2, rng()<.5 ? -style.padPan : style.padPan];
            const chord = [sn(chordRoot), sn(chordRoot + 2), sn(chordRoot + 4)];
            for (let i = 0; i < B; i++)
                ch.push(i < style.padLength && rng() < style.padChance ? chord[i % chord.length] : 0);
            return ch;
        };

        const genPerc = () => {
            const ch = [3, 0];
            for (let i = 0; i < B; i++) {
                if      ((i & 7) === 0)               ch.push(style.percKick);
                else if ((i & 7) === 4 && rng()<style.percAccentChance)
                                                     ch.push(style.percAccent);
                else if ((i & 3) === 2 && rng()<style.percTickChance)
                                                     ch.push(style.percTick);
                else                                   ch.push(0);
            }
            return ch;
        };

        const prog = style.progs[ri(style.progs.length)];
        const patterns = prog.map(cr => [
            genLead(cr),
            genBass(cr),
            genPad(cr),
            genPerc(),
        ]);
        const sequence = [0, 1, 2, 3, 0, 1, 2, 3];

        return [instruments, patterns, sequence, bpm];
    };

    const styles = [
        {
            name: 'gentle-sci-fi-exploration',
            scales: [
                [0,2,4,7,9],
                [0,2,4,5,7,9,11],
                [0,2,3,5,7,9,10],
            ],
            rootMin: 10,
            rootRange: 5,
            bpmMin: 68,
            bpmSteps: 4,
            bpmStep: 6,
            leadPan: 0,
            leadWeakChance: .42,
            leadFreeChance: .08,
            leadStrongSpan: 3,
            leadWeakSpan: 5,
            leadHighOctaveChance: .18,
            bassAnswerChance: .8,
            bassAnswerOffset: 4,
            bassWalkChance: .03,
            bassWalkOffset: 2,
            padPan: .18,
            padLength: 12,
            padChance: .85,
            percKick: 10,
            percAccent: 16,
            percTick: 22,
            percAccentChance: .35,
            percTickChance: .18,
            progs: [
                [0,3,4,3],
                [0,4,3,2],
                [0,2,3,2],
                [0,3,2,4],
            ],
            makeLead: rng => [.28, 0, 220, .03, .16, .28, 0, 1, 0, 0, 0, 0, 0, 0, .08, 0, 0, .9, 0, rng() < .5 ? .08 : 0],
            makeBass: ()=> [.35, 0, 110, .01, .14, .20, 0, 1, 0, 0, 0, 0, 0, 0,  0, 0, 0, .9, 0, 0],
            makePad:  ()=> [.22, 0, 220, .08, .34, .38, 0, 1, 0, 0, 0, 0, 0, 0, .12, 0, 0, .8, 0, .06],
            makePerc: ()=> [.12, 0, 120,  0,  0,   .05, 4, 1, -.2, 0, 0, 0, 0, .2,  0, 0, 0,  1, 0, 0],
        },
        {
            name: 'lofi-chill',
            scales: [
                [0,2,4,7,9],
                [0,2,3,5,7,9,10],
                [0,3,5,7,10],
            ],
            rootMin: 8,
            rootRange: 5,
            bpmMin: 62,
            bpmSteps: 4,
            bpmStep: 5,
            leadPan: -.05,
            leadWeakChance: .30,
            leadFreeChance: .05,
            leadStrongSpan: 2,
            leadWeakSpan: 4,
            leadHighOctaveChance: .10,
            bassAnswerChance: .65,
            bassAnswerOffset: 2,
            bassWalkChance: .02,
            bassWalkOffset: 1,
            padPan: .12,
            padLength: 14,
            padChance: .92,
            percKick: 8,
            percAccent: 14,
            percTick: 20,
            percAccentChance: .20,
            percTickChance: .10,
            progs: [
                [0,2,3,2],
                [0,3,2,1],
                [0,2,4,2],
                [0,1,3,2],
            ],
            makeLead: rng => [.20, 0, 180, .04, .20, .32, 0, 1, 0, 0, 0, 0, 0, 0, .04, 0, 0, .95, 0, rng() < .5 ? .05 : 0],
            makeBass: ()=> [.28, 0, 95,  .02, .18, .24, 0, 1, 0, 0, 0, 0, 0, 0,  0, 0, 0, .95, 0, 0],
            makePad:  ()=> [.18, 0, 190, .10, .40, .44, 0, 1, 0, 0, 0, 0, 0, 0, .08, 0, 0, .85, 0, .04],
            makePerc: ()=> [.08, 0, 100,  0,  0,   .04, 4, 1, -.1, 0, 0, 0, 0, .12, 0, 0, 0,  1, 0, 0],
        },
    ];

    if (!currentMusicStyle)
        currentMusicStyle = styles[ri(styles.length)];
    currentMusicStyleName = currentMusicStyle.name;
    return buildTrack(currentMusicStyle);
}

// level settings
let levelSize, level, levelSeed, levelEnemyCount, levelWarmup;
let levelColor, levelBackgroundColor, levelSkyColor, levelSkyHorizonColor, levelGroundColor;
let skyParticles, skyRain, skySoundTimer = new Timer;
let gameTimer = new Timer, levelTimer = new Timer, levelEndTimer = new Timer;
// Fire TV: set by nextLevel() if generateLevel() couldn't find a valid level
// in 4 tries. Drained at the end of the next appUpdatePost() frame, giving
// the GPU a chance to release the previous level's textures first.
let pendingLevelGenerate = 0;
let pendingNextLevelResume = 0;
// Fire TV: set after generateLevel() succeeds so applyArtToLevel() runs on
// a later frame — giving the GPU 3 frames (~50ms) to release the old TileLayer
// canvas SharedImage mailboxes before we allocate new large ones (prevents
// Skia OOM → EGL_BAD_PARAMETER → WebGL context loss). One frame (16ms) was
// not enough; empirically 3 frames clears the mailbox backlog.
let pendingApplyArt = 0;
// Fire TV: set by resetGame() so nextLevel() uses a longer pendingApplyArt
// delay (5 frames instead of 3). After a full game-over the GPU has been
// holding the entire level's tile textures in VRAM for the duration of the
// death-screen wait, so it needs more time to drain them.
let pendingApplyArtIsReset = false;

let tileBackground;
const setTileBackgroundData = (pos, data=0)=>
    pos.arrayCheck(tileCollisionSize) && (tileBackground[(pos.y|0)*tileCollisionSize.x+pos.x|0] = data);
const getTileBackgroundData = (pos)=>
    pos.arrayCheck(tileCollisionSize) ? tileBackground[(pos.y|0)*tileCollisionSize.x+pos.x|0] : 0;

///////////////////////////////////////////////////////////////////////////////
// level generation

const resetGame=()=>
{
    levelEndTimer.unset();
    gameTimer.set(totalKills = level = 0);

    // Fire TV: release GPU-backed tile canvases before the new level allocates
    // its own (up to 82MB each for foreground + background TileLayers).  Without
    // this the driver holds the previous level's textures in VRAM throughout the
    // entire death-screen wait, and the subsequent double-allocation triggers
    // GL_OUT_OF_MEMORY → WebGL context loss → white screen on level restart.
    tileLayerCanvasCache.forEach(c => { c.width = 1; c.height = 1; });
    tileLayerCanvasCache.length = 0;
    score = 0; levelScore = 0; levelKills = 0; levelStartTime = 0; levelTimeBonus = 0;
    currentMusicStyle = 0;
    currentMusicStyleName = '';
    // IMPROVEMENT 5.1: reset per-weapon stats on full game reset.
    for (let i = 0; i < weaponStats.length; ++i)
        weaponStats[i].fired = weaponStats[i].hits = weaponStats[i].kills = weaponStats[i].damage = 0;
    // Fire TV: signal nextLevel() to use an extended GPU drain delay.
    // After a full game-over the GPU has been holding the entire previous
    // level's tile textures in VRAM throughout the death-screen wait, so
    // 3 frames is not enough — use 5 frames (~83ms) instead.
    pendingApplyArtIsReset = true;
    nextLevel(playerLives = 3);
}

function buildTerrain(size)
{
    tileBackground = [];
    initTileCollision(size);
    let startGroundLevel = rand(40, 60);
    let groundLevel = startGroundLevel;
    let groundSlope = rand(.5,-.5);
    let canayonWidth = 0, backgroundDelta = 0, backgroundDeltaSlope = 0;
    for(let x=0; x < size.x; x++)
    {
        // pull slope towards start ground level
        groundLevel += groundSlope = rand() < .05 ? rand(.5,-.5) :
            groundSlope + (startGroundLevel - groundLevel)/1e3;
        
        // small jump
        if (rand() < .04)
            groundLevel += rand(9,-9);

        if (rand() < .03)
        {
            // big jump
            const jumpDelta = rand(9,-9);
            startGroundLevel = clamp(startGroundLevel + jumpDelta, 80, 20);
            groundLevel += jumpDelta;
            groundSlope = rand(.5,-.5);
        }

        --canayonWidth;
        if (rand() < .005)
            canayonWidth = rand(7, 2);

        backgroundDelta += backgroundDeltaSlope;
        if (rand() < .1)
            backgroundDelta = rand(3, -1);
        if (rand() < .1)
            backgroundDelta = 0;
        if (rand() < .1)
            backgroundDeltaSlope = rand(1,-1);
        backgroundDelta = clamp(backgroundDelta, 3, -1)

        groundLevel = clamp(groundLevel, 99, 30);
        for(let y=0; y < size.y; y++)
        {
            const pos = vec2(x,y);

            let frontTile = tileType_empty;
            if (y < groundLevel && canayonWidth <= 0)
                 frontTile = tileType_dirt;

            let backTile = tileType_empty;
            if (y < groundLevel + backgroundDelta)
                 backTile = tileType_dirt;
            
            setTileCollisionData(pos, frontTile);
            setTileBackgroundData(pos, backTile);
        }
    }

    // add random holes
    for(let i=levelSize.x; i--;)
    {
        const pos = vec2(rand(levelSize.x), rand(levelSize.y-19, 19));
        for(let x = rand(9,1)|0;--x;)
        for(let y = rand(9,1)|0;--y;)
            setTileCollisionData(pos.add(vec2(x,y)), tileType_empty);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reachability helpers
// ─────────────────────────────────────────────────────────────────────────────

// Cached Uint8Array from generateLevel() so finishLevelSetup() can reuse it
// without running a second BFS. Cleared at the start of each generateLevel().
let _reachableCache = null;

// BFS flood-fill of all tile positions the player can physically reach from
// checkpointPos.  Returns a Uint8Array[W*H] — index y*W+x is 1 if reachable.
//
// Typed-array implementation — NO string allocations, NO vec2 object creation
// for the queue.  The old Set<"x,y"> + vec2[] version allocated ~80 000 short-
// lived objects per call causing 1–2 s GC pauses on Fire TV (key event latency
// 1000–1250 ms, dropped=3119 frames in the fluidity logs).
//
// Movement model:
//   Walk  — left/right when standing on solid/ladder ground
//   Jump  — one tile up from a standing tile
//   Fall  — one tile downward when open below
//   Climb — up and down through ladder tiles
function reachableTiles()
{
    const W = levelSize.x | 0;
    const H = levelSize.y | 0;

    // Visited flags — Uint8Array, preallocated, zero-filled by the runtime.
    const visited = new Uint8Array(W * H);

    // Integer queue: each entry encodes a tile as y*W+x (flat index).
    // Uint32Array preallocated to the maximum possible queue size.
    const queue = new Int32Array(W * H);
    let head = 0, tail = 0;

    // Inline helpers using raw integer coordinates — no vec2, no string concat.
    const inBounds  = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
    const tileAt    = (x, y) => inBounds(x, y) ? getTileCollisionData(vec2(x, y)) : 1; // treat OOB as solid
    const isOpen    = (x, y) => tileAt(x, y) <= 0;
    const isSolid   = (x, y) => tileAt(x, y) > 0;
    const isLadder  = (x, y) => tileAt(x, y) === tileType_ladder;

    const enqueue = (x, y) =>
    {
        if (!inBounds(x, y)) return;
        const i = y * W + x;
        if (visited[i] || !isOpen(x, y)) return;
        visited[i] = 1;
        queue[tail++] = i;
    };

    // Seed — player spawn tile
    const sx = checkpointPos.x | 0;
    const sy = checkpointPos.y | 0;
    if (inBounds(sx, sy) && isOpen(sx, sy))
    {
        visited[sy * W + sx] = 1;
        queue[tail++] = sy * W + sx;
    }

    while (head < tail)
    {
        const i = queue[head++];
        const x = i % W;
        const y = (i / W) | 0;

        const onLadder  = isLadder(x, y);
        const canStand  = isSolid(x, y - 1) || isLadder(x, y - 1) || onLadder;

        if (canStand)
        {
            enqueue(x - 1, y);
            enqueue(x + 1, y);
            enqueue(x,     y + 1);          // jump 1 tile up
            enqueue(x - 1, y + 1);
            enqueue(x + 1, y + 1);
        }

        enqueue(x, y - 1);                  // gravity / fall

        if (onLadder)
        {
            enqueue(x, y + 1);
            enqueue(x, y - 1);
        }
    }

    return visited; // Uint8Array — caller uses visited[y*W+x] === 1
}

// Ensure the tile at surfacePos is reachable.  If not, scan downward to find
// the nearest reachable tile and write ladder tiles for the whole gap.
// `reachable` is the Uint8Array returned by reachableTiles().
function connectToReachable(surfacePos, reachable)
{
    const W  = levelSize.x | 0;
    const sx = surfacePos.x | 0;
    const sy = surfacePos.y | 0;

    if (sx < 0 || sx >= W || sy < 0 || sy >= levelSize.y) return;
    if (reachable[sy * W + sx]) return;     // already reachable

    for (let dy = 1; dy < levelSize.y; ++dy)
    {
        const ty = sy - dy;
        if (ty < 2) break;

        const tileD = getTileCollisionData(vec2(sx, ty));
        if (tileD > 0 && tileD !== tileType_ladder) break;  // solid wall blocks shaft

        if (reachable[ty * W + sx])
        {
            // Bridge the gap with ladder tiles and mark them reachable.
            for (let fy = ty + 1; fy <= sy; ++fy)
            {
                if (getTileCollisionData(vec2(sx, fy)) <= 0)
                    setTileCollisionData(vec2(sx, fy), tileType_ladder);
            }
            for (let fy = ty; fy <= sy; ++fy)
                reachable[fy * W + sx] = 1;
            return;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────

function spawnProps(pos)
{
    if (abs(checkpointPos.x-pos.x) > 5)
    {
        new Prop(pos);
        const propPlaceSize = .51;
        if (randSeeded() < .2)
        {
            // 3 triangle prop stack
            new Prop(pos.add(vec2(propPlaceSize*2,0)));
            if (randSeeded() < .2)
                new Prop(pos.add(vec2(propPlaceSize,propPlaceSize*2)));
        }
        else if (randSeeded() < .2)
        {
            // 3 column prop stack
            new Prop(pos.add(vec2(0,propPlaceSize*2)));
            if (randSeeded() < .2)
                new Prop(pos.add(vec2(0,propPlaceSize*4)));
        }
    }
}

function buildBase()
{
    let raycastHit;
    for(let tries=99;!raycastHit;)
    {
        if (!tries--)
            return 1; // count not find pos

        const pos = vec2(randSeeded(levelSize.x-40,40), levelSize.y);

        // must not be near player start
        if (abs(checkpointPos.x-pos.x) > 30)
            raycastHit = tileCollisionRaycast(pos, vec2(pos.x, 0));
    }

    const cave = rand() < .5;
    const baseBottomCenterPos = raycastHit.int();
    const baseSize = randSeeded(20,9)|0;
    const baseFloors = cave? 1 : randSeeded(6,1)|0;
    const basementFloors = randSeeded(cave?7:4, 0)|0;
    let floorBottomCenterPos = baseBottomCenterPos.subtract(vec2(0,basementFloors*6));
    floorBottomCenterPos.y = max(floorBottomCenterPos.y, 9); // prevent going through bottom

    let floorWidth = baseSize;
    let previousFloorHeight = 0;
    for(let floor=-basementFloors; floor <= baseFloors; ++floor)
    {  
        const topFloor = floor == baseFloors;
        const groundFloor = !floor;
        const isCaveFloor = cave ? rand() < .8 | (floor == 0 && rand() < .6): 0;
        // Top floor must be at least 1 tile tall so the side walls actually render
        // (the inner y-loop is `for(y=-1; y<floorHeight; ++y)`, which runs 0 times when floorHeight=0).
        let floorHeight = isCaveFloor ? randSeeded(9,2)|0 : topFloor? 1 : groundFloor? randSeeded(9,4)|0 : randSeeded(7,2)|0;
        const floorSpace = topFloor ? 4 : max(floorHeight - 1, 0);

        let backWindow = rand() < .5;
        const windowTop = rand(4,2);

        for(let x=-floorWidth; x <= floorWidth; ++x)
        {
            const hasSide = !isCaveFloor && randSeeded() < .9;
            // Wall-column windows: only set if this column will be a vertical wall
            // (so non-edge columns can't become glass mid-floor).
            const isWindow = !isCaveFloor && abs(x) == floorWidth && randSeeded() < .3;

            if (cave)
                backWindow = 0;
            else if (rand() < .1)
                backWindow = !backWindow;

            if (cave && rand() < .2)
                floorHeight = clamp(floorHeight + rand(3,-3)|0, 9, 2)

            for(let y=-1; y < floorHeight; ++y)
            {
                const pos = floorBottomCenterPos.add(vec2(x,y));
                let foregroundTile = tileType_empty;
                if (isCaveFloor)
                {
                    // add ceiling, floor, and side walls
                    if ( y < 0 | y == floorHeight-1)
                        foregroundTile = tileType_dirt;
                    else if (abs(x) == floorWidth)
                        foregroundTile = tileType_dirt;

                    setTileBackgroundData(pos, tileType_dirt);
                    setTileCollisionData(pos, foregroundTile);
                }
                else
                {
                    // add ceiling and floor
                    const isHorizontal = y < 0 | y == floorHeight-1;
                    if (isHorizontal)
                        foregroundTile = tileType_pipeH;

                    // add walls and windows
                    if (abs(x) == floorWidth)
                        foregroundTile = isHorizontal ? tileType_base : isWindow ? tileType_glass : tileType_pipeV;

                    let backgroundTile = foregroundTile>0||floorHeight<3? tileType_baseBack : tileType_base;
                    if (backWindow && y > 0 && y < floorHeight-windowTop && abs(x) < floorWidth-2)
                        backgroundTile = tileType_window;

                    setTileBackgroundData(pos, backgroundTile);
                    setTileCollisionData(pos, foregroundTile);
                }
            }
        }

        // add ladders to floor below — guaranteed to write at least one per floor.
        //
        // Old code picked a random X once and silently gave up if that column was
        // blocked (wall tile, zero gap, or hit world bottom), leaving entire floors
        // disconnected. New code retries up to 10 random candidates, then falls back
        // to a deterministic center-outward scan of the full floor width so that
        // *at least one* ladder is always written (unless this is a cave top-floor).
        if (!cave || !topFloor)
        {
            // tryPlaceLadder: scan downward from floorBottomCenterPos at column x.
            // Returns true and writes ladder tiles if a solid-below/open-above pair
            // is found within the level.  Returns false if the column is blocked.
            const tryPlaceLadder = (fbcp, x) =>
            {
                for (let y = 0; y < levelSize.y; ++y)
                {
                    const lp = fbcp.add(vec2(x, -y - 1));
                    if (lp.y < 2) return false;           // hit world bottom, give up
                    if (y                                  // need at least 1 empty tile first
                        && getTileCollisionData(lp) > 0    // solid tile found below gap
                        && getTileCollisionData(lp.add(vec2(0,1))) <= 0) // open above it
                    {
                        for (let ly = y; ly--;)
                            setTileCollisionData(fbcp.add(vec2(x, -ly - 1)), tileType_ladder);
                        return true;
                    }
                }
                return false;
            };

            // Place 1–2 ladders.  Each ladder gets up to 10 random attempts before
            // the fallback deterministic scan ensures one always succeeds.
            const ladderCount = (randSeeded(2) + 1) | 0;
            for (let lc = 0; lc < ladderCount; ++lc)
            {
                let placed = false;

                // Random attempts first (preserves original feel when they work).
                for (let attempt = 0; attempt < 10 && !placed; ++attempt)
                {
                    const x = (randSeeded(floorWidth - 1, -floorWidth + 1)) | 0;
                    placed = tryPlaceLadder(floorBottomCenterPos, x);
                }

                // Deterministic fallback: scan every interior column center-outward.
                if (!placed)
                {
                    for (let dx = 0; dx <= floorWidth - 2 && !placed; ++dx)
                    {
                        placed = tryPlaceLadder(floorBottomCenterPos,  dx) ||
                                 tryPlaceLadder(floorBottomCenterPos, -dx);
                    }
                }
            }
        }

        // spawn crates
        const propCount = randSeeded(floorWidth/2)|0;
        for(let i = propCount; i--;)
            spawnProps(floorBottomCenterPos.add(vec2(randSeeded( floorWidth-2,-floorWidth+2),.5)));

        if (topFloor || floorSpace > 1)
        {
            // spawn enemies — guarantee at least 1 on the top floor so
            // `levelEnemyCount` always decrements and the generateLevel()
            // loop terminates. If propCount rolled 0, a base was previously
            // built with zero enemies, the loop spun to 99 tries, and the
            // level retried 4x before giving up — leaving an empty map.
            const enemyCount = topFloor ? max(1, propCount) : propCount;
            for(let i = enemyCount; i--;)
            {
                const pos = floorBottomCenterPos.add(vec2(randSeeded( floorWidth-1,-floorWidth+1),.7));
                new Enemy(pos);
            }
        }

        const oldFloorWidth = floorWidth;
        floorWidth = max(floorWidth + randSeeded(8,-8),9)|0;
        floorBottomCenterPos.y += floorHeight;
        floorBottomCenterPos.x += randSeeded(oldFloorWidth - floorWidth+1)|0;
        // snap to integer so tile collision coords always match visual tile positions
        floorBottomCenterPos.x = floorBottomCenterPos.x|0;
        floorBottomCenterPos.y = floorBottomCenterPos.y|0;
        previousFloorHeight = floorHeight;
    }

    //checkpointPos = floorBottomCenterPos.copy(); // start player on base for testing

    // spawn random enemies and props
    for(let i=20;levelEnemyCount>0&&i--;)
    {
        const pos = vec2(floorBottomCenterPos.x + randSeeded(99, -99), levelSize.y);
        raycastHit = tileCollisionRaycast(pos, vec2(pos.x, 0));
        // must not be near player start
        if (raycastHit && abs(checkpointPos.x-pos.x) > 20)
        {
            const pos = raycastHit.add(vec2(0,2));
            randSeeded() < .7 ? new Enemy(pos) : spawnProps(pos);
        }
    }
}

function generateLevel()
{
    levelEndTimer.unset();
    levelScore = 0; levelKills = 0; levelStartTime = time;
    liveEnemies = new Set();

    // remove all objects that are not persistnt or are descendants of something persitant
    for(const o of engineObjects)
        o.destroy();
    engineObjects = [];
    engineCollideObjects = [];

    // randomize ground level hills
    buildTerrain(levelSize);

    // find starting poing for player
    let raycastHit;
    for(let tries=99;!raycastHit;)
    {
        if (!tries--)
            return 1; // count not find pos

        // start on either side of level
        checkpointPos = vec2(levelSize.x/2 + (levelSize.x/2-10-randSeeded(9))*(randSeeded()<.5?-1:1) | 0, levelSize.y);
        raycastHit = tileCollisionRaycast(checkpointPos, vec2(checkpointPos.x, 0));
    }
    // Snap to the same integer+0.5 coords the Checkpoint constructor uses
    // (pos.int().add(vec2(.5))) so the player and the flag pole share the
    // exact same X position and don't appear misaligned.
    checkpointPos = raycastHit.add(vec2(0,1)).int().add(vec2(.5));

    // random bases until there enough enemies
    //
    // PREVIOUS BUG: this loop returned 1 on the first `buildBase()` failure,
    // leaving the entire level with zero bases. `buildBase()` can legitimately
    // fail (its own inner position-finder times out when 99 random X-positions
    // are all within 30 of the player). Now we `continue` instead and let
    // `tries` bound the total work; the safety net below catches the case
    // where every single attempt failed to spawn an enemy.
    for(let tries=99; levelEnemyCount>0; --tries)
    {
        if (!tries)
            return 1; // 99 consecutive buildBase() failures — give up

        if (buildBase())
            continue; // one bad roll, try the next random position
    }

    // build checkpoints
    for(let x=0; x<levelSize.x-9; )
    {
        x += rand(100,70);
        const pos = vec2(x, levelSize.y);
        raycastHit = tileCollisionRaycast(pos, vec2(pos.x, 0));
        // must not be near player start
        if (raycastHit && abs(checkpointPos.x-pos.x) > 50)
        {
            // todo prevent overhangs
            const pos = raycastHit.add(vec2(0,1));
            new Checkpoint(pos);
        }
    }

    // ── Reachability pass ────────────────────────────────────────────────────
    // Compute once here (Uint8Array, typed — zero GC pressure) and cache in
    // _reachableCache so finishLevelSetup() can reuse it for BonusBox / Stash
    // placement without running a second BFS.
    _reachableCache = reachableTiles();
    for (const enemy of liveEnemies)
    {
        if (!enemy || enemy.destroyed) continue;
        connectToReachable(vec2(enemy.pos.x | 0, enemy.pos.y | 0), _reachableCache);
    }

    // ── Safety net ────────────────────────────────────────────────────────────
    // If the base-building loop somehow ended with zero enemies (e.g. the
    // random stream rolled `propCount=0` on every base's top floor and the
    // `for(let tries=99;levelEnemyCount>0;)` loop returned 1 before our
    // top-floor guarantee could fire), the player would be presented with
    // an empty map and a locked BonusBox. Force-spawn a handful of enemies
    // directly on the terrain so the level always has something to hunt.
    if (liveEnemies.size === 0)
    {
        let spawned = 0;
        for (let tries = 40; tries-- && spawned < 7;)
        {
            const ex = randSeeded(levelSize.x - 20, 20);
            const hit = tileCollisionRaycast(vec2(ex, levelSize.y), vec2(ex, 0));
            if (hit && abs(checkpointPos.x - ex) > 20)
            {
                new Enemy(hit.add(vec2(0, 2)));
                ++spawned;
            }
        }
    }
}

const groundTileStart = 8;

function makeTileLayers(level_)
{
    // create foreground layer
    tileLayer = new TileLayer(vec2(), levelSize);
    tileLayer.renderOrder = tileRenderOrder;

    // create background layer
    tileBackgroundLayer = new TileLayer(vec2(), levelSize);
    tileBackgroundLayer.renderOrder = tileBackgroundRenderOrder;

    for(let x=levelSize.x;x--;)
    for(let y=levelSize.y;y--;)
    {
        const pos = vec2(x,y);
        let tileType = getTileCollisionData(pos);
        if (tileType)
        {
            // todo pick tile, direction etc based on neighbors tile type
            let direction = rand(4)|0
            let mirror = rand(2)|0;
            let color = new Color();

            let tileIndex = groundTileStart;
            if (tileType == tileType_dirt)
            {
                tileIndex = groundTileStart+2 + rand()**3*2|0;
                color = levelColor.mutate(.03);
            }
            else if (tileType == tileType_pipeH)
            {
                tileIndex = groundTileStart+5;
                direction = 1;
            }
            else if (tileType == tileType_pipeV)
            {
                tileIndex = groundTileStart+5;
                direction = 0;
            }
            else if (tileType == tileType_glass)
            {
                tileIndex = groundTileStart+5;
                direction = 0;
                color = new Color(0,1,1,.5);
            }
            else if (tileType == tileType_base)
                tileIndex = groundTileStart+4;
            else if (tileType == tileType_ladder)
            {
                tileIndex = groundTileStart+7;
                direction = mirror = 0;
            }
            tileLayer.setData(pos, new TileLayerData(tileIndex, direction, mirror, color));
        }
        
        tileType = getTileBackgroundData(pos);
        if (tileType)
        {
            // todo pick tile, direction etc based on neighbors tile type
            const direction = rand(4)|0
            const mirror = rand(2)|0;
            let color = new Color();

            let tileIndex = groundTileStart;
            if (tileType == tileType_dirt)
            {
                tileIndex = groundTileStart +2 + rand()**3*2|0;
                color = levelColor.mutate();
            }
            else if (tileType == tileType_base)
            {
                tileIndex = groundTileStart+6;
                color = color.scale(rand(1,.7),1)
            }
            else if (tileType == tileType_baseBack)
            {
                tileIndex = groundTileStart+6;
                color = color.scale(rand(.5,.3),1).mutate();
            }
            else if (tileType == tileType_window)
            {
                tileIndex = 0;
                color = new Color(0,1,1,.5);
            }
            tileBackgroundLayer.setData(pos, new TileLayerData(tileIndex, direction, mirror, color.scale(.4,1)));
        }
    }
    // Always bake tile layers via Canvas2D to avoid GL_UNKNOWN_CONTEXT_RESET_KHR
    // on Fire TV. When glEnable=1, redrawStart() calls glPreRender(w, h) which
    // resizes glCanvas to the full tile canvas dimensions — this canvas resize
    // triggers a GPU driver watchdog reset on this hardware even at capped sizes.
    // Setting glEnable=0 during baking forces the Canvas2D path (drawCanvas2D
    // with tileImage), which produces identical tile output without touching the
    // WebGL canvas at all. Restored immediately after so sprites/effects still
    // use WebGL for the rest of the frame.
    const _savedGlEnable = glEnable;
    glEnable = 0;
    const _tilePixW = levelSize.x * defaultTileSize.x;
    const _tilePixH = levelSize.y * defaultTileSize.y;
    console.log('[firetv-tiles] baking tiles, glEnable=' + glEnable + ', tiles=' + levelSize.x + 'x' + levelSize.y + ', px=' + _tilePixW + 'x' + _tilePixH + ', lowGfx=' + (lowGraphicsSettings ? 1 : 0));
    tileLayer.redraw();
    console.log('[firetv-tiles] fg baked, bg starting');
    tileBackgroundLayer.redraw();
    glEnable = _savedGlEnable;
    console.log('[firetv-tiles] tile bake complete, glEnable restored=' + glEnable);
}

function applyArtToLevel()
{
    makeTileLayers();
    
    // apply decoration to level tiles
    for(let x=levelSize.x;x--;)
    for(let y=levelSize.y;--y;)
    {
        decorateBackgroundTile(vec2(x,y));
        decorateTile(vec2(x,y));
    }

    generateParallaxLayers();

    if (precipitationEnable && !lowGraphicsSettings)
    {
        // create rain or snow particles
        if (skyRain = rand() < .5)
        {
            // rain
            skyParticles = new ParticleEmitter(
                vec2(), 3, 0, 0, .3, // pos, emitSize, emitTime, emitRate, emiteCone
                0, undefined,   // tileIndex, tileSize
                new Color(.8,1,1,.6), new Color(.5,.5,1,.2), // colorStartA, colorStartB
                new Color(.8,1,1,.6), new Color(.5,.5,1,.2), // colorEndA, colorEndB
                2, .1, .1, .2, 0,  // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
                .99, 1, .5, PI, .2,  // damping, angleDamping, gravityScale, particleCone, fadeRate, 
                .5, 0              // randomness, collide=0 (Fix 8: no tile collision for rain), additive, randomColorLinear, renderOrder
            );
            skyParticles.elasticity = .2;
            skyParticles.trailScale = 2;
        }
        else
        {
            // snow
            skyParticles = new ParticleEmitter(
                vec2(), 3, 0, 0, .5, // pos, emitSize, emitTime, emitRate, emiteCone
                0, undefined,   // tileIndex, tileSize
                new Color(1,1,1,.8), new Color(1,1,1,.2), // colorStartA, colorStartB
                new Color(1,1,1,.8), new Color(1,1,1,.2), // colorEndA, colorEndB
                3, .1, .1, .3, .01,  // particleTime, sizeStart, sizeEnd, particleSpeed, particleAngleSpeed
                .98, 1, .2, PI, .2,  // damping, angleDamping, gravityScale, particleCone, fadeRate, 
                .5, 0              // randomness, collide=0 (no tile collision for snow, perf fix 4.2), additive, randomColorLinear, renderOrder
            );
        }
        skyParticles.emitRate = precipitationEnable && rand()<.5 ? rand(200) : 0;
        skyParticles.angle = PI+rand(.5,-.5);
        _skyRaycastX = null; // invalidate sky raycast cache on level load
    }
}

// Phase 2 of level setup — called one frame after generateLevel() so the GPU
// has had a chance to release the old TileLayer canvas textures (Skia OOM fix).
function finishLevelSetup()
{
    // warm up level
    levelWarmup = 1;

    // objects that effect the level must be added here
    const firstCheckpoint = new Checkpoint(checkpointPos).setActive();

    applyArtToLevel();
    try { playMusic(generateMusic(), 1); } catch(e) {}

    const warmUpTime = 2;
    for(let i=warmUpTime * FPS; i--;)
    {
        updateSky();
        engineUpdateObjects();
    }
    levelWarmup = 0;

    // destroy any objects that are stuck in collision
    forEachObject(0, 0, (o)=>
    {
        if (o.isGameObject && o != firstCheckpoint)
        {
            const checkBackground = o.isCheckpoint;
            (checkBackground ? getTileBackgroundData(o.pos) > 0 : tileCollisionTest(o.pos,o.size))  && o.destroy();
        }
    });

    // ── Reachability set for BonusBox / Stash placement ─────────────────────
    // Reuse the Uint8Array computed in generateLevel() — no second BFS needed.
    // The cache is valid: tile collision data hasn't changed since generateLevel()
    // wrote it, and applyArtToLevel() only reads it (never writes it).
    const _finishReachable = _reachableCache;
    const _frW = levelSize.x | 0;
    const isReachableSurface = (hitPos) =>
    {
        // hitPos is the floor tile (solid). The object stands one tile above it.
        const standX = hitPos.x | 0;
        const standY = (hitPos.y + 1) | 0;
        if (!_finishReachable || standX < 0 || standX >= _frW ||
            standY < 0 || standY >= levelSize.y) return false;
        return _finishReachable[standY * _frW + standX] === 1;
    };

    // ── Spawn the level finale — boss on every 5th level, otherwise BonusBox ─
    // IMPROVEMENT 5.3: every 5th level spawns a Boss instead of the BonusBox.
    // The Boss drops the BonusBox at its death position when killed.
    if (level > 0 && level % 5 === 0)
    {
        const bx = levelSize.x / 2;
        const hit = tileCollisionRaycast(vec2(bx, levelSize.y), vec2(bx, 0));
        if (hit)
            new Boss(hit.add(vec2(0, 2)));
    }
    else
    {
        // Prefer a reachable surface; fall back to any valid surface after 40 tries.
        let bonusPlaced = false;
        for (let tries = 40; tries-- && !bonusPlaced;)
        {
            const bx = rand(levelSize.x - 20, 20);
            const hit = tileCollisionRaycast(vec2(bx, levelSize.y), vec2(bx, 0));
            if (hit && abs(checkpointPos.x - bx) > 15)
            {
                // First 20 tries: require reachable. Last 20: accept any surface.
                if (tries >= 20 && !isReachableSurface(hit)) continue;
                new BonusBox(hit.add(vec2(0, 2)), randColor(new Color(.5,.5,.2), new Color(1,1,.6)));
                bonusPlaced = true;
            }
        }
    }

    // IMPROVEMENT 1.2: COLLECT objective — scatter `stashesRequired` stash
    // pickups around the level for the player to find.
    if (objectiveType === OBJECTIVE_COLLECT)
    {
        for (let i = 0; i < stashesRequired; ++i)
        {
            let stashPlaced = false;
            for (let tries = 40; tries-- && !stashPlaced;)
            {
                const sx = rand(levelSize.x - 20, 20);
                const hit = tileCollisionRaycast(vec2(sx, levelSize.y), vec2(sx, 0));
                if (hit && abs(checkpointPos.x - sx) > 10)
                {
                    if (tries >= 20 && !isReachableSurface(hit)) continue;
                    new Stash(hit.add(vec2(0, 1.5)));
                    stashPlaced = true;
                }
            }
        }
    }

    // hack, subtract off warm up time from main game timer
    //gameTimer.time += warmUpTime;
    levelTimer.set();

    // spawn player (Player constructor creates the weapon internally)
    players = [];
    // The Player constructor unconditionally does `--playerLives;` (see
    // appCharacters.js) so each spawn costs one life. The "join mid-game"
    // path in app.js compensates with a `++playerLives` before new Player();
    // we mirror that here so the very first spawn doesn't silently drop the
    // player from 3 lives to 2.
    ++playerLives;
    new Player(checkpointPos);
    if (typeof players !== 'undefined' && players[0] && players[0].weapon) {
        players[0].weapon.weaponType = weaponType_pistol;
    }
    //new Enemy(checkpointPos.add(vec2(3))); // test enemy

    // Snap the camera directly to the spawn point so the player never sees
    // the wrong part of the map (e.g. empty space / no ground) on the first
    // frame. Without this cameraPos starts at (0,0) and takes several frames
    // to lerp to the player position, making the character appear to float.
    cameraPos = checkpointPos.copy();
}

// IMPROVEMENT 5.2: daily-seed mode. When enabled, every player gets the
// same level on the same day (seed = YYYYMMDD). Set from URL `?daily=1`
// or by the pause menu toggle. The scoreboard flags daily runs so a
// player's "today's best" is directly comparable with anyone else's.
let dailyMode = 0;

const isDailyMode = ()=>
{
    if (dailyMode) return 1;
    try { return /[?&]daily=1\b/.test(location.search) ? 1 : 0; }
    catch (e) { return 0; }
};

// Derive a YYYYMMDD integer from the current local date. Stable within a
// day so the daily level is the same for every player all day.
const dailySeedForToday = ()=>
{
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};

function nextLevel()
{
    if (!pendingNextLevelResume)
    {
        // ── Faster-finish time bonus ──────────────────────────────────────────
        // Reward players who clear the level quickly. Bonus starts at 1000 and
        // drops by 5 per second of elapsed time, floored at 0.
        const levelElapsed = time - levelStartTime;
        levelTimeBonus = max(0, 1000 - levelElapsed * 5) | 0;
        levelScore += levelTimeBonus;
        score += levelScore;
        if (level)
            playerLives += 1; // gain 1 extra life for clearing a level after the first
        // IMPROVEMENT 4.2: beat the personal best for this level. If this is
        // the player's first time finishing the level, just record the time.
        if (level > 0)
        {
            const bests = loadLevelBests();
            const prev = bests[level] | 0;
            if (!prev || levelElapsed < prev)
            {
                if (prev) newBestFlag = 1;          // beat an existing record
                bests[level] = levelElapsed | 0;
                saveLevelBests(bests);
            }
            // IMPROVEMENT 5.4: Speed Demon achievement (cleared a level in
            // under 30s, based on the time of the *just-completed* level).
            if (levelElapsed < 30)
                unlockAchievement('speed_demon', 'Speed Demon');
        }
        // IMPROVEMENT 5.4: Marathon achievement on reaching level 20.
        if (level >= 20)
            unlockAchievement('marathon', 'Marathon');
        // Cap enemy count on Fire TV — the formula can reach 315 on later
        // levels; each enemy is a physics object updated every frame.
        // 60 keeps the game challenging while staying within Fire TV's budget.
        levelEnemyCount = lowGraphicsSettings
            ? min(level * 7, 63)   // multiples of 7: 7, 14, 21 … 63 (cap at 9×7)
            : 15 + min(level * 30, 300);
        ++level;
        // IMPROVEMENT 4.4: arm the "LEVEL N" title card for the new level.
        levelTitleTimer = 1.5;
        // IMPROVEMENT 1.2: pick an objective type for this level. The mix is
        // 60% HUNT (default), 30% SURVIVE, 10% COLLECT. The survive time
        // scales with the level so late-game SURVIVE/COLLECT aren't trivial.
        const _objRoll = rand();
        if (_objRoll < .60)      objectiveType = OBJECTIVE_HUNT;
        else if (_objRoll < .90) { objectiveType = OBJECTIVE_SURVIVE; surviveTimer = 20 + min(level * 2, 40); surviveGoal = surviveTimer; }
        else                     { objectiveType = OBJECTIVE_COLLECT; stashesCollected = 0; stashesRequired = 3; }
        if (objectiveType === OBJECTIVE_HUNT)
            levelTitleObjective = 'CLEAR ALL ENEMIES — THEN BREAK THE BOX';
        else if (objectiveType === OBJECTIVE_SURVIVE)
            levelTitleObjective = 'SURVIVE ' + (surviveGoal | 0) + ' SECONDS — THEN BREAK THE BOX';
        else
            levelTitleObjective = 'COLLECT ' + stashesRequired + ' STASHES (BLUE) — THEN BREAK THE BOX';
        // IMPROVEMENT 5.2: daily mode pins the seed to today's date so all
        // players get the same level on the same day.
        if (isDailyMode())
            levelSeed = randSeed = dailySeedForToday();
        else
            levelSeed = randSeed = rand(1e9)|0;
        levelSize = vec2(min(level*99,400),200);
        // Fire TV / lowGraphicsSettings: cap level dimensions so tile canvases
        // stay within GPU memory limits. At 16px/tile: 100×100 tiles = 1600×1600
        // px ≈ 10MB per canvas (fore + back = ~20MB total). Uncapped max
        // (400×200 tiles) = 6400×3200 ≈ 82MB each → GL_OUT_OF_MEMORY on Fire TV.
        if (lowGraphicsSettings) {
            levelSize.x = min(levelSize.x, 100);
            levelSize.y = min(levelSize.y, 100);
        }
        levelColor = normalizeTerrainColor(randColor(new Color(.2,.2,.2), new Color(.8,.8,.8)));
        levelSkyColor = randColor(new Color(.5,.5,.5), new Color(.9,.9,.9));
        _skyGradient = null; // invalidate cached sky gradient (rebuilt in appRender)
        levelSkyHorizonColor = levelSkyColor.subtract(new Color(.05,.05,.05)).mutate(.3).clamp();
        levelGroundColor = levelColor.mutate().add(new Color(.3,.3,.3)).clamp();

        // IMPROVEMENT 4.2: load the best time for the *new* level so the
        // TIME panel can show "current / best".
        levelBestTime = (loadLevelBests()[level] | 0);
    }
    else
        pendingNextLevelResume = 0;

    // Phase 1: generate terrain + place enemies/objects (destroys old tile canvases).
    // Fire TV: cap retries per frame so the GPU gets a chance to release
    // textures from the previous level before we allocate new ones.
    for (let levelTries = 0; generateLevel();)
    {
        if (++levelTries > 4)
        {
            pendingLevelGenerate = 1;
            pendingNextLevelResume = 1;
            return;
        }
    }

    // Phase 2 is deferred so the GPU can release the old TileLayer canvas
    // SharedImage mailboxes before we allocate new large ones. Without this
    // yield, Skia runs out of GPU memory → EGL_BAD_PARAMETER → WebGL context
    // loss on Fire TV. One frame (16ms) was empirically insufficient; 3 frames
    // (~50ms) clears the backlog on normal level transitions. On a full game
    // restart (pendingApplyArtIsReset) the GPU has held the previous level's
    // textures throughout the entire death-screen wait, so we use 5 frames
    // (~83ms) to give it extra time to drain.
    pendingApplyArt = pendingApplyArtIsReset ? 5 : 3;
    pendingApplyArtIsReset = false;
}