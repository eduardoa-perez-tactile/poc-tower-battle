/*
 * Patch Notes (2026-02-24):
 * - Added campaign v2 validator for progression, dynamic, and data consistency checks.
 */

import type {
  CampaignMapDefinition,
  CampaignMissionRuntimeMeta,
  CampaignSpecV2,
  CampaignWavePresetCatalog,
} from "./CampaignTypes";

export interface CampaignValidationIssue {
  path: string;
  message: string;
}

export interface CampaignValidationResult {
  valid: boolean;
  issues: CampaignValidationIssue[];
}

const EXPECTED_LEVEL_COUNT = 20;
const EXPECTED_STAGE_IDS = ["training", "core"] as const;

export function validateCampaignSpec(
  campaign: CampaignSpecV2,
  presets: CampaignWavePresetCatalog,
  mapById: ReadonlyMap<string, CampaignMapDefinition> | null = null,
): CampaignValidationResult {
  const issues: CampaignValidationIssue[] = [];

  if (campaign.version !== 2) {
    issues.push({ path: "version", message: "Campaign version must be 2." });
  }

  if (!Array.isArray(campaign.stages) || campaign.stages.length === 0) {
    issues.push({ path: "stages", message: "Campaign must define at least one stage." });
    return { valid: false, issues };
  }

  const stageIds = new Set<string>();
  const levelIds = new Set<string>();
  const mapIds = new Set<string>();
  const trainingDynamics = new Set<string>();
  let levelCount = 0;

  for (let stageIndex = 0; stageIndex < campaign.stages.length; stageIndex += 1) {
    const stage = campaign.stages[stageIndex];
    if (!stage.id) {
      issues.push({ path: `stages[${stageIndex}].id`, message: "Stage id must be non-empty." });
    }
    if (stageIds.has(stage.id)) {
      issues.push({ path: `stages[${stageIndex}].id`, message: `Duplicate stage id ${stage.id}.` });
    }
    stageIds.add(stage.id);

    if (!Array.isArray(stage.levels) || stage.levels.length === 0) {
      issues.push({ path: `stages[${stageIndex}].levels`, message: "Stage must include at least one level." });
      continue;
    }

    for (let levelIndex = 0; levelIndex < stage.levels.length; levelIndex += 1) {
      const level = stage.levels[levelIndex];
      const path = `stages[${stageIndex}].levels[${levelIndex}]`;
      levelCount += 1;

      if (!level.id) {
        issues.push({ path: `${path}.id`, message: "Level id must be non-empty." });
      } else if (levelIds.has(level.id)) {
        issues.push({ path: `${path}.id`, message: `Duplicate level id ${level.id}.` });
      }
      levelIds.add(level.id);

      if (!level.dynamic) {
        issues.push({ path: `${path}.dynamic`, message: "Level must define exactly one dynamic identifier." });
      } else if (stage.id === "training") {
        if (trainingDynamics.has(level.dynamic)) {
          issues.push({ path: `${path}.dynamic`, message: `Training dynamic ${level.dynamic} is duplicated.` });
        }
        trainingDynamics.add(level.dynamic);
      }

      if (!level.mapId) {
        issues.push({ path: `${path}.mapId`, message: "mapId is required." });
      } else if (mapIds.has(level.mapId)) {
        issues.push({ path: `${path}.mapId`, message: `Duplicate map id reference ${level.mapId}.` });
      }
      mapIds.add(level.mapId);

      if (mapById && level.mapId && !mapById.has(level.mapId)) {
        issues.push({ path: `${path}.mapId`, message: `Missing map file for ${level.mapId}.` });
      } else if (mapById && level.mapId) {
        const map = mapById.get(level.mapId);
        if (map) {
          validateMapDefinition(map, `${path}.map`, issues);
        }
      }

      if (!level.objectivesText || level.objectivesText.trim().length === 0) {
        issues.push({ path: `${path}.objectivesText`, message: "Objective text is required." });
      }

      if (level.tutorialId !== undefined) {
        if (typeof level.tutorialId !== "string" || level.tutorialId.trim().length === 0) {
          issues.push({ path: `${path}.tutorialId`, message: "tutorialId must be a non-empty string when provided." });
        }
      }

      if (!Array.isArray(level.hints)) {
        issues.push({ path: `${path}.hints`, message: "Hints must be an array." });
      } else {
        if (level.hints.length > 3) {
          issues.push({ path: `${path}.hints`, message: "Hints must contain at most 3 entries." });
        }
        for (let hintIndex = 0; hintIndex < level.hints.length; hintIndex += 1) {
          const hint = level.hints[hintIndex];
          if (!hint.text || hint.text.trim().length === 0) {
            issues.push({ path: `${path}.hints[${hintIndex}].text`, message: "Hint text must be non-empty." });
          }
        }
      }

      if (!Array.isArray(level.archetypeAllowlist) || level.archetypeAllowlist.length === 0) {
        issues.push({ path: `${path}.archetypeAllowlist`, message: "Archetype allowlist must be non-empty." });
      }

      if (!level.wavePlan?.preset) {
        issues.push({ path: `${path}.wavePlan.preset`, message: "wavePlan preset is required." });
      } else if (!presets.presets[level.wavePlan.preset]) {
        issues.push({
          path: `${path}.wavePlan.preset`,
          message: `Unknown wave preset ${level.wavePlan.preset}.`,
        });
      }

      if (!level.difficulty || !level.difficulty.stageId) {
        issues.push({ path: `${path}.difficulty`, message: "Difficulty mapping is required." });
      } else if (!Number.isFinite(level.difficulty.missionIndex) || level.difficulty.missionIndex < 0) {
        issues.push({
          path: `${path}.difficulty.missionIndex`,
          message: "difficulty.missionIndex must be >= 0.",
        });
      }

      validateDynamicAllowlistConsistency(level.dynamic, level.archetypeAllowlist, path, issues);
    }
  }

  if (levelCount !== EXPECTED_LEVEL_COUNT) {
    issues.push({
      path: "stages",
      message: `Campaign must define exactly ${EXPECTED_LEVEL_COUNT} levels (found ${levelCount}).`,
    });
  }

  for (const expectedStage of EXPECTED_STAGE_IDS) {
    if (!stageIds.has(expectedStage)) {
      issues.push({ path: "stages", message: `Expected stage id ${expectedStage} was not found.` });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function validateCampaignMissionMeta(
  missionMeta: Readonly<Record<string, CampaignMissionRuntimeMeta>>,
): CampaignValidationResult {
  const issues: CampaignValidationIssue[] = [];
  for (const [missionKey, meta] of Object.entries(missionMeta)) {
    if (!meta.wavePlan.preset) {
      issues.push({ path: `${missionKey}.wavePlan.preset`, message: "Resolved preset missing." });
    }
    if (!Array.isArray(meta.archetypeAllowlist) || meta.archetypeAllowlist.length === 0) {
      issues.push({ path: `${missionKey}.archetypeAllowlist`, message: "Allowlist is empty." });
    }
    if (!Number.isFinite(meta.wavePlan.waves) || meta.wavePlan.waves < 1) {
      issues.push({ path: `${missionKey}.wavePlan.waves`, message: "Wave count must be >= 1." });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

function validateDynamicAllowlistConsistency(
  dynamicId: string,
  allowlist: string[],
  path: string,
  issues: CampaignValidationIssue[],
): void {
  const requirements: Array<{ token: string; archetype: string }> = [
    { token: "swarm", archetype: "swarm" },
    { token: "tank", archetype: "tank" },
    { token: "shield", archetype: "shield" },
    { token: "support", archetype: "support" },
    { token: "disruptor", archetype: "link_cutter" },
    { token: "splitter", archetype: "splitter" },
    { token: "miniboss", archetype: "miniboss_brute" },
    { token: "boss", archetype: "overseer_boss" },
  ];

  const normalizedAllowlist = new Set(allowlist);
  const dynamic = dynamicId.toLowerCase();

  for (const requirement of requirements) {
    const matched =
      requirement.token === "boss"
        ? dynamic.includes("boss") && !dynamic.includes("miniboss")
        : dynamic.includes(requirement.token);
    if (!matched) {
      continue;
    }
    if (!normalizedAllowlist.has(requirement.archetype)) {
      issues.push({
        path: `${path}.archetypeAllowlist`,
        message: `Dynamic ${dynamicId} expects ${requirement.archetype} in allowlist.`,
      });
    }
  }
}

function validateMapDefinition(
  map: CampaignMapDefinition,
  path: string,
  issues: CampaignValidationIssue[],
): void {
  if (map.nodes.length < 8 || map.nodes.length > 25) {
    issues.push({ path: `${path}.nodes`, message: "Map node count must be between 8 and 25." });
  }
  if (map.tags.lanes < 1) {
    issues.push({ path: `${path}.tags.lanes`, message: "Map lanes must be >= 1." });
  }

  const nodeIds = new Set<string>();
  for (const node of map.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({ path: `${path}.nodes`, message: `Duplicate node id ${node.id}.` });
    }
    nodeIds.add(node.id);
  }

  for (let linkIndex = 0; linkIndex < map.links.length; linkIndex += 1) {
    const link = map.links[linkIndex];
    if (!nodeIds.has(link.a) || !nodeIds.has(link.b)) {
      issues.push({ path: `${path}.links[${linkIndex}]`, message: "Link references unknown node id." });
    }
  }
}
