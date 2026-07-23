import type { WorldManifest, RosterEntry, UtilityKey } from "../schema/core.js";
import type { Action, CanonicalActionEvent, Checkpoint, SemanticEvent } from "../schema/log.js";
import type { WorldState } from "../world/state.js";
import { createInitialState, seasonAt } from "../world/state.js";
import { environmentStep, needsStep, reproductionStep } from "../world/rules.js";
import { applyAction } from "../world/actions.js";
import type { Observation } from "../mind/observe.js";
import { buildObservation } from "../mind/observe.js";
import { reflexDecide } from "../mind/reflex.js";
import { scoreCandidates, type ScoredCandidate } from "../mind/utility.js";
import { resolve } from "../mind/resolver.js";
import { applyBeliefs, decayBeliefs, beliefFormationStep } from "../mind/beliefs.js";
import { hashCanonical } from "../canon/canonicalize.js";
import { drawInt } from "../rng/rng.js";

export interface DecideInfo {
  tick: number;
  npcId: string;
  observation: Observation;
  actionSource: "reflex" | "utility" | "resolver" | "random";
  action: Action;
  /** Scored utility candidates — null for reflex and injected decisions. */
  candidates: ScoredCandidate[] | null;
  chosenKey: UtilityKey | null;   // the winning candidate's key for utility/resolver decisions; null for reflex/injected
  /** Patron mechanism (schema v4): true iff a patron theme entered this decision's resolver
   * band lottery. Always false for reflex/injected/random decisions. */
  patronApplied: boolean;
  /** True iff the patron tilt actually changed the outcome vs. the untilted counterfactual. */
  patronDecisive: boolean;
}

