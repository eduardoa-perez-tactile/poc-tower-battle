/*
 * Patch Notes (2026-02-24):
 * - Added optional stage/ascension difficulty config loading to wave content.
 */

import type { DifficultyTierId } from "../config/Difficulty";
import { loadDifficultyConfig } from "./DifficultyConfig";
import type { AscensionDifficultyCatalog, StageDifficultyCatalog } from "./DifficultyTypes";

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
  linkCutter?: boolean;
  linkIntegrityDamagePerSec?: number;
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
  description?: string;
  baseStats: EnemyBaseStats;
  unitThreatValue: number;
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

export interface RegenCaps {
  min: number;
  max: number;
}

export interface DefenseCaps {
  min: number;
  max: number;
}

export interface PacketGlobalCaps {
  speedMin: number;
  speedMax: number;
  damageMin: number;
  damageMax: number;
  hpMin: number;
  hpMax: number;
  armorMin: number;
  armorMax: number;
}

export interface FightResolutionModelParams {
  shieldArmorUptimeMultiplier: number;
  combatHoldFactor: number;
  rangedHoldFactor: number;
  linkCutterHoldFactor: number;
  bossSummonSpeedMultiplier: number;
}

export interface WaveGenerationCalibration {
  budgetBase: number;
  budgetPerWave: number;
  budgetMin: number;
  budgetMax: number;
  budgetPerMissionDifficultyMul: number;
  spawnIntervalSec: number;
  spawnIntervalJitterMin: number;
  spawnIntervalJitterMax: number;
  swarmCountCap: number;
  defaultCountCap: number;
  baseEliteChance: number;
  eliteChancePerWave: number;
  eliteChanceHardCap: number;
}

export interface BalanceBaselinesConfig {
  version: number;
  troopRegen: {
    baseRegenPerSec: number;
    temporaryBuffBonusScale: number;
    archetypeMultipliers: Record<string, number>;
    globalRegenCaps: RegenCaps;
  };
  towerTroops: {
    baseMaxTroops: number;
    captureRateMultiplier: number;
    captureSeedTroops: number;
    defenseMultipliersCaps: DefenseCaps;
  };
  packets: {
    baseSpeed: number;
    baseDamage: number;
    baseArmor: number;
    globalCaps: PacketGlobalCaps;
    fightResolutionModelParams: FightResolutionModelParams;
    travelTimeTargets: {
      shortEdgeSec: number;
      avgEdgeSec: number;
      longEdgeSec: number;
    };
  };
  economy: {
    baseGoldPerWave: number;
    bankGoldPerSec: number;
    gloryMultiplierByDifficulty: Record<DifficultyTierId, number>;
  };
  calibration: {
    waveGeneration: WaveGenerationCalibration;
  };
}

export interface DifficultyTierEnemyConfig {
  hpMul: number;
  dmgMul: number;
  speedMul: number;
  spawnCountMul: number;
}

export interface DifficultyTierWaveConfig {
  intensityMul: number;
  eliteChanceMul: number;
  minibossChanceMul: number;
  bossHpMul: number;
  earlyIntensityRampPerWave: number;
  midIntensityRampPerWave: number;
  lateIntensityRampPerWave: number;
  minibossGuaranteeWave: number;
}

export interface DifficultyTierPlayerConfig {
  regenMul: number;
  packetSpeedMul: number;
  startingTowersAdd: number;
  startingTroopsMul: number;
}

export interface DifficultyTierEconomyConfig {
  goldMul: number;
  gloryMul: number;
}

export interface DifficultyTierConfig {
  enemy: DifficultyTierEnemyConfig;
  wave: DifficultyTierWaveConfig;
  player: DifficultyTierPlayerConfig;
  economy: DifficultyTierEconomyConfig;
}

export interface DifficultyTierCatalog {
  version: number;
  difficultyTiers: Record<DifficultyTierId, DifficultyTierConfig>;
}

export interface NumericRange {
  min: number;
  max: number;
}

export type LossRiskBand = "low" | "med" | "high";

export interface WavePacingDifficultyTarget {
  expectedPlayerTowersOwnedMin: number;
  expectedPlayerTowersOwnedMax: number;
  expectedAvgTroopsPerTowerMin: number;
  expectedAvgTroopsPerTowerMax: number;
  expectedEnemyPressureScoreRange: NumericRange;
  expectedWaveDurationSecRange: NumericRange;
  expectedLossRiskBand: LossRiskBand;
}

export interface WavePacingTargetBucket {
  waveStart: number;
  waveEnd: number;
  byDifficulty: Record<DifficultyTierId, WavePacingDifficultyTarget>;
}

export interface WavePacingTargetCatalog {
  version: number;
  targets: WavePacingTargetBucket[];
}

