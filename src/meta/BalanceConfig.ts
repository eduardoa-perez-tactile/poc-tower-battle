export const BALANCE_CONFIG = {
  glory: {
    missionBase: 28,
    missionWaveBonusPerIndex: 8,
    missionLossMultiplier: 0.4,
    runWinBonus: 90,
    runLossBonus: 30,
  },
  run: {
    minimumMissionCount: 3,
    maximumMissionCount: 5,
  },
  conversion: {
    startingGoldToTroopsRatio: 20,
  },
} as const;
