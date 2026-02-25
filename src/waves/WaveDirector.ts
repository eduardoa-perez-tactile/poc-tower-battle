/*
 * Patch Notes (2026-02-24):
 * - Added Difficulty Budget wave planning with stage/mission/ascension profile support.
 * - Added WPI-based dynamic pacing and bounded cooldown compression.
 * - Added stage-scaled territory + enemy regen context integration for deterministic sim tuning.
 * - Added boss power/phase hooks and wave-boundary difficulty telemetry.
 * - Added mission-level wave-count and boss toggle overrides for campaign preset control.
 */

import type { Tower, UnitPacket, Vec2, World } from "../sim/World";
import { armorFromMultiplier } from "../sim/TerritoryControl";
import type { DifficultyTierId } from "../config/Difficulty";
import { DifficultyTelemetry } from "../debug/DifficultyTelemetry";
import { EnemyFactory, type EnemyBossSpawnModifiers } from "./EnemyFactory";
import { computeDifficultyBudget, resolveAscensionModifiers, resolveStageProfile } from "./DifficultyConfig";
import type {
  EnemyArchetypeDefinition,
  DifficultyTierConfig,
  LoadedWaveContent,
  LossRiskBand,
  WavePacingDifficultyTarget,
  WaveGeneratorInputs,
  WaveModifierDefinition,
  WavePlan,
  WaveSpawnEntry,
} from "./Definitions";
import type {
  AscensionDifficultyModifiers,
  BossDifficultyModifiers,
  DifficultyAxes,
  StageDifficultyProfile,
} from "./DifficultyTypes";
import { WaveGenerator } from "./WaveGenerator";

interface WaveLane {
  index: number;
  start: Vec2;
}

interface PacketSnapshot {
  id: string;
  linkId: string;
  progress01: number;
  count: number;
  archetypeId: string;
  tags: string[];
  splitChildArchetypeId: string | null;
  splitChildCount: number;
  isElite: boolean;
  eliteDropGold: number;
  eliteDropBuffId: string | null;
  sourceWaveIndex: number;
}

interface BossAbilitySchedule {
  nextSlamAtSec: number;
  nextSummonAtSec: number;
}

export interface TelegraphMarker {
  x: number;
  y: number;
  radiusPx: number;
  label: string;
  color: string;
  windupStartSec: number;
  triggerAtSec: number;
}

export interface WavePreviewItem {
  enemyId: string;
  icon: string;
  count: number;
}

export interface MissionWaveTelemetry {
  difficultyTier: DifficultyTierId;
  currentWaveIndex: number;
  totalWaveCount: number;
  activeWaveInProgress: boolean;
  nextWaveStartsInSec: number | null;
  activeModifierNames: string[];
  nextWavePreview: WavePreviewItem[];
  missionGold: number;
  activeBuffId: string | null;
  activeBuffRemainingSec: number;
  bossName: string | null;
  bossHp01: number;
  wavePressureScore: number;
  playerTowersOwned: number;
  avgTroopsPerOwnedTower: number;
  packetsSentPerSec: number;
  timeToZeroTowersEstimateSec: number | null;
}

export interface WaveRenderState {
  telegraphs: TelegraphMarker[];
}

export interface BossTooltipTelemetry {
  phase: string;
  upcomingTelegraph: string;
}

export interface WaveDirectorOptions {
  runSeed: number;
  missionDifficultyScalar: number;
  difficultyTier: DifficultyTierId;
  stageId?: string;
  stageIndex?: number;
  missionIndex?: number;
  ascensionLevel?: number;
  balanceDiagnosticsEnabled?: boolean;
  allowedEnemyIds?: string[];
  waveCountOverride?: number;
  bossEnabledOverride?: boolean;
  rewardGoldMultiplier?: number;
  bossHpMultiplier?: number;
  bossExtraPhases?: number;
}

interface RuntimeWaveState {
  plan: WavePlan;
  elapsedSec: number;
  nextSpawnIndex: number;
  activeModifierEffects: AggregatedEffects;
  pressureScore: number;
  startedAtSec: number;
}

interface AggregatedEffects {
  speedMultiplier: number;
  armorMultiplier: number;
  spawnRateMultiplier: number;
}

interface DifficultyBudgetSnapshot {
  enabled: boolean;
  stageProfile: StageDifficultyProfile | null;
  axes: DifficultyAxes;
  ascension: AscensionDifficultyModifiers;
  missionIndex: number;
  budgetValue: number;
  unitBudget: number;
  complexityBudget: number;
  eliteBudget: number;
  regenBudget: number;
  tempoBudget: number;
  normalizedEliteBudget: number;
  normalizedRegenBudget: number;
  normalizedTempoBudget: number;
  enemyRegenMultiplier: number;
  cooldownBaseSec: number;
}

interface WaveBudgetTuning {
  difficultyBudget: number;
  cooldownSec: number;
  eliteChance: number;
  bossModifiers: BossDifficultyModifiers | null;
  archetypeMix: Record<string, number>;
  totalUnits: number;
}

interface RuntimeBossState {
  modifiers: BossDifficultyModifiers | null;
  phaseThresholds: number[];
  triggeredPhases: Set<number>;
  spawnedAtSec: number;
}

export class WaveDirector {
  private readonly content: LoadedWaveContent;
  private readonly world: World;
  private readonly waveGenerator: WaveGenerator;
  private readonly enemyFactory: EnemyFactory;
  private readonly options: WaveDirectorOptions;
  private readonly allowedEnemyIds: Set<string> | null;
  private readonly lanes: WaveLane[];
  private readonly modifierById: Map<string, WaveModifierDefinition>;
  private readonly packetSnapshots: Map<string, PacketSnapshot>;
  private readonly telegraphs: TelegraphMarker[];
  private readonly previewsByWave: Map<number, WavePreviewItem[]>;
  private readonly difficultyConfig: DifficultyTierConfig;
  private readonly goldRewardMultiplier: number;
  private readonly bossCooldownFactor: number;
  private readonly difficultyBudget: DifficultyBudgetSnapshot;
  private readonly waveBudgetByIndex: Map<number, WaveBudgetTuning>;
  private readonly plannedWavePlansByIndex: Map<number, WavePlan>;
  private readonly missionArchetypesSeen: Set<string>;
  private readonly telemetry: DifficultyTelemetry;

  private currentWaveIndex: number;
  private readonly totalWaveCount: number;
  private cooldownUntilNextWaveSec: number;
  private runtimeWave: RuntimeWaveState | null;
  private missionGold: number;
  private activeBuffId: string | null;
  private activeBuffRemainingSec: number;
  private activeBossPacketId: string | null;
  private bossAbilitySchedule: BossAbilitySchedule | null;
  private packetSequence: number;
  private simulationTimeSec: number;
  private finished: boolean;
  private diagnosticsEnabled: boolean;
  private currentWavePressureScore: number;
  private packetsSentPerSec: number;
  private packetRateAccumulatorSec: number;
  private packetRateAccumulatorCount: number;
  private previousPlayerPacketCount: number;
  private wpiEma: number;
  private runtimeBossState: RuntimeBossState | null;
  private playerTowersAtWaveStart: number;

