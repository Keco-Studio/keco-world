# Mate-Seeking & Population Sustainability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the population-extinction finding (docs/evolve-calibration.md): the adversarial gate experiment proved births are adjacency-suppressed (eligible adjacent pairs on only ~785 of ~7000 alive ticks — no mate-seeking behavior exists). Add a `seekMate` utility candidate (fed, fertile NPCs walk toward visible fertile adults and wait adjacent), then calibrate `birthChancePpm` empirically. Success gate: 3 seeds × 60k ticks sustain population (no extinction, no cap-explosion, maxGeneration ≥ 8).

**Architecture:** `Observation` gains `visibleNpcs` (radius-limited, sorted (dist, id), with a `fertileAdult` flag) and `self.reproReady` (own age/energy/cooldown check computed at observe time — minds still see only the Observation). A new closed utility key `seekMate` scores flat-minus-distance when reproReady and a fertile adult is visible; adjacent → idle (waiting sustains adjacency so reproduction rolls accumulate). Resolver affinity for seekMate = `socialTrust` (first real use of that Identity axis). Breeding/beliefs cover the new key automatically via the closed-key loops. Then an empirical `birthChancePpm` sweep picks the sustaining value; the calibration doc is UPDATED IN PLACE (single-version policy — git owns history).

**Tech Stack:** existing kernel. No new dependencies.

## Global Constraints

- `SCHEMA_VERSION` bumps to `"phase1a-v2"` (Observation and UtilityWeights shapes change).
- `UTILITY_KEYS` becomes `["forage","consume","shelter","seekMate","explore","idle"]` — **candidate generation order** is consume→forage→shelter→seekMate→explore→idle (seekMate inserted after shelter, before explore; tie-breaks depend on this).
- `EFFECT_TARGETS` gains `"w:seekMate"`.
- Kernel determinism invariants unchanged (integers only, keyed drawInt, explicit sorts, no entropy).
- visibleNpcs excludes self and dead NPCs; fresh position copies (no state aliasing); sorted (dist asc, npcId UTF-16 asc).
- All existing tests keep passing modulo mechanical fixture updates (the new weight key in `.strict()` objects); no assertion weakening — fixture-only edits.
- Calibration (Task 5) records results honestly; if no swept parameter sustains population, STOP and report rather than inventing mechanisms not in this plan.
- Commits end with the Co-Authored-By trailer from the harness rules.

---

### Task 1: Schema + fixtures — the `seekMate` key everywhere it must exist

**Files:**
- Modify: `src/schema/core.ts`, `tests/helpers.ts`, `src/cli/demo.ts`, `src/mind/resolver.ts`, `src/bench/prompt.ts`
- Test: `tests/schema-seekmate.test.ts`

**Interfaces:**
- `core.ts`: `SCHEMA_VERSION = "phase1a-v2"`; `UTILITY_KEYS = ["forage","consume","shelter","seekMate","explore","idle"] as const`; `UtilityWeightsS` gains `seekMate: Milli`; `EFFECT_TARGETS` gains `"w:seekMate"` (append at end, before `"t:hungerUrgent"` moves? NO — keep order `["w:forage","w:consume","w:shelter","w:seekMate","w:explore","w:idle","t:hungerUrgent"]`).
- `tests/helpers.ts`: `makeTestRoster` policies gain `seekMate: 500`.
- `src/cli/demo.ts`: `makeDemoRoster` gains `seekMate: vary(seedRoot, 500, 200, "w-seekmate", i)`.
- `src/mind/resolver.ts`: `affinity("seekMate", identity)` returns `identity.socialTrust` (documented in the table comment).
- `src/bench/prompt.ts` `describeAction`: `move` branch gains `c.key === "seekMate" ? "toward a companion"`; also a direct `seekMate`-keyed idle is described as `stay close to your companion` — implement as: if `c.key === "seekMate"` and verb is `idle`, return `"stay close to your companion"` (check key before the verb switch for this case).
- `src/life/genome.ts` needs NO change if `breedUtilityWeights` iterates `UTILITY_KEYS` — VERIFY this; if it hardcodes keys, fix it to iterate `UTILITY_KEYS`.
- `src/cli/evolve.ts:60`-ish hardcodes the key list for diversity (deferred Minor M2) — fix it now to import `UTILITY_KEYS` (this task touches the key set, so the drift risk becomes real).

- [ ] **Step 1: Write the failing tests**

