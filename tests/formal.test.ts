import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync, mkdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  runFormalSeed,
  evaluateSGates,
  makeNocultureSetup,
  aggregateSGates,
  computeTerminalIdle1000,
  computeIdleSlope1000,
} from "../src/cli/formal.js";
import type { SGateReport, FormalSnapshot } from "../src/cli/formal.js";
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
    // Terminal-phase S3 fields: a 3-tick/1-chunk seed has only 1 snapshot, so the
    // "final 10 or all if fewer" window degenerates to that single snapshot.
    expect(typeof report.s3PassingSeeds).toBe("number");
    if (s.survived) {
      expect(s.terminalIdle1000).not.toBeNull();
    } else {
      expect(s.terminalIdle1000).toBeNull();
    }
    expect(report.idleSlope1000.length).toBe(1);
    expect(report.idleSlope1000[0]!.seedRoot).toBe("pilot-fmt-1");
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
 * (maxGeneration 0). S2-S5 fields are set to always-pass values so only S1 varies.
 * terminalIdle1000 is set to a comfortably-passing 100 for survivors and null for
 * extinct seeds, so S3 never accidentally gates these S1-focused tests. */
function makePerSeed(total: number, survivedCount: number): SGateReport["perSeed"] {
  return Array.from({ length: total }, (_, i) => ({
    seedRoot: `synthetic-${i + 1}`,
    survived: i < survivedCount,
    maxGeneration: i < survivedCount ? 100 : 0,
    s2Ratio1000: i < survivedCount ? 1000 : null,
    s3MaxConsecutiveIdleBreaches: 0,
    terminalIdle1000: i < survivedCount ? 100 : null,
    s4ZodValid: true,
    s5BeliefCapOk: true,
  }));
}

/** Minimal structurally-valid FormalSnapshot for S3/idle-slope unit tests — only
 * verbShares1000.idle is exercised by computeTerminalIdle1000/computeIdleSlope1000,
 * so the other fields are held at deterministic placeholder values. */
function snap(idle1000: number): FormalSnapshot {
  return {
    tick: 0,
    alive: 1,
    maxGeneration: 0,
    livingLineages: 1,
    weightDiversity1000: 0,
    beliefsMaxPerNpc: 0,
    verbShares1000: { idle: idle1000 },
  };
}

/** Synthetic perSeed fixture for S3 count-threshold tests: `total` seeds in all,
 * `survivedCount` of which survive (the rest are extinct: survived=false,
 * terminalIdle1000=null, mirroring what evaluateSGates actually produces), and
 * `passingCount` of the SURVIVING seeds have a passing (< 800) terminalIdle1000 (the
 * remaining survivors sit above the 800 threshold). S1/S2/S4/S5 fields are
 * always-pass placeholders so only S3 varies. */
function makePerSeedForS3(total: number, survivedCount: number, passingCount: number): SGateReport["perSeed"] {
  return Array.from({ length: total }, (_, i) => {
    const survived = i < survivedCount;
    return {
      seedRoot: `synthetic-s3-${i + 1}`,
      survived,
      maxGeneration: survived ? 100 : 0,
      s2Ratio1000: survived ? 1000 : null,
      s3MaxConsecutiveIdleBreaches: 0,
      terminalIdle1000: survived ? (i < passingCount ? 500 : 900) : null,
      s4ZodValid: true,
      s5BeliefCapOk: true,
    };
  });
}

describe("computeTerminalIdle1000 — terminal-phase staticness math", () => {
  it("means over all snapshots when fewer than 10 exist", () => {
    const snapshots = [snap(100), snap(200), snap(300)];
    expect(computeTerminalIdle1000(snapshots)).toBe(200); // (100+200+300)/3 = 200
  });

  it("means over all 10 snapshots when exactly 10 exist", () => {
    const snapshots = Array.from({ length: 10 }, (_, i) => snap((i + 1) * 100)); // 100..1000
    // sum = 5500, /10 = 550
    expect(computeTerminalIdle1000(snapshots)).toBe(550);
  });

  it("means over only the final 10 when more than 10 exist", () => {
    // 5 early snapshots at idle=0 (would drag the mean down if included), then 10 at 800.
    const snapshots = [
      ...Array.from({ length: 5 }, () => snap(0)),
      ...Array.from({ length: 10 }, () => snap(800)),
    ];
    expect(computeTerminalIdle1000(snapshots)).toBe(800);
  });

  it("floors a non-integer mean", () => {
    const snapshots = [snap(100), snap(100), snap(101)]; // sum=301, /3=100.33
    expect(computeTerminalIdle1000(snapshots)).toBe(100);
  });
});

