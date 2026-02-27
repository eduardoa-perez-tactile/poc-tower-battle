/*
 * Level Editor Enemy Data Store
 * UI calls this store; the store handles IO, mapping, and validation for enemy JSON data.
 */

import type { CampaignLevelDefinition, CampaignSpecV2 } from "../../../campaign/CampaignTypes";
import { isObject } from "../model/json";
import type { LevelEditorWorkspace } from "../model/types";
import { setDocumentData } from "../services/workspaceMutations";
import type { EnemyArchetype, EnemyArchetypeBehavior, EnemyArchetypeBaseStats, LevelEnemySet } from "../types/enemies";

const ENEMY_ARCHETYPES_PATH = "/data/enemyArchetypes.json";
const CAMPAIGN_PATH = "/data/campaign/campaign_v2.json";
const LEVEL_ENEMY_SETS_PATH = "/data/levelEnemySets.json";

interface EnemyCatalogDoc {
  archetypes: Array<Record<string, unknown>>;
}

interface LevelEnemySetCatalogDoc {
  levels: Record<string, LevelEnemySet>;
}

export interface EnemyDataStore {
  loadEnemyArchetypes(): Promise<EnemyArchetype[]>;
  saveEnemyArchetypes(updated: EnemyArchetype[]): Promise<void>;
  loadLevelEnemySets(): Promise<Record<string, LevelEnemySet>>;
  saveLevelEnemySets(updated: Record<string, LevelEnemySet>): Promise<void>;
}

export interface EnemyDataStoreDeps {
  getWorkspace: () => LevelEditorWorkspace | null;
  commitWorkspace: (updater: (workspace: LevelEditorWorkspace) => LevelEditorWorkspace) => void;
}

export function createEnemyDataStore(deps: EnemyDataStoreDeps): EnemyDataStore {
  return {
    async loadEnemyArchetypes(): Promise<EnemyArchetype[]> {
      const workspace = requireWorkspace(deps.getWorkspace());
      const catalog = requireEnemyCatalog(workspace);
      const archetypes = catalog.archetypes.map((entry) => deserializeArchetype(entry));
      const errors = validateEnemyArchetypes(archetypes);
      if (errors.length > 0) {
        throw new Error(`Enemy archetypes have validation issues:\n- ${errors.join("\n- ")}`);
      }
      return archetypes;
    },

    async saveEnemyArchetypes(updated: EnemyArchetype[]): Promise<void> {
      const errors = validateEnemyArchetypes(updated);
      if (errors.length > 0) {
        throw new Error(`Cannot save enemy archetypes:\n- ${errors.join("\n- ")}`);
      }
      const nextCatalog: EnemyCatalogDoc = {
        archetypes: updated.map((entry) => serializeArchetype(entry)),
      };
      deps.commitWorkspace((workspace) => setDocumentData(workspace, ENEMY_ARCHETYPES_PATH, nextCatalog));
    },

    async loadLevelEnemySets(): Promise<Record<string, LevelEnemySet>> {
      const workspace = requireWorkspace(deps.getWorkspace());
      const enemyCatalog = requireEnemyCatalog(workspace);
      const enemyIds = new Set(enemyCatalog.archetypes.map((entry) => asString(entry.id)));
      const campaign = requireCampaign(workspace);
      const defaultBossId = resolveDefaultBossId(enemyCatalog.archetypes);

      const fromLevelSets = tryReadLevelEnemySets(workspace);
      const sets = fromLevelSets ?? deriveLevelEnemySetsFromCampaign(campaign, defaultBossId);
      const errors = validateLevelEnemySets(sets, enemyIds, new Set(listCampaignLevelIds(campaign)));
      if (errors.length > 0) {
        throw new Error(`Level enemy usage has validation issues:\n- ${errors.join("\n- ")}`);
      }
      return sets;
    },

    async saveLevelEnemySets(updated: Record<string, LevelEnemySet>): Promise<void> {
      const workspace = requireWorkspace(deps.getWorkspace());
      const enemyCatalog = requireEnemyCatalog(workspace);
      const enemyIds = new Set(enemyCatalog.archetypes.map((entry) => asString(entry.id)));
      const campaign = requireCampaign(workspace);
      const levelIds = new Set(listCampaignLevelIds(campaign));
      const errors = validateLevelEnemySets(updated, enemyIds, levelIds);
      if (errors.length > 0) {
        throw new Error(`Cannot save level enemy usage:\n- ${errors.join("\n- ")}`);
      }

      const nextCampaign = applyLevelEnemySetsToCampaign(campaign, updated);
      deps.commitWorkspace((workspaceBefore) => {
        let next = setDocumentData(workspaceBefore, CAMPAIGN_PATH, nextCampaign);
        if (workspaceBefore.docs[LEVEL_ENEMY_SETS_PATH]) {
          const normalized = normalizeLevelEnemySetRecord(updated);
          const doc: LevelEnemySetCatalogDoc = { levels: normalized };
          next = setDocumentData(next, LEVEL_ENEMY_SETS_PATH, doc);
        }
        return next;
      });
    },
  };
}

