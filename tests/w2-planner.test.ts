import { describe, it, expect } from "vitest";
import { planAction } from "../src/mind2/planner.js";
import type { W2Identity, W2Policy, GoalKey, BuildingKind } from "../src/schema/world2.js";
import { GOAL_KEYS } from "../src/schema/world2.js";
import type { W2NpcState } from "../src/world2/state.js";
import type { W2Observation } from "../src/mind2/observe.js";
import { DIRS } from "../src/mind/utility.js";
import { drawInt } from "../src/rng/rng.js";
import { makeW2TestManifest } from "./w2-helpers.js";

function makeIdentity(overrides: Partial<W2Identity> = {}): W2Identity {
  return { riskTolerance: 500, socialTrust: 500, explorationBias: 400, patience: 500, voiceStyle: "", ...overrides };
}

function makePolicy(overrides: Partial<W2Policy> = {}): W2Policy {
  const goalWeights = Object.fromEntries(GOAL_KEYS.map((k) => [k, 400])) as Record<GoalKey, number>;
  return {
    goalWeights,
    thresholds: { hungerUrgent: 150 },
    deliberationEpsilon: 60,
    commitmentThreshold: 150,
    ...overrides,
  };
}

function makeNpc(overrides: Partial<W2NpcState> = {}): W2NpcState {
  return {
    npcId: "npc-1",
    name: "Test",
    pos: { x: 10, y: 10 },
    hp: 1000,
    energy: 1000,
    carry: { berry: 0, wood: 0, stone: 0, gold: 0 },
    alive: true,
    deathTick: null,
    deathCause: null,
    lastDamage: null,
    identity: makeIdentity(),
    policy: makePolicy(),
    beliefs: [],
    memory: [],
    goal: null,
    birthTick: -1000,
    generation: 0,
    lineageId: "npc-1",
    parents: null,
    reproCooldownUntil: 0,
    genomeHash: "hash",
    ...overrides,
  };
}

function makeObs(overrides: Partial<W2Observation> = {}): W2Observation {
  const pos = overrides.self?.pos ?? { x: 10, y: 10 };
  return {
    tick: 100,
    season: "summer",
    onShelter: false,
    self: {
      npcId: "npc-1",
      pos,
      hp: 1000,
      energy: 1000,
      carry: { berry: 0, wood: 0, stone: 0, gold: 0 },
      reproReady: false,
      lineageId: "npc-1",
    },
    visibleNpcs: [],
    visibleSites: [],
    visibleBuildings: [],
    wolf: null,
    ...overrides,
  };
}

function granaryBuilding(overrides: Partial<W2Observation["visibleBuildings"][number]> = {}) {
  return {
    id: "gr-1",
    kind: "granary" as BuildingKind,
    pos: { x: 10, y: 10 },
    ownerLineageId: "npc-1",
    storeBerry: 5,
    dist: 0,
    ...overrides,
  };
}

const manifest = makeW2TestManifest();
const SEED = "planner-test";

