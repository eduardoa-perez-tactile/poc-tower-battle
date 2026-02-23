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
}

export interface Link {
  id: string;
  fromTowerId: string;
  toTowerId: string;
  owner: Owner;
  points: Vec2[];
}

export const TOWER_RADIUS_PX = 28;

export class World {
  readonly towers: Tower[];
  readonly links: Link[];
  private readonly maxOutgoingLinksPerTower: number;

  constructor(towers: Tower[], maxOutgoingLinksPerTower: number) {
    this.towers = towers.map((tower) => ({ ...tower }));
    this.links = [];
    this.maxOutgoingLinksPerTower = Math.max(0, Math.floor(maxOutgoingLinksPerTower));
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

  private getTowerById(towerId: string): Tower | null {
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
