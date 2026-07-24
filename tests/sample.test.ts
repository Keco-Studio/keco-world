import { describe, it, expect } from "vitest";
import { stratifiedSelect } from "../src/chronicle/sample.js";
import type { LineageChronicle, LineageMember } from "../src/chronicle/extract.js";

function member(npcId: string, generation: number, birthTick: number, overrides: Partial<LineageMember> = {}): LineageMember {
  return {
    npcId,
    name: npcId,
    generation,
    birthTick,
    parents: generation > 0 ? ["parentA", "parentB"] : null,
    deathTick: null,
    deathCause: null,
    ...overrides,
  };
}

function chronicle(members: LineageMember[], beliefsFormed: LineageChronicle["beliefsFormed"] = []): LineageChronicle {
  return {
    lineageId: "lid",
    founderName: "Founder",
    members,
    beliefsFormed,
    weightDrift: [],
    extinct: false,
    peakGeneration: Math.max(...members.map((m) => m.generation)),
  };
}

describe("stratifiedSelect", () => {
  it("caps total selected at the budget, even for a dense 30-generation lineage", () => {
    const members: LineageMember[] = [member("founder", 0, 0)];
    const beliefsFormed: LineageChronicle["beliefsFormed"] = [];
    for (let g = 1; g <= 30; g++) {
      // >=2 births, >=2 deaths, >=2 beliefs per generation (so every 5-generation
      // stretch clears the ">=2 of each" density requirement with room to spare).
      for (let i = 0; i < 2; i++) {
        const id = `g${g}-${i}`;
        members.push(member(id, g, g * 100 + i, { deathTick: g * 100 + 50 + i, deathCause: "old_age" }));
        beliefsFormed.push({ npcId: id, name: id, tick: g * 100 + 10 + i, proposition: `belief-${g}-${i}` });
      }
    }
    const c = chronicle(members, beliefsFormed);
    const selected = stratifiedSelect(c);
    expect(selected.length).toBeLessThanOrEqual(12);
  });

  it("rolls an empty band's unused budget forward to the next band", () => {
    // peakGeneration 39 -> width 10 -> bands [0-9] [10-19] [20-29] [30-39].
    const members: LineageMember[] = [member("founder", 0, 0)];
    // Band 1 (gens 0-9): 4 death candidates, more than its 3-slot allocation.
    for (let i = 0; i < 4; i++) {
      members.push(member(`b1-${i}`, 1 + i, i, { deathTick: 100 + i, deathCause: "old_age" }));
    }
    // Band 2 (gens 10-19): deliberately empty.
    // Band 3 (gens 20-29): 6 death candidates -- enough to absorb band 2's rollover.
    for (let i = 0; i < 6; i++) {
      members.push(member(`b3-${i}`, 20 + i, i, { deathTick: 300 + i, deathCause: "old_age" }));
    }
    // Band 4 (gens 30-39): 3 death candidates, including one at gen 39 to fix peakGeneration.
    members.push(member("b4-0", 30, 0, { deathTick: 400, deathCause: "old_age" }));
    members.push(member("b4-1", 31, 0, { deathTick: 401, deathCause: "old_age" }));
    members.push(member("b4-2", 39, 0, { deathTick: 402, deathCause: "old_age" }));

    const c = chronicle(members);
    expect(c.peakGeneration).toBe(39);

    const selected = stratifiedSelect(c);
    expect(selected.length).toBe(12);

    // Band 2 (1-indexed) is empty, so its 3-slot budget must roll to band 3
    // (1-indexed), letting band 3 select 6 events instead of its base 3.
    const band3Selected = selected.filter((e) => e.tick >= 300 && e.tick < 400);
    expect(band3Selected.length).toBe(6);

    const band1Selected = selected.filter((e) => e.tick >= 100 && e.tick < 200);
    expect(band1Selected.length).toBe(3);

    const band4Selected = selected.filter((e) => e.tick >= 400 && e.tick < 500);
    expect(band4Selected.length).toBe(3);
  });

  it("within a band, priority is death > belief_formed > birth", () => {
    const members: LineageMember[] = [];
    for (let i = 0; i < 4; i++) {
      // gen 0, parents null: death candidates only, never birth candidates.
      members.push(member(`death-${i}`, 0, 0, { deathTick: 100 + i, deathCause: "old_age" }));
    }
    for (let i = 0; i < 4; i++) {
      // gen 1, no death: birth candidates only.
      members.push(member(`birth-${i}`, 1, 200 + i));
    }
    const c = chronicle(members);
    const selected = stratifiedSelect(c, 3, 1); // single band, budget 3: forces the priority tiebreak
    expect(selected.length).toBe(3);
    expect(selected.every((e) => e.kind === "death")).toBe(true);
    expect(selected.map((e) => e.npcId).sort()).toEqual(["death-0", "death-1", "death-2"]);
  });

  it("is deterministic", () => {
    const members: LineageMember[] = [member("founder", 0, 0)];
    for (let g = 1; g <= 10; g++) {
      members.push(member(`m${g}`, g, g * 10, { deathTick: g * 10 + 5, deathCause: "cold" }));
    }
    const c = chronicle(members, [{ npcId: "m1", name: "m1", tick: 12, proposition: "x" }]);
    const first = stratifiedSelect(c);
    const second = stratifiedSelect(c);
    expect(second).toEqual(first);
  });
});