describe("planAction: eat", () => {
  it("consumes when carrying berries, regardless of anything else", () => {
    const npc = makeNpc({ carry: { berry: 2, wood: 0, stone: 0, gold: 0 } });
    const obs = makeObs({ self: { ...makeObs().self, carry: { berry: 2, wood: 0, stone: 0, gold: 0 } } });
    expect(planAction("eat", obs, npc, manifest, SEED)).toEqual({ verb: "consume" });
  });

  it("withdraws from the own-lineage granary when standing on it with berries in store", () => {
    const npc = makeNpc();
    const obs = makeObs({ visibleBuildings: [granaryBuilding({ storeBerry: 5 })] });
    expect(planAction("eat", obs, npc, manifest, SEED)).toEqual({ verb: "withdraw", buildingId: "gr-1" });
  });

  it("does not withdraw from an empty granary; falls through to gathering", () => {
    const npc = makeNpc({
      memory: [{ kind: "berry", pos: { x: 11, y: 10 }, lastStock: 3, seenTick: 0 }],
    });
    const obs = makeObs({
      visibleBuildings: [granaryBuilding({ storeBerry: 0 })],
      visibleSites: [{ id: "berry-0-0", kind: "berry", pos: { x: 11, y: 10 }, stock: 3, dist: 1 }],
    });
    expect(planAction("eat", obs, npc, manifest, SEED)).toEqual({ verb: "gather", siteId: "berry-0-0" });
  });

  it("gathers the nearest remembered berry site when adjacent", () => {
    const npc = makeNpc({
      memory: [{ kind: "berry", pos: { x: 11, y: 10 }, lastStock: 3, seenTick: 0 }],
    });
    const obs = makeObs({
      visibleSites: [{ id: "berry-0-0", kind: "berry", pos: { x: 11, y: 10 }, stock: 3, dist: 1 }],
    });
    expect(planAction("eat", obs, npc, manifest, SEED)).toEqual({ verb: "gather", siteId: "berry-0-0" });
  });

  it("moves toward the nearest remembered berry site when not adjacent (diagonal sign step)", () => {
    const npc = makeNpc({
      memory: [{ kind: "berry", pos: { x: 13, y: 10 }, lastStock: 3, seenTick: 0 }],
    });
    const obs = makeObs();
    expect(planAction("eat", obs, npc, manifest, SEED)).toEqual({ verb: "move", to: { x: 11, y: 10 } });
  });

  it("picks the nearest remembered site, tie-broken by pos.x then pos.y, and skips lastStock===0 entries", () => {
    const npc = makeNpc({
      memory: [
        { kind: "berry", pos: { x: 10, y: 10 }, lastStock: 0, seenTick: 0 }, // depleted, skipped
        { kind: "berry", pos: { x: 12, y: 9 }, lastStock: 1, seenTick: 0 }, // dist 2, x=12
        { kind: "berry", pos: { x: 9, y: 12 }, lastStock: 1, seenTick: 0 }, // dist 2, x=9 (wins tie: lower x)
      ],
    });
    const obs = makeObs();
    expect(planAction("eat", obs, npc, manifest, SEED)).toEqual({ verb: "move", to: { x: 9, y: 11 } });
  });

  it("takes a deterministic exploration step when memory has nothing usable", () => {
    const npc = makeNpc({ memory: [] });
    const obs = makeObs({ tick: 250 });
    const result = planAction("eat", obs, npc, manifest, SEED);
    const dir = DIRS[drawInt(SEED, 8, "w2-explore", "npc-1", 250)]!;
    const to = { x: 10 + dir.x, y: 10 + dir.y };
    const inBounds = to.x >= 0 && to.x < manifest.gridWidth && to.y >= 0 && to.y < manifest.gridHeight;
    expect(result).toEqual(inBounds ? { verb: "move", to } : { verb: "idle" });
    // determinism: repeated call yields identical result
    expect(planAction("eat", obs, npc, manifest, SEED)).toEqual(result);
  });

  it("explore step idles when it would leave the grid", () => {
    const npc = makeNpc({ pos: { x: 0, y: 0 }, memory: [] });
    const obs = makeObs({ self: { ...makeObs().self, pos: { x: 0, y: 0 } }, tick: 0 });
    // find a tick where the drawn direction actually leaves the grid from (0,0)
    let tick = 0;
    let dir = DIRS[drawInt(SEED, 8, "w2-explore", "npc-1", tick)]!;
    while (0 + dir.x >= 0 && 0 + dir.y >= 0) {
      tick++;
      dir = DIRS[drawInt(SEED, 8, "w2-explore", "npc-1", tick)]!;
    }
    const result = planAction("eat", { ...obs, tick }, npc, manifest, SEED);
    expect(result).toEqual({ verb: "idle" });
  });
});

