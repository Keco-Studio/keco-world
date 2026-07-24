import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync, mkdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runFormalSeed, evaluateSGates, makeNocultureSetup, aggregateSGates } from "../src/cli/formal.js";
import type { SGateReport } from "../src/cli/formal.js";
import { makeArmSetup } from "../src/arms/arms.js";
import { runSim } from "../src/sim/engine.js";
import { hashCanonical } from "../src/canon/canonicalize.js";

// Scratch dir under the repo's gitignored runs/ (per task brief), cleaned before and
// after this suite so re-runs never see stale complete:true meta.json from a prior run.
const SCRATCH = join("runs", "formal-test-scratch");

beforeAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
});

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe("formal runner", () => {
  it("runs a chunked seed, archives it, and matches an independent runSim hash", () => {
    const meta = runFormalSeed("fixed", "pilot-fmt-1", 3000, 1000, SCRATCH);

    expect(meta.complete).toBe(true);
    expect(meta.actionChainTip).not.toBeNull();

    const { manifest, roster } = makeArmSetup("fixed", "pilot-fmt-1");
    const independent = runSim(manifest, roster, "pilot-fmt-1", { ticks: 3000, retainActionLog: false });
    expect(meta.finalStateHash).toBe(hashCanonical(independent.finalState));

    const seedDir = join(SCRATCH, "fixed", "pilot-fmt-1");
    const snapshotLines = readFileSync(join(seedDir, "snapshots.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    expect(snapshotLines.length).toBe(3);

    for (const f of [
      "checkpoints.json",
      "final-state.json.gz",
      "meta.json",
      "directives.json",
      "manifest.json",
      "roster.json",
      "events.jsonl.gz",
    ]) {
      expect(existsSync(join(seedDir, f))).toBe(true);
    }
    const directives = JSON.parse(readFileSync(join(seedDir, "directives.json"), "utf8"));
    expect(directives).toEqual([]);
  });

  it("resumes at per-seed granularity: a second call is a no-op when meta.complete is true", () => {
    const seedDir = join(SCRATCH, "fixed", "pilot-fmt-1");
    const metaPath = join(seedDir, "meta.json");
    const mtimeBefore = statSync(metaPath).mtimeMs;

    const meta2 = runFormalSeed("fixed", "pilot-fmt-1", 3000, 1000, SCRATCH);

    expect(statSync(metaPath).mtimeMs).toBe(mtimeBefore);
    expect(meta2.complete).toBe(true);
  });

  it("evaluateSGates returns a structurally valid report over an archived seed", () => {
    const report = evaluateSGates(join(SCRATCH, "fixed"), "fixed");
    expect(report.perSeed.length).toBe(1);
    const s = report.perSeed[0]!;
    expect(s.seedRoot).toBe("pilot-fmt-1");
    expect(s.s4ZodValid).toBe(true);
    expect(report.s5Pass).toBe(true);
    expect(report.exempt).toBe(false);
    expect(typeof report.s1Pass).toBe("boolean");
    expect(typeof report.s2Pass).toBe("boolean");
    expect(typeof report.s3Pass).toBe("boolean");
    expect(typeof report.s4Pass).toBe("boolean");
  });

  it("noculture setup is evolutionary roster + cognition with beliefDynamics forced off", () => {
    const noculture = makeNocultureSetup("x");
    expect(noculture.manifest.cognition).toEqual({
      decisionMode: "utility",
      inheritanceMode: "breed",
      beliefDynamics: "off",
    });
    const evo = makeArmSetup("evolutionary", "x");
    expect(noculture.roster).toEqual(evo.roster);
    // manifest copy, not mutation: the evolutionary setup's own cognition is untouched.
    expect(evo.manifest.cognition.beliefDynamics).toBe("on");
  });
});

/** Synthetic perSeed fixture: `survivedCount` of `total` seeds survive with a
 * maxGeneration comfortably above the default minGen (50); the rest are extinct
 * (maxGeneration 0). S2-S5 fields are set to always-pass values so only S1 varies. */
function makePerSeed(total: number, survivedCount: number): SGateReport["perSeed"] {
  return Array.from({ length: total }, (_, i) => ({
    seedRoot: `synthetic-${i + 1}`,
    survived: i < survivedCount,
    maxGeneration: i < survivedCount ? 100 : 0,
    s2Ratio1000: i < survivedCount ? 1000 : null,
    s3MaxConsecutiveIdleBreaches: 0,
    s4ZodValid: true,
    s5BeliefCapOk: true,
  }));
}

describe("aggregateSGates — S1 arm-level count threshold (frozen prereg semantics)", () => {
  it("11/12 seeds surviving passes S1 (protocol explicitly tolerates this)", () => {
    const perSeed = makePerSeed(12, 11);
    const agg = aggregateSGates(perSeed, "evolutionary");
    expect(agg.s1PassingSeeds).toBe(11);
    expect(agg.s1Pass).toBe(true);
  });

  it("9/12 seeds surviving fails S1", () => {
    const perSeed = makePerSeed(12, 9);
    const agg = aggregateSGates(perSeed, "evolutionary");
    expect(agg.s1PassingSeeds).toBe(9);
    expect(agg.s1Pass).toBe(false);
  });

  it("default s1MinSeeds threshold for n=12 is 10 (ceil(12 * 10/12))", () => {
    const perSeed10 = makePerSeed(12, 10);
    const agg10 = aggregateSGates(perSeed10, "evolutionary");
    expect(agg10.s1Pass).toBe(true);

    const perSeed9 = makePerSeed(12, 9);
    const agg9 = aggregateSGates(perSeed9, "evolutionary");
    expect(agg9.s1Pass).toBe(false);
  });

  it("random arm is exempt from S1 regardless of survival count", () => {
    const perSeed = makePerSeed(12, 0);
    const agg = aggregateSGates(perSeed, "random");
    expect(agg.exempt).toBe(true);
    expect(agg.s1Pass).toBe(true);
  });

  it("s1MinSeeds is overridable", () => {
    const perSeed = makePerSeed(12, 11);
    const agg = aggregateSGates(perSeed, "evolutionary", { s1MinSeeds: 12 });
    expect(agg.s1Pass).toBe(false); // 11 < strict override of 12
  });
});
