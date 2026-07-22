import { describe, it, expect } from "vitest";
import { SCENARIOS } from "../src/scenarios/library.js";
import { evaluateGenome } from "../src/scenarios/framework.js";
import { makeTestRoster } from "./helpers.js";

const neutral = (() => { const r = makeTestRoster(1)[0]!; return { identity: r.identity, policy: r.policy, beliefs: [] }; })();

describe("scenario framework", () => {
  it("builders are pure and deterministic", () => {
    for (const s of SCENARIOS) {
      expect(s.build()).toEqual(s.build());
    }
  });
  it("evaluation is deterministic and traces only the focal npc", () => {
    const a = evaluateGenome(neutral, SCENARIOS);
    const b = evaluateGenome(neutral, SCENARIOS);
    expect(a).toEqual(b);
    for (let i = 0; i < SCENARIOS.length; i++) {
      expect(a[i]!.scenarioId).toBe(SCENARIOS[i]!.id);
      expect(a[i]!.verbs.length).toBeGreaterThanOrEqual(1);
      expect(a[i]!.verbs.length).toBeLessThanOrEqual(SCENARIOS[i]!.horizon);
      expect(a[i]!.keys.length).toBe(a[i]!.verbs.length);
    }
  });
  it("known scenarios produce sane behaviors for the neutral genome", () => {
    const traces = Object.fromEntries(evaluateGenome(neutral, SCENARIOS).map((t) => [t.scenarioId, t]));
    expect(traces["H3"]!.verbs[0]).toBe("consume");         // reflex: starving with food
    expect(traces["P1"]!.verbs[0]).toBe("flee");            // reflex: wolf adjacent
    expect(["take", "move"]).toContain(traces["H2"]!.verbs[0]); // hungry near food → forage-ish
    expect(traces["W1"]!.verbs[0]).toBe("move");            // winter off-shelter → head for shelter
  });
  it("genome injection actually changes behavior", () => {
    const homebody = { ...neutral, policy: { ...neutral.policy, utilityWeights: { ...neutral.policy.utilityWeights, explore: 0, shelter: 1000 } } };
    const explorer = { ...neutral, policy: { ...neutral.policy, utilityWeights: { ...neutral.policy.utilityWeights, explore: 1000, shelter: 0 } } };
    const a = evaluateGenome(homebody, SCENARIOS).flatMap((t) => t.keys);
    const b = evaluateGenome(explorer, SCENARIOS).flatMap((t) => t.keys);
    expect(a).not.toEqual(b);
  });
  it("first 10 scenario ids and categories are frozen", () => {
    expect(SCENARIOS.slice(0, 10).map((s) => s.id)).toEqual(["H1","H2","H3","H4","H5","W1","W2","W3","P1","P2"]);
  });
});