function requireWorkspace(workspace: LevelEditorWorkspace | null): LevelEditorWorkspace {
  if (!workspace) {
    throw new Error("Level editor workspace is not loaded.");
  }
  return workspace;
}

function requireEnemyCatalog(workspace: LevelEditorWorkspace): EnemyCatalogDoc {
  const doc = workspace.docs[ENEMY_ARCHETYPES_PATH];
  if (!doc || !isObject(doc.currentData)) {
    throw new Error("Missing /data/enemyArchetypes.json.");
  }
  const raw = doc.currentData as Record<string, unknown>;
  if (!Array.isArray(raw.archetypes)) {
    throw new Error("enemyArchetypes.json must contain an archetypes array.");
  }
  return {
    archetypes: raw.archetypes.filter(isObject).map((entry) => deepClone(entry)),
  };
}

function requireCampaign(workspace: LevelEditorWorkspace): CampaignSpecV2 {
  const doc = workspace.docs[CAMPAIGN_PATH];
  if (!doc || !isObject(doc.currentData)) {
    throw new Error("Missing /data/campaign/campaign_v2.json.");
  }
  const current = doc.currentData as Record<string, unknown>;
  if (current.version !== 2 || !Array.isArray(current.stages)) {
    throw new Error("campaign_v2.json has invalid format.");
  }
  return deepClone(doc.currentData as unknown as CampaignSpecV2);
}

function tryReadLevelEnemySets(workspace: LevelEditorWorkspace): Record<string, LevelEnemySet> | null {
  const doc = workspace.docs[LEVEL_ENEMY_SETS_PATH];
  if (!doc || !isObject(doc.currentData)) {
    return null;
  }
  const raw = doc.currentData as Record<string, unknown>;
  if (!isObject(raw.levels)) {
    return null;
  }
  const record: Record<string, LevelEnemySet> = {};
  for (const [levelId, value] of Object.entries(raw.levels)) {
    if (!isObject(value) || !Array.isArray(value.enemies)) {
      continue;
    }
    record[levelId] = {
      enemies: value.enemies.map((entry) => `${entry}`).map((entry) => entry.trim()).filter((entry) => entry.length > 0),
      bossEnabled: typeof value.bossEnabled === "boolean" ? value.bossEnabled : undefined,
      minibossWave: asOptionalPositiveInt(value.minibossWave),
      bossId: typeof value.bossId === "string" ? value.bossId : undefined,
    };
  }
  return record;
}

