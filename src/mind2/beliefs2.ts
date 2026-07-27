import type { W2Belief } from "../schema/world2.js";
import type { SemanticEvent } from "../schema/log.js";
import type { W2WorldState, W2NpcState } from "../world2/state.js";

/**
 * Task 6 addition (not present after Task 5): `decayBeliefs2` and
 * `beliefFormationStep2`, the w2 counterparts of v1's
 * src/mind/beliefs.ts `decayBeliefs`/`beliefFormationStep`. `applyBeliefs2`
 * itself lives in src/mind2/goals.ts per the Task 6 brief's explicit
 * placement instruction; these two run alongside it at the same tick
 * positions v1 runs its originals. Same constants (BELIEF_CAP 16,
 * BELIEF_FLOOR 100, REINFORCE_STEP 150, confidence/decay magnitudes) as v1;
 * only the three formation rules' targets are re-mapped per the brief:
 *   wolf_attack -> w:takeShelter
 *   starving (hp < 500 gate) -> w:eat
 *   season_change to "winter" (入冬, not v1's "to summer") -> w:takeShelter, condition "winter"
 */

export const BELIEF_CAP = 16;
export const BELIEF_FLOOR = 100;
export const REINFORCE_STEP = 150;

/** In-place decay every 100 ticks: confidence -= decayPer100; drop below floor. */
export function decayBeliefs2(npc: W2NpcState, tick: number): void {
  if (tick % 100 !== 0) return;
  for (const belief of npc.beliefs) {
    belief.confidence -= belief.decayPer100;
  }
  npc.beliefs = npc.beliefs.filter((b) => b.confidence >= BELIEF_FLOOR);
}

/** Event-driven formation for THIS tick's semantic events. Emits belief_formed events. */
export function beliefFormationStep2(state: W2WorldState, events: SemanticEvent[], tickEvents: SemanticEvent[]): void {
  for (const event of tickEvents) {
    if (event.kind === "wolf_attack") {
      const npc = state.npcs.find((n) => n.npcId === event.npcId);
      if (npc && npc.alive) {
        const belief: W2Belief = {
          proposition: "狼口即死，屋内即生",
          effect: { target: "w:takeShelter", modifier: 80, condition: null },
          confidence: 600,
          source: "observed",
          acquiredTick: state.tick,
          decayPer100: 20,
        };
        reinforceOrAdd2(npc, belief, state.tick, events);
      }
    } else if (event.kind === "starving") {
      const npc = state.npcs.find((n) => n.npcId === event.npcId);
      if (npc && npc.alive && npc.hp < 500) {
        const belief: W2Belief = {
          proposition: "饥饿转瞬即至，趁早采摘",
          effect: { target: "w:eat", modifier: 100, condition: null },
          confidence: 600,
          source: "observed",
          acquiredTick: state.tick,
          decayPer100: 25,
        };
        reinforceOrAdd2(npc, belief, state.tick, events);
      }
    } else if (event.kind === "season_change") {
      const season = event.data.season as string;
      if (season === "winter") {
        for (const npc of state.npcs) {
          if (npc.alive && npc.hp < 500) {
            const belief: W2Belief = {
              proposition: "寒冬将至，需未雨绸缪",
              effect: { target: "w:takeShelter", modifier: 60, condition: "winter" },
              confidence: 500,
              source: "observed",
              acquiredTick: state.tick,
              decayPer100: 30,
            };
            reinforceOrAdd2(npc, belief, state.tick, events);
          }
        }
      }
    }
  }
}

/** Helper: reinforce-or-add a belief. Mutates npc.beliefs and emits belief_formed event if new. */
function reinforceOrAdd2(npc: W2NpcState, belief: W2Belief, tick: number, events: SemanticEvent[]): void {
  const target = belief.effect.target;
  const modifierSign = Math.sign(belief.effect.modifier);
  const existingIndex = npc.beliefs.findIndex(
    (b) => b.effect.target === target && Math.sign(b.effect.modifier) === modifierSign,
  );

  if (existingIndex !== -1) {
    npc.beliefs[existingIndex]!.confidence = Math.min(1000, npc.beliefs[existingIndex]!.confidence + REINFORCE_STEP);
  } else {
    if (npc.beliefs.length >= BELIEF_CAP) {
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

    npc.beliefs.push(belief);

    events.push({
      tick,
      kind: "belief_formed",
      npcId: npc.npcId,
      data: { target: belief.effect.target, proposition: belief.proposition },
    });
  }
}
