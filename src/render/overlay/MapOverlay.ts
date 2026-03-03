import type {
  DragCandidateOverlay,
  DragPreview,
  LinkCandidateState,
  PointerHint,
} from "../../input/InputController";
import { TOWER_RADIUS_PX, type Link, type Tower, type Vec2, type World } from "../../sim/World";
import { formatCompactCount, formatRegenPerSec } from "./format";
import { OVERLAY_THEME } from "./overlayTheme";

export interface OverlayViewportTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface MapOverlayInteractionState {
  hoveredTowerId: string | null;
  selectedTowerId: string | null;
  isDraggingLink: boolean;
  dragSourceId: string | null;
  currentMouseWorld: Vec2 | null;
  preview: DragPreview | null;
  dragOverlay: DragCandidateOverlay | null;
  pointerHint: PointerHint | null;
}

export interface MapOverlayDrawState {
  world: World;
  interaction: MapOverlayInteractionState;
  showLegend: boolean;
  showDebugIds: boolean;
  timeSec: number;
}

export class MapOverlay {
  private readonly towerById: Map<string, Tower>;
  private readonly badgeAngleByTowerId: Map<string, number>;
  private readonly textWidthCache: Map<string, number>;
  private readonly tmpPoint: Vec2;
  private readonly tmpDir: Vec2;
  private readonly badgeFont: string;
  private readonly badgeSubFont: string;
  private readonly legendFont: string;
  private readonly linkLevelFont: string;
  private readonly pointerHintFont: string;

  constructor() {
    this.towerById = new Map<string, Tower>();
    this.badgeAngleByTowerId = new Map<string, number>();
    this.textWidthCache = new Map<string, number>();
    this.tmpPoint = { x: 0, y: 0 };
    this.tmpDir = { x: 1, y: 0 };
    this.badgeFont = `${OVERLAY_THEME.badge.fontWeight} ${OVERLAY_THEME.badge.fontSizePx}px ${OVERLAY_THEME.fontFamily}`;
    this.badgeSubFont = `600 ${Math.max(10, OVERLAY_THEME.badge.fontSizePx - 2)}px ${OVERLAY_THEME.fontFamily}`;
    this.legendFont = `600 ${OVERLAY_THEME.legend.fontSizePx}px ${OVERLAY_THEME.fontFamily}`;
    this.linkLevelFont = `700 ${OVERLAY_THEME.link.levelFontSizePx}px ${OVERLAY_THEME.fontFamily}`;
    this.pointerHintFont = `600 12px ${OVERLAY_THEME.fontFamily}`;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    overlayState: MapOverlayDrawState,
    viewportTransform: OverlayViewportTransform,
  ): void {
    this.prepareTowerLookup(overlayState.world.towers);
    this.drawLinks(ctx, overlayState, viewportTransform);
    this.drawTowers(ctx, overlayState, viewportTransform);
    this.drawSuggestedLink(ctx, overlayState, viewportTransform);
    this.drawPreviewLink(ctx, overlayState.interaction.preview, viewportTransform);
    this.drawPointerHint(ctx, overlayState.interaction.pointerHint, viewportTransform);
    if (overlayState.showLegend) {
      this.drawLegend(ctx, viewportTransform);
    }
  }

  private prepareTowerLookup(towers: ReadonlyArray<Tower>): void {
    this.towerById.clear();
    for (const tower of towers) {
      this.towerById.set(tower.id, tower);
      if (!this.badgeAngleByTowerId.has(tower.id)) {
        this.badgeAngleByTowerId.set(tower.id, angleFromId(tower.id));
      }
    }
  }

  private drawLinks(
    ctx: CanvasRenderingContext2D,
    overlayState: MapOverlayDrawState,
    viewportTransform: OverlayViewportTransform,
  ): void {
    for (const link of overlayState.world.links) {
      if (link.hideInRender || link.points.length < 2) {
        continue;
      }
      const ownerColors = OVERLAY_THEME.ownerColors[link.owner];
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      this.tracePolyline(ctx, link.points, viewportTransform);
      ctx.strokeStyle = ownerColors.linkOutline;
      ctx.lineWidth = OVERLAY_THEME.link.outlineWidthPx;
      ctx.stroke();

      this.tracePolyline(ctx, link.points, viewportTransform);
      ctx.strokeStyle = ownerColors.link;
      ctx.lineWidth = OVERLAY_THEME.link.widthPx;
      ctx.stroke();

      const from = link.points[link.points.length - 2];
      const to = link.points[link.points.length - 1];
      if (from && to) {
        this.drawArrowHead(ctx, from, to, ownerColors.link, viewportTransform);
      }

      this.drawLinkLevelBadge(ctx, link, viewportTransform);
      if (shouldShowFlowMarkers(link, overlayState.interaction, this.towerById)) {
        this.drawFlowMarkers(ctx, link, ownerColors.flow, overlayState.timeSec, viewportTransform);
      }
      if (overlayState.showDebugIds) {
        this.drawLinkDebugId(ctx, link, viewportTransform);
      }
      ctx.restore();
    }
  }

