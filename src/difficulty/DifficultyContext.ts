import type { DifficultyTierId } from "../config/Difficulty";
import { computeDifficultyBudget, resolveAscensionModifiers, resolveStageProfile } from "../waves/DifficultyConfig";
import type { DifficultyTierConfig, BalanceBaselinesConfig, WaveBalanceConfig } from "../waves/Definitions";
import type {
  AscensionDifficultyCatalog,
  AscensionDifficultyModifiers,
  BossDifficultyModifiers,
  DifficultyAxes,
  StageDifficultyCatalog,
  StageDifficultyProfile,
} from "../waves/DifficultyTypes";
import type { MetaModifiers } from "../save/Schema";

export interface DifficultyContribution {
  source: string;
  mode: "mul" | "add" | "set";
  value: number | boolean;
  note?: string;
}

export interface ExplainedValue {
  preCap: number;
  postCap: number;
  capMin: number | null;
  capMax: number | null;
  contributions: DifficultyContribution[];
}

export interface DifficultyInputs {
  missionId?: string;
  missionName?: string;
  missionDifficulty: number;
  runDifficultyScalar: number;
  tierId: DifficultyTierId;
  tierConfig: DifficultyTierConfig;
  baselines: BalanceBaselinesConfig;
  waveBalance: WaveBalanceConfig;
  stageCatalog: StageDifficultyCatalog | null;
  ascensionCatalog: AscensionDifficultyCatalog | null;
  stageId?: string;
  stageIndex?: number;
  missionIndex: number;
  presetId?: string;
  waveCountOverride?: number;
  bossEnabledOverride?: boolean;
  firstAppearanceWaveOverride?: number;
  minibossWaveOverride?: number;
  ascensionLevel: number;
  activeAscensionIds: string[];
  activeWaveModifierIds: string[];
  metaModifiers: MetaModifiers;
  simulationBase?: {
    sendRatePerSec?: number;
    captureRateMultiplier?: number;
    playerCaptureEfficiencyMul?: number;
    playerRegenMultiplier?: number;
    enemyRegenMultiplier?: number;
    linkDecayPerSec?: number;
    linkDecayCanBreak?: boolean;
  };
  rewardGoldMultiplierOverride?: number;
  bossHpMultiplierOverride?: number;
  bossExtraPhasesOverride?: number;
  runSeed: number;
  missionSeed?: number;
}

export interface DifficultyContext {
  labels: {
    missionId: string | null;
    missionName: string | null;
    tier: DifficultyTierId;
    ascensionLevel: number;
    stageId: string;
    stageIndex: number;
    missionIndex: number;
    presetId: string | null;
    activeAscensionIds: string[];
  };
  seeds: {
    runSeed: number;
    missionSeed: number | null;
  };
  missionDifficultyScalar: number;
  mapDifficultyScalar: number;
  tierConfig: DifficultyTierConfig;
  stage: {
    profile: StageDifficultyProfile | null;
    ascension: AscensionDifficultyModifiers;
    axes: DifficultyAxes;
    budgetValue: number;
    unitBudget: number;
    complexityBudget: number;
    eliteBudget: number;
    regenBudget: number;
    tempoBudget: number;
    normalizedEliteBudget: number;
    normalizedRegenBudget: number;
    normalizedTempoBudget: number;
    stageEnemyRegenMultiplier: number;
    cooldownBaseSec: number;
  };
  wavePlan: {
    waveCountOverride: number | null;
    bossEnabledOverride: boolean | null;
    firstAppearanceWave: number | null;
    minibossWave: number | null;
    activeWaveModifierIds: string[];
  };
  appliedMetaModifiers: MetaModifiers;
  finalMultipliers: {
    enemy: {
      hpMul: ExplainedValue;
      dmgMul: ExplainedValue;
      speedMul: ExplainedValue;
      attackCooldownMul: ExplainedValue;
      regenMul: ExplainedValue;
      spawnCountMul: ExplainedValue;
      spawnRateMul: ExplainedValue;
    };
    player: {
      towerRegenMul: ExplainedValue;
      startingTowersAdd: number;
      startingTroopsMul: ExplainedValue;
      packetSpeedMul: ExplainedValue;
      packetDamageMul: ExplainedValue;
      packetArmorMul: ExplainedValue;
      packetArmorAdd: ExplainedValue;
      captureEfficiencyMul: ExplainedValue;
    };
    economy: {
      goldMul: ExplainedValue;
      gloryMul: ExplainedValue;
      startingGold: number;
    };
    boss: {
      bossHpMul: ExplainedValue;
      extraPhases: number;
    };
  };
  simulation: {
    sendRatePerSec: number;
    captureRateMultiplier: number;
    playerCaptureEfficiencyMul: number;
    regenMinPerSec: number;
    regenMaxPerSec: number;
    playerRegenMultiplier: number;
    enemyRegenMultiplier: number;
    linkDecayPerSec: number;
    linkDecayCanBreak: boolean;
    packetStatCaps: BalanceBaselinesConfig["packets"]["globalCaps"];
    fightModel: BalanceBaselinesConfig["packets"]["fightResolutionModelParams"];
  };
  caps: {
    packetStatCaps: BalanceBaselinesConfig["packets"]["globalCaps"];
    budgetClamp: { min: number; max: number } | null;
    spawnIntervalClamp: { min: number; max: number };
  };
  provenance: Record<string, DifficultyContribution[]>;
}

