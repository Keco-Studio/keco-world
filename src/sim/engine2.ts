import type { W2Manifest, W2RosterEntry, GoalKey } from "../schema/world2.js";
import type { SemanticEvent } from "../schema/log.js";
import type { W2WorldState } from "../world2/state.js";
import { createW2InitialState, seasonAt2 } from "../world2/state.js";
import { environmentStep2, needsStep2, reproductionStep2 } from "../world2/rules.js";
import { applyAction2, type W2Action } from "../world2/actions.js";
import type { W2Observation } from "../mind2/observe.js";
import { buildObservation2 } from "../mind2/observe.js";
import { updateMemory } from "../mind2/memory.js";
import { applyBeliefs2, scoreGoals, chooseGoal } from "../mind2/goals.js";
import { planAction } from "../mind2/planner.js";
import { reflexDecide2 } from "../mind2/reflex2.js";
import { decayBeliefs2, beliefFormationStep2 } from "../mind2/beliefs2.js";
import { hashCanonical } from "../canon/canonicalize.js";
import { breed2 } from "../life/genome2.js";

export interface DecideInfo2 {
  tick: number;
  npcId: string;
  observation: W2Observation;
  actionSource: "reflex" | "goal";
  goal: GoalKey | null;
  action: W2Action;
}

export interface RunOptions2 {
  ticks: number;
  retainActionLog?: boolean;
  collectTickHashes?: boolean;
  onDecide?: (info: DecideInfo2) => void;
  injectedActions?: Map<string, { action: W2Action; actionSource: "reflex" | "goal"; goal: GoalKey | null }>;
}

/**
 * Layer-1 action-log entry for w2. Not present in src/schema/world2.ts (Task
 * 1 didn't define it — Task 6's brief only specifies its field list, not a
 * zod schema); declared here as a plain interface since nothing needs runtime
 * validation of it and `W2Action` itself (src/world2/actions.ts) is likewise
 * a plain TS discriminated union rather than a zod schema.
 */
export interface W2ActionEvent {
  eventId: string;
  tick: number;
  npcId: string;
  observationHash: string;
  action: W2Action;
  actionSource: "reflex" | "goal";
  goal: GoalKey | null;
  previousEventHash: string | null;
}

export interface RunResult2 {
  finalState: W2WorldState;
  actionLog: W2ActionEvent[];
  checkpoints: { tick: number; stateHash: string }[];
  events: SemanticEvent[];
  tickHashes: { tick: number; stateHash: string }[];
  haltedAtTick: number | null;
}

