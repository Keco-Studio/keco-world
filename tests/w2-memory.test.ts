import { describe, it, expect } from "vitest";
import type { MemoryEntry } from "../src/schema/world2.js";
import { MEMORY_CAP, MEMORY_INHERIT_MAX, MEMORY_MISREMEMBER_PPM, GRID } from "../src/schema/world2.js";
import { createW2InitialState } from "../src/world2/state.js";
import { updateMemory } from "../src/mind2/memory.js";
import { inheritMemory } from "../src/mind2/memory.js";
import type { W2Observation } from "../src/mind2/observe.js";
import { drawInt } from "../src/rng/rng.js";
import { makeW2TestManifest, makeW2TestRoster } from "./w2-helpers.js";

function makeNpc() {
  const manifest = makeW2TestManifest();
  const state = createW2InitialState(manifest, makeW2TestRoster("mem-npc"), "mem-npc");
  const npc = state.npcs[0]!;
  npc.memory = [];
  return npc;
}

function baseObs(overrides: Partial<W2Observation>): W2Observation {
  return {
    tick: 0,
    season: "summer",
    onShelter: false,
    self: {
      npcId: "npc-1",
      pos: { x: 0, y: 0 },
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

describe("updateMemory", () => {
  it("refreshes an existing entry with the same pos and kind instead of duplicating it", () => {
    const npc = makeNpc();
    npc.memory = [{ kind: "berry", pos: { x: 5, y: 5 }, lastStock: 2, seenTick: 10, ownerLineageId: null }];
    const obs = baseObs({
      tick: 20,
      visibleSites: [{ id: "berry-9-0", kind: "berry", pos: { x: 5, y: 5 }, stock: 9, dist: 0 }],
    });
    updateMemory(npc, obs);
    expect(npc.memory.length).toBe(1);
    expect(npc.memory[0]).toEqual({
      kind: "berry",
      pos: { x: 5, y: 5 },
      lastStock: 9,
      seenTick: 20,
      ownerLineageId: null,
    });
  });

  it("refreshes a building entry, always with lastStock = 1, and updates ownerLineageId", () => {
    const npc = makeNpc();
    npc.memory = [
      { kind: "granary", pos: { x: 3, y: 3 }, lastStock: 1, seenTick: 5, ownerLineageId: "npc-1" },
    ];
    const obs = baseObs({
      tick: 30,
      visibleBuildings: [
        { id: "b-1-npc-1", kind: "granary", pos: { x: 3, y: 3 }, ownerLineageId: "npc-1", storeBerry: 40, dist: 0 },
      ],
    });
    updateMemory(npc, obs);
    expect(npc.memory.length).toBe(1);
    expect(npc.memory[0]).toEqual({
      kind: "granary",
      pos: { x: 3, y: 3 },
      lastStock: 1,
      seenTick: 30,
      ownerLineageId: "npc-1",
    });
  });

  it("does not duplicate when a different-kind entry occupies the same pos", () => {
    const npc = makeNpc();
    npc.memory = [{ kind: "berry", pos: { x: 5, y: 5 }, lastStock: 2, seenTick: 10, ownerLineageId: null }];
    const obs = baseObs({
      tick: 20,
      // same pos, different kind (a building was built where a site once stood, e.g.) -> distinct entry
      visibleBuildings: [
        { id: "b-1-npc-1", kind: "shelter", pos: { x: 5, y: 5 }, ownerLineageId: "npc-1", storeBerry: 0, dist: 0 },
      ],
    });
    updateMemory(npc, obs);
    expect(npc.memory.length).toBe(2);
  });

  it("evicts the oldest (smallest seenTick) entries once above MEMORY_CAP, deterministically", () => {
    function run(): MemoryEntry[] {
      const npc = makeNpc();
      for (let t = 1; t <= 15; t++) {
        const obs = baseObs({
          tick: t,
          visibleSites: [{ id: `site-${t}`, kind: "berry", pos: { x: t, y: t }, stock: t, dist: 0 }],
        });
        updateMemory(npc, obs);
      }
      return npc.memory;
    }
    const first = run();
    const second = run();
    expect(first).toEqual(second); // deterministic
    expect(first.length).toBe(MEMORY_CAP);
    // Entries for ticks 1..3 should have been evicted; 4..15 should survive.
    const seenTicks = first.map((e) => e.seenTick).sort((a, b) => a - b);
    expect(seenTicks).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it("breaks eviction ties by pos.x, then pos.y, then kind (UTF-16), deterministically", () => {
    function run(): MemoryEntry[] {
      const npc = makeNpc();
      // 13 entries, all sharing the same seenTick so eviction must fall back to tie-break rules.
      const obs = baseObs({
        tick: 7,
        visibleSites: [
          { id: "s-a", kind: "berry", pos: { x: 9, y: 1 }, stock: 1, dist: 0 },
          { id: "s-b", kind: "berry", pos: { x: 1, y: 9 }, stock: 1, dist: 0 },
          { id: "s-c", kind: "berry", pos: { x: 1, y: 1 }, stock: 1, dist: 0 },
          { id: "s-d", kind: "gold", pos: { x: 1, y: 1 }, stock: 1, dist: 0 },
          { id: "s-e", kind: "stone", pos: { x: 1, y: 1 }, stock: 1, dist: 0 },
          { id: "s-f", kind: "wood", pos: { x: 2, y: 2 }, stock: 1, dist: 0 },
          { id: "s-g", kind: "berry", pos: { x: 3, y: 3 }, stock: 1, dist: 0 },
          { id: "s-h", kind: "berry", pos: { x: 4, y: 4 }, stock: 1, dist: 0 },
          { id: "s-i", kind: "berry", pos: { x: 5, y: 5 }, stock: 1, dist: 0 },
          { id: "s-j", kind: "berry", pos: { x: 6, y: 6 }, stock: 1, dist: 0 },
          { id: "s-k", kind: "berry", pos: { x: 7, y: 7 }, stock: 1, dist: 0 },
          { id: "s-l", kind: "berry", pos: { x: 8, y: 8 }, stock: 1, dist: 0 },
          { id: "s-m", kind: "berry", pos: { x: 10, y: 10 }, stock: 1, dist: 0 },
        ],
      });
      updateMemory(npc, obs);
      return npc.memory;
    }
    const first = run();
    const second = run();
    expect(first).toEqual(second);
    expect(first.length).toBe(MEMORY_CAP);
    // Among all 13 tied-seenTick entries, the smallest by (pos.x, pos.y, kind) is
    // (x=1, y=1, kind="berry") -- "berry" < "gold" < "stone" in UTF-16 -- so it is evicted first.
    expect(first.some((e) => e.kind === "berry" && e.pos.x === 1 && e.pos.y === 1)).toBe(false);
    expect(first.some((e) => e.kind === "gold" && e.pos.x === 1 && e.pos.y === 1)).toBe(true);
    expect(first.some((e) => e.kind === "stone" && e.pos.x === 1 && e.pos.y === 1)).toBe(true);
  });
});

describe("inheritMemory", () => {
  const seedRoot = "inherit-seed";

  function makeParentMemory(n: number): MemoryEntry[] {
    return Array.from({ length: n }, (_, i) => ({
      kind: "berry" as const,
      pos: { x: 10 + i, y: 20 + i },
      lastStock: i,
      seenTick: i, // strictly increasing, so ranking by seenTick is unambiguous
      ownerLineageId: null,
    }));
  }

  it("is deterministic for the same inputs", () => {
    const parent = makeParentMemory(10);
    const a = inheritMemory(parent, "child-x", seedRoot, 500);
    const b = inheritMemory(parent, "child-x", seedRoot, 500);
    expect(a).toEqual(b);
  });

  it("caps the returned count at MEMORY_INHERIT_MAX and selects the entries with the largest seenTick", () => {
    const parent = makeParentMemory(10); // seenTick 0..9
    const result = inheritMemory(parent, "child-y", seedRoot, 900);
    expect(result.length).toBe(MEMORY_INHERIT_MAX);
    // Expected originals: seenTick 9,8,7,6,5,4 (lastStock doubles as identity here).
    const expectedLastStocks = [9, 8, 7, 6, 5, 4];
    expect(result.map((e) => e.lastStock)).toEqual(expectedLastStocks);
    // Every returned entry's seenTick is reset to the child's birth tick.
    expect(result.every((e) => e.seenTick === 900)).toBe(true);
  });

  it("returns all entries when parentMemory has fewer than MEMORY_INHERIT_MAX", () => {
    const parent = makeParentMemory(3);
    const result = inheritMemory(parent, "child-z", seedRoot, 42);
    expect(result.length).toBe(3);
  });

  it("returns an empty array for empty parentMemory", () => {
    expect(inheritMemory([], "child-empty", seedRoot, 1)).toEqual([]);
  });

  it("preserves ownerLineageId through inheritance (untouched by misremembering, which only jitters position)", () => {
    const parent: MemoryEntry[] = [
      { kind: "granary", pos: { x: 15, y: 15 }, lastStock: 1, seenTick: 5, ownerLineageId: "lineage-a" },
      { kind: "berry", pos: { x: 16, y: 16 }, lastStock: 3, seenTick: 4, ownerLineageId: null },
    ];
    const result = inheritMemory(parent, "child-owner", seedRoot, 100);
    const granaryEntry = result.find((e) => e.kind === "granary");
    const berryEntry = result.find((e) => e.kind === "berry");
    expect(granaryEntry?.ownerLineageId).toBe("lineage-a");
    expect(berryEntry?.ownerLineageId).toBeNull();
  });

  it("misremember rate is within 8%-12% over 2000 samples, jitter never exceeds +/-2 and stays in bounds, non-misremembered entries are preserved byte-for-byte", () => {
    const original: MemoryEntry = {
      kind: "wood",
      pos: { x: 30, y: 30 },
      lastStock: 4,
      seenTick: 0,
      ownerLineageId: null,
    };
    const N = 2000;
    let misrememberedCount = 0;
    let sawExactPreservationCheck = false;

    for (let s = 0; s < N; s++) {
      const childKey = `sample-${s}`;
      const parent = [original];
      const [result] = inheritMemory(parent, childKey, seedRoot, 7);
      expect(result).toBeDefined();

      const expectedMisremember =
        drawInt(seedRoot, 1_000_000, "mem-mis", childKey, 0) < MEMORY_MISREMEMBER_PPM;

      if (expectedMisremember) {
        misrememberedCount++;
        // jitter never exceeds +/-2 (from the un-jittered original position)
        expect(Math.abs(result!.pos.x - original.pos.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(result!.pos.y - original.pos.y)).toBeLessThanOrEqual(2);
      } else {
        // non-misremembered entries preserved exactly, byte-for-byte
        expect(result!.pos.x).toBe(original.pos.x);
        expect(result!.pos.y).toBe(original.pos.y);
        sawExactPreservationCheck = true;
      }
      // never out of bounds
      expect(result!.pos.x).toBeGreaterThanOrEqual(0);
      expect(result!.pos.x).toBeLessThan(GRID);
      expect(result!.pos.y).toBeGreaterThanOrEqual(0);
      expect(result!.pos.y).toBeLessThan(GRID);
    }

    const rate = misrememberedCount / N;
    expect(rate).toBeGreaterThan(0.08);
    expect(rate).toBeLessThan(0.12);
    expect(sawExactPreservationCheck).toBe(true);
  });

  it("clamps jittered positions to [0, GRID-1] near the grid edges", () => {
    const corners: MemoryEntry[] = [
      { kind: "stone", pos: { x: 0, y: 0 }, lastStock: 1, seenTick: 0, ownerLineageId: null },
      { kind: "gold", pos: { x: GRID - 1, y: GRID - 1 }, lastStock: 1, seenTick: 0, ownerLineageId: null },
    ];
    for (let s = 0; s < 500; s++) {
      const childKey = `corner-${s}`;
      const results = inheritMemory(corners, childKey, seedRoot, 1);
      for (const r of results) {
        expect(r.pos.x).toBeGreaterThanOrEqual(0);
        expect(r.pos.x).toBeLessThan(GRID);
        expect(r.pos.y).toBeGreaterThanOrEqual(0);
        expect(r.pos.y).toBeLessThan(GRID);
      }
    }
  });
});
