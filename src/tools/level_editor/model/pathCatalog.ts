export const CORE_LEVEL_EDITOR_PATHS = [
  "/data/campaign/campaign_v2.json",
  "/data/waves/presets.json",
  "/data/wave-balance.json",
  "/data/balanceBaselines.json",
  "/data/difficultyTiers.json",
  "/data/wave-modifiers.json",
  "/data/enemyArchetypes.json",
  "/data/waves-handcrafted.json",
  "/data/wavePacingTargets.json",
  "/data/difficulty/stages.json",
  "/data/difficulty/ascensions.json",
  "/data/tutorials/tutorials.json",
  "/data/missions.json",
  "/levels/stage01/level01.json",
  "/levels/stage01/level02.json",
  "/levels/stage02/level01.json",
  "/levels/level01.json",
] as const;

export function isCampaignMapPath(path: string): boolean {
  return path.startsWith("/levels/v2/") && path.endsWith(".json");
}

export function isModernLevelPath(path: string): boolean {
  return path.startsWith("/levels/") && path.endsWith(".json") && !path.startsWith("/levels/v2/");
}