export interface LoadedWaveContent {
  enemyCatalog: EnemyCatalog;
  modifierCatalog: WaveModifierCatalog;
  handcraftedWaves: HandcraftedWaveCatalog;
  balance: WaveBalanceConfig;
  balanceBaselines: BalanceBaselinesConfig;
  difficultyTiers: DifficultyTierCatalog;
  wavePacingTargets: WavePacingTargetCatalog;
  stageDifficulty: StageDifficultyCatalog | null;
  ascensionDifficulty: AscensionDifficultyCatalog | null;
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
  difficultyTier: DifficultyTierId;
  missionDifficultyScalar: number;
  waveIndex: number;
  runSeed: number;
  laneCount: number;
}

export async function loadWaveContent(): Promise<LoadedWaveContent> {
  const [enemyCatalog, modifierCatalog, handcraftedWaves, balance, balanceBaselines, difficultyTiers, wavePacingTargets, difficultyConfig] =
    await Promise.all([
      fetchJson<EnemyCatalog>("/data/enemyArchetypes.json"),
      fetchJson<WaveModifierCatalog>("/data/wave-modifiers.json"),
      fetchJson<HandcraftedWaveCatalog>("/data/waves-handcrafted.json"),
      fetchJson<WaveBalanceConfig>("/data/wave-balance.json"),
      fetchJson<BalanceBaselinesConfig>("/data/balanceBaselines.json"),
      fetchJson<DifficultyTierCatalog>("/data/difficultyTiers.json"),
      fetchJson<WavePacingTargetCatalog>("/data/wavePacingTargets.json"),
      loadDifficultyConfig(),
    ]);

  validateWaveContent(
    enemyCatalog,
    modifierCatalog,
    handcraftedWaves,
    balance,
    balanceBaselines,
    difficultyTiers,
    wavePacingTargets,
  );
  return {
    enemyCatalog,
    modifierCatalog,
    handcraftedWaves,
    balance,
    balanceBaselines,
    difficultyTiers,
    wavePacingTargets,
    stageDifficulty: difficultyConfig.stageCatalog,
    ascensionDifficulty: difficultyConfig.ascensionCatalog,
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
  baselines: BalanceBaselinesConfig,
  difficultyTiers: DifficultyTierCatalog,
  pacingTargets: WavePacingTargetCatalog,
): void {
  if (!Array.isArray(enemyCatalog.archetypes) || enemyCatalog.archetypes.length < 6) {
    throw new Error("Enemy catalog must define at least 6 archetypes");
  }
  for (const archetype of enemyCatalog.archetypes) {
    if (!Number.isFinite(archetype.unitThreatValue) || archetype.unitThreatValue <= 0) {
      throw new Error(`Enemy archetype ${archetype.id} must define unitThreatValue > 0`);
    }
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
  if (!Number.isFinite(baselines.version) || baselines.version <= 0) {
    throw new Error("balanceBaselines.version must be a positive number");
  }
  if (baselines.troopRegen.globalRegenCaps.min > baselines.troopRegen.globalRegenCaps.max) {
    throw new Error("balanceBaselines.troopRegen.globalRegenCaps is invalid");
  }
  if (!Number.isFinite(baselines.troopRegen.temporaryBuffBonusScale)) {
    throw new Error("balanceBaselines.troopRegen.temporaryBuffBonusScale must be finite");
  }
  if (baselines.towerTroops.defenseMultipliersCaps.min > baselines.towerTroops.defenseMultipliersCaps.max) {
    throw new Error("balanceBaselines.towerTroops.defenseMultipliersCaps is invalid");
  }
  if (!Number.isFinite(difficultyTiers.version) || difficultyTiers.version <= 0) {
    throw new Error("difficultyTiers.version must be a positive number");
  }
  validateDifficultyRecord(difficultyTiers.difficultyTiers);
  if (!Array.isArray(pacingTargets.targets) || pacingTargets.targets.length === 0) {
    throw new Error("wavePacingTargets.targets must contain at least one entry");
  }
  if (!Number.isFinite(pacingTargets.version) || pacingTargets.version <= 0) {
    throw new Error("wavePacingTargets.version must be a positive number");
  }
  for (const target of pacingTargets.targets) {
    if (target.waveStart > target.waveEnd) {
      throw new Error("wavePacingTargets target waveStart must be <= waveEnd");
    }
    validateDifficultyRecord(target.byDifficulty);
  }
}

function validateDifficultyRecord<T>(record: Record<DifficultyTierId, T>): void {
  if (!record.NORMAL || !record.HARD || !record.ASCENDED) {
    throw new Error("Difficulty record must include NORMAL, HARD, and ASCENDED");
  }
}
