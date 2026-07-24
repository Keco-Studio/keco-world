import { describe, it, expect } from "vitest";
import { runSim, runFromState } from "../src/sim/engine.js";
import { createInitialState } from "../src/world/state.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import type { DecideInfo } from "../src/sim/engine.js";

const manifest = makeTestManifest();
const roster = makeTestRoster(5);

// Bumped again (de-blind belief-sentence leak fix, docs/prereg-1c-draft.md follow-up):
// the 3 formation-rule propositions in src/mind/beliefs.ts moved from fixed English
// strings to a deterministic Chinese variant pick (fnv1a32(`${npcId}:${tick}`) mod
// pool size). `Belief.proposition` is part of NpcState and so part of every
// checkpoint/final-state hash — this run's tick-by-tick decisions are byte-identical
// (the first 3 checkpoints below, all before this run's first belief-forming event,
// are unchanged from the prior baseline), only the belief text embedded in state
// diverges from the point beliefs start forming onward. Regenerated from the
// post-fix engine and reconfirmed deterministic across repeated runs before pinning.
const BASELINE_FINAL_HASH = "e36bfb82c35322f33b42c35ee29f126dc04df43d63d52d23b3a104d38f5c2730";
const BASELINE_CHECKPOINT_PREFIXES = "794a639d0345,06abbb3a62e8,55029dfe10ee,929e272aa33e,fb74fc25bceb,849ad0d5bc4d,17e05fe5a5c9,3deedab465ac,4d128ce63ea1,e36bfb82c353";

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
