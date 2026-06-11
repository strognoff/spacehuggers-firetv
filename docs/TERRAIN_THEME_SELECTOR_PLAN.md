# Terrain Theme Selector

## Objective
Add a persistent terrain-theme selector available from both the Start Panel and Pause menu, with `Auto`, `Green`, `Snow`, `Desert`, and `Industrial` options. `Auto` preserves current procedural behavior; fixed themes override level palette/weather generation for all subsequent levels until changed.

## Key Files & Context
- `app.js`
  - Holds Start Panel and Pause menu state/input/render logic.
  - Already persists highscores via `localStorage`, which can be reused for terrain preference storage.
- `appLevel.js`
  - Owns per-level palette generation in `nextLevel()`.
  - Owns weather/art application in `applyArtToLevel()`.
- `scripts/check-pass1-spec.js`
  - Existing lightweight regression/spec script; will be extended for the new terrain setting.
- `www/app.js`, `www/appLevel.js`
  - Generated via `npm run sync:source`; no direct edits.

## Implementation Steps
1. **Add terrain preference state and persistence in `app.js`**
   - Add a localStorage key for terrain selection.
   - Define supported terrain options and helper functions to load/save/cycle the selected theme.
   - Initialize the in-memory terrain preference during startup.

2. **Expose terrain selection in the Start Panel**
   - Expand the Start Panel menu from 2 items to 3 items.
   - Add a `TERRAIN` row that displays the current selection.
   - Support left/right (and optionally OK on that row) to cycle themes without starting the game.
   - Keep existing `PLAY` and `HIGH SCORES` behavior intact.

3. **Expose terrain selection in the Pause menu**
   - Expand pause menu item count and add a `Terrain` row.
   - Render the current selection inline in the menu label.
   - Support left/right or confirm to cycle terrain selection.
   - Preserve About/Scoreboard sub-screen behavior and existing actions.

4. **Add theme resolution helpers in `appLevel.js`**
   - Introduce a small helper to resolve the effective terrain mode (`auto` vs fixed theme).
   - Add a second helper to assign deterministic palette/weather values for fixed themes.
   - Keep `Auto` on the current random path so existing procedural variety remains available.

5. **Override palette/weather generation for fixed themes**
   - In `nextLevel()`, keep current random palette generation for `Auto`.
   - For fixed themes, set `levelColor`, `levelSkyColor`, `levelSkyHorizonColor`, and `levelGroundColor` from curated theme palettes.
   - In `applyArtToLevel()`, use theme-directed weather selection when a fixed terrain is chosen:
     - `Snow` → snowy/icy palette and snow weather intent
     - `Green` → greener palette and no snow
     - `Desert` → warm sandy palette and no precipitation
     - `Industrial` → gray/steel palette, optionally rain but no snow
   - Since low graphics mode is currently forced, weather particles may remain visually disabled; the terrain distinction should still be visible through palette choices.

6. **Add regression coverage**
   - Extend `scripts/check-pass1-spec.js` to verify:
     - terrain persistence key/helpers exist
     - Start Panel and Pause menu include terrain option rendering/handling
     - `appLevel.js` contains theme-resolution / fixed-theme override logic

7. **Sync and validate**
   - Run:
     - `npm run sync:source`
     - `npm run check:pass1`
     - `npm run check:www`
     - `npm run parse:www`

## Verification & Testing
- Manual behavior checks:
  - Start Panel shows `Terrain` and cycles through all 5 options.
  - Pause menu shows current terrain and allows changing it.
  - Terrain selection persists after restart/reload.
  - `Auto` still yields procedural variety.
  - Fixed themes visibly bias palettes as intended on newly generated levels.
- Automated checks:
  - `npm run check:pass1`
  - `npm run check:www`
  - `npm run parse:www`
