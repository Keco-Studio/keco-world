import type { Policy, Belief, UtilityKey } from "../schema/core.js";

/** Confidence-scaled, season-gated belief deltas applied to a copy of policy. Never mutates inputs. */
export function applyBeliefs(policy: Policy, beliefs: Belief[], season: "summer" | "winter"): Policy {
  // Start with a deep copy of the policy
  const result: Policy = {
    utilityWeights: { ...policy.utilityWeights },
    thresholds: { ...policy.thresholds },
    deliberationEpsilon: policy.deliberationEpsilon,
  };

  // Apply each belief that is active for this season
  for (const belief of beliefs) {
    // Gate by season condition
    if (belief.effect.condition !== null && belief.effect.condition !== season) {
      continue;
    }

    // Calculate the delta: floor(modifier * confidence / 1000)
    const delta = Math.floor((belief.effect.modifier * belief.confidence) / 1000);

    // Apply delta based on target type
    const target = belief.effect.target;
    if (target.startsWith("w:")) {
      // Weight target: "w:forage" -> utilityWeights.forage
      const weightKey = target.slice(2) as UtilityKey;
      result.utilityWeights[weightKey] = Math.max(0, Math.min(1000, result.utilityWeights[weightKey] + delta));
    } else if (target.startsWith("t:")) {
      // Threshold target: "t:hungerUrgent" -> thresholds.hungerUrgent
      const thresholdKey = target.slice(2) as keyof typeof result.thresholds;
      result.thresholds[thresholdKey] = Math.max(0, Math.min(1000, result.thresholds[thresholdKey] + delta));
    }
  }

  return result;
}
