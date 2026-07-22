import { describe, it, expect } from "vitest";
import { utilityDecide, moveToward } from "../src/mind/utility.js";
import type { Observation } from "../src/mind/observe.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest();
const { identity, policy } = makeTestRoster(1)[0]!;

function obs(overrides: Partial<Observation> = {}): Observation {
  return {
    tick: 10,
    season: "summer",
    onShelter: false,
    self: { npcId: "npc-1", pos: { x: 5, y: 5 }, hp: 1000, energy: 1000, berries: 0, reproReady: false },
    visibleNpcs: [],
    visibleBushes: [],
    wolf: null,
    nearestShelter: { pos: { x: 2, y: 2 }, dist: 3 },
    ...overrides,
  };
}

describe("utility", () => {
  it("hungry with berries → consume beats forage", () => {
    const o = obs({
      self: { ...obs().self, energy: 300, berries: 1 },
      visibleBushes: [{ id: "bush-1", pos: { x: 6, y: 5 }, berries: 3, dist: 1 }],
    });
    const d = utilityDecide(o, identity, policy, manifest, "seed-1");
    expect(d.key).toBe("consume"); // w.consume 800 > w.forage 600 at same need
    expect(d.action).toEqual({ verb: "consume" });
  });
  it("hungry, no berries, bush adjacent → take", () => {
    const o = obs({
      self: { ...obs().self, energy: 300 },
      visibleBushes: [{ id: "bush-1", pos: { x: 6, y: 5 }, berries: 3, dist: 1 }],
    });
    const d = utilityDecide(o, identity, policy, manifest, "seed-1");
    expect(d).toEqual({ key: "forage", action: { verb: "take", target: "bush-1" } });
  });
  it("hungry, bush far → single step toward it", () => {
    const o = obs({
      self: { ...obs().self, energy: 300 },
      visibleBushes: [{ id: "bush-2", pos: { x: 10, y: 3 }, berries: 3, dist: 5 }],
    });
    const d = utilityDecide(o, identity, policy, manifest, "seed-1");
    expect(d.key).toBe("forage");
    expect(d.action).toEqual({ verb: "move", to: { x: 6, y: 4 } });
  });
  it("winter off-shelter, not hungry → heads to shelter", () => {
    const o = obs({ season: "winter" });
    const d = utilityDecide(o, identity, policy, manifest, "seed-1");
    expect(d.key).toBe("shelter");
    expect(d.action).toEqual({ verb: "move", to: { x: 4, y: 4 } });
  });
  it("nothing pressing → explore or idle, deterministically", () => {
    const o = obs();
    const a = utilityDecide(o, identity, policy, manifest, "seed-1");
    const b = utilityDecide(o, identity, policy, manifest, "seed-1");
    expect(a).toEqual(b);
    expect(["explore", "idle"]).toContain(a.key);
  });
  it("moveToward takes one chebyshev step with sign()", () => {
    expect(moveToward({ x: 5, y: 5 }, { x: 10, y: 3 })).toEqual({ verb: "move", to: { x: 6, y: 4 } });
    expect(moveToward({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ verb: "idle" });
  });
});
