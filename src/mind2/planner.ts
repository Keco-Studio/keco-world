import type { Vec2 } from "../schema/core.js";
import type { W2Manifest, GoalKey, BuildingKind, ResourceKind, MemoryEntry } from "../schema/world2.js";
import { RESOURCE_KINDS, RECIPES, CARRY_CAP } from "../schema/world2.js";
import type { W2NpcState } from "../world2/state.js";
import { chebyshev2, carryTotal } from "../world2/state.js";
import type { W2Observation } from "./observe.js";
import type { W2Action } from "../world2/actions.js";
import { DIRS } from "../mind/utility.js";
import { drawInt } from "../rng/rng.js";

/**
 * "Nearest remembered X": filter memory entries of the given kind with
 * lastStock > 0 (and, when `ownerLineageId` is given, matching ownership —
 * used to find one's own lineage's granary from memory, since ownership
 * can't be read off `obs.visibleBuildings` once out of vision range), sort
 * by chebyshev2 distance from `from` ascending, tie-break pos.x then pos.y
 * ascending, return the first (or null if none qualify). Frozen determinism
 * detail from the Task 5 brief.
 */
export function nearestRemembered(
  memory: MemoryEntry[],
  kind: ResourceKind | BuildingKind,
  from: Vec2,
  ownerLineageId?: string,
): MemoryEntry | null {
  const candidates = memory.filter(
    (e) => e.kind === kind && e.lastStock > 0 && (ownerLineageId === undefined || e.ownerLineageId === ownerLineageId),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const da = chebyshev2(from, a.pos);
    const db = chebyshev2(from, b.pos);
    if (da !== db) return da - db;
    if (a.pos.x !== b.pos.x) return a.pos.x - b.pos.x;
    return a.pos.y - b.pos.y;
  });
  return candidates[0]!;
}

/** Diagonal step toward `to`, sign(dx)/sign(dy); idle when already there (v1 moveToward parity). */
function moveToward2(from: Vec2, to: Vec2): W2Action {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy === 0) return { verb: "idle" };
  return { verb: "move", to: { x: from.x + dx, y: from.y + dy } };
}

function inBounds2(x: number, y: number, manifest: W2Manifest): boolean {
  return x >= 0 && x < manifest.gridWidth && y >= 0 && y < manifest.gridHeight;
}

/** Deterministic exploration step when memory has nothing usable: drawInt over DIRS, idle if out of bounds. */
function exploreStep(
  pos: Vec2,
  manifest: W2Manifest,
  seedRoot: string,
  npcId: string,
  tick: number,
): W2Action {
  const dir = DIRS[drawInt(seedRoot, 8, "w2-explore", npcId, tick)]!;
  const to = { x: pos.x + dir.x, y: pos.y + dir.y };
  if (!inBounds2(to.x, to.y, manifest)) return { verb: "idle" };
  return { verb: "move", to };
}

/**
 * Acquisition path shared by eat/stockpile/build goals: go get one unit of
 * `kind` from the nearest remembered site. Adjacent (<=1) site -> gather;
 * otherwise move a step closer; nothing remembered -> exploration step.
 */
function gatherPath(
  kind: ResourceKind,
  npc: W2NpcState,
  obs: W2Observation,
  manifest: W2Manifest,
  seedRoot: string,
): W2Action {
  const target = nearestRemembered(npc.memory, kind, npc.pos);
  if (target === null) return exploreStep(npc.pos, manifest, seedRoot, npc.npcId, obs.tick);
  if (chebyshev2(npc.pos, target.pos) <= 1) {
    const site = obs.visibleSites.find(
      (s) => s.kind === kind && s.pos.x === target.pos.x && s.pos.y === target.pos.y,
    );
    if (site !== undefined) return { verb: "gather", siteId: site.id };
  }
  return moveToward2(npc.pos, target.pos);
}

