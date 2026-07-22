# Genome & Structured Breeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** living-worlds.md §17.1 step 5: in-world reproduction with heritable four-layer genomes — Identity/Policy crossover+mutation, Cultural Memory with structured `effect` coupling into the utility layer (P2), the B0 Resolver (personality-weighted deterministic tie-break, evolvable epsilon), aging/senescence, and a long-run `npm run evolve` driver that reaches multi-generation populations deterministically.

**Architecture:** Genomes live *in* NPC state (identity/policy/beliefs embedded at spawn; founders from roster, children from `breed()`). Selection is natural: whoever survives, pairs, and meets energy/age/cooldown conditions reproduces via a deterministic world rule — no explicit fitness function. Culture is Lamarckian (children sample parents' *current* beliefs, formed from lived events, decaying over time); Identity/Policy are Darwinian (per-key crossover + bounded integer mutation, all randomness via keyed `drawInt`). The Resolver replaces argmax inside the epsilon hesitation band with a personality-affinity weighted deterministic draw (`actionSource: "resolver"`). Births/deaths/beliefs are world rules — fully replayable, zero LLM.

**Tech Stack:** existing kernel (TypeScript ESM, zod v4, vitest). No new dependencies.

## Global Constraints

- Kernel determinism invariants hold: integers-only in hashed state, all randomness via `drawInt` with explicit keys, roster-order/npc-list-order iteration, no `Date.now()`/`Math.random()` under `src/`.
- `SCHEMA_VERSION` bumps to `"phase1a-v1"` (state shape changes; old run dirs incompatible by design — the replay CLI's meta check enforces this).
- Mutation/inheritance constants are named exports in `src/life/genome.ts` (no magic numbers inline).
- Epsilon = `policy.deliberationEpsilon` (0..1000, evolvable). **epsilon 0 → Resolver never fires → exact pre-existing argmax behavior** (baseline arms depend on this).
- Belief effects are confidence-scaled integer deltas clamped into [0,1000]; `applyBeliefs` never mutates its inputs.
- Newborns do not act on their birth tick (reproduction runs after the decision loop).
- All existing 125 tests keep passing, except tests/candidates.test.ts which this plan explicitly amends (resolver is a new legal actionSource with non-null candidates).
- Commits end with the Co-Authored-By trailer from the harness rules.

---

### Task 1: Schema extensions — genome fields, beliefs, reproduction params

**Files:**
- Modify: `src/schema/core.ts`, `src/schema/log.ts`, `tests/helpers.ts`
- Test: `tests/schema-genome.test.ts`

**Interfaces:**
- Produces in `core.ts`: `SCHEMA_VERSION = "phase1a-v1"`; `EFFECT_TARGETS = ["w:forage","w:consume","w:shelter","w:explore","w:idle","t:hungerUrgent"] as const`; `EffectTarget`; `BeliefS`/`Belief`:

```typescript
export const EFFECT_TARGETS = ["w:forage", "w:consume", "w:shelter", "w:explore", "w:idle", "t:hungerUrgent"] as const;
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
    source: z.enum(["observed", "parentA", "parentB"]),
    acquiredTick: Int,
    decayPer100: Int.min(0).max(100),
  })
  .strict();
export type Belief = z.infer<typeof BeliefS>;
```

- `PolicyS` gains `deliberationEpsilon: Milli` (required). `RosterEntryS` gains `beliefs: z.array(BeliefS).max(16)`. `WorldManifestS` gains reproduction/aging params (all `Int.min(0)` unless noted): `adultAgeTicks`, `elderAgeTicks`, `senescenceHpDrain`, `reproEnergyMin`, `reproEnergyCost`, `reproCooldownTicks`, `birthChancePpm` (`.max(1_000_000)`), `maxPopulation: Int.min(1)`, `childStartHp: Int.min(1)`, `childStartEnergy: Int.min(0)`.
- In `log.ts`: `actionSource` enum becomes `["reflex","utility","resolver"]`; `SemanticEventS.kind` enum gains `"birth"` and `"belief_formed"`.
- `tests/helpers.ts` updates: `makeTestManifest` adds `adultAgeTicks: 100, elderAgeTicks: 400, senescenceHpDrain: 5, reproEnergyMin: 600, reproEnergyCost: 200, reproCooldownTicks: 150, birthChancePpm: 100_000, maxPopulation: 40, childStartHp: 600, childStartEnergy: 600`; `makeTestRoster` adds `deliberationEpsilon: 60` to every policy and `beliefs: []` to every entry. Export `makeTestBelief(overrides?)`:

```typescript
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
```

- [ ] **Step 1: Write the failing tests**

`tests/schema-genome.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { BeliefS, PolicyS, RosterEntryS, WorldManifestS, SCHEMA_VERSION, EFFECT_TARGETS } from "../src/schema/core.js";
import { CanonicalActionEventS, SemanticEventS } from "../src/schema/log.js";
import { makeTestManifest, makeTestRoster, makeTestBelief } from "./helpers.js";

describe("genome schemas", () => {
  it("schema version bumped", () => {
    expect(SCHEMA_VERSION).toBe("phase1a-v1");
  });
  it("belief validates and rejects out-of-range modifiers", () => {
    BeliefS.parse(makeTestBelief());
    expect(() => BeliefS.parse(makeTestBelief({ effect: { target: "w:forage", modifier: 400, condition: null } }))).toThrow();
    expect(() => BeliefS.parse(makeTestBelief({ effect: { target: "w:hoard" as never, modifier: 0, condition: null } }))).toThrow();
  });
  it("policy requires deliberationEpsilon", () => {
    const p = makeTestRoster(1)[0]!.policy;
    expect(PolicyS.parse(p).deliberationEpsilon).toBe(60);
    const { deliberationEpsilon: _e, ...rest } = p;
    expect(() => PolicyS.parse(rest)).toThrow();
  });
  it("roster entries carry beliefs; manifest carries reproduction params", () => {
    RosterEntryS.parse({ ...makeTestRoster(1)[0]!, beliefs: [makeTestBelief()] });
    const m = WorldManifestS.parse(makeTestManifest());
    expect(m.maxPopulation).toBe(40);
    expect(m.birthChancePpm).toBe(100_000);
  });
  it("log accepts resolver actionSource and birth/belief_formed events", () => {
    CanonicalActionEventS.parse({
      eventId: "1:npc-1", tick: 1, npcId: "npc-1", observationHash: "a".repeat(64),
      action: { verb: "idle" }, actionSource: "resolver",
      deliberationTriggered: false, energyCharged: 0, previousEventHash: null,
    });
    SemanticEventS.parse({ tick: 5, kind: "birth", npcId: "child-5-0", data: { generation: 1 } });
    SemanticEventS.parse({ tick: 5, kind: "belief_formed", npcId: "npc-1", data: { target: "w:shelter" } });
  });
  it("EFFECT_TARGETS is the closed list", () => {
    expect(EFFECT_TARGETS).toEqual(["w:forage", "w:consume", "w:shelter", "w:explore", "w:idle", "t:hungerUrgent"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/schema-genome.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement schema changes** (as specified in Interfaces; add fields in `makeTestManifest`/`makeTestRoster`; keep every existing field untouched)

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: new tests pass. Existing suite must remain green — the added manifest/roster/policy fields flow through deep-equal tests harmlessly. (`src/cli/narrate.ts` switch will fail typecheck on the new event kinds — add minimal cases now: `birth` → `` `[tick ${event.tick}] ${who} was born (gen ${event.data["generation"]}).` ``, `belief_formed` → `` `[tick ${event.tick}] ${who} learned something (${event.data["target"]}).` ``. `src/cli/demo.ts` makeDemoRoster must add `deliberationEpsilon: vary(seedRoot, 60, 40, "w-epsilon", i)` and `beliefs: []`.)

- [ ] **Step 5: Commit**

```bash
git add src/schema src/cli/narrate.ts src/cli/demo.ts tests/helpers.ts tests/schema-genome.test.ts
git commit -m "feat: phase1a schemas - beliefs with effect coupling, epsilon, reproduction params"
```

---

### Task 2: Genome-bearing NPC state + founders

**Files:**
- Modify: `src/world/state.ts`, `src/sim/engine.ts`
- Test: `tests/state-genome.test.ts`

**Interfaces:**
- `NpcState` gains: `identity: Identity; policy: Policy; beliefs: Belief[]; birthTick: number; generation: number; lineageId: string; parents: [string, string] | null; reproCooldownUntil: number; genomeHash: string`.
- `createInitialState`: founders embed roster identity/policy/beliefs (deep-copied); `lineageId = npcId`, `generation = 0`, `parents = null`, `reproCooldownUntil = 0`; staggered adult ages: `birthTick = -(manifest.adultAgeTicks + drawInt(seedRoot, Math.max(1, manifest.elderAgeTicks - manifest.adultAgeTicks), "founder-age", npcId))` (founders start between adult and elder age); `genomeHash = hashCanonical({ identity, policy, beliefs })`.
- `npcAge(npc, tick) = tick - npc.birthTick` exported from `state.ts`.
- `src/sim/engine.ts`: replace every `rosterById` lookup with the npc's embedded `npc.identity` / `npc.policy` (delete the map and the missing-roster throw). Roster is now founders-only input.

- [ ] **Step 1: Write the failing tests**

`tests/state-genome.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createInitialState, npcAge } from "../src/world/state.js";
import { runSim } from "../src/sim/engine.js";
import { makeTestManifest, makeTestRoster, makeTestBelief } from "./helpers.js";

const manifest = makeTestManifest();

describe("genome-bearing state", () => {
  it("founders embed deep-copied genome with lineage metadata", () => {
    const roster = makeTestRoster(3);
    roster[0]!.beliefs = [makeTestBelief()];
    const s = createInitialState(manifest, roster, "seed-1");
    const n = s.npcs[0]!;
    expect(n.lineageId).toBe(n.npcId);
    expect(n.generation).toBe(0);
    expect(n.parents).toBeNull();
    expect(n.identity).toEqual(roster[0]!.identity);
    expect(n.beliefs).toEqual(roster[0]!.beliefs);
    expect(n.beliefs).not.toBe(roster[0]!.beliefs);          // deep copy, no aliasing
    expect(n.genomeHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("founders start between adult and elder age, staggered and deterministic", () => {
    const s = createInitialState(manifest, makeTestRoster(10), "seed-1");
    const ages = s.npcs.map((n) => npcAge(n, 0));
    for (const a of ages) {
      expect(a).toBeGreaterThanOrEqual(manifest.adultAgeTicks);
      expect(a).toBeLessThan(manifest.adultAgeTicks + manifest.elderAgeTicks);
    }
    expect(new Set(ages).size).toBeGreaterThan(3);
    expect(createInitialState(manifest, makeTestRoster(10), "seed-1")).toEqual(s);
  });
  it("engine runs on embedded genomes (no roster lookups) and stays deterministic", () => {
    const roster = makeTestRoster(5);
    const a = runSim(manifest, roster, "seed-1", { ticks: 200 });
    const b = runSim(manifest, roster, "seed-1", { ticks: 200 });
    expect(a.checkpoints).toEqual(b.checkpoints);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/state-genome.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** (per Interfaces; imports: `Identity, Policy, Belief` types from schema, `hashCanonical`, `drawInt` already imported in state.ts)

- [ ] **Step 4: Full suite**

Run: `npm test && npm run typecheck`
Expected: green. (Engine no longer throws on missing roster entries; nothing tested that path.)

- [ ] **Step 5: Commit**

```bash
git add src/world/state.ts src/sim/engine.ts tests/state-genome.test.ts
git commit -m "feat: genome-bearing npc state with staggered founders"
```

---

### Task 3: Belief effects into the utility layer

**Files:**
- Create: `src/mind/beliefs.ts`
- Modify: `src/sim/engine.ts`
- Test: `tests/beliefs-effect.test.ts`

**Interfaces:**

```typescript
/** Confidence-scaled, season-gated belief deltas applied to a copy of policy. Never mutates inputs. */
export function applyBeliefs(policy: Policy, beliefs: Belief[], season: "summer" | "winter"): Policy;
```

Delta per active belief (`condition === null || condition === season`): `Math.floor(effect.modifier * confidence / 1000)`; `w:*` targets add to the matching utility weight, `t:hungerUrgent` to the threshold; every result clamped to [0,1000]; `deliberationEpsilon` untouched. Engine: in the live decision path compute `const effPolicy = applyBeliefs(npc.policy, npc.beliefs, seasonAt(t, manifest))` and pass `effPolicy` to reflex + candidate scoring (reflex threshold also feels beliefs — a hoarding culture eats earlier).

- [ ] **Step 1: Write the failing tests**

`tests/beliefs-effect.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { applyBeliefs } from "../src/mind/beliefs.js";
import { makeTestRoster, makeTestBelief } from "./helpers.js";

const base = makeTestRoster(1)[0]!.policy; // forage 600

describe("applyBeliefs", () => {
  it("applies confidence-scaled deltas and clamps", () => {
    const p = applyBeliefs(base, [makeTestBelief({ effect: { target: "w:forage", modifier: 100, condition: null }, confidence: 500 })], "summer");
    expect(p.utilityWeights.forage).toBe(650);   // 600 + floor(100*500/1000)
    const q = applyBeliefs(base, [makeTestBelief({ effect: { target: "w:consume", modifier: 300, condition: null }, confidence: 1000 })], "summer");
    expect(q.utilityWeights.consume).toBe(1000); // 800+300 clamped
  });
  it("season condition gates the effect", () => {
    const b = makeTestBelief({ effect: { target: "w:shelter", modifier: 200, condition: "winter" }, confidence: 1000 });
    expect(applyBeliefs(base, [b], "summer").utilityWeights.shelter).toBe(base.utilityWeights.shelter);
    expect(applyBeliefs(base, [b], "winter").utilityWeights.shelter).toBe(base.utilityWeights.shelter + 200);
  });
  it("threshold target works and inputs are not mutated", () => {
    const b = makeTestBelief({ effect: { target: "t:hungerUrgent", modifier: 100, condition: null }, confidence: 1000 });
    const before = JSON.stringify(base);
    const p = applyBeliefs(base, [b], "summer");
    expect(p.thresholds.hungerUrgent).toBe(base.thresholds.hungerUrgent + 100);
    expect(JSON.stringify(base)).toBe(before);
    expect(p.deliberationEpsilon).toBe(base.deliberationEpsilon);
  });
  it("multiple beliefs stack", () => {
    const bs = [
      makeTestBelief({ effect: { target: "w:forage", modifier: 100, condition: null }, confidence: 1000 }),
      makeTestBelief({ effect: { target: "w:forage", modifier: -50, condition: null }, confidence: 1000 }),
    ];
    expect(applyBeliefs(base, bs, "summer").utilityWeights.forage).toBe(650);
  });
});
```

- [ ] **Step 2: Verify fail** — `npx vitest run tests/beliefs-effect.test.ts`

- [ ] **Step 3: Implement** `src/mind/beliefs.ts` and wire `effPolicy` into the engine's live path (reflex + scoring). Injected/replay path unaffected (actions come from the log).

- [ ] **Step 4: Full suite** — `npm test && npm run typecheck` (existing tests use `beliefs: []` → effPolicy === policy, no behavioral drift).

- [ ] **Step 5: Commit**

```bash
git add src/mind/beliefs.ts src/sim/engine.ts tests/beliefs-effect.test.ts
git commit -m "feat: cultural belief effects applied to utility weights and thresholds"
```

---

### Task 4: Resolver — personality-weighted hesitation-band tie-break

**Files:**
- Create: `src/mind/resolver.ts`
- Modify: `src/sim/engine.ts`, `tests/candidates.test.ts`
- Test: `tests/resolver.test.ts`

**Interfaces:**

```typescript
export const RESOLVER_BASE_WEIGHT = 100;
/** Personality affinity per candidate key (documented mapping, ints 0..1000). */
export function affinity(key: UtilityKey, identity: Identity): number;
// consume: 1000 - patience   (impatient eat now)
// forage:  patience          (patient gatherers)
// shelter: 1000 - riskTolerance (cautious seek walls)
// explore: explorationBias
// idle:    floor(patience / 2)
export interface Resolution { action: Action; key: UtilityKey; source: "utility" | "resolver" }
export function resolve(
  candidates: ScoredCandidate[], identity: Identity, epsilon: number,
  seedRoot: string, npcId: string, tick: number,
): Resolution;
```

`resolve`: `best = pickBest(candidates)`; band = candidates with `score >= best.score - epsilon` (band always contains best). If `epsilon === 0` or band has 1 member → `{ ...best, source: "utility" }`. Else weighted draw: each band member weight `RESOLVER_BASE_WEIGHT + affinity(key, identity)`; `r = drawInt(seedRoot, totalWeight, "resolver", npcId, tick)`; walk the band **in candidate generation order** subtracting weights → `source: "resolver"`. Engine live path replaces `pickBest` with `resolve(cands, npc.identity, npc.policy.deliberationEpsilon, seedRoot, npc.npcId, t)` and uses `resolution.source` as `actionSource`. `DecideInfo.candidates` stays non-null for both utility and resolver decisions. **Amend `tests/candidates.test.ts`**: the hook test's assertion becomes `if (actionSource === "utility" || actionSource === "resolver") expect non-null candidates; else null` (reflex).

- [ ] **Step 1: Write the failing tests**

`tests/resolver.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolve, affinity, RESOLVER_BASE_WEIGHT } from "../src/mind/resolver.js";
import { pickBest, type ScoredCandidate } from "../src/mind/utility.js";
import { runSim } from "../src/sim/engine.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const identity = makeTestRoster(1)[0]!.identity;
const cands: ScoredCandidate[] = [
  { key: "consume", score: 500, action: { verb: "consume" } },
  { key: "forage", score: 480, action: { verb: "take", target: "bush-1" } },
  { key: "idle", score: 100, action: { verb: "idle" } },
];

describe("resolver", () => {
  it("epsilon 0 reproduces exact argmax with source utility", () => {
    const r = resolve(cands, identity, 0, "s", "npc-1", 10);
    expect(r).toEqual({ ...{ action: pickBest(cands).action, key: pickBest(cands).key }, source: "utility" });
  });
  it("band of one → utility even with large epsilon", () => {
    const solo = [cands[0]!, cands[2]!]; // gap 400 > epsilon 60
    expect(resolve(solo, identity, 60, "s", "npc-1", 10).source).toBe("utility");
  });
  it("hesitation band → deterministic resolver draw from band members only", () => {
    const a = resolve(cands, identity, 60, "s", "npc-1", 10);
    const b = resolve(cands, identity, 60, "s", "npc-1", 10);
    expect(a).toEqual(b);
    expect(a.source).toBe("resolver");
    expect(["consume", "forage"]).toContain(a.key);          // idle (100) is outside the band
  });
  it("different personalities shift the distribution across many draws", () => {
    const patient = { ...identity, patience: 950 };
    const impatient = { ...identity, patience: 50 };
    let patientForage = 0, impatientForage = 0;
    for (let t = 0; t < 300; t++) {
      if (resolve(cands, patient, 60, "s", "npc-1", t).key === "forage") patientForage++;
      if (resolve(cands, impatient, 60, "s", "npc-1", t).key === "forage") impatientForage++;
    }
    expect(patientForage).toBeGreaterThan(impatientForage + 30);
  });
  it("affinity mapping matches the documented table", () => {
    expect(affinity("consume", identity)).toBe(1000 - identity.patience);
    expect(affinity("forage", identity)).toBe(identity.patience);
    expect(affinity("shelter", identity)).toBe(1000 - identity.riskTolerance);
    expect(affinity("explore", identity)).toBe(identity.explorationBias);
    expect(affinity("idle", identity)).toBe(Math.floor(identity.patience / 2));
    expect(RESOLVER_BASE_WEIGHT).toBe(100);
  });
  it("engine emits resolver actionSource and stays deterministic", () => {
    const manifest = makeTestManifest();
    const roster = makeTestRoster(5); // epsilon 60
    const a = runSim(manifest, roster, "seed-1", { ticks: 300 });
    const b = runSim(manifest, roster, "seed-1", { ticks: 300 });
    expect(a.checkpoints).toEqual(b.checkpoints);
    expect(a.actionLog.some((e) => e.actionSource === "resolver")).toBe(true);
  });
});
```

- [ ] **Step 2: Verify fail** — `npx vitest run tests/resolver.test.ts`

- [ ] **Step 3: Implement** `src/mind/resolver.ts`, wire into engine, amend `tests/candidates.test.ts` as specified.

- [ ] **Step 4: Full suite** — `npm test && npm run typecheck`. Note: with epsilon 60 in the test roster, checkpoint hashes of pre-existing engine tests change values but the tests only compare run-vs-run, so they stay green. The kernel golden invariants (no cross-run constants) were designed for this.

- [ ] **Step 5: Commit**

```bash
git add src/mind/resolver.ts src/sim/engine.ts tests/resolver.test.ts tests/candidates.test.ts
git commit -m "feat: resolver - personality-weighted deterministic tie-break in epsilon band (B0)"
```

---

### Task 5: Genome breeding — crossover + mutation

**Files:**
- Create: `src/life/genome.ts`
- Test: `tests/genome.test.ts`

**Interfaces:**

```typescript
export interface NpcGenome {
  lineageId: string;
  generation: number;
  identity: Identity;
  policy: Policy;
  beliefs: Belief[];
}
// Named constants (Global Constraints):
export const IDENTITY_MUT_PPM = 100_000;   // 10% per field
export const IDENTITY_JITTER = 60;
export const POLICY_MUT_PPM = 250_000;     // 25% per key
export const POLICY_JITTER = 120;
export const EPSILON_JITTER = 40;
export const CULT_INHERIT_MAX = 8;
export const CULT_POOL_MAX = 12;
export const CULT_INHERIT_SCALE = 800;     // inherit chance ≈ confidence*0.8
export const CULT_CONF_SCALE = 700;        // inherited confidence ≈ 70%
export const MISREMEMBER_PPM_MOD = 150_000;
export const MISREMEMBER_PPM_COND = 50_000;
export const MISREMEMBER_JITTER = 60;

export function breed(parentA: NpcGenome, parentB: NpcGenome, childKey: string, seedRoot: string, tick: number): NpcGenome;
```

Rules — every draw keyed `drawInt(seedRoot, n, "breed", childKey, <field-or-step>, ...)`:
- **Identity** per numeric field (riskTolerance/socialTrust/explorationBias/patience): parent pick via `drawInt(...,2)`; mutation roll `drawInt(...,1_000_000) < IDENTITY_MUT_PPM` → add `drawInt(...,2*IDENTITY_JITTER+1) - IDENTITY_JITTER`, clamp [0,1000]. `voiceStyle: ""` (expression layer later).
- **Policy** per utility-weight key and per threshold key: same pattern with POLICY constants; `deliberationEpsilon`: parent pick + POLICY_MUT_PPM roll with EPSILON_JITTER. Closed key set — never add/remove keys.
- **Cultural inheritance** (Lamarckian, from parents' *current* beliefs): pool = A's beliefs tagged source `parentA` + B's tagged `parentB`; sort by (confidence desc, proposition asc); truncate to CULT_POOL_MAX; for pool index i: inherit if `drawInt(...,1000,"cult",childKey,i) < Math.floor(b.confidence * CULT_INHERIT_SCALE / 1000)`; inherited belief: `confidence = Math.floor(b.confidence * CULT_CONF_SCALE / 1000)`, `acquiredTick = tick`; misremember: MISREMEMBER_PPM_MOD roll → modifier += jitter(±MISREMEMBER_JITTER) clamp [-300,300]; MISREMEMBER_PPM_COND roll → condition cycles null→"winter"→"summer"→null. Stop at CULT_INHERIT_MAX; drop any inherited belief with confidence < 100.
- `lineageId = parentA.lineageId`; `generation = Math.max(gA, gB) + 1`.
- Pure function; never mutates parents; result passes zod (`IdentityS`/`PolicyS`/`BeliefS`).

- [ ] **Step 1: Write the failing tests**

`tests/genome.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { breed, type NpcGenome } from "../src/life/genome.js";
import { IdentityS, PolicyS, BeliefS } from "../src/schema/core.js";
import { makeTestRoster, makeTestBelief } from "./helpers.js";

function genome(i: number, beliefs = [] as ReturnType<typeof makeTestBelief>[]): NpcGenome {
  const r = makeTestRoster(5)[i]!;
  return { lineageId: r.npcId, generation: 0, identity: r.identity, policy: r.policy, beliefs };
}

describe("breed", () => {
  const A = genome(0, [makeTestBelief({ confidence: 900 }), makeTestBelief({ proposition: "walls save lives", effect: { target: "w:shelter", modifier: 150, condition: "winter" }, confidence: 700 })]);
  const B = genome(1, [makeTestBelief({ proposition: "wander far", effect: { target: "w:explore", modifier: 120, condition: null }, confidence: 800 })]);

  it("is deterministic and pure", () => {
    const snapshot = JSON.stringify([A, B]);
    const c1 = breed(A, B, "child-1", "seed-1", 500);
    const c2 = breed(A, B, "child-1", "seed-1", 500);
    expect(c1).toEqual(c2);
    expect(JSON.stringify([A, B])).toBe(snapshot);
  });
  it("child validates against schemas with bounded values", () => {
    const c = breed(A, B, "child-1", "seed-1", 500);
    IdentityS.parse(c.identity);
    PolicyS.parse(c.policy);
    for (const b of c.beliefs) BeliefS.parse(b);
    expect(c.beliefs.length).toBeLessThanOrEqual(8);
  });
  it("lineage from parentA, generation max+1", () => {
    const c = breed(A, { ...B, generation: 3 }, "child-1", "seed-1", 500);
    expect(c.lineageId).toBe(A.lineageId);
    expect(c.generation).toBe(4);
  });
  it("different childKey → different child (mutation/crossover varies)", () => {
    const kids = Array.from({ length: 20 }, (_, k) => breed(A, B, `child-${k}`, "seed-1", 500));
    const distinct = new Set(kids.map((c) => JSON.stringify(c.policy.utilityWeights)));
    expect(distinct.size).toBeGreaterThan(3);
  });
  it("inherited beliefs are re-tagged, discounted, and stamped", () => {
    const c = breed(A, B, "child-2", "seed-1", 777);
    for (const b of c.beliefs) {
      expect(["parentA", "parentB"]).toContain(b.source);
      expect(b.acquiredTick).toBe(777);
      expect(b.confidence).toBeLessThan(900);   // discounted from any parent original
    }
  });
  it("crossover draws from both parents across many children", () => {
    // parents with maximally distinct forage weights
    const hi = { ...A, policy: { ...A.policy, utilityWeights: { ...A.policy.utilityWeights, forage: 1000 } } };
    const lo = { ...B, policy: { ...B.policy, utilityWeights: { ...B.policy.utilityWeights, forage: 0 } } };
    const kids = Array.from({ length: 30 }, (_, k) => breed(hi, lo, `c${k}`, "seed-1", 1).policy.utilityWeights.forage);
    expect(kids.some((f) => f > 700)).toBe(true);
    expect(kids.some((f) => f < 300)).toBe(true);
  });
});
```

- [ ] **Step 2: Verify fail** — `npx vitest run tests/genome.test.ts`

- [ ] **Step 3: Implement** `src/life/genome.ts` per rules above.

- [ ] **Step 4: Full suite** — `npm test && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/life tests/genome.test.ts
git commit -m "feat: genome breeding - per-key crossover, bounded mutation, lamarckian belief sampling"
```

---

### Task 6: Belief runtime dynamics — decay + event-driven formation

**Files:**
- Modify: `src/mind/beliefs.ts`
- Test: `tests/beliefs-dynamics.test.ts`

**Interfaces:**

```typescript
export const BELIEF_CAP = 16;
export const BELIEF_FLOOR = 100;            // below → forgotten
export const REINFORCE_STEP = 150;
/** In-place decay every 100 ticks: confidence -= decayPer100; drop below floor. */
export function decayBeliefs(npc: NpcState, tick: number): void;
/** Event-driven formation for THIS tick's semantic events. Emits belief_formed events. */
export function beliefFormationStep(state: WorldState, events: SemanticEvent[], tickEvents: SemanticEvent[]): void;
```

Formation rules (deterministic, keyed off `tickEvents` — the slice of events emitted this tick; `events` is the global array to append `belief_formed` to):
1. `wolf_attack` on an alive NPC → reinforce-or-add `{ proposition: "the wolf is death; walls are life", effect: { target: "w:shelter", modifier: 80, condition: null }, confidence: 600, source: "observed", decayPer100: 20 }`.
2. `starving` on an NPC with `hp < 500` → reinforce-or-add `{ proposition: "hunger comes fast; gather while you can", effect: { target: "w:forage", modifier: 100, condition: null }, confidence: 600, source: "observed", decayPer100: 25 }`.
3. `season_change` to `"summer"` → every alive NPC with `hp < 500` reinforce-or-add `{ proposition: "winter nearly killed me", effect: { target: "w:shelter", modifier: 60, condition: "winter" }, confidence: 500, source: "observed", decayPer100: 30 }`.

Reinforce-or-add: an existing belief with same `effect.target` and same modifier sign → `confidence = Math.min(1000, confidence + REINFORCE_STEP)` (no new belief, no event); else push new belief with `acquiredTick = state.tick` and emit `belief_formed` `{ npcId, data: { target, proposition } }`. At BELIEF_CAP, drop the lowest-confidence belief (tie: earliest in array) before pushing.

- [ ] **Step 1: Write the failing tests**

`tests/beliefs-dynamics.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { decayBeliefs, beliefFormationStep, BELIEF_CAP, BELIEF_FLOOR, REINFORCE_STEP } from "../src/mind/beliefs.js";
import { createInitialState } from "../src/world/state.js";
import { makeTestManifest, makeTestRoster, makeTestBelief } from "./helpers.js";
import type { SemanticEvent } from "../src/schema/log.js";

const manifest = makeTestManifest();

function fresh() {
  const s = createInitialState(manifest, makeTestRoster(2), "seed-1");
  return { s, npc: s.npcs[0]! };
}

describe("belief dynamics", () => {
  it("decays only on century ticks and forgets below the floor", () => {
    const { npc } = fresh();
    npc.beliefs = [makeTestBelief({ confidence: 500, decayPer100: 30 }), makeTestBelief({ proposition: "x", confidence: BELIEF_FLOOR + 10, decayPer100: 30 })];
    decayBeliefs(npc, 150);                       // not a century tick
    expect(npc.beliefs[0]!.confidence).toBe(500);
    decayBeliefs(npc, 200);
    expect(npc.beliefs[0]!.confidence).toBe(470);
    expect(npc.beliefs.length).toBe(1);           // second dropped below floor
  });
  it("wolf attack forms a shelter belief and emits belief_formed", () => {
    const { s, npc } = fresh();
    s.tick = 50;
    const tickEvents: SemanticEvent[] = [{ tick: 50, kind: "wolf_attack", npcId: npc.npcId, data: { damage: 50 } }];
    const events: SemanticEvent[] = [];
    beliefFormationStep(s, events, tickEvents);
    expect(npc.beliefs.some((b) => b.effect.target === "w:shelter")).toBe(true);
    expect(events.some((e) => e.kind === "belief_formed" && e.npcId === npc.npcId)).toBe(true);
  });
  it("repeat experience reinforces instead of duplicating", () => {
    const { s, npc } = fresh();
    s.tick = 50;
    const ev: SemanticEvent[] = [];
    const hit: SemanticEvent[] = [{ tick: 50, kind: "wolf_attack", npcId: npc.npcId, data: { damage: 50 } }];
    beliefFormationStep(s, ev, hit);
    const confAfterFirst = npc.beliefs[0]!.confidence;
    beliefFormationStep(s, ev, hit);
    expect(npc.beliefs.length).toBe(1);
    expect(npc.beliefs[0]!.confidence).toBe(Math.min(1000, confAfterFirst + REINFORCE_STEP));
  });
  it("cap evicts the weakest belief", () => {
    const { s, npc } = fresh();
    s.tick = 50;
    npc.beliefs = Array.from({ length: BELIEF_CAP }, (_, i) =>
      makeTestBelief({ proposition: `b${i}`, effect: { target: "w:explore", modifier: -50, condition: null }, confidence: 200 + i }),
    );
    beliefFormationStep(s, [], [{ tick: 50, kind: "wolf_attack", npcId: npc.npcId, data: { damage: 50 } }]);
    expect(npc.beliefs.length).toBe(BELIEF_CAP);
    expect(npc.beliefs.some((b) => b.proposition === "b0")).toBe(false);   // weakest evicted
    expect(npc.beliefs.some((b) => b.effect.target === "w:shelter")).toBe(true);
  });
  it("hard winter forms a conditional shelter belief on survivors", () => {
    const { s, npc } = fresh();
    s.tick = 200;
    npc.hp = 400;
    beliefFormationStep(s, [], [{ tick: 200, kind: "season_change", npcId: null, data: { season: "summer" } }]);
    const b = npc.beliefs.find((x) => x.effect.condition === "winter");
    expect(b).toBeDefined();
    expect(s.npcs[1]!.beliefs.length).toBe(0);    // healthy npc (hp 1000) unaffected
  });
});
```

- [ ] **Step 2: Verify fail** — `npx vitest run tests/beliefs-dynamics.test.ts`

- [ ] **Step 3: Implement** in `src/mind/beliefs.ts` (append to Task 3's module).

- [ ] **Step 4: Full suite** — `npm test && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/mind/beliefs.ts tests/beliefs-dynamics.test.ts
git commit -m "feat: belief decay and event-driven formation with reinforcement"
```

---

### Task 7: Aging, senescence, starving-event dedupe

**Files:**
- Modify: `src/world/rules.ts`
- Test: `tests/aging.test.ts`

**Interfaces:** in `needsStep`:
- After the existing drains, before regen: `if (npcAge(npc, state.tick) > manifest.elderAgeTicks) { npc.hp -= manifest.senescenceHpDrain; npc.lastDamage = "old_age"; }`
- Starving event dedupe: emit `starving` only on the transition into starvation (energy was > 0 before this tick's drain and is 0 after). Starvation hp drain still applies every starving tick — only the *event* is deduplicated.
- Death path unchanged (cause comes from `lastDamage`, so elders die of `"old_age"` unless something else hit them last).

- [ ] **Step 1: Write the failing tests**

`tests/aging.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { needsStep } from "../src/world/rules.js";
import { createInitialState } from "../src/world/state.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import type { SemanticEvent } from "../src/schema/log.js";

const manifest = makeTestManifest(); // elderAgeTicks 400, senescenceHpDrain 5

describe("aging", () => {
  it("elders take senescence damage and die of old_age", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    npc.birthTick = -1000;            // age 1000+ → elder
    npc.energy = 1000;
    s.tick = 1;
    const ev: SemanticEvent[] = [];
    needsStep(s, manifest, ev);
    expect(npc.hp).toBe(1000 - 5 + 1); // senescence 5, regen 1
    expect(npc.lastDamage).toBe("old_age");
    npc.hp = 3;
    needsStep(s, manifest, ev);
    expect(npc.alive).toBe(false);
    expect(npc.deathCause).toBe("old_age");
  });
  it("adults below elder age are untouched by senescence", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    npc.birthTick = 0;
    s.tick = manifest.elderAgeTicks;   // age == elder → not yet (strict >)
    npc.energy = 1000;
    needsStep(s, manifest, []);
    expect(npc.hp).toBe(1000);
  });
  it("starving event fires only on the transition into starvation", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    npc.birthTick = 0;
    npc.energy = 1;
    const ev: SemanticEvent[] = [];
    s.tick = 1;
    needsStep(s, manifest, ev);       // 1 → 0: transition, event
    s.tick = 2;
    needsStep(s, manifest, ev);       // stays 0: no event, hp still drains
    expect(ev.filter((e) => e.kind === "starving").length).toBe(1);
    expect(npc.hp).toBeLessThan(1000 - manifest.starvationHpDrain);
  });
});
```

- [ ] **Step 2: Verify fail** — `npx vitest run tests/aging.test.ts`

- [ ] **Step 3: Implement.** Note: `tests/rules.test.ts` sets `npc.energy = 1` then expects a starving event — the transition rule preserves that (1 → 0 is a transition). Founders in older tests have staggered adult ages below `elderAgeTicks` at the low ticks those tests run, so no senescence leaks in; verify by running the suite.

- [ ] **Step 4: Full suite** — `npm test && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/world/rules.ts tests/aging.test.ts
git commit -m "feat: aging with senescence death and starving-event dedupe"
```

---

### Task 8: Reproduction step — pairing, births, population cap

**Files:**
- Modify: `src/world/rules.ts`
- Test: `tests/reproduction.test.ts`

**Interfaces:**

```typescript
export const NAME_POOL: readonly string[];   // reuse the 25 demo names, exported here or imported from a shared module
export function reproductionStep(state: WorldState, manifest: WorldManifest, seedRoot: string, events: SemanticEvent[]): void;
```

Rules (all deterministic, npc-list order):
- Eligible: alive, `adultAgeTicks <= age <= elderAgeTicks`, `energy >= reproEnergyMin`, `tick >= reproCooldownUntil`.
- Pair scan: iterate `state.npcs` in order; each NPC pairs at most once per tick; for eligible unpaired `a`, find the first later eligible unpaired `b` with `chebyshev(a.pos, b.pos) <= 1`.
- Population guard: skip all births once `state.npcs.filter(alive).length >= maxPopulation` (checked per birth, so a tick can fill the last slot then stop).
- Chance: `drawInt(seedRoot, 1_000_000, "repro", a.npcId, b.npcId, tick) < birthChancePpm`.
- On birth: both parents `energy -= reproEnergyCost`, `reproCooldownUntil = tick + reproCooldownTicks`; `birthIdx` counts births this tick (0-based); child:
  - `npcId = \`child-${tick}-${birthIdx}\``, `name = NAME_POOL[drawInt(seedRoot, NAME_POOL.length, "childname", npcId)]`
  - genome = `breed(genomeOf(a), genomeOf(b), npcId, seedRoot, tick)` where `genomeOf` lifts the npc's embedded fields; child NpcState: `pos = {...a.pos}`, `hp = childStartHp`, `energy = childStartEnergy`, `berries = 0`, alive, `birthTick = tick`, `reproCooldownUntil = tick + reproCooldownTicks` (no instant maturity anyway), `genomeHash = hashCanonical({identity, policy, beliefs})`, lineage/generation/parents from breed + `[a.npcId, b.npcId]`.
  - push to `state.npcs`; emit `birth` event `{ npcId: child.npcId, data: { generation, lineageId, parentA: a.npcId, parentB: b.npcId } }`.

- [ ] **Step 1: Write the failing tests**

`tests/reproduction.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { reproductionStep } from "../src/world/rules.js";
import { createInitialState } from "../src/world/state.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import type { SemanticEvent } from "../src/schema/log.js";

const manifest = makeTestManifest(); // birthChancePpm 100_000 (10%)

function eligiblePair() {
  const s = createInitialState(manifest, makeTestRoster(2), "seed-1");
  for (const n of s.npcs) { n.pos = { x: 5, y: 5 }; n.energy = 1000; n.birthTick = -150; n.reproCooldownUntil = 0; }
  return s;
}

describe("reproduction", () => {
  it("adjacent eligible pair eventually births; is deterministic", () => {
    const run = () => {
      const s = eligiblePair();
      const ev: SemanticEvent[] = [];
      for (let t = 1; t <= 200; t++) {
        s.tick = t;
        for (const n of s.npcs) { n.energy = 1000; }   // keep eligible; cooldown still gates
        reproductionStep(s, manifest, "seed-1", ev);
      }
      return { pop: s.npcs.length, births: ev.filter((e) => e.kind === "birth").length, s };
    };
    const a = run(); const b = run();
    expect(a.births).toBeGreaterThan(0);
    expect(a.births).toBe(b.births);
    expect(a.pop).toBe(2 + a.births);
  });
  it("birth costs energy and sets cooldown on both parents", () => {
    const s = eligiblePair();
    const ev: SemanticEvent[] = [];
    let t = 0;
    while (ev.length === 0 && t < 500) { s.tick = ++t; s.npcs[0]!.energy = 1000; s.npcs[1]!.energy = 1000; reproductionStep(s, manifest, "seed-1", ev); }
    expect(ev.length).toBeGreaterThan(0);
    const [a, b] = [s.npcs[0]!, s.npcs[1]!];
    expect(a.energy).toBe(1000 - manifest.reproEnergyCost);
    expect(b.energy).toBe(1000 - manifest.reproEnergyCost);
    expect(a.reproCooldownUntil).toBe(t + manifest.reproCooldownTicks);
  });
  it("child carries bred genome, lineage and parents", () => {
    const s = eligiblePair();
    const ev: SemanticEvent[] = [];
    let t = 0;
    while (ev.length === 0 && t < 500) { s.tick = ++t; s.npcs[0]!.energy = 1000; s.npcs[1]!.energy = 1000; reproductionStep(s, manifest, "seed-1", ev); }
    const child = s.npcs[2]!;
    expect(child.npcId).toBe(`child-${t}-0`);
    expect(child.generation).toBe(1);
    expect(child.parents).toEqual([s.npcs[0]!.npcId, s.npcs[1]!.npcId]);
    expect(child.hp).toBe(manifest.childStartHp);
    expect(child.birthTick).toBe(t);
    expect(child.genomeHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("ineligible npcs never breed: age, energy, cooldown, distance", () => {
    const cases: ((s: ReturnType<typeof eligiblePair>) => void)[] = [
      (s) => { s.npcs[0]!.birthTick = 0; },                        // too young at tick 1
      (s) => { s.npcs[0]!.energy = manifest.reproEnergyMin - 1; },
      (s) => { s.npcs[0]!.reproCooldownUntil = 10_000; },
      (s) => { s.npcs[0]!.pos = { x: 0, y: 0 }; },
    ];
    for (const mutate of cases) {
      const s = eligiblePair();
      mutate(s);
      const ev: SemanticEvent[] = [];
      for (let t = 1; t <= 300; t++) { s.tick = t; reproductionStep(s, manifest, "seed-1", ev); }
      expect(ev.length).toBe(0);
    }
  });
  it("population cap blocks births", () => {
    const s = eligiblePair();
    const filler = createInitialState(makeTestManifest({ maxPopulation: 400 }), makeTestRoster(2), "x");
    while (s.npcs.length < manifest.maxPopulation) {
      s.npcs.push({ ...filler.npcs[0]!, npcId: `pad-${s.npcs.length}`, pos: { x: 0, y: 0 } });
    }
    const ev: SemanticEvent[] = [];
    for (let t = 1; t <= 300; t++) { s.tick = t; s.npcs[0]!.energy = 1000; s.npcs[1]!.energy = 1000; reproductionStep(s, manifest, "seed-1", ev); }
    expect(ev.filter((e) => e.kind === "birth").length).toBe(0);
  });
});
```

- [ ] **Step 2: Verify fail** — `npx vitest run tests/reproduction.test.ts`

- [ ] **Step 3: Implement** `reproductionStep` in `src/world/rules.ts` (import `breed` from `../life/genome.js`, `hashCanonical`, `npcAge`). `NAME_POOL`: move the 25-name array from `src/cli/demo.ts` into `src/world/rules.ts` export (or a tiny `src/life/names.ts`) and re-import in demo.ts — single source.

- [ ] **Step 4: Full suite** — `npm test && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/world/rules.ts src/life src/cli/demo.ts tests/reproduction.test.ts
git commit -m "feat: in-world reproduction - deterministic pairing, births, population cap"
```

---

### Task 9: Engine integration — full generational tick loop

**Files:**
- Modify: `src/sim/engine.ts`
- Test: `tests/engine-evolution.test.ts`

**Interfaces:**
- Tick sequence becomes: season event → `state.tick = t` → `environmentStep` → decision loop (iterate over a **snapshot** `const actors = [...state.npcs]` so newborns never act on their birth tick) → `needsStep` → per-npc `decayBeliefs(npc, t)` + `beliefFormationStep(state, events, eventsThisTick)` (`eventsThisTick` = events sliced from the index recorded at tick start) → `reproductionStep` → checkpoint/tickHash.
- `RunOptions` gains `retainActionLog?: boolean` (default true): when false, the engine still computes `observationHash` and the hash chain (cheap, keeps eventIds/injection semantics identical) but does NOT push entries into `actionLog` (long-run memory guard).
- Replay of runs with births: injection keys `${tick}:${npcId}` work for children because ids are deterministic.

- [ ] **Step 1: Write the failing tests**

`tests/engine-evolution.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runSim } from "../src/sim/engine.js";
import { replayRun, verifyReplay } from "../src/replay/replay.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

// generous food so pairs form: dense bushes, fast regrowth
const manifest = makeTestManifest({
  berryRegrowPpmSummer: 300_000,
  berryRegrowPpmWinter: 100_000,
  bushes: Array.from({ length: 6 }, (_, i) => ({ id: `bush-${i + 1}`, pos: { x: 4 + 2 * i % 12, y: 4 + Math.floor(i / 2) * 3 }, capacity: 5 })),
});
const roster = makeTestRoster(8);

describe("generational engine", () => {
  const r = runSim(manifest, roster, "evo-seed", { ticks: 2000 });

  it("births happen and newborns act only after their birth tick", () => {
    const births = r.events.filter((e) => e.kind === "birth");
    expect(births.length).toBeGreaterThan(0);
    for (const b of births) {
      const firstAction = r.actionLog.find((e) => e.npcId === b.npcId);
      if (firstAction !== undefined) expect(firstAction.tick).toBeGreaterThan(b.tick);
    }
  });
  it("full determinism with reproduction, beliefs, aging", () => {
    const r2 = runSim(manifest, roster, "evo-seed", { ticks: 2000 });
    expect(hashCanonical(r2.finalState)).toBe(hashCanonical(r.finalState));
    expect(r2.checkpoints).toEqual(r.checkpoints);
  });
  it("replay reproduces a run containing births", () => {
    const replayed = replayRun(manifest, roster, "evo-seed", r.actionLog, 2000);
    expect(hashCanonical(replayed.finalState)).toBe(hashCanonical(r.finalState));
    const report = verifyReplay(manifest, roster, "evo-seed", r.actionLog, r.checkpoints, 2000);
    expect(report.ok).toBe(true);
  });
  it("beliefs form during life", () => {
    expect(r.events.some((e) => e.kind === "belief_formed")).toBe(true);
  });
  it("retainActionLog:false keeps identical world outcomes with an empty log", () => {
    const lean = runSim(manifest, roster, "evo-seed", { ticks: 2000, retainActionLog: false });
    expect(hashCanonical(lean.finalState)).toBe(hashCanonical(r.finalState));
    expect(lean.checkpoints).toEqual(r.checkpoints);
    expect(lean.actionLog.length).toBe(0);
  });
});
```

- [ ] **Step 2: Verify fail** — `npx vitest run tests/engine-evolution.test.ts`

- [ ] **Step 3: Implement** the tick-sequence changes. Record `const evStart = events.length` at tick start; `eventsThisTick = events.slice(evStart)` before `beliefFormationStep`. Careful: `beliefFormationStep` appends `belief_formed` to `events` — pass the slice, not the live tail.

- [ ] **Step 4: Full suite** — `npm test && npm run typecheck`. If the pre-existing 25-NPC smoke test in `tests/engine.test.ts` now sees births (test manifest birthChance 10%), its invariants (bounds, chain, dead-stop-acting) still hold by construction — verify, don't assume.

- [ ] **Step 5: Commit**

```bash
git add src/sim/engine.ts tests/engine-evolution.test.ts
git commit -m "feat: generational tick loop - beliefs, aging, reproduction, lean-log mode"
```

---

### Task 10: Evolve CLI — long-run driver with population/diversity reporting

**Files:**
- Create: `src/cli/evolve.ts`
- Modify: `package.json` (script `"evolve": "tsx src/cli/evolve.ts"`), `src/cli/demo.ts` (demo manifest gains reproduction params: `adultAgeTicks: 800, elderAgeTicks: 2400, senescenceHpDrain: 2, reproEnergyMin: 600, reproEnergyCost: 300, reproCooldownTicks: 600, birthChancePpm: 15_000, maxPopulation: 60, childStartHp: 600, childStartEnergy: 600`)
- Test: `tests/evolve-summary.test.ts`

**Interfaces:**
- `src/cli/evolve.ts` exports (for testability) `summarizeEvolution(result: RunResult, roster: RosterEntry[]): EvolutionSummary`:

```typescript
export interface EvolutionSummary {
  finalPopulation: number;
  totalBirths: number;
  deathsByCause: Record<string, number>;
  maxGeneration: number;
  meanGenerationAlive: number;        // ×100 integer (avoid floats): floor(mean*100)
  livingLineages: number;
  extinctLineages: number;            // founders whose lineage has no living member
  beliefStats: { totalHeld: number; meanPerNpc100: number; formedEvents: number };
  weightDiversity100: number;         // floor(mean pairwise L1 distance of utilityWeights over alive NPCs * 100 / #keys) — 0 when < 2 alive
}
```

- CLI: `npm run evolve -- [--seed evo-1] [--ticks 60000] [--out runs/evolve-<seed>]` → runs demo world with `retainActionLog: false`, prints the summary + a generation histogram, writes `summary.json` and `births.jsonl` (birth events) to the out dir.

- [ ] **Step 1: Write the failing tests**

`tests/evolve-summary.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { summarizeEvolution } from "../src/cli/evolve.js";
import { runSim } from "../src/sim/engine.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest({
  berryRegrowPpmSummer: 300_000,
  berryRegrowPpmWinter: 100_000,
});
const roster = makeTestRoster(8);

describe("evolution summary", () => {
  const r = runSim(manifest, roster, "evo-seed", { ticks: 3000 });
  const s = summarizeEvolution(r, roster);

  it("counts births, deaths, generations consistently", () => {
    expect(s.totalBirths).toBe(r.events.filter((e) => e.kind === "birth").length);
    expect(s.finalPopulation).toBe(r.finalState.npcs.filter((n) => n.alive).length);
    const deaths = Object.values(s.deathsByCause).reduce((a, b) => a + b, 0);
    expect(deaths).toBe(r.events.filter((e) => e.kind === "death").length);
    expect(s.maxGeneration).toBeGreaterThanOrEqual(1);   // manifest tuned for fast breeding
  });
  it("lineage accounting partitions the founders", () => {
    expect(s.livingLineages + s.extinctLineages).toBe(roster.length);
  });
  it("diversity and belief stats are non-negative integers", () => {
    expect(Number.isSafeInteger(s.weightDiversity100)).toBe(true);
    expect(s.weightDiversity100).toBeGreaterThanOrEqual(0);
    expect(Number.isSafeInteger(s.meanGenerationAlive)).toBe(true);
    expect(s.beliefStats.formedEvents).toBe(r.events.filter((e) => e.kind === "belief_formed").length);
  });
  it("summary is deterministic", () => {
    const r2 = runSim(manifest, roster, "evo-seed", { ticks: 3000 });
    expect(summarizeEvolution(r2, roster)).toEqual(s);
  });
});
```

- [ ] **Step 2: Verify fail** — `npx vitest run tests/evolve-summary.test.ts`

- [ ] **Step 3: Implement** `src/cli/evolve.ts` (summary function + CLI main guarded by `process.argv[1]` endsWith check so importing it in tests doesn't run the CLI), update demo manifest.

- [ ] **Step 4: Full suite + smoke**

Run: `npm test && npm run typecheck`
Run: `npm run evolve -- --seed evo-smoke --ticks 20000`
Expected: prints summary (population > 0 expected but ANY outcome is data, not failure — record it); exits 0. `rm -rf runs/evolve-evo-smoke` afterwards.

- [ ] **Step 5: Commit**

```bash
git add src/cli/evolve.ts src/cli/demo.ts package.json tests/evolve-summary.test.ts
git commit -m "feat: evolve CLI - long-run generational driver with population and diversity reporting"
```

---

### Task 11: Calibration run + README + docs

**Files:**
- Create: `docs/evolve-calibration.md`
- Modify: `README.md`

- [ ] **Step 1: Full verification** — `npm test && npm run typecheck` (expect ~160+ tests green).

- [ ] **Step 2: Calibration runs.** Run `npm run evolve -- --seed evo-1 --ticks 60000` and `--seed evo-2` and `--seed evo-3`. Record for each: final population, births, deaths by cause, max generation, diversity. **Do not tune parameters in this task** — if populations explode/collapse, record it honestly in the calibration doc as the finding; parameter iteration is its own follow-up with visibility.

- [ ] **Step 3: Write `docs/evolve-calibration.md`**: table of the three runs' summaries, one paragraph of observations (population stability? generation turnover rate vs DEC-4 anchors? diversity trend?), and explicit "known unknowns" (what 17.1 step 7's 10-generation degradation check must look at).

- [ ] **Step 4: README**: add `npm run evolve` to Commands; add `docs/evolve-calibration.md` to Design docs.

- [ ] **Step 5: Commit**

```bash
git add docs/evolve-calibration.md README.md
git commit -m "docs: evolve calibration runs and README update"
```

---

## Self-Review Notes

- **Spec coverage:** §6.4 Genome layers → Tasks 1/5 (Identity/Policy/Cultural; Neural Adapter stays a disabled field — not implemented, per doc). §6.5 pipeline → Task 5+8 (crossover→mutation→belief sampling→constraint check via zod→freeze+hash; LLM polish and moderation are expression-layer/deferred per B0, documented). P2 effect coupling → Tasks 1/3. Resolver/B0 → Task 4 (epsilon evolvable via Task 5). Aging/turnover → Task 7. In-world natural selection → Task 8/9. 17.1 step 7 pre-work → Tasks 10/11. `ruleSet: StrategyRule[]` is **deliberately deferred** (no defined semantics yet; documented deviation to note in living-worlds.md when this plan ships).
- **Type consistency:** `Belief`/`EffectTarget` defined once (Task 1), consumed by 3/5/6; `NpcGenome` (Task 5) consumed by 8; `npcAge` (Task 2) consumed by 7/8; `resolve` signature matches engine call (Task 4); `retainActionLog` only touches engine + evolve CLI.
- **Determinism risks flagged for reviewers:** decision-loop snapshot vs live array; events-slice for formation step; birth ordering (npc-list scan) and per-tick birthIdx; founder age staggering keyed by npcId.
- **Honest uncertainty:** reproduction/population balance parameters are first guesses; Task 11 records outcomes without tuning. Population collapse or explosion in calibration is a *finding*, not a plan failure.
```
