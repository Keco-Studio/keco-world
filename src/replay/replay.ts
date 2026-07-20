import type { WorldManifest, RosterEntry } from "../schema/core.js";
import type { Action, CanonicalActionEvent, Checkpoint } from "../schema/log.js";
import { runSim, type RunResult } from "../sim/engine.js";
import { hashCanonical } from "../canon/canonicalize.js";

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
 * Layer-1 verification (doc §3.1): verifies the provided log and checkpoints are the
 * complete, untampered record of the run — not merely a record that is *consistent*
 * with one. Consistency alone is insufficient: `runSim`'s live-decision fallback (used
 * whenever a tick/npc has no injected action) deterministically regenerates a missing
 * tail exactly as the original live run produced it, so a truncated-but-otherwise-real
 * log/checkpoint set would replay clean under a content-only check. This function
 * therefore enforces three things: (1) content correctness — replayed state hashes
 * match the recorded checkpoints and the tampered-detection halt behavior described
 * below; (2) checkpoint-set completeness — the recorded checkpoints are exactly the
 * expected ticks `interval, 2*interval, ..., floor(ticks/interval)*interval`, in order,
 * with no gaps or extras; (3) log completeness — the provided action log is exactly
 * equal (length and per-event content) to the log the engine re-emits during replay,
 * which includes events for every live-fallback tick, so a truncated or tail-tampered
 * input log always diverges from it.
 *
 * `runSim` never throws on a tampered log: a replayed action that is illegal (because
 * an earlier tampered action shifted state) causes the run to halt gracefully at that
 * tick (`RunResult.haltedAtTick`) rather than throw — throwing is reserved for genuine
 * engine bugs in live (non-replayed) decisions. This function treats the halt as one
 * more data point to compare, not as an error to catch.
 *
 * On divergence, re-run live + replay with per-tick hashes and take the first tick
 * where the hash sequences actually differ (or, if the replay's hashes all matched but
 * it halted early, the halt tick) as `firstDivergentTick`. If that content-level
 * comparison finds nothing — the signature of a pure completeness violation, e.g. plain
 * truncation, where the live-fallback silently regenerates a byte-identical tail — we
 * fall back to a documented localization rule: `firstDivergentTick` is the earliest tick
 * not faithfully covered by either the provided log or the provided checkpoint set
 * (the smaller of the two completeness-violation ticks found below), since that is the
 * first point at which the record is no longer a complete, verifiable account of the run.
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

  // 1. Checkpoint-set completeness + correctness: recordedCheckpoints must match the
  // expected tick sequence exactly (no gaps, no extras, no reordering), and each
  // checkpoint's hash must match the replay's state hash at that tick.
  const expectedCheckpointTicks: number[] = [];
  for (let t = manifest.checkpointInterval; t <= ticks; t += manifest.checkpointInterval) {
    expectedCheckpointTicks.push(t);
  }

  let firstDivergentCheckpoint: number | null = null;
  const checkpointCompareLen = Math.max(expectedCheckpointTicks.length, recordedCheckpoints.length);
  for (let i = 0; i < checkpointCompareLen; i++) {
    const expectedTick = expectedCheckpointTicks[i];
    const rec = recordedCheckpoints[i];
    if (expectedTick === undefined || rec === undefined || rec.tick !== expectedTick) {
      // Deviation at position i. Two shapes are possible:
      //  - an extra/spurious checkpoint: rec is present but "ahead of schedule" (its tick
      //    is less than what's expected here, or there's no expected tick left at all) —
      //    report the anomalous recorded tick itself, since that's the actual defect.
      //  - a missing checkpoint (or one that arrived later than scheduled): rec is absent,
      //    or its tick is past what was expected here — report the expected tick that
      //    should have appeared, since that's the tick left unaccounted-for.
      firstDivergentCheckpoint =
        expectedTick === undefined || (rec !== undefined && rec.tick < expectedTick) ? rec!.tick : expectedTick;
      break;
    }
    const got = replayed.checkpoints.find((c) => c.tick === rec.tick);
    if (got === undefined || got.stateHash !== rec.stateHash) {
      firstDivergentCheckpoint = rec.tick;
      break;
    }
  }

  // 2. Log completeness: the provided actionLog must be exactly equal (length + every
  // event's content) to the log the replay engine re-emits — which includes live-fallback
  // events for any tick/npc not covered by the provided log, so truncation or tail
  // tampering always shows up here even when checkpoints happen to still line up.
  let firstDivergentLogTick: number | null = null;
  const logCompareLen = Math.max(replayed.actionLog.length, actionLog.length);
  for (let i = 0; i < logCompareLen; i++) {
    const got = replayed.actionLog[i];
    const rec = actionLog[i];
    if (got === undefined || rec === undefined || hashCanonical(got) !== hashCanonical(rec)) {
      firstDivergentLogTick = (rec ?? got)!.tick;
      break;
    }
  }

  if (firstDivergentCheckpoint === null && firstDivergentLogTick === null && replayed.haltedAtTick === null) {
    return {
      ok: true,
      checkpointCount: recordedCheckpoints.length,
      firstDivergentCheckpoint: null,
      firstDivergentTick: null,
    };
  }

  // Divergence detected (a checkpoint mismatch/missing/extra, a log completeness
  // violation, or the replay halted before finishing): do per-tick comparison against a
  // live run to find the exact tick of content-level divergence.
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

  // Pure completeness violation: no content-level divergence and no halt (the classic
  // truncation escape — the live-fallback regenerated a byte-identical tail). Localize to
  // the earliest tick not faithfully covered by the provided log or checkpoint set.
  if (firstDivergentTick === null) {
    const completenessCandidates = [firstDivergentLogTick, firstDivergentCheckpoint].filter(
      (t): t is number => t !== null,
    );
    if (completenessCandidates.length > 0) firstDivergentTick = Math.min(...completenessCandidates);
  }

  // If we don't yet have a divergent checkpoint (e.g. the halt/completeness violation
  // occurred before any recorded checkpoint mismatched but also before the run
  // completed), find the first recorded checkpoint at or after the first divergent tick.
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
