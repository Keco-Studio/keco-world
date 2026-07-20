import { describe, it, expect } from "vitest";
import { buildObservation } from "../src/mind/observe.js";
import { createInitialState } from "../src/world/state.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

describe("observation", () => {
  const manifest = makeTestManifest();
  const roster = makeTestRoster(2);

  it("sees bushes within vision radius sorted by (dist, id), not beyond", () => {
    const s = createInitialState(manifest, roster, "seed-1");
    const npc = s.npcs[0]!;
    npc.pos = { x: 5, y: 5 }; // on bush-1, dist 5 to bush-2 (10,3)
    const obs = buildObservation(s, manifest, npc);
    expect(obs.visibleBushes.map((b) => b.id)).toEqual(["bush-1", "bush-2"]);
    expect(obs.visibleBushes[0]!.dist).toBe(0);
    npc.pos = { x: 0, y: 15 }; // dist 10 to bush-1 → out of radius 8
    const obs2 = buildObservation(s, manifest, npc);
    expect(obs2.visibleBushes.map((b) => b.id)).toEqual([]);
  });
  it("reports wolf only within radius; nearest shelter always known", () => {
    const s = createInitialState(manifest, roster, "seed-1");
    const npc = s.npcs[0]!;
    npc.pos = { x: 0, y: 0 }; // wolf at (15,15), dist 15 → unseen
    const obs = buildObservation(s, manifest, npc);
    expect(obs.wolf).toBeNull();
    expect(obs.nearestShelter).toEqual({ pos: { x: 2, y: 2 }, dist: 2 });
    npc.pos = { x: 14, y: 14 };
    expect(buildObservation(s, manifest, npc).wolf).toEqual({ pos: { x: 15, y: 15 }, dist: 1 });
  });
  it("carries self, tick, season, onShelter", () => {
    const s = createInitialState(manifest, roster, "seed-1");
    s.tick = 150; // winter (seasonLength 100)
    const npc = s.npcs[0]!;
    npc.pos = { x: 2, y: 2 };
    const obs = buildObservation(s, manifest, npc);
    expect(obs.tick).toBe(150);
    expect(obs.season).toBe("winter");
    expect(obs.onShelter).toBe(true);
    expect(obs.self).toEqual({ npcId: npc.npcId, pos: { x: 2, y: 2 }, hp: npc.hp, energy: npc.energy, berries: 0 });
  });
});
