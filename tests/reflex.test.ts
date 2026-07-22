import { describe, it, expect } from "vitest";
import { reflexDecide } from "../src/mind/reflex.js";
import type { Observation } from "../src/mind/observe.js";
import { makeTestRoster } from "./helpers.js";

function baseObs(overrides: Partial<Observation> = {}): Observation {
  return {
    tick: 10,
    season: "summer",
    onShelter: false,
    self: { npcId: "npc-1", pos: { x: 5, y: 5 }, hp: 1000, energy: 900, berries: 0, reproReady: false },
    visibleNpcs: [],
    visibleBushes: [],
    wolf: null,
    nearestShelter: { pos: { x: 2, y: 2 }, dist: 3 },
    ...overrides,
  };
}
const policy = makeTestRoster(1)[0]!.policy; // hungerUrgent: 150

describe("reflex", () => {
  it("flees when wolf within 2", () => {
    const obs = baseObs({ wolf: { pos: { x: 6, y: 5 }, dist: 1 } });
    expect(reflexDecide(obs, policy)).toEqual({ verb: "flee", from: "wolf" });
  });
  it("does not flee a distant wolf", () => {
    const obs = baseObs({ wolf: { pos: { x: 9, y: 5 }, dist: 4 } });
    expect(reflexDecide(obs, policy)).toBeNull();
  });
  it("eats when starving and holding berries", () => {
    const obs = baseObs({ self: { ...baseObs().self, energy: 100, berries: 2 } });
    expect(reflexDecide(obs, policy)).toEqual({ verb: "consume" });
  });
  it("flee outranks eating", () => {
    const obs = baseObs({
      wolf: { pos: { x: 6, y: 5 }, dist: 1 },
      self: { ...baseObs().self, energy: 100, berries: 2 },
    });
    expect(reflexDecide(obs, policy)!.verb).toBe("flee");
  });
  it("returns null when nothing urgent", () => {
    expect(reflexDecide(baseObs(), policy)).toBeNull();
  });
});
