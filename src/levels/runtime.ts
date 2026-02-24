import type { LinkSeed, Tower } from "../sim/World";
import type { SimulationRules } from "../sim/Simulation";

export interface AiRules {
  aiThinkIntervalSec: number;
  aiMinTroopsToAttack: number;
}

export interface LevelRules extends SimulationRules {
  maxOutgoingLinksPerTower: number;
  collisionDistancePx: number;
  captureSeedTroops: number;
}

export interface GridRenderNode {
  id: string;
  x: number;
  y: number;
}

export interface GridRenderEdge {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface GridRenderData {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  originX: number;
  originY: number;
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
  nodes: GridRenderNode[];
  edges: GridRenderEdge[];
}

export interface LoadedLevel {
  towers: Tower[];
  initialLinks: LinkSeed[];
  rules: LevelRules;
  ai: AiRules;
  mapRenderData?: GridRenderData;
}
