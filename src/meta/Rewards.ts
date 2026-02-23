import { BALANCE_CONFIG } from "./BalanceConfig";

export interface MissionGloryReward {
  base: number;
  waveBonus: number;
  difficultyMultiplier: number;
  resultMultiplier: number;
  total: number;
}

export function calculateMissionGloryReward(
  missionIndex: number,
  missionDifficulty: number,
  won: boolean,
  goldEarnedMultiplier: number,
  difficultyGloryMultiplier = 1,
): MissionGloryReward {
  const base = BALANCE_CONFIG.glory.missionBase;
  const waveBonus = (missionIndex + 1) * BALANCE_CONFIG.glory.missionWaveBonusPerIndex;
  const difficultyMultiplier = Math.max(0.7, missionDifficulty);
  const resultMultiplier = won ? 1 : BALANCE_CONFIG.glory.missionLossMultiplier;
  const value =
    (base + waveBonus) *
    difficultyMultiplier *
    resultMultiplier *
    goldEarnedMultiplier *
    difficultyGloryMultiplier;
  return {
    base,
    waveBonus,
    difficultyMultiplier,
    resultMultiplier,
    total: Math.max(0, Math.round(value)),
  };
}

export function calculateRunBonusGlory(
  won: boolean,
  goldEarnedMultiplier: number,
  difficultyGloryMultiplier = 1,
): number {
  const base = won ? BALANCE_CONFIG.glory.runWinBonus : BALANCE_CONFIG.glory.runLossBonus;
  return Math.max(0, Math.round(base * goldEarnedMultiplier * difficultyGloryMultiplier));
}
