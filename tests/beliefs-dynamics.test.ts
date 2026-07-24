import { describe, it, expect } from "vitest";
import {
  decayBeliefs,
  beliefFormationStep,
  BELIEF_CAP,
  BELIEF_FLOOR,
  REINFORCE_STEP,
  WOLF_PROPOSITIONS,
  HUNGER_PROPOSITIONS,
  WINTER_PROPOSITIONS,
} from "../src/mind/beliefs.js";
import { createInitialState } from "../src/world/state.js";
import { makeTestManifest, makeTestRoster, makeTestBelief } from "./helpers.js";
import type { SemanticEvent } from "../src/schema/log.js";

const manifest = makeTestManifest();

function fresh() {
  const s = createInitialState(manifest, makeTestRoster(2), "seed-1");
  return { s, npc: s.npcs[0]! };
}

describe("belief dynamics", () => {
  it("decays only on century ticks and forgets below the floor", () => {
    const { npc } = fresh();
    npc.beliefs = [makeTestBelief({ confidence: 500, decayPer100: 30 }), makeTestBelief({ proposition: "x", confidence: BELIEF_FLOOR + 10, decayPer100: 30 })];
    decayBeliefs(npc, 150);                       // not a century tick
    expect(npc.beliefs[0]!.confidence).toBe(500);
    decayBeliefs(npc, 200);
    expect(npc.beliefs[0]!.confidence).toBe(470);
    expect(npc.beliefs.length).toBe(1);           // second dropped below floor
  });
  it("wolf attack forms a shelter belief and emits belief_formed", () => {
    const { s, npc } = fresh();
    s.tick = 50;
    const tickEvents: SemanticEvent[] = [{ tick: 50, kind: "wolf_attack", npcId: npc.npcId, data: { damage: 50 } }];
    const events: SemanticEvent[] = [];
    beliefFormationStep(s, events, tickEvents);
    expect(npc.beliefs.some((b) => b.effect.target === "w:shelter")).toBe(true);
    expect(events.some((e) => e.kind === "belief_formed" && e.npcId === npc.npcId)).toBe(true);
  });
  it("repeat experience reinforces instead of duplicating", () => {
    const { s, npc } = fresh();
    s.tick = 50;
    const ev: SemanticEvent[] = [];
    const hit: SemanticEvent[] = [{ tick: 50, kind: "wolf_attack", npcId: npc.npcId, data: { damage: 50 } }];
    beliefFormationStep(s, ev, hit);
    const confAfterFirst = npc.beliefs[0]!.confidence;
    beliefFormationStep(s, ev, hit);
    expect(npc.beliefs.length).toBe(1);
    expect(npc.beliefs[0]!.confidence).toBe(Math.min(1000, confAfterFirst + REINFORCE_STEP));
  });
  it("cap evicts the weakest belief", () => {
    const { s, npc } = fresh();
    s.tick = 50;
    npc.beliefs = Array.from({ length: BELIEF_CAP }, (_, i) =>
      makeTestBelief({ proposition: `b${i}`, effect: { target: "w:explore", modifier: -50, condition: null }, confidence: 200 + i }),
    );
    beliefFormationStep(s, [], [{ tick: 50, kind: "wolf_attack", npcId: npc.npcId, data: { damage: 50 } }]);
    expect(npc.beliefs.length).toBe(BELIEF_CAP);
    expect(npc.beliefs.some((b) => b.proposition === "b0")).toBe(false);   // weakest evicted
    expect(npc.beliefs.some((b) => b.effect.target === "w:shelter")).toBe(true);
  });
  it("hard winter forms a conditional shelter belief on survivors", () => {
    const { s, npc } = fresh();
    s.tick = 200;
    npc.hp = 400;
    beliefFormationStep(s, [], [{ tick: 200, kind: "season_change", npcId: null, data: { season: "summer" } }]);
    const b = npc.beliefs.find((x) => x.effect.condition === "winter");
    expect(b).toBeDefined();
    expect(s.npcs[1]!.beliefs.length).toBe(0);    // healthy npc (hp 1000) unaffected
  });
  it("dead npc never gains beliefs from starving events", () => {
    const { s, npc } = fresh();
    s.tick = 150;
    npc.alive = false;
    npc.hp = 0;
    const events: SemanticEvent[] = [];
    const tickEvents: SemanticEvent[] = [{ tick: 150, kind: "starving", npcId: npc.npcId, data: {} }];
    beliefFormationStep(s, events, tickEvents);
    expect(npc.beliefs.length).toBe(0);
    expect(events.some((e) => e.kind === "belief_formed" && e.npcId === npc.npcId)).toBe(false);
  });

  // De-blind fix regression: the three formation rules used to emit one fixed
  // English sentence apiece (a lexical arm tell). Now each draws from a 3-variant
  // Chinese pool, chosen deterministically from (npcId, tick) since
  // beliefFormationStep has no seedRoot in scope for drawInt.
  it("formation propositions are drawn from the localized pools, deterministically", () => {
    const { s, npc } = fresh();
    s.tick = 50;
    beliefFormationStep(s, [], [{ tick: 50, kind: "wolf_attack", npcId: npc.npcId, data: { damage: 50 } }]);
    const wolfBelief = npc.beliefs.find((b) => b.effect.target === "w:shelter" && b.effect.condition === null)!;
    expect(WOLF_PROPOSITIONS).toContain(wolfBelief.proposition);
    expect(wolfBelief.proposition).not.toMatch(/[a-zA-Z]/); // no leftover English

    const { s: s2, npc: npc2 } = fresh();
    s2.tick = 150;
    npc2.hp = 400;
    beliefFormationStep(s2, [], [{ tick: 150, kind: "starving", npcId: npc2.npcId, data: {} }]);
    const hungerBelief = npc2.beliefs.find((b) => b.effect.target === "w:forage")!;
    expect(HUNGER_PROPOSITIONS).toContain(hungerBelief.proposition);
    expect(hungerBelief.proposition).not.toMatch(/[a-zA-Z]/);

    const { s: s3, npc: npc3 } = fresh();
    s3.tick = 200;
    npc3.hp = 400;
    beliefFormationStep(s3, [], [{ tick: 200, kind: "season_change", npcId: null, data: { season: "summer" } }]);
    const winterBelief = npc3.beliefs.find((b) => b.effect.condition === "winter")!;
    expect(WINTER_PROPOSITIONS).toContain(winterBelief.proposition);
    expect(winterBelief.proposition).not.toMatch(/[a-zA-Z]/);

    // determinism: same (npcId, tick) -> same variant every time.
    const { s: s4, npc: npc4 } = fresh();
    s4.tick = 50;
    beliefFormationStep(s4, [], [{ tick: 50, kind: "wolf_attack", npcId: npc4.npcId, data: { damage: 50 } }]);
    const wolfBelief2 = npc4.beliefs.find((b) => b.effect.target === "w:shelter")!;
    expect(wolfBelief2.proposition).toBe(wolfBelief.proposition); // same npcId ("npc-1"), same tick
  });

  it("varying the proposition text does not break reinforce-or-add dedup (keyed on effect target+sign, not text)", () => {
    const { s, npc } = fresh();
    // Two wolf_attack events at different ticks: the variant text may differ, but
    // dedup is keyed on (effect.target, sign(modifier)), so this must still
    // reinforce a single belief object rather than create a second one.
    s.tick = 10;
    beliefFormationStep(s, [], [{ tick: 10, kind: "wolf_attack", npcId: npc.npcId, data: { damage: 50 } }]);
    const firstProposition = npc.beliefs[0]!.proposition;
    const confAfterFirst = npc.beliefs[0]!.confidence;

    s.tick = 987; // different tick -> plausibly a different variant, still same npc
    beliefFormationStep(s, [], [{ tick: 987, kind: "wolf_attack", npcId: npc.npcId, data: { damage: 50 } }]);

    expect(npc.beliefs.length).toBe(1); // reinforced, not duplicated
    expect(npc.beliefs[0]!.proposition).toBe(firstProposition); // reinforce keeps the ORIGINAL text
    expect(npc.beliefs[0]!.confidence).toBe(Math.min(1000, confAfterFirst + REINFORCE_STEP));
  });
});
