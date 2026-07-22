import { describe, it, expect } from "vitest";
import { UTILITY_KEYS, UtilityWeightsS, EFFECT_TARGETS, SCHEMA_VERSION } from "../src/schema/core.js";
import { affinity } from "../src/mind/resolver.js";
import { breed } from "../src/life/genome.js";
import { makeTestRoster } from "./helpers.js";

describe("seekMate key", () => {
  it("schema version and key sets updated", () => {
    expect(SCHEMA_VERSION).toBe("phase1a-v3");
    expect(UTILITY_KEYS).toEqual(["forage", "consume", "shelter", "seekMate", "explore", "idle"]);
    expect(EFFECT_TARGETS).toContain("w:seekMate");
  });
  it("weights require seekMate", () => {
    const w = makeTestRoster(1)[0]!.policy.utilityWeights;
    expect(UtilityWeightsS.parse(w).seekMate).toBe(500);
    const { seekMate: _s, ...rest } = w;
    expect(() => UtilityWeightsS.parse(rest)).toThrow();
  });
  it("resolver affinity for seekMate is socialTrust", () => {
    const id = makeTestRoster(1)[0]!.identity;
    expect(affinity("seekMate", id)).toBe(id.socialTrust);
  });
  it("breeding covers the new key", () => {
    const r = makeTestRoster(2);
    const A = { lineageId: "a", generation: 0, identity: r[0]!.identity, policy: { ...r[0]!.policy, utilityWeights: { ...r[0]!.policy.utilityWeights, seekMate: 1000 } }, beliefs: [] };
    const B = { lineageId: "b", generation: 0, identity: r[1]!.identity, policy: { ...r[1]!.policy, utilityWeights: { ...r[1]!.policy.utilityWeights, seekMate: 0 } }, beliefs: [] };
    const kids = Array.from({ length: 30 }, (_, k) => breed(A, B, `c${k}`, "s", 1).policy.utilityWeights.seekMate);
    expect(kids.some((v) => v > 700)).toBe(true);
    expect(kids.some((v) => v < 300)).toBe(true);
  });
});
