import { describe, it, expect } from "vitest";
import { verbHistogram, histogramL1, ngramProfile, ngramDistance, compareGenomes, meanPairwiseVerbL1 } from "../src/scenarios/metrics.js";
import { SCENARIOS } from "../src/scenarios/library.js";
import { makeTestRoster } from "./helpers.js";

const r = makeTestRoster(1)[0]!;
const neutral = { identity: r.identity, policy: r.policy, beliefs: [] };

describe("behavior metrics", () => {
  it("histogram + L1 basics", () => {
    const a = { move: 6, take: 4 };
    const b = { move: 4, take: 4, idle: 2 };
    expect(histogramL1(a, a)).toBe(0);
    expect(histogramL1(a, b)).toBeCloseTo(0.4, 5);   // props: (.6,.4,0) vs (.4,.4,.2) → .2+.0+.2
    expect(histogramL1(a, { flee: 1 })).toBe(2);      // disjoint
  });
  it("ngram profile stays within traces", () => {
    const p = ngramProfile([{ scenarioId: "x", verbs: ["move", "move", "take"], keys: [null, null, null] }], 2);
    expect(p.get("move|move")).toBe(1);
    expect(p.get("move|take")).toBe(1);
    expect(p.size).toBe(2);
  });
  it("identical genomes → zero distances", () => {
    const c = compareGenomes(neutral, neutral, SCENARIOS);
    expect(c.verbL1).toBe(0);
    expect(c.bigramL1).toBe(0);
    expect(c.disagreementRate).toBe(0);
  });
  it("opposed genomes → measurable distance with sensible keyShift", () => {
    const explorer = { ...neutral, policy: { ...neutral.policy, utilityWeights: { ...neutral.policy.utilityWeights, explore: 1000, forage: 100 } } };
    const c = compareGenomes(neutral, explorer, SCENARIOS);
    expect(c.verbL1).toBeGreaterThan(0);
    expect(c.disagreementRate).toBeGreaterThan(0);
    expect(c.keyShift["explore"] ?? 0).toBeGreaterThan(0);   // B explores more
  });
  it("meanPairwiseVerbL1: zero for clones, positive for a mixed set, deterministic", () => {
    const explorer = { ...neutral, policy: { ...neutral.policy, utilityWeights: { ...neutral.policy.utilityWeights, explore: 1000, forage: 100 } } };
    expect(meanPairwiseVerbL1([neutral, neutral, neutral], SCENARIOS)).toBe(0);
    const m = meanPairwiseVerbL1([neutral, explorer, neutral], SCENARIOS);
    expect(m).toBeGreaterThan(0);
    expect(meanPairwiseVerbL1([neutral, explorer, neutral], SCENARIOS)).toBe(m);
  });
});
