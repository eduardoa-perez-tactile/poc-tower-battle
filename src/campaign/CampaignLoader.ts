/*
 * Patch Notes (2026-02-24):
 * - Added loader that converts campaign_v2 + map_tXX data into StageRegistryEntry runtime levels.
 * - Added resolved mission metadata (difficulty mapping, allowlists, hints, wave presets).
 */

import { cloneTilePalette, computeShorelineMask, hasTilePaletteOverrides, normalizeShorelineMaskMap } from "../levels/TilePalette";
import type { LevelTilePalette } from "../levels/types";
import type { LevelJson, LevelNode, LevelSizePreset, LevelSourceEntry, StageRegistryEntry } from "../levels/types";
import type {
  CampaignMapDefinition,
  CampaignMissionRuntimeMeta,
  CampaignSpecV2,
  CampaignWavePreset,
  CampaignWavePresetCatalog,
  ResolvedCampaignWavePlan,
} from "./CampaignTypes";
import { validateCampaignMissionMeta, validateCampaignSpec } from "./CampaignValidator";

const TERRAIN_TILE_SIZE = 32;
const TILE_EMPTY = -1;
const TILE_GRASS_PRIMARY = 324;
const TILE_GRASS_ALT_A = 323;
const TILE_GRASS_ALT_B = 325;
const GRASS_TILE_VARIANTS = [TILE_GRASS_PRIMARY, TILE_GRASS_ALT_A, TILE_GRASS_ALT_B] as const;
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
const NEUTRAL_SPRITE_CYCLE = [
  "barracks",
  "guard_tower",
  "scout_tower",
  "foundry",
  "gnomish_inventor",
  "stables",
  "mage_tower",
] as const;

export interface CampaignRegistryV2 {
  stages: StageRegistryEntry[];
  missionMetaByKey: Record<string, CampaignMissionRuntimeMeta>;
  campaign: CampaignSpecV2;
}

export async function loadCampaignRegistryV2(
  campaignPath = "/data/campaign/campaign_v2.json",
  wavePresetPath = "/data/waves/presets.json",
): Promise<CampaignRegistryV2> {
  const [campaign, wavePresets] = await Promise.all([
    fetchJson<CampaignSpecV2>(campaignPath),
    fetchJson<CampaignWavePresetCatalog>(wavePresetPath),
  ]);

  const mapIds = campaign.stages.flatMap((stage) => stage.levels.map((level) => level.mapId));
  const uniqueMapIds = [...new Set(mapIds)];
  const mapEntries = await Promise.all(
    uniqueMapIds.map(async (mapId) => {
      const map = await fetchJson<CampaignMapDefinition>(`/levels/v2/${mapId}.json`);
      return [mapId, map] as const;
    }),
  );
  const mapById = new Map<string, CampaignMapDefinition>(mapEntries);

  const validation = validateCampaignSpec(campaign, wavePresets, mapById);
  if (!validation.valid) {
    const report = validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
    throw new Error(`campaign_v2 validation failed:\n${report}`);
  }

  const missionMetaByKey: Record<string, CampaignMissionRuntimeMeta> = {};
  const stages: StageRegistryEntry[] = [];

  for (let stageIndex = 0; stageIndex < campaign.stages.length; stageIndex += 1) {
    const stage = campaign.stages[stageIndex];
    const levels: LevelSourceEntry[] = [];

    for (const level of stage.levels) {
      const map = mapById.get(level.mapId);
      if (!map) {
        throw new Error(`Map ${level.mapId} missing for ${stage.id}/${level.id}.`);
      }

      const resolvedWavePlan = resolveWavePlan(level.wavePlan, wavePresets.presets[level.wavePlan.preset]);
      const missionId = "m01";
      const levelJson = buildLevelJsonFromCampaignMap(
        stage.id,
        level.id,
        level.displayName,
        level.objectivesText,
        map,
        resolvedWavePlan,
        missionId,
        level.tutorialId,
        stage.tilePalette ?? level.tilePalette,
      );

      levels.push({
        source: "bundled",
        path: `/levels/v2/${level.mapId}.json`,
        level: levelJson,
      });

      const missionKey = toMissionKey(stage.id, level.id, missionId);
      missionMetaByKey[missionKey] = {
        stageId: stage.id,
        levelId: level.id,
        missionId,
        tutorialId: level.tutorialId,
        dynamic: level.dynamic,
        teaches: [...level.teaches],
        reinforces: [...level.reinforces],
        hints: level.hints.map((hint) => ({ ...hint })),
        archetypeAllowlist: [...new Set(level.archetypeAllowlist)],
        difficulty: { ...level.difficulty },
        wavePlan: resolvedWavePlan,
        mapId: level.mapId,
      };
    }

    stages.push({
      stageId: stage.id,
      name: stage.displayName,
      order: stageIndex + 1,
      source: "bundled",
      levels,
    });
  }

  const metaValidation = validateCampaignMissionMeta(missionMetaByKey);
  if (!metaValidation.valid) {
    const report = metaValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
    throw new Error(`campaign mission metadata validation failed:\n${report}`);
  }

  return {
    stages,
    missionMetaByKey,
    campaign,
  };
}

