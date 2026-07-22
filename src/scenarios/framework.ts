import type { Identity, Policy, Belief, WorldManifest } from "../schema/core.js";
import type { WorldState } from "../world/state.js";
import { runFromState } from "../sim/engine.js";
import { hashCanonical } from "../canon/canonicalize.js";

export type ScenarioCategory = "hunger" | "winter" | "predator" | "courtship" | "hesitation" | "sequence";

export interface Scenario {
  id: string; // e.g. "H1"
  category: ScenarioCategory;
  title: string; // one-line human description
  horizon: number; // ticks to run (1 for single-decision, up to 40 for sequence)
  build(): { manifest: WorldManifest; state: WorldState; focalNpcId: string };
}

export interface GenomeUnderTest {
  identity: Identity;
  policy: Policy;
  beliefs: Belief[];
}

export interface ScenarioTrace {
  scenarioId: string;
  verbs: string[]; // focal NPC's action verbs in order
  keys: (string | null)[]; // chosenKey per decision (null = reflex)
}

/**
 * Evaluate a genome-under-test across a batch of scenarios: for each scenario, deep-copy the
 * built state, inject the genome into the focal NPC (identity/policy/beliefs replaced, genomeHash
 * recomputed), then run the tick loop for `horizon` ticks, recording only the focal NPC's
 * decisions (verb + chosenKey) in order.
 */
export function evaluateGenome(
  g: GenomeUnderTest,
  scenarios: Scenario[],
  seedRoot?: string,
): ScenarioTrace[] {
  return scenarios.map((scenario) => {
    const built = scenario.build();
    const state: WorldState = structuredClone(built.state);
    const focal = state.npcs.find((n) => n.npcId === built.focalNpcId);
    if (focal === undefined) {
      throw new Error(`scenario ${scenario.id}: focal npc ${built.focalNpcId} not found in built state`);
    }

    focal.identity = structuredClone(g.identity);
    focal.policy = structuredClone(g.policy);
    focal.beliefs = structuredClone(g.beliefs);
    focal.genomeHash = hashCanonical({ identity: focal.identity, policy: focal.policy, beliefs: focal.beliefs });

    const verbs: string[] = [];
    const keys: (string | null)[] = [];

    runFromState(state, built.manifest, seedRoot ?? "scenario-eval", {
      ticks: scenario.horizon,
      retainActionLog: true,
      onDecide: (info) => {
        if (info.npcId !== built.focalNpcId) return;
        verbs.push(info.action.verb);
        keys.push(info.chosenKey);
      },
    });

    return { scenarioId: scenario.id, verbs, keys };
  });
}
