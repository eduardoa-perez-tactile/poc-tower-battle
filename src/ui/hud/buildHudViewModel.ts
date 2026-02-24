import type { Game } from "../../game/Game";
import type { Link, Owner, Tower, World } from "../../sim/World";
import type { MissionWaveTelemetry } from "../../waves/WaveDirector";
import {
  type HudBadgeVM,
  type HudLogEntryVM,
  type HudTone,
  type HudVM,
  type SkillHotkeyVM,
} from "./types";

export interface BuildHudViewModelInput {
  game: Game;
  missionTitle: string;
  objectiveText: string;
  selectedTowerId: string | null;
  showSkills: boolean;
  showLogDrawer: boolean;
  missionEvents: readonly HudLogEntryVM[];
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
  const linkById = new Map<string, Link>();
  const towerById = new Map<string, Tower>();
  for (const link of world.links) {
    linkById.set(link.id, link);
  }
  for (const tower of world.towers) {
    towerById.set(tower.id, tower);
  }

  const incomingByTower = new Map<string, TowerPacketTraffic>();
  const outgoingPacketsByTower = new Map<string, number>();
  for (const packet of world.packets) {
    const link = linkById.get(packet.linkId);
    if (!link) {
      continue;
    }

    outgoingPacketsByTower.set(link.fromTowerId, (outgoingPacketsByTower.get(link.fromTowerId) ?? 0) + 1);

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

  const playerTowers = world.towers.filter((tower) => tower.owner === "player");
  const selectedTower = input.selectedTowerId ? towerById.get(input.selectedTowerId) ?? null : null;
  const largestClusterSize = playerTowers.reduce((best, tower) => Math.max(best, tower.territoryClusterSize ?? 0), 0);
  const completedWaves = telemetry
    ? Math.max(0, telemetry.currentWaveIndex - (telemetry.activeWaveInProgress ? 1 : 0))
    : 0;
  const totalWaves = telemetry?.totalWaveCount ?? 0;

  const context = selectedTower
    ? buildTowerContext(selectedTower, incomingByTower, outgoingPacketsByTower)
    : buildGlobalContext(world, playerTowers, largestClusterSize);

  return {
    missionTitle: input.missionTitle,
    objectiveText: input.objectiveText,
    threat: {
      waveLabel: telemetry
        ? `Wave ${Math.max(1, telemetry.currentWaveIndex)}/${telemetry.totalWaveCount}`
        : "Wave --/--",
      phaseLabel: getThreatPhaseLabel(telemetry),
      countdownLabel: getCountdownLabel(telemetry),
      countdownSec: telemetry?.nextWaveStartsInSec ?? null,
      threats: (telemetry?.nextWavePreview ?? []).map((entry) => ({
        id: `${entry.enemyId}-${entry.count}`,
        icon: entry.icon || "•",
        label: entry.enemyId,
        count: entry.count,
        etaSec: telemetry?.nextWaveStartsInSec ?? null,
      })),
      modifiers: (telemetry?.activeModifierNames ?? []).map((name, index) => toBadge(`mod-${index}`, name, "warning")),
    },
    tactical: {
      objective: {
        label: "Objective Progress",
        detail:
          totalWaves > 0
            ? `${completedWaves}/${totalWaves} waves secured`
            : "Awaiting wave telemetry",
        progress01: totalWaves > 0 ? clamp01(completedWaves / Math.max(1, totalWaves)) : 0,
      },
      globalBadges: buildGlobalBadges(telemetry),
      territory: {
        largestClusterSize,
        bonusBadges: buildTerritoryBonusBadges(largestClusterSize),
      },
      skills: input.showSkills ? buildSkillHotkeys(input.game) : [],
    },
    context: {
      mode: selectedTower ? "tower" : "global",
      globalSummary: selectedTower ? null : context.globalSummary,
      towerInspect: selectedTower ? context.towerInspect : null,
      logEntries: input.missionEvents.slice(0, 16),
      showLogDrawer: input.showLogDrawer,
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

function buildTowerContext(
  tower: Tower,
  incomingByTower: ReadonlyMap<string, TowerPacketTraffic>,
  outgoingPacketsByTower: ReadonlyMap<string, number>,
): {
  globalSummary: null;
  towerInspect: HudVM["context"]["towerInspect"];
} {
  const traffic = incomingByTower.get(tower.id);
  const incomingPackets = traffic?.incomingHostilePackets ?? 0;
  const outgoingPackets = outgoingPacketsByTower.get(tower.id) ?? 0;
  const threatLevel = incomingPackets >= 5 ? "high" : incomingPackets >= 2 ? "medium" : "low";

  return {
    globalSummary: null,
    towerInspect: {
      towerId: tower.id,
      owner: tower.owner,
      archetypeLabel: tower.archetype,
      troops: sanitizeNumber(tower.troops),
      maxTroops: sanitizeNumber(tower.maxTroops),
      regenPerSec: tower.owner === "neutral" ? 0 : sanitizeNumber(tower.effectiveRegen),
      incomingPackets,
      outgoingPackets,
      clusterSize: tower.owner === "player" ? tower.territoryClusterSize ?? 0 : 0,
      clusterBadges: tower.owner === "player" ? buildTowerClusterBadges(tower) : [],
      threatIncomingSoon: incomingPackets,
      threatLevel,
      controlHint:
        tower.owner === "player"
          ? "Drag from this tower to create outgoing links."
          : "Select a player tower, then drag to issue new routes.",
    },
  };
}

function buildGlobalContext(
  world: World,
  playerTowers: readonly Tower[],
  largestClusterSize: number,
): {
  globalSummary: HudVM["context"]["globalSummary"];
  towerInspect: null;
} {
  const totalRegenPerSec = playerTowers.reduce((sum, tower) => sum + sanitizeNumber(tower.effectiveRegen), 0);
  return {
    globalSummary: {
      ownedTowers: playerTowers.length,
      totalRegenPerSec,
      packetsInTransit: world.packets.length,
      clusterBonusActive: largestClusterSize >= 3,
    },
    towerInspect: null,
  };
}

function buildSkillHotkeys(game: Game): SkillHotkeyVM[] {
  const skills = game.getSkillHudState();
  return skills.map((skill, index) => ({
    id: skill.id,
    name: skill.name,
    targeting: skill.targeting,
    hotkeyLabel: String((index % 9) + 1),
    ready: skill.ready,
    cooldownRemainingSec: skill.cooldownRemainingSec,
    cooldownTotalSec: skill.cooldownTotalSec,
  }));
}

function buildGlobalBadges(telemetry: MissionWaveTelemetry | null): HudBadgeVM[] {
  if (!telemetry) {
    return [];
  }

  const badges: HudBadgeVM[] = [
    {
      id: "mission-gold",
      icon: "$",
      label: `Gold ${Math.floor(telemetry.missionGold)}`,
      tone: "neutral",
    },
  ];

  if (telemetry.activeBuffId) {
    badges.push({
      id: "active-buff",
      icon: "B",
      label: `${telemetry.activeBuffId} ${telemetry.activeBuffRemainingSec.toFixed(1)}s`,
      tone: "success",
    });
  }

  return badges;
}

function buildTerritoryBonusBadges(largestClusterSize: number): HudBadgeVM[] {
  const badges: HudBadgeVM[] = [];
  if (largestClusterSize >= 3) {
    badges.push({ id: "territory-regen", icon: "R", label: "Regen Bonus", tone: "success" });
  }
  if (largestClusterSize >= 5) {
    badges.push({ id: "territory-armor", icon: "A", label: "Armor Bonus", tone: "success" });
  }
  if (largestClusterSize >= 8) {
    badges.push({ id: "territory-vision", icon: "V", label: "Vision Bonus", tone: "success" });
  }
  return badges;
}

function buildTowerClusterBadges(tower: Tower): HudBadgeVM[] {
  const badges: HudBadgeVM[] = [];
  if ((tower.territoryRegenBonusPct ?? 0) > 0) {
    badges.push(toBadge("tower-regen", `Regen +${Math.round((tower.territoryRegenBonusPct ?? 0) * 100)}%`, "success"));
  }
  if ((tower.territoryArmorBonusPct ?? 0) > 0) {
    badges.push(toBadge("tower-armor", `Armor +${Math.round((tower.territoryArmorBonusPct ?? 0) * 100)}%`, "success"));
  }
  if ((tower.territoryVisionBonusPct ?? 0) > 0) {
    badges.push(toBadge("tower-vision", `Vision +${Math.round((tower.territoryVisionBonusPct ?? 0) * 100)}%`, "success"));
  }
  return badges;
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

function getThreatPhaseLabel(telemetry: MissionWaveTelemetry | null): string {
  if (!telemetry) {
    return "Awaiting telemetry";
  }
  if (telemetry.activeWaveInProgress) {
    return "Assault Active";
  }
  if (telemetry.currentWaveIndex >= telemetry.totalWaveCount) {
    return "Final Assault Cleared";
  }
  return "Staging";
}

function getCountdownLabel(telemetry: MissionWaveTelemetry | null): string {
  if (!telemetry) {
    return "Waiting";
  }
  if (telemetry.nextWaveStartsInSec === null) {
    return telemetry.activeWaveInProgress ? "Assault active" : "Final assault complete";
  }
  return `${Math.ceil(telemetry.nextWaveStartsInSec)}s`;
}

function toBadge(id: string, label: string, tone: HudTone): HudBadgeVM {
  const words = label.split(/\s+/).filter((word) => word.length > 0);
  const icon = words.length === 0 ? "•" : words[0][0]?.toUpperCase() ?? "•";
  return {
    id,
    icon,
    label,
    tone,
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