  constructor(world: World, content: LoadedWaveContent, options: WaveDirectorOptions) {
    this.content = content;
    this.world = world;
    this.options = options;
    const allowedEnemyIds = options.allowedEnemyIds ? new Set(options.allowedEnemyIds) : null;
    this.allowedEnemyIds = allowedEnemyIds;
    this.waveGenerator = new WaveGenerator(content, allowedEnemyIds);
    this.enemyFactory = new EnemyFactory(content, {
      allowedEnemyIds: allowedEnemyIds ?? undefined,
      bossHpMul: options.bossHpMultiplier,
    });
    this.lanes = createLanes(world);
    this.modifierById = new Map<string, WaveModifierDefinition>();
    this.packetSnapshots = new Map<string, PacketSnapshot>();
    this.telegraphs = [];
    this.previewsByWave = new Map<number, WavePreviewItem[]>();
    this.difficultyConfig = content.difficultyTiers.difficultyTiers[options.difficultyTier];
    this.goldRewardMultiplier = this.difficultyConfig.economy.goldMul * (options.rewardGoldMultiplier ?? 1);
    this.bossCooldownFactor = 1 / (1 + Math.max(0, options.bossExtraPhases ?? 0) * 0.5);
    this.waveBudgetByIndex = new Map<number, WaveBudgetTuning>();
    this.plannedWavePlansByIndex = new Map<number, WavePlan>();
    this.missionArchetypesSeen = new Set<string>();
    this.telemetry = new DifficultyTelemetry();

    const missionIndex = Math.max(0, Math.floor(options.missionIndex ?? 0));
    const stageProfile = resolveStageProfile(content.stageDifficulty, {
      stageId: options.stageId,
      stageIndex: options.stageIndex,
    });
    const stageId = stageProfile?.id ?? normalizeStageId(options.stageId);
    const stageIndex = stageProfile?.stageIndex ?? Math.max(1, Math.floor(options.stageIndex ?? deriveStageIndex(stageId)));
    const ascensionLevel = Math.max(
      0,
      Math.floor(options.ascensionLevel ?? Math.max(0, options.bossExtraPhases ?? 0)),
    );
    const ascension = resolveAscensionModifiers(content.ascensionDifficulty, ascensionLevel);
    const axes = resolveAxesForMission(stageProfile, missionIndex);
    const budgetValue = stageProfile ? computeDifficultyBudget(stageProfile, missionIndex, ascensionLevel) : 0;

    const unitBudget = budgetValue * (stageProfile?.budgetAllocation.unitCount ?? 0);
    const complexityBudget = budgetValue * (stageProfile?.budgetAllocation.complexity ?? 0);
    const eliteBudget = budgetValue * (stageProfile?.budgetAllocation.elite ?? 0);
    const regenBudget = budgetValue * (stageProfile?.budgetAllocation.regen ?? 0);
    const tempoBudget = budgetValue * (stageProfile?.budgetAllocation.tempo ?? 0);
    const normalizedEliteBudget = eliteBudget > 0 ? eliteBudget / Math.max(1, budgetValue) : 0;
    const normalizedRegenBudget = regenBudget > 0 ? regenBudget / Math.max(1, budgetValue) : 0;
    const normalizedTempoBudget = tempoBudget > 0 ? tempoBudget / Math.max(1, budgetValue) : 0;
    const enemyRegenMultiplier = clamp(
      1 + axes.economy * 0.15 + normalizedRegenBudget * 0.1 + ascension.enemyRegenBonus,
      1,
      1.75,
    );
    const cooldownBaseSec = stageProfile
      ? computeBaseCooldown(stageProfile, axes, normalizedTempoBudget)
      : 3;

    this.difficultyBudget = {
      enabled: Boolean(stageProfile),
      stageProfile,
      axes,
      ascension,
      missionIndex,
      budgetValue,
      unitBudget,
      complexityBudget,
      eliteBudget,
      regenBudget,
      tempoBudget,
      normalizedEliteBudget,
      normalizedRegenBudget,
      normalizedTempoBudget,
      enemyRegenMultiplier,
      cooldownBaseSec,
    };

    for (const modifier of content.modifierCatalog.modifiers) {
      this.modifierById.set(modifier.id, modifier);
    }

    this.currentWaveIndex = 0;
    const baseWaveCount = this.waveGenerator.getTotalWaveCount();
    this.totalWaveCount = clamp(
      options.waveCountOverride ?? baseWaveCount,
      1,
      baseWaveCount,
    );
    this.cooldownUntilNextWaveSec = this.difficultyBudget.enabled
      ? Math.max(0.75, this.difficultyBudget.cooldownBaseSec * 0.35)
      : 1;
    this.runtimeWave = null;
    this.missionGold = 0;
    this.activeBuffId = null;
    this.activeBuffRemainingSec = 0;
    this.activeBossPacketId = null;
    this.bossAbilitySchedule = null;
    this.packetSequence = 0;
    this.simulationTimeSec = 0;
    this.finished = false;
    this.diagnosticsEnabled = Boolean(options.balanceDiagnosticsEnabled);
    this.currentWavePressureScore = 0;
    this.packetsSentPerSec = 0;
    this.packetRateAccumulatorSec = 0;
    this.packetRateAccumulatorCount = 0;
    this.previousPlayerPacketCount = 0;
    this.wpiEma = this.difficultyBudget.stageProfile
      ? (this.difficultyBudget.stageProfile.tempoModel.wpi.targetLow +
          this.difficultyBudget.stageProfile.tempoModel.wpi.targetHigh) *
        0.5
      : 1;
    this.runtimeBossState = null;
    this.playerTowersAtWaveStart = countOwnedTowers(this.world.towers, "player");

    const territoryPenalty = resolveTerritoryPenalty(
      this.difficultyBudget.stageProfile,
      this.difficultyBudget.ascension.territoryPenalty,
    );
    this.world.setDifficultyContext({
      stageId,
      stageIndex,
      missionIndex,
      enemyRegenMultiplier: this.difficultyBudget.enemyRegenMultiplier,
      interferenceLinkDecayPerSec:
        this.difficultyBudget.axes.interference * (this.difficultyBudget.ascension.linkDecayEnabled ? 0.35 : 0),
      linkDecayCanBreak: this.difficultyBudget.ascension.linkDecayEnabled,
      territoryScaling: {
        regenPerCluster: this.difficultyBudget.stageProfile?.territoryScaling.regenPerCluster ?? 0.1,
        armorPerCluster: this.difficultyBudget.stageProfile?.territoryScaling.armorPerCluster ?? 0.15,
        visionPerCluster: this.difficultyBudget.stageProfile?.territoryScaling.visionPerCluster ?? 0.2,
      },
      playerTerritoryPenalty: territoryPenalty,
    });

    this.preparePlannedWaves();
    this.preparePreviews();
  }

  updatePreStep(dtSec: number): void {
    this.simulationTimeSec += dtSec;
    this.updatePlayerPacketRate(dtSec);
    this.sampleWavePressureIndex();

    if (this.activeBuffRemainingSec > 0) {
      this.activeBuffRemainingSec = Math.max(0, this.activeBuffRemainingSec - dtSec);
      if (this.activeBuffRemainingSec <= 0) {
        this.activeBuffId = null;
      }
    }

    if (this.activeBuffRemainingSec > 0) {
      const regenBoost = this.content.balance.elite.temporaryBuffSpeedMultiplier;
      const regenBonus =
        this.content.balanceBaselines.troopRegen.temporaryBuffBonusScale * (regenBoost - 1);
      const regenCaps = this.content.balanceBaselines.troopRegen.globalRegenCaps;
      for (const tower of this.world.towers) {
        if (tower.owner !== "player") {
          continue;
        }
        const clampedBonus = clamp(regenBonus, regenCaps.min, regenCaps.max);
        tower.troops = Math.min(tower.maxTroops, tower.troops + clampedBonus * dtSec);
      }
    }

    this.generateBankGold(dtSec);
    this.advanceWaveSpawner(dtSec);
    this.updateTelegraphs();
  }

  updatePostStep(dtSec: number): void {
    this.processTowerCaptureEvents();
    this.processPacketDeaths();
    this.updateBossState(dtSec);
    this.cleanupStaleScriptedLinks();

    if (!this.runtimeWave) {
      if (this.currentWaveIndex >= this.totalWaveCount) {
        this.finished = true;
      }
      return;
    }

    const allSpawned = this.runtimeWave.nextSpawnIndex >= this.runtimeWave.plan.spawnEntries.length;
    const hasAliveWavePackets = this.hasAlivePacketsForWave(this.currentWaveIndex);
    if (allSpawned && !hasAliveWavePackets) {
      const waveClearReward =
        this.content.balanceBaselines.economy.baseGoldPerWave +
        this.currentWaveIndex * this.content.balance.goldRewards.waveClearPerWave;
      this.addMissionGold(waveClearReward);
      const currentWaveRuntime = this.runtimeWave;
      this.validateWaveEnd(this.runtimeWave, dtSec);
      this.telemetry.finishWave(
        Math.max(0, this.playerTowersAtWaveStart - countOwnedTowers(this.world.towers, "player")),
      );
      this.runtimeWave = null;
      this.currentWavePressureScore = 0;
      this.cooldownUntilNextWaveSec = this.computeNextWaveCooldown();
      this.playerTowersAtWaveStart = countOwnedTowers(this.world.towers, "player");
      this.runtimeBossState = null;
      if (this.currentWaveIndex >= this.totalWaveCount) {
        this.finished = true;
      }
      void currentWaveRuntime;
    }
  }

  isFinished(): boolean {
    return this.finished;
  }

  getCurrentWaveIndex(): number {
    return this.currentWaveIndex;
  }

  getTelemetry(): MissionWaveTelemetry {
    const activeModifierNames = this.runtimeWave
      ? this.runtimeWave.plan.modifiers
          .map((id) => this.modifierById.get(id)?.name ?? id)
          .filter((name) => name.length > 0)
      : [];

    const nextWavePreview = this.previewsByWave.get(this.currentWaveIndex + 1) ?? [];
    const activeBoss = this.getActiveBossPacket();
    const bossName = activeBoss ? this.enemyFactory.getArchetype(activeBoss.archetypeId).name : null;
    const bossHp01 = activeBoss ? clamp(activeBoss.count / Math.max(1, activeBoss.baseCount), 0, 1) : 0;
    const playerMetrics = this.getPlayerMetrics();
    const timeToZeroTowersEstimateSec = this.estimateTimeToZeroTowersSec();
    const activeWaveInProgress = this.runtimeWave !== null;
    const nextWaveStartsInSec =
      this.currentWaveIndex >= this.totalWaveCount
        ? null
        : activeWaveInProgress
          ? null
          : Math.max(0, this.cooldownUntilNextWaveSec);

    return {
      difficultyTier: this.options.difficultyTier,
      currentWaveIndex: this.currentWaveIndex,
      totalWaveCount: this.totalWaveCount,
      activeWaveInProgress,
      nextWaveStartsInSec,
      activeModifierNames,
      nextWavePreview,
      missionGold: Math.max(0, Math.round(this.missionGold)),
      activeBuffId: this.activeBuffId,
      activeBuffRemainingSec: this.activeBuffRemainingSec,
      bossName,
      bossHp01,
      wavePressureScore: this.currentWavePressureScore,
      playerTowersOwned: playerMetrics.playerTowersOwned,
      avgTroopsPerOwnedTower: playerMetrics.avgTroopsPerOwnedTower,
      packetsSentPerSec: this.packetsSentPerSec,
      timeToZeroTowersEstimateSec,
    };
  }

