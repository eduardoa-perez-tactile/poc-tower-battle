import type { Owner } from "../../sim/World";
import type { SkillHudState } from "../../game/SkillManager";

export type HudTone = "neutral" | "warning" | "success";
export type HudToastType = "info" | "warning" | "success" | "danger";

export interface HudBadgeVM {
  id: string;
  icon: string;
  label: string;
  tone: HudTone;
}

export interface ThreatItemVM {
  id: string;
  icon: string;
  label: string;
  count: number;
  etaSec: number | null;
}

export interface ThreatVM {
  waveLabel: string;
  phaseLabel: string;
  countdownLabel: string;
  countdownSec: number | null;
  threats: ThreatItemVM[];
  modifiers: HudBadgeVM[];
}

export interface ObjectiveVM {
  label: string;
  detail: string;
  progress01: number;
}

export interface TerritorySummaryVM {
  largestClusterSize: number;
  bonusBadges: HudBadgeVM[];
}

export interface SkillHotkeyVM {
  id: string;
  name: string;
  targeting: SkillHudState["targeting"];
  hotkeyLabel: string;
  ready: boolean;
  cooldownRemainingSec: number;
  cooldownTotalSec: number;
}

export interface TacticalVM {
  objective: ObjectiveVM;
  globalBadges: HudBadgeVM[];
  territory: TerritorySummaryVM;
  skills: SkillHotkeyVM[];
}

export interface GlobalSummaryVM {
  ownedTowers: number;
  totalRegenPerSec: number;
  packetsInTransit: number;
  clusterBonusActive: boolean;
}

export interface TowerInspectVM {
  towerId: string;
  owner: Owner;
  archetypeLabel: string;
  troops: number;
  maxTroops: number;
  regenPerSec: number;
  incomingPackets: number;
  outgoingPackets: number;
  clusterSize: number;
  clusterBadges: HudBadgeVM[];
  threatIncomingSoon: number;
  threatLevel: "low" | "medium" | "high";
  controlHint: string;
}

export interface HudLogEntryVM {
  id: number;
  tone: HudTone;
  message: string;
}

export interface ContextVM {
  mode: "global" | "tower";
  globalSummary: GlobalSummaryVM | null;
  towerInspect: TowerInspectVM | null;
  logEntries: HudLogEntryVM[];
  showLogDrawer: boolean;
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
  missionTitle: string;
  objectiveText: string;
  threat: ThreatVM;
  tactical: TacticalVM;
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