function deserializeArchetype(raw: Record<string, unknown>): EnemyArchetype {
  const id = asString(raw.id);
  const tags = asStringArray(raw.tags);
  const baseStatsRaw = isObject(raw.baseStats) ? raw.baseStats : {};
  const behaviorRaw = isObject(raw.behavior) ? raw.behavior : {};
  const displayName = asOptionalString(raw.displayName) ?? asOptionalString(raw.name) ?? id;
  const description = asOptionalString(raw.description);
  const role = asOptionalString(raw.role);

  const baseStats: EnemyArchetypeBaseStats = {
    hp: asNumber(baseStatsRaw.hp),
    damage: asNumber(baseStatsRaw.damage),
    speed: asNumber(baseStatsRaw.speed),
    attackRange: asOptionalNumber(baseStatsRaw.attackRange),
    attackCooldown: asOptionalNumber(baseStatsRaw.attackCooldown),
  };

  const behavior: EnemyArchetypeBehavior = {
    shieldDurationSec: asOptionalNumber(behaviorRaw.shieldUptimeSec),
    shieldCooldownSec: asOptionalNumber(behaviorRaw.shieldCycleSec),
    supportAuraRadius: asOptionalNumber(behaviorRaw.supportAuraRadius),
    supportSpeedMultiplier: asOptionalNumber(behaviorRaw.supportSpeedMultiplier),
    supportArmorMultiplier: asOptionalNumber(behaviorRaw.supportArmorMultiplier),
    supportDamageBuff: asOptionalNumber(behaviorRaw.supportDamageBuff),
    supportHpBuff: asOptionalNumber(behaviorRaw.supportHpBuff),
    linkCutDurationSec: asOptionalNumber(behaviorRaw.linkCutDurationSec),
    linkCutCooldownSec: asOptionalNumber(behaviorRaw.linkCutCooldownSec),
    linkIntegrityDamagePerSec: asOptionalNumber(behaviorRaw.linkIntegrityDamagePerSec),
    splitChildId: asOptionalString(behaviorRaw.splitChildArchetypeId),
    splitChildCount: asOptionalNumber(behaviorRaw.splitChildCount),
  };

  return {
    id,
    displayName,
    description,
    role,
    baseStats,
    spawnWeight: asNumber(raw.spawnWeight),
    isBoss: tags.includes("boss"),
    isMiniboss: tags.includes("miniboss"),
    tags,
    behavior,
    raw: deepClone(raw),
  };
}

function serializeArchetype(archetype: EnemyArchetype): Record<string, unknown> {
  const next = deepClone(archetype.raw);
  const baseStats = isObject(next.baseStats) ? next.baseStats : {};
  const behavior = isObject(next.behavior) ? next.behavior : {};
  const tags = withBossTags(archetype.tags, archetype.isBoss, archetype.isMiniboss);

  next.id = archetype.id;
  next.name = archetype.displayName;
  if (archetype.description && archetype.description.trim().length > 0) {
    next.description = archetype.description.trim();
  } else {
    delete next.description;
  }
  if (archetype.role && archetype.role.trim().length > 0) {
    next.role = archetype.role.trim();
  } else {
    delete next.role;
  }
  next.baseStats = {
    ...baseStats,
    hp: archetype.baseStats.hp,
    damage: archetype.baseStats.damage,
    speed: archetype.baseStats.speed,
    attackRange: archetype.baseStats.attackRange ?? 0,
    attackCooldown: archetype.baseStats.attackCooldown ?? 0,
  };
  next.spawnWeight = archetype.spawnWeight;
  next.tags = tags;

  applyOptionalBehaviorField(behavior, "shieldUptimeSec", archetype.behavior.shieldDurationSec);
  applyOptionalBehaviorField(behavior, "shieldCycleSec", archetype.behavior.shieldCooldownSec);
  applyOptionalBehaviorField(behavior, "supportAuraRadius", archetype.behavior.supportAuraRadius);
  applyOptionalBehaviorField(behavior, "supportSpeedMultiplier", archetype.behavior.supportSpeedMultiplier);
  applyOptionalBehaviorField(behavior, "supportArmorMultiplier", archetype.behavior.supportArmorMultiplier);
  applyOptionalBehaviorField(behavior, "supportDamageBuff", archetype.behavior.supportDamageBuff);
  applyOptionalBehaviorField(behavior, "supportHpBuff", archetype.behavior.supportHpBuff);
  applyOptionalBehaviorField(behavior, "linkCutDurationSec", archetype.behavior.linkCutDurationSec);
  applyOptionalBehaviorField(behavior, "linkCutCooldownSec", archetype.behavior.linkCutCooldownSec);
  applyOptionalBehaviorField(behavior, "linkIntegrityDamagePerSec", archetype.behavior.linkIntegrityDamagePerSec);
  applyOptionalBehaviorField(behavior, "splitChildArchetypeId", archetype.behavior.splitChildId);
  applyOptionalBehaviorField(behavior, "splitChildCount", archetype.behavior.splitChildCount);

  if (Object.keys(behavior).length > 0) {
    next.behavior = behavior;
  } else {
    delete next.behavior;
  }

  return next;
}

