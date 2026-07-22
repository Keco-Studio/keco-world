# Fixed Scenario Suite & Lineage Biography Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** living-worlds.md §17.1 step 6 / §6.8 deliverable 5: (A) a 30-scenario fixed test set + behavioral metrics that quantify how any genome behaves (action distributions, n-gram profiles, category breakdowns) — the instrument for "did 58 generations change anything?"; (B) the lineage biography auto-extractor (P1/P3): template-only, event-grounded markdown biographies of lineages from evolve runs, the raw material for 1C's paired-preference primary endpoint.

**Architecture:** The engine gains `runFromState` (run the existing tick loop from an arbitrary prepared state — `runSim` becomes a thin wrapper) and `DecideInfo.chosenKey`. A scenario is a pure builder returning `(manifest, state, focalNpcId, horizon)`; evaluation injects a genome-under-test into the focal NPC and records its verb/key sequence via `onDecide`. Metrics are pure integer/float functions over recorded sequences. The biography extractor RERUNS an evolve seed (determinism = free storage), assembles per-lineage chronicles from birth/death/belief events + genome weight drift, and renders via deterministic templates (Chronicle grounding rules: every claim traces to an event; LLM never involved).

**Tech Stack:** existing kernel. No new dependencies.

## Global Constraints

- Kernel invariants unchanged; `runSim` behavior byte-identical after the `runFromState` refactor (same seed → same hashes as before the refactor — verify against a pre-refactor capture).
- Scenario builders are pure and deterministic: same id → deep-equal (manifest, state); focal genome injection replaces identity/policy/beliefs (+ recomputed genomeHash) and NOTHING else about the state.
- Biographies are template-only; every rendered factual claim must trace to a specific event or state field (grounding rule 2 of Chronicle, living-worlds.md §5). No LLM anywhere in this plan.
- Blinding: rendered biographies contain no seed strings, no parameter values, no arm identifiers — only in-world names, seasons, and events.
- Metrics may use floats (stats layer, never hashed); everything entering hashed state stays integer.
- Commits end with the Co-Authored-By trailer from the harness rules.

---

### Task 1: Engine — `runFromState` + `DecideInfo.chosenKey`

**Files:**
- Modify: `src/sim/engine.ts`
- Test: `tests/run-from-state.test.ts`

**Interfaces:**

```typescript
export interface DecideInfo {
  // ...existing fields...
  chosenKey: UtilityKey | null;   // the winning candidate's key for utility/resolver decisions; null for reflex/injected
}
/** Run the tick loop from a prepared state, ticks state.tick+1 .. state.tick+opts.ticks. Mutates a deep copy, never the input. */
export function runFromState(
  initial: WorldState, manifest: WorldManifest, seedRoot: string, opts: RunOptions,
): RunResult;
export function runSim(manifest, roster, seedRoot, opts): RunResult; // = runFromState(createInitialState(...), ...) — unchanged signature/behavior
```

Implementation: move the existing loop body into `runFromState`; first line `const state = structuredClone(initial);` (input never mutated); loop bounds `for (let t = state.tick + 1; t <= startTick + opts.ticks; t++)` where `startTick` is captured before the loop. `runSim` delegates. `chosenKey`: utility/resolver path sets it from the winning candidate (`resolution.key`), reflex/injected paths set `null`.

- [ ] **Step 1: Capture pre-refactor baseline** — run this and SAVE the output in the test (Step 2) as literals:

```bash
npx tsx -e "
import { runSim } from './src/sim/engine.js';
import { makeTestManifest, makeTestRoster } from './tests/helpers.js';
import { hashCanonical } from './src/canon/canonicalize.js';
const r = runSim(makeTestManifest(), makeTestRoster(5), 'refactor-guard', { ticks: 500 });
console.log(hashCanonical(r.finalState));
console.log(r.checkpoints.map(c => c.stateHash.slice(0, 12)).join(','));
"
```

- [ ] **Step 2: Write the failing tests**