export interface WaveBudgetSnapshot {
  waveProgress01: number;
  waveDifficultyBudget: number;
  waveDifficultyBudgetPreClamp: number;
  unitBudgetPoints: number;
  complexityAxis: number;
  eliteChance: number;
  minibossChance: number;
}

export function buildDifficultyContext(inputs: DifficultyInputs): DifficultyContext {
  const tierConfig = inputs.tierConfig;
  const mapDifficultyScalar = Math.max(0.05, inputs.missionDifficulty);

  const stageProfile = resolveStageProfile(inputs.stageCatalog, {
    stageId: inputs.stageId,
    stageIndex: inputs.stageIndex,
  });
  const stageId = stageProfile?.id ?? normalizeStageId(inputs.stageId);
  const stageIndex = stageProfile?.stageIndex ?? Math.max(1, Math.floor(inputs.stageIndex ?? deriveStageIndex(stageId)));
  const ascensionLevel = Math.max(
    0,
    Math.floor(inputs.ascensionLevel ?? Math.max(0, inputs.bossExtraPhasesOverride ?? 0)),
  );
  const ascension = resolveAscensionRules(inputs.ascensionCatalog, ascensionLevel);
  const axes = resolveAxesForMission(stageProfile, inputs.missionIndex);
  const budgetValue = stageProfile ? computeDifficultyBudget(stageProfile, inputs.missionIndex, ascensionLevel) : 0;

  const unitBudget = budgetValue * (stageProfile?.budgetAllocation.unitCount ?? 0);
  const complexityBudget = budgetValue * (stageProfile?.budgetAllocation.complexity ?? 0);
  const eliteBudget = budgetValue * (stageProfile?.budgetAllocation.elite ?? 0);
  const regenBudget = budgetValue * (stageProfile?.budgetAllocation.regen ?? 0);
  const tempoBudget = budgetValue * (stageProfile?.budgetAllocation.tempo ?? 0);
  const normalizedEliteBudget = eliteBudget > 0 ? eliteBudget / Math.max(1, budgetValue) : 0;
  const normalizedRegenBudget = regenBudget > 0 ? regenBudget / Math.max(1, budgetValue) : 0;
  const normalizedTempoBudget = tempoBudget > 0 ? tempoBudget / Math.max(1, budgetValue) : 0;
  const cooldownBaseSec = stageProfile
    ? computeBaseCooldown(stageProfile, axes, normalizedTempoBudget)
    : 3;

  const stageEnemyRegenMultiplier = clamp(
    1 + axes.economy * 0.15 + normalizedRegenBudget * 0.1 + ascension.enemyRegenBonus,
    1,
    1.75,
  );
  const enemyRegenExplained = explainValue(
    stageEnemyRegenMultiplier,
    [{ source: "meta.enemyRegenMul", mode: "mul", value: inputs.metaModifiers.enemyRegenMul }],
    1,
    4,
  );

  const missionScalarExplained = explainValue(
    1,
    [
      { source: "mission.difficulty", mode: "mul", value: inputs.missionDifficulty },
      { source: "runModifiers.difficulty", mode: "mul", value: inputs.runDifficultyScalar },
    ],
    null,
    null,
  );

  const spawnCountExplained = explainValue(
    1,
    [
      { source: "tier.enemy.spawnCountMul", mode: "mul", value: tierConfig.enemy.spawnCountMul },
      { source: "missionDifficultyScalar", mode: "mul", value: missionScalarExplained.postCap },
    ],
    0.25,
    8,
  );

  const spawnRateExplained = explainValue(
    1,
    [{ source: "base.spawnRate", mode: "mul", value: 1 }],
    0.3,
    4,
  );

  const enemyHpExplained = explainValue(
    1,
    [
      { source: "tier.enemy.hpMul", mode: "mul", value: tierConfig.enemy.hpMul },
      { source: "missionDifficultyScalar", mode: "mul", value: missionScalarExplained.postCap },
    ],
    0.25,
    50,
  );

  const enemyDmgExplained = explainValue(
    1,
    [
      { source: "tier.enemy.dmgMul", mode: "mul", value: tierConfig.enemy.dmgMul },
      { source: "missionDifficultyScalar", mode: "mul", value: missionScalarExplained.postCap },
    ],
    0.25,
    50,
  );

  const enemySpeedExplained = explainValue(
    1,
    [{ source: "tier.enemy.speedMul", mode: "mul", value: tierConfig.enemy.speedMul }],
    0.25,
    10,
  );

  const playerTowerRegenExplained = explainValue(
    inputs.metaModifiers.towerRegenMul,
    [{ source: "tier.player.regenMul", mode: "mul", value: tierConfig.player.regenMul }],
    0.2,
    3,
  );
  const playerPacketSpeedExplained = explainValue(
    inputs.metaModifiers.packetSpeedMul,
    [{ source: "tier.player.packetSpeedMul", mode: "mul", value: tierConfig.player.packetSpeedMul }],
    inputs.baselines.packets.globalCaps.speedMin / Math.max(1, inputs.baselines.packets.baseSpeed),
    inputs.baselines.packets.globalCaps.speedMax / Math.max(1, inputs.baselines.packets.baseSpeed),
  );
  const playerStartingTroopsExplained = explainValue(
    inputs.metaModifiers.startingTroopsMul,
    [{ source: "tier.player.startingTroopsMul", mode: "mul", value: tierConfig.player.startingTroopsMul }],
    0.5,
    2.5,
  );
  const economyGoldExplained = explainValue(
    inputs.metaModifiers.rewardGoldMul,
    [{ source: "tier.economy.goldMul", mode: "mul", value: tierConfig.economy.goldMul }],
    0.5,
    4,
  );
  const economyGloryExplained = explainValue(
    inputs.metaModifiers.rewardGloryMul,
    [
      {
        source: `baselines.economy.gloryMultiplierByDifficulty.${inputs.tierId}`,
        mode: "mul",
        value: inputs.baselines.economy.gloryMultiplierByDifficulty[inputs.tierId],
      },
      { source: "tier.economy.gloryMul", mode: "mul", value: tierConfig.economy.gloryMul },
    ],
    0.5,
    6,
  );

  const bossHpExplained = explainValue(
    inputs.metaModifiers.bossHpMul,
    [{ source: "override.bossHpMultiplier", mode: "mul", value: Math.max(0.5, inputs.bossHpMultiplierOverride ?? 1) }],
    0.5,
    4,
  );

  const resolvedMetaModifiers: MetaModifiers = {
    ...inputs.metaModifiers,
    packetSpeedMul: playerPacketSpeedExplained.postCap,
    towerRegenMul: playerTowerRegenExplained.postCap,
    startingTroopsMul: playerStartingTroopsExplained.postCap,
    rewardGoldMul: economyGoldExplained.postCap,
    rewardGloryMul: economyGloryExplained.postCap,
    enemyRegenMul: enemyRegenExplained.postCap,
    bossHpMul: bossHpExplained.postCap,
    bossExtraPhases: clampInt(
      inputs.metaModifiers.bossExtraPhases + Math.max(0, Math.round(inputs.bossExtraPhasesOverride ?? 0)),
      0,
      3,
    ),
  };

  const simulationBase = inputs.simulationBase ?? {};
  const simulationSendRatePerSec = simulationBase.sendRatePerSec ?? 6;
  const simulationCaptureRateMultiplier =
    simulationBase.captureRateMultiplier ?? inputs.baselines.towerTroops.captureRateMultiplier;
  const simulationPlayerCaptureEfficiencyMul =
    (simulationBase.playerCaptureEfficiencyMul ?? 1) * resolvedMetaModifiers.captureEfficiencyMul;
  const simulationPlayerRegenMultiplier = simulationBase.playerRegenMultiplier ?? 1;
  const simulationEnemyRegenMultiplier =
    (simulationBase.enemyRegenMultiplier ?? 1) * resolvedMetaModifiers.enemyRegenMul;
  const simulationLinkDecayPerSec = clamp(
    (simulationBase.linkDecayPerSec ?? 0) + resolvedMetaModifiers.linkDecayPerSec,
    0,
    20,
  );
  const simulationLinkDecayCanBreak =
    Boolean(simulationBase.linkDecayCanBreak) || resolvedMetaModifiers.linkDecayCanBreak;

  const provenances: Record<string, DifficultyContribution[]> = {
    missionDifficultyScalar: missionScalarExplained.contributions,
    "enemy.hpMul": enemyHpExplained.contributions,
    "enemy.dmgMul": enemyDmgExplained.contributions,
    "enemy.speedMul": enemySpeedExplained.contributions,
    "enemy.regenMul": enemyRegenExplained.contributions,
    "enemy.spawnCountMul": spawnCountExplained.contributions,
    "enemy.spawnRateMul": spawnRateExplained.contributions,
    "player.towerRegenMul": playerTowerRegenExplained.contributions,
    "player.packetSpeedMul": playerPacketSpeedExplained.contributions,
    "player.startingTroopsMul": playerStartingTroopsExplained.contributions,
    "economy.goldMul": economyGoldExplained.contributions,
    "economy.gloryMul": economyGloryExplained.contributions,
    "boss.bossHpMul": bossHpExplained.contributions,
  };

  return {
    labels: {
      missionId: inputs.missionId ?? null,
      missionName: inputs.missionName ?? null,
      tier: inputs.tierId,
      ascensionLevel,
      stageId,
      stageIndex,
      missionIndex: Math.max(0, Math.floor(inputs.missionIndex)),
      presetId: inputs.presetId ?? null,
      activeAscensionIds: [...inputs.activeAscensionIds].sort(),
    },
    seeds: {
      runSeed: inputs.runSeed,
      missionSeed: inputs.missionSeed ?? null,
    },
    missionDifficultyScalar: missionScalarExplained.postCap,
    mapDifficultyScalar,
    tierConfig,
    stage: {
      profile: stageProfile,
      ascension,
      axes,
      budgetValue,
      unitBudget,
      complexityBudget,
      eliteBudget,
      regenBudget,
      tempoBudget,
      normalizedEliteBudget,
      normalizedRegenBudget,
      normalizedTempoBudget,
      stageEnemyRegenMultiplier,
      cooldownBaseSec,
    },
    wavePlan: {
      waveCountOverride: inputs.waveCountOverride ?? null,
      bossEnabledOverride: inputs.bossEnabledOverride ?? null,
      firstAppearanceWave: normalizeOptionalInt(inputs.firstAppearanceWaveOverride, 1),
      minibossWave: normalizeOptionalInt(inputs.minibossWaveOverride, 1),
      activeWaveModifierIds: [...inputs.activeWaveModifierIds].sort(),
    },
    appliedMetaModifiers: resolvedMetaModifiers,
    finalMultipliers: {
      enemy: {
        hpMul: enemyHpExplained,
        dmgMul: enemyDmgExplained,
        speedMul: enemySpeedExplained,
        attackCooldownMul: explainValue(1, [{ source: "base.attackCooldown", mode: "mul", value: 1 }], 0.1, 10),
        regenMul: enemyRegenExplained,
        spawnCountMul: spawnCountExplained,
        spawnRateMul: spawnRateExplained,
      },
      player: {
        towerRegenMul: playerTowerRegenExplained,
        startingTowersAdd: tierConfig.player.startingTowersAdd,
        startingTroopsMul: playerStartingTroopsExplained,
        packetSpeedMul: playerPacketSpeedExplained,
        packetDamageMul: explainValue(inputs.metaModifiers.packetDamageMul, [], 0.2, 14),
        packetArmorMul: explainValue(inputs.metaModifiers.packetArmorMul, [], 0.5, 2.5),
        packetArmorAdd: explainValue(inputs.metaModifiers.packetArmorAdd, [], -0.5, 2),
        captureEfficiencyMul: explainValue(inputs.metaModifiers.captureEfficiencyMul, [], 0.5, 2.5),
      },
      economy: {
        goldMul: economyGoldExplained,
        gloryMul: economyGloryExplained,
        startingGold: resolvedMetaModifiers.startingGold,
      },
      boss: {
        bossHpMul: bossHpExplained,
        extraPhases: resolvedMetaModifiers.bossExtraPhases,
      },
    },
    simulation: {
      sendRatePerSec: simulationSendRatePerSec,
      captureRateMultiplier: simulationCaptureRateMultiplier,
      playerCaptureEfficiencyMul: simulationPlayerCaptureEfficiencyMul,
      regenMinPerSec: inputs.baselines.troopRegen.globalRegenCaps.min,
      regenMaxPerSec: inputs.baselines.troopRegen.globalRegenCaps.max,
      playerRegenMultiplier: simulationPlayerRegenMultiplier,
      enemyRegenMultiplier: simulationEnemyRegenMultiplier,
      linkDecayPerSec: simulationLinkDecayPerSec,
      linkDecayCanBreak: simulationLinkDecayCanBreak,
      packetStatCaps: { ...inputs.baselines.packets.globalCaps },
      fightModel: { ...inputs.baselines.packets.fightResolutionModelParams },
    },
    caps: {
      packetStatCaps: { ...inputs.baselines.packets.globalCaps },
      budgetClamp: stageProfile ? { ...stageProfile.dbTuning.clamp } : null,
      spawnIntervalClamp: {
        min: Math.max(0.1, inputs.baselines.calibration.waveGeneration.spawnIntervalJitterMin),
        max: Math.max(
          Math.max(0.1, inputs.baselines.calibration.waveGeneration.spawnIntervalJitterMin),
          inputs.baselines.calibration.waveGeneration.spawnIntervalJitterMax,
        ),
      },
    },
    provenance: provenances,
  };
}

