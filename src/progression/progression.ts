import type { StageRegistryEntry } from "../levels/types";

/*
 * Patch Notes (2026-02-24):
 * - Moved campaign progression storage namespace to v2 for the new tutorial-first campaign.
 */

export const CAMPAIGN_PROGRESS_STORAGE_KEY = "campaignProgress_v2";

const CAMPAIGN_PROGRESS_VERSION = 1;

export interface CampaignProgress {
  version: 1;
  completedMissionKeys: string[];
}

export interface StageUnlockState {
  unlocked: boolean;
  completed: boolean;
}

export interface LevelUnlockState {
  unlocked: boolean;
  completed: boolean;
}

export interface MissionUnlockState {
  unlocked: boolean;
  completed: boolean;
}

export interface CampaignUnlocks {
  stage: Record<string, StageUnlockState>;
  level: Record<string, LevelUnlockState>;
  mission: Record<string, MissionUnlockState>;
}

export function loadCampaignProgress(): CampaignProgress {
  const raw = localStorage.getItem(CAMPAIGN_PROGRESS_STORAGE_KEY);
  if (!raw) {
    return createDefaultCampaignProgress();
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed) || !Array.isArray(parsed.completedMissionKeys)) {
      return createDefaultCampaignProgress();
    }

    const completedMissionKeys = parsed.completedMissionKeys
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .sort((left, right) => left.localeCompare(right));

    return {
      version: CAMPAIGN_PROGRESS_VERSION,
      completedMissionKeys,
    };
  } catch {
    return createDefaultCampaignProgress();
  }
}

export function saveCampaignProgress(progress: CampaignProgress): void {
  const normalized: CampaignProgress = {
    version: CAMPAIGN_PROGRESS_VERSION,
    completedMissionKeys: [...new Set(progress.completedMissionKeys)].sort((left, right) =>
      left.localeCompare(right),
    ),
  };

  localStorage.setItem(CAMPAIGN_PROGRESS_STORAGE_KEY, JSON.stringify(normalized));
}

export function resetCampaignProgress(): CampaignProgress {
  localStorage.removeItem(CAMPAIGN_PROGRESS_STORAGE_KEY);
  return createDefaultCampaignProgress();
}

export function markMissionComplete(
  stageId: string,
  levelId: string,
  missionId: string,
  progress: CampaignProgress = loadCampaignProgress(),
): CampaignProgress {
  const key = toMissionKey(stageId, levelId, missionId);
  const nextSet = new Set(progress.completedMissionKeys);
  nextSet.add(key);

  const next: CampaignProgress = {
    version: CAMPAIGN_PROGRESS_VERSION,
    completedMissionKeys: [...nextSet].sort((left, right) => left.localeCompare(right)),
  };

  saveCampaignProgress(next);
  return next;
}

export function computeUnlocks(
  stages: StageRegistryEntry[],
  progress: CampaignProgress = loadCampaignProgress(),
): CampaignUnlocks {
  const completed = new Set(progress.completedMissionKeys);
  const unlocks: CampaignUnlocks = {
    stage: {},
    level: {},
    mission: {},
  };

  let previousOrderedStageCompleted = true;

  for (const stage of stages) {
    const stageKey = stage.stageId;
    const isCustomStage = stage.stageId === "user";
    const stageUnlocked = isCustomStage || previousOrderedStageCompleted;

    let previousLevelCompleted = false;
    let stageCompleted = stage.levels.length > 0;

    for (let levelIndex = 0; levelIndex < stage.levels.length; levelIndex += 1) {
      const level = stage.levels[levelIndex].level;
      const levelKey = toLevelKey(stage.stageId, level.levelId);
      const levelUnlocked = stageUnlocked && (levelIndex === 0 || previousLevelCompleted || isCustomStage);

      let levelCompleted = level.missions.length > 0;
      let previousMissionCompleted = false;

      for (let missionIndex = 0; missionIndex < level.missions.length; missionIndex += 1) {
        const mission = level.missions[missionIndex];
        const missionKey = toMissionKey(stage.stageId, level.levelId, mission.missionId);
        const missionCompleted = completed.has(missionKey);
        const missionUnlocked = levelUnlocked && (missionIndex === 0 || previousMissionCompleted);

        unlocks.mission[missionKey] = {
          unlocked: missionUnlocked,
          completed: missionCompleted,
        };

        levelCompleted = levelCompleted && missionCompleted;
        previousMissionCompleted = missionCompleted;
      }

      unlocks.level[levelKey] = {
        unlocked: levelUnlocked,
        completed: levelCompleted,
      };

      previousLevelCompleted = levelCompleted;
      stageCompleted = stageCompleted && levelCompleted;
    }

    unlocks.stage[stageKey] = {
      unlocked: stageUnlocked,
      completed: stageCompleted,
    };

    if (!isCustomStage) {
      previousOrderedStageCompleted = stageCompleted;
    }
  }

  return unlocks;
}

export function toMissionKey(stageId: string, levelId: string, missionId: string): string {
  return `${stageId}:${levelId}:${missionId}`;
}

export function toLevelKey(stageId: string, levelId: string): string {
  return `${stageId}:${levelId}`;
}

function createDefaultCampaignProgress(): CampaignProgress {
  return {
    version: CAMPAIGN_PROGRESS_VERSION,
    completedMissionKeys: [],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
