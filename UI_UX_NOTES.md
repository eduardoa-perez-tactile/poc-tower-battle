# UI / UX Notes

## World tooltip projection
- `src/ui/worldToScreen.ts` provides `useWorldToScreen(canvas)`.
- Current renderer uses 2D world-space in canvas pixels, so projection maps `world.x/world.y` directly into viewport coordinates via `canvas.getBoundingClientRect()`.
- `src/ui/WorldTooltipOverlay.ts` applies viewport clamping and above/below flipping, then smooths position in RAF by updating DOM `transform` (no per-frame React/state updates).

## Territory control mission HUD
- Mission HUD includes a "Tower Selection" card in `src/main.ts`.
- Synced DOM ids:
- `missionSelectedTower`
- `missionClusterSize`
- `missionClusterBonusRegen`
- `missionClusterBonusArmor`
- `missionClusterBonusVision`
- Selected tower id is provided by `InputController.getSelectedTowerId()`.

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

## Enemy descriptions data
- Enemy one-line descriptions are read from `description` in:
  - `public/data/enemyArchetypes.json` (runtime source)
  - `public/data/enemies.json` (legacy mirror)
- Type support is in `src/waves/Definitions.ts` via `EnemyArchetypeDefinition.description`.

## Debug menu toggle
- Global toggle key is `D` from app root (`src/main.ts`).
- State lives in `src/ui/debugStore.ts` (`debugOpen` + UI toggles).
- The tabbed right-dock menu is rendered by `renderDebugPanel()` in `src/main.ts`.
