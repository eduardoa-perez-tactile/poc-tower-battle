import type { TowerDefinition, TowerDictionary, TowerGameplayParams } from "../types/towerDictionary";

const DEFAULT_GAMEPLAY: TowerGameplayParams = {
  icon: "T",
  regenRateBonusPct: 0,
  maxTroopsBonusPct: 0,
  defenseMultiplierAdd: 0,
  packetDamageBonusPct: 0,
  linkSpeedBonusPct: 0,
  extraOutgoingLinks: 0,
  auraRadius: 0,
  auraRegenBonusPct: 0,
  captureSpeedTakenMultiplierAdd: 0,
  goldPerSecond: 0,
  recaptureBonusGold: 0,
};

const DEFAULT_SPRITE_BY_ID: Record<string, string> = {
  STRONGHOLD: "keep",
  BARRACKS: "barracks",
  FORTRESS: "guard_tower",
  RELAY: "scout_tower",
  BANK: "foundry",
  OBELISK: "mage_tower",
};

export function cloneTowerDictionary(dictionary: TowerDictionary): TowerDictionary {
  return {
    schemaVersion: dictionary.schemaVersion,
    version: dictionary.version,
    baseline: {
      gameplay: { ...dictionary.baseline.gameplay },
      raw: deepClone(dictionary.baseline.raw),
    },
    towers: Object.fromEntries(
      Object.entries(dictionary.towers).map(([id, tower]) => [id, cloneTowerDefinition(tower)]),
    ),
    order: [...dictionary.order],
  };
}

export function cloneTowerDefinition(tower: TowerDefinition): TowerDefinition {
  return {
    id: tower.id,
    displayName: tower.displayName,
    description: tower.description,
    category: tower.category,
    tags: [...tower.tags],
    ownershipDefault: tower.ownershipDefault,
    gameplay: { ...tower.gameplay },
    art: {
      atlasId: tower.art.atlasId,
      spriteKey: tower.art.spriteKey,
      frameIndex: tower.art.frameIndex,
      scale: tower.art.scale,
      offsetX: tower.art.offsetX,
      offsetY: tower.art.offsetY,
      anchorX: tower.art.anchorX,
      anchorY: tower.art.anchorY,
    },
    raw: deepClone(tower.raw),
  };
}

export function createNewTowerDefinition(id: string): TowerDefinition {
  const normalizedId = normalizeTowerId(id);
  const spriteKey = DEFAULT_SPRITE_BY_ID[normalizedId] ?? "guard_tower";
  return {
    id: normalizedId,
    displayName: toDisplayName(normalizedId),
    description: "",
    category: "",
    tags: [],
    ownershipDefault: "neutral",
    gameplay: {
      ...DEFAULT_GAMEPLAY,
      icon: normalizedId.slice(0, 1).toUpperCase() || "T",
    },
    art: {
      atlasId: "buildings",
      spriteKey,
      frameIndex: 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    },
    raw: {},
  };
}

export function createUniqueTowerId(dictionary: TowerDictionary, seed: string): string {
  const normalizedSeed = normalizeTowerId(seed);
  const existing = new Set(Object.keys(dictionary.towers));
  if (!existing.has(normalizedSeed)) {
    return normalizedSeed;
  }

  let suffix = 2;
  while (existing.has(`${normalizedSeed}_${suffix}`)) {
    suffix += 1;
  }
  return `${normalizedSeed}_${suffix}`;
}

export function duplicateTower(dictionary: TowerDictionary, sourceId: string, nextId: string): TowerDictionary {
  const source = dictionary.towers[sourceId];
  if (!source) {
    return dictionary;
  }
  const normalizedId = normalizeTowerId(nextId);
  const duplicate = cloneTowerDefinition(source);
  duplicate.id = normalizedId;
  duplicate.displayName = `${source.displayName} Copy`;

  return {
    ...cloneTowerDictionary(dictionary),
    towers: {
      ...dictionary.towers,
      [normalizedId]: duplicate,
    },
    order: insertAfter(dictionary.order, sourceId, normalizedId),
  };
}

