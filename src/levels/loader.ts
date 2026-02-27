import type {
  DecorLayer,
  GroundTileId,
  GroundLayer,
  LevelEdge,
  LevelGrid,
  LevelJson,
  LevelMission,
  LevelNode,
  LevelSizePreset,
} from "./types";

export const USER_LEVELS_STORAGE_KEY = "tower-battle.user-levels.v1";

export const BUNDLED_LEVEL_PATHS = [
  "/levels/stage01/level01.json",
  "/levels/stage01/level02.json",
  "/levels/stage02/level01.json",
] as const;

interface StoredUserLevel {
  id: string;
  sourcePath: string;
  savedAt: number;
  level: LevelJson;
}

export async function loadBundledLevels(paths: readonly string[] = BUNDLED_LEVEL_PATHS): Promise<LevelJson[]> {
  const results = await Promise.all(
    paths.map(async (path) => {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to load ${path} (${response.status} ${response.statusText})`);
      }
      const data: unknown = await response.json();
      return parseLevelJson(data, path);
    }),
  );

  return results;
}

export async function loadLevelFromPath(path: string): Promise<LevelJson> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (${response.status} ${response.statusText})`);
  }
  const data: unknown = await response.json();
  return parseLevelJson(data, path);
}

export function loadUserLevelsFromStorage(): LevelJson[] {
  const raw = localStorage.getItem(USER_LEVELS_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const levels: LevelJson[] = [];
  for (const [index, entry] of parsed.entries()) {
    if (!isObject(entry) || !isObject(entry.level)) {
      continue;
    }

    try {
      levels.push(parseLevelJson(entry.level, `${USER_LEVELS_STORAGE_KEY}[${index}]`));
    } catch (error) {
      console.warn("Skipping invalid user level", error);
    }
  }

  return levels;
}

export function saveUserLevelToStorage(level: LevelJson): void {
  const current = loadUserLevelRecords();
  const id = `${level.stageId}:${level.levelId}`;
  const sourcePath = `/levels/${level.stageId}/${level.levelId}.json`;
  const record: StoredUserLevel = {
    id,
    sourcePath,
    savedAt: Date.now(),
    level,
  };

  const next = current.filter((entry) => entry.id !== id);
  next.push(record);
  next.sort((a, b) => a.id.localeCompare(b.id));
  localStorage.setItem(USER_LEVELS_STORAGE_KEY, JSON.stringify(next));
}

export function downloadLevelJson(level: LevelJson): void {
  const pretty = JSON.stringify(level, null, 2);
  const blob = new Blob([pretty], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${level.stageId}-${level.levelId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function parseLevelJson(data: unknown, sourceLabel: string): LevelJson {
  if (!isObject(data)) {
    throw new Error(`${sourceLabel}: level JSON root must be an object`);
  }

  const version = asNumber(data.version, `${sourceLabel}.version`);
  if (version !== 1) {
    throw new Error(`${sourceLabel}: version must be 1`);
  }

  const stageId = asString(data.stageId, `${sourceLabel}.stageId`);
  const levelId = asString(data.levelId, `${sourceLabel}.levelId`);
  const name = asString(data.name, `${sourceLabel}.name`);
  const size = asSizePreset(data.size, `${sourceLabel}.size`);
  const grid = parseGrid(data.grid, `${sourceLabel}.grid`);
  const nodes = parseNodes(data.nodes, grid, `${sourceLabel}.nodes`);
  const edges = parseEdges(data.edges, nodes, `${sourceLabel}.edges`);
  const missions = parseMissions(data.missions, `${sourceLabel}.missions`);

  return {
    version: 1,
    stageId,
    levelId,
    name,
    size,
    grid,
    nodes,
    edges,
    missions,
    runtime: parseRuntime(data.runtime, `${sourceLabel}.runtime`),
  };
}

function parseGrid(value: unknown, fieldName: string): LevelGrid {
  if (!isObject(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  const width = asInteger(value.width, `${fieldName}.width`);
  const height = asInteger(value.height, `${fieldName}.height`);
  const minCellSize = asNumber(value.minCellSize, `${fieldName}.minCellSize`);

  if (width < 8 || width > 96) {
    throw new Error(`${fieldName}.width must be between 8 and 96`);
  }
  if (height < 8 || height > 96) {
    throw new Error(`${fieldName}.height must be between 8 and 96`);
  }
  if (minCellSize <= 0) {
    throw new Error(`${fieldName}.minCellSize must be > 0`);
  }

  if (!isObject(value.layers)) {
    throw new Error(`${fieldName}.layers must be an object`);
  }

  const ground = parseGroundLayer(value.layers.ground, `${fieldName}.layers.ground`);
  const decor = parseDecorLayer(value.layers.decor, `${fieldName}.layers.decor`);
  const blocked = parsePointsArray(value.layers.blocked, `${fieldName}.layers.blocked`, width, height);

  return {
    width,
    height,
    minCellSize,
    layers: {
      ground,
      decor,
      blocked,
    },
  };
}

function parseGroundLayer(value: unknown, fieldName: string): GroundLayer {
  if (!isObject(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  const fallback = asString(value.default, `${fieldName}.default`);
  if (fallback !== "grass" && fallback !== "dirt" && fallback !== "water") {
    throw new Error(`${fieldName}.default must be grass, dirt, or water`);
  }

  const overrides = parseTileOverrides(value.overrides, `${fieldName}.overrides`).map((entry, index) => {
    if (entry.tile !== "grass" && entry.tile !== "dirt" && entry.tile !== "water") {
      throw new Error(`${fieldName}.overrides[${index}].tile must be grass, dirt, or water`);
    }
    return {
      ...entry,
      tile: entry.tile as GroundTileId,
    };
  });

  return {
    default: fallback,
    overrides,
  };
}

function parseDecorLayer(value: unknown, fieldName: string): DecorLayer {
  if (!isObject(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  return {
    overrides: parseTileOverrides(value.overrides, `${fieldName}.overrides`),
  };
}

function parseTileOverrides(
  value: unknown,
  fieldName: string,
): Array<{ x: number; y: number; tile: string }> {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }

  return value.map((entry, index) => {
    if (!isObject(entry)) {
      throw new Error(`${fieldName}[${index}] must be an object`);
    }

    return {
      x: asInteger(entry.x, `${fieldName}[${index}].x`),
      y: asInteger(entry.y, `${fieldName}[${index}].y`),
      tile: asString(entry.tile, `${fieldName}[${index}].tile`),
    };
  });
}

function parseNodes(value: unknown, grid: LevelGrid, fieldName: string): LevelNode[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty array`);
  }

  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!isObject(entry)) {
      throw new Error(`${fieldName}[${index}] must be an object`);
    }

    const id = asString(entry.id, `${fieldName}[${index}].id`);
    if (ids.has(id)) {
      throw new Error(`${fieldName}[${index}].id must be unique`);
    }
    ids.add(id);

    const x = asInteger(entry.x, `${fieldName}[${index}].x`);
    const y = asInteger(entry.y, `${fieldName}[${index}].y`);
    if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) {
      throw new Error(`${fieldName}[${index}] must be inside grid bounds`);
    }

    const type = asString(entry.type, `${fieldName}[${index}].type`);
    if (type !== "tower" && type !== "stronghold") {
      throw new Error(`${fieldName}[${index}].type must be tower or stronghold`);
    }

    const owner = asString(entry.owner, `${fieldName}[${index}].owner`);
    if (owner !== "player" && owner !== "enemy" && owner !== "neutral") {
      throw new Error(`${fieldName}[${index}].owner must be player, enemy, or neutral`);
    }

    return {
      id,
      x,
      y,
      type,
      owner,
      regen: asOptionalNumber(entry.regen, `${fieldName}[${index}].regen`),
      cap: asOptionalNumber(entry.cap, `${fieldName}[${index}].cap`),
      maxHp: asOptionalNumber(entry.maxHp, `${fieldName}[${index}].maxHp`),
      hp: asOptionalNumber(entry.hp, `${fieldName}[${index}].hp`),
      troops: asOptionalNumber(entry.troops, `${fieldName}[${index}].troops`),
      archetype: asOptionalString(entry.archetype, `${fieldName}[${index}].archetype`),
    };
  });
}

function parseEdges(value: unknown, nodes: LevelNode[], fieldName: string): LevelEdge[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  return value.map((entry, index) => {
    if (!isObject(entry)) {
      throw new Error(`${fieldName}[${index}] must be an object`);
    }

    const from = asString(entry.from, `${fieldName}[${index}].from`);
    const to = asString(entry.to, `${fieldName}[${index}].to`);
    if (from === to) {
      throw new Error(`${fieldName}[${index}] cannot connect node to itself`);
    }
    if (!nodeIds.has(from) || !nodeIds.has(to)) {
      throw new Error(`${fieldName}[${index}] references unknown node id`);
    }

    return { from, to };
  });
}

function parseMissions(value: unknown, fieldName: string): LevelMission[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty array`);
  }

  const ids = new Set<string>();
  return value.map((entry, index) => {
    if (!isObject(entry)) {
      throw new Error(`${fieldName}[${index}] must be an object`);
    }

    const missionId = asString(entry.missionId, `${fieldName}[${index}].missionId`);
    if (ids.has(missionId)) {
      throw new Error(`${fieldName}[${index}].missionId must be unique`);
    }
    ids.add(missionId);

    const mission: LevelMission = {
      missionId,
      name: asString(entry.name, `${fieldName}[${index}].name`),
      seed: asInteger(entry.seed, `${fieldName}[${index}].seed`),
      waveSetId: asString(entry.waveSetId, `${fieldName}[${index}].waveSetId`),
      objectiveText: asString(entry.objectiveText, `${fieldName}[${index}].objectiveText`),
      difficulty: asOptionalNumber(entry.difficulty, `${fieldName}[${index}].difficulty`) ?? 1,
      tutorialId: asOptionalString(entry.tutorialId, `${fieldName}[${index}].tutorialId`),
    };

    return mission;
  });
}

function parseRuntime(value: unknown, fieldName: string): LevelJson["runtime"] {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  const runtime: NonNullable<LevelJson["runtime"]> = {};

  if (isObject(value.rules)) {
    runtime.rules = {
      maxOutgoingLinksPerTower: asOptionalNumber(value.rules.maxOutgoingLinksPerTower, `${fieldName}.rules.maxOutgoingLinksPerTower`),
      sendRatePerSec: asOptionalNumber(value.rules.sendRatePerSec, `${fieldName}.rules.sendRatePerSec`),
      collisionDistancePx: asOptionalNumber(value.rules.collisionDistancePx, `${fieldName}.rules.collisionDistancePx`),
      captureSeedTroops: asOptionalNumber(value.rules.captureSeedTroops, `${fieldName}.rules.captureSeedTroops`),
      defaultUnit: isObject(value.rules.defaultUnit)
        ? {
            speedPxPerSec: asOptionalNumber(value.rules.defaultUnit.speedPxPerSec, `${fieldName}.rules.defaultUnit.speedPxPerSec`),
            dpsPerUnit: asOptionalNumber(value.rules.defaultUnit.dpsPerUnit, `${fieldName}.rules.defaultUnit.dpsPerUnit`),
            hpPerUnit: asOptionalNumber(value.rules.defaultUnit.hpPerUnit, `${fieldName}.rules.defaultUnit.hpPerUnit`),
          }
        : undefined,
    };
  }

  if (isObject(value.ai)) {
    runtime.ai = {
      aiThinkIntervalSec: asOptionalNumber(value.ai.aiThinkIntervalSec, `${fieldName}.ai.aiThinkIntervalSec`),
      aiMinTroopsToAttack: asOptionalNumber(value.ai.aiMinTroopsToAttack, `${fieldName}.ai.aiMinTroopsToAttack`),
    };
  }

  return runtime;
}

function parsePointsArray(
  value: unknown,
  fieldName: string,
  width: number,
  height: number,
): Array<{ x: number; y: number }> {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }

  return value.map((entry, index) => {
    if (!isObject(entry)) {
      throw new Error(`${fieldName}[${index}] must be an object`);
    }

    const x = asInteger(entry.x, `${fieldName}[${index}].x`);
    const y = asInteger(entry.y, `${fieldName}[${index}].y`);
    if (x < 0 || x >= width || y < 0 || y >= height) {
      throw new Error(`${fieldName}[${index}] must be inside grid bounds`);
    }

    return { x, y };
  });
}

function loadUserLevelRecords(): StoredUserLevel[] {
  const raw = localStorage.getItem(USER_LEVELS_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const records: StoredUserLevel[] = [];
    for (const entry of parsed) {
      if (!isObject(entry) || !isObject(entry.level)) {
        continue;
      }

      try {
        const level = parseLevelJson(entry.level, `${USER_LEVELS_STORAGE_KEY}.level`);
        const record: StoredUserLevel = {
          id: asString(entry.id, `${USER_LEVELS_STORAGE_KEY}.id`),
          sourcePath: asString(entry.sourcePath, `${USER_LEVELS_STORAGE_KEY}.sourcePath`),
          savedAt: asInteger(entry.savedAt, `${USER_LEVELS_STORAGE_KEY}.savedAt`),
          level,
        };
        records.push(record);
      } catch (error) {
        console.warn("Skipping malformed user level record", error);
      }
    }

    return records;
  } catch {
    return [];
  }
}

function asSizePreset(value: unknown, fieldName: string): LevelSizePreset {
  if (value === "small" || value === "medium" || value === "big") {
    return value;
  }
  throw new Error(`${fieldName} must be one of: small, medium, big`);
}

function asInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return value;
}

function asNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  return value;
}

function asOptionalNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return asNumber(value, fieldName);
}

function asString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function asOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return asString(value, fieldName);
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
