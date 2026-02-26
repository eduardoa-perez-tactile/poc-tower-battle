import {
  META_SCHEMA_VERSION,
  RUN_SCHEMA_VERSION,
  createDefaultMetaModifiers,
  createDefaultMetaProfile,
  createDefaultRunUnlockSnapshot,
  type MetaProfile,
  type RunState,
} from "./Schema";
import { DEFAULT_DIFFICULTY_TIER, toDifficultyTierId } from "../config/Difficulty";

const META_PROFILE_KEY = "tower-battle.meta-profile";
const RUN_STATE_KEY = "tower-battle.run-state";

export function loadMetaProfile(): MetaProfile {
  const raw = loadJson(META_PROFILE_KEY);
  const migrated = migrateMetaProfile(raw);
  if (migrated) {
    return migrated;
  }

  const created = createDefaultMetaProfile();
  saveMetaProfile(created);
  return created;
}

export function saveMetaProfile(profile: MetaProfile): void {
  const normalized: MetaProfile = {
    ...profile,
    schemaVersion: META_SCHEMA_VERSION,
    unlocks: { ...profile.unlocks },
    metaUpgradeState: {
      version: 1,
      purchasedRanks: { ...profile.metaUpgradeState.purchasedRanks },
      glorySpentTotal: asFiniteOr(profile.metaUpgradeState.glorySpentTotal, 0),
    },
    metaProgress: {
      ...profile.metaProgress,
      ascensionsCleared: { ...profile.metaProgress.ascensionsCleared },
      highestDifficultyCleared: toDifficultyTierId(profile.metaProgress.highestDifficultyCleared),
    },
    stats: { ...profile.stats },
  };
  saveJson(META_PROFILE_KEY, normalized);
}

export function resetMetaProfile(): MetaProfile {
  const profile = createDefaultMetaProfile();
  saveMetaProfile(profile);
  return profile;
}

export function loadRunState(): RunState | null {
  const raw = loadJson(RUN_STATE_KEY);
  return migrateRunState(raw);
}

export function saveRunState(runState: RunState): void {
  const normalized: RunState = {
    ...runState,
    schemaVersion: RUN_SCHEMA_VERSION,
    missions: runState.missions.map((mission) => ({ ...mission })),
    runModifiers: { ...runState.runModifiers },
    runAscensionIds: [...runState.runAscensionIds].sort((a, b) => a.localeCompare(b)),
    runUnlockSnapshot: {
      towerTypes: [...runState.runUnlockSnapshot.towerTypes].sort((a, b) => a.localeCompare(b)),
      enemyTypes: [...runState.runUnlockSnapshot.enemyTypes].sort((a, b) => a.localeCompare(b)),
      mapMutators: [...runState.runUnlockSnapshot.mapMutators].sort((a, b) => a.localeCompare(b)),
      ascensionIds: [...runState.runUnlockSnapshot.ascensionIds].sort((a, b) => a.localeCompare(b)),
    },
    startingBonuses: { ...runState.startingBonuses },
    inventory: {
      relics: [...runState.inventory.relics],
      boons: [...runState.inventory.boons],
    },
  };
  saveJson(RUN_STATE_KEY, normalized);
}

export function clearRunState(): void {
  localStorage.removeItem(RUN_STATE_KEY);
}

function migrateMetaProfile(raw: unknown): MetaProfile | null {
  if (!isObject(raw)) {
    return null;
  }

  const defaultProfile = createDefaultMetaProfile();
  const schemaVersion = asNumber(raw.schemaVersion, 1);

  if (schemaVersion === META_SCHEMA_VERSION) {
    const stats = isObject(raw.stats) ? raw.stats : {};
    const upgradeState = isObject(raw.metaUpgradeState) ? raw.metaUpgradeState : {};
    const progress = isObject(raw.metaProgress) ? raw.metaProgress : {};

    return {
      schemaVersion: META_SCHEMA_VERSION,
      glory: asNumber(raw.glory, defaultProfile.glory),
      unlocks: isObject(raw.unlocks) ? toUnlockRecord(raw.unlocks) : {},
      metaUpgradeState: {
        version: 1,
        purchasedRanks: isObject(upgradeState.purchasedRanks)
          ? toNumberRecord(upgradeState.purchasedRanks)
          : {},
        glorySpentTotal: asNumber(upgradeState.glorySpentTotal, 0),
      },
      metaProgress: {
        gloryEarnedTotal: asNumber(progress.gloryEarnedTotal, 0),
        glorySpentTotal: asNumber(progress.glorySpentTotal, 0),
        runsCompleted: asNumber(progress.runsCompleted, 0),
        runsWon: asNumber(progress.runsWon, 0),
        bossesDefeated: asNumber(progress.bossesDefeated, 0),
        highestDifficultyCleared: toDifficultyTierId(progress.highestDifficultyCleared),
        ascensionsCleared: isObject(progress.ascensionsCleared)
          ? toNumberRecord(progress.ascensionsCleared)
          : {},
      },
      stats: {
        runsPlayed: asNumber(stats.runsPlayed, defaultProfile.stats.runsPlayed),
        wins: asNumber(stats.wins, defaultProfile.stats.wins),
        losses: asNumber(stats.losses, defaultProfile.stats.losses),
        bestMissionIndex: asNumber(stats.bestMissionIndex, defaultProfile.stats.bestMissionIndex),
        bestWave: asNumber(stats.bestWave, defaultProfile.stats.bestWave),
      },
      metaUpgrades: {},
    };
  }

  if (schemaVersion === 1) {
    const stats = isObject(raw.stats) ? raw.stats : {};
    const legacyMetaUpgrades = isObject(raw.metaUpgrades) ? toNumberRecord(raw.metaUpgrades) : {};

    return {
      schemaVersion: META_SCHEMA_VERSION,
      glory: asNumber(raw.glory, defaultProfile.glory),
      unlocks: isObject(raw.unlocks) ? toUnlockRecord(raw.unlocks) : {},
      metaUpgradeState: {
        version: 1,
        purchasedRanks: { ...legacyMetaUpgrades },
        glorySpentTotal: 0,
      },
      metaProgress: {
        gloryEarnedTotal: asNumber(raw.glory, 0),
        glorySpentTotal: 0,
        runsCompleted: asNumber(stats.wins, 0) + asNumber(stats.losses, 0),
        runsWon: asNumber(stats.wins, 0),
        bossesDefeated: 0,
        highestDifficultyCleared: "NORMAL",
        ascensionsCleared: {},
      },
      stats: {
        runsPlayed: asNumber(stats.runsPlayed, defaultProfile.stats.runsPlayed),
        wins: asNumber(stats.wins, defaultProfile.stats.wins),
        losses: asNumber(stats.losses, defaultProfile.stats.losses),
        bestMissionIndex: asNumber(stats.bestMissionIndex, defaultProfile.stats.bestMissionIndex),
        bestWave: asNumber(stats.bestWave, defaultProfile.stats.bestWave),
      },
      metaUpgrades: {},
    };
  }

  return null;
}

