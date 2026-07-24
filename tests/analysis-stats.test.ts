import { describe, it, expect } from "vitest";
import { binomTwoSided, holmBonferroni, clusterRobustPrefSE, cohenKappa } from "../src/analysis/stats.js";

describe("binomTwoSided", () => {
  it("k at the mode (n/2) -> two-sided p approx 1 (every outcome is at-least-as-likely as the mode)", () => {
    expect(binomTwoSided(10, 20, 0.5)).toBeCloseTo(1, 6);
  });

  it("k=15,n=20,p0=0.5 -> exact two-sided p approx 0.0414 (independent hand check)", () => {
    // One-sided tail P(X>=15 | n=20,p=0.5), computed by hand from C(20,i)/2^20:
    //   P(15)=15504/1048576=0.0147857
    //   P(16)=4845/1048576 =0.0046196
    //   P(17)=1140/1048576 =0.0010872
    //   P(18)=190/1048576  =0.0001812
    //   P(19)=20/1048576   =0.0000191
    //   P(20)=1/1048576    =0.0000010
    //   tail sum = 0.0206938
    // p=0.5 is symmetric (pmf(i)=pmf(n-i)) and pmf is unimodal decreasing away from
    // i=10, so every i>=15 is <=pmf(15) and, by symmetry, so is every i<=5 -- nothing
    // in between qualifies. Two-sided = 2 * 0.0206938 = 0.0413876 ~= 0.0414.
    const p = binomTwoSided(15, 20, 0.5);
    expect(p).toBeLessThan(0.05);
    expect(p).toBeCloseTo(0.0414, 3);
  });

  it("k=0 or k=n -> two-sided p is the (tiny) two-tailed extreme, not 1", () => {
    expect(binomTwoSided(0, 20, 0.5)).toBeCloseTo(2 / Math.pow(2, 20), 8);
    expect(binomTwoSided(20, 20, 0.5)).toBeCloseTo(2 / Math.pow(2, 20), 8);
  });

  it("supports a non-0.5 null (p0 param)", () => {
    // k=n -> the single most extreme outcome under any p0 in (0,1): two-sided p
    // should just be P(X=n) itself (nothing else can be <= the most extreme pmf
    // value on the high side... unless p0 is small, in which case low-k outcomes can
    // tie/beat it in likelihood). Use p0=0.9, n=10, k=10: pmf is monotonically
    // increasing toward k=10 (mode near 9), so P(X=10) is NOT the smallest pmf value
    // -- pick k=0 instead, the tail farthest from a p0=0.9 mode, for an
    // unambiguous minimum-likelihood point.
    const p = binomTwoSided(0, 10, 0.9);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(0.01);
  });

  it("rejects an out-of-range k", () => {
    expect(() => binomTwoSided(-1, 10)).toThrow();
    expect(() => binomTwoSided(11, 10)).toThrow();
  });
});

