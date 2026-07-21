import { describe, it, expect } from "vitest";
import { runSim } from "../src/sim/engine.js";
import { replayRun, verifyReplay } from "../src/replay/replay.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

// generous food so pairs form: dense bushes, fast regrowth
const manifest = makeTestManifest({
  berryRegrowPpmSummer: 300_000,
  berryRegrowPpmWinter: 100_000,
  bushes: Array.from({ length: 6 }, (_, i) => ({ id: `bush-${i + 1}`, pos: { x: 4 + 2 * i % 12, y: 4 + Math.floor(i / 2) * 3 }, capacity: 5 })),
});
const roster = makeTestRoster(8);

describe("generational engine", () => {
  const r = runSim(manifest, roster, "evo-seed", { ticks: 2000 });

  it("births happen and newborns act only after their birth tick", () => {
    const births = r.events.filter((e) => e.kind === "birth");
    expect(births.length).toBeGreaterThan(0);
    for (const b of births) {
      const firstAction = r.actionLog.find((e) => e.npcId === b.npcId);
      if (firstAction !== undefined) expect(firstAction.tick).toBeGreaterThan(b.tick);
    }
  });
  it("full determinism with reproduction, beliefs, aging", () => {
    const r2 = runSim(manifest, roster, "evo-seed", { ticks: 2000 });
    expect(hashCanonical(r2.finalState)).toBe(hashCanonical(r.finalState));
    expect(r2.checkpoints).toEqual(r.checkpoints);
  });
  it("replay reproduces a run containing births", () => {
    const replayed = replayRun(manifest, roster, "evo-seed", r.actionLog, 2000);
    expect(hashCanonical(replayed.finalState)).toBe(hashCanonical(r.finalState));
    const report = verifyReplay(manifest, roster, "evo-seed", r.actionLog, r.checkpoints, 2000);
    expect(report.ok).toBe(true);
  });
  it("beliefs form during life", () => {
    expect(r.events.some((e) => e.kind === "belief_formed")).toBe(true);
  });
  it("retainActionLog:false keeps identical world outcomes with an empty log", () => {
    const lean = runSim(manifest, roster, "evo-seed", { ticks: 2000, retainActionLog: false });
    expect(hashCanonical(lean.finalState)).toBe(hashCanonical(r.finalState));
    expect(lean.checkpoints).toEqual(r.checkpoints);
    expect(lean.actionLog.length).toBe(0);
  });
});
