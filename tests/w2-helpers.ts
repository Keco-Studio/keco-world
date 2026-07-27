import type { W2Manifest, W2RosterEntry, GoalKey } from "../src/schema/world2.js";
import { SCHEMA_VERSION_W2, GRID, GOAL_KEYS } from "../src/schema/world2.js";
import { generateSites } from "../src/world2/map.js";
import { drawInt } from "../src/rng/rng.js";

export function makeW2TestManifest(overrides: Partial<W2Manifest> = {}): W2Manifest {
  return {
    schemaVersion: SCHEMA_VERSION_W2,
    gridWidth: GRID,
    gridHeight: GRID,
    seasonLengthTicks: 400,
    energyDrainPerTick: 2,
    starvationHpDrain: 5,
    winterColdHpDrain: 3,
    berryEnergy: 200,
    wolfDamage: 50,
    hpRegenPerTick: 1,
    hpRegenEnergyMin: 500,
    maxHp: 1000,
    maxEnergy: 1000,
    visionRadius: 8,
    checkpointInterval: 100,
    sites: generateSites("w2-test"),
    wolfStart: { x: GRID - 1, y: GRID - 1 },
    adultAgeTicks: 800,
    elderAgeTicks: 2400,
    senescenceHpDrain: 2,
    reproEnergyMin: 600,
    reproEnergyCost: 300,
    reproCooldownTicks: 200,
    birthChancePpm: 50_000,
    maxPopulation: 60,
    childStartHp: 600,
    childStartEnergy: 600,
    founderSeededMemory: 3,
    ...overrides,
  };
}

export function makeW2TestRoster(seedRoot: string): W2RosterEntry[] {
  return Array.from({ length: 5 }, (_, i) => {
    const npcId = `npc-${i + 1}`;
    const goalWeights = Object.fromEntries(
      GOAL_KEYS.map((k) => [k, 100 + drawInt(seedRoot, 701, "goal-weight", k, i)]),
    ) as Record<GoalKey, number>;
    return {
      npcId,
      name: `NPC ${i + 1}`,
      identity: { riskTolerance: 500, socialTrust: 500, explorationBias: 400, patience: 500, voiceStyle: "" },
      policy: {
        goalWeights,
        thresholds: { hungerUrgent: 150 },
        deliberationEpsilon: 60,
        commitmentThreshold: 150,
      },
      beliefs: [],
    };
  });
}
