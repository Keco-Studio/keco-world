import type { ScenarioTrace, GenomeUnderTest, Scenario, ScenarioCategory } from "./framework.js";
import { evaluateGenome } from "./framework.js";

export type VerbHistogram = Record<string, number>;

/**
 * Count verb occurrences across all traces.
 */
export function verbHistogram(traces: ScenarioTrace[]): VerbHistogram {
  const hist: VerbHistogram = {};
  for (const trace of traces) {
    for (const verb of trace.verbs) {
      hist[verb] = (hist[verb] ?? 0) + 1;
    }
  }
  return hist;
}

/**
 * Normalized L1 distance between two histograms over proportions.
 * Returns 0..2, where:
 * - 0 means identical distributions
 * - 2 means completely disjoint (no shared keys)
 */
export function histogramL1(a: VerbHistogram, b: VerbHistogram): number {
  // Get total counts
  const totalA = Object.values(a).reduce((sum, count) => sum + count, 0);
  const totalB = Object.values(b).reduce((sum, count) => sum + count, 0);

  // Get union of all keys
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

  // Compute L1 distance over proportions
  let distance = 0;
  for (const key of allKeys) {
    const propA = totalA > 0 ? (a[key] ?? 0) / totalA : 0;
    const propB = totalB > 0 ? (b[key] ?? 0) / totalB : 0;
    distance += Math.abs(propA - propB);
  }

  return distance;
}

/**
 * Generate n-gram profiles from verbs within each trace (no cross-trace n-grams).
 * Keys are verb sequences joined by "|".
 */
export function ngramProfile(traces: ScenarioTrace[], n: number): Map<string, number> {
  const profile = new Map<string, number>();

  for (const trace of traces) {
    for (let i = 0; i <= trace.verbs.length - n; i++) {
      const ngram = trace.verbs.slice(i, i + n).join("|");
      profile.set(ngram, (profile.get(ngram) ?? 0) + 1);
    }
  }

  return profile;
}

/**
 * Normalized L1 distance between two n-gram profiles over proportions.
 * Returns 0..2.
 */
export function ngramDistance(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  // Get total counts
  const totalA = Array.from(a.values()).reduce((sum, count) => sum + count, 0);
  const totalB = Array.from(b.values()).reduce((sum, count) => sum + count, 0);

  // Get union of all keys
  const allKeys = new Set([...a.keys(), ...b.keys()]);

  // Compute L1 distance over proportions
  let distance = 0;
  for (const key of allKeys) {
    const propA = totalA > 0 ? (a.get(key) ?? 0) / totalA : 0;
    const propB = totalB > 0 ? (b.get(key) ?? 0) / totalB : 0;
    distance += Math.abs(propA - propB);
  }

  return distance;
}

export interface GenomeComparison {
  verbL1: number;
  bigramL1: number;
  keyShift: Record<string, number>;          // per-chosenKey proportion delta (B minus A)
  byCategory: Record<ScenarioCategory, { verbL1: number }>;
  disagreementRate: number;                  // fraction of scenarios where first-decision verbs differ
}

/**
 * Compare two genomes across all scenarios.
 */
