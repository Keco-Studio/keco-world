import type { WorldManifest, RosterEntry } from "../schema/core.js";
import type { SemanticEvent } from "../schema/log.js";
import type { WorldState } from "../world/state.js";
import { createInitialState, npcAge, seasonAt } from "../world/state.js";
import { runFromState } from "../sim/engine.js";

export const DIRECTOR_SCAN_DEFAULT = 1200;

export interface OpeningMoment {
  npcId: string;
  tick: number;
  score: number;
  ticksToWinter: number;
  reserves: number;
  shortfall: number;
  kind: "winter-shortfall" | "fallback-low-reserves";
}

export interface DirectedOpening {
  moment: OpeningMoment;
  state: WorldState;
  events: SemanticEvent[];
}

export function findOpening(
  manifest: WorldManifest,
  roster: RosterEntry[],
  seedRoot: string,
  scanTicks: number = DIRECTOR_SCAN_DEFAULT,
): DirectedOpening {
  const initial = createInitialState(manifest, roster, seedRoot);

  let bestMoment: OpeningMoment | null = null;
  let bestState: WorldState | null = null;
  let bestEvents: SemanticEvent[] = [];

  // Chunk scanning: evaluate at each chunk boundary (100, 200, 300, ...)
  const chunk = 100;
  for (let chunkEnd = chunk; chunkEnd <= scanTicks; chunkEnd += chunk) {
    // Run from the current best state or from initial
    const runFrom = bestState ?? initial;
    const ticksToRun = chunkEnd - runFrom.tick;
    if (ticksToRun <= 0) continue;

    const result = runFromState(runFrom, manifest, seedRoot, { ticks: ticksToRun, retainActionLog: false });
    const currentState = result.finalState;
    const currentEvents = bestEvents.length > 0 ? bestEvents.concat(result.events) : result.events;

    // Evaluate candidates at this chunk boundary
    for (const npc of currentState.npcs) {
      if (!npc.alive) continue;
      if (npcAge(npc, currentState.tick) < manifest.adultAgeTicks) continue;

      const season = seasonAt(currentState.tick, manifest);
      if (season !== "summer") continue;

      // Calculate ticksToWinter
      // In a summer tick t: p2 = floor(t / seasonLengthTicks), and summer iff p2 % 2 === 0
      // Winter starts at (p2+1)*seasonLengthTicks
      // So ticksToWinter = (p2+1)*seasonLengthTicks - t
      const p2 = Math.floor(currentState.tick / manifest.seasonLengthTicks);
      const ticksToWinter = (p2 + 1) * manifest.seasonLengthTicks - currentState.tick;

      if (ticksToWinter <= 0 || ticksToWinter > 200) continue;

      // Calculate reserves and shortfall
      const reserves = npc.energy + npc.berries * manifest.berryEnergy;
      const shortfall = manifest.seasonLengthTicks * manifest.energyDrainPerTick - reserves;

      if (shortfall <= 0) continue;

      // Calculate score
      const score = Math.min(shortfall, 2000) + (200 - ticksToWinter);

      // Check if this is better than the current best
      const isBetter =
        bestMoment === null ||
        score > bestMoment.score ||
        (score === bestMoment.score && currentState.tick < bestMoment.tick) ||
        (score === bestMoment.score &&
          currentState.tick === bestMoment.tick &&
          npc.npcId.localeCompare(bestMoment.npcId) < 0);

      if (isBetter) {
        bestMoment = {
          npcId: npc.npcId,
          tick: currentState.tick,
          score,
          ticksToWinter,
          reserves,
          shortfall,
          kind: "winter-shortfall",
        };
        bestState = structuredClone(currentState);
        bestEvents = currentEvents.slice(0, currentEvents.length);
      }
    }
  }

  // If no winter-shortfall candidate found, fallback to lowest reserves
  if (bestMoment === null) {
    // Run to scanTicks if not already there
    const finalResult = bestState ? runFromState(bestState, manifest, seedRoot, { ticks: scanTicks - bestState.tick, retainActionLog: false }) : runFromState(initial, manifest, seedRoot, { ticks: scanTicks, retainActionLog: false });
    const finalState = finalResult.finalState;
    const finalEvents = bestState ? bestEvents.concat(finalResult.events) : finalResult.events;

    // Find alive adult with lowest reserves
    const candidates = finalState.npcs.filter((n) => n.alive && npcAge(n, finalState.tick) >= manifest.adultAgeTicks);

    if (candidates.length === 0) {
      throw new Error("No alive NPC at scan end");
    }

    const sorted = candidates.sort((a, b) => {
      const reservesA = a.energy + a.berries * manifest.berryEnergy;
      const reservesB = b.energy + b.berries * manifest.berryEnergy;
      if (reservesA !== reservesB) return reservesA - reservesB;
      return a.npcId.localeCompare(b.npcId);
    });

    const focal = sorted[0]!;
    const reserves = focal.energy + focal.berries * manifest.berryEnergy;
    const season = seasonAt(finalState.tick, manifest);
    const p2 = Math.floor(finalState.tick / manifest.seasonLengthTicks);
    const ticksToWinter = season === "summer" ? (p2 + 1) * manifest.seasonLengthTicks - finalState.tick : 0;
    const shortfall = manifest.seasonLengthTicks * manifest.energyDrainPerTick - reserves;

    bestMoment = {
      npcId: focal.npcId,
      tick: finalState.tick,
      score: 0, // fallback doesn't use score
      ticksToWinter,
      reserves,
      shortfall,
      kind: "fallback-low-reserves",
    };
    bestState = finalState;
    bestEvents = finalEvents;
  } else {
    // We found a winter-shortfall candidate, but we need to ensure bestState is at bestMoment.tick
    // The candidate was found at a chunk boundary, so it should already be correct
    if (bestState === null || bestState.tick !== bestMoment.tick) {
      throw new Error("State tick mismatch");
    }
  }

  if (bestState === null) {
    throw new Error("No best state found");
  }

  return {
    moment: bestMoment,
    state: bestState,
    events: bestEvents,
  };
}
