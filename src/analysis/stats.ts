// Endpoint statistics (docs/prereg-1c-draft.md §4-6): the primary-endpoint exact
// binomial test, the secondary-endpoint Holm-Bonferroni family correction, the
// cluster-robust standard error for the judge-clustered preference proportion, and
// Cohen's kappa for the double-rater causal-retelling rubric (docs/eval-rubric.md).
// Stats module — floats allowed (mirrors src/bench/stats.ts's convention).

/** log(n choose i) built iteratively via the pmf recurrence below, never materialized
 * on its own — see logBinomPmf. */
function logBinomPmf(n: number, p0: number): number[] {
  if (p0 <= 0 || p0 >= 1) {
    throw new Error(`logBinomPmf: p0 must be in (0,1), got ${p0}`);
  }
  const logs = new Array<number>(n + 1);
  logs[0] = n * Math.log(1 - p0);
  const logOdds = Math.log(p0) - Math.log(1 - p0);
  for (let i = 1; i <= n; i++) {
    // pmf(i)/pmf(i-1) = (n-i+1)/i * p0/(1-p0) -- standard binomial pmf ratio,
    // computed in log space so n up to the thousands never overflows/underflows a
    // double (unlike accumulating raw products of binomial coefficients and powers).
    logs[i] = logs[i - 1]! + Math.log(n - i + 1) - Math.log(i) + logOdds;
  }
  return logs;
}

function logSumExp(logs: number[]): number {
  let m = -Infinity;
  for (const l of logs) if (l > m) m = l;
  if (m === -Infinity) return -Infinity;
  let sum = 0;
  for (const l of logs) sum += Math.exp(l - m);
  return m + Math.log(sum);
}

/**
 * Exact two-sided binomial test p-value, minimum-likelihood method: p = sum of
 * P(X=i) over every i in [0,n] with P(X=i) <= P(X=k), X ~ Binom(n, p0).
 *
 * Hand check (docs required this be independently verifiable, not just asserted):
 * binomTwoSided(15, 20, 0.5). One-sided tail P(X>=15 | n=20,p=0.5):
 *   P(15)=C(20,15)*0.5^20=15504/1048576=0.014786
 *   P(16)=C(20,16)*0.5^20=4845/1048576=0.004620
 *   P(17)=C(20,17)*0.5^20=1140/1048576=0.001087
 *   P(18)=C(20,18)*0.5^20=190/1048576 =0.000181
 *   P(19)=C(20,19)*0.5^20=20/1048576  =0.0000191
 *   P(20)=C(20,20)*0.5^20=1/1048576   =0.00000095
 *   sum = 0.014786+0.004620+0.001087+0.000181+0.0000191+0.00000095 = 0.0206941
 * p=0.5 is symmetric (pmf(i)=pmf(n-i)), and every i>=15 has pmf(i)<=pmf(15) (pmf is
 * unimodal, strictly decreasing away from the n/2 mode) while every i<=5 mirrors it
 * exactly by symmetry, and no i in (5,15) has pmf(i)<=pmf(15) (still climbing toward
 * the mode) -- so two-sided = 2 * 0.0206941 = 0.0413882, i.e. ~0.0414. Matches the
 * brief's stated reference value.
 */
export function binomTwoSided(k: number, n: number, p0 = 0.5): number {
  if (!Number.isInteger(n) || n < 0) throw new Error(`binomTwoSided: n must be a non-negative integer, got ${n}`);
  if (!Number.isInteger(k) || k < 0 || k > n) throw new Error(`binomTwoSided: k must be an integer in [0,n], got ${k}`);

  const logs = logBinomPmf(n, p0);
  const logK = logs[k]!;
  // Floating-point tolerance so the exact-tie case (e.g. p0=0.5, i and n-i) isn't
  // dropped by rounding noise in the log-space recurrence.
  const eps = 1e-9;
  const included = logs.filter((l) => l <= logK + eps);
  return Math.min(1, Math.exp(logSumExp(included)));
}

export interface HolmResult {
  name: string;
  p: number;
  adjustedAlpha: number;
  reject: boolean;
}

