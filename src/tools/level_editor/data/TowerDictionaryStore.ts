import { setDocumentData } from "../services/workspaceMutations";
import { isObject } from "../model/json";
import type { LevelEditorWorkspace } from "../model/types";
import {
  TOWER_DICTIONARY_PATH,
  TOWER_DICTIONARY_SCHEMA_VERSION,
  type TowerDefinition,
  type TowerDictionary,
  type TowerGameplayParams,
} from "../types/towerDictionary";

const DEFAULT_ORDER = ["STRONGHOLD", "BARRACKS", "FORTRESS", "RELAY", "BANK", "OBELISK"];

const DEFAULT_SPRITE_BY_ID: Record<string, string> = {
  STRONGHOLD: "keep",
  BARRACKS: "barracks",
  FORTRESS: "guard_tower",
  RELAY: "scout_tower",
  BANK: "foundry",
  OBELISK: "mage_tower",
};

interface TowerDictionaryDoc {
  schemaVersion?: number;
  version?: number;
  baseline: Record<string, unknown>;
  archetypes: Record<string, Record<string, unknown>>;
}

export interface TowerDictionaryStore {
  loadTowerDictionary(): Promise<TowerDictionary>;
  saveTowerDictionary(next: TowerDictionary): Promise<void>;
  createDefaultDictionary(): Promise<TowerDictionary>;
  isMissingTowerDictionaryError(error: unknown): boolean;
}

export interface TowerDictionaryStoreDeps {
  getWorkspace: () => LevelEditorWorkspace | null;
  commitWorkspace: (updater: (workspace: LevelEditorWorkspace) => LevelEditorWorkspace) => void;
}

export class MissingTowerDictionaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingTowerDictionaryError";
  }
}

export function createTowerDictionaryStore(deps: TowerDictionaryStoreDeps): TowerDictionaryStore {
  const save = async (next: TowerDictionary): Promise<void> => {
    const workspace = requireWorkspace(deps.getWorkspace());
    const existing = workspace.docs[TOWER_DICTIONARY_PATH];
    const existingDoc = isObject(existing?.currentData) ? existing.currentData : {};
    const serialized = serializeTowerDictionary(next, existingDoc as Record<string, unknown>);

    deps.commitWorkspace((workspaceBefore) => {
      if (workspaceBefore.docs[TOWER_DICTIONARY_PATH]) {
        return setDocumentData(workspaceBefore, TOWER_DICTIONARY_PATH, serialized);
      }
      return withSyntheticDocument(workspaceBefore, serialized);
    });
  };

  return {
    async loadTowerDictionary(): Promise<TowerDictionary> {
      const workspace = requireWorkspace(deps.getWorkspace());
      const doc = workspace.docs[TOWER_DICTIONARY_PATH];
      if (!doc) {
        throw new MissingTowerDictionaryError(`${TOWER_DICTIONARY_PATH} is not available in workspace.`);
      }

      if (doc.loadError) {
        if (doc.loadError.includes("404") || doc.loadError.includes("Failed to load")) {
          throw new MissingTowerDictionaryError(doc.loadError);
        }
        throw new Error(doc.loadError);
      }

      if (!isObject(doc.currentData)) {
        throw new Error(`${TOWER_DICTIONARY_PATH} must contain an object.`);
      }

      const parsedDoc = parseTowerDictionaryDoc(doc.currentData);
      return deserializeTowerDictionary(parsedDoc);
    },

    async saveTowerDictionary(next: TowerDictionary): Promise<void> {
      await save(next);
    },

    async createDefaultDictionary(): Promise<TowerDictionary> {
      const dictionary = makeDefaultDictionary();
      await save(dictionary);
      return dictionary;
    },

    isMissingTowerDictionaryError(error: unknown): boolean {
      return error instanceof MissingTowerDictionaryError;
    },
  };
}

export function parseTowerDictionaryFromRaw(value: unknown): TowerDictionary {
  if (!isObject(value)) {
    throw new Error("Tower dictionary document must be an object.");
  }
  return deserializeTowerDictionary(parseTowerDictionaryDoc(value));
}