export function buildLevelJsonFromCampaignMap(
  stageId: string,
  levelId: string,
  displayName: string,
  objectiveText: string,
  map: CampaignMapDefinition,
  wavePlan: ResolvedCampaignWavePlan,
  missionId: string,
  tutorialId?: string,
  tilePalette?: LevelTilePalette,
): LevelJson {
  const nodeCount = map.nodes.length;
  const sizePreset: LevelSizePreset = nodeCount <= 12 ? "small" : nodeCount <= 18 ? "medium" : "big";
  const width = Math.max(8, Math.floor(map.size.w));
  const height = Math.max(8, Math.floor(map.size.h));

  const playerAnchor = map.nodes.find((node) => node.owner === "player")?.id ?? "p_start";
  const enemyAnchor = map.nodes.find((node) => node.owner === "enemy")?.id ?? "e_start";

  const nodes: LevelNode[] = map.nodes.map((node) => {
    const isStronghold = node.id === playerAnchor || node.id === enemyAnchor;
    return {
      id: node.id,
      x: Math.max(0, Math.min(width - 1, Math.round(node.x))),
      y: Math.max(0, Math.min(height - 1, Math.round(node.y))),
      type: isStronghold ? "stronghold" : "tower",
      owner: node.owner,
      regen: node.regen,
      cap: node.cap,
      troops: defaultTroops(node.owner, isStronghold),
    };
  });

  const edges = map.links.map((link) => ({ from: link.a, to: link.b }));

  return {
    version: 1,
    stageId,
    levelId,
    name: displayName,
    size: sizePreset,
    grid: {
      width,
      height,
      minCellSize: 38,
      layers: {
        ground: {
          default: "grass",
          overrides: [],
        },
        decor: {
          overrides: [],
        },
        blocked: [],
      },
    },
    nodes,
    edges,
    missions: [
      {
        missionId,
        name: displayName,
        seed: hashSeed(`${stageId}:${levelId}:${map.id}`),
        waveSetId: wavePlan.preset,
        objectiveText,
        difficulty: wavePlan.missionDifficultyScalar,
        ...(tutorialId ? { tutorialId } : {}),
      },
    ],
    runtime: {
      rules: {
        maxOutgoingLinksPerTower: map.tags.linkDensity >= 1.15 ? 2 : 1,
        sendRatePerSec: 6,
        collisionDistancePx: 14,
        captureSeedTroops: 10,
        defaultUnit: {
          speedPxPerSec: map.tags.lanes <= 1 ? 116 : 122,
          dpsPerUnit: 1,
          hpPerUnit: 1,
        },
      },
      ai: {
        aiThinkIntervalSec: 2.4,
        aiMinTroopsToAttack: 24,
      },
    },
    terrain: createCampaignTerrain(map, tilePalette),
    visuals: createCampaignVisuals(map, playerAnchor, enemyAnchor),
    ...(tilePalette ? { tilePalette: cloneTilePalette(tilePalette) } : {}),
  };
}

