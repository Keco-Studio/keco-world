import type { RosterEntry } from "../schema/core.js";
import { UTILITY_KEYS } from "../schema/core.js";
import type { SemanticEvent } from "../schema/log.js";
import type { WorldState } from "../world/state.js";

export interface LineageMember {
  npcId: string;
  name: string;
  generation: number;
  birthTick: number;
  parents: [string, string] | null;
  deathTick: number | null;
  deathCause: string | null; // null = alive at end
}

export interface LineageChronicle {
  lineageId: string;
  founderName: string;
  members: LineageMember[]; // sorted (generation, birthTick, npcId)
  beliefsFormed: { npcId: string; name: string; tick: number; proposition: string }[]; // from belief_formed events, members only
  weightDrift: { key: string; founder: number; latest: number }[]; // founder roster weights vs the LATEST-generation living member (tie: earliest npcId); empty if lineage extinct
  extinct: boolean;
  peakGeneration: number;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Assemble a grounded chronicle for one lineage from the authoritative event log
 * and final state. Membership: the founder (roster entry whose npcId === lineageId)
 * plus every birth event whose data.lineageId === lineageId. Every field traces to
 * either a birth/death/belief_formed event or a roster/finalState record.
 */
export function extractLineage(
  events: SemanticEvent[],
  finalState: WorldState,
  roster: RosterEntry[],
  lineageId: string,
): LineageChronicle {
  const founderRoster = roster.find((r) => r.npcId === lineageId);
  if (!founderRoster) {
    throw new Error(`extractLineage: no roster entry for lineageId "${lineageId}"`);
  }

  // Resolve display names for any npcId we encounter (founders + descendants),
  // grounded in the roster and the final simulated state.
  const nameByNpcId = new Map<string, string>();
  for (const r of roster) nameByNpcId.set(r.npcId, r.name);
  for (const n of finalState.npcs) nameByNpcId.set(n.npcId, n.name);
  const resolveName = (npcId: string): string => nameByNpcId.get(npcId) ?? npcId;

  const founderState = finalState.npcs.find((n) => n.npcId === lineageId);

  const membersById = new Map<string, LineageMember>();
  membersById.set(lineageId, {
    npcId: lineageId,
    name: founderRoster.name,
    generation: 0,
    birthTick: founderState?.birthTick ?? 0,
    parents: null,
    deathTick: null,
    deathCause: null,
  });

  for (const e of events) {
    if (e.kind === "birth" && e.npcId !== null && e.data["lineageId"] === lineageId) {
      const generation = Number(e.data["generation"]);
      const parentA = String(e.data["parentA"]);
      const parentB = String(e.data["parentB"]);
      membersById.set(e.npcId, {
        npcId: e.npcId,
        name: resolveName(e.npcId),
        generation,
        birthTick: e.tick,
        parents: [parentA, parentB],
        deathTick: null,
        deathCause: null,
      });
    }
  }

  for (const e of events) {
    if (e.kind === "death" && e.npcId !== null) {
      const m = membersById.get(e.npcId);
      if (m) {
        m.deathTick = e.tick;
        m.deathCause = String(e.data["cause"] ?? "unknown");
      }
    }
  }

  const members = [...membersById.values()].sort((a, b) => {
    if (a.generation !== b.generation) return a.generation - b.generation;
    if (a.birthTick !== b.birthTick) return a.birthTick - b.birthTick;
    return compareIds(a.npcId, b.npcId);
  });

  const memberIds = new Set(members.map((m) => m.npcId));

  const beliefsFormed = events
    .filter((e): e is SemanticEvent & { npcId: string } => e.kind === "belief_formed" && e.npcId !== null && memberIds.has(e.npcId))
    .map((e) => ({
      npcId: e.npcId,
      name: resolveName(e.npcId),
      tick: e.tick,
      proposition: String(e.data["proposition"] ?? ""),
    }))
    .sort((a, b) => (a.tick !== b.tick ? a.tick - b.tick : compareIds(a.npcId, b.npcId)));

  const peakGeneration = Math.max(...members.map((m) => m.generation));

  const livingMembers = finalState.npcs.filter((n) => n.alive && n.lineageId === lineageId);
  const extinct = livingMembers.length === 0;

  let weightDrift: { key: string; founder: number; latest: number }[] = [];
  if (!extinct) {
    const latest = [...livingMembers].sort((a, b) => {
      if (b.generation !== a.generation) return b.generation - a.generation;
      return compareIds(a.npcId, b.npcId);
    })[0]!;
    weightDrift = UTILITY_KEYS.map((key) => ({
      key,
      founder: founderRoster.policy.utilityWeights[key],
      latest: latest.policy.utilityWeights[key],
    }));
  }

  return {
    lineageId,
    founderName: founderRoster.name,
    members,
    beliefsFormed,
    weightDrift,
    extinct,
    peakGeneration,
  };
}
