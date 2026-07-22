import { describe, it, expect } from "vitest";
import { buildObservation } from "../src/mind/observe.js";
import { isFertileEligible } from "../src/world/rules.js";
import { createInitialState } from "../src/world/state.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest();

describe("visibleNpcs and reproReady", () => {
  it("sees living neighbors sorted (dist, id), never self or the dead", () => {
    const s = createInitialState(manifest, makeTestRoster(4), "seed-1");
    const [a, b, c, d] = s.npcs;
    a!.pos = { x: 5, y: 5 }; b!.pos = { x: 6, y: 5 }; c!.pos = { x: 5, y: 7 }; d!.pos = { x: 15, y: 15 };
    c!.alive = false;
    const obs = buildObservation(s, manifest, a!);
    expect(obs.visibleNpcs.map((n) => n.npcId)).toEqual([b!.npcId]); // c dead, d out of radius 8? dist 10 → out
    expect(obs.visibleNpcs[0]!.dist).toBe(1);
    expect(obs.visibleNpcs[0]!.pos).not.toBe(b!.pos);               // fresh copy
  });
  it("fertileAdult flag matches the shared eligibility age window", () => {
    const s = createInitialState(manifest, makeTestRoster(2), "seed-1");
    const [a, b] = s.npcs;
    a!.pos = { x: 5, y: 5 }; b!.pos = { x: 6, y: 5 };
    b!.birthTick = s.tick;                        // age 0 → too young
    expect(buildObservation(s, manifest, a!).visibleNpcs[0]!.fertileAdult).toBe(false);
    b!.birthTick = -150;                          // age in window
    expect(buildObservation(s, manifest, a!).visibleNpcs[0]!.fertileAdult).toBe(true);
  });
  it("reproReady mirrors isFertileEligible exactly", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    for (const mutate of [
      () => { npc.energy = manifest.reproEnergyMin - 1; },
      () => { npc.energy = 1000; npc.reproCooldownUntil = 10_000; },
      () => { npc.reproCooldownUntil = 0; npc.birthTick = s.tick; },
    ]) {
      mutate();
      expect(buildObservation(s, manifest, npc).self.reproReady).toBe(isFertileEligible(npc, manifest, s.tick));
    }
  });
});
