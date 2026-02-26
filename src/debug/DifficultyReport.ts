import type { DifficultyContext } from "../difficulty/DifficultyContext";
import { resolveStageBudgetModel, resolveWaveRamp } from "../difficulty/DifficultyContext";
import { EnemyFactory } from "../waves/EnemyFactory";
import type { LoadedWaveContent, WaveModifierDefinition } from "../waves/Definitions";
import type { DifficultyDebugSnapshot } from "../waves/WaveDirector";

export interface GenerateDifficultyReportArgs {
  snapshot: DifficultyDebugSnapshot;
  content: LoadedWaveContent;
  previewWaves?: number;
  includeUnitSamples?: boolean;
}

export function generateDifficultyReport(args: GenerateDifficultyReportArgs): string {
  const context = args.snapshot.context;
  const nowIso = new Date().toISOString();
  const previewWaves = clampInt(args.previewWaves ?? args.snapshot.waves.length, 1, args.snapshot.totalWaveCount);
  const includeUnitSamples = args.includeUnitSamples ?? true;
  const modifierById = new Map<string, WaveModifierDefinition>();
  for (const modifier of args.content.modifierCatalog.modifiers) {
    modifierById.set(modifier.id, modifier);
  }
  const enemyFactory = new EnemyFactory(args.content, context);

  const lines: string[] = [];
  lines.push("=== Difficulty Report ===");
  lines.push(`timestamp: ${nowIso}`);
  lines.push(`missionId: ${context.labels.missionId ?? "--"} | missionName: ${context.labels.missionName ?? "--"}`);
  lines.push(
    `stage: ${context.labels.stageId}#${context.labels.stageIndex} | missionIndex: ${context.labels.missionIndex} | preset: ${context.labels.presetId ?? "--"}`,
  );
  lines.push(
    `tier: ${context.labels.tier} | ascensionLevel: ${context.labels.ascensionLevel} | ascensionIds: ${csvOrNone(context.labels.activeAscensionIds)}`,
  );
  lines.push(
    `runSeed: ${context.seeds.runSeed} | missionSeed: ${context.seeds.missionSeed ?? "--"} | missionDifficultyScalar: ${context.missionDifficultyScalar.toFixed(4)}`,
  );
  lines.push(
    `waveOverrides: waves=${context.wavePlan.waveCountOverride ?? "--"} boss=${context.wavePlan.bossEnabledOverride ?? "--"} firstAppearance=${context.wavePlan.firstAppearanceWave ?? "--"} minibossWave=${context.wavePlan.minibossWave ?? "--"}`,
  );
  lines.push(`activeWaveModifierIds: ${csvOrNone(context.wavePlan.activeWaveModifierIds)}`);
  lines.push(
    `wiredVars: waveClearBase=${args.content.balance.goldRewards.waveClearBase} temporaryBuffDamageMultiplier=${args.content.balance.elite.temporaryBuffDamageMultiplier} firstAppearanceWave=${context.wavePlan.firstAppearanceWave ?? "--"} minibossWave=${context.wavePlan.minibossWave ?? "--"}`,
  );
  lines.push(`metaModifiers(active): ${csvOrNone(listNonDefaultMetaModifiers(context))}`);
  lines.push("");
  lines.push("-- Final Multipliers --");
  lines.push(formatExplained("enemy.hpMul", context.finalMultipliers.enemy.hpMul));
  lines.push(formatExplained("enemy.dmgMul", context.finalMultipliers.enemy.dmgMul));
  lines.push(formatExplained("enemy.speedMul", context.finalMultipliers.enemy.speedMul));
  lines.push(formatExplained("enemy.regenMul", context.finalMultipliers.enemy.regenMul));
  lines.push(formatExplained("enemy.spawnCountMul", context.finalMultipliers.enemy.spawnCountMul));
  lines.push(formatExplained("enemy.spawnRateMul", context.finalMultipliers.enemy.spawnRateMul));
  lines.push(formatExplained("player.towerRegenMul", context.finalMultipliers.player.towerRegenMul));
  lines.push(formatExplained("player.packetSpeedMul", context.finalMultipliers.player.packetSpeedMul));
  lines.push(formatExplained("player.packetDamageMul", context.finalMultipliers.player.packetDamageMul));
  lines.push(formatExplained("player.captureEfficiencyMul", context.finalMultipliers.player.captureEfficiencyMul));
  lines.push(formatExplained("economy.goldMul", context.finalMultipliers.economy.goldMul));
  lines.push(formatExplained("economy.metaGoldMul", context.finalMultipliers.economy.gloryMul));
  lines.push(formatExplained("boss.bossHpMul", context.finalMultipliers.boss.bossHpMul));
  lines.push(`boss.extraPhases=${context.finalMultipliers.boss.extraPhases}`);
  lines.push(
    `sim.sendRate=${context.simulation.sendRatePerSec.toFixed(2)} captureRate=${context.simulation.captureRateMultiplier.toFixed(2)} playerCaptureEff=${context.simulation.playerCaptureEfficiencyMul.toFixed(2)} enemyRegen=${context.simulation.enemyRegenMultiplier.toFixed(2)} linkDecay=${context.simulation.linkDecayPerSec.toFixed(2)} break=${context.simulation.linkDecayCanBreak}`,
  );
  lines.push("");
  lines.push(`-- Waves (1..${previewWaves}) --`);

  const waves = args.snapshot.waves
    .slice()
    .sort((left, right) => left.waveIndex - right.waveIndex)
    .filter((wave) => wave.waveIndex <= previewWaves);

  for (const wave of waves) {
    const budget = resolveStageBudgetModel(context, wave.waveIndex, args.snapshot.totalWaveCount);
    const intensity = context.tierConfig.wave.intensityMul * resolveWaveRamp(context, wave.waveIndex, args.snapshot.totalWaveCount);
    const modifierEffects = aggregateModifierEffects(wave.plan.modifiers, modifierById);
    const spawnIntervalPre = args.content.balanceBaselines.calibration.waveGeneration.spawnIntervalSec;
    const spawnPaceMul = Math.max(0.3, modifierEffects.spawnRateMultiplier * Math.max(0.55, intensity));
    const spawnIntervalPost = spawnIntervalPre / spawnPaceMul;
    const minibossGuaranteed =
      (context.wavePlan.minibossWave !== null && wave.waveIndex === context.wavePlan.minibossWave) ||
      wave.waveIndex >= context.tierConfig.wave.minibossGuaranteeWave;

    lines.push(
      `W${wave.waveIndex}: budget=${budget.waveDifficultyBudgetPreClamp.toFixed(2)}->${budget.waveDifficultyBudget.toFixed(2)} cooldown=${wave.tuning?.cooldownSec.toFixed(2) ?? "--"} intensity=${intensity.toFixed(3)} spawnInterval=${spawnIntervalPre.toFixed(2)}->${spawnIntervalPost.toFixed(2)}`,
    );
    lines.push(
      `  eliteChance=${(wave.tuning?.eliteChance ?? budget.eliteChance).toFixed(3)} minibossChance=${budget.minibossChance.toFixed(3)} minibossGuaranteed=${minibossGuaranteed}`,
    );
    const archetypeMix = wave.tuning?.archetypeMix ?? countArchetypesFromEntries(wave.plan.spawnEntries);
    const topArchetypes = Object.entries(archetypeMix)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5);
    const composition = topArchetypes.map(([id, count]) => `${id}x${count}`).join(", ");
    const threat = computeThreatScore(archetypeMix, args.content, context);
    lines.push(`  composition=${composition || "none"} totalThreat=${threat.toFixed(2)} totalUnits=${wave.tuning?.totalUnits ?? sumEntries(wave.plan.spawnEntries)}`);

    if (includeUnitSamples) {
      const sampleIds = topArchetypes.slice(0, 3).map(([id]) => id);
      for (const sampleId of sampleIds) {
        const packet = enemyFactory.createEnemyPacket({
          packetId: `report-${wave.waveIndex}-${sampleId}`,
          owner: "enemy",
          linkId: "report-link",
          archetypeId: sampleId,
          count: 1,
          waveIndex: wave.waveIndex,
          isElite: false,
          isBoss: sampleId === args.content.balance.boss.id,
        });
        lines.push(
          `  sample.${sampleId}: hp=${packet.hpPerUnit.toFixed(2)} dmg=${packet.dpsPerUnit.toFixed(2)} speed=${packet.speedPxPerSec.toFixed(2)} range=${packet.attackRangePx.toFixed(1)} cd=${packet.attackCooldownSec.toFixed(2)}`,
        );
      }
    }
  }

  lines.push("");
  lines.push("-- Why --");
  lines.push("enemy.hp formula: baseHp * waveScale * tier.enemy.hpMul * eliteMul * bossMul * caps");
  lines.push("enemy.dmg formula: baseDmg * waveScale * tier.enemy.dmgMul * eliteMul * bossMul * caps");
  lines.push("enemy.speed formula: baseSpeed * waveScale * tier.enemy.speedMul * caps");
  lines.push("budget formula: baseMissionValue * missionSlope * stageSlope * ascensionSlope (then clamp)");

  const provenanceKeys = Object.keys(context.provenance).sort((a, b) => a.localeCompare(b));
  for (const key of provenanceKeys) {
    const steps = context.provenance[key]
      .map((entry) => `${entry.source}:${entry.mode}=${typeof entry.value === "number" ? entry.value.toFixed(4) : String(entry.value)}`)
      .join(" -> ");
    lines.push(`  ${key}: ${steps || "none"}`);
  }

  return lines.join("\n");
}

