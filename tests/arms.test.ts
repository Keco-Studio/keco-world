import { describe, it, expect } from "vitest";
import { ARM_IDS, HANDCRAFTED_ARCHETYPES, makeArmSetup } from "../src/arms/arms.js";
import { RosterEntryS, WorldManifestS } from "../src/schema/core.js";

describe("baseline arms", () => {
  it("every arm setup zod-validates and has 25 archetypes (parity)", () => {
    for (const arm of ARM_IDS) {
      const { manifest, roster } = makeArmSetup(arm, "arms-t");
      expect(WorldManifestS.safeParse(manifest).success).toBe(true);
      expect(roster.length).toBe(25);
      for (const e of roster) expect(RosterEntryS.safeParse(e).success).toBe(true);
    }
  });
  it("arm cognition configs match the frozen table", () => {
    expect(makeArmSetup("random", "s").manifest.cognition).toEqual({ decisionMode: "random", inheritanceMode: "clone", beliefDynamics: "off" });
    expect(makeArmSetup("fixed", "s").manifest.cognition).toEqual({ decisionMode: "utility", inheritanceMode: "clone", beliefDynamics: "off" });
    expect(makeArmSetup("handcrafted", "s").manifest.cognition).toEqual({ decisionMode: "utility", inheritanceMode: "clone", beliefDynamics: "off" });
    expect(makeArmSetup("evolutionary", "s").manifest.cognition).toEqual({ decisionMode: "utility", inheritanceMode: "breed", beliefDynamics: "on" });
  });
  it("fixed and random rosters are argmax (epsilon 0); evolutionary keeps demo epsilon", () => {
    for (const arm of ["fixed", "random"] as const) {
      for (const e of makeArmSetup(arm, "s").roster) expect(e.policy.deliberationEpsilon).toBe(0);
    }
    expect(makeArmSetup("evolutionary", "s").roster.some((e) => e.policy.deliberationEpsilon > 0)).toBe(true);
  });
  it("handcrafted content honors the frozen budget", () => {
    expect(HANDCRAFTED_ARCHETYPES.length).toBe(25);
    let rules = 0;
    for (const a of HANDCRAFTED_ARCHETYPES) {
      expect(a.beliefs.length).toBeLessThanOrEqual(3);
      rules += a.beliefs.length;
      for (const b of a.beliefs) {
        expect(b.source).toBe("designed");
        expect(b.decayPer100).toBe(0);
      }
      expect(a.policy.deliberationEpsilon).toBeGreaterThanOrEqual(0);
      expect(a.policy.deliberationEpsilon).toBeLessThanOrEqual(150);
      expect(a.identity.voiceStyle.length).toBeGreaterThan(0);
    }
    expect(rules).toBe(20);
    expect(new Set(HANDCRAFTED_ARCHETYPES.map((a) => a.npcId)).size).toBe(25);
  });
  it("handcrafted roster is seed-independent; fixed roster varies with seed", () => {
    expect(makeArmSetup("handcrafted", "s1").roster).toEqual(makeArmSetup("handcrafted", "s2").roster);
    expect(makeArmSetup("fixed", "s1").roster).not.toEqual(makeArmSetup("fixed", "s2").roster);
  });
});
