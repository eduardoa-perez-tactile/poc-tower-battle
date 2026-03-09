import type { UnitSpriteFacing } from "../sim/World";
import { toPublicPath } from "../utils/publicPath";

interface UnitSpriteFrameInput {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  col?: number;
  row?: number;
}

interface UnitSpritePivotInput {
  x: number;
  y: number;
}

interface UnitSpriteDefinitionInput {
  image: string;
  frameW: number;
  frameH: number;
  fps: number;
  pivot?: UnitSpritePivotInput;
  directions: Record<UnitSpriteFacing, UnitSpriteFrameInput[]>;
}

interface UnitSpriteCatalogInput {
  sprites: Record<string, UnitSpriteDefinitionInput>;
}

export interface UnitSpriteFrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface UnitSpriteDefinition {
  image: string;
  fps: number;
  pivotX: number;
  pivotY: number;
  directions: Record<UnitSpriteFacing, UnitSpriteFrameRect[]>;
}

export interface UnitSpriteAnimDefinition {
  spriteId: string;
  fps: number;
  frameCounts: Record<UnitSpriteFacing, number>;
}

export interface UnitSpriteAnimFrame {
  image: HTMLImageElement;
  imagePath: string;
  frame: UnitSpriteFrameRect;
  pivotX: number;
  pivotY: number;
  directionFrameCount: number;
}

export interface DrawUnitSpriteAnimationParams {
  spriteId: string;
  facing: UnitSpriteFacing;
  timeSec: number;
  worldX: number;
  worldY: number;
  sizeScale: number;
  frames?: number[];
  fps?: number;
  loop?: boolean;
  offsetX?: number;
  offsetY?: number;
}

const FACINGS: UnitSpriteFacing[] = ["up", "down", "left", "right"];

export class UnitSpriteAtlas {
  private readonly catalogPath: string;
  private readonly spriteById: Map<string, UnitSpriteDefinition>;
  private readonly imageByPath: Map<string, HTMLImageElement>;
  private loadPromise: Promise<void> | null;
  private ready: boolean;

  constructor(catalogPath = "/data/unitSprites.json") {
    this.catalogPath = catalogPath;
    this.spriteById = new Map<string, UnitSpriteDefinition>();
    this.imageByPath = new Map<string, HTMLImageElement>();
    this.loadPromise = null;
    this.ready = false;
  }

  async ensureLoaded(): Promise<void> {
    if (this.ready) {
      return;
    }
    if (!this.loadPromise) {
      this.loadPromise = this.loadInternal();
    }
    await this.loadPromise;
  }

  isReady(): boolean {
    return this.ready;
  }

  getSpriteIds(): string[] {
    return Array.from(this.spriteById.keys()).sort((left, right) => left.localeCompare(right));
  }

  getDirectionFrameCount(spriteId: string, facing: UnitSpriteFacing): number {
    const definition = this.spriteById.get(spriteId);
    if (!definition) {
      return 0;
    }
    const frames = resolveDirectionFrames(definition, facing);
    return frames.length;
  }

  getAnimDefinition(spriteId: string): UnitSpriteAnimDefinition | null {
    const definition = this.spriteById.get(spriteId);
    if (!definition) {
      return null;
    }
    return {
      spriteId,
      fps: definition.fps,
      frameCounts: {
        up: resolveDirectionFrames(definition, "up").length,
        down: resolveDirectionFrames(definition, "down").length,
        left: resolveDirectionFrames(definition, "left").length,
        right: resolveDirectionFrames(definition, "right").length,
      },
    };
  }

  getUnitAnimFrame(
    spriteId: string,
    facing: UnitSpriteFacing,
    frameIndex: number,
  ): UnitSpriteAnimFrame | null {
    if (!this.ready) {
      return null;
    }

    const resolved = this.resolveSprite(spriteId);
    if (!resolved) {
      return null;
    }

    const directionFrames = resolveDirectionFrames(resolved.definition, facing);
    if (directionFrames.length === 0) {
      return null;
    }

    const clampedIndex = clampInt(frameIndex, 0, directionFrames.length - 1);
    return {
      image: resolved.image,
      imagePath: resolved.definition.image,
      frame: directionFrames[clampedIndex],
      pivotX: resolved.definition.pivotX,
      pivotY: resolved.definition.pivotY,
      directionFrameCount: directionFrames.length,
    };
  }

  drawSprite(
    ctx: CanvasRenderingContext2D,
    spriteId: string,
    facing: UnitSpriteFacing,
    timeSec: number,
    worldX: number,
    worldY: number,
    sizeScale: number,
  ): boolean {
    return this.drawAnimation(ctx, {
      spriteId,
      facing,
      timeSec,
      worldX,
      worldY,
      sizeScale,
    });
  }