function formatExplained(label: string, explained: { preCap: number; postCap: number; capMin: number | null; capMax: number | null }): string {
  const caps =
    explained.capMin !== null || explained.capMax !== null
      ? ` cap[${explained.capMin ?? "-inf"}, ${explained.capMax ?? "+inf"}]`
      : "";
  return `${label}=${explained.preCap.toFixed(4)}->${explained.postCap.toFixed(4)}${caps}`;
}

function listNonDefaultMetaModifiers(context: DifficultyContext): string[] {
  const modifiers = context.appliedMetaModifiers;
  const entries: Array<[string, number | boolean]> = [
    ["packetDamageMul", modifiers.packetDamageMul],
    ["packetSpeedMul", modifiers.packetSpeedMul],
    ["packetArmorMul", modifiers.packetArmorMul],
    ["packetArmorAdd", modifiers.packetArmorAdd],
    ["towerRegenMul", modifiers.towerRegenMul],
    ["towerMaxTroopsMul", modifiers.towerMaxTroopsMul],
    ["linkIntegrityMul", modifiers.linkIntegrityMul],
    ["linkCostDiscount", modifiers.linkCostDiscount],
    ["extraOutgoingLinksAdd", modifiers.extraOutgoingLinksAdd],
    ["startingTroopsMul", modifiers.startingTroopsMul],
    ["captureEfficiencyMul", modifiers.captureEfficiencyMul],
    ["enemyRegenMul", modifiers.enemyRegenMul],
    ["linkDecayPerSec", modifiers.linkDecayPerSec],
    ["linkDecayCanBreak", modifiers.linkDecayCanBreak],
    ["bossHpMul", modifiers.bossHpMul],
    ["bossExtraPhases", modifiers.bossExtraPhases],
    ["rewardMetaGoldMul", modifiers.rewardGloryMul],
    ["rewardRunGoldMul", modifiers.rewardGoldMul],
    ["startingGold", modifiers.startingGold],
    ["goldEarnedMultiplier", modifiers.goldEarnedMultiplier],
    ["towerHpMultiplier", modifiers.towerHpMultiplier],
    ["strongholdStartLevel", modifiers.strongholdStartLevel],
  ];

  return entries
    .filter(([_, value]) => {
      if (typeof value === "boolean") {
        return value;
      }
      return Math.abs(value - 1) > 0.0001 && Math.abs(value) > 0.0001;
    })
    .map(([key, value]) => `${key}=${String(value)}`);
}

