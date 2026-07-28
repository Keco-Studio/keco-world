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

/**
 * Default w2 manifest. `overrides` exists for Task 8's calibration sweep: every
 * knob a calibration attempt touches is passed explicitly on the command line
 * and echoed into the run's meta.json, so an attempt row in
 * docs/world2-calibration.md is reproducible from the recorded flags alone
 * rather than from "whatever the defaults were that afternoon".
 */
export function makeW2Manifest(overrides: Partial<W2Manifest> = {}): W2Manifest {
  return {
    schemaVersion: SCHEMA_VERSION_W2,
    gridWidth: GRID,
    gridHeight: GRID,
    seasonLengthTicks: 400,
    firstSummerBonusTicks: 0,
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
    flatGoalsSatietyScaled: 0,
    ...overrides,
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
  /** Number of decisions in THIS chunk's actionLog; the denominator behind
   * verbShares1000/goalShares1000, kept so multi-chunk aggregates (C2's
   * first-10-chunks vs last-10-chunks comparison) can weight chunks by how
   * many decisions they actually contain instead of averaging shares blind. */
  actions: number;
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
  /**
   * Whole-run tally of W2SemanticEvent kinds (births, deaths, wolf_attack,
   * starving, ...). Task 8's brief requires reporting `wolf_attack` frequency
   * alongside C2, and C1 diagnosis needs to know *what* kills a cohort rather
   * than only that it died -- both are counted here instead of reconstructed
   * from the discarded per-chunk event arrays.
   */
  eventCounts: Record<string, number>;
  /** Whole-run tally of `death` events by their recorded cause. */
  deathCauses: Record<string, number>;
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
    actions: totalActions,
    maxGeneration,
    livingLineages,
    verbShares1000,
    goalShares1000,
    buildings,
    siteStock,
    beliefsMaxPerNpc,
  };
}

export function runW2Seed(
  seedRoot: string,
  ticks: number,
  chunk: number,
  manifest: W2Manifest = makeW2Manifest(),
): W2SeedResult {
  if (chunk < 1) throw new Error(`chunk must be >= 1, got ${chunk}`);
  if (ticks < 1) throw new Error(`ticks must be >= 1, got ${ticks}`);

  const roster = makeW2Roster(seedRoot);
  const founderLineageIds = new Set(roster.map((r) => r.npcId));
  let state = createW2InitialState(manifest, roster, seedRoot);
  const snapshots: W2Snapshot[] = [];
  const eventCounts: Record<string, number> = {};
  const deathCauses: Record<string, number> = {};

  let remaining = ticks;
  while (remaining > 0) {
    const thisChunk = Math.min(chunk, remaining);
    const result = runFromState2(state, manifest, seedRoot, { ticks: thisChunk, retainActionLog: true });
    state = result.finalState;
    for (const ev of result.events) {
      eventCounts[ev.kind] = (eventCounts[ev.kind] ?? 0) + 1;
      if (ev.kind === "death") {
        const cause = typeof ev.data.cause === "string" ? ev.data.cause : "unknown";
        deathCauses[cause] = (deathCauses[cause] ?? 0) + 1;
      }
    }
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
    eventCounts,
    deathCauses,
  };
}

/**
 * Decision-weighted mean of one share series over a window of chunks, in
 * per-mille. Chunks differ in population (hence in decision count), so an
 * unweighted mean of per-chunk shares would let a nearly-extinct 3-decision
 * chunk count as much as a full-population one. Chunks with zero decisions
 * contribute nothing (and, if the whole window is empty, the result is 0).
 */
export function weightedShare1000(
  snapshots: W2Snapshot[],
  pick: (s: W2Snapshot) => Record<string, number>,
  key: string,
): number {
  let num = 0;
  let den = 0;
  for (const s of snapshots) {
    num += (pick(s)[key] ?? 0) * s.actions;
    den += s.actions;
  }
  return den === 0 ? 0 : Math.floor(num / den);
}

/** C2 static-share summary for one seed: first-window vs last-window idle. */
export interface W2StaticShare {
  firstIdle1000: number;
  lastIdle1000: number;
  delta1000: number;
  firstRestGoal1000: number;
  lastRestGoal1000: number;
  windowChunks: number;
}

/**
 * Static share = the `idle` VERB share, which is what v1's 611‰ figure counted
 * (see docs/idle-convergence-diagnosis.md §2: "发呆动作 224,560 次（876‰）").
 * The `rest` GOAL is reported separately rather than added to it: `rest` always
 * plans `idle` (src/mind2/planner.ts), so it is a strict subset of the idle
 * verb and summing the two would double-count every rest tick.
 */
