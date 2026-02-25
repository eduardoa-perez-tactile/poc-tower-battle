/*
 * Patch Notes (2026-02-24):
 * - Added data-driven stage difficulty profile types for multi-axis Difficulty Budget ramps.
 * - Added ascension difficulty modifier types and simulation-facing difficulty context types.
 */

export type DifficultyAxes = {
  economy: number;
  spatial: number;
  complexity: number;
  tempo: number;
  interference: number;
};

export type StageDifficultyProfile = {
  id: string;
  displayName: string;
  baseMissionValue: number;
  stageIndex: number;
  missionCount: number;
  axesByMission: DifficultyAxes[];
  dbTuning: {
    missionSlope: number;
    stageSlope: number;
    ascensionMultiplierPerLevel: number;
    clamp: { min: number; max: number };
  };
  budgetAllocation: {
    unitCount: number;
    complexity: number;
    elite: number;
    regen: number;
    tempo: number;
  };
  archetypeProgression: {
    tiers: Array<{
      minComplexity: number;
      allowedArchetypes: string[];
      weights: Record<string, number>;
      eliteChance: number;
      minibossChance: number;
    }>;
    maxNewArchetypesPerMission: number;
  };
  tempoModel: {
    baseCooldownSec: number;
    maxCompression: number;
    wpi: {
      enabled: boolean;
      targetLow: number;
      targetHigh: number;
      earlySpawnFactor: number;
      lateSpawnFactor: number;
      smoothing: number;
    };
  };
  territoryScaling: {
    regenPerCluster: number;
    armorPerCluster: number;
    visionPerCluster: number;
    penaltyMultiplier?: number;
  };
  bossModel: {
    enabled: boolean;
    powerMultiplier: number;
    phases: Array<{
      hpThreshold?: number;
      addReinforcementWave?: boolean;
      regenSpike?: number;
      tempoSpike?: number;
    }>;
    enrage: {
      enabled: boolean;
      hpBelow?: number;
      timeSec?: number;
      addPhaseOnHighAscension?: boolean;
    };
  };
};

export interface StageDifficultyCatalog {
  stages: StageDifficultyProfile[];
}

export interface AscensionDifficultyModifiers {
  level: number;
  enemyRegenBonus: number;
  linkDecayEnabled: boolean;
  eliteEarlier: boolean;
  bossExtraPhase: boolean;
  territoryPenalty: number;
}

export interface AscensionDifficultyCatalog {
  levels: AscensionDifficultyModifiers[];
}

export interface BossDifficultyModifiers {
  hpMultiplier: number;
  damageMultiplier: number;
  abilityCooldownMultiplier: number;
  reinforcementCountBonus: number;
  extraPhaseCount: number;
}

export interface DifficultyContext {
  stageId: string;
  stageIndex: number;
  missionIndex: number;
  enemyRegenMultiplier: number;
  interferenceLinkDecayPerSec: number;
  linkDecayCanBreak: boolean;
  territoryScaling: {
    regenPerCluster: number;
    armorPerCluster: number;
    visionPerCluster: number;
  };
  playerTerritoryPenalty: number;
}
