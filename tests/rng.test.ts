import { describe, it, expect } from "vitest";
import { fnv1a32, drawInt, RNG_SCHEME_VERSION } from "../src/rng/rng.js";

describe("rng", () => {
  it("fnv1a32 matches the known offset basis for empty string", () => {
    expect(fnv1a32("")).toBe(2166136261); // 0x811c9dc5
  });
  it("drawInt is deterministic for identical keys", () => {
    expect(drawInt("seed-a", 1000, "explore", "npc-1", 42)).toBe(
      drawInt("seed-a", 1000, "explore", "npc-1", 42),
    );
  });
  it("drawInt stays in range", () => {
    for (let t = 0; t < 500; t++) {
      const v = drawInt("seed-a", 8, "dir", t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(8);
    }
  });
  it("different keys give different streams (statistically)", () => {
    let same = 0;
    for (let t = 0; t < 200; t++) {
      if (drawInt("seed-a", 1000, "x", t) === drawInt("seed-b", 1000, "x", t)) same++;
    }
    expect(same).toBeLessThan(10);
  });
  it("exports the scheme version", () => {
    expect(RNG_SCHEME_VERSION).toBe("fnv1a-mulberry32-v1");
  });
});
