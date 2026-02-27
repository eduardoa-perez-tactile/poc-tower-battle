import { buildDifficultyContext, resolveStageBudgetModel } from "../../../difficulty/DifficultyContext";
import type { DifficultyTierId } from "../../../config/Difficulty";
import { buildRuntimeLevelFromLevel } from "../../../levels/adapter";
import type { LevelJson } from "../../../levels/types";
import { createDefaultMetaModifiers } from "../../../save/Schema";
import { World } from "../../../sim/World";
import type { CampaignMapDefinition, CampaignSpecV2, CampaignWavePreset, CampaignWavePresetCatalog } from "../../../campaign/CampaignTypes";
import type {
  BalanceBaselinesConfig,
  DifficultyTierCatalog,
  EnemyCatalog,
  HandcraftedWaveCatalog,
  LoadedWaveContent,
  WaveBalanceConfig,
  WaveModifierCatalog,
  WavePacingTargetCatalog,
} from "../../../waves/Definitions";
import { WaveDirector } from "../../../waves/WaveDirector";
import type { AscensionDifficultyCatalog, StageDifficultyCatalog } from "../../../waves/DifficultyTypes";
import { isObject } from "../model/json";
import type { LevelEditorResolvedMission, LevelEditorSelection, LevelEditorWorkspace, ResolveMissionOptions } from "../model/types";
import { computeDerivedWave } from "./derived";

interface ResolveMissionInput {
  missionLabel: string;
  missionKey: string;
  baseLevel: LevelJson;
  wavePlan: {
    preset: string;
    waves: number;
    missionDifficultyScalar: number;
    firstAppearanceWave: number;
    minibossWave: number | null;
    bossEnabled: boolean;
  };
  difficulty: {
    stageId: string;
    missionIndex: number;
  };
  allowedEnemyIds: string[] | null;
}

export function resolveMissionForSelection(
  workspace: LevelEditorWorkspace,
  selection: LevelEditorSelection,
  options: ResolveMissionOptions,
): LevelEditorResolvedMission | null {
  const input = toResolveInput(workspace, selection);
  if (!input) {
    return null;
  }

  const loaded = readWaveDependencies(workspace);
  if (!loaded) {
    return null;
  }

  const tierConfig = loaded.difficultyTiers.difficultyTiers[options.tierId];
  if (!tierConfig) {
    return null;
  }

  const runSeed = hashSeed(input.missionKey);
  const difficultyContext = buildDifficultyContext({
    missionId: input.missionKey,
    missionName: input.missionLabel,
    missionDifficulty: input.wavePlan.missionDifficultyScalar,
    runDifficultyScalar: options.runDifficultyScalar,
    tierId: options.tierId,
    tierConfig,
    baselines: loaded.balanceBaselines,
    waveBalance: loaded.balance,
    stageCatalog: loaded.stageDifficulty,
    ascensionCatalog: loaded.ascensionDifficulty,
    stageId: input.difficulty.stageId,
    stageIndex: deriveStageIndex(input.difficulty.stageId),
    missionIndex: input.difficulty.missionIndex,
    presetId: input.wavePlan.preset,
    waveCountOverride: input.wavePlan.waves,
    bossEnabledOverride: input.wavePlan.bossEnabled,
    firstAppearanceWaveOverride: input.wavePlan.firstAppearanceWave,
    minibossWaveOverride: input.wavePlan.minibossWave ?? undefined,
    ascensionLevel: options.ascensionLevel,
    activeAscensionIds: [],
    activeWaveModifierIds: [],
    metaModifiers: createDefaultMetaModifiers(),
    simulationBase: {
      sendRatePerSec: 6,
      captureRateMultiplier: 1,
      playerCaptureEfficiencyMul: 1,
      playerRegenMultiplier: 1,
      enemyRegenMultiplier: 1,
      linkDecayPerSec: 0,
      linkDecayCanBreak: false,
    },
    runSeed,
    missionSeed: runSeed,
  });

  const runtimeLevel = buildRuntimeLevelFromLevel(input.baseLevel, {
    viewport: {
      width: 1280,
      height: 720,
    },
  });
  const world = new World(
    runtimeLevel.towers,
    runtimeLevel.rules.maxOutgoingLinksPerTower,
    new Map(),
    runtimeLevel.initialLinks,
    1,
    runtimeLevel.graphEdges,
  );

  const waveDirector = new WaveDirector(world, loaded, {
    runSeed,
    difficultyContext,
    allowedEnemyIds: input.allowedEnemyIds ?? undefined,
    balanceDiagnosticsEnabled: false,
  });
  const snapshot = waveDirector.getDifficultyDebugSnapshot(input.wavePlan.waves);

  const waves = snapshot.waves
    .slice()
    .sort((left, right) => left.waveIndex - right.waveIndex)
    .map((wave) => {
      const derived = computeDerivedWave(wave.waveIndex, wave.plan, wave.tuning, difficultyContext, loaded.balance);
      const stageBudget = resolveStageBudgetModel(difficultyContext, wave.waveIndex, snapshot.totalWaveCount);
      return {
        ...derived,
        minibossChance: stageBudget.minibossChance,
      };
    });

  const resolvedJson: Record<string, unknown> = {
    missionKey: input.missionKey,
    missionLabel: input.missionLabel,
    tierId: options.tierId,
    runDifficultyScalar: options.runDifficultyScalar,
    wavePlan: {
      ...input.wavePlan,
    },
    difficulty: {
      stageId: input.difficulty.stageId,
      missionIndex: input.difficulty.missionIndex,
      missionDifficultyScalar: input.wavePlan.missionDifficultyScalar,
    },
    context: {
      waveCountOverride: difficultyContext.wavePlan.waveCountOverride,
      bossEnabledOverride: difficultyContext.wavePlan.bossEnabledOverride,
      firstAppearanceWave: difficultyContext.wavePlan.firstAppearanceWave,
      minibossWave: difficultyContext.wavePlan.minibossWave,
      missionDifficultyScalar: difficultyContext.missionDifficultyScalar,
      tier: difficultyContext.labels.tier,
    },
    waves,
  };

  return {
    missionLabel: input.missionLabel,
    missionKey: input.missionKey,
    tierId: options.tierId,
    runDifficultyScalar: options.runDifficultyScalar,
    waveCount: input.wavePlan.waves,
    firstAppearanceWave: input.wavePlan.firstAppearanceWave,
    minibossWave: input.wavePlan.minibossWave,
    bossEnabled: input.wavePlan.bossEnabled,
    waves,
    resolvedJson,
  };
}

