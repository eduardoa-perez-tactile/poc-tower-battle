import { MIN_CELL_SIZE } from "./grid";
import { downloadLevelJson, saveUserLevelToStorage } from "./loader";
import type { LevelEdge, LevelJson, LevelNode, LevelSizePreset } from "./types";

const SIZE_PRESETS: Record<LevelSizePreset, { width: number; height: number; towerCount: number; minNodeDist: number }> = {
  small: { width: 18, height: 12, towerCount: 6, minNodeDist: 4 },
  medium: { width: 24, height: 16, towerCount: 8, minNodeDist: 4 },
  big: { width: 32, height: 20, towerCount: 10, minNodeDist: 5 },
};

const WAVE_SET_IDS = ["waves_basic_01", "waves_basic_02", "waves_elite_01"];

export interface GenerateLevelParams {
  sizePreset: LevelSizePreset;
  seed: number;
  stageId?: string;
  levelId?: string;
  name?: string;
}

export function createRandomSeed(): number {
  const now = Date.now();
  return Math.floor(now % 2147483647);
}

export function generateLevel(params: GenerateLevelParams): LevelJson {
  const preset = SIZE_PRESETS[params.sizePreset];
  const rng = createRng(params.seed);
  const blocked = generateBlockedCells(preset.width, preset.height, rng, params.sizePreset);

  const hqX = 2;
  const hqY = Math.floor(preset.height / 2);
  const nodes: LevelNode[] = [
    {
      id: "HQ",
      x: hqX,
      y: hqY,
      type: "stronghold",
      owner: "player",
      regen: 3,
      cap: 120,
      maxHp: 60,
      hp: 60,
      troops: 40,
      archetype: "STRONGHOLD",
    },
  ];

  const occupied = new Set<string>([cellKey(hqX, hqY), ...blocked.map((cell) => cellKey(cell.x, cell.y))]);
  const letterIds = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  for (let i = 0; i < preset.towerCount; i += 1) {
    const point = pickNodePoint({
      width: preset.width,
      height: preset.height,
      minDistance: preset.minNodeDist,
      rng,
      existing: nodes,
      occupied,
    });

    const id = i < letterIds.length ? letterIds[i] : `N${String(i + 1).padStart(2, "0")}`;
    occupied.add(cellKey(point.x, point.y));

    nodes.push({
      id,
      x: point.x,
      y: point.y,
      type: "tower",
      owner: "neutral",
      regen: 1.5,
      cap: 80,
      maxHp: 48,
      hp: 48,
      troops: 18,
      archetype: "BARRACKS",
    });
  }

  assignOwners(nodes, rng);
  const edges = buildConnectedEdges(nodes, rng);

  const missionCount = params.sizePreset === "small" ? 1 : params.sizePreset === "medium" ? 2 : 3;
  const missions = Array.from({ length: missionCount }, (_, index) => {
    const missionSeed = Math.floor(rng() * 2147483647);
    return {
      missionId: `m${String(index + 1).padStart(2, "0")}`,
      name: `Skirmish ${index + 1}`,
      seed: missionSeed,
      waveSetId: WAVE_SET_IDS[index % WAVE_SET_IDS.length],
      objectiveText: index === missionCount - 1 ? "Survive all enemy waves." : "Hold control and prepare for the next assault.",
      difficulty: 1,
    };
  });

  const stageId = params.stageId ?? "user";
  const levelId = params.levelId ?? `generated-${params.sizePreset}-${params.seed}`;

  return {
    version: 1,
    stageId,
    levelId,
    name: params.name ?? `Generated ${capitalize(params.sizePreset)} ${params.seed}`,
    size: params.sizePreset,
    grid: {
      width: preset.width,
      height: preset.height,
      minCellSize: MIN_CELL_SIZE,
      layers: {
        ground: {
          default: "grass",
          overrides: [],
        },
        decor: {
          overrides: [],
        },
        blocked,
      },
    },
    nodes,
    edges,
    missions,
  };
}

export function saveGeneratedLevel(level: LevelJson): void {
  saveUserLevelToStorage(level);
  downloadLevelJson(level);
}

function generateBlockedCells(
  width: number,
  height: number,
  rng: () => number,
  sizePreset: LevelSizePreset,
): Array<{ x: number; y: number }> {
  const maxBlocked = sizePreset === "small" ? 8 : sizePreset === "medium" ? 14 : 24;
  const blocked: Array<{ x: number; y: number }> = [];
  const occupied = new Set<string>();

  for (let i = 0; i < maxBlocked; i += 1) {
    const x = 2 + Math.floor(rng() * Math.max(1, width - 4));
    const y = 1 + Math.floor(rng() * Math.max(1, height - 2));
    if (x <= 3 || x >= width - 2) {
      continue;
    }

    const key = cellKey(x, y);
    if (occupied.has(key)) {
      continue;
    }

    occupied.add(key);
    blocked.push({ x, y });
  }

  return blocked;
}