function resolveWavePlan(
  wavePlanRef: {
    preset: string;
    waves?: number;
    firstAppearanceWave?: number;
    minibossWave?: number;
    bossEnabled?: boolean;
  },
  preset: CampaignWavePreset,
): ResolvedCampaignWavePlan {
  return {
    preset: wavePlanRef.preset,
    waves: clampInt(wavePlanRef.waves ?? preset.waves, 0, 12),
    missionDifficultyScalar: clamp(preset.missionDifficultyScalar, 0.6, 2),
    firstAppearanceWave: clampInt(wavePlanRef.firstAppearanceWave ?? preset.firstAppearanceWave ?? 1, 1, 12),
    minibossWave:
      wavePlanRef.minibossWave ??
      preset.minibossWave,
    bossEnabled: wavePlanRef.bossEnabled ?? preset.bossEnabled ?? false,
  };
}

function defaultTroops(owner: "player" | "enemy" | "neutral", stronghold: boolean): number {
  if (owner === "player") {
    return stronghold ? 42 : 24;
  }
  if (owner === "enemy") {
    return stronghold ? 34 : 22;
  }
  return 16;
}

function toMissionKey(stageId: string, levelId: string, missionId: string): string {
  return `${stageId}:${levelId}:${missionId}`;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createCampaignTerrain(
  map: CampaignMapDefinition,
  tilePalette?: LevelTilePalette,
): LevelJson["terrain"] {
  const width = Math.max(8, Math.floor(map.size.w));
  const height = Math.max(8, Math.floor(map.size.h));
  const total = width * height;
  const ground = new Array<number>(total).fill(TILE_GRASS_PRIMARY);
  const deco = new Array<number>(total).fill(TILE_EMPTY);
  const nodeById = new Map(map.nodes.map((node) => [node.id, node] as const));
  const seed = hashSeed(map.id);
  const waterMask = new Array<boolean>(total).fill(true);
  const roadMask = new Array<boolean>(total).fill(false);
  const paletteOverridesEnabled = hasTilePaletteOverrides(tilePalette);
  const waterBaseOverride = normalizeTileIndex(tilePalette?.waterBase);
  const grassBaseOverride = normalizeTileIndex(tilePalette?.grassBase);
  const shorelineMaskOverrides = normalizeShorelineMaskMap(tilePalette?.shoreline?.maskToTileIndex);
  const centerX = (width - 1) * 0.5;
  const centerY = (height - 1) * 0.5;
  const radiusX = Math.max(3, Math.floor(width * 0.44));
  const radiusY = Math.max(3, Math.floor(height * 0.4));

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      const nx = (col - centerX) / radiusX;
      const ny = (row - centerY) / radiusY;
      const ellipse = nx * nx + ny * ny;
      const contourNoise = ((hash2d(col, row, seed ^ 0x63c63cd9) % 1000) / 1000 - 0.5) * 0.08;
      if (ellipse <= 1 + contourNoise) {
        waterMask[index] = false;
      }
    }
  }

  for (const node of map.nodes) {
    paintDisk(waterMask, width, height, Math.round(node.x), Math.round(node.y), 2, false);
  }

  for (const link of map.links) {
    const from = nodeById.get(link.a);
    const to = nodeById.get(link.b);
    if (!from || !to) {
      continue;
    }
    stampLineCells(
      Math.round(from.x),
      Math.round(from.y),
      Math.round(to.x),
      Math.round(to.y),
      (x, y) => {
        paintDisk(waterMask, width, height, x, y, 2, false);
        paintDisk(roadMask, width, height, x, y, 1, true);
      },
    );
  }

  for (const node of map.nodes) {
    paintDisk(roadMask, width, height, Math.round(node.x), Math.round(node.y), 1, true);
  }

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      if (roadMask[index]) {
        waterMask[index] = false;
      }
    }
  }

  // Keep an explicit ocean ring so every generated map reads as an island.
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      if (col <= 0 || row <= 0 || col >= width - 1 || row >= height - 1) {
        const index = row * width + col;
        waterMask[index] = true;
        roadMask[index] = false;
      }
    }
  }

  // Keep roads away from immediate coast so shoreline tiles stay coherent.
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      if (!roadMask[index] || waterMask[index]) {
        continue;
      }
      const northWater = row > 0 ? waterMask[(row - 1) * width + col] : false;
      const southWater = row < height - 1 ? waterMask[(row + 1) * width + col] : false;
      const westWater = col > 0 ? waterMask[row * width + (col - 1)] : false;
      const eastWater = col < width - 1 ? waterMask[row * width + (col + 1)] : false;
      if (northWater || southWater || westWater || eastWater) {
        roadMask[index] = false;
      }
    }
  }

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      if (waterMask[index]) {
        if (paletteOverridesEnabled && waterBaseOverride !== null) {
          ground[index] = waterBaseOverride;
        } else {
          ground[index] = pickVariant(WATER_TILE_VARIANTS, col, row, seed ^ 0x5bf03635);
        }
        continue;
      }

      if (roadMask[index]) {
        const roadOverrideTile = paletteOverridesEnabled
          ? resolveRoadTileOverride(col, row, width, height, roadMask, tilePalette?.road)
          : null;
        if (roadOverrideTile !== null) {
          ground[index] = roadOverrideTile;
        } else {
          ground[index] = pickVariant(ROAD_TILE_VARIANTS, col, row, seed ^ 0xc2b2ae35);
        }
        continue;
      }

      if (paletteOverridesEnabled && grassBaseOverride !== null) {
        ground[index] = grassBaseOverride;
      } else {
        const noise = hash2d(col, row, seed);
        if (noise % 17 === 0) {
          ground[index] = TILE_GRASS_ALT_A;
        } else if (noise % 23 === 0) {
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
      if (waterMask[index]) {
        continue;
      }

      const northWater = row > 0 ? waterMask[(row - 1) * width + col] : false;
      const southWater = row < height - 1 ? waterMask[(row + 1) * width + col] : false;
      const westWater = col > 0 ? waterMask[row * width + (col - 1)] : false;
      const eastWater = col < width - 1 ? waterMask[row * width + (col + 1)] : false;
      const waterSides = Number(northWater) + Number(southWater) + Number(westWater) + Number(eastWater);
      if (waterSides === 0) {
        continue;
      }

      if (paletteOverridesEnabled) {
        const shorelineOverrideTile = resolveShorelineOverrideTile(
          northWater,
          southWater,
          westWater,
          eastWater,
          shorelineMaskOverrides,
          tilePalette?.shoreline,
        );
        if (shorelineOverrideTile !== null) {
          ground[index] = shorelineOverrideTile;
          continue;
        }
      }

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
      } else if (northWater) {
        ground[index] = TILE_SHORE_NORTH;
      } else if (southWater) {
        ground[index] = TILE_SHORE_SOUTH;
      } else if (westWater) {
        ground[index] = TILE_SHORE_WEST;
      } else if (eastWater) {
        ground[index] = TILE_SHORE_EAST;
      }
    }
  }

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      if (waterMask[index] || roadMask[index]) {
        continue;
      }
      if (!GRASS_TILE_VARIANTS.includes(ground[index] as (typeof GRASS_TILE_VARIANTS)[number])) {
        continue;
      }
      const flowerNoise = hash2d(col, row, seed ^ 0xa54ff53a);
      if (flowerNoise % 43 === 0) {
        deco[index] = TILE_FLOWER;
      }
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

