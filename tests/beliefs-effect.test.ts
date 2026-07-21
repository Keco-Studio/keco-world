import { describe, it, expect } from "vitest";
import { applyBeliefs } from "../src/mind/beliefs.js";
import { makeTestRoster, makeTestBelief } from "./helpers.js";

const base = makeTestRoster(1)[0]!.policy; // forage 600

describe("applyBeliefs", () => {
  it("applies confidence-scaled deltas and clamps", () => {
    const p = applyBeliefs(base, [makeTestBelief({ effect: { target: "w:forage", modifier: 100, condition: null }, confidence: 500 })], "summer");
    expect(p.utilityWeights.forage).toBe(650);   // 600 + floor(100*500/1000)
    const q = applyBeliefs(base, [makeTestBelief({ effect: { target: "w:consume", modifier: 300, condition: null }, confidence: 1000 })], "summer");
    expect(q.utilityWeights.consume).toBe(1000); // 800+300 clamped
  });
  it("season condition gates the effect", () => {
    const b = makeTestBelief({ effect: { target: "w:shelter", modifier: 200, condition: "winter" }, confidence: 1000 });
    expect(applyBeliefs(base, [b], "summer").utilityWeights.shelter).toBe(base.utilityWeights.shelter);
    expect(applyBeliefs(base, [b], "winter").utilityWeights.shelter).toBe(base.utilityWeights.shelter + 200);
  });
  it("threshold target works and inputs are not mutated", () => {
    const b = makeTestBelief({ effect: { target: "t:hungerUrgent", modifier: 100, condition: null }, confidence: 1000 });
    const before = JSON.stringify(base);
    const p = applyBeliefs(base, [b], "summer");
    expect(p.thresholds.hungerUrgent).toBe(base.thresholds.hungerUrgent + 100);
    expect(JSON.stringify(base)).toBe(before);
    expect(p.deliberationEpsilon).toBe(base.deliberationEpsilon);
  });
  it("multiple beliefs stack", () => {
    const bs = [
      makeTestBelief({ effect: { target: "w:forage", modifier: 100, condition: null }, confidence: 1000 }),
      makeTestBelief({ effect: { target: "w:forage", modifier: -50, condition: null }, confidence: 1000 }),
    ];
    expect(applyBeliefs(base, bs, "summer").utilityWeights.forage).toBe(650);
  });
});
