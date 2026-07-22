import { describe, it, expect } from "vitest";
import { extractLineage } from "../src/chronicle/extract.js";
import { renderBiography } from "../src/chronicle/biography.js";
import { runSim } from "../src/sim/engine.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest({ berryRegrowPpmSummer: 300_000, berryRegrowPpmWinter: 100_000 });
const roster = makeTestRoster(8);
const r = runSim(manifest, roster, "bio-seed", { ticks: 4000 });
const lineages = new Set(r.events.filter((e) => e.kind === "birth").map((e) => String(e.data["lineageId"])));

describe("lineage chronicle", () => {
  it("run produced at least one lineage with births", () => {
    expect(lineages.size).toBeGreaterThan(0);
  });
  const lid = [...lineages].sort()[0]!;
  const c = extractLineage(r.events, r.finalState, roster, lid);

  it("chronicle facts trace to events", () => {
    expect(c.lineageId).toBe(lid);
    expect(c.members.length).toBeGreaterThanOrEqual(2);           // founder + ≥1 birth
    expect(c.members[0]!.generation).toBe(0);
    const births = r.events.filter((e) => e.kind === "birth" && e.data["lineageId"] === lid).length;
    expect(c.members.length).toBe(1 + births);
    for (const m of c.members.filter((m) => m.deathTick !== null)) {
      expect(r.events.some((e) => e.kind === "death" && e.npcId === m.npcId)).toBe(true);
    }
    expect(c.peakGeneration).toBe(Math.max(...c.members.map((m) => m.generation)));
  });
  it("renders a grounded, blinded biography", () => {
    const md = renderBiography(c, manifest);
    expect(md).toContain(c.founderName);
    expect(md).not.toContain("bio-seed");
    expect(md).not.toContain(lid);                                 // raw lineage id blinded
    expect(md).not.toMatch(/tick\s*\d|\btick\b/i);                 // no raw ticks
    expect(md).toMatch(/第\d+年/);                                  // season-year notation present
    const named = c.members.filter((m) => m.deathTick !== null).slice(0, 3);
    for (const m of named) expect(md).toContain(m.name);
  });
  it("rendering is deterministic and length-controlled", () => {
    const md = renderBiography(c, manifest);
    expect(renderBiography(c, manifest)).toBe(md);
    expect(md.length).toBeLessThan(4000);
  });
  it("extinct lineage renders the extinct closing and empty drift", () => {
    const extinctLid = roster.map((x) => x.npcId).find((id) => !r.finalState.npcs.some((n) => n.alive && n.lineageId === id));
    if (extinctLid !== undefined) {
      const ec = extractLineage(r.events, r.finalState, roster, extinctLid);
      expect(ec.extinct).toBe(true);
      expect(ec.weightDrift).toEqual([]);
    }
  });
});
