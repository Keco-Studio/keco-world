// Formal 1C runner CLI: chunked long simulations per docs/prereg-1c-draft.md §1-2/§7 —
// archives each seed's full artifact set to disk (resumable at per-seed granularity),
// and codifies the S1-S5 survival/degradation gates over an archived arm's seeds.
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { join } from "node:path";
import type { WorldState } from "../world/state.js";
import { createInitialState } from "../world/state.js";
import { runFromState } from "../sim/engine.js";
import { makeArmSetup, ARM_IDS } from "../arms/arms.js";
import type { ArmId, ArmSetup } from "../arms/arms.js";
import { IdentityS, PolicyS, BeliefS, SCHEMA_VERSION } from "../schema/core.js";
import type { RosterEntry } from "../schema/core.js";
import { CANON_VERSION, hashCanonical } from "../canon/canonicalize.js";
import { RNG_SCHEME_VERSION } from "../rng/rng.js";
import { computeWeightDiversity1000 } from "../analysis/diversity.js";
import { evaluateNovelty, rosterToGenomes, seedIndexOf } from "../analysis/novelty.js";
import type { GenomeUnderTest } from "../scenarios/framework.js";

/** Arm identifiers accepted by the formal runner: the four makeArmSetup arms, plus the
 * "noculture" ablation (evolutionary roster/breeding, beliefDynamics forced off). */
export type FormalArmId = ArmId | "noculture";

/** Breed-inheritance arms: the only ones for which generation depth / genome-space
 * diversity (S1's maxGen clause, S2) are meaningful — clone arms don't evolve. */
function isBreedArm(arm: FormalArmId): boolean {
  return arm === "evolutionary" || arm === "noculture";
}

export interface FormalSnapshot {
  // per chunk — superset of degradation's Snapshot fields it reuses
  tick: number;
  alive: number;
  maxGeneration: number;
  livingLineages: number;
  weightDiversity1000: number; // breed arms; 0 when <2 alive
  beliefsMaxPerNpc: number;
  verbShares1000: Record<string, number>; // THIS chunk's shares
}

export interface FormalSeedMeta {
  arm: FormalArmId;
  seedRoot: string;
  ticks: number;
  chunk: number;
  schemaVersion: string;
  canonVersion: string;
  rngSchemeVersion: string;
  complete: boolean;
  survived: boolean;
  finalAlive: number;
  maxGeneration: number;
  /**
   * Hash-of-tips chain over the full run's action log, NOT a continuation of the
   * engine's own per-event previousEventHash chain.
   *
   * Why: `runFromState` (src/sim/engine.ts) always initializes its internal
   * `lastEventHash` to `null` at the start of every call, so each chunk's actionLog
   * restarts its previousEventHash chain at null — the first event of chunk N never
   * actually chains to chunk N-1's last event inside the engine. Splicing that
   * continuity in after the fact (rewriting chunk N's first event's previousEventHash
   * to point at chunk N-1's tip) would cascade: every subsequent event's hash in the
   * chunk depends on the previous event's hash, so "fixing" just the first event
   * forces re-hashing the entire chunk. That's not merely more code — the formal
   * runner does not persist the full per-tick actionLog to disk at all (only
   * `snapshots.jsonl` and `events.jsonl.gz`, the semantic-event log), so there is
   * nothing on disk to check a spliced hash against; the extra rehashing would buy no
   * additional verifiability.
   *
   * Note the granularity this buys: chunkTip hashes only the LAST event of the
   * chunk. Tampering with an earlier event within a chunk (while leaving that
   * chunk's final event and its own local previousEventHash chain internally
   * consistent up to that point) is not, by itself, caught by actionChainTip — it
   * relies on `checkpoints.json` (one stateHash per `checkpointInterval`) and
   * `finalStateHash` to catch state-level divergence from such tampering, not the
   * tip scalar itself.
   *
   * Instead, actionChainTip is defined as a hash-of-tips chain computed once per
   * chunk from data the engine already produces:
   *   chunkTip_N = hashCanonical(lastEventOfChunk_N)   // null if chunk N's actionLog is empty
   *   tip_0      = null
   *   tip_N      = hashCanonical({ prev: tip_{N-1}, chunkTip: chunkTip_N })
   * `actionChainTip` is tip_N after the last chunk processed. This is deterministic
   * and reproducible by any later verifier that walks the same seed through the same
   * chunk boundaries and recomputes each chunk's actionLog (e.g. via a fresh
   * `runFromState` call per chunk, exactly as this runner does) — it needs no on-disk
   * action log, only the chunking parameters (seedRoot, ticks, chunk) and the engine's
   * own per-chunk hash chain, which `verifyLogChain` already knows how to check.
   */
  actionChainTip: string | null;
  finalStateHash: string;
}

