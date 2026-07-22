import type { WorldManifest, RosterEntry, Identity, Policy, Vec2 } from "../schema/core.js";
import { SCHEMA_VERSION } from "../schema/core.js";
import type { WorldState } from "../world/state.js";
import { createInitialState } from "../world/state.js";
import type { Scenario, ScenarioCategory } from "./framework.js";

/**
 * Fixed base manifest for scenario builders. Deliberately NOT imported from tests/helpers.ts —
 * scenarios must not depend on test files. Values mirror makeTestManifest's defaults except
 * seasonLengthTicks (400, so winter-timing scenarios have room to place "N ticks to winter"
 * setups without an unrealistically short season).
 */
export const SCENARIO_MANIFEST_BASE: WorldManifest = {
  schemaVersion: SCHEMA_VERSION,
  cognition: { decisionMode: "utility", inheritanceMode: "breed", beliefDynamics: "on" },
  gridWidth: 16,
  gridHeight: 16,
  seasonLengthTicks: 400,
  energyDrainPerTick: 2,
  starvationHpDrain: 5,
  winterColdHpDrain: 3,
  berryEnergy: 200,
  berryRegrowPpmSummer: 60_000,
  berryRegrowPpmWinter: 5_000,
  wolfDamage: 50,
  hpRegenPerTick: 1,
  hpRegenEnergyMin: 500,
  maxHp: 1000,
  maxEnergy: 1000,
  visionRadius: 8,
  checkpointInterval: 50,
  shelters: [{ x: 2, y: 2 }, { x: 12, y: 12 }],
  bushes: [
    { id: "bush-1", pos: { x: 5, y: 5 }, capacity: 5 },
    { id: "bush-2", pos: { x: 10, y: 3 }, capacity: 5 },
  ],
  wolfStart: { x: 15, y: 15 },
  adultAgeTicks: 100,
  elderAgeTicks: 400,
  senescenceHpDrain: 5,
  reproEnergyMin: 600,
  reproEnergyCost: 200,
  reproCooldownTicks: 150,
  birthChancePpm: 100_000,
  maxPopulation: 40,
  childStartHp: 600,
  childStartEnergy: 600,
};

/** Neutral fixed roster profile for non-focal NPCs (and the focal placeholder before injection). */
const NEUTRAL_IDENTITY: Identity = {
  riskTolerance: 500,
  socialTrust: 500,
  explorationBias: 400,
  patience: 500,
  voiceStyle: "",
};

/** epsilon 0 keeps non-focal NPCs deterministic-argmax; the genome under test replaces the focal anyway. */
const NEUTRAL_POLICY: Policy = {
  utilityWeights: { forage: 600, consume: 800, shelter: 700, seekMate: 500, explore: 200, idle: 50 },
  thresholds: { hungerUrgent: 150 },
  deliberationEpsilon: 0,
};

function neutralRosterEntry(npcId: string, name: string): RosterEntry {
  return {
    npcId,
    name,
    identity: structuredClone(NEUTRAL_IDENTITY),
    policy: structuredClone(NEUTRAL_POLICY),
    beliefs: [],
  };
}

export interface Placement {
  pos: Vec2;
  hp?: number;
  energy?: number;
  berries?: number;
  birthTick?: number;
  reproCooldownUntil?: number;
}

export interface BuildScenarioOpts {
  tick: number; // start tick (season = seasonAt(tick))
  focal: Placement;
  others?: Placement[]; // additional NPCs (fertile adults unless birthTick overridden)
  bushes?: { pos: Vec2; berries: number }[]; // replaces manifest bushes (ids bush-1..n, capacity 5)
  wolfPos?: Vec2; // default far corner {x:15,y:15}
  manifestOverrides?: Partial<WorldManifest>;
}

