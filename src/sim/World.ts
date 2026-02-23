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
}

export interface UnitPacket {
  id: string;
  owner: Owner;
  count: number;
  speedPxPerSec: number;
  dpsPerUnit: number;
  hpPerUnit: number;
  linkId: string;
  progress01: number;
}

export const TOWER_RADIUS_PX = 28;

export class World {
  readonly towers: Tower[];
  readonly links: Link[];
  readonly packets: UnitPacket[];
  private readonly maxOutgoingLinksPerTower: number;

  constructor(towers: Tower[], maxOutgoingLinksPerTower: number, initialLinks: Link[] = []) {
    this.towers = towers.map((tower) => ({ ...tower }));
    this.links = [];
    this.packets = [];
    this.maxOutgoingLinksPerTower = Math.max(0, Math.floor(maxOutgoingLinksPerTower));

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

    this.removeOutgoingLinks(fromTowerId);
    const link: Link = {
      id: `${fromTowerId}->${toTowerId}`,
      fromTowerId,
      toTowerId,
      owner: fromTower.owner,
      points: [
        { x: fromTower.x, y: fromTower.y },
        { x: toTower.x, y: toTower.y },
      ],
    };
    this.links.push(link);
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

  private removeOutgoingLinks(fromTowerId: string): void {
    for (let i = this.links.length - 1; i >= 0; i -= 1) {
      if (this.links[i].fromTowerId === fromTowerId) {
        this.links.splice(i, 1);
      }
    }
  }
}
