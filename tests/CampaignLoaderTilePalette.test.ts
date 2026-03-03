import { describe, expect, it } from "vitest";
import { buildLevelJsonFromCampaignMap } from "../src/campaign/CampaignLoader";
import type { CampaignMapDefinition, ResolvedCampaignWavePlan } from "../src/campaign/CampaignTypes";
import { computeShorelineMask } from "../src/levels/TilePalette";

function makeMap(): CampaignMapDefinition {
  return {
    id: "map_test_tile_palette",
    size: {
      w: 18,
      h: 12,
    },
    nodes: [
      { id: "p_start", x: 3, y: 6, owner: "player", tier: 2, cap: 120, regen: 3.1 },
      { id: "mid", x: 8, y: 6, owner: "neutral", tier: 1, cap: 78, regen: 1.2 },
      { id: "e_start", x: 14, y: 6, owner: "enemy", tier: 2, cap: 120, regen: 3.0 },
    ],
    links: [
      { a: "p_start", b: "mid" },
      { a: "mid", b: "e_start" },
    ],
    tags: {
      chokepoints: 0.2,
      linkDensity: 1.2,
      lanes: 1,
    },
  };
}

function makeWavePlan(): ResolvedCampaignWavePlan {
  return {
    preset: "test_preset",
    waves: 3,
    missionDifficultyScalar: 1,
    firstAppearanceWave: 1,
    minibossWave: undefined,
    bossEnabled: false,
  };
}

describe("CampaignLoader tile palette shoreline overrides", () => {
  it("uses maskToTileIndex for shoreline cells on generated terrain", () => {
    const shorelineOverrides: Record<string, number> = {
      1: 801,
      2: 802,
      4: 804,
      8: 808,
      5: 805,
      9: 809,
      6: 806,
      10: 810,
    };
    const waterTile = 700;
    const level = buildLevelJsonFromCampaignMap(
      "training",
      "tile_palette_test",
      "Tile Palette Test",
      "Validate shoreline masks.",
      makeMap(),
      makeWavePlan(),
      "m01",
      undefined,
      {
        waterBase: waterTile,
        grassBase: 701,
        road: {
          straight: 720,
          corner: 721,
        },
        shoreline: {
          maskToTileIndex: shorelineOverrides,
        },
      },
    );

    const terrain = level.terrain;
    expect(terrain).toBeDefined();
    if (!terrain) {
      return;
    }

    const width = terrain.width;
    const height = terrain.height;
    const ground = terrain.layers.ground;
    let checkedBorderShorelineCells = 0;

    for (let row = 1; row < height - 1; row += 1) {
      for (let col = 1; col < width - 1; col += 1) {
        const isBorderRing = row === 1 || row === height - 2 || col === 1 || col === width - 2;
        if (!isBorderRing) {
          continue;
        }

        const index = row * width + col;
        if (ground[index] === waterTile) {
          continue;
        }

        const northWater = ground[(row - 1) * width + col] === waterTile;
        const southWater = ground[(row + 1) * width + col] === waterTile;
        const westWater = ground[row * width + (col - 1)] === waterTile;
        const eastWater = ground[row * width + (col + 1)] === waterTile;
        const mask = computeShorelineMask(northWater, southWater, westWater, eastWater);
        const expected = shorelineOverrides[String(mask)];
        if (expected === undefined) {
          continue;
        }

        expect(ground[index]).toBe(expected);
        checkedBorderShorelineCells += 1;
      }
    }

    expect(checkedBorderShorelineCells).toBeGreaterThan(0);
  });
});
