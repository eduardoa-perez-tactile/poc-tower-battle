import type {
  CampaignLevelDefinition,
  CampaignSpecV2,
  CampaignWavePresetCatalog,
} from "../../../campaign/CampaignTypes";
import type { MissionCatalog } from "../../../run/RunGeneration";
import { isObject, parseJsonSafe } from "../model/json";
import { CORE_LEVEL_EDITOR_PATHS, isCampaignMapPath } from "../model/pathCatalog";
import {
  LEVEL_EDITOR_WORKSPACE_VERSION,
  type LevelEditorDocKind,
  type LevelEditorDocument,
  type LevelEditorKnownJson,
  type LevelEditorWorkspace,
} from "../model/types";

interface LoadedRaw {
  path: string;
  raw: string;
  loadError: string | null;
}

export async function loadLevelEditorWorkspace(): Promise<LevelEditorWorkspace> {
  const initialPaths = [...CORE_LEVEL_EDITOR_PATHS, ...fallbackCampaignMapPaths()];
  const initialLoads = await Promise.all(initialPaths.map((path) => fetchRaw(path)));

  const campaignLoad = initialLoads.find((entry) => entry.path === "/data/campaign/campaign_v2.json") ?? null;
  const missionCatalogLoad = initialLoads.find((entry) => entry.path === "/data/missions.json") ?? null;
  const discoveredPaths = discoverAdditionalPaths(campaignLoad, missionCatalogLoad);

  const discoveredLoads = await Promise.all(
    discoveredPaths
      .filter((path) => initialPaths.indexOf(path) < 0)
      .map((path) => fetchRaw(path)),
  );

  const loads = [...initialLoads, ...discoveredLoads];
  const docs: Record<string, LevelEditorDocument> = {};
  const order: string[] = [];

  for (const load of loads) {
    const document = buildDocument(load);
    docs[document.id] = document;
    order.push(document.id);
  }

  const now = Date.now();
  return {
    version: LEVEL_EDITOR_WORKSPACE_VERSION,
    createdAt: now,
    updatedAt: now,
    order,
    docs,
  };
}

function discoverAdditionalPaths(campaignLoad: LoadedRaw | null, missionCatalogLoad: LoadedRaw | null): string[] {
  const discovered = new Set<string>();

  if (campaignLoad?.raw) {
    const parsed = parseJsonSafe(campaignLoad.raw);
    if (!parsed.error && isCampaignSpec(parsed.data)) {
      for (const stage of parsed.data.stages) {
        for (const level of stage.levels) {
          discovered.add(`/levels/v2/${level.mapId}.json`);
        }
      }
    }
  }

  if (missionCatalogLoad?.raw) {
    const parsed = parseJsonSafe(missionCatalogLoad.raw);
    if (!parsed.error && isMissionCatalog(parsed.data)) {
      for (const template of parsed.data.templates) {
        discovered.add(template.levelPath);
      }
    }
  }

  return [...discovered];
}

function buildDocument(input: LoadedRaw): LevelEditorDocument {
  const parsed = input.loadError ? { data: null, error: input.loadError } : parseJsonSafe(input.raw);
  const kind = resolveKind(input.path, parsed.data);
  return {
    id: input.path,
    path: input.path,
    label: resolveLabel(input.path),
    kind,
    group: resolveGroup(kind),
    originalRaw: input.raw,
    currentRaw: input.raw,
    originalData: parsed.error ? null : (parsed.data as LevelEditorKnownJson),
    currentData: parsed.error ? null : (parsed.data as LevelEditorKnownJson),
    parseError: parsed.error,
    loadError: input.loadError,
    isSynthetic: false,
  };
}

async function fetchRaw(path: string): Promise<LoadedRaw> {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      return {
        path,
        raw: "",
        loadError: `Failed to load ${path} (${response.status} ${response.statusText})`,
      };
    }

    return {
      path,
      raw: await response.text(),
      loadError: null,
    };
  } catch (error) {
    return {
      path,
      raw: "",
      loadError: error instanceof Error ? error.message : `Failed to load ${path}`,
    };
  }
}

