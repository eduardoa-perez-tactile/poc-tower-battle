import { describe, expect, it } from "vitest";
import { validateTowerDictionary } from "../src/tools/level_editor/domain/towerDictionaryValidation";
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
        category: "defense",
        tags: ["starter"],
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

describe("towerDictionaryValidation", () => {
  it("accepts a valid dictionary", () => {
    const issues = validateTowerDictionary(makeDictionary(), {
      knownSpriteKeys: new Set(["keep"]),
    });

    expect(issues).toHaveLength(0);
  });

  it("reports field-level errors for invalid values", () => {
    const dictionary = makeDictionary();
    dictionary.towers.STRONGHOLD.displayName = "";
    dictionary.towers.STRONGHOLD.gameplay.goldPerSecond = -4;
    dictionary.towers.STRONGHOLD.art.spriteKey = "";

    const issues = validateTowerDictionary(dictionary, {
      knownSpriteKeys: new Set(["keep"]),
    });

    const paths = new Set(issues.map((issue) => issue.fieldPath));
    expect(paths.has("displayName")).toBe(true);
    expect(paths.has("gameplay.goldPerSecond")).toBe(true);
    expect(paths.has("art.spriteKey")).toBe(true);
  });

  it("flags unknown sprite keys when registry is available", () => {
    const dictionary = makeDictionary();
    dictionary.towers.STRONGHOLD.art.spriteKey = "not_found";

    const issues = validateTowerDictionary(dictionary, {
      knownSpriteKeys: new Set(["keep"]),
    });

    expect(issues.some((issue) => issue.fieldPath === "art.spriteKey")).toBe(true);
  });
});