  getBossTooltipTelemetry(): BossTooltipTelemetry | null {
    const boss = this.getActiveBossPacket();
    if (!boss) {
      return null;
    }

    const healthRatio = clamp(boss.count / Math.max(1, boss.baseCount), 0, 1);
    const dynamicPhaseLabel = this.runtimeBossState
      ? `Phase ${Math.min(this.runtimeBossState.phaseThresholds.length + 1, this.runtimeBossState.triggeredPhases.size + 1)}`
      : null;
    const phase = boss.bossEnraged
      ? "Enraged"
      : dynamicPhaseLabel
        ? dynamicPhaseLabel
      : healthRatio > 0.66
        ? "Phase 1"
        : healthRatio > this.content.balance.boss.enrageThreshold
          ? "Phase 2"
          : "Phase 3";

    let upcomingTelegraph = "Slam / Summon / Enrage";
    if (this.bossAbilitySchedule) {
      upcomingTelegraph =
        this.bossAbilitySchedule.nextSlamAtSec <= this.bossAbilitySchedule.nextSummonAtSec
          ? "Slam"
          : "Summon";
    }

    return {
      phase,
      upcomingTelegraph,
    };
  }

  getRenderState(): WaveRenderState {
    return {
      telegraphs: this.telegraphs,
    };
  }

  getDebugEnemyIds(): string[] {
    return this.enemyFactory.listAllArchetypes().map((archetype) => archetype.id);
  }

  getDebugMaxWaveIndex(): number {
    return this.totalWaveCount;
  }

  getDifficultyTelemetryRecords(): ReturnType<DifficultyTelemetry["getRecords"]> {
    return this.telemetry.getRecords();
  }

