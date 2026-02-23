# Data Format

## Data files
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
- `public/data/balanceBaselines.json`
- `public/data/difficultyTiers.json`
- `public/data/wavePacingTargets.json`

## Level file (`levels/level01.json`)

### Root fields
- `meta`: `{ id: string, name: string }`
- `rules`: level combat tuning
- `ai`: strategic AI tuning
- `initialLinks` (optional): `InitialLink[]`
- `towers`: `Tower[]`

### Tower
- `id`: string
- `x`: number
- `y`: number
- `owner`: `"player" | "enemy" | "neutral"`
- `maxHp`: number
- `hp`: number
- `troops` (or legacy `troopCount`): number
- `regenRate` (or legacy `regenRatePerSec`): number
- `maxTroops`: number
- `archetype`: tower archetype id

### Rules
- `maxOutgoingLinksPerTower`: number
- `sendRatePerSec`: number
- `collisionDistancePx`: number
- `captureSeedTroops`: number
- `defaultUnit`: `{ speedPxPerSec: number, dpsPerUnit: number, hpPerUnit: number }`

### AI
- `aiThinkIntervalSec`: number
- `aiMinTroopsToAttack`: number

### InitialLink
- `fromTowerId`: string
- `toTowerId`: string
- `level` (optional): number

## Mission catalog (`public/data/missions.json`)
- Root: `{ templates: MissionTemplate[] }`
- `MissionTemplate.id`: string
- `MissionTemplate.name`: string
- `MissionTemplate.levelPath`: string
- `MissionTemplate.baseDifficulty`: number

## Persistent upgrades (`public/data/upgrades.json`)
- Root: `{ version: number, trees: UpgradeTree[] }`
- `UpgradeTree`: `{ id, name, nodes[] }`
- `Node` fields:
- `id`, `name`, `desc`, `maxRank`
- `costGlory` + optional `costGrowth` OR `costGloryPerRank[]`
- `prereqs[]`: `{ nodeId, minRank }`
- `effects[]`: `{ type, op, valuePerRank/value, skillId? }`

## Skills (`public/data/skills.json`)
- Root: `{ version: number, skills: Skill[] }`
- `Skill` fields:
- `id`, `name`, `desc`
- `cooldownSec`, `durationSec`
- `targeting`: `"NONE" | "TOWER" | "AREA"`
- `radius` (for area skills)
- `effects[]`: typed skill effects

## Ascensions (`public/data/ascensions.json`)
- Root: `{ version: number, maxSelected: number, ascensions: Ascension[] }`
- `Ascension` fields:
- `id`, `name`, `desc`
- `unlocksAt` (optional): `{ metaLevel?, orNodeId? }`
- `effects[]`: typed ascension effects
- `reward`: `{ gloryMul, goldMul }`

## Permanent unlocks (`public/data/unlocks.json`)
- Root: `{ version: number, unlocks: Unlock[] }`
- `Unlock` fields:
- `id`
- `type`: `"TOWER_TYPE" | "ENEMY_TYPE" | "MAP_MUTATOR" | "ASCENSION"`
- `value`: content id
- `requires[]`: rule predicates (`GLORY_SPENT_TOTAL`, `RUNS_WON`, `RUNS_COMPLETED`, `BOSSES_DEFEATED`, `META_LEVEL`, `UPGRADE_PURCHASED`, `ASCENSION_CLEAR_COUNT`, `HIGHEST_DIFFICULTY_CLEARED`)

## Enemy catalog (`public/data/enemyArchetypes.json`)
- Root: `{ archetypes: EnemyArchetype[] }`
- `EnemyArchetype.id`: string
- `EnemyArchetype.name`: string
- `EnemyArchetype.baseStats`: `{ hp, speed, damage, attackRange, attackCooldown }`
- `EnemyArchetype.unitThreatValue`: number
- `EnemyArchetype.tags`: string[]
- `EnemyArchetype.spawnCost`: number
- `EnemyArchetype.spawnWeight`: number
- `EnemyArchetype.behavior` (optional): archetype behavior params
- `EnemyArchetype.visuals`: `{ icon, color, sizeScale, vfxHook, sfxHook }`
- `EnemyArchetype.eliteDrop` (optional): `{ gold, temporaryBuffId }`

## Wave modifiers (`public/data/wave-modifiers.json`)
- Root: `{ modifiers: WaveModifier[] }`
- `WaveModifier.id`, `name`, `description`
- `WaveModifier.effects`: speed/armor/spawn-rate/elite/tag-weight effects

## Handcrafted waves (`public/data/waves-handcrafted.json`)
- Root: `{ handcraftedWaves: HandcraftedWave[] }`
- `HandcraftedWave.waveIndex`: number
- `HandcraftedWave.modifiers`: string[]
- `HandcraftedWave.entries`: `HandcraftedWaveEntry[]`
- `HandcraftedWaveEntry.timeOffsetSec`, `enemyId`, `count`, `eliteChance`, `laneIndex`

## Wave balance (`public/data/wave-balance.json`)
- Root: `WaveBalanceConfig`
- Includes: total wave count, scaling, rewards, elite config, boss config

## Local save schema (LocalStorage)
- `tower-battle.meta-profile`: `MetaProfile`
- `tower-battle.run-state`: `RunState`

### MetaProfile (schema v2)
- `schemaVersion`: number
- `glory`: number
- `unlocks`: `Record<string, boolean | number>`
- `metaUpgradeState`:
- `version`: number
- `purchasedRanks`: `Record<string, number>`
- `glorySpentTotal`: number
- `metaProgress`:
- `gloryEarnedTotal`, `glorySpentTotal`
- `runsCompleted`, `runsWon`, `bossesDefeated`
- `highestDifficultyCleared`
- `ascensionsCleared`: `Record<string, number>`
- `stats`: legacy session summary fields (`runsPlayed`, `wins`, `losses`, `bestMissionIndex`, `bestWave`)

### RunState (schema v2)
- `schemaVersion`: number
- `runId`: string
- `seed`: number
- `currentMissionIndex`: number
- `missions`: `RunMissionNode[]`
- `runModifiers`: `{ difficulty: number, tier: DifficultyTierId }`
- `runAscensionIds`: `string[]` (sorted)
- `runUnlockSnapshot`:
- `towerTypes`: `string[]`
- `enemyTypes`: `string[]`
- `mapMutators`: `string[]`
- `ascensionIds`: `string[]`
- `inventory`: `{ relics: string[], boons: string[] }`
- `startingBonuses`: resolved modifier block for the run
- `runGloryEarned`: number
