import { z } from "zod";
import { Vec2S } from "./core.js";

const Int = z.number().int();
const Hash = z.string().regex(/^[0-9a-f]{64}$/);

export const ActionS = z.discriminatedUnion("verb", [
  z.object({ verb: z.literal("move"), to: Vec2S }).strict(),
  z.object({ verb: z.literal("take"), target: z.string() }).strict(),
  z.object({ verb: z.literal("consume") }).strict(),
  z.object({ verb: z.literal("flee"), from: z.literal("wolf") }).strict(),
  z.object({ verb: z.literal("idle") }).strict(),
]);
export type Action = z.infer<typeof ActionS>;

/** Layer-1 authoritative log entry. P4 fields present, fixed in Phase 0. */
export const CanonicalActionEventS = z
  .object({
    eventId: z.string(),
    tick: Int.min(0),
    npcId: z.string(),
    observationHash: Hash,
    action: ActionS,
    actionSource: z.enum(["reflex", "utility", "resolver", "random"]),
    deliberationTriggered: z.boolean(),
    energyCharged: Int.min(0),
    /** Patron mechanism (schema v4): true iff the resolver's band lottery for this
     * decision was tilted toward a player-set patron theme (Resolution.patronApplied). */
    patronInfluence: z.boolean(),
    previousEventHash: Hash.nullable(),
  })
  .strict();
export type CanonicalActionEvent = z.infer<typeof CanonicalActionEventS>;

export const SemanticEventS = z
  .object({
    tick: Int.min(0),
    kind: z.enum([
      "death",
      "wolf_attack",
      "starving",
      "season_change",
      "birth",
      "belief_formed",
      "patron_set",
    ]),
    npcId: z.string().nullable(),
    data: z.record(z.string(), z.union([z.string(), z.number().int(), z.null()])),
  })
  .strict();
export type SemanticEvent = z.infer<typeof SemanticEventS>;

export const CheckpointS = z.object({ tick: Int.min(0), stateHash: Hash }).strict();
export type Checkpoint = z.infer<typeof CheckpointS>;
