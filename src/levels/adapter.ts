import { parseTowerArchetype } from "../sim/DepthConfig";
import { TowerArchetype } from "../sim/DepthTypes";
import type { Tower } from "../sim/World";
import type { TerrainData } from "../types/Terrain";
import { cloneOptionalTerrain, cloneOptionalVisuals } from "./LevelVisuals";
import { createGridWorldTransform, gridBoundsWorld, gridToWorld, type ViewportSize } from "./grid";
import type { LoadedLevel } from "./runtime";
import { computeShorelineMask, normalizeShorelineMaskMap } from "./TilePalette";
import type { LevelJson, LevelNode, LevelTilePalette } from "./types";

const DEFAULT_RULES: LoadedLevel["rules"] = {
  maxOutgoingLinksPerTower: 1,
  sendRatePerSec: 6,
  collisionDistancePx: 14,
  captureSeedTroops: 10,
  captureRateMultiplier: 1,
  playerCaptureEfficiencyMul: 1,
  regenMinPerSec: 0,
  regenMaxPerSec: 8,
  playerRegenMultiplier: 1,
  enemyRegenMultiplier: 1,
  defaultPacketArmor: 1,
  playerPacketArmorAdd: 0,
  playerPacketArmorMul: 1,
  linkDecayPerSec: 0,
  linkDecayCanBreak: false,
  packetStatCaps: {
    speedMin: 25,
    speedMax: 420,
    damageMin: 0.2,
    damageMax: 14,
    hpMin: 0.2,
    hpMax: 220,
    armorMin: 0.2,
    armorMax: 4,
  },
  fightModel: {
    shieldArmorUptimeMultiplier: 1.8,
    combatHoldFactor: 0.45,
    rangedHoldFactor: 0.65,
    linkCutterHoldFactor: 0.4,
  },
  defaultUnit: {
    speedPxPerSec: 120,
    dpsPerUnit: 1,
    hpPerUnit: 1,
  },
};

const DEFAULT_AI: LoadedLevel["ai"] = {
  aiThinkIntervalSec: 2.5,
  aiMinTroopsToAttack: 25,
};
const DEFAULT_TOWER_VISION = 170;
const TERRAIN_TILE_SIZE = 32;
const TILE_EMPTY = -1;
const TILE_GRASS_PRIMARY = 324;
const TILE_GRASS_ALT_A = 323;
const TILE_GRASS_ALT_B = 325;
const ROAD_TILE_VARIANTS = [432, 433, 434, 450, 451] as const;
const WATER_TILE_VARIANTS = [396, 397, 398, 399] as const;
const TILE_SHORE_NORTH = 414;
const TILE_SHORE_SOUTH = 384;
const TILE_SHORE_WEST = 278;
const TILE_SHORE_EAST = 288;
const TILE_SHORE_CORNER_NW = 429;
const TILE_SHORE_CORNER_NE = TILE_SHORE_NORTH;
const TILE_SHORE_CORNER_SW = TILE_SHORE_SOUTH;
const TILE_SHORE_CORNER_SE = 373;
const TILE_FLOWER = 74;

interface BuildRuntimeLevelOptions {
  viewport: ViewportSize;
}