describe("holmBonferroni", () => {
  it("worked example: all three reject (m=3, alpha=0.05)", () => {
    // p = [0.04, 0.01, 0.02] fed out of order to also confirm sort-ascending behavior.
    // sorted: 0.01, 0.02, 0.04
    //   i=0: adjustedAlpha=0.05/3=0.016667; 0.01<=0.016667 -> reject
    //   i=1: adjustedAlpha=0.05/2=0.025;    0.02<=0.025    -> reject
    //   i=2: adjustedAlpha=0.05/1=0.05;     0.04<=0.05     -> reject
    const results = holmBonferroni(
      [
        { name: "c", p: 0.04 },
        { name: "a", p: 0.01 },
        { name: "b", p: 0.02 },
      ],
      0.05,
    );
    expect(results.map((r) => r.name)).toEqual(["a", "b", "c"]); // ascending-p order
    expect(results[0]).toMatchObject({ p: 0.01, adjustedAlpha: 0.05 / 3, reject: true });
    expect(results[1]).toMatchObject({ p: 0.02, adjustedAlpha: 0.05 / 2, reject: true });
    expect(results[2]).toMatchObject({ p: 0.04, adjustedAlpha: 0.05 / 1, reject: true });
  });

  it("cascade stops at the first non-rejection: later (larger-p) hypotheses stay non-rejected regardless of their own raw p", () => {
    // sorted: 0.01, 0.02, 0.5, 0.001 -- wait, must sort: 0.001, 0.01, 0.02, 0.5
    // Use p = [0.001, 0.02, 0.5, 0.01] (m=4, alpha=0.05):
    // sorted ascending: 0.001, 0.01, 0.02, 0.5
    //   i=0: adjustedAlpha=0.05/4=0.0125; 0.001<=0.0125 -> reject
    //   i=1: adjustedAlpha=0.05/3=0.016667; 0.01<=0.016667 -> reject
    //   i=2: adjustedAlpha=0.05/2=0.025; 0.02<=0.025 -> reject
    //   i=3: adjustedAlpha=0.05/1=0.05; 0.5<=0.05 -> false -> cascade stops here
    // (this example's cascade only "stops" at the very last item; force an earlier
    // stop by replacing the third-sorted p with something that fails its own
    // threshold while a later, even-larger p might have separately passed its own
    // looser one -- Holm says it doesn't matter, it's still non-rejected.)
    const results = holmBonferroni(
      [
        { name: "w", p: 0.001 },
        { name: "x", p: 0.03 }, // fails i=2's adjustedAlpha=0.025 -> cascade stops here
        { name: "y", p: 0.038 }, // would itself satisfy i=3's adjustedAlpha=0.05, but must stay non-rejected
        { name: "z", p: 0.01 },
      ],
      0.05,
    );
    // sorted ascending: w(0.001), z(0.01), x(0.03), y(0.038)
    expect(results.map((r) => r.name)).toEqual(["w", "z", "x", "y"]);
    expect(results[0]!.reject).toBe(true); // 0.001 <= 0.05/4=0.0125
    expect(results[1]!.reject).toBe(true); // 0.01  <= 0.05/3=0.016667
    expect(results[2]!.reject).toBe(false); // 0.03  <= 0.05/2=0.025 is false -> cascade stops
    expect(results[3]!.reject).toBe(false); // 0.038 <= 0.05/1=0.05 would pass on its own, but stays non-rejected
  });
});

