import type { CampaignLevelDefinition, CampaignSpecV2, CampaignWavePresetCatalog } from "../../../campaign/CampaignTypes";
import type { LevelMission, LevelJson } from "../../../levels/types";
import { isObject } from "../model/json";
import type { LevelEditorSelection, LevelEditorWorkspace } from "../model/types";

export function getSelectedDoc(workspace: LevelEditorWorkspace, selection: LevelEditorSelection | null) {
  if (!selection) {
    return null;
  }
  return workspace.docs[selection.docId] ?? null;
}

export function getSelectedCampaignLevel(
  workspace: LevelEditorWorkspace,
  selection: LevelEditorSelection,
): CampaignLevelDefinition | null {
  if (selection.type !== "campaign-mission" && selection.type !== "campaign-level") {
    return null;
  }
  const campaign = getCampaign(workspace, selection.docId);
  if (!campaign) {
    return null;
  }
  return campaign.stages[selection.stageIndex]?.levels[selection.levelIndex] ?? null;
}

export function getSelectedPreset(
  workspace: LevelEditorWorkspace,
  selection: LevelEditorSelection,
): CampaignWavePresetCatalog["presets"][string] | null {
  if (selection.type !== "preset") {
    return null;
  }
  const catalog = getPresetCatalog(workspace, selection.docId);
  if (!catalog) {
    return null;
  }
  return catalog.presets[selection.presetId] ?? null;
}

export function getSelectedLevel(
  workspace: LevelEditorWorkspace,
  selection: LevelEditorSelection,
): LevelJson | null {
  if (selection.type !== "file" && selection.type !== "level-mission") {
    return null;
  }
  const doc = workspace.docs[selection.docId];
  if (!doc) {
    return null;
  }
  if (!isLevelJson(doc.currentData)) {
    return null;
  }
  return doc.currentData;
}

export function getSelectedLevelMission(
  workspace: LevelEditorWorkspace,
  selection: LevelEditorSelection,
): LevelMission | null {
  if (selection.type !== "level-mission") {
    return null;
  }
  const level = getSelectedLevel(workspace, selection);
  if (!level) {
    return null;
  }
  return level.missions[selection.missionIndex] ?? null;
}

function getCampaign(workspace: LevelEditorWorkspace, docId: string): CampaignSpecV2 | null {
  const doc = workspace.docs[docId];
  if (!doc || !isCampaignSpec(doc.currentData)) {
    return null;
  }
  return doc.currentData;
}

function getPresetCatalog(workspace: LevelEditorWorkspace, docId: string): CampaignWavePresetCatalog | null {
  const doc = workspace.docs[docId];
  if (!doc || !isPresetCatalog(doc.currentData)) {
    return null;
  }
  return doc.currentData;
}

function isCampaignSpec(value: unknown): value is CampaignSpecV2 {
  return isObject(value) && value.version === 2 && Array.isArray(value.stages);
}

function isPresetCatalog(value: unknown): value is CampaignWavePresetCatalog {
  return isObject(value) && value.version === 1 && isObject(value.presets);
}

function isLevelJson(value: unknown): value is LevelJson {
  return isObject(value) && value.version === 1 && Array.isArray(value.missions) && Array.isArray(value.nodes);
}
