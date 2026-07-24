// Analysis master CLI (docs/prereg-1c-draft.md §9 item 5): one command that reads an
// archived formal-runner output directory (Task 1: `src/cli/formal.ts`) and produces
// every S/N-gate verdict plus (when judge data is supplied) the primary-endpoint
// statistics and a Go/Iterate/Stop recommendation per §6. Writes `analysis.json`.
//
// Prefers reading already-computed `sgates-<arm>.json` / `novelty-<arm>.json` (written
// by `npm run formal -- gates|novelty`) over recomputing from the raw archive — recompute
// only happens when the json is missing but the raw `<outDir>/<arm>` archive exists.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { evaluateSGates } from "./formal.js";
import type { FormalArmId, SGateReport } from "./formal.js";
import { ARM_IDS } from "../arms/arms.js";
import { evaluateNovelty, rosterToGenomes, seedIndexOf, DEFAULT_NOVELTY_THRESHOLDS } from "../analysis/novelty.js";
import type { NoveltyReport } from "../analysis/novelty.js";
import type { RosterEntry } from "../schema/core.js";
import type { GenomeUnderTest } from "../scenarios/framework.js";
import { wilson } from "../bench/stats.js";
import { binomTwoSided, clusterRobustPrefSE } from "../analysis/stats.js";
import type { ClusterRobustResult } from "../analysis/stats.js";

const FORMAL_ARM_IDS: FormalArmId[] = [...ARM_IDS, "noculture"];
const NOVELTY_ARM_IDS = ["evolutionary", "noculture"] as const;

// The primary-endpoint significance level and the product-meaningful point-estimate
// threshold are both frozen in docs/prereg-1c-draft.md §4 ("H0 p=0.5 双侧 α=0.05" /
// "最小产品意义效应量 0.62") — not analysis-time knobs, unlike the S1/N1-N3
// thresholds which the brief explicitly keeps parameterized for freeze-time tuning.
const PRIMARY_ALPHA = 0.05;
const PRIMARY_MIN_EFFECT = 0.62;

export interface Judgment {
  pairId: string;
  judgeId: string;
  choice: "left" | "right";
}

/** Parses the `--judgments` CSV: `pairId,judgeId,choice` with an optional header row
 * (detected by a case-insensitive "pairid" first field) and `choice` restricted to
 * `left`/`right`. Throws on any malformed row rather than silently dropping it —
 * judge data feeds a preregistered hypothesis test, so a silently-shortened sample
 * would be a protocol violation, not a convenience. */
export function parseJudgmentsCsv(csvText: string): Judgment[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const startIdx = lines[0]!.toLowerCase().startsWith("pairid") ? 1 : 0;
  const judgments: Judgment[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]!;
    const parts = line.split(",").map((s) => s.trim());
    if (parts.length !== 3) {
      throw new Error(`analyze: malformed judgments CSV row ${i + 1}: ${JSON.stringify(line)} (want pairId,judgeId,choice)`);
    }
    const [pairId, judgeId, choice] = parts as [string, string, string];
    if (choice !== "left" && choice !== "right") {
      throw new Error(`analyze: judgments CSV row ${i + 1} has invalid choice ${JSON.stringify(choice)} (must be left|right)`);
    }
    judgments.push({ pairId, judgeId, choice });
  }
  return judgments;
}

export interface PrimaryEndpointResult {
  n: number;
  k: number;
  pointEstimate: number;
  pValueTwoSided: number;
  significant: boolean;
  passes062: boolean;
  primaryPass: boolean; // significant AND direction positive AND pointEstimate >= 0.62
  wilson: { p: number; lo: number; hi: number };
  clusterRobust: ClusterRobustResult;
}

/**
 * Joins judgments against the packet's answer key (`runs/evalpack/answer-key.json` by
 * default — `{ [pairId]: "left"|"right" }`, the side that carries the Evolutionary
 * biography), producing k = count of judgments that picked the Evolutionary side, and
 * computes the primary-endpoint statistics frozen in docs/prereg-1c-draft.md §4: exact
 * two-sided binomial vs 0.5, Wilson 95% CI (reused from src/bench/stats.ts), and the
 * cluster-robust recheck (judge-level clustering, since a judge may contribute up to 8
 * judgments — §4's "聚类稳健标准误复核").
 */
