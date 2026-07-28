// World2 CLI: chains runFromState2 in fixed-size chunks (carrying finalState
// forward), accumulating a cheap W2Snapshot per chunk from that chunk's own
// actionLog + the current state, then dropping the chunk's result so memory
// stays bounded regardless of `ticks`. Stops early on extinction. Style
// modelled on src/cli/degradation.ts and src/cli/arms.ts (read-only
// references; neither is modified here).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { W2Manifest, W2RosterEntry, BuildingKind, ResourceKind, GoalKey } from "../schema/world2.js";
import { SCHEMA_VERSION_W2, GRID, VISION_RADIUS, GOAL_KEYS, BUILDING_KINDS, RESOURCE_KINDS } from "../schema/world2.js";
import { generateSites } from "../world2/map.js";
import type { W2WorldState } from "../world2/state.js";
import { createW2InitialState } from "../world2/state.js";
import { runFromState2 } from "../sim/engine2.js";
import type { W2ActionEvent } from "../sim/engine2.js";
import { drawInt } from "../rng/rng.js";
import { hashCanonical } from "../canon/canonicalize.js";

// Fixed map layout shared across all CLI seeds/runs (v1 parity: demo.ts's
// bushes are likewise generated from a constant "demo-layout" key, not the
// run's own seedRoot, so only roster/decisions vary by seed and maps stay
// comparable across seeds).
const MAP_SEED = "world2-map";

export function makeW2Manifest(): W2Manifest {
  return {
    schemaVersion: SCHEMA_VERSION_W2,
    gridWidth: GRID,
    gridHeight: GRID,
    seasonLengthTicks: 400,
    energyDrainPerTick: 2,
    starvationHpDrain: 5,
    winterColdHpDrain: 3,
    berryEnergy: 200,
    wolfDamage: 50,
    hpRegenPerTick: 1,
    hpRegenEnergyMin: 500,
    maxHp: 1000,
    maxEnergy: 1000,
    visionRadius: VISION_RADIUS,
    checkpointInterval: 100,
    sites: generateSites(MAP_SEED),
    wolfStart: { x: GRID - 1, y: GRID - 1 },
    adultAgeTicks: 800,
    elderAgeTicks: 2400,
    senescenceHpDrain: 2,
    reproEnergyMin: 600,
    reproEnergyCost: 300,
    reproCooldownTicks: 200,
    birthChancePpm: 50_000,
    maxPopulation: 60,
    childStartHp: 600,
    childStartEnergy: 600,
    founderSeededMemory: 3,
  };
}

// Standalone name pool for w2 founders (deliberately not importing v1's
// src/world/rules.ts NAME_POOL — v1 files are frozen and w2 should not couple
// its roster generation to a v1-only export).
const W2_NAME_POOL = [
  "Bracken", "Ilse", "Toren", "Maren", "Cael", "Rowe", "Sena", "Idun", "Varo", "Nell",
  "Osk", "Fira", "Tobin", "Wynn", "Ada", "Corvin", "Lysa", "Petro", "Eowyn", "Kestrel",
  "Ombra", "Sula", "Dagny", "Finch", "Marek",
] as const;

function vary(seedRoot: string, base: number, spread: number, ...key: (string | number)[]): number {
  const v = base - spread + drawInt(seedRoot, spread * 2 + 1, ...key);
  return Math.max(0, Math.min(1000, v));
}

export function makeW2Roster(seedRoot: string): W2RosterEntry[] {
  return W2_NAME_POOL.map((name, i) => {
    const npcId = `npc-${i + 1}`;
    const goalWeights = Object.fromEntries(
      GOAL_KEYS.map((k) => [k, vary(seedRoot, 400, 300, "goal-weight", k, i)]),
    ) as Record<GoalKey, number>;
    return {
      npcId,
      name,
      identity: {
        riskTolerance: vary(seedRoot, 500, 300, "risk", i),
        socialTrust: vary(seedRoot, 500, 300, "trust", i),
        explorationBias: vary(seedRoot, 400, 300, "explore", i),
        patience: vary(seedRoot, 500, 300, "patience", i),
        voiceStyle: "",
      },
      policy: {
        goalWeights,
        thresholds: { hungerUrgent: vary(seedRoot, 150, 100, "t-hunger", i) },
        deliberationEpsilon: vary(seedRoot, 60, 40, "w-epsilon", i),
        commitmentThreshold: vary(seedRoot, 150, 100, "w-commit", i),
      },
      beliefs: [],
    };
  });
}

export interface W2Snapshot {
  tick: number;
  alive: number;
  maxGeneration: number;
  livingLineages: number;
  verbShares1000: Record<string, number>; // this CHUNK's actionLog verb proportions x1000 floored
  goalShares1000: Record<string, number>; // this CHUNK's actionLog goal proportions x1000 floored;
  // reflex decisions (goal: null) are counted under the "reflex" bucket rather
  // than excluded, so this sum lands in the same (900,1000] range as
  // verbShares1000 instead of an unrelated, smaller denominator.
  buildings: Record<BuildingKind, number>; // current total count per kind
  siteStock: Record<ResourceKind, number>; // current total stock per resource kind
  beliefsMaxPerNpc: number;
}

export interface W2SeedResult {
  seedRoot: string;
  survived: boolean;
  finalAlive: number;
  maxGeneration: number;
  snapshots: W2Snapshot[];
  finalStateHash: string;
}

