# Architecture (PoC + M8)

## Runtime
- Single canvas renderer with lightweight DOM overlays.
- `src/main.ts` boots app state, loads data files, and drives screen flow.
- Fixed-step simulation runs in `requestAnimationFrame` loop.

## Primary modules
- `src/main.ts`: app bootstrap, menu/meta/run screens, mission orchestration, docs-aligned data loading, HUD sync.
- `src/game/Game.ts`: fixed-step loop, AI decisions, skill dispatch, win/lose evaluation, renderer handoff.
- `src/game/SkillManager.ts`: fixed-tick skill cooldowns, activation, temporary modifier state.
- `src/game/LevelLoader.ts`: level JSON parsing and validation.
- `src/sim/World.ts`: mutable world state for towers, links, packets, scripted links, packet pool.
- `src/sim/Simulation.ts`: regen, sending, packet combat, movement, arrival/capture, modifier hooks.
- `src/input/InputController.ts`: player drag-to-link interactions.
- `src/render/Renderer2D.ts`: links/towers/packets rendering plus telegraphs and boss bar.

## Meta progression modules (M8)
- `src/meta/MetaProgression.ts`:
- retention catalogs (upgrades/skills/ascensions/unlocks) loading + validation
- upgrade tree prerequisite DAG checks
- deterministic modifier resolution pipeline
- unlock evaluation against persistent progress metrics
- `src/save/Schema.ts`: schema v2 for meta profile and run state.
- `src/save/Storage.ts`: save/load normalization + migrations (v1 -> v2).
- `src/run/RunGeneration.ts`: run creation with ascension selection and unlock snapshot.

## Wave system modules
- `src/waves/Definitions.ts`: wave/enemy config types and data loading.
- `src/waves/EnemyFactory.ts`: archetype packet construction, scaling, unlock-filtered availability.
- `src/waves/WaveGenerator.ts`: deterministic handcrafted/procedural wave generation with unlock filtering.
- `src/waves/WaveDirector.ts`: runtime wave execution, spawn scheduling, rewards, boss abilities, telemetry, ascension hooks.

## Data-driven content
- Mission templates: `public/data/missions.json`
- Persistent upgrade trees: `public/data/upgrades.json`
- Skills: `public/data/skills.json`
- Ascensions: `public/data/ascensions.json`
- Permanent unlock pacing: `public/data/unlocks.json`
- Enemy archetypes: `public/data/enemyArchetypes.json`
- Wave modifiers: `public/data/wave-modifiers.json`
- Handcrafted waves: `public/data/waves-handcrafted.json`
- Wave scaling/rewards/elite/boss config: `public/data/wave-balance.json`
- Baselines/difficulty targets: `public/data/balanceBaselines.json`, `public/data/difficultyTiers.json`, `public/data/wavePacingTargets.json`

## Frame/update flow
- `main.ts` calls `game.frame(dt)` each frame.
- `Game` fixed-step order:
- `waveDirector.updatePreStep`
- `skillManager.update`
- `updateWorld` simulation tick
- `waveDirector.updatePostStep`
- enemy strategic AI
- match result evaluation
- `Renderer2D.render` draws world plus wave visuals.

## Determinism and performance
- Wave composition/schedule is generated from seeded RNG.
- Modifier resolution applies in stable order: base -> meta -> ascensions -> difficulty -> clamp.
- IDs are sorted before aggregation to avoid object-key-order dependence.
- Run content gates are snapshotted at run start (`runUnlockSnapshot`) and used as explicit generation input.
- Packet pooling is used to reduce allocation churn.
- UI telemetry and skill HUD update via targeted DOM sync, not per-frame React rerenders.
