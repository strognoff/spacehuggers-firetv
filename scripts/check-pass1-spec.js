#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (relPath) => fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
const assert = (condition, message) =>
{
    if (!condition)
        throw new Error(message);
};

const appJs = read('app.js');
const appEffectsJs = read('appEffects.js');
const appLevelJs = read('appLevel.js');

assert(appJs.includes('const defaultCameraScale = 4*8;'), 'app.js must set defaultCameraScale to 4*8');
assert(appJs.includes('const hudFrame = (x, y, w, h, color, alpha=.15) => {'), 'app.js must define hudFrame helper');
assert(appJs.includes("drawHudPanel(pad, pad, 240, 'SCORE', totalScore, '#ffb347');"), 'app.js must render SCORE panel');
assert(appJs.includes("drawHudPanel(cw/2 - 90, pad, 180, 'LEVEL', level, '#7fdbff', 'center');"), 'app.js must render LEVEL panel');
assert(appJs.includes("drawHudPanel(cw - pad - 170, pad, 170, 'LIVES', Math.max(0, playerLives), '#ff5050', 'right');") || (appJs.includes("'LIVES'") && appJs.includes('drawHeart(')), 'app.js must render LIVES panel (numeric or heart row)');
assert(appJs.includes("drawHudPanel(cw/2 - 140, ch - pad - frameH, 280, 'ENEMIES', threatsValue, threatsColor, 'center');"), 'app.js must render ENEMIES panel (formerly THREATS)');
assert(appJs.includes("drawHudPanel(pad, ch - pad - frameH, 220, 'KILLS', levelKills + '  +' + levelScore, '#ffffff');"), 'app.js must render KILLS panel');

assert(appEffectsJs.includes('const starCount = lowGraphicsSettings ? 150 : 300;'), 'appEffects.js must reduce star count');
assert(appEffectsJs.includes('function makeDebris(pos, color = new Color, amount = 50)'), 'appEffects.js must reduce debris amount default');
assert(appEffectsJs.includes('skyParticles.emitRate = clamp(skyParticles.emitRate + rand(120,-120), 200);'), 'appEffects.js must cap dynamic sky emit rate at 200');
assert(appLevelJs.includes('skyParticles.emitRate = precipitationEnable && rand()<.5 ? rand(200) : 0;'), 'appLevel.js must cap initial sky emit rate at 200');

execFileSync('bash', ['scripts/sync-www.sh', '--check'], { cwd: repoRoot, stdio: 'pipe' });

console.log('PASS: pass-1 spec checks succeeded');
