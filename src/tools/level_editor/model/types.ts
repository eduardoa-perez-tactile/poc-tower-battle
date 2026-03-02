import type { DifficultyTierId } from "../../../config/Difficulty";
import type { CampaignMapDefinition, CampaignSpecV2, CampaignWavePresetCatalog } from "../../../campaign/CampaignTypes";
import type { LevelJson } from "../../../levels/types";
import type { TutorialCatalog } from "../../../tutorial/TutorialTypes";
import type {
  BalanceBaselinesConfig,
  EnemyCatalog,
  HandcraftedWaveCatalog,
  WaveBalanceConfig,
  WaveModifierCatalog,
  DifficultyTierCatalog,
  WavePacingTargetCatalog,
} from "../../../waves/Definitions";
import type { AscensionDifficultyCatalog, StageDifficultyCatalog } from "../../../waves/DifficultyTypes";

export const LEVEL_EDITOR_WORKSPACE_VERSION = 1;
export const LEVEL_EDITOR_WORKSPACE_STORAGE_KEY = "tower-battle.level-editor.workspace.v1";

export type LevelEditorKnownJson =
  | CampaignSpecV2
  | CampaignWavePresetCatalog
  | CampaignMapDefinition
  | LevelJson
  | EnemyCatalog
  | WaveModifierCatalog
  | HandcraftedWaveCatalog
  | WaveBalanceConfig
  | BalanceBaselinesConfig
  | DifficultyTierCatalog
  | WavePacingTargetCatalog
  | StageDifficultyCatalog
  | AscensionDifficultyCatalog
  | TutorialCatalog
  | Record<string, unknown>
  | Array<unknown>;

export type LevelEditorDocKind =
  | "campaign"
  | "wave-presets"
  | "wave-balance"
  | "balance-baselines"
  | "difficulty-tiers"
  | "stage-difficulty"
  | "ascension-difficulty"
  | "wave-modifiers"
  | "enemy-archetypes"
  | "waves-handcrafted"
  | "wave-pacing-targets"
  | "tutorial-catalog"
  | "mission-catalog"
  | "level-json"
  | "legacy-level"
  | "campaign-map"
  | "unknown";

export interface LevelEditorDocument {
  id: string;
  path: string;
  label: string;
  kind: LevelEditorDocKind;
  group: "campaign" | "levels" | "presets" | "globals" | "maps" | "tutorials" | "other";
  originalRaw: string;
  currentRaw: string;
  originalData: LevelEditorKnownJson | null;
  currentData: LevelEditorKnownJson | null;
  parseError: string | null;
  loadError: string | null;
  isSynthetic: boolean;
}

export interface LevelEditorWorkspace {
  version: number;
  createdAt: number;
  updatedAt: number;
  order: string[];
  docs: Record<string, LevelEditorDocument>;
}

export type LevelEditorSelection =
  | { type: "file"; docId: string }
  | { type: "campaign-stage"; docId: string; stageIndex: number }
  | { type: "campaign-level"; docId: string; stageIndex: number; levelIndex: number }
  | { type: "campaign-mission"; docId: string; stageIndex: number; levelIndex: number }
  | { type: "preset"; docId: string; presetId: string }
  | { type: "level-mission"; docId: string; missionIndex: number };

export interface LevelEditorLibraryNode {
  id: string;
  parentId: string | null;
  depth: number;
  label: string;
  searchableText: string;
  selectable: boolean;
  selection: LevelEditorSelection | null;
  kind: "group" | "entry";
}

export interface LevelEditorIssue {
  severity: "error" | "warning";
  filePath: string;
  message: string;
  fieldPath?: string;
}

export interface LevelEditorResolvedWave {
  waveIndex: number;
  budget: number;
  cooldownSec: number;
  eliteChance: number;
  minibossChance: number;
  isBossWave: boolean;
  hasMiniBossEscort: boolean;
  spawnCountEstimate: number;
  spawnIntervalEstimateSec: number;
  hpScale: number;
  damageScale: number;
  speedScale: number;
  compositionByEnemyId: Record<string, number>;
}

export interface LevelEditorResolvedMission {
  missionLabel: string;
  missionKey: string;
  tierId: DifficultyTierId;
  runDifficultyScalar: number;
  waveCount: number;
  firstAppearanceWave: number;
  minibossWave: number | null;
  bossEnabled: boolean;
  waves: LevelEditorResolvedWave[];
  resolvedJson: Record<string, unknown>;
}

export interface LevelEditorPersistedSnapshot {
  version: number;
  updatedAt: number;
  docs: Array<{
    path: string;
    currentRaw: string;
    kind: LevelEditorDocKind;
    label: string;
    group: LevelEditorDocument["group"];
    isSynthetic: boolean;
  }>;
}

export interface ResolveMissionOptions {
  tierId: DifficultyTierId;
  runDifficultyScalar: number;
  ascensionLevel: number;
}
