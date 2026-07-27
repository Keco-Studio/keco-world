import type { W2Manifest, W2Identity, W2Policy, W2Belief, MemoryEntry } from "../schema/world2.js";
import type { SemanticEvent } from "../schema/log.js";
import type { W2WorldState, W2NpcState } from "./state.js";
import { seasonAt2, chebyshev2, npcAge2, shelterAt } from "./state.js";
import { drawInt } from "../rng/rng.js";
import { hashCanonical } from "../canon/canonicalize.js";
import { DIRS } from "../mind/utility.js";
import { NAME_POOL } from "../world/rules.js";

/**
 * Minimal heritable genome payload consumed/produced by the reproduction
 * injection point. Task 6's `breed2` (src/life/genome2.ts) will implement the
 * real crossover/mutation logic against this exact shape; tests in this task
 * use a stub of matching shape.
 */
export interface W2Genome2 {
  lineageId: string;
  generation: number;
  identity: W2Identity;
  policy: W2Policy;
  beliefs: W2Belief[];
  memory: MemoryEntry[];
}

export type BreedFn2 = (
  a: W2Genome2,
  b: W2Genome2,
  childKey: string,
  seedRoot: string,
  tick: number,
) => W2Genome2;

/** Check if an NPC is fertile-eligible: adult age in window, enough energy, cooldown passed. */
export function isFertileEligible2(npc: W2NpcState, manifest: W2Manifest, tick: number): boolean {
  const age = npcAge2(npc, tick);
  return (
    npc.alive &&
    age >= manifest.adultAgeTicks &&
    age <= manifest.elderAgeTicks &&
    npc.energy >= manifest.reproEnergyMin &&
    tick >= npc.reproCooldownUntil
  );
}

/** Site regrowth (per-kind seasonal ppm), wolf walk + attacks. Runs before NPC decisions each tick. */
export function environmentStep2(
  state: W2WorldState,
  manifest: W2Manifest,
  seedRoot: string,
  events: SemanticEvent[],
): void {
  const season = seasonAt2(state.tick, manifest);
  for (const site of state.sites) {
    const ppm = season === "summer" ? site.regrowPpmSummer : site.regrowPpmWinter;
    if (site.stock < site.capacity && drawInt(seedRoot, 1_000_000, "regrow", site.id, state.tick) < ppm) {
      site.stock += 1;
    }
  }

  const dir = DIRS[drawInt(seedRoot, 8, "wolf", state.tick)]!;
  const nx = state.wolf.pos.x + dir.x;
  const ny = state.wolf.pos.y + dir.y;
  if (nx >= 0 && nx < manifest.gridWidth && ny >= 0 && ny < manifest.gridHeight) {
    state.wolf.pos = { x: nx, y: ny };
  }
  for (const npc of state.npcs) {
    if (!npc.alive) continue;
    if (chebyshev2(npc.pos, state.wolf.pos) <= 1) {
      npc.hp -= manifest.wolfDamage;
      npc.lastDamage = "wolf";
      events.push({ tick: state.tick, kind: "wolf_attack", npcId: npc.npcId, data: { damage: manifest.wolfDamage } });
    }
  }
}

/** Energy drain, starvation, shelter-gated cold, senescence, regen, death. Runs after NPC actions each tick. */
export function needsStep2(state: W2WorldState, manifest: W2Manifest, events: SemanticEvent[]): void {
  const season = seasonAt2(state.tick, manifest);
  for (const npc of state.npcs) {
    if (!npc.alive) continue;
    const wasStarving = npc.energy === 0;
    npc.energy = Math.max(0, npc.energy - manifest.energyDrainPerTick);
    const isStarving = npc.energy === 0;
    if (isStarving) {
      npc.hp -= manifest.starvationHpDrain;
      npc.lastDamage = "starvation";
      if (!wasStarving) {
        events.push({ tick: state.tick, kind: "starving", npcId: npc.npcId, data: {} });
      }
    }
    if (season === "winter" && shelterAt(state, npc.pos) === null) {
      npc.hp -= manifest.winterColdHpDrain;
      npc.lastDamage = "cold";
    }
    if (npcAge2(npc, state.tick) > manifest.elderAgeTicks) {
      npc.hp -= manifest.senescenceHpDrain;
      npc.lastDamage = "old_age";
    }
    if (npc.energy >= manifest.hpRegenEnergyMin) {
      npc.hp = Math.min(manifest.maxHp, npc.hp + manifest.hpRegenPerTick);
    }
    if (npc.hp <= 0) {
      npc.hp = 0;
      npc.alive = false;
      npc.deathTick = state.tick;
      npc.deathCause = npc.lastDamage ?? "unknown";
      events.push({ tick: state.tick, kind: "death", npcId: npc.npcId, data: { cause: npc.deathCause } });
    }
  }
}

