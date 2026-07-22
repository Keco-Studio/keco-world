// Degradation check CLI: chains runFromState in fixed-size chunks across multiple
// seeds, snapshotting cheap metrics at each chunk boundary, and evaluates the
// pre-declared D1-D5 degradation criteria from docs/superpowers/plans/2026-07-22-degradation-check.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalActionEvent } from "../schema/log.js";
import type { WorldState, NpcState } from "../world/state.js";
import { createInitialState } from "../world/state.js";
import { runFromState } from "../sim/engine.js";
import { IdentityS, PolicyS, BeliefS, UTILITY_KEYS } from "../schema/core.js";
import { makeDemoManifest, makeDemoRoster } from "./demo.js";

/** Deterministic cap on pairwise comparisons for weight-diversity, mirroring
 * the meanPairwiseVerbL1 pattern in src/scenarios/metrics.ts. */
const MAX_DIVERSITY_PAIRS = 200;

export interface Snapshot {
  tick: number;
  alive: number;
  maxGeneration: number;
  meanGeneration100: number; // floor(mean*100)
  livingLineages: number;
  weightDiversity1000: number; // floor(mean pairwise L1 proportion * 1000); 0 when <2 alive
  epsilon: { mean: number; min: number; max: number }; // over alive, mean floored int
  beliefs: { meanPer100: number; maxPerNpc: number };
  verbShares1000: Record<string, number>; // this CHUNK's actionLog verb proportions ×1000 floored
}

export interface SeedResult {
  seedRoot: string;
  snapshots: Snapshot[];
  survived: boolean;
  finalMaxGeneration: number;
  criteria: {
    d2DiversityRatio1000: number | null;
    d3IdleShare1000: number | null;
    d4ZodValid: boolean;
    d5BeliefCapOk: boolean;
  };
}

export interface DegradationReport {
  seeds: SeedResult[];
  d1Pass: boolean;
  d2Pass: boolean;
  d3Pass: boolean;
  d4Pass: boolean;
  d5Pass: boolean;
  verdict: "no-degradation" | "findings";
}

/** Mean pairwise L1 distance over utilityWeights (each key normalized to a 0..1
 * proportion by /1000), over alive NPCs, capped at MAX_DIVERSITY_PAIRS deterministic
 * (i<j order) pairs. Returns floor(proportion * 1000); 0 when <2 alive. */
function computeWeightDiversity1000(aliveNpcs: NpcState[]): number {
  if (aliveNpcs.length < 2) return 0;
  const weights = aliveNpcs.map((n) => UTILITY_KEYS.map((k) => n.policy.utilityWeights[k]));
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < weights.length; i++) {
    for (let j = i + 1; j < weights.length; j++) {
      pairs.push([i, j]);
    }
  }
  const used = pairs.slice(0, MAX_DIVERSITY_PAIRS);
  if (used.length === 0) return 0;
  let totalL1 = 0;
  for (const [i, j] of used) {
    let l1 = 0;
    for (let k = 0; k < UTILITY_KEYS.length; k++) {
      l1 += Math.abs(weights[i]![k]! - weights[j]![k]!);
    }
    totalL1 += l1;
  }
  const meanL1 = totalL1 / used.length; // raw units, 0..(UTILITY_KEYS.length * 1000)
  const proportion = meanL1 / (UTILITY_KEYS.length * 1000); // 0..1
  return Math.floor(proportion * 1000);
}

