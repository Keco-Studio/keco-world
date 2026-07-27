import { describe, it, expect } from "vitest";
import { scoreGoals, chooseGoal, type ScoredGoal } from "../src/mind2/goals.js";
import type {
  W2Identity,
  W2Policy,
  GoalKey,
  BuildingKind,
} from "../src/schema/world2.js";
import { GOAL_KEYS, SHELTER_NEED_RADIUS } from "../src/schema/world2.js";
import type { W2NpcState } from "../src/world2/state.js";
import type { W2Observation } from "../src/mind2/observe.js";
import { drawInt } from "../src/rng/rng.js";
import { makeW2TestManifest } from "./w2-helpers.js";

function makeIdentity(overrides: Partial<W2Identity> = {}): W2Identity {
  return { riskTolerance: 500, socialTrust: 500, explorationBias: 400, patience: 500, voiceStyle: "", ...overrides };
}

function makePolicy(overrides: Partial<W2Policy> = {}): W2Policy {
  const goalWeights = Object.fromEntries(GOAL_KEYS.map((k) => [k, 400])) as Record<GoalKey, number>;
  return {
    thresholds: { hungerUrgent: 150 },
    deliberationEpsilon: 60,
    commitmentThreshold: 150,
    ...overrides,
    goalWeights: { ...goalWeights, ...(overrides.goalWeights ?? {}) },
  };
}

function makeNpc(overrides: Partial<W2NpcState> = {}): W2NpcState {
  return {
    npcId: "npc-1",
    name: "Test",
    pos: { x: 10, y: 10 },
    hp: 1000,
    energy: 1000,
    carry: { berry: 0, wood: 0, stone: 0, gold: 0 },
    alive: true,
    deathTick: null,
    deathCause: null,
    lastDamage: null,
    identity: makeIdentity(),
    policy: makePolicy(),
    beliefs: [],
    memory: [],
    goal: null,
    birthTick: -1000,
    generation: 0,
    lineageId: "npc-1",
    parents: null,
    reproCooldownUntil: 0,
    genomeHash: "hash",
    ...overrides,
  };
}

function makeObs(overrides: Partial<W2Observation> = {}): W2Observation {
  return {
    tick: 100,
    season: "summer",
    onShelter: false,
    self: {
      npcId: "npc-1",
      pos: { x: 10, y: 10 },
      hp: 1000,
      energy: 1000,
      carry: { berry: 0, wood: 0, stone: 0, gold: 0 },
      reproReady: false,
      lineageId: "npc-1",
    },
    visibleNpcs: [],
    visibleSites: [],
    visibleBuildings: [],
    wolf: null,
    ...overrides,
  };
}

function granaryBuilding(overrides: Partial<W2Observation["visibleBuildings"][number]> = {}) {
  return {
    id: "gr-1",
    kind: "granary" as BuildingKind,
    pos: { x: 10, y: 10 },
    ownerLineageId: "npc-1",
    storeBerry: 5,
    dist: 0,
    ...overrides,
  };
}

const manifest = makeW2TestManifest();

