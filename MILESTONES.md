# Milestones

## M1 Render-only
- Load level01.json
- Draw towers and troop counts

## M2 Links + input
- Drag to create/replace outgoing link
- Render links

## M3 Sending + movement
- Towers send UnitPackets
- Packets move along links

## M4 Combat + capture
- Packet vs packet combat
- Packet vs tower resolution
- Ownership flip

## M5 AI + win/lose
- Simple AI attacks
- Win/Lose detection
- Restart works

## M6 Meta progression layer
- Run-based structure across multiple missions
- Persistent Glory currency + upgrade tree
- Continue run after reload + summary screens

## M7 Enemy & wave variety
- Data-driven enemy archetypes (swarm/tank/ranged/shield/splitter/support) + elites
- Deterministic handcrafted/procedural wave generation with wave modifiers
- Mini-boss + boss mechanics (slam/summon/enrage), telegraphs, and mission telemetry UI

## M8 Meta layer expansion (Retention Engine) v1
- Branching persistent upgrade trees (Offense / Economy / Tactical)
- Tactical skills: unlocks, cooldown/duration/potency scaling, in-mission fixed-tick skill manager
- Ascensions: selectable run mutators with deterministic persistence and reward multipliers
- Permanent unlock pacing rules with progress metrics and end-of-run unlock evaluation
- Run unlock snapshot + sorted id resolution to preserve deterministic seeded generation
- Save schema v2 + migration path from older profiles/run states
