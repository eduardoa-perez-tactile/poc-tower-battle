import type {
  CampaignMapDefinition,
  CampaignSpecV2,
  CampaignWavePresetCatalog,
} from "../../../campaign/CampaignTypes";
import type { LevelJson } from "../../../levels/types";
import type {
  BalanceBaselinesConfig,
  DifficultyTierCatalog,
  EnemyCatalog,
  HandcraftedWaveCatalog,
  WaveBalanceConfig,
  WaveModifierCatalog,
  WavePacingTargetCatalog,
} from "../../../waves/Definitions";
import type { AscensionDifficultyCatalog, StageDifficultyCatalog } from "../../../waves/DifficultyTypes";
import { isObject } from "./json";

export function isCampaignSpec(value: unknown): value is CampaignSpecV2 {
  return isObject(value) && value.version === 2 && Array.isArray(value.stages);
}

export function isCampaignMap(value: unknown): value is CampaignMapDefinition {
  return isObject(value) && typeof value.id === "string" && Array.isArray(value.nodes) && Array.isArray(value.links);
}

export function isWavePresetCatalog(value: unknown): value is CampaignWavePresetCatalog {
  return isObject(value) && value.version === 1 && isObject(value.presets);
}

export function isLevelJson(value: unknown): value is LevelJson {
  return (
    isObject(value) &&
    value.version === 1 &&
    typeof value.stageId === "string" &&
    typeof value.levelId === "string" &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges) &&
    Array.isArray(value.missions)
  );
}

export function isEnemyCatalog(value: unknown): value is EnemyCatalog {
  return isObject(value) && Array.isArray(value.archetypes);
}

export function isWaveModifierCatalog(value: unknown): value is WaveModifierCatalog {
  return isObject(value) && Array.isArray(value.modifiers);
}

export function isHandcraftedWaveCatalog(value: unknown): value is HandcraftedWaveCatalog {
  return isObject(value) && Array.isArray(value.handcraftedWaves);
}

export function isWaveBalanceConfig(value: unknown): value is WaveBalanceConfig {
  return isObject(value) && typeof value.totalWaveCount === "number" && isObject(value.boss);
}

export function isBalanceBaselinesConfig(value: unknown): value is BalanceBaselinesConfig {
  return isObject(value) && typeof value.version === "number" && isObject(value.calibration);
}

export function isDifficultyTierCatalog(value: unknown): value is DifficultyTierCatalog {
  return isObject(value) && typeof value.version === "number" && isObject(value.difficultyTiers);
}

export function isWavePacingTargetCatalog(value: unknown): value is WavePacingTargetCatalog {
  return isObject(value) && typeof value.version === "number" && Array.isArray(value.targets);
}

export function isStageDifficultyCatalog(value: unknown): value is StageDifficultyCatalog {
  return isObject(value) && Array.isArray(value.stages);
}

export function isAscensionDifficultyCatalog(value: unknown): value is AscensionDifficultyCatalog {
  return isObject(value) && Array.isArray(value.levels);
}
