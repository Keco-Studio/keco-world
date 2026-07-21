import { drawInt } from "../rng/rng.js";
import type { Identity, Policy, Belief, UtilityKey } from "../schema/core.js";
import { UTILITY_KEYS } from "../schema/core.js";

export interface NpcGenome {
  lineageId: string;
  generation: number;
  identity: Identity;
  policy: Policy;
  beliefs: Belief[];
}

// Named constants (Global Constraints)
export const IDENTITY_MUT_PPM = 100_000; // 10% per field
export const IDENTITY_JITTER = 60;
export const POLICY_MUT_PPM = 250_000; // 25% per key
export const POLICY_JITTER = 120;
export const EPSILON_JITTER = 40;
export const CULT_INHERIT_MAX = 8;
export const CULT_POOL_MAX = 12;
export const CULT_INHERIT_SCALE = 800; // inherit chance ≈ confidence*0.8
export const CULT_CONF_SCALE = 700; // inherited confidence ≈ 70%
export const MISREMEMBER_PPM_MOD = 150_000;
export const MISREMEMBER_PPM_COND = 50_000;
export const MISREMEMBER_JITTER = 60;

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function jitter(seedRoot: string, jitterAmount: number, ...parts: (string | number)[]): number {
  const r = drawInt(seedRoot, 2 * jitterAmount + 1, ...parts);
  return r - jitterAmount;
}

export function breed(parentA: NpcGenome, parentB: NpcGenome, childKey: string, seedRoot: string, tick: number): NpcGenome {
  // Lineage and generation
  const lineageId = parentA.lineageId;
  const generation = Math.max(parentA.generation, parentB.generation) + 1;

  // Identity: per numeric field
  const identity: Identity = {
    riskTolerance: breedIdentityField(seedRoot, childKey, "riskTolerance", parentA.identity.riskTolerance, parentB.identity.riskTolerance),
    socialTrust: breedIdentityField(seedRoot, childKey, "socialTrust", parentA.identity.socialTrust, parentB.identity.socialTrust),
    explorationBias: breedIdentityField(seedRoot, childKey, "explorationBias", parentA.identity.explorationBias, parentB.identity.explorationBias),
    patience: breedIdentityField(seedRoot, childKey, "patience", parentA.identity.patience, parentB.identity.patience),
    voiceStyle: "",
  };

  // Policy: per utility-weight key and per threshold key
  const utilityWeights: Record<UtilityKey, number> = breedUtilityWeights(seedRoot, childKey, parentA.policy.utilityWeights, parentB.policy.utilityWeights);
  const thresholds: { hungerUrgent: number } = breedThresholds(seedRoot, childKey, parentA.policy.thresholds, parentB.policy.thresholds);
  const deliberationEpsilon = breedPolicyField(seedRoot, childKey, "deliberationEpsilon", parentA.policy.deliberationEpsilon, parentB.policy.deliberationEpsilon);

  const policy: Policy = {
    utilityWeights,
    thresholds,
    deliberationEpsilon,
  };

  // Cultural inheritance (Lamarckian, from parents' current beliefs)
  const beliefs = inheritBeliefs(seedRoot, childKey, tick, parentA, parentB);

  return { lineageId, generation, identity, policy, beliefs };
}

function breedIdentityField(seedRoot: string, childKey: string, fieldName: string, valueA: number, valueB: number): number {
  // Pick parent
  const parentIdx = drawInt(seedRoot, 2, "breed", childKey, "identity", fieldName, "pick");
  let value = parentIdx === 0 ? valueA : valueB;

  // Mutation roll
  const mutRoll = drawInt(seedRoot, 1_000_000, "breed", childKey, "identity", fieldName, "mut");
  if (mutRoll < IDENTITY_MUT_PPM) {
    const jit = jitter(seedRoot, IDENTITY_JITTER, "breed", childKey, "identity", fieldName, "jitter");
    value = value + jit;
  }

  return clamp(value, 0, 1000);
}

function breedPolicyField(seedRoot: string, childKey: string, fieldName: string, valueA: number, valueB: number): number {
  // Pick parent
  const parentIdx = drawInt(seedRoot, 2, "breed", childKey, "policy", fieldName, "pick");
  let value = parentIdx === 0 ? valueA : valueB;

  // Mutation roll
  const mutRoll = drawInt(seedRoot, 1_000_000, "breed", childKey, "policy", fieldName, "mut");
  if (mutRoll < POLICY_MUT_PPM) {
    const jit = jitter(seedRoot, POLICY_JITTER, "breed", childKey, "policy", fieldName, "jitter");
    value = value + jit;
  }

  return clamp(value, 0, 1000);
}

