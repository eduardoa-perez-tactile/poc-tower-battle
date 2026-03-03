export const TOWER_DICTIONARY_PATH = "/data/towerArchetypes.json";
export const TOWER_DICTIONARY_SCHEMA_VERSION = 1;

export type TowerOwnershipDefault = "neutral" | "player" | "enemy";

export interface TowerGameplayParams {
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

export interface TowerArtReference {
  atlasId: string;
  spriteKey: string;
  frameIndex: number;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  anchorX?: number;
  anchorY?: number;
}

export interface TowerDefinition {
  id: string;
  displayName: string;
  description?: string;
  category?: string;
  tags: string[];
  ownershipDefault?: TowerOwnershipDefault;
  gameplay: TowerGameplayParams;
  art: TowerArtReference;
  raw: Record<string, unknown>;
}

export interface TowerBaselineDefinition {
  gameplay: TowerGameplayParams;
  raw: Record<string, unknown>;
}

export interface TowerDictionary {
  schemaVersion: number;
  version: number;
  baseline: TowerBaselineDefinition;
  towers: Record<string, TowerDefinition>;
  order: string[];
}

export interface TowerDerivedStats {
  regenMultiplier: number;
  maxTroopsMultiplier: number;
  defenseMultiplier: number;
  packetDamageMultiplier: number;
  linkSpeedMultiplier: number;
  captureSpeedTakenMultiplier: number;
}

export interface TowerDictionaryValidationIssue {
  severity: "error" | "warning";
  towerId: string;
  fieldPath: string;
  message: string;
}
