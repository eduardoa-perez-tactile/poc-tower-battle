import type {
  DragCandidateOverlay,
  DragPreview,
  LinkCandidateState,
  PointerHint,
} from "../../input/InputController";
import type { GridRenderData } from "../../levels/runtime";
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

export interface MapOverlayIsoContext {
  mapRenderData: GridRenderData | null;
  terrainTileSize: number | null;
}

// Tower-plate tuning constants (kept local for quick visual iteration).
const ISO_TILE_HEIGHT_RATIO = 0.5;
const PLATE_W_MUL = 0.95;
const PLATE_H_MUL = 0.95;
const PLATE_INSET_MUL = 0.8;
const PLATE_Y_OFFSET = 0.1;
const PLATE_BASE_ALPHA = 0.3;
const PLATE_INSET_ALPHA = 0.24;
const BADGE_OFFSET_X = -0.46;
const BADGE_OFFSET_Y = -0.57;
const REGEN_OFFSET_X = -0.43;
const REGEN_OFFSET_Y = -0.12;
const STATUS_OFFSET_Y = 0.9;
const TOWER_ID_OFFSET_Y = -0.92;
const SELECTION_EXPAND = 5;
const CANDIDATE_VALID_EXPAND = 4;
const CANDIDATE_INVALID_EXPAND = 3;
const PIP_EDGE_INSET = 0.16;
const PIP_RADIUS = 2.8;
const PIP_SPACING = 1;
const PIP_MAX_VISIBLE = 8;
const BREACH_CORNER_SLASH = 8;
const BREACH_CORNER_INSET = 5;

export class MapOverlay {
  private readonly towerById: Map<string, Tower>;
  private readonly outgoingLinkCountByTowerId: Map<string, number>;
  private readonly badgeAngleByTowerId: Map<string, number>;
  private readonly textWidthCache: Map<string, number>;
  private readonly tmpPoint: Vec2;
  private readonly tmpDir: Vec2;
  private readonly dynamicDash: [number, number];
  private readonly isoPlateStyleScratch: IsoPlateStyle;
  private readonly badgeFont: string;
  private readonly badgeSubFont: string;
  private readonly legendFont: string;
  private readonly linkLevelFont: string;
  private readonly pointerHintFont: string;

  constructor() {
    this.towerById = new Map<string, Tower>();
    this.outgoingLinkCountByTowerId = new Map<string, number>();
    this.badgeAngleByTowerId = new Map<string, number>();
    this.textWidthCache = new Map<string, number>();
    this.tmpPoint = { x: 0, y: 0 };
    this.tmpDir = { x: 1, y: 0 };
    this.dynamicDash = [1, 1];
    this.isoPlateStyleScratch = {
      fillColor: "",
      fillAlpha: 0,
      insetColor: "",
      insetAlpha: 0,
      outlineColor: "",
      outlineWidth: 0,
      glowColor: "",
      glowWidth: 0,
      dashed: false,
      insetScale: PLATE_INSET_MUL,
    };
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
    const isoContext: MapOverlayIsoContext = {
      mapRenderData: null,
      terrainTileSize: null,
    };
    this.drawTowerUnderlay(ctx, overlayState, viewportTransform, isoContext);
    this.drawForeground(ctx, overlayState, viewportTransform, isoContext);
  }

  drawTowerUnderlay(
    ctx: CanvasRenderingContext2D,
    overlayState: MapOverlayDrawState,
    viewportTransform: OverlayViewportTransform,
    isoContext: MapOverlayIsoContext,
  ): void {
    this.prepareTowerLookup(overlayState.world);
    const tile = getIsoTileSize(
      isoContext.mapRenderData,
      isoContext.terrainTileSize,
      viewportTransform.scale,
    );
    const plateW = tile.tileW * PLATE_W_MUL;
    const plateH = tile.tileH * PLATE_H_MUL;
    const interaction = overlayState.interaction;

    for (const tower of overlayState.world.towers) {
      if (!Number.isFinite(tower.x) || !Number.isFinite(tower.y)) {
        continue;
      }
      const sx = toScreenX(tower.x, viewportTransform);
      const sy = toScreenY(tower.y, viewportTransform);
      const plateX = sx;
      const plateY = sy + tile.tileH * PLATE_Y_OFFSET;
      const hovered = interaction.hoveredTowerId === tower.id;
      const selected = interaction.selectedTowerId === tower.id;
      const isDragSource = interaction.dragSourceId === tower.id && interaction.isDraggingLink;

      this.drawTowerPlateUnderlay(
        ctx,
        tower,
        plateX,
        plateY,
        plateW,
        plateH,
        hovered,
        selected || isDragSource,
      );
      this.drawTowerControlEdgeOverlay(ctx, tower, plateX, plateY, plateW, plateH, overlayState.timeSec);
    }
  }

