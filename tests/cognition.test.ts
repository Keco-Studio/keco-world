import { describe, it, expect } from "vitest";
import { runSim } from "../src/sim/engine.js";
import { verifyReplay } from "../src/replay/replay.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { cloneGenome } from "../src/life/genome.js";
import { makeDemoManifest, makeDemoRoster } from "../src/cli/demo.js";
import type { WorldManifest } from "../src/schema/core.js";

function cogManifest(cog: WorldManifest["cognition"]): WorldManifest {
  return { ...makeDemoManifest(), cognition: cog };
}

describe("cognition modes", () => {
  it("random decisionMode is deterministic, replayable, and differs from utility", () => {
    const m = cogManifest({ decisionMode: "random", inheritanceMode: "clone", beliefDynamics: "off" });
    const roster = makeDemoRoster("cog-rand");
    const a = runSim(m, roster, "cog-rand", { ticks: 300 });
    const b = runSim(m, roster, "cog-rand", { ticks: 300 });
    expect(hashCanonical(a.finalState)).toBe(hashCanonical(b.finalState));
    expect(a.actionLog.some((e) => e.actionSource === "random")).toBe(true);
    expect(a.actionLog.every((e) => e.actionSource === "random")).toBe(true); // reflex bypassed
    const u = runSim(makeDemoManifest(), roster, "cog-rand", { ticks: 300 });
    expect(hashCanonical(a.finalState)).not.toBe(hashCanonical(u.finalState));
    const rep = verifyReplay(m, roster, "cog-rand", a.actionLog, a.checkpoints, 300);
    expect(rep.ok).toBe(true);
  });

  it("beliefDynamics off keeps beliefs empty for a designless roster", () => {
    const m = cogManifest({ decisionMode: "utility", inheritanceMode: "breed", beliefDynamics: "off" });
    const r = runSim(m, makeDemoRoster("cog-nobelief"), "cog-nobelief", { ticks: 2000 });
    for (const npc of r.finalState.npcs) expect(npc.beliefs.length).toBe(0);
  });

  it("cloneGenome copies parent A verbatim and filters to designed beliefs", () => {
    const roster = makeDemoRoster("cog-clone");
    const a = {
      lineageId: "npc-1", generation: 2,
      identity: roster[0]!.identity, policy: roster[0]!.policy,
      beliefs: [
        { proposition: "designed rule", effect: { target: "w:shelter" as const, modifier: 200, condition: null }, confidence: 900, source: "designed" as const, acquiredTick: 0, decayPer100: 0 },
        { proposition: "learned", effect: { target: "w:forage" as const, modifier: 100, condition: null }, confidence: 500, source: "observed" as const, acquiredTick: 50, decayPer100: 30 },
      ],
    };
    const b = { lineageId: "npc-2", generation: 5, identity: roster[1]!.identity, policy: roster[1]!.policy, beliefs: [] };
    const child = cloneGenome(a, b, 777);
    expect(child.identity).toEqual(a.identity);
    expect(child.policy).toEqual(a.policy);
    expect(child.generation).toBe(6);
    expect(child.lineageId).toBe("npc-1");
    expect(child.beliefs.length).toBe(1);
    expect(child.beliefs[0]!.source).toBe("designed");
    expect(child.beliefs[0]!.acquiredTick).toBe(777);
  });

  it("clone inheritance keeps every NPC's genome equal to its lineage founder's", () => {
    const m = cogManifest({ decisionMode: "utility", inheritanceMode: "clone", beliefDynamics: "off" });
    const roster = makeDemoRoster("cog-lineage");
    const byId = new Map(roster.map((e) => [e.npcId, e]));
    const r = runSim(m, roster, "cog-lineage", { ticks: 4000 });
    let sawChild = false;
    for (const npc of r.finalState.npcs) {
      const founder = byId.get(npc.lineageId)!;
      expect(npc.identity).toEqual(founder.identity);
      expect(npc.policy).toEqual(founder.policy);
      if (npc.parents !== null) sawChild = true;
    }
    expect(sawChild).toBe(true); // the run must actually exercise clone inheritance
  });
});