export function buildRuntimeLevelFromLevel(
  level: LevelJson,
  options: BuildRuntimeLevelOptions,
): LoadedLevel {
  const transform = createGridWorldTransform(level.grid, options.viewport);
  const worldBounds = gridBoundsWorld(transform);
  const nodesById = new Map<string, LevelNode>();

  const towers: Tower[] = level.nodes.map((node) => {
    nodesById.set(node.id, node);
    const world = gridToWorld(node.x, node.y, transform);
    const defaults = getNodeDefaults(node);

    const maxTroops = sanitizePositive(node.cap ?? defaults.maxTroops, defaults.maxTroops);
    const regenRate = sanitizePositive(node.regen ?? defaults.regenRate, defaults.regenRate);
    const maxHp = sanitizePositive(node.maxHp ?? defaults.maxHp, defaults.maxHp);
    const hp = sanitizePositive(node.hp ?? maxHp, maxHp);
    const troops = sanitizePositive(node.troops ?? defaults.troops, defaults.troops);

    const archetype = parseTowerArchetype(
      node.archetype,
      node.type === "stronghold" ? TowerArchetype.STRONGHOLD : TowerArchetype.BARRACKS,
    );

    return {
      id: node.id,
      x: world.x,
      y: world.y,
      owner: node.owner,
      maxHp,
      hp: Math.min(maxHp, hp),
      troops: Math.min(maxTroops, troops),
      maxTroops,
      regenRate,
      baseRegen: regenRate,
      effectiveRegen: regenRate,
      baseVision: DEFAULT_TOWER_VISION,
      effectiveVision: DEFAULT_TOWER_VISION,
      territoryClusterSize: 0,
      territoryRegenBonusPct: 0,
      territoryArmorBonusPct: 0,
      territoryVisionBonusPct: 0,
      baseMaxTroops: maxTroops,
      baseRegenRate: regenRate,
      archetype,
      defenseMultiplier: 1,
      packetDamageMultiplier: 1,
      linkSpeedBonus: 0,
      extraOutgoingLinks: 0,
      auraRadius: 0,
      auraRegenBonusPct: 0,
      captureSpeedTakenMultiplier: 1,
      goldPerSecond: 0,
      recaptureBonusGold: 0,
      archetypeIcon: "",
    };
  });

  const towersById = new Map<string, Tower>();
  for (const tower of towers) {
    towersById.set(tower.id, tower);
  }

  // Graph edges are level topology data and map visuals; runtime links still start empty
  // so existing link mechanics and AI behavior are preserved.
  const initialLinks: LoadedLevel["initialLinks"] = [];

  const runtimeRules = level.runtime?.rules;
  const runtimeAi = level.runtime?.ai;
  const mergedRules = {
    ...DEFAULT_RULES,
    ...(runtimeRules?.maxOutgoingLinksPerTower !== undefined
      ? { maxOutgoingLinksPerTower: runtimeRules.maxOutgoingLinksPerTower }
      : {}),
    ...(runtimeRules?.sendRatePerSec !== undefined
      ? { sendRatePerSec: runtimeRules.sendRatePerSec }
      : {}),
    ...(runtimeRules?.collisionDistancePx !== undefined
      ? { collisionDistancePx: runtimeRules.collisionDistancePx }
      : {}),
    ...(runtimeRules?.captureSeedTroops !== undefined
      ? { captureSeedTroops: runtimeRules.captureSeedTroops }
      : {}),
    defaultUnit: {
      ...DEFAULT_RULES.defaultUnit,
      ...(runtimeRules?.defaultUnit?.speedPxPerSec !== undefined
        ? { speedPxPerSec: runtimeRules.defaultUnit.speedPxPerSec }
        : {}),
      ...(runtimeRules?.defaultUnit?.dpsPerUnit !== undefined
        ? { dpsPerUnit: runtimeRules.defaultUnit.dpsPerUnit }
        : {}),
      ...(runtimeRules?.defaultUnit?.hpPerUnit !== undefined
        ? { hpPerUnit: runtimeRules.defaultUnit.hpPerUnit }
        : {}),
    },
  };
  const mergedAi = {
    ...DEFAULT_AI,
    ...(runtimeAi?.aiThinkIntervalSec !== undefined
      ? { aiThinkIntervalSec: runtimeAi.aiThinkIntervalSec }
      : {}),
    ...(runtimeAi?.aiMinTroopsToAttack !== undefined
      ? { aiMinTroopsToAttack: runtimeAi.aiMinTroopsToAttack }
      : {}),
  };

  const renderNodes = towers.map((tower) => ({ id: tower.id, x: tower.x, y: tower.y }));
  const graphEdges = level.edges
    .map((edge) => {
      const from = towersById.get(edge.from);
      const to = towersById.get(edge.to);
      if (!from || !to) {
        return null;
      }
      return {
        fromTowerId: from.id,
        toTowerId: to.id,
      };
    })
    .filter((edge): edge is { fromTowerId: string; toTowerId: string } => edge !== null);

  const renderEdges = graphEdges
    .map((edge) => {
      const from = towersById.get(edge.fromTowerId);
      const to = towersById.get(edge.toTowerId);
      if (!from || !to) {
        return null;
      }
      return {
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
      };
    })
    .filter((edge): edge is { fromX: number; fromY: number; toX: number; toY: number } => edge !== null);

  return {
    towers,
    initialLinks,
    rules: mergedRules,
    ai: mergedAi,
    graphEdges,
    mapRenderData: {
      gridWidth: level.grid.width,
      gridHeight: level.grid.height,
      cellSize: transform.cellSize,
      originX: transform.originX,
      originY: transform.originY,
      bounds: worldBounds,
      nodes: renderNodes,
      edges: renderEdges,
    },
    terrain: projectTerrainToWorld(
      resolveRuntimeTerrain(level),
      transform.cellSize,
      worldBounds.minX,
      worldBounds.minY,
    ),
    visuals: cloneOptionalVisuals(level.visuals),
  };
}

