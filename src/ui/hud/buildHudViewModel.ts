import type { Game } from "../../game/Game";
import type { Link, Owner, Tower } from "../../sim/World";
import type { MissionWaveTelemetry } from "../../waves/WaveDirector";
import type { HudVM } from "./types";

export interface BuildHudViewModelInput {
  game: Game;
  missionTitle: string;
  objectiveText: string;
  selectedTowerId: string | null;
  missionPaused: boolean;
  missionSpeedMul: 1 | 2;
  overlayRegenEnabled: boolean;
  overlayCaptureEnabled: boolean;
  overlayClusterEnabled: boolean;
}

interface TowerPacketTraffic {
  incomingFriendlyPackets: number;
  incomingHostilePackets: number;
  incomingPlayerUnits: number;
  incomingEnemyUnits: number;
  incomingNeutralUnits: number;
}

export function buildHudViewModel(input: BuildHudViewModelInput): HudVM {
  const world = input.game.getWorld();
  const telemetry = input.game.getWaveTelemetry();
  const towerById = new Map<string, Tower>();
  const linkById = new Map<string, Link>();

  for (const tower of world.towers) {
    towerById.set(tower.id, tower);
  }
  for (const link of world.links) {
    linkById.set(link.id, link);
  }

  const incomingByTower = new Map<string, TowerPacketTraffic>();
  const outgoingPacketCountByTower = new Map<string, number>();
  const outgoingLinkCountByTower = new Map<string, number>();

  for (const link of world.links) {
    outgoingLinkCountByTower.set(link.fromTowerId, (outgoingLinkCountByTower.get(link.fromTowerId) ?? 0) + 1);
  }

  for (const packet of world.packets) {
    const link = linkById.get(packet.linkId);
    if (!link) {
      continue;
    }

    outgoingPacketCountByTower.set(link.fromTowerId, (outgoingPacketCountByTower.get(link.fromTowerId) ?? 0) + 1);

    const targetTower = towerById.get(link.toTowerId);
    if (!targetTower) {
      continue;
    }

    const traffic = incomingByTower.get(targetTower.id) ?? {
      incomingFriendlyPackets: 0,
      incomingHostilePackets: 0,
      incomingPlayerUnits: 0,
      incomingEnemyUnits: 0,
      incomingNeutralUnits: 0,
    };

    if (packet.owner === targetTower.owner) {
      traffic.incomingFriendlyPackets += 1;
    } else {
      traffic.incomingHostilePackets += 1;
    }

    if (packet.owner === "player") {
      traffic.incomingPlayerUnits += packet.count;
    } else if (packet.owner === "enemy") {
      traffic.incomingEnemyUnits += packet.count;
    } else {
      traffic.incomingNeutralUnits += packet.count;
    }

    incomingByTower.set(targetTower.id, traffic);
  }

  const selectedTower = input.selectedTowerId ? towerById.get(input.selectedTowerId) ?? null : null;
  const playerTowers = world.towers.filter((tower) => tower.owner === "player");
  const totalRegenPerSec = playerTowers.reduce((sum, tower) => sum + sanitizeNumber(tower.effectiveRegen), 0);
  const largestClusterSize = playerTowers.reduce((best, tower) => Math.max(best, tower.territoryClusterSize ?? 0), 0);

  const stateLabel = getStateLabel(telemetry);
  const waveLabel = formatWaveLabel(telemetry);
  const completedWaves = telemetry
    ? Math.max(0, telemetry.currentWaveIndex - (telemetry.activeWaveInProgress ? 1 : 0))
    : 0;
  const totalWaves = telemetry?.totalWaveCount ?? 0;

  return {
    topBar: {
      missionTitle: input.missionTitle,
      waveLabel,
      stateLabel,
      countdownLabel: getCountdownLabel(telemetry),
      gold: Math.floor(telemetry?.missionGold ?? 0),
      ownedTowers: playerTowers.length,
      totalRegenPerSec,
      paused: input.missionPaused,
      speedMul: input.missionSpeedMul,
      overlayRegenEnabled: input.overlayRegenEnabled,
      overlayCaptureEnabled: input.overlayCaptureEnabled,
      overlayClusterEnabled: input.overlayClusterEnabled,
    },
    waveIntel: {
      collapsedLabel: `Wave ${waveLabel} | ${stateLabel}`,
      waveLabel,
      stateLabel,
      enemyComposition: (telemetry?.nextWavePreview ?? []).map((entry) => ({
        id: `${entry.enemyId}-${entry.count}`,
        icon: entry.icon || "•",
        label: entry.enemyId,
        count: entry.count,
      })),
      modifiers: telemetry?.activeModifierNames ?? [],
      bossPreview: getBossPreviewLabel(telemetry),
      defaultCollapsed: stateLabel === "LIVE",
    },
    objective: {
      title: input.objectiveText,
      progress01: totalWaves > 0 ? clamp01(completedWaves / Math.max(1, totalWaves)) : 0,
      wavesSecuredLabel: totalWaves > 0 ? `${completedWaves}/${totalWaves} waves secured` : "Awaiting wave telemetry",
      clusterBonusLabel: largestClusterSize >= 3 ? "Active" : "Inactive",
    },
    context: {
      towerInspect: selectedTower
        ? buildTowerInspect(selectedTower, incomingByTower, outgoingLinkCountByTower, outgoingPacketCountByTower)
        : null,
    },
    overlays: {
      towers: world.towers.map((tower) => {
        const traffic = incomingByTower.get(tower.id);
        const capture = computeCaptureOverlay(tower, traffic);
        return {
          towerId: tower.id,
          x: tower.x,
          y: tower.y,
          owner: tower.owner,
          regenPerSec: tower.owner === "neutral" ? 0 : sanitizeNumber(tower.effectiveRegen),
          clusterHighlight: tower.owner === "player" && (tower.territoryClusterSize ?? 0) >= 3,
          capture,
        };
      }),
    },
  };
}

