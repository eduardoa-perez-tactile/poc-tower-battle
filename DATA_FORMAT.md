# Data Format

## Level file location
- `levels/level01.json`
- `public/data/missions.json`
- `public/data/meta-upgrades.json`

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

## Mission template catalog (`public/data/missions.json`)
- Root: `{ templates: MissionTemplate[] }`
- MissionTemplate:
- id: string
- name: string
- levelPath: string
- baseDifficulty: number

## Meta upgrade catalog (`public/data/meta-upgrades.json`)
- Root: `{ upgrades: MetaUpgrade[] }`
- MetaUpgrade:
- id: string
- name: string
- description: string
- maxLevel: number
- baseCost: number
- costGrowth: number
- effectsPerLevel: object (e.g. `startingGold`, `goldEarnedPct`, `towerHpPct`, `heroDamagePct`, `strongholdStartLevel`)
- prerequisites: string[] (optional)

## Local save schema (LocalStorage)
- `tower-battle.meta-profile`: MetaProfile
- `tower-battle.run-state`: RunState

### MetaProfile
- schemaVersion: number
- glory: number
- unlocks: Record<string, boolean | number>
- metaUpgrades: Record<string, number>
- stats:
- runsPlayed: number
- wins: number
- losses: number
- bestMissionIndex: number
- bestWave: number

### RunState
- schemaVersion: number
- runId: string
- seed: number
- currentMissionIndex: number
- missions: RunMissionNode[]
- runModifiers: `{ difficulty: number }`
- inventory: `{ relics: string[], boons: string[] }`
- startingBonuses:
- startingGold: number
- goldEarnedMultiplier: number
- heroDamageMultiplier: number
- towerHpMultiplier: number
- strongholdStartLevel: number
- runGloryEarned: number
