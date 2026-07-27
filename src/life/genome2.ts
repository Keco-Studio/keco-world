import { drawInt } from "../rng/rng.js";
import type { W2Identity, W2Policy, W2Belief } from "../schema/world2.js";
import { GOAL_KEYS, type GoalKey } from "../schema/world2.js";
import { inheritMemory } from "../mind2/memory.js";
import type { W2Genome2 } from "../world2/rules.js";
import {
  IDENTITY_MUT_PPM,
  IDENTITY_JITTER,
  POLICY_MUT_PPM,
  POLICY_JITTER,
  EPSILON_JITTER,
  CULT_INHERIT_MAX,
  CULT_POOL_MAX,
  CULT_INHERIT_SCALE,
  CULT_CONF_SCALE,
  MISREMEMBER_PPM_MOD,
  MISREMEMBER_PPM_COND,
  MISREMEMBER_JITTER,
} from "./genome.js";

/**
 * breed2 (Task 6). Reuses v1's `breed` (src/life/genome.ts) constants and
 * per-field crossover style verbatim for the four identity fields,
 * thresholds.hungerUrgent, and deliberationEpsilon. Extends it with:
 *   - goalWeights: per-GoalKey crossover+mutation, same POLICY_MUT_PPM/POLICY_JITTER style.
 *   - commitmentThreshold: same crossover+mutation style, EPSILON_JITTER magnitude.
 *   - belief inheritance: v1's cultural-layer logic (CULT_* constants) verbatim,
 *     operating on W2Belief (effect.target already ranges over W2_EFFECT_TARGETS
 *     because it's copied through from the parents' own w2 beliefs).
 *   - memory: inheritMemory(a.memory, childKey, seedRoot, tick) — single-parent
 *     (only `a`), per the brief.
 *
 * The `W2Genome2` shape (lineageId/generation/identity/policy/beliefs/memory)
 * is the exact injection-point type `reproductionStep2` (src/world2/rules.ts,
 * Task 2) already declares as `BreedFn2`'s parameter/return type. The Task 6
 * brief's interface listing calls this type `W2Genome`; that name doesn't
 * exist anywhere in the codebase, so `breed2` is typed against the real,
 * already-wired `W2Genome2` instead of introducing a redundant duplicate
 * alias. See report for detail.
 */

const RNG_PREFIX = "breed2";
const CULT_PREFIX = "cult2";

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function jitter(seedRoot: string, jitterAmount: number, ...parts: (string | number)[]): number {
  const r = drawInt(seedRoot, 2 * jitterAmount + 1, ...parts);
  return r - jitterAmount;
}

function breedIdentityField2(
  seedRoot: string,
  childKey: string,
  fieldName: string,
  valueA: number,
  valueB: number,
): number {
  const parentIdx = drawInt(seedRoot, 2, RNG_PREFIX, childKey, "identity", fieldName, "pick");
  let value = parentIdx === 0 ? valueA : valueB;

  const mutRoll = drawInt(seedRoot, 1_000_000, RNG_PREFIX, childKey, "identity", fieldName, "mut");
  if (mutRoll < IDENTITY_MUT_PPM) {
    value += jitter(seedRoot, IDENTITY_JITTER, RNG_PREFIX, childKey, "identity", fieldName, "jitter");
  }

  return clamp(value, 0, 1000);
}

function breedPolicyField2(
  seedRoot: string,
  childKey: string,
  fieldName: string,
  valueA: number,
  valueB: number,
  jitterAmount: number = POLICY_JITTER,
): number {
  const parentIdx = drawInt(seedRoot, 2, RNG_PREFIX, childKey, "policy", fieldName, "pick");
  let value = parentIdx === 0 ? valueA : valueB;

  const mutRoll = drawInt(seedRoot, 1_000_000, RNG_PREFIX, childKey, "policy", fieldName, "mut");
  if (mutRoll < POLICY_MUT_PPM) {
    value += jitter(seedRoot, jitterAmount, RNG_PREFIX, childKey, "policy", fieldName, "jitter");
  }

  return clamp(value, 0, 1000);
}

function breedGoalWeights(
  seedRoot: string,
  childKey: string,
  weightsA: Record<GoalKey, number>,
  weightsB: Record<GoalKey, number>,
): Record<GoalKey, number> {
  const result = {} as Record<GoalKey, number>;

  for (const key of GOAL_KEYS) {
    const parentIdx = drawInt(seedRoot, 2, RNG_PREFIX, childKey, "policy", "goalWeights", key, "pick");
    let value = parentIdx === 0 ? weightsA[key] : weightsB[key];

    const mutRoll = drawInt(seedRoot, 1_000_000, RNG_PREFIX, childKey, "policy", "goalWeights", key, "mut");
    if (mutRoll < POLICY_MUT_PPM) {
      value += jitter(seedRoot, POLICY_JITTER, RNG_PREFIX, childKey, "policy", "goalWeights", key, "jitter");
    }

    result[key] = clamp(value, 0, 1000);
  }

  return result;
}

