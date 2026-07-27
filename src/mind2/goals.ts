import type { GoalKey, W2Policy, W2Manifest, W2Identity } from "../schema/world2.js";
import { SHELTER_NEED_RADIUS } from "../schema/world2.js";
import type { W2Observation } from "./observe.js";
import type { W2NpcState } from "../world2/state.js";
import { chebyshev2 } from "../world2/state.js";
import { drawInt } from "../rng/rng.js";
import { nearestRemembered } from "./planner.js";

export interface ScoredGoal {
  key: GoalKey;
  score: number;
}

/** Frozen personality affinity mapping per the Task 5 brief. */
function goalAffinity(key: GoalKey, identity: W2Identity): number {
  switch (key) {
    case "eat":
      return 1000 - identity.patience;
    case "stockpile":
      return identity.patience;
    case "takeShelter":
      return 1000 - identity.riskTolerance;
    case "shelterBuild":
      return identity.patience;
    case "granaryBuild":
      return identity.patience;
    case "monumentBuild":
      return identity.socialTrust;
    case "rest":
      return Math.floor(identity.patience / 2);
  }
}

/** Strict >; earliest candidate (GOAL_KEYS emission order) wins ties. */
function pickBestGoal(scored: ScoredGoal[]): ScoredGoal {
  let best = scored[0]!;
  for (const c of scored) if (c.score > best.score) best = c;
  return best;
}

/**
 * scoreGoals (frozen, all-integer). `rest` and `monumentBuild` are ungated so
 * the candidate set is never empty.
 */
export function scoreGoals(
  obs: W2Observation,
  npc: W2NpcState,
  effPolicy: W2Policy,
  manifest: W2Manifest,
): ScoredGoal[] {
  const w = effPolicy.goalWeights;
  const hungerNeed = Math.floor(((manifest.maxEnergy - obs.self.energy) * 1000) / manifest.maxEnergy);

  // Granary ownership is only knowable from the current observation — MemoryEntry
  // carries no owner field, so "does my lineage have a granary" cannot be answered
  // from memory alone. Shelters, by contrast, are a public good (no ownership
  // check needed), so their gates below use memory instead, matching the design
  // spec's distinction between private granaries and public shelters.
  const ownGranaries = obs.visibleBuildings.filter(
    (b) => b.kind === "granary" && b.ownerLineageId === obs.self.lineageId,
  );
  const hasOwnGranary = ownGranaries.length > 0;
  const ownGranaryBerries = ownGranaries.reduce((sum, b) => sum + b.storeBerry, 0);
  const foodSecurity = Math.min(1000, (obs.self.carry.berry + ownGranaryBerries) * 100);

  const out: ScoredGoal[] = [];

  out.push({ key: "eat", score: Math.floor((w.eat * hungerNeed) / 1000) });

  if (hasOwnGranary) {
    out.push({
      key: "stockpile",
      score: Math.floor((w.stockpile * (1000 - foodSecurity)) / 1000),
    });
  }

  if (obs.season === "winter" && !obs.onShelter) {
    const nearestShelter = nearestRemembered(npc.memory, "shelter", obs.self.pos);
    if (nearestShelter !== null) {
      const d = chebyshev2(obs.self.pos, nearestShelter.pos);
      out.push({ key: "takeShelter", score: w.takeShelter - 15 * d });
    }
  }

  const hasNearbyShelter = npc.memory.some(
    (e) => e.kind === "shelter" && e.lastStock > 0 && chebyshev2(obs.self.pos, e.pos) <= SHELTER_NEED_RADIUS,
  );
  if (!hasNearbyShelter) {
    out.push({ key: "shelterBuild", score: w.shelterBuild });
  }

  if (!hasOwnGranary) {
    out.push({ key: "granaryBuild", score: w.granaryBuild });
  }

  out.push({ key: "monumentBuild", score: w.monumentBuild });
  out.push({ key: "rest", score: w.rest });

  return out;
}

/**
 * chooseGoal (frozen). Band lottery mirrors src/mind/resolver.ts's structure
 * (band = candidates within deliberationEpsilon of best; weight = 100 +
 * affinity; drawInt keyed "goal-resolver"). Hysteresis: if `current` is still
 * a candidate this tick, switch only when best.score clears
 * currentScore + commitmentThreshold; if `current` dropped out of the
 * candidate set (its gate failed), switch immediately. `switched` reports
 * whether the returned key actually differs from `current.key`, not merely
 * whether the hysteresis gate opened.
 */
export function chooseGoal(
  scored: ScoredGoal[],
  current: { key: GoalKey; sinceTick: number } | null,
  effPolicy: W2Policy,
  identity: W2Identity,
  seedRoot: string,
  npcId: string,
  tick: number,
): { key: GoalKey; switched: boolean; source: "utility" | "resolver" } {
  const best = pickBestGoal(scored);
  const eps = effPolicy.deliberationEpsilon;
  const band = scored.filter((c) => c.score >= best.score - eps);

  let resolvedKey: GoalKey;
  let source: "utility" | "resolver";
  if (eps === 0 || band.length === 1) {
    resolvedKey = best.key;
    source = "utility";
  } else {
    let total = 0;
    for (const c of band) total += 100 + goalAffinity(c.key, identity);
    const r = drawInt(seedRoot, total, "goal-resolver", npcId, tick);
    let acc = 0;
    resolvedKey = band[band.length - 1]!.key;
    for (const c of band) {
      acc += 100 + goalAffinity(c.key, identity);
      if (r < acc) {
        resolvedKey = c.key;
        break;
      }
    }
    source = "resolver";
  }

  if (current === null) {
    return { key: resolvedKey, switched: true, source };
  }

  const currentScored = scored.find((c) => c.key === current.key);
  if (currentScored === undefined) {
    // Current goal's gate no longer holds -> switch immediately.
    return { key: resolvedKey, switched: resolvedKey !== current.key, source };
  }

  if (best.score > currentScored.score + effPolicy.commitmentThreshold) {
    return { key: resolvedKey, switched: resolvedKey !== current.key, source };
  }

  return { key: current.key, switched: false, source };
}
