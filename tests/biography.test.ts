import { describe, it, expect } from "vitest";
import { extractLineage } from "../src/chronicle/extract.js";
import type { LineageChronicle, LineageMember } from "../src/chronicle/extract.js";
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

  // Locks the v1 (no-selection) render path's SELECTION LOGIC (earliest-N cap,
  // section structure, formed-beliefs-only) byte-for-byte across the sampler v2
  // change. The belief sentence template itself is a deliberate, v1-visible
  // exception (学会了 -> 信奉, plus the localized Chinese proposition pools —
  // docs/prereg-1c-draft.md follow-up: de-blind belief-sentence leak) — this golden
  // was recaptured after that change, from this exact fixture.
  it("2-arg call (no selection) matches the post-de-blind-fix golden", () => {
    const golden =
      "# NPC 1一脉纪事\n\nNPC 1是这一脉的始祖，其血脉历经17代的繁衍。如今这一脉已经断绝。\n\n## 始祖\n\nNPC 1信奉：『见狼要跑，有墙要躲』，时在第1年冬。 NPC 1寿终正寝，时在第1年冬。\n\n## 第1代\n\nCorin诞生于第1年夏，父母是NPC 1与族外的伴侣。 Corin信奉：『见狼要跑，有墙要躲』，时在第1年夏。 Corin死于严寒，时在第2年冬。\n\n## 第2代\n\nHazel诞生于第2年冬，父母是Corin与族外的伴侣。 Hazel寿终正寝，时在第4年冬。\n\n## 第4代\n\nBram诞生于第3年夏，父母是Hazel与族外的伴侣。 Odo诞生于第4年夏，父母是Hazel与族外的伴侣。 Bram寿终正寝，时在第6年夏。 Odo寿终正寝，时在第7年夏。\n\n## 第5代\n\nSable诞生于第5年夏，父母是Bram与Odo。 Sable寿终正寝，时在第8年夏。\n\n## 第7代\n\n另一位Odo诞生于第6年冬，父母是Sable与族外的伴侣。 Odo信奉：『狼是死神，屋是命』，时在第8年冬。\n\n## 第9代\n\nIsla信奉：『狼是死神，屋是命』，时在第8年冬。\n\n## 第15代\n\n另一位Isla信奉：『狼口即死，墙内即生』，时在第15年冬。\n\n## 结语\n\nNPC 1的这一脉最终在世间断绝，未留下存续的血脉。\n";
    expect(renderBiography(c, manifest)).toBe(golden);
    // No leftover English *inside the belief quotes* specifically (test fixture names
    // like "NPC 1"/"Corin" are expected Latin-alphabet in-world names, not a leak).
    const propositions = [...golden.matchAll(/『([^』]*)』/g)].map((m) => m[1]!);
    expect(propositions.length).toBeGreaterThan(0);
    for (const p of propositions) expect(p).not.toMatch(/[a-zA-Z]/);
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

    // Exclusion: a member outside the selection (and not name-colliding with any
    // selected member) must not appear at all.
    const excluded = c.members.find((m) => !selectedNpcIds.has(m.npcId) && m.name === "Runa");
    expect(excluded).toBeDefined();
    expect(md).not.toContain(excluded!.name);

    // Determinism.
    expect(renderBiography(c, manifest, selection)).toBe(md);
  });
});

