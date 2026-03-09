import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRuntimeLevelFromLevel } from "../src/levels/adapter";
import { parseLevelJson } from "../src/levels/loader";
import { canCreateLink, getNeighbors } from "../src/sim/LinkRules";
import { updateWorld } from "../src/sim/Simulation";
import { World, type Owner } from "../src/sim/World";

const PLAYABLE_OWNERS: readonly Owner[] = ["player", "red", "green", "yellow"];
const AI_DEFENSE_WEIGHT = 2;

interface LinkLevelEntry {
  level: number;
  speedMultiplier: number;
  armorBonus: number;
  damageBonus: number;
  integrity: number;
  overchargeDrain: number;
}

function loadSkirmishLevel() {
  const raw = JSON.parse(
    readFileSync(new URL("../levels/skirmish/skirmish_4p.json", import.meta.url), "utf8"),
  ) as unknown;
  return parseLevelJson(raw, "levels/skirmish/skirmish_4p.json");
}

function loadLinkLevels() {
  const raw = JSON.parse(
    readFileSync(new URL("../public/data/linkLevels.json", import.meta.url), "utf8"),
  ) as { levels: LinkLevelEntry[] };

  return new Map(
    raw.levels.map((entry) => [
      Math.floor(entry.level),
      {
        level: Math.floor(entry.level),
        speedMultiplier: entry.speedMultiplier,
        armorBonus: entry.armorBonus,
        damageBonus: entry.damageBonus,
        integrity: entry.integrity,
        overchargeDrain: entry.overchargeDrain,
      },
    ]),
  );
}

function aliveOwners(world: World): Owner[] {
  return PLAYABLE_OWNERS.filter((owner) => world.towers.some((tower) => tower.owner === owner));
}

function runProxyAiDecision(world: World, minTroopsToAttack: number): void {
  for (const owner of PLAYABLE_OWNERS) {
    const candidateSources = world.towers.filter(
      (tower) => tower.owner === owner && tower.troops >= minTroopsToAttack,
    );
    if (candidateSources.length === 0) {
      continue;
    }

    let bestSourceId = "";
    let bestTargetId = "";
    let bestScore = Number.POSITIVE_INFINITY;
    let bestKey = "";

    for (const source of candidateSources) {
      for (const neighborId of getNeighbors(world, source.id)) {
        const target = world.getTowerById(neighborId);
        if (!target || target.owner === source.owner) {
          continue;
        }

        const validation = canCreateLink(world, source.id, target.id, source.owner);
        if (!validation.ok) {
          continue;
        }

        const score =
          Math.hypot(target.x - source.x, target.y - source.y) +
          AI_DEFENSE_WEIGHT * (target.troops + target.hp);
        const key = `${source.id}->${target.id}`;
        if (score < bestScore || (score === bestScore && (bestKey === "" || key < bestKey))) {
          bestScore = score;
          bestSourceId = source.id;
          bestTargetId = target.id;
          bestKey = key;
        }
      }
    }

    if (bestSourceId && bestTargetId) {
      world.setOutgoingLink(bestSourceId, bestTargetId);
    }
  }
}

describe("skirmish_4p layout", () => {
  it("uses a smaller corner-based topology", () => {
    const level = loadSkirmishLevel();
    const positions = new Map(level.nodes.map((node) => [node.id, node]));

    expect(level.grid.width).toBe(24);
    expect(level.grid.height).toBe(18);
    expect(level.size).toBe("medium");
    expect(positions.get("nw_home")).toMatchObject({ owner: "player", x: 2, y: 2 });
    expect(positions.get("ne_home")).toMatchObject({ owner: "red", x: 21, y: 2 });
    expect(positions.get("se_home")).toMatchObject({ owner: "green", x: 21, y: 15 });
    expect(positions.get("sw_home")).toMatchObject({ owner: "yellow", x: 2, y: 15 });
  });

  it("leans toward the blue side in a four-faction proxy sim", () => {
    const level = loadSkirmishLevel();
    const runtime = buildRuntimeLevelFromLevel(level, {
      viewport: { width: 1600, height: 900 },
    });
    const world = new World(
      runtime.towers,
      runtime.rules.maxOutgoingLinksPerTower,
      loadLinkLevels(),
      runtime.initialLinks,
      1,
      runtime.graphEdges,
    );

    const stepSec = 1 / 30;
    let simSec = 0;
    let aiAccumulatorSec = 0;

    while (simSec < 900 && aliveOwners(world).length > 1) {
      updateWorld(world, stepSec, runtime.rules);
      aiAccumulatorSec += stepSec;
      while (aiAccumulatorSec >= runtime.ai.aiThinkIntervalSec) {
        aiAccumulatorSec -= runtime.ai.aiThinkIntervalSec;
        runProxyAiDecision(world, runtime.ai.aiMinTroopsToAttack);
      }
      simSec += stepSec;
    }

    const ownerCounts = new Map(
      PLAYABLE_OWNERS.map((owner) => [
        owner,
        world.towers.filter((tower) => tower.owner === owner).length,
      ]),
    );
    const bestRivalCount = Math.max(
      ownerCounts.get("red") ?? 0,
      ownerCounts.get("green") ?? 0,
      ownerCounts.get("yellow") ?? 0,
    );

    expect(ownerCounts.get("player")).toBeGreaterThan(bestRivalCount);
  });
});