function aggregateModifierEffects(
  modifierIds: string[],
  modifierById: ReadonlyMap<string, WaveModifierDefinition>,
): { spawnRateMultiplier: number } {
  let spawnRateMultiplier = 1;
  for (const modifierId of modifierIds) {
    const modifier = modifierById.get(modifierId);
    if (!modifier) {
      continue;
    }
    spawnRateMultiplier *= modifier.effects.spawnRateMultiplier ?? 1;
  }
  return { spawnRateMultiplier };
}

function countArchetypesFromEntries(entries: Array<{ enemyId: string; count: number }>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of entries) {
    result[entry.enemyId] = (result[entry.enemyId] ?? 0) + entry.count;
  }
  return result;
}

function computeThreatScore(
  archetypeMix: Record<string, number>,
  content: LoadedWaveContent,
  context: DifficultyContext,
): number {
  const byId = new Map(content.enemyCatalog.archetypes.map((archetype) => [archetype.id, archetype] as const));
  let score = 0;
  const difficultyMul = context.tierConfig.wave.intensityMul * context.missionDifficultyScalar;
  for (const [id, count] of Object.entries(archetypeMix)) {
    const archetype = byId.get(id);
    if (!archetype) {
      continue;
    }
    score += archetype.unitThreatValue * count * difficultyMul;
  }
  return score;
}

function sumEntries(entries: Array<{ count: number }>): number {
  let total = 0;
  for (const entry of entries) {
    total += entry.count;
  }
  return total;
}

function csvOrNone(values: string[]): string {
  if (values.length === 0) {
    return "none";
  }
  return values.join(", ");
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
