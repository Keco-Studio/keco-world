import type { Vec2, WorldManifest } from "../schema/core.js";
import type { WorldState, NpcState } from "../world/state.js";
import { chebyshev, seasonAt, isOnShelter } from "../world/state.js";

export interface Observation {
  tick: number;
  season: "summer" | "winter";
  onShelter: boolean;
  self: { npcId: string; pos: Vec2; hp: number; energy: number; berries: number };
  visibleBushes: { id: string; pos: Vec2; berries: number; dist: number }[];
  wolf: { pos: Vec2; dist: number } | null;
  nearestShelter: { pos: Vec2; dist: number } | null;
}

export function buildObservation(
  state: WorldState,
  manifest: WorldManifest,
  npc: NpcState,
): Observation {
  const visibleBushes = state.bushes
    .map((b) => ({ id: b.id, pos: { x: b.pos.x, y: b.pos.y }, berries: b.berries, dist: chebyshev(npc.pos, b.pos) }))
    .filter((b) => b.dist <= manifest.visionRadius)
    .sort((a, b) => (a.dist - b.dist) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const wolfDist = chebyshev(npc.pos, state.wolf.pos);
  const wolf =
    wolfDist <= manifest.visionRadius
      ? { pos: { x: state.wolf.pos.x, y: state.wolf.pos.y }, dist: wolfDist }
      : null;

  let nearestShelter: Observation["nearestShelter"] = null;
  for (const s of manifest.shelters) {
    const d = chebyshev(npc.pos, s);
    if (nearestShelter === null || d < nearestShelter.dist) {
      nearestShelter = { pos: { x: s.x, y: s.y }, dist: d };
    }
  }

  return {
    tick: state.tick,
    season: seasonAt(state.tick, manifest),
    onShelter: isOnShelter(npc.pos, manifest),
    self: { npcId: npc.npcId, pos: { x: npc.pos.x, y: npc.pos.y }, hp: npc.hp, energy: npc.energy, berries: npc.berries },
    visibleBushes,
    wolf,
    nearestShelter,
  };
}