  drawAnimation(ctx: CanvasRenderingContext2D, params: DrawUnitSpriteAnimationParams): boolean {
    if (!this.ready) {
      return false;
    }

    const resolved = this.resolveSprite(params.spriteId);
    if (!resolved) {
      return false;
    }

    const directionFrames = resolveDirectionFrames(resolved.definition, params.facing);
    if (directionFrames.length === 0) {
      return false;
    }

    const frameSequence = normalizeFrameSequence(params.frames, directionFrames.length);
    if (frameSequence.length === 0) {
      return false;
    }

    const effectiveFps =
      typeof params.fps === "number" && Number.isFinite(params.fps) && params.fps > 0
        ? params.fps
        : resolved.definition.fps;
    const shouldLoop = params.loop ?? true;
    const elapsedFrames = Math.floor(Math.max(0, params.timeSec) * Math.max(0.01, effectiveFps));
    const sequenceIndex = shouldLoop
      ? elapsedFrames % frameSequence.length
      : clampInt(elapsedFrames, 0, frameSequence.length - 1);
    const frame = directionFrames[frameSequence[sequenceIndex]];

    const scale = Math.max(0.2, params.sizeScale);
    const drawW = frame.w * scale;
    const drawH = frame.h * scale;
    const drawX = Math.round(params.worldX - resolved.definition.pivotX * scale + (params.offsetX ?? 0));
    const drawY = Math.round(params.worldY - resolved.definition.pivotY * scale + (params.offsetY ?? 0));

    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      resolved.image,
      frame.x,
      frame.y,
      frame.w,
      frame.h,
      drawX,
      drawY,
      drawW,
      drawH,
    );
    ctx.imageSmoothingEnabled = previousSmoothing;
    return true;
  }

  private resolveSprite(
    spriteId: string,
  ): { definition: UnitSpriteDefinition; image: HTMLImageElement } | null {
    const definition = this.spriteById.get(spriteId);
    if (!definition) {
      return null;
    }
    const image = this.imageByPath.get(definition.image);
    if (!image) {
      return null;
    }
    return { definition, image };
  }

  private async loadInternal(): Promise<void> {
    const catalog = await loadUnitSpriteCatalog(this.catalogPath);
    const imagePaths = new Set<string>();
    for (const sprite of Object.values(catalog.sprites)) {
      imagePaths.add(sprite.image);
    }

    const loadedEntries = await Promise.all(
      Array.from(imagePaths).map(async (path) => [path, await loadImage(toPublicPath(path))] as const),
    );

    this.spriteById.clear();
    this.imageByPath.clear();
    for (const [spriteId, definition] of Object.entries(catalog.sprites)) {
      this.spriteById.set(spriteId, {
        image: definition.image,
        fps: definition.fps,
        pivotX: definition.pivot?.x ?? Math.floor(definition.frameW / 2),
        pivotY: definition.pivot?.y ?? Math.max(0, definition.frameH - 2),
        directions: parseDirectionFrames(
          spriteId,
          definition.directions,
          definition.frameW,
          definition.frameH,
        ),
      });
    }

    for (const [path, image] of loadedEntries) {
      this.imageByPath.set(path, image);
    }
    this.ready = true;
  }
}

async function loadUnitSpriteCatalog(path: string): Promise<UnitSpriteCatalogInput> {
  const response = await fetch(toPublicPath(path));
  if (!response.ok) {
    throw new Error(`Failed to load unit sprite catalog (${response.status} ${response.statusText})`);
  }
  const parsed = (await response.json()) as unknown;
  return parseUnitSpriteCatalog(parsed, path);
}