function applyOptionalBehaviorField(
  target: Record<string, unknown>,
  key: string,
  value: number | string | undefined,
): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    target[key] = value;
    return;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    target[key] = value.trim();
    return;
  }
  delete target[key];
}

function deriveLevelEnemySetsFromCampaign(
  campaign: CampaignSpecV2,
  fallbackBossId: string,
): Record<string, LevelEnemySet> {
  const result: Record<string, LevelEnemySet> = {};
  for (const stage of campaign.stages) {
    for (const level of stage.levels) {
      const bossId = resolveBossIdForLevel(level.archetypeAllowlist, fallbackBossId);
      result[level.id] = {
        enemies: uniqueStrings(level.archetypeAllowlist),
        bossEnabled: typeof level.wavePlan.bossEnabled === "boolean" ? level.wavePlan.bossEnabled : undefined,
        minibossWave: asOptionalPositiveInt(level.wavePlan.minibossWave),
        bossId,
      };
    }
  }
  return result;
}

function applyLevelEnemySetsToCampaign(
  campaign: CampaignSpecV2,
  sets: Record<string, LevelEnemySet>,
): CampaignSpecV2 {
  return {
    ...campaign,
    stages: campaign.stages.map((stage) => ({
      ...stage,
      levels: stage.levels.map((level) => applyLevelEnemySet(level, sets[level.id])),
    })),
  };
}

function applyLevelEnemySet(level: CampaignLevelDefinition, set: LevelEnemySet | undefined): CampaignLevelDefinition {
  if (!set) {
    return level;
  }
  const allowlist = uniqueStrings(set.enemies);
  if (set.bossEnabled && set.bossId && !allowlist.includes(set.bossId)) {
    allowlist.push(set.bossId);
  }

  const nextWavePlan = { ...level.wavePlan };
  if (typeof set.bossEnabled === "boolean") {
    nextWavePlan.bossEnabled = set.bossEnabled;
  }
  if (typeof set.minibossWave === "number" && set.minibossWave > 0) {
    nextWavePlan.minibossWave = Math.floor(set.minibossWave);
  } else {
    delete nextWavePlan.minibossWave;
  }

  return {
    ...level,
    archetypeAllowlist: allowlist,
    wavePlan: nextWavePlan,
  };
}

function resolveDefaultBossId(archetypes: Array<Record<string, unknown>>): string {
  for (const entry of archetypes) {
    const tags = asStringArray(entry.tags);
    if (tags.includes("boss")) {
      return asString(entry.id);
    }
  }
  return "overseer_boss";
}

function resolveBossIdForLevel(allowlist: string[], fallbackBossId: string): string | undefined {
  const explicitBoss = allowlist.find((entry) => entry.includes("boss"));
  return explicitBoss ?? fallbackBossId;
}

function listCampaignLevelIds(campaign: CampaignSpecV2): string[] {
  const ids: string[] = [];
  for (const stage of campaign.stages) {
    for (const level of stage.levels) {
      ids.push(level.id);
    }
  }
  return ids;
}

function normalizeLevelEnemySetRecord(value: Record<string, LevelEnemySet>): Record<string, LevelEnemySet> {
  const result: Record<string, LevelEnemySet> = {};
  for (const [levelId, set] of Object.entries(value)) {
    result[levelId] = {
      enemies: uniqueStrings(set.enemies),
      bossEnabled: typeof set.bossEnabled === "boolean" ? set.bossEnabled : undefined,
      minibossWave: asOptionalPositiveInt(set.minibossWave),
      bossId: set.bossId && set.bossId.trim().length > 0 ? set.bossId.trim() : undefined,
    };
  }
  return result;
}

