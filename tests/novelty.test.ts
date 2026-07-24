import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateNoveltyForSeed,
  evaluateNovelty,
  rosterToGenomes,
  DEFAULT_NOVELTY_THRESHOLDS,
} from "../src/analysis/novelty.js";
import type { NoveltyThresholds } from "../src/analysis/novelty.js";
import { meanPairwiseVerbL1 } from "../src/scenarios/metrics.js";
import { SCENARIOS } from "../src/scenarios/library.js";
import type { GenomeUnderTest } from "../src/scenarios/framework.js";
import type { RosterEntry } from "../src/schema/core.js";
import { makeDemoRoster } from "./../src/cli/demo.js";
import { runFormalSeed } from "../src/cli/formal.js";

// Deterministic founder population (25 genomes, per makeDemoRoster) used across the
// pure-core unit tests below — no disk I/O, no sim run.
const FOUNDERS: GenomeUnderTest[] = rosterToGenomes(makeDemoRoster("novelty-unit-test"));

function mutateForageEpsilonZero(genomes: GenomeUnderTest[]): GenomeUnderTest[] {
  return genomes.map((g) => ({
    ...g,
    policy: {
      ...g.policy,
      utilityWeights: {
        ...g.policy.utilityWeights,
        forage: Math.max(0, Math.min(1000, g.policy.utilityWeights.forage + 400)),
      },
      deliberationEpsilon: 0,
    },
  }));
}

describe("evaluateNoveltyForSeed — pure core (no disk)", () => {
  it("identical evolved==founders population -> n1 approx 0 -> n1Pass false", () => {
    const result = evaluateNoveltyForSeed(FOUNDERS, FOUNDERS, FOUNDERS, DEFAULT_NOVELTY_THRESHOLDS);
    expect(result.n1VerbL1).toBe(0);
    expect(result.n1Pass).toBe(false);
    // n3: evolved===founders here, so evolvedVsFixed === foundersVsFixed exactly -> n3Pass true (>=).
    expect(result.n3EvolvedVsFixed).toBe(result.n3FoundersVsFixed);
    expect(result.n3Pass).toBe(true);
  }, 120_000);

  it("hand-mutated evolved set (forage +400, epsilon 0) -> n1 > 0, pass flags consistent with thresholds", () => {
    const evolved = mutateForageEpsilonZero(FOUNDERS);
    const result = evaluateNoveltyForSeed(FOUNDERS, evolved, FOUNDERS, DEFAULT_NOVELTY_THRESHOLDS);

    expect(result.n1VerbL1).toBeGreaterThan(0);
    expect(result.n1Pass).toBe(result.n1VerbL1 >= DEFAULT_NOVELTY_THRESHOLDS.n1MinVerbL1);
    expect(result.n2Pass).toBe(
      result.n2Intra >= result.n2FounderIntra * DEFAULT_NOVELTY_THRESHOLDS.n2RatioMin &&
        result.n2Intra >= DEFAULT_NOVELTY_THRESHOLDS.n2AbsMin,
    );
    expect(result.n3Pass).toBe(result.n3EvolvedVsFixed >= result.n3FoundersVsFixed);
  }, 120_000);

  it("N2 ratio math matches direct meanPairwiseVerbL1 calls", () => {
    const evolved = mutateForageEpsilonZero(FOUNDERS);
    const result = evaluateNoveltyForSeed(FOUNDERS, evolved, FOUNDERS, DEFAULT_NOVELTY_THRESHOLDS);

    const directEvolvedIntra = meanPairwiseVerbL1(evolved, SCENARIOS, 2000);
    const directFounderIntra = meanPairwiseVerbL1(FOUNDERS, SCENARIOS, 2000);

    expect(result.n2Intra).toBe(directEvolvedIntra);
    expect(result.n2FounderIntra).toBe(directFounderIntra);
  }, 120_000);

  it("thresholds parameterization is honored: loose thresholds pass, strict thresholds fail", () => {
    const evolved = mutateForageEpsilonZero(FOUNDERS);

    const loose: NoveltyThresholds = { n1MinVerbL1: 0, n2RatioMin: 0, n2AbsMin: 0, minPassingSeeds: 9 };
    const strict: NoveltyThresholds = { n1MinVerbL1: 10, n2RatioMin: 10, n2AbsMin: 10, minPassingSeeds: 9 };

    const looseResult = evaluateNoveltyForSeed(FOUNDERS, evolved, FOUNDERS, loose);
    expect(looseResult.n1Pass).toBe(true);
    expect(looseResult.n2Pass).toBe(true);

    const strictResult = evaluateNoveltyForSeed(FOUNDERS, evolved, FOUNDERS, strict);
    expect(strictResult.n1Pass).toBe(false);
    expect(strictResult.n2Pass).toBe(false);
  }, 120_000);
});

describe("evaluateNovelty — disk integration", () => {
  const SCRATCH = join("runs", "novelty-test-scratch");

  beforeAll(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
    mkdirSync(SCRATCH, { recursive: true });
    runFormalSeed("fixed", "pilot-fixed-1", 1000, 1000, SCRATCH);
    runFormalSeed("evolutionary", "pilot-evolutionary-1", 1000, 1000, SCRATCH);
  }, 120_000);

  afterAll(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  it("reads archived roster.json/final-state.json.gz and produces a structurally valid report", () => {
    const fixedRoster = JSON.parse(
      readFileSync(join(SCRATCH, "fixed", "pilot-fixed-1", "roster.json"), "utf8"),
    ) as RosterEntry[];
    const fixedFounderRosters = new Map<string, GenomeUnderTest[]>([["1", rosterToGenomes(fixedRoster)]]);

    const report = evaluateNovelty(join(SCRATCH, "evolutionary"), fixedFounderRosters);

    expect(report.perSeed.length).toBe(1);
    const s = report.perSeed[0]!;
    expect(s.seedRoot).toBe("pilot-evolutionary-1");
    expect(typeof s.n1VerbL1).toBe("number");
    expect(typeof s.n2Intra).toBe("number");
    expect(typeof s.n3EvolvedVsFixed).toBe("number");
    expect(typeof s.n1Pass).toBe("boolean");
    expect(typeof s.n2Pass).toBe("boolean");
    expect(typeof s.n3Pass).toBe("boolean");
    expect(typeof report.n1Pass).toBe("boolean");
    expect(typeof report.n2Pass).toBe("boolean");
    expect(typeof report.n3Pass).toBe("boolean");
  }, 120_000);

  it("throws a clear error when the fixed arm's founder roster for a seed index is missing", () => {
    expect(() => evaluateNovelty(join(SCRATCH, "evolutionary"), new Map())).toThrow(/fixed/i);
  }, 120_000);
});
