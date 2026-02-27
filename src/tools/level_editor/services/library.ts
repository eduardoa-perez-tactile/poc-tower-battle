import type { CampaignSpecV2, CampaignWavePresetCatalog } from "../../../campaign/CampaignTypes";
import type { LevelJson } from "../../../levels/types";
import { isObject } from "../model/json";
import type {
  LevelEditorLibraryNode,
  LevelEditorSelection,
  LevelEditorWorkspace,
} from "../model/types";

export function buildLibrary(workspace: LevelEditorWorkspace, searchText: string): LevelEditorLibraryNode[] {
  const query = searchText.trim().toLowerCase();
  const nodes = buildAllNodes(workspace);
  if (!query) {
    return nodes;
  }

  const included = new Set<string>();
  for (const node of nodes) {
    if (node.searchableText.toLowerCase().includes(query)) {
      included.add(node.id);
      let parentId = node.parentId;
      while (parentId) {
        included.add(parentId);
        parentId = nodes.find((candidate) => candidate.id === parentId)?.parentId ?? null;
      }
    }
  }

  return nodes.filter((node) => included.has(node.id));
}

function buildAllNodes(workspace: LevelEditorWorkspace): LevelEditorLibraryNode[] {
  const nodes: LevelEditorLibraryNode[] = [];

  const campaignRootId = "group:campaign";
  const levelsRootId = "group:levels";
  const presetsRootId = "group:presets";
  const globalsRootId = "group:globals";

  nodes.push(makeGroup(campaignRootId, null, 0, "Campaign"));
  nodes.push(makeGroup(levelsRootId, null, 0, "Standalone Levels"));
  nodes.push(makeGroup(presetsRootId, null, 0, "Presets"));
  nodes.push(makeGroup(globalsRootId, null, 0, "Global Config"));

  appendCampaignNodes(nodes, workspace, campaignRootId);
  appendLevelNodes(nodes, workspace, levelsRootId);
  appendPresetNodes(nodes, workspace, presetsRootId);
  appendGlobalNodes(nodes, workspace, globalsRootId);

  return nodes;
}

function appendCampaignNodes(nodes: LevelEditorLibraryNode[], workspace: LevelEditorWorkspace, rootId: string): void {
  const campaignDoc = workspace.docs["/data/campaign/campaign_v2.json"];
  if (!campaignDoc) {
    return;
  }

  const campaignEntryId = `entry:${campaignDoc.id}`;
  nodes.push(
    makeEntry(campaignEntryId, rootId, 1, "campaign_v2.json", {
      type: "file",
      docId: campaignDoc.id,
    }),
  );

  if (!isCampaignSpec(campaignDoc.currentData)) {
    return;
  }

  campaignDoc.currentData.stages.forEach((stage, stageIndex) => {
    const stageId = `campaign:stage:${stageIndex}`;
    nodes.push(
      makeEntry(stageId, campaignEntryId, 2, `${stage.displayName} (${stage.id})`, {
        type: "campaign-stage",
        docId: campaignDoc.id,
        stageIndex,
      }),
    );

    stage.levels.forEach((level, levelIndex) => {
      const levelId = `campaign:level:${stageIndex}:${levelIndex}`;
      nodes.push(
        makeEntry(levelId, stageId, 3, `${level.displayName} (${level.id})`, {
          type: "campaign-level",
          docId: campaignDoc.id,
          stageIndex,
          levelIndex,
        }),
      );
      nodes.push(
        makeEntry(
          `campaign:mission:${stageIndex}:${levelIndex}`,
          levelId,
          4,
          `Mission (${level.wavePlan.preset} / ${level.wavePlan.waves ?? "preset"} waves)`,
          {
            type: "campaign-mission",
            docId: campaignDoc.id,
            stageIndex,
            levelIndex,
          },
        ),
      );
    });
  });
}