function buildTowerInspect(
  tower: Tower,
  incomingByTower: ReadonlyMap<string, TowerPacketTraffic>,
  outgoingLinkCountByTower: ReadonlyMap<string, number>,
  outgoingPacketCountByTower: ReadonlyMap<string, number>,
): HudVM["context"]["towerInspect"] {
  const traffic = incomingByTower.get(tower.id);
  const incomingPackets = traffic?.incomingHostilePackets ?? 0;
  const outgoingLinks = outgoingLinkCountByTower.get(tower.id) ?? 0;
  const outgoingPackets = outgoingPacketCountByTower.get(tower.id) ?? 0;
  const clusterSize = tower.owner === "player" ? tower.territoryClusterSize ?? 0 : 0;

  return {
    towerName: `${tower.id} · ${tower.archetype}`,
    troopCountLabel: `${Math.round(tower.troops)}/${Math.round(tower.maxTroops)}`,
    regenLabel: tower.owner === "neutral" ? "0.0/s" : `+${sanitizeNumber(tower.effectiveRegen).toFixed(2)}/s`,
    incomingPackets,
    outgoingLinks,
    localPressureLabel: getPressureLabel(incomingPackets, outgoingPackets),
    clusterStatusLabel: getClusterStatusLabel(tower, clusterSize),
    owner: tower.owner,
  };
}

function getClusterStatusLabel(tower: Tower, clusterSize: number): string {
  if (tower.owner !== "player") {
    return "Not in player cluster";
  }

  const bonuses: string[] = [];
  if ((tower.territoryRegenBonusPct ?? 0) > 0) {
    bonuses.push(`Regen +${Math.round((tower.territoryRegenBonusPct ?? 0) * 100)}%`);
  }
  if ((tower.territoryArmorBonusPct ?? 0) > 0) {
    bonuses.push(`Armor +${Math.round((tower.territoryArmorBonusPct ?? 0) * 100)}%`);
  }
  if ((tower.territoryVisionBonusPct ?? 0) > 0) {
    bonuses.push(`Vision +${Math.round((tower.territoryVisionBonusPct ?? 0) * 100)}%`);
  }

  if (bonuses.length === 0) {
    return `Size ${clusterSize} · Inactive`;
  }
  return `Size ${clusterSize} · ${bonuses.join(" / ")}`;
}

function getPressureLabel(incomingPackets: number, outgoingPackets: number): string {
  if (incomingPackets >= 5) {
    return `High (${incomingPackets} incoming)`;
  }
  if (incomingPackets >= 2) {
    return `Medium (${incomingPackets} incoming)`;
  }
  if (incomingPackets === 0 && outgoingPackets > 0) {
    return "Low (projecting force)";
  }
  return "Low";
}

function formatWaveLabel(telemetry: MissionWaveTelemetry | null): string {
  if (!telemetry) {
    return "--/--";
  }
  const current = Math.max(1, telemetry.currentWaveIndex);
  return `${current}/${telemetry.totalWaveCount}`;
}

function getStateLabel(telemetry: MissionWaveTelemetry | null): "LIVE" | "PREP" | "COMPLETE" {
  if (!telemetry) {
    return "PREP";
  }
  if (telemetry.activeWaveInProgress) {
    return "LIVE";
  }
  if (telemetry.currentWaveIndex >= telemetry.totalWaveCount) {
    return "COMPLETE";
  }
  return "PREP";
}

function getCountdownLabel(telemetry: MissionWaveTelemetry | null): string | null {
  if (!telemetry || telemetry.nextWaveStartsInSec === null) {
    return null;
  }
  return `${Math.ceil(telemetry.nextWaveStartsInSec)}s`;
}

function getBossPreviewLabel(telemetry: MissionWaveTelemetry | null): string | null {
  if (!telemetry) {
    return null;
  }
  if (telemetry.bossName) {
    return `${telemetry.bossName} (${Math.round(clamp01(telemetry.bossHp01) * 100)}%)`;
  }
  const previewBoss = telemetry.nextWavePreview.find((entry) => /boss/i.test(entry.enemyId));
  if (!previewBoss) {
    return null;
  }
  return `${previewBoss.enemyId} x${previewBoss.count}`;
}

function computeCaptureOverlay(
  tower: Tower,
  traffic: TowerPacketTraffic | undefined,
): {
  visible: boolean;
  progress01: number;
  attacker: Owner;
} {
  if (!traffic) {
    return {
      visible: false,
      progress01: 0,
      attacker: "neutral",
    };
  }

  let attacker: Owner = "neutral";
  let attackingPower = 0;
  if (tower.owner === "player") {
    attacker = "enemy";
    attackingPower = traffic.incomingEnemyUnits + traffic.incomingNeutralUnits;
  } else if (tower.owner === "enemy") {
    attacker = "player";
    attackingPower = traffic.incomingPlayerUnits + traffic.incomingNeutralUnits;
  } else {
    attacker = traffic.incomingPlayerUnits >= traffic.incomingEnemyUnits ? "player" : "enemy";
    attackingPower = Math.max(traffic.incomingPlayerUnits, traffic.incomingEnemyUnits);
  }

  if (attackingPower <= 0) {
    return {
      visible: false,
      progress01: 0,
      attacker,
    };
  }

  const progress01 = clamp01(attackingPower / Math.max(1, tower.troops + attackingPower));
  return {
    visible: true,
    progress01,
    attacker,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sanitizeNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value;
}
