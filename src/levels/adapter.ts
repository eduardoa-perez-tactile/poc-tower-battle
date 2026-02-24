import { parseTowerArchetype } from "../sim/DepthConfig";
import { TowerArchetype } from "../sim/DepthTypes";
import type { Tower } from "../sim/World";
import { createGridWorldTransform, gridBoundsWorld, gridToWorld, type ViewportSize } from "./grid";
import type { LoadedLevel } from "./runtime";
import type { LevelJson, LevelNode } from "./types";

const DEFAULT_RULES: LoadedLevel["rules"] = {
  maxOutgoingLinksPerTower: 1,
  sendRatePerSec: 6,
  collisionDistancePx: 14,
  captureSeedTroops: 10,
  captureRateMultiplier: 1,
  playerCaptureEfficiencyMul: 1,
  regenMinPerSec: 0,
  regenMaxPerSec: 8,
  playerRegenMultiplier: 1,
  enemyRegenMultiplier: 1,
  defaultPacketArmor: 1,
  playerPacketArmorAdd: 0,
  playerPacketArmorMul: 1,
  linkDecayPerSec: 0,
  linkDecayCanBreak: false,
  packetStatCaps: {
    speedMin: 25,
    speedMax: 420,
    damageMin: 0.2,
    damageMax: 14,
    hpMin: 0.2,
    hpMax: 220,
    armorMin: 0.2,
    armorMax: 4,
  },
  fightModel: {
    shieldArmorUptimeMultiplier: 1.8,
    combatHoldFactor: 0.45,
    rangedHoldFactor: 0.65,
    linkCutterHoldFactor: 0.4,
  },
  defaultUnit: {
    speedPxPerSec: 120,
    dpsPerUnit: 1,
    hpPerUnit: 1,
  },
};

const DEFAULT_AI: LoadedLevel["ai"] = {
  aiThinkIntervalSec: 2.5,
  aiMinTroopsToAttack: 25,
};

interface BuildRuntimeLevelOptions {
  viewport: ViewportSize;
}