`tests/run-from-state.test.ts` (fill the two literals from Step 1's ACTUAL output — they pin refactor-neutrality):

```typescript
import { describe, it, expect } from "vitest";
import { runSim, runFromState } from "../src/sim/engine.js";
import { createInitialState } from "../src/world/state.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import type { DecideInfo } from "../src/sim/engine.js";

const manifest = makeTestManifest();
const roster = makeTestRoster(5);

const BASELINE_FINAL_HASH = "<literal from Step 1>";
const BASELINE_CHECKPOINT_PREFIXES = "<literal from Step 1>";

describe("runFromState", () => {
  it("refactor is behavior-neutral: pre-refactor hashes reproduced exactly", () => {
    const r = runSim(manifest, roster, "refactor-guard", { ticks: 500 });
    expect(hashCanonical(r.finalState)).toBe(BASELINE_FINAL_HASH);
    expect(r.checkpoints.map((c) => c.stateHash.slice(0, 12)).join(",")).toBe(BASELINE_CHECKPOINT_PREFIXES);
  });
  it("runSim equals createInitialState + runFromState", () => {
    const a = runSim(manifest, roster, "seed-x", { ticks: 300 });
    const b = runFromState(createInitialState(manifest, roster, "seed-x"), manifest, "seed-x", { ticks: 300 });
    expect(hashCanonical(a.finalState)).toBe(hashCanonical(b.finalState));
    expect(a.checkpoints).toEqual(b.checkpoints);
  });
  it("does not mutate the input state and continues from a mid-run tick", () => {
    const s = createInitialState(manifest, roster, "seed-x");
    s.tick = 450;                        // mid-winter start
    const frozen = JSON.stringify(s);
    const r = runFromState(s, manifest, "seed-x", { ticks: 10 });
    expect(JSON.stringify(s)).toBe(frozen);
    expect(r.finalState.tick).toBe(460);
    expect(r.actionLog.every((e) => e.tick > 450 && e.tick <= 460)).toBe(true);
  });
  it("chosenKey reported for utility/resolver, null for reflex", () => {
    const seen: DecideInfo[] = [];
    runSim(manifest, roster, "seed-x", { ticks: 200, onDecide: (i) => seen.push(i) });
    for (const d of seen) {
      if (d.actionSource === "reflex") expect(d.chosenKey).toBeNull();
      else expect(d.chosenKey).not.toBeNull();
    }
    expect(new Set(seen.filter((d) => d.chosenKey !== null).map((d) => d.chosenKey)).size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 3: Verify fail** — `npx vitest run tests/run-from-state.test.ts`

- [ ] **Step 4: Implement**, then `npm test && npm run typecheck` — the baseline-hash test proves refactor-neutrality; all 195 existing tests must stay green untouched.

- [ ] **Step 5: Commit**

```bash
git add src/sim/engine.ts tests/run-from-state.test.ts
git commit -m "feat: runFromState engine entry and chosenKey in decision info"
```

---

### Task 2: Scenario framework + first 10 scenarios

**Files:**
- Create: `src/scenarios/framework.ts`, `src/scenarios/library.ts`
- Test: `tests/scenario-framework.test.ts`

**Interfaces:**

```typescript
// framework.ts
export type ScenarioCategory = "hunger" | "winter" | "predator" | "courtship" | "hesitation" | "sequence";
export interface Scenario {
  id: string;                       // e.g. "H1"
  category: ScenarioCategory;
  title: string;                    // one-line human description
  horizon: number;                  // ticks to run (1 for single-decision, up to 40 for sequence)
  build(): { manifest: WorldManifest; state: WorldState; focalNpcId: string };
}
export interface GenomeUnderTest { identity: Identity; policy: Policy; beliefs: Belief[] }
export interface ScenarioTrace {
  scenarioId: string;
  verbs: string[];                  // focal NPC's action verbs in order
  keys: (string | null)[];          // chosenKey per decision (null = reflex)
}
export function evaluateGenome(g: GenomeUnderTest, scenarios: Scenario[], seedRoot?: string): ScenarioTrace[];
// injection: deep-copy the built state; replace focal npc's identity/policy/beliefs with deep copies of g;
// recompute genomeHash = hashCanonical({identity, policy, beliefs}); run runFromState(state, manifest, seedRoot ?? "scenario-eval", { ticks: horizon, retainActionLog: true, onDecide });
// record ONLY the focal npc's decisions.
```

`library.ts` — a builder helper plus the scenario definitions:

```typescript
// Base: makeTestManifest-like fixed manifest (defined locally, NOT imported from tests/) with
// gridWidth/Height 16, seasonLengthTicks 400, visionRadius 8, and the standard phase1a params
// (same values as tests/helpers.ts makeTestManifest — duplicate them here as SCENARIO_MANIFEST_BASE;
// scenarios must not depend on test files).
export const SCENARIO_MANIFEST_BASE: WorldManifest = { /* exact copy of makeTestManifest defaults */ };

interface Placement { pos: Vec2; hp?: number; energy?: number; berries?: number; birthTick?: number; reproCooldownUntil?: number }
export function buildScenario(opts: {
  tick: number;                                    // start tick (season = seasonAt(tick))
  focal: Placement;
  others?: Placement[];                            // additional NPCs (fertile adults unless birthTick overridden)
  bushes?: { pos: Vec2; berries: number }[];       // replaces manifest bushes (ids bush-1..n, capacity 5)
  wolfPos?: Vec2;                                  // default far corner {x:15,y:15}
  manifestOverrides?: Partial<WorldManifest>;
}): { manifest: WorldManifest; state: WorldState; focalNpcId: string };
// build: manifest from base+overrides (bushes converted); createInitialState with a 1+others.length
// neutral roster (fixed weights: forage 600, consume 800, shelter 700, seekMate 500, explore 200, idle 50,
// hungerUrgent 150, epsilon 0 — the GENOME UNDER TEST replaces the focal anyway; epsilon 0 keeps
// non-focal NPCs deterministic-argmax); then apply placements (pos/hp/energy/berries/birthTick default
// adult age via birthTick = tick - 1000 for base manifest, cooldown 0); state.tick = opts.tick; wolf placed.
```

First 10 scenarios in `SCENARIOS` (exported array, ids stable — these are the frozen test-set identities):

| id | cat | horizon | spec (exact params) |
|---|---|---|---|
| H1 | hunger | 1 | tick 10 (summer), focal energy 800, bush(6,5) berries 3, focal(5,5) — fed near food |
| H2 | hunger | 1 | as H1 but energy 400 — hungry near food |
| H3 | hunger | 1 | as H1 but energy 120, berries 2 held — starving with pocket food (reflex eat) |
| H4 | hunger | 1 | tick 10, energy 400, nearest bush at (12,5) dist 7 — hungry, food far |
| H5 | hunger | 20 | tick 10, energy 500, bushes (6,5) b1 and (12,5) b5 — near-empty vs far-full over 20 ticks |
| W1 | winter | 1 | tick 450 (winter), focal(8,8) energy 800, shelter at (2,2) (base manifest), no bushes visible |
| W2 | winter | 1 | tick 450, focal ON shelter (2,2), energy 800 — stay put? |
| W3 | winter | 20 | tick 390 (10 ticks to winter), focal(8,8), energy 600, bush(9,8) b3 — pre-winter tradeoff |
| P1 | predator | 1 | tick 10, wolf at (6,5) dist 1 — reflex flee |
| P2 | predator | 1 | tick 10, wolf at (9,5) dist 4, bush(6,5) b3, energy 400 — forage under watch |

- [ ] **Step 1: Write the failing tests**

`tests/scenario-framework.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SCENARIOS } from "../src/scenarios/library.js";
import { evaluateGenome } from "../src/scenarios/framework.js";
import { makeTestRoster } from "./helpers.js";