export function createTower(dictionary: TowerDictionary, id: string): TowerDictionary {
  const normalizedId = normalizeTowerId(id);
  const next = cloneTowerDictionary(dictionary);
  next.towers[normalizedId] = createNewTowerDefinition(normalizedId);
  next.order = [...dictionary.order, normalizedId];
  return next;
}

export function deleteTower(dictionary: TowerDictionary, id: string): TowerDictionary {
  if (!dictionary.towers[id]) {
    return dictionary;
  }
  const next = cloneTowerDictionary(dictionary);
  delete next.towers[id];
  next.order = next.order.filter((entry) => entry !== id);
  return next;
}

export function replaceTower(dictionary: TowerDictionary, towerId: string, nextTower: TowerDefinition): TowerDictionary {
  if (!dictionary.towers[towerId]) {
    return dictionary;
  }
  const next = cloneTowerDictionary(dictionary);
  next.towers[towerId] = cloneTowerDefinition(nextTower);
  return next;
}

export function revertTower(draft: TowerDictionary, applied: TowerDictionary, towerId: string): TowerDictionary {
  const appliedTower = applied.towers[towerId];
  if (!appliedTower) {
    return draft;
  }
  return replaceTower(draft, towerId, appliedTower);
}

export function listDirtyTowerIds(applied: TowerDictionary, draft: TowerDictionary): string[] {
  const ids = new Set<string>([...Object.keys(applied.towers), ...Object.keys(draft.towers)]);
  return [...ids]
    .filter((towerId) => {
      const before = applied.towers[towerId];
      const after = draft.towers[towerId];
      if (!before || !after) {
        return true;
      }
      return stableSerialize(before) !== stableSerialize(after);
    })
    .sort((left, right) => left.localeCompare(right));
}

export function listDirtyTowerFieldPaths(loaded: TowerDictionary, draft: TowerDictionary, towerId: string): Set<string> {
  const dirty = new Set<string>();
  const original = loaded.towers[towerId];
  const current = draft.towers[towerId];
  if (!original || !current) {
    return dirty;
  }

  compareField(dirty, "displayName", original.displayName, current.displayName);
  compareField(dirty, "description", original.description ?? "", current.description ?? "");
  compareField(dirty, "category", original.category ?? "", current.category ?? "");
  compareField(dirty, "ownershipDefault", original.ownershipDefault ?? "", current.ownershipDefault ?? "");
  compareField(dirty, "tags", stableSerialize(original.tags), stableSerialize(current.tags));

  for (const key of Object.keys(original.gameplay) as Array<keyof TowerGameplayParams>) {
    compareField(dirty, `gameplay.${key}`, original.gameplay[key], current.gameplay[key]);
  }

  compareField(dirty, "art.atlasId", original.art.atlasId, current.art.atlasId);
  compareField(dirty, "art.spriteKey", original.art.spriteKey, current.art.spriteKey);
  compareField(dirty, "art.frameIndex", original.art.frameIndex, current.art.frameIndex);
  compareField(dirty, "art.scale", original.art.scale ?? "", current.art.scale ?? "");
  compareField(dirty, "art.offsetX", original.art.offsetX ?? "", current.art.offsetX ?? "");
  compareField(dirty, "art.offsetY", original.art.offsetY ?? "", current.art.offsetY ?? "");
  compareField(dirty, "art.anchorX", original.art.anchorX ?? "", current.art.anchorX ?? "");
  compareField(dirty, "art.anchorY", original.art.anchorY ?? "", current.art.anchorY ?? "");

  return dirty;
}

function normalizeTowerId(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function toDisplayName(id: string): string {
  return id
    .toLowerCase()
    .split("_")
    .filter((token) => token.length > 0)
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1))
    .join(" ");
}

function insertAfter(order: string[], sourceId: string, insertedId: string): string[] {
  const without = order.filter((entry) => entry !== insertedId);
  const index = without.indexOf(sourceId);
  if (index < 0) {
    return [...without, insertedId];
  }
  const result = [...without];
  result.splice(index + 1, 0, insertedId);
  return result;
}

function compareField(set: Set<string>, fieldPath: string, left: unknown, right: unknown): void {
  if (left !== right) {
    set.add(fieldPath);
  }
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJson(entry));
  }
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
      sorted[key] = sortJson((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