function resolveRuntimeTerrain(level: LevelJson): TerrainData | undefined {
  const terrain = cloneOptionalTerrain(level.terrain);
  if (terrain) {
    return terrain;
  }
  if (!level.tilePalette) {
    return undefined;
  }
  return buildTerrainFromGrid(level);
}

function projectTerrainToWorld(
  terrain: LoadedLevel["terrain"],
  worldCellSize: number,
  worldOriginX: number,
  worldOriginY: number,
): LoadedLevel["terrain"] {
  if (!terrain) {
    return undefined;
  }

  const sourceTileSize = Math.max(1, terrain.tileSize);
  const scale = worldCellSize / sourceTileSize;
  return {
    ...terrain,
    tileSize: sourceTileSize * scale,
    originX: worldOriginX + terrain.originX * scale,
    originY: worldOriginY + terrain.originY * scale,
    layers: {
      ground: terrain.layers.ground.slice(),
      deco: terrain.layers.deco.slice(),
    },
  };
}

function buildTerrainFromGrid(level: LevelJson): TerrainData {
  const width = Math.max(1, Math.floor(level.grid.width));
  const height = Math.max(1, Math.floor(level.grid.height));
  const total = width * height;
  const groundType = new Array<"grass" | "dirt" | "water">(total).fill(level.grid.layers.ground.default);
  const roadMask = new Array<boolean>(total).fill(false);
  const ground = new Array<number>(total).fill(TILE_GRASS_PRIMARY);
  const deco = new Array<number>(total).fill(TILE_EMPTY);
  const nodeById = new Map(level.nodes.map((node) => [node.id, node] as const));
  const shorelineMaskOverrides = normalizeShorelineMaskMap(level.tilePalette?.shoreline?.maskToTileIndex);
  const seed = hashSeed(`${level.stageId}:${level.levelId}`);

  for (const override of level.grid.layers.ground.overrides) {
    if (override.x < 0 || override.y < 0 || override.x >= width || override.y >= height) {
      continue;
    }
    groundType[override.y * width + override.x] = override.tile;
  }

  for (const edge of level.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) {
      continue;
    }
    stampLineCells(from.x, from.y, to.x, to.y, (x, y) => {
      paintDisk(roadMask, width, height, x, y, 0, true);
    });
  }

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      const type = groundType[index];
      if (type === "water") {
        const waterBaseOverride = normalizeTileIndex(level.tilePalette?.waterBase);
        ground[index] = waterBaseOverride ?? pickVariant(WATER_TILE_VARIANTS, col, row, seed ^ 0x5bf03635);
        continue;
      }
      if (type === "dirt" || roadMask[index]) {
        const roadOverrideTile = resolveRoadTileOverride(col, row, width, height, roadMask, level.tilePalette?.road);
        ground[index] = roadOverrideTile ?? pickVariant(ROAD_TILE_VARIANTS, col, row, seed ^ 0xc2b2ae35);
        continue;
      }
      const grassBaseOverride = normalizeTileIndex(level.tilePalette?.grassBase);
      if (grassBaseOverride !== null) {
        ground[index] = grassBaseOverride;
      } else {
        const noise = hash2d(col, row, seed);
        if (noise % 11 === 0) {
          ground[index] = TILE_GRASS_ALT_A;
        } else if (noise % 17 === 0) {
          ground[index] = TILE_GRASS_ALT_B;
        } else {
          ground[index] = TILE_GRASS_PRIMARY;
        }
      }
    }
  }

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      if (groundType[index] === "water") {
        continue;
      }

      const northWater = isWaterCell(groundType, width, height, col, row - 1);
      const southWater = isWaterCell(groundType, width, height, col, row + 1);
      const westWater = isWaterCell(groundType, width, height, col - 1, row);
      const eastWater = isWaterCell(groundType, width, height, col + 1, row);
      const hasWaterNeighbor = northWater || southWater || westWater || eastWater;
      if (!hasWaterNeighbor) {
        continue;
      }

      const shorelineOverrideTile = resolveShorelineOverrideTile(
        northWater,
        southWater,
        westWater,
        eastWater,
        shorelineMaskOverrides,
        level.tilePalette?.shoreline,
      );
      if (shorelineOverrideTile !== null) {
        ground[index] = shorelineOverrideTile;
        continue;
      }

      const waterSides = Number(northWater) + Number(southWater) + Number(westWater) + Number(eastWater);
      if (waterSides === 1) {
        if (northWater) {
          ground[index] = TILE_SHORE_NORTH;
        } else if (southWater) {
          ground[index] = TILE_SHORE_SOUTH;
        } else if (westWater) {
          ground[index] = TILE_SHORE_WEST;
        } else {
          ground[index] = TILE_SHORE_EAST;
        }
        continue;
      }
      if (northWater && westWater && !eastWater && !southWater) {
        ground[index] = TILE_SHORE_CORNER_NW;
      } else if (northWater && eastWater && !westWater && !southWater) {
        ground[index] = TILE_SHORE_CORNER_NE;
      } else if (southWater && westWater && !northWater && !eastWater) {
        ground[index] = TILE_SHORE_CORNER_SW;
      } else if (southWater && eastWater && !northWater && !westWater) {
        ground[index] = TILE_SHORE_CORNER_SE;
      }
    }
  }

  for (const override of level.grid.layers.decor.overrides) {
    if (override.x < 0 || override.y < 0 || override.x >= width || override.y >= height) {
      continue;
    }
    const index = override.y * width + override.x;
    if (override.tile === "flower") {
      deco[index] = TILE_FLOWER;
    } else {
      deco[index] = TILE_EMPTY;
    }
  }

  return {
    width,
    height,
    tileSize: TERRAIN_TILE_SIZE,
    originX: 0,
    originY: 0,
    layers: {
      ground,
      deco,
    },
  };
}