  private drawLinkLevelBadge(
    ctx: CanvasRenderingContext2D,
    link: Link,
    viewportTransform: OverlayViewportTransform,
  ): void {
    const midpoint = samplePointOnPolyline(link.points, 0.5);
    if (!midpoint) {
      return;
    }
    const sx = toScreenX(midpoint.x, viewportTransform);
    const sy = toScreenY(midpoint.y, viewportTransform);

    ctx.fillStyle = "rgba(8, 12, 17, 0.82)";
    ctx.strokeStyle = "rgba(232, 240, 246, 0.42)";
    ctx.lineWidth = 1;
    this.drawRoundedRect(ctx, sx - 10, sy - 17, 20, 13, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#f8f9fa";
    ctx.font = this.linkLevelFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(link.level), sx, sy - 10.5);
  }

  private drawFlowMarkers(
    ctx: CanvasRenderingContext2D,
    link: Link,
    color: string,
    timeSec: number,
    viewportTransform: OverlayViewportTransform,
  ): void {
    const length = getPolylineLength(link.points);
    if (length <= 0.001) {
      return;
    }
    const markerCount = Math.max(
      1,
      Math.min(4, Math.floor(length / OVERLAY_THEME.link.flowMarkerSpacingPx)),
    );
    const baseProgress = (timeSec * OVERLAY_THEME.link.flowSpeed) % 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.9;
    ctx.lineCap = "round";

    for (let i = 0; i < markerCount; i += 1) {
      const progress = (baseProgress + i / markerCount) % 1;
      if (!samplePointAndDirectionOnPolyline(link.points, progress, this.tmpPoint, this.tmpDir)) {
        continue;
      }
      const sx = toScreenX(this.tmpPoint.x, viewportTransform);
      const sy = toScreenY(this.tmpPoint.y, viewportTransform);
      const len = Math.hypot(this.tmpDir.x, this.tmpDir.y);
      if (len <= 0.001) {
        continue;
      }
      const ux = this.tmpDir.x / len;
      const uy = this.tmpDir.y / len;
      const px = -uy;
      const py = ux;
      const markerSize = OVERLAY_THEME.link.flowMarkerSizePx;
      const backX = sx - ux * markerSize;
      const backY = sy - uy * markerSize;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(backX + px * (markerSize * 0.55), backY + py * (markerSize * 0.55));
      ctx.moveTo(sx, sy);
      ctx.lineTo(backX - px * (markerSize * 0.55), backY - py * (markerSize * 0.55));
      ctx.stroke();
    }
  }

  private drawLinkDebugId(
    ctx: CanvasRenderingContext2D,
    link: Link,
    viewportTransform: OverlayViewportTransform,
  ): void {
    const midpoint = samplePointOnPolyline(link.points, 0.5);
    if (!midpoint) {
      return;
    }
    const sx = toScreenX(midpoint.x, viewportTransform);
    const sy = toScreenY(midpoint.y, viewportTransform);
    ctx.font = "600 10px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const textWidth = this.measureTextCached(ctx, link.id, ctx.font);
    const bgWidth = textWidth + 8;
    this.drawRoundedRect(ctx, sx - bgWidth / 2, sy + 4, bgWidth, 13, 4);
    ctx.fillStyle = "rgba(2, 5, 9, 0.66)";
    ctx.fill();
    ctx.fillStyle = "rgba(222, 228, 236, 0.96)";
    ctx.fillText(link.id, sx, sy + 14);
  }