  drawForeground(
    ctx: CanvasRenderingContext2D,
    overlayState: MapOverlayDrawState,
    viewportTransform: OverlayViewportTransform,
    isoContext: MapOverlayIsoContext,
  ): void {
    this.prepareTowerLookup(overlayState.world);
    this.drawLinks(ctx, overlayState, viewportTransform);
    this.drawTowerForeground(ctx, overlayState, viewportTransform, isoContext);
    this.drawSuggestedLink(ctx, overlayState, viewportTransform);
    this.drawPreviewLink(ctx, overlayState.interaction.preview, viewportTransform);
    this.drawPointerHint(ctx, overlayState.interaction.pointerHint, viewportTransform);
    if (overlayState.showLegend) {
      this.drawLegend(ctx, viewportTransform);
    }
  }

  private prepareTowerLookup(world: World): void {
    this.towerById.clear();
    this.outgoingLinkCountByTowerId.clear();
    for (const tower of world.towers) {
      this.towerById.set(tower.id, tower);
      this.outgoingLinkCountByTowerId.set(tower.id, 0);
      if (!this.badgeAngleByTowerId.has(tower.id)) {
        this.badgeAngleByTowerId.set(tower.id, angleFromId(tower.id));
      }
    }
    for (const link of world.links) {
      if (link.isScripted) {
        continue;
      }
      const previous = this.outgoingLinkCountByTowerId.get(link.fromTowerId);
      if (previous === undefined) {
        continue;
      }
      this.outgoingLinkCountByTowerId.set(link.fromTowerId, previous + 1);
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

  private drawTowerForeground(
    ctx: CanvasRenderingContext2D,
    overlayState: MapOverlayDrawState,
    viewportTransform: OverlayViewportTransform,
    isoContext: MapOverlayIsoContext,
  ): void {
    const tile = getIsoTileSize(
      isoContext.mapRenderData,
      isoContext.terrainTileSize,
      viewportTransform.scale,
    );
    const plateW = tile.tileW * PLATE_W_MUL;
    const plateH = tile.tileH * PLATE_H_MUL;
    const interaction = overlayState.interaction;
    const candidateMap = interaction.dragOverlay?.candidateStateByTowerId ?? null;
    for (const tower of overlayState.world.towers) {
      if (!Number.isFinite(tower.x) || !Number.isFinite(tower.y)) {
        continue;
      }
      const sx = toScreenX(tower.x, viewportTransform);
      const sy = toScreenY(tower.y, viewportTransform);
      const plateX = sx;
      const plateY = sy + tile.tileH * PLATE_Y_OFFSET;
      const hovered = interaction.hoveredTowerId === tower.id;
      const selected = interaction.selectedTowerId === tower.id;
      const isDragSource = interaction.dragSourceId === tower.id && interaction.isDraggingLink;
      const candidateState = candidateMap?.[tower.id] ?? null;
      this.drawTowerAffordanceOverlays(
        ctx,
        plateX,
        plateY,
        plateW,
        plateH,
        hovered,
        selected || isDragSource,
        candidateState,
        overlayState.timeSec,
      );

      const maxLinks = overlayState.world.getMaxOutgoingLinksForTower(tower.id);
      const activeLinks = this.outgoingLinkCountByTowerId.get(tower.id) ?? 0;
      drawLinkPips(
        ctx,
        plateX,
        plateY,
        plateW,
        plateH,
        maxLinks,
        activeLinks,
        OVERLAY_THEME.ownerColors[tower.owner].ring,
      );
      this.drawTowerBadge(ctx, tower, plateX, plateY, plateW, plateH, viewportTransform.scale);
      this.drawTowerStatusLabel(ctx, tower, plateX, plateY, plateH);

      if (overlayState.showDebugIds) {
        this.drawTowerIdLabel(ctx, tower.id, plateX, plateY, plateH);
      }
    }
  }

  private drawTowerPlateUnderlay(
    ctx: CanvasRenderingContext2D,
    tower: Tower,
    plateX: number,
    plateY: number,
    plateW: number,
    plateH: number,
    hovered: boolean,
    selected: boolean,
  ): void {
    const ownerColors = OVERLAY_THEME.ownerColors[tower.owner];
    const outlineWidth =
      OVERLAY_THEME.ring.baseWidthPx +
      (hovered ? OVERLAY_THEME.ring.hoverExtraWidthPx : 0) +
      (selected ? OVERLAY_THEME.ring.selectedExtraWidthPx : 0);
    const style = this.isoPlateStyleScratch;
    style.fillColor = ownerColors.ring;
    style.fillAlpha = PLATE_BASE_ALPHA + (hovered ? 0.06 : 0);
    style.insetColor = ownerColors.glow;
    style.insetAlpha = PLATE_INSET_ALPHA + (selected ? 0.1 : 0);
    style.outlineColor = ownerColors.ring;
    style.outlineWidth = outlineWidth;
    style.glowColor = ownerColors.glow;
    style.glowWidth = OVERLAY_THEME.ring.glowWidthPx * (selected ? 1.3 : 1);
    style.dashed = tower.owner === "neutral";
    style.insetScale = PLATE_INSET_MUL;
    drawIsoPlate(ctx, plateX, plateY, plateW, plateH, style);
  }

  private drawTowerControlEdgeOverlay(
    ctx: CanvasRenderingContext2D,
    tower: Tower,
    plateX: number,
    plateY: number,
    plateW: number,
    plateH: number,
    timeSec: number,
  ): void {
    const phase = getTowerControlPhase(tower);
    if (phase === "stable") {
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * Math.PI * 2 * OVERLAY_THEME.animation.pulseHz);
    const hp01 = clamp01(sanitizeNumber(tower.hp) / Math.max(1, sanitizeNumber(tower.maxHp)));
    const progress01 = phase === "breaching" ? clamp01(1 - hp01) : 0.22 + pulse * 0.18;
    const perimeter = getIsoPerimeterLength(plateW + 2, plateH + 2);

    ctx.save();
    this.dynamicDash[0] = Math.max(8, perimeter * progress01);
    this.dynamicDash[1] = Math.max(10, perimeter);
    ctx.setLineDash(this.dynamicDash);
    ctx.lineDashOffset = -timeSec * OVERLAY_THEME.animation.contestedDashSpeed * 24;
    drawIsoSelection(
      ctx,
      plateX,
      plateY,
      plateW + 2,
      plateH + 2,
      phase === "breaching" ? "rgba(255, 178, 122, 0.92)" : "rgba(255, 226, 170, 0.85)",
      2.2 + pulse * 0.8,
    );
    ctx.setLineDash([]);
    if (phase === "breaching") {
      this.drawBreachCornerSlashes(ctx, plateX, plateY, plateW, plateH);
    }
    ctx.restore();
  }

  private drawBreachCornerSlashes(
    ctx: CanvasRenderingContext2D,
    plateX: number,
    plateY: number,
    plateW: number,
    plateH: number,
  ): void {
    const topX = plateX;
    const topY = plateY - plateH * 0.5;
    const rightX = plateX + plateW * 0.5;
    const rightY = plateY;
    const bottomX = plateX;
    const bottomY = plateY + plateH * 0.5;
    const leftX = plateX - plateW * 0.5;
    const leftY = plateY;

    ctx.strokeStyle = "rgba(255, 166, 106, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(topX + BREACH_CORNER_INSET, topY + BREACH_CORNER_INSET);
    ctx.lineTo(
      topX + BREACH_CORNER_INSET + BREACH_CORNER_SLASH,
      topY + BREACH_CORNER_INSET + BREACH_CORNER_SLASH * 0.5,
    );
    ctx.moveTo(rightX - BREACH_CORNER_INSET, rightY + BREACH_CORNER_INSET);
    ctx.lineTo(
      rightX - BREACH_CORNER_INSET - BREACH_CORNER_SLASH * 0.5,
      rightY + BREACH_CORNER_INSET + BREACH_CORNER_SLASH,
    );
    ctx.moveTo(bottomX - BREACH_CORNER_INSET, bottomY - BREACH_CORNER_INSET);
    ctx.lineTo(
      bottomX - BREACH_CORNER_INSET - BREACH_CORNER_SLASH,
      bottomY - BREACH_CORNER_INSET - BREACH_CORNER_SLASH * 0.5,
    );
    ctx.moveTo(leftX + BREACH_CORNER_INSET, leftY - BREACH_CORNER_INSET);
    ctx.lineTo(
      leftX + BREACH_CORNER_INSET + BREACH_CORNER_SLASH * 0.5,
      leftY - BREACH_CORNER_INSET - BREACH_CORNER_SLASH,
    );
    ctx.stroke();
  }

  private drawTowerAffordanceOverlays(
    ctx: CanvasRenderingContext2D,
    plateX: number,
    plateY: number,
    plateW: number,
    plateH: number,
    hovered: boolean,
    selected: boolean,
    candidateState: LinkCandidateState | null,
    timeSec: number,
  ): void {
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * Math.PI * 2 * OVERLAY_THEME.animation.pulseHz);
    if (hovered || selected) {
      drawIsoSelection(
        ctx,
        plateX,
        plateY,
        plateW + SELECTION_EXPAND,
        plateH + SELECTION_EXPAND,
        "rgba(235, 247, 255, 0.85)",
        selected ? 2.8 : 2.1,
      );
    }

    if (candidateState === "valid") {
      drawIsoSelection(
        ctx,
        plateX,
        plateY,
        plateW + CANDIDATE_VALID_EXPAND,
        plateH + CANDIDATE_VALID_EXPAND,
        OVERLAY_THEME.affordance.validRingColor,
        2.8 + pulse * 1.2,
      );
      return;
    }

    if (candidateState === "invalid") {
      ctx.save();
      this.dynamicDash[0] = 6;
      this.dynamicDash[1] = 4;
      ctx.setLineDash(this.dynamicDash);
      drawIsoSelection(
        ctx,
        plateX,
        plateY,
        plateW + CANDIDATE_INVALID_EXPAND,
        plateH + CANDIDATE_INVALID_EXPAND,
        OVERLAY_THEME.affordance.invalidRingColor,
        2.3,
      );
      ctx.setLineDash([]);
      ctx.strokeStyle = OVERLAY_THEME.affordance.invalidCrossColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(plateX - 8, plateY - 8);
      ctx.lineTo(plateX + 8, plateY + 8);
      ctx.moveTo(plateX + 8, plateY - 8);
      ctx.lineTo(plateX - 8, plateY + 8);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawTowerBadge(
    ctx: CanvasRenderingContext2D,
    tower: Tower,
    plateX: number,
    plateY: number,
    plateW: number,
    plateH: number,
    scale: number,
  ): void {
    const ownerColors = OVERLAY_THEME.ownerColors[tower.owner];
    const angle = this.badgeAngleByTowerId.get(tower.id) ?? 0;
    const jitterRadius = OVERLAY_THEME.badge.jitterRadiusPx * scale;
    const jitterX = Math.cos(angle) * jitterRadius;
    const jitterY = Math.sin(angle) * jitterRadius * 0.6;
    const anchorX = plateX + plateW * BADGE_OFFSET_X + jitterX;
    const anchorY = plateY + plateH * BADGE_OFFSET_Y + jitterY;

    const troopValue = Number.isFinite(tower.troops) ? tower.troops : 0;
    const countText = formatCompactCount(troopValue);
    const regenValue = Number.isFinite(tower.effectiveRegen) ? tower.effectiveRegen : tower.regenRate;
    const regenText = tower.owner === "player" ? formatRegenPerSec(regenValue) : "";

    ctx.save();
    ctx.font = this.badgeFont;
    const countWidth = this.measureTextCached(ctx, countText, this.badgeFont);
    const width = countWidth + OVERLAY_THEME.badge.paddingXPx * 2;
    const height = OVERLAY_THEME.badge.fontSizePx + OVERLAY_THEME.badge.paddingYPx * 2;
    this.drawRoundedRect(ctx, anchorX, anchorY, width, height, OVERLAY_THEME.badge.cornerRadiusPx);
    ctx.fillStyle = ownerColors.badgeFill;
    ctx.fill();
    ctx.strokeStyle = OVERLAY_THEME.badge.outlineColor;
    ctx.lineWidth = OVERLAY_THEME.badge.outlineWidthPx;
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = ownerColors.badgeText;
    ctx.font = this.badgeFont;
    ctx.fillText(countText, anchorX + OVERLAY_THEME.badge.paddingXPx, anchorY + height / 2 + 0.25);

    if (regenText) {
      ctx.font = this.badgeSubFont;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      const regenX = plateX + plateW * REGEN_OFFSET_X;
      const regenY = plateY + plateH * REGEN_OFFSET_Y;
      const regenWidth = this.measureTextCached(ctx, regenText, this.badgeSubFont);
      this.drawRoundedRect(ctx, regenX - 4, regenY - 11, regenWidth + 8, 14, 5);
      ctx.fillStyle = "rgba(3, 8, 13, 0.62)";
      ctx.fill();
      ctx.fillStyle = OVERLAY_THEME.badge.regenTextColor;
      ctx.fillText(regenText, regenX, regenY);
    }
    ctx.restore();
  }

  private drawTowerStatusLabel(
    ctx: CanvasRenderingContext2D,
    tower: Tower,
    plateX: number,
    plateY: number,
    plateH: number,
  ): void {
    const phase = getTowerControlPhase(tower);
    if (phase === "stable") {
      return;
    }
    const text = phase === "breaching" ? "BREACHING" : "CONTESTED";
    const y = plateY + plateH * STATUS_OFFSET_Y;
    const font = "700 10px Arial, sans-serif";
    ctx.save();
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const width = this.measureTextCached(ctx, text, font);
    this.drawRoundedRect(ctx, plateX - width * 0.5 - 6, y - 11, width + 12, 14, 6);
    ctx.fillStyle = "rgba(3, 8, 13, 0.64)";
    ctx.fill();
    ctx.fillStyle = phase === "breaching" ? "#ffc78a" : "#ffe6b2";
    ctx.fillText(text, plateX, y);
    ctx.restore();
  }

  private drawTowerIdLabel(
    ctx: CanvasRenderingContext2D,
    towerId: string,
    plateX: number,
    plateY: number,
    plateH: number,
  ): void {
    ctx.save();
    ctx.font = "600 10px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const textWidth = this.measureTextCached(ctx, towerId, ctx.font);
    const bgWidth = textWidth + 8;
    const x = plateX - bgWidth / 2;
    const y = plateY + plateH * TOWER_ID_OFFSET_Y - 18;
    this.drawRoundedRect(ctx, x, y, bgWidth, 12, 4);
    ctx.fillStyle = "rgba(2, 5, 9, 0.64)";
    ctx.fill();
    ctx.fillStyle = "rgba(222, 228, 236, 0.96)";
    ctx.fillText(towerId, plateX, y + 10);
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
    this.drawLegendDashed(ctx, x + 10, y + 64, OVERLAY_THEME.ownerColors.neutral.ring, "Neutral plate");

    ctx.fillStyle = OVERLAY_THEME.legend.textColor;
    ctx.fillText("Edge pulse = contested", x + 10, y + 88);
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

interface IsoPlateStyle {
  fillColor: string;
  fillAlpha: number;
  insetColor: string;
  insetAlpha: number;
  outlineColor: string;
  outlineWidth: number;
  glowColor: string;
  glowWidth: number;
  dashed: boolean;
  insetScale: number;
}

function getIsoTileSize(
  mapRenderData: GridRenderData | null,
  terrainTileSize: number | null,
  scale: number,
): { tileW: number; tileH: number } {
  const baseTile = Math.max(1, mapRenderData?.cellSize ?? terrainTileSize ?? TOWER_RADIUS_PX * 2.1);
  const tileW = Math.max(TOWER_RADIUS_PX * 1.7, baseTile * Math.max(0.2, scale));
  return {
    tileW,
    tileH: tileW * ISO_TILE_HEIGHT_RATIO,
  };
}

function drawIsoPlate(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  style: IsoPlateStyle,
): void {
  ctx.save();
  if (style.glowWidth > 0.01) {
    traceDiamond(ctx, cx, cy, w, h);
    ctx.strokeStyle = style.glowColor;
    ctx.lineWidth = style.outlineWidth + style.glowWidth;
    ctx.stroke();
  }

  traceDiamond(ctx, cx, cy, w, h);
  ctx.globalAlpha = clamp01(style.fillAlpha);
  ctx.fillStyle = style.fillColor;
  ctx.fill();
  ctx.globalAlpha = 1;

  const insetScale = clamp(style.insetScale, 0.4, 0.95);
  const insetW = w * insetScale;
  const insetH = h * insetScale;
  traceDiamond(ctx, cx, cy, insetW, insetH);
  ctx.globalAlpha = clamp01(style.insetAlpha);
  ctx.fillStyle = style.insetColor;
  ctx.fill();
  ctx.globalAlpha = 1;

  traceDiamond(ctx, cx, cy, w, h);
  ctx.strokeStyle = style.outlineColor;
  ctx.lineWidth = style.outlineWidth;
  if (style.dashed) {
    ctx.setLineDash(OVERLAY_THEME.ring.neutralDash);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawIsoSelection(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  color: string,
  width: number,
): void {
  ctx.save();
  traceDiamond(ctx, cx, cy, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

function drawLinkPips(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  plateW: number,
  plateH: number,
  maxLinks: number,
  activeLinks: number,
  tint: string,
): void {
  const safeMax = clamp(Math.floor(maxLinks), 0, 64);
  if (safeMax <= 0) {
    return;
  }
  const visible = clamp(safeMax, 1, PIP_MAX_VISIBLE);
  const topX = cx;
  const topY = cy - plateH * 0.5;
  const rightX = cx + plateW * 0.5;
  const rightY = cy;
  const activeVisible = clamp(Math.round((activeLinks / safeMax) * visible), 0, visible);
  const spacingMul = (1 - PIP_EDGE_INSET * 2) / Math.max(1, visible - 1);

  ctx.save();
  for (let i = 0; i < visible; i += 1) {
    const t = clamp(PIP_EDGE_INSET + i * spacingMul * PIP_SPACING, 0.06, 0.94);
    const px = topX + (rightX - topX) * t;
    const py = topY + (rightY - topY) * t;
    ctx.beginPath();
    ctx.arc(px, py, PIP_RADIUS, 0, Math.PI * 2);
    if (i < activeVisible) {
      ctx.fillStyle = tint;
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(10, 14, 19, 0.55)";
      ctx.fill();
      ctx.strokeStyle = "rgba(232, 240, 248, 0.58)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function traceDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
): void {
  const halfW = w * 0.5;
  const halfH = h * 0.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - halfH);
  ctx.lineTo(cx + halfW, cy);
  ctx.lineTo(cx, cy + halfH);
  ctx.lineTo(cx - halfW, cy);
  ctx.closePath();
}

function getIsoPerimeterLength(w: number, h: number): number {
  const edge = Math.hypot(w * 0.5, h * 0.5);
  return edge * 4;
}

function getTowerControlPhase(tower: Tower): "stable" | "contested" | "breaching" {
  const defendersBroken = sanitizeNumber(tower.troops) <= 0.001;
  const hp01 = clamp01(sanitizeNumber(tower.hp) / Math.max(1, sanitizeNumber(tower.maxHp)));
  const damaged = hp01 < 0.999;
  if (defendersBroken && damaged) {
    return "breaching";
  }
  if (damaged) {
    return "contested";
  }
  return "stable";
}

function sanitizeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
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