describe("planAction: stockpile", () => {
  it("gathers berries (eat's acquisition path) while under CARRY_CAP", () => {
    const npc = makeNpc({
      memory: [{ kind: "berry", pos: { x: 11, y: 10 }, lastStock: 3, seenTick: 0 }],
    });
    const obs = makeObs({
      visibleSites: [{ id: "berry-0-0", kind: "berry", pos: { x: 11, y: 10 }, stock: 3, dist: 1 }],
    });
    expect(planAction("stockpile", obs, npc, manifest, SEED)).toEqual({ verb: "gather", siteId: "berry-0-0" });
  });

  it("deposits when the bag is full and standing on the own-lineage granary", () => {
    const npc = makeNpc({ carry: { berry: 10, wood: 0, stone: 0, gold: 0 } });
    const obs = makeObs({
      self: { ...makeObs().self, carry: { berry: 10, wood: 0, stone: 0, gold: 0 } },
      visibleBuildings: [granaryBuilding()],
    });
    expect(planAction("stockpile", obs, npc, manifest, SEED)).toEqual({ verb: "deposit", buildingId: "gr-1" });
  });

  it("moves toward the remembered granary when the bag is full and not there yet", () => {
    const npc = makeNpc({
      carry: { berry: 10, wood: 0, stone: 0, gold: 0 },
      memory: [{ kind: "granary", pos: { x: 13, y: 10 }, lastStock: 1, seenTick: 0 }],
    });
    const obs = makeObs({ self: { ...makeObs().self, carry: { berry: 10, wood: 0, stone: 0, gold: 0 } } });
    expect(planAction("stockpile", obs, npc, manifest, SEED)).toEqual({ verb: "move", to: { x: 11, y: 10 } });
  });

  it("explores when the bag is full and no granary is remembered or visible", () => {
    const npc = makeNpc({ carry: { berry: 10, wood: 0, stone: 0, gold: 0 }, memory: [] });
    const obs = makeObs({ self: { ...makeObs().self, carry: { berry: 10, wood: 0, stone: 0, gold: 0 } }, tick: 77 });
    const dir = DIRS[drawInt(SEED, 8, "w2-explore", "npc-1", 77)]!;
    const to = { x: 10 + dir.x, y: 10 + dir.y };
    const inBounds = to.x >= 0 && to.x < manifest.gridWidth && to.y >= 0 && to.y < manifest.gridHeight;
    expect(planAction("stockpile", obs, npc, manifest, SEED)).toEqual(
      inBounds ? { verb: "move", to } : { verb: "idle" },
    );
  });
});

describe("planAction: takeShelter", () => {
  it("idles when already on a shelter", () => {
    const npc = makeNpc({ memory: [{ kind: "shelter", pos: { x: 20, y: 20 }, lastStock: 1, seenTick: 0 }] });
    const obs = makeObs({ onShelter: true });
    expect(planAction("takeShelter", obs, npc, manifest, SEED)).toEqual({ verb: "idle" });
  });

  it("moves toward the nearest remembered shelter otherwise", () => {
    const npc = makeNpc({ memory: [{ kind: "shelter", pos: { x: 12, y: 10 }, lastStock: 1, seenTick: 0 }] });
    const obs = makeObs({ onShelter: false });
    expect(planAction("takeShelter", obs, npc, manifest, SEED)).toEqual({ verb: "move", to: { x: 11, y: 10 } });
  });

  it("explores when not on shelter and none is remembered", () => {
    const npc = makeNpc({ memory: [] });
    const obs = makeObs({ onShelter: false, tick: 33 });
    const dir = DIRS[drawInt(SEED, 8, "w2-explore", "npc-1", 33)]!;
    const to = { x: 10 + dir.x, y: 10 + dir.y };
    const inBounds = to.x >= 0 && to.x < manifest.gridWidth && to.y >= 0 && to.y < manifest.gridHeight;
    expect(planAction("takeShelter", obs, npc, manifest, SEED)).toEqual(
      inBounds ? { verb: "move", to } : { verb: "idle" },
    );
  });
});

describe("planAction: rest", () => {
  it("always idles", () => {
    const npc = makeNpc();
    expect(planAction("rest", makeObs(), npc, manifest, SEED)).toEqual({ verb: "idle" });
  });
});