export function compareGenomes(
  a: GenomeUnderTest,
  b: GenomeUnderTest,
  scenarios: Scenario[],
): GenomeComparison {
  const tracesA = evaluateGenome(a, scenarios);
  const tracesB = evaluateGenome(b, scenarios);

  // Verb histograms and L1
  const histA = verbHistogram(tracesA);
  const histB = verbHistogram(tracesB);
  const verbL1 = histogramL1(histA, histB);

  // Bigram profiles and L1
  const bigramA = ngramProfile(tracesA, 2);
  const bigramB = ngramProfile(tracesB, 2);
  const bigramL1 = ngramDistance(bigramA, bigramB);

  // Key shift: per-chosenKey proportion delta (B minus A)
  const keyShift: Record<string, number> = {};
  const allKeys = new Set<string>();
  for (const trace of tracesA) {
    for (const key of trace.keys) {
      if (key !== null) allKeys.add(key);
    }
  }
  for (const trace of tracesB) {
    for (const key of trace.keys) {
      if (key !== null) allKeys.add(key);
    }
  }

  for (const key of allKeys) {
    const countA = tracesA.reduce((sum, t) => sum + (t.keys.filter(k => k === key).length), 0);
    const countB = tracesB.reduce((sum, t) => sum + (t.keys.filter(k => k === key).length), 0);
    const totalA = tracesA.reduce((sum, t) => sum + t.keys.length, 0);
    const totalB = tracesB.reduce((sum, t) => sum + t.keys.length, 0);
    const propA = totalA > 0 ? countA / totalA : 0;
    const propB = totalB > 0 ? countB / totalB : 0;
    keyShift[key] = propB - propA;
  }

  // By category: verb L1 for each category
  const byCategory: Record<ScenarioCategory, { verbL1: number }> = {
    hunger: { verbL1: 0 },
    winter: { verbL1: 0 },
    predator: { verbL1: 0 },
    courtship: { verbL1: 0 },
    hesitation: { verbL1: 0 },
    sequence: { verbL1: 0 },
  };

  for (const category of Object.keys(byCategory) as ScenarioCategory[]) {
    const scenariosInCategory = scenarios.filter(s => s.category === category);
    const tracesAInCategory = tracesA.filter(t => scenariosInCategory.some(s => s.id === t.scenarioId));
    const tracesBInCategory = tracesB.filter(t => scenariosInCategory.some(s => s.id === t.scenarioId));

    const histACategory = verbHistogram(tracesAInCategory);
    const histBCategory = verbHistogram(tracesBInCategory);
    byCategory[category].verbL1 = histogramL1(histACategory, histBCategory);
  }

  // Disagreement rate: fraction of scenarios where first verb differs
  let disagreements = 0;
  for (let i = 0; i < tracesA.length; i++) {
    const traceA = tracesA[i]!;
    const traceB = tracesB[i]!;
    if (traceA.verbs.length > 0 && traceB.verbs.length > 0) {
      if (traceA.verbs[0] !== traceB.verbs[0]) {
        disagreements++;
      }
    }
  }
  const disagreementRate = tracesA.length > 0 ? disagreements / tracesA.length : 0;

  return {
    verbL1,
    bigramL1,
    keyShift,
    byCategory,
    disagreementRate,
  };
}

/**
 * Mean L1 distance over all pairs of genomes.
 * If number of pairs C(n,2) exceeds maxPairs, takes the first maxPairs pairs
 * in deterministic (i<j) order.
 *
 * Performance: evaluates each genome exactly once, then computes pairwise
 * distances from pre-computed verb histograms.
 */
export function meanPairwiseVerbL1(
  genomes: GenomeUnderTest[],
  scenarios: Scenario[],
  maxPairs: number = 100,
): number {
  if (genomes.length < 2) {
    return 0;
  }

  // Evaluate each genome exactly once
  const traces = genomes.map(g => evaluateGenome(g, scenarios));

  // Compute verb histogram for each genome
  const hists = traces.map(verbHistogram);

  // Generate all pairs (i < j)
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < genomes.length; i++) {
    for (let j = i + 1; j < genomes.length; j++) {
      pairs.push([i, j]);
    }
  }

  // Limit to maxPairs if needed
  const pairsToUse = pairs.slice(0, maxPairs);

  // Compute mean verbL1 over selected pairs
  let totalL1 = 0;
  for (const [i, j] of pairsToUse) {
    const l1 = histogramL1(hists[i]!, hists[j]!);
    totalL1 += l1;
  }

  return pairsToUse.length > 0 ? totalL1 / pairsToUse.length : 0;
}

/**
 * Mean verbL1 distance over cross pairs (a_i, b_j) between two genome sets.
 * If |a|×|b| exceeds maxPairs, takes the first maxPairs pairs in deterministic
 * row-major order (i.e. i=0 paired with every j, then i=1, ...).
 *
 * Performance: evaluates each genome in each set exactly once, then computes
 * cross-pair distances from pre-computed verb histograms (no per-pair re-evaluation).
 */
export function meanCrossVerbL1(
  a: GenomeUnderTest[],
  b: GenomeUnderTest[],
  scenarios: Scenario[],
  maxPairs: number = 100,
): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  // Evaluate each genome exactly once
  const histsA = a.map((g) => verbHistogram(evaluateGenome(g, scenarios)));
  const histsB = b.map((g) => verbHistogram(evaluateGenome(g, scenarios)));

  // Generate all cross pairs (i, j) in deterministic row-major order
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      pairs.push([i, j]);
    }
  }

  // Limit to maxPairs if needed
  const pairsToUse = pairs.slice(0, maxPairs);

  // Compute mean verbL1 over selected pairs
  let totalL1 = 0;
  for (const [i, j] of pairsToUse) {
    totalL1 += histogramL1(histsA[i]!, histsB[j]!);
  }

  return pairsToUse.length > 0 ? totalL1 / pairsToUse.length : 0;
}
