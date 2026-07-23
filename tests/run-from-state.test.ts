import { describe, it, expect } from "vitest";
import { runSim, runFromState } from "../src/sim/engine.js";
import { createInitialState } from "../src/world/state.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import type { DecideInfo } from "../src/sim/engine.js";

const manifest = makeTestManifest();
const roster = makeTestRoster(5);

// Bumped for schema v4 (Task 2, patron mechanism): WorldState gained `patronThemes`
// (hashed into every checkpoint/state hash), so every hash below shifted even though this
// run never sets a patron directive and patronThemes stays `{}` throughout — i.e. the
// underlying tick-by-tick decisions are unchanged, only the serialized state shape is. This
// baseline was regenerated from the post-v4 engine and reconfirmed deterministic across
// repeated runs before being pinned.
const BASELINE_FINAL_HASH = "1aad11987941f1878a0418ac7b87771f69a7e0aaad06dfac4d5c587be9b87a27";
const BASELINE_CHECKPOINT_PREFIXES = "794a639d0345,06abbb3a62e8,55029dfe10ee,85fa37586e82,52e6b3de6a1d,228c2a9c19eb,278086dfd963,42229e028866,ef64addb77b4,1aad11987941";

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
