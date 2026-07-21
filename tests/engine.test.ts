import { describe, it, expect } from "vitest";
import { runSim, verifyLogChain } from "../src/sim/engine.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import { CanonicalActionEventS } from "../src/schema/log.js";

const manifest = makeTestManifest();

describe("engine", () => {
  it("same seed → identical final state, log, checkpoints", () => {
    const roster = makeTestRoster(5);
    const a = runSim(manifest, roster, "seed-1", { ticks: 300 });
    const b = runSim(manifest, roster, "seed-1", { ticks: 300 });
    expect(hashCanonical(a.finalState)).toBe(hashCanonical(b.finalState));
    expect(a.actionLog).toEqual(b.actionLog);
    expect(a.checkpoints).toEqual(b.checkpoints);
  });
  it("different seed → different trajectory", () => {
    const roster = makeTestRoster(5);
    const a = runSim(manifest, roster, "seed-1", { ticks: 300 });
    const b = runSim(manifest, roster, "seed-2", { ticks: 300 });
    expect(hashCanonical(a.finalState)).not.toBe(hashCanonical(b.finalState));
  });
  it("action log entries validate and hash-chain correctly", () => {
    const r = runSim(manifest, makeTestRoster(3), "seed-1", { ticks: 50 });
    for (const ev of r.actionLog) CanonicalActionEventS.parse(ev);
    expect(r.actionLog[0]!.previousEventHash).toBeNull();
    expect(verifyLogChain(r.actionLog)).toBe(true);
    const tampered = r.actionLog.map((e) => ({ ...e }));
    tampered[10]!.observationHash = "tampered-hash";
    expect(verifyLogChain(tampered)).toBe(false);
  });
  it("checkpoints at fixed interval", () => {
    const r = runSim(manifest, makeTestRoster(3), "seed-1", { ticks: 200 });
    expect(r.checkpoints.map((c) => c.tick)).toEqual([50, 100, 150, 200]);
  });
  it("25-NPC 1200-tick smoke: bounded state, no crash, chain valid", () => {
    const roster = makeTestRoster(25);
    const r = runSim(manifest, roster, "smoke-seed", { ticks: 1200 });
    for (const n of r.finalState.npcs) {
      expect(n.hp).toBeGreaterThanOrEqual(0);
      expect(n.hp).toBeLessThanOrEqual(manifest.maxHp);
      expect(n.energy).toBeGreaterThanOrEqual(0);
      expect(n.energy).toBeLessThanOrEqual(manifest.maxEnergy);
    }
    expect(verifyLogChain(r.actionLog)).toBe(true);
    expect(r.events.some((e) => e.kind === "season_change")).toBe(true);
    // dead NPCs stop producing actions
    for (const n of r.finalState.npcs.filter((n) => !n.alive)) {
      const after = r.actionLog.filter((e) => e.npcId === n.npcId && e.tick > n.deathTick!);
      expect(after).toEqual([]);
    }
  });
  it("collectTickHashes returns one hash per tick", () => {
    const r = runSim(manifest, makeTestRoster(2), "seed-1", { ticks: 40, collectTickHashes: true });
    expect(r.tickHashes.length).toBe(40);
    expect(r.tickHashes[0]!.tick).toBe(1);
  });
});
