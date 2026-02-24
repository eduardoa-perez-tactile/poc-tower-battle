import type { DragPreview } from "../input/InputController";
import type { GridRenderData } from "../levels/runtime";
import {
  TOWER_RADIUS_PX,
  type Link,
  type Owner,
  type UnitPacket,
  type Vec2,
  type World,
} from "../sim/World";
import type { WaveRenderState } from "../waves/WaveDirector";

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
  private mapRenderData: GridRenderData | null;
  private showGridLines: boolean;

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.mapRenderData = null;
    this.showGridLines = true;
  }

  setMapRenderData(mapRenderData: GridRenderData | null): void {
    this.mapRenderData = mapRenderData;
  }

  setShowGridLines(enabled: boolean): void {
    this.showGridLines = enabled;
  }

  render(
    world: World,
    preview: DragPreview | null,
    overlayText: string | null,
    waveRenderState: WaveRenderState | null,
    bossBar: { name: string; hp01: number } | null,
    linkBreakBursts: ReadonlyArray<{ x: number; y: number; ttlSec: number; radiusPx: number }>,
  ): void {
    const viewport = this.getViewportSize();
    this.ctx.clearRect(0, 0, viewport.width, viewport.height);

    this.drawGroundAndGrid();
    this.drawStaticGraphEdges();

    for (const link of world.links) {
      this.drawLink(link);
    }

    this.drawLinkBreakBursts(linkBreakBursts);

    if (waveRenderState) {
      this.drawTelegraphs(waveRenderState);
    }

    for (const packet of world.packets) {
      const position = getPacketRenderPos(world, packet);
      if (!position) {
        continue;
      }
      this.drawPacket(
        position,
        packet.owner,
        packet.count,
        packet.sizeScale,
        packet.colorTint,
        packet.isElite,
        packet.icon,
      );
    }

    for (const tower of world.towers) {
      this.drawTower(tower.x, tower.y, tower.owner, tower.troops, tower.id, tower.archetypeIcon);
    }

    if (preview) {
      this.drawPreviewLink(preview);
    }

    if (overlayText) {
      this.drawOverlay(overlayText);
    }

    if (bossBar) {
      this.drawBossBar(bossBar.name, bossBar.hp01);
    }
  }

  private drawGroundAndGrid(): void {
    if (!this.mapRenderData) {
      return;
    }

    const bounds = this.mapRenderData.bounds;
    this.ctx.save();
    this.ctx.fillStyle = "rgba(44, 102, 74, 0.35)";
    this.ctx.fillRect(bounds.minX, bounds.minY, bounds.width, bounds.height);

    this.ctx.strokeStyle = "rgba(182, 210, 255, 0.28)";
    this.ctx.lineWidth = 1.5;
    this.ctx.strokeRect(bounds.minX, bounds.minY, bounds.width, bounds.height);

    if (this.showGridLines) {
      this.ctx.strokeStyle = "rgba(182, 210, 255, 0.12)";
      this.ctx.lineWidth = 1;

      for (let x = 0; x <= this.mapRenderData.gridWidth; x += 1) {
        const wx = bounds.minX + x * this.mapRenderData.cellSize;
        this.ctx.beginPath();
        this.ctx.moveTo(wx, bounds.minY);
        this.ctx.lineTo(wx, bounds.maxY);
        this.ctx.stroke();
      }

      for (let y = 0; y <= this.mapRenderData.gridHeight; y += 1) {
        const wy = bounds.minY + y * this.mapRenderData.cellSize;
        this.ctx.beginPath();
        this.ctx.moveTo(bounds.minX, wy);
        this.ctx.lineTo(bounds.maxX, wy);
        this.ctx.stroke();
      }
    }

    this.ctx.restore();
  }

  private drawStaticGraphEdges(): void {
    if (!this.mapRenderData) {
      return;
    }

    this.ctx.save();
    this.ctx.strokeStyle = "rgba(203, 220, 255, 0.35)";
    this.ctx.lineWidth = 2;
    this.ctx.lineCap = "round";

    for (const edge of this.mapRenderData.edges) {
      this.ctx.beginPath();
      this.ctx.moveTo(edge.fromX, edge.fromY);
      this.ctx.lineTo(edge.toX, edge.toY);
      this.ctx.stroke();
    }

    this.ctx.fillStyle = "rgba(215, 231, 255, 0.22)";
    for (const node of this.mapRenderData.nodes) {
      this.ctx.beginPath();
      this.ctx.arc(node.x, node.y, TOWER_RADIUS_PX * 0.4, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  private drawTower(
    x: number,
    y: number,
    owner: Owner,
    troops: number,
    id: string,
    archetypeIcon: string,
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
    this.ctx.fillText(String(Math.round(troops)), x, y);

    this.ctx.font = "12px Arial";
    this.ctx.textBaseline = "alphabetic";
    this.ctx.fillText(id, x, y - TOWER_RADIUS_PX - 8);

    if (archetypeIcon) {
      this.ctx.fillStyle = "#111418";
      this.ctx.beginPath();
      this.ctx.arc(x + 16, y - 16, 9, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.fillStyle = "#f8f9fa";
      this.ctx.font = "bold 10px Arial";
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(archetypeIcon, x + 16, y - 16.5);
    }
  }

  private drawLink(link: Link): void {
    if (link.hideInRender) {
      return;
    }

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

    const midpoint = samplePointOnPolyline(link.points, 0.5);
    if (midpoint) {
      this.ctx.fillStyle = "rgba(11, 12, 13, 0.8)";
      this.ctx.fillRect(midpoint.x - 8, midpoint.y - 18, 16, 12);
      this.ctx.fillStyle = "#f8f9fa";
      this.ctx.font = "bold 10px Arial";
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(String(link.level), midpoint.x, midpoint.y - 12);

      if (link.underAttackTimerSec > 0 && link.integrity < link.maxIntegrity) {
        const hp01 = clamp01(link.integrity / Math.max(1, link.maxIntegrity));
        this.ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
        this.ctx.fillRect(midpoint.x - 22, midpoint.y - 4, 44, 6);
        this.ctx.fillStyle = hp01 > 0.35 ? "#63e6be" : "#ff6b6b";
        this.ctx.fillRect(midpoint.x - 21, midpoint.y - 3, 42 * hp01, 4);
      }
    }

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

  private drawPacket(
    position: Vec2,
    owner: Owner,
    count: number,
    sizeScale: number,
    colorTint: string,
    isElite: boolean,
    icon: string,
  ): void {
    this.ctx.save();
    const packetRadius = Math.max(4, 8 * sizeScale);
    this.ctx.fillStyle = colorTint || PACKET_COLORS[owner];
    this.ctx.beginPath();
    this.ctx.arc(position.x, position.y, packetRadius, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = isElite ? "#ffd166" : "#0b0c0d";
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();

    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = "11px Arial";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(String(Math.max(0, Math.round(count))), position.x, position.y - 14);
    if (icon) {
      this.ctx.font = "bold 10px Arial";
      this.ctx.fillText(icon, position.x, position.y + 0.5);
    }
    this.ctx.restore();
  }

  private drawTelegraphs(waveRenderState: WaveRenderState): void {
    for (const marker of waveRenderState.telegraphs) {
      const windupDuration = Math.max(0.01, marker.triggerAtSec - marker.windupStartSec);
      const windupT = clamp01((performance.now() / 1000 - marker.windupStartSec) / windupDuration);
      this.ctx.save();
      this.ctx.strokeStyle = marker.color;
      this.ctx.lineWidth = 3;
      this.ctx.setLineDash([8, 6]);
      this.ctx.beginPath();
      this.ctx.arc(marker.x, marker.y, marker.radiusPx * (0.85 + windupT * 0.15), 0, Math.PI * 2);
      this.ctx.stroke();

      this.ctx.fillStyle = marker.color;
      this.ctx.font = "bold 12px Arial";
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(marker.label, marker.x, marker.y);
      this.ctx.restore();
    }
  }

  private drawLinkBreakBursts(
    bursts: ReadonlyArray<{ x: number; y: number; ttlSec: number; radiusPx: number }>,
  ): void {
    for (const burst of bursts) {
      const life01 = clamp01(burst.ttlSec / 0.45);
      const radius = burst.radiusPx * (1.2 - life01 * 0.45);
      this.ctx.save();
      this.ctx.strokeStyle = `rgba(255, 208, 102, ${0.7 * life01})`;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(burst.x, burst.y, radius, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.restore();
    }
  }

  private drawBossBar(name: string, hp01: number): void {
    const viewport = this.getViewportSize();
    const width = Math.min(520, viewport.width - 80);
    const height = 22;
    const x = Math.round((viewport.width - width) / 2);
    const y = 12;

    this.ctx.save();
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    this.ctx.fillRect(x, y, width, height);

    this.ctx.fillStyle = "#c77dff";
    this.ctx.fillRect(x + 2, y + 2, Math.max(0, (width - 4) * clamp01(hp01)), height - 4);

    this.ctx.strokeStyle = "#f8f9fa";
    this.ctx.lineWidth = 1.5;
    this.ctx.strokeRect(x, y, width, height);

    this.ctx.fillStyle = "#f8f9fa";
    this.ctx.font = "bold 12px Arial";
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(`${name} ${Math.round(clamp01(hp01) * 100)}%`, x + width / 2, y + height / 2 + 0.5);
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getPacketRenderPos(world: World, packet: UnitPacket): Vec2 | null {
  if (packet.hasWorldPosition) {
    return {
      x: packet.worldX,
      y: packet.worldY,
    };
  }

  const link = world.getLinkById(packet.linkId);
  if (!link) {
    return null;
  }
  return samplePointOnPolyline(link.points, packet.progress01);
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
