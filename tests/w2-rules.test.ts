import { describe, it, expect } from "vitest";
import { createW2InitialState, seasonAt2, shelterAt } from "../src/world2/state.js";
import { environmentStep2, needsStep2, reproductionStep2 } from "../src/world2/rules.js";
import type { W2Genome2 } from "../src/world2/rules.js";
import type { W2SemanticEvent } from "../src/schema/world2.js";
import { makeW2TestManifest, makeW2TestRoster } from "./w2-helpers.js";

describe("w2 rules", () => {
  it("founders get seeded memory of the nearest sites, and empty carry", () => {
    const m = makeW2TestManifest(); // founderSeededMemory = 3
    const s = createW2InitialState(m, makeW2TestRoster("r1"), "r1");
    for (const npc of s.npcs) {
      expect(npc.memory.length).toBe(3);
      expect(npc.memory.every((e) => e.seenTick === 0)).toBe(true);
      expect(Object.values(npc.carry).every((v) => v === 0)).toBe(true);
      expect(npc.goal).toBeNull();
    }
    expect(s.buildings).toEqual([]);
  });
  it("firstSummerBonusTicks stretches only the first summer and shifts later boundaries by exactly the bonus", () => {
    const base = makeW2TestManifest(); // L = 400, bonus = 0
    const bonus = makeW2TestManifest({ firstSummerBonusTicks: 300 });

    // bonus = 0 keeps the frozen v2.0 rhythm
    expect(seasonAt2(0, base)).toBe("summer");
    expect(seasonAt2(399, base)).toBe("summer");
    expect(seasonAt2(400, base)).toBe("winter");
    expect(seasonAt2(800, base)).toBe("summer");

    // first summer now runs 0..699 (L + bonus ticks)
    expect(seasonAt2(0, bonus)).toBe("summer");
    expect(seasonAt2(400, bonus)).toBe("summer");
    expect(seasonAt2(699, bonus)).toBe("summer");
    // first winter runs 700..1099 -- a normal-length season
    expect(seasonAt2(700, bonus)).toBe("winter");
    expect(seasonAt2(1099, bonus)).toBe("winter");
    expect(seasonAt2(1100, bonus)).toBe("summer");
    // every later season keeps seasonLengthTicks
    expect(seasonAt2(1499, bonus)).toBe("summer");
    expect(seasonAt2(1500, bonus)).toBe("winter");
  });

  it("cold damage applies only when not standing on a shelter", () => {
    const m = { ...makeW2TestManifest(), seasonLengthTicks: 1 }; // tick 1 = winter
    const s = createW2InitialState(m, makeW2TestRoster("r2"), "r2");
    s.tick = 1;
    expect(seasonAt2(1, m)).toBe("winter");
    const [a, b] = s.npcs;
    s.buildings.push({
      id: "sh-1",
      kind: "shelter",
      pos: { ...a!.pos },
      ownerNpcId: a!.npcId,
      ownerLineageId: a!.lineageId,
      builtTick: 0,
      store: { berry: 0, wood: 0, stone: 0, gold: 0 },
    });
    b!.pos = { x: (a!.pos.x + 5) % 64, y: a!.pos.y };
    const hpA = a!.hp,
      hpB = b!.hp;
    needsStep2(s, m, []);
    expect(shelterAt(s, a!.pos)).not.toBeNull();
    expect(hpA - a!.hp).toBeLessThan(hpB - b!.hp); // 有庇护所的掉血更少
  });
  it("death cause is the largest cumulative damage source, not the last one applied", () => {
    // Winter, no shelter, energy 0: starvation (5/tick) outweighs cold (3/tick),
    // but cold is applied last. The pre-Task-8 rule labelled this "cold".
    const m = { ...makeW2TestManifest(), seasonLengthTicks: 1 };
    const s = createW2InitialState(m, makeW2TestRoster("r-cause"), "r-cause");
    s.tick = 1;
    const npc = s.npcs[0]!;
    npc.energy = 0;
    npc.hp = 40;
    const events: W2SemanticEvent[] = [];
    for (let i = 0; i < 10 && npc.alive; i++) needsStep2(s, m, events);
    expect(npc.alive).toBe(false);
    expect(npc.damage.starvation).toBeGreaterThan(npc.damage.cold);
    expect(npc.deathCause).toBe("starvation");
    expect(events.some((e) => e.kind === "death" && e.data["cause"] === "starvation")).toBe(true);
  });

  it("a zero-damage source is never blamed for a death", () => {
    // winterColdHpDrain = 0 must not produce a "cold" death cause.
    const m = { ...makeW2TestManifest(), seasonLengthTicks: 1, winterColdHpDrain: 0 };
    const s = createW2InitialState(m, makeW2TestRoster("r-cause0"), "r-cause0");
    s.tick = 1;
    const npc = s.npcs[0]!;
    npc.energy = 0;
    npc.hp = 20;
    for (let i = 0; i < 10 && npc.alive; i++) needsStep2(s, m, []);
    expect(npc.alive).toBe(false);
    expect(npc.damage.cold).toBe(0);
    expect(npc.deathCause).toBe("starvation");
  });

  it("sites regrow deterministically and never exceed capacity", () => {
    const m = makeW2TestManifest();
    const s = createW2InitialState(m, makeW2TestRoster("r3"), "r3");
    for (const site of s.sites) site.stock = 0;
    for (let t = 1; t <= 500; t++) {
      s.tick = t;
      environmentStep2(s, m, "r3", []);
    }
    for (const site of s.sites) {
      expect(site.stock).toBeGreaterThanOrEqual(0);
      expect(site.stock).toBeLessThanOrEqual(site.capacity);
    }
    const again = createW2InitialState(m, makeW2TestRoster("r3"), "r3");
    for (const site of again.sites) site.stock = 0;
    for (let t = 1; t <= 500; t++) {
      again.tick = t;
      environmentStep2(again, m, "r3", []);
    }
    expect(again.sites.map((x) => x.stock)).toEqual(s.sites.map((x) => x.stock));
  });

  it("reproductionStep2 pairs adjacent fertile npcs, spends energy, sets cooldown, and invokes the injected breedFn", () => {
    const m = makeW2TestManifest({ maxPopulation: 60, birthChancePpm: 1_000_000 }); // guarantee birth roll
    const s = createW2InitialState(m, makeW2TestRoster("r4"), "r4");
    // Make first two founders adjacent, adult, well-fed and off cooldown.
    const [a, b] = s.npcs;
    a!.pos = { x: 10, y: 10 };
    b!.pos = { x: 10, y: 11 };
    a!.birthTick = 0;
    b!.birthTick = 0;
    for (const npc of [a!, b!]) {
      npc.energy = m.reproEnergyMin;
      npc.reproCooldownUntil = 0;
    }
    s.tick = 1000; // age 1000, within [adultAgeTicks=800, elderAgeTicks=2400]

    let calls = 0;
    const stubBreed: (
      pa: W2Genome2,
      pb: W2Genome2,
      childId: string,
      seedRoot: string,
      tick: number,
    ) => W2Genome2 = (pa, pb, childId) => {
      calls++;
      return {
        lineageId: `${pa.lineageId}+${pb.lineageId}`,
        generation: Math.max(pa.generation, pb.generation) + 1,
        identity: pa.identity,
        policy: pa.policy,
        beliefs: [],
        memory: [],
      };
    };

    const beforeCount = s.npcs.length;
    const events: W2SemanticEvent[] = [];
    reproductionStep2(s, m, "r4", events, stubBreed);

    expect(calls).toBe(1);
    expect(s.npcs.length).toBe(beforeCount + 1);
    const child = s.npcs[s.npcs.length - 1]!;
    expect(child.parents).toEqual([a!.npcId, b!.npcId]);
    expect(child.generation).toBe(1);
    expect(child.goal).toBeNull();
    expect(Object.values(child.carry).every((v) => v === 0)).toBe(true);
    expect(a!.energy).toBe(m.reproEnergyMin - m.reproEnergyCost);
    expect(a!.reproCooldownUntil).toBe(s.tick + m.reproCooldownTicks);
  });
});