function appendLevelNodes(nodes: LevelEditorLibraryNode[], workspace: LevelEditorWorkspace, rootId: string): void {
  const levelDocs = workspace.order
    .map((docId) => workspace.docs[docId])
    .filter((doc) => doc && (doc.kind === "level-json" || doc.kind === "legacy-level"));

  for (const doc of levelDocs) {
    if (!doc) {
      continue;
    }
    const levelNodeId = `entry:${doc.id}`;
    nodes.push(
      makeEntry(levelNodeId, rootId, 1, `${doc.label}${doc.isSynthetic ? " (workspace)" : ""}`, {
        type: "file",
        docId: doc.id,
      }),
    );

    if (!isLevelJson(doc.currentData)) {
      continue;
    }

    doc.currentData.missions.forEach((mission, missionIndex) => {
      nodes.push(
        makeEntry(
          `level-mission:${doc.id}:${missionIndex}`,
          levelNodeId,
          2,
          `${mission.name} (${mission.missionId})`,
          {
            type: "level-mission",
            docId: doc.id,
            missionIndex,
          },
        ),
      );
    });
  }
}

function appendPresetNodes(nodes: LevelEditorLibraryNode[], workspace: LevelEditorWorkspace, rootId: string): void {
  const presetDoc = workspace.docs["/data/waves/presets.json"];
  if (!presetDoc) {
    return;
  }
  const presetRootEntryId = `entry:${presetDoc.id}`;
  nodes.push(
    makeEntry(presetRootEntryId, rootId, 1, presetDoc.label, {
      type: "file",
      docId: presetDoc.id,
    }),
  );

  if (!isWavePresetCatalog(presetDoc.currentData)) {
    return;
  }

  for (const presetId of Object.keys(presetDoc.currentData.presets).sort((a, b) => a.localeCompare(b))) {
    const preset = presetDoc.currentData.presets[presetId];
    nodes.push(
      makeEntry(
        `preset:${presetId}`,
        presetRootEntryId,
        2,
        `${presetId} (${preset.waves}w / x${preset.missionDifficultyScalar.toFixed(2)})`,
        {
          type: "preset",
          docId: presetDoc.id,
          presetId,
        },
      ),
    );
  }
}

function appendGlobalNodes(nodes: LevelEditorLibraryNode[], workspace: LevelEditorWorkspace, rootId: string): void {
  const globalDocKinds = new Set([
    "wave-balance",
    "balance-baselines",
    "difficulty-tiers",
    "stage-difficulty",
    "ascension-difficulty",
    "wave-modifiers",
    "enemy-archetypes",
    "waves-handcrafted",
    "wave-pacing-targets",
    "mission-catalog",
    "campaign-map",
  ]);

  const globals = workspace.order
    .map((docId) => workspace.docs[docId])
    .filter((doc) => doc && globalDocKinds.has(doc.kind));

  for (const doc of globals) {
    if (!doc) {
      continue;
    }
    nodes.push(
      makeEntry(`entry:${doc.id}`, rootId, 1, doc.label, {
        type: "file",
        docId: doc.id,
      }),
    );
  }
}

function makeGroup(
  id: string,
  parentId: string | null,
  depth: number,
  label: string,
): LevelEditorLibraryNode {
  return {
    id,
    parentId,
    depth,
    label,
    searchableText: label,
    selectable: false,
    selection: null,
    kind: "group",
  };
}

function makeEntry(
  id: string,
  parentId: string,
  depth: number,
  label: string,
  selection: LevelEditorSelection,
): LevelEditorLibraryNode {
  return {
    id,
    parentId,
    depth,
    label,
    searchableText: `${label} ${selection.docId}`,
    selectable: true,
    selection,
    kind: "entry",
  };
}

function isCampaignSpec(value: unknown): value is CampaignSpecV2 {
  return isObject(value) && value.version === 2 && Array.isArray(value.stages);
}

function isWavePresetCatalog(value: unknown): value is CampaignWavePresetCatalog {
  return isObject(value) && value.version === 1 && isObject(value.presets);
}

function isLevelJson(value: unknown): value is LevelJson {
  return isObject(value) && value.version === 1 && Array.isArray(value.missions);
}