export function serializeTowerDictionaryToRaw(
  dictionary: TowerDictionary,
  existingRoot: Record<string, unknown> = {},
): Record<string, unknown> {
  return serializeTowerDictionary(dictionary, existingRoot);
}

function requireWorkspace(workspace: LevelEditorWorkspace | null): LevelEditorWorkspace {
  if (!workspace) {
    throw new Error("Level editor workspace is not loaded.");
  }
  return workspace;
}

function parseTowerDictionaryDoc(value: Record<string, unknown>): TowerDictionaryDoc {
  const baseline = isObject(value.baseline) ? deepClone(value.baseline) : null;
  const archetypesRaw = isObject(value.archetypes) ? value.archetypes : null;
  if (!baseline || !archetypesRaw) {
    throw new Error("towerArchetypes.json must contain baseline + archetypes objects.");
  }

  const archetypes: Record<string, Record<string, unknown>> = {};
  for (const [towerId, entry] of Object.entries(archetypesRaw)) {
    if (!isObject(entry)) {
      continue;
    }
    archetypes[towerId] = deepClone(entry);
  }

  return {
    schemaVersion: asOptionalInt(value.schemaVersion),
    version: asOptionalInt(value.version),
    baseline,
    archetypes,
  };
}

function deserializeTowerDictionary(doc: TowerDictionaryDoc): TowerDictionary {
  const towers: Record<string, TowerDefinition> = {};
  const order = Object.keys(doc.archetypes);

  for (const [towerId, raw] of Object.entries(doc.archetypes)) {
    towers[towerId] = deserializeTowerDefinition(towerId, raw);
  }

  return {
    schemaVersion: doc.schemaVersion ?? TOWER_DICTIONARY_SCHEMA_VERSION,
    version: doc.version ?? 1,
    baseline: {
      gameplay: deserializeGameplay(doc.baseline, "B"),
      raw: deepClone(doc.baseline),
    },
    towers,
    order,
  };
}

function deserializeTowerDefinition(towerId: string, raw: Record<string, unknown>): TowerDefinition {
  const gameplay = deserializeGameplay(raw, towerId);
  const displayName = asOptionalString(raw.displayName) ?? asOptionalString(raw.name) ?? toDisplayName(towerId);
  const tags = asStringArray(raw.tags);
  const category = asOptionalString(raw.category) ?? undefined;
  const ownershipDefault = asOwnership(raw.ownershipDefault);

  const artRaw = isObject(raw.art) ? raw.art : {};
  const art = {
    atlasId: asOptionalString(artRaw.atlasId) ?? "buildings",
    spriteKey: asOptionalString(artRaw.spriteKey) ?? DEFAULT_SPRITE_BY_ID[towerId] ?? "guard_tower",
    frameIndex: Math.max(0, asOptionalInt(artRaw.frameIndex) ?? 0),
    scale: asOptionalNumber(artRaw.scale) ?? 1,
    offsetX: asOptionalNumber(artRaw.offsetX) ?? 0,
    offsetY: asOptionalNumber(artRaw.offsetY) ?? 0,
    anchorX: asOptionalNumber(artRaw.anchorX) ?? undefined,
    anchorY: asOptionalNumber(artRaw.anchorY) ?? undefined,
  };

  return {
    id: towerId,
    displayName,
    description: asOptionalString(raw.description) ?? undefined,
    category,
    tags,
    ownershipDefault,
    gameplay,
    art,
    raw: deepClone(raw),
  };
}

