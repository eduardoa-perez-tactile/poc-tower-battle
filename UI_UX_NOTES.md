# UI / UX Notes

## World tooltip projection
- `src/ui/worldToScreen.ts` provides `useWorldToScreen(canvas)`.
- Current renderer uses 2D world-space in canvas pixels, so projection maps `world.x/world.y` directly into viewport coordinates via `canvas.getBoundingClientRect()`.
- `src/ui/WorldTooltipOverlay.ts` applies viewport clamping and above/below flipping, then smooths position in RAF by updating DOM `transform` (no per-frame React/state updates).

## Territory control mission HUD
- Mission HUD is modular and lives in `src/ui/hud/`.
- Composition root: `GameplayHUD` (`src/ui/hud/GameplayHUD.ts`).
- Zones:
- `TopBarZone` (mission/wave/state, gold/towers/regen, pause/speed, overlay mini-toggles)
- `WaveIntelPanel` (collapsible right-side wave intelligence)
- `ObjectiveCard` (bottom-left objective + progress + waves secured + cluster status)
- `TowerInspectorPanel` (bottom-right, visible only when tower is selected)
- Data binding is built in `buildHudViewModel.ts` and selected tower id still comes from `InputController.getSelectedTowerId()`.
- Capture communication model (phase-aware):
- `stable` (no hostile pressure), `contested` (defenders being reduced), `breaching` (tower HP being reduced).
- Capture overlay renders dual-ring progress:
- `--capture-pressure` for defender pressure.
- `--capture-breach` for post-defender HP breach.
- `--capture-takeover` for label emphasis.

## Territory visual indicators
- Renderer draws cluster feedback in `src/render/Renderer2D.ts`.
- Cluster `3+`: faint green ring.
- Cluster `5+`: shield marker above tower.
- Cluster `8+`: expanded vision circle.
- Indicators are drawn in canvas render pass (no React rerender path).

## Adding new tooltip fields
- Tower tooltip content is assembled in `WorldTooltipOverlay.showTowerTooltip()`.
- Enemy tooltip content is assembled in `WorldTooltipOverlay.showEnemyTooltip()`.
- To add fields, extend `collectTowerData()` or `pickEnemyPacket()` and append rows/chips with `createTooltipRow()` / `createTooltipChipRow()`.
- Tower tooltip now includes a derived control row and capture rule hint:
- `Control: Stable/Contested/Breaching (...)`
- `Capture: Control transfers only when HP reaches 0.`

## Enemy descriptions data
- Enemy one-line descriptions are read from `description` in:
  - `public/data/enemyArchetypes.json` (runtime source)
  - `public/data/enemies.json` (legacy mirror)
- Type support is in `src/waves/Definitions.ts` via `EnemyArchetypeDefinition.description`.

## Debug menu toggle
- Global toggle key is `D` from app root (`src/main.ts`).
- State lives in `src/ui/debugStore.ts` (`debugOpen` + UI toggles).
- The tabbed right-dock menu is rendered by `renderDebugPanel()` in `src/main.ts`.
- Overlay toggles (`Regen`, `Capture`, `Cluster`) are mirrored between debug UI toggles and top HUD mini-toggle buttons.
- Overlay toggles (`R/C/L`) default to enabled and are auto-enabled on mission start.

## Splash screen
- Splash screen is rendered in `renderCurrentScreen()` (`src/main.ts`, `title` branch).
- The mock device status strip and loading bar were removed.
- Primary CTA is the enlarged `Tap Screen to Begin` prompt.

## Mission pause modal style
- Pause overlay uses `wrapCenteredModal()` in `src/main.ts` to vertically center the popup in gameplay.
- Modal shell classes are:
- `mission-pause-shell`
- `mission-pause-hero`
- `mission-pause-actions`
- The control-summary explanatory text block was removed; only hero + actions are shown.
- Buttons are intentionally full-width and stacked (not horizontal) to improve readability during pause decisions.
