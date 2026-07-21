import { describe, it, expect } from "vitest";
import { breed, type NpcGenome, EPSILON_JITTER } from "../src/life/genome.js";
import { IdentityS, PolicyS, BeliefS } from "../src/schema/core.js";
import { makeTestRoster, makeTestBelief } from "./helpers.js";

function genome(i: number, beliefs = [] as ReturnType<typeof makeTestBelief>[]): NpcGenome {
  const r = makeTestRoster(5)[i]!;
  return { lineageId: r.npcId, generation: 0, identity: r.identity, policy: r.policy, beliefs };
}

describe("breed", () => {
  const A = genome(0, [makeTestBelief({ confidence: 900 }), makeTestBelief({ proposition: "walls save lives", effect: { target: "w:shelter", modifier: 150, condition: "winter" }, confidence: 700 })]);
  const B = genome(1, [makeTestBelief({ proposition: "wander far", effect: { target: "w:explore", modifier: 120, condition: null }, confidence: 800 })]);

  it("is deterministic and pure", () => {
    const snapshot = JSON.stringify([A, B]);
    const c1 = breed(A, B, "child-1", "seed-1", 500);
    const c2 = breed(A, B, "child-1", "seed-1", 500);
    expect(c1).toEqual(c2);
    expect(JSON.stringify([A, B])).toBe(snapshot);
  });
  it("child validates against schemas with bounded values", () => {
    const c = breed(A, B, "child-1", "seed-1", 500);
    IdentityS.parse(c.identity);
    PolicyS.parse(c.policy);
    for (const b of c.beliefs) BeliefS.parse(b);
    expect(c.beliefs.length).toBeLessThanOrEqual(8);
  });
  it("lineage from parentA, generation max+1", () => {
    const c = breed(A, { ...B, generation: 3 }, "child-1", "seed-1", 500);
    expect(c.lineageId).toBe(A.lineageId);
    expect(c.generation).toBe(4);
  });
  it("different childKey → different child (mutation/crossover varies)", () => {
    const kids = Array.from({ length: 20 }, (_, k) => breed(A, B, `child-${k}`, "seed-1", 500));
    const distinct = new Set(kids.map((c) => JSON.stringify(c.policy.utilityWeights)));
    expect(distinct.size).toBeGreaterThan(3);
  });
  it("inherited beliefs are re-tagged, discounted, and stamped", () => {
    const c = breed(A, B, "child-2", "seed-1", 777);
    for (const b of c.beliefs) {
      expect(["parentA", "parentB"]).toContain(b.source);
      expect(b.acquiredTick).toBe(777);
      expect(b.confidence).toBeLessThan(900);   // discounted from any parent original
    }
  });
  it("crossover draws from both parents across many children", () => {
    // parents with maximally distinct forage weights
    const hi = { ...A, policy: { ...A.policy, utilityWeights: { ...A.policy.utilityWeights, forage: 1000 } } };
    const lo = { ...B, policy: { ...B.policy, utilityWeights: { ...B.policy.utilityWeights, forage: 0 } } };
    const kids = Array.from({ length: 30 }, (_, k) => breed(hi, lo, `c${k}`, "seed-1", 1).policy.utilityWeights.forage);
    expect(kids.some((f) => f > 700)).toBe(true);
    expect(kids.some((f) => f < 300)).toBe(true);
  });
  it("epsilon jitter respects EPSILON_JITTER bound (±40)", () => {
    const epsilon = 500;
    const parentWithEpsilon = { ...A, policy: { ...A.policy, deliberationEpsilon: epsilon } };
    const childKeys = Array.from({ length: 300 }, (_, k) => `epsilon-child-${k}`);
    const childEpsilons = childKeys.map((key) =>
      breed(parentWithEpsilon, parentWithEpsilon, key, "seed-epsilon", 500).policy.deliberationEpsilon
    );

    const minBound = epsilon - EPSILON_JITTER;
    const maxBound = epsilon + EPSILON_JITTER;

    for (const eps of childEpsilons) {
      expect(eps).toBeGreaterThanOrEqual(minBound);
      expect(eps).toBeLessThanOrEqual(maxBound);
    }
  });
  it("EPSILON_JITTER constant is exported and equals 40", () => {
    expect(EPSILON_JITTER).toBe(40);
  });
});