// 2nd de-blind fix (docs/prereg-1c-draft.md §4 盲化核查表 信念句对称性): a re-review
// found that even after unifying formed/designed beliefs on the same VERB (信奉),
// the v2/selection path still had a categorical tell -- formed beliefs carried a
// "，时在<season-year>。" timestamp and designed beliefs didn't ("生来信奉" vs
// "信奉...时在"), so any belief clause in a judge-packet biography still identified
// the arm with certainty. This synthetic fixture has BOTH a formed belief and a
// designed belief on the same tiny lineage, so both templates are directly
// comparable in one render.
describe("selection-mode belief template (blinding: uniform, no timestamp)", () => {
  const founder: LineageMember = {
    npcId: "f1",
    name: "Founder",
    generation: 0,
    birthTick: 0,
    parents: null,
    deathTick: null,
    deathCause: null,
  };
  const chronicle: LineageChronicle = {
    lineageId: "f1",
    founderName: "Founder",
    members: [founder],
    beliefsFormed: [{ npcId: "f1", name: "Founder", tick: 5, proposition: "formed-prop" }],
    designedBeliefs: [{ proposition: "designed-prop" }],
    weightDrift: [],
    extinct: false,
    peakGeneration: 0,
  };
  const manifest = makeTestManifest();

  it("v2/selection path (evalpack's only path) renders formed and designed beliefs identically, no timestamp", () => {
    const selection = stratifiedSelect(chronicle);
    const md = renderBiography(chronicle, manifest, selection);
    expect(md).toContain("Founder信奉：『formed-prop』。");
    expect(md).toContain("Founder信奉：『designed-prop』。");
    // Neither template artifact may appear anywhere in a selection-mode render that
    // contains belief clauses -- this fixture has no births/deaths, so the whole
    // document body is belief lines plus the fixed opening/closing prose.
    expect(md).not.toContain("时在");
    expect(md).not.toContain("生来");
  });

  it("v1 (no-selection) path is unaffected -- keeps its richer, timestamped rendering", () => {
    const md = renderBiography(chronicle, manifest); // v1 never sees designed beliefs at all
    expect(md).toContain("Founder信奉：『formed-prop』，时在");
    expect(md).toContain("时在");
    expect(md).not.toContain("designed-prop"); // designed beliefs are v2/selection-only
  });
});

// 3rd de-blind fix (docs/prereg-1c-draft.md §4, "终审发现，2026-07-24"): the closing
// (结语) itself was a ~100% arm classifier -- Handcrafted (clone-inheritance) always
// has empty weightDrift, so its old closing was ALWAYS "…并无显著改变"; Evolutionary
// (breed, 50+ gens) reliably clears DRIFT_THRESHOLD somewhere, so its old closing was
// ALWAYS the "…演变…更热衷于/更疏于…" phrasing. The v2/selection path now renders a
// neutral, extinction-status-only closing with no drift semantics whatsoever.
describe("selection-mode closing (blinding: neutral, no drift semantics)", () => {
  const manifest = makeTestManifest();

  const survivingWithDrift: LineageChronicle = {
    lineageId: "f2",
    founderName: "Founder2",
    members: [{ npcId: "f2", name: "Founder2", generation: 0, birthTick: 0, parents: null, deathTick: null, deathCause: null }],
    beliefsFormed: [],
    designedBeliefs: [],
    // Large drift -- would have triggered the old "演变...更热衷于" closing.
    weightDrift: [{ key: "forage", founder: 200, latest: 700 }],
    extinct: false,
    peakGeneration: 0,
  };

  const extinctNoDrift: LineageChronicle = {
    lineageId: "f3",
    founderName: "Founder3",
    members: [{ npcId: "f3", name: "Founder3", generation: 0, birthTick: 0, parents: null, deathTick: 5, deathCause: "old_age" }],
    beliefsFormed: [],
    designedBeliefs: [],
    weightDrift: [], // extractLineage always yields [] for extinct lineages
    extinct: true,
    peakGeneration: 0,
  };

  it("surviving + drifted chronicle gets the neutral '仍在继续' closing, never drift phrasing", () => {
    const md = renderBiography(survivingWithDrift, manifest, []);
    expect(md).toContain("这一脉的故事仍在继续。");
    expect(md).not.toMatch(/演变|更热衷|更疏于|并无显著改变/);
  });

  it("extinct chronicle gets the neutral '落幕' closing in selection mode", () => {
    const md = renderBiography(extinctNoDrift, manifest, []);
    expect(md).toContain("这一脉的故事至此落幕。");
    expect(md).not.toMatch(/演变|更热衷|更疏于|并无显著改变/);
  });

  it("v1 path is unaffected -- the same drifted chronicle still gets the rich drift closing", () => {
    const md = renderBiography(survivingWithDrift, manifest); // no selection arg
    expect(md).toContain("演变");
    expect(md).toContain("更热衷于采集");
    expect(md).not.toContain("这一脉的故事仍在继续");
  });
});