  debugDescribePlannedWaves(): string[] {
    const lines: string[] = [];
    for (let waveIndex = 1; waveIndex <= this.totalWaveCount; waveIndex += 1) {
      const plan = this.plannedWavePlansByIndex.get(waveIndex);
      const tuning = this.waveBudgetByIndex.get(waveIndex);
      if (!plan || !tuning) {
        continue;
      }
      const mixSummary = Object.entries(tuning.archetypeMix)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([id, count]) => `${id}:${count}`)
        .join(", ");
      lines.push(
        `W${waveIndex} DB=${tuning.difficultyBudget.toFixed(2)} units=${tuning.totalUnits} elite=${tuning.eliteChance.toFixed(2)} cooldown=${tuning.cooldownSec.toFixed(2)} mix=[${mixSummary}]`,
      );
    }
    return lines;
  }

  setBalanceDiagnosticsEnabled(enabled: boolean): void {
    this.diagnosticsEnabled = enabled;
  }

  isBalanceDiagnosticsEnabled(): boolean {
    return this.diagnosticsEnabled;
  }

  debugSpawnEnemy(archetypeId: string, elite: boolean): void {
    const lane = this.lanes[0];
    const entry: WaveSpawnEntry = {
      timeOffsetSec: 0,
      enemyId: archetypeId,
      count: 1,
      eliteChance: elite ? 1 : 0,
      laneIndex: lane.index,
    };
    const modifierEffects: AggregatedEffects = {
      speedMultiplier: 1,
      armorMultiplier: 1,
      spawnRateMultiplier: 1,
    };
    this.spawnEntry(entry, this.currentWaveIndex <= 0 ? 1 : this.currentWaveIndex, modifierEffects);
  }

  debugStartWave(waveIndex: number): void {
    const normalized = Math.max(1, Math.min(this.totalWaveCount, Math.floor(waveIndex)));
    this.currentWaveIndex = normalized - 1;
    this.cooldownUntilNextWaveSec = 0;
    this.runtimeWave = null;
    this.finished = false;
    this.activeBossPacketId = null;
    this.bossAbilitySchedule = null;
    this.currentWavePressureScore = 0;
  }

  private preparePlannedWaves(): void {
    this.missionArchetypesSeen.clear();
    for (let waveIndex = 1; waveIndex <= this.totalWaveCount; waveIndex += 1) {
      const plan = this.generateWavePlan(waveIndex);
      this.plannedWavePlansByIndex.set(waveIndex, plan);
    }
  }

  private preparePreviews(): void {
    for (let waveIndex = 1; waveIndex <= this.totalWaveCount; waveIndex += 1) {
      const plan = this.plannedWavePlansByIndex.get(waveIndex) ?? this.waveGenerator.generate(this.getWaveGeneratorInputs(waveIndex));
      this.previewsByWave.set(waveIndex, summarizeWavePreview(plan, this.enemyFactory));
    }
  }

  private advanceWaveSpawner(dtSec: number): void {
    if (this.finished) {
      return;
    }

    if (!this.runtimeWave) {
      this.cooldownUntilNextWaveSec = Math.max(0, this.cooldownUntilNextWaveSec - dtSec);
      if (this.cooldownUntilNextWaveSec <= 0 && this.currentWaveIndex < this.totalWaveCount) {
        this.currentWaveIndex += 1;
        const plan =
          this.plannedWavePlansByIndex.get(this.currentWaveIndex) ??
          this.waveGenerator.generate(this.getWaveGeneratorInputs(this.currentWaveIndex));
        const modifierEffects = this.aggregateModifierEffects(plan.modifiers);
        const pressureScore = this.computePressureScore(plan, modifierEffects);
        this.runtimeWave = {
          plan,
          elapsedSec: 0,
          nextSpawnIndex: 0,
          activeModifierEffects: modifierEffects,
          pressureScore,
          startedAtSec: this.simulationTimeSec,
        };
        const tuning = this.waveBudgetByIndex.get(this.currentWaveIndex);
        if (tuning) {
          this.telemetry.startWave({
            waveIndex: this.currentWaveIndex,
            difficultyBudget: tuning.difficultyBudget,
            unitCount: tuning.totalUnits,
            archetypeMix: { ...tuning.archetypeMix },
            eliteChance: tuning.eliteChance,
            enemyRegenMultiplier: this.difficultyBudget.enemyRegenMultiplier,
            cooldownSec: tuning.cooldownSec,
          });
        }
        this.currentWavePressureScore = pressureScore;
        this.playerTowersAtWaveStart = countOwnedTowers(this.world.towers, "player");
        this.validateWaveStart(this.runtimeWave);
      }
      return;
    }

    this.runtimeWave.elapsedSec += dtSec;
    while (this.runtimeWave.nextSpawnIndex < this.runtimeWave.plan.spawnEntries.length) {
      const entry = this.runtimeWave.plan.spawnEntries[this.runtimeWave.nextSpawnIndex];
      if (entry.timeOffsetSec > this.runtimeWave.elapsedSec) {
        break;
      }

      this.spawnEntry(
        entry,
        this.currentWaveIndex,
        this.runtimeWave.activeModifierEffects,
        this.waveBudgetByIndex.get(this.currentWaveIndex)?.bossModifiers,
      );
      this.runtimeWave.nextSpawnIndex += 1;
    }
  }

  private spawnEntry(
    entry: WaveSpawnEntry,
    waveIndex: number,
    effects: AggregatedEffects,
    bossModifiers?: BossDifficultyModifiers | null,
  ): void {
    const lane = this.getLane(entry.laneIndex);
    const targetTower = pickPlayerTarget(this.world.towers, lane.start);
    if (!targetTower) {
      return;
    }

    const linkId = `wave-lane-${lane.index}-to-${targetTower.id}`;
    this.world.upsertScriptedLink({
      id: linkId,
      fromTowerId: `wave-lane-${lane.index}`,
      toTowerId: targetTower.id,
      owner: "enemy",
      isScripted: true,
      hideInRender: true,
      points: [
        { x: lane.start.x, y: lane.start.y },
        { x: targetTower.x, y: targetTower.y },
      ],
    });

    const eliteRng = createRng(mixSeed(this.options.runSeed, waveIndex, this.packetSequence + 1));
    const eliteChance = clamp(entry.eliteChance, 0, 1);

    for (let i = 0; i < entry.count; i += 1) {
      const isElite = eliteRng() < eliteChance;
      this.packetSequence += 1;
      const packet = this.enemyFactory.createEnemyPacket({
        packetId: `wave-pkt-${this.packetSequence}`,
        owner: "enemy",
        linkId,
        archetypeId: entry.enemyId,
        count: 1,
        waveIndex,
        difficultyTier: this.options.difficultyTier,
        missionDifficultyScalar: this.options.missionDifficultyScalar,
        isElite,
        isBoss: entry.enemyId === this.content.balance.boss.id,
        bossModifiers: mapBossSpawnModifiers(bossModifiers),
      });

      packet.baseCount = packet.count;
      packet.sourceLane = lane.index;
      packet.sourceWaveIndex = waveIndex;
      const packetCaps = this.content.balanceBaselines.packets.globalCaps;
      const speedMinMul = packetCaps.speedMin / Math.max(1, packet.speedPxPerSec);
      const speedMaxMul = packetCaps.speedMax / Math.max(1, packet.speedPxPerSec);
      packet.baseSpeedMultiplier = clamp(effects.speedMultiplier, speedMinMul, speedMaxMul);
      packet.baseArmorMultiplier = clamp(
        effects.armorMultiplier,
        packetCaps.armorMin,
        packetCaps.armorMax,
      );
      packet.baseArmor = armorFromMultiplier(packet.baseArmorMultiplier);
      packet.effectiveArmor = packet.baseArmor;

      this.world.packets.push(this.world.acquirePacket(packet));

      if (packet.isBoss) {
        const effectiveBossModifiers = bossModifiers ?? this.waveBudgetByIndex.get(waveIndex)?.bossModifiers ?? null;
        const abilityCooldownMultiplier = effectiveBossModifiers?.abilityCooldownMultiplier ?? 1;
        this.activeBossPacketId = packet.id;
        this.bossAbilitySchedule = {
          nextSlamAtSec:
            this.simulationTimeSec +
            this.content.balance.boss.slam.cooldownSec *
              this.bossCooldownFactor *
              abilityCooldownMultiplier,
          nextSummonAtSec:
            this.simulationTimeSec +
            this.content.balance.boss.summon.cooldownSec *
              this.bossCooldownFactor *
              abilityCooldownMultiplier,
        };
        this.runtimeBossState = createRuntimeBossState(
          this.difficultyBudget.stageProfile,
          this.difficultyBudget.ascension,
          effectiveBossModifiers,
          this.simulationTimeSec,
        );
      }
    }
  }

  private processPacketDeaths(): void {
    const current = new Map<string, PacketSnapshot>();

    for (const packet of this.world.packets) {
      if (packet.owner !== "enemy") {
        continue;
      }
      current.set(packet.id, {
        id: packet.id,
        linkId: packet.linkId,
        progress01: packet.progress01,
        count: packet.count,
        archetypeId: packet.archetypeId,
        tags: [...packet.tags],
        splitChildArchetypeId: packet.splitChildArchetypeId,
        splitChildCount: packet.splitChildCount,
        isElite: packet.isElite,
        eliteDropGold: packet.eliteDropGold,
        eliteDropBuffId: packet.eliteDropBuffId,
        sourceWaveIndex: packet.sourceWaveIndex,
      });
    }

    for (const [packetId, snapshot] of this.packetSnapshots.entries()) {
      if (current.has(packetId)) {
        continue;
      }

      const defeatedInTransit = snapshot.progress01 < 0.99;
      if (defeatedInTransit) {
        this.handleEnemyKill(snapshot);
      }

      if (snapshot.splitChildArchetypeId && snapshot.splitChildCount > 0 && defeatedInTransit) {
        this.spawnSplitChildren(snapshot);
      }

      if (this.activeBossPacketId === packetId) {
        this.activeBossPacketId = null;
        this.bossAbilitySchedule = null;
        this.runtimeBossState = null;
      }
    }

    this.packetSnapshots.clear();
    for (const [id, snapshot] of current.entries()) {
      this.packetSnapshots.set(id, snapshot);
    }
  }

  private handleEnemyKill(snapshot: PacketSnapshot): void {
    const goldConfig = this.content.balance.goldRewards;
    let reward = goldConfig.baseKill;
    for (const tag of snapshot.tags) {
      reward += goldConfig.tagBonuses[tag] ?? 0;
    }
    if (snapshot.isElite) {
      reward += goldConfig.eliteBonus + snapshot.eliteDropGold;
      if (snapshot.eliteDropBuffId) {
        this.activeBuffId = snapshot.eliteDropBuffId;
        this.activeBuffRemainingSec = this.content.balance.elite.temporaryBuffDurationSec;
      }
    }

    this.addMissionGold(reward);
  }

  private spawnSplitChildren(snapshot: PacketSnapshot): void {
    const link = this.world.getLinkById(snapshot.linkId);
    if (!link || !snapshot.splitChildArchetypeId) {
      return;
    }

    const lane = pickLaneByLink(this.lanes, link, snapshot.sourceWaveIndex);
    const childCount = Math.max(1, snapshot.splitChildCount);

    for (let i = 0; i < childCount; i += 1) {
      this.packetSequence += 1;
      const child = this.enemyFactory.createEnemyPacket({
        packetId: `wave-pkt-${this.packetSequence}`,
        owner: "enemy",
        linkId: snapshot.linkId,
        archetypeId: snapshot.splitChildArchetypeId,
        count: 1,
        waveIndex: Math.max(1, snapshot.sourceWaveIndex),
        difficultyTier: this.options.difficultyTier,
        missionDifficultyScalar: this.options.missionDifficultyScalar,
        isElite: false,
        isBoss: false,
      });

      child.progress01 = clamp(snapshot.progress01 - 0.02 + i * 0.01, 0, 0.98);
      child.sourceWaveIndex = Math.max(1, snapshot.sourceWaveIndex);
      child.sourceLane = lane.index;
      child.baseSpeedMultiplier = 1;
      child.baseArmorMultiplier = 1;
      child.baseArmor = armorFromMultiplier(child.baseArmorMultiplier);
      child.effectiveArmor = child.baseArmor;
      this.world.packets.push(this.world.acquirePacket(child));
    }
  }

  private updateBossState(dtSec: number): void {
    void dtSec;
    const bossPacket = this.getActiveBossPacket();
    if (!bossPacket || !this.bossAbilitySchedule) {
      return;
    }

    const healthRatio = bossPacket.count / Math.max(1, bossPacket.baseCount);
    if (this.runtimeBossState) {
      for (let i = 0; i < this.runtimeBossState.phaseThresholds.length; i += 1) {
        if (this.runtimeBossState.triggeredPhases.has(i)) {
          continue;
        }
        if (healthRatio > this.runtimeBossState.phaseThresholds[i]) {
          continue;
        }
        this.runtimeBossState.triggeredPhases.add(i);
        this.triggerBossPhase(i);
      }
    }

    const enrageThreshold = this.difficultyBudget.stageProfile?.bossModel.enrage.hpBelow ?? this.content.balance.boss.enrageThreshold;
    const enrageAtTimeSec = this.difficultyBudget.stageProfile?.bossModel.enrage.timeSec;
    const timedEnrage = Number.isFinite(enrageAtTimeSec)
      ? this.simulationTimeSec - (this.runtimeBossState?.spawnedAtSec ?? this.simulationTimeSec) >= (enrageAtTimeSec as number)
      : false;

    if (!bossPacket.bossEnraged && (healthRatio <= enrageThreshold || timedEnrage)) {
      bossPacket.bossEnraged = true;
      bossPacket.baseSpeedMultiplier *= this.content.balance.boss.enrageSpeedMultiplier;
      bossPacket.dpsPerUnit *= this.content.balance.boss.enrageDamageMultiplier;
    }

    const bossPosition = samplePacketPosition(this.world, bossPacket);
    if (!bossPosition) {
      return;
    }

    const abilityCooldownMultiplier = this.runtimeBossState?.modifiers?.abilityCooldownMultiplier ?? 1;

    if (this.simulationTimeSec >= this.bossAbilitySchedule.nextSlamAtSec) {
      const target = pickPlayerTarget(this.world.towers, bossPosition);
      if (target) {
        this.telegraphs.push({
          x: target.x,
          y: target.y,
          radiusPx: this.content.balance.boss.slam.radiusPx,
          label: "Slam",
          color: "rgba(255, 99, 71, 0.45)",
          windupStartSec: this.simulationTimeSec,
          triggerAtSec: this.simulationTimeSec + this.content.balance.boss.slam.windupSec,
        });
      }
      this.bossAbilitySchedule.nextSlamAtSec =
        this.simulationTimeSec +
        this.content.balance.boss.slam.cooldownSec *
          this.bossCooldownFactor *
          abilityCooldownMultiplier;
    }

    if (this.simulationTimeSec >= this.bossAbilitySchedule.nextSummonAtSec) {
      this.telegraphs.push({
        x: bossPosition.x,
        y: bossPosition.y,
        radiusPx: 90,
        label: "Summon",
        color: "rgba(123, 44, 191, 0.45)",
        windupStartSec: this.simulationTimeSec,
        triggerAtSec: this.simulationTimeSec + this.content.balance.boss.summon.windupSec,
      });
      this.bossAbilitySchedule.nextSummonAtSec =
        this.simulationTimeSec +
        this.content.balance.boss.summon.cooldownSec *
          this.bossCooldownFactor *
          abilityCooldownMultiplier;
    }
  }

  private triggerBossPhase(phaseIndex: number): void {
    const stageProfile = this.difficultyBudget.stageProfile;
    if (!stageProfile) {
      return;
    }
    const phase = stageProfile.bossModel.phases[phaseIndex];
    if (!phase) {
      return;
    }

    if (phase.addReinforcementWave) {
      const lane = this.lanes[Math.max(0, this.lanes.length - 1)] ?? this.getLane(0);
      const reinforcementCount =
        2 + Math.max(0, Math.round((this.runtimeBossState?.modifiers?.reinforcementCountBonus ?? 0)));
      this.spawnEntry(
        {
          timeOffsetSec: 0,
          enemyId: stageProfile.bossModel.enabled ? this.content.balance.boss.summon.enemyId : "swarm",
          count: reinforcementCount,
          eliteChance: clamp(0.15 + this.difficultyBudget.normalizedEliteBudget * 0.2, 0, 0.35),
          laneIndex: lane.index,
        },
        Math.max(1, this.currentWaveIndex),
        {
          speedMultiplier: 1,
          armorMultiplier: 1,
          spawnRateMultiplier: 1,
        },
      );
    }

    if (phase.regenSpike) {
      const context = this.world.getDifficultyContext();
      this.world.setDifficultyContext({
        enemyRegenMultiplier: clamp(
          context.enemyRegenMultiplier * (1 + phase.regenSpike),
          1,
          1.9,
        ),
      });
    }

    if (phase.tempoSpike && this.bossAbilitySchedule) {
      const tempoFactor = clamp(1 - phase.tempoSpike, 0.7, 1);
      const slamDelta = Math.max(0, this.bossAbilitySchedule.nextSlamAtSec - this.simulationTimeSec);
      const summonDelta = Math.max(0, this.bossAbilitySchedule.nextSummonAtSec - this.simulationTimeSec);
      this.bossAbilitySchedule.nextSlamAtSec = this.simulationTimeSec + slamDelta * tempoFactor;
      this.bossAbilitySchedule.nextSummonAtSec = this.simulationTimeSec + summonDelta * tempoFactor;
    }
  }

  private updateTelegraphs(): void {
    for (let i = this.telegraphs.length - 1; i >= 0; i -= 1) {
      const marker = this.telegraphs[i];
      if (this.simulationTimeSec < marker.triggerAtSec) {
        continue;
      }

      if (marker.label === "Slam") {
        this.resolveBossSlam(marker);
      } else if (marker.label === "Summon") {
        this.resolveBossSummon(marker);
      }
      this.telegraphs.splice(i, 1);
    }
  }

  private resolveBossSlam(marker: TelegraphMarker): void {
    const damage = this.content.balance.boss.slam.towerDamage;
    for (const tower of this.world.towers) {
      if (tower.owner !== "player") {
        continue;
      }

      const distance = Math.hypot(tower.x - marker.x, tower.y - marker.y);
      if (distance > marker.radiusPx) {
        continue;
      }

      tower.hp -= damage;
      if (tower.hp > 0) {
        continue;
      }

      tower.owner = "enemy";
      tower.hp = tower.maxHp * 0.55;
      tower.troops = Math.min(tower.maxTroops, 10);
    }
  }

  private generateBankGold(dtSec: number): void {
    if (!this.runtimeWave) {
      return;
    }

    for (const tower of this.world.towers) {
      if (tower.owner !== "player" || tower.goldPerSecond <= 0) {
        continue;
      }
      const cappedPerSec = Math.min(
        tower.goldPerSecond,
        this.content.balanceBaselines.economy.bankGoldPerSec,
      );
      this.addMissionGold(cappedPerSec * dtSec);
    }
  }

  private processTowerCaptureEvents(): void {
    const captureEvents = this.world.drainTowerCapturedEvents();
    if (captureEvents.length === 0) {
      return;
    }

    for (const event of captureEvents) {
      if (event.newOwner !== "player" || event.previousOwner === "player") {
        continue;
      }
      const tower = this.world.getTowerById(event.towerId);
      if (!tower || tower.recaptureBonusGold <= 0) {
        continue;
      }
      this.addMissionGold(tower.recaptureBonusGold);
    }
  }

  private resolveBossSummon(marker: TelegraphMarker): void {
    const lane = pickNearestLane(this.lanes, { x: marker.x, y: marker.y });
    const countBonus = this.runtimeBossState?.modifiers?.reinforcementCountBonus ?? 0;
    const entry: WaveSpawnEntry = {
      timeOffsetSec: 0,
      enemyId: this.content.balance.boss.summon.enemyId,
      count: Math.max(1, Math.round(this.content.balance.boss.summon.count + countBonus)),
      eliteChance: 0.2,
      laneIndex: lane.index,
    };
    this.spawnEntry(entry, Math.max(1, this.currentWaveIndex), {
      speedMultiplier: this.content.balanceBaselines.packets.fightResolutionModelParams.bossSummonSpeedMultiplier,
      armorMultiplier: 1,
      spawnRateMultiplier: 1,
    });
  }

  private cleanupStaleScriptedLinks(): void {
    const activeLinkIds = new Set<string>();
    for (const packet of this.world.packets) {
      activeLinkIds.add(packet.linkId);
    }
    this.world.removeScriptedLinksNotIn(activeLinkIds);
  }

  private hasAlivePacketsForWave(waveIndex: number): boolean {
    for (const packet of this.world.packets) {
      if (packet.owner === "enemy" && packet.sourceWaveIndex === waveIndex) {
        return true;
      }
    }
    return false;
  }

  private generateWavePlan(waveIndex: number): WavePlan {
    const basePlan = this.waveGenerator.generate(this.getWaveGeneratorInputs(waveIndex));
    if (!this.difficultyBudget.enabled || !this.difficultyBudget.stageProfile) {
      const normalizedBasePlan =
        this.options.bossEnabledOverride === false
          ? {
              ...basePlan,
              spawnEntries: basePlan.spawnEntries.filter((entry) => entry.enemyId !== this.content.balance.boss.id),
              isBossWave: false,
            }
          : basePlan;
      this.waveBudgetByIndex.set(waveIndex, {
        difficultyBudget: this.options.missionDifficultyScalar,
        cooldownSec: 3,
        eliteChance: averageEliteChance(normalizedBasePlan.spawnEntries),
        bossModifiers: null,
        archetypeMix: countArchetypes(normalizedBasePlan.spawnEntries),
        totalUnits: normalizedBasePlan.spawnEntries.reduce((sum, entry) => sum + entry.count, 0),
      });
      return normalizedBasePlan;
    }

    const stageProfile = this.difficultyBudget.stageProfile;
    const waveProgress01 = clamp((waveIndex - 1) / Math.max(1, this.totalWaveCount - 1), 0, 1);
    const waveDifficultyBudget = this.difficultyBudget.budgetValue * (0.82 + waveProgress01 * 0.36);
    const unitBudgetPoints = Math.max(
      5,
      Math.round(waveDifficultyBudget * stageProfile.budgetAllocation.unitCount * this.options.missionDifficultyScalar),
    );
    const complexityAxis = clamp(
      this.difficultyBudget.axes.complexity + waveProgress01 * 0.1 + this.difficultyBudget.complexityBudget / Math.max(1, waveDifficultyBudget) * 0.15,
      0,
      2,
    );
    const tier = resolveComplexityTier(stageProfile, complexityAxis);
    const eliteChance = clamp(
      tier.eliteChance +
        this.difficultyBudget.normalizedEliteBudget * 0.18 +
        (this.difficultyBudget.ascension.eliteEarlier ? 0.05 : 0),
      0,
      0.35,
    );
    const rng = createRng(mixSeed(this.options.runSeed, waveIndex, 0x5f3759df));

    const allowedArchetypes = this.resolveAllowedArchetypes(tier.allowedArchetypes);
    const weightedPool = buildWeightedArchetypePool(allowedArchetypes, tier.weights);
    const archetypeCounts = this.allocateArchetypeCounts(
      basePlan.spawnEntries.length,
      unitBudgetPoints,
      weightedPool,
      stageProfile.archetypeProgression.maxNewArchetypesPerMission,
      rng,
    );

    const spawnEntries: WaveSpawnEntry[] = [];
    const laneCount = Math.max(1, this.lanes.length);
    const totalBudgetUnits = Object.values(archetypeCounts).reduce((sum, value) => sum + value, 0);
    const entryCount = Math.max(1, basePlan.spawnEntries.length);
    const tempoSpacingMul = clamp(1 - this.difficultyBudget.axes.tempo * 0.25, 0.55, 1);
    const defaultSpacing =
      this.content.balanceBaselines.calibration.waveGeneration.spawnIntervalSec * tempoSpacingMul;

    const archetypeQueue = expandArchetypeCounts(archetypeCounts);
    let queueIndex = 0;

    for (let i = 0; i < entryCount; i += 1) {
      const baseEntry = basePlan.spawnEntries[i] ?? {
        timeOffsetSec: i * defaultSpacing,
        enemyId: archetypeQueue[queueIndex] ?? "swarm",
        count: 1,
        eliteChance,
        laneIndex: i % laneCount,
      };
      const archetypeId = archetypeQueue[queueIndex] ?? baseEntry.enemyId;
      queueIndex = Math.min(archetypeQueue.length, queueIndex + 1);

      const remainingEntries = Math.max(1, entryCount - i);
      const remainingUnits = Math.max(1, totalBudgetUnits - spawnEntries.reduce((sum, entry) => sum + entry.count, 0));
      const count = Math.max(1, Math.round(remainingUnits / remainingEntries));

      spawnEntries.push({
        timeOffsetSec: round2(i * defaultSpacing),
        enemyId: archetypeId,
        count,
        eliteChance,
        laneIndex: normalizeLane(baseEntry.laneIndex, laneCount),
      });
    }

    const minibossChance = clamp(
      tier.minibossChance + this.difficultyBudget.axes.complexity * 0.08 + (this.difficultyBudget.ascension.eliteEarlier ? 0.05 : 0),
      0,
      0.8,
    );
    const supportsExtraMiniboss =
      waveIndex >= 3 &&
      !isBossWaveIndex(this.content, waveIndex, this.totalWaveCount) &&
      this.isEnemyAllowed(this.content.balance.boss.minibossArchetypeId);
    if (supportsExtraMiniboss && rng() < minibossChance) {
      spawnEntries.push({
        timeOffsetSec: round2(entryCount * defaultSpacing + 0.45),
        enemyId: this.content.balance.boss.minibossArchetypeId,
        count: 1,
        eliteChance: 0,
        laneIndex: Math.floor(rng() * laneCount),
      });
    }

    const bossWave = this.isBossEnabledForMission() && isBossWaveIndex(this.content, waveIndex, this.totalWaveCount);
    let bossModifiers: BossDifficultyModifiers | null = null;
    if (bossWave && stageProfile.bossModel.enabled && this.isEnemyAllowed(this.content.balance.boss.id)) {
      bossModifiers = computeBossDifficultyModifiers(
        stageProfile,
        waveDifficultyBudget,
        this.difficultyBudget.ascension,
      );
      spawnEntries.unshift({
        timeOffsetSec: 0,
        enemyId: this.content.balance.boss.id,
        count: 1,
        eliteChance: 0,
        laneIndex: Math.floor(laneCount / 2),
      });
      if (bossModifiers.reinforcementCountBonus > 0) {
        spawnEntries.push({
          timeOffsetSec: round2(entryCount * defaultSpacing + 0.95),
          enemyId: this.content.balance.boss.summon.enemyId,
          count: Math.max(1, bossModifiers.reinforcementCountBonus),
          eliteChance: clamp(eliteChance * 0.8, 0, 0.35),
          laneIndex: Math.floor(laneCount / 2),
        });
      }
    }

    spawnEntries.sort((left, right) => left.timeOffsetSec - right.timeOffsetSec);

    const plan: WavePlan = {
      ...basePlan,
      waveIndex,
      spawnEntries,
      hasMiniBossEscort: supportsExtraMiniboss,
      isBossWave: bossWave,
    };

    for (const entry of spawnEntries) {
      if (entry.enemyId === this.content.balance.boss.id) {
        continue;
      }
      this.missionArchetypesSeen.add(entry.enemyId);
    }

    const cooldownSec = this.computeWaveCooldownSec(waveIndex, waveDifficultyBudget);
    const archetypeMix = countArchetypes(plan.spawnEntries);
    this.waveBudgetByIndex.set(waveIndex, {
      difficultyBudget: round2(waveDifficultyBudget),
      cooldownSec,
      eliteChance,
      bossModifiers,
      archetypeMix,
      totalUnits: plan.spawnEntries.reduce((sum, entry) => sum + entry.count, 0),
    });

    return plan;
  }

  private resolveAllowedArchetypes(archetypeIds: string[]): EnemyArchetypeDefinition[] {
    const spawnable = this.enemyFactory
      .listSpawnableArchetypes()
      .filter((archetype) => !archetype.tags.includes("boss") && !archetype.tags.includes("miniboss"));
    if (archetypeIds.length === 0) {
      return spawnable;
    }

    const byId = new Map<string, EnemyArchetypeDefinition>();
    for (const archetype of spawnable) {
      byId.set(archetype.id, archetype);
    }

    const selected: EnemyArchetypeDefinition[] = [];
    for (const id of archetypeIds) {
      const found = byId.get(id);
      if (found) {
        selected.push(found);
      }
    }
    return selected.length > 0 ? selected : spawnable;
  }

  private isEnemyAllowed(enemyId: string): boolean {
    if (!this.allowedEnemyIds || this.allowedEnemyIds.size === 0) {
      return true;
    }
    return this.allowedEnemyIds.has(enemyId);
  }

  private isBossEnabledForMission(): boolean {
    if (this.options.bossEnabledOverride !== undefined) {
      return this.options.bossEnabledOverride;
    }
    return true;
  }

  private allocateArchetypeCounts(
    targetEntries: number,
    unitBudgetPoints: number,
    weightedPool: Array<{ archetype: EnemyArchetypeDefinition; weight: number }>,
    maxNewArchetypesPerMission: number,
    rng: () => number,
  ): Record<string, number> {
    const counts: Record<string, number> = {};
    if (weightedPool.length === 0) {
      counts.swarm = Math.max(1, unitBudgetPoints);
      return counts;
    }

    let remainingBudget = unitBudgetPoints;
    let entriesRemaining = Math.max(1, targetEntries);
    let newlyIntroduced = 0;
    const allowMoreIntroductions =
      (this.difficultyBudget.stageProfile?.stageIndex ?? 1) >= 5 || this.difficultyBudget.ascension.level >= 3;

    while (remainingBudget > 0 && entriesRemaining > 0) {
      const pool = weightedPool.filter((entry) => {
        if (allowMoreIntroductions) {
          return true;
        }
        const alreadySeen = this.missionArchetypesSeen.has(entry.archetype.id) || counts[entry.archetype.id] > 0;
        if (alreadySeen) {
          return true;
        }
        return newlyIntroduced < maxNewArchetypesPerMission;
      });

      const picked = pickWeightedPoolEntry(pool.length > 0 ? pool : weightedPool, rng);
      if (!picked) {
        break;
      }

      const cost = Math.max(1, resolveSpawnCost(picked.archetype));
      const maxByBudget = Math.max(1, Math.floor(remainingBudget / cost));
      const count = Math.max(1, Math.min(maxByBudget, Math.round(remainingBudget / Math.max(1, entriesRemaining))));
      counts[picked.archetype.id] = (counts[picked.archetype.id] ?? 0) + count;
      remainingBudget -= count * cost;
      entriesRemaining -= 1;

      if (!this.missionArchetypesSeen.has(picked.archetype.id)) {
        newlyIntroduced += 1;
      }
    }

    if (Object.keys(counts).length === 0) {
      counts.swarm = Math.max(1, unitBudgetPoints);
    }

    return counts;
  }

  private computeWaveCooldownSec(waveIndex: number, waveDifficultyBudget: number): number {
    const profile = this.difficultyBudget.stageProfile;
    if (!profile) {
      return 3;
    }

    const waveProgress01 = clamp((waveIndex - 1) / Math.max(1, this.totalWaveCount - 1), 0, 1);
    const tempoBudgetNorm = this.difficultyBudget.tempoBudget / Math.max(1, waveDifficultyBudget);
    const compression = clamp(
      this.difficultyBudget.axes.tempo * 0.25 + tempoBudgetNorm * 0.1,
      0,
      profile.tempoModel.maxCompression,
    );
    const progressionMul = 1 - waveProgress01 * 0.08;
    const base = profile.tempoModel.baseCooldownSec * (1 - compression) * progressionMul;
    return clamp(base, 3, 30);
  }

  private computeNextWaveCooldown(): number {
    if (this.currentWaveIndex >= this.totalWaveCount) {
      return 0;
    }

    const upcomingWaveIndex = this.currentWaveIndex + 1;
    const baseCooldown = this.waveBudgetByIndex.get(upcomingWaveIndex)?.cooldownSec ?? 3;
    const profile = this.difficultyBudget.stageProfile;
    if (!profile || !profile.tempoModel.wpi.enabled) {
      return clamp(baseCooldown, 3, 30);
    }

    let adjustment = 1;
    if (this.wpiEma < profile.tempoModel.wpi.targetLow) {
      adjustment *= profile.tempoModel.wpi.earlySpawnFactor;
    } else if (this.wpiEma > profile.tempoModel.wpi.targetHigh) {
      adjustment *= profile.tempoModel.wpi.lateSpawnFactor;
    }

    adjustment = clamp(adjustment, 0.85, 1.15);
    return clamp(baseCooldown * adjustment, 3, 30);
  }

  private sampleWavePressureIndex(): void {
    const profile = this.difficultyBudget.stageProfile;
    const instantWpi = computeWavePressureIndex(this.world);
    if (profile?.tempoModel.wpi.enabled) {
      const smoothing = clamp(profile.tempoModel.wpi.smoothing, 0.01, 1);
      this.wpiEma = lerp(this.wpiEma, instantWpi, smoothing);
    } else {
      this.wpiEma = instantWpi;
    }

    if (this.runtimeWave) {
      this.telemetry.sampleWpi(this.wpiEma);
    }
  }

  private getWaveGeneratorInputs(waveIndex: number): WaveGeneratorInputs {
    return {
      waveIndex,
      difficultyTier: this.options.difficultyTier,
      missionDifficultyScalar: this.options.missionDifficultyScalar,
      runSeed: this.options.runSeed,
      laneCount: this.lanes.length,
    };
  }

  private getLane(index: number): WaveLane {
    const laneCount = this.lanes.length;
    if (laneCount === 0) {
      return {
        index: 0,
        start: { x: 900, y: 300 },
      };
    }

    const normalized = ((Math.floor(index) % laneCount) + laneCount) % laneCount;
    return this.lanes[normalized];
  }

  private aggregateModifierEffects(modifierIds: string[]): AggregatedEffects {
    const result: AggregatedEffects = {
      speedMultiplier: 1,
      armorMultiplier: 1,
      spawnRateMultiplier: 1,
    };

    for (const modifierId of modifierIds) {
      const modifier = this.modifierById.get(modifierId);
      if (!modifier) {
        continue;
      }
      result.speedMultiplier *= modifier.effects.speedMultiplier ?? 1;
      result.armorMultiplier *= modifier.effects.armorMultiplier ?? 1;
      result.spawnRateMultiplier *= modifier.effects.spawnRateMultiplier ?? 1;
    }

    return result;
  }

  private addMissionGold(rawAmount: number): void {
    const scaled = Math.max(0, rawAmount * this.goldRewardMultiplier);
    this.missionGold += scaled;
  }

  private computePressureScore(plan: WavePlan, effects: AggregatedEffects): number {
    const difficultyMul = this.difficultyConfig.wave.intensityMul * this.options.missionDifficultyScalar;
    const waveModMul = Math.max(
      0.5,
      Math.min(3, (effects.speedMultiplier + effects.armorMultiplier + effects.spawnRateMultiplier) / 3),
    );

    let score = 0;
    for (const entry of plan.spawnEntries) {
      const archetype = this.enemyFactory.getArchetype(entry.enemyId);
      score += archetype.unitThreatValue * entry.count * difficultyMul * waveModMul;
    }
    return Math.round(score * 100) / 100;
  }

  private validateWaveStart(runtimeWave: RuntimeWaveState): void {
    if (!this.diagnosticsEnabled) {
      return;
    }
    const target = this.getPacingTarget(runtimeWave.plan.waveIndex);
    if (!target) {
      return;
    }

    if (!isWithinRange(runtimeWave.pressureScore, target.expectedEnemyPressureScoreRange)) {
      console.warn(
        `[Balance] Wave ${runtimeWave.plan.waveIndex} pressure ${runtimeWave.pressureScore.toFixed(2)} outside target [${target.expectedEnemyPressureScoreRange.min}, ${target.expectedEnemyPressureScoreRange.max}] (${this.options.difficultyTier})`,
      );
    }
  }

  private validateWaveEnd(runtimeWave: RuntimeWaveState, dtSec: number): void {
    void dtSec;
    if (!this.diagnosticsEnabled) {
      return;
    }

    const target = this.getPacingTarget(runtimeWave.plan.waveIndex);
    if (!target) {
      return;
    }

    const playerMetrics = this.getPlayerMetrics();
    const waveDurationSec = this.simulationTimeSec - runtimeWave.startedAtSec;
    const actualRiskBand = this.estimateLossRiskBand(playerMetrics, target);

    if (
      playerMetrics.playerTowersOwned < target.expectedPlayerTowersOwnedMin ||
      playerMetrics.playerTowersOwned > target.expectedPlayerTowersOwnedMax
    ) {
      console.warn(
        `[Balance] Wave ${runtimeWave.plan.waveIndex} towers owned ${playerMetrics.playerTowersOwned} outside target [${target.expectedPlayerTowersOwnedMin}, ${target.expectedPlayerTowersOwnedMax}] (${this.options.difficultyTier})`,
      );
    }

    if (
      playerMetrics.avgTroopsPerOwnedTower < target.expectedAvgTroopsPerTowerMin ||
      playerMetrics.avgTroopsPerOwnedTower > target.expectedAvgTroopsPerTowerMax
    ) {
      console.warn(
        `[Balance] Wave ${runtimeWave.plan.waveIndex} avg troops ${playerMetrics.avgTroopsPerOwnedTower.toFixed(2)} outside target [${target.expectedAvgTroopsPerTowerMin}, ${target.expectedAvgTroopsPerTowerMax}] (${this.options.difficultyTier})`,
      );
    }

    if (!isWithinRange(waveDurationSec, target.expectedWaveDurationSecRange)) {
      console.warn(
        `[Balance] Wave ${runtimeWave.plan.waveIndex} duration ${waveDurationSec.toFixed(2)}s outside target [${target.expectedWaveDurationSecRange.min}, ${target.expectedWaveDurationSecRange.max}] (${this.options.difficultyTier})`,
      );
    }

    if (actualRiskBand !== target.expectedLossRiskBand) {
      console.warn(
        `[Balance] Wave ${runtimeWave.plan.waveIndex} estimated risk "${actualRiskBand}" differs from target "${target.expectedLossRiskBand}" (${this.options.difficultyTier})`,
      );
    }
  }

  private getPacingTarget(waveIndex: number): WavePacingDifficultyTarget | null {
    for (const target of this.content.wavePacingTargets.targets) {
      if (waveIndex < target.waveStart || waveIndex > target.waveEnd) {
        continue;
      }
      return target.byDifficulty[this.options.difficultyTier];
    }
    return null;
  }

  private getPlayerMetrics(): { playerTowersOwned: number; avgTroopsPerOwnedTower: number } {
    let playerTowersOwned = 0;
    let troopsTotal = 0;

    for (const tower of this.world.towers) {
      if (tower.owner !== "player") {
        continue;
      }
      playerTowersOwned += 1;
      troopsTotal += tower.troops;
    }

    return {
      playerTowersOwned,
      avgTroopsPerOwnedTower: playerTowersOwned > 0 ? troopsTotal / playerTowersOwned : 0,
    };
  }

  private estimateTimeToZeroTowersSec(): number | null {
    const playerTowers = this.world.towers.filter((tower) => tower.owner === "player");
    if (playerTowers.length === 0) {
      return 0;
    }

    let enemyDps = 0;
    for (const packet of this.world.packets) {
      if (packet.owner !== "enemy") {
        continue;
      }
      enemyDps += packet.count * packet.dpsPerUnit;
    }

    if (enemyDps <= 0) {
      return null;
    }

    let playerDurability = 0;
    for (const tower of playerTowers) {
      playerDurability += tower.hp + tower.troops * this.content.balanceBaselines.packets.baseDamage;
    }

    return Math.round((playerDurability / enemyDps) * 10) / 10;
  }

  private updatePlayerPacketRate(dtSec: number): void {
    let currentPlayerPacketCount = 0;
    for (const packet of this.world.packets) {
      if (packet.owner === "player") {
        currentPlayerPacketCount += 1;
      }
    }

    const createdDelta = Math.max(0, currentPlayerPacketCount - this.previousPlayerPacketCount);
    this.previousPlayerPacketCount = currentPlayerPacketCount;
    this.packetRateAccumulatorCount += createdDelta;
    this.packetRateAccumulatorSec += dtSec;

    if (this.packetRateAccumulatorSec >= 0.5) {
      this.packetsSentPerSec = this.packetRateAccumulatorCount / this.packetRateAccumulatorSec;
      this.packetRateAccumulatorSec = 0;
      this.packetRateAccumulatorCount = 0;
    }
  }

  private estimateLossRiskBand(
    metrics: { playerTowersOwned: number; avgTroopsPerOwnedTower: number },
    target: WavePacingDifficultyTarget,
  ): LossRiskBand {
    const towersMid = (target.expectedPlayerTowersOwnedMin + target.expectedPlayerTowersOwnedMax) * 0.5;
    const troopsMid = (target.expectedAvgTroopsPerTowerMin + target.expectedAvgTroopsPerTowerMax) * 0.5;

    if (
      metrics.playerTowersOwned < target.expectedPlayerTowersOwnedMin ||
      metrics.avgTroopsPerOwnedTower < target.expectedAvgTroopsPerTowerMin
    ) {
      return "high";
    }
    if (metrics.playerTowersOwned <= towersMid || metrics.avgTroopsPerOwnedTower <= troopsMid) {
      return "med";
    }
    return "low";
  }

  private getActiveBossPacket(): UnitPacket | null {
    if (!this.activeBossPacketId) {
      return null;
    }
    for (const packet of this.world.packets) {
      if (packet.id === this.activeBossPacketId) {
        return packet;
      }
    }
    return null;
  }
}

