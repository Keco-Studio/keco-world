// Arms CLI: runs a named "arm" (random | fixed | handcrafted | evolutionary) as a
// chunked long simulation, and compares arms behaviorally by evaluating each arm's
// founder genomes against the shared scenario suite (src/scenarios/library.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInitialState } from "../world/state.js";
import { runFromState } from "../sim/engine.js";
import { makeArmSetup, ARM_IDS } from "../arms/arms.js";
import type { ArmId } from "../arms/arms.js";
import { SCENARIOS } from "../scenarios/library.js";
import { meanPairwiseVerbL1, meanCrossVerbL1 } from "../scenarios/metrics.js";
import type { GenomeUnderTest } from "../scenarios/framework.js";

export interface ArmSeedResult {
  arm: ArmId;
  seedRoot: string;
  survived: boolean;
  finalAlive: number;
  maxGeneration: number;
  livingLineages: number;
  verbShares1000: Record<string, number>; // whole-run action-log verb proportions ×1000 floored
}

/**
 * Run one arm/seed as a chunked long simulation: chains runFromState in fixed-size
 * chunks (carrying finalState forward), pooling verb counts over ALL chunks (not
 * just the final one) and dropping each chunk's actionLog after counting so memory
 * stays bounded regardless of `ticks`. Stops early on extinction.
 */
export function runArm(arm: ArmId, seedRoot: string, ticks: number, chunk: number): ArmSeedResult {
  if (chunk < 1) throw new Error(`chunk must be >= 1, got ${chunk}`);
  if (ticks < 1) throw new Error(`ticks must be >= 1, got ${ticks}`);

  const { manifest, roster } = makeArmSetup(arm, seedRoot);
  const founderLineageIds = new Set(roster.map((r) => r.npcId));
  let state = createInitialState(manifest, roster, seedRoot);

  const verbCounts: Record<string, number> = {};
  let totalActions = 0;
  let alive = state.npcs.filter((n) => n.alive).length;

  let remaining = ticks;
  while (remaining > 0) {
    const thisChunk = Math.min(chunk, remaining);
    const result = runFromState(state, manifest, seedRoot, { ticks: thisChunk, retainActionLog: true });
    state = result.finalState;

    for (const ev of result.actionLog) {
      verbCounts[ev.action.verb] = (verbCounts[ev.action.verb] ?? 0) + 1;
      totalActions++;
    }

    alive = state.npcs.filter((n) => n.alive).length;
    remaining -= thisChunk;
    if (alive === 0) break; // extinction: stop early
  }

  const survived = alive > 0;
  const maxGeneration =
    state.npcs.length > 0 ? Math.max(...state.npcs.map((n) => n.generation)) : 0; // over alive AND dead
  const aliveLineageIds = new Set(state.npcs.filter((n) => n.alive).map((n) => n.lineageId));
  const livingLineages = Array.from(founderLineageIds).filter((id) => aliveLineageIds.has(id)).length;

  const verbShares1000: Record<string, number> = {};
  if (totalActions > 0) {
    for (const [verb, count] of Object.entries(verbCounts)) {
      verbShares1000[verb] = Math.floor((count / totalActions) * 1000);
    }
  }

  return {
    arm,
    seedRoot,
    survived,
    finalAlive: alive,
    maxGeneration,
    livingLineages,
    verbShares1000,
  };
}

export interface ArmComparison {
  intra: Record<ArmId, number>; // meanPairwiseVerbL1 over the arm's 25 founder genomes
  cross: Record<string, number>; // "a|b" -> meanCrossVerbL1 between arm founder sets
}

/**
 * Compares arms by CONTENT: each arm's founder genomes (identity/policy/beliefs, incl.
 * designed beliefs for "handcrafted") are evaluated against the shared scenario suite
 * under the scenario suite's own manifest (evaluateGenome always uses scenario.build()'s
 * manifest) — this is the §6.7 novelty question, independent of the arm's simulation
 * manifest/cognition mode used by runArm.
 */