function deserializeGameplay(raw: Record<string, unknown>, fallbackIconSeed: string): TowerGameplayParams {
  const fallbackIcon = fallbackIconSeed.slice(0, 1).toUpperCase() || "T";
  return {
    icon: asOptionalString(raw.icon) ?? fallbackIcon,
    regenRateBonusPct: asFinite(raw.regenRateBonusPct, 0),
    maxTroopsBonusPct: asFinite(raw.maxTroopsBonusPct, 0),
    defenseMultiplierAdd: asFinite(raw.defenseMultiplierAdd, 0),
    packetDamageBonusPct: asFinite(raw.packetDamageBonusPct, 0),
    linkSpeedBonusPct: asFinite(raw.linkSpeedBonusPct, 0),
    extraOutgoingLinks: Math.max(0, Math.floor(asFinite(raw.extraOutgoingLinks, 0))),
    auraRadius: Math.max(0, asFinite(raw.auraRadius, 0)),
    auraRegenBonusPct: Math.max(0, asFinite(raw.auraRegenBonusPct, 0)),
    captureSpeedTakenMultiplierAdd: asFinite(raw.captureSpeedTakenMultiplierAdd, 0),
    goldPerSecond: Math.max(0, asFinite(raw.goldPerSecond, 0)),
    recaptureBonusGold: Math.max(0, asFinite(raw.recaptureBonusGold, 0)),
  };
}

function serializeTowerDictionary(
  dictionary: TowerDictionary,
  existingRoot: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(existingRoot)) {
    if (key === "baseline" || key === "archetypes" || key === "schemaVersion" || key === "version") {
      continue;
    }
    next[key] = deepClone(value);
  }

  next.schemaVersion = Math.max(1, Math.floor(dictionary.schemaVersion || TOWER_DICTIONARY_SCHEMA_VERSION));
  next.version = Math.max(1, Math.floor(dictionary.version || 1));
  next.baseline = serializeGameplay(dictionary.baseline.raw, dictionary.baseline.gameplay);

  const orderedIds = normalizeOrder(dictionary.order, dictionary.towers);
  const archetypes: Record<string, Record<string, unknown>> = {};
  for (const towerId of orderedIds) {
    const tower = dictionary.towers[towerId];
    if (!tower) {
      continue;
    }
    archetypes[towerId] = serializeTowerDefinition(tower);
  }
  next.archetypes = archetypes;

  return next;
}