export function staticShareOf(snapshots: W2Snapshot[], window: number): W2StaticShare {
  const w = Math.max(1, Math.min(window, snapshots.length));
  const first = snapshots.slice(0, w);
  const last = snapshots.slice(snapshots.length - w);
  const firstIdle1000 = weightedShare1000(first, (s) => s.verbShares1000, "idle");
  const lastIdle1000 = weightedShare1000(last, (s) => s.verbShares1000, "idle");
  return {
    firstIdle1000,
    lastIdle1000,
    delta1000: lastIdle1000 - firstIdle1000,
    firstRestGoal1000: weightedShare1000(first, (s) => s.goalShares1000, "rest"),
    lastRestGoal1000: weightedShare1000(last, (s) => s.goalShares1000, "rest"),
    windowChunks: w,
  };
}

// Guard against CLI execution during test imports
if (process.argv[1]?.endsWith("world2.ts") || process.argv[1]?.endsWith("world2.js")) {
  function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
  }

  const subcommand = process.argv[2];

  // Calibration knobs, in the priority order Task 8's brief fixes them:
  // founderSeededMemory, then first-summer length, then winterColdHpDrain.
  // Defaults reproduce makeW2Manifest() exactly, so omitting all three is the
  // uncalibrated baseline.
  const defaults = makeW2Manifest();
  const knobs: Partial<W2Manifest> = {
    founderSeededMemory: parseInt(arg("founder-memory", String(defaults.founderSeededMemory)), 10),
    firstSummerBonusTicks: parseInt(arg("first-summer-bonus", String(defaults.firstSummerBonusTicks)), 10),
    winterColdHpDrain: parseInt(arg("winter-cold", String(defaults.winterColdHpDrain)), 10),
    wolfDamage: parseInt(arg("wolf-damage", String(defaults.wolfDamage)), 10),
    // Not a calibration knob: a diagnostic probe (see src/mind2/goals.ts).
    flatGoalsSatietyScaled: parseInt(arg("flat-satiety", String(defaults.flatGoalsSatietyScaled)), 10),
  };
  const manifest = makeW2Manifest(knobs);
  const knobLine =
    `founderSeededMemory=${manifest.founderSeededMemory} ` +
    `firstSummerBonusTicks=${manifest.firstSummerBonusTicks} ` +
    `winterColdHpDrain=${manifest.winterColdHpDrain} ` +
    `wolfDamage=${manifest.wolfDamage} ` +
    `flatGoalsSatietyScaled=${manifest.flatGoalsSatietyScaled}`;

  if (subcommand === "run") {
    const seedCount = parseInt(arg("seeds", "3"), 10);
    const ticks = parseInt(arg("ticks", "60000"), 10);
    const chunk = parseInt(arg("chunk", "1000"), 10);
    const window = parseInt(arg("window", "10"), 10);
    const seedPrefix = arg("seed-prefix", "w2");
    const outDir = arg("out", join("runs", "world2"));

    const seedRoots = Array.from({ length: seedCount }, (_, i) => `${seedPrefix}-${i + 1}`);
    console.log(`=== World2 Run: ${seedCount} seeds x ${ticks} ticks (chunk ${chunk}) ===`);
    console.log(`knobs: ${knobLine}`);

    mkdirSync(outDir, { recursive: true });

    console.log("\nseed          survived  finalAlive  maxGen  livingLineages");
    for (const seedRoot of seedRoots) {
      const result = runW2Seed(seedRoot, ticks, chunk, manifest);

      const seedDir = join(outDir, seedRoot);
      mkdirSync(seedDir, { recursive: true });
      const jsonl = result.snapshots.map((s) => JSON.stringify(s)).join("\n") + "\n";
      writeFileSync(join(seedDir, "snapshots.jsonl"), jsonl);

      const last = result.snapshots[result.snapshots.length - 1]!;
      const stat = staticShareOf(result.snapshots, window);
      const meta = {
        seedRoot: result.seedRoot,
        ticks,
        chunk,
        knobs,
        survived: result.survived,
        finalAlive: result.finalAlive,
        maxGeneration: result.maxGeneration,
        finalStateHash: result.finalStateHash,
        livingLineages: last.livingLineages,
        finalGoalShares1000: last.goalShares1000,
        finalBuildings: last.buildings,
        finalSiteStock: last.siteStock,
        staticShare: stat,
        eventCounts: result.eventCounts,
        deathCauses: result.deathCauses,
      };
      writeFileSync(join(seedDir, "meta.json"), JSON.stringify(meta, null, 2));

      console.log(
        `${result.seedRoot.padEnd(13)} ${String(result.survived).padEnd(9)} ${String(result.finalAlive).padEnd(11)} ` +
          `${String(result.maxGeneration).padEnd(7)} ${last.livingLineages}`,
      );
      console.log(`  final goalShares1000: ${JSON.stringify(last.goalShares1000)}`);
      console.log(
        `  idle verb share: first${stat.windowChunks}=${stat.firstIdle1000} last${stat.windowChunks}=${stat.lastIdle1000} ` +
          `delta=${stat.delta1000} | rest goal: ${stat.firstRestGoal1000} -> ${stat.lastRestGoal1000}`,
      );
      console.log(`  buildings: ${JSON.stringify(last.buildings)}  siteStock: ${JSON.stringify(last.siteStock)}`);
      console.log(`  events: ${JSON.stringify(result.eventCounts)}  deaths: ${JSON.stringify(result.deathCauses)}`);
    }

    console.log(`\nOutput: ${outDir}`);
  } else if (subcommand === "calibrate") {
    // C1 first-winter survival gate (Task 8). Runs each seed past the first
    // winter and reads the alive count at `--sample` (default 800 = the first
    // tick of the second summer under the frozen 400-tick rhythm; with
    // --first-summer-bonus B the equivalent sample point is 800 + B, which the
    // caller passes explicitly so the recorded number is unambiguous).
    const seedCount = parseInt(arg("seeds", "12"), 10);
    const ticks = parseInt(arg("ticks", "900"), 10);
    const chunk = parseInt(arg("chunk", "100"), 10);
    const sample = parseInt(arg("sample", "800"), 10);
    const minAlive = parseInt(arg("min-alive", "10"), 10);
    const seedPrefix = arg("seed-prefix", "w2");

    if (sample % chunk !== 0) {
      throw new Error(`--sample ${sample} must be a multiple of --chunk ${chunk} to land on a snapshot boundary`);
    }

    const seedRoots = Array.from({ length: seedCount }, (_, i) => `${seedPrefix}-${i + 1}`);
    console.log(`=== World2 Calibrate: ${seedCount} seeds x ${ticks} ticks, sample @ tick ${sample} ===`);
    console.log(`knobs: ${knobLine}`);
    console.log(`\nseed          alive@${sample}  finalAlive  maxGen  wolfAttacks  deathCauses`);

    let passing = 0;
    const rows: Record<string, unknown>[] = [];
    for (const seedRoot of seedRoots) {
      const result = runW2Seed(seedRoot, ticks, chunk, manifest);
      const at = result.snapshots.find((s) => s.tick === sample);
      // No snapshot at `sample` means the run halted before reaching it, which
      // only happens on extinction -> 0 alive.
      const aliveAtSample = at?.alive ?? 0;
      if (aliveAtSample >= minAlive) passing += 1;
      const wolfAttacks = result.eventCounts["wolf_attack"] ?? 0;
      rows.push({
        seedRoot,
        aliveAtSample,
        finalAlive: result.finalAlive,
        maxGeneration: result.maxGeneration,
        wolfAttacks,
        births: result.eventCounts["birth"] ?? 0,
        buildings: result.snapshots[result.snapshots.length - 1]!.buildings,
        deathCauses: result.deathCauses,
      });
      console.log(
        `${seedRoot.padEnd(13)} ${String(aliveAtSample).padEnd(10)} ${String(result.finalAlive).padEnd(11)} ` +
          `${String(result.maxGeneration).padEnd(7)} ${String(wolfAttacks).padEnd(12)} ${JSON.stringify(result.deathCauses)}`,
      );
      const lastSnap = result.snapshots[result.snapshots.length - 1]!;
      console.log(
        `  buildings: ${JSON.stringify(lastSnap.buildings)}  births: ${result.eventCounts["birth"] ?? 0}` +
          `  goalShares1000: ${JSON.stringify(lastSnap.goalShares1000)}`,
      );
    }

    // Brief's gate is ">= 8 of 12 seeds with >= 10 alive"; kept as a proportion
    // so a smaller --seeds probe reports against the same bar.
    const needed = Math.ceil((seedCount * 8) / 12);
    const verdict = passing >= needed ? "PASS" : "FAIL";
    console.log(`\nC1: ${passing}/${seedCount} seeds with >=${minAlive} alive at tick ${sample} (need >=${needed}) -> ${verdict}`);

    const outDir = arg("out", "");
    if (outDir !== "") {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(
        join(outDir, "calibrate.json"),
        JSON.stringify({ knobs, seedCount, ticks, chunk, sample, minAlive, passing, needed, verdict, rows }, null, 2),
      );
      console.log(`Output: ${outDir}`);
    }
  } else {
    console.log(
      "Usage: npm run world2 -- run [--seeds N] [--ticks N] [--chunk N] [--window N] [--seed-prefix P] [--out DIR]\n" +
        "       npm run world2 -- calibrate [--seeds N] [--ticks N] [--chunk N] [--sample T] [--min-alive N] [--out DIR]\n" +
        "  knobs (both subcommands): [--founder-memory N] [--first-summer-bonus N] [--winter-cold N] [--wolf-damage N]\n" +
        "  diagnostic probe: [--flat-satiety 0|1]  (1 = satiety-scale rest/shelterBuild/granaryBuild; default 0 = frozen v2.1)",
    );
  }
}
