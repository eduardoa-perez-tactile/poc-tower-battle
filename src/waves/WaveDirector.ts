import type { Tower, UnitPacket, Vec2, World } from "../sim/World";
import { armorFromMultiplier } from "../sim/TerritoryControl";
import type { DifficultyTierId } from "../config/Difficulty";
import { EnemyFactory } from "./EnemyFactory";
import type {
  DifficultyTierConfig,
  LoadedWaveContent,
  LossRiskBand,
  WavePacingDifficultyTarget,
  WaveGeneratorInputs,
  WaveModifierDefinition,
  WavePlan,
  WaveSpawnEntry,
} from "./Definitions";
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
  balanceDiagnosticsEnabled?: boolean;
  allowedEnemyIds?: string[];
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

export class WaveDirector {
  private readonly content: LoadedWaveContent;
  private readonly world: World;
  private readonly waveGenerator: WaveGenerator;
  private readonly enemyFactory: EnemyFactory;
  private readonly options: WaveDirectorOptions;
  private readonly lanes: WaveLane[];
  private readonly modifierById: Map<string, WaveModifierDefinition>;
  private readonly packetSnapshots: Map<string, PacketSnapshot>;
  private readonly telegraphs: TelegraphMarker[];
  private readonly previewsByWave: Map<number, WavePreviewItem[]>;
  private readonly difficultyConfig: DifficultyTierConfig;
  private readonly goldRewardMultiplier: number;
  private readonly bossCooldownFactor: number;

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

  constructor(world: World, content: LoadedWaveContent, options: WaveDirectorOptions) {
    this.content = content;
    this.world = world;
    this.options = options;
    const allowedEnemyIds = options.allowedEnemyIds ? new Set(options.allowedEnemyIds) : null;
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

    for (const modifier of content.modifierCatalog.modifiers) {
      this.modifierById.set(modifier.id, modifier);
    }

    this.currentWaveIndex = 0;
    this.totalWaveCount = this.waveGenerator.getTotalWaveCount();
    this.cooldownUntilNextWaveSec = 1;
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

    this.preparePreviews();
  }

  updatePreStep(dtSec: number): void {
    this.simulationTimeSec += dtSec;
    this.updatePlayerPacketRate(dtSec);

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
      this.validateWaveEnd(this.runtimeWave, dtSec);
      this.runtimeWave = null;
      this.currentWavePressureScore = 0;
      this.cooldownUntilNextWaveSec = 3;
      if (this.currentWaveIndex >= this.totalWaveCount) {
        this.finished = true;
      }
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

    return {
      difficultyTier: this.options.difficultyTier,
      currentWaveIndex: this.currentWaveIndex,
      totalWaveCount: this.totalWaveCount,
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
    const phase = boss.bossEnraged
      ? "Enraged"
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

  private preparePreviews(): void {
    for (let waveIndex = 1; waveIndex <= this.totalWaveCount; waveIndex += 1) {
      const plan = this.waveGenerator.generate(this.getWaveGeneratorInputs(waveIndex));
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
        const plan = this.waveGenerator.generate(this.getWaveGeneratorInputs(this.currentWaveIndex));
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
        this.currentWavePressureScore = pressureScore;
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

      this.spawnEntry(entry, this.currentWaveIndex, this.runtimeWave.activeModifierEffects);
      this.runtimeWave.nextSpawnIndex += 1;
    }
  }

  private spawnEntry(entry: WaveSpawnEntry, waveIndex: number, effects: AggregatedEffects): void {
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
        this.activeBossPacketId = packet.id;
        this.bossAbilitySchedule = {
          nextSlamAtSec: this.simulationTimeSec + this.content.balance.boss.slam.cooldownSec * this.bossCooldownFactor,
          nextSummonAtSec:
            this.simulationTimeSec + this.content.balance.boss.summon.cooldownSec * this.bossCooldownFactor,
        };
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
    if (!bossPacket.bossEnraged && healthRatio <= this.content.balance.boss.enrageThreshold) {
      bossPacket.bossEnraged = true;
      bossPacket.baseSpeedMultiplier *= this.content.balance.boss.enrageSpeedMultiplier;
      bossPacket.dpsPerUnit *= this.content.balance.boss.enrageDamageMultiplier;
    }

    const bossPosition = samplePacketPosition(this.world, bossPacket);
    if (!bossPosition) {
      return;
    }

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
        this.simulationTimeSec + this.content.balance.boss.slam.cooldownSec * this.bossCooldownFactor;
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
        this.simulationTimeSec + this.content.balance.boss.summon.cooldownSec * this.bossCooldownFactor;
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
    const entry: WaveSpawnEntry = {
      timeOffsetSec: 0,
      enemyId: this.content.balance.boss.summon.enemyId,
      count: this.content.balance.boss.summon.count,
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