function createLanes(world: World): WaveLane[] {
  const enemyTowers = world.towers.filter((tower) => tower.owner === "enemy");
  if (enemyTowers.length > 0) {
    return enemyTowers.map((tower, index) => ({
      index,
      start: { x: tower.x, y: tower.y },
    }));
  }

  const bounds = getWorldBounds(world.towers);
  const laneCount = 2;
  const lanes: WaveLane[] = [];
  for (let i = 0; i < laneCount; i += 1) {
    const y = bounds.minY + (i + 1) * ((bounds.maxY - bounds.minY) / (laneCount + 1));
    lanes.push({
      index: i,
      start: { x: bounds.maxX + 120, y },
    });
  }
  return lanes;
}

function summarizeWavePreview(plan: WavePlan, factory: EnemyFactory): WavePreviewItem[] {
  const counts = new Map<string, number>();
  for (const entry of plan.spawnEntries) {
    counts.set(entry.enemyId, (counts.get(entry.enemyId) ?? 0) + entry.count);
  }

  const result: WavePreviewItem[] = [];
  for (const [enemyId, count] of counts.entries()) {
    const archetype = factory.getArchetype(enemyId);
    result.push({
      enemyId,
      icon: archetype.visuals.icon,
      count,
    });
  }

  result.sort((a, b) => b.count - a.count || a.enemyId.localeCompare(b.enemyId));
  return result.slice(0, 6);
}

