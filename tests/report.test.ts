import { describe, it, expect } from "vitest";
import { renderReportMd } from "../src/bench/report.js";
import type { ModelSummary, BenchParams } from "../src/bench/orchestrate.js";

const params: BenchParams = {
  seeds: ["bench-1"], ticks: 800, epsilon: 60, horizonTicks: 100, timeoutMs: 30000, capPerSeed: 200,
};
const summary: ModelSummary = {
  model: "qwen3:0.6b", trials: 200, failures: 4, agreements: 90,
  divergent: 106, wins: 60, losses: 40, ties: 6,
  winRate: { p: 0.6, lo: 0.52, hi: 0.68 },
  latencyP50: 900, latencyP95: 2500, tokensInMean: 250, tokensOutMean: 30,
  verdict: "gain",
};

describe("renderReportMd", () => {
  const md = renderReportMd([summary], params, {
    promptVersion: "bench-v1", triggerCount: 200, startedAt: "2026-07-21T00:00:00Z",
  });
  it("contains the preregistered gate and MDE note", () => {
    expect(md).toContain("0.55");
    expect(md).toContain("0.50");
    expect(md.toLowerCase()).toContain("power");
  });
  it("tabulates the model row with verdict and CI", () => {
    expect(md).toContain("qwen3:0.6b");
    expect(md).toContain("gain");
    expect(md).toContain("0.52");
    expect(md).toContain("60/40/6");
  });
  it("records params and prompt version", () => {
    expect(md).toContain("bench-v1");
    expect(md).toContain("epsilon 60");
    expect(md).toContain("horizon 100");
  });
});
