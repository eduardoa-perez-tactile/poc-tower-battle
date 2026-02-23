# Tower Battle PoC Spec (Current Scope)

## Goal
Build a playable browser strategy prototype with tower-link control, mission-based runs, meta progression, M7 enemy/wave variety, and M8 retention engine expansion.

## Tech Stack
- TypeScript (strict)
- Vite
- HTML5 Canvas 2D (single canvas)
- Minimal DOM overlay (no React)

## Core gameplay systems
- Top-down node map with player/enemy/neutral towers.
- Player draws outgoing links from owned towers to redirect pressure.
- Towers regenerate and send grouped troop packets.
- Packets move, fight, siege, and capture towers.
- Enemy AI periodically retargets attacks.
- Mission progression is organized into seeded runs with persistent meta bonuses.

## M7 combat extension
- Data-driven enemy archetypes with distinct tactical behavior.
- Elite variants with multipliers, tint, and reward drops.
- Wave modifiers applied per wave to composition and tempo.
- Deterministic wave generation using run seed + wave context.
- Miniboss escalation and final boss mechanics (slam, summon, enrage).
- Telegraph rendering and boss hp bar.
- Mission wave telemetry UI (upcoming preview, active modifiers, mission gold, buff timer).

## M8 retention engine extension
- Data-driven branching persistent upgrade trees (Offense / Economy / Tactical).
- Data-driven skills with fixed-tick cooldown manager and mission HUD skill bar.
- Ascension mutators selectable per run with reward multipliers.
- Permanent unlock pacing rules evaluated from persistent account progress metrics.
- Run-start unlock snapshot for deterministic generation and mid-run stability.
- Backward-compatible save/load migrations (schema v2).

## Controls
- Drag from owned tower to target tower to create/replace outgoing link.
- Right click or `Escape` cancels an active drag.
- Mission skill cast buttons trigger unlocked tactical skills.
- Restart button and debug mission controls are available in UI.

## Core entities
- `Tower`: ownership, hp, troop economy, regen.
- `Link`: source-target route for packet movement.
- `UnitPacket`: grouped moving combat packet with archetype behavior data.
- `WavePlan`: scheduled spawn entries and applied modifiers for a wave.

## Rules summary
- Each tower has max one standard outgoing link (extended via meta tactical upgrades).
- Sending is continuous while link exists.
- Packet combat uses ranges, cooldowns, and archetype modifiers.
- Arrival resolves reinforcement or capture flow.
- Win condition in missions with wave director: survive until full wave program is completed.
- Lose condition: player owns zero towers.

## Data-driven assets
- `levels/level01.json`
- `public/data/missions.json`
- `public/data/upgrades.json`
- `public/data/skills.json`
- `public/data/ascensions.json`
- `public/data/unlocks.json`
- `public/data/enemyArchetypes.json`
- `public/data/wave-modifiers.json`
- `public/data/waves-handcrafted.json`
- `public/data/wave-balance.json`

## Performance constraints
- Use pooled packets for transient enemy traffic.
- Keep update loop deterministic and fixed-step.
- Avoid per-frame framework rerender loops for HUD updates.
- Reuse shared canvas drawing paths and compact packet representations.

## Deliverable
- `npm install && npm run dev` launches playable prototype.
- `npm run build` passes with production build output.
