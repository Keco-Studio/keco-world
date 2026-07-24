// N-gate codification (docs/prereg-1c-draft.md §3): behavioral-novelty gates over an
// archived Evolutionary/Evo-NoCulture arm, evaluated per seed against the same-seed
// founder pool and the same-seed-index Fixed arm's founder pool (N3's baseline).
//
// Instrument reuse: N1 (pooled drift) uses `comparePooled` (src/cli/behavior.ts, now
// exported for this purpose), N2 (diversity maintenance) uses `meanPairwiseVerbL1`,
// and N3 (directional novelty vs the no-evolution baseline) uses `meanCrossVerbL1` —
// both from src/scenarios/metrics.ts. Per the prereg's "epsilon confound" framing
// (§3), all three gates are self-referential (evolved vs that seed's own founders) or
// directional (evolved vs fixed, compared against founders vs fixed) — never a raw
// cross-arm absolute number — because the deliberation-epsilon confound makes raw
// diversity numbers incomparable across arms (baseline-arms.md finding 2).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import type { WorldState } from "../world/state.js";
import type { RosterEntry } from "../schema/core.js";
import type { GenomeUnderTest } from "../scenarios/framework.js";
import { SCENARIOS } from "../scenarios/library.js";
import { meanPairwiseVerbL1, meanCrossVerbL1 } from "../scenarios/metrics.js";
import { comparePooled } from "../cli/behavior.js";

export interface NoveltyThresholds {
  n1MinVerbL1: number;
  n2RatioMin: number;
  n2AbsMin: number;
  minPassingSeeds: number;
}

/** Per docs/prereg-1c-draft.md §3 (待拍板 items frozen at their conservative,
 * evo-1-anchored values): N1 verbL1 >= 0.30; N2 final intra-pool diversity >= 60% of
 * founder intra-pool diversity AND >= 0.25 absolute; arm gate requires >= 9/12 seeds
 * passing each of N1/N2/N3. */
export const DEFAULT_NOVELTY_THRESHOLDS: NoveltyThresholds = {
  n1MinVerbL1: 0.3,
  n2RatioMin: 0.6,
  n2AbsMin: 0.25,
  minPassingSeeds: 9,
};

export interface SeedNovelty {
  seedRoot: string;
  n1VerbL1: number;
  n2Intra: number;
  n2FounderIntra: number;
  n3EvolvedVsFixed: number;
  n3FoundersVsFixed: number;
  n1Pass: boolean;
  n2Pass: boolean;
  n3Pass: boolean;
}

export interface NoveltyReport {
  perSeed: SeedNovelty[];
  n1Pass: boolean;
  n2Pass: boolean;
  n3Pass: boolean;
}

/** Deterministic pairwise/cross-pair cap passed through to meanPairwiseVerbL1 /
 * meanCrossVerbL1. C(60,2) = 1770 (evolved populations cap at manifest.maxPopulation
 * = 60) and any evolved(<=60) x fixedFounders(25) cross count (<=1500) both fit under
 * this cap with margin, so every N2/N3 comparison in the formal 1C design point is
 * exhaustive, not sampled. Founders (25 = C(25,2)=300) are exhaustive a fortiori. */
const MAX_PAIRS = 2000;

/** Projects archived roster entries down to the identity/policy/beliefs genome fields
 * that scenario evaluation reads (drops npcId/name). */
export function rosterToGenomes(roster: RosterEntry[]): GenomeUnderTest[] {
  return roster.map((r) => ({ identity: r.identity, policy: r.policy, beliefs: r.beliefs }));
}

/** Extracts the trailing seed index from a seedRoot of the form `<prefix>-<arm>-<n>`
 * (e.g. "pilot-evolutionary-4" -> "4"), used to pair an evolutionary/noculture seed
 * with its same-index counterpart in the fixed arm for N3. */
export function seedIndexOf(seedRoot: string): string {
  const m = /-(\d+)$/.exec(seedRoot);
  if (m === null) {
    throw new Error(`seedIndexOf: seedRoot ${JSON.stringify(seedRoot)} has no trailing "-<index>"`);
  }
  return m[1]!;
}

/**
 * Pure core: no disk I/O, no arm/seed bookkeeping — just the N1/N2/N3 math over three
 * already-loaded genome pools. Exported so thresholds, pass/fail logic, and the metric
 * calls can be unit-tested with hand-constructed genomes (see tests/novelty.test.ts).
 *
 * Cost note (docs/prereg-1c-draft.md §9 item 3 / task-2 brief): each of founders,
 * evolved, and fixedFounders gets re-evaluated (evaluateGenome, 31 scenarios each)
 * multiple times across the three metric calls below — meanPairwiseVerbL1/
 * meanCrossVerbL1/comparePooled each evaluate their inputs internally and don't share
 * a cache across calls. Reusing evaluations across N1/N2/N3 would require threading a
 * pre-computed trace/histogram cache through src/scenarios/metrics.ts's public API,
 * which the task brief explicitly says not to do ("if reuse requires invasive
 * changes, DON'T refactor the metrics module... correctness first"). At the formal
 * run's design point (25 founders, <=60 evolved, 25 fixed founders) this means ~200
 * genome evaluations (~6200 scenario runs) per seed; left as a known cost, not
 * addressed here.
 */
