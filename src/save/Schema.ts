import type { DifficultyTierId } from "../config/Difficulty";

export const META_SCHEMA_VERSION = 1;
export const RUN_SCHEMA_VERSION = 1;

export interface MetaModifiers {
  startingGold: number;
  goldEarnedMultiplier: number;
  heroDamageMultiplier: number;
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

export interface MetaProfile {
  schemaVersion: number;
  glory: number;
  unlocks: Record<string, boolean | number>;
  metaUpgrades: Record<string, number>;
  stats: MetaProfileStats;
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

export function createDefaultMetaProfile(): MetaProfile {
  return {
    schemaVersion: META_SCHEMA_VERSION,
    glory: 0,
    unlocks: {},
    metaUpgrades: {},
    stats: {
      runsPlayed: 0,
      wins: 0,
      losses: 0,
      bestMissionIndex: 0,
      bestWave: 0,
    },
  };
}

export function createDefaultMetaModifiers(): MetaModifiers {
  return {
    startingGold: 0,
    goldEarnedMultiplier: 1,
    heroDamageMultiplier: 1,
    towerHpMultiplier: 1,
    strongholdStartLevel: 1,
  };
}
