// CLI instrumentation layer: wall-clock timestamps for report metadata only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeDemoManifest, makeDemoRoster } from "./demo.js";
import { harvestAll, runBenchForModel, summarize, randomArmSummary, type BenchParams } from "../bench/orchestrate.js";
import { OllamaRuntime } from "../bench/runtime.js";
import { renderReportMd } from "../bench/report.js";
import { PROMPT_VERSION } from "../bench/prompt.js";
import type { ModelSummary } from "../bench/orchestrate.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const models = arg("models", "qwen3:0.6b,qwen3:1.7b,qwen3:4b").split(",").map((m) => m.trim()).filter((m) => m.length > 0);
const seedCount = parseInt(arg("seeds", "8"), 10);
const label = arg("label", "dev");
const minDecisive = parseInt(arg("min-decisive", "300"), 10);
const params: BenchParams = {
  seeds: Array.from({ length: seedCount }, (_, i) => `bench-${i + 1}`),
  ticks: parseInt(arg("ticks", "800"), 10),
  epsilon: parseInt(arg("epsilon", "60"), 10),
  horizonTicks: parseInt(arg("horizon", "100"), 10),
  timeoutMs: parseInt(arg("timeout", "30000"), 10),
  capPerSeed: parseInt(arg("cap", "200"), 10),
};
const outDir = arg("out", join("runs", `bench-${label}`));

const manifest = makeDemoManifest();
const roster = makeDemoRoster("bench-roster");
const triggers = harvestAll(manifest, roster, params);
console.log(`harvested ${triggers.length} triggers (epsilon ${params.epsilon}) across ${params.seeds.length} seeds`);

if (hasFlag("harvest-only")) {
  const bySeed = new Map<string, number>();
  for (const t of triggers) bySeed.set(t.seedRoot, (bySeed.get(t.seedRoot) ?? 0) + 1);
  for (const [seed, n] of bySeed) console.log(`  ${seed}: ${n}`);
  const gaps = triggers.map((t) => t.gap).sort((a, b) => a - b);
  console.log(`gap distribution: min ${gaps[0]}, median ${gaps[Math.floor(gaps.length / 2)]}, max ${gaps[gaps.length - 1]}`);
  console.log(`tick coverage of sampled triggers (buckets of 100, cap ${params.capPerSeed}/seed):`);
  if (triggers.length === 0) {
    console.log(`  (no triggers)`);
  } else {
    const buckets = new Map<number, number>();
    for (const t of triggers) {
      const bucket = Math.floor(t.tick / 100) * 100;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    const maxBucket = Math.max(...buckets.keys());
    for (let b = 0; b <= maxBucket; b += 100) {
      console.log(`  ticks ${b}-${b + 99}: ${buckets.get(b) ?? 0}`);
    }
  }
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const startedAt = new Date().toISOString();
const summaries: ModelSummary[] = [];

for (const model of models) {
  const persist = join(outDir, `trials-${model.replace(/[^a-z0-9.]/gi, "_")}.jsonl`);
  console.log(`\n=== ${model} → ${persist}`);
  const runtime = new OllamaRuntime(model);
  const trials = await runBenchForModel(manifest, roster, params, triggers, runtime, persist, (d, t) => {
    if (d % 25 === 0 || d === t) process.stdout.write(`\r  ${d}/${t}`);
  });
  console.log();
  summaries.push(summarize(model, trials, minDecisive));
}

console.log(`\n=== random-control`);
summaries.push(randomArmSummary(manifest, roster, params, triggers));

const md = renderReportMd(summaries, params, { promptVersion: PROMPT_VERSION, triggerCount: triggers.length, startedAt });
writeFileSync(join(outDir, "report.json"), JSON.stringify({ params, promptVersion: PROMPT_VERSION, startedAt, triggerCount: triggers.length, summaries }, null, 2));
writeFileSync(join(outDir, "report.md"), md + "\n");
console.log(`\n${md}\nreport → ${outDir}/report.md`);
