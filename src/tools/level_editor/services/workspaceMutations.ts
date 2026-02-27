import type {
  CampaignLevelDefinition,
  CampaignSpecV2,
  CampaignWavePresetCatalog,
} from "../../../campaign/CampaignTypes";
import type { LevelMission, LevelJson } from "../../../levels/types";
import { ensureTrailingNewline, parseJsonSafe, toPrettyJson } from "../model/json";
import type {
  LevelEditorDocument,
  LevelEditorSelection,
  LevelEditorWorkspace,
} from "../model/types";

export function setDocumentRaw(
  workspace: LevelEditorWorkspace,
  docId: string,
  raw: string,
): LevelEditorWorkspace {
  const document = workspace.docs[docId];
  if (!document) {
    return workspace;
  }
  const parsed = parseJsonSafe(raw);
  return withUpdatedDocument(workspace, docId, {
    ...document,
    currentRaw: ensureTrailingNewline(raw),
    currentData: parsed.error ? null : (parsed.data as LevelEditorDocument["currentData"]),
    parseError: parsed.error,
  });
}

export function setDocumentData(
  workspace: LevelEditorWorkspace,
  docId: string,
  data: unknown,
): LevelEditorWorkspace {
  const document = workspace.docs[docId];
  if (!document) {
    return workspace;
  }
  return withUpdatedDocument(workspace, docId, {
    ...document,
    currentData: data as LevelEditorDocument["currentData"],
    currentRaw: ensureTrailingNewline(toPrettyJson(data)),
    parseError: null,
  });
}

export function revertDocument(workspace: LevelEditorWorkspace, docId: string): LevelEditorWorkspace {
  const document = workspace.docs[docId];
  if (!document) {
    return workspace;
  }

  return withUpdatedDocument(workspace, docId, {
    ...document,
    currentRaw: document.originalRaw,
    currentData: document.originalData,
    parseError: null,
  });
}

export function mutateCampaignMission(
  workspace: LevelEditorWorkspace,
  docId: string,
  stageIndex: number,
  levelIndex: number,
  mutator: (level: CampaignLevelDefinition) => CampaignLevelDefinition,
): LevelEditorWorkspace {
  const document = workspace.docs[docId];
  if (!document || !isCampaignSpec(document.currentData)) {
    return workspace;
  }
  const stage = document.currentData.stages[stageIndex];
  if (!stage) {
    return workspace;
  }
  const level = stage.levels[levelIndex];
  if (!level) {
    return workspace;
  }

  const nextCampaign: CampaignSpecV2 = {
    ...document.currentData,
    stages: document.currentData.stages.map((entry, index) => {
      if (index !== stageIndex) {
        return entry;
      }
      return {
        ...entry,
        levels: entry.levels.map((candidate, candidateIndex) =>
          candidateIndex === levelIndex ? mutator(candidate) : candidate,
        ),
      };
    }),
  };

  return setDocumentData(workspace, docId, nextCampaign);
}

export function duplicateCampaignMission(
  workspace: LevelEditorWorkspace,
  docId: string,
  stageIndex: number,
  levelIndex: number,
): LevelEditorWorkspace {
  return mutateCampaignStage(workspace, docId, stageIndex, (stage) => {
    const level = stage.levels[levelIndex];
    if (!level) {
      return stage;
    }
    const nextId = uniquifyId(
      `${level.id}_copy`,
      new Set(stage.levels.map((entry) => entry.id)),
    );
    const duplicate: CampaignLevelDefinition = {
      ...level,
      id: nextId,
      displayName: `${level.displayName} Copy`,
    };
    const levels = [...stage.levels];
    levels.splice(levelIndex + 1, 0, duplicate);
    return {
      ...stage,
      levels,
    };
  });
}

export function mutatePreset(
  workspace: LevelEditorWorkspace,
  docId: string,
  presetId: string,
  mutator: (preset: CampaignWavePresetCatalog["presets"][string]) => CampaignWavePresetCatalog["presets"][string],
): LevelEditorWorkspace {
  const document = workspace.docs[docId];
  if (!document || !isWavePresetCatalog(document.currentData)) {
    return workspace;
  }
  const existing = document.currentData.presets[presetId];
  if (!existing) {
    return workspace;
  }
  const nextCatalog: CampaignWavePresetCatalog = {
    ...document.currentData,
    presets: {
      ...document.currentData.presets,
      [presetId]: mutator(existing),
    },
  };
  return setDocumentData(workspace, docId, nextCatalog);
}