function ownGranaryHere(obs: W2Observation): W2Observation["visibleBuildings"][number] | null {
  const b = obs.visibleBuildings.find(
    (x) => x.kind === "granary" && x.ownerLineageId === obs.self.lineageId && x.dist === 0,
  );
  return b ?? null;
}

function planEat(obs: W2Observation, npc: W2NpcState, manifest: W2Manifest, seedRoot: string): W2Action {
  if (npc.carry.berry > 0) return { verb: "consume" };
  const granary = ownGranaryHere(obs);
  if (granary !== null && granary.storeBerry > 0) return { verb: "withdraw", buildingId: granary.id };
  return gatherPath("berry", npc, obs, manifest, seedRoot);
}

function planStockpile(obs: W2Observation, npc: W2NpcState, manifest: W2Manifest, seedRoot: string): W2Action {
  if (carryTotal(npc.carry) < CARRY_CAP) return gatherPath("berry", npc, obs, manifest, seedRoot);
  const granary = ownGranaryHere(obs);
  if (granary !== null) return { verb: "deposit", buildingId: granary.id };
  // Navigate home from memory (ownership-filtered) so a full-carry NPC can find its
  // way back even when the granary itself is currently out of vision range.
  const target = nearestRemembered(npc.memory, "granary", npc.pos, npc.lineageId);
  if (target === null) return exploreStep(npc.pos, manifest, seedRoot, npc.npcId, obs.tick);
  return moveToward2(npc.pos, target.pos);
}

function planTakeShelter(obs: W2Observation, npc: W2NpcState, manifest: W2Manifest, seedRoot: string): W2Action {
  if (obs.onShelter) return { verb: "idle" };
  const target = nearestRemembered(npc.memory, "shelter", npc.pos);
  if (target === null) return exploreStep(npc.pos, manifest, seedRoot, npc.npcId, obs.tick);
  return moveToward2(npc.pos, target.pos);
}

function planBuildGoal(
  kind: BuildingKind,
  obs: W2Observation,
  npc: W2NpcState,
  manifest: W2Manifest,
  seedRoot: string,
): W2Action {
  const recipe = RECIPES[kind];
  let bestResource: ResourceKind | null = null;
  let bestGap = 0;
  for (const r of RESOURCE_KINDS) {
    const gap = (recipe[r] ?? 0) - npc.carry[r];
    if (gap > bestGap) {
      bestGap = gap;
      bestResource = r;
    }
  }
  if (bestResource !== null) return gatherPath(bestResource, npc, obs, manifest, seedRoot);

  const hasBuildingHere = obs.visibleBuildings.some((b) => b.dist === 0);
  if (!hasBuildingHere) return { verb: "build", kind };

  for (const d of DIRS) {
    const cand = { x: npc.pos.x + d.x, y: npc.pos.y + d.y };
    if (!inBounds2(cand.x, cand.y, manifest)) continue;
    const occupied = obs.visibleBuildings.some((b) => b.pos.x === cand.x && b.pos.y === cand.y);
    if (!occupied) return { verb: "move", to: cand };
  }
  return { verb: "idle" };
}

export function planAction(
  goal: GoalKey,
  obs: W2Observation,
  npc: W2NpcState,
  manifest: W2Manifest,
  seedRoot: string,
): W2Action {
  switch (goal) {
    case "eat":
      return planEat(obs, npc, manifest, seedRoot);
    case "stockpile":
      return planStockpile(obs, npc, manifest, seedRoot);
    case "takeShelter":
      return planTakeShelter(obs, npc, manifest, seedRoot);
    case "shelterBuild":
      return planBuildGoal("shelter", obs, npc, manifest, seedRoot);
    case "granaryBuild":
      return planBuildGoal("granary", obs, npc, manifest, seedRoot);
    case "monumentBuild":
      return planBuildGoal("monument", obs, npc, manifest, seedRoot);
    case "rest":
      return { verb: "idle" };
  }
}
