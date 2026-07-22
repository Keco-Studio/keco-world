import type { Vec2, Identity, Policy, WorldManifest, UtilityKey } from "../schema/core.js";
import type { Action } from "../schema/log.js";
import type { Observation } from "./observe.js";
import { drawInt } from "../rng/rng.js";

export const DIRS: readonly Vec2[] = [
  { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
  { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
] as const;

export interface ScoredCandidate { key: UtilityKey; score: number; action: Action }

export function moveToward(from: Vec2, to: Vec2): Action {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy === 0) return { verb: "idle" };
  return { verb: "move", to: { x: from.x + dx, y: from.y + dy } };
}

/** All applicable candidates in fixed generation order (consume→forage→shelter→seekMate→explore→idle). */
export function scoreCandidates(
  obs: Observation,
  identity: Identity,
  policy: Policy,
  manifest: WorldManifest,
  seedRoot: string,
): ScoredCandidate[] {
  const w = policy.utilityWeights;
  const hungerNeed = Math.floor(((manifest.maxEnergy - obs.self.energy) * 1000) / manifest.maxEnergy);
  const candidates: ScoredCandidate[] = [];

  if (obs.self.berries > 0) {
    candidates.push({ key: "consume", score: Math.floor((w.consume * hungerNeed) / 1000), action: { verb: "consume" } });
  }

  const bush = obs.visibleBushes.find((b) => b.berries > 0);
  if (bush !== undefined) {
    const action: Action =
      bush.dist <= 1 ? { verb: "take", target: bush.id } : moveToward(obs.self.pos, bush.pos);
    candidates.push({ key: "forage", score: Math.floor((w.forage * hungerNeed) / 1000) - 20 * bush.dist, action });
  }

  if (obs.season === "winter" && !obs.onShelter && obs.nearestShelter !== null) {
    candidates.push({
      key: "shelter",
      score: w.shelter - 15 * obs.nearestShelter.dist,
      action: moveToward(obs.self.pos, obs.nearestShelter.pos),
    });
  }

  if (obs.self.reproReady) {
    const mate = obs.visibleNpcs.find((n) => n.fertileAdult);
    if (mate !== undefined) {
      candidates.push({
        key: "seekMate",
        score: w.seekMate - 15 * mate.dist,
        action: mate.dist <= 1 ? { verb: "idle" } : moveToward(obs.self.pos, mate.pos),
      });
    }
  }

  {
    const dir = DIRS[drawInt(seedRoot, 8, "explore", obs.self.npcId, obs.tick)]!;
    const to = { x: obs.self.pos.x + dir.x, y: obs.self.pos.y + dir.y };
    const inBounds = to.x >= 0 && to.x < manifest.gridWidth && to.y >= 0 && to.y < manifest.gridHeight;
    candidates.push({
      key: "explore",
      score: Math.floor((w.explore * identity.explorationBias) / 1000),
      action: inBounds ? { verb: "move", to } : { verb: "idle" },
    });
  }

  candidates.push({ key: "idle", score: w.idle, action: { verb: "idle" } });

  return candidates;
}

/** Strict > comparison; earliest candidate wins ties. */
export function pickBest(candidates: ScoredCandidate[]): ScoredCandidate {
  let best = candidates[0]!;
  for (const c of candidates) if (c.score > best.score) best = c;
  return best;
}

/** Deterministic integer scoring per plan spec; ties resolved by candidate order. */
export function utilityDecide(
  obs: Observation,
  identity: Identity,
  policy: Policy,
  manifest: WorldManifest,
  seedRoot: string,
): { action: Action; key: UtilityKey } {
  const best = pickBest(scoreCandidates(obs, identity, policy, manifest, seedRoot));
  return { action: best.action, key: best.key };
}
