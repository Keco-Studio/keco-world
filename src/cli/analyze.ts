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

/** clusterRobustPrefSE throws on inputs it can't honor (e.g. a single distinct judge
 * — see src/analysis/stats.ts). That's the right behavior for the stats function
 * itself (never hand back a garbage z/pValue), but the CLI's job is to report the
 * primary endpoint even when the recheck can't be computed — the exact binomial test
 * and Wilson CI don't depend on judge clustering and must still print. So the
 * recheck's outcome is carried as either a real result or an explanatory error
 * string, never allowed to abort the whole analysis. */
export type ClusterRobustOutcome = ClusterRobustResult | { error: string };

export function isClusterRobustError(outcome: ClusterRobustOutcome): outcome is { error: string } {
  return "error" in outcome;
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
  clusterRobust: ClusterRobustOutcome;
}

/**
 * Joins judgments against the packet's answer key (`runs/evalpack/answer-key.json` by
 * default — `{ [pairId]: "left"|"right" }`, the side that carries the Evolutionary
 * biography), producing k = count of judgments that picked the Evolutionary side, and
 * computes the primary-endpoint statistics frozen in docs/prereg-1c-draft.md §4: exact
 * two-sided binomial vs 0.5, Wilson 95% CI (reused from src/bench/stats.ts), and the
 * cluster-robust recheck (judge-level clustering, since a judge may contribute up to 8
 * judgments — §4's "聚类稳健标准误复核"). The recheck alone can fail (e.g. a formative
 * pilot with only one judge) without losing the rest of the primary-endpoint report —
 * see ClusterRobustOutcome above.
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

  let clusterRobust: ClusterRobustOutcome;
  try {
    clusterRobust = clusterRobustPrefSE(joined);
  } catch (err) {
    clusterRobust = { error: err instanceof Error ? err.message : String(err) };
  }

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

export type Verdict = "Go" | "Iterate" | "Stop";
export interface Recommendation {
  verdict: Verdict;
  reason: string;
}

/**
 * Go/Iterate/Stop mapping per docs/prereg-1c-draft.md §6, remapped post-pilot
 * (docs/pilot-1c.md §2.2) so the S-gates-overall verdict — and hence Stop's S1
 * clause — is based on the EVOLUTIONARY arm only, not "any arm's S-gate failure".
 *
 * Rationale: baseline-arm extinction (Fixed/Handcrafted/Random going extinct) is a
 * COMPARATIVE result about those arms — it's the very thing the baseline arms exist
 * to measure (does evolution improve survival relative to non-evolving controls) —
 * not evidence that the world under test (the Evolutionary arm) is itself unstable.
 * §6's original "S 组任一失败 ⇒ Stop" wording conflated the two; it already exempted
 * Random from S1-S3 ("Random 臂灭绝不算 S 组失败"), which shows exempting
 * comparison-only arms from the Stop trigger was already the intent — this change
 * just makes that exemption consistent across all baseline arms, not just Random.
 *
 * This is advisory only — the decision itself stays human (§6 is explicit that
 * Iterate/Stop trigger a project-owner review, not an automatic pipeline branch), so
 * callers must not treat this return value as authorization to act.
 *
 * The three-way Go/Iterate/Stop vocabulary is now exhaustive (no separate
 * "Unavailable"/"Incomplete" verdict): a missing evolutionary S-gate report, or a
 * primary endpoint that was never computed (no --judgments supplied), simply makes
 * Go unreachable (its preconditions require the data) and Stop's S1 clause inert
 * (nothing to report as FAILED), so the recommendation falls through to Iterate.
 */
export function computeRecommendation(
  evoSGates: SGateReport | undefined,
  nPass: boolean,
  primary: PrimaryEndpointResult | null,
): Recommendation {
  const evoS1Fail = evoSGates !== undefined && !evoSGates.s1Pass;
  const negativeStop = primary !== null && primary.pointEstimate < 0.5 && primary.wilson.hi < 0.5;

  if (evoS1Fail || negativeStop) {
    const reasons: string[] = [];
    if (evoS1Fail) {
      reasons.push("evolutionary arm S1 failed (world itself is not stable; §6 Stop)");
    }
    if (negativeStop) {
      reasons.push("primary endpoint direction negative and Wilson CI upper bound < 0.5 (§6 Stop: 观众明确更爱手工内容)");
    }
    return { verdict: "Stop", reason: reasons.join("; ") };
  }

  const evoSGatesAllPass =
    evoSGates !== undefined &&
    evoSGates.s1Pass &&
    evoSGates.s2Pass &&
    evoSGates.s3Pass &&
    evoSGates.s4Pass &&
    evoSGates.s5Pass;

  if (evoSGatesAllPass && nPass && primary !== null && primary.primaryPass) {
    return {
      verdict: "Go",
      reason:
        "evolutionary arm S1-S5 all pass, N gates pass, primary endpoint computed and significant with point " +
        "estimate >= 0.62 (§6 Go)",
    };
  }

  return {
    verdict: "Iterate",
    reason:
      "Go/Stop criteria not met (evolutionary S-gates, N-gates, and/or the primary endpoint fall short of Go, and " +
      "neither Stop trigger fired); defaulting to Iterate pending human review (§6)",
  };
}