function serializeTowerDefinition(tower: TowerDefinition): Record<string, unknown> {
  const next = serializeGameplay(tower.raw, tower.gameplay);

  next.id = tower.id;
  next.displayName = tower.displayName.trim();

  if (tower.description && tower.description.trim().length > 0) {
    next.description = tower.description.trim();
  } else {
    delete next.description;
  }

  if (tower.category && tower.category.trim().length > 0) {
    next.category = tower.category.trim();
  } else {
    delete next.category;
  }

  if (tower.tags.length > 0) {
    next.tags = [...new Set(tower.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
  } else {
    delete next.tags;
  }

  if (tower.ownershipDefault) {
    next.ownershipDefault = tower.ownershipDefault;
  } else {
    delete next.ownershipDefault;
  }

  next.art = {
    atlasId: tower.art.atlasId.trim(),
    spriteKey: tower.art.spriteKey.trim(),
    frameIndex: Math.max(0, Math.floor(tower.art.frameIndex)),
    ...(Number.isFinite(tower.art.scale) ? { scale: tower.art.scale } : {}),
    ...(Number.isFinite(tower.art.offsetX) ? { offsetX: tower.art.offsetX } : {}),
    ...(Number.isFinite(tower.art.offsetY) ? { offsetY: tower.art.offsetY } : {}),
    ...(Number.isFinite(tower.art.anchorX) ? { anchorX: tower.art.anchorX } : {}),
    ...(Number.isFinite(tower.art.anchorY) ? { anchorY: tower.art.anchorY } : {}),
  };

  return next;
}

function serializeGameplay(
  previousRaw: Record<string, unknown>,
  gameplay: TowerGameplayParams,
): Record<string, unknown> {
  const next = deepClone(previousRaw);
  next.icon = gameplay.icon;
  next.regenRateBonusPct = gameplay.regenRateBonusPct;
  next.maxTroopsBonusPct = gameplay.maxTroopsBonusPct;
  next.defenseMultiplierAdd = gameplay.defenseMultiplierAdd;
  next.packetDamageBonusPct = gameplay.packetDamageBonusPct;
  next.linkSpeedBonusPct = gameplay.linkSpeedBonusPct;
  next.extraOutgoingLinks = Math.max(0, Math.floor(gameplay.extraOutgoingLinks));
  next.auraRadius = Math.max(0, gameplay.auraRadius);
  next.auraRegenBonusPct = Math.max(0, gameplay.auraRegenBonusPct);
  next.captureSpeedTakenMultiplierAdd = gameplay.captureSpeedTakenMultiplierAdd;
  next.goldPerSecond = Math.max(0, gameplay.goldPerSecond);
  next.recaptureBonusGold = Math.max(0, gameplay.recaptureBonusGold);
  return next;
}

function normalizeOrder(order: string[], towers: Record<string, TowerDefinition>): string[] {
  const deduped = new Set<string>();
  for (const towerId of order) {
    if (!towers[towerId] || deduped.has(towerId)) {
      continue;
    }
    deduped.add(towerId);
  }

  for (const towerId of Object.keys(towers).sort((left, right) => left.localeCompare(right))) {
    if (!deduped.has(towerId)) {
      deduped.add(towerId);
    }
  }

  return [...deduped];
}

function withSyntheticDocument(
  workspace: LevelEditorWorkspace,
  data: Record<string, unknown>,
): LevelEditorWorkspace {
  const nextRaw = `${JSON.stringify(data, null, 2)}\n`;
  const nextDoc = {
    id: TOWER_DICTIONARY_PATH,
    path: TOWER_DICTIONARY_PATH,
    label: "towerArchetypes.json",
    kind: "tower-archetypes" as const,
    group: "globals" as const,
    originalRaw: "",
    currentRaw: nextRaw,
    originalData: null,
    currentData: data,
    parseError: null,
    loadError: null,
    isSynthetic: true,
  };

  return {
    ...workspace,
    updatedAt: Date.now(),
    order: workspace.order.includes(TOWER_DICTIONARY_PATH) ? workspace.order : [...workspace.order, TOWER_DICTIONARY_PATH],
    docs: {
      ...workspace.docs,
      [TOWER_DICTIONARY_PATH]: nextDoc,
    },
  };
}

function makeDefaultDictionary(): TowerDictionary {
  const baselineGameplay: TowerGameplayParams = {
    icon: "S",
    regenRateBonusPct: 0,
    maxTroopsBonusPct: 0,
    defenseMultiplierAdd: 0,
    packetDamageBonusPct: 0,
    linkSpeedBonusPct: 0,
    extraOutgoingLinks: 0,
    auraRadius: 0,
    auraRegenBonusPct: 0,
    captureSpeedTakenMultiplierAdd: 0,
    goldPerSecond: 0,
    recaptureBonusGold: 0,
  };

  const towers: Record<string, TowerDefinition> = {};
  for (const towerId of DEFAULT_ORDER) {
    towers[towerId] = {
      id: towerId,
      displayName: toDisplayName(towerId),
      description: "",
      category: "",
      tags: [],
      ownershipDefault: "neutral",
      gameplay: {
        ...baselineGameplay,
        icon: towerId.slice(0, 1),
      },
      art: {
        atlasId: "buildings",
        spriteKey: DEFAULT_SPRITE_BY_ID[towerId] ?? "guard_tower",
        frameIndex: 0,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
      },
      raw: {},
    };
  }

  return {
    schemaVersion: TOWER_DICTIONARY_SCHEMA_VERSION,
    version: 1,
    baseline: {
      gameplay: baselineGameplay,
      raw: {},
    },
    towers,
    order: [...DEFAULT_ORDER],
  };
}

function asFinite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asOptionalInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => `${entry}`.trim())
    .filter((entry) => entry.length > 0);
}

function asOwnership(value: unknown): "neutral" | "player" | "enemy" | undefined {
  if (value === "neutral" || value === "player" || value === "enemy") {
    return value;
  }
  return undefined;
}

function toDisplayName(id: string): string {
  return id
    .split("_")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => token[0].toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
