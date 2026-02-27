import { validateCampaignSpec } from "../../../campaign/CampaignValidator";
import type {
  CampaignMapDefinition,
  CampaignSpecV2,
  CampaignWavePresetCatalog,
} from "../../../campaign/CampaignTypes";
import { parseLevelJson } from "../../../levels/loader";
import type { LevelJson } from "../../../levels/types";
import type { EnemyCatalog, HandcraftedWaveCatalog, WaveBalanceConfig, WaveModifierCatalog } from "../../../waves/Definitions";
import type { StageDifficultyCatalog } from "../../../waves/DifficultyTypes";
import { isObject } from "../model/json";
import type { LevelEditorIssue, LevelEditorWorkspace } from "../model/types";

export function validateWorkspace(workspace: LevelEditorWorkspace): LevelEditorIssue[] {
  const issues: LevelEditorIssue[] = [];

  for (const docId of workspace.order) {
    const doc = workspace.docs[docId];
    if (!doc) {
      continue;
    }
    if (doc.loadError) {
      issues.push({
        severity: "error",
        filePath: doc.path,
        message: doc.loadError,
      });
      continue;
    }
    if (doc.parseError) {
      issues.push({
        severity: "error",
        filePath: doc.path,
        message: `Invalid JSON: ${doc.parseError}`,
      });
    }
  }

  const campaign = getCampaign(workspace);
  const presets = getPresetCatalog(workspace);
  const mapById = getCampaignMapById(workspace);
  if (campaign && presets) {
    const result = validateCampaignSpec(campaign, presets, mapById);
    for (const issue of result.issues) {
      issues.push({
        severity: "error",
        filePath: "/data/campaign/campaign_v2.json",
        message: issue.message,
        fieldPath: issue.path,
      });
    }
  }

  const enemies = getEnemyCatalog(workspace);
  const modifiers = getModifierCatalog(workspace);
  const handcrafted = getHandcraftedCatalog(workspace);
  const waveBalance = getWaveBalance(workspace);
  const stageDifficulty = getStageDifficulty(workspace);

  if (enemies) {
    const seenEnemyIds = new Set<string>();
    let positiveSpawnWeightSum = 0;
    enemies.archetypes.forEach((entry, index) => {
      if (seenEnemyIds.has(entry.id)) {
        issues.push({
          severity: "error",
          filePath: "/data/enemyArchetypes.json",
          message: `Duplicate enemy id ${entry.id}`,
          fieldPath: `archetypes[${index}].id`,
        });
      }
      seenEnemyIds.add(entry.id);

      if (!Number.isFinite(entry.spawnWeight) || entry.spawnWeight < 0) {
        issues.push({
          severity: "error",
          filePath: "/data/enemyArchetypes.json",
          message: `spawnWeight must be non-negative for ${entry.id}`,
          fieldPath: `archetypes[${index}].spawnWeight`,
        });
      }
      if (entry.spawnWeight > 0) {
        positiveSpawnWeightSum += entry.spawnWeight;
      }
    });

    if (positiveSpawnWeightSum <= 0) {
      issues.push({
        severity: "error",
        filePath: "/data/enemyArchetypes.json",
        message: "At least one enemy archetype must have spawnWeight > 0.",
      });
    }
  }

  if (modifiers) {
    const seenModifierIds = new Set<string>();
    modifiers.modifiers.forEach((modifier, index) => {
      if (seenModifierIds.has(modifier.id)) {
        issues.push({
          severity: "error",
          filePath: "/data/wave-modifiers.json",
          message: `Duplicate modifier id ${modifier.id}`,
          fieldPath: `modifiers[${index}].id`,
        });
      }
      seenModifierIds.add(modifier.id);
    });
  }

  if (handcrafted && enemies && modifiers) {
    const enemyIds = new Set(enemies.archetypes.map((entry) => entry.id));
    const modifierIds = new Set(modifiers.modifiers.map((entry) => entry.id));
    handcrafted.handcraftedWaves.forEach((wave, waveIndex) => {
      wave.modifiers.forEach((modifierId, modifierIndex) => {
        if (!modifierIds.has(modifierId)) {
          issues.push({
            severity: "error",
            filePath: "/data/waves-handcrafted.json",
            message: `Unknown modifier ${modifierId}`,
            fieldPath: `handcraftedWaves[${waveIndex}].modifiers[${modifierIndex}]`,
          });
        }
      });
      wave.entries.forEach((entry, entryIndex) => {
        if (!enemyIds.has(entry.enemyId)) {
          issues.push({
            severity: "error",
            filePath: "/data/waves-handcrafted.json",
            message: `Unknown enemy ${entry.enemyId}`,
            fieldPath: `handcraftedWaves[${waveIndex}].entries[${entryIndex}].enemyId`,
          });
        }
      });
    });
  }

  if (waveBalance && enemies) {
    const enemyIds = new Set(enemies.archetypes.map((entry) => entry.id));
    if (!enemyIds.has(waveBalance.boss.id)) {
      issues.push({
        severity: "error",
        filePath: "/data/wave-balance.json",
        message: `Boss id ${waveBalance.boss.id} does not exist in enemy catalog.`,
        fieldPath: "boss.id",
      });
    }
    if (!enemyIds.has(waveBalance.boss.minibossArchetypeId)) {
      issues.push({
        severity: "error",
        filePath: "/data/wave-balance.json",
        message: `Miniboss id ${waveBalance.boss.minibossArchetypeId} does not exist in enemy catalog.`,
        fieldPath: "boss.minibossArchetypeId",
      });
    }
    if (waveBalance.totalWaveCount < 1) {
      issues.push({
        severity: "error",
        filePath: "/data/wave-balance.json",
        message: "totalWaveCount must be >= 1.",
        fieldPath: "totalWaveCount",
      });
    }
  }

  if (campaign && presets && enemies) {
    const presetIds = new Set(Object.keys(presets.presets));
    const enemyIds = new Set(enemies.archetypes.map((entry) => entry.id));
    const wavesPerMission: number[] = [];

    campaign.stages.forEach((stage, stageIndex) => {
      stage.levels.forEach((level, levelIndex) => {
        const pathPrefix = `stages[${stageIndex}].levels[${levelIndex}]`;
        if (!presetIds.has(level.wavePlan.preset)) {
          issues.push({
            severity: "error",
            filePath: "/data/campaign/campaign_v2.json",
            message: `Preset ${level.wavePlan.preset} does not exist.`,
            fieldPath: `${pathPrefix}.wavePlan.preset`,
          });
        }

        const resolvedWaves = level.wavePlan.waves ?? presets.presets[level.wavePlan.preset]?.waves ?? 0;
        wavesPerMission.push(resolvedWaves);

        if ((level.wavePlan.bossEnabled ?? false) && resolvedWaves < 3) {
          issues.push({
            severity: "warning",
            filePath: "/data/campaign/campaign_v2.json",
            message: `Mission ${level.id} enables boss with only ${resolvedWaves} waves.`,
            fieldPath: `${pathPrefix}.wavePlan.waves`,
          });
        }

        level.archetypeAllowlist.forEach((enemyId, allowIndex) => {
          if (!enemyIds.has(enemyId)) {
            issues.push({
              severity: "error",
              filePath: "/data/campaign/campaign_v2.json",
              message: `Unknown allowlist enemy ${enemyId}.`,
              fieldPath: `${pathPrefix}.archetypeAllowlist[${allowIndex}]`,
            });
          }
        });
      });
    });

    for (let index = 1; index < wavesPerMission.length; index += 1) {
      if (wavesPerMission[index] + 2 < wavesPerMission[index - 1]) {
        issues.push({
          severity: "warning",
          filePath: "/data/campaign/campaign_v2.json",
          message: "Campaign wave-count progression drops sharply between adjacent missions.",
          fieldPath: "stages",
        });
        break;
      }
    }
  }

  if (presets) {
    for (const [presetId, preset] of Object.entries(presets.presets)) {
      if (!Number.isFinite(preset.waves) || preset.waves < 1 || preset.waves > 12) {
        issues.push({
          severity: "error",
          filePath: "/data/waves/presets.json",
          message: `Preset ${presetId} has invalid wave count ${preset.waves}.`,
          fieldPath: `presets.${presetId}.waves`,
        });
      }
      if (preset.minibossWave !== undefined && preset.minibossWave < 1) {
        issues.push({
          severity: "error",
          filePath: "/data/waves/presets.json",
          message: `Preset ${presetId} has invalid minibossWave ${preset.minibossWave}.`,
          fieldPath: `presets.${presetId}.minibossWave`,
        });
      }
    }
  }

  if (stageDifficulty) {
    stageDifficulty.stages.forEach((stage, stageIndex) => {
      stage.archetypeProgression.tiers.forEach((tier, tierIndex) => {
        const totalWeight = Object.values(tier.weights).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
        if (totalWeight <= 0) {
          issues.push({
            severity: "warning",
            filePath: "/data/difficulty/stages.json",
            message: `Tier weights sum to zero for ${stage.id} tier index ${tierIndex}.`,
            fieldPath: `stages[${stageIndex}].archetypeProgression.tiers[${tierIndex}].weights`,
          });
        }
      });
    });
  }

  for (const docId of workspace.order) {
    const doc = workspace.docs[docId];
    if (!doc || doc.kind !== "level-json" || !doc.currentData) {
      continue;
    }
    try {
      parseLevelJson(doc.currentData, doc.path);
    } catch (error) {
      issues.push({
        severity: "error",
        filePath: doc.path,
        message: error instanceof Error ? error.message : "Invalid level JSON",
      });
    }
  }

  return issues;
}