export function resolveTierMultipliers(
  tierId: DifficultyTierId,
): DifficultyContext["labels"] {
  return {
    missionId: null,
    missionName: null,
    tier: tierId,
    ascensionLevel: 0,
    stageId: "stage01",
    stageIndex: 1,
    missionIndex: 0,
    presetId: null,
    activeAscensionIds: [],
  };
}

export function resolveStageBudgetModel(
  context: DifficultyContext,
  waveIndex: number,
  totalWaveCount: number,
): WaveBudgetSnapshot {
  const waveProgress01 = clamp((waveIndex - 1) / Math.max(1, totalWaveCount - 1), 0, 1);
  if (!context.stage.profile) {
    return {
      waveProgress01,
      waveDifficultyBudget: context.missionDifficultyScalar,
      waveDifficultyBudgetPreClamp: context.missionDifficultyScalar,
      unitBudgetPoints: 0,
      complexityAxis: 0,
      eliteChance: 0,
      minibossChance: 0,
    };
  }

  const waveDifficultyBudgetRaw = context.stage.budgetValue * (0.82 + waveProgress01 * 0.36);
  const waveDifficultyBudget = clamp(
    waveDifficultyBudgetRaw,
    context.stage.profile.dbTuning.clamp.min,
    context.stage.profile.dbTuning.clamp.max,
  );
  const unitBudgetPoints = Math.max(
    5,
    Math.round(
      waveDifficultyBudget * context.stage.profile.budgetAllocation.unitCount * context.missionDifficultyScalar,
    ),
  );
  const complexityAxis = clamp(
    context.stage.axes.complexity +
      waveProgress01 * 0.1 +
      (context.stage.complexityBudget / Math.max(1, waveDifficultyBudget)) * 0.15,
    0,
    2,
  );
  const tier = resolveComplexityTier(context.stage.profile, complexityAxis);
  const eliteChance = clamp(
    tier.eliteChance +
      context.stage.normalizedEliteBudget * 0.18 +
      (context.stage.ascension.eliteEarlier ? 0.05 : 0),
    0,
    0.35,
  );
  const minibossChance = clamp(
    tier.minibossChance + context.stage.axes.complexity * 0.08 + (context.stage.ascension.eliteEarlier ? 0.05 : 0),
    0,
    0.8,
  );

  return {
    waveProgress01,
    waveDifficultyBudget,
    waveDifficultyBudgetPreClamp: waveDifficultyBudgetRaw,
    unitBudgetPoints,
    complexityAxis,
    eliteChance,
    minibossChance,
  };
}