export interface SGateReport {
  perSeed: {
    seedRoot: string;
    survived: boolean;
    maxGeneration: number;
    s2Ratio1000: number | null;
    s3MaxConsecutiveIdleBreaches: number;
    s4ZodValid: boolean;
    s5BeliefCapOk: boolean;
  }[];
  s1Pass: boolean;
  /** Count of seeds satisfying the per-seed S1 criterion (survived, and for breed
   * arms maxGeneration >= minGen). Exposed alongside s1Pass so a report can show
   * "11/12" rather than only the boolean verdict. */
  s1PassingSeeds: number;
  s2Pass: boolean;
  s3Pass: boolean;
  s4Pass: boolean;
  s5Pass: boolean;
  exempt: boolean; // random arm: reported but exempt from S1-S3
}

/** Evolutionary roster + cognition, with beliefDynamics forced off (§6.6 culture-ablation
 * sub-arm) — a manifest COPY, not a mutation of the evolutionary arm's own manifest. */
export function makeNocultureSetup(seedRoot: string): ArmSetup {
  const { manifest, roster } = makeArmSetup("evolutionary", seedRoot);
  return {
    manifest: { ...manifest, cognition: { ...manifest.cognition, beliefDynamics: "off" } },
    roster,
  };
}

function setupFor(arm: FormalArmId, seedRoot: string): ArmSetup {
  return arm === "noculture" ? makeNocultureSetup(seedRoot) : makeArmSetup(arm, seedRoot);
}

function buildFormalSnapshot(
  state: WorldState,
  actionLog: { action: { verb: string } }[],
  founderLineageIds: Set<string>,
): FormalSnapshot {
  const aliveNpcs = state.npcs.filter((n) => n.alive);
  const maxGeneration = aliveNpcs.length > 0 ? Math.max(...aliveNpcs.map((n) => n.generation)) : 0;
  const aliveLineageIds = new Set(aliveNpcs.map((n) => n.lineageId));
  const livingLineages = Array.from(founderLineageIds).filter((id) => aliveLineageIds.has(id)).length;
  const weightDiversity1000 = computeWeightDiversity1000(aliveNpcs);
  const beliefsMaxPerNpc = aliveNpcs.length > 0 ? Math.max(...aliveNpcs.map((n) => n.beliefs.length)) : 0;

  const verbCounts: Record<string, number> = {};
  for (const ev of actionLog) verbCounts[ev.action.verb] = (verbCounts[ev.action.verb] ?? 0) + 1;
  const verbShares1000: Record<string, number> = {};
  if (actionLog.length > 0) {
    for (const [verb, count] of Object.entries(verbCounts)) {
      verbShares1000[verb] = Math.floor((count / actionLog.length) * 1000);
    }
  }

  return {
    tick: state.tick,
    alive: aliveNpcs.length,
    maxGeneration,
    livingLineages,
    weightDiversity1000,
    beliefsMaxPerNpc,
    verbShares1000,
  };
}

function zodValidateAlive(state: WorldState): boolean {
  for (const npc of state.npcs) {
    if (!npc.alive) continue;
    if (!IdentityS.safeParse(npc.identity).success) return false;
    if (!PolicyS.safeParse(npc.policy).success) return false;
    for (const belief of npc.beliefs) {
      if (!BeliefS.safeParse(belief).success) return false;
    }
  }
  return true;
}

