import type { WorldManifest, RosterEntry } from "../schema/core.js";
import type { Action, CanonicalActionEvent, Checkpoint } from "../schema/log.js";
import { runSim, type RunResult } from "../sim/engine.js";

export interface ReplayReport {
  ok: boolean;
  checkpointCount: number;
  firstDivergentCheckpoint: number | null;
  firstDivergentTick: number | null;
}

export function replayRun(
  manifest: WorldManifest,
  roster: RosterEntry[],
  seedRoot: string,
  actionLog: CanonicalActionEvent[],
  ticks: number,
  collectTickHashes = false,
): RunResult {
  const injected = new Map<string, { action: Action; actionSource: "reflex" | "utility" }>();
  for (const ev of actionLog) {
    injected.set(ev.eventId, { action: ev.action, actionSource: ev.actionSource });
  }
  return runSim(manifest, roster, seedRoot, { ticks, injectedActions: injected, collectTickHashes });
}

/**
 * Layer-1 verification (doc §3.1): replay the log, compare checkpoint hashes.
 *
 * `runSim` never throws on a tampered log: a replayed action that is illegal (because
 * an earlier tampered action shifted state) causes the run to halt gracefully at that
 * tick (`RunResult.haltedAtTick`) rather than throw — throwing is reserved for genuine
 * engine bugs in live (non-replayed) decisions. This function treats the halt as one
 * more data point to compare, not as an error to catch.
 *
 * On divergence, re-run live + replay with per-tick hashes and take the first tick
 * where the hash sequences actually differ (or, if the replay's hashes all matched but
 * it halted early, the halt tick) as `firstDivergentTick`.
 */
export function verifyReplay(
  manifest: WorldManifest,
  roster: RosterEntry[],
  seedRoot: string,
  actionLog: CanonicalActionEvent[],
  recordedCheckpoints: Checkpoint[],
  ticks: number,
): ReplayReport {
  const replayed = replayRun(manifest, roster, seedRoot, actionLog, ticks);

  let firstDivergentCheckpoint: number | null = null;
  for (const rec of recordedCheckpoints) {
    const got = replayed.checkpoints.find((c) => c.tick === rec.tick);
    if (got === undefined || got.stateHash !== rec.stateHash) {
      firstDivergentCheckpoint = rec.tick;
      break;
    }
  }

  if (firstDivergentCheckpoint === null && replayed.haltedAtTick === null) {
    return {
      ok: true,
      checkpointCount: recordedCheckpoints.length,
      firstDivergentCheckpoint: null,
      firstDivergentTick: null,
    };
  }

  // Divergence detected (either a checkpoint mismatch/missing, or the replay halted
  // before finishing): do per-tick comparison against a live run to find the exact tick.
  const liveTicks = runSim(manifest, roster, seedRoot, { ticks, collectTickHashes: true }).tickHashes;
  const replayTicks = replayRun(manifest, roster, seedRoot, actionLog, ticks, true).tickHashes;

  let firstDivergentTick: number | null = null;
  for (let i = 0; i < liveTicks.length; i++) {
    if (replayTicks[i] === undefined || liveTicks[i]!.stateHash !== replayTicks[i]!.stateHash) {
      firstDivergentTick = liveTicks[i]!.tick;
      break;
    }
  }
  if (firstDivergentTick === null && replayed.haltedAtTick !== null) {
    // All collected replay hashes matched live, but the replay halted before producing
    // more — the halt tick is itself the first point of divergence.
    firstDivergentTick = replayed.haltedAtTick;
  }

  // If we don't yet have a divergent checkpoint (e.g. the halt occurred before any
  // recorded checkpoint mismatched but also before the run completed), find the first
  // recorded checkpoint at or after the first divergent tick.
  if (firstDivergentCheckpoint === null && firstDivergentTick !== null) {
    for (const checkpoint of recordedCheckpoints) {
      if (checkpoint.tick >= firstDivergentTick) {
        firstDivergentCheckpoint = checkpoint.tick;
        break;
      }
    }
  }

  return {
    ok: false,
    checkpointCount: recordedCheckpoints.length,
    firstDivergentCheckpoint,
    firstDivergentTick,
  };
}