function toResolveInput(workspace: LevelEditorWorkspace, selection: LevelEditorSelection): ResolveMissionInput | null {
  if (selection.type === "campaign-mission") {
    return buildCampaignResolveInput(workspace, selection.docId, selection.stageIndex, selection.levelIndex);
  }

  if (selection.type === "level-mission") {
    return buildLevelMissionResolveInput(workspace, selection.docId, selection.missionIndex);
  }

  return null;
}

function buildCampaignResolveInput(
  workspace: LevelEditorWorkspace,
  docId: string,
  stageIndex: number,
  levelIndex: number,
): ResolveMissionInput | null {
  const campaignDoc = workspace.docs[docId];
  const presetsDoc = workspace.docs["/data/waves/presets.json"];
  if (!campaignDoc || !presetsDoc) {
    return null;
  }
  if (!isCampaignSpec(campaignDoc.currentData) || !isPresetCatalog(presetsDoc.currentData)) {
    return null;
  }

  const stage = campaignDoc.currentData.stages[stageIndex];
  const level = stage?.levels[levelIndex];
  if (!stage || !level) {
    return null;
  }

  const preset = presetsDoc.currentData.presets[level.wavePlan.preset];
  if (!preset) {
    return null;
  }

  const mapDoc = workspace.docs[`/levels/v2/${level.mapId}.json`];
  if (!mapDoc || !isCampaignMap(mapDoc.currentData)) {
    return null;
  }

  const resolvedWavePlan = resolveWavePlan(level.wavePlan, preset);
  const baseLevel = campaignMapToLevelJson(stage.id, level.id, level.displayName, level.objectivesText, mapDoc.currentData, resolvedWavePlan.preset, resolvedWavePlan.missionDifficultyScalar);
  return {
    missionLabel: level.displayName,
    missionKey: `${stage.id}:${level.id}:m01`,
    baseLevel,
    wavePlan: resolvedWavePlan,
    difficulty: {
      stageId: level.difficulty.stageId,
      missionIndex: level.difficulty.missionIndex,
    },
    allowedEnemyIds: [...new Set(level.archetypeAllowlist)],
  };
}

function buildLevelMissionResolveInput(
  workspace: LevelEditorWorkspace,
  docId: string,
  missionIndex: number,
): ResolveMissionInput | null {
  const levelDoc = workspace.docs[docId];
  if (!levelDoc || !isLevelJson(levelDoc.currentData)) {
    return null;
  }
  const mission = levelDoc.currentData.missions[missionIndex];
  if (!mission) {
    return null;
  }

  const presetsDoc = workspace.docs["/data/waves/presets.json"];
  const presetCatalog = presetsDoc && isPresetCatalog(presetsDoc.currentData) ? presetsDoc.currentData : null;
  const fallbackPreset = presetCatalog ? firstPreset(presetCatalog) : null;
  const selectedPreset = presetCatalog?.presets[mission.waveSetId] ?? fallbackPreset;
  if (!selectedPreset) {
    return null;
  }

  const resolvedWavePlan = {
    preset: selectedPreset.id,
    waves: selectedPreset.waves,
    missionDifficultyScalar: mission.difficulty ?? selectedPreset.missionDifficultyScalar,
    firstAppearanceWave: selectedPreset.firstAppearanceWave ?? 1,
    minibossWave: selectedPreset.minibossWave ?? null,
    bossEnabled: selectedPreset.bossEnabled ?? false,
  };

  return {
    missionLabel: mission.name,
    missionKey: `${levelDoc.currentData.stageId}:${levelDoc.currentData.levelId}:${mission.missionId}`,
    baseLevel: levelDoc.currentData,
    wavePlan: resolvedWavePlan,
    difficulty: {
      stageId: levelDoc.currentData.stageId,
      missionIndex,
    },
    allowedEnemyIds: null,
  };
}