function pickPlayerTarget(towers: Tower[], reference: Vec2): Tower | null {
  let best: Tower | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const tower of towers) {
    if (tower.owner !== "player") {
      continue;
    }
    const distance = Math.hypot(tower.x - reference.x, tower.y - reference.y);
    if (distance < bestDistance) {
      best = tower;
      bestDistance = distance;
    }
  }

  return best;
}

function pickNearestLane(lanes: WaveLane[], reference: Vec2): WaveLane {
  let best = lanes[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const lane of lanes) {
    const distance = Math.hypot(lane.start.x - reference.x, lane.start.y - reference.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = lane;
    }
  }

  return best;
}

function pickLaneByLink(lanes: WaveLane[], link: { points: Vec2[] }, fallbackWaveIndex: number): WaveLane {
  const origin = link.points[0];
  let best = lanes[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const lane of lanes) {
    const distance = Math.hypot(origin.x - lane.start.x, origin.y - lane.start.y);
    if (distance < bestDistance) {
      best = lane;
      bestDistance = distance;
    }
  }

  if (best) {
    return best;
  }

  return {
    index: Math.max(0, fallbackWaveIndex - 1),
    start: origin,
  };
}

function samplePacketPosition(world: World, packet: UnitPacket): Vec2 | null {
  const link = world.getLinkById(packet.linkId);
  if (!link) {
    return null;
  }

  return samplePointOnPolyline(link.points, packet.progress01);
}

