import { describe, expect, it } from "vitest";
import { getProjectWriteTargetCandidates } from "../src/tools/level_editor/io/exportChanged";

describe("getProjectWriteTargetCandidates", () => {
  it("writes data documents to public data and mirrors to root data when present", () => {
    expect(getProjectWriteTargetCandidates("/data/towerArchetypes.json")).toEqual({
      primaryPath: "public/data/towerArchetypes.json",
      mirrorPath: "data/towerArchetypes.json",
    });
  });

  it("writes level documents to root levels and mirrors to public levels when present", () => {
    expect(getProjectWriteTargetCandidates("/levels/v2/map_t01.json")).toEqual({
      primaryPath: "levels/v2/map_t01.json",
      mirrorPath: "public/levels/v2/map_t01.json",
    });
  });

  it("normalizes generic workspace paths", () => {
    expect(getProjectWriteTargetCandidates("misc/config.json")).toEqual({
      primaryPath: "misc/config.json",
      mirrorPath: null,
    });
  });
});
