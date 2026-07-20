import type { Policy } from "../schema/core.js";
import type { Action } from "../schema/log.js";
import type { Observation } from "./observe.js";

const FLEE_RADIUS = 2;

/** Fixed priority order; returns null when no reflex fires. Doc §6.2. */
export function reflexDecide(obs: Observation, policy: Policy): Action | null {
  if (obs.wolf !== null && obs.wolf.dist <= FLEE_RADIUS) {
    return { verb: "flee", from: "wolf" };
  }
  if (obs.self.energy < policy.thresholds.hungerUrgent && obs.self.berries > 0) {
    return { verb: "consume" };
  }
  return null;
}
