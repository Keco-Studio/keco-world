// DOM-free sim driver: wraps runFromState into a single-tick step() call so the
// web shell can advance the live in-browser kernel one tick at a time.
import type { WorldManifest, RosterEntry } from "../../src/schema/core.js";
import type { RunOptions, DecideInfo } from "../../src/sim/engine.js";
import { runFromState } from "../../src/sim/engine.js";
import type { WorldState } from "../../src/world/state.js";
import type { SemanticEvent } from "../../src/schema/log.js";
import type { DirectedOpening } from "../../src/director/director.js";

export interface SimHandle {
  state: WorldState;
  events: SemanticEvent[];
  /** npcId → latest DecideInfo this tick. */
  lastDecisions: Map<string, DecideInfo>;
  /** advance exactly 1 tick. */
  step(patronDirectives?: RunOptions["patronDirectives"]): void;
}

export function createSim(
  manifest: WorldManifest,
  roster: RosterEntry[],
  seedRoot: string,
  opening: DirectedOpening,
): SimHandle {
  void roster; // roster is baked into opening.state already; kept in the signature per the interface contract
  let state: WorldState = opening.state;
  const events: SemanticEvent[] = [...opening.events];
  let lastDecisions = new Map<string, DecideInfo>();

  return {
    get state(): WorldState {
      return state;
    },
    get events(): SemanticEvent[] {
      return events;
    },
    get lastDecisions(): Map<string, DecideInfo> {
      return lastDecisions;
    },
    step(patronDirectives?: RunOptions["patronDirectives"]): void {
      const decisions = new Map<string, DecideInfo>();
      const result = runFromState(state, manifest, seedRoot, {
        ticks: 1,
        retainActionLog: false,
        patronDirectives,
        onDecide: (info) => decisions.set(info.npcId, info),
      });
      state = result.finalState;
      events.push(...result.events);
      lastDecisions = decisions;
    },
  };
}
