import { buildLevelJsonFromCampaignMap } from "../../../campaign/CampaignLoader";
import type {
  CampaignMapDefinition,
  CampaignSpecV2,
  CampaignWavePreset,
  CampaignWavePresetCatalog,
  ResolvedCampaignWavePlan,
} from "../../../campaign/CampaignTypes";
import { buildRuntimeLevelFromLevel } from "../../../levels/adapter";
import type { GridRenderData } from "../../../levels/runtime";
import type { LevelJson } from "../../../levels/types";
import type { TerrainData } from "../../../types/Terrain";
import type { LevelVisualsData } from "../../../types/Visuals";
import { parseTowerDictionaryFromRaw } from "../data/TowerDictionaryStore";
import type { LevelEditorSelection, LevelEditorWorkspace } from "../model/types";

export interface LevelEditorTowerArtPreview {
  atlasId: string;
  spriteKey: string;
  frameIndex: number;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
}

export interface LevelEditorArtPreviewPayload {
  mapRenderData: GridRenderData;
  terrain: TerrainData | null;
  visuals: LevelVisualsData | null;
  towers: Array<{
    id: string;
    x: number;
    y: number;
    archetype: string;
    owner: "player" | "enemy" | "neutral";
  }>;
  towerArtByArchetype: Record<string, LevelEditorTowerArtPreview>;
}

export interface LevelEditorArtPreviewCompileResult {
  payload: LevelEditorArtPreviewPayload | null;
  error: string | null;
}

interface ViewportSize {
  width: number;
  height: number;
}

export class LevelEditorArtPreviewCompiler {
  private lastKey: string | null;
  private lastResult: LevelEditorArtPreviewCompileResult;

  constructor() {
    this.lastKey = null;
    this.lastResult = {
      payload: null,
      error: null,
    };
  }

  compile(
    workspace: LevelEditorWorkspace,
    selection: LevelEditorSelection,
    viewport: ViewportSize,
  ): LevelEditorArtPreviewCompileResult {
    const key = buildCompilationKey(workspace, selection, viewport);
    if (!key) {
      this.lastKey = null;
      this.lastResult = {
        payload: null,
        error: null,
      };
      return this.lastResult;
    }

    if (this.lastKey === key) {
      return this.lastResult;
    }

    const result = compileArtPreviewPayload(workspace, selection, viewport);
    this.lastKey = key;
    this.lastResult = result;
    return result;
  }
}

function compileArtPreviewPayload(
  workspace: LevelEditorWorkspace,
  selection: LevelEditorSelection,
  viewport: ViewportSize,
): LevelEditorArtPreviewCompileResult {
  const level = resolveLevelFromSelection(workspace, selection);
  if (!level) {
    return {
      payload: null,
      error: null,
    };
  }

  try {
    const runtimeLevel = buildRuntimeLevelFromLevel(level, {
      viewport: {
        width: clampInt(viewport.width, 1, 8192),
        height: clampInt(viewport.height, 1, 8192),
      },
    });

    if (!runtimeLevel.mapRenderData) {
      return {
        payload: null,
        error: "Art preview unavailable—showing blueprint.",
      };
    }

    return {
      payload: {
        mapRenderData: runtimeLevel.mapRenderData,
        terrain: runtimeLevel.terrain ?? null,
        visuals: runtimeLevel.visuals ?? null,
        towers: runtimeLevel.towers.map((tower) => ({
          id: tower.id,
          x: tower.x,
          y: tower.y,
          archetype: tower.archetype,
          owner: tower.owner,
        })),
        towerArtByArchetype: readTowerArtByArchetype(workspace),
      },
      error: null,
    };
  } catch {
    return {
      payload: null,
      error: "Art preview unavailable—showing blueprint.",
    };
  }
}

function resolveLevelFromSelection(
  workspace: LevelEditorWorkspace,
  selection: LevelEditorSelection,
): LevelJson | null {
  if (selection.type === "campaign-mission") {
    return buildCampaignMissionLevel(workspace, selection.docId, selection.stageIndex, selection.levelIndex);
  }

  if (selection.type !== "file") {
    return null;
  }

  const doc = workspace.docs[selection.docId];
  if (!doc) {
    return null;
  }
  if (isLevelJson(doc.currentData)) {
    return doc.currentData;
  }
  if (isCampaignMap(doc.currentData)) {
    const defaultWavePlan: ResolvedCampaignWavePlan = {
      preset: "preview",
      waves: 6,
      missionDifficultyScalar: 1,
      firstAppearanceWave: 1,
      minibossWave: undefined,
      bossEnabled: false,
    };
    return buildLevelJsonFromCampaignMap(
      "preview",
      doc.currentData.id,
      doc.currentData.id,
      "Preview mission",
      doc.currentData,
      defaultWavePlan,
      "m01",
    );
  }

  return null;
}

function buildCampaignMissionLevel(
  workspace: LevelEditorWorkspace,
  docId: string,
  stageIndex: number,
  levelIndex: number,
): LevelJson | null {
  const campaignDoc = workspace.docs[docId];
  if (!campaignDoc || !isCampaignSpec(campaignDoc.currentData)) {
    return null;
  }

  const stage = campaignDoc.currentData.stages[stageIndex];
  const level = stage?.levels[levelIndex];
  if (!stage || !level) {
    return null;
  }

  const mapDoc = workspace.docs[`/levels/v2/${level.mapId}.json`];
  if (!mapDoc || !isCampaignMap(mapDoc.currentData)) {
    return null;
  }

  const resolvedWavePlan = resolveWavePlan(workspace, level.wavePlan);
  return buildLevelJsonFromCampaignMap(
    stage.id,
    level.id,
    level.displayName,
    level.objectivesText,
    mapDoc.currentData,
    resolvedWavePlan,
    "m01",
    level.tutorialId,
    stage.tilePalette ?? level.tilePalette,
  );
}

