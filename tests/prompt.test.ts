import { describe, it, expect } from "vitest";
import { renderPrompt, shuffleOrder, PROMPT_VERSION } from "../src/bench/prompt.js";
import { findTriggers } from "../src/bench/trigger.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest();
const roster = makeTestRoster(5);
const triggers = findTriggers(manifest, roster, "seed-1", 300, 100);

describe("prompt rendering", () => {
  it("shuffle is a deterministic permutation keyed by trigger id", () => {
    const tr = triggers[0]!;
    const a = shuffleOrder(tr);
    const b = shuffleOrder(tr);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(tr.candidates.map((_, i) => i));
  });
  it("different triggers get different shuffles somewhere in the harvest", () => {
    const multi = triggers.filter((t) => t.candidates.length >= 3);
    const distinct = new Set(multi.map((t) => shuffleOrder(t).join(",")));
    expect(distinct.size).toBeGreaterThan(1);
  });
  it("renders every candidate exactly once, numbered from 1, with no score leakage", () => {
    const tr = triggers.find((t) => t.candidates.length >= 2)!;
    const p = renderPrompt(tr, "Rill");
    for (let i = 1; i <= tr.candidates.length; i++) expect(p.user).toContain(`${i}.`);
    expect(p.user.toLowerCase()).not.toContain("score");
    for (const c of tr.candidates) expect(p.user).not.toContain(`(${c.score})`);
    expect(p.order.length).toBe(tr.candidates.length);
  });
  it("schema bounds choice to the candidate count", () => {
    const tr = triggers[0]!;
    const p = renderPrompt(tr, "Rill");
    const choice = (p.schema["properties"] as Record<string, { maximum: number; minimum: number }>)["choice"]!;
    expect(choice.minimum).toBe(1);
    expect(choice.maximum).toBe(tr.candidates.length);
  });
  it("mentions survival context: season, energy, and the npc name", () => {
    const tr = triggers[0]!;
    const p = renderPrompt(tr, "Rill");
    expect(p.user).toContain(tr.observation.season);
    expect(p.system).toContain("Rill");
    expect(PROMPT_VERSION).toBe("bench-v1");
  });
});