export function computePrimaryEndpoint(judgments: Judgment[], answerKey: Record<string, "left" | "right">): PrimaryEndpointResult {
  if (judgments.length === 0) throw new Error("computePrimaryEndpoint: judgments must be non-empty");

  const joined = judgments.map((j) => {
    const evoSide = answerKey[j.pairId];
    if (evoSide === undefined) {
      throw new Error(`analyze: judgment for pairId ${JSON.stringify(j.pairId)} has no entry in the answer key`);
    }
    return { judgeId: j.judgeId, choseEvolutionary: j.choice === evoSide };
  });

  const n = joined.length;
  const k = joined.filter((j) => j.choseEvolutionary).length;
  const pointEstimate = k / n;
  const pValueTwoSided = binomTwoSided(k, n, 0.5);
  const significant = pValueTwoSided < PRIMARY_ALPHA;
  const passes062 = pointEstimate >= PRIMARY_MIN_EFFECT;
  const primaryPass = significant && pointEstimate > 0.5 && passes062;
  const w = wilson(k, n);
  const clusterRobust = clusterRobustPrefSE(joined);

  return { n, k, pointEstimate, pValueTwoSided, significant, passes062, primaryPass, wilson: w, clusterRobust };
}

function loadOrComputeSGates(outDir: string, arm: FormalArmId): SGateReport | null {
  const jsonPath = join(outDir, `sgates-${arm}.json`);
  if (existsSync(jsonPath)) return JSON.parse(readFileSync(jsonPath, "utf8")) as SGateReport;
  const armDir = join(outDir, arm);
  if (existsSync(armDir)) return evaluateSGates(armDir, arm);
  return null;
}

/** Same "same-seed-index Fixed-arm founder roster" join N3 needs, factored out of
 * `formal.ts`'s `novelty` CLI subcommand so `analyze` can compute novelty on a miss
 * without shelling out to it. */
function loadFixedFounderRosters(outDir: string): Map<string, GenomeUnderTest[]> {
  const fixedArmDir = join(outDir, "fixed");
  const map = new Map<string, GenomeUnderTest[]>();
  if (!existsSync(fixedArmDir)) return map;
  const seedRoots = readdirSync(fixedArmDir).filter((name) => statSync(join(fixedArmDir, name)).isDirectory());
  for (const seedRoot of seedRoots) {
    const roster = JSON.parse(readFileSync(join(fixedArmDir, seedRoot, "roster.json"), "utf8")) as RosterEntry[];
    map.set(seedIndexOf(seedRoot), rosterToGenomes(roster));
  }
  return map;
}

function loadOrComputeNovelty(outDir: string, arm: "evolutionary" | "noculture"): NoveltyReport | null {
  const jsonPath = join(outDir, `novelty-${arm}.json`);
  if (existsSync(jsonPath)) return JSON.parse(readFileSync(jsonPath, "utf8")) as NoveltyReport;
  const armDir = join(outDir, arm);
  if (!existsSync(armDir)) return null;
  const fixedFounderRosters = loadFixedFounderRosters(outDir);
  if (fixedFounderRosters.size === 0) return null; // N3 baseline unavailable -- can't compute
  return evaluateNovelty(armDir, fixedFounderRosters, DEFAULT_NOVELTY_THRESHOLDS);
}

export type Verdict = "Go" | "Iterate" | "Stop" | "Unavailable" | "Incomplete";
export interface Recommendation {
  verdict: Verdict;
  reason: string;
}

/**
 * Go/Iterate/Stop mapping per docs/prereg-1c-draft.md §6. This is advisory only — the
 * decision itself stays human (§6 is explicit that Iterate/Stop trigger a
 * project-owner review, not an automatic pipeline branch), so callers must not treat
 * this return value as authorization to act.
 *
 * "Unavailable"/"Incomplete" are not in §6's three-way vocabulary; they cover the
 * two states §6 doesn't address (no S-gate data at all; S/N available but no
 * --judgments supplied) so the CLI never has to silently guess a verdict from a
 * partial run.
 */
