/*
 * Patch Notes (2026-02-24):
 * - Added optional difficulty config loading for stage and ascension profiles.
 * - Added helpers for profile resolution and deterministic Difficulty Budget computation.
 */

import type {
  AscensionDifficultyCatalog,
  AscensionDifficultyModifiers,
  StageDifficultyCatalog,
  StageDifficultyProfile,
} from "./DifficultyTypes";

export interface DifficultyConfigBundle {
  stageCatalog: StageDifficultyCatalog | null;
  ascensionCatalog: AscensionDifficultyCatalog | null;
}

export interface ResolveStageProfileOptions {
  stageId?: string;
  stageIndex?: number;
}

const DEFAULT_ASCENSION_MODIFIERS: AscensionDifficultyModifiers = {
  level: 0,
  enemyRegenBonus: 0,
  linkDecayEnabled: false,
  eliteEarlier: false,
  bossExtraPhase: false,
  territoryPenalty: 0,
};

export async function loadDifficultyConfig(
  stagePath = "/data/difficulty/stages.json",
  ascensionPath = "/data/difficulty/ascensions.json",
): Promise<DifficultyConfigBundle> {
  const [stageCatalog, ascensionCatalog] = await Promise.all([
    fetchOptionalJson<StageDifficultyCatalog>(stagePath),
    fetchOptionalJson<AscensionDifficultyCatalog>(ascensionPath),
  ]);

  return {
    stageCatalog: stageCatalog && Array.isArray(stageCatalog.stages) ? stageCatalog : null,
    ascensionCatalog: ascensionCatalog && Array.isArray(ascensionCatalog.levels) ? ascensionCatalog : null,
  };
}

export function resolveStageProfile(
  catalog: StageDifficultyCatalog | null,
  options: ResolveStageProfileOptions,
): StageDifficultyProfile | null {
  if (!catalog || catalog.stages.length === 0) {
    return null;
  }

  const byId = options.stageId ? catalog.stages.find((entry) => entry.id === normalizeStageId(options.stageId)) : null;
  if (byId) {
    return byId;
  }

  const parsedStageIndex = options.stageIndex ?? deriveStageIndexFromId(options.stageId);
  if (parsedStageIndex > 0) {
    const byIndex = catalog.stages.find((entry) => entry.stageIndex === parsedStageIndex);
    if (byIndex) {
      return byIndex;
    }
  }

  const sorted = [...catalog.stages].sort((left, right) => left.stageIndex - right.stageIndex);
  return sorted[0] ?? null;
}

export function resolveAscensionModifiers(
  catalog: AscensionDifficultyCatalog | null,
  ascensionLevel: number,
): AscensionDifficultyModifiers {
  if (!catalog || catalog.levels.length === 0) {
    return DEFAULT_ASCENSION_MODIFIERS;
  }

  const normalized = Math.max(0, Math.floor(ascensionLevel));
  let best = DEFAULT_ASCENSION_MODIFIERS;

  for (const entry of catalog.levels) {
    if (!Number.isFinite(entry.level) || entry.level > normalized) {
      continue;
    }
    if (entry.level >= best.level) {
      best = {
        ...DEFAULT_ASCENSION_MODIFIERS,
        ...entry,
      };
    }
  }

  return best;
}

export function computeDifficultyBudget(
  profile: StageDifficultyProfile,
  missionIndex: number,
  ascensionLevel: number,
): number {
  const clampedMissionIndex = Math.max(0, Math.min(profile.missionCount - 1, Math.floor(missionIndex)));
  const normalizedAscension = Math.max(0, Math.floor(ascensionLevel));

  const dbRaw =
    profile.baseMissionValue *
    (1 + clampedMissionIndex * profile.dbTuning.missionSlope) *
    (1 + Math.max(0, profile.stageIndex - 1) * profile.dbTuning.stageSlope) *
    (1 + normalizedAscension * profile.dbTuning.ascensionMultiplierPerLevel);

  return clamp(dbRaw, profile.dbTuning.clamp.min, profile.dbTuning.clamp.max);
}

export function normalizeStageId(stageId?: string): string {
  const trimmed = (stageId ?? "").trim().toLowerCase();
  if (!trimmed) {
    return "stage01";
  }
  if (/^stage\d+$/.test(trimmed)) {
    const numeric = Number.parseInt(trimmed.slice(5), 10);
    return `stage${numeric.toString().padStart(2, "0")}`;
  }
  return trimmed;
}

function deriveStageIndexFromId(stageId?: string): number {
  if (!stageId) {
    return 1;
  }
  const match = stageId.match(/(\d+)/);
  if (!match) {
    return 1;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

async function fetchOptionalJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