describe("scoreGoals gating", () => {
  it("eat is always produced and scores from hungerNeed, no gate", () => {
    const npc = makeNpc({ policy: makePolicy({ goalWeights: { ...makePolicy().goalWeights, eat: 800 } }) });
    const obs = makeObs({ self: { ...makeObs().self, energy: 500 } });
    const scored = scoreGoals(obs, npc, npc.policy, manifest);
    const eat = scored.find((s) => s.key === "eat")!;
    const hungerNeed = Math.floor(((manifest.maxEnergy - 500) * 1000) / manifest.maxEnergy);
    expect(eat.score).toBe(Math.floor((800 * hungerNeed) / 1000));

    // even at full energy / dead / anything, eat is still present.
    const fullObs = makeObs({ self: { ...makeObs().self, energy: manifest.maxEnergy } });
    expect(scoreGoals(fullObs, npc, npc.policy, manifest).some((s) => s.key === "eat")).toBe(true);
  });

  it("stockpile only appears when the lineage has a granary remembered (ownerLineageId match)", () => {
    const npc = makeNpc();
    const obsNoGranary = makeObs();
    expect(scoreGoals(obsNoGranary, npc, npc.policy, manifest).some((s) => s.key === "stockpile")).toBe(false);

    const npcWithGranaryMemory = makeNpc({
      memory: [{ kind: "granary", pos: { x: 10, y: 10 }, lastStock: 1, seenTick: 0, ownerLineageId: "npc-1" }],
    });
    expect(
      scoreGoals(makeObs(), npcWithGranaryMemory, npcWithGranaryMemory.policy, manifest).some(
        (s) => s.key === "stockpile",
      ),
    ).toBe(true);
  });

  it("a granary remembered outside current vision still satisfies the stockpile/granaryBuild gates (does not re-trigger granaryBuild, does allow stockpile)", () => {
    // The granary is far away -- not in obs.visibleBuildings at all -- but the NPC remembers it.
    const npc = makeNpc({
      memory: [{ kind: "granary", pos: { x: 60, y: 60 }, lastStock: 1, seenTick: 0, ownerLineageId: "npc-1" }],
    });
    const obs = makeObs({ visibleBuildings: [] }); // granary not currently visible
    const scored = scoreGoals(obs, npc, npc.policy, manifest);
    expect(scored.some((s) => s.key === "granaryBuild")).toBe(false);
    expect(scored.some((s) => s.key === "stockpile")).toBe(true);
  });

  it("a foreign lineage's granary in memory does not satisfy stockpile/granaryBuild gates", () => {
    const npc = makeNpc({
      lineageId: "npc-1",
      memory: [{ kind: "granary", pos: { x: 10, y: 10 }, lastStock: 1, seenTick: 0, ownerLineageId: "other-lineage" }],
    });
    const scored = scoreGoals(makeObs(), npc, npc.policy, manifest);
    expect(scored.some((s) => s.key === "stockpile")).toBe(false);
    expect(scored.some((s) => s.key === "granaryBuild")).toBe(true);
  });

  it("stockpile score uses foodSecurity including only currently-visible own-granary berries (not memory)", () => {
    const npc = makeNpc({
      memory: [{ kind: "granary", pos: { x: 10, y: 10 }, lastStock: 1, seenTick: 0, ownerLineageId: "npc-1" }],
    });
    const w = { ...makePolicy().goalWeights, stockpile: 900 };
    const policy = makePolicy({ goalWeights: w });
    const obs = makeObs({
      self: { ...makeObs().self, carry: { berry: 2, wood: 0, stone: 0, gold: 0 } },
      visibleBuildings: [granaryBuilding({ storeBerry: 3 })],
    });
    const scored = scoreGoals(obs, npc, policy, manifest);
    const stockpile = scored.find((s) => s.key === "stockpile")!;
    const foodSecurity = Math.min(1000, (2 + 3) * 100);
    expect(stockpile.score).toBe(Math.floor((900 * (1000 - foodSecurity)) / 1000));

    // Same npc/memory, but the granary is no longer visible this tick: foodSecurity
    // drops to carry-only, even though the stockpile gate (memory-based) still holds.
    const obsAway = makeObs({
      self: { ...makeObs().self, carry: { berry: 2, wood: 0, stone: 0, gold: 0 } },
      visibleBuildings: [],
    });
    const scoredAway = scoreGoals(obsAway, npc, policy, manifest);
    const stockpileAway = scoredAway.find((s) => s.key === "stockpile")!;
    const foodSecurityAway = Math.min(1000, 2 * 100);
    expect(stockpileAway.score).toBe(Math.floor((900 * (1000 - foodSecurityAway)) / 1000));
  });

  it("takeShelter requires winter, not-on-shelter, and a remembered shelter", () => {
    const npc = makeNpc({
      memory: [{ kind: "shelter", pos: { x: 12, y: 10 }, lastStock: 1, seenTick: 0, ownerLineageId: null }],
    });

    // not winter -> absent
    expect(
      scoreGoals(makeObs({ season: "summer" }), npc, npc.policy, manifest).some((s) => s.key === "takeShelter"),
    ).toBe(false);

    // winter but already on shelter -> absent
    expect(
      scoreGoals(makeObs({ season: "winter", onShelter: true }), npc, npc.policy, manifest).some(
        (s) => s.key === "takeShelter",
      ),
    ).toBe(false);

    // winter, not on shelter, but no shelter in memory -> absent
    const npcNoMemory = makeNpc({ memory: [] });
    expect(
      scoreGoals(makeObs({ season: "winter", onShelter: false }), npcNoMemory, npcNoMemory.policy, manifest).some(
        (s) => s.key === "takeShelter",
      ),
    ).toBe(false);

    // all conditions hold -> present, with distance-based score
    const w = { ...makePolicy().goalWeights, takeShelter: 700 };
    const policy = makePolicy({ goalWeights: w });
    const scored = scoreGoals(makeObs({ season: "winter", onShelter: false }), npc, policy, manifest);
    const ts = scored.find((s) => s.key === "takeShelter")!;
    expect(ts.score).toBe(700 - 15 * 2); // chebyshev distance from (10,10) to (12,10) = 2
  });

  it("shelterBuild is gated off only by a remembered shelter within SHELTER_NEED_RADIUS", () => {
    const near = makeNpc({
      memory: [
        { kind: "shelter", pos: { x: 10 + SHELTER_NEED_RADIUS, y: 10 }, lastStock: 1, seenTick: 0, ownerLineageId: null },
      ],
    });
    expect(scoreGoals(makeObs(), near, near.policy, manifest).some((s) => s.key === "shelterBuild")).toBe(false);

    const far = makeNpc({
      memory: [
        {
          kind: "shelter",
          pos: { x: 10 + SHELTER_NEED_RADIUS + 1, y: 10 },
          lastStock: 1,
          seenTick: 0,
          ownerLineageId: null,
        },
      ],
    });
    expect(scoreGoals(makeObs(), far, far.policy, manifest).some((s) => s.key === "shelterBuild")).toBe(true);

    const none = makeNpc({ memory: [] });
    expect(scoreGoals(makeObs(), none, none.policy, manifest).some((s) => s.key === "shelterBuild")).toBe(true);
  });

  it("granaryBuild is gated off only by an own-lineage granary remembered (visible or not)", () => {
    const npc = makeNpc();
    expect(scoreGoals(makeObs(), npc, npc.policy, manifest).some((s) => s.key === "granaryBuild")).toBe(true);

    const npcWithGranaryMemory = makeNpc({
      memory: [{ kind: "granary", pos: { x: 10, y: 10 }, lastStock: 1, seenTick: 0, ownerLineageId: "npc-1" }],
    });
    expect(
      scoreGoals(makeObs(), npcWithGranaryMemory, npcWithGranaryMemory.policy, manifest).some(
        (s) => s.key === "granaryBuild",
      ),
    ).toBe(false);

    // A visible granary that is never actually put into memory does not, by itself,
    // satisfy the gate -- the gate is memory-based, not observation-based.
    const obsWithGranary = makeObs({ visibleBuildings: [granaryBuilding()] });
    expect(scoreGoals(obsWithGranary, npc, npc.policy, manifest).some((s) => s.key === "granaryBuild")).toBe(true);
  });

  it("monumentBuild has no gate", () => {
    const npc = makeNpc();
    for (const obs of [makeObs(), makeObs({ season: "winter" }), makeObs({ visibleBuildings: [granaryBuilding()] })]) {
      expect(scoreGoals(obs, npc, npc.policy, manifest).some((s) => s.key === "monumentBuild")).toBe(true);
    }
  });

  it("rest has no gate and the candidate set is never empty", () => {
    const scenarios: { npc: W2NpcState; obs: W2Observation }[] = [
      { npc: makeNpc(), obs: makeObs() },
      { npc: makeNpc({ memory: [] }), obs: makeObs({ season: "winter" }) },
      {
        npc: makeNpc(),
        obs: makeObs({ season: "winter", onShelter: true, visibleBuildings: [granaryBuilding()] }),
      },
      { npc: makeNpc({ energy: 0 }), obs: makeObs({ self: { ...makeObs().self, energy: 0 } }) },
    ];
    for (const { npc, obs } of scenarios) {
      const scored = scoreGoals(obs, npc, npc.policy, manifest);
      expect(scored.length).toBeGreaterThan(0);
      expect(scored.some((s) => s.key === "rest")).toBe(true);
    }
  });
});

