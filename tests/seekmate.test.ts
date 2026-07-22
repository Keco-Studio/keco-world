import { describe, it, expect } from "vitest";
import { scoreCandidates, utilityDecide } from "../src/mind/utility.js";
import type { Observation } from "../src/mind/observe.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest();
const { identity, policy } = makeTestRoster(1)[0]!; // seekMate 500, forage 600

function obs(overrides: Partial<Observation> = {}): Observation {
  return {
    tick: 10, season: "summer", onShelter: false,
    self: { npcId: "npc-1", pos: { x: 5, y: 5 }, hp: 1000, energy: 800, berries: 0, reproReady: true },
    visibleBushes: [], visibleNpcs: [], wolf: null,
    nearestShelter: { pos: { x: 2, y: 2 }, dist: 3 },
    ...overrides,
  };
}

describe("seekMate candidate", () => {
  it("generated only when reproReady and a fertile adult is visible, in order after shelter", () => {
    const withMate = obs({ visibleNpcs: [{ npcId: "npc-2", pos: { x: 8, y: 5 }, dist: 3, fertileAdult: true }] });
    const keys = scoreCandidates(withMate, identity, policy, manifest, "s").map((c) => c.key);
    expect(keys).toContain("seekMate");
    expect(keys.indexOf("seekMate")).toBeGreaterThan(keys.indexOf("shelter") === -1 ? -1 : keys.indexOf("shelter"));
    expect(keys.indexOf("seekMate")).toBeLessThan(keys.indexOf("explore"));
    expect(scoreCandidates(obs(), identity, policy, manifest, "s").map((c) => c.key)).not.toContain("seekMate");
    expect(scoreCandidates(obs({ self: { ...obs().self, reproReady: false }, visibleNpcs: withMate.visibleNpcs }), identity, policy, manifest, "s").map((c) => c.key)).not.toContain("seekMate");
    const infertile = obs({ visibleNpcs: [{ npcId: "npc-2", pos: { x: 8, y: 5 }, dist: 3, fertileAdult: false }] });
    expect(scoreCandidates(infertile, identity, policy, manifest, "s").map((c) => c.key)).not.toContain("seekMate");
  });
  it("scores flat weight minus 15 per step and targets the NEAREST fertile adult", () => {
    const o = obs({ visibleNpcs: [
      { npcId: "far", pos: { x: 10, y: 5 }, dist: 5, fertileAdult: true },
      { npcId: "near-infertile", pos: { x: 6, y: 5 }, dist: 1, fertileAdult: false },
    ] });
    // visibleNpcs sorted by dist: near-infertile first, but find() skips it → far
    const c = scoreCandidates(o, identity, policy, manifest, "s").find((x) => x.key === "seekMate")!;
    expect(c.score).toBe(500 - 15 * 5);
    expect(c.action).toEqual({ verb: "move", to: { x: 6, y: 5 } });
  });
  it("adjacent to mate → idle (wait), and a fed NPC prefers courting to foraging", () => {
    const o = obs({
      visibleNpcs: [{ npcId: "npc-2", pos: { x: 6, y: 5 }, dist: 1, fertileAdult: true }],
      visibleBushes: [{ id: "bush-1", pos: { x: 4, y: 5 }, berries: 3, dist: 1 }],
    });
    const d = utilityDecide(o, identity, policy, manifest, "s");
    expect(d.key).toBe("seekMate");            // 500-15=485 > forage 600*200/1000-20=100
    expect(d.action).toEqual({ verb: "idle" });
  });
  it("a starving NPC forages instead", () => {
    const o = obs({
      self: { ...obs().self, energy: 200, reproReady: false },
      visibleBushes: [{ id: "bush-1", pos: { x: 4, y: 5 }, berries: 3, dist: 1 }],
      visibleNpcs: [{ npcId: "npc-2", pos: { x: 6, y: 5 }, dist: 1, fertileAdult: true }],
    });
    expect(utilityDecide(o, identity, policy, manifest, "s").key).toBe("forage");
  });
});
