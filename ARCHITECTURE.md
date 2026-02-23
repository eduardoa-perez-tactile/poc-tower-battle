# Architecture (PoC + M7)

## Runtime
- Single canvas renderer with lightweight DOM overlays.
- `src/main.ts` boots app state, loads data files, and drives screen flow.
- Fixed-step simulation runs in `requestAnimationFrame` loop.

## Primary modules
- `src/main.ts`: app bootstrap, menu/meta/run screens, mission orchestration, debug UI.
- `src/game/Game.ts`: fixed-step loop, AI decisions, win/lose evaluation, renderer handoff.
- `src/game/LevelLoader.ts`: level JSON parsing and validation.
- `src/sim/World.ts`: mutable world state for towers, links, packets, scripted links, packet pool.
- `src/sim/Simulation.ts`: regen, sending, packet combat, movement, arrival/capture.
- `src/input/InputController.ts`: player drag-to-link interactions.
- `src/render/Renderer2D.ts`: links/towers/packets rendering plus telegraphs and boss bar.

## Wave system modules (M7)
- `src/waves/Definitions.ts`: wave/enemy config types and data loading.
- `src/waves/EnemyFactory.ts`: archetype packet construction and elite/stat application.
- `src/waves/WaveGenerator.ts`: deterministic handcrafted/procedural wave plan generation.
- `src/waves/WaveDirector.ts`: runtime wave execution, spawn scheduling, rewards, boss abilities, telemetry.

## Data-driven content
- Enemy archetypes: `public/data/enemies.json`
- Wave modifiers: `public/data/wave-modifiers.json`
- Handcrafted waves: `public/data/waves-handcrafted.json`
- Wave scaling/rewards/elite/boss config: `public/data/wave-balance.json`
- Mission templates: `public/data/missions.json`
- Meta upgrades: `public/data/meta-upgrades.json`

## Frame/update flow
- `main.ts` calls `game.frame(dt)` each frame.
- `Game` fixed step order:
- `waveDirector.updatePreStep`
- `updateWorld` simulation tick
- `waveDirector.updatePostStep`
- enemy strategic AI
- match result evaluation
- `Renderer2D.render` draws world plus wave visuals.

## Determinism and performance
- Wave composition/schedule is generated from seeded RNG.
- Packet pooling is used to reduce allocation churn.
- Scripted links are hidden and recycled as needed.
- UI telemetry updates via targeted DOM sync, not per-frame React rerenders.
