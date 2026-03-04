import type { Owner } from "../sim/World";

export interface FactionTintEntry {
  color?: string;
  strength?: number;
}

export interface FactionTintConfigDoc {
  version?: number;
  player?: FactionTintEntry;
  enemy?: FactionTintEntry;
  neutral?: FactionTintEntry;
}

export interface ResolvedFactionTint {
  color: string;
  strength: number;
}

export type ResolvedFactionTintConfig = Record<Owner, ResolvedFactionTint | null>;

export const DEFAULT_FACTION_TINT_DOC: Readonly<FactionTintConfigDoc> = {
  version: 1,
  player: {
    color: "#2dd4bf",
    strength: 0.22,
  },
  enemy: {
    color: "#fb7185",
    strength: 0.24,
  },
  neutral: {
    color: "#b8c2cf",
    strength: 0,
  },
};

export const DEFAULT_RESOLVED_FACTION_TINTS: Readonly<ResolvedFactionTintConfig> = resolveFactionTintConfig(
  DEFAULT_FACTION_TINT_DOC,
);

export async function loadFactionTintConfig(path = "/data/factionTints.json"): Promise<ResolvedFactionTintConfig> {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      console.warn(`[FactionTints] Failed to load ${path} (${response.status} ${response.statusText}); using defaults.`);
      return { ...DEFAULT_RESOLVED_FACTION_TINTS };
    }
    const raw = (await response.json()) as unknown;
    return resolveFactionTintConfig(raw);
  } catch (error) {
    console.warn("[FactionTints] Failed to load config; using defaults.", error);
    return { ...DEFAULT_RESOLVED_FACTION_TINTS };
  }
}

export function resolveFactionTintConfig(raw: unknown): ResolvedFactionTintConfig {
  const doc = isObject(raw) ? (raw as FactionTintConfigDoc) : {};
  return {
    player: resolveOwnerTint(doc.player, DEFAULT_FACTION_TINT_DOC.player),
    enemy: resolveOwnerTint(doc.enemy, DEFAULT_FACTION_TINT_DOC.enemy),
    neutral: resolveOwnerTint(doc.neutral, DEFAULT_FACTION_TINT_DOC.neutral),
  };
}

export function createFactionTintConfigDoc(input: ResolvedFactionTintConfig): FactionTintConfigDoc {
  return {
    version: 1,
    player: {
      color: input.player?.color ?? DEFAULT_FACTION_TINT_DOC.player?.color,
      strength: input.player?.strength ?? DEFAULT_FACTION_TINT_DOC.player?.strength,
    },
    enemy: {
      color: input.enemy?.color ?? DEFAULT_FACTION_TINT_DOC.enemy?.color,
      strength: input.enemy?.strength ?? DEFAULT_FACTION_TINT_DOC.enemy?.strength,
    },
    neutral: {
      color: input.neutral?.color ?? DEFAULT_FACTION_TINT_DOC.neutral?.color,
      strength: input.neutral?.strength ?? DEFAULT_FACTION_TINT_DOC.neutral?.strength,
    },
  };
}

function resolveOwnerTint(
  entry: FactionTintEntry | undefined,
  fallback: FactionTintEntry | undefined,
): ResolvedFactionTint | null {
  const color = normalizeHexColor(entry?.color) ?? normalizeHexColor(fallback?.color);
  const strength = clamp01(Number.isFinite(entry?.strength) ? entry!.strength! : (fallback?.strength ?? 0));
  if (!color || strength <= 0) {
    return null;
  }
  return { color, strength };
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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