function samplePointOnPolyline(points: Vec2[], progress01: number): Vec2 | null {
  if (points.length === 0) {
    return null;
  }
  if (points.length === 1) {
    return points[0];
  }

  const clampedProgress = clamp(progress01, 0, 1);
  const totalLength = polylineLength(points);
  if (totalLength <= 0.001) {
    return points[0];
  }

  const targetDistance = totalLength * clampedProgress;
  let walked = 0;

  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    const segment = Math.hypot(end.x - start.x, end.y - start.y);
    if (segment <= 0.001) {
      continue;
    }

    if (walked + segment >= targetDistance) {
      const t = (targetDistance - walked) / segment;
      return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      };
    }

    walked += segment;
  }

  return points[points.length - 1];
}

function polylineLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

function getWorldBounds(towers: Tower[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const tower of towers) {
    minX = Math.min(minX, tower.x);
    minY = Math.min(minY, tower.y);
    maxX = Math.max(maxX, tower.x);
    maxY = Math.max(maxY, tower.y);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return {
      minX: 0,
      maxX: 1000,
      minY: 0,
      maxY: 600,
    };
  }

  return { minX, maxX, minY, maxY };
}

function normalizeStageId(stageId?: string): string {
  if (!stageId) {
    return "stage01";
  }
  const trimmed = stageId.trim().toLowerCase();
  if (/^stage\d+$/.test(trimmed)) {
    const numeric = Number.parseInt(trimmed.slice(5), 10);
    return `stage${numeric.toString().padStart(2, "0")}`;
  }
  return trimmed.length > 0 ? trimmed : "stage01";
}