/** Run the tick loop from a prepared state, ticks state.tick+1 .. state.tick+opts.ticks. Mutates a deep copy, never the input. */
export function runFromState2(
  initial: W2WorldState,
  manifest: W2Manifest,
  seedRoot: string,
  opts: RunOptions2,
): RunResult2 {
  const state = structuredClone(initial);
  const actionLog: W2ActionEvent[] = [];
  const checkpoints: RunResult2["checkpoints"] = [];
  const events: SemanticEvent[] = [];
  const tickHashes: RunResult2["tickHashes"] = [];
  let lastEventHash: string | null = null;
  let haltedAtTick: number | null = null;

  const startTick = state.tick;
  tickLoop: for (let t = state.tick + 1; t <= startTick + opts.ticks; t++) {
    const retainLog = opts.retainActionLog !== false; // default true

    // Record event index at tick start (before any events added) for belief formation
    const evStart = events.length;

    if (seasonAt2(t, manifest) !== seasonAt2(t - 1, manifest)) {
      events.push({ tick: t, kind: "season_change", npcId: null, data: { season: seasonAt2(t, manifest) } });
    }
    state.tick = t;

    environmentStep2(state, manifest, seedRoot, events);

    // Decision loop: iterate over snapshot so newborns never act on their birth tick
    const actors = [...state.npcs];
    for (const npc of actors) {
      if (!npc.alive) continue;

      // buildObservation2 -> updateMemory always run, live decision or injected replay
      // alike: npc.memory is part of hashed state, so a replay must evolve it exactly
      // as the original live run did, regardless of which action ultimately gets applied.
      const obs = buildObservation2(state, manifest, npc);
      updateMemory(npc, obs);
      const observationHash = hashCanonical(obs);

      let action: W2Action;
      let actionSource: "reflex" | "goal";
      let goal: GoalKey | null;

      const injected = opts.injectedActions?.get(`${t}:${npc.npcId}`);
      if (injected !== undefined) {
        action = injected.action;
        actionSource = injected.actionSource;
        goal = injected.goal;
        // Reconstruct npc.goal state (part of hashed state, used for next-tick
        // hysteresis) from the logged audit field alone: chooseGoal's `switched`
        // is, by construction, exactly "resolved key differs from the prior
        // committed key" (or true when there was no prior key) — so it can be
        // recovered here without re-running scoreGoals/chooseGoal. Reflex ticks
        // never touch npc.goal in a live run, so they don't here either.
        if (actionSource === "goal" && goal !== null) {
          const switched = npc.goal === null || npc.goal.key !== goal;
          npc.goal = { key: goal, sinceTick: switched ? t : npc.goal!.sinceTick };
        }
      } else {
        const effPolicy = applyBeliefs2(npc.policy, npc.beliefs, seasonAt2(t, manifest));
        const reflex = reflexDecide2(obs, effPolicy);
        if (reflex !== null) {
          action = reflex;
          actionSource = "reflex";
          goal = null;
        } else {
          const scored = scoreGoals(obs, npc, effPolicy, manifest);
          const chosen = chooseGoal(scored, npc.goal, effPolicy, npc.identity, seedRoot, npc.npcId, t);
          npc.goal = chosen.switched ? { key: chosen.key, sinceTick: t } : { key: chosen.key, sinceTick: npc.goal!.sinceTick };
          action = planAction(chosen.key, obs, npc, manifest, seedRoot);
          actionSource = "goal";
          goal = chosen.key;
        }
      }

      opts.onDecide?.({ tick: t, npcId: npc.npcId, observation: obs, actionSource, goal, action });

      const legal = applyAction2(state, manifest, npc, action);
      if (!legal) {
        if (injected !== undefined) {
          // Replay mode: an illegal injected action means the claim diverged from a
          // genuine live run upstream. Halt and return the partial result rather than
          // throwing — see src/sim/engine.ts's v1 twin for the identical rationale.
          haltedAtTick = t;
          break tickLoop;
        }
        throw new Error(`illegal action at tick ${t} for ${npc.npcId}: ${JSON.stringify(action)}`);
      }

      const event: W2ActionEvent = {
        eventId: `${t}:${npc.npcId}`,
        tick: t,
        npcId: npc.npcId,
        observationHash,
        action,
        actionSource,
        goal,
        previousEventHash: lastEventHash,
      };
      lastEventHash = hashCanonical(event);
      if (retainLog) {
        actionLog.push(event);
      }

      // building_built: v1's SemanticEvent kind enum (src/schema/log.ts, frozen) has no
      // construction-event kind, and that file may not be edited. Of its 7 kinds, 6
      // ("death"/"wolf_attack"/"starving"/"season_change"/"birth"/"belief_formed") are
      // all legitimately produced elsewhere in this very engine, so repurposing any of
      // them would make `events.filter(e => e.kind === X)` ambiguous between a real w2
      // event and a relabeled building-built event. "patron_set" is the one kind engine2
      // never legitimately produces (the patron mechanism is v1/arms-only, absent from
      // w2's design entirely), so it's the only repurposing that can't collide with a
      // genuine same-kind event in the same stream. See the Task 6 report for the
      // consequence: consumers must disambiguate by `data` shape (a `buildingKind` key)
      // rather than by `kind` alone, and a future schema revision should give w2 its own
      // event-kind union instead of reusing v1's frozen one.
      if (action.verb === "build") {
        events.push({
          tick: t,
          kind: "patron_set",
          npcId: npc.npcId,
          data: { buildingKind: action.kind, posX: npc.pos.x, posY: npc.pos.y },
        });
      }
    }

    needsStep2(state, manifest, events);

    for (const npc of state.npcs) {
      if (!npc.alive) continue;
      decayBeliefs2(npc, t);
    }
    const eventsThisTick = events.slice(evStart);
    beliefFormationStep2(state, events, eventsThisTick);

    // Reproduction: births add new NPCs
    reproductionStep2(state, manifest, seedRoot, events, breed2);

    if (t % manifest.checkpointInterval === 0) {
      checkpoints.push({ tick: t, stateHash: hashCanonical(state) });
    }
    if (opts.collectTickHashes === true) {
      tickHashes.push({ tick: t, stateHash: hashCanonical(state) });
    }
  }

  return { finalState: state, actionLog, checkpoints, events, tickHashes, haltedAtTick };
}

export function runSim2(
  manifest: W2Manifest,
  roster: W2RosterEntry[],
  seedRoot: string,
  opts: RunOptions2,
): RunResult2 {
  const initial = createW2InitialState(manifest, roster, seedRoot);
  return runFromState2(initial, manifest, seedRoot, opts);
}

/** Recomputes the previousEventHash chain. */
export function verifyLogChain2(log: W2ActionEvent[]): boolean {
  let prev: string | null = null;
  for (const ev of log) {
    if (ev.previousEventHash !== prev) return false;
    prev = hashCanonical(ev);
  }
  return true;
}