describe("clusterRobustPrefSE", () => {
  it("degenerates to ~binomial SE when every judge contributes exactly 1 judgment", () => {
    // 20 judges, 1 judgment each, 14 chose evolutionary -> pHat=0.7
    const judgments = Array.from({ length: 20 }, (_, i) => ({
      judgeId: `judge-${i}`,
      choseEvolutionary: i < 14,
    }));
    const result = clusterRobustPrefSE(judgments);
    expect(result.pHat).toBeCloseTo(0.7, 10);

    const naiveBinomialSE = Math.sqrt((0.7 * 0.3) / 20); // = 0.10247
    // Cluster SE = naive * sqrt(G/(G-1)) = naive * sqrt(20/19) here (see stats.ts doc
    // comment for the exact identity sum(u_j^2) = n*pHat*(1-pHat) at 1-per-judge).
    const expectedSE = naiveBinomialSE * Math.sqrt(20 / 19);
    expect(result.se).toBeCloseTo(expectedSE, 10);
    // "approximately" binomial, not exactly -- the small-sample correction bumps it up a little.
    expect(result.se).toBeGreaterThan(naiveBinomialSE);
    expect(result.se / naiveBinomialSE).toBeCloseTo(1, 1); // within ~10%, i.e. "approx"
  });

  it("grows vs a naive iid-across-judgments SE when judges internally agree (positive intra-cluster correlation)", () => {
    // Same aggregate proportion (12/20 = 0.6 chose evolutionary), two different
    // clusterings:
    //  (a) spread thin: 20 judges x 1 judgment each -> clusters carry no extra
    //      correlation info beyond the raw Bernoulli draws.
    //  (b) clumped: 4 judges x 5 judgments each, and each judge is internally
    //      UNANIMOUS (all-yes or all-no) so that within a cluster there is nothing
    //      but agreement -- the clustering carries strictly less independent
    //      information than 20 separate judges, so its cluster-robust SE must be
    //      larger than case (a)'s.
    const spread = Array.from({ length: 20 }, (_, i) => ({
      judgeId: `judge-${i}`,
      choseEvolutionary: i < 12,
    }));
    // 3 judges of 5 "all chose evolutionary" (15) is too many; need exactly 12/20.
    // Use judges of size 5: 2 unanimous-yes judges (10) + judges contributing the
    // remaining 2 yes / 8 no split across 2 more judges of 5, each internally
    // unanimous is impossible for a 2/5 split -- so allow the last two judges to
    // be non-unanimous but identical to each other (still more within-cluster
    // repetition than the fully spread case).
    const clumped = [
      ...Array.from({ length: 5 }, (_, i) => ({ judgeId: "j0", choseEvolutionary: true })),
      ...Array.from({ length: 5 }, (_, i) => ({ judgeId: "j1", choseEvolutionary: true })),
      ...Array.from({ length: 5 }, (_, i) => ({ judgeId: "j2", choseEvolutionary: i < 1 })),
      ...Array.from({ length: 5 }, (_, i) => ({ judgeId: "j3", choseEvolutionary: i < 1 })),
    ];
    expect(clumped.filter((j) => j.choseEvolutionary).length).toBe(12); // same pHat=0.6 as `spread`

    const spreadResult = clusterRobustPrefSE(spread);
    const clumpedResult = clusterRobustPrefSE(clumped);
    expect(spreadResult.pHat).toBeCloseTo(0.6, 10);
    expect(clumpedResult.pHat).toBeCloseTo(0.6, 10);
    expect(clumpedResult.se).toBeGreaterThan(spreadResult.se);
  });

  it("z and pValue are consistent with pHat/se (two-sided normal test vs 0.5)", () => {
    const judgments = Array.from({ length: 30 }, (_, i) => ({
      judgeId: `judge-${i}`,
      choseEvolutionary: i < 20, // pHat = 2/3
    }));
    const result = clusterRobustPrefSE(judgments);
    expect(result.z).toBeCloseTo((result.pHat - 0.5) / result.se, 10);
    expect(result.pValue).toBeGreaterThan(0);
    expect(result.pValue).toBeLessThan(1);
    // A clearly-above-0.5 proportion with 30 observations should read as strongly
    // suggestive, even after the cluster small-sample correction inflates SE a bit
    // vs the naive binomial figure (naive z=(0.667-0.5)/sqrt(0.667*0.333/30)=1.94,
    // p~0.052; cluster-robust with G/(G-1)=30/29 correction is very slightly wider).
    expect(result.pValue).toBeLessThan(0.1);
  });
});

describe("cohenKappa", () => {
  it("perfect agreement -> kappa = 1", () => {
    const a = [0, 1, 2, 3, 1, 2, 0, 3];
    expect(cohenKappa(a, [...a])).toBeCloseTo(1, 10);
  });

  it("hand-computed constructed example -> known kappa value", () => {
    // a = [0,1,2,3,0,1,2,3,1,2]
    // b = [0,1,2,3,1,1,2,2,1,3]
    // po: agree at indices 0,1,2,3,5,6,8 (7/10) = 0.7
    // a marginals: {0:2,1:3,2:3,3:2}/10 ; b marginals: {0:1,1:4,2:3,3:2}/10
    // pe = 0.2*0.1 + 0.3*0.4 + 0.3*0.3 + 0.2*0.2 = 0.02+0.12+0.09+0.04 = 0.27
    // kappa = (0.7-0.27)/(1-0.27) = 0.43/0.73 = 0.5890410958904109
    const a = [0, 1, 2, 3, 0, 1, 2, 3, 1, 2];
    const b = [0, 1, 2, 3, 1, 1, 2, 2, 1, 3];
    expect(cohenKappa(a, b)).toBeCloseTo(0.589041095890411, 10);
  });

  it("rejects mismatched lengths", () => {
    expect(() => cohenKappa([0, 1], [0])).toThrow();
  });
});
