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
 * On divergence, re-run live + replay with per-tick hashes to find the first
 * inconsistent tick.
 */
export function verifyReplay(
  manifest: WorldManifest,
  roster: RosterEntry[],
  seedRoot: string,
  actionLog: CanonicalActionEvent[],
  recordedCheckpoints: Checkpoint[],
  ticks: number,
): ReplayReport {
  let replayed: RunResult | null = null;
  let divergenceDetected = false;
  let firstDivergentCheckpoint: number | null = null;

  // Try to replay and compare checkpoints
  try {
    replayed = replayRun(manifest, roster, seedRoot, actionLog, ticks);
    for (let i = 0; i < recordedCheckpoints.length; i++) {
      const rec = recordedCheckpoints[i]!;
      const got = replayed.checkpoints[i];
      if (got === undefined || got.tick !== rec.tick || got.stateHash !== rec.stateHash) {
        firstDivergentCheckpoint = rec.tick;
        divergenceDetected = true;
        break;
      }
    }
  } catch (error) {
    // Replay threw an error (illegal action), so divergence is detected
    divergenceDetected = true;
  }

  if (!divergenceDetected) {
    return {
      ok: true,
      checkpointCount: recordedCheckpoints.length,
      firstDivergentCheckpoint: null,
      firstDivergentTick: null,
    };
  }

  // Divergence detected: do per-tick comparison to find exact tick
  const liveTicks = runSim(manifest, roster, seedRoot, { ticks, collectTickHashes: true }).tickHashes;
  let replayTicks: RunResult["tickHashes"] = [];
  let replayErrorTick: number | null = null;

  try {
    replayTicks = replayRun(manifest, roster, seedRoot, actionLog, ticks, true).tickHashes;
  } catch (error) {
    // Replay threw an error; try to extract the tick number from the error message
    const errorMsg = (error as Error).message;
    let match = errorMsg.match(/at tick (\d+)/);
    if (!match) match = errorMsg.match(/tick (\d+)/);
    if (match) {
      replayErrorTick = parseInt(match[1]!, 10);
    }
  }

  let firstDivergentTick: number | null = null;

  // If replayTicks is empty, it means the replay threw an error before generating hashes
  if (replayTicks.length === 0) {
    // Use the error tick if available, otherwise assume the first tick is divergent
    if (replayErrorTick !== null) {
      // Assume divergence starts one tick before the error
      firstDivergentTick = Math.max(1, replayErrorTick - 1);
    }
  } else {
    // Find the first tick where hashes differ
    for (let i = 0; i < liveTicks.length; i++) {
      if (replayTicks[i] === undefined || liveTicks[i]!.stateHash !== replayTicks[i]!.stateHash) {
        firstDivergentTick = liveTicks[i]!.tick;
        break;
      }
    }
  }

  // If we detected divergence from error but don't have firstDivergentCheckpoint yet,
  // find the first checkpoint at or after the first divergent tick
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