export function buildRuntimeLevelFromLevel(
  level: LevelJson,
  options: BuildRuntimeLevelOptions,
): LoadedLevel {
  const transform = createGridWorldTransform(level.grid, options.viewport);
  const nodesById = new Map<string, LevelNode>();

  const towers: Tower[] = level.nodes.map((node) => {
    nodesById.set(node.id, node);
    const world = gridToWorld(node.x, node.y, transform);
    const defaults = getNodeDefaults(node);

    const maxTroops = sanitizePositive(node.cap ?? defaults.maxTroops, defaults.maxTroops);
    const regenRate = sanitizePositive(node.regen ?? defaults.regenRate, defaults.regenRate);
    const maxHp = sanitizePositive(node.maxHp ?? defaults.maxHp, defaults.maxHp);
    const hp = sanitizePositive(node.hp ?? maxHp, maxHp);
    const troops = sanitizePositive(node.troops ?? defaults.troops, defaults.troops);

    const archetype = parseTowerArchetype(
      node.archetype,
      node.type === "stronghold" ? TowerArchetype.STRONGHOLD : TowerArchetype.BARRACKS,
    );

    return {
      id: node.id,
      x: world.x,
      y: world.y,
      owner: node.owner,
      maxHp,
      hp: Math.min(maxHp, hp),
      troops: Math.min(maxTroops, troops),
      maxTroops,
      regenRate,
      baseMaxTroops: maxTroops,
      baseRegenRate: regenRate,
      archetype,
      defenseMultiplier: 1,
      packetDamageMultiplier: 1,
      linkSpeedBonus: 0,
      extraOutgoingLinks: 0,
      auraRadius: 0,
      auraRegenBonusPct: 0,
      captureSpeedTakenMultiplier: 1,
      goldPerSecond: 0,
      recaptureBonusGold: 0,
      archetypeIcon: "",
    };
  });

  const towersById = new Map<string, Tower>();
  for (const tower of towers) {
    towersById.set(tower.id, tower);
  }

  // Graph edges are level topology data and map visuals; runtime links still start empty
  // so existing link mechanics and AI behavior are preserved.
  const initialLinks: LoadedLevel["initialLinks"] = [];

  const runtimeRules = level.runtime?.rules;
  const runtimeAi = level.runtime?.ai;
  const mergedRules = {
    ...DEFAULT_RULES,
    ...(runtimeRules?.maxOutgoingLinksPerTower !== undefined
      ? { maxOutgoingLinksPerTower: runtimeRules.maxOutgoingLinksPerTower }
      : {}),
    ...(runtimeRules?.sendRatePerSec !== undefined
      ? { sendRatePerSec: runtimeRules.sendRatePerSec }
      : {}),
    ...(runtimeRules?.collisionDistancePx !== undefined
      ? { collisionDistancePx: runtimeRules.collisionDistancePx }
      : {}),
    ...(runtimeRules?.captureSeedTroops !== undefined
      ? { captureSeedTroops: runtimeRules.captureSeedTroops }
      : {}),
    defaultUnit: {
      ...DEFAULT_RULES.defaultUnit,
      ...(runtimeRules?.defaultUnit?.speedPxPerSec !== undefined
        ? { speedPxPerSec: runtimeRules.defaultUnit.speedPxPerSec }
        : {}),
      ...(runtimeRules?.defaultUnit?.dpsPerUnit !== undefined
        ? { dpsPerUnit: runtimeRules.defaultUnit.dpsPerUnit }
        : {}),
      ...(runtimeRules?.defaultUnit?.hpPerUnit !== undefined
        ? { hpPerUnit: runtimeRules.defaultUnit.hpPerUnit }
        : {}),
    },
  };
  const mergedAi = {
    ...DEFAULT_AI,
    ...(runtimeAi?.aiThinkIntervalSec !== undefined
      ? { aiThinkIntervalSec: runtimeAi.aiThinkIntervalSec }
      : {}),
    ...(runtimeAi?.aiMinTroopsToAttack !== undefined
      ? { aiMinTroopsToAttack: runtimeAi.aiMinTroopsToAttack }
      : {}),
  };

  const renderNodes = towers.map((tower) => ({ id: tower.id, x: tower.x, y: tower.y }));
  const renderEdges = level.edges
    .map((edge) => {
      const from = towersById.get(edge.from);
      const to = towersById.get(edge.to);
      if (!from || !to) {
        return null;
      }
      return {
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
      };
    })
    .filter((edge): edge is { fromX: number; fromY: number; toX: number; toY: number } => edge !== null);

  return {
    towers,
    initialLinks,
    rules: mergedRules,
    ai: mergedAi,
    mapRenderData: {
      gridWidth: level.grid.width,
      gridHeight: level.grid.height,
      cellSize: transform.cellSize,
      originX: transform.originX,
      originY: transform.originY,
      bounds: gridBoundsWorld(transform),
      nodes: renderNodes,
      edges: renderEdges,
    },
  };
}

function getNodeDefaults(node: LevelNode): {
  maxTroops: number;
  regenRate: number;
  maxHp: number;
  troops: number;
} {
  if (node.type === "stronghold") {
    return {
      maxTroops: 120,
      regenRate: 3,
      maxHp: 60,
      troops: node.owner === "player" ? 40 : 32,
    };
  }

  if (node.owner === "enemy") {
    return {
      maxTroops: 90,
      regenRate: 2,
      maxHp: 50,
      troops: 20,
    };
  }

  if (node.owner === "player") {
    return {
      maxTroops: 90,
      regenRate: 2,
      maxHp: 50,
      troops: 20,
    };
  }

  return {
    maxTroops: 70,
    regenRate: 1,
    maxHp: 40,
    troops: 15,
  };
}

function sanitizePositive(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}
