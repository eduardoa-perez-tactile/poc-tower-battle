import type { Owner, Tower } from "../sim/World";

export interface LoadedLevel {
  towers: Tower[];
  maxOutgoingLinksPerTower: number;
}

export async function loadLevel(path: string): Promise<LoadedLevel> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load level (${response.status} ${response.statusText})`);
  }

  const data: unknown = await response.json();
  return parseLevel(data);
}

function parseLevel(data: unknown): LoadedLevel {
  if (!isObject(data)) {
    throw new Error("Level JSON root must be an object");
  }

  if (!isObject(data.rules)) {
    throw new Error("Level JSON must include a rules object");
  }

  const towers = data.towers;
  if (!Array.isArray(towers)) {
    throw new Error("Level JSON must include a towers array");
  }

  return {
    towers: towers.map((tower, index) => parseTower(tower, index)),
    maxOutgoingLinksPerTower: asNumber(
      data.rules.maxOutgoingLinksPerTower,
      "rules.maxOutgoingLinksPerTower",
    ),
  };
}

function parseTower(value: unknown, index: number): Tower {
  if (!isObject(value)) {
    throw new Error(`Tower at index ${index} is invalid`);
  }

  const id = asString(value.id, `towers[${index}].id`);
  const x = asNumber(value.x, `towers[${index}].x`);
  const y = asNumber(value.y, `towers[${index}].y`);
  const owner = asOwner(value.owner, `towers[${index}].owner`);
  const troopCount = asNumber(value.troopCount, `towers[${index}].troopCount`);

  return { id, x, y, owner, troopCount };
}

function asString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function asNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  return value;
}

function asOwner(value: unknown, fieldName: string): Owner {
  if (value === "player" || value === "enemy" || value === "neutral") {
    return value;
  }
  throw new Error(`${fieldName} must be "player", "enemy", or "neutral"`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
