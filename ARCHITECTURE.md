# Architecture (PoC)

## Runtime
- Single canvas: `#gameCanvas`
- `main.ts` boots the game, loads level JSON, starts loop.

## Modules (create these files)
- `src/game/Game.ts` orchestrates loop state: update(dt), render()
- `src/game/LevelLoader.ts` loads `levels/level01.json`
- `src/sim/World.ts` holds all simulation state (towers, links, packets)
- `src/render/Renderer2D.ts` draws world to canvas
- `src/input/InputController.ts` handles drag-to-connect

## Constraints
- No external libs beyond Vite/TS.
- Use UnitPackets (group objects), not per-unit entities.