function parseUnitSpriteCatalog(value: unknown, sourceLabel: string): UnitSpriteCatalogInput {
  if (!isObject(value)) {
    throw new Error(`${sourceLabel}: catalog must be an object`);
  }
  if (!isObject(value.sprites)) {
    throw new Error(`${sourceLabel}.sprites must be an object`);
  }

  const sprites: Record<string, UnitSpriteDefinitionInput> = {};
  for (const [spriteId, entry] of Object.entries(value.sprites)) {
    if (!isObject(entry)) {
      throw new Error(`${sourceLabel}.sprites.${spriteId} must be an object`);
    }
    const frameW = asInt(entry.frameW, `${sourceLabel}.sprites.${spriteId}.frameW`);
    const frameH = asInt(entry.frameH, `${sourceLabel}.sprites.${spriteId}.frameH`);
    const fps = asNumber(entry.fps, `${sourceLabel}.sprites.${spriteId}.fps`);
    if (!isObject(entry.directions)) {
      throw new Error(`${sourceLabel}.sprites.${spriteId}.directions must be an object`);
    }

    const directions = {} as Record<UnitSpriteFacing, UnitSpriteFrameInput[]>;
    for (const facing of FACINGS) {
      const rawFrames = entry.directions[facing];
      if (!Array.isArray(rawFrames) || rawFrames.length === 0) {
        throw new Error(
          `${sourceLabel}.sprites.${spriteId}.directions.${facing} must be a non-empty array`,
        );
      }
      directions[facing] = rawFrames.map((rawFrame, index) => {
        if (!isObject(rawFrame)) {
          throw new Error(
            `${sourceLabel}.sprites.${spriteId}.directions.${facing}[${index}] must be an object`,
          );
        }
        return {
          x: asOptionalInt(rawFrame.x, `${sourceLabel}.sprites.${spriteId}.directions.${facing}[${index}].x`),
          y: asOptionalInt(rawFrame.y, `${sourceLabel}.sprites.${spriteId}.directions.${facing}[${index}].y`),
          w: asOptionalInt(rawFrame.w, `${sourceLabel}.sprites.${spriteId}.directions.${facing}[${index}].w`),
          h: asOptionalInt(rawFrame.h, `${sourceLabel}.sprites.${spriteId}.directions.${facing}[${index}].h`),
          col: asOptionalInt(
            rawFrame.col,
            `${sourceLabel}.sprites.${spriteId}.directions.${facing}[${index}].col`,
          ),
          row: asOptionalInt(
            rawFrame.row,
            `${sourceLabel}.sprites.${spriteId}.directions.${facing}[${index}].row`,
          ),
        };
      });
    }

    const pivot = parseOptionalPivot(entry.pivot, `${sourceLabel}.sprites.${spriteId}.pivot`);
    sprites[spriteId] = {
      image: asString(entry.image, `${sourceLabel}.sprites.${spriteId}.image`),
      frameW,
      frameH,
      fps,
      pivot,
      directions,
    };
  }

  return { sprites };
}

function parseOptionalPivot(value: unknown, field: string): UnitSpritePivotInput | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value)) {
    throw new Error(`${field} must be an object`);
  }
  return {
    x: asInt(value.x, `${field}.x`),
    y: asInt(value.y, `${field}.y`),
  };
}

function parseDirectionFrames(
  spriteId: string,
  directions: Record<UnitSpriteFacing, UnitSpriteFrameInput[]>,
  frameW: number,
  frameH: number,
): Record<UnitSpriteFacing, UnitSpriteFrameRect[]> {
  const parsed = {} as Record<UnitSpriteFacing, UnitSpriteFrameRect[]>;
  for (const facing of FACINGS) {
    const frames = directions[facing];
    parsed[facing] = frames.map((frame, index) => parseFrameRect(frame, frameW, frameH, spriteId, facing, index));
  }
  return parsed;
}

function parseFrameRect(
  frame: UnitSpriteFrameInput,
  frameW: number,
  frameH: number,
  spriteId: string,
  facing: UnitSpriteFacing,
  index: number,
): UnitSpriteFrameRect {
  const hasDirectCoordinates = Number.isFinite(frame.x) && Number.isFinite(frame.y);
  if (hasDirectCoordinates) {
    return {
      x: Math.max(0, Math.floor(frame.x as number)),
      y: Math.max(0, Math.floor(frame.y as number)),
      w: Math.max(1, Math.floor(frame.w ?? frameW)),
      h: Math.max(1, Math.floor(frame.h ?? frameH)),
    };
  }

  if (Number.isFinite(frame.col) && Number.isFinite(frame.row)) {
    return {
      x: Math.max(0, Math.floor((frame.col as number) * frameW)),
      y: Math.max(0, Math.floor((frame.row as number) * frameH)),
      w: Math.max(1, Math.floor(frame.w ?? frameW)),
      h: Math.max(1, Math.floor(frame.h ?? frameH)),
    };
  }

  throw new Error(
    `Sprite ${spriteId} direction ${facing} frame ${index} must define either (x,y) or (col,row)`,
  );
}

function resolveDirectionFrames(
  definition: UnitSpriteDefinition,
  facing: UnitSpriteFacing,
): UnitSpriteFrameRect[] {
  const directionFrames = definition.directions[facing];
  if (directionFrames.length > 0) {
    return directionFrames;
  }
  return definition.directions.down;
}

function normalizeFrameSequence(frames: number[] | undefined, directionFrameCount: number): number[] {
  if (directionFrameCount <= 0) {
    return [];
  }

  if (!frames || frames.length === 0) {
    const defaults: number[] = [];
    for (let index = 0; index < directionFrameCount; index += 1) {
      defaults.push(index);
    }
    return defaults;
  }

  const normalized: number[] = [];
  for (const frameIndex of frames) {
    if (!Number.isFinite(frameIndex)) {
      continue;
    }
    const clamped = clampInt(frameIndex, 0, directionFrameCount - 1);
    normalized.push(clamped);
  }
  return normalized;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
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

function asOptionalInt(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return asInt(value, field);
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}
