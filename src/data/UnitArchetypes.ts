import type { UnitSpriteFacing } from "../sim/World";
import { toPublicPath } from "../utils/publicPath";

export const UNIT_ARCHETYPE_DOC_PATH = "/data/unitArchetypes.json";
export const UNIT_ARCHETYPES_UPDATED_EVENT = "tower-battle:unit-archetypes-updated";

const LEVEL_EDITOR_WORKSPACE_STORAGE_KEY = "tower-battle.level-editor.workspace.v1";
const FACINGS: UnitSpriteFacing[] = ["up", "down", "left", "right"];

export interface UnitWalkAnimationOverride {
  spriteKey: string;
  frames?: number[];
  fps?: number;
  loop?: boolean;
}

export interface UnitVisualDefinition {
  spriteSheetId?: string;
  spriteAtlasKey?: string;
  sizeScale?: number;
  offsetX?: number;
  offsetY?: number;
  walk?: Partial<Record<UnitSpriteFacing, UnitWalkAnimationOverride>>;
}

export interface UnitArchetypeDefinition {
  id: string;
  displayName?: string;
  visuals?: UnitVisualDefinition;
}

export interface UnitArchetypeCatalog {
  version?: number;
  archetypes: UnitArchetypeDefinition[];
}

type UnitArchetypeListener = (version: number) => void;

class UnitArchetypeRegistry {
  private readonly catalogPath: string;
  private readonly listeners: Set<UnitArchetypeListener>;
  private readonly byId: Map<string, UnitArchetypeDefinition>;
  private loadPromise: Promise<void> | null;
  private version: number;
  private catalog: UnitArchetypeCatalog;

  constructor(catalogPath = UNIT_ARCHETYPE_DOC_PATH) {
    this.catalogPath = catalogPath;
    this.listeners = new Set<UnitArchetypeListener>();
    this.byId = new Map<string, UnitArchetypeDefinition>();
    this.loadPromise = null;
    this.version = 0;
    this.catalog = { version: 1, archetypes: [] };
  }

  async ensureLoaded(): Promise<void> {
    if (this.version > 0) {
      return;
    }
    if (!this.loadPromise) {
      this.loadPromise = this.loadInternal();
    }
    await this.loadPromise;
  }

  getVersion(): number {
    return this.version;
  }

  getCatalog(): UnitArchetypeCatalog {
    return cloneCatalog(this.catalog);
  }

  getArchetype(id: string): UnitArchetypeDefinition | null {
    return this.byId.get(id) ?? null;
  }

  listArchetypeIds(): string[] {
    return Array.from(this.byId.keys()).sort((left, right) => left.localeCompare(right));
  }

