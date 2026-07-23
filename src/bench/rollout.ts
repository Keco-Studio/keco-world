import type { WorldManifest, RosterEntry } from "../schema/core.js";
import type { Action } from "../schema/log.js";
import { runSim } from "../sim/engine.js";
import { hashCanonical } from "../canon/canonicalize.js";
import type { TriggerPoint } from "./trigger.js";

export function actionsEqual(a: Action, b: Action): boolean {
  return hashCanonical(a) === hashCanonical(b);
}

/**
 * Shadow branch rollout: re-run deterministically from t=1 with exactly one
 * injected action at (trigger.tick, trigger.npcId), continue horizonTicks past
 * the trigger, and score the NPC's outcome. Preregistered margin:
 *   alive ? 10_000 + hp + energy + 100*berries : (deathTick - triggerTick)
 */
export function evaluateBranch(
  manifest: WorldManifest,
  roster: RosterEntry[],
  trigger: TriggerPoint,
  forcedAction: Action,
  horizonTicks: number,
): number {
  const injected = new Map([
    [`${trigger.tick}:${trigger.npcId}`, { action: forcedAction, actionSource: "utility" as const, patronInfluence: false }],
  ]);
  const r = runSim(manifest, roster, trigger.seedRoot, {
    ticks: trigger.tick + horizonTicks,
    injectedActions: injected,
  });
  if (r.haltedAtTick !== null) {
    throw new Error(
      `rollout halted at tick ${r.haltedAtTick} — forced action was illegal for ${trigger.id}`,
    );
  }
  const npc = r.finalState.npcs.find((n) => n.npcId === trigger.npcId);
  if (npc === undefined) throw new Error(`npc ${trigger.npcId} missing from rollout`);
  return npc.alive
    ? 10_000 + npc.hp + npc.energy + 100 * npc.berries
    : (npc.deathTick ?? trigger.tick) - trigger.tick;
}

export interface PairResult { marginA: number; marginB: number; outcome: "A" | "B" | "tie" }

export function evaluatePair(
  manifest: WorldManifest,
  roster: RosterEntry[],
  trigger: TriggerPoint,
  actionA: Action,
  actionB: Action,
  horizonTicks: number,
): PairResult {
  const marginA = evaluateBranch(manifest, roster, trigger, actionA, horizonTicks);
  const marginB = evaluateBranch(manifest, roster, trigger, actionB, horizonTicks);
  return { marginA, marginB, outcome: marginA > marginB ? "A" : marginA < marginB ? "B" : "tie" };
}
