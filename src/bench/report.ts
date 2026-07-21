import type { BenchParams, ModelSummary } from "./orchestrate.js";

export function renderReportMd(
  summaries: ModelSummary[],
  params: BenchParams,
  meta: { promptVersion: string; triggerCount: number; startedAt: string },
): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`# Deliberation Benchmark Report`);
  lines.push(``);
  lines.push(`- started: ${meta.startedAt}`);
  lines.push(`- prompt version: ${meta.promptVersion}`);
  lines.push(`- params: seeds ${params.seeds.length}, ticks ${params.ticks}, epsilon ${params.epsilon}, horizon ${params.horizonTicks}, cap/seed ${params.capPerSeed}, timeout ${params.timeoutMs}ms`);
  lines.push(`- triggers harvested: ${meta.triggerCount}`);
  lines.push(``);
  lines.push(`**Preregistered gate:** a model shows gain iff win-rate over decisive divergent trials ≥ 0.55 AND the Wilson 95% lower bound > 0.50.`);
  lines.push(`**MDE note:** at n=300 decisive trials this design has ~80% power to detect a true rate of ~0.58; detecting 0.55 needs n≈780. Verdicts on smaller n are correspondingly weaker evidence.`);
  lines.push(``);
  lines.push(`| model | trials | fail | agree | divergent | W/L/T | win rate | 95% CI | p50 ms | p95 ms | tok in/out | verdict |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const s of summaries) {
    const agreeRate = s.trials - s.failures === 0 ? 0 : s.agreements / (s.trials - s.failures);
    lines.push(
      `| ${s.model} | ${s.trials} | ${s.failures} | ${pct(agreeRate)} | ${s.divergent} | ${s.wins}/${s.losses}/${s.ties} | ${pct(s.winRate.p)} | ${s.winRate.lo.toFixed(2)}–${s.winRate.hi.toFixed(2)} | ${Math.round(s.latencyP50)} | ${Math.round(s.latencyP95)} | ${Math.round(s.tokensInMean)}/${Math.round(s.tokensOutMean)} | ${s.verdict} |`,
    );
  }
  lines.push(``);
  lines.push(`Branch guidance (v0.5 §18 P0): all models no-gain → **B0**; gain but over budget → **B±**; gain within budget → **B+**. The random-control row is the sanity floor — any model at or below it is unambiguous no-gain.`);
  return lines.join("\n");
}