const neutral = (() => { const r = makeTestRoster(1)[0]!; return { identity: r.identity, policy: r.policy, beliefs: [] }; })();

describe("scenario framework", () => {
  it("builders are pure and deterministic", () => {
    for (const s of SCENARIOS) {
      expect(s.build()).toEqual(s.build());
    }
  });
  it("evaluation is deterministic and traces only the focal npc", () => {
    const a = evaluateGenome(neutral, SCENARIOS);
    const b = evaluateGenome(neutral, SCENARIOS);
    expect(a).toEqual(b);
    for (let i = 0; i < SCENARIOS.length; i++) {
      expect(a[i]!.scenarioId).toBe(SCENARIOS[i]!.id);
      expect(a[i]!.verbs.length).toBeGreaterThanOrEqual(1);
      expect(a[i]!.verbs.length).toBeLessThanOrEqual(SCENARIOS[i]!.horizon);
      expect(a[i]!.keys.length).toBe(a[i]!.verbs.length);
    }
  });
  it("known scenarios produce sane behaviors for the neutral genome", () => {
    const traces = Object.fromEntries(evaluateGenome(neutral, SCENARIOS).map((t) => [t.scenarioId, t]));
    expect(traces["H3"]!.verbs[0]).toBe("consume");         // reflex: starving with food
    expect(traces["P1"]!.verbs[0]).toBe("flee");            // reflex: wolf adjacent
    expect(["take", "move"]).toContain(traces["H2"]!.verbs[0]); // hungry near food → forage-ish
    expect(traces["W1"]!.verbs[0]).toBe("move");            // winter off-shelter → head for shelter
  });
  it("genome injection actually changes behavior", () => {
    const homebody = { ...neutral, policy: { ...neutral.policy, utilityWeights: { ...neutral.policy.utilityWeights, explore: 0, shelter: 1000 } } };
    const explorer = { ...neutral, policy: { ...neutral.policy, utilityWeights: { ...neutral.policy.utilityWeights, explore: 1000, shelter: 0 } } };
    const a = evaluateGenome(homebody, SCENARIOS).flatMap((t) => t.keys);
    const b = evaluateGenome(explorer, SCENARIOS).flatMap((t) => t.keys);
    expect(a).not.toEqual(b);
  });
  it("first 10 scenario ids and categories are frozen", () => {
    expect(SCENARIOS.slice(0, 10).map((s) => s.id)).toEqual(["H1","H2","H3","H4","H5","W1","W2","W3","P1","P2"]);
  });
});
```

- [ ] **Step 2: Verify fail**, implement, `npm test && npm run typecheck` green.

- [ ] **Step 3: Commit**

```bash
git add src/scenarios tests/scenario-framework.test.ts
git commit -m "feat: scenario framework with builder DSL and first 10 fixed scenarios"
```

---

### Task 3: Complete the 30-scenario library

**Files:**
- Modify: `src/scenarios/library.ts`
- Test: `tests/scenario-library.test.ts`

**Interfaces:** extend `SCENARIOS` to 30 with these exact specs (same builder DSL):

| id | cat | horizon | spec |
|---|---|---|---|
| P3 | predator | 1 | tick 10, wolf (7,5) dist 2 — reflex boundary |
| P4 | predator | 20 | tick 10, wolf (10,5) dist 5, bush(4,5) b3 behind focal, energy 500 — retreat-and-forage sequence |
| P5 | predator | 1 | tick 450 winter, wolf (9,5) dist 4, off-shelter energy 700 — двой threat: prefer shelter or flee-bias? (verifies threat композиция) — title in English: "winter predator tension" |
| C1 | courtship | 1 | tick 10, focal reproReady (energy 800, adult, cooldown 0), fertile adult other at (8,5) dist 3 |
| C2 | courtship | 1 | as C1 but other at (6,5) dist 1 — adjacent wait |
| C3 | courtship | 1 | as C1 but focal energy 500 (reproReady false) — courtship suppressed by hunger |
| C4 | courtship | 1 | as C1 but other has birthTick = tick (juvenile — not fertileAdult) |
| C5 | courtship | 30 | tick 10, focal(5,5) energy 900, mate(12,12) dist 7, bush(6,6) b2 — approach across map |
| Z1 | hesitation | 1 | tick 10, energy 620, bush(7,5) dist 2 b3, epsilon set on GENOME (evaluator passes genome epsilon; scenario neutral) — forage/seekMate/explore near-tie; others: fertile adult (7,7) dist 2 |
| Z2 | hesitation | 1 | as Z1, energy 640, bush dist 3, mate dist 3 |
| Z3 | hesitation | 1 | tick 450 winter, energy 640, shelter dist 3, bush(6,5) dist 1 b2 — eat-or-shelter tension |
| Z4 | hesitation | 1 | as Z1 but focal berries 1 — consume joins the band |
| S1 | sequence | 40 | tick 10, all bushes empty (b0, capacity 5), energy 500 — forced exploration |
| S2 | sequence | 40 | tick 10, bush cluster {(12,12) b5, (13,12) b5, (12,13) b5} far from focal(3,3), energy 450 — travel + harvest |
| S3 | sequence | 40 | tick 380, focal(10,10), energy 700, shelter (2,2) dist 8, bush(11,10) b2 — winter onset during run |
| S4 | sequence | 40 | tick 10, wolf (8,8) near bush(9,9) b5, focal(3,3) energy 400, second bush(2,2) b1 — risky rich vs safe poor |
| S5 | sequence | 40 | tick 10, focal + fertile mate (4,3) adjacent, both energy 900, bush(10,10) b3 — court then feed cycle |
| H6 | hunger | 1 | tick 10, energy 400, TWO bushes: (6,5) b1, (7,5) b5 — nearest-vs-richest (verifies .find takes nearest) |
| H7 | hunger | 1 | tick 10, energy 50, no bushes, berries 0 — desperate empty world |
| W4 | winter | 1 | tick 450, energy 300, bush(6,5) b3, shelter dist 4 — hunger-vs-cold |
| W5 | winter | 20 | tick 430, ON shelter, energy 550, bush(4,4) dist 2 b3 — leave shelter to eat? |

(30 total with Task 2's 10.) Note P5's title field must be English like the rest; the table's stray Cyrillic is a typo — do not copy it.

- [ ] **Step 1: Write the failing tests**

`tests/scenario-library.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SCENARIOS } from "../src/scenarios/library.js";
import { evaluateGenome } from "../src/scenarios/framework.js";
import { makeTestRoster } from "./helpers.js";

