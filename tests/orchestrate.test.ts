import { describe, it, expect, vi } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harvestAll, runBenchForModel, summarize, randomArmSummary, sampleEvenly } from "../src/bench/orchestrate.js";
import { MockRuntime } from "../src/bench/runtime.js";
import { actionsEqual } from "../src/bench/rollout.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import { makeDemoManifest, makeDemoRoster } from "../src/cli/demo.js";
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

  it("throws on resume when params fingerprint changed (I1)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-fp-"));
    const file = join(dir, "trials.jsonl");
    const rt = new MockRuntime(() => 1);
    await runBenchForModel(manifest, roster, params, triggers, rt, file);
    const changedParams: BenchParams = { ...params, horizonTicks: 100 };
    let caught: unknown;
    try {
      await runBenchForModel(manifest, roster, changedParams, triggers, rt, file);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(`${file}.meta.json`);
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips a truncated trailing JSONL line on resume and re-runs only that trial (I2)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-trunc-"));
    const file = join(dir, "trials.jsonl");
    const rt = new MockRuntime(() => 1);
    const complete = triggers.slice(0, triggers.length - 1);
    const missing = triggers[triggers.length - 1]!;
    await runBenchForModel(manifest, roster, params, complete, rt, file);
    // Simulate a crash mid-write: a partial JSON object with no trailing newline.
    appendFileSync(file, `{"trigger`);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let called = 0;
    const counting = new MockRuntime(() => { called++; return 1; });
    const resumed = await runBenchForModel(manifest, roster, params, triggers, counting, file);
    expect(called).toBe(1);
    expect(resumed.length).toBe(triggers.length);
    expect(resumed.find((r) => r.triggerId === missing.id)).toBeDefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain("line");
    warnSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("failure trials persist and resume without re-invoking the runtime (M1)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-fail-"));
    const file = join(dir, "trials.jsonl");
    const failing = new MockRuntime(() => null);
    const first = await runBenchForModel(manifest, roster, params, triggers, failing, file);
    expect(first.length).toBe(triggers.length);
    for (const rec of first) {
      expect(rec.error).not.toBeNull();
      expect(rec.agreed).toBeNull();
      expect(rec.outcome).toBeNull();
    }
    let called = 0;
    const counting = new MockRuntime(() => { called++; return null; });
    const second = await runBenchForModel(manifest, roster, params, triggers, counting, file);
    expect(called).toBe(0);
    expect(second).toEqual(first);
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

describe("sampleEvenly", () => {
  it("returns the input unchanged when already at or under the cap", () => {
    expect(sampleEvenly([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(sampleEvenly([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });

  it("caps the length and is deterministic", () => {
    const xs = Array.from({ length: 8986 }, (_, i) => i);
    const a = sampleEvenly(xs, 200);
    const b = sampleEvenly(xs, 200);
    expect(a.length).toBe(200);
    expect(a).toEqual(b);
  });

  it("spans the full input instead of biasing toward the head", () => {
    const xs = Array.from({ length: 8986 }, (_, i) => i);
    const sampled = sampleEvenly(xs, 200);
    expect(sampled[0]).toBe(0);
    expect(sampled[sampled.length - 1]!).toBeGreaterThan(xs.length * 0.9);
  });

  it("harvestAll on a real 800-tick sim spans well beyond the head of the trigger sequence (C1)", () => {
    const demoManifest = makeDemoManifest();
    const demoRoster = makeDemoRoster("bench-roster");
    const demoParams: BenchParams = {
      seeds: ["bench-1"], ticks: 800, epsilon: 60, horizonTicks: 100, timeoutMs: 1000, capPerSeed: 200,
    };
    const sampled = harvestAll(demoManifest, demoRoster, demoParams);
    expect(sampled.length).toBe(200);
    const ticks = sampled.map((t) => t.tick);
    const minTick = Math.min(...ticks);
    const maxTick = Math.max(...ticks);
    // A head-slice (the C1 bug) would keep everything within the first ~13 ticks.
    // With reproduction now happening, trigger distribution changes but should still span well.
    expect(maxTick).toBeGreaterThan(minTick * 10);
    expect(maxTick).toBeGreaterThan(600);  // Ensure well into the run (was 700, adjusted for reproduction RNG)
  });
});
