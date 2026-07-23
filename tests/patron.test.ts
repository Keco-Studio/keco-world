import { describe, it, expect } from "vitest";
import { runSim } from "../src/sim/engine.js";
import { verifyReplay } from "../src/replay/replay.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { resolve, PATRON_TILT } from "../src/mind/resolver.js";
import { makeDemoManifest, makeDemoRoster } from "../src/cli/demo.js";
import type { ScoredCandidate } from "../src/mind/utility.js";

const IDENT = { riskTolerance: 500, socialTrust: 500, explorationBias: 500, patience: 500, voiceStyle: "" };
const cand = (key: string, score: number): ScoredCandidate =>
  ({ key, score, action: { verb: "idle" } }) as unknown as ScoredCandidate;

describe("patron mechanism", () => {
  it("tilt applies only inside a multi-member band", () => {
    const r0 = resolve([cand("explore", 100), cand("idle", 10)], IDENT, 0, "p", "n", 1, "idle");
    expect(r0.patronApplied).toBe(false);
    const r1 = resolve([cand("explore", 100), cand("idle", 98)], IDENT, 60, "p", "n", 1, "idle");
    expect(r1.patronApplied).toBe(true);
    const r2 = resolve([cand("explore", 100), cand("idle", 98)], IDENT, 60, "p", "n", 1, "forage");
    expect(r2.patronApplied).toBe(false); // theme not in band
  });
  it("patronDecisive is exactly 'outcome differs from counterfactual'", () => {
    // Scan ticks to find at least one decisive and one applied-but-not-decisive case
    let decisive = 0, applied = 0;
    for (let t = 1; t <= 500; t++) {
      const r = resolve([cand("explore", 100), cand("idle", 99)], IDENT, 60, "p", "n", t, "idle");
      if (r.patronApplied) applied++;
      if (r.patronDecisive) { decisive++; expect(r.key).toBe("idle"); } // tilt can only pull TOWARD the theme
    }
    expect(applied).toBe(500);
    expect(decisive).toBeGreaterThan(0);
    expect(decisive).toBeLessThan(500);
  });
  it("directives are deterministic, hashed into state, and replayable", () => {
    const m = makeDemoManifest();
    const roster = makeDemoRoster("pat-e2e");
    const dirs = new Map([[1, [{ npcId: "npc-1", theme: "explore" as const }]], [400, [{ npcId: "npc-1", theme: null }]]]);
    const a = runSim(m, roster, "pat-e2e", { ticks: 800, patronDirectives: dirs });
    const b = runSim(m, roster, "pat-e2e", { ticks: 800, patronDirectives: dirs });
    expect(hashCanonical(a.finalState)).toBe(hashCanonical(b.finalState));
    const plain = runSim(m, roster, "pat-e2e", { ticks: 800 });
    expect(hashCanonical(a.finalState)).not.toBe(hashCanonical(plain.finalState)); // theme actually mattered somewhere
    expect(a.events.filter((e) => e.kind === "patron_set").length).toBe(2);
    expect(a.finalState.patronThemes["npc-1"]).toBeUndefined(); // cleared at 400
    const rep = verifyReplay(m, roster, "pat-e2e", a.actionLog, a.checkpoints, 800, dirs);
    expect(rep.ok).toBe(true);
  });
  it("patronInfluence lands in the action log and PATRON_TILT is frozen", () => {
    const m = makeDemoManifest();
    const roster = makeDemoRoster("pat-log");
    const dirs = new Map([[1, [{ npcId: "npc-1", theme: "explore" as const }]]]);
    const r = runSim(m, roster, "pat-log", { ticks: 2000, patronDirectives: dirs });
    const mine = r.actionLog.filter((e) => e.npcId === "npc-1");
    expect(mine.some((e) => e.patronInfluence)).toBe(true);
    expect(r.actionLog.filter((e) => e.npcId !== "npc-1").every((e) => !e.patronInfluence)).toBe(true);
    expect([150, 100, 60, 30]).toContain(PATRON_TILT);
  });
  it("patronDecisive is persisted in the action log, audit-traceable, and replayable", () => {
    const m = makeDemoManifest();
    const roster = makeDemoRoster("pat-decisive-log");
    const dirs = new Map([[1, [{ npcId: "npc-1", theme: "explore" as const }]]]);
    const r = runSim(m, roster, "pat-decisive-log", { ticks: 2000, patronDirectives: dirs });
    const mine = r.actionLog.filter((e) => e.npcId === "npc-1");
    // At least one decisive event landed in the persisted log — the UI's decisive mark is
    // traceable to a saved run, not just a live in-process DecideInfo signal.
    expect(mine.some((e) => e.patronDecisive)).toBe(true);
    // decisive ⊆ applied: every decisive event also has patronInfluence true.
    expect(mine.filter((e) => e.patronDecisive).every((e) => e.patronInfluence)).toBe(true);
    // Non-directive NPCs never have either flag set.
    const others = r.actionLog.filter((e) => e.npcId !== "npc-1");
    expect(others.every((e) => !e.patronInfluence && !e.patronDecisive)).toBe(true);
    // The regenerated log during replay must byte-match, including the new field.
    const rep = verifyReplay(m, roster, "pat-decisive-log", r.actionLog, r.checkpoints, 2000, dirs);
    expect(rep.ok).toBe(true);
  });
});
