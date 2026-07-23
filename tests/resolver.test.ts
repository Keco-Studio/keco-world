import { describe, it, expect } from "vitest";
import { resolve, affinity, RESOLVER_BASE_WEIGHT } from "../src/mind/resolver.js";
import { pickBest, type ScoredCandidate } from "../src/mind/utility.js";
import { runSim } from "../src/sim/engine.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const identity = makeTestRoster(1)[0]!.identity;
const cands: ScoredCandidate[] = [
  { key: "consume", score: 500, action: { verb: "consume" } },
  { key: "forage", score: 480, action: { verb: "take", target: "bush-1" } },
  { key: "idle", score: 100, action: { verb: "idle" } },
];

describe("resolver", () => {
  it("epsilon 0 reproduces exact argmax with source utility", () => {
    const r = resolve(cands, identity, 0, "s", "npc-1", 10);
    expect(r).toEqual({
      action: pickBest(cands).action,
      key: pickBest(cands).key,
      source: "utility",
      patronApplied: false,
      patronDecisive: false,
    });
  });
  it("band of one → utility even with large epsilon", () => {
    const solo = [cands[0]!, cands[2]!]; // gap 400 > epsilon 60
    expect(resolve(solo, identity, 60, "s", "npc-1", 10).source).toBe("utility");
  });
  it("hesitation band → deterministic resolver draw from band members only", () => {
    const a = resolve(cands, identity, 60, "s", "npc-1", 10);
    const b = resolve(cands, identity, 60, "s", "npc-1", 10);
    expect(a).toEqual(b);
    expect(a.source).toBe("resolver");
    expect(["consume", "forage"]).toContain(a.key);          // idle (100) is outside the band
  });
  it("different personalities shift the distribution across many draws", () => {
    const patient = { ...identity, patience: 950 };
    const impatient = { ...identity, patience: 50 };
    let patientForage = 0, impatientForage = 0;
    for (let t = 0; t < 300; t++) {
      if (resolve(cands, patient, 60, "s", "npc-1", t).key === "forage") patientForage++;
      if (resolve(cands, impatient, 60, "s", "npc-1", t).key === "forage") impatientForage++;
    }
    expect(patientForage).toBeGreaterThan(impatientForage + 30);
  });
  it("affinity mapping matches the documented table", () => {
    expect(affinity("consume", identity)).toBe(1000 - identity.patience);
    expect(affinity("forage", identity)).toBe(identity.patience);
    expect(affinity("shelter", identity)).toBe(1000 - identity.riskTolerance);
    expect(affinity("explore", identity)).toBe(identity.explorationBias);
    expect(affinity("idle", identity)).toBe(Math.floor(identity.patience / 2));
    expect(RESOLVER_BASE_WEIGHT).toBe(100);
  });
  it("engine emits resolver actionSource and stays deterministic", () => {
    const manifest = makeTestManifest();
    const roster = makeTestRoster(5); // epsilon 60
    const a = runSim(manifest, roster, "seed-1", { ticks: 300 });
    const b = runSim(manifest, roster, "seed-1", { ticks: 300 });
    expect(a.checkpoints).toEqual(b.checkpoints);
    expect(a.actionLog.some((e) => e.actionSource === "resolver")).toBe(true);
  });
});
