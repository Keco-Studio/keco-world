import type { WorldManifest, RosterEntry } from "../schema/core.js";
import type { Action, CanonicalActionEvent, Checkpoint, SemanticEvent } from "../schema/log.js";
import type { WorldState } from "../world/state.js";
import { createInitialState, seasonAt } from "../world/state.js";
import { environmentStep, needsStep } from "../world/rules.js";
import { applyAction } from "../world/actions.js";
import type { Observation } from "../mind/observe.js";
import { buildObservation } from "../mind/observe.js";
import { reflexDecide } from "../mind/reflex.js";
import { scoreCandidates, pickBest, type ScoredCandidate } from "../mind/utility.js";
import { hashCanonical } from "../canon/canonicalize.js";

export interface DecideInfo {
  tick: number;
  npcId: string;
  observation: Observation;
  actionSource: "reflex" | "utility" | "resolver";
  action: Action;
  /** Scored utility candidates — null for reflex and injected decisions. */
  candidates: ScoredCandidate[] | null;
}

export interface RunOptions {
  ticks: number;
  injectedActions?: Map<string, { action: Action; actionSource: "reflex" | "utility" | "resolver" }>;
  collectTickHashes?: boolean;
  /** Read-only observer of every NPC decision (after decide, before apply). MUST NOT mutate. */
  onDecide?: (info: DecideInfo) => void;
}

export interface RunResult {
  finalState: WorldState;
  actionLog: CanonicalActionEvent[];
  checkpoints: Checkpoint[];
  events: SemanticEvent[];
  tickHashes: { tick: number; stateHash: string }[];
  /** Tick at which the run was halted early because a replayed (injected) action was
   * illegal, or null if the run completed all `opts.ticks`. */
  haltedAtTick: number | null;
}

export function runSim(
  manifest: WorldManifest,
  roster: RosterEntry[],
  seedRoot: string,
  opts: RunOptions,
): RunResult {
  const state = createInitialState(manifest, roster, seedRoot);
  const actionLog: CanonicalActionEvent[] = [];
  const checkpoints: Checkpoint[] = [];
  const events: SemanticEvent[] = [];
  const tickHashes: RunResult["tickHashes"] = [];
  const rosterById = new Map(roster.map((r) => [r.npcId, r]));
  let lastEventHash: string | null = null;
  let haltedAtTick: number | null = null;

  tickLoop: for (let t = 1; t <= opts.ticks; t++) {
    if (seasonAt(t, manifest) !== seasonAt(t - 1, manifest)) {
      events.push({ tick: t, kind: "season_change", npcId: null, data: { season: seasonAt(t, manifest) } });
    }
    state.tick = t;
    environmentStep(state, manifest, seedRoot, events);

    for (const npc of state.npcs) {
      if (!npc.alive) continue;
      const entry = rosterById.get(npc.npcId);
      if (entry === undefined) throw new Error(`npc ${npc.npcId} missing from roster`);
      const obs = buildObservation(state, manifest, npc);
      const observationHash = hashCanonical(obs);

      let action: Action;
      let actionSource: "reflex" | "utility" | "resolver";
      let cands: ScoredCandidate[] | null = null;
      const injected = opts.injectedActions?.get(`${t}:${npc.npcId}`);
      if (injected !== undefined) {
        ({ action, actionSource } = injected);
      } else {
        const reflex = reflexDecide(obs, entry.policy);
        if (reflex !== null) {
          action = reflex;
          actionSource = "reflex";
        } else {
          cands = scoreCandidates(obs, entry.identity, entry.policy, manifest, seedRoot);
          const best = pickBest(cands);
          action = best.action;
          actionSource = "utility";
        }
      }

      opts.onDecide?.({
        tick: t,
        npcId: npc.npcId,
        observation: obs,
        actionSource,
        action,
        candidates: cands,
      });

      const legal = applyAction(state, manifest, npc, action);
      if (!legal) {
        if (injected !== undefined) {
          // Replay mode: the log is authoritative; an illegal injected action means the
          // claim diverged from a genuine live run somewhere upstream (e.g. a tampered
          // earlier action shifted state so this later logged action is no longer legal).
          // Halt immediately and return the partial result — the verifier localizes the
          // actual first divergent tick by comparing per-tick hashes, not by inspecting
          // this halt point. Do not throw: an illegal injected action is expected under
          // tampering, not an engine bug.
          haltedAtTick = t;
          break tickLoop;
        }
        // Live decision (no injection): an illegal action here is a genuine engine bug.
        throw new Error(`illegal action at tick ${t} for ${npc.npcId}: ${JSON.stringify(action)}`);
      }

      const event: CanonicalActionEvent = {
        eventId: `${t}:${npc.npcId}`,
        tick: t,
        npcId: npc.npcId,
        observationHash,
        action,
        actionSource,
        deliberationTriggered: false, // P4: fixed in Phase 0 (no deliberative layer)
        energyCharged: 0,
        previousEventHash: lastEventHash,
      };
      lastEventHash = hashCanonical(event);
      actionLog.push(event);
    }

    needsStep(state, manifest, events);

    if (t % manifest.checkpointInterval === 0) {
      checkpoints.push({ tick: t, stateHash: hashCanonical(state) });
    }
    if (opts.collectTickHashes === true) {
      tickHashes.push({ tick: t, stateHash: hashCanonical(state) });
    }
  }

  return { finalState: state, actionLog, checkpoints, events, tickHashes, haltedAtTick };
}

/** Recomputes the previousEventHash chain. */
export function verifyLogChain(log: CanonicalActionEvent[]): boolean {
  let prev: string | null = null;
  for (const ev of log) {
    if (ev.previousEventHash !== prev) return false;
    prev = hashCanonical(ev);
  }
  return true;
}
