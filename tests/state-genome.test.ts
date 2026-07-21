import { describe, it, expect } from "vitest";
import { createInitialState, npcAge } from "../src/world/state.js";
import { runSim } from "../src/sim/engine.js";
import { makeTestManifest, makeTestRoster, makeTestBelief } from "./helpers.js";

const manifest = makeTestManifest();

describe("genome-bearing state", () => {
  it("founders embed deep-copied genome with lineage metadata", () => {
    const roster = makeTestRoster(3);
    roster[0]!.beliefs = [makeTestBelief()];
    const s = createInitialState(manifest, roster, "seed-1");
    const n = s.npcs[0]!;
    expect(n.lineageId).toBe(n.npcId);
    expect(n.generation).toBe(0);
    expect(n.parents).toBeNull();
    expect(n.identity).toEqual(roster[0]!.identity);
    expect(n.beliefs).toEqual(roster[0]!.beliefs);
    expect(n.beliefs).not.toBe(roster[0]!.beliefs);          // deep copy, no aliasing
    expect(n.genomeHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("founders start between adult and elder age, staggered and deterministic", () => {
    const s = createInitialState(manifest, makeTestRoster(10), "seed-1");
    const ages = s.npcs.map((n) => npcAge(n, 0));
    for (const a of ages) {
      expect(a).toBeGreaterThanOrEqual(manifest.adultAgeTicks);
      expect(a).toBeLessThan(manifest.adultAgeTicks + manifest.elderAgeTicks);
    }
    expect(new Set(ages).size).toBeGreaterThan(3);
    expect(createInitialState(manifest, makeTestRoster(10), "seed-1")).toEqual(s);
  });
  it("engine runs on embedded genomes (no roster lookups) and stays deterministic", () => {
    const roster = makeTestRoster(5);
    const a = runSim(manifest, roster, "seed-1", { ticks: 200 });
    const b = runSim(manifest, roster, "seed-1", { ticks: 200 });
    expect(a.checkpoints).toEqual(b.checkpoints);
  });
});
