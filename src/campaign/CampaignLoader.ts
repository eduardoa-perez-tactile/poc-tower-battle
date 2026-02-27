/*
 * Patch Notes (2026-02-24):
 * - Added loader that converts campaign_v2 + map_tXX data into StageRegistryEntry runtime levels.
 * - Added resolved mission metadata (difficulty mapping, allowlists, hints, wave presets).
 */

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
      const levelJson = mapToLevelJson(
        stage.id,
        level.id,
        level.displayName,
        level.objectivesText,
        map,
        resolvedWavePlan,
        missionId,
        level.tutorialId,
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

function mapToLevelJson(
  stageId: string,
  levelId: string,
  displayName: string,
  objectiveText: string,
  map: CampaignMapDefinition,
  wavePlan: ResolvedCampaignWavePlan,
  missionId: string,
  tutorialId?: string,
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
    waves: clampInt(wavePlanRef.waves ?? preset.waves, 1, 12),
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
