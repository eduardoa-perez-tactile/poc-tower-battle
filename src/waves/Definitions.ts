export interface EnemyBaseStats {
  hp: number;
  speed: number;
  damage: number;
  attackRange: number;
  attackCooldown: number;
}

export interface EnemyBehaviorDefinition {
  rangedStopToShoot?: boolean;
  shieldCycleSec?: number;
  shieldUptimeSec?: number;
  splitChildArchetypeId?: string;
  splitChildCount?: number;
  supportAuraRadius?: number;
  supportSpeedMultiplier?: number;
  supportArmorMultiplier?: number;
}

export interface EnemyVisualDefinition {
  icon: string;
  color: string;
  sizeScale: number;
  vfxHook: string;
  sfxHook: string;
}

export interface EnemyDropDefinition {
  gold: number;
  temporaryBuffId?: string;
}

export interface EnemyArchetypeDefinition {
  id: string;
  name: string;
  baseStats: EnemyBaseStats;
  tags: string[];
  spawnCost: number;
  spawnWeight: number;
  behavior?: EnemyBehaviorDefinition;
  visuals: EnemyVisualDefinition;
  eliteDrop?: EnemyDropDefinition;
}

export interface EnemyCatalog {
  archetypes: EnemyArchetypeDefinition[];
}

export interface WaveModifierEffects {
  speedMultiplier?: number;
  armorMultiplier?: number;
  spawnRateMultiplier?: number;
  eliteChanceBonus?: number;
  forceMiniBossEscort?: boolean;
  tagWeightMultipliers?: Record<string, number>;
}

export interface WaveModifierDefinition {
  id: string;
  name: string;
  description: string;
  effects: WaveModifierEffects;
}

export interface WaveModifierCatalog {
  modifiers: WaveModifierDefinition[];
}

export interface HandcraftedWaveEntry {
  timeOffsetSec: number;
  enemyId: string;
  count: number;
  eliteChance: number;
  laneIndex: number;
}

export interface HandcraftedWaveDefinition {
  waveIndex: number;
  modifiers: string[];
  entries: HandcraftedWaveEntry[];
}

export interface HandcraftedWaveCatalog {
  handcraftedWaves: HandcraftedWaveDefinition[];
}

export interface WaveScalingConfig {
  hpPerWave: number;
  damagePerWave: number;
  speedPerWave: number;
  hpPerDifficultyTier: number;
  damagePerDifficultyTier: number;
}

export interface GoldRewardConfig {
  baseKill: number;
  tagBonuses: Record<string, number>;
  eliteBonus: number;
  waveClearBase: number;
  waveClearPerWave: number;
}

export interface EliteConfig {
  hpMultiplier: number;
  damageMultiplier: number;
  sizeScaleMultiplier: number;
  colorTint: string;
  defaultDropGold: number;
  temporaryBuffId: string;
  temporaryBuffDurationSec: number;
  temporaryBuffDamageMultiplier: number;
  temporaryBuffSpeedMultiplier: number;
}

export interface BossAbilitySlamConfig {
  cooldownSec: number;
  windupSec: number;
  radiusPx: number;
  towerDamage: number;
}

export interface BossAbilitySummonConfig {
  cooldownSec: number;
  windupSec: number;
  enemyId: string;
  count: number;
}

export interface BossConfig {
  id: string;
  finalWaveIndex: number;
  minibossStartWave: number;
  minibossArchetypeId: string;
  hpMultiplier: number;
  damageMultiplier: number;
  enrageThreshold: number;
  enrageSpeedMultiplier: number;
  enrageDamageMultiplier: number;
  slam: BossAbilitySlamConfig;
  summon: BossAbilitySummonConfig;
}

export interface WaveBalanceConfig {
  totalWaveCount: number;
  scaling: WaveScalingConfig;
  goldRewards: GoldRewardConfig;
  elite: EliteConfig;
  boss: BossConfig;
}

export interface LoadedWaveContent {
  enemyCatalog: EnemyCatalog;
  modifierCatalog: WaveModifierCatalog;
  handcraftedWaves: HandcraftedWaveCatalog;
  balance: WaveBalanceConfig;
}

export interface WaveSpawnEntry {
  timeOffsetSec: number;
  enemyId: string;
  count: number;
  eliteChance: number;
  laneIndex: number;
}

export interface WavePlan {
  waveIndex: number;
  modifiers: string[];
  spawnEntries: WaveSpawnEntry[];
  hasMiniBossEscort: boolean;
  isBossWave: boolean;
}

export interface WaveGeneratorInputs {
  difficultyTier: number;
  waveIndex: number;
  runSeed: number;
  laneCount: number;
}

export async function loadWaveContent(): Promise<LoadedWaveContent> {
  const [enemyCatalog, modifierCatalog, handcraftedWaves, balance] = await Promise.all([
    fetchJson<EnemyCatalog>("/data/enemies.json"),
    fetchJson<WaveModifierCatalog>("/data/wave-modifiers.json"),
    fetchJson<HandcraftedWaveCatalog>("/data/waves-handcrafted.json"),
    fetchJson<WaveBalanceConfig>("/data/wave-balance.json"),
  ]);

  validateWaveContent(enemyCatalog, modifierCatalog, handcraftedWaves, balance);
  return {
    enemyCatalog,
    modifierCatalog,
    handcraftedWaves,
    balance,
  };
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load wave data from ${path} (${response.status} ${response.statusText})`);
  }
  return (await response.json()) as T;
}

function validateWaveContent(
  enemyCatalog: EnemyCatalog,
  modifierCatalog: WaveModifierCatalog,
  handcraftedWaves: HandcraftedWaveCatalog,
  balance: WaveBalanceConfig,
): void {
  if (!Array.isArray(enemyCatalog.archetypes) || enemyCatalog.archetypes.length < 6) {
    throw new Error("Enemy catalog must define at least 6 archetypes");
  }
  if (!Array.isArray(modifierCatalog.modifiers) || modifierCatalog.modifiers.length < 6) {
    throw new Error("Wave modifiers catalog must define at least 6 modifiers");
  }
  if (!Array.isArray(handcraftedWaves.handcraftedWaves)) {
    throw new Error("Handcrafted wave catalog is invalid");
  }
  if (!Number.isFinite(balance.totalWaveCount) || balance.totalWaveCount < 3) {
    throw new Error("Wave balance config must define totalWaveCount >= 3");
  }
}