export function resolveAscensionRules(
  catalog: AscensionDifficultyCatalog | null,
  ascensionLevel: number,
): AscensionDifficultyModifiers {
  return resolveAscensionModifiers(catalog, ascensionLevel);
}

export function resolveWaveRamp(context: DifficultyContext, waveIndex: number, totalWaveCount: number): number {
  const tier = context.tierConfig;
  const normalizedWave = clampInt(waveIndex, 1, totalWaveCount);
  const firstCut = Math.ceil(totalWaveCount / 3);
  const secondCut = Math.ceil((totalWaveCount * 2) / 3);
  if (normalizedWave <= firstCut) {
    return Math.max(0.5, 1 + Math.max(0, normalizedWave - 1) * tier.wave.earlyIntensityRampPerWave);
  }
  if (normalizedWave <= secondCut) {
    return Math.max(0.5, 1 + Math.max(0, normalizedWave - firstCut - 1) * tier.wave.midIntensityRampPerWave);
  }
  return Math.max(0.5, 1 + Math.max(0, normalizedWave - secondCut - 1) * tier.wave.lateIntensityRampPerWave);
}

export function computeWaveCooldownSec(context: DifficultyContext, waveIndex: number, totalWaveCount: number): number {
  if (!context.stage.profile) {
    return 3;
  }

  const waveProgress01 = clamp((waveIndex - 1) / Math.max(1, totalWaveCount - 1), 0, 1);
  const waveBudget = resolveStageBudgetModel(context, waveIndex, totalWaveCount);
  const tempoBudgetNorm = context.stage.tempoBudget / Math.max(1, waveBudget.waveDifficultyBudget);
  const compression = clamp(
    context.stage.axes.tempo * 0.25 + tempoBudgetNorm * 0.1,
    0,
    context.stage.profile.tempoModel.maxCompression,
  );
  const progressionMul = 1 - waveProgress01 * 0.08;
  const base = context.stage.profile.tempoModel.baseCooldownSec * (1 - compression) * progressionMul;
  return clamp(base, 3, 30);
}