/** Builder DSL shared by every scenario in the library. Pure: same opts → deep-equal output. */
export function buildScenario(
  opts: BuildScenarioOpts,
): { manifest: WorldManifest; state: WorldState; focalNpcId: string } {
  const others = opts.others ?? [];

  const bushes =
    opts.bushes !== undefined
      ? opts.bushes.map((b, i) => ({ id: `bush-${i + 1}`, pos: { x: b.pos.x, y: b.pos.y }, capacity: 5 }))
      : SCENARIO_MANIFEST_BASE.bushes;
  const wolfStart = opts.wolfPos !== undefined ? { x: opts.wolfPos.x, y: opts.wolfPos.y } : { x: 15, y: 15 };

  const manifest: WorldManifest = {
    ...SCENARIO_MANIFEST_BASE,
    bushes,
    wolfStart,
    ...opts.manifestOverrides,
  };

  const focalNpcId = "focal";
  const roster: RosterEntry[] = [
    neutralRosterEntry(focalNpcId, "Focal"),
    ...others.map((_, i) => neutralRosterEntry(`other-${i + 1}`, `Other ${i + 1}`)),
  ];

  const state = createInitialState(manifest, roster, "scenario-build");
  state.tick = opts.tick;

  if (opts.bushes !== undefined) {
    opts.bushes.forEach((b, i) => {
      state.bushes[i]!.berries = b.berries;
    });
  }

  const applyPlacement = (npcId: string, p: Placement) => {
    const npc = state.npcs.find((n) => n.npcId === npcId);
    if (npc === undefined) throw new Error(`buildScenario: npc ${npcId} not found`);
    npc.pos = { x: p.pos.x, y: p.pos.y };
    if (p.hp !== undefined) npc.hp = p.hp;
    if (p.energy !== undefined) npc.energy = p.energy;
    if (p.berries !== undefined) npc.berries = p.berries;
    npc.birthTick = p.birthTick ?? opts.tick - 250;
    npc.reproCooldownUntil = p.reproCooldownUntil ?? 0;
  };

  applyPlacement(focalNpcId, opts.focal);
  others.forEach((p, i) => applyPlacement(`other-${i + 1}`, p));

  return { manifest, state, focalNpcId };
}

function scenario(
  id: string,
  category: ScenarioCategory,
  title: string,
  horizon: number,
  opts: BuildScenarioOpts,
): Scenario {
  return { id, category, title, horizon, build: () => buildScenario(opts) };
}

/**
 * Scenario library with 31 scenarios across six categories (hunger, winter, predator,
 * courtship, hesitation, sequence). The first 10 ids are frozen test-set identities —
 * do not renumber or reorder the first 10 entries when extending the library.
 *
 * NOTE: H6 was initially dropped to reconcile task-3-brief.md's 21-row table with the
 * hard 30-scenario assertion, but was restored per design doc allowance (30–50 scenarios).
 * H6 is appended at the end rather than inserted after H5 to preserve the frozen first-10
 * test requirement (ids H1-H5, W1-W3, P1-P2 must remain at indices 0-9).
 */