function isWaterCell(
  groundType: readonly ("grass" | "dirt" | "water")[],
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return true;
  }
  return groundType[y * width + x] === "water";
}

type RoadShape = "straight" | "corner" | "t" | "cross";

function resolveRoadTileOverride(
  col: number,
  row: number,
  width: number,
  height: number,
  roadMask: readonly boolean[],
  roadPalette: LevelTilePalette["road"] | undefined,
): number | null {
  if (!roadPalette) {
    return null;
  }

  const north = row > 0 ? roadMask[(row - 1) * width + col] : false;
  const south = row < height - 1 ? roadMask[(row + 1) * width + col] : false;
  const west = col > 0 ? roadMask[row * width + (col - 1)] : false;
  const east = col < width - 1 ? roadMask[row * width + (col + 1)] : false;
  const connectionCount = Number(north) + Number(south) + Number(west) + Number(east);

  const shape: RoadShape = connectionCount >= 4
    ? "cross"
    : connectionCount === 3
    ? "t"
    : connectionCount === 2
    ? (north && south) || (west && east)
      ? "straight"
      : "corner"
    : "straight";

  const requested = shape === "straight"
    ? roadPalette.straight
    : shape === "corner"
    ? roadPalette.corner
    : shape === "t"
    ? roadPalette.t
    : roadPalette.cross;

  return normalizeTileIndex(requested);
}