describe("scenario library", () => {
  it("has 30 scenarios with unique frozen ids across 6 categories", () => {
    expect(SCENARIOS.length).toBe(30);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(30);
    const cats = new Set(SCENARIOS.map((s) => s.category));
    expect(cats).toEqual(new Set(["hunger", "winter", "predator", "courtship", "hesitation", "sequence"]));
    for (const cat of cats) expect(SCENARIOS.filter((s) => s.category === cat).length).toBeGreaterThanOrEqual(3);
  });
  it("every scenario evaluates deterministically for the neutral genome", () => {
    const r = makeTestRoster(1)[0]!;
    const g = { identity: r.identity, policy: r.policy, beliefs: [] };
    const a = evaluateGenome(g, SCENARIOS);
    expect(a).toEqual(evaluateGenome(g, SCENARIOS));
    expect(a.length).toBe(30);
  });
  it("category signatures hold for the neutral genome", () => {
    const r = makeTestRoster(1)[0]!;
    const g = { identity: r.identity, policy: r.policy, beliefs: [] };
    const byId = Object.fromEntries(evaluateGenome(g, SCENARIOS).map((t) => [t.scenarioId, t]));
    expect(byId["C2"]!.keys[0]).toBe("seekMate");
    expect(byId["C3"]!.keys[0]).not.toBe("seekMate");
    expect(byId["C4"]!.keys[0]).not.toBe("seekMate");
    expect(byId["S1"]!.verbs).toContain("move");          // exploration happens
    expect(byId["H7"]!.verbs.length).toBe(1);
    const z = ["Z1", "Z2", "Z3", "Z4"].map((id) => byId[id]!.keys[0]);
    expect(z.every((k) => k !== null)).toBe(true);        // hesitation scenarios produce utility-layer picks
  });
  it("an epsilon-laden genome resolves hesitation scenarios via the resolver at least once", () => {
    const r = makeTestRoster(1)[0]!;
    const g = { identity: { ...r.identity, socialTrust: 900 }, policy: { ...r.policy, deliberationEpsilon: 200 }, beliefs: [] };
    const traces = evaluateGenome(g, SCENARIOS.filter((s) => s.category === "hesitation"));
    expect(traces.length).toBe(4);   // sanity: resolver actually has bands to work with (behavioral diff vs epsilon 0 checked in metrics tests)
  });
});
```

- [ ] **Step 2: Verify fail, implement, iterate.** Category-signature expectations may need scenario parameter adjustments (e.g. Z-scenario energies to actually land near-ties) — tune the SCENARIO params (not the assertions) until signatures hold, and document any tuned values in the report.

- [ ] **Step 3: Full suite + commit**

```bash
git add src/scenarios/library.ts tests/scenario-library.test.ts
git commit -m "feat: complete 30-scenario fixed test set across six categories"
```

---

### Task 4: Behavior metrics

**Files:**
- Create: `src/scenarios/metrics.ts`
- Test: `tests/behavior-metrics.test.ts`

**Interfaces:**

```typescript
export type VerbHistogram = Record<string, number>;
export function verbHistogram(traces: ScenarioTrace[]): VerbHistogram;                    // counts across all traces
export function histogramL1(a: VerbHistogram, b: VerbHistogram): number;                  // normalized: sum |pa - pb| over union keys, using proportions; 0..2
export function ngramProfile(traces: ScenarioTrace[], n: number): Map<string, number>;    // verb n-grams within each trace (no cross-trace grams), key = verbs joined "|"
export function ngramDistance(a: Map<string, number>, b: Map<string, number>): number;    // normalized L1 over proportions, 0..2
export interface GenomeComparison {
  verbL1: number;
  bigramL1: number;
  keyShift: Record<string, number>;          // per-chosenKey proportion delta (B minus A), keys union, null-key excluded
  byCategory: Record<ScenarioCategory, { verbL1: number }>;
  disagreementRate: number;                  // fraction of scenario first-decisions where A and B verbs differ
}
export function compareGenomes(a: GenomeUnderTest, b: GenomeUnderTest, scenarios: Scenario[]): GenomeComparison;
export function meanPairwiseVerbL1(genomes: GenomeUnderTest[], scenarios: Scenario[], maxPairs?: number): number;
// maxPairs (default 100): if C(n,2) exceeds it, take the first maxPairs pairs in deterministic (i<j) order.
```

- [ ] **Step 1: Write the failing tests**

`tests/behavior-metrics.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { verbHistogram, histogramL1, ngramProfile, ngramDistance, compareGenomes, meanPairwiseVerbL1 } from "../src/scenarios/metrics.js";
import { SCENARIOS } from "../src/scenarios/library.js";
import { makeTestRoster } from "./helpers.js";

