import { describe, it, expect } from "vitest";
import { runW2Seed } from "../src/cli/world2.js";
import { renderBuildingLine } from "../src/chronicle/biography2.js";
import { BUILDING_KINDS } from "../src/schema/world2.js";

function sum(rec: Record<string, number>): number {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}

describe("runW2Seed", () => {
  it("is deterministic: same seedRoot/ticks/chunk twice -> identical result", () => {
    const a = runW2Seed("w2-t", 3000, 1000);
    const b = runW2Seed("w2-t", 3000, 1000);
    expect(a).toEqual(b);
  });

  // NOTE: under the current default w2 manifest/mechanics, this founder population
  // does not survive the full 3000 ticks (extinction observed by ~tick 700-800 in
  // every seed tried during implementation, dominated by "cold" and "old_age" -
  // see the Task 7 report for details). runW2Seed stops early on extinction (by
  // design, matching the v1 degradation/arms CLIs), so fewer than 3 chunks can
  // land here. This is a world-balance question for Task 8, not something this
  // CLI's test should paper over by forcing survival.
  it("produces at most one snapshot per chunk (fewer if extinction halts the run early), with bounded verb/goal share sums and all building keys present", () => {
    const result = runW2Seed("w2-t", 3000, 1000);
    expect(result.snapshots.length).toBeGreaterThanOrEqual(1);
    expect(result.snapshots.length).toBeLessThanOrEqual(3);

    for (const snap of result.snapshots) {
      const verbSum = sum(snap.verbShares1000);
      expect(verbSum).toBeGreaterThan(900);
      expect(verbSum).toBeLessThanOrEqual(1000);

      const goalSum = sum(snap.goalShares1000);
      expect(goalSum).toBeGreaterThan(900);
      expect(goalSum).toBeLessThanOrEqual(1000);

      for (const kind of BUILDING_KINDS) {
        expect(snap.buildings).toHaveProperty(kind);
      }
    }
  });
});

describe("renderBuildingLine", () => {
  it("shelter sentence", () => {
    expect(renderBuildingLine("shelter", "阿萌")).toBe("阿萌盖起了一座庇护所。");
  });

  it("granary sentence", () => {
    expect(renderBuildingLine("granary", "阿萌")).toBe("阿萌为族人立起了粮仓。");
  });

  it("monument sentence (deliberately notes it cannot feed anyone)", () => {
    expect(renderBuildingLine("monument", "阿萌")).toBe("阿萌立起了一座石碑，它不能充饥。");
  });
});
