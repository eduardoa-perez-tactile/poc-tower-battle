import {
  TERRAIN_EMPTY_TILE,
  cloneTerrainData,
  createEmptyTerrainData,
  type TerrainData,
} from "../types/Terrain";
import {
  cloneLevelVisualsData,
  type LevelVisualsData,
  type ResolvedTowerVisual,
  type TowerVisualOverride,
} from "../types/Visuals";

interface TowerLike {
  id: string;
}

export function parseOptionalTerrain(
  value: unknown,
  fieldName: string,
): TerrainData | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  const width = asInteger(value.width, `${fieldName}.width`);
  const height = asInteger(value.height, `${fieldName}.height`);
  const tileSize = asInteger(value.tileSize, `${fieldName}.tileSize`);
  const originX = asOptionalInteger(value.originX, `${fieldName}.originX`) ?? 0;
  const originY = asOptionalInteger(value.originY, `${fieldName}.originY`) ?? 0;

  if (width < 1 || width > 512) {
    throw new Error(`${fieldName}.width must be between 1 and 512`);
  }
  if (height < 1 || height > 512) {
    throw new Error(`${fieldName}.height must be between 1 and 512`);
  }
  if (tileSize <= 0 || tileSize > 256) {
    throw new Error(`${fieldName}.tileSize must be between 1 and 256`);
  }

  if (!isObject(value.layers)) {
    throw new Error(`${fieldName}.layers must be an object`);
  }

  const totalTiles = width * height;
  const ground = parseTerrainLayer(value.layers.ground, `${fieldName}.layers.ground`, totalTiles);
  const deco = parseTerrainLayer(value.layers.deco, `${fieldName}.layers.deco`, totalTiles);

  return {
    width,
    height,
    tileSize,
    originX,
    originY,
    layers: {
      ground,
      deco,
    },
  };
}

export function parseOptionalVisuals(
  value: unknown,
  fieldName: string,
): LevelVisualsData | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  const towerDefaults = parseTowerDefaults(value.towerDefaults, `${fieldName}.towerDefaults`);
  const towers = parseTowerVisualOverrides(value.towers, `${fieldName}.towers`);
  return {
    towerDefaults,
    towers,
  };
}

export function cloneOptionalTerrain(terrain: TerrainData | undefined): TerrainData | undefined {
  return terrain ? cloneTerrainData(terrain) : undefined;
}

export function cloneOptionalVisuals(visuals: LevelVisualsData | undefined): LevelVisualsData | undefined {
  return visuals ? cloneLevelVisualsData(visuals) : undefined;
}

export function resolveTowerVisual(
  visuals: LevelVisualsData | undefined,
  towerId: string,
): ResolvedTowerVisual | null {
  const defaults = visuals?.towerDefaults;
  const override = visuals?.towers?.[towerId];
  const spriteKey = (override?.spriteKey ?? defaults?.spriteKey ?? "").trim();
  if (!spriteKey) {
    return null;
  }

  return {
    spriteKey,
    frameIndex: Math.max(0, Math.floor(override?.frameIndex ?? defaults?.frameIndex ?? 0)),
    offsetX: override?.offsetX ?? 0,
    offsetY: override?.offsetY ?? 0,
    scale: sanitizeScale(override?.scale ?? 1),
  };
}

export function resolveTowerVisualMap(
  visuals: LevelVisualsData | undefined,
  towers: ReadonlyArray<TowerLike>,
): Record<string, ResolvedTowerVisual | null> {
  const resolved: Record<string, ResolvedTowerVisual | null> = {};
  for (const tower of towers) {
    resolved[tower.id] = resolveTowerVisual(visuals, tower.id);
  }
  return resolved;
}

export function createTerrainForLevelGrid(
  width: number,
  height: number,
  tileSize = 32,
): TerrainData {
  return createEmptyTerrainData(width, height, tileSize, 0, 0);
}

function parseTerrainLayer(value: unknown, fieldName: string, expectedLength: number): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  if (value.length !== expectedLength) {
    throw new Error(`${fieldName} must contain exactly ${expectedLength} entries`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "number" || !Number.isFinite(entry) || !Number.isInteger(entry)) {
      throw new Error(`${fieldName}[${index}] must be an integer`);
    }
    return entry >= 0 ? entry : TERRAIN_EMPTY_TILE;
  });
}

function parseTowerDefaults(value: unknown, fieldName: string): LevelVisualsData["towerDefaults"] {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  const spriteKey = asOptionalString(value.spriteKey, `${fieldName}.spriteKey`);
  const frameIndex = asOptionalInteger(value.frameIndex, `${fieldName}.frameIndex`);

  return {
    ...(spriteKey !== null ? { spriteKey } : {}),
    ...(frameIndex !== null ? { frameIndex: Math.max(0, frameIndex) } : {}),
  };
}

function parseTowerVisualOverrides(
  value: unknown,
  fieldName: string,
): Record<string, TowerVisualOverride> {
  if (value === undefined) {
    return {};
  }
  if (!isObject(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  const parsed: Record<string, TowerVisualOverride> = {};
  for (const [towerId, entry] of Object.entries(value)) {
    if (!isObject(entry)) {
      throw new Error(`${fieldName}.${towerId} must be an object`);
    }

    const spriteKey = asString(entry.spriteKey, `${fieldName}.${towerId}.spriteKey`);
    const frameIndex = Math.max(0, asInteger(entry.frameIndex, `${fieldName}.${towerId}.frameIndex`));
    const offsetX = asOptionalNumber(entry.offsetX, `${fieldName}.${towerId}.offsetX`);
    const offsetY = asOptionalNumber(entry.offsetY, `${fieldName}.${towerId}.offsetY`);
    const scale = asOptionalNumber(entry.scale, `${fieldName}.${towerId}.scale`);

    parsed[towerId] = {
      spriteKey,
      frameIndex,
      ...(offsetX !== null ? { offsetX } : {}),
      ...(offsetY !== null ? { offsetY } : {}),
      ...(scale !== null ? { scale: sanitizeScale(scale) } : {}),
    };
  }

  return parsed;
}

function sanitizeScale(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return value;
}

function asString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function asOptionalString(value: unknown, fieldName: string): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return value;
}

function asOptionalInteger(value: unknown, fieldName: string): number | null {
  if (value === undefined) {
    return null;
  }
  return asInteger(value, fieldName);
}

function asOptionalNumber(value: unknown, fieldName: string): number | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