describe("planAction: build goals (shelterBuild / granaryBuild / monumentBuild)", () => {
  it("gathers the resource with the largest recipe gap", () => {
    // granaryBuild recipe: wood:6, stone:4. carry wood:5 (gap1), stone:0 (gap4) -> stone wins.
    const npc = makeNpc({
      carry: { berry: 0, wood: 5, stone: 0, gold: 0 },
      memory: [{ kind: "stone", pos: { x: 11, y: 10 }, lastStock: 5, seenTick: 0 }],
    });
    const obs = makeObs({
      visibleSites: [{ id: "stone-0-0", kind: "stone", pos: { x: 11, y: 10 }, stock: 5, dist: 1 }],
    });
    expect(planAction("granaryBuild", obs, npc, manifest, SEED)).toEqual({ verb: "gather", siteId: "stone-0-0" });
  });

  it("breaks a tied gap by RESOURCE_KINDS order (wood before stone)", () => {
    // granaryBuild recipe: wood:6, stone:4. carry wood:2 (gap4), stone:0 (gap4) -> tie -> wood (earlier in RESOURCE_KINDS).
    const npc = makeNpc({
      carry: { berry: 0, wood: 2, stone: 0, gold: 0 },
      memory: [
        { kind: "wood", pos: { x: 11, y: 10 }, lastStock: 5, seenTick: 0 },
        { kind: "stone", pos: { x: 9, y: 10 }, lastStock: 5, seenTick: 0 },
      ],
    });
    const obs = makeObs({
      visibleSites: [
        { id: "wood-0-0", kind: "wood", pos: { x: 11, y: 10 }, stock: 5, dist: 1 },
        { id: "stone-0-0", kind: "stone", pos: { x: 9, y: 10 }, stock: 5, dist: 1 },
      ],
    });
    expect(planAction("granaryBuild", obs, npc, manifest, SEED)).toEqual({ verb: "gather", siteId: "wood-0-0" });
  });

  it("builds once the recipe is fully covered and the current tile has no building", () => {
    const npc = makeNpc({ carry: { berry: 0, wood: 4, stone: 2, gold: 0 } });
    const obs = makeObs({ self: { ...makeObs().self, carry: { berry: 0, wood: 4, stone: 2, gold: 0 } } });
    expect(planAction("shelterBuild", obs, npc, manifest, SEED)).toEqual({ verb: "build", kind: "shelter" });
  });

  it("moves to the nearest building-free adjacent tile (DIRS order) when the current tile is occupied", () => {
    const pos = { x: 5, y: 5 };
    const npc = makeNpc({ pos, carry: { berry: 0, wood: 4, stone: 2, gold: 0 } });
    // Occupy the current tile and the first two DIRS-order neighbors: (5,4) and (6,4).
    const obs = makeObs({
      self: { ...makeObs().self, pos, carry: { berry: 0, wood: 4, stone: 2, gold: 0 } },
      visibleBuildings: [
        { id: "b-here", kind: "shelter", pos: { x: 5, y: 5 }, ownerLineageId: "x", storeBerry: 0, dist: 0 },
        { id: "b-n", kind: "shelter", pos: { x: 5, y: 4 }, ownerLineageId: "x", storeBerry: 0, dist: 1 },
        { id: "b-ne", kind: "shelter", pos: { x: 6, y: 4 }, ownerLineageId: "x", storeBerry: 0, dist: 1 },
      ],
    });
    expect(planAction("shelterBuild", obs, npc, manifest, SEED)).toEqual({ verb: "move", to: { x: 6, y: 5 } });
  });

  it("idles when the current tile and all eight neighbors are occupied", () => {
    const pos = { x: 5, y: 5 };
    const npc = makeNpc({ pos, carry: { berry: 0, wood: 4, stone: 2, gold: 0 } });
    const buildings = [{ x: 5, y: 5 }, ...DIRS.map((d) => ({ x: pos.x + d.x, y: pos.y + d.y }))].map((p, i) => ({
      id: `b-${i}`,
      kind: "shelter" as BuildingKind,
      pos: p,
      ownerLineageId: "x",
      storeBerry: 0,
      dist: i === 0 ? 0 : 1,
    }));
    const obs = makeObs({
      self: { ...makeObs().self, pos, carry: { berry: 0, wood: 4, stone: 2, gold: 0 } },
      visibleBuildings: buildings,
    });
    expect(planAction("shelterBuild", obs, npc, manifest, SEED)).toEqual({ verb: "idle" });
  });

  it("explores toward the required resource when nothing is remembered", () => {
    const npc = makeNpc({ carry: { berry: 0, wood: 0, stone: 0, gold: 0 }, memory: [] });
    const obs = makeObs({ tick: 5 });
    const dir = DIRS[drawInt(SEED, 8, "w2-explore", "npc-1", 5)]!;
    const to = { x: 10 + dir.x, y: 10 + dir.y };
    const inBounds = to.x >= 0 && to.x < manifest.gridWidth && to.y >= 0 && to.y < manifest.gridHeight;
    expect(planAction("shelterBuild", obs, npc, manifest, SEED)).toEqual(
      inBounds ? { verb: "move", to } : { verb: "idle" },
    );
  });

  it("monumentBuild uses the gold/stone recipe", () => {
    const npc = makeNpc({
      carry: { berry: 0, wood: 0, stone: 8, gold: 0 },
      memory: [{ kind: "gold", pos: { x: 11, y: 10 }, lastStock: 2, seenTick: 0 }],
    });
    const obs = makeObs({
      visibleSites: [{ id: "gold-0-0", kind: "gold", pos: { x: 11, y: 10 }, stock: 2, dist: 1 }],
    });
    expect(planAction("monumentBuild", obs, npc, manifest, SEED)).toEqual({ verb: "gather", siteId: "gold-0-0" });
  });
});
