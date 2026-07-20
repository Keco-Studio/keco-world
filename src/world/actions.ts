import type { WorldManifest } from "../schema/core.js";
import type { Action } from "../schema/log.js";
import type { WorldState, NpcState } from "./state.js";
import { chebyshev } from "./state.js";
import { DIRS } from "../mind/utility.js";

function inBounds(x: number, y: number, manifest: WorldManifest): boolean {
  return x >= 0 && x < manifest.gridWidth && y >= 0 && y < manifest.gridHeight;
}

/** Applies an action, mutating state. Returns false (and no-ops) when illegal. */
export function applyAction(
  state: WorldState,
  manifest: WorldManifest,
  npc: NpcState,
  action: Action,
): boolean {
  switch (action.verb) {
    case "move": {
      const { to } = action;
      if (!inBounds(to.x, to.y, manifest)) return false;
      if (chebyshev(npc.pos, to) > 1) return false;
      npc.pos = { x: to.x, y: to.y };
      return true;
    }
    case "take": {
      const bush = state.bushes.find((b) => b.id === action.target);
      if (bush === undefined) return false;
      if (chebyshev(npc.pos, bush.pos) > 1) return false;
      if (bush.berries <= 0) return false;
      bush.berries -= 1;
      npc.berries += 1;
      return true;
    }
    case "consume": {
      if (npc.berries <= 0) return false;
      npc.berries -= 1;
      npc.energy = Math.min(manifest.maxEnergy, npc.energy + manifest.berryEnergy);
      return true;
    }
    case "flee": {
      // candidates: stay + 8 dirs, in-bounds; pick max distance to wolf, last wins ties
      let best = { x: npc.pos.x, y: npc.pos.y };
      let bestDist = chebyshev(best, state.wolf.pos);
      for (const d of DIRS) {
        const cand = { x: npc.pos.x + d.x, y: npc.pos.y + d.y };
        if (!inBounds(cand.x, cand.y, manifest)) continue;
        const dist = chebyshev(cand, state.wolf.pos);
        if (dist >= bestDist) {
          best = cand;
          bestDist = dist;
        }
      }
      npc.pos = best;
      return true;
    }
    case "idle":
      return true;
  }
}
