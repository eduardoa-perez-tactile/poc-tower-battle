import type { Tower, UnitPacket, Vec2, World } from "../sim/World";
import { EnemyFactory } from "./EnemyFactory";
import type {
  LoadedWaveContent,
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
  currentWaveIndex: number;
  totalWaveCount: number;
  activeModifierNames: string[];
  nextWavePreview: WavePreviewItem[];
  missionGold: number;
  activeBuffId: string | null;
  activeBuffRemainingSec: number;
  bossName: string | null;
  bossHp01: number;
}

export interface WaveRenderState {
  telegraphs: TelegraphMarker[];
}

export interface WaveDirectorOptions {
  runSeed: number;
  missionDifficulty: number;
}

interface RuntimeWaveState {
  plan: WavePlan;
  elapsedSec: number;
  nextSpawnIndex: number;
  activeModifierEffects: AggregatedEffects;
}

interface AggregatedEffects {
  speedMultiplier: number;
  armorMultiplier: number;
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

  constructor(world: World, content: LoadedWaveContent, options: WaveDirectorOptions) {
    this.content = content;
    this.world = world;
    this.options = options;
    this.waveGenerator = new WaveGenerator(content);
    this.enemyFactory = new EnemyFactory(content);
    this.lanes = createLanes(world);
    this.modifierById = new Map<string, WaveModifierDefinition>();
    this.packetSnapshots = new Map<string, PacketSnapshot>();
    this.telegraphs = [];
    this.previewsByWave = new Map<number, WavePreviewItem[]>();

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

    this.preparePreviews();
  }

  updatePreStep(dtSec: number): void {
    this.simulationTimeSec += dtSec;

    if (this.activeBuffRemainingSec > 0) {
      this.activeBuffRemainingSec = Math.max(0, this.activeBuffRemainingSec - dtSec);
      if (this.activeBuffRemainingSec <= 0) {
        this.activeBuffId = null;
      }
    }

    if (this.activeBuffRemainingSec > 0) {
      const regenBoost = this.content.balance.elite.temporaryBuffSpeedMultiplier;
      const regenBonus = 0.6 * (regenBoost - 1);
      for (const tower of this.world.towers) {
        if (tower.owner !== "player") {
          continue;
        }
        tower.troops = Math.min(tower.maxTroops, tower.troops + regenBonus * dtSec);
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
        this.content.balance.goldRewards.waveClearBase +
        this.currentWaveIndex * this.content.balance.goldRewards.waveClearPerWave;
      this.missionGold += Math.max(0, Math.round(waveClearReward));
      this.runtimeWave = null;
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

    return {
      currentWaveIndex: this.currentWaveIndex,
      totalWaveCount: this.totalWaveCount,
      activeModifierNames,
      nextWavePreview,
      missionGold: Math.max(0, Math.round(this.missionGold)),
      activeBuffId: this.activeBuffId,
      activeBuffRemainingSec: this.activeBuffRemainingSec,
      bossName,
      bossHp01,
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
        this.runtimeWave = {
          plan,
          elapsedSec: 0,
          nextSpawnIndex: 0,
          activeModifierEffects: this.aggregateModifierEffects(plan.modifiers),
        };
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
        difficultyTier: this.options.missionDifficulty,
        isElite,
        isBoss: entry.enemyId === this.content.balance.boss.id,
      });

      packet.baseCount = packet.count;
      packet.sourceLane = lane.index;
      packet.sourceWaveIndex = waveIndex;
      packet.baseSpeedMultiplier = effects.speedMultiplier;
      packet.baseArmorMultiplier = effects.armorMultiplier;

      this.world.packets.push(this.world.acquirePacket(packet));

      if (packet.isBoss) {
        this.activeBossPacketId = packet.id;
        this.bossAbilitySchedule = {
          nextSlamAtSec: this.simulationTimeSec + this.content.balance.boss.slam.cooldownSec,
          nextSummonAtSec: this.simulationTimeSec + this.content.balance.boss.summon.cooldownSec,
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

    this.missionGold += Math.max(0, Math.round(reward));
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
        difficultyTier: this.options.missionDifficulty,
        isElite: false,
        isBoss: false,
      });

      child.progress01 = clamp(snapshot.progress01 - 0.02 + i * 0.01, 0, 0.98);
      child.sourceWaveIndex = Math.max(1, snapshot.sourceWaveIndex);
      child.sourceLane = lane.index;
      child.baseSpeedMultiplier = 1;
      child.baseArmorMultiplier = 1;
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
        this.simulationTimeSec + this.content.balance.boss.slam.cooldownSec;
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
        this.simulationTimeSec + this.content.balance.boss.summon.cooldownSec;
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
      this.missionGold += tower.goldPerSecond * dtSec;
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
      this.missionGold += tower.recaptureBonusGold;
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
      speedMultiplier: 1.1,
      armorMultiplier: 1,
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
      difficultyTier: this.options.missionDifficulty,
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
    };

    for (const modifierId of modifierIds) {
      const modifier = this.modifierById.get(modifierId);
      if (!modifier) {
        continue;
      }
      result.speedMultiplier *= modifier.effects.speedMultiplier ?? 1;
      result.armorMultiplier *= modifier.effects.armorMultiplier ?? 1;
    }

    return result;
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
