import type { Vec2 } from "../schema/core.js";
import type { W2Manifest, BuildingKind } from "../schema/world2.js";
import { RESOURCE_KINDS, RECIPES, CARRY_CAP, GRANARY_CAP } from "../schema/world2.js";
import type { W2WorldState, W2NpcState } from "./state.js";
import { chebyshev2, carryTotal, lineageGranaryAt } from "./state.js";
import { DIRS } from "../mind/utility.js";

export type W2Action =
  | { verb: "move"; to: Vec2 }
  | { verb: "gather"; siteId: string }
  | { verb: "consume" }
  | { verb: "deposit"; buildingId: string }
  | { verb: "withdraw"; buildingId: string }
  | { verb: "build"; kind: BuildingKind }
  | { verb: "idle" }
  | { verb: "flee"; from: string };

function inBounds2(x: number, y: number, manifest: W2Manifest): boolean {
  return x >= 0 && x < manifest.gridWidth && y >= 0 && y < manifest.gridHeight;
}

/**
 * Applies a v2 action, mutating state. Returns false (and no-ops) when illegal.
 * Engine contract (v1 parity): a false return means the caller must treat the
 * action as illegal — live decisions throw, injected replay halts.
 */
export function applyAction2(
  state: W2WorldState,
  manifest: W2Manifest,
  npc: W2NpcState,
  action: W2Action,
): boolean {
  switch (action.verb) {
    case "move": {
      const { to } = action;
      if (!inBounds2(to.x, to.y, manifest)) return false;
      if (chebyshev2(npc.pos, to) > 1) return false;
      npc.pos = { x: to.x, y: to.y };
      return true;
    }
    case "gather": {
      const site = state.sites.find((s) => s.id === action.siteId);
      if (site === undefined) return false;
      if (chebyshev2(npc.pos, site.pos) > 1) return false;
      if (site.stock <= 0) return false;
      if (carryTotal(npc.carry) >= CARRY_CAP) return false;
      site.stock -= 1;
      npc.carry[site.kind] += 1;
      return true;
    }
    case "consume": {
      if (npc.carry.berry <= 0) return false;
      npc.carry.berry -= 1;
      npc.energy = Math.min(manifest.maxEnergy, npc.energy + manifest.berryEnergy);
      return true;
    }
    case "deposit": {
      const b = lineageGranaryAt(state, npc.pos, npc.lineageId);
      if (b === null || b.id !== action.buildingId) return false;
      const amount = Math.min(npc.carry.berry, GRANARY_CAP - carryTotal(b.store));
      if (amount <= 0) return false;
      npc.carry.berry -= amount;
      b.store.berry += amount;
      return true;
    }
    case "withdraw": {
      const b = lineageGranaryAt(state, npc.pos, npc.lineageId);
      if (b === null || b.id !== action.buildingId) return false;
      const amount = Math.min(b.store.berry, CARRY_CAP - carryTotal(npc.carry));
      if (amount <= 0) return false;
      b.store.berry -= amount;
      npc.carry.berry += amount;
      return true;
    }
    case "build": {
      const hasBuildingHere = state.buildings.some(
        (b) => b.pos.x === npc.pos.x && b.pos.y === npc.pos.y,
      );
      if (hasBuildingHere) return false;
      const recipe = RECIPES[action.kind];
      for (const k of RESOURCE_KINDS) {
        if (npc.carry[k] < (recipe[k] ?? 0)) return false;
      }
      for (const k of RESOURCE_KINDS) {
        npc.carry[k] -= recipe[k] ?? 0;
      }
      state.buildings.push({
        id: `b-${state.tick}-${npc.npcId}`,
        kind: action.kind,
        pos: { x: npc.pos.x, y: npc.pos.y },
        ownerNpcId: npc.npcId,
        ownerLineageId: npc.lineageId,
        builtTick: state.tick,
        store: { berry: 0, wood: 0, stone: 0, gold: 0 },
      });
      return true;
    }
    case "idle":
      return true;
    case "flee": {
      // candidates: stay + 8 dirs, in-bounds; pick max distance to wolf, last wins ties (v1 parity).
      let best = { x: npc.pos.x, y: npc.pos.y };
      let bestDist = chebyshev2(best, state.wolf.pos);
      for (const d of DIRS) {
        const cand = { x: npc.pos.x + d.x, y: npc.pos.y + d.y };
        if (!inBounds2(cand.x, cand.y, manifest)) continue;
        const dist = chebyshev2(cand, state.wolf.pos);
        if (dist >= bestDist) {
          best = cand;
          bestDist = dist;
        }
      }
      npc.pos = best;
      return true;
    }
  }
}
