export const DIFFICULTY_TIER_IDS = ["NORMAL", "HARD", "ASCENDED"] as const;

export type DifficultyTierId = (typeof DIFFICULTY_TIER_IDS)[number];

export const DEFAULT_DIFFICULTY_TIER: DifficultyTierId = "NORMAL";

export function isDifficultyTierId(value: unknown): value is DifficultyTierId {
  return (
    typeof value === "string" &&
    (value === "NORMAL" || value === "HARD" || value === "ASCENDED")
  );
}

export function toDifficultyTierId(value: unknown): DifficultyTierId {
  return isDifficultyTierId(value) ? value : DEFAULT_DIFFICULTY_TIER;
}

export function difficultyTierToSeedSalt(value: DifficultyTierId): number {
  switch (value) {
    case "NORMAL":
      return 1;
    case "HARD":
      return 2;
    case "ASCENDED":
      return 3;
  }
}
