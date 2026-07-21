import type { WorldManifest, Identity, Policy, Belief } from "../schema/core.js";
import type { SemanticEvent } from "../schema/log.js";
import type { WorldState, NpcState } from "./state.js";
import { seasonAt, chebyshev, isOnShelter, npcAge } from "./state.js";
import { drawInt } from "../rng/rng.js";
import { hashCanonical } from "../canon/canonicalize.js";
import { breed } from "../life/genome.js";
import { DIRS } from "../mind/utility.js";

export const NAME_POOL = [
  "Rill", "Ash", "Fenna", "Bram", "Sorrel", "Wren", "Tarn", "Isla", "Corin", "Vesna",
  "Odo", "Merle", "Sable", "Quinn", "Petra", "Lorn", "Hazel", "Garen", "Nyx", "Ives",
  "Runa", "Col", "Tamsin", "Ebba", "Joss",
] as const;

/** Bush regrowth, wolf walk + attacks. Runs before NPC decisions each tick. */
export function environmentStep(
  state: WorldState,
  manifest: WorldManifest,
  seedRoot: string,
  events: SemanticEvent[],
): void {
  const season = seasonAt(state.tick, manifest);
  const ppm = season === "summer" ? manifest.berryRegrowPpmSummer : manifest.berryRegrowPpmWinter;
  for (const bush of state.bushes) {
    if (bush.berries < bush.capacity && drawInt(seedRoot, 1_000_000, "regrow", bush.id, state.tick) < ppm) {
      bush.berries += 1;
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
    if (chebyshev(npc.pos, state.wolf.pos) <= 1) {
      npc.hp -= manifest.wolfDamage;
      npc.lastDamage = "wolf";
      events.push({ tick: state.tick, kind: "wolf_attack", npcId: npc.npcId, data: { damage: manifest.wolfDamage } });
    }
  }
}

/** Energy drain, starvation, cold, regen, death. Runs after NPC actions each tick. */
export function needsStep(
  state: WorldState,
  manifest: WorldManifest,
  events: SemanticEvent[],
): void {
  const season = seasonAt(state.tick, manifest);
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
    if (season === "winter" && !isOnShelter(npc.pos, manifest)) {
      npc.hp -= manifest.winterColdHpDrain;
      npc.lastDamage = "cold";
    }
    if (npcAge(npc, state.tick) > manifest.elderAgeTicks) {
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

/** Reproduction step: pairing, births, population cap. */
export function reproductionStep(
  state: WorldState,
  manifest: WorldManifest,
  seedRoot: string,
  events: SemanticEvent[],
): void {
  const age = (npc: NpcState) => npcAge(npc, state.tick);
  const isEligible = (npc: NpcState): boolean =>
    npc.alive &&
    age(npc) >= manifest.adultAgeTicks &&
    age(npc) <= manifest.elderAgeTicks &&
    npc.energy >= manifest.reproEnergyMin &&
    state.tick >= npc.reproCooldownUntil;

  const paired = new Set<string>(); // track paired npcIds this tick
  let birthIdx = 0;

  for (let i = 0; i < state.npcs.length; i++) {
    const a = state.npcs[i]!;
    if (!isEligible(a) || paired.has(a.npcId)) continue;

    // Find first later eligible unpaired partner within Chebyshev distance 1
    let b: NpcState | null = null;
    for (let j = i + 1; j < state.npcs.length; j++) {
      const candidate = state.npcs[j]!;
      if (isEligible(candidate) && !paired.has(candidate.npcId) && chebyshev(a.pos, candidate.pos) <= 1) {
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

    const childGenome = breed(genomeOf(a), genomeOf(b), childId, seedRoot, state.tick);

    const child: NpcState = {
      npcId: childId,
      name: NAME_POOL[drawInt(seedRoot, NAME_POOL.length, "childname", childId)]!,
      pos: { x: a.pos.x, y: a.pos.y },
      hp: manifest.childStartHp,
      energy: manifest.childStartEnergy,
      berries: 0,
      alive: true,
      deathTick: null,
      deathCause: null,
      lastDamage: null,
      identity: childGenome.identity,
      policy: childGenome.policy,
      beliefs: childGenome.beliefs,
      birthTick: state.tick,
      generation: childGenome.generation,
      lineageId: childGenome.lineageId,
      parents: [a.npcId, b.npcId],
      reproCooldownUntil: state.tick + manifest.reproCooldownTicks,
      genomeHash: hashCanonical({ identity: childGenome.identity, policy: childGenome.policy, beliefs: childGenome.beliefs }),
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

/** Extract genome from an NPC state. */
function genomeOf(npc: NpcState) {
  return {
    lineageId: npc.lineageId,
    generation: npc.generation,
    identity: npc.identity,
    policy: npc.policy,
    beliefs: npc.beliefs,
  };
}