  private drawTowers(
    ctx: CanvasRenderingContext2D,
    overlayState: MapOverlayDrawState,
    viewportTransform: OverlayViewportTransform,
  ): void {
    const interaction = overlayState.interaction;
    const candidateMap = interaction.dragOverlay?.candidateStateByTowerId ?? null;
    for (const tower of overlayState.world.towers) {
      if (!Number.isFinite(tower.x) || !Number.isFinite(tower.y)) {
        continue;
      }
      const sx = toScreenX(tower.x, viewportTransform);
      const sy = toScreenY(tower.y, viewportTransform);
      const radius = Math.max(
        (TOWER_RADIUS_PX + 6) * viewportTransform.scale,
        OVERLAY_THEME.ring.baseRadiusPx * viewportTransform.scale,
      );
      const hovered = interaction.hoveredTowerId === tower.id;
      const selected = interaction.selectedTowerId === tower.id;
      const isDragSource = interaction.dragSourceId === tower.id && interaction.isDraggingLink;
      const contested = Number.isFinite(tower.hp) && tower.hp < tower.maxHp;
      const candidateState = candidateMap?.[tower.id] ?? null;
      this.drawTowerRing(
        ctx,
        sx,
        sy,
        radius,
        tower,
        contested,
        hovered,
        selected || isDragSource,
        candidateState,
        overlayState.timeSec,
      );
      this.drawTowerBadge(ctx, tower, sx, sy, radius, viewportTransform.scale);
      if (overlayState.showDebugIds) {
        this.drawTowerIdLabel(ctx, tower.id, sx, sy, radius);
      }
    }
  }

