import { describe, it, expect } from "vitest";
import { createInitialState, seasonAt, chebyshev, isOnShelter } from "../src/world/state.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

describe("world state", () => {
  const manifest = makeTestManifest();
  const roster = makeTestRoster(5);

  it("creates NPCs in roster order with full hp/energy", () => {
    const s = createInitialState(manifest, roster, "seed-1");
    expect(s.npcs.map((n) => n.npcId)).toEqual(roster.map((r) => r.npcId));
    expect(s.npcs.every((n) => n.hp === manifest.maxHp && n.energy === manifest.maxEnergy)).toBe(true);
    expect(s.npcs.every((n) => n.alive)).toBe(true);
  });
  it("placement is deterministic and in-bounds", () => {
    const a = createInitialState(manifest, roster, "seed-1");
    const b = createInitialState(manifest, roster, "seed-1");
    expect(a).toEqual(b);
    for (const n of a.npcs) {
      expect(n.pos.x).toBeGreaterThanOrEqual(0);
      expect(n.pos.x).toBeLessThan(manifest.gridWidth);
      expect(n.pos.y).toBeGreaterThanOrEqual(0);
      expect(n.pos.y).toBeLessThan(manifest.gridHeight);
    }
  });
  it("bushes start at capacity; wolf at wolfStart", () => {
    const s = createInitialState(manifest, roster, "seed-1");
    expect(s.bushes.every((b) => b.berries === b.capacity)).toBe(true);
    expect(s.wolf.pos).toEqual(manifest.wolfStart);
  });
  it("seasonAt alternates summer/winter", () => {
    expect(seasonAt(0, manifest)).toBe("summer");
    expect(seasonAt(manifest.seasonLengthTicks, manifest)).toBe("winter");
    expect(seasonAt(manifest.seasonLengthTicks * 2, manifest)).toBe("summer");
  });
  it("chebyshev and shelter helpers", () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3);
    expect(isOnShelter(manifest.shelters[0]!, manifest)).toBe(true);
    expect(isOnShelter({ x: -1, y: -1 }, manifest)).toBe(false);
  });
});
