import type { WorldManifest, RosterEntry } from "../schema/core.js";
import type { Observation } from "../mind/observe.js";
import type { ScoredCandidate } from "../mind/utility.js";
import { pickBest } from "../mind/utility.js";
import { runSim } from "../sim/engine.js";

export interface TriggerPoint {
  id: string;
  seedRoot: string;
  tick: number;
  npcId: string;
  observation: Observation;
  candidates: ScoredCandidate[];
  bestIndex: number;
  gap: number;
}

/** Harvest utility decisions whose top-2 score gap ≤ epsilon (deliberation trigger band). */
export function findTriggers(
  manifest: WorldManifest,
  roster: RosterEntry[],
  seedRoot: string,
  ticks: number,
  epsilon: number,
): TriggerPoint[] {
  const triggers: TriggerPoint[] = [];
  runSim(manifest, roster, seedRoot, {
    ticks,
    onDecide: (info) => {
      if (info.candidates === null || info.candidates.length < 2) return;
      const sorted = [...info.candidates].sort((a, b) => b.score - a.score);
      const gap = sorted[0]!.score - sorted[1]!.score;
      if (gap > epsilon) return;
      const best = pickBest(info.candidates);
      triggers.push({
        id: `${seedRoot}:${info.tick}:${info.npcId}`,
        seedRoot,
        tick: info.tick,
        npcId: info.npcId,
        observation: info.observation,
        candidates: info.candidates,
        bestIndex: info.candidates.indexOf(best),
        gap,
      });
    },
  });
  return triggers;
}
