import type { Vec2 } from "../schema/core.js";
import type { MemoryEntry, ResourceKind, BuildingKind } from "../schema/world2.js";
import { MEMORY_CAP, MEMORY_INHERIT_MAX, MEMORY_MISREMEMBER_PPM, MEMORY_JITTER, GRID } from "../schema/world2.js";
import type { W2NpcState } from "../world2/state.js";
import type { W2Observation } from "./observe.js";
import { drawInt } from "../rng/rng.js";

/** UTF-16 string comparison; never localeCompare (determinism doctrine). */
function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ordering used to pick the eviction victim: smallest seenTick, tie by pos.x, pos.y, kind (UTF-16). */
function cmpEvictionOrder(a: MemoryEntry, b: MemoryEntry): number {
  if (a.seenTick !== b.seenTick) return a.seenTick - b.seenTick;
  if (a.pos.x !== b.pos.x) return a.pos.x - b.pos.x;
  if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
  return cmpStr(a.kind, b.kind);
}

/**
 * Mutates `npc.memory` in place: processes `obs.visibleSites` then
 * `obs.visibleBuildings`, each in id UTF-16 order. An existing entry with the
 * same pos and kind is refreshed (lastStock, seenTick, ownerLineageId);
 * otherwise a new entry is appended. Building entries always carry
 * lastStock = 1 and their true `ownerLineageId`; site entries carry
 * `ownerLineageId: null` (sites are ownerless). After each append, entries
 * are evicted (smallest seenTick first, ties by pos.x, pos.y, kind) until
 * length <= MEMORY_CAP.
 */
export function updateMemory(npc: W2NpcState, obs: W2Observation): void {
  const memory = npc.memory;

  function upsert(
    kind: ResourceKind | BuildingKind,
    pos: Vec2,
    lastStock: number,
    seenTick: number,
    ownerLineageId: string | null,
  ): void {
    const existing = memory.find((e) => e.pos.x === pos.x && e.pos.y === pos.y && e.kind === kind);
    if (existing) {
      existing.lastStock = lastStock;
      existing.seenTick = seenTick;
      existing.ownerLineageId = ownerLineageId;
      return;
    }
    memory.push({ kind, pos: { x: pos.x, y: pos.y }, lastStock, seenTick, ownerLineageId });
    while (memory.length > MEMORY_CAP) {
      let worstIdx = 0;
      for (let i = 1; i < memory.length; i++) {
        if (cmpEvictionOrder(memory[i]!, memory[worstIdx]!) < 0) worstIdx = i;
      }
      memory.splice(worstIdx, 1);
    }
  }

  const sites = [...obs.visibleSites].sort((a, b) => cmpStr(a.id, b.id));
  for (const s of sites) upsert(s.kind, s.pos, s.stock, obs.tick, null);

  const buildings = [...obs.visibleBuildings].sort((a, b) => cmpStr(a.id, b.id));
  for (const b of buildings) upsert(b.kind, b.pos, 1, obs.tick, b.ownerLineageId);
}

/**
 * Selects up to MEMORY_INHERIT_MAX entries from `parentMemory` with the
 * largest seenTick (ties by pos.x, pos.y, kind). Each is independently
 * misremembered with probability MEMORY_MISREMEMBER_PPM / 1_000_000: on a
 * misremember, pos.x and pos.y are each jittered by
 * drawInt(seedRoot, 2*MEMORY_JITTER+1, ...) - MEMORY_JITTER and clamped to
 * [0, GRID-1]. Non-misremembered entries keep their position byte-for-byte.
 * Every returned entry gets seenTick = tick (the child's birth tick).
 */
export function inheritMemory(
  parentMemory: MemoryEntry[],
  childKey: string,
  seedRoot: string,
  tick: number,
): MemoryEntry[] {
  const sorted = [...parentMemory].sort((a, b) => {
    if (a.seenTick !== b.seenTick) return b.seenTick - a.seenTick;
    if (a.pos.x !== b.pos.x) return a.pos.x - b.pos.x;
    if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
    return cmpStr(a.kind, b.kind);
  });
  const top = sorted.slice(0, MEMORY_INHERIT_MAX);

  return top.map((entry, i) => {
    const misremember = drawInt(seedRoot, 1_000_000, "mem-mis", childKey, i) < MEMORY_MISREMEMBER_PPM;
    let pos: Vec2 = { x: entry.pos.x, y: entry.pos.y };
    if (misremember) {
      const jx = drawInt(seedRoot, 2 * MEMORY_JITTER + 1, "mem-jx", childKey, i) - MEMORY_JITTER;
      const jy = drawInt(seedRoot, 2 * MEMORY_JITTER + 1, "mem-jy", childKey, i) - MEMORY_JITTER;
      pos = {
        x: Math.min(GRID - 1, Math.max(0, entry.pos.x + jx)),
        y: Math.min(GRID - 1, Math.max(0, entry.pos.y + jy)),
      };
    }
    return { kind: entry.kind, pos, lastStock: entry.lastStock, seenTick: tick, ownerLineageId: entry.ownerLineageId };
  });
}