export function computeRecommendation(
  sPass: boolean,
  sAvailable: boolean,
  evoNovelty: NoveltyReport | undefined,
  nPass: boolean,
  primary: PrimaryEndpointResult | null,
): Recommendation {
  // Stop's negative-direction clause is checked first and can override an
  // otherwise-passing S/N state: "观众明确更爱手工内容" is a product-level verdict
  // independent of world-stability gates.
  if (primary !== null && primary.pointEstimate < 0.5 && primary.wilson.hi < 0.5) {
    return {
      verdict: "Stop",
      reason: "primary endpoint direction negative and Wilson CI upper bound < 0.5 (§6 Stop: 观众明确更爱手工内容)",
    };
  }

  if (!sAvailable) {
    return { verdict: "Unavailable", reason: "no S-gate reports found under --out; run `formal gates` for each arm first" };
  }
  if (!sPass) {
    return { verdict: "Stop", reason: "an S-gate failed for at least one arm (world itself is not stable; §6 Stop)" };
  }

  if (primary === null) {
    return { verdict: "Incomplete", reason: "S gates pass; primary endpoint not computed (no --judgments supplied)" };
  }

  if (nPass && primary.primaryPass) {
    return {
      verdict: "Go",
      reason: "S gates pass, N gates pass, primary endpoint significant with point estimate >= 0.62 (§6 Go)",
    };
  }

  const nPassCount = evoNovelty ? [evoNovelty.n1Pass, evoNovelty.n2Pass, evoNovelty.n3Pass].filter(Boolean).length : 0;
  if (primary.pointEstimate > 0.5 || nPassCount >= 2) {
    return {
      verdict: "Iterate",
      reason: "S gates pass; N gates or primary endpoint short of Go, but direction is positive (§6 Iterate)",
    };
  }

  return {
    verdict: "Iterate",
    reason:
      "S gates pass but neither Go nor Stop criteria are met (direction not clearly positive, and CI does not clearly " +
      "exclude 0.5 either); defaulting to Iterate pending human review, since §6's Stop clause requires both a negative " +
      "point estimate AND a Wilson CI upper bound < 0.5",
  };
}

export interface AnalysisResult {
  sGates: Record<string, SGateReport>;
  novelty: Record<string, NoveltyReport>;
  sPass: boolean;
  nPass: boolean;
  primaryEndpoint: PrimaryEndpointResult | null;
  recommendation: Recommendation;
}

export function runAnalysis(outDir: string, judgmentsPath?: string, answerKeyPath?: string): AnalysisResult {
  const sGates: Record<string, SGateReport> = {};
  for (const arm of FORMAL_ARM_IDS) {
    const report = loadOrComputeSGates(outDir, arm);
    if (report !== null) sGates[arm] = report;
  }

  const novelty: Record<string, NoveltyReport> = {};
  for (const arm of NOVELTY_ARM_IDS) {
    const report = loadOrComputeNovelty(outDir, arm);
    if (report !== null) novelty[arm] = report;
  }

  const sAvailable = Object.keys(sGates).length > 0;
  const sPass = sAvailable && Object.values(sGates).every((r) => r.s1Pass && r.s2Pass && r.s3Pass && r.s4Pass && r.s5Pass);
  // Per docs/prereg-1c-draft.md §3, Evo-NoCulture is attribution-only ("不投闸门票") —
  // only the Evolutionary arm's novelty report gates the N-group verdict.
  const evoNovelty = novelty["evolutionary"];
  const nPass = evoNovelty !== undefined && evoNovelty.n1Pass && evoNovelty.n2Pass && evoNovelty.n3Pass;

  let primaryEndpoint: PrimaryEndpointResult | null = null;
  if (judgmentsPath !== undefined) {
    const resolvedAnswerKeyPath = answerKeyPath ?? join("runs", "evalpack", "answer-key.json");
    if (!existsSync(resolvedAnswerKeyPath)) {
      throw new Error(`analyze: --judgments given but answer key not found at ${resolvedAnswerKeyPath} (run \`npm run evalpack\` first)`);
    }
    const answerKey = JSON.parse(readFileSync(resolvedAnswerKeyPath, "utf8")) as Record<string, "left" | "right">;
    const judgments = parseJudgmentsCsv(readFileSync(judgmentsPath, "utf8"));
    primaryEndpoint = computePrimaryEndpoint(judgments, answerKey);
  }

  const recommendation = computeRecommendation(sPass, sAvailable, evoNovelty, nPass, primaryEndpoint);

  return { sGates, novelty, sPass, nPass, primaryEndpoint, recommendation };
}

