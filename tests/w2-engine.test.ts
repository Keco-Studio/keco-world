import { describe, it, expect } from "vitest";
import { runSim2, runFromState2, verifyLogChain2 } from "../src/sim/engine2.js";
import type { W2Action } from "../src/world2/actions.js";
import { breed2 } from "../src/life/genome2.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { createW2InitialState } from "../src/world2/state.js";
import { makeW2TestManifest, makeW2TestRoster } from "./w2-helpers.js";
import { GOAL_KEYS, type GoalKey } from "../src/schema/world2.js";
import type { W2Genome2 } from "../src/world2/rules.js";

const manifest = makeW2TestManifest();

describe("engine2", () => {
  it("same seed twice -> identical final state hash, action log, checkpoints", () => {
    const roster = makeW2TestRoster("engine2-seed-1");
    const a = runSim2(manifest, roster, "engine2-seed-1", { ticks: 500 });
    const b = runSim2(manifest, roster, "engine2-seed-1", { ticks: 500 });
    expect(hashCanonical(a.finalState)).toBe(hashCanonical(b.finalState));
    expect(a.actionLog).toEqual(b.actionLog);
    expect(a.checkpoints).toEqual(b.checkpoints);
  });

  it("chunked 3x1000-tick run matches a single continuous 3000-tick run byte-for-byte", () => {
    const roster = makeW2TestRoster("engine2-chunk");
    const continuous = runSim2(manifest, roster, "engine2-chunk", { ticks: 3000 });

    const initial = createW2InitialState(manifest, roster, "engine2-chunk");
    let chunkState = initial;
    for (let i = 0; i < 3; i++) {
      const r = runFromState2(chunkState, manifest, "engine2-chunk", { ticks: 1000 });
      chunkState = r.finalState;
    }
    expect(hashCanonical(chunkState)).toBe(hashCanonical(continuous.finalState));
  });

  it("feeding the recorded actionLog back as injectedActions reproduces the same final hash, and verifyLogChain2 holds", () => {
    const roster = makeW2TestRoster("engine2-replay");
    const original = runSim2(manifest, roster, "engine2-replay", { ticks: 800 });
    expect(verifyLogChain2(original.actionLog)).toBe(true);
    expect(original.haltedAtTick).toBeNull();

    const injectedActions = new Map<
      string,
      { action: W2Action; actionSource: "reflex" | "goal"; goal: GoalKey | null }
    >();
    for (const ev of original.actionLog) {
      injectedActions.set(`${ev.tick}:${ev.npcId}`, {
        action: ev.action,
        actionSource: ev.actionSource,
        goal: ev.goal,
      });
    }

    const replay = runSim2(manifest, roster, "engine2-replay", { ticks: 800, injectedActions });
    expect(replay.haltedAtTick).toBeNull();
    expect(hashCanonical(replay.finalState)).toBe(hashCanonical(original.finalState));
    expect(verifyLogChain2(replay.actionLog)).toBe(true);
    expect(replay.actionLog).toEqual(original.actionLog);
  });

  it("a tampered replay (illegal injected action) halts early instead of throwing", () => {
    const roster = makeW2TestRoster("engine2-tamper");
    const original = runSim2(manifest, roster, "engine2-tamper", { ticks: 400 });
    expect(original.actionLog.length).toBeGreaterThan(0);

    const injectedActions = new Map<
      string,
      { action: W2Action; actionSource: "reflex" | "goal"; goal: GoalKey | null }
    >();
    for (const ev of original.actionLog) {
      injectedActions.set(`${ev.tick}:${ev.npcId}`, {
        action: ev.action,
        actionSource: ev.actionSource,
        goal: ev.goal,
      });
    }
    // Corrupt one mid-run action into something illegal: move ten squares away.
    const mid = original.actionLog[Math.floor(original.actionLog.length / 2)]!;
    injectedActions.set(`${mid.tick}:${mid.npcId}`, {
      action: { verb: "move", to: { x: manifest.gridWidth + 50, y: manifest.gridHeight + 50 } },
      actionSource: mid.actionSource,
      goal: mid.goal,
    });

    const replay = runSim2(manifest, roster, "engine2-tamper", { ticks: 400, injectedActions });
    expect(replay.haltedAtTick).not.toBeNull();
    expect(replay.haltedAtTick).toBeLessThanOrEqual(400);
  });

  it("action log events carry a goal audit field; reflex decisions have goal === null, goal decisions have goal !== null", () => {
    const roster = makeW2TestRoster("engine2-goalfield");
    const r = runSim2(manifest, roster, "engine2-goalfield", { ticks: 600 });
    expect(r.actionLog.length).toBeGreaterThan(0);
    for (const ev of r.actionLog) {
      expect("goal" in ev).toBe(true);
      expect(ev.actionSource === "reflex" || ev.actionSource === "goal").toBe(true);
      if (ev.actionSource === "reflex") {
        expect(ev.goal).toBeNull();
      } else {
        expect(ev.goal).not.toBeNull();
        expect(GOAL_KEYS).toContain(ev.goal);
      }
    }
    const sources = new Set(r.actionLog.map((e) => e.actionSource));
    expect(sources.has("goal")).toBe(true);
  });

  it("checkpoints land at the fixed interval and tickHashes cover every tick when requested", () => {
    const roster = makeW2TestRoster("engine2-checkpoint");
    const r = runSim2(manifest, roster, "engine2-checkpoint", { ticks: 250, collectTickHashes: true });
    expect(r.checkpoints.map((c) => c.tick)).toEqual([100, 200]);
    expect(r.tickHashes.length).toBe(250);
    expect(r.tickHashes[0]!.tick).toBe(1);
  });

  it("breed2 produces goalWeights for every goal key within [0,1000], and memory capped at MEMORY_INHERIT_MAX (6)", () => {
    const roster = makeW2TestRoster("engine2-breed");
    const genomeOf = (npcId: string): W2Genome2 => {
      const entry = roster.find((r) => r.npcId === npcId)!;
      return {
        lineageId: entry.npcId,
        generation: 0,
        identity: entry.identity,
        policy: entry.policy,
        beliefs: entry.beliefs,
        memory: [],
      };
    };
    const a = genomeOf("npc-1");
    a.memory = Array.from({ length: 10 }, (_, i) => ({
      kind: "berry" as const,
      pos: { x: i, y: i },
      lastStock: 1,
      seenTick: i,
      ownerLineageId: null,
    }));
    const b = genomeOf("npc-2");

    for (let i = 0; i < 50; i++) {
      const child = breed2(a, b, `child-test-${i}`, "engine2-breed", 100);
      expect(Object.keys(child.policy.goalWeights).sort()).toEqual([...GOAL_KEYS].sort());
      for (const key of GOAL_KEYS) {
        expect(child.policy.goalWeights[key]).toBeGreaterThanOrEqual(0);
        expect(child.policy.goalWeights[key]).toBeLessThanOrEqual(1000);
      }
      expect(child.policy.commitmentThreshold).toBeGreaterThanOrEqual(0);
      expect(child.policy.commitmentThreshold).toBeLessThanOrEqual(1000);
      expect(child.memory.length).toBeLessThanOrEqual(6);
      expect(child.lineageId).toBe(a.lineageId);
      expect(child.generation).toBe(1);
    }
  });

  it("breed2 is deterministic for a fixed (childKey, seedRoot, tick)", () => {
    const roster = makeW2TestRoster("engine2-breed-det");
    const genomeOf = (npcId: string): W2Genome2 => {
      const entry = roster.find((r) => r.npcId === npcId)!;
      return { lineageId: entry.npcId, generation: 2, identity: entry.identity, policy: entry.policy, beliefs: entry.beliefs, memory: [] };
    };
    const a = genomeOf("npc-1");
    const b = genomeOf("npc-2");
    const c1 = breed2(a, b, "child-x", "engine2-breed-det", 42);
    const c2 = breed2(a, b, "child-x", "engine2-breed-det", 42);
    expect(c1).toEqual(c2);
  });
});