function createCampaignVisuals(
  map: CampaignMapDefinition,
  playerAnchor: string,
  enemyAnchor: string,
): LevelJson["visuals"] {
  const towers: NonNullable<LevelJson["visuals"]>["towers"] = {};

  for (const node of map.nodes) {
    towers[node.id] = {
      spriteKey: resolveSpriteKey(node, playerAnchor, enemyAnchor),
      frameIndex: 0,
      scale: 1,
    };
  }

  return {
    towerDefaults: {
      spriteKey: "barracks",
      frameIndex: 0,
    },
    towers,
  };
}

function resolveSpriteKey(
  node: CampaignMapDefinition["nodes"][number],
  playerAnchor: string,
  enemyAnchor: string,
): string {
  if (node.id === playerAnchor) {
    return "castle";
  }
  if (node.id === enemyAnchor) {
    return "keep";
  }
  if (node.owner === "player") {
    return node.tier >= 2 ? "guard_tower" : "scout_tower";
  }
  if (node.owner === "enemy") {
    return node.tier >= 2 ? "cannon_tower" : "guard_tower";
  }
  if (node.tier >= 2) {
    return "mage_tower";
  }
  return NEUTRAL_SPRITE_CYCLE[hashSeed(node.id) % NEUTRAL_SPRITE_CYCLE.length];
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

function normalizeTileIndex(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (${response.status} ${response.statusText})`);
  }
  return (await response.json()) as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