  private drawTowerRing(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    radius: number,
    tower: Tower,
    contested: boolean,
    hovered: boolean,
    selected: boolean,
    candidateState: LinkCandidateState | null,
    timeSec: number,
  ): void {
    const ownerColors = OVERLAY_THEME.ownerColors[tower.owner];
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * Math.PI * 2 * OVERLAY_THEME.animation.pulseHz);
    const ringWidth =
      OVERLAY_THEME.ring.baseWidthPx +
      (hovered ? OVERLAY_THEME.ring.hoverExtraWidthPx : 0) +
      (selected ? OVERLAY_THEME.ring.selectedExtraWidthPx : 0);

    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = ownerColors.glow;
    ctx.lineWidth = ringWidth + OVERLAY_THEME.ring.glowWidthPx * (selected ? 1.3 : 1);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = ownerColors.ring;
    ctx.lineWidth = ringWidth;
    if (tower.owner === "neutral") {
      ctx.setLineDash(OVERLAY_THEME.ring.neutralDash);
    }
    if (contested) {
      ctx.setLineDash(OVERLAY_THEME.ring.contestedDash);
      ctx.lineDashOffset = -timeSec * OVERLAY_THEME.animation.contestedDashSpeed * 20;
      ctx.lineWidth += 0.8 + pulse;
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (selected) {
      this.drawSelectionWedge(ctx, sx, sy, radius, ownerColors.ring);
    }

    if (candidateState === "valid") {
      ctx.beginPath();
      ctx.arc(sx, sy, radius + 5, 0, Math.PI * 2);
      ctx.strokeStyle = OVERLAY_THEME.affordance.validRingColor;
      ctx.lineWidth = 2.8 + pulse * 1.2;
      ctx.stroke();
    } else if (candidateState === "invalid") {
      ctx.beginPath();
      ctx.arc(sx, sy, radius + 4, 0, Math.PI * 2);
      ctx.strokeStyle = OVERLAY_THEME.affordance.invalidRingColor;
      ctx.lineWidth = 2.3;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = OVERLAY_THEME.affordance.invalidCrossColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy - 8);
      ctx.lineTo(sx + 8, sy + 8);
      ctx.moveTo(sx + 8, sy - 8);
      ctx.lineTo(sx - 8, sy + 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSelectionWedge(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    radius: number,
    color: string,
  ): void {
    const wedgeR = radius + OVERLAY_THEME.ring.selectionWedgeSizePx;
    const a0 = -Math.PI * 0.36;
    const a1 = -Math.PI * 0.16;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.arc(sx, sy, wedgeR, a0, a1);
    ctx.closePath();
    ctx.globalAlpha = 0.2;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawTowerBadge(
    ctx: CanvasRenderingContext2D,
    tower: Tower,
    sx: number,
    sy: number,
    radius: number,
    scale: number,
  ): void {
    const ownerColors = OVERLAY_THEME.ownerColors[tower.owner];
    const angle = this.badgeAngleByTowerId.get(tower.id) ?? 0;
    const jitterRadius = OVERLAY_THEME.badge.jitterRadiusPx * scale;
    const jitterX = Math.cos(angle) * jitterRadius;
    const jitterY = Math.sin(angle) * jitterRadius * 0.6;
    const anchorX = sx + OVERLAY_THEME.badge.anchorOffsetXPx * scale + jitterX;
    const anchorY = sy + OVERLAY_THEME.badge.anchorOffsetYPx * scale - radius * 0.02 + jitterY;

    const troopValue = Number.isFinite(tower.troops) ? tower.troops : 0;
    const countText = formatCompactCount(troopValue);
    const regenValue = Number.isFinite(tower.effectiveRegen) ? tower.effectiveRegen : tower.regenRate;
    const regenText = tower.owner === "player" ? formatRegenPerSec(regenValue) : "";

    ctx.save();
    ctx.font = this.badgeFont;
    const countWidth = this.measureTextCached(ctx, countText, this.badgeFont);
    let regenWidth = 0;
    if (regenText) {
      regenWidth = this.measureTextCached(ctx, regenText, this.badgeSubFont);
    }
    const width =
      countWidth +
      (regenWidth > 0 ? regenWidth + 6 : 0) +
      OVERLAY_THEME.badge.paddingXPx * 2;
    const height = OVERLAY_THEME.badge.fontSizePx + OVERLAY_THEME.badge.paddingYPx * 2;

    this.drawRoundedRect(
      ctx,
      anchorX,
      anchorY,
      width,
      height,
      OVERLAY_THEME.badge.cornerRadiusPx,
    );
    ctx.fillStyle = ownerColors.badgeFill;
    ctx.fill();
    ctx.strokeStyle = OVERLAY_THEME.badge.outlineColor;
    ctx.lineWidth = OVERLAY_THEME.badge.outlineWidthPx;
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = ownerColors.badgeText;
    const textX = anchorX + OVERLAY_THEME.badge.paddingXPx;
    const textY = anchorY + height / 2 + 0.25;
    ctx.font = this.badgeFont;
    ctx.fillText(countText, textX, textY);

    if (regenText) {
      ctx.font = this.badgeSubFont;
      ctx.fillStyle = OVERLAY_THEME.badge.regenTextColor;
      ctx.fillText(regenText, textX + countWidth + 6, textY);
    }
    ctx.restore();
  }

  private drawTowerIdLabel(
    ctx: CanvasRenderingContext2D,
    towerId: string,
    sx: number,
    sy: number,
    radius: number,
  ): void {
    ctx.save();
    ctx.font = "600 10px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const textWidth = this.measureTextCached(ctx, towerId, ctx.font);
    const bgWidth = textWidth + 8;
    const x = sx - bgWidth / 2;
    const y = sy - radius - 18;
    this.drawRoundedRect(ctx, x, y, bgWidth, 12, 4);
    ctx.fillStyle = "rgba(2, 5, 9, 0.64)";
    ctx.fill();
    ctx.fillStyle = "rgba(222, 228, 236, 0.96)";
    ctx.fillText(towerId, sx, y + 10);
    ctx.restore();
  }

  private drawSuggestedLink(
    ctx: CanvasRenderingContext2D,
    overlayState: MapOverlayDrawState,
    viewportTransform: OverlayViewportTransform,
  ): void {
    const interaction = overlayState.interaction;
    if (!interaction.isDraggingLink || !interaction.dragSourceId || !interaction.hoveredTowerId) {
      return;
    }
    if (interaction.dragSourceId === interaction.hoveredTowerId) {
      return;
    }
    const source = this.towerById.get(interaction.dragSourceId);
    const target = this.towerById.get(interaction.hoveredTowerId);
    if (!source || !target) {
      return;
    }

    ctx.save();
    ctx.strokeStyle = OVERLAY_THEME.affordance.suggestedLineColor;
    ctx.lineWidth = OVERLAY_THEME.affordance.suggestedLineWidthPx;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(toScreenX(source.x, viewportTransform), toScreenY(source.y, viewportTransform));
    ctx.lineTo(toScreenX(target.x, viewportTransform), toScreenY(target.y, viewportTransform));
    ctx.stroke();
    ctx.restore();
  }

  private drawPreviewLink(
    ctx: CanvasRenderingContext2D,
    preview: DragPreview | null,
    viewportTransform: OverlayViewportTransform,
  ): void {
    if (!preview) {
      return;
    }
    const ownerColors = OVERLAY_THEME.ownerColors[preview.owner];
    ctx.save();
    ctx.strokeStyle = ownerColors.link;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.moveTo(toScreenX(preview.from.x, viewportTransform), toScreenY(preview.from.y, viewportTransform));
    ctx.lineTo(toScreenX(preview.to.x, viewportTransform), toScreenY(preview.to.y, viewportTransform));
    ctx.stroke();
    ctx.restore();
  }

  private drawPointerHint(
    ctx: CanvasRenderingContext2D,
    hint: PointerHint | null,
    viewportTransform: OverlayViewportTransform,
  ): void {
    if (!hint) {
      return;
    }
    const textPaddingX = 8;
    const textPaddingY = 5;
    const x = toScreenX(hint.position.x, viewportTransform) + 12;
    const y = toScreenY(hint.position.y, viewportTransform) - 24;

    ctx.save();
    ctx.font = this.pointerHintFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const textWidth = this.measureTextCached(ctx, hint.text, this.pointerHintFont);
    const width = textWidth + textPaddingX * 2;
    const height = 22;
    this.drawRoundedRect(ctx, x, y, width, height, 6);
    ctx.fillStyle = "rgba(7, 12, 20, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 198, 160, 0.85)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#ffe8d6";
    ctx.fillText(hint.text, x + textPaddingX, y + textPaddingY);
    ctx.restore();
  }

  private drawLegend(ctx: CanvasRenderingContext2D, viewportTransform: OverlayViewportTransform): void {
    const x = Math.max(10, viewportTransform.viewportWidth - 220);
    const y = 14;
    const width = 206;
    const height = 108;

    ctx.save();
    this.drawRoundedRect(ctx, x, y, width, height, 10);
    ctx.fillStyle = OVERLAY_THEME.legend.bgColor;
    ctx.fill();
    ctx.strokeStyle = OVERLAY_THEME.legend.borderColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = this.legendFont;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = OVERLAY_THEME.legend.titleColor;
    ctx.fillText("Readability Legend (H)", x + 10, y + 18);

    this.drawLegendSwatch(ctx, x + 10, y + 28, OVERLAY_THEME.ownerColors.player.ring, "Player");
    this.drawLegendSwatch(ctx, x + 10, y + 46, OVERLAY_THEME.ownerColors.enemy.ring, "Enemy");
    this.drawLegendDashed(ctx, x + 10, y + 64, OVERLAY_THEME.ownerColors.neutral.ring, "Neutral (dashed)");

    ctx.fillStyle = OVERLAY_THEME.legend.textColor;
    ctx.fillText("Pulse = contested", x + 10, y + 88);
    ctx.fillText("O toggle overlay", x + 10, y + 104);
    ctx.restore();
  }

  private drawLegendSwatch(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    label: string,
  ): void {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.moveTo(x, y);
    ctx.lineTo(x + 22, y);
    ctx.stroke();
    ctx.fillStyle = OVERLAY_THEME.legend.textColor;
    ctx.fillText(label, x + 30, y + 4);
  }

  private drawLegendDashed(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    label: string,
  ): void {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash(OVERLAY_THEME.ring.neutralDash);
    ctx.moveTo(x, y);
    ctx.lineTo(x + 22, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = OVERLAY_THEME.legend.textColor;
    ctx.fillText(label, x + 30, y + 4);
  }

  private tracePolyline(
    ctx: CanvasRenderingContext2D,
    points: ReadonlyArray<Vec2>,
    viewportTransform: OverlayViewportTransform,
  ): void {
    const first = points[0];
    if (!first) {
      return;
    }
    ctx.beginPath();
    ctx.moveTo(toScreenX(first.x, viewportTransform), toScreenY(first.y, viewportTransform));
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i];
      if (!point) {
        continue;
      }
      ctx.lineTo(toScreenX(point.x, viewportTransform), toScreenY(point.y, viewportTransform));
    }
  }

  private drawArrowHead(
    ctx: CanvasRenderingContext2D,
    from: Vec2,
    to: Vec2,
    color: string,
    viewportTransform: OverlayViewportTransform,
  ): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0.001) {
      return;
    }
    const ux = dx / length;
    const uy = dy / length;
    const tipOffset = TOWER_RADIUS_PX + 3;
    const tipX = to.x - ux * tipOffset;
    const tipY = to.y - uy * tipOffset;
    const size = OVERLAY_THEME.link.arrowSizePx;
    const baseX = tipX - ux * size;
    const baseY = tipY - uy * size;
    const px = -uy;
    const py = ux;
    const width = size * 0.52;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(toScreenX(tipX, viewportTransform), toScreenY(tipY, viewportTransform));
    ctx.lineTo(
      toScreenX(baseX + px * width, viewportTransform),
      toScreenY(baseY + py * width, viewportTransform),
    );
    ctx.lineTo(
      toScreenX(baseX - px * width, viewportTransform),
      toScreenY(baseY - py * width, viewportTransform),
    );
    ctx.closePath();
    ctx.fill();
  }

