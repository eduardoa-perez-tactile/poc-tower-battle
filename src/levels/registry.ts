import { BUNDLED_LEVEL_PATHS, loadBundledLevels, loadUserLevelsFromStorage } from "./loader";
import type { LevelJson, LevelSourceEntry, StageRegistryEntry } from "./types";

const DEFAULT_STAGE_NAMES: Record<string, string> = {
  stage01: "Stage 01: Frontier Line",
  stage02: "Stage 02: Iron Divide",
  user: "User Generated",
};

const ORDER_HINTS: Record<string, number> = {
  stage01: 1,
  stage02: 2,
  user: 999,
};

export interface LevelRegistry {
  stages: StageRegistryEntry[];
}

export async function loadLevelRegistry(): Promise<LevelRegistry> {
  const [bundledLevels, userLevels] = await Promise.all([
    loadBundledLevels(BUNDLED_LEVEL_PATHS),
    Promise.resolve(loadUserLevelsFromStorage()),
  ]);

  const grouped = new Map<string, LevelSourceEntry[]>();

  for (const level of bundledLevels) {
    pushLevel(grouped, level.stageId, {
      source: "bundled",
      path: `/levels/${level.stageId}/${level.levelId}.json`,
      level,
    });
  }

  for (const level of userLevels) {
    pushLevel(grouped, level.stageId, {
      source: "user",
      path: `localStorage:${level.stageId}/${level.levelId}`,
      level,
    });
  }

  const stages: StageRegistryEntry[] = [];
  for (const [stageId, levels] of grouped.entries()) {
    const deduped = dedupeLevels(levels);
    deduped.sort((left, right) => compareLevelIds(left.level.levelId, right.level.levelId));

    const hasBundled = deduped.some((entry) => entry.source === "bundled");
    const hasUser = deduped.some((entry) => entry.source === "user");

    stages.push({
      stageId,
      name: DEFAULT_STAGE_NAMES[stageId] ?? humanizeStageId(stageId),
      order: ORDER_HINTS[stageId] ?? deriveOrder(stageId),
      source: hasBundled && hasUser ? "mixed" : hasUser ? "user" : "bundled",
      levels: deduped,
    });
  }

  stages.sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.stageId.localeCompare(right.stageId);
  });

  return { stages };
}

export function findStageById(stages: StageRegistryEntry[], stageId: string): StageRegistryEntry | null {
  for (const stage of stages) {
    if (stage.stageId === stageId) {
      return stage;
    }
  }
  return null;
}

export function findLevelById(
  stages: StageRegistryEntry[],
  stageId: string,
  levelId: string,
): LevelSourceEntry | null {
  const stage = findStageById(stages, stageId);
  if (!stage) {
    return null;
  }

  for (const level of stage.levels) {
    if (level.level.levelId === levelId) {
      return level;
    }
  }
  return null;
}

function dedupeLevels(levels: LevelSourceEntry[]): LevelSourceEntry[] {
  const byId = new Map<string, LevelSourceEntry>();
  for (const entry of levels) {
    const key = entry.level.levelId;
    const existing = byId.get(key);
    if (!existing || existing.source === "bundled") {
      byId.set(key, entry);
    }
  }
  return [...byId.values()];
}

function pushLevel(grouped: Map<string, LevelSourceEntry[]>, stageId: string, entry: LevelSourceEntry): void {
  const existing = grouped.get(stageId);
  if (existing) {
    existing.push(entry);
    return;
  }
  grouped.set(stageId, [entry]);
}

function compareLevelIds(left: string, right: string): number {
  const leftNum = numericSuffix(left);
  const rightNum = numericSuffix(right);
  if (leftNum !== null && rightNum !== null && leftNum !== rightNum) {
    return leftNum - rightNum;
  }
  return left.localeCompare(right);
}

function numericSuffix(value: string): number | null {
  const match = value.match(/(\d+)$/);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

function deriveOrder(stageId: string): number {
  const numeric = numericSuffix(stageId);
  if (numeric === null) {
    return 100;
  }
  return numeric;
}

function humanizeStageId(value: string): string {
  const normalized = value.replace(/[_-]+/g, " ").trim();
  if (!normalized) {
    return "Stage";
  }
  return normalized
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function toLevelKey(level: LevelJson): string {
  return `${level.stageId}:${level.levelId}`;
}
