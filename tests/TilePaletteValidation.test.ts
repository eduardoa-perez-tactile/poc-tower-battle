import { describe, expect, it } from "vitest";
import { parseLevelJson } from "../src/levels/loader";
import { validateTilePaletteWhenEnabled } from "../src/levels/TilePalette";
import type { LevelJson } from "../src/levels/types";

function makeLevelJson(): LevelJson {
  return {
    version: 1,
    stageId: "test-stage",
    levelId: "test-level",
    name: "Test Level",
    size: "small",
    grid: {
      width: 8,
      height: 8,
      minCellSize: 38,
      layers: {
        ground: {
          default: "grass",
          overrides: [],
        },
        decor: {
          overrides: [],
        },
        blocked: [],
      },
    },
    nodes: [
      {
        id: "HQ",
        x: 2,
        y: 4,
        type: "stronghold",
        owner: "player",
      },
      {
        id: "E",
        x: 6,
        y: 4,
        type: "stronghold",
        owner: "enemy",
      },
    ],
    edges: [{ from: "HQ", to: "E" }],
    missions: [
      {
        missionId: "m01",
        name: "Mission",
        seed: 12345,
        waveSetId: "waves_basic_01",
        objectiveText: "Hold the line.",
      },
    ],
  };
}

describe("tile palette parse + validation", () => {
  it("loads a level without tilePalette", () => {
    const parsed = parseLevelJson(makeLevelJson(), "test-level");
    expect(parsed.tilePalette).toBeUndefined();
  });

  it("preserves tilePalette through save/reload parse", () => {
    const level = makeLevelJson();
    level.tilePalette = {
      waterBase: 396,
      grassBase: 324,
      road: {
        straight: 432,
        corner: 433,
        t: 434,
      },
      shoreline: {
        maskToTileIndex: {
          1: 414,
          2: 384,
          4: 278,
          8: 288,
          5: 429,
          9: 414,
          6: 384,
          10: 373,
        },
      },
    };

    const parsed = parseLevelJson(level, "test-level");
    const reloaded = parseLevelJson(JSON.parse(JSON.stringify(parsed)) as unknown, "test-level-reload");
    expect(reloaded.tilePalette).toEqual(parsed.tilePalette);
  });

  it("rejects incomplete overrides when enabled", () => {
    const issues = validateTilePaletteWhenEnabled({
      waterBase: 396,
      road: {
        straight: 432,
      },
      shoreline: {
        maskToTileIndex: {
          1: 414,
        },
      },
    });

    const fields = new Set(issues.map((issue) => issue.fieldPath));
    expect(fields.has("tilePalette.grassBase")).toBe(true);
    expect(fields.has("tilePalette.road.corner")).toBe(true);
    expect(fields.has("tilePalette.shoreline.maskToTileIndex.10")).toBe(true);
  });
});
