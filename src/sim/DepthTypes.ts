export const TowerArchetype = {
  STRONGHOLD: "STRONGHOLD",
  BARRACKS: "BARRACKS",
  FORTRESS: "FORTRESS",
  RELAY: "RELAY",
  BANK: "BANK",
  OBELISK: "OBELISK",
} as const;

export type TowerArchetype = (typeof TowerArchetype)[keyof typeof TowerArchetype];

export interface TowerArchetypeModifier {
  icon: string;
  regenRateBonusPct: number;
  maxTroopsBonusPct: number;
  defenseMultiplierAdd: number;
  packetDamageBonusPct: number;
  linkSpeedBonusPct: number;
  extraOutgoingLinks: number;
  auraRadius: number;
  auraRegenBonusPct: number;
  captureSpeedTakenMultiplierAdd: number;
  goldPerSecond: number;
  recaptureBonusGold: number;
}

export interface TowerArchetypeCatalog {
  baseline: TowerArchetypeModifier;
  archetypes: Record<TowerArchetype, TowerArchetypeModifier>;
}

export interface LinkLevelDefinition {
  level: number;
  speedMultiplier: number;
  armorBonus: number;
  damageBonus: number;
  integrity: number;
  overchargeDrain: number;
}

export interface LinkLevelCatalog {
  levels: LinkLevelDefinition[];
}

export interface LoadedDepthContent {
  towerArchetypes: TowerArchetypeCatalog;
  linkLevels: Map<number, LinkLevelDefinition>;
}

export interface TowerArchetypeState {
  archetype: TowerArchetype;
  baseMaxTroops: number;
  baseRegenRate: number;
  maxTroops: number;
  regenRate: number;
  defenseMultiplier: number;
  packetDamageMultiplier: number;
  linkSpeedBonus: number;
  extraOutgoingLinks: number;
  auraRadius: number;
  auraRegenBonusPct: number;
  captureSpeedTakenMultiplier: number;
  goldPerSecond: number;
  recaptureBonusGold: number;
  archetypeIcon: string;
}
