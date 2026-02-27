import type { CampaignMapDefinition, CampaignSpecV2 } from "../../../campaign/CampaignTypes";
import type { LevelJson } from "../../../levels/types";
import { isObject } from "../model/json";
import type { LevelEditorSelection, LevelEditorWorkspace } from "../model/types";

export interface MapPreviewModel {
  width: number;
  height: number;
  nodes: Array<{
    id: string;
    x: number;
    y: number;
    owner: "player" | "enemy" | "neutral";
  }>;
  edges: Array<{ fromX: number; fromY: number; toX: number; toY: number }>;
}

export function buildMapPreviewModel(
  workspace: LevelEditorWorkspace,
  selection: LevelEditorSelection,
): MapPreviewModel | null {
  if (selection.type === "campaign-mission") {
    return buildCampaignMissionMapPreview(workspace, selection.docId, selection.stageIndex, selection.levelIndex);
  }

  if (selection.type === "file") {
    return buildFileMapPreview(workspace, selection.docId);
  }

  if (selection.type === "level-mission") {
    return buildFileMapPreview(workspace, selection.docId);
  }

  if (selection.type === "campaign-level" || selection.type === "campaign-stage") {
    return null;
  }

  return null;
}

function buildCampaignMissionMapPreview(
  workspace: LevelEditorWorkspace,
  docId: string,
  stageIndex: number,
  levelIndex: number,
): MapPreviewModel | null {
  const campaignDoc = workspace.docs[docId];
  if (!campaignDoc || !isCampaignSpec(campaignDoc.currentData)) {
    return null;
  }

  const stage = campaignDoc.currentData.stages[stageIndex];
  const level = stage?.levels[levelIndex];
  if (!level) {
    return null;
  }

  const mapDoc = workspace.docs[`/levels/v2/${level.mapId}.json`];
  if (!mapDoc || !isCampaignMap(mapDoc.currentData)) {
    return null;
  }

  return campaignMapToPreview(mapDoc.currentData);
}

function buildFileMapPreview(workspace: LevelEditorWorkspace, docId: string): MapPreviewModel | null {
  const doc = workspace.docs[docId];
  if (!doc || !doc.currentData) {
    return null;
  }

  if (isLevelJson(doc.currentData)) {
    return levelJsonToPreview(doc.currentData);
  }

  if (isCampaignMap(doc.currentData)) {
    return campaignMapToPreview(doc.currentData);
  }

  return legacyLevelToPreview(doc.currentData);
}

function campaignMapToPreview(map: CampaignMapDefinition): MapPreviewModel {
  const byId = new Map(map.nodes.map((node) => [node.id, node] as const));
  return {
    width: Math.max(1, map.size.w),
    height: Math.max(1, map.size.h),
    nodes: map.nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      owner: node.owner,
    })),
    edges: map.links
      .map((link) => {
        const from = byId.get(link.a);
        const to = byId.get(link.b);
        if (!from || !to) {
          return null;
        }
        return {
          fromX: from.x,
          fromY: from.y,
          toX: to.x,
          toY: to.y,
        };
      })
      .filter((edge): edge is { fromX: number; fromY: number; toX: number; toY: number } => edge !== null),
  };
}

function levelJsonToPreview(level: LevelJson): MapPreviewModel {
  const byId = new Map(level.nodes.map((node) => [node.id, node] as const));
  return {
    width: Math.max(1, level.grid.width),
    height: Math.max(1, level.grid.height),
    nodes: level.nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      owner: node.owner,
    })),
    edges: level.edges
      .map((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) {
          return null;
        }
        return {
          fromX: from.x,
          fromY: from.y,
          toX: to.x,
          toY: to.y,
        };
      })
      .filter((edge): edge is { fromX: number; fromY: number; toX: number; toY: number } => edge !== null),
  };
}

function legacyLevelToPreview(value: unknown): MapPreviewModel | null {
  if (!isObject(value) || !Array.isArray(value.towers)) {
    return null;
  }

  const nodes = value.towers
    .map((tower) => {
      if (!isObject(tower)) {
        return null;
      }
      if (
        typeof tower.id !== "string" ||
        typeof tower.x !== "number" ||
        typeof tower.y !== "number" ||
        (tower.owner !== "player" && tower.owner !== "enemy" && tower.owner !== "neutral")
      ) {
        return null;
      }
      return {
        id: tower.id,
        x: tower.x,
        y: tower.y,
        owner: tower.owner,
      };
    })
    .filter(
      (
        node,
      ): node is {
        id: string;
        x: number;
        y: number;
        owner: "player" | "enemy" | "neutral";
      } => node !== null,
    );

  if (nodes.length === 0) {
    return null;
  }

  const maxX = nodes.reduce((max, node) => Math.max(max, node.x), 1);
  const maxY = nodes.reduce((max, node) => Math.max(max, node.y), 1);

  return {
    width: maxX,
    height: maxY,
    nodes,
    edges: [],
  };
}

function isCampaignSpec(value: unknown): value is CampaignSpecV2 {
  return isObject(value) && value.version === 2 && Array.isArray(value.stages);
}

function isCampaignMap(value: unknown): value is CampaignMapDefinition {
  return isObject(value) && typeof value.id === "string" && Array.isArray(value.nodes) && Array.isArray(value.links);
}

function isLevelJson(value: unknown): value is LevelJson {
  return isObject(value) && value.version === 1 && isObject(value.grid) && Array.isArray(value.nodes) && Array.isArray(value.edges);
}