export const SCENARIOS: Scenario[] = [
  scenario("H1", "hunger", "fed near food", 1, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 800 },
    bushes: [{ pos: { x: 6, y: 5 }, berries: 3 }],
  }),
  scenario("H2", "hunger", "hungry near food", 1, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 400 },
    bushes: [{ pos: { x: 6, y: 5 }, berries: 3 }],
  }),
  scenario("H3", "hunger", "starving with pocket food (reflex eat)", 1, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 120, berries: 2 },
    bushes: [{ pos: { x: 6, y: 5 }, berries: 3 }],
  }),
  scenario("H4", "hunger", "hungry, food far", 1, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 400 },
    bushes: [{ pos: { x: 12, y: 5 }, berries: 5 }],
  }),
  scenario("H5", "hunger", "near-empty vs far-full over 20 ticks", 20, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 500 },
    bushes: [
      { pos: { x: 6, y: 5 }, berries: 1 },
      { pos: { x: 12, y: 5 }, berries: 5 },
    ],
  }),
  scenario("W1", "winter", "winter off-shelter, no bushes visible", 1, {
    tick: 450,
    focal: { pos: { x: 8, y: 8 }, energy: 800 },
    bushes: [],
  }),
  scenario("W2", "winter", "already on shelter — stay put?", 1, {
    tick: 450,
    focal: { pos: { x: 2, y: 2 }, energy: 800 },
  }),
  scenario("W3", "winter", "pre-winter tradeoff (10 ticks to winter)", 20, {
    tick: 390,
    focal: { pos: { x: 8, y: 8 }, energy: 600 },
    bushes: [{ pos: { x: 9, y: 8 }, berries: 3 }],
  }),
  scenario("P1", "predator", "reflex flee — wolf adjacent", 1, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 } },
    wolfPos: { x: 6, y: 5 },
  }),
  scenario("P2", "predator", "forage under watch", 1, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 400 },
    bushes: [{ pos: { x: 6, y: 5 }, berries: 3 }],
    wolfPos: { x: 9, y: 5 },
  }),

  // --- Predator (P3-P5) ---
  scenario("P3", "predator", "reflex boundary — wolf at distance two", 1, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 } },
    wolfPos: { x: 7, y: 5 },
  }),
  scenario("P4", "predator", "retreat-and-forage sequence", 20, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 500 },
    bushes: [{ pos: { x: 4, y: 5 }, berries: 3 }],
    wolfPos: { x: 10, y: 5 },
  }),
  scenario("P5", "predator", "winter predator tension", 1, {
    tick: 450,
    focal: { pos: { x: 5, y: 5 }, energy: 700 },
    wolfPos: { x: 9, y: 5 },
  }),

  // --- Courtship (C1-C5) ---
  scenario("C1", "courtship", "courtship approach", 1, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 800, reproCooldownUntil: 0 },
    others: [{ pos: { x: 8, y: 5 } }],
  }),
  scenario("C2", "courtship", "courtship adjacent wait", 1, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 800, reproCooldownUntil: 0 },
    others: [{ pos: { x: 6, y: 5 } }],
  }),
  scenario("C3", "courtship", "courtship suppressed by hunger", 1, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 500, reproCooldownUntil: 0 },
    others: [{ pos: { x: 8, y: 5 } }],
  }),
  scenario("C4", "courtship", "courtship blocked by juvenile", 1, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 800, reproCooldownUntil: 0 },
    others: [{ pos: { x: 8, y: 5 }, birthTick: 10 }],
  }),
  scenario("C5", "courtship", "courtship approach across the map", 30, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 900 },
    others: [{ pos: { x: 12, y: 12 } }],
    bushes: [{ pos: { x: 6, y: 6 }, berries: 2 }],
  }),

  // --- Hesitation (Z1-Z4) ---
  scenario("Z1", "hesitation", "forage, seek-mate, or explore near-tie", 1, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 620 },
    others: [{ pos: { x: 7, y: 7 } }],
    bushes: [{ pos: { x: 7, y: 5 }, berries: 3 }],
  }),
  scenario("Z2", "hesitation", "near-tie at greater distance", 1, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 640 },
    others: [{ pos: { x: 8, y: 8 } }],
    bushes: [{ pos: { x: 8, y: 5 }, berries: 3 }],
  }),
  scenario("Z3", "hesitation", "eat-or-shelter tension", 1, {
    tick: 450,
    focal: { pos: { x: 5, y: 5 }, energy: 640 },
    bushes: [{ pos: { x: 6, y: 5 }, berries: 2 }],
  }),
  scenario("Z4", "hesitation", "consume joins the hesitation band", 1, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 620, berries: 1 },
    others: [{ pos: { x: 7, y: 7 } }],
    bushes: [{ pos: { x: 7, y: 5 }, berries: 3 }],
  }),

  // --- Sequence (S1-S5) ---
  scenario("S1", "sequence", "forced exploration, empty bushes", 40, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 500 },
    bushes: [
      { pos: { x: 5, y: 5 }, berries: 0 },
      { pos: { x: 10, y: 3 }, berries: 0 },
    ],
  }),
  scenario("S2", "sequence", "travel and harvest a bush cluster", 40, {
    tick: 10,
    focal: { pos: { x: 3, y: 3 }, energy: 450 },
    bushes: [
      { pos: { x: 12, y: 12 }, berries: 5 },
      { pos: { x: 13, y: 12 }, berries: 5 },
      { pos: { x: 12, y: 13 }, berries: 5 },
    ],
  }),
  scenario("S3", "sequence", "winter onset during a long run", 40, {
    tick: 380,
    focal: { pos: { x: 10, y: 10 }, energy: 700 },
    bushes: [{ pos: { x: 11, y: 10 }, berries: 2 }],
    manifestOverrides: { shelters: [{ x: 2, y: 2 }] },
  }),
  scenario("S4", "sequence", "risky rich bush vs safe poor bush", 40, {
    tick: 10,
    focal: { pos: { x: 3, y: 3 }, energy: 400 },
    bushes: [
      { pos: { x: 9, y: 9 }, berries: 5 },
      { pos: { x: 2, y: 2 }, berries: 1 },
    ],
    wolfPos: { x: 8, y: 8 },
  }),
  scenario("S5", "sequence", "court then feed cycle", 40, {
    tick: 10,
    focal: { pos: { x: 4, y: 4 }, energy: 900 },
    others: [{ pos: { x: 4, y: 3 }, energy: 900 }],
    bushes: [{ pos: { x: 10, y: 10 }, berries: 3 }],
  }),

  // --- Hunger (H6-H7) ---
  scenario("H7", "hunger", "desperate empty world", 1, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 50, berries: 0 },
    bushes: [],
  }),

  // --- Winter (W4-W5) ---
  scenario("W4", "winter", "hunger vs cold", 1, {
    tick: 450,
    focal: { pos: { x: 6, y: 6 }, energy: 300 },
    bushes: [{ pos: { x: 6, y: 5 }, berries: 3 }],
  }),
  scenario("W5", "winter", "leave shelter to eat?", 20, {
    tick: 430,
    focal: { pos: { x: 2, y: 2 }, energy: 550 },
    bushes: [{ pos: { x: 4, y: 4 }, berries: 3 }],
  }),

  // --- Hunger (H6, appended at end to preserve frozen first-10 ids) ---
  scenario("H6", "hunger", "nearest vs richest bush", 1, {
    tick: 10,
    focal: { pos: { x: 5, y: 5 }, energy: 400 },
    bushes: [
      { pos: { x: 6, y: 5 }, berries: 1 },
      { pos: { x: 7, y: 5 }, berries: 5 },
    ],
  }),
];
