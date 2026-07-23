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
 *
 * Precondition (not enforced): callers should keep `tilt < untiltedTotal` (the sum of
 * RESOLVER_BASE_WEIGHT+affinity over the band). In practice this always holds — a band has
 * >= 2 members (single-member bands short-circuit above), so untiltedTotal >= 2*100 = 200,
 * comfortably above every calibration candidate (<= 150). If it's ever violated, `walk`'s
 * fallback to the last band member keeps the draw well-defined rather than crashing; the
 * probabilities just stop matching the intended weight formula for that misuse.
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

  // Coupled, ORDER-INDEPENDENT draw. An earlier version of this function split [0, total)
  // into "forced zone r < tilt -> theme" then "regular zone -> untilted walk in original band
  // order" (or the reverse split). Both are order-DEPENDENT: whichever zone abuts the theme's
  // own slice in the chosen band order silently merges into it, so whenever the theme sits at
  // that end of band order AND its own untilted weight already exceeds the zone width,
  // `patronDecisive` is structurally always false there — even though the tilt still moved
  // real probability mass. (Confirmed empirically: theme first-in-band with w_theme >= tilt
  // reproduces this exactly.) The fix must not depend on where the theme falls in band order,
  // since band order is fixed by candidate kind, not by which key the patron backs.
  //
  // Reorder the band, conceptually, as [...non-theme candidates in existing order, theme]
  // (a relabeling only — it changes which r maps to which candidate, not either lottery's
  // marginal distribution). Let S = untiltedTotal, total = S + tilt (tilt adds only to the
  // theme's own weight). Draw once, r = drawInt(seedRoot, S + tilt, "resolver", npcId, tick)
  // (same key as before). Three zones over the reordered layout:
  //   - r < S - w_theme        : reordered walk lands on some non-theme candidate — identical
  //                               computation for tilted and counterfactual. Not decisive.
  //   - S - w_theme <= r < S   : reordered walk lands on the theme's own (untilted) slice,
  //                               now positioned last, right before the boundary at S — again
  //                               identical for tilted/counterfactual. Not decisive.
  //   - S <= r < S + tilt      : the moved sliver, i.e. exactly the extra mass the tilt added.
  //     tilted := theme, forced. The counterfactual must answer "what would an untilted draw
  //     have picked instead", which this r cannot answer (it has no untilted meaning) — so it
  //     is redrawn independently via r2 = drawInt(seedRoot, S, "resolver-cf", npcId, tick),
  //     walked against the untilted weights. Decisive iff that redraw's key !== theme.
  // (In practice the first two zones collapse into a single walk call below — the theme's own
  // untilted slice sits wherever the reordered array places it, and by construction tilted and
  // counterfactual are IDENTICAL for any r < S regardless of which candidate that r lands on,
  // so there is no need to special-case the internal S - w_theme boundary.)
  //
  // Correctness: tilted marginal = (w_theme+tilt)/(S+tilt) for theme, w_c/(S+tilt) for every
  // other candidate c — matches "weight = base+affinity(+tilt if theme)" exactly. Counterfactual
  // marginal = w_c/S for every c (i.e. exactly the plain untilted lottery): the r<S branch
  // contributes w_c/(S+tilt) to each c (branch probability S/(S+tilt) times within-branch
  // probability w_c/S), and the sliver branch's independent redraw contributes
  // (tilt/(S+tilt))*(w_c/S) to each c; summing gives w_c/S. Decisive probability =
  // P(r in sliver) * P(redraw != theme) = [tilt/(S+tilt)] * [(S-w_theme)/S] =
  // tilt*(S-w_theme) / (S*(S+tilt)) — exactly the total-variation distance between the tilted
  // and untilted lotteries, independent of band order. The extra "resolver-cf" draw only ever
  // feeds `patronDecisive` (the audit flag); it never touches `action`/`key`, so it cannot
  // affect world state, determinism, or replay.
  const untiltedTotal = bandTotal(null);
  const total = untiltedTotal + tilt;
  const r = drawInt(seedRoot, total, "resolver", npcId, tick);

  let tilted: { action: Action; key: UtilityKey };
  let counter: { action: Action; key: UtilityKey };
  if (r < untiltedTotal) {
    const result = walk(null, r); // untilted draw; identical for tilted and counterfactual
    tilted = result;
    counter = result;
  } else {
    const theme = band.find((c) => c.key === patronTheme)!;
    tilted = { action: theme.action, key: theme.key };
    const r2 = drawInt(seedRoot, untiltedTotal, "resolver-cf", npcId, tick);
    counter = walk(null, r2);
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
