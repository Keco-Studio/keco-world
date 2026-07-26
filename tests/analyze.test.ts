import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeRecommendation, runAnalysis } from "../src/cli/analyze.js";
import type { PrimaryEndpointResult } from "../src/cli/analyze.js";
import type { SGateReport } from "../src/cli/formal.js";

// Scratch dir under the repo's gitignored runs/ (same pattern as tests/formal.test.ts),
// used for the runAnalysis integration tests that need sgates-<arm>.json on disk.
const SCRATCH = join("runs", "analyze-test-scratch");

beforeAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
});

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/** Minimal structurally-valid SGateReport for recommendation-logic tests — perSeed
 * and idleSlope1000 are irrelevant to computeRecommendation/runAnalysis's pass/fail
 * wiring, so they're left empty by default. */
function makeSGates(overrides: Partial<SGateReport> = {}): SGateReport {
  return {
    perSeed: [],
    s1Pass: true,
    s1PassingSeeds: 12,
    s2Pass: true,
    s3Pass: true,
    s3PassingSeeds: 12,
    s3EvaluatedSeeds: 12,
    s4Pass: true,
    s5Pass: true,
    exempt: false,
    idleSlope1000: [],
    ...overrides,
  };
}

/** Minimal structurally-valid PrimaryEndpointResult, defaulting to a clearly-passing
 * primary endpoint (n=200, point estimate 0.65, significant, Wilson CI excludes 0.5). */
function makePrimary(overrides: Partial<PrimaryEndpointResult> = {}): PrimaryEndpointResult {
  return {
    n: 200,
    k: 130,
    pointEstimate: 0.65,
    pValueTwoSided: 0.001,
    significant: true,
    passes062: true,
    primaryPass: true,
    wilson: { p: 0.65, lo: 0.58, hi: 0.71 },
    clusterRobust: { error: "not needed for this synthetic fixture" },
    ...overrides,
  };
}

describe("computeRecommendation — evolutionary-only S-gate basis (post-pilot remap)", () => {
  it("evolutionary S1 fail => Stop, even with N gates passing and no primary endpoint", () => {
    const evoSGates = makeSGates({ s1Pass: false, s1PassingSeeds: 8 });
    const rec = computeRecommendation(evoSGates, /* nPass */ true, /* primary */ null);
    expect(rec.verdict).toBe("Stop");
    expect(rec.reason).toMatch(/evolutionary arm S1 failed/);
  });

  it("evolutionary S1 fail => Stop even when a positive primary endpoint is also present", () => {
    const evoSGates = makeSGates({ s1Pass: false });
    const rec = computeRecommendation(evoSGates, true, makePrimary());
    expect(rec.verdict).toBe("Stop");
    expect(rec.reason).toMatch(/evolutionary arm S1 failed/);
  });

  it("missing evolutionary S-gate data does not itself trigger Stop (falls through to Iterate)", () => {
    const rec = computeRecommendation(undefined, true, null);
    expect(rec.verdict).not.toBe("Stop");
    expect(rec.verdict).toBe("Iterate");
  });

  it("Go requires the primary endpoint to be computed, not just S/N gates passing", () => {
    const evoSGates = makeSGates(); // all S1-S5 pass
    const rec = computeRecommendation(evoSGates, /* nPass */ true, /* primary */ null);
    expect(rec.verdict).not.toBe("Go");
    expect(rec.verdict).toBe("Iterate");
  });

  it("Go requires the primary endpoint to pass, not merely be computed", () => {
    const evoSGates = makeSGates();
    const notPassingPrimary = makePrimary({
      primaryPass: false,
      pointEstimate: 0.55,
      significant: false,
      wilson: { p: 0.55, lo: 0.48, hi: 0.62 },
    });
    const rec = computeRecommendation(evoSGates, true, notPassingPrimary);
    expect(rec.verdict).not.toBe("Go");
  });

  it("Go: evolutionary S1-S5 all pass + N gates pass + primary endpoint computed and passing", () => {
    const evoSGates = makeSGates();
    const rec = computeRecommendation(evoSGates, true, makePrimary());
    expect(rec.verdict).toBe("Go");
  });

  it("negative primary endpoint with Wilson CI upper bound < 0.5 => Stop, even with S/N gates passing", () => {
    const evoSGates = makeSGates();
    const negativePrimary = makePrimary({
      pointEstimate: 0.3,
      k: 60,
      significant: true,
      primaryPass: false,
      wilson: { p: 0.3, lo: 0.24, hi: 0.37 },
    });
    const rec = computeRecommendation(evoSGates, true, negativePrimary);
    expect(rec.verdict).toBe("Stop");
    expect(rec.reason).toMatch(/primary endpoint direction negative/);
  });

  it("negative point estimate alone (Wilson CI hi >= 0.5) does not trigger Stop", () => {
    const evoSGates = makeSGates();
    const ambiguousPrimary = makePrimary({
      pointEstimate: 0.48,
      k: 96,
      significant: false,
      primaryPass: false,
      wilson: { p: 0.48, lo: 0.41, hi: 0.55 },
    });
    const rec = computeRecommendation(evoSGates, true, ambiguousPrimary);
    expect(rec.verdict).not.toBe("Stop");
  });
});

describe("runAnalysis — S-gates-overall basis is the evolutionary arm only", () => {
  it("a non-evolutionary arm's S1 failure does not fail sPass, does not cause Stop, and is reported as comparative", () => {
    const outDir = join(SCRATCH, "non-evo-fail");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "sgates-fixed.json"), JSON.stringify(makeSGates({ s1Pass: false, s1PassingSeeds: 5 })));
    writeFileSync(join(outDir, "sgates-evolutionary.json"), JSON.stringify(makeSGates()));

    const result = runAnalysis(outDir);

    expect(result.sGatesOverallBasis).toBe("evolutionary");
    expect(result.sPass).toBe(true); // fixed's S1 failure does not propagate
    expect(result.recommendation.verdict).not.toBe("Stop");
    // No N-gate data and no primary endpoint supplied => can't reach Go either.
    expect(result.recommendation.verdict).toBe("Iterate");
  });

  it("the evolutionary arm's own S1 failure does fail sPass and is reflected in the recommendation", () => {
    const outDir = join(SCRATCH, "evo-fail");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "sgates-fixed.json"), JSON.stringify(makeSGates()));
    writeFileSync(join(outDir, "sgates-evolutionary.json"), JSON.stringify(makeSGates({ s1Pass: false, s1PassingSeeds: 6 })));

    const result = runAnalysis(outDir);

    expect(result.sPass).toBe(false);
    expect(result.recommendation.verdict).toBe("Stop");
  });
});
