import { describe, it, expect } from "vitest";
import { runW2Seed, makeW2Manifest, weightedShare1000, staticShareOf, type W2Snapshot } from "../src/cli/world2.js";
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

describe("makeW2Manifest overrides (Task 8 calibration knobs)", () => {
  it("defaults reproduce the frozen v2.0 manifest and overrides apply on top", () => {
    const base = makeW2Manifest();
    expect(base.firstSummerBonusTicks).toBe(0);
    expect(base.founderSeededMemory).toBe(3);
    expect(base.winterColdHpDrain).toBe(3);

    const tuned = makeW2Manifest({ founderSeededMemory: 8, firstSummerBonusTicks: 400, winterColdHpDrain: 2 });
    expect(tuned.founderSeededMemory).toBe(8);
    expect(tuned.firstSummerBonusTicks).toBe(400);
    expect(tuned.winterColdHpDrain).toBe(2);
    // untouched knobs stay at the frozen defaults
    expect(tuned.seasonLengthTicks).toBe(base.seasonLengthTicks);
    expect(tuned.sites).toEqual(base.sites);
  });

  it("a knob change actually reaches the sim (different final state hash)", () => {
    const a = runW2Seed("w2-knob", 500, 500, makeW2Manifest());
    const b = runW2Seed("w2-knob", 500, 500, makeW2Manifest({ founderSeededMemory: 8 }));
    expect(a.finalStateHash).not.toBe(b.finalStateHash);
  });
});

function snap(actions: number, idle: number, rest: number): W2Snapshot {
  return {
    tick: 0,
    alive: 1,
    actions,
    maxGeneration: 0,
    livingLineages: 1,
    verbShares1000: { idle },
    goalShares1000: { rest },
    buildings: { shelter: 0, granary: 0, monument: 0 },
    siteStock: { berry: 0, wood: 0, stone: 0, gold: 0 },
    beliefsMaxPerNpc: 0,
  };
}

describe("static-share aggregation", () => {
  it("weights chunks by decision count, not by chunk count", () => {
    // 900 decisions at 100 idle + 100 decisions at 900 idle -> 180, not 500.
    const got = weightedShare1000([snap(900, 100, 0), snap(100, 900, 0)], (s) => s.verbShares1000, "idle");
    expect(got).toBe(180);
  });

  it("ignores empty chunks and returns 0 for an all-empty window", () => {
    expect(weightedShare1000([snap(0, 999, 0), snap(10, 200, 0)], (s) => s.verbShares1000, "idle")).toBe(200);
    expect(weightedShare1000([snap(0, 999, 0)], (s) => s.verbShares1000, "idle")).toBe(0);
  });

  it("staticShareOf compares the first and last window and reports rest separately", () => {
    const snaps = [snap(10, 100, 50), snap(10, 100, 50), snap(10, 700, 400), snap(10, 700, 400)];
    const stat = staticShareOf(snaps, 2);
    expect(stat.firstIdle1000).toBe(100);
    expect(stat.lastIdle1000).toBe(700);
    expect(stat.delta1000).toBe(600);
    expect(stat.firstRestGoal1000).toBe(50);
    expect(stat.lastRestGoal1000).toBe(400);
    expect(stat.windowChunks).toBe(2);
  });

  it("clamps the window when the run has fewer chunks than requested", () => {
    const stat = staticShareOf([snap(10, 300, 0)], 10);
    expect(stat.windowChunks).toBe(1);
    expect(stat.firstIdle1000).toBe(300);
    expect(stat.lastIdle1000).toBe(300);
    expect(stat.delta1000).toBe(0);
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