function breedUtilityWeights(
  seedRoot: string,
  childKey: string,
  weightsA: Record<UtilityKey, number>,
  weightsB: Record<UtilityKey, number>
): Record<UtilityKey, number> {
  const result: Record<UtilityKey, number> = {} as Record<UtilityKey, number>;

  for (const key of UTILITY_KEYS) {
    // Pick parent
    const parentIdx = drawInt(seedRoot, 2, "breed", childKey, "policy", "utilityWeights", key, "pick");
    let value = parentIdx === 0 ? weightsA[key]! : weightsB[key]!;

    // Mutation roll
    const mutRoll = drawInt(seedRoot, 1_000_000, "breed", childKey, "policy", "utilityWeights", key, "mut");
    if (mutRoll < POLICY_MUT_PPM) {
      const jit = jitter(seedRoot, POLICY_JITTER, "breed", childKey, "policy", "utilityWeights", key, "jitter");
      value = value + jit;
    }

    result[key] = clamp(value, 0, 1000);
  }

  return result;
}

function breedThresholds(
  seedRoot: string,
  childKey: string,
  thresholdsA: { hungerUrgent: number },
  thresholdsB: { hungerUrgent: number }
): { hungerUrgent: number } {
  // Pick parent
  const parentIdx = drawInt(seedRoot, 2, "breed", childKey, "policy", "thresholds", "hungerUrgent", "pick");
  let value = parentIdx === 0 ? thresholdsA.hungerUrgent : thresholdsB.hungerUrgent;

  // Mutation roll
  const mutRoll = drawInt(seedRoot, 1_000_000, "breed", childKey, "policy", "thresholds", "hungerUrgent", "mut");
  if (mutRoll < POLICY_MUT_PPM) {
    const jit = jitter(seedRoot, POLICY_JITTER, "breed", childKey, "policy", "thresholds", "hungerUrgent", "jitter");
    value = value + jit;
  }

  return { hungerUrgent: clamp(value, 0, 1000) };
}

function inheritBeliefs(seedRoot: string, childKey: string, tick: number, parentA: NpcGenome, parentB: NpcGenome): Belief[] {
  // Pool = A's beliefs tagged source parentA + B's tagged parentB
  const pool: (Belief & { originalSource: "A" | "B" })[] = [
    ...parentA.beliefs.map((b) => ({ ...b, originalSource: "A" as const })),
    ...parentB.beliefs.map((b) => ({ ...b, originalSource: "B" as const })),
  ];

  // Sort by (confidence desc, proposition asc)
  pool.sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    return a.proposition.localeCompare(b.proposition);
  });

  // Truncate to CULT_POOL_MAX
  pool.splice(CULT_POOL_MAX);

  const inherited: Belief[] = [];

  for (let i = 0; i < pool.length && inherited.length < CULT_INHERIT_MAX; i++) {
    const b = pool[i]!;
    const inheritChance = Math.floor((b.confidence * CULT_INHERIT_SCALE) / 1000);
    const inheritRoll = drawInt(seedRoot, 1000, "cult", childKey, String(i));

    if (inheritRoll < inheritChance) {
      const source = b.originalSource === "A" ? "parentA" : "parentB";
      let confidence = Math.floor((b.confidence * CULT_CONF_SCALE) / 1000);

      // Apply misremembering to modifier
      const modJitterRoll = drawInt(seedRoot, 1_000_000, "cult", childKey, String(i), "mod-jitter");
      let modifier = b.effect.modifier;
      if (modJitterRoll < MISREMEMBER_PPM_MOD) {
        const jit = jitter(seedRoot, MISREMEMBER_JITTER, "cult", childKey, String(i), "mod");
        modifier = clamp(modifier + jit, -300, 300);
      }

      // Apply misremembering to condition
      const condJitterRoll = drawInt(seedRoot, 1_000_000, "cult", childKey, String(i), "cond-jitter");
      let condition = b.effect.condition;
      if (condJitterRoll < MISREMEMBER_PPM_COND) {
        // Cycle: null → "winter" → "summer" → null
        const cycle = [null, "winter", "summer"];
        const currentIdx = cycle.indexOf(condition);
        const nextIdx = (currentIdx + 1) % cycle.length;
        condition = cycle[nextIdx] as null | "winter" | "summer";
      }

      const inheritedBelief: Belief = {
        proposition: b.proposition,
        effect: {
          target: b.effect.target,
          modifier,
          condition,
        },
        confidence,
        source,
        acquiredTick: tick,
        decayPer100: b.decayPer100,
      };

      // Only add if confidence >= 100
      if (confidence >= 100) {
        inherited.push(inheritedBelief);
      }
    }
  }

  return inherited;
}
