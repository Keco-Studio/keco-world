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

  it("meanPairwiseVerbL1: refactored function matches old formula via compareGenomes", () => {
    // Create a 3-genome test set
    const explorer = { ...neutral, policy: { ...neutral.policy, utilityWeights: { ...neutral.policy.utilityWeights, explore: 1000, forage: 100 } } };
    const cautious = { ...neutral, policy: { ...neutral.policy, utilityWeights: { ...neutral.policy.utilityWeights, explore: 50, forage: 500 } } };
    const genomes = [neutral, explorer, cautious];

    // Compute via refactored function (should evaluate each genome once)
    const refactored = meanPairwiseVerbL1(genomes, SCENARIOS, 10);

    // Compute via old formula using compareGenomes
    const pair01 = compareGenomes(genomes[0]!, genomes[1]!, SCENARIOS);
    const pair02 = compareGenomes(genomes[0]!, genomes[2]!, SCENARIOS);
    const pair12 = compareGenomes(genomes[1]!, genomes[2]!, SCENARIOS);
    const manual = (pair01.verbL1 + pair02.verbL1 + pair12.verbL1) / 3;

    expect(refactored).toBeCloseTo(manual, 5);
  });
});