export interface RunOptions {
  ticks: number;
  injectedActions?: Map<
    string,
    {
      action: Action;
      actionSource: "reflex" | "utility" | "resolver" | "random";
      patronInfluence: boolean;
      patronDecisive: boolean;
    }
  >;
  collectTickHashes?: boolean;
  /** Read-only observer of every NPC decision (after decide, before apply). MUST NOT mutate. */
  onDecide?: (info: DecideInfo) => void;
  /** When false, skips actionLog pushes but keeps hash chain computation (default: true). */
  retainActionLog?: boolean;
  /** Patron mechanism (schema v4): per-tick list of directives (in array order) setting or
   * clearing (theme: null) the patron theme for an npcId. Applied at tick start, before
   * environmentStep, and hashed into state via state.patronThemes. */
  patronDirectives?: Map<number, { npcId: string; theme: UtilityKey | null }[]>;
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

/** Run the tick loop from a prepared state, ticks state.tick+1 .. state.tick+opts.ticks. Mutates a deep copy, never the input. */
export function runFromState(
  initial: WorldState,
  manifest: WorldManifest,
  seedRoot: string,
  opts: RunOptions,
): RunResult {
  const state = structuredClone(initial);
  const actionLog: CanonicalActionEvent[] = [];
  const checkpoints: Checkpoint[] = [];
  const events: SemanticEvent[] = [];
  const tickHashes: RunResult["tickHashes"] = [];
  let lastEventHash: string | null = null;
  let haltedAtTick: number | null = null;

  const startTick = state.tick;
  tickLoop: for (let t = state.tick + 1; t <= startTick + opts.ticks; t++) {
    const retainLog = opts.retainActionLog !== false; // default true

    // Record event index at tick start (before any events added) for belief formation
    const evStart = events.length;

    if (seasonAt(t, manifest) !== seasonAt(t - 1, manifest)) {
      events.push({ tick: t, kind: "season_change", npcId: null, data: { season: seasonAt(t, manifest) } });
    }
    state.tick = t;

    // Patron directives (schema v4): apply before environmentStep so state.patronThemes
    // (hashed into every checkpoint) reflects the directive from this tick onward.
    const directives = opts.patronDirectives?.get(t);
    if (directives !== undefined) {
      for (const d of directives) {
        if (d.theme === null) {
          delete state.patronThemes[d.npcId];
        } else {
          state.patronThemes[d.npcId] = d.theme;
        }
        events.push({ tick: t, kind: "patron_set", npcId: d.npcId, data: { theme: d.theme } });
      }
    }

    environmentStep(state, manifest, seedRoot, events);

    // Decision loop: iterate over snapshot so newborns never act on their birth tick
    const actors = [...state.npcs];
    for (const npc of actors) {
      if (!npc.alive) continue;
      const obs = buildObservation(state, manifest, npc);
      const observationHash = hashCanonical(obs);

      let action: Action;
      let actionSource: "reflex" | "utility" | "resolver" | "random";
      let cands: ScoredCandidate[] | null = null;
      let chosenKey: UtilityKey | null = null;
      let patronApplied = false; // DecideInfo only: true iff THIS live decision used resolver tilt
      let patronDecisive = false; // DecideInfo only: true iff THIS live decision's tilt was decisive
      let eventPatronInfluence = false; // recorded verbatim into the log event's patronInfluence
      let eventPatronDecisive = false; // recorded verbatim into the log event's patronDecisive
      const injected = opts.injectedActions?.get(`${t}:${npc.npcId}`);
      if (injected !== undefined) {
        ({ action, actionSource } = injected);
        eventPatronInfluence = injected.patronInfluence;
        eventPatronDecisive = injected.patronDecisive;
        chosenKey = null;
      } else {
        const effPolicy = applyBeliefs(npc.policy, npc.beliefs, seasonAt(t, manifest));
        if (manifest.cognition.decisionMode === "random") {
          // Sanity-floor arm: no reflex, no utility — uniform over the candidate list.
          // Not a hesitation band; patron tilt never applies here.
          cands = scoreCandidates(obs, npc.identity, effPolicy, manifest, seedRoot);
          const idx = drawInt(seedRoot, cands.length, "randarm", npc.npcId, t);
          action = cands[idx]!.action;
          actionSource = "random";
          chosenKey = cands[idx]!.key;
        } else {
          const reflex = reflexDecide(obs, effPolicy);
          if (reflex !== null) {
            action = reflex;
            actionSource = "reflex";
            chosenKey = null;
          } else {
            cands = scoreCandidates(obs, npc.identity, effPolicy, manifest, seedRoot);
            const patronTheme = state.patronThemes[npc.npcId] ?? null;
            const resolution = resolve(cands, npc.identity, effPolicy.deliberationEpsilon, seedRoot, npc.npcId, t, patronTheme);
            action = resolution.action;
            actionSource = resolution.source;
            chosenKey = resolution.key;
            patronApplied = resolution.patronApplied;
            patronDecisive = resolution.patronDecisive;
            eventPatronInfluence = resolution.patronApplied;
            eventPatronDecisive = resolution.patronDecisive;
          }
        }
      }

      opts.onDecide?.({
        tick: t,
        npcId: npc.npcId,
        observation: obs,
        actionSource,
        action,
        candidates: cands,
        chosenKey,
        patronApplied,
        patronDecisive,
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
        patronInfluence: eventPatronInfluence,
        patronDecisive: eventPatronDecisive,
        previousEventHash: lastEventHash,
      };
      lastEventHash = hashCanonical(event);
      if (retainLog) {
        actionLog.push(event);
      }
    }

    needsStep(state, manifest, events);

    if (manifest.cognition.beliefDynamics === "on") {
      for (const npc of state.npcs) {
        if (!npc.alive) continue;
        decayBeliefs(npc, t);
      }
      const eventsThisTick = events.slice(evStart);
      beliefFormationStep(state, events, eventsThisTick);
    }

    // Reproduction: births add new NPCs
    reproductionStep(state, manifest, seedRoot, events);

    if (t % manifest.checkpointInterval === 0) {
      checkpoints.push({ tick: t, stateHash: hashCanonical(state) });
    }
    if (opts.collectTickHashes === true) {
      tickHashes.push({ tick: t, stateHash: hashCanonical(state) });
    }
  }

  return { finalState: state, actionLog, checkpoints, events, tickHashes, haltedAtTick };
}

export function runSim(
  manifest: WorldManifest,
  roster: RosterEntry[],
  seedRoot: string,
  opts: RunOptions,
): RunResult {
  const initial = createInitialState(manifest, roster, seedRoot);
  return runFromState(initial, manifest, seedRoot, opts);
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
