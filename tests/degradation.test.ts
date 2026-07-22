import { describe, it, expect } from "vitest";
import { runDegradation } from "../src/cli/degradation.js";
import { runSim } from "../src/sim/engine.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { createInitialState } from "../src/world/state.js";
import { runFromState } from "../src/sim/engine.js";
import { makeDemoManifest, makeDemoRoster } from "../src/cli/demo.js";

describe("degradation check", () => {
  it("chunked chaining is trajectory-identical to one continuous run", () => {
    const manifest = makeDemoManifest();
    const roster = makeDemoRoster("chunk-eq");
    const single = runSim(manifest, roster, "chunk-eq", { ticks: 3000, retainActionLog: false });
    let state = createInitialState(manifest, roster, "chunk-eq");
    for (let i = 0; i < 3; i++) {
      state = runFromState(state, manifest, "chunk-eq", { ticks: 1000, retainActionLog: false }).finalState;
    }
    expect(hashCanonical(state)).toBe(hashCanonical(single.finalState));
  });
  it("produces snapshots, criteria, and a deterministic report", () => {
    const r = runDegradation(["deg-t1", "deg-t2"], 4000, 1000);
    expect(r.seeds.length).toBe(2);
    for (const s of r.seeds) {
      expect(s.snapshots.length).toBeGreaterThanOrEqual(1);
      expect(s.snapshots.length).toBeLessThanOrEqual(4);
      const first = s.snapshots[0]!;
      expect(first.alive).toBeGreaterThan(0);
      expect(first.weightDiversity1000).toBeGreaterThan(0);   // founders are diverse
      const shareSum = Object.values(first.verbShares1000).reduce((a, b) => a + b, 0);
      expect(shareSum).toBeGreaterThan(900);                  // proportions ×1000, floor rounding
      expect(shareSum).toBeLessThanOrEqual(1000);
      expect(first.beliefs.maxPerNpc).toBeLessThanOrEqual(16);
    }
    expect(runDegradation(["deg-t1", "deg-t2"], 4000, 1000)).toEqual(r);
  });
  it("criteria fields populate and zod validation runs", () => {
    const r = runDegradation(["deg-t1"], 3000, 1000);
    const s = r.seeds[0]!;
    expect(typeof s.criteria.d4ZodValid).toBe("boolean");
    expect(s.criteria.d5BeliefCapOk).toBe(true);
    if (s.survived) {
      expect(s.criteria.d2DiversityRatio1000).not.toBeNull();
      expect(s.criteria.d3IdleShare1000).not.toBeNull();
    }
  });
});