export function computeBossDifficultyModifiers(
  context: DifficultyContext,
  waveDifficultyBudget: number,
): BossDifficultyModifiers | null {
  if (!context.stage.profile || !context.stage.profile.bossModel.enabled) {
    return null;
  }

  const bossPower = waveDifficultyBudget * context.stage.profile.bossModel.powerMultiplier;
  const extraPhaseCount =
    (context.stage.ascension.bossExtraPhase ? 1 : 0) +
    (context.stage.profile.bossModel.enrage.addPhaseOnHighAscension && context.stage.ascension.level >= 3 ? 1 : 0) +
    context.finalMultipliers.boss.extraPhases;

  return {
    hpMultiplier: clamp(1 + bossPower / 120, 1, 3),
    damageMultiplier: clamp(1 + bossPower / 200, 1, 2.2),
    abilityCooldownMultiplier: clamp(1 - bossPower / 280, 0.65, 1),
    reinforcementCountBonus: clamp(Math.round(bossPower / 35), 0, 8),
    extraPhaseCount: Math.max(0, extraPhaseCount),
  };
}

export function assertDifficultyContextDeterministic(inputs: DifficultyInputs): boolean {
  const left = buildDifficultyContext(inputs);
  const right = buildDifficultyContext(inputs);
  return stableStringify(left) === stableStringify(right);
}