function pickNodePoint(params: {
  width: number;
  height: number;
  minDistance: number;
  rng: () => number;
  existing: LevelNode[];
  occupied: Set<string>;
}): { x: number; y: number } {
  for (let attempt = 0; attempt < 1600; attempt += 1) {
    const x = 2 + Math.floor(params.rng() * Math.max(1, params.width - 4));
    const y = 1 + Math.floor(params.rng() * Math.max(1, params.height - 2));

    const key = cellKey(x, y);
    if (params.occupied.has(key)) {
      continue;
    }

    const okDistance = params.existing.every((node) => {
      const distance = Math.hypot(node.x - x, node.y - y);
      return distance >= params.minDistance;
    });

    if (!okDistance) {
      continue;
    }

    return { x, y };
  }

  for (let y = 1; y < params.height - 1; y += 1) {
    for (let x = 2; x < params.width - 2; x += 1) {
      const key = cellKey(x, y);
      if (!params.occupied.has(key)) {
        return { x, y };
      }
    }
  }

  return { x: 2, y: 2 };
}

function assignOwners(nodes: LevelNode[], rng: () => number): void {
  if (nodes.length <= 1) {
    return;
  }

  const hq = nodes[0];
  const towers = nodes.slice(1);
  towers.sort((left, right) => {
    const dl = Math.hypot(left.x - hq.x, left.y - hq.y);
    const dr = Math.hypot(right.x - hq.x, right.y - hq.y);
    return dl - dr;
  });

  const playerCount = Math.max(1, Math.floor(towers.length * 0.25));
  const enemyCount = Math.max(1, Math.floor(towers.length * 0.3));

  for (let i = 0; i < towers.length; i += 1) {
    const tower = towers[i];
    if (i < playerCount) {
      tower.owner = "player";
      tower.regen = 2;
      tower.cap = 95;
      tower.troops = 22;
      continue;
    }

    if (i >= towers.length - enemyCount) {
      tower.owner = "enemy";
      tower.regen = 2;
      tower.cap = 95;
      tower.troops = 24;
      continue;
    }

    tower.owner = rng() > 0.85 ? "enemy" : "neutral";
    tower.regen = tower.owner === "neutral" ? 1.2 : 1.8;
    tower.cap = tower.owner === "neutral" ? 75 : 88;
    tower.troops = tower.owner === "neutral" ? 14 : 20;
  }
}

function buildConnectedEdges(nodes: LevelNode[], rng: () => number): LevelEdge[] {
  if (nodes.length <= 1) {
    return [];
  }

  const used = new Set<number>([0]);
  const edges: LevelEdge[] = [];

  while (used.size < nodes.length) {
    let bestFrom = -1;
    let bestTo = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const fromIndex of used) {
      for (let toIndex = 0; toIndex < nodes.length; toIndex += 1) {
        if (used.has(toIndex)) {
          continue;
        }

        const from = nodes[fromIndex];
        const to = nodes[toIndex];
        const distance = Math.hypot(from.x - to.x, from.y - to.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestFrom = fromIndex;
          bestTo = toIndex;
        }
      }
    }

    if (bestFrom < 0 || bestTo < 0) {
      break;
    }

    used.add(bestTo);
    edges.push(createOrderedEdge(nodes[bestFrom].id, nodes[bestTo].id));
  }

  const edgeSet = new Set(edges.map((edge) => `${edge.from}->${edge.to}`));
  const extraAttempts = Math.max(2, Math.floor(nodes.length * 0.9));

  for (let i = 0; i < extraAttempts; i += 1) {
    const fromIndex = Math.floor(rng() * nodes.length);
    let toIndex = Math.floor(rng() * nodes.length);
    if (fromIndex === toIndex) {
      toIndex = (toIndex + 1) % nodes.length;
    }

    const from = nodes[fromIndex];
    const to = nodes[toIndex];
    const distance = Math.hypot(from.x - to.x, from.y - to.y);
    if (distance > Math.max(8, nodes.length + 3) || rng() < 0.35) {
      continue;
    }

    const edge = createOrderedEdge(from.id, to.id);
    const key = `${edge.from}->${edge.to}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push(edge);
    }
  }

  return edges;
}

function createOrderedEdge(left: string, right: string): LevelEdge {
  if (left < right) {
    return { from: left, to: right };
  }
  return { from: right, to: left };
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