function resolveWavePlan(
  workspace: LevelEditorWorkspace,
  wavePlanRef: {
    preset: string;
    waves?: number;
    firstAppearanceWave?: number;
    minibossWave?: number;
    bossEnabled?: boolean;
  },
): ResolvedCampaignWavePlan {
  const presetsDoc = workspace.docs["/data/waves/presets.json"];
  const presetCatalog = presetsDoc && isPresetCatalog(presetsDoc.currentData)
    ? presetsDoc.currentData
    : null;
  const preset = presetCatalog?.presets[wavePlanRef.preset] ?? firstPreset(presetCatalog);

  return {
    preset: wavePlanRef.preset,
    waves: clampInt(wavePlanRef.waves ?? preset?.waves ?? 6, 0, 12),
    missionDifficultyScalar: clamp(preset?.missionDifficultyScalar ?? 1, 0.6, 2),
    firstAppearanceWave: clampInt(wavePlanRef.firstAppearanceWave ?? preset?.firstAppearanceWave ?? 1, 1, 12),
    minibossWave: wavePlanRef.minibossWave ?? preset?.minibossWave,
    bossEnabled: wavePlanRef.bossEnabled ?? preset?.bossEnabled ?? false,
  };
}

function firstPreset(catalog: CampaignWavePresetCatalog | null): CampaignWavePreset | null {
  if (!catalog) {
    return null;
  }
  const ids = Object.keys(catalog.presets).sort((left, right) => left.localeCompare(right));
  if (ids.length === 0) {
    return null;
  }
  return catalog.presets[ids[0]] ?? null;
}

function buildCompilationKey(
  workspace: LevelEditorWorkspace,
  selection: LevelEditorSelection,
  viewport: ViewportSize,
): string | null {
  const width = clampInt(viewport.width, 1, 8192);
  const height = clampInt(viewport.height, 1, 8192);
  const keyParts = [`${width}x${height}`, selection.type];
  const towerDictionaryDoc = workspace.docs["/data/towerArchetypes.json"];
  const towerDictionaryHash = hashText(towerDictionaryDoc?.currentRaw ?? "");

  if (selection.type === "campaign-mission") {
    const campaignDoc = workspace.docs[selection.docId];
    if (!campaignDoc || !isCampaignSpec(campaignDoc.currentData)) {
      return null;
    }
    const stage = campaignDoc.currentData.stages[selection.stageIndex];
    const level = stage?.levels[selection.levelIndex];
    if (!stage || !level) {
      return null;
    }
    const mapDoc = workspace.docs[`/levels/v2/${level.mapId}.json`];
    if (!mapDoc || !isCampaignMap(mapDoc.currentData)) {
      return null;
    }
    const presetsDoc = workspace.docs["/data/waves/presets.json"];
    keyParts.push(
      selection.docId,
      `${selection.stageIndex}:${selection.levelIndex}`,
      hashText(campaignDoc.currentRaw),
      hashText(mapDoc.currentRaw),
      hashText(presetsDoc?.currentRaw ?? ""),
      towerDictionaryHash,
    );
    return keyParts.join("|");
  }

  if (selection.type === "file") {
    const doc = workspace.docs[selection.docId];
    if (!doc) {
      return null;
    }
    const includesDoc = isLevelJson(doc.currentData) || isCampaignMap(doc.currentData);
    if (!includesDoc) {
      return null;
    }
    keyParts.push(selection.docId, hashText(doc.currentRaw), towerDictionaryHash);
    return keyParts.join("|");
  }

  return null;
}

function isCampaignSpec(value: unknown): value is CampaignSpecV2 {
  return isObject(value) && value.version === 2 && Array.isArray(value.stages);
}

function isPresetCatalog(value: unknown): value is CampaignWavePresetCatalog {
  return isObject(value) && value.version === 1 && isObject(value.presets);
}

function isCampaignMap(value: unknown): value is CampaignMapDefinition {
  return isObject(value) && typeof value.id === "string" && Array.isArray(value.nodes) && Array.isArray(value.links);
}

function isLevelJson(value: unknown): value is LevelJson {
  return isObject(value) && value.version === 1 && isObject(value.grid) && Array.isArray(value.nodes) && Array.isArray(value.edges);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function readTowerArtByArchetype(workspace: LevelEditorWorkspace): Record<string, LevelEditorTowerArtPreview> {
  const doc = workspace.docs["/data/towerArchetypes.json"];
  if (!doc || !doc.currentData) {
    return {};
  }

  try {
    const dictionary = parseTowerDictionaryFromRaw(doc.currentData);
    const mapping: Record<string, LevelEditorTowerArtPreview> = {};
    for (const [towerId, tower] of Object.entries(dictionary.towers)) {
      mapping[towerId] = {
        atlasId: tower.art.atlasId,
        spriteKey: tower.art.spriteKey,
        frameIndex: tower.art.frameIndex,
        scale: tower.art.scale,
        offsetX: tower.art.offsetX,
        offsetY: tower.art.offsetY,
      };
    }
    return mapping;
  } catch {
    return {};
  }
}
