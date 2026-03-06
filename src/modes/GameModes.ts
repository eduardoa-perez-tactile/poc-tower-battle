import type { Owner } from "../sim/World";
import { HUMAN_OWNER_DEFAULT, SKIRMISH_AI_OWNERS } from "../sim/Factions";

export type GameModeId = "campaign" | "skirmish" | string;

export interface GameModeDefinition {
  id: GameModeId;
  label: string;
  description: string;
  type: "campaign" | "skirmish";
  skirmish?: {
    levelPath: string;
    humanOwner: Owner;
    aiOwners: Owner[];
    objectiveText: string;
  };
}

interface GameModeDoc {
  version?: number;
  modes?: unknown;
}

export interface GameModeRegistry {
  version: number;
  modes: GameModeDefinition[];
}

const DEFAULT_GAME_MODES: GameModeRegistry = {
  version: 1,
  modes: [
    {
      id: "campaign",
      label: "Campaign",
      description: "Tutorial and mission progression.",
      type: "campaign",
    },
    {
      id: "skirmish",
      label: "Local Multiplayer",
      description: "Free-for-all skirmish. Eliminate all opponents.",
      type: "skirmish",
      skirmish: {
        levelPath: "/levels/skirmish/skirmish_4p.json",
        humanOwner: HUMAN_OWNER_DEFAULT,
        aiOwners: [...SKIRMISH_AI_OWNERS],
        objectiveText: "Eliminate all opponents.",
      },
    },
  ],
};

export async function loadGameModeRegistry(path = "/data/gameModes.json"): Promise<GameModeRegistry> {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      console.warn(`[GameModes] Failed to load ${path} (${response.status} ${response.statusText}); using defaults.`);
      return cloneGameModeRegistry(DEFAULT_GAME_MODES);
    }
    const raw = (await response.json()) as unknown;
    return resolveGameModeRegistry(raw);
  } catch (error) {
    console.warn("[GameModes] Failed to load config; using defaults.", error);
    return cloneGameModeRegistry(DEFAULT_GAME_MODES);
  }
}

export function resolveGameModeRegistry(raw: unknown): GameModeRegistry {
  const doc = isObject(raw) ? (raw as GameModeDoc) : {};
  const parsedModes = Array.isArray(doc.modes)
    ? doc.modes.map(parseMode).filter((mode): mode is GameModeDefinition => mode !== null)
    : [];
  const modes = parsedModes.length > 0 ? parsedModes : DEFAULT_GAME_MODES.modes;
  return {
    version: Number.isFinite(doc.version) ? Number(doc.version) : 1,
    modes: modes.map((mode) => cloneMode(mode)),
  };
}

export function getGameModeById(registry: GameModeRegistry, id: GameModeId): GameModeDefinition | null {
  return registry.modes.find((mode) => mode.id === id) ?? null;
}

function parseMode(raw: unknown): GameModeDefinition | null {
  if (!isObject(raw)) {
    return null;
  }
  const id = asString(raw.id);
  const label = asString(raw.label);
  const description = asString(raw.description);
  const type = raw.type === "campaign" || raw.type === "skirmish" ? raw.type : null;
  if (!id || !label || !description || !type) {
    return null;
  }

  if (type === "campaign") {
    return { id, label, description, type };
  }

  const skirmish = parseSkirmishRules(raw.skirmish);
  if (!skirmish) {
    return null;
  }
  return {
    id,
    label,
    description,
    type,
    skirmish,
  };
}

function parseSkirmishRules(raw: unknown): GameModeDefinition["skirmish"] | null {
  if (!isObject(raw)) {
    return null;
  }
  const levelPath = asString(raw.levelPath);
  const objectiveText = asString(raw.objectiveText);
  const humanOwner = asOwner(raw.humanOwner) ?? HUMAN_OWNER_DEFAULT;
  const aiOwners = Array.isArray(raw.aiOwners)
    ? raw.aiOwners
      .map((value) => asOwner(value))
      .filter((owner): owner is Owner => owner !== null && owner !== "neutral" && owner !== humanOwner)
    : [...SKIRMISH_AI_OWNERS];
  const uniqueAiOwners = [...new Set(aiOwners)];
  if (!levelPath || !objectiveText || uniqueAiOwners.length === 0) {
    return null;
  }
  return {
    levelPath,
    objectiveText,
    humanOwner,
    aiOwners: uniqueAiOwners,
  };
}

function asOwner(value: unknown): Owner | null {
  if (
    value === "player" ||
    value === "enemy" ||
    value === "red" ||
    value === "green" ||
    value === "yellow" ||
    value === "neutral"
  ) {
    return value;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cloneGameModeRegistry(registry: GameModeRegistry): GameModeRegistry {
  return {
    version: registry.version,
    modes: registry.modes.map((mode) => cloneMode(mode)),
  };
}

function cloneMode(mode: GameModeDefinition): GameModeDefinition {
  return {
    ...mode,
    skirmish: mode.skirmish
      ? {
          ...mode.skirmish,
          aiOwners: [...mode.skirmish.aiOwners],
        }
      : undefined,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

