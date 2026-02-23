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
  troopCount: number;
  regenRatePerSec: number;
  maxTroops: number;
}

export interface Link {
  id: string;
  fromTowerId: string;
  toTowerId: string;
  owner: Owner;
  points: Vec2[];
  isScripted?: boolean;
  hideInRender?: boolean;
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

export const TOWER_RADIUS_PX = 28;
const EMPTY_TAGS: string[] = [];

export class World {
  readonly towers: Tower[];
  readonly links: Link[];
  readonly packets: UnitPacket[];
  private readonly maxOutgoingLinksPerTower: number;
  private readonly packetPool: UnitPacket[];

  constructor(towers: Tower[], maxOutgoingLinksPerTower: number, initialLinks: Link[] = []) {
    this.towers = towers.map((tower) => ({ ...tower }));
    this.links = [];
    this.packets = [];
    this.maxOutgoingLinksPerTower = Math.max(0, Math.floor(maxOutgoingLinksPerTower));
    this.packetPool = [];

    for (const link of initialLinks) {
      this.setOutgoingLink(link.fromTowerId, link.toTowerId);
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

  setOutgoingLink(fromTowerId: string, toTowerId: string): void {
    if (fromTowerId === toTowerId || this.maxOutgoingLinksPerTower < 1) {
      return;
    }

    const fromTower = this.getTowerById(fromTowerId);
    const toTower = this.getTowerById(toTowerId);
    if (!fromTower || !toTower) {
      return;
    }

    this.clearOutgoingLink(fromTowerId);
    const link: Link = {
      id: `${fromTowerId}->${toTowerId}`,
      fromTowerId,
      toTowerId,
      owner: fromTower.owner,
      isScripted: false,
      hideInRender: false,
      points: [
        { x: fromTower.x, y: fromTower.y },
        { x: toTower.x, y: toTower.y },
      ],
    };
    this.links.push(link);
  }

  clearOutgoingLink(fromTowerId: string): void {
    for (let i = this.links.length - 1; i >= 0; i -= 1) {
      if (this.links[i].fromTowerId === fromTowerId && !this.links[i].isScripted) {
        this.links.splice(i, 1);
      }
    }
  }

  getOutgoingLink(fromTowerId: string): Link | null {
    for (const link of this.links) {
      if (link.fromTowerId === fromTowerId) {
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

  upsertScriptedLink(link: Link): void {
    const scripted: Link = {
      ...link,
      isScripted: true,
      hideInRender: link.hideInRender ?? true,
      points: link.points.map((point) => ({ ...point })),
    };

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