function fallbackCampaignMapPaths(): string[] {
  const result: string[] = [];
  for (let index = 1; index <= 20; index += 1) {
    result.push(`/levels/v2/map_t${index.toString().padStart(2, "0")}.json`);
  }
  return result;
}

function resolveLabel(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const fileName = segments[segments.length - 1] ?? path;
  if (isCampaignMapPath(path)) {
    return `Map ${fileName.replace(".json", "")}`;
  }
  return fileName;
}

function resolveKind(path: string, data: unknown | null): LevelEditorDocKind {
  if (path.endsWith("/campaign_v2.json")) {
    return "campaign";
  }
  if (path.endsWith("/presets.json")) {
    return "wave-presets";
  }
  if (path.endsWith("/wave-balance.json")) {
    return "wave-balance";
  }
  if (path.endsWith("/balanceBaselines.json")) {
    return "balance-baselines";
  }
  if (path.endsWith("/difficultyTiers.json")) {
    return "difficulty-tiers";
  }
  if (path.endsWith("/difficulty/stages.json")) {
    return "stage-difficulty";
  }
  if (path.endsWith("/difficulty/ascensions.json")) {
    return "ascension-difficulty";
  }
  if (path.endsWith("/wave-modifiers.json")) {
    return "wave-modifiers";
  }
  if (path.endsWith("/enemyArchetypes.json")) {
    return "enemy-archetypes";
  }
  if (path.endsWith("/waves-handcrafted.json")) {
    return "waves-handcrafted";
  }
  if (path.endsWith("/wavePacingTargets.json")) {
    return "wave-pacing-targets";
  }
  if (path.endsWith("/missions.json")) {
    return "mission-catalog";
  }
  if (path.endsWith("/tutorials.json")) {
    return "tutorial-catalog";
  }
  if (isCampaignMapPath(path)) {
    return "campaign-map";
  }
  if (path.startsWith("/levels/") && path.endsWith(".json")) {
    if (isObject(data) && data.version === 1 && typeof data.stageId === "string") {
      return "level-json";
    }
    return "legacy-level";
  }
  return "unknown";
}

function resolveGroup(kind: LevelEditorDocKind): LevelEditorDocument["group"] {
  switch (kind) {
    case "campaign":
      return "campaign";
    case "level-json":
    case "legacy-level":
      return "levels";
    case "wave-presets":
      return "presets";
    case "campaign-map":
      return "maps";
    case "wave-balance":
    case "balance-baselines":
    case "difficulty-tiers":
    case "stage-difficulty":
    case "ascension-difficulty":
    case "wave-modifiers":
    case "enemy-archetypes":
    case "waves-handcrafted":
    case "wave-pacing-targets":
    case "mission-catalog":
      return "globals";
    case "tutorial-catalog":
      return "tutorials";
    default:
      return "other";
  }
}

function isCampaignSpec(value: unknown): value is CampaignSpecV2 {
  return (
    isObject(value) &&
    value.version === 2 &&
    Array.isArray(value.stages) &&
    value.stages.every((stage) => isObject(stage) && Array.isArray(stage.levels))
  );
}

function isMissionCatalog(value: unknown): value is MissionCatalog {
  return (
    isObject(value) &&
    Array.isArray(value.templates) &&
    value.templates.every((template) => isObject(template) && typeof template.levelPath === "string")
  );
}

export function isWavePresetCatalog(value: unknown): value is CampaignWavePresetCatalog {
  return isObject(value) && value.version === 1 && isObject(value.presets);
}

export function isCampaignLevelDefinition(value: unknown): value is CampaignLevelDefinition {
  return isObject(value) && typeof value.id === "string" && isObject(value.wavePlan);
}
