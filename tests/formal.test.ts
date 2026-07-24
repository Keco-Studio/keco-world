import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync, mkdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runFormalSeed, evaluateSGates, makeNocultureSetup } from "../src/cli/formal.js";
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
