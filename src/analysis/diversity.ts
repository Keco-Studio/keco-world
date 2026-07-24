// Shared genome-diversity metric: extracted from src/cli/degradation.ts so both the
// degradation-check CLI and the formal 1C runner (src/cli/formal.ts) use the exact
// same unbiased weight-diversity sampler (S2/D2 gates depend on this being identical
// across callers — a duplicated-and-drifted copy would silently desync the two).
import type { NpcState } from "../world/state.js";
import { UTILITY_KEYS } from "../schema/core.js";
import { drawInt } from "../rng/rng.js";

/** Deterministic cap on pairwise comparisons for weight-diversity, mirroring
 * the meanPairwiseVerbL1 pattern in src/scenarios/metrics.ts. */
const MAX_DIVERSITY_PAIRS = 200;

/** Fixed seed root for the pair-sampling draws below. Any fixed literal works —
 * it only needs to be deterministic and independent of population order/size —
 * so this is not derived from the run's actual seedRoot. */
const DIVERSITY_SAMPLE_SEED = "diversity-sample";

/**
 * Deterministically select `cap` distinct indices from [0, totalPairs) via a
 * partial Fisher-Yates shuffle keyed by drawInt. Used to sample pair-indices
 * out of the full (i,j) pair-index space when C(n,2) exceeds the cap.
 *
 * Why not `pairs.slice(0, cap)`: the (i,j) pairs are generated in ascending
 * index order (i=0,1,2,... paired with all j>i first), so a plain slice
 * systematically favors pairs involving the lowest-indexed NPCs. Because
 * `aliveNpcs` (and thus `weights`) is derived from `state.npcs` in roster/
 * birth order, "lowest index" means "oldest-born" — so a slice-based cap
 * would silently exclude most of a population's later-born NPCs from the
 * diversity metric once alive count exceeds the cap-implying threshold
 * (C(n,2) > 200 at n=21+), regardless of any real change in genotype
 * diversity among the excluded majority.
 *
 * The shuffle below draws each swap position via drawInt keyed only on a
 * fixed seed root, the literal "pair", and the shuffle step `k` — never on
 * NPC identity, birth order, or array position beyond `k` itself — so the
 * selected subset does not correlate with population order. It is still
 * fully deterministic: the same `totalPairs`/`cap` always yields the same
 * sampled index set, satisfying replay/report reproducibility.
 */
function sampleDistinctIndices(totalPairs: number, cap: number, seedRoot: string): number[] {
  const idx = Array.from({ length: totalPairs }, (_, k) => k);
  const limit = Math.min(cap, totalPairs);
  for (let k = 0; k < limit; k++) {
    const remaining = totalPairs - k;
    const j = k + drawInt(seedRoot, remaining, "pair", k);
    const tmp = idx[k]!;
    idx[k] = idx[j]!;
    idx[j] = tmp;
  }
  return idx.slice(0, limit);
}

/** Mean pairwise L1 distance over utilityWeights (each key normalized to a 0..1
 * proportion by /1000), over alive NPCs. When C(n,2) <= MAX_DIVERSITY_PAIRS, every
 * pair is used (exhaustive). Otherwise MAX_DIVERSITY_PAIRS pairs are sampled via a
 * deterministic, population-order-uncorrelated partial shuffle (see
 * sampleDistinctIndices) so the metric isn't biased toward the oldest-born NPCs.
 * Returns floor(proportion * 1000); 0 when <2 alive. */
export function computeWeightDiversity1000(aliveNpcs: NpcState[]): number {
  if (aliveNpcs.length < 2) return 0;
  const weights = aliveNpcs.map((n) => UTILITY_KEYS.map((k) => n.policy.utilityWeights[k]));
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < weights.length; i++) {
    for (let j = i + 1; j < weights.length; j++) {
      pairs.push([i, j]);
    }
  }
  const used =
    pairs.length <= MAX_DIVERSITY_PAIRS
      ? pairs
      : sampleDistinctIndices(pairs.length, MAX_DIVERSITY_PAIRS, DIVERSITY_SAMPLE_SEED).map(
          (idx) => pairs[idx]!,
        );
  if (used.length === 0) return 0;
  let totalL1 = 0;
  for (const [i, j] of used) {
    let l1 = 0;
    for (let k = 0; k < UTILITY_KEYS.length; k++) {
      l1 += Math.abs(weights[i]![k]! - weights[j]![k]!);
    }
    totalL1 += l1;
  }
  const meanL1 = totalL1 / used.length; // raw units, 0..(UTILITY_KEYS.length * 1000)
  const proportion = meanL1 / (UTILITY_KEYS.length * 1000); // 0..1
  return Math.floor(proportion * 1000);
}
