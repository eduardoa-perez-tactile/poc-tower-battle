# Level JSON Format

This document defines the grid-based level format used by Tower Battle's **Stages → Levels → Missions** pipeline.

## File location

Bundled levels live under:

- `/levels/stage01/level01.json`
- `/levels/stage01/level02.json`
- `/levels/stage02/level01.json`

User-generated levels are saved to localStorage and exported as JSON downloads.

## Root schema

```json
{
  "version": 1,
  "stageId": "stage01",
  "levelId": "level01",
  "name": "Verdant Crossroads",
  "size": "small",
  "grid": {
    "width": 24,
    "height": 16,
    "minCellSize": 40,
    "layers": {
      "ground": {
        "default": "grass",
        "overrides": [
          { "x": 0, "y": 0, "tile": "dirt" }
        ]
      },
      "decor": {
        "overrides": []
      },
      "blocked": [
        { "x": 5, "y": 7 }
      ]
    }
  },
  "nodes": [
    {
      "id": "HQ",
      "x": 3,
      "y": 8,
      "type": "stronghold",
      "owner": "player",
      "regen": 3,
      "cap": 120,
      "archetype": "STRONGHOLD"
    },
    {
      "id": "A",
      "x": 6,
      "y": 7,
      "type": "tower",
      "owner": "neutral",
      "regen": 1.2,
      "cap": 75
    }
  ],
  "edges": [
    { "from": "HQ", "to": "A" }
  ],
  "missions": [
    {
      "missionId": "m01",
      "name": "Hold the Line",
      "seed": 12345,
      "waveSetId": "waves_basic_01",
      "objectiveText": "Survive all waves.",
      "difficulty": 1
    }
  ],
  "runtime": {
    "rules": {
      "maxOutgoingLinksPerTower": 1,
      "sendRatePerSec": 6,
      "collisionDistancePx": 14,
      "captureSeedTroops": 10,
      "defaultUnit": {
        "speedPxPerSec": 120,
        "dpsPerUnit": 1,
        "hpPerUnit": 1
      }
    },
    "ai": {
      "aiThinkIntervalSec": 2.5,
      "aiMinTroopsToAttack": 25
    }
  }
}
```

## Required fields

- `version`: currently `1`
- `stageId`: stage identifier
- `levelId`: level identifier within stage
- `name`: display name
- `size`: `small | medium | big`
- `grid.width`, `grid.height`: tile dimensions
- `grid.minCellSize`: minimum world-space cell size used for grid→world conversion
- `grid.layers.ground.default`
- `nodes[]`: at least 1 node
- `edges[]`: may be empty, but must reference known node IDs
- `missions[]`: at least 1 mission

## Grid layers

- `ground`: required base terrain
- `decor`: optional extra tiles for future visuals
- `blocked`: tile coordinates reserved/blocked for placement

## Node semantics

- Nodes are gameplay towers/strongholds with stable IDs.
- `x`,`y` are integer tile coordinates.
- `type`:
  - `stronghold`
  - `tower`
- `owner`:
  - `player`
  - `enemy`
  - `neutral`

## Mission semantics

A mission is the playable session config for that level.

- `missionId`: unique inside level
- `seed`: deterministic seed used by mission start
- `waveSetId`: wave preset identifier
- `objectiveText`: UI objective copy
- `difficulty`: optional mission scalar, defaults to `1`

## Validation behavior

Loader validation fails with clear errors when:

- required fields are missing
- coordinates are not integers
- node IDs are duplicated
- edges reference unknown nodes
- ownership/type enums are invalid
- missions are missing or duplicated

Validation errors are logged in dev console and shown in an in-game toast where available.
