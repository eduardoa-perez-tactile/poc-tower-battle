import type { TerrainData } from "../types/Terrain";
import { toPublicPath } from "../utils/publicPath";

export interface SpriteTilesheetMeta {
  image: string;
  tileW: number;
  tileH: number;
  cols: number;
  rows: number;
}

export interface SpriteBuildingMeta {
  image: string;
  frameW: number;
  frameH: number;
  anchorX: number;
  anchorY: number;
}

export interface SpriteCatalog {
  tileSize: number;
  tilesheet: SpriteTilesheetMeta;
  buildings: Record<string, SpriteBuildingMeta>;
}

export interface DrawTileParams {
  tileIndex: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export interface DrawBuildingFrameParams {
  spriteKey: string;
  frameIndex: number;
  worldX: number;
  worldY: number;
  offsetX?: number;
  offsetY?: number;
  scale?: number;
  tintColor?: string;
  tintStrength?: number;
}

export async function loadSpriteCatalog(path = "/data/art/sprites.json"): Promise<SpriteCatalog> {
  const response = await fetch(toPublicPath(path));
  if (!response.ok) {
    throw new Error(`Failed to load sprite catalog (${response.status} ${response.statusText})`);
  }
  const parsed = (await response.json()) as unknown;
  return parseSpriteCatalog(parsed, path);
}

export class SpriteAtlas {
  private catalog: SpriteCatalog | null;
  private readonly imageByPath: Map<string, HTMLImageElement>;
  private readonly frameCountBySpriteKey: Map<string, number>;
  private readonly tintedFrameCache: Map<string, HTMLCanvasElement>;
  private loadPromise: Promise<void> | null;

  constructor() {
    this.catalog = null;
    this.imageByPath = new Map<string, HTMLImageElement>();
    this.frameCountBySpriteKey = new Map<string, number>();
    this.tintedFrameCache = new Map<string, HTMLCanvasElement>();
    this.loadPromise = null;
  }

  async ensureLoaded(): Promise<void> {
    if (this.catalog) {
      return;
    }
    if (!this.loadPromise) {
      this.loadPromise = this.loadInternal();
    }
    await this.loadPromise;
  }

  isReady(): boolean {
    return this.catalog !== null;
  }

  getCatalog(): SpriteCatalog | null {
    return this.catalog;
  }

  getBuildingKeys(): string[] {
    return Object.keys(this.catalog?.buildings ?? {}).sort((left, right) => left.localeCompare(right));
  }

  getBuildingFrameCount(spriteKey: string): number | null {
    const known = this.frameCountBySpriteKey.get(spriteKey);
    if (typeof known === "number") {
      return known;
    }
    return null;
  }

  drawTile(ctx: CanvasRenderingContext2D, params: DrawTileParams): boolean {
    if (!this.catalog) {
      return false;
    }
    const tileSheet = this.catalog.tilesheet;
    if (params.tileIndex < 0) {
      return false;
    }
    const maxTiles = tileSheet.cols * tileSheet.rows;
    if (params.tileIndex >= maxTiles) {
      return false;
    }

    const image = this.imageByPath.get(tileSheet.image);
    if (!image) {
      return false;
    }

    const sx = (params.tileIndex % tileSheet.cols) * tileSheet.tileW;
    const sy = Math.floor(params.tileIndex / tileSheet.cols) * tileSheet.tileH;

    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      image,
      sx,
      sy,
      tileSheet.tileW,
      tileSheet.tileH,
      params.dx,
      params.dy,
      params.dw,
      params.dh,
    );
    ctx.imageSmoothingEnabled = previousSmoothing;
    return true;
  }

  drawBuildingFrame(ctx: CanvasRenderingContext2D, params: DrawBuildingFrameParams): boolean {
    if (!this.catalog) {
      return false;
    }

    const meta = this.catalog.buildings[params.spriteKey];
    if (!meta) {
      return false;
    }
    const image = this.imageByPath.get(meta.image);
    if (!image) {
      return false;
    }

    const frameCount = this.resolveFrameCount(params.spriteKey, meta, image);
    if (frameCount <= 0) {
      return false;
    }

    const clampedFrame = clampInt(params.frameIndex, 0, frameCount - 1);
    const sy = clampedFrame * meta.frameH;
    const scale = Math.max(0.05, params.scale ?? 1);
    const offsetX = params.offsetX ?? 0;
    const offsetY = params.offsetY ?? 0;

    const drawW = meta.frameW * scale;
    const drawH = meta.frameH * scale;
    const drawX = params.worldX - meta.anchorX * scale + offsetX;
    const drawY = params.worldY - meta.anchorY * scale + offsetY;
    const tintColor = normalizeHexColor(params.tintColor);
    const tintStrength = clamp01(params.tintStrength ?? 0);

    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    if (tintColor && tintStrength > 0) {
      const tintedFrame = this.getTintedFrame({
        spriteKey: params.spriteKey,
        frameIndex: clampedFrame,
        tintColor,
        tintStrength,
        image,
        frameW: meta.frameW,
        frameH: meta.frameH,
      });
      if (tintedFrame) {
        ctx.drawImage(
          tintedFrame,
          0,
          0,
          meta.frameW,
          meta.frameH,
          drawX,
          drawY,
          drawW,
          drawH,
        );
      } else {
        ctx.drawImage(
          image,
          0,
          sy,
          meta.frameW,
          meta.frameH,
          drawX,
          drawY,
          drawW,
          drawH,
        );
      }
    } else {
      ctx.drawImage(
        image,
        0,
        sy,
        meta.frameW,
        meta.frameH,
        drawX,
        drawY,
        drawW,
        drawH,
      );
    }
    ctx.imageSmoothingEnabled = previousSmoothing;
    return true;
  }

