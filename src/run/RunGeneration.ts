import { createDefaultMetaModifiers, RUN_SCHEMA_VERSION, type MetaModifiers, type RunMissionNode, type RunState } from "../save/Schema";
import { DEFAULT_DIFFICULTY_TIER } from "../config/Difficulty";

export interface MissionTemplate {
  id: string;
  name: string;
  levelPath: string;
  baseDifficulty: number;
}

export interface MissionCatalog {
  templates: MissionTemplate[];
}

export async function loadMissionCatalog(path = "/data/missions.json"): Promise<MissionTemplate[]> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load mission catalog (${response.status} ${response.statusText})`);
  }

  const data: unknown = await response.json();
  return parseMissionCatalog(data);
}

export function createRunState(seed: number, templates: MissionTemplate[], bonuses: MetaModifiers): RunState {
  const normalizedBonuses = {
    ...createDefaultMetaModifiers(),
    ...bonuses,
  };
  const missions = generateRunMissions(seed, templates);

  return {
    schemaVersion: RUN_SCHEMA_VERSION,
    runId: `run-${Date.now()}-${seed}`,
    seed,
    currentMissionIndex: 0,
    missions,
    runModifiers: {
      difficulty: 1,
      tier: DEFAULT_DIFFICULTY_TIER,
    },
    inventory: {
      relics: [],
      boons: [],
    },
    startingBonuses: normalizedBonuses,
    runGloryEarned: 0,
  };
}

function generateRunMissions(seed: number, templates: MissionTemplate[]): RunMissionNode[] {
  if (templates.length === 0) {
    throw new Error("Mission catalog has no templates");
  }

  const rng = createRng(seed);
  const missionCount = Math.min(templates.length, 3 + Math.floor(rng() * 3));
  const pool = [...templates];
  shuffle(pool, rng);

  const nodes: RunMissionNode[] = [];
  for (let i = 0; i < missionCount; i += 1) {
    const template = pool[i];
    const difficultyVariance = (rng() - 0.5) * 0.08;
    const difficulty = round2(template.baseDifficulty + i * 0.1 + difficultyVariance);
    nodes.push({
      id: `${template.id}-${i + 1}`,
      templateId: template.id,
      name: template.name,
      levelPath: template.levelPath,
      difficulty: Math.max(0.8, difficulty),
    });
  }

  return nodes;
}

function parseMissionCatalog(data: unknown): MissionTemplate[] {
  if (!isObject(data) || !Array.isArray(data.templates)) {
    throw new Error("Mission catalog must include a templates array");
  }

  const templates = data.templates.map((entry, index) => parseMissionTemplate(entry, index));
  if (templates.length < 3) {
    throw new Error("Mission catalog must include at least 3 templates");
  }
  return templates;
}

function parseMissionTemplate(value: unknown, index: number): MissionTemplate {
  if (!isObject(value)) {
    throw new Error(`Mission template at index ${index} is invalid`);
  }

  const id = asString(value.id, `templates[${index}].id`);
  const name = asString(value.name, `templates[${index}].name`);
  const levelPath = asString(value.levelPath, `templates[${index}].levelPath`);
  const baseDifficulty = asNumber(value.baseDifficulty, `templates[${index}].baseDifficulty`);

  return { id, name, levelPath, baseDifficulty };
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

function shuffle<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}