function getCampaign(workspace: LevelEditorWorkspace): CampaignSpecV2 | null {
  const doc = workspace.docs["/data/campaign/campaign_v2.json"];
  if (!doc || !isObject(doc.currentData)) {
    return null;
  }
  const campaign = doc.currentData as unknown as CampaignSpecV2;
  if (campaign.version !== 2 || !Array.isArray(campaign.stages)) {
    return null;
  }
  return campaign;
}

function getPresetCatalog(workspace: LevelEditorWorkspace): CampaignWavePresetCatalog | null {
  const doc = workspace.docs["/data/waves/presets.json"];
  if (!doc || !isObject(doc.currentData)) {
    return null;
  }
  const catalog = doc.currentData as unknown as CampaignWavePresetCatalog;
  if (catalog.version !== 1 || !isObject(catalog.presets)) {
    return null;
  }
  return catalog;
}

function getEnemyCatalog(workspace: LevelEditorWorkspace): EnemyCatalog | null {
  const doc = workspace.docs["/data/enemyArchetypes.json"];
  if (!doc || !isObject(doc.currentData)) {
    return null;
  }
  const catalog = doc.currentData as unknown as EnemyCatalog;
  if (!Array.isArray(catalog.archetypes)) {
    return null;
  }
  return catalog;
}