export interface AnalysisResult {
  sGates: Record<string, SGateReport>;
  novelty: Record<string, NoveltyReport>;
  sPass: boolean;
  /** Which arm's S-gate report the `sPass` overall verdict (and the recommendation's
   * S1-Stop clause) is computed from. Frozen to "evolutionary" post-pilot
   * (docs/pilot-1c.md §2.2, see computeRecommendation's doc comment) — other arms'
   * sGates entries are still reported in full but are comparative/attribution data,
   * not inputs to the overall S-gates verdict. */
  sGatesOverallBasis: "evolutionary";
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

  // Post-pilot remap (docs/pilot-1c.md §2.2): the S-gates-overall verdict is the
  // EVOLUTIONARY arm's S1-S5 only. Other arms' reports remain in `sGates` (printed
  // and written to analysis.json in full) but are reported/comparative — baseline-arm
  // extinction is a finding about those arms, not evidence the evolutionary world
  // under test is unstable. See computeRecommendation's doc comment for the full
  // rationale.
  const sGatesOverallBasis = "evolutionary" as const;
  const evoSGates = sGates[sGatesOverallBasis];
  const sPass = evoSGates !== undefined && evoSGates.s1Pass && evoSGates.s2Pass && evoSGates.s3Pass && evoSGates.s4Pass && evoSGates.s5Pass;

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

  const recommendation = computeRecommendation(evoSGates, nPass, primaryEndpoint);

  return { sGates, novelty, sPass, sGatesOverallBasis, nPass, primaryEndpoint, recommendation };
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
    const basisNote = arm === result.sGatesOverallBasis ? "" : "  [reported/comparative — not part of S-gates-overall]";
    console.log(
      `S-gates ${arm.padEnd(12)} S1=${report.s1Pass ? "PASS" : "FAIL"} S2=${report.s2Pass ? "PASS" : "FAIL"} ` +
        `S3=${report.s3Pass ? "PASS" : "FAIL"} S4=${report.s4Pass ? "PASS" : "FAIL"} S5=${report.s5Pass ? "PASS" : "FAIL"} ` +
        `exempt=${report.exempt}${basisNote}`,
    );
  }
  for (const [arm, report] of Object.entries(result.novelty)) {
    console.log(
      `N-gates ${arm.padEnd(12)} N1=${report.n1Pass ? "PASS" : "FAIL"} N2=${report.n2Pass ? "PASS" : "FAIL"} N3=${report.n3Pass ? "PASS" : "FAIL"}`,
    );
  }
  console.log(
    `\nS gates overall (${result.sGatesOverallBasis} arm only — other arms above are reported/comparative, ` +
      `see docs/pilot-1c.md §2.2): ${result.sPass ? "PASS" : "FAIL"}`,
  );
  console.log(`N gates overall (evolutionary arm, noculture is attribution-only): ${result.nPass ? "PASS" : "FAIL"}`);

  if (result.primaryEndpoint) {
    const pe = result.primaryEndpoint;
    console.log(`\nPrimary endpoint: k=${pe.k} n=${pe.n} pointEstimate=${pe.pointEstimate.toFixed(4)} (target >= 0.62)`);
    console.log(`  exact two-sided binomial p=${pe.pValueTwoSided.toFixed(6)} significant(alpha=0.05)=${pe.significant}`);
    console.log(`  Wilson 95% CI: [${pe.wilson.lo.toFixed(4)}, ${pe.wilson.hi.toFixed(4)}]`);
    if (isClusterRobustError(pe.clusterRobust)) {
      console.log(`  cluster-robust recheck: UNAVAILABLE — ${pe.clusterRobust.error}`);
    } else {
      console.log(
        `  cluster-robust recheck: pHat=${pe.clusterRobust.pHat.toFixed(4)} se=${pe.clusterRobust.se.toFixed(4)} ` +
          `z=${pe.clusterRobust.z.toFixed(4)} p=${pe.clusterRobust.pValue.toFixed(6)}`,
      );
    }
  } else {
    console.log(`\nPrimary endpoint: not computed (pass --judgments <csv> to compute it)`);
  }

  console.log(`\nRECOMMENDATION: ${result.recommendation.verdict} — ${result.recommendation.reason}`);
  console.log(`(advisory only per docs/prereg-1c-draft.md §6 — the actual decision stays human)`);

  console.log(`\nOutput: ${outFile}`);
}
