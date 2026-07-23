import { describe, it, expect } from "vitest";
import { findOpening, DIRECTOR_SCAN_DEFAULT } from "../src/director/director.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { runSim } from "../src/sim/engine.js";
import { makeDemoManifest, makeDemoRoster } from "../src/cli/demo.js";
import { seasonAt } from "../src/world/state.js";

describe("moment director v0", () => {
  it("finds a deterministic opening with a live state snapshot at the moment tick", () => {
    const m = makeDemoManifest();
    const roster = makeDemoRoster("dir-1");
    const a = findOpening(m, roster, "dir-1");
    const b = findOpening(m, roster, "dir-1");
    expect(hashCanonical(a.state)).toBe(hashCanonical(b.state));
    expect(a.moment.npcId).toBe(b.moment.npcId);
    expect(a.state.tick).toBe(a.moment.tick);
    expect(a.moment.tick).toBeGreaterThan(0);
    expect(a.moment.tick).toBeLessThanOrEqual(DIRECTOR_SCAN_DEFAULT);
    const focal = a.state.npcs.find((n) => n.npcId === a.moment.npcId)!;
    expect(focal.alive).toBe(true);
    // snapshot equals an independent run to the same tick
    const indep = runSim(m, roster, "dir-1", { ticks: a.moment.tick });
    expect(hashCanonical(indep.finalState)).toBe(hashCanonical(a.state));
  });
  it("winter-shortfall moments satisfy their own definition", () => {
    const m = makeDemoManifest();
    const a = findOpening(m, makeDemoRoster("dir-2"), "dir-2");
    if (a.moment.kind === "winter-shortfall") {
      expect(seasonAt(a.moment.tick, m)).toBe("summer");
      expect(a.moment.ticksToWinter).toBeGreaterThan(0);
      expect(a.moment.ticksToWinter).toBeLessThanOrEqual(200);
      expect(a.moment.shortfall).toBeGreaterThan(0);
      expect(a.moment.score).toBe(Math.min(a.moment.shortfall, 2000) + (200 - a.moment.ticksToWinter));
    } else {
      expect(a.moment.kind).toBe("fallback-low-reserves");
    }
  });
  it("fallback path returns lowest-reserves adult at scan end", () => {
    const m = makeDemoManifest();
    // Use scanTicks=100 to ensure no winter-shortfall candidates (ticksToWinter would be ~300 > 200)
    const a = findOpening(m, makeDemoRoster("dir-fb"), "dir-fb", 100);
    expect(a.moment.kind).toBe("fallback-low-reserves");
    expect(a.state.tick).toBe(100);
    // Verify state matches independent run to tick 100
    const indep = runSim(m, makeDemoRoster("dir-fb"), "dir-fb", { ticks: 100 });
    expect(hashCanonical(indep.finalState)).toBe(hashCanonical(a.state));
  });
});
