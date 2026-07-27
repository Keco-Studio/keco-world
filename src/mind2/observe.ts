import type { Vec2 } from "../schema/core.js";
import type { W2Manifest, ResourceKind, BuildingKind } from "../schema/world2.js";
import type { W2WorldState, W2NpcState } from "../world2/state.js";
import { chebyshev2, seasonAt2, npcAge2, shelterAt } from "../world2/state.js";
import { isFertileEligible2 } from "../world2/rules.js";

export interface W2Observation {
  tick: number;
  season: "summer" | "winter";
  onShelter: boolean;
  self: {
    npcId: string;
    pos: Vec2;
    hp: number;
    energy: number;
    carry: Record<ResourceKind, number>;
    reproReady: boolean;
    lineageId: string;
  };
  visibleNpcs: { npcId: string; pos: Vec2; dist: number; fertileAdult: boolean }[];
  visibleSites: { id: string; kind: ResourceKind; pos: Vec2; stock: number; dist: number }[];
  visibleBuildings: {
    id: string;
    kind: BuildingKind;
    pos: Vec2;
    ownerLineageId: string;
    storeBerry: number;
    dist: number;
  }[];
  wolf: { pos: Vec2; dist: number } | null;
}

/** UTF-16 string comparison; never localeCompare (determinism doctrine). */
function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildObservation2(
  state: W2WorldState,
  manifest: W2Manifest,
  npc: W2NpcState,
): W2Observation {
  const visibleNpcs = state.npcs
    .filter((other) => other.npcId !== npc.npcId && other.alive)
    .map((other) => {
      const dist = chebyshev2(npc.pos, other.pos);
      const age = npcAge2(other, state.tick);
      const fertileAdult = age >= manifest.adultAgeTicks && age <= manifest.elderAgeTicks;
      return {
        npcId: other.npcId,
        pos: { x: other.pos.x, y: other.pos.y },
        dist,
        fertileAdult,
      };
    })
    .filter((n) => n.dist <= manifest.visionRadius)
    .sort((a, b) => (a.dist !== b.dist ? a.dist - b.dist : cmpStr(a.npcId, b.npcId)));

  const visibleSites = state.sites
    .map((s) => ({
      id: s.id,
      kind: s.kind,
      pos: { x: s.pos.x, y: s.pos.y },
      stock: s.stock,
      dist: chebyshev2(npc.pos, s.pos),
    }))
    .filter((s) => s.dist <= manifest.visionRadius)
    .sort((a, b) => (a.dist !== b.dist ? a.dist - b.dist : cmpStr(a.id, b.id)));

  const visibleBuildings = state.buildings
    .map((b) => ({
      id: b.id,
      kind: b.kind,
      pos: { x: b.pos.x, y: b.pos.y },
      ownerLineageId: b.ownerLineageId,
      storeBerry: b.store.berry,
      dist: chebyshev2(npc.pos, b.pos),
    }))
    .filter((b) => b.dist <= manifest.visionRadius)
    .sort((a, b) => (a.dist !== b.dist ? a.dist - b.dist : cmpStr(a.id, b.id)));

  const wolfDist = chebyshev2(npc.pos, state.wolf.pos);
  const wolf =
    wolfDist <= manifest.visionRadius
      ? { pos: { x: state.wolf.pos.x, y: state.wolf.pos.y }, dist: wolfDist }
      : null;

  return {
    tick: state.tick,
    season: seasonAt2(state.tick, manifest),
    onShelter: shelterAt(state, npc.pos) !== null,
    self: {
      npcId: npc.npcId,
      pos: { x: npc.pos.x, y: npc.pos.y },
      hp: npc.hp,
      energy: npc.energy,
      carry: { ...npc.carry },
      reproReady: isFertileEligible2(npc, manifest, state.tick),
      lineageId: npc.lineageId,
    },
    visibleNpcs,
    visibleSites,
    visibleBuildings,
    wolf,
  };
}