/** Cultural (Lamarckian) belief inheritance — identical algorithm to v1's inheritBeliefs. */
function inheritBeliefs2(seedRoot: string, childKey: string, tick: number, a: W2Genome2, b: W2Genome2): W2Belief[] {
  const pool: (W2Belief & { originalSource: "A" | "B" })[] = [
    ...a.beliefs.map((bl) => ({ ...bl, originalSource: "A" as const })),
    ...b.beliefs.map((bl) => ({ ...bl, originalSource: "B" as const })),
  ];

  pool.sort((x, y) => {
    if (y.confidence !== x.confidence) return y.confidence - x.confidence;
    return x.proposition < y.proposition ? -1 : x.proposition > y.proposition ? 1 : 0;
  });
  pool.splice(CULT_POOL_MAX);

  const inherited: W2Belief[] = [];

  for (let i = 0; i < pool.length && inherited.length < CULT_INHERIT_MAX; i++) {
    const bl = pool[i]!;
    const inheritChance = Math.floor((bl.confidence * CULT_INHERIT_SCALE) / 1000);
    const inheritRoll = drawInt(seedRoot, 1000, CULT_PREFIX, childKey, String(i));

    if (inheritRoll < inheritChance) {
      const source = bl.originalSource === "A" ? "parentA" : "parentB";
      const confidence = Math.floor((bl.confidence * CULT_CONF_SCALE) / 1000);

      const modJitterRoll = drawInt(seedRoot, 1_000_000, CULT_PREFIX, childKey, String(i), "mod-jitter");
      let modifier = bl.effect.modifier;
      if (modJitterRoll < MISREMEMBER_PPM_MOD) {
        modifier = clamp(modifier + jitter(seedRoot, MISREMEMBER_JITTER, CULT_PREFIX, childKey, String(i), "mod"), -300, 300);
      }

      const condJitterRoll = drawInt(seedRoot, 1_000_000, CULT_PREFIX, childKey, String(i), "cond-jitter");
      let condition = bl.effect.condition;
      if (condJitterRoll < MISREMEMBER_PPM_COND) {
        const cycle: (null | "winter" | "summer")[] = [null, "winter", "summer"];
        const currentIdx = cycle.indexOf(condition);
        condition = cycle[(currentIdx + 1) % cycle.length]!;
      }

      if (confidence >= 100) {
        inherited.push({
          proposition: bl.proposition,
          effect: { target: bl.effect.target, modifier, condition },
          confidence,
          source,
          acquiredTick: tick,
          decayPer100: bl.decayPer100,
        });
      }
    }
  }

  return inherited;
}

export function breed2(a: W2Genome2, b: W2Genome2, childKey: string, seedRoot: string, tick: number): W2Genome2 {
  const lineageId = a.lineageId;
  const generation = Math.max(a.generation, b.generation) + 1;

  const identity: W2Identity = {
    riskTolerance: breedIdentityField2(seedRoot, childKey, "riskTolerance", a.identity.riskTolerance, b.identity.riskTolerance),
    socialTrust: breedIdentityField2(seedRoot, childKey, "socialTrust", a.identity.socialTrust, b.identity.socialTrust),
    explorationBias: breedIdentityField2(seedRoot, childKey, "explorationBias", a.identity.explorationBias, b.identity.explorationBias),
    patience: breedIdentityField2(seedRoot, childKey, "patience", a.identity.patience, b.identity.patience),
    voiceStyle: "",
  };

  const goalWeights = breedGoalWeights(seedRoot, childKey, a.policy.goalWeights, b.policy.goalWeights);
  const hungerUrgent = breedPolicyField2(
    seedRoot,
    childKey,
    "hungerUrgent",
    a.policy.thresholds.hungerUrgent,
    b.policy.thresholds.hungerUrgent,
  );
  const deliberationEpsilon = breedPolicyField2(
    seedRoot,
    childKey,
    "deliberationEpsilon",
    a.policy.deliberationEpsilon,
    b.policy.deliberationEpsilon,
    EPSILON_JITTER,
  );
  const commitmentThreshold = breedPolicyField2(
    seedRoot,
    childKey,
    "commitmentThreshold",
    a.policy.commitmentThreshold,
    b.policy.commitmentThreshold,
    EPSILON_JITTER,
  );

  const policy: W2Policy = {
    goalWeights,
    thresholds: { hungerUrgent },
    deliberationEpsilon,
    commitmentThreshold,
  };

  const beliefs = inheritBeliefs2(seedRoot, childKey, tick, a, b);
  const memory = inheritMemory(a.memory, childKey, seedRoot, tick);

  return { lineageId, generation, identity, policy, beliefs, memory };
}
