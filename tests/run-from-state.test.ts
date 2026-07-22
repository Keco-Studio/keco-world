import { describe, it, expect } from "vitest";
import { runSim, runFromState } from "../src/sim/engine.js";
import { createInitialState } from "../src/world/state.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import type { DecideInfo } from "../src/sim/engine.js";

const manifest = makeTestManifest();
const roster = makeTestRoster(5);

const BASELINE_FINAL_HASH = "921cc3de0ca2e45a8cb2ade50b5507f740670c73e61ea1410f3a61ad0adccce6";
const BASELINE_CHECKPOINT_PREFIXES = "449e936196b7,7c2a81955fc3,994570870a56,c3a1b55bce55,1b84b77e2fab,00407aade5a3,2b34f85a7984,c16538defa05,eac56cfc9704,921cc3de0ca2";

describe("runFromState", () => {
  it("refactor is behavior-neutral: pre-refactor hashes reproduced exactly", () => {
    const r = runSim(manifest, roster, "refactor-guard", { ticks: 500 });
    expect(hashCanonical(r.finalState)).toBe(BASELINE_FINAL_HASH);
    expect(r.checkpoints.map((c) => c.stateHash.slice(0, 12)).join(",")).toBe(BASELINE_CHECKPOINT_PREFIXES);
  });
  it("runSim equals createInitialState + runFromState", () => {
    const a = runSim(manifest, roster, "seed-x", { ticks: 300 });
    const b = runFromState(createInitialState(manifest, roster, "seed-x"), manifest, "seed-x", { ticks: 300 });
    expect(hashCanonical(a.finalState)).toBe(hashCanonical(b.finalState));
    expect(a.checkpoints).toEqual(b.checkpoints);
  });
  it("does not mutate the input state and continues from a mid-run tick", () => {
    const s = createInitialState(manifest, roster, "seed-x");
    s.tick = 450;                        // mid-winter start
    const frozen = JSON.stringify(s);
    const r = runFromState(s, manifest, "seed-x", { ticks: 10 });
    expect(JSON.stringify(s)).toBe(frozen);
    expect(r.finalState.tick).toBe(460);
    expect(r.actionLog.every((e) => e.tick > 450 && e.tick <= 460)).toBe(true);
  });
  it("chosenKey reported for utility/resolver, null for reflex", () => {
    const seen: DecideInfo[] = [];
    runSim(manifest, roster, "seed-x", { ticks: 200, onDecide: (i) => seen.push(i) });
    for (const d of seen) {
      if (d.actionSource === "reflex") expect(d.chosenKey).toBeNull();
      else expect(d.chosenKey).not.toBeNull();
    }
    expect(new Set(seen.filter((d) => d.chosenKey !== null).map((d) => d.chosenKey)).size).toBeGreaterThan(1);
  });
});
