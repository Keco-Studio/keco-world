import type { Policy, Belief, UtilityKey } from "../schema/core.js";
import type { NpcState, WorldState } from "../world/state.js";
import type { SemanticEvent } from "../schema/log.js";
import { fnv1a32 } from "../rng/rng.js";

export const BELIEF_CAP = 16;
export const BELIEF_FLOOR = 100;
export const REINFORCE_STEP = 150;

/** Formation-rule proposition pools (blinding fix: the three formation rules used to
 * emit one fixed English sentence apiece — a lexical arm tell, since these are the
 * ONLY propositions an Evolutionary-arm biography ever contains). Each rule now has
 * 3 Chinese variants (register matches the designed archetypes in src/arms/arms.ts,
 * each ≤20 chars). */
export const WOLF_PROPOSITIONS = ["狼口即死，墙内即生", "见狼要跑，有墙要躲", "狼是死神，屋是命"] as const;
export const HUNGER_PROPOSITIONS = ["饥饿转瞬即至，趁早采摘", "错过时机，腹中空空", "能摘就摘，莫要迟疑"] as const;
export const WINTER_PROPOSITIONS = ["那个寒冬，几乎要了我的命", "严冬几乎夺走我的命", "寒冬近乎致命，我记得"] as const;

/**
 * Deterministic per-(npcId, tick) variant pick. `beliefFormationStep` only receives
 * `WorldState` + event arrays — no seedRoot is in scope here (unlike drawInt call
 * sites elsewhere) — so this substitutes an fnv1a32 hash of "npcId:tick" mod the
 * pool size. Same modulo-bias caveat as drawInt (src/rng/rng.ts): acceptable at a
 * pool size of 3.
 */
function pickVariant(pool: readonly string[], npcId: string, tick: number): string {
  const idx = fnv1a32(`${npcId}:${tick}`) % pool.length;
  return pool[idx]!;
}

/** Confidence-scaled, season-gated belief deltas applied to a copy of policy. Never mutates inputs. */
export function applyBeliefs(policy: Policy, beliefs: Belief[], season: "summer" | "winter"): Policy {
  // Start with a deep copy of the policy
  const result: Policy = {
    utilityWeights: { ...policy.utilityWeights },
    thresholds: { ...policy.thresholds },
    deliberationEpsilon: policy.deliberationEpsilon,
  };

  // Apply each belief that is active for this season
  for (const belief of beliefs) {
    // Gate by season condition
    if (belief.effect.condition !== null && belief.effect.condition !== season) {
      continue;
    }

    // Calculate the delta: floor(modifier * confidence / 1000)
    const delta = Math.floor((belief.effect.modifier * belief.confidence) / 1000);

    // Apply delta based on target type
    const target = belief.effect.target;
    if (target.startsWith("w:")) {
      // Weight target: "w:forage" -> utilityWeights.forage
      const weightKey = target.slice(2) as UtilityKey;
      result.utilityWeights[weightKey] = Math.max(0, Math.min(1000, result.utilityWeights[weightKey] + delta));
    } else if (target.startsWith("t:")) {
      // Threshold target: "t:hungerUrgent" -> thresholds.hungerUrgent
      const thresholdKey = target.slice(2) as keyof typeof result.thresholds;
      result.thresholds[thresholdKey] = Math.max(0, Math.min(1000, result.thresholds[thresholdKey] + delta));
    }
  }

  return result;
}

/** In-place decay every 100 ticks: confidence -= decayPer100; drop below floor. */
export function decayBeliefs(npc: NpcState, tick: number): void {
  // Only decay on century ticks (tick % 100 === 0)
  if (tick % 100 !== 0) {
    return;
  }

  // Apply decay to each belief
  for (const belief of npc.beliefs) {
    belief.confidence -= belief.decayPer100;
  }

  // Remove beliefs below the floor
  npc.beliefs = npc.beliefs.filter((b) => b.confidence >= BELIEF_FLOOR);
}

