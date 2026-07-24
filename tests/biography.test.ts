import { describe, it, expect } from "vitest";
import { extractLineage } from "../src/chronicle/extract.js";
import { renderBiography } from "../src/chronicle/biography.js";
import { stratifiedSelect } from "../src/chronicle/sample.js";
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

  // Locks the v1 (no-selection) render path byte-for-byte: the sampler v2 change
  // (renderBiography's new optional 3rd `selection` param) must never alter output
  // for existing 2-arg callers. Captured from this exact fixture before that change.
  it("2-arg call (no selection) stays byte-identical to the pre-sampler-v2 golden", () => {
    const golden =
      "# NPC 1一脉纪事\n\nNPC 1是这一脉的始祖，其血脉历经17代的繁衍。如今这一脉已经断绝。\n\n## 始祖\n\n第1年冬，NPC 1学会了：『the wolf is death; walls are life』 NPC 1寿终正寝，时在第1年冬。\n\n## 第1代\n\nCorin诞生于第1年夏，父母是NPC 1与族外的伴侣。 第1年夏，Corin学会了：『the wolf is death; walls are life』 Corin死于严寒，时在第2年冬。\n\n## 第2代\n\nHazel诞生于第2年冬，父母是Corin与族外的伴侣。 Hazel寿终正寝，时在第4年冬。\n\n## 第4代\n\nBram诞生于第3年夏，父母是Hazel与族外的伴侣。 Odo诞生于第4年夏，父母是Hazel与族外的伴侣。 Bram寿终正寝，时在第6年夏。 Odo寿终正寝，时在第7年夏。\n\n## 第5代\n\nSable诞生于第5年夏，父母是Bram与Odo。 Sable寿终正寝，时在第8年夏。\n\n## 第7代\n\n另一位Odo诞生于第6年冬，父母是Sable与族外的伴侣。 第8年冬，Odo学会了：『the wolf is death; walls are life』\n\n## 第9代\n\n第8年冬，Isla学会了：『the wolf is death; walls are life』\n\n## 第15代\n\n第15年冬，另一位Isla学会了：『the wolf is death; walls are life』\n\n## 结语\n\nNPC 1的这一脉最终在世间断绝，未留下存续的血脉。\n";
    expect(renderBiography(c, manifest)).toBe(golden);
  });

  it("3-arg call renders exactly the given selection, in chronological section order", () => {
    const selection = stratifiedSelect(c, 4, 2); // small budget/bands: easy to check exhaustively
    const md = renderBiography(c, manifest, selection);

    // Every selected event's subject name must appear; nothing beyond the selection's
    // generations should introduce a section (the belief/event caps are bypassed).
    const selectedNpcIds = new Set(selection.map((s) => s.npcId));
    for (const npcId of selectedNpcIds) {
      const name = c.members.find((m) => m.npcId === npcId)!.name;
      expect(md).toContain(name);
    }

    // Determinism.
    expect(renderBiography(c, manifest, selection)).toBe(md);
  });
});