function deriveStageIndex(stageId: string): number {
  const match = stageId.match(/(\d+)/);
  if (!match) {
    return 1;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
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
  const index = Math.max(0, Math.min(profile.axesByMission.length - 1, missionIndex));
  return profile.axesByMission[index];
}

function computeBaseCooldown(
  profile: StageDifficultyProfile,
  axes: DifficultyAxes,
  normalizedTempoBudget: number,
): number {
  const compression = clamp(
    axes.tempo * 0.25 + normalizedTempoBudget * 0.1,
    0,
    profile.tempoModel.maxCompression,
  );
  return clamp(profile.tempoModel.baseCooldownSec * (1 - compression), 3, 30);
}

function resolveTerritoryPenalty(profile: StageDifficultyProfile | null, ascensionPenalty: number): number {
  const clampedAscensionPenalty = clamp(ascensionPenalty, 0, 1);
  if (clampedAscensionPenalty <= 0) {
    return 0;
  }
  if (profile?.territoryScaling.penaltyMultiplier !== undefined) {
    return clamp(1 - profile.territoryScaling.penaltyMultiplier, 0, 1);
  }
  return clampedAscensionPenalty;
}

function resolveComplexityTier(
  profile: StageDifficultyProfile,
  complexityAxis: number,
): StageDifficultyProfile["archetypeProgression"]["tiers"][number] {
  const sorted = [...profile.archetypeProgression.tiers].sort(
    (left, right) => left.minComplexity - right.minComplexity,
  );
  let best = sorted[0];
  for (const tier of sorted) {
    if (complexityAxis >= tier.minComplexity) {
      best = tier;
    }
  }
  return best;
}

function buildWeightedArchetypePool(
  archetypes: EnemyArchetypeDefinition[],
  weights: Record<string, number>,
): Array<{ archetype: EnemyArchetypeDefinition; weight: number }> {
  const pool: Array<{ archetype: EnemyArchetypeDefinition; weight: number }> = [];
  for (const archetype of archetypes) {
    const weight = weights[archetype.id] ?? archetype.spawnWeight;
    if (!Number.isFinite(weight) || weight <= 0) {
      continue;
    }
    pool.push({ archetype, weight });
  }
  return pool;
}

function pickWeightedPoolEntry<T extends { weight: number }>(pool: T[], rng: () => number): T | null {
  let total = 0;
  for (const entry of pool) {
    total += Math.max(0, entry.weight);
  }
  if (total <= 0) {
    return null;
  }

  let roll = rng() * total;
  for (const entry of pool) {
    roll -= Math.max(0, entry.weight);
    if (roll <= 0) {
      return entry;
    }
  }
  return pool[pool.length - 1] ?? null;
}

function resolveSpawnCost(archetype: EnemyArchetypeDefinition): number {
  if (Number.isFinite(archetype.spawnCost) && archetype.spawnCost > 0) {
    return archetype.spawnCost;
  }
  const heuristic: Record<string, number> = {
    swarm: 1,
    tank: 2,
    shield: 2,
    support: 2,
    disruptor: 3,
    splitter: 2,
    miniboss: 6,
  };
  for (const tag of archetype.tags) {
    if (heuristic[tag] !== undefined) {
      return heuristic[tag];
    }
  }
  return 2;
}

function countArchetypes(entries: WaveSpawnEntry[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of entries) {
    result[entry.enemyId] = (result[entry.enemyId] ?? 0) + entry.count;
  }
  return result;
}

function averageEliteChance(entries: WaveSpawnEntry[]): number {
  if (entries.length === 0) {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    total += clamp(entry.eliteChance, 0, 1);
  }
  return total / entries.length;
}

function expandArchetypeCounts(counts: Record<string, number>): string[] {
  const entries: Array<{ id: string; count: number }> = Object.entries(counts).map(([id, count]) => ({
    id,
    count: Math.max(0, Math.floor(count)),
  }));
  entries.sort((left, right) => right.count - left.count || left.id.localeCompare(right.id));
  const queue: string[] = [];
  for (const entry of entries) {
    for (let i = 0; i < entry.count; i += 1) {
      queue.push(entry.id);
    }
  }
  return queue;
}

function isBossWaveIndex(content: LoadedWaveContent, waveIndex: number, totalWaveCount: number): boolean {
  const configuredBossWave = clamp(content.balance.boss.finalWaveIndex, 1, totalWaveCount);
  return waveIndex >= configuredBossWave;
}

function computeBossDifficultyModifiers(
  profile: StageDifficultyProfile,
  waveDifficultyBudget: number,
  ascension: AscensionDifficultyModifiers,
): BossDifficultyModifiers {
  const bossPower = waveDifficultyBudget * profile.bossModel.powerMultiplier;
  const extraPhaseCount =
    (ascension.bossExtraPhase ? 1 : 0) +
    (profile.bossModel.enrage.addPhaseOnHighAscension && ascension.level >= 3 ? 1 : 0);
  return {
    hpMultiplier: clamp(1 + bossPower / 120, 1, 3),
    damageMultiplier: clamp(1 + bossPower / 200, 1, 2.2),
    abilityCooldownMultiplier: clamp(1 - bossPower / 280, 0.65, 1),
    reinforcementCountBonus: clamp(Math.round(bossPower / 35), 0, 8),
    extraPhaseCount: Math.max(0, extraPhaseCount),
  };
}

function createRuntimeBossState(
  stageProfile: StageDifficultyProfile | null,
  ascension: AscensionDifficultyModifiers,
  modifiers: BossDifficultyModifiers | null,
  spawnedAtSec: number,
): RuntimeBossState | null {
  if (!stageProfile || !stageProfile.bossModel.enabled) {
    return null;
  }

  const thresholds: number[] = [];
  for (const phase of stageProfile.bossModel.phases) {
    if (phase.hpThreshold === undefined) {
      continue;
    }
    thresholds.push(clamp(phase.hpThreshold, 0.05, 0.95));
  }

  const bonusPhases =
    modifiers?.extraPhaseCount ??
    ((stageProfile.bossModel.enrage.addPhaseOnHighAscension && ascension.level >= 3) ? 1 : 0);
  for (let i = 0; i < bonusPhases; i += 1) {
    thresholds.push(clamp(0.25 - i * 0.08, 0.08, 0.95));
  }

  thresholds.sort((left, right) => right - left);
  return {
    modifiers,
    phaseThresholds: thresholds,
    triggeredPhases: new Set<number>(),
    spawnedAtSec,
  };
}

function mapBossSpawnModifiers(modifiers?: BossDifficultyModifiers | null): EnemyBossSpawnModifiers | undefined {
  if (!modifiers) {
    return undefined;
  }
  return {
    hpMultiplier: modifiers.hpMultiplier,
    damageMultiplier: modifiers.damageMultiplier,
  };
}

function computeWavePressureIndex(world: World): number {
  const activeEnemyCount = world.packets.filter((packet) => packet.owner === "enemy").length + countOwnedTowers(world.towers, "enemy");
  const playerTowerCount = countOwnedTowers(world.towers, "player");
  return activeEnemyCount / Math.max(1, playerTowerCount);
}

function countOwnedTowers(towers: Tower[], owner: Tower["owner"]): number {
  let count = 0;
  for (const tower of towers) {
    if (tower.owner === owner) {
      count += 1;
    }
  }
  return count;
}

function normalizeLane(laneIndex: number, laneCount: number): number {
  const limit = Math.max(1, laneCount);
  const normalized = Math.floor(Math.abs(laneIndex)) % limit;
  return normalized;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

function mixSeed(seed: number, wave: number, salt: number): number {
  return (seed ^ (wave * 0x9e3779b9) ^ (salt * 0x85ebca6b)) >>> 0;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isWithinRange(value: number, range: { min: number; max: number }): boolean {
  return value >= range.min && value <= range.max;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
