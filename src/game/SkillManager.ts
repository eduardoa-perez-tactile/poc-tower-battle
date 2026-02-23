import type { MetaModifiers } from "../save/Schema";
import type { SkillCatalog, SkillDefinition, SkillEffectType } from "../meta/MetaProgression";
import type { Vec2, World } from "../sim/World";

export interface SkillTarget {
  towerId?: string;
  point?: Vec2;
}

export interface SkillHudState {
  id: string;
  name: string;
  targeting: SkillDefinition["targeting"];
  cooldownRemainingSec: number;
  cooldownTotalSec: number;
  ready: boolean;
}

export interface TemporaryModifiers {
  playerPacketSpeedMul: number;
}

interface ActiveTimedEffect {
  skillId: string;
  remainingSec: number;
  potency: number;
}

interface PendingCast {
  skillId: string;
  target: SkillTarget;
}

interface ActiveTowerShield {
  towerId: string;
  remainingSec: number;
  defenseMul: number;
}

export class SkillManager {
  private readonly skillsById: Map<string, SkillDefinition>;
  private readonly unlockedSkillIds: string[];
  private readonly metaModifiers: MetaModifiers;
  private readonly cooldownRemainingSecById: Map<string, number>;
  private readonly activeHaste: ActiveTimedEffect[];
  private readonly activeShields: ActiveTowerShield[];
  private readonly baseDefenseByTowerId: Map<string, number>;
  private readonly pendingCasts: PendingCast[];

  constructor(catalog: SkillCatalog, unlockedSkillIds: string[], metaModifiers: MetaModifiers) {
    this.skillsById = new Map<string, SkillDefinition>();
    for (const skill of catalog.skills) {
      this.skillsById.set(skill.id, skill);
    }

    this.unlockedSkillIds = [...unlockedSkillIds]
      .filter((id) => this.skillsById.has(id))
      .sort((a, b) => a.localeCompare(b));
    this.metaModifiers = metaModifiers;
    this.cooldownRemainingSecById = new Map<string, number>();
    this.activeHaste = [];
    this.activeShields = [];
    this.baseDefenseByTowerId = new Map<string, number>();
    this.pendingCasts = [];

    for (const skillId of this.unlockedSkillIds) {
      this.cooldownRemainingSecById.set(skillId, 0);
    }
  }

  getHudState(): SkillHudState[] {
    const states: SkillHudState[] = [];
    for (const skillId of this.unlockedSkillIds) {
      const skill = this.skillsById.get(skillId);
      if (!skill) {
        continue;
      }
      const cooldownRemainingSec = this.cooldownRemainingSecById.get(skillId) ?? 0;
      states.push({
        id: skill.id,
        name: skill.name,
        targeting: skill.targeting,
        cooldownRemainingSec,
        cooldownTotalSec: this.computeCooldownSec(skill),
        ready: cooldownRemainingSec <= 0,
      });
    }
    return states;
  }

  queueCast(skillId: string, target: SkillTarget = {}): boolean {
    if (!this.cooldownRemainingSecById.has(skillId)) {
      return false;
    }
    this.pendingCasts.push({ skillId, target });
    return true;
  }

  update(dtSec: number, world: World): void {
    for (const [skillId, remainingSec] of this.cooldownRemainingSecById.entries()) {
      this.cooldownRemainingSecById.set(skillId, Math.max(0, remainingSec - dtSec));
    }

    this.updateTimedEffects(dtSec, world);

    while (this.pendingCasts.length > 0) {
      const cast = this.pendingCasts.shift();
      if (!cast) {
        break;
      }
      this.resolveCast(cast, world);
    }
  }

  getTemporaryModifiers(): TemporaryModifiers {
    let playerPacketSpeedMul = 1;
    for (const effect of this.activeHaste) {
      playerPacketSpeedMul += effect.potency;
    }
    return {
      playerPacketSpeedMul,
    };
  }

  private resolveCast(cast: PendingCast, world: World): void {
    const skill = this.skillsById.get(cast.skillId);
    if (!skill) {
      return;
    }

    const cooldownRemaining = this.cooldownRemainingSecById.get(skill.id) ?? 0;
    if (cooldownRemaining > 0) {
      return;
    }

    const potency = this.metaModifiers.skillPotencyMul;
    const durationSec = skill.durationSec * this.metaModifiers.skillDurationMul;

    if (skill.id === "GLOBAL_HASTE") {
      const speedBonus = getSkillEffectValue(skill, "TEMP_PLAYER_PACKET_SPEED_MUL") * potency;
      this.activeHaste.push({
        skillId: skill.id,
        remainingSec: Math.max(0, durationSec),
        potency: speedBonus,
      });
      this.cooldownRemainingSecById.set(skill.id, this.computeCooldownSec(skill));
      return;
    }

    if (skill.id === "TOWER_SHIELD") {
      const tower = pickTargetTower(world, cast.target.towerId);
      if (!tower || tower.owner !== "player") {
        return;
      }
      const defenseBonus = getSkillEffectValue(skill, "TEMP_TOWER_DEFENSE_MUL") * potency;
      if (!this.baseDefenseByTowerId.has(tower.id)) {
        this.baseDefenseByTowerId.set(tower.id, tower.defenseMultiplier);
      }
      this.activeShields.push({
        towerId: tower.id,
        remainingSec: Math.max(0, durationSec),
        defenseMul: 1 + defenseBonus,
      });
      this.recomputeTowerShields(world);
      this.cooldownRemainingSecById.set(skill.id, this.computeCooldownSec(skill));
      return;
    }

    if (skill.id === "LINK_PURGE") {
      const point = pickTargetPoint(world, cast.target);
      if (!point) {
        return;
      }
      const radius = Math.max(1, skill.radius ?? 120);
      const repair = getSkillEffectValue(skill, "LINK_INTEGRITY_REPAIR") * potency;
      repairLinks(world, point, radius, repair);
      this.cooldownRemainingSecById.set(skill.id, this.computeCooldownSec(skill));
    }
  }

