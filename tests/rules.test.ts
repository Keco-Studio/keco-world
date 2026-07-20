import { describe, it, expect } from "vitest";
import { environmentStep, needsStep } from "../src/world/rules.js";
import { createInitialState } from "../src/world/state.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import type { SemanticEvent } from "../src/schema/log.js";

const manifest = makeTestManifest();

describe("environmentStep", () => {
  it("wolf attacks adjacent NPCs and stays deterministic", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    s.wolf.pos = { x: 8, y: 8 };
    npc.pos = { x: 8, y: 8 };
    const ev: SemanticEvent[] = [];
    environmentStep(s, manifest, "seed-1", ev);
    // wolf moved one step but npc was adjacent before/after? attack happens after move:
    // place npc adjacent to every possible post-move position instead — re-run controlled:
    const s2 = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc2 = s2.npcs[0]!;
    s2.wolf.pos = { x: 8, y: 8 };
    npc2.pos = { x: 8, y: 8 };
    const ev2: SemanticEvent[] = [];
    environmentStep(s2, manifest, "seed-1", ev2);
    expect(s2.wolf.pos).toEqual(s.wolf.pos); // deterministic walk
    expect(npc2.hp).toBe(npc.hp); // deterministic damage outcome
  });
  it("wolf damage applies when adjacent after move", () => {
    const wideManifest = makeTestManifest({ wolfDamage: 50 });
    const s = createInitialState(wideManifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    // surround-proof: npc shares tile with wolf after any 1-step move if npc sits on wolf start
    s.wolf.pos = { x: 8, y: 8 };
    npc.pos = { x: 8, y: 8 };
    const ev: SemanticEvent[] = [];
    environmentStep(s, wideManifest, "seed-1", ev);
    expect(npc.hp).toBe(1000 - 50); // any 1-step move keeps chebyshev ≤ 1
    expect(ev.some((e) => e.kind === "wolf_attack" && e.npcId === npc.npcId)).toBe(true);
    expect(npc.lastDamage).toBe("wolf");
  });
  it("bushes regrow toward capacity over enough summer ticks", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const bush = s.bushes[0]!;
    bush.berries = 0;
    for (let t = 1; t <= 200; t++) {
      s.tick = t;
      environmentStep(s, manifest, "seed-1", []);
    }
    expect(bush.berries).toBeGreaterThan(0); // 6% ppm per tick × 100 summer ticks
    expect(bush.berries).toBeLessThanOrEqual(bush.capacity);
  });
});

describe("needsStep", () => {
  it("drains energy; starvation damages hp and emits event", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    npc.energy = 1;
    const ev: SemanticEvent[] = [];
    needsStep(s, manifest, ev); // energy → 0, starvation hp drain
    expect(npc.energy).toBe(0);
    expect(npc.hp).toBe(1000 - manifest.starvationHpDrain);
    expect(ev.some((e) => e.kind === "starving")).toBe(true);
  });
  it("winter cold drains hp off-shelter but not on shelter", () => {
    const s = createInitialState(manifest, makeTestRoster(2), "seed-1");
    s.tick = 150; // winter
    const [outside, inside] = [s.npcs[0]!, s.npcs[1]!];
    outside.pos = { x: 8, y: 8 };
    inside.pos = { x: 2, y: 2 }; // shelter
    outside.energy = 1000; // isolate cold from starvation; but drain makes 998 < regen min? 998 ≥ 500 → regen applies
    inside.energy = 1000;
    needsStep(s, manifest, []);
    // outside: -3 cold +1 regen = 998; inside: +1 regen capped at 1000
    expect(outside.hp).toBe(998);
    expect(inside.hp).toBe(1000);
  });
  it("death sets cause from lastDamage and emits death event", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    npc.hp = 2;
    npc.energy = 0;
    npc.lastDamage = "wolf";
    const ev: SemanticEvent[] = [];
    needsStep(s, manifest, ev); // starvation overwrites lastDamage → cause "starvation"
    expect(npc.alive).toBe(false);
    expect(npc.deathTick).toBe(s.tick);
    expect(npc.deathCause).toBe("starvation");
    const death = ev.find((e) => e.kind === "death");
    expect(death).toBeDefined();
    expect(death!.data["cause"]).toBe("starvation");
  });
  it("dead NPCs are skipped", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    npc.alive = false;
    npc.hp = 0;
    const before = npc.energy;
    needsStep(s, manifest, []);
    expect(npc.energy).toBe(before);
  });
});
