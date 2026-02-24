/*
 * Patch Notes (2026-02-24):
 * - Added campaign v2 schema types for tutorial-first progression content.
 */

export type CampaignDynamicId =
  | "none"
  | "travel_time"
  | "multi_front"
  | "swarm"
  | "tank"
  | "shield"
  | "support"
  | "territory_clusters"
  | "tempo_compression"
  | "disruptor"
  | "splitter"
  | "boss_intro"
  | "swarm_multi_front"
  | "tank_chokepoint"
  | "shield_support"
  | "territory_tempo"
  | "disruptor_multi_front"
  | "splitter_tempo"
  | "miniboss_escort"
  | "final_boss"
  | string;

export type CampaignHintTrigger =
  | "onStart"
  | "onFirstCapture"
  | "onFirstLoss"
  | "onWaveStart"
  | "onFirstDisruptorSeen";

export interface CampaignHintDefinition {
  trigger: CampaignHintTrigger;
  text: string;
  wave?: number;
}

export interface CampaignDifficultyRef {
  stageId: string;
  missionIndex: number;
}

export interface CampaignWavePlanRef {
  preset: string;
  waves?: number;
  firstAppearanceWave?: number;
  minibossWave?: number;
  bossEnabled?: boolean;
}

export interface CampaignLevelDefinition {
  id: string;
  displayName: string;
  mapId: string;
  difficulty: CampaignDifficultyRef;
  dynamic: CampaignDynamicId;
  teaches: string[];
  reinforces: string[];
  objectivesText: string;
  hints: CampaignHintDefinition[];
  archetypeAllowlist: string[];
  wavePlan: CampaignWavePlanRef;
}

export interface CampaignStageDefinition {
  id: string;
  displayName: string;
  levels: CampaignLevelDefinition[];
}

export interface CampaignSpecV2 {
  version: 2;
  stages: CampaignStageDefinition[];
}

export interface CampaignWavePreset {
  id: string;
  waves: number;
  missionDifficultyScalar: number;
  firstAppearanceWave?: number;
  minibossWave?: number;
  bossEnabled?: boolean;
}

export interface CampaignWavePresetCatalog {
  version: 1;
  presets: Record<string, CampaignWavePreset>;
}

export interface CampaignMapNode {
  id: string;
  x: number;
  y: number;
  owner: "player" | "enemy" | "neutral";
  tier: number;
  cap: number;
  regen: number;
}

export interface CampaignMapLink {
  a: string;
  b: string;
}

export interface CampaignMapDefinition {
  id: string;
  size: {
    w: number;
    h: number;
  };
  nodes: CampaignMapNode[];
  links: CampaignMapLink[];
  tags: {
    chokepoints: number;
    linkDensity: number;
    lanes: number;
  };
}

export interface ResolvedCampaignWavePlan {
  preset: string;
  waves: number;
  missionDifficultyScalar: number;
  firstAppearanceWave: number;
  minibossWave?: number;
  bossEnabled: boolean;
}

export interface CampaignMissionRuntimeMeta {
  stageId: string;
  levelId: string;
  missionId: string;
  dynamic: CampaignDynamicId;
  teaches: string[];
  reinforces: string[];
  hints: CampaignHintDefinition[];
  archetypeAllowlist: string[];
  difficulty: CampaignDifficultyRef;
  wavePlan: ResolvedCampaignWavePlan;
  mapId: string;
}
