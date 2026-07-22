import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runSim } from "../sim/engine.js";
import { makeDemoManifest, makeDemoRoster } from "./demo.js";
import { SCENARIOS } from "../scenarios/library.js";
import type { Scenario, GenomeUnderTest } from "../scenarios/framework.js";
import { evaluateGenome } from "../scenarios/framework.js";
import {
  verbHistogram,
  histogramL1,
  ngramProfile,
  ngramDistance,
  meanPairwiseVerbL1,
  meanCrossVerbL1,
} from "../scenarios/metrics.js";
import type { GenomeComparison } from "../scenarios/metrics.js";

export interface BehaviorReport {
  seedRoot: string;
  ticks: number;
  foundersAlive: number;            // founders are roster genomes (all 25, regardless of survival)
  evolvedAlive: number;             // alive NPCs at end of the rerun
  maxGeneration: number;
  foundersVsEvolved: GenomeComparison;
  intraFounderDiversity: number;    // meanPairwiseVerbL1(founders)
  intraEvolvedDiversity: number;    // meanPairwiseVerbL1(evolved)
  crossDistance: number;            // meanCrossVerbL1(founders, evolved)
  topKeyShifts: [string, number][]; // largest-|delta| chosenKey proportion shifts, top 3
}

/**
 * Pooled comparison of two genome sets: each genome is evaluated exactly once, and its
 * traces are pooled (concatenated) per side before computing verbL1/bigramL1/keyShift/
 * byCategory/disagreementRate — the population-level analogue of compareGenomes for a
 * single genome pair.
 */
function comparePooled(as: GenomeUnderTest[], bs: GenomeUnderTest[], scenarios: Scenario[]): GenomeComparison {
  const tracesAByGenome = as.map((g) => evaluateGenome(g, scenarios));
  const tracesBByGenome = bs.map((g) => evaluateGenome(g, scenarios));
  const tracesA = tracesAByGenome.flat();
  const tracesB = tracesBByGenome.flat();

  const histA = verbHistogram(tracesA);
  const histB = verbHistogram(tracesB);
  const verbL1 = histogramL1(histA, histB);

  const bigramA = ngramProfile(tracesA, 2);
  const bigramB = ngramProfile(tracesB, 2);
  const bigramL1 = ngramDistance(bigramA, bigramB);

  // keyShift: per-chosenKey proportion delta (pooled B minus pooled A)
  const keyShift: Record<string, number> = {};
  const allKeys = new Set<string>();
  for (const trace of tracesA) for (const key of trace.keys) if (key !== null) allKeys.add(key);
  for (const trace of tracesB) for (const key of trace.keys) if (key !== null) allKeys.add(key);
  for (const key of allKeys) {
    const countA = tracesA.reduce((sum, t) => sum + t.keys.filter((k) => k === key).length, 0);
    const countB = tracesB.reduce((sum, t) => sum + t.keys.filter((k) => k === key).length, 0);
    const totalA = tracesA.reduce((sum, t) => sum + t.keys.length, 0);
    const totalB = tracesB.reduce((sum, t) => sum + t.keys.length, 0);
    const propA = totalA > 0 ? countA / totalA : 0;
    const propB = totalB > 0 ? countB / totalB : 0;
    keyShift[key] = propB - propA;
  }

  // byCategory: verbL1 for each category, over pooled traces
  const byCategory: GenomeComparison["byCategory"] = {
    hunger: { verbL1: 0 },
    winter: { verbL1: 0 },
    predator: { verbL1: 0 },
    courtship: { verbL1: 0 },
    hesitation: { verbL1: 0 },
    sequence: { verbL1: 0 },
  };
  for (const category of Object.keys(byCategory) as (keyof typeof byCategory)[]) {
    const idsInCategory = new Set(scenarios.filter((s) => s.category === category).map((s) => s.id));
    const tracesACategory = tracesA.filter((t) => idsInCategory.has(t.scenarioId));
    const tracesBCategory = tracesB.filter((t) => idsInCategory.has(t.scenarioId));
    byCategory[category].verbL1 = histogramL1(verbHistogram(tracesACategory), verbHistogram(tracesBCategory));
  }

  // Disagreement: per scenario, does the modal first-decision verb differ between the two pools?
  let disagreements = 0;
  let counted = 0;
  for (let k = 0; k < scenarios.length; k++) {
    const firstVerbsA = tracesAByGenome.map((t) => t[k]!.verbs[0]).filter((v): v is string => v !== undefined);
    const firstVerbsB = tracesBByGenome.map((t) => t[k]!.verbs[0]).filter((v): v is string => v !== undefined);
    if (firstVerbsA.length === 0 || firstVerbsB.length === 0) continue;
    counted++;
    if (modalVerb(firstVerbsA) !== modalVerb(firstVerbsB)) disagreements++;
  }
  const disagreementRate = counted > 0 ? disagreements / counted : 0;

  return { verbL1, bigramL1, keyShift, byCategory, disagreementRate };
}

