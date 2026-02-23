# Data Format

## Level file location
- `levels/level01.json`

## Schema

### Root
- `meta`: { id: string, name: string }
- `rules`: tuning constants
- `ai`: tuning constants
- `initialLinks` (optional): InitialLink[]
- `towers`: Tower[]

### Tower
- id: string
- x: number
- y: number
- owner: "player" | "enemy" | "neutral"
- maxHp: number
- hp: number
- troopCount: number
- regenRatePerSec: number
- maxTroops: number

### Rules
- maxOutgoingLinksPerTower: number (PoC uses 1)
- sendRatePerSec: number
- collisionDistancePx: number
- captureSeedTroops: number
- defaultUnit: { speedPxPerSec: number, dpsPerUnit: number, hpPerUnit: number }

### AI
- aiThinkIntervalSec: number
- aiMinTroopsToAttack: number

### InitialLink
- fromTowerId: string
- toTowerId: string
- If multiple links share the same `fromTowerId`, the last one wins.