/** Event-driven formation for THIS tick's semantic events. Emits belief_formed events. */
export function beliefFormationStep(state: WorldState, events: SemanticEvent[], tickEvents: SemanticEvent[]): void {
  for (const event of tickEvents) {
    if (event.kind === "wolf_attack") {
      // Rule 1: wolf_attack on an alive NPC → reinforce-or-add shelter belief
      const npc = state.npcs.find((n) => n.npcId === event.npcId);
      if (npc && npc.alive) {
        const belief: Belief = {
          proposition: pickVariant(WOLF_PROPOSITIONS, npc.npcId, state.tick),
          effect: { target: "w:shelter", modifier: 80, condition: null },
          confidence: 600,
          source: "observed",
          acquiredTick: state.tick,
          decayPer100: 20,
        };
        reinforceOrAdd(npc, belief, state.tick, events);
      }
    } else if (event.kind === "starving") {
      // Rule 2: starving on an NPC with hp < 500 → reinforce-or-add forage belief
      const npc = state.npcs.find((n) => n.npcId === event.npcId);
      if (npc && npc.alive && npc.hp < 500) {
        const belief: Belief = {
          proposition: pickVariant(HUNGER_PROPOSITIONS, npc.npcId, state.tick),
          effect: { target: "w:forage", modifier: 100, condition: null },
          confidence: 600,
          source: "observed",
          acquiredTick: state.tick,
          decayPer100: 25,
        };
        reinforceOrAdd(npc, belief, state.tick, events);
      }
    } else if (event.kind === "season_change") {
      // Rule 3: season_change to "summer" → every alive NPC with hp < 500 reinforce-or-add winter shelter belief
      const season = event.data.season as string;
      if (season === "summer") {
        for (const npc of state.npcs) {
          if (npc.alive && npc.hp < 500) {
            const belief: Belief = {
              proposition: pickVariant(WINTER_PROPOSITIONS, npc.npcId, state.tick),
              effect: { target: "w:shelter", modifier: 60, condition: "winter" },
              confidence: 500,
              source: "observed",
              acquiredTick: state.tick,
              decayPer100: 30,
            };
            reinforceOrAdd(npc, belief, state.tick, events);
          }
        }
      }
    }
  }
}

/** Helper: reinforce-or-add a belief. Mutates npc.beliefs and emits belief_formed event if new. */
function reinforceOrAdd(npc: NpcState, belief: Belief, tick: number, events: SemanticEvent[]): void {
  // Find existing belief with same effect.target and same modifier sign
  const target = belief.effect.target;
  const modifierSign = Math.sign(belief.effect.modifier);
  const existingIndex = npc.beliefs.findIndex(
    (b) => b.effect.target === target && Math.sign(b.effect.modifier) === modifierSign,
  );

  if (existingIndex !== -1) {
    // Reinforce: increase confidence, no event
    npc.beliefs[existingIndex]!.confidence = Math.min(1000, npc.beliefs[existingIndex]!.confidence + REINFORCE_STEP);
  } else {
    // Add new belief
    // Check if at capacity
    if (npc.beliefs.length >= BELIEF_CAP) {
      // Drop the lowest-confidence belief (tie: earliest in array)
      let minIdx = 0;
      let minConf = npc.beliefs[0]!.confidence;
      for (let i = 1; i < npc.beliefs.length; i++) {
        if (npc.beliefs[i]!.confidence < minConf) {
          minConf = npc.beliefs[i]!.confidence;
          minIdx = i;
        }
      }
      npc.beliefs.splice(minIdx, 1);
    }

    // Push new belief
    npc.beliefs.push(belief);

    // Emit belief_formed event
    events.push({
      tick,
      kind: "belief_formed",
      npcId: npc.npcId,
      data: { target: belief.effect.target, proposition: belief.proposition },
    });
  }
}
