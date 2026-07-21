import { describe, it, expect } from "vitest";
import { needsStep } from "../src/world/rules.js";
import { createInitialState } from "../src/world/state.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import type { SemanticEvent } from "../src/schema/log.js";

const manifest = makeTestManifest(); // elderAgeTicks 400, senescenceHpDrain 5

describe("aging", () => {
  it("elders take senescence damage and die of old_age", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    npc.birthTick = -1000;            // age 1000+ → elder
    npc.energy = 1000;
    s.tick = 1;
    const ev: SemanticEvent[] = [];
    needsStep(s, manifest, ev);
    expect(npc.hp).toBe(1000 - 5 + 1); // senescence 5, regen 1
    expect(npc.lastDamage).toBe("old_age");
    npc.hp = 3;
    needsStep(s, manifest, ev);
    expect(npc.alive).toBe(false);
    expect(npc.deathCause).toBe("old_age");
  });
  it("adults below elder age are untouched by senescence", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    npc.birthTick = 0;
    s.tick = manifest.elderAgeTicks;   // age == elder → not yet (strict >)
    npc.energy = 1000;
    needsStep(s, manifest, []);
    expect(npc.hp).toBe(1000);
  });
  it("starving event fires only on the transition into starvation", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    npc.birthTick = 0;
    npc.energy = 1;
    const ev: SemanticEvent[] = [];
    s.tick = 1;
    needsStep(s, manifest, ev);       // 1 → 0: transition, event
    s.tick = 2;
    needsStep(s, manifest, ev);       // stays 0: no event, hp still drains
    expect(ev.filter((e) => e.kind === "starving").length).toBe(1);
    expect(npc.hp).toBeLessThan(1000 - manifest.starvationHpDrain);
  });
});
