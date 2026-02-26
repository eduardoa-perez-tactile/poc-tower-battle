import type { DifficultyTierId } from "../config/Difficulty";

export const META_SCHEMA_VERSION = 2;
export const RUN_SCHEMA_VERSION = 2;

export interface MetaModifiers {
  packetDamageMul: number;
  packetSpeedMul: number;
  packetArmorAdd: number;
  packetArmorMul: number;
  towerRegenMul: number;
  towerMaxTroopsMul: number;
  linkIntegrityMul: number;
  linkCostDiscount: number;
  extraOutgoingLinksAdd: number;
  skillCooldownMul: number;
  skillDurationMul: number;
  skillPotencyMul: number;
  startingTroopsMul: number;
  captureEfficiencyMul: number;
  enemyRegenMul: number;
  linkDecayPerSec: number;
  linkDecayCanBreak: boolean;
  bossHpMul: number;
  bossExtraPhases: number;
  rewardGloryMul: number;
  rewardGoldMul: number;
  startingGold: number;
  goldEarnedMultiplier: number;
  towerHpMultiplier: number;
  strongholdStartLevel: number;
}

export interface MetaProfileStats {
  runsPlayed: number;
  wins: number;
  losses: number;
  bestMissionIndex: number;
  bestWave: number;
}

export interface MetaUpgradeState {
  version: number;
  purchasedRanks: Record<string, number>;
  glorySpentTotal: number;
}

export interface MetaProgress {
  gloryEarnedTotal: number;
  glorySpentTotal: number;
  runsCompleted: number;
  runsWon: number;
  bossesDefeated: number;
  highestDifficultyCleared: DifficultyTierId;
  ascensionsCleared: Record<string, number>;
}

export interface MetaProfile {
  schemaVersion: number;
  glory: number;
  unlocks: Record<string, boolean | number>;
  metaUpgradeState: MetaUpgradeState;
  metaProgress: MetaProgress;
  stats: MetaProfileStats;
  metaUpgrades?: Record<string, number>;
}

export interface RunInventory {
  relics: string[];
  boons: string[];
}

export interface RunMissionNode {
  id: string;
  templateId: string;
  name: string;
  levelPath: string;
  difficulty: number;
}

export interface RunUnlockSnapshot {
  towerTypes: string[];
  enemyTypes: string[];
  mapMutators: string[];
  ascensionIds: string[];
}

export interface RunState {
  schemaVersion: number;
  runId: string;
  seed: number;
  currentMissionIndex: number;
  missions: RunMissionNode[];
  runModifiers: {
    difficulty: number;
    tier: DifficultyTierId;
  };
  runAscensionIds: string[];
  runUnlockSnapshot: RunUnlockSnapshot;
  inventory: RunInventory;
  startingBonuses: MetaModifiers;
  runGloryEarned: number;
}

export interface RunSummary {
  runId: string;
  won: boolean;
  missionsCompleted: number;
  missionGlory: number;
  runBonusGlory: number;
  totalGloryEarned: number;
  difficultyTier: DifficultyTierId;
  ascensionIds: string[];
  rewardMultipliers: {
    gloryMul: number;
    goldMul: number;
  };
  appliedDifficultyMultipliers: {
    enemyHpMul: number;
    enemyDmgMul: number;
    enemySpeedMul: number;
    waveIntensityMul: number;
    economyGoldMul: number;
    economyGloryMul: number;
  };
  unlockNotifications: string[];
}

export function createDefaultMetaUpgradeState(): MetaUpgradeState {
  return {
    version: 1,
    purchasedRanks: {},
    glorySpentTotal: 0,
  };
}

export function createDefaultMetaProgress(): MetaProgress {
  return {
    gloryEarnedTotal: 0,
    glorySpentTotal: 0,
    runsCompleted: 0,
    runsWon: 0,
    bossesDefeated: 0,
    highestDifficultyCleared: "NORMAL",
    ascensionsCleared: {},
  };
}

export function createDefaultRunUnlockSnapshot(): RunUnlockSnapshot {
  return {
    towerTypes: [],
    enemyTypes: [],
    mapMutators: [],
    ascensionIds: [],
  };
}

export function createDefaultMetaProfile(): MetaProfile {
  return {
    schemaVersion: META_SCHEMA_VERSION,
    glory: 0,
    unlocks: {},
    metaUpgradeState: createDefaultMetaUpgradeState(),
    metaProgress: createDefaultMetaProgress(),
    stats: {
      runsPlayed: 0,
      wins: 0,
      losses: 0,
      bestMissionIndex: 0,
      bestWave: 0,
    },
    metaUpgrades: {},
  };
}

export function createDefaultMetaModifiers(): MetaModifiers {
  return {
    packetDamageMul: 1,
    packetSpeedMul: 1,
    packetArmorAdd: 0,
    packetArmorMul: 1,
    towerRegenMul: 1,
    towerMaxTroopsMul: 1,
    linkIntegrityMul: 1,
    linkCostDiscount: 0,
    extraOutgoingLinksAdd: 0,
    skillCooldownMul: 1,
    skillDurationMul: 1,
    skillPotencyMul: 1,
    startingTroopsMul: 1,
    captureEfficiencyMul: 1,
    enemyRegenMul: 1,
    linkDecayPerSec: 0,
    linkDecayCanBreak: false,
    bossHpMul: 1,
    bossExtraPhases: 0,
    rewardGloryMul: 1,
    rewardGoldMul: 1,
    startingGold: 0,
    goldEarnedMultiplier: 1,
    towerHpMultiplier: 1,
    strongholdStartLevel: 1,
  };
}
