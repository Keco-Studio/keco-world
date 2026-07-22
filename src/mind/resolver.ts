import type { Identity, UtilityKey } from "../schema/core.js";
import type { Action } from "../schema/log.js";
import type { ScoredCandidate } from "./utility.js";
import { pickBest } from "./utility.js";
import { drawInt } from "../rng/rng.js";

export const RESOLVER_BASE_WEIGHT = 100;

/** Personality affinity per candidate key (documented mapping, ints 0..1000). */
export function affinity(key: UtilityKey, identity: Identity): number {
  switch (key) {
    case "consume":
      return 1000 - identity.patience; // impatient eat now
    case "forage":
      return identity.patience; // patient gatherers
    case "shelter":
      return 1000 - identity.riskTolerance; // cautious seek walls
    case "seekMate":
      return identity.socialTrust; // social companions
    case "explore":
      return identity.explorationBias;
    case "idle":
      return Math.floor(identity.patience / 2);
  }
}

export interface Resolution {
  action: Action;
  key: UtilityKey;
  source: "utility" | "resolver";
}

export function resolve(
  candidates: ScoredCandidate[],
  identity: Identity,
  epsilon: number,
  seedRoot: string,
  npcId: string,
  tick: number,
): Resolution {
  const best = pickBest(candidates);

  // Band = candidates with score >= best.score - epsilon
  const band = candidates.filter((c) => c.score >= best.score - epsilon);

  // If epsilon === 0 or band has 1 member → return with source "utility"
  if (epsilon === 0 || band.length === 1) {
    return { action: best.action, key: best.key, source: "utility" };
  }

  // Weighted draw: each band member weight = RESOLVER_BASE_WEIGHT + affinity(key, identity)
  let totalWeight = 0;
  for (const c of band) {
    totalWeight += RESOLVER_BASE_WEIGHT + affinity(c.key, identity);
  }

  // Draw a random value in [0, totalWeight)
  const r = drawInt(seedRoot, totalWeight, "resolver", npcId, tick);

  // Walk the band in candidate generation order, subtracting weights
  let accumulated = 0;
  for (const c of band) {
    const weight = RESOLVER_BASE_WEIGHT + affinity(c.key, identity);
    accumulated += weight;
    if (r < accumulated) {
      return { action: c.action, key: c.key, source: "resolver" };
    }
  }

  // Fallback (should never happen if math is correct)
  const last = band[band.length - 1]!;
  return { action: last.action, key: last.key, source: "resolver" };
}
