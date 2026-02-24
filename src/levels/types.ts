import type { Owner } from "../sim/World";

export type LevelSizePreset = "small" | "medium" | "big";

export type GroundTileId = "grass" | "dirt" | "water";
export type DecorTileId = "tree" | "rock" | "flower" | "none" | string;
export type BuildingNodeType = "tower" | "stronghold";

export interface GridPoint {
  x: number;
  y: number;
}

export interface TileOverride<TTile extends string> extends GridPoint {
  tile: TTile;
}

export interface GroundLayer {
  default: GroundTileId;
  overrides: TileOverride<GroundTileId>[];
}

export interface DecorLayer {
  overrides: TileOverride<DecorTileId>[];
}

export interface GridLayers {
  ground: GroundLayer;
  decor: DecorLayer;
  blocked: GridPoint[];
}

export interface LevelGrid {
  width: number;
  height: number;
  minCellSize: number;
  layers: GridLayers;
}

export interface LevelNode {
  id: string;
  x: number;
  y: number;
  type: BuildingNodeType;
  owner: Owner;
  regen?: number;
  cap?: number;
  maxHp?: number;
  hp?: number;
  troops?: number;
  archetype?: string;
}

export interface LevelEdge {
  from: string;
  to: string;
}

export interface LevelMission {
  missionId: string;
  name: string;
  seed: number;
  waveSetId: string;
  objectiveText: string;
  difficulty?: number;
}

export interface RuntimeLevelRulesPatch {
  maxOutgoingLinksPerTower?: number;
  sendRatePerSec?: number;
  collisionDistancePx?: number;
  captureSeedTroops?: number;
  defaultUnit?: {
    speedPxPerSec?: number;
    dpsPerUnit?: number;
    hpPerUnit?: number;
  };
}

export interface RuntimeLevelAiPatch {
  aiThinkIntervalSec?: number;
  aiMinTroopsToAttack?: number;
}

export interface LevelRuntimeOverrides {
  rules?: RuntimeLevelRulesPatch;
  ai?: RuntimeLevelAiPatch;
}

export interface LevelJson {
  version: 1;
  stageId: string;
  levelId: string;
  name: string;
  size: LevelSizePreset;
  grid: LevelGrid;
  nodes: LevelNode[];
  edges: LevelEdge[];
  missions: LevelMission[];
  runtime?: LevelRuntimeOverrides;
}

export interface StageJson {
  stageId: string;
  name: string;
  levels: LevelJson[];
}

export interface LevelSourceEntry {
  source: "bundled" | "user";
  path: string;
  level: LevelJson;
}

export interface StageRegistryEntry {
  stageId: string;
  name: string;
  order: number;
  source: "bundled" | "user" | "mixed";
  levels: LevelSourceEntry[];
}
