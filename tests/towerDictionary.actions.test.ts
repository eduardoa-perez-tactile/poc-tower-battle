import { describe, expect, it } from "vitest";
import {
  createTower,
  createUniqueTowerId,
  deleteTower,
  duplicateTower,
  revertTower,
} from "../src/tools/level_editor/domain/towerDictionaryActions";
import type { TowerDictionary } from "../src/tools/level_editor/types/towerDictionary";

function makeDictionary(): TowerDictionary {
  return {
    schemaVersion: 1,
    version: 1,
    baseline: {
      gameplay: {
        icon: "S",
        regenRateBonusPct: 0,
        maxTroopsBonusPct: 0,
        defenseMultiplierAdd: 0,
        packetDamageBonusPct: 0,
        linkSpeedBonusPct: 0,
        extraOutgoingLinks: 0,
        auraRadius: 0,
        auraRegenBonusPct: 0,
        captureSpeedTakenMultiplierAdd: 0,
        goldPerSecond: 0,
        recaptureBonusGold: 0,
      },
      raw: {},
    },
    towers: {
      STRONGHOLD: {
        id: "STRONGHOLD",
        displayName: "Stronghold",
        description: "",
        category: "",
        tags: [],
        ownershipDefault: "neutral",
        gameplay: {
          icon: "S",
          regenRateBonusPct: 0.1,
          maxTroopsBonusPct: 0.2,
          defenseMultiplierAdd: 0,
          packetDamageBonusPct: 0,
          linkSpeedBonusPct: 0,
          extraOutgoingLinks: 0,
          auraRadius: 0,
          auraRegenBonusPct: 0,
          captureSpeedTakenMultiplierAdd: 0,
          goldPerSecond: 0,
          recaptureBonusGold: 0,
        },
        art: {
          atlasId: "buildings",
          spriteKey: "keep",
          frameIndex: 0,
          scale: 1,
        },
        raw: {},
      },
    },
    order: ["STRONGHOLD"],
  };
}

describe("towerDictionaryActions", () => {
  it("creates a new tower with a unique id", () => {
    const dictionary = makeDictionary();
    const id = createUniqueTowerId(dictionary, "stronghold");
    expect(id).toBe("STRONGHOLD_2");

    const next = createTower(dictionary, "relay");
    expect(next.towers.RELAY).toBeDefined();
    expect(next.order[next.order.length - 1]).toBe("RELAY");
  });

  it("duplicates and deletes towers", () => {
    const dictionary = makeDictionary();
    const duplicated = duplicateTower(dictionary, "STRONGHOLD", "stronghold_copy");
    expect(duplicated.towers.STRONGHOLD_COPY).toBeDefined();
    expect(duplicated.order).toEqual(["STRONGHOLD", "STRONGHOLD_COPY"]);

    const removed = deleteTower(duplicated, "STRONGHOLD_COPY");
    expect(removed.towers.STRONGHOLD_COPY).toBeUndefined();
    expect(removed.order).toEqual(["STRONGHOLD"]);
  });

  it("reverts a tower to applied state", () => {
    const applied = makeDictionary();
    const draft = makeDictionary();
    draft.towers.STRONGHOLD.displayName = "Edited Name";

    const reverted = revertTower(draft, applied, "STRONGHOLD");
    expect(reverted.towers.STRONGHOLD.displayName).toBe("Stronghold");
  });
});