/**
 * Holm-Bonferroni step-down family correction. Sort ascending by raw p; test i (0
 * indexed, m = family size) against adjustedAlpha_i = alpha/(m-i); reject H0_i while
 * p_i <= adjustedAlpha_i; the FIRST failure to reject stops the cascade -- every
 * later (larger-p) hypothesis is non-rejected regardless of its own raw p, since
 * Holm's validity depends on stopping at the first non-rejection, not re-testing.
 *
 * Worked example (m=3, alpha=0.05), verified by hand:
 *   p = [0.01, 0.02, 0.04] (already ascending)
 *   i=0: adjustedAlpha=0.05/3=0.01667; 0.01<=0.01667 -> reject
 *   i=1: adjustedAlpha=0.05/2=0.025;   0.02<=0.025   -> reject
 *   i=2: adjustedAlpha=0.05/1=0.05;    0.04<=0.05    -> reject
 *   All three reject here. Swap the last p to 0.03 to force a cascade stop:
 *   p = [0.01, 0.02, 0.03]:
 *   i=0: 0.01<=0.01667 -> reject
 *   i=1: 0.02<=0.025   -> reject
 *   i=2: 0.03<=0.05    -> reject (still passes on its own adjustedAlpha)
 *   To actually see a stop, p = [0.01, 0.02, 0.5]:
 *   i=0: 0.01<=0.01667 -> reject
 *   i=1: 0.02<=0.025   -> reject
 *   i=2: 0.5<=0.05      -> false -> not reject, cascade stops (there is no i=3 to
 *   force non-rejected regardless, but with a 4th hypothesis at raw p=0.001 it would
 *   still be marked non-rejected because it sorts after the failure).
 */
export function holmBonferroni(pvals: { name: string; p: number }[], alpha = 0.05): HolmResult[] {
  const m = pvals.length;
  const sorted = [...pvals].sort((a, b) => a.p - b.p);
  const results: HolmResult[] = [];
  let cascadeStopped = false;
  for (let i = 0; i < m; i++) {
    const { name, p } = sorted[i]!;
    const adjustedAlpha = alpha / (m - i);
    const reject = !cascadeStopped && p <= adjustedAlpha;
    if (!reject) cascadeStopped = true;
    results.push({ name, p, adjustedAlpha, reject });
  }
  return results;
}

export interface ClusterRobustResult {
  pHat: number;
  se: number;
  z: number;
  pValue: number;
}

/** Standard normal CDF via the Abramowitz-Stegun 7.1.26 erf approximation
 * (max error ~1.5e-7) -- no erf builtin in Node/TS, and this is more than accurate
 * enough for a p-value reported to a handful of significant figures. */
