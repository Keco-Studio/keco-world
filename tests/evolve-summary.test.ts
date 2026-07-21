import { describe, it, expect } from "vitest";
import { summarizeEvolution } from "../src/cli/evolve.js";
import { runSim } from "../src/sim/engine.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest({
  berryRegrowPpmSummer: 300_000,
  berryRegrowPpmWinter: 100_000,
});
const roster = makeTestRoster(8);

describe("evolution summary", () => {
  const r = runSim(manifest, roster, "evo-seed", { ticks: 3000 });
  const s = summarizeEvolution(r, roster);

  it("counts births, deaths, generations consistently", () => {
    expect(s.totalBirths).toBe(r.events.filter((e) => e.kind === "birth").length);
    expect(s.finalPopulation).toBe(r.finalState.npcs.filter((n) => n.alive).length);
    const deaths = Object.values(s.deathsByCause).reduce((a, b) => a + b, 0);
    expect(deaths).toBe(r.events.filter((e) => e.kind === "death").length);
    expect(s.maxGeneration).toBeGreaterThanOrEqual(1);   // manifest tuned for fast breeding
  });
  it("lineage accounting partitions the founders", () => {
    expect(s.livingLineages + s.extinctLineages).toBe(roster.length);
  });
  it("diversity and belief stats are non-negative integers", () => {
    expect(Number.isSafeInteger(s.weightDiversity100)).toBe(true);
    expect(s.weightDiversity100).toBeGreaterThanOrEqual(0);
    expect(Number.isSafeInteger(s.meanGenerationAlive)).toBe(true);
    expect(s.beliefStats.formedEvents).toBe(r.events.filter((e) => e.kind === "belief_formed").length);
  });
  it("summary is deterministic", () => {
    const r2 = runSim(manifest, roster, "evo-seed", { ticks: 3000 });
    expect(summarizeEvolution(r2, roster)).toEqual(s);
  });
});