function buildSnapshot(
  state: WorldState,
  actionLog: CanonicalActionEvent[],
  founderLineageIds: Set<string>,
): Snapshot {
  const aliveNpcs = state.npcs.filter((n) => n.alive);

  const maxGeneration = aliveNpcs.length > 0 ? Math.max(...aliveNpcs.map((n) => n.generation)) : 0;
  const meanGeneration100 =
    aliveNpcs.length > 0
      ? Math.floor((aliveNpcs.reduce((sum, n) => sum + n.generation, 0) / aliveNpcs.length) * 100)
      : 0;
  const aliveLineageIds = new Set(aliveNpcs.map((n) => n.lineageId));
  const livingLineages = Array.from(founderLineageIds).filter((id) => aliveLineageIds.has(id)).length;

  const weightDiversity1000 = computeWeightDiversity1000(aliveNpcs);

  const epsVals = aliveNpcs.map((n) => n.policy.deliberationEpsilon);
  const epsilon = {
    mean: epsVals.length > 0 ? Math.floor(epsVals.reduce((a, b) => a + b, 0) / epsVals.length) : 0,
    min: epsVals.length > 0 ? Math.min(...epsVals) : 0,
    max: epsVals.length > 0 ? Math.max(...epsVals) : 0,
  };

  const beliefCounts = aliveNpcs.map((n) => n.beliefs.length);
  const beliefs = {
    meanPer100:
      aliveNpcs.length > 0
        ? Math.floor((beliefCounts.reduce((a, b) => a + b, 0) / aliveNpcs.length) * 100)
        : 0,
    maxPerNpc: beliefCounts.length > 0 ? Math.max(...beliefCounts) : 0,
  };

  const verbCounts: Record<string, number> = {};
  for (const ev of actionLog) {
    verbCounts[ev.action.verb] = (verbCounts[ev.action.verb] ?? 0) + 1;
  }
  const totalActions = actionLog.length;
  const verbShares1000: Record<string, number> = {};
  if (totalActions > 0) {
    for (const [verb, count] of Object.entries(verbCounts)) {
      verbShares1000[verb] = Math.floor((count / totalActions) * 1000);
    }
  }

  return {
    tick: state.tick,
    alive: aliveNpcs.length,
    maxGeneration,
    meanGeneration100,
    livingLineages,
    weightDiversity1000,
    epsilon,
    beliefs,
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

function runOneSeed(
  manifest: ReturnType<typeof makeDemoManifest>,
  seedRoot: string,
  ticks: number,
  chunk: number,
): SeedResult {
  const roster = makeDemoRoster(seedRoot);
  const founderLineageIds = new Set(roster.map((r) => r.npcId));
  let state = createInitialState(manifest, roster, seedRoot);
  const snapshots: Snapshot[] = [];

  let remaining = ticks;
  while (remaining > 0) {
    const thisChunk = Math.min(chunk, remaining);
    const result = runFromState(state, manifest, seedRoot, { ticks: thisChunk, retainActionLog: true });
    state = result.finalState;
    const snapshot = buildSnapshot(state, result.actionLog, founderLineageIds);
    snapshots.push(snapshot);
    remaining -= thisChunk;
    if (snapshot.alive === 0) break; // extinction: stop early
  }

  const first = snapshots[0]!;
  const last = snapshots[snapshots.length - 1]!;
  const survived = last.alive > 0;

  const d2DiversityRatio1000 =
    survived && first.weightDiversity1000 > 0
      ? Math.floor((last.weightDiversity1000 * 1000) / first.weightDiversity1000)
      : null;
  const d3IdleShare1000 = survived ? last.verbShares1000["idle"] ?? 0 : null;
  const d4ZodValid = zodValidateAlive(state);
  const d5BeliefCapOk = snapshots.every((s) => s.beliefs.maxPerNpc <= 16);

  return {
    seedRoot,
    snapshots,
    survived,
    finalMaxGeneration: last.maxGeneration,
    criteria: { d2DiversityRatio1000, d3IdleShare1000, d4ZodValid, d5BeliefCapOk },
  };
}

export function runDegradation(seedRoots: string[], ticks: number, chunk: number): DegradationReport {
  if (chunk < 1) throw new Error(`chunk must be >= 1, got ${chunk}`);
  if (ticks < 1) throw new Error(`ticks must be >= 1, got ${ticks}`);
  const manifest = makeDemoManifest();
  const seeds = seedRoots.map((seedRoot) => runOneSeed(manifest, seedRoot, ticks, chunk));

  const survivedWithGen10 = seeds.filter((s) => s.survived && s.finalMaxGeneration >= 10).length;
  const d1Pass = seeds.length > 0 ? survivedWithGen10 / seeds.length >= 5 / 6 : true;

  const survivors = seeds.filter((s) => s.survived);
  const d2Pass = survivors.every((s) => (s.criteria.d2DiversityRatio1000 ?? 0) >= 300);
  const d3Pass = survivors.every((s) => (s.criteria.d3IdleShare1000 ?? 1000) < 600);
  const d4Pass = seeds.every((s) => s.criteria.d4ZodValid);
  const d5Pass = seeds.every((s) => s.criteria.d5BeliefCapOk);

  const verdict: DegradationReport["verdict"] =
    d1Pass && d2Pass && d3Pass && d4Pass && d5Pass ? "no-degradation" : "findings";

  return { seeds, d1Pass, d2Pass, d3Pass, d4Pass, d5Pass, verdict };
}

// Guard against CLI execution during test imports
if (process.argv[1]?.endsWith("degradation.ts") || process.argv[1]?.endsWith("degradation.js")) {
  function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
  }

  const seedCount = parseInt(arg("seeds", "6"), 10);
  const ticks = parseInt(arg("ticks", "15000"), 10);
  const chunk = parseInt(arg("chunk", "1000"), 10);
  const outDir = arg("out", join("runs", "degradation"));

  const seedRoots = Array.from({ length: seedCount }, (_, i) => `deg-${i + 1}`);
  console.log(`=== Degradation Check: ${seedCount} seeds x ${ticks} ticks (chunk ${chunk}) ===`);
  const report = runDegradation(seedRoots, ticks, chunk);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));

  console.log(
    "\nseed          survived  finalGen  d2Ratio1000  d3Idle1000  d4ZodValid  d5BeliefCapOk",
  );
  for (const s of report.seeds) {
    console.log(
      `${s.seedRoot.padEnd(13)} ${String(s.survived).padEnd(9)} ${String(s.finalMaxGeneration).padEnd(9)} ` +
        `${String(s.criteria.d2DiversityRatio1000).padEnd(12)} ${String(s.criteria.d3IdleShare1000).padEnd(11)} ` +
        `${String(s.criteria.d4ZodValid).padEnd(11)} ${s.criteria.d5BeliefCapOk}`,
    );
  }

  console.log(`\nD1 sustainability (>=5/6 alive, maxGen>=10):  ${report.d1Pass ? "PASS" : "FAIL"}`);
  console.log(`D2 no monoculture collapse (diversity>=30%):  ${report.d2Pass ? "PASS" : "FAIL"}`);
  console.log(`D3 world stays active (idle share<0.60):      ${report.d3Pass ? "PASS" : "FAIL"}`);
  console.log(`D4 mutation bounds hold (zod-valid):          ${report.d4Pass ? "PASS" : "FAIL"}`);
  console.log(`D5 belief system bounded (<=16/npc):          ${report.d5Pass ? "PASS" : "FAIL"}`);
  console.log(`\nVerdict: ${report.verdict}`);
  console.log(`\nOutput: ${join(outDir, "report.json")}`);
}