// Guard against CLI execution during test imports
if (process.argv[1]?.endsWith("analyze.ts") || process.argv[1]?.endsWith("analyze.js")) {
  function arg(name: string, fallback: string | undefined): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
  }

  const outDir = arg("out", join("runs", "formal"))!;
  const judgmentsPath = arg("judgments", undefined);
  const answerKeyPath = arg("answer-key", undefined);

  const result = runAnalysis(outDir, judgmentsPath, answerKeyPath);

  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "analysis.json");
  writeFileSync(outFile, JSON.stringify(result, null, 2));

  console.log(`=== Analysis: ${outDir} ===`);
  if (Object.keys(result.sGates).length === 0) {
    console.log("S-gates: no reports found (run `formal gates --arm <id>` per arm first)");
  }
  for (const [arm, report] of Object.entries(result.sGates)) {
    console.log(
      `S-gates ${arm.padEnd(12)} S1=${report.s1Pass ? "PASS" : "FAIL"} S2=${report.s2Pass ? "PASS" : "FAIL"} ` +
        `S3=${report.s3Pass ? "PASS" : "FAIL"} S4=${report.s4Pass ? "PASS" : "FAIL"} S5=${report.s5Pass ? "PASS" : "FAIL"} ` +
        `exempt=${report.exempt}`,
    );
  }
  for (const [arm, report] of Object.entries(result.novelty)) {
    console.log(
      `N-gates ${arm.padEnd(12)} N1=${report.n1Pass ? "PASS" : "FAIL"} N2=${report.n2Pass ? "PASS" : "FAIL"} N3=${report.n3Pass ? "PASS" : "FAIL"}`,
    );
  }
  console.log(`\nS gates overall: ${result.sPass ? "PASS" : "FAIL"}`);
  console.log(`N gates overall (evolutionary arm, noculture is attribution-only): ${result.nPass ? "PASS" : "FAIL"}`);

  if (result.primaryEndpoint) {
    const pe = result.primaryEndpoint;
    console.log(`\nPrimary endpoint: k=${pe.k} n=${pe.n} pointEstimate=${pe.pointEstimate.toFixed(4)} (target >= 0.62)`);
    console.log(`  exact two-sided binomial p=${pe.pValueTwoSided.toFixed(6)} significant(alpha=0.05)=${pe.significant}`);
    console.log(`  Wilson 95% CI: [${pe.wilson.lo.toFixed(4)}, ${pe.wilson.hi.toFixed(4)}]`);
    console.log(
      `  cluster-robust recheck: pHat=${pe.clusterRobust.pHat.toFixed(4)} se=${pe.clusterRobust.se.toFixed(4)} ` +
        `z=${pe.clusterRobust.z.toFixed(4)} p=${pe.clusterRobust.pValue.toFixed(6)}`,
    );
  } else {
    console.log(`\nPrimary endpoint: not computed (pass --judgments <csv> to compute it)`);
  }

  console.log(`\nRECOMMENDATION: ${result.recommendation.verdict} — ${result.recommendation.reason}`);
  console.log(`(advisory only per docs/prereg-1c-draft.md §6 — the actual decision stays human)`);

  console.log(`\nOutput: ${outFile}`);
}
