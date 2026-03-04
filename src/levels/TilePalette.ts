import type { LevelTilePalette, TilePaletteRoad, TilePaletteShoreline } from "./types";

export interface TilePaletteValidationIssue {
  fieldPath: string;
  message: string;
}

export const SHORELINE_MASK_NORTH = 1;
export const SHORELINE_MASK_SOUTH = 2;
export const SHORELINE_MASK_WEST = 4;
export const SHORELINE_MASK_EAST = 8;

export const REQUIRED_SHORELINE_MASK_KEYS = ["1", "2", "4", "8", "5", "9", "6", "10"] as const;

export function parseOptionalTilePalette(
  value: unknown,
  fieldName: string,
): LevelTilePalette | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  const parsed: LevelTilePalette = {};
  const waterBase = asOptionalTileIndex(value.waterBase, `${fieldName}.waterBase`);
  const grassBase = asOptionalTileIndex(value.grassBase, `${fieldName}.grassBase`);
  const road = parseOptionalRoad(value.road, `${fieldName}.road`);
  const shoreline = parseOptionalShoreline(value.shoreline, `${fieldName}.shoreline`);

  if (waterBase !== null) {
    parsed.waterBase = waterBase;
  }
  if (grassBase !== null) {
    parsed.grassBase = grassBase;
  }
  if (road !== null) {
    parsed.road = road;
  }
  if (shoreline !== null) {
    parsed.shoreline = shoreline;
  }

  return parsed;
}

export function cloneTilePalette(palette: LevelTilePalette | undefined): LevelTilePalette | undefined {
  if (!palette) {
    return undefined;
  }
  return {
    ...(palette.waterBase !== undefined ? { waterBase: palette.waterBase } : {}),
    ...(palette.grassBase !== undefined ? { grassBase: palette.grassBase } : {}),
    ...(palette.road
      ? {
          road: {
            ...(palette.road.straight !== undefined ? { straight: palette.road.straight } : {}),
            ...(palette.road.corner !== undefined ? { corner: palette.road.corner } : {}),
            ...(palette.road.t !== undefined ? { t: palette.road.t } : {}),
            ...(palette.road.cross !== undefined ? { cross: palette.road.cross } : {}),
          },
        }
      : {}),
    ...(palette.shoreline
      ? {
          shoreline: {
            ...(palette.shoreline.maskToTileIndex
              ? { maskToTileIndex: { ...palette.shoreline.maskToTileIndex } }
              : {}),
            ...(palette.shoreline.north !== undefined ? { north: palette.shoreline.north } : {}),
            ...(palette.shoreline.south !== undefined ? { south: palette.shoreline.south } : {}),
            ...(palette.shoreline.east !== undefined ? { east: palette.shoreline.east } : {}),
            ...(palette.shoreline.west !== undefined ? { west: palette.shoreline.west } : {}),
            ...(palette.shoreline.ne !== undefined ? { ne: palette.shoreline.ne } : {}),
            ...(palette.shoreline.nw !== undefined ? { nw: palette.shoreline.nw } : {}),
            ...(palette.shoreline.se !== undefined ? { se: palette.shoreline.se } : {}),
            ...(palette.shoreline.sw !== undefined ? { sw: palette.shoreline.sw } : {}),
          },
        }
      : {}),
  };
}

export function computeShorelineMask(
  northWater: boolean,
  southWater: boolean,
  westWater: boolean,
  eastWater: boolean,
): number {
  return (northWater ? SHORELINE_MASK_NORTH : 0) +
    (southWater ? SHORELINE_MASK_SOUTH : 0) +
    (westWater ? SHORELINE_MASK_WEST : 0) +
    (eastWater ? SHORELINE_MASK_EAST : 0);
}

