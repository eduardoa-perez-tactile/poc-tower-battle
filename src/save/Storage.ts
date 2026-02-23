import {
  META_SCHEMA_VERSION,
  RUN_SCHEMA_VERSION,
  createDefaultMetaProfile,
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
    metaUpgrades: { ...profile.metaUpgrades },
    unlocks: { ...profile.unlocks },
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

  const schemaVersion = asNumber(raw.schemaVersion);
  if (schemaVersion !== META_SCHEMA_VERSION) {
    return null;
  }

  const defaultProfile = createDefaultMetaProfile();
  const stats = isObject(raw.stats) ? raw.stats : {};

  return {
    schemaVersion: META_SCHEMA_VERSION,
    glory: asNumber(raw.glory, defaultProfile.glory),
    unlocks: isObject(raw.unlocks) ? toUnlockRecord(raw.unlocks) : {},
    metaUpgrades: isObject(raw.metaUpgrades) ? toNumberRecord(raw.metaUpgrades) : {},
    stats: {
      runsPlayed: asNumber(stats.runsPlayed, defaultProfile.stats.runsPlayed),
      wins: asNumber(stats.wins, defaultProfile.stats.wins),
      losses: asNumber(stats.losses, defaultProfile.stats.losses),
      bestMissionIndex: asNumber(stats.bestMissionIndex, defaultProfile.stats.bestMissionIndex),
      bestWave: asNumber(stats.bestWave, defaultProfile.stats.bestWave),
    },
  };
}

function migrateRunState(raw: unknown): RunState | null {
  if (!isObject(raw)) {
    return null;
  }

  if (asNumber(raw.schemaVersion) !== RUN_SCHEMA_VERSION) {
    return null;
  }
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

  const startingBonuses = raw.startingBonuses;
  const inventory = isObject(raw.inventory) ? raw.inventory : {};

  const currentMissionIndex = Math.max(0, asNumber(raw.currentMissionIndex, 0));

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
    inventory: {
      relics: Array.isArray(inventory.relics) ? inventory.relics.filter(isString) : [],
      boons: Array.isArray(inventory.boons) ? inventory.boons.filter(isString) : [],
    },
    startingBonuses: {
      startingGold: asNumber(startingBonuses.startingGold, 0),
      goldEarnedMultiplier: asNumber(startingBonuses.goldEarnedMultiplier, 1),
      heroDamageMultiplier: asNumber(startingBonuses.heroDamageMultiplier, 1),
      towerHpMultiplier: asNumber(startingBonuses.towerHpMultiplier, 1),
      strongholdStartLevel: Math.max(1, asNumber(startingBonuses.strongholdStartLevel, 1)),
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
