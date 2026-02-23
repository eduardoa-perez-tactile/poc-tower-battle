import type { LinkLevelDefinition } from "./DepthTypes";
import { TowerArchetype } from "./DepthTypes";

export type Owner = "player" | "enemy" | "neutral";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Tower {
  id: string;
  x: number;
  y: number;
  owner: Owner;
  maxHp: number;
  hp: number;
  troops: number;
  maxTroops: number;
  regenRate: number;
  baseMaxTroops: number;
  baseRegenRate: number;
  archetype: TowerArchetype;
  defenseMultiplier: number;
  packetDamageMultiplier: number;
  linkSpeedBonus: number;
  extraOutgoingLinks: number;
  auraRadius: number;
  auraRegenBonusPct: number;
  captureSpeedTakenMultiplier: number;
  goldPerSecond: number;
  recaptureBonusGold: number;
  archetypeIcon: string;
}

export interface LinkSeed {
  id: string;
  fromTowerId: string;
  toTowerId: string;
  owner: Owner;
  points: Vec2[];
  level?: number;
  integrity?: number;
  maxIntegrity?: number;
  speedMultiplier?: number;
  armorBonus?: number;
  damageBonus?: number;
  overchargeDrain?: number;
  isScripted?: boolean;
  hideInRender?: boolean;
}

export interface Link {
  id: string;
  fromTowerId: string;
  toTowerId: string;
  owner: Owner;
  points: Vec2[];
  level: number;
  integrity: number;
  maxIntegrity: number;
  speedMultiplier: number;
  armorBonus: number;
  damageBonus: number;
  overchargeDrain: number;
  underAttackTimerSec: number;
  isScripted: boolean;
  hideInRender: boolean;
}

export interface UnitPacket {
  id: string;
  owner: Owner;
  count: number;
  baseCount: number;
  speedPxPerSec: number;
  baseSpeedMultiplier: number;
  dpsPerUnit: number;
  baseDpsPerUnit: number;
  hpPerUnit: number;
  linkId: string;
  progress01: number;
  archetypeId: string;
  tags: string[];
  attackRangePx: number;
  attackCooldownSec: number;
  attackCooldownRemainingSec: number;
  holdRemainingSec: number;
  shieldCycleSec: number;
  shieldUptimeSec: number;
  supportAuraRadiusPx: number;
  supportSpeedMultiplier: number;
  supportArmorMultiplier: number;
  splitChildArchetypeId: string | null;
  splitChildCount: number;
  canStopToShoot: boolean;
  isLinkCutter: boolean;
  linkIntegrityDamagePerSec: number;
  hasWorldPosition: boolean;
  worldX: number;
  worldY: number;
  sizeScale: number;
  colorTint: string;
  vfxHook: string;
  sfxHook: string;
  icon: string;
  isElite: boolean;
  eliteDropGold: number;
  eliteDropBuffId: string | null;
  isBoss: boolean;
  bossEnraged: boolean;
  ageSec: number;
  baseArmorMultiplier: number;
  tempSpeedMultiplier: number;
  tempArmorMultiplier: number;
  sourceLane: number;
  sourceWaveIndex: number;
}

export interface LinkDestroyedEvent {
  type: "link_destroyed";
  linkId: string;
  x: number;
  y: number;
}

export interface TowerCapturedEvent {
  type: "tower_captured";
  towerId: string;
  previousOwner: Owner;
  newOwner: Owner;
  archetype: TowerArchetype;
}

export const TOWER_RADIUS_PX = 28;
const EMPTY_TAGS: string[] = [];

export class World {
  readonly towers: Tower[];
  readonly links: Link[];
  readonly packets: UnitPacket[];
  private readonly maxOutgoingLinksPerTower: number;
  private readonly packetPool: UnitPacket[];
  private readonly linkLevels: Map<number, LinkLevelDefinition>;
  private readonly linkDestroyedEvents: LinkDestroyedEvent[];
  private readonly towerCapturedEvents: TowerCapturedEvent[];

  constructor(
    towers: Tower[],
    maxOutgoingLinksPerTower: number,
    linkLevels: Map<number, LinkLevelDefinition>,
    initialLinks: LinkSeed[] = [],
  ) {
    this.towers = towers.map((tower) => ({ ...tower }));
    this.links = [];
    this.packets = [];
    this.maxOutgoingLinksPerTower = Math.max(0, Math.floor(maxOutgoingLinksPerTower));
    this.packetPool = [];
    this.linkLevels = new Map<number, LinkLevelDefinition>(linkLevels);
    this.linkDestroyedEvents = [];
    this.towerCapturedEvents = [];

    for (const link of initialLinks) {
      this.setOutgoingLink(link.fromTowerId, link.toTowerId, link.level ?? 1);
    }
  }

  getTowerAtPoint(x: number, y: number): Tower | null {
    const radiusSq = TOWER_RADIUS_PX * TOWER_RADIUS_PX;
    for (const tower of this.towers) {
      const dx = x - tower.x;
      const dy = y - tower.y;
      if (dx * dx + dy * dy <= radiusSq) {
        return tower;
      }
    }
    return null;
  }