export function collectDifficultySanityWarnings(context: DifficultyContext): string[] {
  const warnings: string[] = [];
  const hpMul = context.finalMultipliers.enemy.hpMul.postCap;
  const dmgMul = context.finalMultipliers.enemy.dmgMul.postCap;
  const speedMul = context.finalMultipliers.enemy.speedMul.postCap;
  const spawnMul = context.finalMultipliers.enemy.spawnCountMul.postCap;

  if (hpMul > 50) {
    warnings.push(`enemy.hpMul exceeded soft bound (value=${hpMul.toFixed(4)} > 50)`);
  }
  if (dmgMul > 50) {
    warnings.push(`enemy.dmgMul exceeded soft bound (value=${dmgMul.toFixed(4)} > 50)`);
  }
  if (speedMul > 10) {
    warnings.push(`enemy.speedMul exceeded soft bound (value=${speedMul.toFixed(4)} > 10)`);
  }

  if (context.stage.profile && context.stage.budgetValue > 80 && spawnMul > 1.75) {
    warnings.push(
      `budget + spawnCount scaling may stack too aggressively (budget=${context.stage.budgetValue.toFixed(2)}, spawnCountMul=${spawnMul.toFixed(2)})`,
    );
  }

  return warnings;
}

function resolveAxesForMission(profile: StageDifficultyProfile | null, missionIndex: number): DifficultyAxes {
  if (!profile || profile.axesByMission.length === 0) {
    return {
      economy: 0,
      spatial: 0,
      complexity: 0,
      tempo: 0,
      interference: 0,
    };
  }
  const index = Math.max(0, Math.min(profile.axesByMission.length - 1, Math.floor(missionIndex)));
  return profile.axesByMission[index];
}