export function parseShorelineMaskKey(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/^[01]{4,8}$/.test(trimmed)) {
    return Number.parseInt(trimmed, 2);
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

export function normalizeShorelineMaskMap(
  rawMaskMap: Record<string, number> | undefined,
): Map<number, number> {
  const normalized = new Map<number, number>();
  if (!rawMaskMap) {
    return normalized;
  }
  for (const [key, tileIndex] of Object.entries(rawMaskMap)) {
    const parsedMask = parseShorelineMaskKey(key);
    if (parsedMask === null || !isValidTileIndex(tileIndex)) {
      continue;
    }
    normalized.set(parsedMask, tileIndex);
  }
  return normalized;
}

export function hasTilePaletteOverrides(palette: LevelTilePalette | undefined): boolean {
  if (!palette) {
    return false;
  }
  if (isValidTileIndex(palette.waterBase) || isValidTileIndex(palette.grassBase)) {
    return true;
  }
  if (hasRoadOverrides(palette.road)) {
    return true;
  }
  if (hasShorelineOverrides(palette.shoreline)) {
    return true;
  }
  return false;
}

export function validateTilePaletteWhenEnabled(
  palette: LevelTilePalette | undefined,
): TilePaletteValidationIssue[] {
  const issues: TilePaletteValidationIssue[] = [];
  const target = palette ?? {};

  if (!isValidTileIndex(target.waterBase)) {
    issues.push({
      fieldPath: "tilePalette.waterBase",
      message: "waterBase is required and must be a non-negative integer tile index.",
    });
  }
  if (!isValidTileIndex(target.grassBase)) {
    issues.push({
      fieldPath: "tilePalette.grassBase",
      message: "grassBase is required and must be a non-negative integer tile index.",
    });
  }

  const road = target.road ?? {};
  if (!isValidTileIndex(road.straight)) {
    issues.push({
      fieldPath: "tilePalette.road.straight",
      message: "road.straight is required and must be a non-negative integer tile index.",
    });
  }
  if (!isValidTileIndex(road.corner)) {
    issues.push({
      fieldPath: "tilePalette.road.corner",
      message: "road.corner is required and must be a non-negative integer tile index.",
    });
  }

  const shoreline = target.shoreline ?? {};
  if (shoreline.maskToTileIndex !== undefined) {
    for (const key of REQUIRED_SHORELINE_MASK_KEYS) {
      if (!isValidTileIndex(shoreline.maskToTileIndex[key])) {
        issues.push({
          fieldPath: `tilePalette.shoreline.maskToTileIndex.${key}`,
          message: `Missing shoreline mask mapping for key ${key}.`,
        });
      }
    }
    return issues;
  }

  const requiredDirectional: ReadonlyArray<{
    key: keyof TilePaletteShoreline;
    label: string;
  }> = [
    { key: "north", label: "north" },
    { key: "south", label: "south" },
    { key: "east", label: "east" },
    { key: "west", label: "west" },
    { key: "ne", label: "ne" },
    { key: "nw", label: "nw" },
    { key: "se", label: "se" },
    { key: "sw", label: "sw" },
  ];

  for (const requirement of requiredDirectional) {
    if (!isValidTileIndex(shoreline[requirement.key])) {
      issues.push({
        fieldPath: `tilePalette.shoreline.${requirement.label}`,
        message: `shoreline.${requirement.label} is required when maskToTileIndex is omitted.`,
      });
    }
  }

  return issues;
}

function parseOptionalRoad(value: unknown, fieldName: string): TilePaletteRoad | null {
  if (value === undefined) {
    return null;
  }
  if (!isObject(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  const straight = asOptionalTileIndex(value.straight, `${fieldName}.straight`);
  const corner = asOptionalTileIndex(value.corner, `${fieldName}.corner`);
  const tee = asOptionalTileIndex(value.t, `${fieldName}.t`);
  const cross = asOptionalTileIndex(value.cross, `${fieldName}.cross`);
  const parsed: TilePaletteRoad = {};
  if (straight !== null) {
    parsed.straight = straight;
  }
  if (corner !== null) {
    parsed.corner = corner;
  }
  if (tee !== null) {
    parsed.t = tee;
  }
  if (cross !== null) {
    parsed.cross = cross;
  }
  return parsed;
}

function parseOptionalShoreline(value: unknown, fieldName: string): TilePaletteShoreline | null {
  if (value === undefined) {
    return null;
  }
  if (!isObject(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  const parsed: TilePaletteShoreline = {};
  const maskMap = parseOptionalMaskMap(value.maskToTileIndex, `${fieldName}.maskToTileIndex`);
  const north = asOptionalTileIndex(value.north, `${fieldName}.north`);
  const south = asOptionalTileIndex(value.south, `${fieldName}.south`);
  const east = asOptionalTileIndex(value.east, `${fieldName}.east`);
  const west = asOptionalTileIndex(value.west, `${fieldName}.west`);
  const ne = asOptionalTileIndex(value.ne, `${fieldName}.ne`);
  const nw = asOptionalTileIndex(value.nw, `${fieldName}.nw`);
  const se = asOptionalTileIndex(value.se, `${fieldName}.se`);
  const sw = asOptionalTileIndex(value.sw, `${fieldName}.sw`);

  if (maskMap !== null) {
    parsed.maskToTileIndex = maskMap;
  }
  if (north !== null) {
    parsed.north = north;
  }
  if (south !== null) {
    parsed.south = south;
  }
  if (east !== null) {
    parsed.east = east;
  }
  if (west !== null) {
    parsed.west = west;
  }
  if (ne !== null) {
    parsed.ne = ne;
  }
  if (nw !== null) {
    parsed.nw = nw;
  }
  if (se !== null) {
    parsed.se = se;
  }
  if (sw !== null) {
    parsed.sw = sw;
  }

  return parsed;
}

function parseOptionalMaskMap(value: unknown, fieldName: string): Record<string, number> | null {
  if (value === undefined) {
    return null;
  }
  if (!isObject(value)) {
    throw new Error(`${fieldName} must be an object`);
  }

  const parsed: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    parsed[key] = asTileIndex(entry, `${fieldName}.${key}`);
  }
  return parsed;
}

function asOptionalTileIndex(value: unknown, fieldName: string): number | null {
  if (value === undefined) {
    return null;
  }
  return asTileIndex(value, fieldName);
}

function asTileIndex(value: unknown, fieldName: string): number {
  if (!isValidTileIndex(value)) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return value;
}

function hasRoadOverrides(road: TilePaletteRoad | undefined): boolean {
  if (!road) {
    return false;
  }
  return isValidTileIndex(road.straight) ||
    isValidTileIndex(road.corner) ||
    isValidTileIndex(road.t) ||
    isValidTileIndex(road.cross);
}

function hasShorelineOverrides(shoreline: TilePaletteShoreline | undefined): boolean {
  if (!shoreline) {
    return false;
  }
  if (normalizeShorelineMaskMap(shoreline.maskToTileIndex).size > 0) {
    return true;
  }
  return isValidTileIndex(shoreline.north) ||
    isValidTileIndex(shoreline.south) ||
    isValidTileIndex(shoreline.east) ||
    isValidTileIndex(shoreline.west) ||
    isValidTileIndex(shoreline.ne) ||
    isValidTileIndex(shoreline.nw) ||
    isValidTileIndex(shoreline.se) ||
    isValidTileIndex(shoreline.sw);
}

function isValidTileIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
