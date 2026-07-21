import type { WorldManifest } from "../schema/core.js";
import type { SemanticEvent } from "../schema/log.js";
import type { WorldState } from "./state.js";
import { seasonAt, chebyshev, isOnShelter, npcAge } from "./state.js";
import { drawInt } from "../rng/rng.js";
import { DIRS } from "../mind/utility.js";

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
