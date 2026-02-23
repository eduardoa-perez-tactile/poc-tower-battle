export type TowerOwner = "player" | "enemy" | "neutral";

export interface TowerState {
  id: string;
  x: number;
  y: number;
  owner: TowerOwner;
  troopCount: number;
}

export class World {
  readonly towers: TowerState[];

  constructor(towers: TowerState[]) {
    this.towers = towers.map((tower) => ({ ...tower }));
  }
}