function buildW2Snapshot(
  state: W2WorldState,
  actionLog: W2ActionEvent[],
  founderLineageIds: Set<string>,
): W2Snapshot {
  const aliveNpcs = state.npcs.filter((n) => n.alive);

  const maxGeneration = aliveNpcs.length > 0 ? Math.max(...aliveNpcs.map((n) => n.generation)) : 0;
  const aliveLineageIds = new Set(aliveNpcs.map((n) => n.lineageId));
  const livingLineages = Array.from(founderLineageIds).filter((id) => aliveLineageIds.has(id)).length;

  const verbCounts: Record<string, number> = {};
  const goalCounts: Record<string, number> = {};
  for (const ev of actionLog) {
    verbCounts[ev.action.verb] = (verbCounts[ev.action.verb] ?? 0) + 1;
    const goalKey = ev.goal ?? "reflex";
    goalCounts[goalKey] = (goalCounts[goalKey] ?? 0) + 1;
  }
  const totalActions = actionLog.length;
  const verbShares1000: Record<string, number> = {};
  const goalShares1000: Record<string, number> = {};
  if (totalActions > 0) {
    for (const [verb, count] of Object.entries(verbCounts)) {
      verbShares1000[verb] = Math.floor((count / totalActions) * 1000);
    }
    for (const [goalKey, count] of Object.entries(goalCounts)) {
      goalShares1000[goalKey] = Math.floor((count / totalActions) * 1000);
    }
  }

  const buildings = Object.fromEntries(BUILDING_KINDS.map((k) => [k, 0])) as Record<BuildingKind, number>;
  for (const b of state.buildings) buildings[b.kind] += 1;

  const siteStock = Object.fromEntries(RESOURCE_KINDS.map((k) => [k, 0])) as Record<ResourceKind, number>;
  for (const s of state.sites) siteStock[s.kind] += s.stock;

  const beliefsMaxPerNpc = aliveNpcs.length > 0 ? Math.max(...aliveNpcs.map((n) => n.beliefs.length)) : 0;

  return {
    tick: state.tick,
    alive: aliveNpcs.length,
    maxGeneration,
    livingLineages,
    verbShares1000,
    goalShares1000,
    buildings,
    siteStock,
    beliefsMaxPerNpc,
  };
}

export function runW2Seed(seedRoot: string, ticks: number, chunk: number): W2SeedResult {
  if (chunk < 1) throw new Error(`chunk must be >= 1, got ${chunk}`);
  if (ticks < 1) throw new Error(`ticks must be >= 1, got ${ticks}`);

  const manifest = makeW2Manifest();
  const roster = makeW2Roster(seedRoot);
  const founderLineageIds = new Set(roster.map((r) => r.npcId));
  let state = createW2InitialState(manifest, roster, seedRoot);
  const snapshots: W2Snapshot[] = [];

  let remaining = ticks;
  while (remaining > 0) {
    const thisChunk = Math.min(chunk, remaining);
    const result = runFromState2(state, manifest, seedRoot, { ticks: thisChunk, retainActionLog: true });
    state = result.finalState;
    const snapshot = buildW2Snapshot(state, result.actionLog, founderLineageIds);
    snapshots.push(snapshot);
    remaining -= thisChunk;
    if (snapshot.alive === 0) break; // extinction: stop early
  }

  const last = snapshots[snapshots.length - 1]!;

  return {
    seedRoot,
    survived: last.alive > 0,
    finalAlive: last.alive,
    maxGeneration: last.maxGeneration,
    snapshots,
    finalStateHash: hashCanonical(state),
  };
}

// Guard against CLI execution during test imports
if (process.argv[1]?.endsWith("world2.ts") || process.argv[1]?.endsWith("world2.js")) {
  function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
  }

  const subcommand = process.argv[2];

  if (subcommand === "run") {
    const seedCount = parseInt(arg("seeds", "3"), 10);
    const ticks = parseInt(arg("ticks", "60000"), 10);
    const chunk = parseInt(arg("chunk", "1000"), 10);
    const seedPrefix = arg("seed-prefix", "w2");
    const outDir = arg("out", join("runs", "world2"));

    const seedRoots = Array.from({ length: seedCount }, (_, i) => `${seedPrefix}-${i + 1}`);
    console.log(`=== World2 Run: ${seedCount} seeds x ${ticks} ticks (chunk ${chunk}) ===`);

    mkdirSync(outDir, { recursive: true });

    console.log("\nseed          survived  finalAlive  maxGen  livingLineages");
    for (const seedRoot of seedRoots) {
      const result = runW2Seed(seedRoot, ticks, chunk);

      const seedDir = join(outDir, seedRoot);
      mkdirSync(seedDir, { recursive: true });
      const jsonl = result.snapshots.map((s) => JSON.stringify(s)).join("\n") + "\n";
      writeFileSync(join(seedDir, "snapshots.jsonl"), jsonl);

      const last = result.snapshots[result.snapshots.length - 1]!;
      const meta = {
        seedRoot: result.seedRoot,
        ticks,
        chunk,
        survived: result.survived,
        finalAlive: result.finalAlive,
        maxGeneration: result.maxGeneration,
        finalStateHash: result.finalStateHash,
        livingLineages: last.livingLineages,
        finalGoalShares1000: last.goalShares1000,
        finalBuildings: last.buildings,
      };
      writeFileSync(join(seedDir, "meta.json"), JSON.stringify(meta, null, 2));

      console.log(
        `${result.seedRoot.padEnd(13)} ${String(result.survived).padEnd(9)} ${String(result.finalAlive).padEnd(11)} ` +
          `${String(result.maxGeneration).padEnd(7)} ${last.livingLineages}`,
      );
      console.log(`  final goalShares1000: ${JSON.stringify(last.goalShares1000)}`);
    }

    console.log(`\nOutput: ${outDir}`);
  } else {
    console.log("Usage: npm run world2 -- run [--seeds N] [--ticks N] [--chunk N] [--seed-prefix P] [--out DIR]");
  }
}
