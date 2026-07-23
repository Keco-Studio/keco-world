import { describe, it, expect } from "vitest";
import { BeliefS, PolicyS, RosterEntryS, WorldManifestS, SCHEMA_VERSION, EFFECT_TARGETS } from "../src/schema/core.js";
import { CanonicalActionEventS, SemanticEventS } from "../src/schema/log.js";
import { makeTestManifest, makeTestRoster, makeTestBelief } from "./helpers.js";

describe("genome schemas", () => {
  it("schema version bumped", () => {
    expect(SCHEMA_VERSION).toBe("phase1a-v4");
  });
  it("belief validates and rejects out-of-range modifiers", () => {
    BeliefS.parse(makeTestBelief());
    expect(() => BeliefS.parse(makeTestBelief({ effect: { target: "w:forage", modifier: 400, condition: null } }))).toThrow();
    expect(() => BeliefS.parse(makeTestBelief({ effect: { target: "w:hoard" as never, modifier: 0, condition: null } }))).toThrow();
  });
  it("policy requires deliberationEpsilon", () => {
    const p = makeTestRoster(1)[0]!.policy;
    expect(PolicyS.parse(p).deliberationEpsilon).toBe(60);
    const { deliberationEpsilon: _e, ...rest } = p;
    expect(() => PolicyS.parse(rest)).toThrow();
  });
  it("roster entries carry beliefs; manifest carries reproduction params", () => {
    RosterEntryS.parse({ ...makeTestRoster(1)[0]!, beliefs: [makeTestBelief()] });
    const m = WorldManifestS.parse(makeTestManifest());
    expect(m.maxPopulation).toBe(40);
    expect(m.birthChancePpm).toBe(100_000);
  });
  it("log accepts resolver actionSource and birth/belief_formed events", () => {
    CanonicalActionEventS.parse({
      eventId: "1:npc-1", tick: 1, npcId: "npc-1", observationHash: "a".repeat(64),
      action: { verb: "idle" }, actionSource: "resolver",
      deliberationTriggered: false, energyCharged: 0, patronInfluence: false, previousEventHash: null,
    });
    SemanticEventS.parse({ tick: 5, kind: "birth", npcId: "child-5-0", data: { generation: 1 } });
    SemanticEventS.parse({ tick: 5, kind: "belief_formed", npcId: "npc-1", data: { target: "w:shelter" } });
  });
  it("EFFECT_TARGETS is the closed list", () => {
    expect(EFFECT_TARGETS).toEqual(["w:forage", "w:consume", "w:shelter", "w:seekMate", "w:explore", "w:idle", "t:hungerUrgent"]);
  });
});
