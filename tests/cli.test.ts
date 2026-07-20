import { describe, it, expect } from "vitest";
import { makeDemoManifest, makeDemoRoster } from "../src/cli/demo.js";
import { narrate } from "../src/cli/narrate.js";
import { WorldManifestS, RosterEntryS } from "../src/schema/core.js";
import { runSim } from "../src/sim/engine.js";

describe("demo world", () => {
  it("manifest and roster validate against schemas", () => {
    WorldManifestS.parse(makeDemoManifest());
    const roster = makeDemoRoster("demo-seed");
    expect(roster.length).toBe(25);
    for (const r of roster) RosterEntryS.parse(r);
  });
  it("roster weights actually vary across NPCs", () => {
    const roster = makeDemoRoster("demo-seed");
    const forages = new Set(roster.map((r) => r.policy.utilityWeights.forage));
    expect(forages.size).toBeGreaterThan(3);
  });
  it("25 NPCs survive-or-die plausibly over 2 seasons (no mass instant death)", () => {
    const r = runSim(makeDemoManifest(), makeDemoRoster("demo-seed"), "demo-seed", { ticks: 800 });
    const alive = r.finalState.npcs.filter((n) => n.alive).length;
    expect(alive).toBeGreaterThan(0);
  });
});

describe("narration", () => {
  const names = new Map([["npc-1", "Rill"]]);
  it("narrates death with cause", () => {
    const line = narrate({ tick: 412, kind: "death", npcId: "npc-1", data: { cause: "cold" } }, names);
    expect(line).toContain("Rill");
    expect(line).toContain("cold");
    expect(line).toContain("412");
  });
  it("narrates season change", () => {
    const line = narrate({ tick: 400, kind: "season_change", npcId: null, data: { season: "winter" } }, names);
    expect(line.toLowerCase()).toContain("winter");
  });
});