  getMaxOutgoingLinksForTower(towerId: string): number {
    const tower = this.getTowerById(towerId);
    if (!tower) {
      return this.maxOutgoingLinksPerTower;
    }
    return Math.max(0, this.maxOutgoingLinksPerTower + tower.extraOutgoingLinks);
  }

  setOutgoingLink(fromTowerId: string, toTowerId: string, level = 1): void {
    if (fromTowerId === toTowerId) {
      return;
    }

    const fromTower = this.getTowerById(fromTowerId);
    const toTower = this.getTowerById(toTowerId);
    if (!fromTower || !toTower) {
      return;
    }

    const maxOutgoing = this.getMaxOutgoingLinksForTower(fromTowerId);
    if (maxOutgoing < 1) {
      return;
    }

    const existing = this.links.find(
      (link) => !link.isScripted && link.fromTowerId === fromTowerId && link.toTowerId === toTowerId,
    );
    if (existing) {
      return;
    }

    while (this.getOutgoingLinks(fromTowerId).length >= maxOutgoing) {
      let removed = false;
      for (let i = 0; i < this.links.length; i += 1) {
        const link = this.links[i];
        if (!link.isScripted && link.fromTowerId === fromTowerId) {
          this.links.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (!removed) {
        break;
      }
    }

    this.links.push(
      this.createRuntimeLink({
        id: `${fromTowerId}->${toTowerId}`,
        fromTowerId,
        toTowerId,
        owner: fromTower.owner,
        points: [
          { x: fromTower.x, y: fromTower.y },
          { x: toTower.x, y: toTower.y },
        ],
        level,
        isScripted: false,
        hideInRender: false,
      }),
    );
  }

  clearOutgoingLink(fromTowerId: string): void {
    for (let i = this.links.length - 1; i >= 0; i -= 1) {
      if (this.links[i].fromTowerId === fromTowerId && !this.links[i].isScripted) {
        this.links.splice(i, 1);
      }
    }
  }

  getOutgoingLinks(fromTowerId: string): Link[] {
    const result: Link[] = [];
    for (const link of this.links) {
      if (link.fromTowerId === fromTowerId && !link.isScripted) {
        result.push(link);
      }
    }
    return result;
  }

  getOutgoingLink(fromTowerId: string): Link | null {
    for (const link of this.links) {
      if (link.fromTowerId === fromTowerId && !link.isScripted) {
        return link;
      }
    }
    return null;
  }

  getLinkById(linkId: string): Link | null {
    for (const link of this.links) {
      if (link.id === linkId) {
        return link;
      }
    }
    return null;
  }

  getTowerById(towerId: string): Tower | null {
    for (const tower of this.towers) {
      if (tower.id === towerId) {
        return tower;
      }
    }
    return null;
  }

  upsertScriptedLink(link: LinkSeed): void {
    const scripted = this.createRuntimeLink({
      ...link,
      isScripted: true,
      hideInRender: link.hideInRender ?? true,
    });

    for (let i = 0; i < this.links.length; i += 1) {
      if (this.links[i].id === scripted.id) {
        this.links[i] = scripted;
        return;
      }
    }

    this.links.push(scripted);
  }

  removeScriptedLinksNotIn(activeLinkIds: Set<string>): void {
    for (let i = this.links.length - 1; i >= 0; i -= 1) {
      const link = this.links[i];
      if (!link.isScripted) {
        continue;
      }
      if (activeLinkIds.has(link.id)) {
        continue;
      }
      this.links.splice(i, 1);
    }
  }

  tickLinkRuntime(dtSec: number): void {
    for (const link of this.links) {
      link.underAttackTimerSec = Math.max(0, link.underAttackTimerSec - dtSec);
    }
  }

  damageLinkIntegrity(linkId: string, damage: number): boolean {
    if (damage <= 0) {
      return false;
    }

    for (let i = 0; i < this.links.length; i += 1) {
      const link = this.links[i];
      if (link.id !== linkId) {
        continue;
      }

      link.integrity = Math.max(0, link.integrity - damage);
      link.underAttackTimerSec = 0.85;
      if (link.integrity <= 0) {
        this.destroyLinkAt(i);
        return true;
      }
      return false;
    }

    return false;
  }

  destroyLink(linkId: string): boolean {
    for (let i = 0; i < this.links.length; i += 1) {
      if (this.links[i].id === linkId) {
        this.destroyLinkAt(i);
        return true;
      }
    }
    return false;
  }

  notifyTowerCaptured(tower: Tower, previousOwner: Owner, newOwner: Owner): void {
    this.towerCapturedEvents.push({
      type: "tower_captured",
      towerId: tower.id,
      previousOwner,
      newOwner,
      archetype: tower.archetype,
    });
  }

  drainTowerCapturedEvents(): TowerCapturedEvent[] {
    if (this.towerCapturedEvents.length === 0) {
      return [];
    }

    const drained = this.towerCapturedEvents.slice();
    this.towerCapturedEvents.length = 0;
    return drained;
  }

  drainLinkDestroyedEvents(): LinkDestroyedEvent[] {
    if (this.linkDestroyedEvents.length === 0) {
      return [];
    }

    const drained = this.linkDestroyedEvents.slice();
    this.linkDestroyedEvents.length = 0;
    return drained;
  }

  acquirePacket(packet: UnitPacket): UnitPacket {
    const pooled = this.packetPool.pop();
    if (!pooled) {
      return packet;
    }

    Object.assign(pooled, packet);
    pooled.tags = [...packet.tags];
    return pooled;
  }

  removePacketAt(index: number): void {
    const packet = this.packets[index];
    this.packets.splice(index, 1);
    if (packet) {
      this.recyclePacket(packet);
    }
  }

  private destroyLinkAt(index: number): void {
    const link = this.links[index];
    const middle = samplePointOnPolyline(link.points, 0.5) ?? link.points[link.points.length - 1] ?? { x: 0, y: 0 };
    this.links.splice(index, 1);
    this.linkDestroyedEvents.push({
      type: "link_destroyed",
      linkId: link.id,
      x: middle.x,
      y: middle.y,
    });
  }

  private createRuntimeLink(seed: LinkSeed): Link {
    const levelConfig = this.getLinkLevel(seed.level ?? 1);
    const level = levelConfig.level;
    const maxIntegrity = Math.max(1, seed.maxIntegrity ?? levelConfig.integrity);
    const integrity = Math.max(0, Math.min(maxIntegrity, seed.integrity ?? maxIntegrity));

    return {
      id: seed.id,
      fromTowerId: seed.fromTowerId,
      toTowerId: seed.toTowerId,
      owner: seed.owner,
      points: seed.points.map((point) => ({ ...point })),
      level,
      integrity,
      maxIntegrity,
      speedMultiplier: seed.speedMultiplier ?? levelConfig.speedMultiplier,
      armorBonus: seed.armorBonus ?? levelConfig.armorBonus,
      damageBonus: seed.damageBonus ?? levelConfig.damageBonus,
      overchargeDrain: seed.overchargeDrain ?? levelConfig.overchargeDrain,
      underAttackTimerSec: 0,
      isScripted: seed.isScripted ?? false,
      hideInRender: seed.hideInRender ?? false,
    };
  }

  private getLinkLevel(level: number): LinkLevelDefinition {
    const normalized = Math.floor(level);
    const levelOne = this.linkLevels.get(1);
    const found = this.linkLevels.get(normalized);

    if (found) {
      return found;
    }
    if (levelOne) {
      return levelOne;
    }

    return {
      level: 1,
      speedMultiplier: 0,
      armorBonus: 0,
      damageBonus: 0,
      integrity: 100,
      overchargeDrain: 0,
    };
  }

  private recyclePacket(packet: UnitPacket): void {
    packet.id = "";
    packet.owner = "neutral";
    packet.count = 0;
    packet.baseCount = 0;
    packet.speedPxPerSec = 0;
    packet.baseSpeedMultiplier = 1;
    packet.dpsPerUnit = 0;
    packet.baseDpsPerUnit = 0;
    packet.hpPerUnit = 1;
    packet.linkId = "";
    packet.progress01 = 0;
    packet.archetypeId = "";
    packet.tags = EMPTY_TAGS;
    packet.attackRangePx = 0;
    packet.attackCooldownSec = 0;
    packet.attackCooldownRemainingSec = 0;
    packet.holdRemainingSec = 0;
    packet.shieldCycleSec = 0;
    packet.shieldUptimeSec = 0;
    packet.supportAuraRadiusPx = 0;
    packet.supportSpeedMultiplier = 1;
    packet.supportArmorMultiplier = 1;
    packet.splitChildArchetypeId = null;
    packet.splitChildCount = 0;
    packet.canStopToShoot = false;
    packet.isLinkCutter = false;
    packet.linkIntegrityDamagePerSec = 0;
    packet.hasWorldPosition = false;
    packet.worldX = 0;
    packet.worldY = 0;
    packet.sizeScale = 1;
    packet.colorTint = "#ffffff";
    packet.vfxHook = "";
    packet.sfxHook = "";
    packet.icon = "";
    packet.isElite = false;
    packet.eliteDropGold = 0;
    packet.eliteDropBuffId = null;
    packet.isBoss = false;
    packet.bossEnraged = false;
    packet.ageSec = 0;
    packet.baseArmorMultiplier = 1;
    packet.tempSpeedMultiplier = 1;
    packet.tempArmorMultiplier = 1;
    packet.sourceLane = -1;
    packet.sourceWaveIndex = 0;
    this.packetPool.push(packet);
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
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    length += Math.hypot(dx, dy);
  }
  return length;
}
