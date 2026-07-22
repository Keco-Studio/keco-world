import type { WorldManifest, RosterEntry } from "../schema/core.js";
import { SCHEMA_VERSION } from "../schema/core.js";
import { drawInt } from "../rng/rng.js";
import { NAME_POOL } from "../world/rules.js";

export function makeDemoManifest(): WorldManifest {
  const bushes = Array.from({ length: 12 }, (_, i) => ({
    id: `bush-${i + 1}`,
    pos: { x: drawInt("demo-layout", 32, "bush-x", i), y: drawInt("demo-layout", 32, "bush-y", i) },
    capacity: 5,
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    gridWidth: 32,
    gridHeight: 32,
    seasonLengthTicks: 400,
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
    checkpointInterval: 100,
    shelters: [{ x: 6, y: 6 }, { x: 25, y: 8 }, { x: 15, y: 26 }],
    bushes,
    wolfStart: { x: 31, y: 31 },
    adultAgeTicks: 800,
    elderAgeTicks: 2400,
    senescenceHpDrain: 2,
    reproEnergyMin: 600,
    reproEnergyCost: 300,
    reproCooldownTicks: 600,
    birthChancePpm: 15_000,
    maxPopulation: 60,
    childStartHp: 600,
    childStartEnergy: 600,
  };
}

function vary(seedRoot: string, base: number, spread: number, ...key: (string | number)[]): number {
  const v = base - spread + drawInt(seedRoot, spread * 2 + 1, ...key);
  return Math.max(0, Math.min(1000, v));
}

export function makeDemoRoster(seedRoot: string): RosterEntry[] {
  return NAME_POOL.map((name, i) => {
    const npcId = `npc-${i + 1}`;
    return {
      npcId,
      name,
      identity: {
        riskTolerance: vary(seedRoot, 500, 300, "risk", i),
        socialTrust: vary(seedRoot, 500, 300, "trust", i),
        explorationBias: vary(seedRoot, 400, 300, "explore", i),
        patience: vary(seedRoot, 500, 300, "patience", i),
        voiceStyle: "",
      },
      policy: {
        utilityWeights: {
          forage: vary(seedRoot, 600, 250, "w-forage", i),
          consume: vary(seedRoot, 800, 150, "w-consume", i),
          shelter: vary(seedRoot, 700, 250, "w-shelter", i),
          seekMate: vary(seedRoot, 500, 200, "w-seekmate", i),
          explore: vary(seedRoot, 200, 180, "w-explore", i),
          idle: vary(seedRoot, 50, 40, "w-idle", i),
        },
        thresholds: { hungerUrgent: vary(seedRoot, 150, 100, "t-hunger", i) },
        deliberationEpsilon: vary(seedRoot, 60, 40, "w-epsilon", i),
      },
      beliefs: [],
    };
  });
}
