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
  it("an untampered replay run completes without halting", () => {
    const live = runSim(manifest, roster, "seed-1", { ticks: 300 });
    const replayed = replayRun(manifest, roster, "seed-1", live.actionLog, 300);
    expect(replayed.haltedAtTick).toBeNull();
  });
  it("a tampered log that makes a LATER injected action illegal halts the replay, " +
    "but verifyReplay still localizes firstDivergentTick to the earlier tamper tick", () => {
    const live = runSim(manifest, roster, "seed-1", { ticks: 300 });

    // Find a 'move' event past tick 100 and nudge its destination by one cell (still a
    // legal move on its own) such that a later logged action for the same npc — whose
    // target was computed relative to the untampered trajectory — becomes illegal against
    // the now-shifted position. This makes runSim halt strictly after the tamper tick,
    // while the recorded state hashes actually diverge starting at the tamper tick itself.
    const moveIndices = live.actionLog
      .map((_, i) => i)
      .filter((i) => live.actionLog[i]!.tick > 100 && live.actionLog[i]!.action.verb === "move");
    expect(moveIndices.length).toBeGreaterThan(0);

    let found: { tampered: typeof live.actionLog; tamperTick: number } | null = null;
    search: for (const idx of moveIndices) {
      const ev = live.actionLog[idx]!;
      const origTo = (ev.action as { verb: "move"; to: { x: number; y: number } }).to;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const cand = { x: origTo.x + dx, y: origTo.y + dy };
          if (cand.x < 0 || cand.x >= 16 || cand.y < 0 || cand.y >= 16) continue;
          const tampered = live.actionLog.map((e) => ({ ...e, action: { ...e.action } }));
          tampered[idx]!.action = { verb: "move", to: cand } as Action;
          const replayed = replayRun(manifest, roster, "seed-1", tampered, 300);
          if (replayed.haltedAtTick !== null && replayed.haltedAtTick > ev.tick) {
            found = { tampered, tamperTick: ev.tick };
            break search;
          }
        }
      }
    }
    expect(found).not.toBeNull();
    const { tampered, tamperTick } = found!;

    const replayed = replayRun(manifest, roster, "seed-1", tampered, 300);
    expect(replayed.haltedAtTick).not.toBeNull();
    expect(replayed.haltedAtTick!).toBeGreaterThan(tamperTick);

    const report = verifyReplay(manifest, roster, "seed-1", tampered, live.checkpoints, 300);
    expect(report.ok).toBe(false);
    expect(report.firstDivergentTick).toBe(tamperTick);
  });
});
