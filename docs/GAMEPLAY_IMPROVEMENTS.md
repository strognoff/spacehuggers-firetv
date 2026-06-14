# SpaceHuggers — Gameplay & Fun Improvement Suggestions

> Audit date: June 2026
> Targets: Fire TV (Amazon WebView / Chromium 118) and desktop browsers
> Current version at audit: **1.0.88**

This document catalogues suggestions that would make the game **more fun / more readable / more replayable** for the player. They are explicitly designed to **not** impact the perf work already shipped in `docs/PERFORMANCE_IMPROVEMENTS.md` — each suggestion either has no runtime cost, or its cost is bounded (one-shot spawns, no per-frame work, no growth in `engineObjects` / `engineCollideObjects`).

The suggestions are ordered by **impact-per-effort**: the highest-leverage ones are at the top of each section. None of these are required to ship the next build — they are a design menu, not a roadmap.

## Implementation log (2026-06-14)

A subset of the suggestions below — plus a few smaller fixes — have
been implemented in a follow-up batch after the audit. They are listed
here so the rest of the document can be read against the *current*
state of the game. Full details in
`docs/CHANGES_2026-06-11.md` under "Subsequent changes (2026-06-14)".

| Suggestion | Status | Note |
|---|---|---|
| 1.2 — Secondary objective types | ✅ reverted | Objective selection in `nextLevel()` was first hard-set to `OBJECTIVE_HUNT` (change 6.1), then reverted to the original 60 / 30 / 10 mix. SURVIVE / COLLECT branches run again. |
| 2.1 — Replace numeric LIVES with hearts | Implemented | `app.js:1128-1168` now draws one heart per life using a new `drawHeart` bezier helper. 3 lives = 3 hearts. — change 6.2. |
| (HUD) — TIME panel: drop personal-best | Implemented | Pass 4's "current / best" was overflowing the 180 px panel on Fire TV. Now shows only the current time; width 130 px. Data model preserved for later. — change 6.3. |
| (HUD) — THREATS panel: always show count | Implemented | Renamed to `ENEMIES`, value is always `enemiesCount + ' REMAINING'`. — change 6.4. |
| (Gen) — Empty-map fix | Implemented | Two compounding bugs left levels with no bases / no enemies. (a) the base-building loop returned 1 on the first `buildBase()` failure; (b) `propCount` could roll 0. Both fixed. Plus a defense-in-depth terrain-spawn safety net. — change 6.5. |
| (Gen) — Initial-spawn life drop | Implemented | `Player` constructor's `--playerLives` was firing on the very first spawn too. Added a `++playerLives` compensation in `finishLevelSetup()`. — change 6.6. |

---

## Table of Contents