export function evaluateNoveltyForSeed(
  founders: GenomeUnderTest[],
  evolved: GenomeUnderTest[],
  fixedFounders: GenomeUnderTest[],
  thresholds: NoveltyThresholds,
): Omit<SeedNovelty, "seedRoot"> {
  const n1VerbL1 = comparePooled(founders, evolved, SCENARIOS).verbL1;
  const n2Intra = meanPairwiseVerbL1(evolved, SCENARIOS, MAX_PAIRS);
  const n2FounderIntra = meanPairwiseVerbL1(founders, SCENARIOS, MAX_PAIRS);
  const n3EvolvedVsFixed = meanCrossVerbL1(evolved, fixedFounders, SCENARIOS, MAX_PAIRS);
  const n3FoundersVsFixed = meanCrossVerbL1(founders, fixedFounders, SCENARIOS, MAX_PAIRS);

  const n1Pass = n1VerbL1 >= thresholds.n1MinVerbL1;
  const n2Pass = n2Intra >= n2FounderIntra * thresholds.n2RatioMin && n2Intra >= thresholds.n2AbsMin;
  const n3Pass = n3EvolvedVsFixed >= n3FoundersVsFixed;

  return { n1VerbL1, n2Intra, n2FounderIntra, n3EvolvedVsFixed, n3FoundersVsFixed, n1Pass, n2Pass, n3Pass };
}

/**
 * Disk wrapper: evaluates the N1-N3 gates over every seed dir archived under `armDir`
 * (i.e. `<outDir>/<arm>`, arm being "evolutionary" or "noculture"). Reads only what
 * runFormalSeed (src/cli/formal.ts) wrote — roster.json for founders, final-state.json.gz
 * for the evolved (alive-at-end) pool — so it works against any archived arm dir.
 *
 * `fixedFounderRosters` supplies the N3 baseline: the Fixed arm's founder roster for
 * the SAME seed index (see seedIndexOf), pre-loaded by the caller (the `formal
 * novelty` CLI subcommand builds this from `<outDir>/fixed`). A seed whose index has
 * no entry in the map throws — N3 cannot be computed without that seed's fixed-arm
 * counterpart on disk.
 */
export function evaluateNovelty(
  armDir: string,
  fixedFounderRosters: Map<string, GenomeUnderTest[]>,
  thresholds: NoveltyThresholds = DEFAULT_NOVELTY_THRESHOLDS,
): NoveltyReport {
  const seedRoots = existsSync(armDir)
    ? readdirSync(armDir).filter((name) => statSync(join(armDir, name)).isDirectory())
    : [];

  const perSeed: SeedNovelty[] = seedRoots.map((seedRoot) => {
    const seedDir = join(armDir, seedRoot);

    const roster = JSON.parse(readFileSync(join(seedDir, "roster.json"), "utf8")) as RosterEntry[];
    const founders = rosterToGenomes(roster);

    const finalStateBuf = gunzipSync(readFileSync(join(seedDir, "final-state.json.gz")));
    const finalState = JSON.parse(finalStateBuf.toString("utf8")) as WorldState;
    const evolved: GenomeUnderTest[] = finalState.npcs
      .filter((n) => n.alive)
      .map((n) => ({ identity: n.identity, policy: n.policy, beliefs: n.beliefs }));

    const index = seedIndexOf(seedRoot);
    const fixedFounders = fixedFounderRosters.get(index);
    if (fixedFounders === undefined) {
      throw new Error(
        `evaluateNovelty: no fixed-arm founder roster for seed index ${JSON.stringify(index)} ` +
          `(seed ${JSON.stringify(seedRoot)}) — N3 requires the fixed arm's archive for the same ` +
          `seed index. Run the fixed arm (formal run --arm fixed) first.`,
      );
    }

    return { seedRoot, ...evaluateNoveltyForSeed(founders, evolved, fixedFounders, thresholds) };
  });

  const passCount = (pred: (s: SeedNovelty) => boolean) => perSeed.filter(pred).length;
  const n1Pass = passCount((s) => s.n1Pass) >= thresholds.minPassingSeeds;
  const n2Pass = passCount((s) => s.n2Pass) >= thresholds.minPassingSeeds;
  const n3Pass = passCount((s) => s.n3Pass) >= thresholds.minPassingSeeds;

  return { perSeed, n1Pass, n2Pass, n3Pass };
}
