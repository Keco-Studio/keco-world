import { describe, it, expect } from "vitest";
import { behaviorReport } from "../src/cli/behavior.js";

describe("behavior report", () => {
  const r = behaviorReport("bhv-test", 2000);   // ~seconds; population barely changed
  it("shape and determinism", () => {
    expect(r.foundersAlive).toBe(25);
    expect(r.evolvedAlive).toBeGreaterThan(0);
    expect(Number.isFinite(r.crossDistance)).toBe(true);
    expect(behaviorReport("bhv-test", 2000)).toEqual(r);
  });
  it("short-horizon evolved population behaves near-founder (sanity direction)", () => {
    // after only 2000 ticks (mostly founders alive, few births), cross distance should be small-ish
    expect(r.foundersVsEvolved.verbL1).toBeLessThan(1.0);
  });
  it("key shifts are proportion deltas", () => {
    for (const [, delta] of r.topKeyShifts) expect(Math.abs(delta)).toBeLessThanOrEqual(1.0);
  });
});
