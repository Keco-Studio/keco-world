import { describe, it, expect } from "vitest";
import { evaluateBranch, evaluatePair, actionsEqual } from "../src/bench/rollout.js";
import { findTriggers } from "../src/bench/trigger.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest();
const roster = makeTestRoster(5);
const triggers = findTriggers(manifest, roster, "seed-1", 300, 100);

describe("rollout evaluation", () => {
  it("harvest produced triggers to evaluate", () => {
    expect(triggers.length).toBeGreaterThan(0);
  });
  it("is deterministic and returns integer margins", () => {
    const tr = triggers[0]!;
    const a1 = evaluateBranch(manifest, roster, tr, tr.candidates[tr.bestIndex]!.action, 100);
    const a2 = evaluateBranch(manifest, roster, tr, tr.candidates[tr.bestIndex]!.action, 100);
    expect(a1).toBe(a2);
    expect(Number.isSafeInteger(a1)).toBe(true);
  });
  it("evaluatePair classifies outcomes consistently with margins", () => {
    const tr = triggers.find((t) => t.candidates.length >= 2)!;
    const a = tr.candidates[0]!.action;
    const b = tr.candidates[1]!.action;
    const pair = evaluatePair(manifest, roster, tr, a, b, 100);
    if (pair.marginA > pair.marginB) expect(pair.outcome).toBe("A");
    else if (pair.marginA < pair.marginB) expect(pair.outcome).toBe("B");
    else expect(pair.outcome).toBe("tie");
  });
  it("identical forced actions produce a tie", () => {
    const tr = triggers[0]!;
    const a = tr.candidates[tr.bestIndex]!.action;
    const pair = evaluatePair(manifest, roster, tr, a, a, 100);
    expect(pair.outcome).toBe("tie");
    expect(pair.marginA).toBe(pair.marginB);
  });
  it("actionsEqual distinguishes actions structurally", () => {
    expect(actionsEqual({ verb: "idle" }, { verb: "idle" })).toBe(true);
    expect(actionsEqual({ verb: "idle" }, { verb: "consume" })).toBe(false);
    expect(actionsEqual({ verb: "move", to: { x: 1, y: 2 } }, { verb: "move", to: { x: 1, y: 3 } })).toBe(false);
  });
});
