import type { Owner, Tower, World } from "./World";

export const HUMAN_OWNER_DEFAULT: Owner = "player";
export const NEUTRAL_OWNER: Owner = "neutral";

export const PLAYABLE_OWNERS: readonly Owner[] = [
  "player",
  "enemy",
  "red",
  "green",
  "yellow",
] as const;

export const ALL_OWNERS: readonly Owner[] = [
  ...PLAYABLE_OWNERS,
  NEUTRAL_OWNER,
] as const;

export const SKIRMISH_AI_OWNERS: readonly Owner[] = [
  "red",
  "green",
  "yellow",
] as const;

const FACTION_LABELS: Record<Owner, string> = {
  player: "Blue Command",
  enemy: "Red Command",
  red: "Red Command",
  green: "Green Command",
  yellow: "Yellow Command",
  neutral: "Neutral",
};

export const FACTION_COLORS: Record<Owner, string> = {
  player: "#3b82f6",
  enemy: "#ef4444",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#facc15",
  neutral: "#94a3b8",
};

export function isNeutral(owner: Owner): boolean {
  return owner === NEUTRAL_OWNER;
}

export function isHumanFaction(owner: Owner, humanOwner: Owner = HUMAN_OWNER_DEFAULT): boolean {
  return owner === humanOwner;
}

export function isPlayableFaction(owner: Owner): boolean {
  return owner !== NEUTRAL_OWNER;
}

export function isHostile(a: Owner, b: Owner): boolean {
  if (a === b) {
    return false;
  }
  return isPlayableFaction(a) && isPlayableFaction(b);
}

export function getFactionColor(owner: Owner): string {
  return FACTION_COLORS[owner];
}

export function getFactionLabel(owner: Owner): string {
  return FACTION_LABELS[owner];
}

export function getAliveFactions(
  world: Pick<World, "towers">,
  includeNeutral = false,
): Owner[] {
  const alive = new Set<Owner>();
  for (const tower of world.towers) {
    if (!includeNeutral && isNeutral(tower.owner)) {
      continue;
    }
    alive.add(tower.owner);
  }
  return [...alive].sort((a, b) => a.localeCompare(b));
}

export function countOwnedTowers(
  towers: ReadonlyArray<Tower>,
  owner: Owner,
): number {
  let count = 0;
  for (const tower of towers) {
    if (tower.owner === owner) {
      count += 1;
    }
  }
  return count;
}