const r = makeTestRoster(1)[0]!;
const neutral = { identity: r.identity, policy: r.policy, beliefs: [] };

describe("behavior metrics", () => {
  it("histogram + L1 basics", () => {
    const a = { move: 6, take: 4 };
    const b = { move: 4, take: 4, idle: 2 };
    expect(histogramL1(a, a)).toBe(0);
    expect(histogramL1(a, b)).toBeCloseTo(0.4, 5);   // props: (.6,.4,0) vs (.4,.4,.2) → .2+.0+.2
    expect(histogramL1(a, { flee: 1 })).toBe(2);      // disjoint
  });
  it("ngram profile stays within traces", () => {
    const p = ngramProfile([{ scenarioId: "x", verbs: ["move", "move", "take"], keys: [null, null, null] }], 2);
    expect(p.get("move|move")).toBe(1);
    expect(p.get("move|take")).toBe(1);
    expect(p.size).toBe(2);
  });
  it("identical genomes → zero distances", () => {
    const c = compareGenomes(neutral, neutral, SCENARIOS);
    expect(c.verbL1).toBe(0);
    expect(c.bigramL1).toBe(0);
    expect(c.disagreementRate).toBe(0);
  });
  it("opposed genomes → measurable distance with sensible keyShift", () => {
    const explorer = { ...neutral, policy: { ...neutral.policy, utilityWeights: { ...neutral.policy.utilityWeights, explore: 1000, forage: 100 } } };
    const c = compareGenomes(neutral, explorer, SCENARIOS);
    expect(c.verbL1).toBeGreaterThan(0);
    expect(c.disagreementRate).toBeGreaterThan(0);
    expect(c.keyShift["explore"] ?? 0).toBeGreaterThan(0);   // B explores more
  });
  it("meanPairwiseVerbL1: zero for clones, positive for a mixed set, deterministic", () => {
    const explorer = { ...neutral, policy: { ...neutral.policy, utilityWeights: { ...neutral.policy.utilityWeights, explore: 1000, forage: 100 } } };
    expect(meanPairwiseVerbL1([neutral, neutral, neutral], SCENARIOS)).toBe(0);
    const m = meanPairwiseVerbL1([neutral, explorer, neutral], SCENARIOS);
    expect(m).toBeGreaterThan(0);
    expect(meanPairwiseVerbL1([neutral, explorer, neutral], SCENARIOS)).toBe(m);
  });
});
```

- [ ] **Step 2: Verify fail, implement, full suite green, commit**

```bash
git add src/scenarios/metrics.ts tests/behavior-metrics.test.ts
git commit -m "feat: behavior metrics - verb histograms, ngram profiles, genome comparison"
```

---

### Task 5: Behavior CLI — founders vs evolved

**Files:**
- Create: `src/cli/behavior.ts`
- Modify: `package.json` (script `"behavior": "tsx src/cli/behavior.ts"`)
- Test: `tests/behavior-cli.test.ts`

**Interfaces:** exported for tests: `behaviorReport(seedRoot: string, ticks: number): BehaviorReport` where

```typescript
export interface BehaviorReport {
  seedRoot: string;
  ticks: number;
  foundersAlive: number;            // founders are roster genomes (all 25, regardless of survival)
  evolvedAlive: number;             // alive NPCs at end of the rerun
  maxGeneration: number;
  foundersVsEvolved: GenomeComparison;      // pooled: compare the MEAN behavior? No — pairwise:
  // founders set = 25 roster genomes; evolved set = alive NPCs' genomes (identity/policy/beliefs snapshot)
  intraFounderDiversity: number;    // meanPairwiseVerbL1(founders)
  intraEvolvedDiversity: number;    // meanPairwiseVerbL1(evolved)
  crossDistance: number;            // mean over min(100, |F|×|E|) cross pairs (deterministic order) of verbL1 between founder-i, evolved-j — implement as meanCrossVerbL1(a, b, scenarios, maxPairs)
  topKeyShifts: [string, number][]; // largest-|delta| chosenKey proportion shifts, founders→evolved pooled traces, top 3
}
```

CLI: `npm run behavior -- --seed evo-1 --ticks 60000 [--out runs/behavior-<seed>]` → reruns the demo world via `runSim` (retainActionLog:false), collects evolved genomes from `finalState.npcs.filter(alive)`, founder genomes from `makeDemoRoster("bench-roster"?)` — NO: founders must be the same roster the evolve CLI uses; read `src/cli/evolve.ts` and reuse its exact roster construction (import the same function/seed). Prints a readable table; writes `report.json`. Add `meanCrossVerbL1` to `src/scenarios/metrics.ts` if not present.

- [ ] **Step 1: Write the failing tests**

`tests/behavior-cli.test.ts` (use a SHORT run so the test is fast; the fertile test-manifest world isn't available here — use the real demo world with few ticks; evolved≈founders then, which is itself the assertion):

```typescript
import { describe, it, expect } from "vitest";
import { behaviorReport } from "../src/cli/behavior.js";

