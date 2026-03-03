import { describe, expect, it } from "vitest";
import {
  createTowerDictionaryStore,
  parseTowerDictionaryFromRaw,
  serializeTowerDictionaryToRaw,
} from "../src/tools/level_editor/data/TowerDictionaryStore";
import type { LevelEditorWorkspace } from "../src/tools/level_editor/model/types";

const DOC_PATH = "/data/towerArchetypes.json";

function makeWorkspace(rawData: Record<string, unknown>): LevelEditorWorkspace {
  return {
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    order: [DOC_PATH],
    docs: {
      [DOC_PATH]: {
        id: DOC_PATH,
        path: DOC_PATH,
        label: "towerArchetypes.json",
        kind: "tower-archetypes",
        group: "globals",
        originalRaw: `${JSON.stringify(rawData, null, 2)}\n`,
        currentRaw: `${JSON.stringify(rawData, null, 2)}\n`,
        originalData: rawData,
        currentData: rawData,
        parseError: null,
        loadError: null,
        isSynthetic: false,
      },
    },
  };
}

function makeRawDocument(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    version: 7,
    notes: "preserve me",
    baseline: {
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
    archetypes: {
      STRONGHOLD: {
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
        displayName: "Stronghold",
        art: {
          atlasId: "buildings",
          spriteKey: "keep",
          frameIndex: 0,
        },
      },
      BARRACKS: {
        icon: "B",
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
        displayName: "Barracks",
        art: {
          atlasId: "buildings",
          spriteKey: "barracks",
          frameIndex: 0,
        },
      },
    },
  };
}

describe("TowerDictionaryStore", () => {
  it("loads dictionary from workspace and saves updates", async () => {
    let workspace = makeWorkspace(makeRawDocument());
    const store = createTowerDictionaryStore({
      getWorkspace: () => workspace,
      commitWorkspace: (updater) => {
        workspace = updater(workspace);
      },
    });

    const dictionary = await store.loadTowerDictionary();
    expect(dictionary.order).toEqual(["STRONGHOLD", "BARRACKS"]);

    dictionary.towers.BARRACKS.gameplay.goldPerSecond = 2.5;
    dictionary.order = ["BARRACKS", "STRONGHOLD"];
    await store.saveTowerDictionary(dictionary);

    const savedDoc = workspace.docs[DOC_PATH];
    expect(savedDoc).toBeDefined();
    const savedRaw = savedDoc?.currentData as Record<string, unknown>;
    expect(savedRaw.notes).toBe("preserve me");
    expect(Object.keys(savedRaw.archetypes as Record<string, unknown>)).toEqual(["BARRACKS", "STRONGHOLD"]);
  });

  it("round-trips parse + serialize with stable tower ordering", () => {
    const raw = makeRawDocument();
    const parsed = parseTowerDictionaryFromRaw(raw);
    parsed.order = ["BARRACKS", "STRONGHOLD"];

    const serialized = serializeTowerDictionaryToRaw(parsed, raw);
    const reparsed = parseTowerDictionaryFromRaw(serialized);

    expect(reparsed.order).toEqual(["BARRACKS", "STRONGHOLD"]);
    expect(reparsed.towers.BARRACKS.displayName).toBe("Barracks");
  });
});
