import { drawInt } from "../rng/rng.js";
import { REGION_SIZE } from "../schema/world2.js";
import type { ResourceKind, Site } from "../schema/world2.js";

export interface RegionPlan {
  regionIndex: number;
  kind: ResourceKind;
}

export function planRegions(seedRoot: string): RegionPlan[] {
  const idx = Array.from({ length: 16 }, (_, i) => i);
  // Fisher-Yates, keyed random
  for (let i = idx.length - 1; i > 0; i--) {
    const j = drawInt(seedRoot, i + 1, "region-shuffle", i);
    const t = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = t;
  }
  const quota: [ResourceKind, number][] = [
    ["berry", 8],
    ["wood", 4],
    ["stone", 2],
    ["gold", 2],
  ];
  const out: RegionPlan[] = [];
  let p = 0;
  for (const [kind, n] of quota) for (let k = 0; k < n; k++) out.push({ regionIndex: idx[p++]!, kind });
  return out.sort((a, b) => a.regionIndex - b.regionIndex);
}

export function generateSites(seedRoot: string): Site[] {
  const sites: Site[] = [];
  const PER_REGION: Record<ResourceKind, number> = { berry: 3, wood: 2, stone: 2, gold: 1 };
  const PARAMS: Record<ResourceKind, { capacity: number; s: number; w: number }> = {
    berry: { capacity: 5, s: 60_000, w: 5_000 },
    wood: { capacity: 8, s: 8_000, w: 2_000 },
    stone: { capacity: 20, s: 20_000, w: 20_000 },
    gold: { capacity: 3, s: 500, w: 500 },
  };
  for (const { regionIndex, kind } of planRegions(seedRoot)) {
    const rx = (regionIndex % 4) * REGION_SIZE;
    const ry = Math.floor(regionIndex / 4) * REGION_SIZE;
    for (let i = 0; i < PER_REGION[kind]; i++) {
      const p = PARAMS[kind];
      sites.push({
        id: `${kind}-${regionIndex}-${i}`,
        kind,
        pos: {
          x: rx + drawInt(seedRoot, REGION_SIZE, "site-x", regionIndex, i),
          y: ry + drawInt(seedRoot, REGION_SIZE, "site-y", regionIndex, i),
        },
        stock: p.capacity,
        capacity: p.capacity,
        regrowPpmSummer: p.s,
        regrowPpmWinter: p.w,
      });
    }
  }
  return sites;
}