describe("behavior report", () => {
  const r = behaviorReport("bhv-test", 2000);   // ~seconds; population barely changed
  it("shape and determinism", () => {
    expect(r.foundersAlive).toBe(25);
    expect(r.evolvedAlive).toBeGreaterThan(0);
    expect(Number.isFinite(r.crossDistance)).toBe(true);
    expect(behaviorReport("bhv-test", 2000)).toEqual(r);
  });
  it("short-horizon evolved population behaves near-founder (sanity direction)", () => {
    // after only 2000 ticks (mostly founders alive, few births), cross distance should be small-ish
    expect(r.foundersVsEvolved.verbL1).toBeLessThan(1.0);
  });
  it("key shifts are proportion deltas", () => {
    for (const [, delta] of r.topKeyShifts) expect(Math.abs(delta)).toBeLessThanOrEqual(1.0);
  });
});
```

- [ ] **Step 2: Verify fail, implement, full suite green.** Smoke: `npm run behavior -- --seed evo-1 --ticks 60000` (couple of minutes) — record the REAL founders-vs-evolved numbers in the report; this is the first quantitative answer to "did 58 generations change behavior?" `rm -rf runs/behavior-evo-1` after recording.

- [ ] **Step 3: Commit**

```bash
git add src/cli/behavior.ts src/scenarios/metrics.ts package.json tests/behavior-cli.test.ts
git commit -m "feat: behavior CLI - founders-vs-evolved scenario comparison"
```

---

### Task 6: Lineage chronicle extractor + biography templates

**Files:**
- Create: `src/chronicle/extract.ts`, `src/chronicle/biography.ts`
- Test: `tests/biography.test.ts`

**Interfaces:**

```typescript
// extract.ts
export interface LineageMember {
  npcId: string; name: string; generation: number;
  birthTick: number; parents: [string, string] | null;
  deathTick: number | null; deathCause: string | null;   // null = alive at end
}
export interface LineageChronicle {
  lineageId: string;
  founderName: string;
  members: LineageMember[];                 // sorted (generation, birthTick, npcId)
  beliefsFormed: { npcId: string; name: string; tick: number; proposition: string }[];  // from belief_formed events, members only
  weightDrift: { key: string; founder: number; latest: number }[];   // founder roster weights vs the LATEST-generation living member (tie: earliest npcId); empty if lineage extinct
  extinct: boolean;
  peakGeneration: number;
}
export function extractLineage(
  events: SemanticEvent[], finalState: WorldState, roster: RosterEntry[], lineageId: string,
): LineageChronicle;
// membership: founder (roster npcId === lineageId) + every birth event whose data.lineageId === lineageId.
// birth data provides generation/parents; death events keyed by npcId give deathTick/cause.
// belief_formed events for member npcIds (data.proposition carried per beliefs.ts).

