import type {
  TowerArchetypeArtResolved,
  LinkLevelCatalog,
  LinkLevelDefinition,
  LoadedDepthContent,
  TowerArchetypeCatalog,
  TowerArchetypeModifier,
  TowerArchetypeState,
} from "./DepthTypes";
import { TowerArchetype } from "./DepthTypes";

const ARCHETYPE_ORDER: TowerArchetype[] = [
  TowerArchetype.STRONGHOLD,
  TowerArchetype.BARRACKS,
  TowerArchetype.FORTRESS,
  TowerArchetype.RELAY,
  TowerArchetype.BANK,
  TowerArchetype.OBELISK,
];

export async function loadDepthContent(): Promise<LoadedDepthContent> {
  const [towerArchetypes, linkLevels] = await Promise.all([
    fetchJson<TowerArchetypeCatalog>("/data/towerArchetypes.json"),
    fetchJson<LinkLevelCatalog>("/data/linkLevels.json"),
  ]);

  validateTowerArchetypes(towerArchetypes);
  const linkLevelsByLevel = validateAndIndexLinkLevels(linkLevels);

  return {
    towerArchetypes,
    linkLevels: linkLevelsByLevel,
  };
}

export function applyTowerArchetypeModifiers(
  tower: TowerArchetypeState,
  catalog: TowerArchetypeCatalog,
): void {
  const baseline = catalog.baseline;
  const modifier = catalog.archetypes[tower.archetype] ?? baseline;

  tower.maxTroops = applyBonusPct(tower.baseMaxTroops, baseline.maxTroopsBonusPct + modifier.maxTroopsBonusPct);
  tower.regenRate = applyBonusPct(tower.baseRegenRate, baseline.regenRateBonusPct + modifier.regenRateBonusPct);
  tower.defenseMultiplier = Math.max(
    0.1,
    1 + baseline.defenseMultiplierAdd + modifier.defenseMultiplierAdd,
  );
  tower.packetDamageMultiplier = Math.max(
    0.1,
    1 + baseline.packetDamageBonusPct + modifier.packetDamageBonusPct,
  );
  tower.linkSpeedBonus = Math.max(0, baseline.linkSpeedBonusPct + modifier.linkSpeedBonusPct);
  tower.extraOutgoingLinks = Math.max(
    0,
    Math.floor(baseline.extraOutgoingLinks + modifier.extraOutgoingLinks),
  );
  tower.auraRadius = Math.max(0, baseline.auraRadius + modifier.auraRadius);
  tower.auraRegenBonusPct = Math.max(0, baseline.auraRegenBonusPct + modifier.auraRegenBonusPct);
  tower.captureSpeedTakenMultiplier = Math.max(
    0.1,
    1 + baseline.captureSpeedTakenMultiplierAdd + modifier.captureSpeedTakenMultiplierAdd,
  );
  tower.goldPerSecond = Math.max(0, baseline.goldPerSecond + modifier.goldPerSecond);
  tower.recaptureBonusGold = Math.max(0, baseline.recaptureBonusGold + modifier.recaptureBonusGold);
  tower.archetypeIcon = modifier.icon || baseline.icon;
}

export function parseTowerArchetype(value: unknown, fallback: TowerArchetype): TowerArchetype {
  if (typeof value !== "string") {
    return fallback;
  }

  for (const archetype of ARCHETYPE_ORDER) {
    if (value === archetype) {
      return archetype;
    }
  }

  return fallback;
}

