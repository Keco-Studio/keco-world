import { describe, it, expect } from "vitest";
import { reproductionStep } from "../src/world/rules.js";
import { createInitialState } from "../src/world/state.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import type { SemanticEvent } from "../src/schema/log.js";

const manifest = makeTestManifest(); // birthChancePpm 100_000 (10%)

function eligiblePair() {
  const s = createInitialState(manifest, makeTestRoster(2), "seed-1");
  for (const n of s.npcs) { n.pos = { x: 5, y: 5 }; n.energy = 1000; n.birthTick = -150; n.reproCooldownUntil = 0; }
  return s;
}

describe("reproduction", () => {
  it("adjacent eligible pair eventually births; is deterministic", () => {
    const run = () => {
      const s = eligiblePair();
      const ev: SemanticEvent[] = [];
      for (let t = 1; t <= 200; t++) {
        s.tick = t;
        for (const n of s.npcs) { n.energy = 1000; }   // keep eligible; cooldown still gates
        reproductionStep(s, manifest, "seed-1", ev);
      }
      return { pop: s.npcs.length, births: ev.filter((e) => e.kind === "birth").length, s };
    };
    const a = run(); const b = run();
    expect(a.births).toBeGreaterThan(0);
    expect(a.births).toBe(b.births);
    expect(a.pop).toBe(2 + a.births);
  });
  it("birth costs energy and sets cooldown on both parents", () => {
    const s = eligiblePair();
    const ev: SemanticEvent[] = [];
    let t = 0;
    while (ev.length === 0 && t < 500) { s.tick = ++t; s.npcs[0]!.energy = 1000; s.npcs[1]!.energy = 1000; reproductionStep(s, manifest, "seed-1", ev); }
    expect(ev.length).toBeGreaterThan(0);
    const [a, b] = [s.npcs[0]!, s.npcs[1]!];
    expect(a.energy).toBe(1000 - manifest.reproEnergyCost);
    expect(b.energy).toBe(1000 - manifest.reproEnergyCost);
    expect(a.reproCooldownUntil).toBe(t + manifest.reproCooldownTicks);
  });
  it("child carries bred genome, lineage and parents", () => {
    const s = eligiblePair();
    const ev: SemanticEvent[] = [];
    let t = 0;
    while (ev.length === 0 && t < 500) { s.tick = ++t; s.npcs[0]!.energy = 1000; s.npcs[1]!.energy = 1000; reproductionStep(s, manifest, "seed-1", ev); }
    const child = s.npcs[2]!;
    expect(child.npcId).toBe(`child-${t}-0`);
    expect(child.generation).toBe(1);
    expect(child.parents).toEqual([s.npcs[0]!.npcId, s.npcs[1]!.npcId]);
    expect(child.hp).toBe(manifest.childStartHp);
    expect(child.birthTick).toBe(t);
    expect(child.genomeHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("ineligible npcs never breed: age, energy, cooldown, distance", () => {
    const cases: ((s: ReturnType<typeof eligiblePair>) => void)[] = [
      (s) => { s.npcs[0]!.birthTick = 10_000; },                   // age stays < adultAgeTicks forever within test window
      (s) => { s.npcs[0]!.energy = manifest.reproEnergyMin - 1; },
      (s) => { s.npcs[0]!.reproCooldownUntil = 10_000; },
      (s) => { s.npcs[0]!.pos = { x: 0, y: 0 }; },
    ];
    for (const mutate of cases) {
      const s = eligiblePair();
      mutate(s);
      const ev: SemanticEvent[] = [];
      for (let t = 1; t <= 300; t++) { s.tick = t; reproductionStep(s, manifest, "seed-1", ev); }
      expect(ev.length).toBe(0);
    }
  });
  it("population cap blocks births", () => {
    const s = eligiblePair();
    const filler = createInitialState(makeTestManifest({ maxPopulation: 400 }), makeTestRoster(2), "x");
    while (s.npcs.length < manifest.maxPopulation) {
      s.npcs.push({ ...filler.npcs[0]!, npcId: `pad-${s.npcs.length}`, pos: { x: 0, y: 0 } });
    }
    const ev: SemanticEvent[] = [];
    for (let t = 1; t <= 300; t++) { s.tick = t; s.npcs[0]!.energy = 1000; s.npcs[1]!.energy = 1000; reproductionStep(s, manifest, "seed-1", ev); }
    expect(ev.filter((e) => e.kind === "birth").length).toBe(0);
  });
});
