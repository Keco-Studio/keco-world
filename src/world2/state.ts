import type { Vec2 } from "../schema/core.js";
import type {
  W2Manifest,
  W2RosterEntry,
  W2Identity,
  W2Policy,
  W2Belief,
  MemoryEntry,
  Site,
  Building,
  ResourceKind,
  GoalKey,
} from "../schema/world2.js";
import { RESOURCE_KINDS, GRID } from "../schema/world2.js";
import { drawInt } from "../rng/rng.js";
import { hashCanonical } from "../canon/canonicalize.js";

/** The four things that can subtract hp in world2. */
export const DAMAGE_SOURCES = ["starvation", "cold", "old_age", "wolf"] as const;
export type DamageSource = (typeof DAMAGE_SOURCES)[number];

export function emptyDamage(): Record<DamageSource, number> {
  return { starvation: 0, cold: 0, old_age: 0, wolf: 0 };
}

/**
 * Death cause = the source that did the most cumulative hp damage over this
 * NPC's life; ties resolve in DAMAGE_SOURCES order.
 *
 * Task 8 diagnosis note: the previous rule was "whatever damaged me last"
 * (`lastDamage`), which systematically mislabelled winter deaths. needsStep2
 * applies starvation before cold, so any NPC dying in winter got `cold` as its
 * cause even when starvation was doing 5 hp/tick against cold's 3 — and with
 * `winterColdHpDrain = 0` it still got `cold` despite cold doing literally no
 * damage. That made the first-winter death ledger unreadable, which is exactly
 * the evidence C1 has to reason from. This changes labelling only: no hp,
 * energy, or aliveness arithmetic depends on it.
 */
export function dominantDamage(damage: Record<DamageSource, number>): string {
  let best: DamageSource | null = null;
  for (const s of DAMAGE_SOURCES) {
    if (damage[s] > 0 && (best === null || damage[s] > damage[best])) best = s;
  }
  return best ?? "unknown";
}

export interface W2NpcState {
  npcId: string;
  name: string;
  pos: Vec2;
  hp: number;
  energy: number;
  carry: Record<ResourceKind, number>;
  alive: boolean;
  deathTick: number | null;
  deathCause: string | null;
  /** last source of hp damage (set only when that source actually removed hp) */
  lastDamage: string | null;
  /** cumulative hp removed by each source over this NPC's life */
  damage: Record<DamageSource, number>;
  identity: W2Identity;
  policy: W2Policy;
  beliefs: W2Belief[];
  memory: MemoryEntry[];
  goal: { key: GoalKey; sinceTick: number } | null;
  birthTick: number;
  generation: number;
  lineageId: string;
  parents: [string, string] | null;
  reproCooldownUntil: number;
  genomeHash: string;
}

export interface W2WorldState {
  tick: number;
  npcs: W2NpcState[];
  sites: Site[];
  buildings: Building[];
  wolf: { pos: Vec2 };
}

/**
 * Season at `tick`. With `firstSummerBonusTicks = 0` this is the frozen v2.0
 * rule: alternating blocks of `seasonLengthTicks` starting with summer at
 * tick 0. A positive bonus B stretches the *first* summer to
 * `seasonLengthTicks + B` ticks (0 .. L+B-1) and shifts every later boundary by
 * exactly B, leaving all subsequent seasons at their normal length.
 */
export function seasonAt2(tick: number, manifest: W2Manifest): "summer" | "winter" {
  const bonus = manifest.firstSummerBonusTicks;
  const shifted = tick < bonus ? 0 : tick - bonus;
  return Math.floor(shifted / manifest.seasonLengthTicks) % 2 === 0 ? "summer" : "winter";
}

export function chebyshev2(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function npcAge2(npc: W2NpcState, tick: number): number {
  return tick - npc.birthTick;
}

export function carryTotal(carry: Record<ResourceKind, number>): number {
  let total = 0;
  for (const k of RESOURCE_KINDS) total += carry[k];
  return total;
}

/** Building of kind "shelter" occupying the same grid cell as `pos`, or null. */
export function shelterAt(state: W2WorldState, pos: Vec2): Building | null {
  for (const b of state.buildings) {
    if (b.kind === "shelter" && b.pos.x === pos.x && b.pos.y === pos.y) return b;
  }
  return null;
}

/** Building of kind "granary" owned by `lineageId` occupying the same grid cell as `pos`, or null. */
export function lineageGranaryAt(state: W2WorldState, pos: Vec2, lineageId: string): Building | null {
  for (const b of state.buildings) {
    if (b.kind === "granary" && b.ownerLineageId === lineageId && b.pos.x === pos.x && b.pos.y === pos.y) {
      return b;
    }
  }
  return null;
}

function emptyCarry(): Record<ResourceKind, number> {
  return { berry: 0, wood: 0, stone: 0, gold: 0 };
}

/** UTF-16 string comparison; never localeCompare (determinism doctrine). */
function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function createW2InitialState(
  manifest: W2Manifest,
  roster: W2RosterEntry[],
  seedRoot: string,
): W2WorldState {
  const sites: Site[] = structuredClone(manifest.sites);

  const npcs: W2NpcState[] = roster.map((r) => {
    const birthTick = -(
      manifest.adultAgeTicks +
      drawInt(seedRoot, Math.max(1, manifest.elderAgeTicks - manifest.adultAgeTicks), "founder-age", r.npcId)
    );
    const identity = structuredClone(r.identity);
    const policy = structuredClone(r.policy);
    const beliefs = structuredClone(r.beliefs);
    const genomeHash = hashCanonical({ identity, policy, beliefs });
    const pos: Vec2 = {
      x: drawInt(seedRoot, GRID, "spawn-x", r.npcId),
      y: drawInt(seedRoot, GRID, "spawn-y", r.npcId),
    };

    const ranked = sites
      .map((site) => ({ site, dist: chebyshev2(pos, site.pos) }))
      .sort((x, y) => (x.dist !== y.dist ? x.dist - y.dist : cmpStr(x.site.id, y.site.id)));
    const memory: MemoryEntry[] = ranked.slice(0, manifest.founderSeededMemory).map(({ site }) => ({
      kind: site.kind,
      pos: { x: site.pos.x, y: site.pos.y },
      lastStock: site.stock,
      seenTick: 0,
      ownerLineageId: null,
    }));

    return {
      npcId: r.npcId,
      name: r.name,
      pos,
      hp: manifest.maxHp,
      energy: manifest.maxEnergy,
      carry: emptyCarry(),
      alive: true,
      deathTick: null,
      deathCause: null,
      lastDamage: null,
      damage: emptyDamage(),
      identity,
      policy,
      beliefs,
      memory,
      goal: null,
      birthTick,
      generation: 0,
      lineageId: r.npcId,
      parents: null,
      reproCooldownUntil: 0,
      genomeHash,
    };
  });

  return {
    tick: 0,
    npcs,
    sites,
    buildings: [],
    wolf: { pos: { x: manifest.wolfStart.x, y: manifest.wolfStart.y } },
  };
}
