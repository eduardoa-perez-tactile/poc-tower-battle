# Data Format

## Data files
- `levels/level01.json`
- `public/data/missions.json`
- `public/data/meta-upgrades.json`
- `public/data/enemies.json`
- `public/data/wave-modifiers.json`
- `public/data/waves-handcrafted.json`
- `public/data/wave-balance.json`

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
- `troopCount`: number
- `regenRatePerSec`: number
- `maxTroops`: number

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
- If multiple links share the same `fromTowerId`, the last one wins.

## Mission catalog (`public/data/missions.json`)
- Root: `{ templates: MissionTemplate[] }`
- `MissionTemplate.id`: string
- `MissionTemplate.name`: string
- `MissionTemplate.levelPath`: string
- `MissionTemplate.baseDifficulty`: number

## Meta upgrade catalog (`public/data/meta-upgrades.json`)
- Root: `{ upgrades: MetaUpgrade[] }`
- `MetaUpgrade.id`: string
- `MetaUpgrade.name`: string
- `MetaUpgrade.description`: string
- `MetaUpgrade.maxLevel`: number
- `MetaUpgrade.baseCost`: number
- `MetaUpgrade.costGrowth`: number
- `MetaUpgrade.effectsPerLevel`: object (`startingGold`, `goldEarnedPct`, `towerHpPct`, `heroDamagePct`, `strongholdStartLevel`)
- `MetaUpgrade.prerequisites` (optional): string[]

## Enemy catalog (`public/data/enemies.json`)
- Root: `{ archetypes: EnemyArchetype[] }`
- `EnemyArchetype.id`: string
- `EnemyArchetype.name`: string
- `EnemyArchetype.baseStats`: `{ hp, speed, damage, attackRange, attackCooldown }`
- `EnemyArchetype.tags`: string[]
- `EnemyArchetype.spawnCost`: number
- `EnemyArchetype.spawnWeight`: number
- `EnemyArchetype.behavior` (optional):
- `rangedStopToShoot`: boolean
- `shieldCycleSec`: number
- `shieldUptimeSec`: number
- `splitChildArchetypeId`: string
- `splitChildCount`: number
- `supportAuraRadius`: number
- `supportSpeedMultiplier`: number
- `supportArmorMultiplier`: number
- `EnemyArchetype.visuals`: `{ icon, color, sizeScale, vfxHook, sfxHook }`
- `EnemyArchetype.eliteDrop` (optional): `{ gold, temporaryBuffId }`

## Wave modifiers (`public/data/wave-modifiers.json`)
- Root: `{ modifiers: WaveModifier[] }`
- `WaveModifier.id`: string
- `WaveModifier.name`: string
- `WaveModifier.description`: string
- `WaveModifier.effects`:
- `speedMultiplier`: number
- `armorMultiplier`: number
- `spawnRateMultiplier`: number
- `eliteChanceBonus`: number
- `forceMiniBossEscort`: boolean
- `tagWeightMultipliers`: `Record<string, number>`

## Handcrafted waves (`public/data/waves-handcrafted.json`)
- Root: `{ handcraftedWaves: HandcraftedWave[] }`
- `HandcraftedWave.waveIndex`: number
- `HandcraftedWave.modifiers`: string[] (modifier ids)
- `HandcraftedWave.entries`: `HandcraftedWaveEntry[]`
- `HandcraftedWaveEntry.timeOffsetSec`: number
- `HandcraftedWaveEntry.enemyId`: string
- `HandcraftedWaveEntry.count`: number
- `HandcraftedWaveEntry.eliteChance`: number
- `HandcraftedWaveEntry.laneIndex`: number

## Wave balance (`public/data/wave-balance.json`)
- Root: `WaveBalanceConfig`
- `totalWaveCount`: number
- `scaling`:
- `hpPerWave`: number
- `damagePerWave`: number
- `speedPerWave`: number
- `hpPerDifficultyTier`: number
- `damagePerDifficultyTier`: number
- `goldRewards`:
- `baseKill`: number
- `tagBonuses`: `Record<string, number>`
- `eliteBonus`: number
- `waveClearBase`: number
- `waveClearPerWave`: number
- `elite`:
- `hpMultiplier`: number
- `damageMultiplier`: number
- `sizeScaleMultiplier`: number
- `colorTint`: string
- `defaultDropGold`: number
- `temporaryBuffId`: string
- `temporaryBuffDurationSec`: number
- `temporaryBuffDamageMultiplier`: number
- `temporaryBuffSpeedMultiplier`: number
- `boss`:
- `id`: string
- `finalWaveIndex`: number
- `minibossStartWave`: number
- `minibossArchetypeId`: string
- `hpMultiplier`: number
- `damageMultiplier`: number
- `enrageThreshold`: number
- `enrageSpeedMultiplier`: number
- `enrageDamageMultiplier`: number
- `slam`: `{ cooldownSec, windupSec, radiusPx, towerDamage }`
- `summon`: `{ cooldownSec, windupSec, enemyId, count }`

## Local save schema (LocalStorage)
- `tower-battle.meta-profile`: `MetaProfile`
- `tower-battle.run-state`: `RunState`

### MetaProfile
- `schemaVersion`: number
- `glory`: number
- `unlocks`: `Record<string, boolean | number>`
- `metaUpgrades`: `Record<string, number>`
- `stats.runsPlayed`: number
- `stats.wins`: number
- `stats.losses`: number
- `stats.bestMissionIndex`: number
- `stats.bestWave`: number

### RunState
- `schemaVersion`: number
- `runId`: string
- `seed`: number
- `currentMissionIndex`: number
- `missions`: `RunMissionNode[]`
- `runModifiers`: `{ difficulty: number }`
- `inventory`: `{ relics: string[], boons: string[] }`
- `startingBonuses.startingGold`: number
- `startingBonuses.goldEarnedMultiplier`: number
- `startingBonuses.heroDamageMultiplier`: number
- `startingBonuses.towerHpMultiplier`: number
- `startingBonuses.strongholdStartLevel`: number
- `runGloryEarned`: number