function resolveShorelineOverrideTile(
  northWater: boolean,
  southWater: boolean,
  westWater: boolean,
  eastWater: boolean,
  shorelineMaskOverrides: ReadonlyMap<number, number>,
  shorelinePalette: LevelTilePalette["shoreline"] | undefined,
): number | null {
  const mask = computeShorelineMask(northWater, southWater, westWater, eastWater);
  const fromMask = shorelineMaskOverrides.get(mask);
  if (fromMask !== undefined) {
    return fromMask;
  }
  if (!shorelinePalette) {
    return null;
  }

  const waterSides = Number(northWater) + Number(southWater) + Number(westWater) + Number(eastWater);
  if (waterSides === 1) {
    if (northWater) {
      return normalizeTileIndex(shorelinePalette.north);
    }
    if (southWater) {
      return normalizeTileIndex(shorelinePalette.south);
    }
    if (westWater) {
      return normalizeTileIndex(shorelinePalette.west);
    }
    return normalizeTileIndex(shorelinePalette.east);
  }

  if (northWater && westWater && !eastWater && !southWater) {
    return normalizeTileIndex(shorelinePalette.nw);
  }
  if (northWater && eastWater && !westWater && !southWater) {
    return normalizeTileIndex(shorelinePalette.ne);
  }
  if (southWater && westWater && !northWater && !eastWater) {
    return normalizeTileIndex(shorelinePalette.sw);
  }
  if (southWater && eastWater && !northWater && !westWater) {
    return normalizeTileIndex(shorelinePalette.se);
  }
  if (northWater) {
    return normalizeTileIndex(shorelinePalette.north);
  }
  if (southWater) {
    return normalizeTileIndex(shorelinePalette.south);
  }
  if (westWater) {
    return normalizeTileIndex(shorelinePalette.west);
  }
  if (eastWater) {
    return normalizeTileIndex(shorelinePalette.east);
  }
  return null;
}

function stampLineCells(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (x: number, y: number) => void,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) {
    visit(x0, y0);
    return;
  }
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    visit(Math.round(x0 + dx * t), Math.round(y0 + dy * t));
  }
}

function paintDisk(
  layer: boolean[],
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  value: boolean,
): void {
  const clampedRadius = Math.max(0, Math.floor(radius));
  const radiusSq = clampedRadius * clampedRadius;
  for (let dy = -clampedRadius; dy <= clampedRadius; dy += 1) {
    for (let dx = -clampedRadius; dx <= clampedRadius; dx += 1) {
      if (dx * dx + dy * dy > radiusSq) {
        continue;
      }
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) {
        continue;
      }
      layer[y * width + x] = value;
    }
  }
}

function pickVariant(tiles: readonly number[], col: number, row: number, seed: number): number {
  const variant = hash2d(col, row, seed) % tiles.length;
  return tiles[variant];
}

function hash2d(x: number, y: number, seed: number): number {
  let value = (x * 73856093) ^ (y * 19349663) ^ seed;
  value = Math.imul(value ^ (value >>> 16), 2246822507);
  value = Math.imul(value ^ (value >>> 13), 3266489909);
  return (value ^ (value >>> 16)) >>> 0;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeTileIndex(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function getNodeDefaults(node: LevelNode): {
  maxTroops: number;
  regenRate: number;
  maxHp: number;
  troops: number;
} {
  if (node.type === "stronghold") {
    return {
      maxTroops: 120,
      regenRate: 3,
      maxHp: 60,
      troops: node.owner === "player" ? 40 : 32,
    };
  }

  if (node.owner !== "player" && node.owner !== "neutral") {
    return {
      maxTroops: 90,
      regenRate: 2,
      maxHp: 50,
      troops: 20,
    };
  }

  if (node.owner === "player") {
    return {
      maxTroops: 90,
      regenRate: 2,
      maxHp: 50,
      troops: 20,
    };
  }

  return {
    maxTroops: 70,
    regenRate: 1,
    maxHp: 40,
    troops: 15,
  };
}

function sanitizePositive(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}
