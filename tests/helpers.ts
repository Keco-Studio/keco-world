import type { WorldManifest, RosterEntry, Belief } from "../src/schema/core.js";
import { SCHEMA_VERSION } from "../src/schema/core.js";

export function makeTestManifest(overrides: Partial<WorldManifest> = {}): WorldManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    gridWidth: 16,
    gridHeight: 16,
    seasonLengthTicks: 100,
    energyDrainPerTick: 2,
    starvationHpDrain: 5,
    winterColdHpDrain: 3,
    berryEnergy: 200,
    berryRegrowPpmSummer: 60_000,
    berryRegrowPpmWinter: 5_000,
    wolfDamage: 50,
    hpRegenPerTick: 1,
    hpRegenEnergyMin: 500,
    maxHp: 1000,
    maxEnergy: 1000,
    visionRadius: 8,
    checkpointInterval: 50,
    shelters: [{ x: 2, y: 2 }, { x: 12, y: 12 }],
    bushes: [
      { id: "bush-1", pos: { x: 5, y: 5 }, capacity: 5 },
      { id: "bush-2", pos: { x: 10, y: 3 }, capacity: 5 },
    ],
    wolfStart: { x: 15, y: 15 },
    adultAgeTicks: 100,
    elderAgeTicks: 400,
    senescenceHpDrain: 5,
    reproEnergyMin: 600,
    reproEnergyCost: 200,
    reproCooldownTicks: 150,
    birthChancePpm: 100_000,
    maxPopulation: 40,
    childStartHp: 600,
    childStartEnergy: 600,
    ...overrides,
  };
}

export function makeTestRoster(n: number): RosterEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    npcId: `npc-${i + 1}`,
    name: `NPC ${i + 1}`,
    identity: { riskTolerance: 500, socialTrust: 500, explorationBias: 400, patience: 500, voiceStyle: "" },
    policy: {
      utilityWeights: { forage: 600, consume: 800, shelter: 700, seekMate: 500, explore: 200, idle: 50 },
      thresholds: { hungerUrgent: 150 },
      deliberationEpsilon: 60,
    },
    beliefs: [],
  }));
}

export function makeTestBelief(overrides: Partial<Belief> = {}): Belief {
  return {
    proposition: "berries matter",
    effect: { target: "w:forage", modifier: 100, condition: null },
    confidence: 800,
    source: "observed",
    acquiredTick: 0,
    decayPer100: 20,
    ...overrides,
  };
}
