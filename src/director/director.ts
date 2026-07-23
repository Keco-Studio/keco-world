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
  let bestEventsLen = 0;

  // Single-pass rolling cursor: always advance chunk by chunk
  let cursorState = structuredClone(initial);
  let allEvents: SemanticEvent[] = [];

  const chunk = 100;
  for (let chunkEnd = chunk; chunkEnd <= scanTicks; chunkEnd += chunk) {
    const ticksToRun = chunkEnd - cursorState.tick;
    if (ticksToRun <= 0) continue;

    const result = runFromState(cursorState, manifest, seedRoot, { ticks: ticksToRun, retainActionLog: false });
    cursorState = result.finalState;
    allEvents = allEvents.concat(result.events);

    // Evaluate candidates at this chunk boundary
    for (const npc of cursorState.npcs) {
      if (!npc.alive) continue;
      if (npcAge(npc, cursorState.tick) < manifest.adultAgeTicks) continue;

      const season = seasonAt(cursorState.tick, manifest);
      if (season !== "summer") continue;

      // Calculate ticksToWinter
      // In a summer tick t: p2 = floor(t / seasonLengthTicks), and summer iff p2 % 2 === 0
      // Winter starts at (p2+1)*seasonLengthTicks
      // So ticksToWinter = (p2+1)*seasonLengthTicks - t
      const p2 = Math.floor(cursorState.tick / manifest.seasonLengthTicks);
      const ticksToWinter = (p2 + 1) * manifest.seasonLengthTicks - cursorState.tick;

      if (ticksToWinter <= 0 || ticksToWinter > 200) continue;

      // Calculate reserves and shortfall
      const reserves = npc.energy + npc.berries * manifest.berryEnergy;
      const shortfall = manifest.seasonLengthTicks * manifest.energyDrainPerTick - reserves;

      if (shortfall <= 0) continue;

      // Calculate score
      const score = Math.min(shortfall, 2000) + (200 - ticksToWinter);

      // UTF-16 comparison for tie-breaking (deterministic, not locale-dependent);
      // only consulted when bestMoment !== null (the || below short-circuits first).
      const bestId = bestMoment === null ? "" : bestMoment.npcId;
      const npcIdCmp = npc.npcId < bestId ? -1 : npc.npcId > bestId ? 1 : 0;

      // Check if this is better than the current best
      const isBetter =
        bestMoment === null ||
        score > bestMoment.score ||
        (score === bestMoment.score && cursorState.tick < bestMoment.tick) ||
        (score === bestMoment.score && cursorState.tick === bestMoment.tick && npcIdCmp < 0);

      if (isBetter) {
        bestMoment = {
          npcId: npc.npcId,
          tick: cursorState.tick,
          score,
          ticksToWinter,
          reserves,
          shortfall,
          kind: "winter-shortfall",
        };
        bestState = structuredClone(cursorState);
        bestEventsLen = allEvents.length;
      }
    }
  }

  // If no winter-shortfall candidate found, fallback to lowest reserves
  if (bestMoment === null) {
    // Find alive adult with lowest reserves
    const candidates = cursorState.npcs.filter((n) => n.alive && npcAge(n, cursorState.tick) >= manifest.adultAgeTicks);

    if (candidates.length === 0) {
      throw new Error("No alive NPC at scan end");
    }

    // UTF-16 comparison for tie-breaking (deterministic, not locale-dependent)
    const sorted = candidates.sort((a, b) => {
      const reservesA = a.energy + a.berries * manifest.berryEnergy;
      const reservesB = b.energy + b.berries * manifest.berryEnergy;
      if (reservesA !== reservesB) return reservesA - reservesB;
      return a.npcId < b.npcId ? -1 : a.npcId > b.npcId ? 1 : 0;
    });

    const focal = sorted[0]!;
    const reserves = focal.energy + focal.berries * manifest.berryEnergy;
    const p2 = Math.floor(cursorState.tick / manifest.seasonLengthTicks);
    // Compute ticksToWinter using the same formula regardless of season
    // For fallback moments in winter, this represents ticks-to-next-boundary (reported as-is per spec)
    const ticksToWinter = (p2 + 1) * manifest.seasonLengthTicks - cursorState.tick;
    const shortfall = manifest.seasonLengthTicks * manifest.energyDrainPerTick - reserves;

    bestMoment = {
      npcId: focal.npcId,
      tick: cursorState.tick,
      score: 0, // fallback doesn't use score
      ticksToWinter,
      reserves,
      shortfall,
      kind: "fallback-low-reserves",
    };
    bestState = cursorState;
    bestEventsLen = allEvents.length;
  }

  if (bestState === null) {
    throw new Error("No best state found");
  }

  return {
    moment: bestMoment,
    state: bestState,
    events: allEvents.slice(0, bestEventsLen),
  };
}
