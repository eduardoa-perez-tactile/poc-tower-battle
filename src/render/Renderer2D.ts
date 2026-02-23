import type { World, TowerOwner } from "../sim/World";

const TOWER_RADIUS_PX = 28;

const OWNER_COLORS: Record<TowerOwner, string> = {
  player: "#2a9d8f",
  enemy: "#e63946",
  neutral: "#6c757d",
};

export class Renderer2D {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.canvas = canvas;
    this.ctx = ctx;
  }

  render(world: World): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const tower of world.towers) {
      this.drawTower(tower.x, tower.y, tower.owner, tower.troopCount, tower.id);
    }
  }

  private drawTower(
    x: number,
    y: number,
    owner: TowerOwner,
    troopCount: number,
    id: string,
  ): void {
    this.ctx.beginPath();
    this.ctx.fillStyle = OWNER_COLORS[owner];
    this.ctx.arc(x, y, TOWER_RADIUS_PX, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = "#f8f9fa";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.ctx.fillStyle = "#f8f9fa";
    this.ctx.font = "bold 18px Arial";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(String(troopCount), x, y);

    this.ctx.font = "12px Arial";
    this.ctx.textBaseline = "alphabetic";
    this.ctx.fillText(id, x, y - TOWER_RADIUS_PX - 8);
  }
}
