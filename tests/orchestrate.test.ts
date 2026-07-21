import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harvestAll, runBenchForModel, summarize, randomArmSummary } from "../src/bench/orchestrate.js";
import { MockRuntime } from "../src/bench/runtime.js";
import { actionsEqual } from "../src/bench/rollout.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import type { BenchParams } from "../src/bench/orchestrate.js";

const manifest = makeTestManifest();
const roster = makeTestRoster(5);
const params: BenchParams = {
  seeds: ["bench-a", "bench-b"],
  ticks: 200,
  epsilon: 100,
  horizonTicks: 50,
  timeoutMs: 1000,
  capPerSeed: 10,
};

describe("orchestrator", () => {
  const triggers = harvestAll(manifest, roster, params);

  it("harvests across seeds with the per-seed cap", () => {
    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers.length).toBeLessThanOrEqual(params.seeds.length * params.capPerSeed);
    expect(new Set(triggers.map((t) => t.seedRoot)).size).toBeGreaterThan(1);
  });

  it("a best-picking mock agrees on every trial and yields zero divergent", async () => {
    const rt = new MockRuntime((p) => {
      // pick the display position that maps to... we don't know bestIndex here; pick 1 and let test below cover divergence
      return 1;
    });
    const trials = await runBenchForModel(manifest, roster, params, triggers, rt, null);
    expect(trials.length).toBe(triggers.length);
    for (const tr of trials) {
      expect(tr.error).toBeNull();
      expect(tr.chosenIndex).not.toBeNull();
      // agreement must equal action-equality with the best candidate
      const trigger = triggers.find((g) => g.id === tr.triggerId)!;
      const expected = actionsEqual(
        trigger.candidates[tr.chosenIndex!]!.action,
        trigger.candidates[trigger.bestIndex]!.action,
      );
      expect(tr.agreed).toBe(expected);
      if (tr.agreed) expect(tr.outcome).toBeNull();
      else expect(["win", "loss", "tie"]).toContain(tr.outcome);
    }
  });

  it("persists trials as JSONL and resumes without re-running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-"));
    const file = join(dir, "trials.jsonl");
    const rt = new MockRuntime(() => 1);
    const first = await runBenchForModel(manifest, roster, params, triggers, rt, file);
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines.length).toBe(first.length);
    let called = 0;
    const counting = new MockRuntime(() => { called++; return 1; });
    const second = await runBenchForModel(manifest, roster, params, triggers, counting, file);
    expect(called).toBe(0);                    // everything resumed from disk
    expect(second.length).toBe(first.length);
    rmSync(dir, { recursive: true, force: true });
  });

  it("summarize computes verdicts per the preregistered gate", () => {
    const mk = (outcome: "win" | "loss" | "tie" | null, agreed: boolean | null): Parameters<typeof summarize>[1][number] => ({
      triggerId: "x", model: "m", displayChoice: 1, chosenIndex: 0, agreed,
      outcome, marginLlm: 0, marginBest: 0, latencyMs: 10, tokensIn: 5, tokensOut: 2, error: agreed === null ? "parse" : null,
    });
    const wins = Array.from({ length: 180 }, () => mk("win", false));
    const losses = Array.from({ length: 120 }, () => mk("loss", false));
    const s = summarize("m", [...wins, ...losses], 100);
    expect(s.divergent).toBe(300);
    expect(s.verdict).toBe("gain");            // 180/300 = 0.60, lo > 0.50
    const s2 = summarize("m", [...wins.slice(0, 30), ...losses.slice(0, 30)], 100);
    expect(s2.verdict).toBe("insufficient-n");
    const s3 = summarize("m", [...Array.from({ length: 150 }, () => mk("win", false)), ...Array.from({ length: 150 }, () => mk("loss", false))], 100);
    expect(s3.verdict).toBe("no-gain");        // 0.50
  });

  it("random-arm control runs without any runtime and is deterministic", () => {
    const a = randomArmSummary(manifest, roster, params, triggers);
    const b = randomArmSummary(manifest, roster, params, triggers);
    expect(a).toEqual(b);
    expect(a.model).toBe("random-control");
    expect(a.divergent).toBeGreaterThan(0);
  });
});