  subscribe(listener: UnitArchetypeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setCatalog(nextCatalog: UnitArchetypeCatalog): void {
    const parsed = parseUnitArchetypeCatalog(nextCatalog, "unit-archetype-catalog");
    this.catalog = cloneCatalog(parsed);
    this.byId.clear();
    for (const entry of this.catalog.archetypes) {
      this.byId.set(entry.id, entry);
    }
    this.version += 1;
    for (const listener of this.listeners) {
      listener(this.version);
    }
  }

  async reloadFromPath(): Promise<void> {
    const loaded = await loadUnitArchetypeCatalog(this.catalogPath);
    const override = parseUnitArchetypeCatalogFromEditorSnapshot();
    this.setCatalog(override ?? loaded);
  }

  private async loadInternal(): Promise<void> {
    await this.reloadFromPath();
  }
}

export const unitArchetypeRegistry = new UnitArchetypeRegistry();

export async function loadUnitArchetypeCatalog(path = UNIT_ARCHETYPE_DOC_PATH): Promise<UnitArchetypeCatalog> {
  const response = await fetch(toPublicPath(path));
  if (!response.ok) {
    throw new Error(`Failed to load unit archetypes (${response.status} ${response.statusText})`);
  }
  const parsed = (await response.json()) as unknown;
  return parseUnitArchetypeCatalog(parsed, path);
}

export function parseUnitArchetypeCatalog(value: unknown, sourceLabel: string): UnitArchetypeCatalog {
  if (!isObject(value)) {
    throw new Error(`${sourceLabel} must be an object`);
  }

  const rawArchetypes = value.archetypes;
  if (!Array.isArray(rawArchetypes)) {
    throw new Error(`${sourceLabel}.archetypes must be an array`);
  }

  const seenIds = new Set<string>();
  const archetypes: UnitArchetypeDefinition[] = [];
  for (let index = 0; index < rawArchetypes.length; index += 1) {
    const entry = rawArchetypes[index];
    if (!isObject(entry)) {
      throw new Error(`${sourceLabel}.archetypes[${index}] must be an object`);
    }
    const id = asString(entry.id, `${sourceLabel}.archetypes[${index}].id`);
    if (seenIds.has(id)) {
      throw new Error(`${sourceLabel}.archetypes has duplicate id \"${id}\"`);
    }
    seenIds.add(id);

    const visuals = parseOptionalVisuals(
      entry.visuals,
      `${sourceLabel}.archetypes[${index}].visuals`,
    );

    archetypes.push({
      id,
      displayName: asOptionalString(entry.displayName),
      visuals,
    });
  }

  return {
    version: asOptionalInt(value.version),
    archetypes,
  };
}

function parseOptionalVisuals(value: unknown, field: string): UnitVisualDefinition | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value)) {
    throw new Error(`${field} must be an object`);
  }

  const walk = parseOptionalWalk(value.walk, `${field}.walk`);
  return {
    spriteSheetId: asOptionalString(value.spriteSheetId),
    spriteAtlasKey: asOptionalString(value.spriteAtlasKey),
    sizeScale: asOptionalNumber(value.sizeScale),
    offsetX: asOptionalNumber(value.offsetX),
    offsetY: asOptionalNumber(value.offsetY),
    walk,
  };
}

function parseOptionalWalk(
  value: unknown,
  field: string,
): Partial<Record<UnitSpriteFacing, UnitWalkAnimationOverride>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value)) {
    throw new Error(`${field} must be an object`);
  }

  const walk: Partial<Record<UnitSpriteFacing, UnitWalkAnimationOverride>> = {};
  for (const facing of FACINGS) {
    const rawAnim = value[facing];
    if (rawAnim === undefined) {
      continue;
    }
    if (!isObject(rawAnim)) {
      throw new Error(`${field}.${facing} must be an object`);
    }

    walk[facing] = {
      spriteKey: asString(rawAnim.spriteKey, `${field}.${facing}.spriteKey`),
      frames: parseOptionalFrames(rawAnim.frames, `${field}.${facing}.frames`),
      fps: asOptionalNumber(rawAnim.fps),
      loop: asOptionalBoolean(rawAnim.loop),
    };
  }

  return Object.keys(walk).length > 0 ? walk : undefined;
}

function parseOptionalFrames(value: unknown, field: string): number[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }

  const frames: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== "number" || !Number.isFinite(entry) || !Number.isInteger(entry) || entry < 0) {
      throw new Error(`${field}[${index}] must be a non-negative integer`);
    }
    frames.push(entry);
  }
  return frames;
}

export function parseUnitArchetypeCatalogFromEditorSnapshot(): UnitArchetypeCatalog | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  const rawSnapshot = localStorage.getItem(LEVEL_EDITOR_WORKSPACE_STORAGE_KEY);
  if (!rawSnapshot) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawSnapshot) as unknown;
    if (!isObject(parsed) || !Array.isArray(parsed.docs)) {
      return null;
    }

    const unitDoc = parsed.docs.find((entry) =>
      isObject(entry) &&
      entry.path === UNIT_ARCHETYPE_DOC_PATH &&
      typeof entry.currentRaw === "string",
    ) as { currentRaw: string } | undefined;

    if (!unitDoc) {
      return null;
    }
    return parseUnitArchetypeCatalog(JSON.parse(unitDoc.currentRaw) as unknown, "editor-snapshot");
  } catch {
    return null;
  }
}

function cloneCatalog(catalog: UnitArchetypeCatalog): UnitArchetypeCatalog {
  return JSON.parse(JSON.stringify(catalog)) as UnitArchetypeCatalog;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asOptionalInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.floor(value);
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
