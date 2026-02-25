/*
 * Patch Notes (2026-02-24):
 * - Added runtime territory scaling support for stage-driven difficulty context.
 */

import type { Link, Owner, Tower, UnitPacket } from "./World";

export interface ConnectedCluster {
  towers: Tower[];
  size: number;
}

export interface TerritoryBonusConfig {
  regenThreshold: number;
  armorThreshold: number;
  visionThreshold: number;
  regenBonus: number;
  armorBonus: number;
  visionBonus: number;
}

export interface TerritoryScalingRuntime {
  regenPerCluster: number;
  armorPerCluster: number;
  visionPerCluster: number;
}

export const TERRITORY_BONUSES: TerritoryBonusConfig = {
  regenThreshold: 3,
  armorThreshold: 5,
  visionThreshold: 8,
  regenBonus: 0.10,
  armorBonus: 0.15,
  visionBonus: 0.20,
};

interface TerritoryWorldView {
  towers: Tower[];
  links: Link[];
  packets: UnitPacket[];
  getTowerById(towerId: string): Tower | null;
  getLinkById(linkId: string): Link | null;
}

const DEFAULT_TOWER_VISION_RADIUS = 170;
const MAX_EFFECTIVE_ARMOR = 0.95;
const MIN_EFFECTIVE_ARMOR = -3;

export function computeConnectedClusters(world: Pick<TerritoryWorldView, "towers" | "links">, playerId: Owner): ConnectedCluster[] {
  const ownedTowers: Tower[] = [];
  const towerById = new Map<string, Tower>();
  const adjacency = new Map<string, string[]>();

  for (const tower of world.towers) {
    if (tower.owner !== playerId) {
      continue;
    }

    ownedTowers.push(tower);
    towerById.set(tower.id, tower);
    adjacency.set(tower.id, []);
  }

  if (ownedTowers.length === 0) {
    return [];
  }

  for (const link of world.links) {
    if (!towerById.has(link.fromTowerId) || !towerById.has(link.toTowerId)) {
      continue;
    }

    adjacency.get(link.fromTowerId)?.push(link.toTowerId);
    adjacency.get(link.toTowerId)?.push(link.fromTowerId);
  }

  const visited = new Set<string>();
  const clusters: ConnectedCluster[] = [];

  for (const tower of ownedTowers) {
    if (visited.has(tower.id)) {
      continue;
    }

    const stack = [tower.id];
    visited.add(tower.id);
    const clusterTowers: Tower[] = [];

    while (stack.length > 0) {
      const currentId = stack.pop();
      if (!currentId) {
        continue;
      }

      const currentTower = towerById.get(currentId);
      if (!currentTower) {
        continue;
      }
      clusterTowers.push(currentTower);

      const neighbors = adjacency.get(currentId) ?? [];
      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) {
          continue;
        }
        visited.add(neighborId);
        stack.push(neighborId);
      }
    }

    clusterTowers.sort((a, b) => a.id.localeCompare(b.id));
    clusters.push({
      towers: clusterTowers,
      size: clusterTowers.length,
    });
  }

  return clusters;
}

export function applyTerritoryControlBonuses(
  world: TerritoryWorldView,
  playerId: Owner,
  config: TerritoryBonusConfig = TERRITORY_BONUSES,
  scaling?: TerritoryScalingRuntime,
): ConnectedCluster[] {
  const clusterSizeByTower = new Map<string, number>();

  for (const tower of world.towers) {
    const resolvedBaseRegen = Number.isFinite(tower.baseRegen)
      ? tower.baseRegen
      : Number.isFinite(tower.baseRegenRate)
        ? tower.baseRegenRate
        : tower.regenRate;
    const resolvedBaseVision = Number.isFinite(tower.baseVision)
      ? tower.baseVision
      : DEFAULT_TOWER_VISION_RADIUS;

    tower.baseRegen = Math.max(0, resolvedBaseRegen);
    tower.baseRegenRate = tower.baseRegen;
    tower.baseVision = Math.max(0, resolvedBaseVision);
    tower.territoryClusterSize = 0;
    tower.territoryRegenBonusPct = 0;
    tower.territoryArmorBonusPct = 0;
    tower.territoryVisionBonusPct = 0;
    tower.effectiveRegen = tower.baseRegen;
    tower.effectiveVision = tower.baseVision;
    tower.regenRate = tower.effectiveRegen;
  }

  const clusters = computeConnectedClusters(world, playerId);

  for (const cluster of clusters) {
    const regenBonusPct = resolveClusterBonusPct(
      cluster.size,
      config.regenThreshold,
      config.regenBonus,
      scaling?.regenPerCluster,
    );
    const armorBonusPct = resolveClusterBonusPct(
      cluster.size,
      config.armorThreshold,
      config.armorBonus,
      scaling?.armorPerCluster,
    );
    const visionBonusPct = resolveClusterBonusPct(
      cluster.size,
      config.visionThreshold,
      config.visionBonus,
      scaling?.visionPerCluster,
    );

    for (const tower of cluster.towers) {
      tower.territoryClusterSize = cluster.size;
      tower.territoryRegenBonusPct = regenBonusPct;
      tower.territoryArmorBonusPct = armorBonusPct;
      tower.territoryVisionBonusPct = visionBonusPct;
      tower.effectiveRegen = tower.baseRegen * (1 + regenBonusPct);
      tower.effectiveVision = tower.baseVision * (1 + visionBonusPct);
      tower.regenRate = tower.effectiveRegen;
      clusterSizeByTower.set(tower.id, cluster.size);
    }
  }

  for (const packet of world.packets) {
    if (!Number.isFinite(packet.baseArmor)) {
      packet.baseArmor = armorFromMultiplier(packet.baseArmorMultiplier);
    }

    packet.territoryArmorBonus = 0;

    if (packet.owner === playerId) {
      const link = world.getLinkById(packet.linkId);
      const originTower = link ? world.getTowerById(link.fromTowerId) : null;
      const clusterSize = originTower ? clusterSizeByTower.get(originTower.id) ?? 0 : 0;

      if (clusterSize >= config.armorThreshold) {
        packet.territoryArmorBonus = config.armorBonus;
      }
    }

    const runtimeArmor = armorFromMultiplier(
      packet.tempArmorMultiplier > 0 ? packet.tempArmorMultiplier : packet.baseArmorMultiplier,
    );
    packet.effectiveArmor = combineArmorMultiplicative([
      runtimeArmor,
      packet.territoryArmorBonus,
    ]);
  }

  return clusters;
}

export function armorFromMultiplier(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return 0;
  }
  return clampArmor(1 - 1 / multiplier);
}

export function combineArmorMultiplicative(armorSources: readonly number[]): number {
  let damageMultiplier = 1;

  for (const armor of armorSources) {
    const clampedArmor = clampArmor(armor);
    damageMultiplier *= 1 - clampedArmor;
  }

  return clampArmor(1 - damageMultiplier);
}

function clampArmor(armor: number): number {
  if (!Number.isFinite(armor)) {
    return 0;
  }
  return Math.max(MIN_EFFECTIVE_ARMOR, Math.min(MAX_EFFECTIVE_ARMOR, armor));
}

function resolveClusterBonusPct(
  clusterSize: number,
  threshold: number,
  fallbackBonus: number,
  perClusterBonus?: number,
): number {
  if (clusterSize < threshold) {
    return 0;
  }

  if (perClusterBonus === undefined || !Number.isFinite(perClusterBonus)) {
    return Math.max(0, fallbackBonus);
  }

  const clusterSteps = clusterSize - threshold + 1;
  return Math.max(0, perClusterBonus * clusterSteps);
}
