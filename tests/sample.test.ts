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

function chronicle(
  members: LineageMember[],
  beliefsFormed: LineageChronicle["beliefsFormed"] = [],
  designedBeliefs: LineageChronicle["designedBeliefs"] = [],
): LineageChronicle {
  return {
    lineageId: "lid",
    founderName: "Founder",
    members,
    beliefsFormed,
    designedBeliefs,
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
    for (let i = 0; i < 2; i++) {
      // gen 0, parents null: death candidates only, never birth candidates.
      members.push(member(`death-${i}`, 0, 0, { deathTick: 100 + i, deathCause: "old_age" }));
    }
    for (let i = 0; i < 4; i++) {
      // gen 1, no death: birth candidates only.
      members.push(member(`birth-${i}`, 1, 200 + i));
    }
    const beliefsFormed: LineageChronicle["beliefsFormed"] = [
      { npcId: "death-0", name: "death-0", tick: 150, proposition: "belief-a" },
      { npcId: "death-1", name: "death-1", tick: 160, proposition: "belief-b" },
    ];
    const c = chronicle(members, beliefsFormed);
    // Single band, budget 3, pool = 2 deaths + 2 beliefs + 4 births (8 candidates,
    // more than enough of every kind to fill the budget from any one tier alone) --
    // isolates the priority tiebreak: expect 2 deaths + 1 belief, never a birth.
    const selected = stratifiedSelect(c, 3, 1);
    expect(selected.length).toBe(3);
    expect(selected.filter((e) => e.kind === "death").length).toBe(2);
    expect(selected.filter((e) => e.kind === "belief").length).toBe(1);
    expect(selected.some((e) => e.kind === "birth")).toBe(false);
  });

  it("surfaces the founder's designed beliefs as belief-priority candidates in the founder's band", () => {
    // chronicle()'s lineageId is fixed at "lid" -- the founder member's npcId must
    // match it (extractLineage guarantees this for real chronicles: the founder
    // roster entry's npcId IS the lineageId).
    const members: LineageMember[] = [member("lid", 0, 0), member("child", 1, 10, { deathTick: 20, deathCause: "cold" })];
    const designedBeliefs = [{ proposition: "冬藏胜于冬狩" }, { proposition: "远方总有新的浆果丛" }];
    const c = chronicle(members, [], designedBeliefs);
    const selected = stratifiedSelect(c);
    const designedSelected = selected.filter((e) => e.kind === "belief" && e.npcId === "lid");
    expect(designedSelected.length).toBe(2);
    expect(designedSelected.every((e) => e.tick < 0)).toBe(true); // synthetic sentinel, never a real tick
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
