import type { Vec2, WorldManifest, RosterEntry, Identity, Policy, Belief } from "../schema/core.js";
import { drawInt } from "../rng/rng.js";
import { hashCanonical } from "../canon/canonicalize.js";

export interface NpcState {
  npcId: string;
  name: string;
  pos: Vec2;
  hp: number;
  energy: number;
  berries: number;
  alive: boolean;
  deathTick: number | null;
  deathCause: string | null;
  /** last source of hp damage, used as death cause chain root */
  lastDamage: string | null;
  identity: Identity;
  policy: Policy;
  beliefs: Belief[];
  birthTick: number;
  generation: number;
  lineageId: string;
  parents: [string, string] | null;
  reproCooldownUntil: number;
  genomeHash: string;
}

export interface BushState {
  id: string;
  pos: Vec2;
  berries: number;
  capacity: number;
}

export interface WorldState {
  tick: number;
  npcs: NpcState[];
  bushes: BushState[];
  wolf: { pos: Vec2 };
}

export function seasonAt(tick: number, manifest: WorldManifest): "summer" | "winter" {
  return Math.floor(tick / manifest.seasonLengthTicks) % 2 === 0 ? "summer" : "winter";
}

export function chebyshev(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function isOnShelter(pos: Vec2, manifest: WorldManifest): boolean {
  return manifest.shelters.some((s) => s.x === pos.x && s.y === pos.y);
}

export function npcAge(npc: NpcState, tick: number): number {
  return tick - npc.birthTick;
}

export function createInitialState(
  manifest: WorldManifest,
  roster: RosterEntry[],
  seedRoot: string,
): WorldState {
  const npcs: NpcState[] = roster.map((r) => {
    const birthTick = -(
      manifest.adultAgeTicks +
      drawInt(
        seedRoot,
        Math.max(1, manifest.elderAgeTicks),
        "founder-age",
        r.npcId,
      )
    );
    const identity = structuredClone(r.identity);
    const policy = structuredClone(r.policy);
    const beliefs = structuredClone(r.beliefs);
    const genomeHash = hashCanonical({ identity, policy, beliefs });
    return {
      npcId: r.npcId,
      name: r.name,
      pos: {
        x: drawInt(seedRoot, manifest.gridWidth, "spawn-x", r.npcId),
        y: drawInt(seedRoot, manifest.gridHeight, "spawn-y", r.npcId),
      },
      hp: manifest.maxHp,
      energy: manifest.maxEnergy,
      berries: 0,
      alive: true,
      deathTick: null,
      deathCause: null,
      lastDamage: null,
      identity,
      policy,
      beliefs,
      birthTick,
      generation: 0,
      lineageId: r.npcId,
      parents: null,
      reproCooldownUntil: 0,
      genomeHash,
    };
  });
  const bushes: BushState[] = manifest.bushes.map((b) => ({
    id: b.id,
    pos: { x: b.pos.x, y: b.pos.y },
    berries: b.capacity,
    capacity: b.capacity,
  }));
  return { tick: 0, npcs, bushes, wolf: { pos: { x: manifest.wolfStart.x, y: manifest.wolfStart.y } } };
}