export function mutateLevel(
  workspace: LevelEditorWorkspace,
  docId: string,
  mutator: (level: LevelJson) => LevelJson,
): LevelEditorWorkspace {
  const document = workspace.docs[docId];
  if (!document || !isLevelJson(document.currentData)) {
    return workspace;
  }
  return setDocumentData(workspace, docId, mutator(document.currentData));
}

export function mutateLevelMission(
  workspace: LevelEditorWorkspace,
  docId: string,
  missionIndex: number,
  mutator: (mission: LevelMission) => LevelMission,
): LevelEditorWorkspace {
  return mutateLevel(workspace, docId, (level) => {
    const mission = level.missions[missionIndex];
    if (!mission) {
      return level;
    }
    return {
      ...level,
      missions: level.missions.map((entry, index) => (index === missionIndex ? mutator(entry) : entry)),
    };
  });
}

export function duplicateLevel(
  workspace: LevelEditorWorkspace,
  docId: string,
): LevelEditorWorkspace {
  const document = workspace.docs[docId];
  if (!document || !isLevelJson(document.currentData)) {
    return workspace;
  }

  const baseLevel = document.currentData;
  const existingLevelIds = new Set(
    Object.values(workspace.docs)
      .map((doc) => doc.currentData)
      .filter(isLevelJson)
      .map((level) => `${level.stageId}:${level.levelId}`),
  );

  const nextLevelId = uniquifyId(`${baseLevel.levelId}_copy`, existingLevelIds, `${baseLevel.stageId}:`);
  const duplicatedLevel: LevelJson = {
    ...baseLevel,
    levelId: nextLevelId,
    name: `${baseLevel.name} Copy`,
  };
  const nextPath = `/levels/${baseLevel.stageId}/${nextLevelId}.json`;

  const nextDoc: LevelEditorDocument = {
    id: nextPath,
    path: nextPath,
    label: `${nextLevelId}.json`,
    kind: "level-json",
    group: "levels",
    originalRaw: "",
    currentRaw: ensureTrailingNewline(toPrettyJson(duplicatedLevel)),
    originalData: null,
    currentData: duplicatedLevel,
    parseError: null,
    loadError: null,
    isSynthetic: true,
  };

  return {
    ...workspace,
    updatedAt: Date.now(),
    order: [...workspace.order, nextDoc.id],
    docs: {
      ...workspace.docs,
      [nextDoc.id]: nextDoc,
    },
  };
}

export function selectionToOwningDocId(selection: LevelEditorSelection): string {
  return selection.docId;
}

function mutateCampaignStage(
  workspace: LevelEditorWorkspace,
  docId: string,
  stageIndex: number,
  mutator: (stage: CampaignSpecV2["stages"][number]) => CampaignSpecV2["stages"][number],
): LevelEditorWorkspace {
  const document = workspace.docs[docId];
  if (!document || !isCampaignSpec(document.currentData)) {
    return workspace;
  }
  const stage = document.currentData.stages[stageIndex];
  if (!stage) {
    return workspace;
  }

  const nextCampaign: CampaignSpecV2 = {
    ...document.currentData,
    stages: document.currentData.stages.map((entry, index) => (index === stageIndex ? mutator(entry) : entry)),
  };

  return setDocumentData(workspace, docId, nextCampaign);
}

function withUpdatedDocument(
  workspace: LevelEditorWorkspace,
  docId: string,
  nextDocument: LevelEditorDocument,
): LevelEditorWorkspace {
  return {
    ...workspace,
    updatedAt: Date.now(),
    docs: {
      ...workspace.docs,
      [docId]: nextDocument,
    },
  };
}

function uniquifyId(baseId: string, existing: Set<string>, prefix = ""): string {
  let candidate = `${prefix}${baseId}`;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${prefix}${baseId}_${suffix}`;
    suffix += 1;
  }
  return prefix ? candidate.slice(prefix.length) : candidate;
}

function isCampaignSpec(value: unknown): value is CampaignSpecV2 {
  return typeof value === "object" && value !== null && (value as { version?: number }).version === 2;
}

function isWavePresetCatalog(value: unknown): value is CampaignWavePresetCatalog {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: number }).version === 1 &&
    typeof (value as { presets?: unknown }).presets === "object"
  );
}

function isLevelJson(value: unknown): value is LevelJson {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: number }).version === 1 &&
    typeof (value as { stageId?: unknown }).stageId === "string" &&
    typeof (value as { levelId?: unknown }).levelId === "string" &&
    Array.isArray((value as { nodes?: unknown[] }).nodes)
  );
}