/**
 * Runs one arm/seed as a chunked long simulation and archives the full artifact set
 * under `<outDir>/<arm>/<seedRoot>/`. Resumable at per-seed granularity: if that dir's
 * meta.json already has `complete: true`, this is a no-op (returns the persisted meta
 * unchanged, no re-run, no file writes).
 *
 * Chunking mirrors the arms.ts/degradation.ts pattern: `runFromState` is called once
 * per chunk with `retainActionLog: true`, the chunk's actionLog is used to build one
 * FormalSnapshot line (appended immediately) and to extend `actionChainTip` (see that
 * field's doc comment for the exact hash-of-tips definition), and the chunk's actionLog
 * is then dropped — never accumulated across chunks — so memory stays bounded across
 * the full 50k-tick run regardless of population size. Semantic events ARE accumulated
 * across chunks (they're cheap) and gzip-written once at the end.
 */
export function runFormalSeed(
  arm: FormalArmId,
  seedRoot: string,
  ticks: number,
  chunk: number,
  outDir: string,
): FormalSeedMeta {
  if (chunk < 1) throw new Error(`chunk must be >= 1, got ${chunk}`);
  if (ticks < 1) throw new Error(`ticks must be >= 1, got ${ticks}`);

  const seedDir = join(outDir, arm, seedRoot);
  const metaPath = join(seedDir, "meta.json");
  if (existsSync(metaPath)) {
    const existing = JSON.parse(readFileSync(metaPath, "utf8")) as FormalSeedMeta;
    if (existing.complete) {
      console.log(`${arm}/${seedRoot}: skip (complete)`);
      return existing;
    }
  }

  mkdirSync(seedDir, { recursive: true });

  const { manifest, roster } = setupFor(arm, seedRoot);
  const founderLineageIds = new Set(roster.map((r) => r.npcId));
  let state = createInitialState(manifest, roster, seedRoot);

  const snapshotsPath = join(seedDir, "snapshots.jsonl");
  writeFileSync(snapshotsPath, ""); // fresh file: no mid-seed resume, always restart from scratch

  const allEvents: unknown[] = [];
  const allCheckpoints: unknown[] = [];
  let tip: string | null = null;

  let remaining = ticks;
  while (remaining > 0) {
    const thisChunk = Math.min(chunk, remaining);
    const result = runFromState(state, manifest, seedRoot, { ticks: thisChunk, retainActionLog: true });
    state = result.finalState;

    const snapshot = buildFormalSnapshot(state, result.actionLog, founderLineageIds);
    appendFileSync(snapshotsPath, JSON.stringify(snapshot) + "\n");

    allEvents.push(...result.events);
    allCheckpoints.push(...result.checkpoints);

    const chunkTip = result.actionLog.length > 0 ? hashCanonical(result.actionLog[result.actionLog.length - 1]) : null;
    tip = hashCanonical({ prev: tip, chunkTip });

    remaining -= thisChunk;
    if (snapshot.alive === 0) break; // extinction: stop early
  }

  const finalAlive = state.npcs.filter((n) => n.alive).length;
  const maxGeneration = state.npcs.length > 0 ? Math.max(...state.npcs.map((n) => n.generation)) : 0; // over alive AND dead
  const survived = finalAlive > 0;
  const finalStateHash = hashCanonical(state);

  writeFileSync(join(seedDir, "checkpoints.json"), JSON.stringify(allCheckpoints));
  writeFileSync(join(seedDir, "final-state.json.gz"), gzipSync(JSON.stringify(state)));
  const eventsJsonl = allEvents.map((e) => JSON.stringify(e)).join("\n") + (allEvents.length > 0 ? "\n" : "");
  writeFileSync(join(seedDir, "events.jsonl.gz"), gzipSync(eventsJsonl));
  writeFileSync(join(seedDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(seedDir, "roster.json"), JSON.stringify(roster, null, 2));
  writeFileSync(join(seedDir, "directives.json"), JSON.stringify([]));

  const meta: FormalSeedMeta = {
    arm,
    seedRoot,
    ticks,
    chunk,
    schemaVersion: SCHEMA_VERSION,
    canonVersion: CANON_VERSION,
    rngSchemeVersion: RNG_SCHEME_VERSION,
    complete: true,
    survived,
    finalAlive,
    maxGeneration,
    actionChainTip: tip,
    finalStateHash,
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  return meta;
}

/**
 * Arm-level aggregation policy per gate (docs/prereg-1c-draft.md §2), applied over
 * `perSeed`. Each gate aggregates differently — this is not a uniform "all seeds
 * must pass" or "N of M seeds must pass" rule:
 *
 * - **S1 (survival + generation depth)**: COUNT THRESHOLD, frozen at ≥10/12 seeds
 *   ("Random 臂除外的每臂 ≥10/12 seed 存活至 50k tick 且 maxGeneration ≥ 50"). This is
 *   the one gate the prereg explicitly tolerates partial failure on — e.g. 11/12
 *   surviving passes the arm. `s1MinSeeds` defaults to `ceil(perSeed.length * 10/12)`
 *   (= 10 at the design point of 12 seeds/arm, scaling proportionally for other seed
 *   counts) but can be overridden explicitly.
 * - **S2 (no monoculture collapse)**: UNANIMOUS, but only over SEEDS THAT SURVIVED.
 *   The prereg text ("终局基因组空间多样性 ≥ 创始值 30%") gives no seed-count qualifier
 *   for S2 the way S1 has one, and a seed that went extinct already fails S1 with
 *   nothing meaningful left to check for genome-space diversity — so S2 is the
 *   most-faithful reading: every surviving seed's diversity ratio must clear 30%,
 *   with extinct seeds excluded rather than counted as automatic S2 failures.
 * - **S3 (world stays active)**: UNANIMOUS over all seeds — "任一 seed 不得出现连续 3
 *   个 chunk idle 份额 > 600‰" is a per-seed hard constraint; any single seed
 *   breaching it fails the arm.
 * - **S4 (mutation bounds) / S5 (belief bounds)**: UNANIMOUS over all seeds — both
 *   are zod/structural validity constraints with no stated tolerance in the prereg.
 */
export function aggregateSGates(
  perSeed: SGateReport["perSeed"],
  arm: FormalArmId,
  opts: { minGen?: number; s1MinSeeds?: number } = {},
): Omit<SGateReport, "perSeed"> {
  const minGen = opts.minGen ?? 50;
  const breedArm = isBreedArm(arm);
  const exempt = arm === "random";
  const s1MinSeeds = opts.s1MinSeeds ?? Math.ceil((perSeed.length * 10) / 12);

  const s1PassingSeeds = perSeed.filter((s) => s.survived && (!breedArm || s.maxGeneration >= minGen)).length;
  const s1Pass = exempt || s1PassingSeeds >= s1MinSeeds;

  const survivors = perSeed.filter((s) => s.survived);
  const s2Pass = exempt || !breedArm || survivors.every((s) => (s.s2Ratio1000 ?? 0) >= 300);
  const s3Pass = exempt || perSeed.every((s) => !s.survived || s.s3MaxConsecutiveIdleBreaches < 3);
  const s4Pass = perSeed.every((s) => s.s4ZodValid);
  const s5Pass = perSeed.every((s) => s.s5BeliefCapOk);

  return { s1Pass, s1PassingSeeds, s2Pass, s3Pass, s4Pass, s5Pass, exempt };
}

/** Evaluates the S1-S5 gates (docs/prereg-1c-draft.md §2) over every seed dir archived
 * under `armDir` (i.e. `<outDir>/<arm>`). Reads only what runFormalSeed wrote to disk —
 * meta.json, snapshots.jsonl, final-state.json.gz — so it works against any archived
 * arm dir, not just ones produced in the same process. */
export function evaluateSGates(
  armDir: string,
  arm: FormalArmId,
  opts: { minAlive?: number; minGen?: number; s1MinSeeds?: number } = {},
): SGateReport {
  const minAlive = opts.minAlive ?? 1;
  const breedArm = isBreedArm(arm);

  const seedRoots = existsSync(armDir)
    ? readdirSync(armDir).filter((name) => statSync(join(armDir, name)).isDirectory())
    : [];

  const perSeed = seedRoots.map((seedRoot) => {
    const seedDir = join(armDir, seedRoot);
    const meta = JSON.parse(readFileSync(join(seedDir, "meta.json"), "utf8")) as FormalSeedMeta;
    const snapshots = readFileSync(join(seedDir, "snapshots.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as FormalSnapshot);

    const survived = meta.finalAlive >= minAlive;

    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const s2Ratio1000 =
      breedArm && survived && first !== undefined && last !== undefined && first.weightDiversity1000 > 0
        ? Math.floor((last.weightDiversity1000 * 1000) / first.weightDiversity1000)
        : null;

    let s3MaxConsecutiveIdleBreaches = 0;
    let run = 0;
    for (const s of snapshots) {
      if ((s.verbShares1000["idle"] ?? 0) > 600) {
        run += 1;
        s3MaxConsecutiveIdleBreaches = Math.max(s3MaxConsecutiveIdleBreaches, run);
      } else {
        run = 0;
      }
    }

    const finalStateBuf = gunzipSync(readFileSync(join(seedDir, "final-state.json.gz")));
    const finalState = JSON.parse(finalStateBuf.toString("utf8")) as WorldState;
    const s4ZodValid = zodValidateAlive(finalState);
    const s5BeliefCapOk = snapshots.every((s) => s.beliefsMaxPerNpc <= 16);

    return {
      seedRoot,
      survived,
      maxGeneration: meta.maxGeneration,
      s2Ratio1000,
      s3MaxConsecutiveIdleBreaches,
      s4ZodValid,
      s5BeliefCapOk,
    };
  });

  const aggregate = aggregateSGates(perSeed, arm, { minGen: opts.minGen, s1MinSeeds: opts.s1MinSeeds });

  return { perSeed, ...aggregate };
}

// Guard against CLI execution during test imports
if (process.argv[1]?.endsWith("formal.ts") || process.argv[1]?.endsWith("formal.js")) {
  function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
  }

  const FORMAL_ARM_IDS: FormalArmId[] = [...ARM_IDS, "noculture"];
  const subcommand = process.argv[2];

  if (subcommand === "run") {
    const armArg = arg("arm", "");
    if (!FORMAL_ARM_IDS.includes(armArg as FormalArmId)) {
      throw new Error(`--arm must be one of ${FORMAL_ARM_IDS.join(", ")}, got ${JSON.stringify(armArg)}`);
    }
    const arm = armArg as FormalArmId;
    const seedCount = parseInt(arg("seeds", "12"), 10);
    const ticks = parseInt(arg("ticks", "50000"), 10);
    const chunk = parseInt(arg("chunk", "1000"), 10);
    const outDir = arg("out", join("runs", "formal"));
    const seedPrefix = arg("seed-prefix", "pilot");

    if (seedPrefix !== "pilot") {
      console.log("!".repeat(72));
      console.log(`!!! OFFICIAL SEED PREFIX IN USE: "${seedPrefix}" — this is NOT a pilot run.`);
      console.log("!!! Per docs/prereg-1c-draft.md §7: any 'rerun until it passes' with an");
      console.log("!!! official seed group is a protocol violation. Proceed only if this is");
      console.log("!!! the deliberate, once-only frozen official run.");
      console.log("!".repeat(72));
    }

    const seedRoots = Array.from({ length: seedCount }, (_, i) => `${seedPrefix}-${arm}-${i + 1}`);
    console.log(`=== Formal Run: ${arm} — ${seedCount} seeds x ${ticks} ticks (chunk ${chunk}) ===`);

    for (const seedRoot of seedRoots) {
      const meta = runFormalSeed(arm, seedRoot, ticks, chunk, outDir);
      console.log(
        `${seedRoot}: survived=${meta.survived} finalAlive=${meta.finalAlive} maxGeneration=${meta.maxGeneration}`,
      );
    }

    console.log(`\nOutput: ${join(outDir, arm)}`);
  } else if (subcommand === "gates") {
    const armArg = arg("arm", "");
    if (!FORMAL_ARM_IDS.includes(armArg as FormalArmId)) {
      throw new Error(`--arm must be one of ${FORMAL_ARM_IDS.join(", ")}, got ${JSON.stringify(armArg)}`);
    }
    const arm = armArg as FormalArmId;
    const outDir = arg("out", join("runs", "formal"));

    const report = evaluateSGates(join(outDir, arm), arm);
    const outFile = join(outDir, `sgates-${arm}.json`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outFile, JSON.stringify(report, null, 2));

    console.log(`=== S-Gates: ${arm} (exempt from S1-S3: ${report.exempt}) ===`);
    console.log("seed              survived  maxGen  s2Ratio1000  s3MaxIdleRun  s4ZodValid  s5BeliefCapOk");
    for (const s of report.perSeed) {
      console.log(
        `${s.seedRoot.padEnd(17)} ${String(s.survived).padEnd(9)} ${String(s.maxGeneration).padEnd(7)} ` +
          `${String(s.s2Ratio1000).padEnd(12)} ${String(s.s3MaxConsecutiveIdleBreaches).padEnd(13)} ` +
          `${String(s.s4ZodValid).padEnd(11)} ${s.s5BeliefCapOk}`,
      );
    }
    console.log(
      `\nS1 survival (${report.s1PassingSeeds}/${report.perSeed.length}): ${report.s1Pass ? "PASS" : "FAIL"}`,
    );
    console.log(`S2 no monoculture:       ${report.s2Pass ? "PASS" : "FAIL"}`);
    console.log(`S3 world stays active:   ${report.s3Pass ? "PASS" : "FAIL"}`);
    console.log(`S4 mutation bounds hold: ${report.s4Pass ? "PASS" : "FAIL"}`);
    console.log(`S5 belief system bounded:${report.s5Pass ? "PASS" : "FAIL"}`);
    console.log(`\nOutput: ${outFile}`);
  } else if (subcommand === "novelty") {
    const armArg = arg("arm", "");
    if (armArg !== "evolutionary" && armArg !== "noculture") {
      throw new Error(`--arm must be one of evolutionary, noculture, got ${JSON.stringify(armArg)}`);
    }
    const arm = armArg as "evolutionary" | "noculture";
    const outDir = arg("out", join("runs", "formal"));

    const fixedArmDir = join(outDir, "fixed");
    if (!existsSync(fixedArmDir)) {
      throw new Error(
        `formal novelty: fixed arm archive not found at ${fixedArmDir} — N3 requires the fixed arm's ` +
          `same-seed-index founder rosters on disk. Run 'formal run --arm fixed' first.`,
      );
    }
    const fixedSeedRoots = readdirSync(fixedArmDir).filter((name) => statSync(join(fixedArmDir, name)).isDirectory());
    const fixedFounderRosters = new Map<string, GenomeUnderTest[]>();
    for (const seedRoot of fixedSeedRoots) {
      const roster = JSON.parse(readFileSync(join(fixedArmDir, seedRoot, "roster.json"), "utf8")) as RosterEntry[];
      fixedFounderRosters.set(seedIndexOf(seedRoot), rosterToGenomes(roster));
    }

    const report = evaluateNovelty(join(outDir, arm), fixedFounderRosters);
    const outFile = join(outDir, `novelty-${arm}.json`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outFile, JSON.stringify(report, null, 2));

    console.log(`=== N-Gates: ${arm} ===`);
    console.log("seed              n1VerbL1  n2Intra  n2FdrIntra  n3EvoVsFix  n3FdrVsFix  N1  N2  N3");
    for (const s of report.perSeed) {
      console.log(
        `${s.seedRoot.padEnd(17)} ${s.n1VerbL1.toFixed(4).padEnd(9)} ${s.n2Intra.toFixed(4).padEnd(8)} ` +
          `${s.n2FounderIntra.toFixed(4).padEnd(11)} ${s.n3EvolvedVsFixed.toFixed(4).padEnd(11)} ` +
          `${s.n3FoundersVsFixed.toFixed(4).padEnd(11)} ${s.n1Pass ? "Y" : "N"}   ${s.n2Pass ? "Y" : "N"}   ${s.n3Pass ? "Y" : "N"}`,
      );
    }
    console.log(`\nN1 behavioral drift:      ${report.n1Pass ? "PASS" : "FAIL"}`);
    console.log(`N2 diversity maintenance: ${report.n2Pass ? "PASS" : "FAIL"}`);
    console.log(`N3 directional novelty:   ${report.n3Pass ? "PASS" : "FAIL"}`);
    console.log(`\nOutput: ${outFile}`);
  } else {
    console.error(
      `Usage: npm run formal -- run --arm <id|noculture> [--seeds 12] [--ticks 50000] [--chunk 1000] [--out runs/formal] [--seed-prefix pilot]`,
    );
    console.error(`       npm run formal -- gates --arm <id> [--out runs/formal]`);
    console.error(`       npm run formal -- novelty --arm <evolutionary|noculture> [--out runs/formal]`);
    process.exit(1);
  }
}
