import type { Owner, UnitPacket } from "../sim/World";
import type { EnemyArchetypeDefinition, LoadedWaveContent } from "./Definitions";

export interface EnemySpawnRequest {
  packetId: string;
  owner: Owner;
  linkId: string;
  archetypeId: string;
  count: number;
  waveIndex: number;
  difficultyTier: number;
  isElite: boolean;
  isBoss: boolean;
}

export class EnemyFactory {
  private readonly archetypesById: Map<string, EnemyArchetypeDefinition>;
  private readonly content: LoadedWaveContent;

  constructor(content: LoadedWaveContent) {
    this.content = content;
    this.archetypesById = new Map<string, EnemyArchetypeDefinition>();
    for (const archetype of content.enemyCatalog.archetypes) {
      this.archetypesById.set(archetype.id, archetype);
    }
  }

  listSpawnableArchetypes(): EnemyArchetypeDefinition[] {
    return this.content.enemyCatalog.archetypes.filter((archetype) => archetype.spawnWeight > 0);
  }

  listAllArchetypes(): EnemyArchetypeDefinition[] {
    return this.content.enemyCatalog.archetypes;
  }

  getArchetype(archetypeId: string): EnemyArchetypeDefinition {
    const archetype = this.archetypesById.get(archetypeId);
    if (!archetype) {
      throw new Error(`Unknown enemy archetype: ${archetypeId}`);
    }
    return archetype;
  }

  createEnemyPacket(request: EnemySpawnRequest): UnitPacket {
    const archetype = this.getArchetype(request.archetypeId);
    const scaling = this.content.balance.scaling;

    const waveFactor = Math.max(0, request.waveIndex - 1);
    const difficultyFactor = Math.max(0, request.difficultyTier - 1);
    const hpScale = 1 + waveFactor * scaling.hpPerWave + difficultyFactor * scaling.hpPerDifficultyTier;
    const damageScale =
      1 + waveFactor * scaling.damagePerWave + difficultyFactor * scaling.damagePerDifficultyTier;
    const speedScale = 1 + waveFactor * scaling.speedPerWave;

    const eliteScale = request.isElite ? this.content.balance.elite.hpMultiplier : 1;
    const eliteDamageScale = request.isElite ? this.content.balance.elite.damageMultiplier : 1;
    const bossHpScale = request.isBoss ? this.content.balance.boss.hpMultiplier : 1;
    const bossDamageScale = request.isBoss ? this.content.balance.boss.damageMultiplier : 1;

    const hpPerUnit = archetype.baseStats.hp * hpScale * eliteScale * bossHpScale;
    const dpsPerUnit = archetype.baseStats.damage * damageScale * eliteDamageScale * bossDamageScale;
    const speedPxPerSec = archetype.baseStats.speed * speedScale;
    const attackCooldownSec = Math.max(0.12, archetype.baseStats.attackCooldown);

    const behavior = archetype.behavior ?? {};
    const eliteDropGold = request.isElite
      ? Math.max(0, archetype.eliteDrop?.gold ?? this.content.balance.elite.defaultDropGold)
      : 0;
    const eliteDropBuffId = request.isElite
      ? archetype.eliteDrop?.temporaryBuffId ?? this.content.balance.elite.temporaryBuffId
      : null;

    return {
      id: request.packetId,
      owner: request.owner,
      count: request.count,
      baseCount: request.count,
      speedPxPerSec,
      baseSpeedMultiplier: 1,
      dpsPerUnit,
      baseDpsPerUnit: dpsPerUnit,
      hpPerUnit,
      linkId: request.linkId,
      progress01: 0,
      archetypeId: archetype.id,
      tags: [...archetype.tags],
      attackRangePx: archetype.baseStats.attackRange,
      attackCooldownSec,
      attackCooldownRemainingSec: 0,
      holdRemainingSec: 0,
      shieldCycleSec: behavior.shieldCycleSec ?? 0,
      shieldUptimeSec: behavior.shieldUptimeSec ?? 0,
      supportAuraRadiusPx: behavior.supportAuraRadius ?? 0,
      supportSpeedMultiplier: behavior.supportSpeedMultiplier ?? 1,
      supportArmorMultiplier: behavior.supportArmorMultiplier ?? 1,
      splitChildArchetypeId: behavior.splitChildArchetypeId ?? null,
      splitChildCount: behavior.splitChildCount ?? 0,
      canStopToShoot: Boolean(behavior.rangedStopToShoot),
      isLinkCutter: Boolean(behavior.linkCutter),
      linkIntegrityDamagePerSec: behavior.linkIntegrityDamagePerSec ?? 0,
      hasWorldPosition: false,
      worldX: 0,
      worldY: 0,
      sizeScale:
        archetype.visuals.sizeScale *
        (request.isElite ? this.content.balance.elite.sizeScaleMultiplier : 1),
      colorTint: request.isElite ? this.content.balance.elite.colorTint : archetype.visuals.color,
      vfxHook: archetype.visuals.vfxHook,
      sfxHook: archetype.visuals.sfxHook,
      icon: archetype.visuals.icon,
      isElite: request.isElite,
      eliteDropGold,
      eliteDropBuffId,
      isBoss: request.isBoss,
      bossEnraged: false,
      ageSec: 0,
      baseArmorMultiplier: 1,
      tempSpeedMultiplier: 1,
      tempArmorMultiplier: 1,
      sourceLane: 0,
      sourceWaveIndex: request.waveIndex,
    };
  }
}