function readWaveDependencies(workspace: LevelEditorWorkspace): LoadedWaveContent | null {
  const enemyCatalog = castDoc<EnemyCatalog>(workspace, "/data/enemyArchetypes.json");
  const modifierCatalog = castDoc<WaveModifierCatalog>(workspace, "/data/wave-modifiers.json");
  const handcraftedWaves = castDoc<HandcraftedWaveCatalog>(workspace, "/data/waves-handcrafted.json");
  const balance = castDoc<WaveBalanceConfig>(workspace, "/data/wave-balance.json");
  const balanceBaselines = castDoc<BalanceBaselinesConfig>(workspace, "/data/balanceBaselines.json");
  const difficultyTiers = castDoc<DifficultyTierCatalog>(workspace, "/data/difficultyTiers.json");
  const wavePacingTargets = castDoc<WavePacingTargetCatalog>(workspace, "/data/wavePacingTargets.json");
  if (
    !enemyCatalog ||
    !modifierCatalog ||
    !handcraftedWaves ||
    !balance ||
    !balanceBaselines ||
    !difficultyTiers ||
    !wavePacingTargets
  ) {
    return null;
  }

  const stageDifficulty = castDoc<StageDifficultyCatalog>(workspace, "/data/difficulty/stages.json");
  const ascensionDifficulty = castDoc<AscensionDifficultyCatalog>(workspace, "/data/difficulty/ascensions.json");

  return {
    enemyCatalog,
    modifierCatalog,
    handcraftedWaves,
    balance,
    balanceBaselines,
    difficultyTiers,
    wavePacingTargets,
    stageDifficulty,
    ascensionDifficulty,
  };
}

function castDoc<T>(workspace: LevelEditorWorkspace, path: string): T | null {
  const doc = workspace.docs[path];
  if (!doc || !doc.currentData || doc.parseError || doc.loadError) {
    return null;
  }
  return doc.currentData as T;
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
): ResolveMissionInput["wavePlan"] {
  return {
    preset: wavePlanRef.preset,
    waves: clampInt(wavePlanRef.waves ?? preset.waves, 1, 12),
    missionDifficultyScalar: clamp(preset.missionDifficultyScalar, 0.6, 2),
    firstAppearanceWave: clampInt(wavePlanRef.firstAppearanceWave ?? preset.firstAppearanceWave ?? 1, 1, 12),
    minibossWave: wavePlanRef.minibossWave ?? preset.minibossWave ?? null,
    bossEnabled: wavePlanRef.bossEnabled ?? preset.bossEnabled ?? false,
  };
}

function campaignMapToLevelJson(
  stageId: string,
  levelId: string,
  displayName: string,
  objectiveText: string,
  map: CampaignMapDefinition,
  waveSetId: string,
  missionDifficulty: number,
): LevelJson {
  const width = Math.max(8, Math.floor(map.size.w));
  const height = Math.max(8, Math.floor(map.size.h));
  const playerAnchor = map.nodes.find((node) => node.owner === "player")?.id ?? "p_start";
  const enemyAnchor = map.nodes.find((node) => node.owner === "enemy")?.id ?? "e_start";

  return {
    version: 1,
    stageId,
    levelId,
    name: displayName,
    size: map.nodes.length <= 12 ? "small" : map.nodes.length <= 18 ? "medium" : "big",
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
    nodes: map.nodes.map((node) => {
      const isStronghold = node.id === playerAnchor || node.id === enemyAnchor;
      return {
        id: node.id,
        x: Math.max(0, Math.min(width - 1, Math.round(node.x))),
        y: Math.max(0, Math.min(height - 1, Math.round(node.y))),
        type: isStronghold ? "stronghold" : "tower",
        owner: node.owner,
        regen: node.regen,
        cap: node.cap,
        troops: node.owner === "player" ? (isStronghold ? 42 : 24) : node.owner === "enemy" ? (isStronghold ? 34 : 22) : 16,
      };
    }),
    edges: map.links.map((link) => ({ from: link.a, to: link.b })),
    missions: [
      {
        missionId: "m01",
        name: displayName,
        seed: hashSeed(`${stageId}:${levelId}:${map.id}`),
        waveSetId,
        objectiveText,
        difficulty: missionDifficulty,
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
  };
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
  return isObject(value) && value.version === 1 && Array.isArray(value.missions) && Array.isArray(value.nodes);
}

function firstPreset(catalog: CampaignWavePresetCatalog): CampaignWavePreset | null {
  const ids = Object.keys(catalog.presets).sort((left, right) => left.localeCompare(right));
  if (ids.length === 0) {
    return null;
  }
  return catalog.presets[ids[0]] ?? null;
}

function deriveStageIndex(stageId: string): number {
  const match = stageId.match(/(\d+)/);
  if (!match) {
    return 1;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createResolveOptions(tierId: DifficultyTierId, runDifficultyScalar: number): ResolveMissionOptions {
  return {
    tierId,
    runDifficultyScalar,
    ascensionLevel: 0,
  };
}
