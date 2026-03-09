# Tower Battle PoC

Browser-based real-time strategy prototype focused on **tower network control**.  
You route links between towers, stream troop packets across the graph, hold territory clusters for bonuses, and survive escalating enemy waves.

## What the game is

Tower Battle is a tactical territory-control game played on a node map:

- Towers are nodes with owners (`player`, AI factions, or neutral).
- Links define where units can flow.
- Owned towers regenerate troops and automatically send packets along outgoing links.
- Packets fight in transit, then reinforce or siege target towers on arrival.
- Territory clusters (connected owned towers) grant scaling bonuses:
  - `3+` towers: regen boost
  - `5+` towers: armor boost
  - `8+` towers: vision boost

Core objective:

- **Campaign / mission runs:** capture enemy network or survive wave program while still owning at least one tower.
- **Skirmish:** be the last faction with towers remaining.

## Modes in this repo

- **Campaign flow:** stage -> level -> mission progression, with unlocks and completion tracking.
- **Run/meta progression:** persistent upgrades, unlock catalogs, ascension modifiers, and deterministic seeded run generation.
- **Skirmish (local multiplayer-style FFA):** one human faction vs AI factions on a dedicated skirmish map.
- **In-dev Level Editor (dev only):** data tooling for level/content iteration.

## Controls

- Drag from an owned tower to a target tower: create/retarget outgoing link.
- Right click or `Esc`: cancel active link drag.
- Click tower: inspect tower and cluster status in HUD.
- Number keys `1-9`: trigger unlocked skills.
- `P`: pause/unpause mission.

## Tech stack

This project intentionally uses a lightweight web stack:

- **Language:** TypeScript (strict mode)
- **Build/dev tooling:** Vite, TypeScript compiler (`tsc`)
- **Testing:** Vitest
- **Rendering:** HTML5 Canvas 2D (single-canvas renderer)
- **UI layer:** minimal DOM overlays and modular HUD components (no React/Vue/Angular)
- **Runtime architecture:** fixed-step simulation loop in `requestAnimationFrame`, deterministic seeded systems for waves/runs
- **Content model:** data-driven JSON catalogs for levels, waves, enemies, upgrades, skills, ascensions, and unlocks

## Project structure

- `src/main.ts` - app bootstrap, screen flow, mission orchestration
- `src/game/` - game loop, level loading, skill runtime
- `src/sim/` - world state, simulation tick, territory control, link rules
- `src/waves/` - wave definitions, generation, enemy factory, director
- `src/meta/`, `src/run/`, `src/save/` - progression, run generation, persistence/migrations
- `src/render/` - canvas rendering and sprite atlases
- `src/ui/` - HUD/screens/overlays
- `src/tools/level_editor/` - in-dev level editor modules
- `public/data/` - gameplay data catalogs (missions, upgrades, enemies, waves, etc.)
- `levels/` and `public/levels/` - map/mission level JSON

## Getting started

```bash
npm install
npm run dev
```

Open the local Vite URL shown in terminal.

## Build and test

```bash
npm run build
npm run test
```

Useful additional script:

- `npm run build:campaign` - rebuild campaign v2 data artifacts.

## Documentation

For deeper design/implementation notes:

- `SPEC.md`
- `ARCHITECTURE.md`
- `GAME_RULES.md`
- `DATA_FORMAT.md`
- `docs/LEVEL_FORMAT.md`
- `docs/LEVEL_EDITOR_TOOL.md`
