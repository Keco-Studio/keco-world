import { describe, it, expect } from "vitest";
import { decayBeliefs, beliefFormationStep, BELIEF_CAP, BELIEF_FLOOR, REINFORCE_STEP } from "../src/mind/beliefs.js";
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
});
