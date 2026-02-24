import type { Owner } from "../../sim/World";

export type HudTone = "neutral" | "warning" | "success";
export type HudToastType = "info" | "warning" | "success" | "danger";

export interface EnemyCompositionItemVM {
  id: string;
  icon: string;
  label: string;
  count: number;
}

export interface TopBarVM {
  missionTitle: string;
  waveLabel: string;
  stateLabel: "LIVE" | "PREP" | "COMPLETE";
  countdownLabel: string | null;
  gold: number;
  ownedTowers: number;
  totalRegenPerSec: number;
  paused: boolean;
  speedMul: 1 | 2;
  overlayRegenEnabled: boolean;
  overlayCaptureEnabled: boolean;
  overlayClusterEnabled: boolean;
}

export interface WaveIntelVM {
  collapsedLabel: string;
  waveLabel: string;
  stateLabel: "LIVE" | "PREP" | "COMPLETE";
  enemyComposition: EnemyCompositionItemVM[];
  modifiers: string[];
  bossPreview: string | null;
  defaultCollapsed: boolean;
}

export interface ObjectiveCardVM {
  title: string;
  progress01: number;
  wavesSecuredLabel: string;
  clusterBonusLabel: "Active" | "Inactive";
}

export interface TowerInspectVM {
  towerName: string;
  troopCountLabel: string;
  regenLabel: string;
  incomingPackets: number;
  outgoingLinks: number;
  localPressureLabel: string;
  clusterStatusLabel: string;
  owner: Owner;
}

export interface HudLogEntryVM {
  id: number;
  tone: HudTone;
  message: string;
}

export interface ContextVM {
  towerInspect: TowerInspectVM | null;
}

export interface TowerOverlayVM {
  towerId: string;
  x: number;
  y: number;
  owner: Owner;
  regenPerSec: number;
  clusterHighlight: boolean;
  capture: {
    visible: boolean;
    progress01: number;
    attacker: Owner;
  };
}

export interface OverlayVM {
  towers: TowerOverlayVM[];
}

export interface HudVM {
  topBar: TopBarVM;
  waveIntel: WaveIntelVM;
  objective: ObjectiveCardVM;
  context: ContextVM;
  overlays: OverlayVM;
}

export interface HudOverlayToggles {
  regenNumbers: boolean;
  captureRings: boolean;
  clusterHighlight: boolean;
}

export interface HudToastInput {
  type: HudToastType;
  title: string;
  body: string;
  ttl?: number;
}