function migrateRunState(raw: unknown): RunState | null {
  if (!isObject(raw)) {
    return null;
  }

  const schemaVersion = asNumber(raw.schemaVersion, 1);
  if (!Array.isArray(raw.missions) || !isObject(raw.runModifiers) || !isObject(raw.startingBonuses)) {
    return null;
  }

  const missions = raw.missions
    .filter(isObject)
    .map((mission) => ({
      id: asString(mission.id, ""),
      templateId: asString(mission.templateId, ""),
      name: asString(mission.name, ""),
      levelPath: asString(mission.levelPath, ""),
      difficulty: asNumber(mission.difficulty, 1),
    }))
    .filter((mission) => mission.id.length > 0 && mission.levelPath.length > 0);

  if (missions.length === 0) {
    return null;
  }

  const startingBonusesRaw = raw.startingBonuses;
  const inventory = isObject(raw.inventory) ? raw.inventory : {};
  const currentMissionIndex = Math.max(0, asNumber(raw.currentMissionIndex, 0));

  const mergedBonuses = {
    ...createDefaultMetaModifiers(),
    ...(isObject(startingBonusesRaw) ? toNumberBooleanRecord(startingBonusesRaw) : {}),
  };

  if (schemaVersion === 1) {
    mergedBonuses.startingGold = asNumber(startingBonusesRaw.startingGold, 0);
    mergedBonuses.goldEarnedMultiplier = asNumber(startingBonusesRaw.goldEarnedMultiplier, 1);
    mergedBonuses.towerHpMultiplier = asNumber(startingBonusesRaw.towerHpMultiplier, 1);
    mergedBonuses.strongholdStartLevel = Math.max(1, asNumber(startingBonusesRaw.strongholdStartLevel, 1));
  }

  return {
    schemaVersion: RUN_SCHEMA_VERSION,
    runId: asString(raw.runId, ""),
    seed: asNumber(raw.seed, 0),
    currentMissionIndex: Math.min(currentMissionIndex, missions.length),
    missions,
    runModifiers: {
      difficulty: asNumber(raw.runModifiers.difficulty, 1),
      tier: toDifficultyTierId(raw.runModifiers.tier ?? DEFAULT_DIFFICULTY_TIER),
    },
    runAscensionIds: Array.isArray(raw.runAscensionIds) ? raw.runAscensionIds.filter(isString).sort() : [],
    runUnlockSnapshot: isObject(raw.runUnlockSnapshot)
      ? {
          towerTypes: Array.isArray(raw.runUnlockSnapshot.towerTypes)
            ? raw.runUnlockSnapshot.towerTypes.filter(isString).sort()
            : [],
          enemyTypes: Array.isArray(raw.runUnlockSnapshot.enemyTypes)
            ? raw.runUnlockSnapshot.enemyTypes.filter(isString).sort()
            : [],
          mapMutators: Array.isArray(raw.runUnlockSnapshot.mapMutators)
            ? raw.runUnlockSnapshot.mapMutators.filter(isString).sort()
            : [],
          ascensionIds: Array.isArray(raw.runUnlockSnapshot.ascensionIds)
            ? raw.runUnlockSnapshot.ascensionIds.filter(isString).sort()
            : [],
        }
      : createDefaultRunUnlockSnapshot(),
    inventory: {
      relics: Array.isArray(inventory.relics) ? inventory.relics.filter(isString) : [],
      boons: Array.isArray(inventory.boons) ? inventory.boons.filter(isString) : [],
    },
    startingBonuses: {
      ...createDefaultMetaModifiers(),
      ...mergedBonuses,
    },
    runGloryEarned: asNumber(raw.runGloryEarned, 0),
  };
}

function loadJson(key: string): unknown {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function saveJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asFiniteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function toNumberRecord(record: Record<string, unknown>): Record<string, number> {
  const output: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      output[key] = value;
    }
  }
  return output;
}

function toUnlockRecord(record: Record<string, unknown>): Record<string, boolean | number> {
  const output: Record<string, boolean | number> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "boolean") {
      output[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      output[key] = value;
    }
  }
  return output;
}

function toNumberBooleanRecord(record: Record<string, unknown>): Record<string, number | boolean> {
  const output: Record<string, number | boolean> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      output[key] = value;
    }
    if (typeof value === "boolean") {
      output[key] = value;
    }
  }
  return output;
}