`tests/schema-seekmate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { UTILITY_KEYS, UtilityWeightsS, EFFECT_TARGETS, SCHEMA_VERSION } from "../src/schema/core.js";
import { affinity } from "../src/mind/resolver.js";
import { breed } from "../src/life/genome.js";
import { makeTestRoster } from "./helpers.js";

describe("seekMate key", () => {
  it("schema version and key sets updated", () => {
    expect(SCHEMA_VERSION).toBe("phase1a-v2");
    expect(UTILITY_KEYS).toEqual(["forage", "consume", "shelter", "seekMate", "explore", "idle"]);
    expect(EFFECT_TARGETS).toContain("w:seekMate");
  });
  it("weights require seekMate", () => {
    const w = makeTestRoster(1)[0]!.policy.utilityWeights;
    expect(UtilityWeightsS.parse(w).seekMate).toBe(500);
    const { seekMate: _s, ...rest } = w;
    expect(() => UtilityWeightsS.parse(rest)).toThrow();
  });
  it("resolver affinity for seekMate is socialTrust", () => {
    const id = makeTestRoster(1)[0]!.identity;
    expect(affinity("seekMate", id)).toBe(id.socialTrust);
  });
  it("breeding covers the new key", () => {
    const r = makeTestRoster(2);
    const A = { lineageId: "a", generation: 0, identity: r[0]!.identity, policy: { ...r[0]!.policy, utilityWeights: { ...r[0]!.policy.utilityWeights, seekMate: 1000 } }, beliefs: [] };
    const B = { lineageId: "b", generation: 0, identity: r[1]!.identity, policy: { ...r[1]!.policy, utilityWeights: { ...r[1]!.policy.utilityWeights, seekMate: 0 } }, beliefs: [] };
    const kids = Array.from({ length: 30 }, (_, k) => breed(A, B, `c${k}`, "s", 1).policy.utilityWeights.seekMate);
    expect(kids.some((v) => v > 700)).toBe(true);
    expect(kids.some((v) => v < 300)).toBe(true);
  });
});
```

- [ ] **Step 2: Verify fail** — `npx vitest run tests/schema-seekmate.test.ts`

- [ ] **Step 3: Implement** all file changes listed in Interfaces. Then run the full suite and mechanically add `seekMate` to any remaining `.strict()` weight fixtures the suite flags (expect a handful in bench/orchestrate/utility tests if they build policies inline — fixture-only edits, no assertion changes).

- [ ] **Step 4: Full suite** — `npm test && npm run typecheck` all green.

- [ ] **Step 5: Commit**

```bash
git add -A -- src tests
git commit -m "feat: seekMate utility key across schema, fixtures, resolver affinity, breeding"
```

---

### Task 2: Observation — visibleNpcs + self.reproReady

**Files:**
- Modify: `src/mind/observe.ts`
- Test: `tests/observe-npcs.test.ts`

**Interfaces:**

```typescript
export interface Observation {
  // ...existing fields...
  self: { npcId: string; pos: Vec2; hp: number; energy: number; berries: number; reproReady: boolean };
  visibleNpcs: { npcId: string; pos: Vec2; dist: number; fertileAdult: boolean }[];
}
```