function getModifierCatalog(workspace: LevelEditorWorkspace): WaveModifierCatalog | null {
  const doc = workspace.docs["/data/wave-modifiers.json"];
  if (!doc || !isObject(doc.currentData)) {
    return null;
  }
  const catalog = doc.currentData as unknown as WaveModifierCatalog;
  if (!Array.isArray(catalog.modifiers)) {
    return null;
  }
  return catalog;
}

function getHandcraftedCatalog(workspace: LevelEditorWorkspace): HandcraftedWaveCatalog | null {
  const doc = workspace.docs["/data/waves-handcrafted.json"];
  if (!doc || !isObject(doc.currentData)) {
    return null;
  }
  const catalog = doc.currentData as unknown as HandcraftedWaveCatalog;
  if (!Array.isArray(catalog.handcraftedWaves)) {
    return null;
  }
  return catalog;
}

function getWaveBalance(workspace: LevelEditorWorkspace): WaveBalanceConfig | null {
  const doc = workspace.docs["/data/wave-balance.json"];
  if (!doc || !isObject(doc.currentData)) {
    return null;
  }
  const config = doc.currentData as unknown as WaveBalanceConfig;
  if (!isObject(config.boss) || !isObject(config.scaling)) {
    return null;
  }
  return config;
}

function getStageDifficulty(workspace: LevelEditorWorkspace): StageDifficultyCatalog | null {
  const doc = workspace.docs["/data/difficulty/stages.json"];
  if (!doc || !isObject(doc.currentData)) {
    return null;
  }
  const catalog = doc.currentData as unknown as StageDifficultyCatalog;
  if (!Array.isArray(catalog.stages)) {
    return null;
  }
  return catalog;
}

function getCampaignMapById(workspace: LevelEditorWorkspace): Map<string, CampaignMapDefinition> {
  const mapById = new Map<string, CampaignMapDefinition>();
  for (const docId of workspace.order) {
    const doc = workspace.docs[docId];
    if (!doc || doc.kind !== "campaign-map" || !isObject(doc.currentData)) {
      continue;
    }
    const map = doc.currentData as unknown as CampaignMapDefinition;
    if (typeof map.id !== "string") {
      continue;
    }
    mapById.set(map.id, map);
  }
  return mapById;
}

export function splitIssues(issues: LevelEditorIssue[]): { errors: LevelEditorIssue[]; warnings: LevelEditorIssue[] } {
  const errors: LevelEditorIssue[] = [];
  const warnings: LevelEditorIssue[] = [];
  for (const issue of issues) {
    if (issue.severity === "error") {
      errors.push(issue);
    } else {
      warnings.push(issue);
    }
  }
  return { errors, warnings };
}

export function getLevelFromDoc(data: unknown): LevelJson | null {
  if (!isObject(data)) {
    return null;
  }
  if (data.version !== 1 || !Array.isArray(data.nodes) || !Array.isArray(data.missions)) {
    return null;
  }
  return data as unknown as LevelJson;
}
