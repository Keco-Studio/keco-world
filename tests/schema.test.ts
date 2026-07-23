import { describe, it, expect } from "vitest";
import { PolicyS, WorldManifestS, SCHEMA_VERSION, UTILITY_KEYS, CognitionS, BeliefS } from "../src/schema/core.js";
import { ActionS, CanonicalActionEventS } from "../src/schema/log.js";
import { makeTestManifest } from "./helpers.js";

const validWeights = { forage: 500, consume: 800, shelter: 600, seekMate: 500, explore: 200, idle: 50 };

describe("core schemas", () => {
  it("accepts a valid policy", () => {
    const p = PolicyS.parse({ utilityWeights: validWeights, thresholds: { hungerUrgent: 150 }, deliberationEpsilon: 60 });
    expect(p.utilityWeights.forage).toBe(500);
  });
  it("rejects unknown utility weight keys (closed key set, P4)", () => {
    expect(() =>
      PolicyS.parse({
        utilityWeights: { ...validWeights, hoard: 100 },
        thresholds: { hungerUrgent: 150 },
        deliberationEpsilon: 60,
      }),
    ).toThrow();
  });
  it("rejects out-of-range weights", () => {
    expect(() =>
      PolicyS.parse({
        utilityWeights: { ...validWeights, forage: 1001 },
        thresholds: { hungerUrgent: 150 },
        deliberationEpsilon: 60,
      }),
    ).toThrow();
  });
  it("UTILITY_KEYS is the closed key list", () => {
    expect(UTILITY_KEYS).toEqual(["forage", "consume", "shelter", "seekMate", "explore", "idle"]);
  });
  it("manifest requires schemaVersion", () => {
    expect(SCHEMA_VERSION).toBe("phase1a-v4");
    expect(() => WorldManifestS.parse({})).toThrow();
  });
});

describe("log schemas", () => {
  it("parses each action verb", () => {
    expect(ActionS.parse({ verb: "move", to: { x: 1, y: 2 } }).verb).toBe("move");
    expect(ActionS.parse({ verb: "take", target: "bush-1" }).verb).toBe("take");
    expect(ActionS.parse({ verb: "consume" }).verb).toBe("consume");
    expect(ActionS.parse({ verb: "flee", from: "wolf" }).verb).toBe("flee");
    expect(ActionS.parse({ verb: "idle" }).verb).toBe("idle");
  });
  it("rejects unknown verbs", () => {
    expect(() => ActionS.parse({ verb: "teleport" })).toThrow();
  });
  it("action event carries P4 fields", () => {
    const ev = CanonicalActionEventS.parse({
      eventId: "5:npc-1",
      tick: 5,
      npcId: "npc-1",
      observationHash: "a".repeat(64),
      action: { verb: "idle" },
      actionSource: "utility",
      deliberationTriggered: false,
      energyCharged: 0,
      patronInfluence: false,
      patronDecisive: false,
      previousEventHash: null,
    });
    expect(ev.deliberationTriggered).toBe(false);
    expect(ev.energyCharged).toBe(0);
    expect(ev.patronInfluence).toBe(false);
    expect(ev.patronDecisive).toBe(false);
  });
});

describe("cognition block (schema v3)", () => {
  it("manifest requires cognition and rejects unknown modes", () => {
    const m = makeTestManifest();
    expect(WorldManifestS.safeParse(m).success).toBe(true);
    const { cognition: _c, ...noCog } = m as Record<string, unknown> & { cognition: unknown };
    expect(WorldManifestS.safeParse(noCog).success).toBe(false);
    expect(CognitionS.safeParse({ decisionMode: "llm", inheritanceMode: "breed", beliefDynamics: "on" }).success).toBe(false);
  });
  it("belief source accepts designed", () => {
    const b = {
      proposition: "冬季闭户",
      effect: { target: "w:shelter", modifier: 250, condition: "winter" },
      confidence: 950,
      source: "designed",
      acquiredTick: 0,
      decayPer100: 0,
    };
    expect(BeliefS.safeParse(b).success).toBe(true);
  });
});
