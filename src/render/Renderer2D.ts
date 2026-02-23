import type { DragPreview } from "../input/InputController";
import { TOWER_RADIUS_PX, type Link, type Owner, type World } from "../sim/World";

const OWNER_COLORS: Record<Owner, string> = {
  player: "#2a9d8f",
  enemy: "#e63946",
  neutral: "#6c757d",
};

const LINK_COLORS: Record<Owner, string> = {
  player: "#7ce3d6",
  enemy: "#ff7b86",
  neutral: "#adb5bd",
};

export class Renderer2D {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.canvas = canvas;
    this.ctx = ctx;
  }

  render(world: World, preview: DragPreview | null): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const link of world.links) {
      this.drawLink(link);
    }

    if (preview) {
      this.drawPreviewLink(preview);
    }

    for (const tower of world.towers) {
      this.drawTower(tower.x, tower.y, tower.owner, tower.troopCount, tower.id);
    }
  }

  private drawTower(
    x: number,
    y: number,
    owner: Owner,
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

  private drawLink(link: Link): void {
    if (link.points.length < 2) {
      return;
    }

    this.ctx.save();
    this.ctx.strokeStyle = LINK_COLORS[link.owner];
    this.ctx.lineWidth = 4;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.beginPath();
    this.ctx.moveTo(link.points[0].x, link.points[0].y);
    for (let i = 1; i < link.points.length; i += 1) {
      this.ctx.lineTo(link.points[i].x, link.points[i].y);
    }
    this.ctx.stroke();

    const fromPoint = link.points[link.points.length - 2];
    const toPoint = link.points[link.points.length - 1];
    this.drawArrowHead(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y, LINK_COLORS[link.owner]);
    this.ctx.restore();
  }

  private drawPreviewLink(preview: DragPreview): void {
    this.ctx.save();
    this.ctx.strokeStyle = LINK_COLORS[preview.owner];
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([10, 6]);
    this.ctx.beginPath();
    this.ctx.moveTo(preview.from.x, preview.from.y);
    this.ctx.lineTo(preview.to.x, preview.to.y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawArrowHead(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    color: string,
  ): void {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.hypot(dx, dy);
    if (length <= 0.001) {
      return;
    }

    const unitX = dx / length;
    const unitY = dy / length;
    const tipOffset = TOWER_RADIUS_PX + 4;
    const tipX = toX - unitX * tipOffset;
    const tipY = toY - unitY * tipOffset;
    const size = 10;
    const baseX = tipX - unitX * size;
    const baseY = tipY - unitY * size;
    const perpX = -unitY;
    const perpY = unitX;
    const width = 5;

    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.moveTo(tipX, tipY);
    this.ctx.lineTo(baseX + perpX * width, baseY + perpY * width);
    this.ctx.lineTo(baseX - perpX * width, baseY - perpY * width);
    this.ctx.closePath();
    this.ctx.fill();
  }
}