describe("computeIdleSlope1000 — first10/last10 diagnostic", () => {
  it("reports distinct first-ten and last-ten means on a monotonically climbing series", () => {
    // 20 snapshots climbing from 0 to 950 in steps of 50 — mirrors the pilot's
    // "idle share climbs monotonically over a run" finding.
    const snapshots = Array.from({ length: 20 }, (_, i) => snap(i * 50));
    const slope = computeIdleSlope1000(snapshots);
    // first 10: 0,50,...,450 -> sum=2250 /10=225
    expect(slope.firstTen).toBe(225);
    // last 10: 500,550,...,950 -> sum=7250 /10=725
    expect(slope.lastTen).toBe(725);
    expect(slope.lastTen).toBeGreaterThan(slope.firstTen);
  });

  it("uses all snapshots for both windows when fewer than 10 exist", () => {
    const snapshots = [snap(100), snap(300)];
    const slope = computeIdleSlope1000(snapshots);
    expect(slope.firstTen).toBe(200);
    expect(slope.lastTen).toBe(200);
  });
});

describe("aggregateSGates — S3 terminal-phase staticness gate (denominator = surviving seeds only)", () => {
  it("fixed-arm pilot case: 3 seeds extinct, all 9 survivors pass terminalIdle1000<800 => S3 PASS", () => {
    // This is exactly the case the pilot's Fixed arm surfaced: 9/12 seeds survive
    // (3 extinct, already failing S1), and every one of the 9 survivors is
    // individually active (terminalIdle1000 < 800). The S3 denominator must be the
    // survivor count (9), not perSeed.length (12) — threshold = ceil(9*10/12) = 8 —
    // so 9 passing survivors clears it, even though 9 < 12.
    const perSeed = makePerSeedForS3(12, 9, 9);
    const extinctSeed = perSeed.find((s) => !s.survived)!;
    expect(extinctSeed.terminalIdle1000).toBeNull();
    expect(extinctSeed.survived).toBe(false);

    const agg = aggregateSGates(perSeed, "evolutionary");
    expect(agg.s3EvaluatedSeeds).toBe(9);
    expect(agg.s3PassingSeeds).toBe(9);
    expect(agg.s3Pass).toBe(true);
  });

  it("s3 count threshold boundary over 9 survivors: 8/9 passes (ceil(9*10/12)=8), 7/9 fails", () => {
    const perSeed8 = makePerSeedForS3(9, 9, 8); // 9 total, all survive, 8 pass
    const agg8 = aggregateSGates(perSeed8, "evolutionary");
    expect(agg8.s3EvaluatedSeeds).toBe(9);
    expect(agg8.s3PassingSeeds).toBe(8);
    expect(agg8.s3Pass).toBe(true);

    const perSeed7 = makePerSeedForS3(9, 9, 7);
    const agg7 = aggregateSGates(perSeed7, "evolutionary");
    expect(agg7.s3EvaluatedSeeds).toBe(9);
    expect(agg7.s3PassingSeeds).toBe(7);
    expect(agg7.s3Pass).toBe(false);
  });

  it("zero survivors fails S3 outright, not a trivial ceil(0*10/12)=0 pass", () => {
    const perSeed = makePerSeedForS3(12, 0, 0);
    const agg = aggregateSGates(perSeed, "evolutionary");
    expect(agg.s3EvaluatedSeeds).toBe(0);
    expect(agg.s3PassingSeeds).toBe(0);
    expect(agg.s3Pass).toBe(false);
  });

  it("random arm is exempt from S3 regardless of terminalIdle1000 or survivor count", () => {
    const perSeed = makePerSeedForS3(12, 0, 0); // zero survivors — would fail S3 outright if not exempt
    const agg = aggregateSGates(perSeed, "random");
    expect(agg.exempt).toBe(true);
    expect(agg.s3Pass).toBe(true);
  });

  it("s3MinSeeds is overridable", () => {
    const perSeed = makePerSeedForS3(9, 9, 8);
    const agg = aggregateSGates(perSeed, "evolutionary", { s3MinSeeds: 9 });
    expect(agg.s3Pass).toBe(false); // 8 < strict override of 9
  });
});

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
