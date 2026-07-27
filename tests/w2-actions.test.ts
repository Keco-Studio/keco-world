import { describe, it, expect } from "vitest";
import { applyAction2 } from "../src/world2/actions.js";
import { createW2InitialState, carryTotal } from "../src/world2/state.js";
import { CARRY_CAP, GRANARY_CAP, GRID } from "../src/schema/world2.js";
import type { Site, Building } from "../src/schema/world2.js";
import { makeW2TestManifest, makeW2TestRoster } from "./w2-helpers.js";

const manifest = makeW2TestManifest();

function fresh() {
  const s = createW2InitialState(manifest, makeW2TestRoster("act-test"), "act-test");
  const npc = s.npcs[0]!;
  // Pin to a known, non-edge position so adjacency/bounds math is easy to reason about.
  npc.pos = { x: 10, y: 10 };
  return { s, npc };
}

function berrySite(overrides: Partial<Site> = {}): Site {
  return {
    id: "test-berry",
    kind: "berry",
    pos: { x: 10, y: 10 },
    stock: 5,
    capacity: 5,
    regrowPpmSummer: 0,
    regrowPpmWinter: 0,
    ...overrides,
  };
}

function woodSite(overrides: Partial<Site> = {}): Site {
  return {
    id: "test-wood",
    kind: "wood",
    pos: { x: 10, y: 10 },
    stock: 5,
    capacity: 8,
    regrowPpmSummer: 0,
    regrowPpmWinter: 0,
    ...overrides,
  };
}

function granaryAt(lineageId: string, storeBerry: number, overrides: Partial<Building> = {}): Building {
  return {
    id: "test-granary",
    kind: "granary",
    pos: { x: 10, y: 10 },
    ownerNpcId: "owner",
    ownerLineageId: lineageId,
    builtTick: 0,
    store: { berry: storeBerry, wood: 0, stone: 0, gold: 0 },
    ...overrides,
  };
}

