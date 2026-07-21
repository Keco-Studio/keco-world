import type { Policy, Belief, UtilityKey } from "../schema/core.js";
import type { NpcState, WorldState } from "../world/state.js";
import type { SemanticEvent } from "../schema/log.js";

export const BELIEF_CAP = 16;
export const BELIEF_FLOOR = 100;
export const REINFORCE_STEP = 150;

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
          proposition: "the wolf is death; walls are life",
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
      if (npc && npc.hp < 500) {
        const belief: Belief = {
          proposition: "hunger comes fast; gather while you can",
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
              proposition: "winter nearly killed me",
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
