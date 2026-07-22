import { describe, it, expect } from "vitest";
import { runDegradation, computeWeightDiversity1000 } from "../src/cli/degradation.js";
import { runSim } from "../src/sim/engine.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { createInitialState } from "../src/world/state.js";
import type { NpcState } from "../src/world/state.js";
import { runFromState } from "../src/sim/engine.js";
import { makeDemoManifest, makeDemoRoster } from "../src/cli/demo.js";
import type { UtilityWeightsS } from "../src/schema/core.js";
import type { z } from "zod";

/** Minimal-but-schema-shaped NpcState fixture: only utilityWeights varies across
 * callers, everything else is a fixed, valid placeholder. */
function makeNpc(id: string, weights: z.infer<typeof UtilityWeightsS>): NpcState {
  return {
    npcId: id,
    name: id,
    pos: { x: 0, y: 0 },
    hp: 100,
    energy: 100,
    berries: 0,
    alive: true,
    deathTick: null,
    deathCause: null,
    lastDamage: null,
    identity: {
      riskTolerance: 500,
      socialTrust: 500,
      explorationBias: 500,
      patience: 500,
      voiceStyle: "neutral",
    },
    policy: {
      utilityWeights: weights,
      thresholds: { hungerUrgent: 500 },
      deliberationEpsilon: 50,
    },
    beliefs: [],
    birthTick: 0,
    generation: 0,
    lineageId: id,
    parents: null,
    reproCooldownUntil: 0,
    genomeHash: "x",
  };
}

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

  it("weight diversity is sensitive to late-born NPCs, not just the first ~8 by index", () => {
    // 30 NPCs so C(30,2) = 435 > MAX_DIVERSITY_PAIRS (200): the sampler must
    // subsample. Under the old `pairs.slice(0, 200)` scheme (birth-order-biased,
    // (i,j) enumerated with i ascending), the sample only ever contains pairs
    // anchored at the lowest ~8 indices; two populations that differ only in
    // NPCs 10..29's mutual weight structure could easily land on the exact same
    // 200 (i,j) index pairs and produce an identical metric regardless of that
    // difference. The keyed random sampler fixed here draws uniformly from the
    // whole pair-index space, so it must not have that blind spot.
    const first10 = Array.from({ length: 10 }, (_, i) =>
      makeNpc(`f${i}`, {
        forage: 100 + i * 10,
        consume: 200,
        shelter: 100,
        seekMate: 100,
        explore: 200,
        idle: 100,
      }),
    );

    // Population A: last 20 NPCs are all identical to each other (zero mutual
    // diversity among themselves).
    const lastA = Array.from({ length: 20 }, (_, i) =>
      makeNpc(`a${i}`, { forage: 150, consume: 150, shelter: 150, seekMate: 150, explore: 150, idle: 250 }),
    );

    // Population B: last 20 NPCs alternate between two maximally-opposed
    // weight vectors (high mutual diversity among themselves).
    const lastB = Array.from({ length: 20 }, (_, i) =>
      makeNpc(
        `b${i}`,
        i % 2 === 0
          ? { forage: 1000, consume: 0, shelter: 0, seekMate: 0, explore: 0, idle: 0 }
          : { forage: 0, consume: 0, shelter: 0, seekMate: 0, explore: 0, idle: 1000 },
      ),
    );

    const popA = [...first10, ...lastA];
    const popB = [...first10, ...lastB];

    const diversityA = computeWeightDiversity1000(popA);
    const diversityB = computeWeightDiversity1000(popB);

    expect(diversityA).not.toBe(diversityB);
    // Determinism: repeated calls on the same input reproduce the same value.
    expect(computeWeightDiversity1000(popA)).toBe(diversityA);
    expect(computeWeightDiversity1000(popB)).toBe(diversityB);
  });
});