  createTerrainDraftFromCatalog(width: number, height: number): TerrainData {
    const tileSize = this.catalog?.tileSize ?? 32;
    const total = Math.max(1, Math.floor(width)) * Math.max(1, Math.floor(height));
    const empty = new Array<number>(total).fill(-1);
    return {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
      tileSize,
      originX: 0,
      originY: 0,
      layers: {
        ground: empty.slice(),
        deco: empty.slice(),
      },
    };
  }

  private async loadInternal(): Promise<void> {
    const catalog = await loadSpriteCatalog();

    const imagePaths = new Set<string>();
    imagePaths.add(catalog.tilesheet.image);
    for (const building of Object.values(catalog.buildings)) {
      imagePaths.add(building.image);
    }

    const loadedEntries = await Promise.all(
      Array.from(imagePaths).map(async (path) => [path, await loadImage(toPublicPath(path))] as const),
    );

    this.catalog = catalog;
    this.imageByPath.clear();
    for (const [path, image] of loadedEntries) {
      this.imageByPath.set(path, image);
    }

    this.frameCountBySpriteKey.clear();
    this.tintedFrameCache.clear();
    for (const [spriteKey, meta] of Object.entries(catalog.buildings)) {
      const image = this.imageByPath.get(meta.image);
      if (!image) {
        continue;
      }
      this.resolveFrameCount(spriteKey, meta, image);
    }
  }

  private resolveFrameCount(
    spriteKey: string,
    meta: SpriteBuildingMeta,
    image: HTMLImageElement,
  ): number {
    const cached = this.frameCountBySpriteKey.get(spriteKey);
    if (typeof cached === "number") {
      return cached;
    }

    const raw = image.naturalHeight / Math.max(1, meta.frameH);
    const frameCount = Math.max(1, Math.floor(raw));
    this.frameCountBySpriteKey.set(spriteKey, frameCount);
    return frameCount;
  }

  private getTintedFrame(input: {
    spriteKey: string;
    frameIndex: number;
    tintColor: string;
    tintStrength: number;
    image: HTMLImageElement;
    frameW: number;
    frameH: number;
  }): HTMLCanvasElement | null {
    const cacheKey = [
      input.spriteKey,
      input.frameIndex,
      input.tintColor,
      Math.round(input.tintStrength * 1000),
    ].join(":");
    const cached = this.tintedFrameCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const canvas = document.createElement("canvas");
    canvas.width = input.frameW;
    canvas.height = input.frameH;
    const tintCtx = canvas.getContext("2d");
    if (!tintCtx) {
      return null;
    }

    const sy = input.frameIndex * input.frameH;
    tintCtx.imageSmoothingEnabled = false;
    tintCtx.drawImage(
      input.image,
      0,
      sy,
      input.frameW,
      input.frameH,
      0,
      0,
      input.frameW,
      input.frameH,
    );
    tintCtx.globalCompositeOperation = "source-atop";
    tintCtx.globalAlpha = input.tintStrength;
    tintCtx.fillStyle = input.tintColor;
    tintCtx.fillRect(0, 0, input.frameW, input.frameH);
    tintCtx.globalAlpha = 1;
    tintCtx.globalCompositeOperation = "source-over";

    this.tintedFrameCache.set(cacheKey, canvas);
    if (this.tintedFrameCache.size > 2048) {
      this.tintedFrameCache.clear();
      this.tintedFrameCache.set(cacheKey, canvas);
    }
    return canvas;
  }
}

function parseSpriteCatalog(value: unknown, sourceLabel: string): SpriteCatalog {
  if (!isObject(value)) {
    throw new Error(`${sourceLabel}: catalog must be an object`);
  }
  const tileSize = asInt(value.tileSize, `${sourceLabel}.tileSize`);
  if (!isObject(value.tilesheet)) {
    throw new Error(`${sourceLabel}.tilesheet must be an object`);
  }
  const tileSheet: SpriteTilesheetMeta = {
    image: asString(value.tilesheet.image, `${sourceLabel}.tilesheet.image`),
    tileW: asInt(value.tilesheet.tileW, `${sourceLabel}.tilesheet.tileW`),
    tileH: asInt(value.tilesheet.tileH, `${sourceLabel}.tilesheet.tileH`),
    cols: asInt(value.tilesheet.cols, `${sourceLabel}.tilesheet.cols`),
    rows: asInt(value.tilesheet.rows, `${sourceLabel}.tilesheet.rows`),
  };

  if (!isObject(value.buildings)) {
    throw new Error(`${sourceLabel}.buildings must be an object`);
  }

  const buildings: Record<string, SpriteBuildingMeta> = {};
  for (const [key, entry] of Object.entries(value.buildings)) {
    if (!isObject(entry)) {
      throw new Error(`${sourceLabel}.buildings.${key} must be an object`);
    }
    buildings[key] = {
      image: asString(entry.image, `${sourceLabel}.buildings.${key}.image`),
      frameW: asInt(entry.frameW, `${sourceLabel}.buildings.${key}.frameW`),
      frameH: asInt(entry.frameH, `${sourceLabel}.buildings.${key}.frameH`),
      anchorX: asInt(entry.anchorX, `${sourceLabel}.buildings.${key}.anchorX`),
      anchorY: asInt(entry.anchorY, `${sourceLabel}.buildings.${key}.anchorY`),
    };
  }

  return {
    tileSize,
    tilesheet: tileSheet,
    buildings,
  };
}

function loadImage(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${path}`));
    image.src = path;
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function asInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`);
  }
  return value;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeHexColor(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}
