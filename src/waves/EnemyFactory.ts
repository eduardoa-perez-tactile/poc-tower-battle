/*
 * Patch Notes (2026-02-24):
 * - Added boss spawn modifier hooks for budget-driven boss scaling.
 */

import type { Owner, UnitPacket } from "../sim/World";
import { armorFromMultiplier } from "../sim/TerritoryControl";
import type { DifficultyTierId } from "../config/Difficulty";
import type { EnemyArchetypeDefinition, LoadedWaveContent } from "./Definitions";

export interface EnemySpawnRequest {
  packetId: string;
  owner: Owner;
  linkId: string;
  archetypeId: string;
  count: number;
  waveIndex: number;
  difficultyTier: DifficultyTierId;
  missionDifficultyScalar: number;
  isElite: boolean;
  isBoss: boolean;
  bossModifiers?: EnemyBossSpawnModifiers;
}

export interface EnemyFactoryOptions {
  allowedEnemyIds?: Set<string>;
  bossHpMul?: number;
}

export interface EnemyBossSpawnModifiers {
  hpMultiplier?: number;
  damageMultiplier?: number;
}

export class EnemyFactory {
  private readonly archetypesById: Map<string, EnemyArchetypeDefinition>;
  private readonly content: LoadedWaveContent;
  private readonly options: EnemyFactoryOptions;

  constructor(content: LoadedWaveContent, options: EnemyFactoryOptions = {}) {
    this.content = content;
    this.options = options;
    this.archetypesById = new Map<string, EnemyArchetypeDefinition>();
    for (const archetype of content.enemyCatalog.archetypes) {
      this.archetypesById.set(archetype.id, archetype);
    }
  }

  listSpawnableArchetypes(): EnemyArchetypeDefinition[] {
    return this.content.enemyCatalog.archetypes.filter((archetype) => {
      if (archetype.spawnWeight <= 0) {
        return false;
      }
      if (this.options.allowedEnemyIds && !this.options.allowedEnemyIds.has(archetype.id)) {
        return false;
      }
      return true;
    });
  }

  listAllArchetypes(): EnemyArchetypeDefinition[] {
    if (!this.options.allowedEnemyIds) {
      return this.content.enemyCatalog.archetypes;
    }
    return this.content.enemyCatalog.archetypes.filter((archetype) =>
      Boolean(this.options.allowedEnemyIds?.has(archetype.id)),
    );
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
    const tierConfig = this.content.difficultyTiers.difficultyTiers[request.difficultyTier];
    const caps = this.content.balanceBaselines.packets.globalCaps;

    const waveFactor = Math.max(0, request.waveIndex - 1);
    const difficultyFactor = Math.max(0, request.missionDifficultyScalar - 1);
    const hpScale = 1 + waveFactor * scaling.hpPerWave + difficultyFactor * scaling.hpPerDifficultyTier;
    const damageScale =
      1 + waveFactor * scaling.damagePerWave + difficultyFactor * scaling.damagePerDifficultyTier;
    const speedScale = 1 + waveFactor * scaling.speedPerWave;

    const eliteScale = request.isElite ? this.content.balance.elite.hpMultiplier : 1;
    const eliteDamageScale = request.isElite ? this.content.balance.elite.damageMultiplier : 1;
    const bossHpScale = request.isBoss
      ? this.content.balance.boss.hpMultiplier *
        tierConfig.wave.bossHpMul *
        Math.max(0.5, this.options.bossHpMul ?? 1) *
        Math.max(0.5, request.bossModifiers?.hpMultiplier ?? 1)
      : 1;
    const bossDamageScale = request.isBoss
      ? this.content.balance.boss.damageMultiplier * Math.max(0.5, request.bossModifiers?.damageMultiplier ?? 1)
      : 1;

    const hpPerUnit = clamp(
      archetype.baseStats.hp * hpScale * tierConfig.enemy.hpMul * eliteScale * bossHpScale,
      caps.hpMin,
      caps.hpMax,
    );
    const dpsPerUnit = clamp(
      archetype.baseStats.damage *
        damageScale *
        tierConfig.enemy.dmgMul *
        eliteDamageScale *
        bossDamageScale,
      caps.damageMin,
      caps.damageMax,
    );
    const speedPxPerSec = clamp(
      archetype.baseStats.speed * speedScale * tierConfig.enemy.speedMul,
      caps.speedMin,
      caps.speedMax,
    );
    const attackCooldownSec = Math.max(0.12, archetype.baseStats.attackCooldown);

    const behavior = archetype.behavior ?? {};
    const eliteDropGold = request.isElite
      ? Math.max(0, archetype.eliteDrop?.gold ?? this.content.balance.elite.defaultDropGold)
      : 0;
    const eliteDropBuffId = request.isElite
      ? archetype.eliteDrop?.temporaryBuffId ?? this.content.balance.elite.temporaryBuffId
      : null;

    const baseArmorMultiplier = 1;
    const baseArmor = armorFromMultiplier(baseArmorMultiplier);

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
      baseArmor,
      effectiveArmor: baseArmor,
      territoryArmorBonus: 0,
      baseArmorMultiplier,
      tempSpeedMultiplier: 1,
      tempArmorMultiplier: 1,
      sourceLane: 0,
      sourceWaveIndex: request.waveIndex,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
