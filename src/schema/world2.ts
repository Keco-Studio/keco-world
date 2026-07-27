import { z } from "zod";
import { Vec2S } from "./core.js";

export const SCHEMA_VERSION_W2 = "world2-v1";
export const RESOURCE_KINDS = ["berry", "wood", "stone", "gold"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export const BUILDING_KINDS = ["shelter", "granary", "monument"] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];
export const GOAL_KEYS = ["eat", "stockpile", "takeShelter", "shelterBuild", "granaryBuild", "monumentBuild", "rest"] as const;
export type GoalKey = (typeof GOAL_KEYS)[number];
export const RECIPES: Record<BuildingKind, Partial<Record<ResourceKind, number>>> = {
  shelter: { wood: 4, stone: 2 },
  granary: { wood: 6, stone: 4 },
  monument: { gold: 3, stone: 8 },
};
export const GRID = 64,
  VISION_RADIUS = 8,
  REGION_SIZE = 16,
  CARRY_CAP = 10,
  GRANARY_CAP = 50,
  MEMORY_CAP = 12,
  MEMORY_INHERIT_MAX = 6,
  MEMORY_MISREMEMBER_PPM = 100_000,
  MEMORY_JITTER = 2,
  SHELTER_NEED_RADIUS = 12;

// Zod helpers
const Int = z.number().int();
const Milli = Int.min(0).max(1000);

// CarryS: Four keys required, each Int >= 0
export const CarryS = z
  .object({
    berry: Int.min(0),
    wood: Int.min(0),
    stone: Int.min(0),
    gold: Int.min(0),
  })
  .strict();
export type Carry = z.infer<typeof CarryS>;

// Site schema
export const SiteS = z
  .object({
    id: z.string(),
    kind: z.enum(RESOURCE_KINDS),
    pos: Vec2S,
    stock: Int.min(0),
    capacity: Int.min(1),
    regrowPpmSummer: Int.min(0).max(1_000_000),
    regrowPpmWinter: Int.min(0).max(1_000_000),
  })
  .strict();
export type Site = z.infer<typeof SiteS>;

// Building schema
export const BuildingS = z
  .object({
    id: z.string(),
    kind: z.enum(BUILDING_KINDS),
    pos: Vec2S,
    ownerNpcId: z.string(),
    ownerLineageId: z.string(),
    builtTick: Int,
    store: CarryS,
  })
  .strict();
export type Building = z.infer<typeof BuildingS>;

// MemoryEntry schema
export const MemoryEntryS = z
  .object({
    kind: z.enum([...RESOURCE_KINDS, ...BUILDING_KINDS]),
    pos: Vec2S,
    lastStock: Int.min(0),
    seenTick: Int,
  })
  .strict();
export type MemoryEntry = z.infer<typeof MemoryEntryS>;

// W2Identity schema
export const W2IdentityS = z
  .object({
    riskTolerance: Milli,
    socialTrust: Milli,
    explorationBias: Milli,
    patience: Milli,
    voiceStyle: z.string().max(300),
  })
  .strict();
export type W2Identity = z.infer<typeof W2IdentityS>;

// W2Policy schema
export const W2PolicyS = z
  .object({
    goalWeights: z.record(z.enum(GOAL_KEYS), Milli),
    thresholds: z.object({ hungerUrgent: Milli }).strict(),
    deliberationEpsilon: Milli,
    commitmentThreshold: Milli,
  })
  .strict();
export type W2Policy = z.infer<typeof W2PolicyS>;

// W2Belief schema
export const W2_EFFECT_TARGETS = [
  "w:eat",
  "w:stockpile",
  "w:takeShelter",
  "w:shelterBuild",
  "w:granaryBuild",
  "w:monumentBuild",
  "w:rest",
  "t:hungerUrgent",
] as const;
export type W2EffectTarget = (typeof W2_EFFECT_TARGETS)[number];

export const W2BeliefS = z
  .object({
    proposition: z.string().max(200),
    effect: z
      .object({
        target: z.enum(W2_EFFECT_TARGETS),
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
export type W2Belief = z.infer<typeof W2BeliefS>;

// W2RosterEntry schema
export const W2RosterEntryS = z
  .object({
    npcId: z.string(),
    name: z.string(),
    identity: W2IdentityS,
    policy: W2PolicyS,
    beliefs: z.array(W2BeliefS).max(16),
  })
  .strict();
export type W2RosterEntry = z.infer<typeof W2RosterEntryS>;

// W2Manifest schema - NO shelters field
export const W2ManifestS = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION_W2),
    gridWidth: Int.min(4),
    gridHeight: Int.min(4),
    seasonLengthTicks: Int.min(1),
    energyDrainPerTick: Int.min(0),
    starvationHpDrain: Int.min(0),
    winterColdHpDrain: Int.min(0),
    berryEnergy: Int.min(0),
    wolfDamage: Int.min(0),
    hpRegenPerTick: Int.min(0),
    hpRegenEnergyMin: Int.min(0),
    maxHp: Int.min(1),
    maxEnergy: Int.min(1),
    visionRadius: Int.min(1),
    checkpointInterval: Int.min(1),
    sites: z.array(SiteS),
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
    founderSeededMemory: Int.min(0),
  })
  .strict();
export type W2Manifest = z.infer<typeof W2ManifestS>;