function validateEnemyArchetypes(archetypes: EnemyArchetype[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const archetype of archetypes) {
    if (archetype.id.trim().length === 0) {
      errors.push("Enemy id is required.");
    }
    if (seen.has(archetype.id)) {
      errors.push(`Duplicate enemy id "${archetype.id}".`);
    }
    seen.add(archetype.id);
    if (!Number.isFinite(archetype.baseStats.hp) || archetype.baseStats.hp < 0) {
      errors.push(`Enemy "${archetype.id}" has invalid hp.`);
    }
    if (!Number.isFinite(archetype.baseStats.damage) || archetype.baseStats.damage < 0) {
      errors.push(`Enemy "${archetype.id}" has invalid damage.`);
    }
    if (!Number.isFinite(archetype.baseStats.speed) || archetype.baseStats.speed < 0) {
      errors.push(`Enemy "${archetype.id}" has invalid speed.`);
    }
    if (archetype.baseStats.attackRange !== undefined && (!Number.isFinite(archetype.baseStats.attackRange) || archetype.baseStats.attackRange < 0)) {
      errors.push(`Enemy "${archetype.id}" has invalid attackRange.`);
    }
    if (
      archetype.baseStats.attackCooldown !== undefined &&
      (!Number.isFinite(archetype.baseStats.attackCooldown) || archetype.baseStats.attackCooldown < 0)
    ) {
      errors.push(`Enemy "${archetype.id}" has invalid attackCooldown.`);
    }
    if (!Number.isFinite(archetype.spawnWeight) || archetype.spawnWeight < 0) {
      errors.push(`Enemy "${archetype.id}" has invalid spawnWeight.`);
    }
    if (archetype.behavior.splitChildCount !== undefined && (!Number.isFinite(archetype.behavior.splitChildCount) || archetype.behavior.splitChildCount < 0)) {
      errors.push(`Enemy "${archetype.id}" has invalid splitter child count.`);
    }
  }
  return errors;
}

function validateLevelEnemySets(
  sets: Record<string, LevelEnemySet>,
  knownEnemyIds: Set<string>,
  knownLevelIds: Set<string>,
): string[] {
  const errors: string[] = [];
  for (const levelId of Object.keys(sets)) {
    if (!knownLevelIds.has(levelId)) {
      errors.push(`Unknown level id "${levelId}" in level enemy sets.`);
      continue;
    }
    const set = sets[levelId];
    if (!Array.isArray(set.enemies) || set.enemies.length === 0) {
      errors.push(`Level "${levelId}" must have at least one enabled enemy.`);
      continue;
    }
    for (const enemyId of set.enemies) {
      if (!knownEnemyIds.has(enemyId)) {
        errors.push(`Level "${levelId}" references unknown enemy "${enemyId}".`);
      }
    }
    if (set.bossId && !knownEnemyIds.has(set.bossId)) {
      errors.push(`Level "${levelId}" references unknown bossId "${set.bossId}".`);
    }
    if (
      set.minibossWave !== undefined &&
      (!Number.isInteger(set.minibossWave) || set.minibossWave < 1 || set.minibossWave > 12)
    ) {
      errors.push(`Level "${levelId}" has invalid minibossWave "${set.minibossWave}".`);
    }
  }
  return errors;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asOptionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.map((entry) => `${entry}`).map((entry) => entry.trim()).filter((entry) => entry.length > 0));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function withBossTags(tags: string[], isBoss: boolean, isMiniboss: boolean): string[] {
  const next = tags.filter((entry) => entry !== "boss" && entry !== "miniboss");
  if (isBoss) {
    next.push("boss");
  }
  if (isMiniboss) {
    next.push("miniboss");
  }
  return uniqueStrings(next);
}
