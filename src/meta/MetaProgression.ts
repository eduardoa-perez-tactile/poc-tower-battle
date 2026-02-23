import { createDefaultMetaModifiers, type MetaModifiers, type MetaProfile } from "../save/Schema";

export interface UpgradeEffectsPerLevel {
  startingGold?: number;
  goldEarnedPct?: number;
  heroDamagePct?: number;
  towerHpPct?: number;
  strongholdStartLevel?: number;
}

export interface MetaUpgradeDefinition {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  baseCost: number;
  costGrowth: number;
  effectsPerLevel: UpgradeEffectsPerLevel;
  prerequisites: string[];
}

export interface PurchaseUpgradeResult {
  ok: boolean;
  reason?: string;
  costPaid?: number;
}

export async function loadMetaUpgradeCatalog(path = "/data/meta-upgrades.json"): Promise<MetaUpgradeDefinition[]> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load meta upgrade catalog (${response.status} ${response.statusText})`);
  }

  const data: unknown = await response.json();
  return parseMetaUpgradeCatalog(data);
}

export function computeMetaModifiers(
  profile: MetaProfile,
  upgrades: MetaUpgradeDefinition[],
): MetaModifiers {
  const modifiers = createDefaultMetaModifiers();
  const upgradesById = new Map<string, MetaUpgradeDefinition>();
  for (const upgrade of upgrades) {
    upgradesById.set(upgrade.id, upgrade);
  }

  for (const [upgradeId, levelRaw] of Object.entries(profile.metaUpgrades)) {
    const definition = upgradesById.get(upgradeId);
    if (!definition) {
      continue;
    }

    const level = clampLevel(levelRaw, definition.maxLevel);
    if (level <= 0) {
      continue;
    }

    modifiers.startingGold += (definition.effectsPerLevel.startingGold ?? 0) * level;
    modifiers.goldEarnedMultiplier += (definition.effectsPerLevel.goldEarnedPct ?? 0) * level;
    modifiers.heroDamageMultiplier += (definition.effectsPerLevel.heroDamagePct ?? 0) * level;
    modifiers.towerHpMultiplier += (definition.effectsPerLevel.towerHpPct ?? 0) * level;

    const unlockLevel = definition.effectsPerLevel.strongholdStartLevel;
    if (typeof unlockLevel === "number" && unlockLevel > modifiers.strongholdStartLevel) {
      modifiers.strongholdStartLevel = unlockLevel;
    }
  }

  return modifiers;
}

export function getNextUpgradeCost(profile: MetaProfile, definition: MetaUpgradeDefinition): number | null {
  const currentLevel = getUpgradeLevel(profile, definition.id);
  if (currentLevel >= definition.maxLevel) {
    return null;
  }

  return Math.round(definition.baseCost * Math.pow(definition.costGrowth, currentLevel));
}

export function getUpgradeLevel(profile: MetaProfile, upgradeId: string): number {
  const raw = profile.metaUpgrades[upgradeId] ?? 0;
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

export function purchaseUpgrade(
  profile: MetaProfile,
  upgrades: MetaUpgradeDefinition[],
  upgradeId: string,
): PurchaseUpgradeResult {
  const definition = upgrades.find((entry) => entry.id === upgradeId);
  if (!definition) {
    return { ok: false, reason: "Unknown upgrade" };
  }

  const currentLevel = getUpgradeLevel(profile, upgradeId);
  if (currentLevel >= definition.maxLevel) {
    return { ok: false, reason: "Upgrade is already maxed" };
  }

  for (const prerequisiteId of definition.prerequisites) {
    if (getUpgradeLevel(profile, prerequisiteId) <= 0) {
      return { ok: false, reason: "Missing prerequisite upgrade" };
    }
  }

  const cost = getNextUpgradeCost(profile, definition);
  if (cost === null) {
    return { ok: false, reason: "Upgrade is already maxed" };
  }
  if (profile.glory < cost) {
    return { ok: false, reason: "Not enough Glory" };
  }

  profile.glory -= cost;
  profile.metaUpgrades[upgradeId] = currentLevel + 1;
  return { ok: true, costPaid: cost };
}

export function refreshUnlocks(profile: MetaProfile): string[] {
  const unlockNotifications: string[] = [];
  unlockNotifications.push(
    ...unlockByCondition(profile, "veteran-command", profile.stats.runsPlayed >= 3, "Veteran Command unlocked"),
  );
  unlockNotifications.push(
    ...unlockByCondition(profile, "victor-banner", profile.stats.wins >= 1, "Victor Banner unlocked"),
  );
  unlockNotifications.push(
    ...unlockByCondition(
      profile,
      "stronghold-doctrine",
      getUpgradeLevel(profile, "stronghold-doctrine") > 0,
      "Stronghold Doctrine unlocked",
    ),
  );
  return unlockNotifications;
}

function parseMetaUpgradeCatalog(data: unknown): MetaUpgradeDefinition[] {
  if (!isObject(data)) {
    throw new Error("Meta upgrade catalog must be an object");
  }

  const upgrades = data.upgrades;
  if (!Array.isArray(upgrades)) {
    throw new Error("Meta upgrade catalog must include an upgrades array");
  }

  return upgrades.map((upgrade, index) => parseUpgrade(upgrade, index));
}

function parseUpgrade(value: unknown, index: number): MetaUpgradeDefinition {
  if (!isObject(value)) {
    throw new Error(`Upgrade entry at index ${index} is invalid`);
  }
  if (!isObject(value.effectsPerLevel)) {
    throw new Error(`upgrades[${index}].effectsPerLevel must be an object`);
  }

  return {
    id: asString(value.id, `upgrades[${index}].id`),
    name: asString(value.name, `upgrades[${index}].name`),
    description: asString(value.description, `upgrades[${index}].description`),
    maxLevel: asPositiveInt(value.maxLevel, `upgrades[${index}].maxLevel`),
    baseCost: asPositiveNumber(value.baseCost, `upgrades[${index}].baseCost`),
    costGrowth: asPositiveNumber(value.costGrowth, `upgrades[${index}].costGrowth`),
    effectsPerLevel: {
      startingGold: asOptionalNumber(value.effectsPerLevel.startingGold),
      goldEarnedPct: asOptionalNumber(value.effectsPerLevel.goldEarnedPct),
      heroDamagePct: asOptionalNumber(value.effectsPerLevel.heroDamagePct),
      towerHpPct: asOptionalNumber(value.effectsPerLevel.towerHpPct),
      strongholdStartLevel: asOptionalNumber(value.effectsPerLevel.strongholdStartLevel),
    },
    prerequisites: Array.isArray(value.prerequisites)
      ? value.prerequisites.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function unlockByCondition(
  profile: MetaProfile,
  key: string,
  condition: boolean,
  message: string,
): string[] {
  const alreadyUnlocked = profile.unlocks[key] === true;
  if (!condition || alreadyUnlocked) {
    return [];
  }

  profile.unlocks[key] = true;
  return [message];
}

function clampLevel(level: number, maxLevel: number): number {
  if (!Number.isFinite(level)) {
    return 0;
  }
  return Math.max(0, Math.min(maxLevel, Math.floor(level)));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function asPositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error(`${field} must be a positive number`);
  }
  return Math.floor(value);
}

function asPositiveNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return value;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}