describe("applyAction2", () => {
  describe("move", () => {
    it("legal: adjacent in-bounds move succeeds", () => {
      const { s, npc } = fresh();
      expect(applyAction2(s, manifest, npc, { verb: "move", to: { x: 11, y: 11 } })).toBe(true);
      expect(npc.pos).toEqual({ x: 11, y: 11 });
    });
    it("illegal: out-of-bounds destination", () => {
      const { s } = fresh();
      const npc = s.npcs[0]!;
      npc.pos = { x: 0, y: 0 };
      expect(applyAction2(s, manifest, npc, { verb: "move", to: { x: -1, y: 0 } })).toBe(false);
      expect(npc.pos).toEqual({ x: 0, y: 0 });
    });
    it("illegal: destination beyond grid on the far edge", () => {
      const { s } = fresh();
      const npc = s.npcs[0]!;
      npc.pos = { x: GRID - 1, y: GRID - 1 };
      expect(applyAction2(s, manifest, npc, { verb: "move", to: { x: GRID, y: GRID - 1 } })).toBe(false);
    });
    it("illegal: distance > 1 (teleport)", () => {
      const { s, npc } = fresh();
      expect(applyAction2(s, manifest, npc, { verb: "move", to: { x: 15, y: 15 } })).toBe(false);
      expect(npc.pos).toEqual({ x: 10, y: 10 });
    });
  });

  describe("gather", () => {
    it("legal: adjacent site with stock, room in carry", () => {
      const { s, npc } = fresh();
      const site = berrySite();
      s.sites.push(site);
      expect(applyAction2(s, manifest, npc, { verb: "gather", siteId: site.id })).toBe(true);
      expect(s.sites.find((x) => x.id === site.id)!.stock).toBe(4);
      expect(npc.carry.berry).toBe(1);
    });
    it("illegal: carry already at CARRY_CAP", () => {
      const { s, npc } = fresh();
      const site = berrySite();
      s.sites.push(site);
      npc.carry = { berry: CARRY_CAP, wood: 0, stone: 0, gold: 0 };
      expect(applyAction2(s, manifest, npc, { verb: "gather", siteId: site.id })).toBe(false);
      expect(s.sites.find((x) => x.id === site.id)!.stock).toBe(5);
      expect(npc.carry.berry).toBe(CARRY_CAP);
    });
    it("illegal: distance > 1 from site", () => {
      const { s, npc } = fresh();
      const site = berrySite({ pos: { x: 20, y: 10 } });
      s.sites.push(site);
      expect(applyAction2(s, manifest, npc, { verb: "gather", siteId: site.id })).toBe(false);
      expect(npc.carry.berry).toBe(0);
    });
    it("illegal: site has zero stock", () => {
      const { s, npc } = fresh();
      const site = berrySite({ stock: 0 });
      s.sites.push(site);
      expect(applyAction2(s, manifest, npc, { verb: "gather", siteId: site.id })).toBe(false);
    });
    it("illegal: unknown siteId", () => {
      const { s, npc } = fresh();
      expect(applyAction2(s, manifest, npc, { verb: "gather", siteId: "nope" })).toBe(false);
    });
  });

  describe("consume", () => {
    it("legal: eats a berry up to maxEnergy cap", () => {
      const { s, npc } = fresh();
      npc.carry.berry = 2;
      npc.energy = manifest.maxEnergy - 50;
      expect(applyAction2(s, manifest, npc, { verb: "consume" })).toBe(true);
      expect(npc.carry.berry).toBe(1);
      expect(npc.energy).toBe(manifest.maxEnergy);
    });
    it("illegal: no berries carried", () => {
      const { s, npc } = fresh();
      npc.carry.berry = 0;
      expect(applyAction2(s, manifest, npc, { verb: "consume" })).toBe(false);
    });
  });

  describe("build", () => {
    it("illegal: carry does not cover the full recipe", () => {
      const { s, npc } = fresh();
      npc.carry = { berry: 0, wood: 3, stone: 2, gold: 0 }; // shelter needs wood:4, stone:2
      expect(applyAction2(s, manifest, npc, { verb: "build", kind: "shelter" })).toBe(false);
      expect(s.buildings.length).toBe(0);
      expect(npc.carry.wood).toBe(3);
    });
    it("legal: build succeeds, deducts materials, places building with correct ownership", () => {
      const { s, npc } = fresh();
      npc.carry = { berry: 0, wood: 4, stone: 2, gold: 0 };
      s.tick = 42;
      expect(applyAction2(s, manifest, npc, { verb: "build", kind: "shelter" })).toBe(true);
      expect(npc.carry).toEqual({ berry: 0, wood: 0, stone: 0, gold: 0 });
      expect(s.buildings.length).toBe(1);
      const b = s.buildings[0]!;
      expect(b.id).toBe(`b-42-${npc.npcId}`);
      expect(b.kind).toBe("shelter");
      expect(b.pos).toEqual(npc.pos);
      expect(b.ownerNpcId).toBe(npc.npcId);
      expect(b.ownerLineageId).toBe(npc.lineageId);
      expect(b.builtTick).toBe(42);
      expect(b.store).toEqual({ berry: 0, wood: 0, stone: 0, gold: 0 });
    });
    it("build leaves leftover materials beyond the recipe untouched", () => {
      const { s, npc } = fresh();
      npc.carry = { berry: 0, wood: 6, stone: 5, gold: 0 }; // extra wood/stone beyond shelter's 4/2
      expect(applyAction2(s, manifest, npc, { verb: "build", kind: "shelter" })).toBe(true);
      expect(npc.carry).toEqual({ berry: 0, wood: 2, stone: 3, gold: 0 });
    });
    it("illegal: current tile already has a building", () => {
      const { s, npc } = fresh();
      npc.carry = { berry: 0, wood: 4, stone: 2, gold: 0 };
      s.buildings.push(granaryAt(npc.lineageId, 0, { pos: { ...npc.pos } }));
      expect(applyAction2(s, manifest, npc, { verb: "build", kind: "shelter" })).toBe(false);
      expect(s.buildings.length).toBe(1);
    });
  });

  describe("deposit", () => {
    it("illegal: granary present but owned by a different lineage", () => {
      const { s, npc } = fresh();
      npc.carry.berry = 5;
      s.buildings.push(granaryAt(`${npc.lineageId}-other`, 0));
      expect(applyAction2(s, manifest, npc, { verb: "deposit", buildingId: "test-granary" })).toBe(false);
      expect(npc.carry.berry).toBe(5);
    });
    it("illegal: no granary at all on the current tile", () => {
      const { s, npc } = fresh();
      npc.carry.berry = 5;
      expect(applyAction2(s, manifest, npc, { verb: "deposit", buildingId: "nope" })).toBe(false);
    });
    it("legal, capped by GRANARY_CAP: transfers only up to remaining room", () => {
      const { s, npc } = fresh();
      npc.carry.berry = 5;
      const b = granaryAt(npc.lineageId, GRANARY_CAP - 2); // 2 slots of room left
      s.buildings.push(b);
      expect(applyAction2(s, manifest, npc, { verb: "deposit", buildingId: b.id })).toBe(true);
      expect(npc.carry.berry).toBe(3); // 5 - 2
      expect(s.buildings[0]!.store.berry).toBe(GRANARY_CAP);
    });
    it("illegal: zero transfer when granary is already full", () => {
      const { s, npc } = fresh();
      npc.carry.berry = 5;
      const b = granaryAt(npc.lineageId, GRANARY_CAP);
      s.buildings.push(b);
      expect(applyAction2(s, manifest, npc, { verb: "deposit", buildingId: b.id })).toBe(false);
      expect(npc.carry.berry).toBe(5);
      expect(s.buildings[0]!.store.berry).toBe(GRANARY_CAP);
    });
    it("illegal: zero transfer when npc carries no berries", () => {
      const { s, npc } = fresh();
      npc.carry.berry = 0;
      const b = granaryAt(npc.lineageId, 0);
      s.buildings.push(b);
      expect(applyAction2(s, manifest, npc, { verb: "deposit", buildingId: b.id })).toBe(false);
    });
  });

  describe("withdraw", () => {
    it("legal, capped by CARRY_CAP: transfers only up to remaining carry room", () => {
      const { s, npc } = fresh();
      npc.carry = { berry: CARRY_CAP - 3, wood: 0, stone: 0, gold: 0 }; // 3 slots of room left
      const b = granaryAt(npc.lineageId, 20);
      s.buildings.push(b);
      expect(applyAction2(s, manifest, npc, { verb: "withdraw", buildingId: b.id })).toBe(true);
      expect(carryTotal(npc.carry)).toBe(CARRY_CAP);
      expect(npc.carry.berry).toBe(CARRY_CAP - 3 + 3);
      expect(s.buildings[0]!.store.berry).toBe(17);
    });
    it("illegal: zero transfer when granary is empty", () => {
      const { s, npc } = fresh();
      const b = granaryAt(npc.lineageId, 0);
      s.buildings.push(b);
      expect(applyAction2(s, manifest, npc, { verb: "withdraw", buildingId: b.id })).toBe(false);
    });
    it("illegal: zero transfer when npc carry is already full", () => {
      const { s, npc } = fresh();
      npc.carry = { berry: 0, wood: 0, stone: 0, gold: CARRY_CAP };
      const b = granaryAt(npc.lineageId, 10);
      s.buildings.push(b);
      expect(applyAction2(s, manifest, npc, { verb: "withdraw", buildingId: b.id })).toBe(false);
    });
    it("illegal: granary owned by a different lineage", () => {
      const { s, npc } = fresh();
      const b = granaryAt(`${npc.lineageId}-other`, 10);
      s.buildings.push(b);
      expect(applyAction2(s, manifest, npc, { verb: "withdraw", buildingId: b.id })).toBe(false);
    });
  });

  describe("idle", () => {
    it("is always legal and changes nothing", () => {
      const { s, npc } = fresh();
      const before = JSON.stringify(s);
      expect(applyAction2(s, manifest, npc, { verb: "idle" })).toBe(true);
      expect(JSON.stringify(s)).toBe(before);
    });
  });

  describe("flee", () => {
    it("legal: moves to maximize distance from wolf, deterministically, last-wins tie-break", () => {
      const { s, npc } = fresh();
      npc.pos = { x: 14, y: 14 };
      s.wolf.pos = { x: 15, y: 15 };
      expect(applyAction2(s, manifest, npc, { verb: "flee", from: "wolf" })).toBe(true);
      expect(npc.pos).toEqual({ x: 13, y: 13 }); // unique maximum distance
    });
    it("ties break to the last candidate in DIRS order (mirrors v1)", () => {
      const { s, npc } = fresh();
      npc.pos = { x: 32, y: 32 };
      s.wolf.pos = { x: 32, y: 32 }; // npc is standing on the wolf: every neighbor is equidistant (1)
      expect(applyAction2(s, manifest, npc, { verb: "flee", from: "wolf" })).toBe(true);
      // DIRS = [N,NE,E,SE,S,SW,W,NW]; with >= tie-break, last strictly-legal candidate wins: NW = (-1,-1)
      expect(npc.pos).toEqual({ x: 31, y: 31 });
    });
  });
});