  private drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const r = Math.max(0, Math.min(radius, width * 0.5, height * 0.5));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private measureTextCached(ctx: CanvasRenderingContext2D, text: string, font: string): number {
    const key = `${font}|${text}`;
    const cached = this.textWidthCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const width = ctx.measureText(text).width;
    this.textWidthCache.set(key, width);
    return width;
  }
}

function shouldShowFlowMarkers(
  link: Link,
  interaction: MapOverlayInteractionState,
  towerById: ReadonlyMap<string, Tower>,
): boolean {
  const fromTower = towerById.get(link.fromTowerId);
  const toTower = towerById.get(link.toTowerId);
  if (fromTower?.owner === "player" || toTower?.owner === "player") {
    return true;
  }
  const hoverId = interaction.hoveredTowerId;
  if (hoverId && (link.fromTowerId === hoverId || link.toTowerId === hoverId)) {
    return true;
  }
  const selectedId = interaction.selectedTowerId;
  if (selectedId && (link.fromTowerId === selectedId || link.toTowerId === selectedId)) {
    return true;
  }
  return false;
}

function toScreenX(worldX: number, viewportTransform: OverlayViewportTransform): number {
  return (worldX + viewportTransform.offsetX) * viewportTransform.scale;
}

function toScreenY(worldY: number, viewportTransform: OverlayViewportTransform): number {
  return (worldY + viewportTransform.offsetY) * viewportTransform.scale;
}

