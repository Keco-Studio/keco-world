import { describe, it, expect } from "vitest";
import { W2ManifestS, W2RosterEntryS, W2PolicyS, GOAL_KEYS, RECIPES, SCHEMA_VERSION_W2 } from "../src/schema/world2.js";

describe("w2 schema", () => {
  it("policy requires every goal key and rejects unknown ones", () => {
    const weights = Object.fromEntries(GOAL_KEYS.map((k) => [k, 100]));
    const ok = { goalWeights: weights, thresholds: { hungerUrgent: 150 }, deliberationEpsilon: 60, commitmentThreshold: 150 };
    expect(W2PolicyS.safeParse(ok).success).toBe(true);
    const { rest: _r, ...missing } = weights as Record<string, number>;
    expect(W2PolicyS.safeParse({ ...ok, goalWeights: missing }).success).toBe(false);
    expect(W2PolicyS.safeParse({ ...ok, goalWeights: { ...weights, forage: 100 } }).success).toBe(false);
  });
  it("freezes the recipes", () => {
    expect(RECIPES).toEqual({ shelter: { wood: 4, stone: 2 }, granary: { wood: 6, stone: 4 }, monument: { gold: 3, stone: 8 } });
  });
  it("manifest has no shelters field and pins the schema version", () => {
    expect(SCHEMA_VERSION_W2).toBe("world2-v1");
    expect("shelters" in W2ManifestS.shape).toBe(false);
    expect("sites" in W2ManifestS.shape).toBe(true);
    expect("founderSeededMemory" in W2ManifestS.shape).toBe(true);
  });
});
