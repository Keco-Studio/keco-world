import { describe, it, expect } from "vitest";
import { runSim } from "../src/sim/engine.js";
import { replayRun, verifyReplay } from "../src/replay/replay.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import type { Action } from "../src/schema/log.js";

const manifest = makeTestManifest();
const roster = makeTestRoster(5);

describe("replay", () => {
  it("replaying a live log reproduces the exact state trajectory", () => {
    const live = runSim(manifest, roster, "seed-1", { ticks: 300 });
    const replayed = replayRun(manifest, roster, "seed-1", live.actionLog, 300);
    expect(hashCanonical(replayed.finalState)).toBe(hashCanonical(live.finalState));
    expect(replayed.checkpoints).toEqual(live.checkpoints);
  });
  it("verifyReplay passes on an untampered log", () => {
    const live = runSim(manifest, roster, "seed-1", { ticks: 300 });
    const report = verifyReplay(manifest, roster, "seed-1", live.actionLog, live.checkpoints, 300);
    expect(report).toEqual({
      ok: true,
      checkpointCount: 6,
      firstDivergentCheckpoint: null,
      firstDivergentTick: null,
    });
  });
  it("a tampered action is detected and localized to its tick", () => {
    const live = runSim(manifest, roster, "seed-1", { ticks: 300 });
    const tampered = live.actionLog.map((e) => ({ ...e }));
    // find a 'move' event past tick 100 and null it out to idle
    const idx = tampered.findIndex((e) => e.tick > 100 && e.action.verb === "move");
    expect(idx).toBeGreaterThan(-1);
    const badTick = tampered[idx]!.tick;
    tampered[idx]!.action = { verb: "idle" } as Action;
    const report = verifyReplay(manifest, roster, "seed-1", tampered, live.checkpoints, 300);
    expect(report.ok).toBe(false);
    expect(report.firstDivergentCheckpoint).not.toBeNull();
    expect(report.firstDivergentTick).toBe(badTick);
  });
});