function samplePointOnPolyline(points: ReadonlyArray<Vec2>, progress01: number): Vec2 | null {
  if (points.length === 0) {
    return null;
  }
  if (points.length === 1) {
    return points[0] ?? null;
  }
  const clamped = Math.max(0, Math.min(1, progress01));
  const totalLength = getPolylineLength(points);
  if (totalLength <= 0.001) {
    return points[0] ?? null;
  }
  const targetDistance = clamped * totalLength;
  let walkedDistance = 0;
  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    if (!start || !end) {
      continue;
    }
    const segDx = end.x - start.x;
    const segDy = end.y - start.y;
    const segLen = Math.hypot(segDx, segDy);
    if (segLen <= 0.001) {
      continue;
    }
    if (walkedDistance + segLen >= targetDistance) {
      const localT = (targetDistance - walkedDistance) / segLen;
      return {
        x: start.x + segDx * localT,
        y: start.y + segDy * localT,
      };
    }
    walkedDistance += segLen;
  }
  return points[points.length - 1] ?? null;
}

function samplePointAndDirectionOnPolyline(
  points: ReadonlyArray<Vec2>,
  progress01: number,
  outPoint: Vec2,
  outDirection: Vec2,
): boolean {
  if (points.length < 2) {
    return false;
  }
  const clamped = Math.max(0, Math.min(1, progress01));
  const totalLength = getPolylineLength(points);
  if (totalLength <= 0.001) {
    return false;
  }
  const targetDistance = clamped * totalLength;
  let walkedDistance = 0;
  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    if (!start || !end) {
      continue;
    }
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen <= 0.001) {
      continue;
    }
    if (walkedDistance + segLen >= targetDistance) {
      const localT = (targetDistance - walkedDistance) / segLen;
      outPoint.x = start.x + dx * localT;
      outPoint.y = start.y + dy * localT;
      outDirection.x = dx;
      outDirection.y = dy;
      return true;
    }
    walkedDistance += segLen;
  }
  const prev = points[points.length - 2];
  const last = points[points.length - 1];
  if (!prev || !last) {
    return false;
  }
  outPoint.x = last.x;
  outPoint.y = last.y;
  outDirection.x = last.x - prev.x;
  outDirection.y = last.y - prev.y;
  return true;
}

function getPolylineLength(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    if (!from || !to) {
      continue;
    }
    total += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return total;
}

function angleFromId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  const normalized = (hash >>> 0) / 4294967295;
  return normalized * Math.PI * 2;
}
