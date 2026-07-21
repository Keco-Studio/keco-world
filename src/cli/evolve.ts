import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunResult } from "../sim/engine.js";
import { runSim } from "../sim/engine.js";
import type { RosterEntry } from "../schema/core.js";
import { makeDemoManifest, makeDemoRoster } from "./demo.js";

export interface EvolutionSummary {
  finalPopulation: number;
  totalBirths: number;
  deathsByCause: Record<string, number>;
  maxGeneration: number;
  meanGenerationAlive: number;        // ×100 integer (avoid floats): floor(mean*100)
  livingLineages: number;
  extinctLineages: number;            // founders whose lineage has no living member
  beliefStats: { totalHeld: number; meanPerNpc100: number; formedEvents: number };
  weightDiversity100: number;         // floor(mean pairwise L1 distance of utilityWeights over alive NPCs * 100 / #keys) — 0 when < 2 alive
}

export function summarizeEvolution(result: RunResult, roster: RosterEntry[]): EvolutionSummary {
  const { finalState, events } = result;

  // Count births and deaths
  const totalBirths = events.filter((e) => e.kind === "birth").length;
  const deathEvents = events.filter((e) => e.kind === "death");
  const deathsByCause: Record<string, number> = {};
  for (const e of deathEvents) {
    const cause = (e.data.cause as string) || "unknown";
    deathsByCause[cause] = (deathsByCause[cause] ?? 0) + 1;
  }

  // Calculate max generation
  const maxGeneration = Math.max(0, ...finalState.npcs.map((n) => n.generation));

  // Calculate meanGenerationAlive (×100 integer)
  const aliveNpcs = finalState.npcs.filter((n) => n.alive);
  const meanGenerationAlive =
    aliveNpcs.length > 0
      ? Math.floor((aliveNpcs.reduce((sum, n) => sum + n.generation, 0) / aliveNpcs.length) * 100)
      : 0;

  // Count living and extinct lineages
  const finalPopulation = aliveNpcs.length;
  const livingLineageIds = new Set(aliveNpcs.map((n) => n.lineageId));
  const founderLineageIds = new Set(roster.map((r) => r.npcId));
  const livingLineages = Array.from(founderLineageIds).filter((id) => livingLineageIds.has(id)).length;
  const extinctLineages = founderLineageIds.size - livingLineages;

  // Calculate belief stats
  const beliefFormedEvents = events.filter((e) => e.kind === "belief_formed");
  const totalBeliefsHeld = finalState.npcs.reduce((sum, n) => sum + n.beliefs.length, 0);
  const meanPerNpc100 =
    finalState.npcs.length > 0
      ? Math.floor((totalBeliefsHeld / finalState.npcs.length) * 100)
      : 0;

  // Calculate weight diversity (mean pairwise L1 distance of utilityWeights over alive NPCs)
  let weightDiversity100 = 0;
  if (aliveNpcs.length >= 2) {
    const utilityKeys = ["forage", "consume", "shelter", "explore", "idle"] as const;
    const weights = aliveNpcs.map((n) => utilityKeys.map((k) => n.policy.utilityWeights[k]));

    // Compute mean pairwise L1 distance
    let totalDistance = 0;
    let pairCount = 0;
    for (let i = 0; i < weights.length; i++) {
      for (let j = i + 1; j < weights.length; j++) {
        const l1Distance = weights[i]!.reduce((sum, val, idx) => sum + Math.abs(val - (weights[j]?.[idx] ?? 0)), 0);
        totalDistance += l1Distance;
        pairCount++;
      }
    }

    const meanDistance = totalDistance / pairCount;
    const normalizedDiversity = meanDistance / utilityKeys.length;
    weightDiversity100 = Math.floor(normalizedDiversity * 100);
  }

  return {
    finalPopulation,
    totalBirths,
    deathsByCause,
    maxGeneration,
    meanGenerationAlive,
    livingLineages,
    extinctLineages,
    beliefStats: {
      totalHeld: totalBeliefsHeld,
      meanPerNpc100,
      formedEvents: beliefFormedEvents.length,
    },
    weightDiversity100,
  };
}

// Guard against CLI execution during test imports
if (process.argv[1]?.endsWith("evolve.ts") || process.argv[1]?.endsWith("evolve.js")) {
  function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
  }

  const seedRoot = arg("seed", "evo-seed");
  const ticks = parseInt(arg("ticks", "60000"), 10);
  const outDir = arg("out", join("runs", `evolve-${seedRoot}`));

  const manifest = makeDemoManifest();
  const roster = makeDemoRoster(seedRoot);
  const result = runSim(manifest, roster, seedRoot, { ticks, retainActionLog: false });
  const summary = summarizeEvolution(result, roster);

  // Create output directory
  mkdirSync(outDir, { recursive: true });

  // Write summary.json
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

  // Write births.jsonl
  const birthEvents = result.events.filter((e) => e.kind === "birth");
  writeFileSync(
    join(outDir, "births.jsonl"),
    birthEvents.map((e) => JSON.stringify(e)).join("\n") + (birthEvents.length > 0 ? "\n" : ""),
  );

  // Print summary
  console.log(`=== Evolution Summary (seed: "${seedRoot}", ticks: ${ticks}) ===`);
  console.log(`Final Population: ${summary.finalPopulation}`);
  console.log(`Total Births: ${summary.totalBirths}`);
  console.log(`Deaths by Cause: ${JSON.stringify(summary.deathsByCause)}`);
  console.log(`Max Generation: ${summary.maxGeneration}`);
  console.log(`Mean Generation (alive): ${(summary.meanGenerationAlive / 100).toFixed(2)}`);
  console.log(`Living Lineages: ${summary.livingLineages}/${roster.length}`);
  console.log(`Extinct Lineages: ${summary.extinctLineages}`);
  console.log(`Beliefs Held: ${summary.beliefStats.totalHeld} (mean: ${(summary.beliefStats.meanPerNpc100 / 100).toFixed(2)})`);
  console.log(`Beliefs Formed: ${summary.beliefStats.formedEvents}`);
  console.log(`Weight Diversity: ${(summary.weightDiversity100 / 100).toFixed(2)}`);

  // Print generation histogram
  const generationCounts: Record<number, number> = {};
  for (const npc of result.finalState.npcs) {
    if (npc.alive) {
      generationCounts[npc.generation] = (generationCounts[npc.generation] ?? 0) + 1;
    }
  }
  console.log("\nGeneration Histogram (alive NPCs):");
  for (const gen of Object.keys(generationCounts).map(Number).sort((a, b) => a - b)) {
    const count = generationCounts[gen] ?? 0;
    const bar = "█".repeat(Math.min(count, 50));
    console.log(`  Gen ${gen}: ${bar} (${count})`);
  }

  console.log(`\nOutput: ${outDir}`);
}