function genomeOf2(npc: W2NpcState): W2Genome2 {
  return {
    lineageId: npc.lineageId,
    generation: npc.generation,
    identity: npc.identity,
    policy: npc.policy,
    beliefs: npc.beliefs,
    memory: npc.memory,
  };
}

function emptyCarry(): Record<"berry" | "wood" | "stone" | "gold", number> {
  return { berry: 0, wood: 0, stone: 0, gold: 0 };
}

/**
 * Reproduction step: pairing, births, population cap. `breedFn` is an
 * injection point — Task 6 wires up the real `breed2`; earlier tasks pass a
 * stub of matching shape.
 */
export function reproductionStep2(
  state: W2WorldState,
  manifest: W2Manifest,
  seedRoot: string,
  events: SemanticEvent[],
  breedFn: BreedFn2,
): void {
  const paired = new Set<string>(); // track paired npcIds this tick
  let birthIdx = 0;

  for (let i = 0; i < state.npcs.length; i++) {
    const a = state.npcs[i]!;
    if (!isFertileEligible2(a, manifest, state.tick) || paired.has(a.npcId)) continue;

    // Find first later eligible unpaired partner within Chebyshev distance 1
    let b: W2NpcState | null = null;
    for (let j = i + 1; j < state.npcs.length; j++) {
      const candidate = state.npcs[j]!;
      if (
        isFertileEligible2(candidate, manifest, state.tick) &&
        !paired.has(candidate.npcId) &&
        chebyshev2(a.pos, candidate.pos) <= 1
      ) {
        b = candidate;
        break;
      }
    }

    if (!b) continue;

    // Check population cap before birth
    if (state.npcs.filter((n) => n.alive).length >= manifest.maxPopulation) break;

    // Roll for birth
    const chance = drawInt(seedRoot, 1_000_000, "repro", a.npcId, b.npcId, state.tick);
    if (chance >= manifest.birthChancePpm) continue;

    // Birth happens: both parents pay energy cost and set cooldown
    a.energy -= manifest.reproEnergyCost;
    b.energy -= manifest.reproEnergyCost;
    a.reproCooldownUntil = state.tick + manifest.reproCooldownTicks;
    b.reproCooldownUntil = state.tick + manifest.reproCooldownTicks;

    // Create child
    const childId = `child-${state.tick}-${birthIdx}`;
    birthIdx++;

    const childGenome = breedFn(genomeOf2(a), genomeOf2(b), childId, seedRoot, state.tick);

    const child: W2NpcState = {
      npcId: childId,
      name: NAME_POOL[drawInt(seedRoot, NAME_POOL.length, "childname", childId)]!,
      pos: { x: a.pos.x, y: a.pos.y },
      hp: manifest.childStartHp,
      energy: manifest.childStartEnergy,
      carry: emptyCarry(),
      alive: true,
      deathTick: null,
      deathCause: null,
      lastDamage: null,
      identity: childGenome.identity,
      policy: childGenome.policy,
      beliefs: childGenome.beliefs,
      memory: childGenome.memory,
      goal: null,
      birthTick: state.tick,
      generation: childGenome.generation,
      lineageId: childGenome.lineageId,
      parents: [a.npcId, b.npcId],
      reproCooldownUntil: state.tick + manifest.reproCooldownTicks,
      genomeHash: hashCanonical({
        identity: childGenome.identity,
        policy: childGenome.policy,
        beliefs: childGenome.beliefs,
      }),
    };

    state.npcs.push(child);
    paired.add(a.npcId);
    paired.add(b.npcId);

    events.push({
      tick: state.tick,
      kind: "birth",
      npcId: child.npcId,
      data: {
        generation: child.generation,
        lineageId: child.lineageId,
        parentA: a.npcId,
        parentB: b.npcId,
      },
    });
  }
}