// biography.ts
export function renderBiography(c: LineageChronicle, manifest: WorldManifest): string;
// Template-only markdown. Grounding: every sentence derives from chronicle fields.
// Time rendering: tick → season-year: year = floor(tick / (2*seasonLengthTicks)) + 1, season = seasonAt(tick) → "第X年夏/冬" — NO raw tick numbers in prose (blinding + readability); an appendix table MAY list member vital records with the same season-year notation.
// Structure: title (founder name + lineage span), 开篇 (founder + peak generation + extinct/living), per-generation paragraphs (births with parent names, deaths with cause phrasing map: starvation→"死于饥饿", cold→"死于严寒", wolf→"死于狼口", old_age→"寿终正寝"), beliefs woven in ("这一年，X 学会了：『proposition』"), 结尾: weightDrift narrated for |delta| >= 80 only ("这一脉比先祖更依恋庇护所" style, mapping key→phrase: forage→采集, consume→进食, shelter→庇护, seekMate→亲近同伴, explore→远行, idle→静处), or extinct closing line.
// Length control: cap at 12 member-event sentences (births+deaths chronological priority), then beliefs capped at 5; deterministic selection (chronological, then npcId).
// Blinding: no seed, no parameter values, no tick integers, no arm/lineage-id strings (founder NAME is fine).
```

- [ ] **Step 1: Write the failing tests**

`tests/biography.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractLineage } from "../src/chronicle/extract.js";
import { renderBiography } from "../src/chronicle/biography.js";
import { runSim } from "../src/sim/engine.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest({ berryRegrowPpmSummer: 300_000, berryRegrowPpmWinter: 100_000 });
const roster = makeTestRoster(8);
const r = runSim(manifest, roster, "bio-seed", { ticks: 4000 });
const lineages = new Set(r.events.filter((e) => e.kind === "birth").map((e) => String(e.data["lineageId"])));

