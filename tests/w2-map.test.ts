import { describe, it, expect } from "vitest";
import { planRegions, generateSites } from "../src/world2/map.js";
import { REGION_SIZE, GRID } from "../src/schema/world2.js";

describe("w2 map generation", () => {
  it("assigns exactly the frozen region quota", () => {
    const plan = planRegions("map-t");
    expect(plan.length).toBe(16);
    const count = (k: string) => plan.filter((p) => p.kind === k).length;
    expect(count("berry")).toBe(8);
    expect(count("wood")).toBe(4);
    expect(count("stone")).toBe(2);
    expect(count("gold")).toBe(2);
    expect(new Set(plan.map((p) => p.regionIndex)).size).toBe(16);
  });
  it("is deterministic and seed-sensitive", () => {
    expect(generateSites("map-t")).toEqual(generateSites("map-t"));
    expect(generateSites("map-t")).not.toEqual(generateSites("map-u"));
  });
  it("produces the frozen site counts, all in-bounds and inside their region", () => {
    const sites = generateSites("map-t");
    const n = (k: string) => sites.filter((s) => s.kind === k).length;
    expect(n("berry")).toBe(24);
    expect(n("wood")).toBe(8);
    expect(n("stone")).toBe(4);
    expect(n("gold")).toBe(2);
    expect(new Set(sites.map((s) => s.id)).size).toBe(sites.length);
    const plan = new Map(planRegions("map-t").map((p) => [p.regionIndex, p.kind]));
    for (const s of sites) {
      expect(s.pos.x).toBeGreaterThanOrEqual(0);
      expect(s.pos.x).toBeLessThan(GRID);
      expect(s.pos.y).toBeGreaterThanOrEqual(0);
      expect(s.pos.y).toBeLessThan(GRID);
      const ri = Math.floor(s.pos.y / REGION_SIZE) * 4 + Math.floor(s.pos.x / REGION_SIZE);
      expect(plan.get(ri)).toBe(s.kind);          // 站点必须落在自己类型的区域内
      expect(s.stock).toBe(s.capacity);
    }
  });
});
