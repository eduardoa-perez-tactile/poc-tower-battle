import type { DragPreview } from "../input/InputController";
import { TOWER_RADIUS_PX, type Link, type Owner, type Vec2, type World } from "../sim/World";

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

const PACKET_COLORS: Record<Owner, string> = {
  player: "#33d9c5",
  enemy: "#ff5d6a",
  neutral: "#dee2e6",
};

export class Renderer2D {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.canvas = canvas;
    this.ctx = ctx;
  }

  render(world: World, preview: DragPreview | null, overlayText: string | null): void {
    const viewport = this.getViewportSize();
    this.ctx.clearRect(0, 0, viewport.width, viewport.height);

    for (const link of world.links) {
      this.drawLink(link);
    }

    for (const packet of world.packets) {
      const link = world.getLinkById(packet.linkId);
      if (link) {
        this.drawPacket(link, packet.progress01, packet.owner, packet.count);
      }
    }

    for (const tower of world.towers) {
      this.drawTower(tower.x, tower.y, tower.owner, tower.troopCount, tower.id);
    }

    if (preview) {
      this.drawPreviewLink(preview);
    }

    if (overlayText) {
      this.drawOverlay(overlayText);
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
    this.ctx.fillText(String(Math.round(troopCount)), x, y);

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

  private drawPacket(link: Link, progress01: number, owner: Owner, count: number): void {
    const position = samplePointOnPolyline(link.points, progress01);
    if (!position) {
      return;
    }

    this.ctx.save();
    this.ctx.fillStyle = PACKET_COLORS[owner];
    this.ctx.beginPath();
    this.ctx.arc(position.x, position.y, 8, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = "#0b0c0d";
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();

    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = "11px Arial";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(String(Math.max(0, Math.round(count))), position.x, position.y - 14);
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

  private drawOverlay(title: string): void {
    const viewport = this.getViewportSize();
    this.ctx.save();
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
    this.ctx.fillRect(0, 0, viewport.width, viewport.height);

    const centerX = viewport.width / 2;
    const centerY = viewport.height / 2;
    this.ctx.fillStyle = "#f8f9fa";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";

    this.ctx.font = "bold 54px Arial";
    this.ctx.fillText(title, centerX, centerY - 12);

    this.ctx.font = "16px Arial";
    this.ctx.fillStyle = "#ced4da";
    this.ctx.fillText("Press R or click Restart", centerX, centerY + 34);
    this.ctx.restore();
  }

  private getViewportSize(): { width: number; height: number } {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { width: rect.width, height: rect.height };
    }
    return { width: this.canvas.width, height: this.canvas.height };
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
      const localDistance = targetDistance - walkedDistance;
      const t = localDistance / segmentLength;
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
  let totalLength = 0;
  for (let i = 1; i < points.length; i += 1) {
    totalLength += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return totalLength;
}
