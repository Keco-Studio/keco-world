import { describe, it, expect } from "vitest";
import { runSim, type DecideInfo } from "../src/sim/engine.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { actionsEqual } from "../src/bench/rollout.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest({
  berryRegrowPpmSummer: 300_000,
  berryRegrowPpmWinter: 100_000,
});
const roster = makeTestRoster(8);

describe("courtship integration", () => {
  const r = runSim(manifest, roster, "court-seed", { ticks: 4000 });

  it("births occur and exceed the pre-seekMate baseline density", () => {
    const births = r.events.filter((e) => e.kind === "birth").length;
    // pre-seekMate evolution test observed ~1-3 births in 2000-3000 ticks on this config;
    // courtship should make reproduction routine rather than accidental
    expect(births).toBeGreaterThanOrEqual(4);
  });

  it("seekMate decisions actually happen and get chosen by the resolver", () => {
    const decisions: DecideInfo[] = [];
    runSim(manifest, roster, "court-seed", {
      ticks: 4000,
      onDecide: (info) => decisions.push(info),
    });

    const sawSeekMateChosen = decisions.some((d) => {
      if (d.candidates === null) return false;
      const seekMateCandidate = d.candidates.find((c) => c.key === "seekMate");
      return seekMateCandidate !== undefined && actionsEqual(d.action, seekMateCandidate.action);
    });
    expect(sawSeekMateChosen).toBe(true);
  });

  it("full determinism holds with courtship active", () => {
    const r2 = runSim(manifest, roster, "court-seed", { ticks: 4000 });
    expect(hashCanonical(r2.finalState)).toBe(hashCanonical(r.finalState));
    expect(r2.checkpoints).toEqual(r.checkpoints);
  });

  it("population does not explode past the cap", () => {
    expect(r.finalState.npcs.filter((n) => n.alive).length).toBeLessThanOrEqual(manifest.maxPopulation);
  });
});
