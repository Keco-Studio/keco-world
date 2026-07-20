import { describe, it, expect } from "vitest";
import { applyAction } from "../src/world/actions.js";
import { createInitialState } from "../src/world/state.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest();

function fresh() {
  const s = createInitialState(manifest, makeTestRoster(2), "seed-1");
  return { s, npc: s.npcs[0]! };
}

describe("applyAction", () => {
  it("move: adjacent legal, teleport illegal (no-op)", () => {
    const { s, npc } = fresh();
    npc.pos = { x: 5, y: 5 };
    expect(applyAction(s, manifest, npc, { verb: "move", to: { x: 6, y: 6 } })).toBe(true);
    expect(npc.pos).toEqual({ x: 6, y: 6 });
    expect(applyAction(s, manifest, npc, { verb: "move", to: { x: 9, y: 9 } })).toBe(false);
    expect(npc.pos).toEqual({ x: 6, y: 6 });
  });
  it("move out of bounds is illegal", () => {
    const { s, npc } = fresh();
    npc.pos = { x: 0, y: 0 };
    expect(applyAction(s, manifest, npc, { verb: "move", to: { x: -1, y: 0 } })).toBe(false);
  });
  it("take: adjacent bush with berries decrements bush, increments inventory", () => {
    const { s, npc } = fresh();
    npc.pos = { x: 5, y: 5 }; // bush-1 here
    expect(applyAction(s, manifest, npc, { verb: "take", target: "bush-1" })).toBe(true);
    expect(s.bushes.find((b) => b.id === "bush-1")!.berries).toBe(4);
    expect(npc.berries).toBe(1);
  });
  it("take: empty or distant bush illegal", () => {
    const { s, npc } = fresh();
    npc.pos = { x: 5, y: 5 };
    s.bushes.find((b) => b.id === "bush-1")!.berries = 0;
    expect(applyAction(s, manifest, npc, { verb: "take", target: "bush-1" })).toBe(false);
    expect(applyAction(s, manifest, npc, { verb: "take", target: "bush-2" })).toBe(false); // dist 5
  });
  it("consume: eats a berry up to maxEnergy cap", () => {
    const { s, npc } = fresh();
    npc.berries = 2;
    npc.energy = 900;
    expect(applyAction(s, manifest, npc, { verb: "consume" })).toBe(true);
    expect(npc.energy).toBe(1000); // capped, berryEnergy 200
    expect(npc.berries).toBe(1);
  });
  it("consume with no berries is illegal", () => {
    const { s, npc } = fresh();
    expect(applyAction(s, manifest, npc, { verb: "consume" })).toBe(false);
  });
  it("flee: moves to maximize distance from wolf, deterministically", () => {
    const { s, npc } = fresh();
    npc.pos = { x: 14, y: 14 };
    s.wolf.pos = { x: 15, y: 15 };
    expect(applyAction(s, manifest, npc, { verb: "flee", from: "wolf" })).toBe(true);
    expect(npc.pos).toEqual({ x: 13, y: 13 }); // dist 2, unique maximum
    const again = { ...npc.pos };
    applyAction(s, manifest, npc, { verb: "flee", from: "wolf" });
    expect(npc.pos).toEqual({ x: again.x - 1, y: again.y - 1 });
  });
  it("idle is always legal and changes nothing", () => {
    const { s, npc } = fresh();
    const before = JSON.stringify(s);
    expect(applyAction(s, manifest, npc, { verb: "idle" })).toBe(true);
    expect(JSON.stringify(s)).toBe(before);
  });
});