1. [Core loop & objectives — biggest fun issue today](#1-core-loop--objectives--biggest-fun-issue-today)
2. [Player feedback & clarity — "I didn't know I was dying"](#2-player-feedback--clarity--i-didnt-know-i-was-dying)
3. [Combat feel & impact — "the gun feels weak"](#3-combat-feel--impact--the-gun-feels-weak)
4. [HUD & UI information — "I can't see what's happening"](#4-hud--ui-information--i-cant-see-whats-happening)
5. [Progression & replayability — "why play another run?"](#5-progression--replayability--why-play-another-run)
6. [Onboarding & quality of life — "I have no idea what to do"](#6-onboarding--quality-of-life--i-have-no-idea-what-to-do)
7. [Summary table — ranked by impact](#7-summary-table--ranked-by-impact)

---

## 1. Core loop & objectives — biggest fun issue today

The current loop is:

1. Player spawns in a generated level.
2. Player wanders the level until they find the **BonusBox** (one per level).
3. Player shoots the BonusBox → `levelEndTimer.set()` → level ends.
4. Repeat with a new procedural level, +1 life.

That makes the BonusBox the **only** objective in the game. Every other system — combat, weapon drops, kill streaks, time bonus, lava rocks, props, checkpoints — is at best a sideshow, because the moment the player finds the box, the level ends. The level-clear reward is "1 life + 100 pts per kill", but most players will be at low health / low ammo when they find the box, so the incentive to fight more enemies is "earn back the life you just spent reaching the box".

**This is the single biggest fix to make the game more fun**, and the suggestion that requires the smallest amount of new code.

### 1.1 — Make the BonusBox a "final objective", not the only objective

**Today:** `appLevel.js:773-783` spawns exactly one BonusBox per level, at a random grounded position, far from the player start. Destroying it ends the level. Nothing else matters.

**Suggestion — "Clear all enemies, then break the box":**
- End the level when **both** conditions are met: (a) `liveEnemies.size === 0` AND (b) the player has destroyed the BonusBox.
- The BonusBox remains the climax moment (it's the level finale), but the player is now required to clear the enemies first.
- The THREATS HUD panel already shows `enemiesCount` ("X REMAINING" vs "AREA CLEAR"), so the UI signal exists. Just change the gate in `app.js:660-662`:

```js
// before
if (!enemiesCount && !levelEndTimer.isSet() && !pendingApplyArt &&
    players.length > 0 && players[0] && !players[0].destroyed)
    levelEndTimer.set();

// after — don't auto-end the level when all enemies die; require the box
if (!enemiesCount && !levelEndTimer.isSet() && !pendingApplyArt &&
    players.length > 0 && players[0] && !players[0].destroyed)
    areaClear = 1;   // <-- new flag, displayed by BonusBox.collideWithObject
```

…and in `BonusBox.collideWithObject` (`appObjects.js:643-660`), only set `levelEndTimer` if `areaClear` is true, otherwise play a "locked" sound (reuse `sound_walk` or add `sound_box_locked`).

**Impact:** every weapon drop, every kill streak, every grenade thrown suddenly matters. Combat becomes a goal, not a distraction. The 35% weapon-drop chance on enemy kill (`appCharacters.js:682-685`) finally has a reason to exist.

**Cost:** ~5 lines + 1 sound constant. No new objects per frame. Zero perf impact.

---

### 1.2 — Add secondary objectives for replay variety

> **Status (2026-06-14):** The HUNT-only restriction is in place per the
> user's request — see change 6.1 in `CHANGES_2026-06-11.md`. The
> SURVIVE / COLLECT branches are preserved in the source as dead code
> so the mix can be restored in a one-line revert when desired. The
> suggestion below describes the original rollout; it has not been
> reverted.

The level is procedurally generated but always the same shape: one main base + scattered enemies + one bonus box. To break the monotony, seed the level with **one of N objective types** at generation time:

| Objective | Description |
|---|---|
| **HUNT** (default) | Clear all enemies + break the box. |
| **SURVIVE** | Stay alive for 45s after the wave starts, then break the box. |
| **COLLECT** | 3 hidden stashes spawn across the level; grab them all, then break the box. |
| **ESCORT** | An NPC walks toward the box; keep it alive for 30s. (Optional, biggest scope.) |

The objective type is shown on the LEVEL panel ("LEVEL 1 — HUNT") and on the LEVEL CLEAR panel. This adds replayability — players will want to see each objective type — without adding any per-frame work.

**Cost:** ~30-50 lines in `appLevel.js:534-585` (one extra branch in `generateLevel`). No new objects per frame.

---

### 1.3 — Show the BonusBox direction when the player is far away

The BonusBox is a 1×1 object in a level that, after the 2x zoom, shows 80×45 world units on screen. The player has to wander to find it.

**Suggestion:** When the player is more than 30 world units from the BonusBox, draw a subtle **off-screen indicator** (an arrow at the screen edge, or a directional cone at the player's feet) pointing toward the box. The indicator fades out as the player gets close (< 20 units), so the discovery moment is preserved for nearby players.

This is a single arrow draw per frame (`drawRect` + rotation), so it's effectively free.

**Cost:** ~15 lines. One `drawRect` per frame. No allocations.

---

## 2. Player feedback & clarity — "I didn't know I was dying"

The current "I got hit" feedback is a 0.5-second white flash on the player sprite (`appObjects.js:39-50`). That's it. No hit-pause, no sound, no knockback, no visible health. The player often doesn't realize they were hit until the death screen appears.

### 2.1 — Add a player health bar (HP, not lives)

> **Status (2026-06-14):** The first half of this suggestion (replace
> the numeric LIVES counter with one heart per life) is implemented —
> see change 6.2 in `CHANGES_2026-06-11.md`. The deeper "4-HP per life
> + non-lethal damage" idea below has not been implemented; the player
> is still one-hit-killed.

**Today:** LIVES counts down 3 → 2 → 1 → 0. Each "life" is one full player character. The player has no health; one strong-enough hit kills instantly.

**Suggestion:** Give each Player a `health` (e.g., 3-5 HP). Damage is now per-hit, not per-life. Show a small HP bar above the player's head (or in the HUD). The "extra life" becomes a full-heal pickup.

Concretely:
- `Player.constructor` initializes `this.health = this.healthMax = 4`.
- `GameObject.damage` already supports sub-lethal damage; just make sure `Character.kill` (which sets `health = 0`) is the only place that drops to 0.
- HUD: add a tiny heart-icon row, or replace the LIVES panel with a 4-segment HP bar.

**Impact:** the player now knows "I got hit, I'm at 2/4 HP, I need to back off". Death stops feeling random.

**Cost:** ~20 lines. A new HUD element rendered per frame. The hearts are 4 draw calls — negligible.

---

### 2.2 — Hit-pause + hit-sound + camera-shake on player damage

When the player takes damage, add three simultaneous feedback cues (each is a single function call):
1. **Hit-pause** (2-3 frames of `timeDelta = 0`) — the classic "game freezes for a moment" trick. Stops the camera from moving for 50ms.
2. **Hit-sound** — add `sound_player_hit` in `appEffects.js` (reuse the existing `sound_die` shape but with a shorter envelope).
3. **Camera shake** — `cameraShake = min(1, cameraShake + 0.25)` (already works for explosions; just call it on player damage too).

**Cost:** ~10 lines. Zero perf impact (one shake scalar, one paused frame).

---

### 2.3 — Death replay / "what killed me?" indicator

When the player dies, show **who killed them** in the GAME OVER panel. The GameObject that dealt the killing blow is passed through `GameObject.damage(damage, damagingObject)`, but it's currently discarded.

**Suggestion:** Store `this.killedBy = damagingObject` on the Character in `damage()`. On the GAME OVER panel (`app.js:1017-1053`), add a small line under KILLS:

```
Killed by: Grenade-Tosser  (or "Heavy Elite" / "Spike Pit" / "Self (fire)")
```

This turns "I died for no reason" into a learning moment — the player now knows which enemy type to be more careful of.

**Cost:** ~5 lines + 1-2 lines in the panel. Zero perf impact.

---

## 3. Combat feel & impact — "the gun feels weak"

The pistol does 1 damage. Most enemies have 1-5 HP. The shotgun does 1 damage × 5 bullets. The plasma does 1 damage, fast. There's no visible feedback beyond the enemy's red flash (`appObjects.js:39-50`). No hit-spark, no bullet-impact particle, no kill-confirm.

### 3.1 — Bullet impact spark

When a bullet hits an enemy, currently nothing visible happens (just the enemy's health decrements). Add a small **hit spark** — 3-4 white particles at the impact point, lifetime 0.1s, no physics. This is a 3-particle emitter, 0.1s lifetime, so the cost is 4-8 particles per shot. Negligible.

**Code:** in `Bullet.collideWithObject` (`appObjects.js:551-575`), after `o.damage(this.damage, this)`, add:

```js
if (o.isGameObject && o.team !== this.team) {
    new ParticleEmitter(
        this.pos, 0, .08, 4, PI,
        0, undefined,
        new Color(1,1,.6), new Color(1,.5,.2),
        new Color(1,1,.6,0), new Color(1,.5,.2,0),
        .12, .15, 0, .1, .1,
        1, 1, 0, PI, 0,
        .5, 0, 1
    );
}
```

**Cost:** 4 particles, 0.08s lifetime. ~30 particles/sec at most in heavy combat. Negligible.

---

### 3.2 — Kill-confirm: small camera kick on enemy death

The camera already shakes on player damage and explosion. Add a smaller shake (0.05) on each enemy kill, so the player *feels* the kills land. This is a 1-line change in `Enemy.kill` (`appCharacters.js:670-687`):

```js
cameraShake = min(1, cameraShake + 0.05);
```

**Cost:** 1 line, 1 frame's shake update. No objects.

---

### 3.3 — Combo / streak system

Reward skilled play. Track consecutive kills without taking damage. At thresholds (3, 5, 10), show a brief on-screen "x3 STREAK", "x5 STREAK!", "x10 UNSTOPPABLE!" message with a score multiplier.

This is a 3-component addition:
- `streakCount` and `streakTimer` on the Player.
- Increment on enemy kill, reset on damage taken.
- A floating `hudText` that fades out over 1s.

**Impact:** the score is no longer "just sum of kills × level". Skilled play now visibly rewards the player.

**Cost:** ~25 lines. One floating text per frame during the streak window. Negligible.

---

### 3.4 — Grenade fuse + throw-arc indicator

The grenade has a 3-second fuse with a beep (`appObjects.js:395-399`), but no on-screen indicator that you have one ready, and no throw-arc preview. Two cheap additions:
- **Grenade count badge** — show "×3" next to the player when they have grenades.
- **Throw-arc dots** — when the player holds the throw key, draw 5-7 small dots along the predicted grenade trajectory (gravity arc, computed analytically from the current `velocity + gravity * t` formula). This is the classic "Bow & Arrow" UI pattern.

**Cost:** ~30 lines. The dots are 5-7 `drawRect` calls per frame, only while the throw key is held.

---

## 4. HUD & UI information — "I can't see what's happening"

### 4.1 — Add a weapon indicator

**Today:** `players[0].weapon.weaponType` (pistol / shotgun / plasma) is the only place weapon state lives. The HUD never displays it. When the player picks up a weapon, only the sound plays (`appObjects.js:717-719`).

**Suggestion:** Add a small weapon icon in the HUD (top-right or top-left, near the SCORE panel). When the weapon changes, briefly highlight the icon.

**Cost:** ~15 lines + a 3-frame icon (already in the tile sheet at tile 4). One draw call.

---

### 4.2 — Show "current best time" alongside the TIME panel

> **Status (2026-06-14):** The "current / best" suffix was tried and
> rolled back in the same batch — it overflowed the 180 px TIME panel on
> narrow Fire TV screens. The TIME panel now shows only the player's
> own counter (see change 6.3 in `CHANGES_2026-06-11.md`). The
> localStorage data model (`loadLevelBests` / `saveLevelBests`) is
> preserved so this can be re-surfaced later in a wider panel.

**Today:** the TIME panel just shows elapsed time. The player has no idea if 0:42 is good.

**Suggestion:** On the very first level of a session, the TIME panel is just "0:00". From level 2 onward, show both the current run and the personal best for this level (e.g., "0:42 / 0:38"). The personal best is per-level (keyed by `levelSeed`), and stored in localStorage. New best → flash a "NEW BEST" indicator.

**Cost:** ~30 lines. One HUD element + localStorage I/O on level transitions only.

---

### 4.3 — Make the bottom THREATS panel show enemy types

> **Status (2026-06-14):** The THREATS panel was renamed to ENEMIES
> and its value simplified to always show `X REMAINING` (no
> "AREA CLEAR" / "CLEAR THEM ALL" status text) — see change 6.4 in
> `CHANGES_2026-06-11.md`. The per-type indicator idea below has not
> been implemented; the bottom-edge enemy dots are still the flat
> colored rectangles from the original pass-1 HUD.

**Today:** the bottom-edge enemy indicators (`app.js:649-658`) are flat color rectangles, no indication of enemy type. A weak/strong/elite/grenade-thrower all look the same.

**Suggestion:** Vary the indicator by enemy type (color already varies, but make it more distinct: weak = small green dot, strong = red, elite = white-with-pulse, grenade = purple-with-pulse). And show a tiny chevron pointing at the most "dangerous" enemy (the one with the lowest health or closest to the player).

**Cost:** ~10 lines. One draw call per live enemy per frame.

---

### 4.4 — Level-start "LEVEL N" title card

**Today:** the level just fades in.

**Suggestion:** Show a "LEVEL 1" / "LEVEL 2" title card for 1.5s when the level starts. Style it like the LEVEL CLEAR panel but with the level name and a thin gold accent. The TIME/THREATS/KILLS HUD panels stay hidden during the title card.

**Cost:** ~25 lines. One-time draw during the title card window.

---

### 4.5 — Visual checkpoint progress indicator

**Today:** checkpoints are flags on the level. The player has no idea how many are in the level or how far they've gone.

**Suggestion:** Show "Checkpoint 2/4" in the HUD, derived from `levelSize.x / 75` (matches the placement spacing in `appLevel.js:573`). The flag color stays as today (red = active, white = not yet).

**Cost:** ~5 lines. One text draw per frame.

---

## 5. Progression & replayability — "why play another run?"

The game has:
- High-score list (top 10) — already excellent
- Name entry on qualifying run
- Procedural levels

But there's **no meta-progression**. There's no reward for "playing again" beyond trying to beat your own score. No unlocks, no achievements, no per-weapon stats, no cosmetics.

### 5.1 — Per-weapon stats tracking

Track across the session (or all-time, in localStorage):
- Bullets fired per weapon
- Hits landed per weapon
- Kills per weapon
- Damage dealt per weapon

Show in a new "STATS" sub-screen in the pause menu, accessible between RESUME and SCOREBOARD.

**Cost:** ~50 lines. localStorage I/O on game start/end only. Render is a table, drawn once when the screen is open.

---

### 5.2 — "Daily seed" mode

Right now `levelSeed = rand(1e9) | 0` is fully random. Add a "DAILY" mode where the seed is derived from the date (`YYYYMMDD` integer). All players get the same level on the same day, so a high score is directly comparable.

Show "DAILY SEED" in the LEVEL panel and on the scoreboard. Add a separate "TODAY'S BEST" section in the scoreboard.

**Cost:** ~30 lines. localStorage to track "last daily played" so the player doesn't accidentally re-roll.

---

### 5.3 — Boss every 5 levels

Levels feel repetitive: same enemy types, same base layout, same density. A boss every 5 levels gives a clear "act" structure.

**Boss design:** a single large enemy with 30-50 HP, regenerating shield, periodic AoE attack, can't be knocked back. Visual: 2x size, white+gold color, pulsing glow. Spawns at the center of the level. The BonusBox spawns AFTER the boss dies, so the level structure becomes: clear enemies → beat boss → break box.

**Cost:** ~80 lines. A new `Boss` class extending `Character`. Boss fight adds a small amount of particles per hit (use the 3.1 hit-spark).

---

### 5.4 — Achievements (local-only)

Simple localStorage-backed achievements. Show in the new STATS screen with a checkmark. Examples:
- "First Blood" — kill 1 enemy
- "Combo Breaker" — 5-kill streak
- "Boxed Up" — break 10 bonus boxes
- "Speed Demon" — clear a level in under 30s
- "Pacifist" — clear a level without firing a shot (grenade only)
- "Fireproof" — survive being on fire for 3s without dying

**Cost:** ~60 lines. A new `achievements` object, checked on relevant events, persisted in localStorage.

---

## 6. Onboarding & quality of life — "I have no idea what to do"

### 6.1 — First-run tutorial overlay

On the very first run ever (localStorage flag), show a 3-step tutorial:
1. "← → Move   ↑ Jump" — overlay fades in over 1s, auto-fades after 3s.
2. "Z Shoot   X Roll   C Grenade" — appears after step 1.
3. "Find and shoot the glowing box to clear the level" — appears at level start.

Use the same `hudText` style. Persist "tutorial done" in localStorage so it never shows again.

**Cost:** ~40 lines. One localStorage key. No per-frame work.

---

### 6.2 — Pause / unpause during GAME OVER

**Today:** the GAME OVER panel is in the `else if (paused)` branch, so it's hidden when paused. The user has to unpause to see GAME OVER, then they have to wait 3 seconds before they can press a key to restart.

**Suggestion:** allow pause/unpause to cycle through GAME OVER → name-entry. The current "Press OK to play again" path is correct, but the Fire TV user pressing the Play/Pause button (keyCode 179) should at minimum NOT hide the GAME OVER panel. The simplest fix: render the GAME OVER panel *outside* the `if (paused) ... else if (gameover) ...` block, so it shows on top of the pause menu too.

**Cost:** ~5 lines (move the GAME OVER block out of the else-if). No new logic.

---

### 6.3 — Auto-pause on focus loss

`engine.js:103` already pauses on `document.hidden`. Add a pause on `window.onblur` (currently sets `paused = 1` but immediately unsets on focus). On a TV, the user might press the home button — the game should pause.

Actually, looking at the code, `window.onblur = ()=> paused = 1;` already does this. The issue is `window.onfocus = ()=> paused = 0;` immediately unpauses, even if the user pressed pause before focus loss. Add a "user didn't explicitly resume" guard.

**Cost:** ~3 lines.

---

### 6.4 — Show controls in the pause menu's About screen

The About screen (`app.js:895-911`) shows credits but not controls. Add a one-line "CONTROLS" section listing keyboard, gamepad, and Fire TV mappings.

**Cost:** ~10 lines.

---

### 6.5 — Score popup on enemy kill (floating "+100")

A brief floating "+100" that rises and fades from the kill location, 0.6s lifetime. This is the classic "damage numbers" / "kill confirm" feedback.

**Cost:** ~25 lines. A new `KillPopup` class, spawned on kill, self-destroyed on timer. ~10-20 active at peak.

---

## 7. Summary table — ranked by impact

| # | Category | Severity | File(s) | Suggestion | Est. Fun Impact | Est. Cost |
|---|----------|----------|---------|------------|------------------|-----------|
| 1.1 | Core loop | 🟢 Critical | `app.js:660-662`, `appObjects.js:643-660` | Require enemy clear before BonusBox ends level | **Massive** — turns combat from a sideshow into the goal | ~5 lines |
| 2.1 | Feedback | 🟢 High | `appCharacters.js:693-724`, `app.js:666+` | Player HP bar (4 HP) instead of 1-hit kill | **High** — death stops feeling random | ~20 lines |
| 2.2 | Feedback | 🟢 High | `appCharacters.js`, `app.js` | Hit-pause + hit-sound + camera-shake on player damage | High — "I got hit" feedback | ~10 lines |
| 3.1 | Combat | 🟢 High | `appObjects.js:551-575` | Bullet-impact spark particles (3-4 each) | High — combat feels meatier | ~10 lines |
| 1.2 | Core loop | 🟡 Med | `appLevel.js:534-585` | Secondary objective types (SURVIVE, COLLECT, etc.) | High — replayability | ~50 lines |
| 4.1 | HUD | 🟡 Med | `app.js:666+` | Weapon indicator (pistol/shotgun/plasma icon) | High — clarity | ~15 lines |
| 3.3 | Combat | 🟡 Med | new state | Combo / streak system | High — reward skilled play | ~25 lines |
| 5.3 | Progression | 🟡 Med | new `Boss` class | Boss every 5 levels | High — "act" structure | ~80 lines |
| 1.3 | Core loop | 🟡 Med | new render code | Off-screen direction indicator to BonusBox | Medium — reduces wandering | ~15 lines |
| 4.4 | HUD | 🟡 Med | `app.js` | Level-start "LEVEL N" title card | Medium — cinematic feel | ~25 lines |
| 2.3 | Feedback | 🟡 Med | `appCharacters.js`, `app.js` | Death-replay: "Killed by [enemy]" line | Medium — learning moment | ~5 lines |
| 4.2 | HUD | 🟡 Med | `app.js`, `appLevel.js` | Show personal best time per level | Medium — speedrun motivation | ~30 lines |
| 4.3 | HUD | 🟡 Med | `app.js:649-658` | Enemy-type-aware bottom indicators | Medium — better threat awareness | ~10 lines |
| 6.1 | Onboarding | 🟡 Med | new overlay code | First-run 3-step tutorial overlay | Medium — new players | ~40 lines |
| 5.4 | Progression | 🟡 Med | new achievements system | 6-8 local achievements | Medium — replayability | ~60 lines |
| 5.1 | Progression | 🟢 Low | new stats tracking | Per-weapon stats in new pause sub-screen | Medium — mastery | ~50 lines |
| 5.2 | Progression | 🟢 Low | new daily logic | Daily-seed mode for comparable scores | Low-Med — niche appeal | ~30 lines |
| 3.2 | Combat | 🟢 Low | `appCharacters.js:670-687` | Small camera kick (0.05) on enemy kill | Low-Med — feel | 1 line |
| 6.5 | Feedback | 🟢 Low | new `KillPopup` class | Floating "+100" damage numbers | Low — visual flair | ~25 lines |
| 4.5 | HUD | 🟢 Low | `app.js`, `appLevel.js:573-585` | "Checkpoint X/Y" progress | Low — context | ~5 lines |
| 6.4 | Onboarding | 🟢 Low | `app.js:895-911` | Controls list in About screen | Low — new players | ~10 lines |
| 3.4 | Combat | 🟢 Low | new grenade arc code | Grenade throw-arc preview dots | Low — accuracy | ~30 lines |
| 6.2 | UX | 🟢 Low | `app.js:993-1053` | Allow GAME OVER to show on top of pause menu | Low — Fire TV ergonomics | ~5 lines |
| 6.3 | UX | 🟢 Low | `engine.js:103-105` | Guard `onfocus` unpause against explicit pause | Low — edge case | ~3 lines |

---

## Recommended sequencing

If only a small budget is available, these three changes in this order produce the largest fun-per-line:

1. **1.1 (BonusBox is the finale, not the only objective)** — 5 lines, transforms the core loop from "find box" to "kill everything, then find box". Highest leverage.
2. **2.1 (Player HP)** — 20 lines, makes the player feel like they have agency over their own death. The most-asked-for missing feature in playtesting.
3. **3.1 (Bullet impact spark)** — 10 lines, makes combat feel impactful. The cheapest "juice" win.

All three together are ~35 lines and change the game from "find the box" to "fight through a level, then find the box, while seeing your own health and feeling every shot land."

---

*End of gameplay audit. None of these suggestions touch the perf-critical code paths identified in `docs/PERFORMANCE_IMPROVEMENTS.md`; they are all either no-cost (state, flags) or bounded one-shot spawns (small particle bursts, single-frame UI draws).*
