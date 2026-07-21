import { describe, it, expect } from "vitest";
import { findTriggers } from "../src/bench/trigger.js";
import { pickBest } from "../src/mind/utility.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest();
const roster = makeTestRoster(5);

describe("findTriggers", () => {
  it("is deterministic", () => {
    const a = findTriggers(manifest, roster, "seed-1", 300, 100);
    const b = findTriggers(manifest, roster, "seed-1", 300, 100);
    expect(a).toEqual(b);
  });
  it("every trigger has ≥2 candidates, gap ≤ epsilon, and bestIndex matching pickBest", () => {
    const triggers = findTriggers(manifest, roster, "seed-1", 300, 100);
    expect(triggers.length).toBeGreaterThan(0);
    for (const tr of triggers) {
      expect(tr.candidates.length).toBeGreaterThanOrEqual(2);
      expect(tr.gap).toBeGreaterThanOrEqual(0);
      expect(tr.gap).toBeLessThanOrEqual(100);
      expect(tr.candidates[tr.bestIndex]).toEqual(pickBest(tr.candidates));
      expect(tr.id).toBe(`${tr.seedRoot}:${tr.tick}:${tr.npcId}`);
    }
  });
  it("epsilon 0 yields a subset of epsilon 100", () => {
    const tight = findTriggers(manifest, roster, "seed-1", 300, 0);
    const loose = findTriggers(manifest, roster, "seed-1", 300, 100);
    const looseIds = new Set(loose.map((t) => t.id));
    expect(tight.length).toBeLessThanOrEqual(loose.length);
    for (const t of tight) expect(looseIds.has(t.id)).toBe(true);
  });
  it("triggers are JSON-safe (integers/strings only)", () => {
    const [tr] = findTriggers(manifest, roster, "seed-1", 300, 100);
    expect(JSON.parse(JSON.stringify(tr))).toEqual(tr);
  });
});