function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const pc = 0.3275911;
  const t = 1 / (1 + pc * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/**
 * Judge-level cluster-robust ("sandwich") standard error for a single proportion
 * (docs/prereg-1c-draft.md §4's "聚类稳健标准误复核"). Judgments are grouped by
 * judgeId (a judge may contribute up to 8, per the prereg's `--judgments` cap);
 * pHat is the plain pooled proportion (total successes / total n), NOT a mean of
 * per-judge proportions. Per-judge residual sums u_j = sum_i(x_ij - pHat) feed a
 * cluster-sandwich variance:
 *
 *   Var(pHat) = (G/(G-1)) * sum_j(u_j^2) / n_total^2      [G = judge count]
 *   se        = sqrt(Var(pHat))
 *
 * the G/(G-1) factor is the small-sample cluster correction (Stata's default
 * `cluster()` df adjustment, simplified here to just the group-count term since we
 * have no regression degrees-of-freedom to also correct for -- documented rather
 * than silently omitted).
 *
 * Degenerate check (1 judgment/judge, so G = n_total): for 0/1 data, the identity
 * sum_i(x_i - pHat)^2 = n*pHat*(1-pHat) holds exactly when pHat is the sample mean
 * of x_i (standard: k terms of (1-pHat)^2 plus (n-k) terms of pHat^2 collapse to
 * n*pHat*(1-pHat) once pHat=k/n is substituted). So sum_j(u_j^2) = n*pHat*(1-pHat)
 * and se = sqrt((n/(n-1)) * n*pHat*(1-pHat)) / n = sqrt(pHat(1-pHat)/n) *
 * sqrt(n/(n-1)) -- the plain binomial SE times a small-sample factor that -> 1 as
 * n grows, i.e. "approximately" (not exactly) binomial SE, which is what the test
 * pins.
 */
export function clusterRobustPrefSE(judgments: { judgeId: string; choseEvolutionary: boolean }[]): ClusterRobustResult {
  const nTotal = judgments.length;
  if (nTotal === 0) throw new Error("clusterRobustPrefSE: judgments must be non-empty");

  const successes = judgments.filter((j) => j.choseEvolutionary).length;
  const pHat = successes / nTotal;

  const byJudge = new Map<string, boolean[]>();
  for (const j of judgments) {
    const arr = byJudge.get(j.judgeId) ?? [];
    arr.push(j.choseEvolutionary);
    byJudge.set(j.judgeId, arr);
  }
  const G = byJudge.size;

  let sumUj2 = 0;
  for (const xs of byJudge.values()) {
    const uj = xs.reduce((acc, x) => acc + ((x ? 1 : 0) - pHat), 0);
    sumUj2 += uj * uj;
  }

  // G=1 (a single judge contributed every judgment): the G/(G-1) correction is
  // undefined (division by zero) -- fall back to no small-sample correction (factor
  // 1) rather than producing NaN/Infinity. This is an edge case the design's "each
  // judge <=8 judgments, 150-200 total, 25+ judges" target never actually hits.
  const smallSampleFactor = G > 1 ? G / (G - 1) : 1;
  const variance = (smallSampleFactor * sumUj2) / (nTotal * nTotal);
  const se = Math.sqrt(variance);

  const z = se === 0 ? 0 : (pHat - 0.5) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));

  return { pHat, se, z, pValue };
}

/**
 * Cohen's kappa for two raters over categorical codes (docs/eval-rubric.md's 0-3
 * causal-retelling rubric): kappa = (po - pe) / (1 - pe), po = observed agreement
 * rate, pe = chance agreement expected from each rater's own marginal category
 * distribution (sum over categories of P_a(c)*P_b(c)).
 *
 * Hand-computed example (n=10, categories {0,1,2,3}):
 *   a = [0,1,2,3,0,1,2,3,1,2]
 *   b = [0,1,2,3,1,1,2,2,1,3]
 *   po: matches at indices 0,1,2,3,5,6,8 (7 of 10) -> po = 0.7
 *   a marginals: 0:2/10, 1:3/10, 2:3/10, 3:2/10
 *   b marginals: 0:1/10, 1:4/10, 2:3/10, 3:2/10
 *   pe = 0.2*0.1 + 0.3*0.4 + 0.3*0.3 + 0.2*0.2 = 0.02+0.12+0.09+0.04 = 0.27
 *   kappa = (0.7-0.27)/(1-0.27) = 0.43/0.73 = 0.589041...
 */
export function cohenKappa(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`cohenKappa: rater arrays must be the same length, got ${a.length} and ${b.length}`);
  const n = a.length;
  if (n === 0) throw new Error("cohenKappa: rater arrays must be non-empty");

  let agree = 0;
  const marginalA = new Map<number, number>();
  const marginalB = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    if (ai === bi) agree += 1;
    marginalA.set(ai, (marginalA.get(ai) ?? 0) + 1);
    marginalB.set(bi, (marginalB.get(bi) ?? 0) + 1);
  }
  const po = agree / n;

  const categories = new Set([...marginalA.keys(), ...marginalB.keys()]);
  let pe = 0;
  for (const c of categories) {
    const pa = (marginalA.get(c) ?? 0) / n;
    const pb = (marginalB.get(c) ?? 0) / n;
    pe += pa * pb;
  }

  if (pe === 1) return po === 1 ? 1 : 0; // degenerate: every rating in one category
  return (po - pe) / (1 - pe);
}
