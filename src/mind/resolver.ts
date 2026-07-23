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
  /** Patron mechanism (schema v4): true iff a patron theme was live in this band and
   * therefore entered the weighted lottery (regardless of whether it changed the outcome). */
  patronApplied: boolean;
  /** True iff the tilted outcome differs from the untilted counterfactual draw — i.e. the
   * patron theme actually decided this pick, not merely participated in the lottery. */
  patronDecisive: boolean;
}

/** Frozen calibrated tilt weight added to the patron theme's band candidate.
 * Replaced by the calibrated value chosen in the calibration step (Task 2 Step 4). */
export const PATRON_TILT = 150;

/**
 * Resolver with an explicit tilt weight, so the calibration CLI can sweep candidate tilt
 * values without touching the frozen `PATRON_TILT` const. `resolve` below delegates here.
 */
export function resolveWithTilt(
  candidates: ScoredCandidate[],
  identity: Identity,
  epsilon: number,
  seedRoot: string,
  npcId: string,
  tick: number,
  patronTheme: UtilityKey | null | undefined,
  tilt: number,
): Resolution {
  const best = pickBest(candidates);

  // Band = candidates with score >= best.score - epsilon
  const band = candidates.filter((c) => c.score >= best.score - epsilon);

  // If epsilon === 0 or band has 1 member → return with source "utility"; no lottery, no tilt.
  if (epsilon === 0 || band.length === 1) {
    return { action: best.action, key: best.key, source: "utility", patronApplied: false, patronDecisive: false };
  }

  // Weighted draw over the band: weight = RESOLVER_BASE_WEIGHT + affinity(key, identity)
  // (+ tilt on the patron theme's candidate, when tiltKey matches).
  function bandTotal(tiltKey: UtilityKey | null): number {
    let total = 0;
    for (const c of band) total += RESOLVER_BASE_WEIGHT + affinity(c.key, identity) + (c.key === tiltKey ? tilt : 0);
    return total;
  }
  function walk(tiltKey: UtilityKey | null, r: number): { action: Action; key: UtilityKey } {
    let accumulated = 0;
    for (const c of band) {
      accumulated += RESOLVER_BASE_WEIGHT + affinity(c.key, identity) + (c.key === tiltKey ? tilt : 0);
      if (r < accumulated) return { action: c.action, key: c.key };
    }
    // Fallback (should never happen if math is correct)
    const last = band[band.length - 1]!;
    return { action: last.action, key: last.key };
  }

  const hasTheme = patronTheme != null && band.some((c) => c.key === patronTheme);
  if (!hasTheme) {
    const total = bandTotal(null);
    const r = drawInt(seedRoot, total, "resolver", npcId, tick);
    const untilted = walk(null, r);
    return { action: untilted.action, key: untilted.key, source: "resolver", patronApplied: false, patronDecisive: false };
  }

  // Coupled draw: the tilted outcome and its untilted counterfactual must derive from the same
  // underlying entropy so "decisive" only ever pulls TOWARD the patron theme, never away from
  // it — and this must hold regardless of the theme candidate's position in band (generation)
  // order, since band order is fixed by candidate kind, not by which key the patron backs.
  //
  // tiltedTotal = untiltedTotal + tilt exactly (only the theme candidate's own weight grows,
  // by exactly `tilt`). Draw r once against tiltedTotal and split [0, tiltedTotal) into two
  // zones instead of recomputing per-candidate boundaries twice independently (which, given
  // drawInt reuses the same underlying raw for any n, would let modular-reduction artifacts
  // flip the outcome AWAY from the theme for interior band positions — verified empirically):
  //   - forced zone  r < tilt            → tilted := theme, unconditionally.
  //   - regular zone r in [tilt, total)  → tilted := walk(untilted weights, r - tilt), which is
  //     exactly the untilted draw shifted by a constant, so it is IDENTICAL to the untilted
  //     counterfactual in this zone (never decisive here).
  // The counterfactual is always the untilted walk: walk(null, r) in the forced zone (using r
  // as-is — valid since r < tilt, and tilt <= untiltedTotal in practice; the walk's built-in
  // fallback to the last band member keeps this safe even if not), or the same value used for
  // tilted in the regular zone. This reproduces exactly the weight = base+affinity+tilt
  // distribution (theme's total share becomes (w_theme+tilt)/tiltedTotal, everyone else's
  // share is unchanged at w_other/tiltedTotal) while guaranteeing decisive ⇒ tilted key ===
  // theme, since the only zone where tilted and counterfactual can differ is the forced zone,
  // where tilted is definitionally the theme.
  const untiltedTotal = bandTotal(null);
  const tiltedTotal = untiltedTotal + tilt;
  const r = drawInt(seedRoot, tiltedTotal, "resolver", npcId, tick);

  let tilted: { action: Action; key: UtilityKey };
  let counter: { action: Action; key: UtilityKey };
  if (r < tilt) {
    const theme = band.find((c) => c.key === patronTheme)!;
    tilted = { action: theme.action, key: theme.key };
    counter = walk(null, r);
  } else {
    tilted = walk(null, r - tilt);
    counter = tilted;
  }

  return {
    action: tilted.action,
    key: tilted.key,
    source: "resolver",
    patronApplied: true,
    patronDecisive: tilted.key !== counter.key,
  };
}

export function resolve(
  candidates: ScoredCandidate[],
  identity: Identity,
  epsilon: number,
  seedRoot: string,
  npcId: string,
  tick: number,
  patronTheme?: UtilityKey | null,
): Resolution {
  return resolveWithTilt(candidates, identity, epsilon, seedRoot, npcId, tick, patronTheme, PATRON_TILT);
}
