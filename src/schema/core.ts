import { z } from "zod";

export const SCHEMA_VERSION = "phase1a-v3";

const Int = z.number().int();
const Milli = Int.min(0).max(1000); // 0..1000 fixed-point "per-mille" scale

export const CognitionS = z
  .object({
    decisionMode: z.enum(["utility", "random"]),
    inheritanceMode: z.enum(["breed", "clone"]),
    beliefDynamics: z.enum(["on", "off"]),
  })
  .strict();
export type Cognition = z.infer<typeof CognitionS>;

export const EFFECT_TARGETS = ["w:forage", "w:consume", "w:shelter", "w:seekMate", "w:explore", "w:idle", "t:hungerUrgent"] as const;
export type EffectTarget = (typeof EFFECT_TARGETS)[number];

export const BeliefS = z
  .object({
    proposition: z.string().max(200),
    effect: z
      .object({
        target: z.enum(EFFECT_TARGETS),
        modifier: Int.min(-300).max(300),
        condition: z.enum(["winter", "summer"]).nullable(),
      })
      .strict(),
    confidence: Milli,
    source: z.enum(["observed", "parentA", "parentB", "designed"]),
    acquiredTick: Int,
    decayPer100: Int.min(0).max(100),
  })
  .strict();
export type Belief = z.infer<typeof BeliefS>;

export const Vec2S = z.object({ x: Int, y: Int }).strict();
export type Vec2 = z.infer<typeof Vec2S>;

export const UTILITY_KEYS = ["forage", "consume", "shelter", "seekMate", "explore", "idle"] as const;
export type UtilityKey = (typeof UTILITY_KEYS)[number];

/** Closed key set (P4/R10): evolution may change values, never keys. */
export const UtilityWeightsS = z
  .object({ forage: Milli, consume: Milli, shelter: Milli, seekMate: Milli, explore: Milli, idle: Milli })
  .strict();

export const IdentityS = z
  .object({
    riskTolerance: Milli,
    socialTrust: Milli,
    explorationBias: Milli,
    patience: Milli,
    voiceStyle: z.string().max(300),
  })
  .strict();
export type Identity = z.infer<typeof IdentityS>;

export const PolicyS = z
  .object({
    utilityWeights: UtilityWeightsS,
    thresholds: z.object({ hungerUrgent: Milli }).strict(),
    deliberationEpsilon: Milli,
  })
  .strict();
export type Policy = z.infer<typeof PolicyS>;

export const RosterEntryS = z
  .object({ npcId: z.string(), name: z.string(), identity: IdentityS, policy: PolicyS, beliefs: z.array(BeliefS).max(16) })
  .strict();
export type RosterEntry = z.infer<typeof RosterEntryS>;

export const WorldManifestS = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    cognition: CognitionS,
    gridWidth: Int.min(4),
    gridHeight: Int.min(4),
    seasonLengthTicks: Int.min(1),
    energyDrainPerTick: Int.min(0),
    starvationHpDrain: Int.min(0),
    winterColdHpDrain: Int.min(0),
    berryEnergy: Int.min(0),
    berryRegrowPpmSummer: Int.min(0).max(1_000_000),
    berryRegrowPpmWinter: Int.min(0).max(1_000_000),
    wolfDamage: Int.min(0),
    hpRegenPerTick: Int.min(0),
    hpRegenEnergyMin: Int.min(0),
    maxHp: Int.min(1),
    maxEnergy: Int.min(1),
    visionRadius: Int.min(1),
    checkpointInterval: Int.min(1),
    shelters: z.array(Vec2S),
    bushes: z.array(z.object({ id: z.string(), pos: Vec2S, capacity: Int.min(1) }).strict()),
    wolfStart: Vec2S,
    adultAgeTicks: Int.min(0),
    elderAgeTicks: Int.min(0),
    senescenceHpDrain: Int.min(0),
    reproEnergyMin: Int.min(0),
    reproEnergyCost: Int.min(0),
    reproCooldownTicks: Int.min(0),
    birthChancePpm: Int.min(0).max(1_000_000),
    maxPopulation: Int.min(1),
    childStartHp: Int.min(1),
    childStartEnergy: Int.min(0),
  })
  .strict();
export type WorldManifest = z.infer<typeof WorldManifestS>;
