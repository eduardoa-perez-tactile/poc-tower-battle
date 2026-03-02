import type { SpriteAtlas } from "../../../render/SpriteAtlas";
import type { TowerDefinition } from "../types/towerDictionary";

export interface SpritePreviewRenderStatus {
  error: string | null;
  frameCount: number | null;
}

export interface SpritePreviewController {
  root: HTMLDivElement;
  update: (atlas: SpriteAtlas | null, tower: TowerDefinition | null) => SpritePreviewRenderStatus;
}

export function createSpritePreview(): SpritePreviewController {
  const root = document.createElement("div");
  root.style.display = "grid";
  root.style.gap = "8px";
  root.style.border = "1px solid rgba(117, 157, 220, 0.24)";
  root.style.borderRadius = "8px";
  root.style.padding = "8px";
  root.style.background = "rgba(8, 16, 28, 0.54)";

  const title = document.createElement("p");
  title.className = "campaign-progress-title";
  title.textContent = "Art Preview";
  title.style.margin = "0";

  const canvasRow = document.createElement("div");
  canvasRow.style.display = "grid";
  canvasRow.style.gridTemplateColumns = "repeat(2, minmax(120px, 1fr))";
  canvasRow.style.gap = "8px";

  const canvas1x = createCanvas(140, 140, "1x");
  const canvas2x = createCanvas(220, 140, "2x");
  canvasRow.append(canvas1x.wrap, canvas2x.wrap);

  const meta = document.createElement("p");
  meta.className = "campaign-progress-subtitle";
  meta.style.margin = "0";

  const error = document.createElement("p");
  error.className = "campaign-progress-subtitle";
  error.style.margin = "0";
  error.style.color = "#ffb0b0";
  error.style.display = "none";

  root.append(title, canvasRow, meta, error);

  return {
    root,
    update(atlas: SpriteAtlas | null, tower: TowerDefinition | null): SpritePreviewRenderStatus {
      clearCanvas(canvas1x.canvas, "#111f35");
      clearCanvas(canvas2x.canvas, "#111f35");

      if (!tower) {
        meta.textContent = "Select a tower.";
        error.style.display = "none";
        return { error: null, frameCount: null };
      }

      meta.textContent = `atlas: ${tower.art.atlasId} • sprite: ${tower.art.spriteKey} • frame: ${tower.art.frameIndex}`;

      if (!atlas) {
        drawPlaceholder(canvas1x.canvas, "Loading atlas");
        drawPlaceholder(canvas2x.canvas, "Loading atlas");
        error.style.display = "none";
        return { error: null, frameCount: null };
      }

      if (tower.art.atlasId !== "buildings") {
        const message = `Unsupported atlasId \"${tower.art.atlasId}\". Expected \"buildings\".`;
        showError(error, message);
        drawPlaceholder(canvas1x.canvas, "Bad atlas");
        drawPlaceholder(canvas2x.canvas, "Bad atlas");
        return { error: message, frameCount: null };
      }

      const frameCount = atlas.getBuildingFrameCount(tower.art.spriteKey);
      if (frameCount === null) {
        const message = `Sprite \"${tower.art.spriteKey}\" is not registered.`;
        showError(error, message);
        drawPlaceholder(canvas1x.canvas, "Missing sprite");
        drawPlaceholder(canvas2x.canvas, "Missing sprite");
        return { error: message, frameCount: null };
      }

      const clampedFrame = Math.max(0, Math.min(frameCount - 1, Math.floor(tower.art.frameIndex)));
      const baseScale = tower.art.scale ?? 1;
      const drawn1x = drawTower(
        canvas1x.canvas,
        atlas,
        tower.art.spriteKey,
        clampedFrame,
        baseScale,
        tower.art.offsetX ?? 0,
        tower.art.offsetY ?? 0,
      );
      const drawn2x = drawTower(
        canvas2x.canvas,
        atlas,
        tower.art.spriteKey,
        clampedFrame,
        baseScale * 2,
        tower.art.offsetX ?? 0,
        tower.art.offsetY ?? 0,
      );

      if (!drawn1x || !drawn2x) {
        const message = "Failed to draw sprite preview.";
        showError(error, message);
        return { error: message, frameCount };
      }

      error.style.display = "none";
      return { error: null, frameCount };
    },
  };
}

function createCanvas(width: number, height: number, label: string): { wrap: HTMLDivElement; canvas: HTMLCanvasElement } {
  const wrap = document.createElement("div");
  wrap.style.display = "grid";
  wrap.style.gap = "4px";

  const text = document.createElement("span");
  text.textContent = label;
  text.style.fontSize = "11px";
  text.style.color = "#8fb4e2";

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  canvas.style.border = "1px solid rgba(117, 157, 220, 0.28)";
  canvas.style.borderRadius = "8px";

  wrap.append(text, canvas);
  return { wrap, canvas };
}

function clearCanvas(canvas: HTMLCanvasElement, color: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawTower(
  canvas: HTMLCanvasElement,
  atlas: SpriteAtlas,
  spriteKey: string,
  frameIndex: number,
  scale: number,
  offsetX: number,
  offsetY: number,
): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return false;
  }

  return atlas.drawBuildingFrame(ctx, {
    spriteKey,
    frameIndex,
    worldX: Math.floor(canvas.width / 2),
    worldY: Math.floor(canvas.height * 0.8),
    scale,
    offsetX,
    offsetY,
  });
}

function drawPlaceholder(canvas: HTMLCanvasElement, label: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.fillStyle = "rgba(25, 41, 66, 0.9)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(148, 179, 222, 0.45)";
  ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
  ctx.fillStyle = "#9ebde5";
  ctx.font = "12px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);
}

function showError(errorEl: HTMLParagraphElement, message: string): void {
  errorEl.textContent = message;
  errorEl.style.display = "block";
}