function modalVerb(verbs: string[]): string {
  const counts = new Map<string, number>();
  for (const v of verbs) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = verbs[0]!;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Rerun the demo world from the same roster the evolve CLI uses (`makeDemoRoster(seedRoot)`),
 * then compare the founder genomes against the genomes of NPCs alive at the end of the run —
 * a quantitative answer to "did evolution change behavior?".
 */
export function behaviorReport(seedRoot: string, ticks: number): BehaviorReport {
  const manifest = makeDemoManifest();
  const roster = makeDemoRoster(seedRoot);
  const result = runSim(manifest, roster, seedRoot, { ticks, retainActionLog: false });

  const founders: GenomeUnderTest[] = roster.map((r) => ({ identity: r.identity, policy: r.policy, beliefs: r.beliefs }));
  const evolvedNpcs = result.finalState.npcs.filter((n) => n.alive);
  const evolved: GenomeUnderTest[] = evolvedNpcs.map((n) => ({ identity: n.identity, policy: n.policy, beliefs: n.beliefs }));

  const maxGeneration = Math.max(0, ...result.finalState.npcs.map((n) => n.generation));

  const foundersVsEvolved = comparePooled(founders, evolved, SCENARIOS);
  const intraFounderDiversity = meanPairwiseVerbL1(founders, SCENARIOS);
  const intraEvolvedDiversity = meanPairwiseVerbL1(evolved, SCENARIOS);
  const crossDistance = meanCrossVerbL1(founders, evolved, SCENARIOS);

  const topKeyShifts = Object.entries(foundersVsEvolved.keyShift)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3) as [string, number][];

  return {
    seedRoot,
    ticks,
    foundersAlive: founders.length,
    evolvedAlive: evolved.length,
    maxGeneration,
    foundersVsEvolved,
    intraFounderDiversity,
    intraEvolvedDiversity,
    crossDistance,
    topKeyShifts,
  };
}

// Guard against CLI execution during test imports
if (process.argv[1]?.endsWith("behavior.ts") || process.argv[1]?.endsWith("behavior.js")) {
  function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
  }

  const seedRoot = arg("seed", "evo-seed");
  const ticks = parseInt(arg("ticks", "60000"), 10);
  const outDir = arg("out", join("runs", `behavior-${seedRoot}`));

  const report = behaviorReport(seedRoot, ticks);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));

  console.log(`=== Behavior Report (seed: "${report.seedRoot}", ticks: ${report.ticks}) ===`);
  console.log(`Founders: ${report.foundersAlive}   Evolved (alive): ${report.evolvedAlive}   Max Generation: ${report.maxGeneration}`);
  console.log();
  console.log(`Intra-founder diversity (verbL1): ${report.intraFounderDiversity.toFixed(4)}`);
  console.log(`Intra-evolved diversity (verbL1): ${report.intraEvolvedDiversity.toFixed(4)}`);
  console.log(`Cross distance (founders x evolved, verbL1): ${report.crossDistance.toFixed(4)}`);
  console.log();
  console.log(`Founders vs Evolved (pooled):`);
  console.log(`  verbL1:            ${report.foundersVsEvolved.verbL1.toFixed(4)}`);
  console.log(`  bigramL1:          ${report.foundersVsEvolved.bigramL1.toFixed(4)}`);
  console.log(`  disagreementRate:  ${report.foundersVsEvolved.disagreementRate.toFixed(4)}`);
  console.log(`  byCategory:`);
  for (const [cat, v] of Object.entries(report.foundersVsEvolved.byCategory)) {
    console.log(`    ${cat.padEnd(12)} verbL1=${v.verbL1.toFixed(4)}`);
  }
  console.log();
  console.log(`Top key shifts (founders -> evolved):`);
  for (const [key, delta] of report.topKeyShifts) {
    console.log(`  ${key.padEnd(12)} ${delta >= 0 ? "+" : ""}${delta.toFixed(4)}`);
  }
  console.log(`\nOutput: ${outDir}`);
}
