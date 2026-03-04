import type { UnitSpriteFacing } from "../sim/World";

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

interface UnitSpriteFrameRect {
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

  drawSprite(
    ctx: CanvasRenderingContext2D,
    spriteId: string,
    facing: UnitSpriteFacing,
    timeSec: number,
    worldX: number,
    worldY: number,
    sizeScale: number,
  ): boolean {
    if (!this.ready) {
      return false;
    }

    const definition = this.spriteById.get(spriteId);
    if (!definition) {
      return false;
    }
    const image = this.imageByPath.get(definition.image);
    if (!image) {
      return false;
    }

    const directionFrames = definition.directions[facing];
    const frames = directionFrames.length > 0 ? directionFrames : definition.directions.down;
    if (frames.length === 0) {
      return false;
    }

    const frameIndex =
      Math.floor(Math.max(0, timeSec) * Math.max(1, definition.fps)) % frames.length;
    const frame = frames[frameIndex];
    const scale = Math.max(0.2, sizeScale);
    const drawW = frame.w * scale;
    const drawH = frame.h * scale;
    const drawX = Math.round(worldX - definition.pivotX * scale);
    const drawY = Math.round(worldY - definition.pivotY * scale);

    const previousSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      image,
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
  const response = await fetch(path);
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

function loadImage(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${path}`));
    image.src = path;
  });
}

function toPublicPath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
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