  private updateTimedEffects(dtSec: number, world: World): void {
    for (let i = this.activeHaste.length - 1; i >= 0; i -= 1) {
      this.activeHaste[i].remainingSec = Math.max(0, this.activeHaste[i].remainingSec - dtSec);
      if (this.activeHaste[i].remainingSec <= 0) {
        this.activeHaste.splice(i, 1);
      }
    }

    let shieldsChanged = false;
    for (let i = this.activeShields.length - 1; i >= 0; i -= 1) {
      this.activeShields[i].remainingSec = Math.max(0, this.activeShields[i].remainingSec - dtSec);
      if (this.activeShields[i].remainingSec <= 0) {
        this.activeShields.splice(i, 1);
        shieldsChanged = true;
      }
    }

    if (shieldsChanged || this.activeShields.length > 0) {
      this.recomputeTowerShields(world);
    }
  }

  private recomputeTowerShields(world: World): void {
    for (const [towerId, baseDefense] of this.baseDefenseByTowerId.entries()) {
      const tower = world.getTowerById(towerId);
      if (tower) {
        tower.defenseMultiplier = baseDefense;
      }
    }

    const maxMultiplierByTowerId = new Map<string, number>();
    for (const shield of this.activeShields) {
      const current = maxMultiplierByTowerId.get(shield.towerId) ?? 1;
      if (shield.defenseMul > current) {
        maxMultiplierByTowerId.set(shield.towerId, shield.defenseMul);
      }
    }

    for (const [towerId, multiplier] of maxMultiplierByTowerId.entries()) {
      const tower = world.getTowerById(towerId);
      if (!tower) {
        continue;
      }
      const baseDefense = this.baseDefenseByTowerId.get(towerId) ?? tower.defenseMultiplier;
      this.baseDefenseByTowerId.set(towerId, baseDefense);
      tower.defenseMultiplier = baseDefense * multiplier;
    }

    if (this.activeShields.length === 0) {
      this.baseDefenseByTowerId.clear();
    }
  }

  private computeCooldownSec(skill: SkillDefinition): number {
    return Math.max(1, skill.cooldownSec * this.metaModifiers.skillCooldownMul);
  }
}

function getSkillEffectValue(skill: SkillDefinition, effectType: SkillEffectType): number {
  for (const effect of skill.effects) {
    if (effect.type === effectType) {
      return effect.value;
    }
  }
  return 0;
}

function pickTargetTower(world: World, towerId: string | undefined): ReturnType<World["getTowerById"]> {
  if (towerId) {
    return world.getTowerById(towerId);
  }

  const playerTowers = world.towers
    .filter((tower) => tower.owner === "player")
    .sort((a, b) => a.id.localeCompare(b.id));
  return playerTowers[0] ?? null;
}

function pickTargetPoint(world: World, target: SkillTarget): Vec2 | null {
  if (target.point) {
    return target.point;
  }
  if (target.towerId) {
    const tower = world.getTowerById(target.towerId);
    if (tower) {
      return { x: tower.x, y: tower.y };
    }
  }

  const firstPlayerTower = world.towers
    .filter((tower) => tower.owner === "player")
    .sort((a, b) => a.id.localeCompare(b.id))[0];

  if (!firstPlayerTower) {
    return null;
  }

  return { x: firstPlayerTower.x, y: firstPlayerTower.y };
}

function repairLinks(world: World, point: Vec2, radius: number, amount: number): void {
  const radiusSq = radius * radius;
  for (const link of world.links) {
    const mid = samplePointOnPolyline(link.points, 0.5) ?? link.points[link.points.length - 1];
    if (!mid) {
      continue;
    }
    const dx = mid.x - point.x;
    const dy = mid.y - point.y;
    if (dx * dx + dy * dy > radiusSq) {
      continue;
    }
    link.integrity = Math.min(link.maxIntegrity, link.integrity + Math.max(0, amount));
  }
}

function samplePointOnPolyline(points: Vec2[], progress01: number): Vec2 | null {
  if (points.length === 0) {
    return null;
  }
  if (points.length === 1) {
    return points[0];
  }

  const clampedProgress = Math.max(0, Math.min(1, progress01));
  const totalLength = getPolylineLength(points);
  if (totalLength <= 0.001) {
    return points[0];
  }

  const targetDistance = clampedProgress * totalLength;
  let walkedDistance = 0;

  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (segmentLength <= 0.001) {
      continue;
    }

    if (walkedDistance + segmentLength >= targetDistance) {
      const t = (targetDistance - walkedDistance) / segmentLength;
      return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      };
    }

    walkedDistance += segmentLength;
  }

  return points[points.length - 1];
}

function getPolylineLength(points: Vec2[]): number {
  if (points.length < 2) {
    return 0;
  }
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return length;
}