export function buildTowerArchetypeArtMap(
  catalog: TowerArchetypeCatalog,
): Record<TowerArchetype, TowerArchetypeArtResolved> {
  const defaults: Record<TowerArchetype, TowerArchetypeArtResolved> = {
    STRONGHOLD: {
      atlasId: "buildings",
      spriteKey: "keep",
      frameIndex: 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    BARRACKS: {
      atlasId: "buildings",
      spriteKey: "barracks",
      frameIndex: 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    FORTRESS: {
      atlasId: "buildings",
      spriteKey: "guard_tower",
      frameIndex: 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    RELAY: {
      atlasId: "buildings",
      spriteKey: "scout_tower",
      frameIndex: 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    BANK: {
      atlasId: "buildings",
      spriteKey: "foundry",
      frameIndex: 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    OBELISK: {
      atlasId: "buildings",
      spriteKey: "mage_tower",
      frameIndex: 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
  };

  const resolved = { ...defaults };
  for (const archetype of ARCHETYPE_ORDER) {
    const modifier = catalog.archetypes[archetype];
    const art = modifier?.art;
    if (!art || typeof art.spriteKey !== "string" || art.spriteKey.trim().length === 0) {
      continue;
    }
    resolved[archetype] = {
      atlasId: typeof art.atlasId === "string" && art.atlasId.trim().length > 0 ? art.atlasId : "buildings",
      spriteKey: art.spriteKey.trim(),
      frameIndex: typeof art.frameIndex === "number" && Number.isFinite(art.frameIndex) ? Math.max(0, Math.floor(art.frameIndex)) : 0,
      scale: typeof art.scale === "number" && Number.isFinite(art.scale) && art.scale > 0 ? art.scale : 1,
      offsetX: typeof art.offsetX === "number" && Number.isFinite(art.offsetX) ? art.offsetX : 0,
      offsetY: typeof art.offsetY === "number" && Number.isFinite(art.offsetY) ? art.offsetY : 0,
    };
  }

  return resolved;
}

function applyBonusPct(value: number, bonusPct: number): number {
  return Math.max(0, value + value * bonusPct);
}

function validateTowerArchetypes(catalog: TowerArchetypeCatalog): void {
  assertModifier(catalog.baseline, "towerArchetypes.baseline");
  for (const archetype of ARCHETYPE_ORDER) {
    const modifier = catalog.archetypes[archetype];
    if (!modifier) {
      throw new Error(`Missing tower archetype modifier for ${archetype}`);
    }
    assertModifier(modifier, `towerArchetypes.archetypes.${archetype}`);
  }
}

function assertModifier(value: TowerArchetypeModifier, path: string): void {
  assertString(value.icon, `${path}.icon`);
  assertNumber(value.regenRateBonusPct, `${path}.regenRateBonusPct`);
  assertNumber(value.maxTroopsBonusPct, `${path}.maxTroopsBonusPct`);
  assertNumber(value.defenseMultiplierAdd, `${path}.defenseMultiplierAdd`);
  assertNumber(value.packetDamageBonusPct, `${path}.packetDamageBonusPct`);
  assertNumber(value.linkSpeedBonusPct, `${path}.linkSpeedBonusPct`);
  assertNumber(value.extraOutgoingLinks, `${path}.extraOutgoingLinks`);
  assertNumber(value.auraRadius, `${path}.auraRadius`);
  assertNumber(value.auraRegenBonusPct, `${path}.auraRegenBonusPct`);
  assertNumber(value.captureSpeedTakenMultiplierAdd, `${path}.captureSpeedTakenMultiplierAdd`);
  assertNumber(value.goldPerSecond, `${path}.goldPerSecond`);
  assertNumber(value.recaptureBonusGold, `${path}.recaptureBonusGold`);
  if (value.art !== undefined) {
    assertArtMeta(value.art, `${path}.art`);
  }
}

function assertArtMeta(value: NonNullable<TowerArchetypeModifier["art"]>, path: string): void {
  if (value.atlasId !== undefined) {
    assertString(value.atlasId, `${path}.atlasId`);
  }
  if (value.spriteKey !== undefined) {
    assertString(value.spriteKey, `${path}.spriteKey`);
  }
  if (value.frameIndex !== undefined) {
    assertNumber(value.frameIndex, `${path}.frameIndex`);
  }
  if (value.scale !== undefined) {
    assertNumber(value.scale, `${path}.scale`);
  }
  if (value.offsetX !== undefined) {
    assertNumber(value.offsetX, `${path}.offsetX`);
  }
  if (value.offsetY !== undefined) {
    assertNumber(value.offsetY, `${path}.offsetY`);
  }
}

function validateAndIndexLinkLevels(catalog: LinkLevelCatalog): Map<number, LinkLevelDefinition> {
  if (!Array.isArray(catalog.levels) || catalog.levels.length < 3) {
    throw new Error("linkLevels.levels must define at least 3 entries");
  }

  const byLevel = new Map<number, LinkLevelDefinition>();
  for (const entry of catalog.levels) {
    assertNumber(entry.level, "linkLevels.levels[].level");
    assertNumber(entry.speedMultiplier, "linkLevels.levels[].speedMultiplier");
    assertNumber(entry.armorBonus, "linkLevels.levels[].armorBonus");
    assertNumber(entry.damageBonus, "linkLevels.levels[].damageBonus");
    assertNumber(entry.integrity, "linkLevels.levels[].integrity");
    assertNumber(entry.overchargeDrain, "linkLevels.levels[].overchargeDrain");

    byLevel.set(Math.floor(entry.level), {
      level: Math.floor(entry.level),
      speedMultiplier: entry.speedMultiplier,
      armorBonus: entry.armorBonus,
      damageBonus: entry.damageBonus,
      integrity: entry.integrity,
      overchargeDrain: entry.overchargeDrain,
    });
  }

  if (!byLevel.has(1) || !byLevel.has(2) || !byLevel.has(3)) {
    throw new Error("linkLevels.levels must include levels 1, 2, and 3");
  }

  return byLevel;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load depth config from ${path} (${response.status} ${response.statusText})`);
  }
  return (await response.json()) as T;
}

function assertString(value: unknown, path: string): void {
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string`);
  }
}

function assertNumber(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
}