function computeBaseCooldown(profile: StageDifficultyProfile, axes: DifficultyAxes, normalizedTempoBudget: number): number {
  const compression = clamp(
    axes.tempo * 0.25 + normalizedTempoBudget * 0.1,
    0,
    profile.tempoModel.maxCompression,
  );
  return clamp(profile.tempoModel.baseCooldownSec * (1 - compression), 3, 30);
}

function resolveComplexityTier(
  profile: StageDifficultyProfile,
  complexityAxis: number,
): StageDifficultyProfile["archetypeProgression"]["tiers"][number] {
  const sorted = [...profile.archetypeProgression.tiers].sort((left, right) => left.minComplexity - right.minComplexity);
  let best = sorted[0];
  for (const tier of sorted) {
    if (complexityAxis >= tier.minComplexity) {
      best = tier;
    }
  }
  return best;
}

function normalizeStageId(stageId?: string): string {
  const trimmed = (stageId ?? "").trim().toLowerCase();
  if (!trimmed) {
    return "stage01";
  }
  if (/^stage\d+$/.test(trimmed)) {
    const numeric = Number.parseInt(trimmed.slice(5), 10);
    return `stage${numeric.toString().padStart(2, "0")}`;
  }
  return trimmed;
}

function deriveStageIndex(stageId: string): number {
  const match = stageId.match(/(\d+)/);
  if (!match) {
    return 1;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function explainValue(
  base: number,
  contributions: DifficultyContribution[],
  capMin: number | null,
  capMax: number | null,
): ExplainedValue {
  let running = base;
  for (const contribution of contributions) {
    if (contribution.mode === "mul" && typeof contribution.value === "number") {
      running *= contribution.value;
    } else if (contribution.mode === "add" && typeof contribution.value === "number") {
      running += contribution.value;
    } else if (contribution.mode === "set" && typeof contribution.value === "number") {
      running = contribution.value;
    }
  }
  const clamped = clampNullable(running, capMin, capMax);
  return {
    preCap: running,
    postCap: clamped,
    capMin,
    capMax,
    contributions,
  };
}

function normalizeOptionalInt(value: number | undefined, min: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.max(min, Math.floor(value as number));
}

function clampNullable(value: number, min: number | null, max: number | null): number {
  let next = value;
  if (min !== null) {
    next = Math.max(min, next);
  }
  if (max !== null) {
    next = Math.min(max, next);
  }
  return next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
