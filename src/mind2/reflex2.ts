import type { W2Policy } from "../schema/world2.js";
import type { W2Observation } from "./observe.js";
import type { W2Action } from "../world2/actions.js";

const FLEE_RADIUS = 2;

/** Fixed priority order; returns null when no reflex fires (v1 mind/reflex.ts parity). */
export function reflexDecide2(obs: W2Observation, effPolicy: W2Policy): W2Action | null {
  if (obs.wolf !== null && obs.wolf.dist <= FLEE_RADIUS) {
    return { verb: "flee", from: "wolf" };
  }
  if (obs.self.energy < effPolicy.thresholds.hungerUrgent && obs.self.carry.berry > 0) {
    return { verb: "consume" };
  }
  return null;
}
