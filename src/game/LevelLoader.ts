import type { Link, Owner, Tower } from "../sim/World";
import type { SimulationRules } from "../sim/Simulation";

export interface LevelRules extends SimulationRules {
  maxOutgoingLinksPerTower: number;
}

export interface LoadedLevel {
  towers: Tower[];
  initialLinks: Link[];
  rules: LevelRules;
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

  const parsedTowers = towers.map((tower, index) => parseTower(tower, index));
  return {
    towers: parsedTowers,
    initialLinks: parseInitialLinks(data.initialLinks, parsedTowers),
    rules: parseRules(data.rules),
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
  const regenRatePerSec = asNumber(value.regenRatePerSec, `towers[${index}].regenRatePerSec`);
  const maxTroops = asNumber(value.maxTroops, `towers[${index}].maxTroops`);

  return { id, x, y, owner, troopCount, regenRatePerSec, maxTroops };
}

function parseRules(value: Record<string, unknown>): LevelRules {
  if (!isObject(value.defaultUnit)) {
    throw new Error("rules.defaultUnit must be an object");
  }

  return {
    maxOutgoingLinksPerTower: asNumber(
      value.maxOutgoingLinksPerTower,
      "rules.maxOutgoingLinksPerTower",
    ),
    sendRatePerSec: asNumber(value.sendRatePerSec, "rules.sendRatePerSec"),
    defaultUnit: {
      speedPxPerSec: asNumber(
        value.defaultUnit.speedPxPerSec,
        "rules.defaultUnit.speedPxPerSec",
      ),
      dpsPerUnit: asNumber(value.defaultUnit.dpsPerUnit, "rules.defaultUnit.dpsPerUnit"),
      hpPerUnit: asNumber(value.defaultUnit.hpPerUnit, "rules.defaultUnit.hpPerUnit"),
    },
  };
}

function parseInitialLinks(value: unknown, towers: Tower[]): Link[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("initialLinks must be an array when provided");
  }

  const towersById = new Map<string, Tower>();
  for (const tower of towers) {
    towersById.set(tower.id, tower);
  }

  const linksBySource = new Map<string, Link>();
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i];
    if (!isObject(entry)) {
      throw new Error(`initialLinks[${i}] must be an object`);
    }

    const fromTowerId = asString(entry.fromTowerId, `initialLinks[${i}].fromTowerId`);
    const toTowerId = asString(entry.toTowerId, `initialLinks[${i}].toTowerId`);
    if (fromTowerId === toTowerId) {
      throw new Error(`initialLinks[${i}] cannot link a tower to itself`);
    }

    const fromTower = towersById.get(fromTowerId);
    const toTower = towersById.get(toTowerId);
    if (!fromTower || !toTower) {
      throw new Error(`initialLinks[${i}] references unknown tower id`);
    }

    linksBySource.set(fromTowerId, {
      id: `${fromTowerId}->${toTowerId}`,
      fromTowerId,
      toTowerId,
      owner: fromTower.owner,
      points: [
        { x: fromTower.x, y: fromTower.y },
        { x: toTower.x, y: toTower.y },
      ],
    });
  }

  return Array.from(linksBySource.values());
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
