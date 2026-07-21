import { describe, it, expect } from "vitest";
import { scoreCandidates, pickBest, utilityDecide } from "../src/mind/utility.js";
import { runSim, type DecideInfo } from "../src/sim/engine.js";
import type { Observation } from "../src/mind/observe.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest();
const { identity, policy } = makeTestRoster(1)[0]!;

function obs(overrides: Partial<Observation> = {}): Observation {
  return {
    tick: 10,
    season: "summer",
    onShelter: false,
    self: { npcId: "npc-1", pos: { x: 5, y: 5 }, hp: 1000, energy: 300, berries: 1 },
    visibleBushes: [{ id: "bush-1", pos: { x: 6, y: 5 }, berries: 3, dist: 1 }],
    wolf: null,
    nearestShelter: { pos: { x: 2, y: 2 }, dist: 3 },
    ...overrides,
  };
}

describe("scoreCandidates", () => {
  it("returns all applicable candidates with integer scores in generation order", () => {
    const cands = scoreCandidates(obs(), identity, policy, manifest, "seed-1");
    expect(cands.map((c) => c.key)).toEqual(["consume", "forage", "explore", "idle"]);
    for (const c of cands) expect(Number.isSafeInteger(c.score)).toBe(true);
  });
  it("pickBest matches utilityDecide", () => {
    const o = obs();
    const cands = scoreCandidates(o, identity, policy, manifest, "seed-1");
    const best = pickBest(cands);
    const d = utilityDecide(o, identity, policy, manifest, "seed-1");
    expect(best.key).toBe(d.key);
    expect(best.action).toEqual(d.action);
  });
  it("pickBest resolves ties to the earlier candidate", () => {
    const cands = [
      { key: "consume" as const, score: 7, action: { verb: "consume" as const } },
      { key: "idle" as const, score: 7, action: { verb: "idle" as const } },
    ];
    expect(pickBest(cands).key).toBe("consume");
  });
});

describe("engine onDecide hook", () => {
  it("fires for every action with candidates on utility decisions and null on reflex", () => {
    const roster = makeTestRoster(3);
    const seen: DecideInfo[] = [];
    const r = runSim(manifest, roster, "seed-1", { ticks: 60, onDecide: (i) => seen.push(i) });
    expect(seen.length).toBe(r.actionLog.length);
    for (let i = 0; i < seen.length; i++) {
      expect(seen[i]!.tick).toBe(r.actionLog[i]!.tick);
      expect(seen[i]!.npcId).toBe(r.actionLog[i]!.npcId);
      expect(seen[i]!.action).toEqual(r.actionLog[i]!.action);
      if (seen[i]!.actionSource === "utility" || seen[i]!.actionSource === "resolver") {
        expect(Array.isArray(seen[i]!.candidates)).toBe(true);
        expect(seen[i]!.candidates!.length).toBeGreaterThan(0);
      } else {
        expect(seen[i]!.candidates).toBeNull();
      }
    }
  });
  it("hook does not perturb determinism", () => {
    const roster = makeTestRoster(5);
    const a = runSim(manifest, roster, "seed-1", { ticks: 200 });
    const b = runSim(manifest, roster, "seed-1", { ticks: 200, onDecide: () => {} });
    expect(a.checkpoints).toEqual(b.checkpoints);
    expect(a.actionLog).toEqual(b.actionLog);
  });
});