describe("chooseGoal hysteresis", () => {
  const identity = makeIdentity();
  const eps0Policy = makePolicy({ deliberationEpsilon: 0, commitmentThreshold: 150 });

  it("keeps the current goal when the lead is below commitmentThreshold", () => {
    const scored: ScoredGoal[] = [
      { key: "eat", score: 600 },
      { key: "rest", score: 500 }, // lead = 100 < 150
    ];
    const result = chooseGoal(scored, { key: "rest", sinceTick: 0 }, eps0Policy, identity, "seed", "npc-1", 100);
    expect(result).toEqual({ key: "rest", switched: false, source: "utility" });
  });

  it("switches when the lead exceeds commitmentThreshold", () => {
    const scored: ScoredGoal[] = [
      { key: "eat", score: 700 },
      { key: "rest", score: 500 }, // lead = 200 > 150
    ];
    const result = chooseGoal(scored, { key: "rest", sinceTick: 0 }, eps0Policy, identity, "seed", "npc-1", 100);
    expect(result).toEqual({ key: "eat", switched: true, source: "utility" });
  });

  it("switches immediately when the current goal is no longer a candidate", () => {
    const scored: ScoredGoal[] = [
      { key: "eat", score: 500 },
      { key: "rest", score: 490 },
    ];
    // "stockpile" (the current goal) is absent from `scored` -> its gate failed this tick.
    const result = chooseGoal(
      scored,
      { key: "stockpile", sinceTick: 0 },
      eps0Policy,
      identity,
      "seed",
      "npc-1",
      100,
    );
    expect(result.switched).toBe(true);
    expect(result.key).toBe("eat");
  });

  it("adopts a goal immediately when there is no current goal", () => {
    const scored: ScoredGoal[] = [
      { key: "eat", score: 500 },
      { key: "rest", score: 100 },
    ];
    const result = chooseGoal(scored, null, eps0Policy, identity, "seed", "npc-1", 100);
    expect(result).toEqual({ key: "eat", switched: true, source: "utility" });
  });

  it("stays with the current goal at exactly the threshold boundary (strict >)", () => {
    const scored: ScoredGoal[] = [
      { key: "eat", score: 650 },
      { key: "rest", score: 500 }, // lead = 150 == threshold, not > threshold
    ];
    const result = chooseGoal(scored, { key: "rest", sinceTick: 0 }, eps0Policy, identity, "seed", "npc-1", 100);
    expect(result).toEqual({ key: "rest", switched: false, source: "utility" });
  });

  it("single-member band (or epsilon 0) uses source utility with no lottery", () => {
    const scored: ScoredGoal[] = [
      { key: "eat", score: 500 },
      { key: "rest", score: 100 }, // gap 400 > epsilon 60
    ];
    const policy = makePolicy({ deliberationEpsilon: 60, commitmentThreshold: 0 });
    const result = chooseGoal(scored, null, policy, identity, "seed", "npc-1", 100);
    expect(result.source).toBe("utility");
    expect(result.key).toBe("eat");
  });

  it("multi-member band uses the resolver lottery, reproducibly, matching the frozen affinity weights", () => {
    const scored: ScoredGoal[] = [
      { key: "eat", score: 500 },
      { key: "rest", score: 480 }, // within epsilon 60 of best
    ];
    const policy = makePolicy({ deliberationEpsilon: 60, commitmentThreshold: 0 });

    const a = chooseGoal(scored, null, policy, identity, "seed-x", "npc-7", 42);
    const b = chooseGoal(scored, null, policy, identity, "seed-x", "npc-7", 42);
    expect(a).toEqual(b); // determinism
    expect(a.source).toBe("resolver");
    expect(["eat", "rest"]).toContain(a.key);

    // Hand-compute the expected pick from the frozen weight formula:
    // weight = 100 + affinity(key, identity); affinity(eat) = 1000-patience, affinity(rest) = floor(patience/2).
    const wEat = 100 + (1000 - identity.patience);
    const wRest = 100 + Math.floor(identity.patience / 2);
    const total = wEat + wRest;
    const r = drawInt("seed-x", total, "goal-resolver", "npc-7", 42);
    const expectedKey: GoalKey = r < wEat ? "eat" : "rest";
    expect(a.key).toBe(expectedKey);
  });

  it("personality affinity shifts the lottery distribution across many draws", () => {
    const scored: ScoredGoal[] = [
      { key: "eat", score: 500 },
      { key: "stockpile", score: 480 },
    ];
    const policy = makePolicy({ deliberationEpsilon: 60, commitmentThreshold: 0 });
    const patient = makeIdentity({ patience: 950 }); // favors stockpile (affinity = patience)
    const impatient = makeIdentity({ patience: 50 }); // favors eat (affinity = 1000-patience)

    let patientStockpile = 0;
    let impatientStockpile = 0;
    for (let t = 0; t < 300; t++) {
      if (chooseGoal(scored, null, policy, patient, "seed", "npc-1", t).key === "stockpile") patientStockpile++;
      if (chooseGoal(scored, null, policy, impatient, "seed", "npc-1", t).key === "stockpile") impatientStockpile++;
    }
    expect(patientStockpile).toBeGreaterThan(impatientStockpile + 30);
  });
});
