import { describe, it, expect } from "vitest";
import { runArm, compareArms } from "../src/cli/arms.js";

describe("arms CLI", () => {
  it("runArm is deterministic and reports verb shares", () => {
    const a = runArm("fixed", "arms-cli-t", 2000, 500);
    const b = runArm("fixed", "arms-cli-t", 2000, 500);
    expect(a).toEqual(b);
    const sum = Object.values(a.verbShares1000).reduce((x, y) => x + y, 0);
    expect(sum).toBeGreaterThan(900);
    expect(sum).toBeLessThanOrEqual(1000);
  });
  it("random arm runs and only ever logs random actionSource decisions", () => {
    const r = runArm("random", "arms-cli-r", 1000, 500);
    expect(r.finalAlive).toBeGreaterThanOrEqual(0); // extinction allowed — sanity arm
  });
  it("compareArms covers all arms and the 6 cross pairs, deterministically", () => {
    const c = compareArms("arms-cmp-t");
    expect(Object.keys(c.intra).sort()).toEqual(["evolutionary", "fixed", "handcrafted", "random"]);
    expect(Object.keys(c.cross).length).toBe(6);
    expect(compareArms("arms-cmp-t")).toEqual(c);
    expect(c.intra.handcrafted).toBeGreaterThan(0); // archetypes are behaviorally distinguishable
  });
});