export function compareArms(seedRoot: string): ArmComparison {
  const genomesByArm = {} as Record<ArmId, GenomeUnderTest[]>;
  for (const arm of ARM_IDS) {
    const { roster } = makeArmSetup(arm, seedRoot);
    genomesByArm[arm] = roster.map((r) => ({
      identity: r.identity,
      policy: r.policy,
      beliefs: r.beliefs,
    }));
  }

  const intra = {} as Record<ArmId, number>;
  for (const arm of ARM_IDS) {
    intra[arm] = meanPairwiseVerbL1(genomesByArm[arm]!, SCENARIOS, 300);
  }

  const cross: Record<string, number> = {};
  for (let i = 0; i < ARM_IDS.length; i++) {
    for (let j = i + 1; j < ARM_IDS.length; j++) {
      const a = ARM_IDS[i]!;
      const b = ARM_IDS[j]!;
      cross[`${a}|${b}`] = meanCrossVerbL1(genomesByArm[a]!, genomesByArm[b]!, SCENARIOS, 625);
    }
  }

  return { intra, cross };
}

// Guard against CLI execution during test imports
if (process.argv[1]?.endsWith("arms.ts") || process.argv[1]?.endsWith("arms.js")) {
  function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
  }

  const subcommand = process.argv[2];

  if (subcommand === "run") {
    const armArg = arg("arm", "");
    if (!ARM_IDS.includes(armArg as ArmId)) {
      throw new Error(`--arm must be one of ${ARM_IDS.join(", ")}, got ${JSON.stringify(armArg)}`);
    }
    const arm = armArg as ArmId;
    const seedCount = parseInt(arg("seeds", "3"), 10);
    const ticks = parseInt(arg("ticks", "15000"), 10);
    const chunk = parseInt(arg("chunk", "1000"), 10);
    const outDir = arg("out", join("runs", "arms"));

    const seedRoots = Array.from({ length: seedCount }, (_, i) => `arm-${arm}-${i + 1}`);
    console.log(`=== Arms Run: ${arm} — ${seedCount} seeds x ${ticks} ticks (chunk ${chunk}) ===`);

    const results = seedRoots.map((seedRoot) => runArm(arm, seedRoot, ticks, chunk));

    mkdirSync(outDir, { recursive: true });
    const outFile = join(outDir, `report-${arm}.json`);
    writeFileSync(outFile, JSON.stringify(results, null, 2));

    console.log("\nseed              survived  finalAlive  maxGen  livingLineages");
    for (const r of results) {
      console.log(
        `${r.seedRoot.padEnd(17)} ${String(r.survived).padEnd(9)} ${String(r.finalAlive).padEnd(11)} ` +
          `${String(r.maxGeneration).padEnd(7)} ${r.livingLineages}`,
      );
    }

    console.log(`\nOutput: ${outFile}`);
  } else if (subcommand === "compare") {
    const seedRoot = arg("seed", "arms-cmp");
    const outDir = arg("out", join("runs", "arms"));

    console.log(`=== Arms Compare: seed ${seedRoot} ===`);
    const comparison = compareArms(seedRoot);

    mkdirSync(outDir, { recursive: true });
    const outFile = join(outDir, "compare.json");
    writeFileSync(outFile, JSON.stringify(comparison, null, 2));

    console.log("\narm            intra");
    for (const arm of ARM_IDS) {
      console.log(`${arm.padEnd(14)} ${comparison.intra[arm].toFixed(4)}`);
    }

    console.log("\npair                          cross");
    for (const [pair, value] of Object.entries(comparison.cross)) {
      console.log(`${pair.padEnd(30)} ${value.toFixed(4)}`);
    }

    console.log(`\nOutput: ${outFile}`);
  } else {
    console.error(`Usage: npm run arms -- run --arm <id> [--seeds 3] [--ticks 15000] [--chunk 1000] [--out runs/arms]`);
    console.error(`       npm run arms -- compare [--seed arms-cmp] [--out runs/arms]`);
    process.exit(1);
  }
}