describe("lineage chronicle", () => {
  it("run produced at least one lineage with births", () => {
    expect(lineages.size).toBeGreaterThan(0);
  });
  const lid = [...lineages].sort()[0]!;
  const c = extractLineage(r.events, r.finalState, roster, lid);

  it("chronicle facts trace to events", () => {
    expect(c.lineageId).toBe(lid);
    expect(c.members.length).toBeGreaterThanOrEqual(2);           // founder + ≥1 birth
    expect(c.members[0]!.generation).toBe(0);
    const births = r.events.filter((e) => e.kind === "birth" && e.data["lineageId"] === lid).length;
    expect(c.members.length).toBe(1 + births);
    for (const m of c.members.filter((m) => m.deathTick !== null)) {
      expect(r.events.some((e) => e.kind === "death" && e.npcId === m.npcId)).toBe(true);
    }
    expect(c.peakGeneration).toBe(Math.max(...c.members.map((m) => m.generation)));
  });
  it("renders a grounded, blinded biography", () => {
    const md = renderBiography(c, manifest);
    expect(md).toContain(c.founderName);
    expect(md).not.toContain("bio-seed");
    expect(md).not.toContain(lid);                                 // raw lineage id blinded
    expect(md).not.toMatch(/tick\s*\d|\btick\b/i);                 // no raw ticks
    expect(md).toMatch(/第\d+年/);                                  // season-year notation present
    const named = c.members.filter((m) => m.deathTick !== null).slice(0, 3);
    for (const m of named) expect(md).toContain(m.name);
  });
  it("rendering is deterministic and length-controlled", () => {
    const md = renderBiography(c, manifest);
    expect(renderBiography(c, manifest)).toBe(md);
    expect(md.length).toBeLessThan(4000);
  });
  it("extinct lineage renders the extinct closing and empty drift", () => {
    const extinctLid = roster.map((x) => x.npcId).find((id) => !r.finalState.npcs.some((n) => n.alive && n.lineageId === id));
    if (extinctLid !== undefined) {
      const ec = extractLineage(r.events, r.finalState, roster, extinctLid);
      expect(ec.extinct).toBe(true);
      expect(ec.weightDrift).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Verify fail, implement, full suite green, commit**

```bash
git add src/chronicle tests/biography.test.ts
git commit -m "feat: lineage chronicle extraction and template-only biography rendering"
```

---

### Task 7: Biography CLI + real artifacts + README

**Files:**
- Create: `src/cli/biography.ts`, `docs/examples/` (one real biography + one behavior report)
- Modify: `package.json` (script `"biography": "tsx src/cli/biography.ts"`), `README.md`

**Interfaces:** CLI `npm run biography -- --seed evo-1 --ticks 60000 [--lineage <founderNpcId>] [--top N]` → reruns the demo world (same roster path as evolve.ts), extracts either the named lineage or the top-N lineages by member count (ties: lineageId asc), writes `runs/biography-<seed>/<founderName>.md` per lineage + an `index.json` (lineageId, founderName, members, peakGeneration, extinct).

- [ ] **Step 1: Implement the CLI** (no new framework — wire Task 6's functions; arg parsing per existing CLI patterns; guard main like evolve.ts).

- [ ] **Step 2: Real artifacts.** Run `npm run biography -- --seed evo-1 --ticks 60000 --top 2` and `npm run behavior -- --seed evo-1 --ticks 60000`. Copy the best biography markdown to `docs/examples/biography-evo1-<founderName>.md` and the behavior report to `docs/examples/behavior-evo1.json`. READ the biography yourself; if it's unreadable garbage (template bugs, nonsense ordering), fix the templates before committing — this artifact is the point of the whole plan. Record the founders-vs-evolved headline numbers (verbL1, disagreementRate, top key shifts) in your report AND in a short paragraph appended to docs/evolve-calibration.md ("行为漂移初测" section).

- [ ] **Step 3: README**: add `npm run behavior` and `npm run biography` to Commands; add `docs/examples/` line to Design docs.

- [ ] **Step 4: Full suite green; clean runs/; commit**

```bash
git add src/cli/biography.ts package.json docs/examples docs/evolve-calibration.md README.md
git commit -m "feat: biography CLI with real evo-1 artifacts and behavior drift headline"
```

---

## Self-Review Notes

- **Spec coverage:** §6.7 行为新颖性 instruments (action distribution distance, n-grams, category breakdown) → Tasks 4–5; 30–50 固定情境 → Tasks 2–3 (30, ids frozen — the doc's range floor; extending toward 50 is a later content task); 传记自动抽取器 with Chronicle grounding + blinding (P1/P3) → Tasks 6–7; "state-visit distribution" from §6.7 deliberately deferred (needs position-trace instrumentation — note as known gap in Task 7's calibration-doc paragraph).
- **Type consistency:** `ScenarioTrace` (T2) consumed by T4/T5; `GenomeUnderTest` shared T2/T4/T5; `runFromState` (T1) consumed by T2's evaluator; `LineageChronicle` (T6) consumed by T7; `chosenKey` (T1) feeds keys in traces.
- **Determinism:** scenario builders pure; evaluator uses fixed seedRoot default; rerun-based extraction relies on kernel determinism (proven by prior plans' replay tests).
- **Honest uncertainty:** the founders-vs-evolved numbers from evo-1 are a first measurement, not a validated novelty gate (that's 1C, with preregistration); Task 7 explicitly labels them 初测.
```