- `visibleNpcs`: alive NPCs other than self within `manifest.visionRadius` (Chebyshev), fresh `pos` copies, `fertileAdult = adultAgeTicks <= npcAge(other, state.tick) <= elderAgeTicks`, sorted `(dist asc, npcId UTF-16 asc)`.
- `self.reproReady = adultAgeTicks <= age <= elderAgeTicks && energy >= reproEnergyMin && state.tick >= reproCooldownUntil` (matches reproductionStep's per-NPC eligibility exactly — cite `src/world/rules.ts` and keep the two in sync via a shared exported predicate `isFertileEligible(npc, manifest, tick)` in `src/world/rules.ts`, used by BOTH observe.ts and reproductionStep).

- [ ] **Step 1: Write the failing tests**

`tests/observe-npcs.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildObservation } from "../src/mind/observe.js";
import { isFertileEligible } from "../src/world/rules.js";
import { createInitialState } from "../src/world/state.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest();

describe("visibleNpcs and reproReady", () => {
  it("sees living neighbors sorted (dist, id), never self or the dead", () => {
    const s = createInitialState(manifest, makeTestRoster(4), "seed-1");
    const [a, b, c, d] = s.npcs;
    a!.pos = { x: 5, y: 5 }; b!.pos = { x: 6, y: 5 }; c!.pos = { x: 5, y: 7 }; d!.pos = { x: 15, y: 15 };
    c!.alive = false;
    const obs = buildObservation(s, manifest, a!);
    expect(obs.visibleNpcs.map((n) => n.npcId)).toEqual([b!.npcId]); // c dead, d out of radius 8? dist 10 → out
    expect(obs.visibleNpcs[0]!.dist).toBe(1);
    expect(obs.visibleNpcs[0]!.pos).not.toBe(b!.pos);               // fresh copy
  });
  it("fertileAdult flag matches the shared eligibility age window", () => {
    const s = createInitialState(manifest, makeTestRoster(2), "seed-1");
    const [a, b] = s.npcs;
    a!.pos = { x: 5, y: 5 }; b!.pos = { x: 6, y: 5 };
    b!.birthTick = s.tick;                        // age 0 → too young
    expect(buildObservation(s, manifest, a!).visibleNpcs[0]!.fertileAdult).toBe(false);
    b!.birthTick = -150;                          // age in window
    expect(buildObservation(s, manifest, a!).visibleNpcs[0]!.fertileAdult).toBe(true);
  });
  it("reproReady mirrors isFertileEligible exactly", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    for (const mutate of [
      () => { npc.energy = manifest.reproEnergyMin - 1; },
      () => { npc.energy = 1000; npc.reproCooldownUntil = 10_000; },
      () => { npc.reproCooldownUntil = 0; npc.birthTick = s.tick; },
    ]) {
      mutate();
      expect(buildObservation(s, manifest, npc).self.reproReady).toBe(isFertileEligible(npc, manifest, s.tick));
    }
  });
});
```

- [ ] **Step 2: Verify fail** — `npx vitest run tests/observe-npcs.test.ts`

- [ ] **Step 3: Implement**: extract `isFertileEligible` in `src/world/rules.ts` (refactor reproductionStep to call it — behavior identical), add the two Observation fields. Any existing observe tests asserting exact `self` shape need the mechanical `reproReady` addition.

- [ ] **Step 4: Full suite** — `npm test && npm run typecheck`. NOTE: adding fields to Observation changes observationHash → all cross-run-relative tests stay green; confirm none hardcode hashes.

- [ ] **Step 5: Commit**

```bash
git add src/mind/observe.ts src/world/rules.ts tests/observe-npcs.test.ts tests
git commit -m "feat: observation sees living neighbors and own reproductive readiness"
```

---

### Task 3: seekMate utility candidate

**Files:**
- Modify: `src/mind/utility.ts`
- Test: `tests/seekmate.test.ts`

**Interfaces:** in `scoreCandidates`, after the shelter candidate and before explore:

```typescript
if (obs.self.reproReady) {
  const mate = obs.visibleNpcs.find((n) => n.fertileAdult);
  if (mate !== undefined) {
    candidates.push({
      key: "seekMate",
      score: w.seekMate - 15 * mate.dist,
      action: mate.dist <= 1 ? { verb: "idle" } : moveToward(obs.self.pos, mate.pos),
    });
  }
}
```

Design notes (for the implementer's understanding, encoded in tests): flat weight minus distance — a fed NPC (hunger need ≤ 400 when energy ≥ 600) has forage score ≈ ≤ w.forage×0.4, so seekMate ≈ 500-15d typically dominates when fed and a mate is near; hungry NPCs still forage. Adjacent → idle: waiting sustains adjacency so reproduction rolls accumulate tick after tick.

- [ ] **Step 1: Write the failing tests**

`tests/seekmate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { scoreCandidates, utilityDecide } from "../src/mind/utility.js";
import type { Observation } from "../src/mind/observe.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest();
const { identity, policy } = makeTestRoster(1)[0]!; // seekMate 500, forage 600

function obs(overrides: Partial<Observation> = {}): Observation {
  return {
    tick: 10, season: "summer", onShelter: false,
    self: { npcId: "npc-1", pos: { x: 5, y: 5 }, hp: 1000, energy: 800, berries: 0, reproReady: true },
    visibleBushes: [], visibleNpcs: [], wolf: null,
    nearestShelter: { pos: { x: 2, y: 2 }, dist: 3 },
    ...overrides,
  };
}

describe("seekMate candidate", () => {
  it("generated only when reproReady and a fertile adult is visible, in order after shelter", () => {
    const withMate = obs({ visibleNpcs: [{ npcId: "npc-2", pos: { x: 8, y: 5 }, dist: 3, fertileAdult: true }] });
    const keys = scoreCandidates(withMate, identity, policy, manifest, "s").map((c) => c.key);
    expect(keys).toContain("seekMate");
    expect(keys.indexOf("seekMate")).toBeGreaterThan(keys.indexOf("shelter") === -1 ? -1 : keys.indexOf("shelter"));
    expect(keys.indexOf("seekMate")).toBeLessThan(keys.indexOf("explore"));
    expect(scoreCandidates(obs(), identity, policy, manifest, "s").map((c) => c.key)).not.toContain("seekMate");
    expect(scoreCandidates(obs({ self: { ...obs().self, reproReady: false }, visibleNpcs: withMate.visibleNpcs }), identity, policy, manifest, "s").map((c) => c.key)).not.toContain("seekMate");
    const infertile = obs({ visibleNpcs: [{ npcId: "npc-2", pos: { x: 8, y: 5 }, dist: 3, fertileAdult: false }] });
    expect(scoreCandidates(infertile, identity, policy, manifest, "s").map((c) => c.key)).not.toContain("seekMate");
  });
  it("scores flat weight minus 15 per step and targets the NEAREST fertile adult", () => {
    const o = obs({ visibleNpcs: [
      { npcId: "far", pos: { x: 10, y: 5 }, dist: 5, fertileAdult: true },
      { npcId: "near-infertile", pos: { x: 6, y: 5 }, dist: 1, fertileAdult: false },
    ] });
    // visibleNpcs sorted by dist: near-infertile first, but find() skips it → far
    const c = scoreCandidates(o, identity, policy, manifest, "s").find((x) => x.key === "seekMate")!;
    expect(c.score).toBe(500 - 15 * 5);
    expect(c.action).toEqual({ verb: "move", to: { x: 6, y: 5 } });
  });
  it("adjacent to mate → idle (wait), and a fed NPC prefers courting to foraging", () => {
    const o = obs({
      visibleNpcs: [{ npcId: "npc-2", pos: { x: 6, y: 5 }, dist: 1, fertileAdult: true }],
      visibleBushes: [{ id: "bush-1", pos: { x: 4, y: 5 }, berries: 3, dist: 1 }],
    });
    const d = utilityDecide(o, identity, policy, manifest, "s");
    expect(d.key).toBe("seekMate");            // 500-15=485 > forage 600*200/1000-20=100
    expect(d.action).toEqual({ verb: "idle" });
  });
  it("a starving NPC forages instead", () => {
    const o = obs({
      self: { ...obs().self, energy: 200, reproReady: false },
      visibleBushes: [{ id: "bush-1", pos: { x: 4, y: 5 }, berries: 3, dist: 1 }],
      visibleNpcs: [{ npcId: "npc-2", pos: { x: 6, y: 5 }, dist: 1, fertileAdult: true }],
    });
    expect(utilityDecide(o, identity, policy, manifest, "s").key).toBe("forage");
  });
});
```

- [ ] **Step 2: Verify fail** — `npx vitest run tests/seekmate.test.ts`

- [ ] **Step 3: Implement** in `scoreCandidates`.

- [ ] **Step 4: Full suite** — `npm test && npm run typecheck`. Pre-existing utility/candidates/trigger/bench tests build observations without `visibleNpcs`/`reproReady` — Task 2 already forced those fixture updates; whatever remains, fix mechanically.

- [ ] **Step 5: Commit**

```bash
git add src/mind/utility.ts tests/seekmate.test.ts tests
git commit -m "feat: seekMate utility candidate - fed fertile npcs court nearby mates"
```

---

### Task 4: Integration check — does courtship change the adjacency picture?

**Files:**
- Test: `tests/courtship-integration.test.ts`

**Interfaces:** no production code — an integration test + measurement, verifying the mechanism works end-to-end before calibration:

- [ ] **Step 1: Write the test**

`tests/courtship-integration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runSim } from "../src/sim/engine.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest({
  berryRegrowPpmSummer: 300_000,
  berryRegrowPpmWinter: 100_000,
});
const roster = makeTestRoster(8);

describe("courtship integration", () => {
  const r = runSim(manifest, roster, "court-seed", { ticks: 4000 });

  it("births occur and exceed the pre-seekMate baseline density", () => {
    const births = r.events.filter((e) => e.kind === "birth").length;
    // pre-seekMate evolution test observed ~1-3 births in 2000-3000 ticks on this config;
    // courtship should make reproduction routine rather than accidental
    expect(births).toBeGreaterThanOrEqual(4);
  });
  it("seekMate decisions actually happen", () => {
    expect(r.actionLog.some((e) => {
      return e.actionSource === "utility" || e.actionSource === "resolver";
    })).toBe(true);
    // measured via events? actionLog has no key — assert births instead plus determinism below
  });
  it("full determinism holds with courtship active", () => {
    const r2 = runSim(manifest, roster, "court-seed", { ticks: 4000 });
    expect(hashCanonical(r2.finalState)).toBe(hashCanonical(r.finalState));
    expect(r2.checkpoints).toEqual(r.checkpoints);
  });
  it("population does not explode past the cap", () => {
    expect(r.finalState.npcs.filter((n) => n.alive).length).toBeLessThanOrEqual(manifest.maxPopulation);
  });
});
```

Note for the implementer: the second test's placeholder assertion is weak because `CanonicalActionEvent` doesn't carry the utility key. Strengthen it properly: run a short sim with an `onDecide` hook collecting `DecideInfo` and assert at least one decision's chosen action came from a `seekMate`-keyed candidate (compare chosen action to the candidates array entry with key "seekMate"). Write that version, not the placeholder.

- [ ] **Step 2: Run** — `npx vitest run tests/courtship-integration.test.ts`; iterate ONLY on test thresholds if birth counts differ from expectation — record actual numbers in the report. If births do NOT increase vs the pre-seekMate baseline, STOP: report BLOCKED with the measured numbers (the mechanism isn't working; don't paper over it).

- [ ] **Step 3: Full suite** — `npm test && npm run typecheck`

- [ ] **Step 4: Commit**

```bash
git add tests/courtship-integration.test.ts
git commit -m "test: courtship integration - births, determinism, cap under seekMate"
```

---

### Task 5: Calibration sweep + demo params + doc update

**Files:**
- Modify: `src/cli/demo.ts` (if the sweep picks a new birthChancePpm), `docs/evolve-calibration.md` (IN PLACE — single-version policy), `README.md` (only if commands change — likely not)

- [ ] **Step 1: Sweep.** With seekMate active, run `npm run evolve -- --seed evo-1 --ticks 60000` (and evo-2, evo-3) at current `birthChancePpm: 15_000`. If population sustains (no extinction, final population in [10, 60], maxGeneration ≥ 8 on ≥2 of 3 seeds), keep 15_000. If births now overshoot (population pinned at cap 60 with mass starvation), sweep DOWN {10_000, 5_000}; if still undershooting, sweep UP {50_000, 100_000}. One value change at a time; rerun all 3 seeds per value. Record every run's summary — including failed values.

- [ ] **Step 2: Update `docs/evolve-calibration.md` in place**: new results table (per swept value × seed), the chosen parameter with rationale, comparison against the pre-seekMate extinction baseline (keep the old table as a "before" reference section — it is the evidence for why seekMate exists), updated observations (generation turnover vs DEC-4 anchors: lifespan ~2400-3400 ticks, generation interval measured from birth events), and refreshed known-unknowns for §17.1 step 7.

- [ ] **Step 3: Success gate check.** State explicitly in the doc whether the gate (3×60k: no extinction, pop ∈ [10,60], maxGen ≥ 8 on ≥2 seeds) PASSED or FAILED. If FAILED after the full sweep: do NOT invent new mechanisms — write the honest failure analysis and stop; the controller escalates.

- [ ] **Step 4: Full verify** — `npm test && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add -A -- src docs README.md
git commit -m "feat: calibrated population sustainability with seekMate (results in evolve-calibration)"
```

---

## Self-Review Notes

- **Scope honesty:** this plan attacks the adjacency bottleneck identified by the gate experiment. If courtship + birthChance sweep can't sustain population, the honest output is a failure analysis, not scope creep into new mechanisms (e.g. migration, food-driven fertility) — those need their own plan.
- **Type consistency:** `visibleNpcs` entry shape defined in Task 2, consumed in Task 3's tests verbatim; `isFertileEligible` single-sources eligibility for observe + reproduction; `UTILITY_KEYS` order defined in Task 1 governs Task 3's insertion position.
- **Benchmark note:** Observation shape change (Task 2) alters trigger/prompt content for any FUTURE bench runs (official-v1 remains archived/valid at its commit); prompt.ts gains a seekMate description in Task 1 so rendered prompts stay exhaustive.
- **Known risk:** two mutually-seeking NPCs both idling adjacent burn energy without foraging; energy drain (2/tick) vs reproEnergyMin 600 naturally breaks the loop (they leave to forage when hunger dominates) — the integration test's birth counts will reveal if this oscillation starves couples instead of breeding them.
```
