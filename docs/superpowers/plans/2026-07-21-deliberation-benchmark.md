# Deliberation Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Phase-0 "三层决策 benchmark" (v0.5 §17.1 step 4, §18 P0 判定基准): harvest deliberation trigger points from deterministic sims, ask small LLMs (qwen3 0.6b/1.7b/4b via Ollama) to adjudicate, evaluate LLM-choice vs utility-best via shadow branch rollouts, and produce the statistics that feed the B+/B0/B± branch decision.

**Architecture:** The engine gains a read-only `onDecide` observer hook; the utility layer exposes its scored candidate list. A harvester collects trigger points (utility decisions where the top-2 score gap ≤ epsilon). For each trigger, a prompt presents the observation and *deterministically shuffled* candidates (no score leakage, no position bias) to an LLM behind a `DeliberationRuntime` interface (Ollama first; interface allows llama.cpp later). Divergent choices (LLM ≠ utility-best) are settled by a pair of shadow rollouts: deterministic re-run from t=1 with exactly one injected action at the trigger, continued H ticks, compared by a preregistered integer margin. Wilson CIs decide the verdict. All LLM results persist incrementally (resumable); unit tests use a MockRuntime — the test suite never touches the network.

**Tech Stack:** Existing kernel (TypeScript ESM, zod v4, vitest). Node ≥20 built-in `fetch` + `AbortSignal.timeout` for the Ollama HTTP API (`http://localhost:11434`). No new dependencies.

## Global Constraints

- **The vitest suite must never call Ollama.** All orchestrator/runtime tests use `MockRuntime` or an injected fake fetch. Live LLM calls happen only via the `npm run bench` CLI.
- **No score leakage:** the prompt must not contain utility scores or any ordering correlated with them; candidate order is a deterministic shuffle keyed by trigger id (`drawInt`, no Math.random anywhere under src/ — Global Constraint carried over from the kernel).
- **Determinism of everything except the LLM call:** trigger harvesting, shuffling, rollouts, margins, and the random-arm control are pure functions of (manifest, roster, seedRoot, params). LLM calls use `temperature: 0` and qwen3 thinking disabled (`think: false`).
- **Rollout injections must be legal:** forced actions come from the candidate list generated at that exact state, so `runSim` must complete with `haltedAtTick === null` — assert this; a halt is a bug.
- Kernel invariants unchanged: existing 75 tests keep passing; `Observation`/engine tick sequence untouched except the additive hook.
- Margin formula (preregistered, integers only): `alive ? 10_000 + hp + energy + 100*berries : (deathTick - triggerTick)`. Higher is better. Strict `>` = win, `<` = loss, `=` = tie (ties reported, excluded from the binomial).
- Statistical gate (preregistered): LLM has增益 iff win-rate over divergent scenarios ≥ 0.55 AND Wilson 95% lower bound > 0.50. Report MDE honestly: n=300 divergent detects ~58% at 80% power; n=780 detects 55%.
- Commit after every task; messages end with the Co-Authored-By trailer from the harness rules.

---

### Task 1: Expose scored candidates + engine `onDecide` hook

**Files:**
- Modify: `src/mind/utility.ts`
- Modify: `src/sim/engine.ts`
- Test: `tests/candidates.test.ts`

**Interfaces:**
- Consumes: existing `utilityDecide` internals, engine decision loop.
- Produces: `export interface ScoredCandidate { key: UtilityKey; score: number; action: Action }`; `scoreCandidates(obs, identity, policy, manifest, seedRoot): ScoredCandidate[]` (in generation order); `pickBest(cands): ScoredCandidate` (strict `>`, earliest wins ties); `utilityDecide` unchanged in signature/behavior (now delegates). Engine `RunOptions` gains `onDecide?: (info: DecideInfo) => void` with `export interface DecideInfo { tick: number; npcId: string; observation: Observation; actionSource: "reflex" | "utility"; action: Action; candidates: ScoredCandidate[] | null }` — candidates non-null only for live utility decisions; hook fires after the decision, before `applyAction`; hook must not mutate (document).

- [ ] **Step 1: Write the failing tests**

`tests/candidates.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { scoreCandidates, pickBest, utilityDecide } from "../src/mind/utility.js";
import { runSim, type DecideInfo } from "../src/sim/engine.js";
import type { Observation } from "../src/mind/observe.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest();
const { identity, policy } = makeTestRoster(1)[0]!;

function obs(overrides: Partial<Observation> = {}): Observation {
  return {
    tick: 10,
    season: "summer",
    onShelter: false,
    self: { npcId: "npc-1", pos: { x: 5, y: 5 }, hp: 1000, energy: 300, berries: 1 },
    visibleBushes: [{ id: "bush-1", pos: { x: 6, y: 5 }, berries: 3, dist: 1 }],
    wolf: null,
    nearestShelter: { pos: { x: 2, y: 2 }, dist: 3 },
    ...overrides,
  };
}

describe("scoreCandidates", () => {
  it("returns all applicable candidates with integer scores in generation order", () => {
    const cands = scoreCandidates(obs(), identity, policy, manifest, "seed-1");
    expect(cands.map((c) => c.key)).toEqual(["consume", "forage", "explore", "idle"]);
    for (const c of cands) expect(Number.isSafeInteger(c.score)).toBe(true);
  });
  it("pickBest matches utilityDecide", () => {
    const o = obs();
    const cands = scoreCandidates(o, identity, policy, manifest, "seed-1");
    const best = pickBest(cands);
    const d = utilityDecide(o, identity, policy, manifest, "seed-1");
    expect(best.key).toBe(d.key);
    expect(best.action).toEqual(d.action);
  });
  it("pickBest resolves ties to the earlier candidate", () => {
    const cands = [
      { key: "consume" as const, score: 7, action: { verb: "consume" as const } },
      { key: "idle" as const, score: 7, action: { verb: "idle" as const } },
    ];
    expect(pickBest(cands).key).toBe("consume");
  });
});

describe("engine onDecide hook", () => {
  it("fires for every action with candidates on utility decisions and null on reflex", () => {
    const roster = makeTestRoster(3);
    const seen: DecideInfo[] = [];
    const r = runSim(manifest, roster, "seed-1", { ticks: 60, onDecide: (i) => seen.push(i) });
    expect(seen.length).toBe(r.actionLog.length);
    for (let i = 0; i < seen.length; i++) {
      expect(seen[i]!.tick).toBe(r.actionLog[i]!.tick);
      expect(seen[i]!.npcId).toBe(r.actionLog[i]!.npcId);
      expect(seen[i]!.action).toEqual(r.actionLog[i]!.action);
      if (seen[i]!.actionSource === "utility") {
        expect(Array.isArray(seen[i]!.candidates)).toBe(true);
        expect(seen[i]!.candidates!.length).toBeGreaterThan(0);
      } else {
        expect(seen[i]!.candidates).toBeNull();
      }
    }
  });
  it("hook does not perturb determinism", () => {
    const roster = makeTestRoster(5);
    const a = runSim(manifest, roster, "seed-1", { ticks: 200 });
    const b = runSim(manifest, roster, "seed-1", { ticks: 200, onDecide: () => {} });
    expect(a.checkpoints).toEqual(b.checkpoints);
    expect(a.actionLog).toEqual(b.actionLog);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/candidates.test.ts`
Expected: FAIL — `scoreCandidates` not exported.

- [ ] **Step 3: Refactor utility.ts**

In `src/mind/utility.ts`: rename the private `Candidate` interface to an exported `ScoredCandidate`; extract the candidate-building block of `utilityDecide` into:

```typescript
export interface ScoredCandidate { key: UtilityKey; score: number; action: Action }

/** All applicable candidates in fixed generation order (consume→forage→shelter→explore→idle). */
export function scoreCandidates(
  obs: Observation,
  identity: Identity,
  policy: Policy,
  manifest: WorldManifest,
  seedRoot: string,
): ScoredCandidate[] {
  // (move the existing candidate-construction code here verbatim, returning the array)
}

/** Strict > comparison; earliest candidate wins ties. */
export function pickBest(candidates: ScoredCandidate[]): ScoredCandidate {
  let best = candidates[0]!;
  for (const c of candidates) if (c.score > best.score) best = c;
  return best;
}

export function utilityDecide(
  obs: Observation, identity: Identity, policy: Policy, manifest: WorldManifest, seedRoot: string,
): { action: Action; key: UtilityKey } {
  const best = pickBest(scoreCandidates(obs, identity, policy, manifest, seedRoot));
  return { action: best.action, key: best.key };
}
```

The scoring formulas must not change — this is a pure extraction.

- [ ] **Step 4: Add the engine hook**

In `src/sim/engine.ts`: import `scoreCandidates`, `pickBest`, and the `ScoredCandidate` type. Add to `RunOptions`:

```typescript
/** Read-only observer of every NPC decision (after decide, before apply). MUST NOT mutate. */
onDecide?: (info: DecideInfo) => void;
```

with

```typescript
export interface DecideInfo {
  tick: number;
  npcId: string;
  observation: Observation;
  actionSource: "reflex" | "utility";
  action: Action;
  /** Scored utility candidates — null for reflex and injected decisions. */
  candidates: ScoredCandidate[] | null;
}
```

In the per-NPC loop, replace the live utility branch `utilityDecide(...)` call with `const cands = scoreCandidates(obs, entry.identity, entry.policy, manifest, seedRoot); const best = pickBest(cands); action = best.action; actionSource = "utility";` keeping `cands` in scope, and after the action is chosen (all three paths: injected / reflex / utility) call:

```typescript
opts.onDecide?.({
  tick: t, npcId: npc.npcId, observation: obs, actionSource, action,
  candidates: /* the utility path's cands, else */ null,
});
```

(Declare `let cands: ScoredCandidate[] | null = null;` before the branch so all paths share it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/candidates.test.ts && npm test && npm run typecheck`
Expected: new tests pass; all 75 existing tests still pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/mind/utility.ts src/sim/engine.ts tests/candidates.test.ts
git commit -m "feat: expose scored utility candidates and read-only engine onDecide hook"
```

---

### Task 2: Trigger harvesting

**Files:**
- Create: `src/bench/trigger.ts`
- Test: `tests/trigger.test.ts`

**Interfaces:**
- Consumes: `runSim` + `onDecide` (Task 1), `ScoredCandidate`.
- Produces:

```typescript
export interface TriggerPoint {
  id: string;                       // `${seedRoot}:${tick}:${npcId}`
  seedRoot: string;
  tick: number;
  npcId: string;
  observation: Observation;
  candidates: ScoredCandidate[];    // generation order, ≥2 entries
  bestIndex: number;                // index of pickBest in candidates
  gap: number;                      // best score − second-best score (≥0)
}
export function findTriggers(
  manifest: WorldManifest, roster: RosterEntry[], seedRoot: string,
  ticks: number, epsilon: number,
): TriggerPoint[];
```

A trigger is a live utility decision with ≥2 candidates whose top-2 score gap ≤ epsilon. `gap` computed from the two highest scores (ties allowed).

- [ ] **Step 1: Write the failing tests**

`tests/trigger.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { findTriggers } from "../src/bench/trigger.js";
import { pickBest } from "../src/mind/utility.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest();
const roster = makeTestRoster(5);

describe("findTriggers", () => {
  it("is deterministic", () => {
    const a = findTriggers(manifest, roster, "seed-1", 300, 100);
    const b = findTriggers(manifest, roster, "seed-1", 300, 100);
    expect(a).toEqual(b);
  });
  it("every trigger has ≥2 candidates, gap ≤ epsilon, and bestIndex matching pickBest", () => {
    const triggers = findTriggers(manifest, roster, "seed-1", 300, 100);
    expect(triggers.length).toBeGreaterThan(0);
    for (const tr of triggers) {
      expect(tr.candidates.length).toBeGreaterThanOrEqual(2);
      expect(tr.gap).toBeGreaterThanOrEqual(0);
      expect(tr.gap).toBeLessThanOrEqual(100);
      expect(tr.candidates[tr.bestIndex]).toEqual(pickBest(tr.candidates));
      expect(tr.id).toBe(`${tr.seedRoot}:${tr.tick}:${tr.npcId}`);
    }
  });
  it("epsilon 0 yields a subset of epsilon 100", () => {
    const tight = findTriggers(manifest, roster, "seed-1", 300, 0);
    const loose = findTriggers(manifest, roster, "seed-1", 300, 100);
    const looseIds = new Set(loose.map((t) => t.id));
    expect(tight.length).toBeLessThanOrEqual(loose.length);
    for (const t of tight) expect(looseIds.has(t.id)).toBe(true);
  });
  it("triggers are JSON-safe (integers/strings only)", () => {
    const [tr] = findTriggers(manifest, roster, "seed-1", 300, 100);
    expect(JSON.parse(JSON.stringify(tr))).toEqual(tr);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/trigger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/bench/trigger.ts`:

```typescript
import type { WorldManifest, RosterEntry } from "../schema/core.js";
import type { Observation } from "../mind/observe.js";
import type { ScoredCandidate } from "../mind/utility.js";
import { pickBest } from "../mind/utility.js";
import { runSim } from "../sim/engine.js";

export interface TriggerPoint {
  id: string;
  seedRoot: string;
  tick: number;
  npcId: string;
  observation: Observation;
  candidates: ScoredCandidate[];
  bestIndex: number;
  gap: number;
}

/** Harvest utility decisions whose top-2 score gap ≤ epsilon (deliberation trigger band). */
export function findTriggers(
  manifest: WorldManifest,
  roster: RosterEntry[],
  seedRoot: string,
  ticks: number,
  epsilon: number,
): TriggerPoint[] {
  const triggers: TriggerPoint[] = [];
  runSim(manifest, roster, seedRoot, {
    ticks,
    onDecide: (info) => {
      if (info.candidates === null || info.candidates.length < 2) return;
      const sorted = [...info.candidates].sort((a, b) => b.score - a.score);
      const gap = sorted[0]!.score - sorted[1]!.score;
      if (gap > epsilon) return;
      const best = pickBest(info.candidates);
      triggers.push({
        id: `${seedRoot}:${info.tick}:${info.npcId}`,
        seedRoot,
        tick: info.tick,
        npcId: info.npcId,
        observation: info.observation,
        candidates: info.candidates,
        bestIndex: info.candidates.indexOf(best),
        gap,
      });
    },
  });
  return triggers;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/trigger.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bench/trigger.ts tests/trigger.test.ts
git commit -m "feat: deliberation trigger harvesting via epsilon score-gap band"
```

---

### Task 3: Branch rollout evaluator + margin

**Files:**
- Create: `src/bench/rollout.ts`
- Test: `tests/rollout.test.ts`

**Interfaces:**
- Consumes: `runSim` (injection), `TriggerPoint` (Task 2), `hashCanonical`.
- Produces:

```typescript
export function actionsEqual(a: Action, b: Action): boolean;   // hashCanonical equality
export function evaluateBranch(
  manifest: WorldManifest, roster: RosterEntry[], trigger: TriggerPoint,
  forcedAction: Action, horizonTicks: number,
): number;                                                     // the margin (integer)
export interface PairResult { marginA: number; marginB: number; outcome: "A" | "B" | "tie" }
export function evaluatePair(
  manifest: WorldManifest, roster: RosterEntry[], trigger: TriggerPoint,
  actionA: Action, actionB: Action, horizonTicks: number,
): PairResult;
```

Margin (preregistered, Global Constraints): after re-running from t=1 with the single injected `(trigger.tick, trigger.npcId) → forcedAction` for `trigger.tick + horizonTicks` ticks: `alive ? 10_000 + hp + energy + 100*berries : (deathTick - trigger.tick)`. `evaluateBranch` must `throw` if the run halts (`haltedAtTick !== null`) — forced candidates are legal by construction, a halt is a bug.

- [ ] **Step 1: Write the failing tests**

`tests/rollout.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { evaluateBranch, evaluatePair, actionsEqual } from "../src/bench/rollout.js";
import { findTriggers } from "../src/bench/trigger.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest();
const roster = makeTestRoster(5);
const triggers = findTriggers(manifest, roster, "seed-1", 300, 100);

describe("rollout evaluation", () => {
  it("harvest produced triggers to evaluate", () => {
    expect(triggers.length).toBeGreaterThan(0);
  });
  it("is deterministic and returns integer margins", () => {
    const tr = triggers[0]!;
    const a1 = evaluateBranch(manifest, roster, tr, tr.candidates[tr.bestIndex]!.action, 100);
    const a2 = evaluateBranch(manifest, roster, tr, tr.candidates[tr.bestIndex]!.action, 100);
    expect(a1).toBe(a2);
    expect(Number.isSafeInteger(a1)).toBe(true);
  });
  it("evaluatePair classifies outcomes consistently with margins", () => {
    const tr = triggers.find((t) => t.candidates.length >= 2)!;
    const a = tr.candidates[0]!.action;
    const b = tr.candidates[1]!.action;
    const pair = evaluatePair(manifest, roster, tr, a, b, 100);
    if (pair.marginA > pair.marginB) expect(pair.outcome).toBe("A");
    else if (pair.marginA < pair.marginB) expect(pair.outcome).toBe("B");
    else expect(pair.outcome).toBe("tie");
  });
  it("identical forced actions produce a tie", () => {
    const tr = triggers[0]!;
    const a = tr.candidates[tr.bestIndex]!.action;
    const pair = evaluatePair(manifest, roster, tr, a, a, 100);
    expect(pair.outcome).toBe("tie");
    expect(pair.marginA).toBe(pair.marginB);
  });
  it("actionsEqual distinguishes actions structurally", () => {
    expect(actionsEqual({ verb: "idle" }, { verb: "idle" })).toBe(true);
    expect(actionsEqual({ verb: "idle" }, { verb: "consume" })).toBe(false);
    expect(actionsEqual({ verb: "move", to: { x: 1, y: 2 } }, { verb: "move", to: { x: 1, y: 3 } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/rollout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/bench/rollout.ts`:

```typescript
import type { WorldManifest, RosterEntry } from "../schema/core.js";
import type { Action } from "../schema/log.js";
import { runSim } from "../sim/engine.js";
import { hashCanonical } from "../canon/canonicalize.js";
import type { TriggerPoint } from "./trigger.js";

export function actionsEqual(a: Action, b: Action): boolean {
  return hashCanonical(a) === hashCanonical(b);
}

/**
 * Shadow branch rollout: re-run deterministically from t=1 with exactly one
 * injected action at (trigger.tick, trigger.npcId), continue horizonTicks past
 * the trigger, and score the NPC's outcome. Preregistered margin:
 *   alive ? 10_000 + hp + energy + 100*berries : (deathTick - triggerTick)
 */
export function evaluateBranch(
  manifest: WorldManifest,
  roster: RosterEntry[],
  trigger: TriggerPoint,
  forcedAction: Action,
  horizonTicks: number,
): number {
  const injected = new Map([
    [`${trigger.tick}:${trigger.npcId}`, { action: forcedAction, actionSource: "utility" as const }],
  ]);
  const r = runSim(manifest, roster, trigger.seedRoot, {
    ticks: trigger.tick + horizonTicks,
    injectedActions: injected,
  });
  if (r.haltedAtTick !== null) {
    throw new Error(
      `rollout halted at tick ${r.haltedAtTick} — forced action was illegal for ${trigger.id}`,
    );
  }
  const npc = r.finalState.npcs.find((n) => n.npcId === trigger.npcId);
  if (npc === undefined) throw new Error(`npc ${trigger.npcId} missing from rollout`);
  return npc.alive
    ? 10_000 + npc.hp + npc.energy + 100 * npc.berries
    : (npc.deathTick ?? trigger.tick) - trigger.tick;
}

export interface PairResult { marginA: number; marginB: number; outcome: "A" | "B" | "tie" }

export function evaluatePair(
  manifest: WorldManifest,
  roster: RosterEntry[],
  trigger: TriggerPoint,
  actionA: Action,
  actionB: Action,
  horizonTicks: number,
): PairResult {
  const marginA = evaluateBranch(manifest, roster, trigger, actionA, horizonTicks);
  const marginB = evaluateBranch(manifest, roster, trigger, actionB, horizonTicks);
  return { marginA, marginB, outcome: marginA > marginB ? "A" : marginA < marginB ? "B" : "tie" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/rollout.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bench/rollout.ts tests/rollout.test.ts
git commit -m "feat: shadow branch rollout evaluator with preregistered margin"
```

---

### Task 4: Stats — Wilson interval + percentile

**Files:**
- Create: `src/bench/stats.ts`
- Test: `tests/stats.test.ts`

**Interfaces:**
- Produces: `wilson(wins: number, n: number, z?: number): { p: number; lo: number; hi: number }` (Wilson score interval, default z=1.96; n=0 → {p:0, lo:0, hi:1}); `percentile(xs: number[], q: number): number` (nearest-rank on a sorted copy, q in [0,100]; empty → NaN). Floats are fine here — stats are never hashed.

- [ ] **Step 1: Write the failing tests**

`tests/stats.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { wilson, percentile } from "../src/bench/stats.js";

describe("wilson", () => {
  it("50/100 brackets 0.5 roughly ±0.10", () => {
    const { p, lo, hi } = wilson(50, 100);
    expect(p).toBe(0.5);
    expect(lo).toBeGreaterThan(0.40);
    expect(lo).toBeLessThan(0.45);
    expect(hi).toBeGreaterThan(0.55);
    expect(hi).toBeLessThan(0.60);
  });
  it("extremes stay within [0,1]", () => {
    expect(wilson(0, 20).lo).toBe(0);
    expect(wilson(20, 20).hi).toBe(1);
    expect(wilson(20, 20).lo).toBeGreaterThan(0.8);
  });
  it("n=0 is the vacuous interval", () => {
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1 });
  });
  it("larger n narrows the interval", () => {
    const small = wilson(55, 100);
    const large = wilson(550, 1000);
    expect(large.hi - large.lo).toBeLessThan(small.hi - small.lo);
  });
  it("the preregistered gate example: 180/300 wins passes, 165/300 does not", () => {
    const pass = wilson(180, 300);   // p=0.60
    expect(pass.p).toBeGreaterThanOrEqual(0.55);
    expect(pass.lo).toBeGreaterThan(0.50);
    const fail = wilson(165, 300);   // p=0.55 but CI includes 0.50
    expect(fail.lo).toBeLessThanOrEqual(0.50);
  });
});

describe("percentile", () => {
  it("nearest-rank behaviour", () => {
    const xs = [5, 1, 3, 2, 4];
    expect(percentile(xs, 50)).toBe(3);
    expect(percentile(xs, 100)).toBe(5);
    expect(percentile(xs, 1)).toBe(1);
  });
  it("does not mutate input and handles empty", () => {
    const xs = [3, 1, 2];
    percentile(xs, 50);
    expect(xs).toEqual([3, 1, 2]);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/stats.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/bench/stats.ts`:

```typescript
/** Wilson score interval for a binomial proportion. Stats module — floats allowed. */
export function wilson(wins: number, n: number, z = 1.96): { p: number; lo: number; hi: number } {
  if (n === 0) return { p: 0, lo: 0, hi: 1 };
  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

/** Nearest-rank percentile on a sorted copy; q in [0,100]. Empty input → NaN. */
export function percentile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((q / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/stats.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bench/stats.ts tests/stats.test.ts
git commit -m "feat: wilson interval and percentile for benchmark statistics"
```

---

### Task 5: Prompt rendering with deterministic shuffle

**Files:**
- Create: `src/bench/prompt.ts`
- Test: `tests/prompt.test.ts`

**Interfaces:**
- Consumes: `TriggerPoint`, `drawInt`, roster entry (for name/voice — name only in Phase 0).
- Produces:

```typescript
export const PROMPT_VERSION = "bench-v1";
export interface RenderedPrompt {
  system: string;
  user: string;
  schema: Record<string, unknown>;   // JSON schema for {choice, reason}
  order: number[];                   // order[displayIndex] = original candidate index
}
export function shuffleOrder(trigger: TriggerPoint): number[];  // deterministic Fisher-Yates keyed by trigger.id
export function renderPrompt(trigger: TriggerPoint, npcName: string): RenderedPrompt;
export function describeAction(c: ScoredCandidate): string;     // neutral text, no scores
```

Candidates are displayed 1..N in shuffled order; `order` maps display position back to the original index. The rendered text must never contain the word "score" or any numeric utility value.

- [ ] **Step 1: Write the failing tests**

`tests/prompt.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderPrompt, shuffleOrder, PROMPT_VERSION } from "../src/bench/prompt.js";
import { findTriggers } from "../src/bench/trigger.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest();
const roster = makeTestRoster(5);
const triggers = findTriggers(manifest, roster, "seed-1", 300, 100);

describe("prompt rendering", () => {
  it("shuffle is a deterministic permutation keyed by trigger id", () => {
    const tr = triggers[0]!;
    const a = shuffleOrder(tr);
    const b = shuffleOrder(tr);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(tr.candidates.map((_, i) => i));
  });
  it("different triggers get different shuffles somewhere in the harvest", () => {
    const multi = triggers.filter((t) => t.candidates.length >= 3);
    const distinct = new Set(multi.map((t) => shuffleOrder(t).join(",")));
    expect(distinct.size).toBeGreaterThan(1);
  });
  it("renders every candidate exactly once, numbered from 1, with no score leakage", () => {
    const tr = triggers.find((t) => t.candidates.length >= 2)!;
    const p = renderPrompt(tr, "Rill");
    for (let i = 1; i <= tr.candidates.length; i++) expect(p.user).toContain(`${i}.`);
    expect(p.user.toLowerCase()).not.toContain("score");
    for (const c of tr.candidates) expect(p.user).not.toContain(`(${c.score})`);
    expect(p.order.length).toBe(tr.candidates.length);
  });
  it("schema bounds choice to the candidate count", () => {
    const tr = triggers[0]!;
    const p = renderPrompt(tr, "Rill");
    const choice = (p.schema["properties"] as Record<string, { maximum: number; minimum: number }>)["choice"]!;
    expect(choice.minimum).toBe(1);
    expect(choice.maximum).toBe(tr.candidates.length);
  });
  it("mentions survival context: season, energy, and the npc name", () => {
    const tr = triggers[0]!;
    const p = renderPrompt(tr, "Rill");
    expect(p.user).toContain(tr.observation.season);
    expect(p.system).toContain("Rill");
    expect(PROMPT_VERSION).toBe("bench-v1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/bench/prompt.ts`:

```typescript
import { drawInt } from "../rng/rng.js";
import type { ScoredCandidate } from "../mind/utility.js";
import type { TriggerPoint } from "./trigger.js";

export const PROMPT_VERSION = "bench-v1";

export interface RenderedPrompt {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  order: number[];
}

/** Deterministic Fisher-Yates keyed by trigger id — kills position bias without entropy. */
export function shuffleOrder(trigger: TriggerPoint): number[] {
  const order = trigger.candidates.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = drawInt(trigger.seedRoot, i + 1, "shuffle", trigger.id, i);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/** Neutral action description — never includes scores or utility hints. */
export function describeAction(c: ScoredCandidate): string {
  const a = c.action;
  switch (a.verb) {
    case "move":
      return `walk one step to (${a.to.x}, ${a.to.y}) — heading ${c.key === "shelter" ? "toward shelter" : c.key === "forage" ? "toward a berry bush" : "somewhere new"}`;
    case "take":
      return `pick a berry from the bush right here (${a.target})`;
    case "consume":
      return `eat one of the berries you are carrying`;
    case "flee":
      return `run away from the wolf`;
    case "idle":
      return `stay put and do nothing this turn`;
  }
}

export function renderPrompt(trigger: TriggerPoint, npcName: string): RenderedPrompt {
  const obs = trigger.observation;
  const order = shuffleOrder(trigger);
  const lines: string[] = [];
  lines.push(`It is ${obs.season}. Your health is ${obs.self.hp}/1000, energy ${obs.self.energy}/1000, and you carry ${obs.self.berries} berries.`);
  lines.push(obs.onShelter ? `You are inside a shelter.` : `You are outdoors${obs.nearestShelter ? `, ${obs.nearestShelter.dist} steps from the nearest shelter` : ""}.`);
  if (obs.visibleBushes.length > 0) {
    lines.push(`Berry bushes in sight: ${obs.visibleBushes.map((b) => `${b.id} (${b.dist} steps away, ${b.berries} berries)`).join("; ")}.`);
  } else {
    lines.push(`No berry bushes in sight.`);
  }
  lines.push(obs.wolf ? `A wolf is ${obs.wolf.dist} steps away.` : `No wolf in sight.`);
  lines.push(``);
  lines.push(`Your options:`);
  order.forEach((origIdx, displayIdx) => {
    lines.push(`${displayIdx + 1}. ${describeAction(trigger.candidates[origIdx]!)}`);
  });
  lines.push(``);
  lines.push(`Which option is best for your long-term survival? Answer with JSON: {"choice": <number>, "reason": "<one short sentence>"}.`);
  return {
    system: `You are ${npcName}, a villager surviving in a small world with seasons, food scarcity, and a predator. Winters are cold and drain health outdoors. Starving drains health. Think practically about survival. Respond with JSON only.`,
    user: lines.join("\n"),
    schema: {
      type: "object",
      properties: {
        choice: { type: "integer", minimum: 1, maximum: trigger.candidates.length },
        reason: { type: "string", maxLength: 200 },
      },
      required: ["choice", "reason"],
    },
    order,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/prompt.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bench/prompt.ts tests/prompt.test.ts
git commit -m "feat: neutral prompt rendering with deterministic candidate shuffle"
```

---

### Task 6: DeliberationRuntime interface — Ollama + Mock

**Files:**
- Create: `src/bench/runtime.ts`
- Test: `tests/runtime.test.ts`

**Interfaces:**
- Produces:

```typescript
export interface DeliberationOutcome {
  choice: number | null;            // 1-based display index, null on any failure
  reason: string | null;
  latencyMs: number;
  tokensIn: number;                 // 0 when unavailable
  tokensOut: number;
  error: string | null;             // null on success; "timeout" | "http:<status>" | "parse" | "range"
}
export interface DeliberationRuntime {
  readonly name: string;            // e.g. "ollama"
  readonly model: string;           // e.g. "qwen3:0.6b"
  decide(p: RenderedPrompt, timeoutMs: number): Promise<DeliberationOutcome>;
}
export class OllamaRuntime implements DeliberationRuntime {
  constructor(model: string, baseUrl?: string, fetchImpl?: typeof fetch);
}
export class MockRuntime implements DeliberationRuntime {
  constructor(pick: (p: RenderedPrompt) => number | null);   // returns display choice or null=failure
}
```

OllamaRuntime POSTs `{baseUrl}/api/chat` with `{ model, messages: [{role:"system"...},{role:"user"...}], stream: false, format: p.schema, think: false, options: { temperature: 0, num_predict: 256 } }`, aborts via `AbortSignal.timeout(timeoutMs)`, parses `message.content` as JSON, validates `choice` is an integer within `[1, max]` from the schema, and reads usage from `prompt_eval_count`/`eval_count`. Any failure → `choice: null` with the error tag (timeout → "timeout", non-2xx → "http:<status>", JSON/shape failure → "parse", out-of-range → "range"). Never throws.

- [ ] **Step 1: Write the failing tests**

`tests/runtime.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { OllamaRuntime, MockRuntime } from "../src/bench/runtime.js";
import type { RenderedPrompt } from "../src/bench/prompt.js";

const prompt: RenderedPrompt = {
  system: "sys",
  user: "user",
  schema: { type: "object", properties: { choice: { type: "integer", minimum: 1, maximum: 3 }, reason: { type: "string" } }, required: ["choice", "reason"] },
  order: [2, 0, 1],
};

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("OllamaRuntime", () => {
  it("parses a valid response with usage", async () => {
    const rt = new OllamaRuntime("qwen3:0.6b", "http://x", fakeFetch({
      message: { content: '{"choice": 2, "reason": "safer"}' },
      prompt_eval_count: 120,
      eval_count: 15,
    }));
    const r = await rt.decide(prompt, 5000);
    expect(r).toMatchObject({ choice: 2, reason: "safer", tokensIn: 120, tokensOut: 15, error: null });
  });
  it("rejects out-of-range choices as error 'range'", async () => {
    const rt = new OllamaRuntime("m", "http://x", fakeFetch({ message: { content: '{"choice": 9, "reason": "x"}' } }));
    const r = await rt.decide(prompt, 5000);
    expect(r.choice).toBeNull();
    expect(r.error).toBe("range");
  });
  it("tags unparseable content as 'parse'", async () => {
    const rt = new OllamaRuntime("m", "http://x", fakeFetch({ message: { content: "I think option 2" } }));
    const r = await rt.decide(prompt, 5000);
    expect(r.error).toBe("parse");
  });
  it("tags non-2xx as http error", async () => {
    const rt = new OllamaRuntime("m", "http://x", fakeFetch({}, 500));
    const r = await rt.decide(prompt, 5000);
    expect(r.error).toBe("http:500");
  });
  it("sends think:false, temperature 0, and the schema as format", async () => {
    let captured: unknown;
    const spy: typeof fetch = (async (_url: unknown, init?: RequestInit) => {
      captured = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ message: { content: '{"choice":1,"reason":"r"}' } }), { status: 200 });
    }) as unknown as typeof fetch;
    await new OllamaRuntime("qwen3:4b", "http://x", spy).decide(prompt, 5000);
    const b = captured as Record<string, unknown>;
    expect(b["think"]).toBe(false);
    expect((b["options"] as Record<string, unknown>)["temperature"]).toBe(0);
    expect(b["format"]).toEqual(prompt.schema);
    expect(b["model"]).toBe("qwen3:4b");
    expect(b["stream"]).toBe(false);
  });
});

describe("MockRuntime", () => {
  it("returns the configured pick with zero latency accounting", async () => {
    const rt = new MockRuntime(() => 3);
    const r = await rt.decide(prompt, 1000);
    expect(r.choice).toBe(3);
    expect(r.error).toBeNull();
  });
  it("null pick becomes a parse failure", async () => {
    const rt = new MockRuntime(() => null);
    const r = await rt.decide(prompt, 1000);
    expect(r.choice).toBeNull();
    expect(r.error).toBe("parse");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/runtime.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/bench/runtime.ts`:

```typescript
import type { RenderedPrompt } from "./prompt.js";

export interface DeliberationOutcome {
  choice: number | null;
  reason: string | null;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  error: string | null;
}

export interface DeliberationRuntime {
  readonly name: string;
  readonly model: string;
  decide(p: RenderedPrompt, timeoutMs: number): Promise<DeliberationOutcome>;
}

function maxChoice(p: RenderedPrompt): number {
  const props = p.schema["properties"] as Record<string, { maximum?: number }> | undefined;
  return props?.["choice"]?.maximum ?? p.order.length;
}

export class OllamaRuntime implements DeliberationRuntime {
  readonly name = "ollama";
  constructor(
    readonly model: string,
    private readonly baseUrl = "http://localhost:11434",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async decide(p: RenderedPrompt, timeoutMs: number): Promise<DeliberationOutcome> {
    const started = Date.now();
    const fail = (error: string): DeliberationOutcome => ({
      choice: null, reason: null, latencyMs: Date.now() - started, tokensIn: 0, tokensOut: 0, error,
    });
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: p.system },
            { role: "user", content: p.user },
          ],
          stream: false,
          format: p.schema,
          think: false,
          options: { temperature: 0, num_predict: 256 },
        }),
      });
    } catch {
      return fail("timeout");
    }
    if (!res.ok) return fail(`http:${res.status}`);
    let body: { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    let parsed: { choice?: unknown; reason?: unknown };
    try {
      body = (await res.json()) as typeof body;
      parsed = JSON.parse(body.message?.content ?? "") as typeof parsed;
    } catch {
      return fail("parse");
    }
    const latencyMs = Date.now() - started;
    const tokensIn = body.prompt_eval_count ?? 0;
    const tokensOut = body.eval_count ?? 0;
    const choice = parsed.choice;
    if (typeof choice !== "number" || !Number.isInteger(choice)) {
      return { choice: null, reason: null, latencyMs, tokensIn, tokensOut, error: "parse" };
    }
    if (choice < 1 || choice > maxChoice(p)) {
      return { choice: null, reason: null, latencyMs, tokensIn, tokensOut, error: "range" };
    }
    return {
      choice,
      reason: typeof parsed.reason === "string" ? parsed.reason : null,
      latencyMs, tokensIn, tokensOut, error: null,
    };
  }
}

/** Test double — never touches the network. */
export class MockRuntime implements DeliberationRuntime {
  readonly name = "mock";
  readonly model = "mock";
  constructor(private readonly pick: (p: RenderedPrompt) => number | null) {}
  async decide(p: RenderedPrompt, _timeoutMs: number): Promise<DeliberationOutcome> {
    const choice = this.pick(p);
    if (choice === null) {
      return { choice: null, reason: null, latencyMs: 0, tokensIn: 0, tokensOut: 0, error: "parse" };
    }
    return { choice, reason: "mock", latencyMs: 0, tokensIn: 0, tokensOut: 0, error: null };
  }
}
```

Note: `Date.now()` here is measurement instrumentation in the benchmark layer (never enters hashed structures or world state). The kernel's no-entropy rule is about simulation determinism; document this exception with a comment at the top of the file: `// Benchmark instrumentation layer: wall-clock latency measurement only. Nothing here enters canonical world state or hashes.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/runtime.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bench/runtime.ts tests/runtime.test.ts
git commit -m "feat: deliberation runtime interface with ollama and mock implementations"
```

---

### Task 7: Benchmark orchestrator with resumable persistence

**Files:**
- Create: `src/bench/orchestrate.ts`
- Test: `tests/orchestrate.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:

```typescript
export interface BenchParams {
  seeds: string[];                  // e.g. ["bench-1", ..., "bench-8"]
  ticks: number;                    // sim length per seed for harvesting
  epsilon: number;                  // trigger band
  horizonTicks: number;             // rollout horizon H
  timeoutMs: number;                // per LLM call
  capPerSeed: number;               // max triggers taken per seed (head of list)
}
export interface TrialRecord {
  triggerId: string;
  model: string;
  displayChoice: number | null;     // raw LLM answer
  chosenIndex: number | null;       // mapped back through order
  agreed: boolean | null;           // chosen action equals utility best (null on failure)
  outcome: "win" | "loss" | "tie" | null;  // rollout result vs utility-best (null unless divergent)
  marginLlm: number | null;
  marginBest: number | null;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  error: string | null;
}
export interface ModelSummary {
  model: string;
  trials: number; failures: number; agreements: number;
  divergent: number; wins: number; losses: number; ties: number;
  winRate: { p: number; lo: number; hi: number };   // over wins+losses
  latencyP50: number; latencyP95: number;
  tokensInMean: number; tokensOutMean: number;
  verdict: "gain" | "no-gain" | "insufficient-n";
}
export function harvestAll(manifest, roster, params): TriggerPoint[];
export function runBenchForModel(
  manifest, roster, params, triggers, runtime: DeliberationRuntime,
  persistPath: string | null,       // JSONL appended per trial; existing trialKeys skipped on resume
  onProgress?: (done: number, total: number) => void,
): Promise<TrialRecord[]>;
export function summarize(model: string, trials: TrialRecord[], minDivergent: number): ModelSummary;
export function randomArmSummary(manifest, roster, params, triggers): ModelSummary;  // control: deterministic random non-best pick, model "random-control"
```

Rules: trial key = `${model}|${triggerId}`. `runBenchForModel` loads `persistPath` (if exists) as JSONL, skips already-recorded keys, appends each new trial as one JSON line (crash-resumable). Failure (choice null) → `agreed: null, outcome: null`. Agreement uses `actionsEqual(chosen.action, candidates[bestIndex].action)` — value equality, not index equality (duplicate actions under different keys count as agreement). Verdict: "insufficient-n" if wins+losses < minDivergent; "gain" if `p ≥ 0.55 && lo > 0.50`; else "no-gain". Random arm: for each trigger with ≥2 candidates, pick index `drawInt(seedRoot, len-1, "randarm", triggerId)` from the non-best candidates (skip bestIndex by offset), evaluate the same way (no LLM, no persistence).

- [ ] **Step 1: Write the failing tests**

`tests/orchestrate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harvestAll, runBenchForModel, summarize, randomArmSummary } from "../src/bench/orchestrate.js";
import { MockRuntime } from "../src/bench/runtime.js";
import { actionsEqual } from "../src/bench/rollout.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import type { BenchParams } from "../src/bench/orchestrate.js";

const manifest = makeTestManifest();
const roster = makeTestRoster(5);
const params: BenchParams = {
  seeds: ["bench-a", "bench-b"],
  ticks: 200,
  epsilon: 100,
  horizonTicks: 50,
  timeoutMs: 1000,
  capPerSeed: 10,
};

describe("orchestrator", () => {
  const triggers = harvestAll(manifest, roster, params);

  it("harvests across seeds with the per-seed cap", () => {
    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers.length).toBeLessThanOrEqual(params.seeds.length * params.capPerSeed);
    expect(new Set(triggers.map((t) => t.seedRoot)).size).toBeGreaterThan(1);
  });

  it("a best-picking mock agrees on every trial and yields zero divergent", async () => {
    const rt = new MockRuntime((p) => {
      // pick the display position that maps to... we don't know bestIndex here; pick 1 and let test below cover divergence
      return 1;
    });
    const trials = await runBenchForModel(manifest, roster, params, triggers, rt, null);
    expect(trials.length).toBe(triggers.length);
    for (const tr of trials) {
      expect(tr.error).toBeNull();
      expect(tr.chosenIndex).not.toBeNull();
      // agreement must equal action-equality with the best candidate
      const trigger = triggers.find((g) => g.id === tr.triggerId)!;
      const expected = actionsEqual(
        trigger.candidates[tr.chosenIndex!]!.action,
        trigger.candidates[trigger.bestIndex]!.action,
      );
      expect(tr.agreed).toBe(expected);
      if (tr.agreed) expect(tr.outcome).toBeNull();
      else expect(["win", "loss", "tie"]).toContain(tr.outcome);
    }
  });

  it("persists trials as JSONL and resumes without re-running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-"));
    const file = join(dir, "trials.jsonl");
    const rt = new MockRuntime(() => 1);
    const first = await runBenchForModel(manifest, roster, params, triggers, rt, file);
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines.length).toBe(first.length);
    let called = 0;
    const counting = new MockRuntime(() => { called++; return 1; });
    const second = await runBenchForModel(manifest, roster, params, triggers, counting, file);
    expect(called).toBe(0);                    // everything resumed from disk
    expect(second.length).toBe(first.length);
    rmSync(dir, { recursive: true, force: true });
  });

  it("summarize computes verdicts per the preregistered gate", () => {
    const mk = (outcome: "win" | "loss" | "tie" | null, agreed: boolean | null): Parameters<typeof summarize>[1][number] => ({
      triggerId: "x", model: "m", displayChoice: 1, chosenIndex: 0, agreed,
      outcome, marginLlm: 0, marginBest: 0, latencyMs: 10, tokensIn: 5, tokensOut: 2, error: agreed === null ? "parse" : null,
    });
    const wins = Array.from({ length: 180 }, () => mk("win", false));
    const losses = Array.from({ length: 120 }, () => mk("loss", false));
    const s = summarize("m", [...wins, ...losses], 100);
    expect(s.divergent).toBe(300);
    expect(s.verdict).toBe("gain");            // 180/300 = 0.60, lo > 0.50
    const s2 = summarize("m", [...wins.slice(0, 30), ...losses.slice(0, 30)], 100);
    expect(s2.verdict).toBe("insufficient-n");
    const s3 = summarize("m", [...Array.from({ length: 150 }, () => mk("win", false)), ...Array.from({ length: 150 }, () => mk("loss", false))], 100);
    expect(s3.verdict).toBe("no-gain");        // 0.50
  });

  it("random-arm control runs without any runtime and is deterministic", () => {
    const a = randomArmSummary(manifest, roster, params, triggers);
    const b = randomArmSummary(manifest, roster, params, triggers);
    expect(a).toEqual(b);
    expect(a.model).toBe("random-control");
    expect(a.divergent).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/orchestrate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/bench/orchestrate.ts`:

```typescript
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { WorldManifest, RosterEntry } from "../schema/core.js";
import { findTriggers, type TriggerPoint } from "./trigger.js";
import { renderPrompt } from "./prompt.js";
import { evaluatePair, actionsEqual } from "./rollout.js";
import { wilson, percentile } from "./stats.js";
import { drawInt } from "../rng/rng.js";
import type { DeliberationRuntime } from "./runtime.js";

export interface BenchParams {
  seeds: string[];
  ticks: number;
  epsilon: number;
  horizonTicks: number;
  timeoutMs: number;
  capPerSeed: number;
}

export interface TrialRecord {
  triggerId: string;
  model: string;
  displayChoice: number | null;
  chosenIndex: number | null;
  agreed: boolean | null;
  outcome: "win" | "loss" | "tie" | null;
  marginLlm: number | null;
  marginBest: number | null;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  error: string | null;
}

export interface ModelSummary {
  model: string;
  trials: number;
  failures: number;
  agreements: number;
  divergent: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: { p: number; lo: number; hi: number };
  latencyP50: number;
  latencyP95: number;
  tokensInMean: number;
  tokensOutMean: number;
  verdict: "gain" | "no-gain" | "insufficient-n";
}

export function harvestAll(
  manifest: WorldManifest, roster: RosterEntry[], params: BenchParams,
): TriggerPoint[] {
  const all: TriggerPoint[] = [];
  for (const seed of params.seeds) {
    all.push(...findTriggers(manifest, roster, seed, params.ticks, params.epsilon).slice(0, params.capPerSeed));
  }
  return all;
}

function npcName(roster: RosterEntry[], npcId: string): string {
  return roster.find((r) => r.npcId === npcId)?.name ?? npcId;
}

function evaluateDivergent(
  manifest: WorldManifest, roster: RosterEntry[], params: BenchParams,
  trigger: TriggerPoint, chosenIndex: number,
): Pick<TrialRecord, "outcome" | "marginLlm" | "marginBest"> {
  const pair = evaluatePair(
    manifest, roster, trigger,
    trigger.candidates[chosenIndex]!.action,
    trigger.candidates[trigger.bestIndex]!.action,
    params.horizonTicks,
  );
  return {
    outcome: pair.outcome === "A" ? "win" : pair.outcome === "B" ? "loss" : "tie",
    marginLlm: pair.marginA,
    marginBest: pair.marginB,
  };
}

export async function runBenchForModel(
  manifest: WorldManifest, roster: RosterEntry[], params: BenchParams,
  triggers: TriggerPoint[], runtime: DeliberationRuntime,
  persistPath: string | null,
  onProgress?: (done: number, total: number) => void,
): Promise<TrialRecord[]> {
  const done = new Map<string, TrialRecord>();
  if (persistPath !== null && existsSync(persistPath)) {
    for (const line of readFileSync(persistPath, "utf8").split("\n")) {
      if (line.length === 0) continue;
      const rec = JSON.parse(line) as TrialRecord;
      done.set(`${rec.model}|${rec.triggerId}`, rec);
    }
  }
  const results: TrialRecord[] = [];
  let processed = 0;
  for (const trigger of triggers) {
    const key = `${runtime.model}|${trigger.id}`;
    const cached = done.get(key);
    if (cached !== undefined) {
      results.push(cached);
      onProgress?.(++processed, triggers.length);
      continue;
    }
    const prompt = renderPrompt(trigger, npcName(roster, trigger.npcId));
    const out = await runtime.decide(prompt, params.timeoutMs);
    let rec: TrialRecord;
    if (out.choice === null) {
      rec = {
        triggerId: trigger.id, model: runtime.model, displayChoice: null, chosenIndex: null,
        agreed: null, outcome: null, marginLlm: null, marginBest: null,
        latencyMs: out.latencyMs, tokensIn: out.tokensIn, tokensOut: out.tokensOut, error: out.error,
      };
    } else {
      const chosenIndex = prompt.order[out.choice - 1]!;
      const agreed = actionsEqual(
        trigger.candidates[chosenIndex]!.action,
        trigger.candidates[trigger.bestIndex]!.action,
      );
      rec = {
        triggerId: trigger.id, model: runtime.model, displayChoice: out.choice, chosenIndex,
        agreed,
        ...(agreed
          ? { outcome: null, marginLlm: null, marginBest: null }
          : evaluateDivergent(manifest, roster, params, trigger, chosenIndex)),
        latencyMs: out.latencyMs, tokensIn: out.tokensIn, tokensOut: out.tokensOut, error: null,
      };
    }
    if (persistPath !== null) appendFileSync(persistPath, JSON.stringify(rec) + "\n");
    results.push(rec);
    onProgress?.(++processed, triggers.length);
  }
  return results;
}

export function summarize(model: string, trials: TrialRecord[], minDivergent: number): ModelSummary {
  const failures = trials.filter((t) => t.error !== null).length;
  const agreements = trials.filter((t) => t.agreed === true).length;
  const wins = trials.filter((t) => t.outcome === "win").length;
  const losses = trials.filter((t) => t.outcome === "loss").length;
  const ties = trials.filter((t) => t.outcome === "tie").length;
  const divergent = wins + losses + ties;
  const decisive = wins + losses;
  const winRate = wilson(wins, decisive);
  const latencies = trials.map((t) => t.latencyMs);
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const verdict: ModelSummary["verdict"] =
    decisive < minDivergent ? "insufficient-n"
    : winRate.p >= 0.55 && winRate.lo > 0.50 ? "gain"
    : "no-gain";
  return {
    model, trials: trials.length, failures, agreements, divergent, wins, losses, ties,
    winRate, latencyP50: percentile(latencies, 50), latencyP95: percentile(latencies, 95),
    tokensInMean: mean(trials.map((t) => t.tokensIn)), tokensOutMean: mean(trials.map((t) => t.tokensOut)),
    verdict,
  };
}

/** Deterministic control arm: a random non-best candidate, no LLM. Sanity floor. */
export function randomArmSummary(
  manifest: WorldManifest, roster: RosterEntry[], params: BenchParams, triggers: TriggerPoint[],
): ModelSummary {
  const trials: TrialRecord[] = triggers.map((trigger) => {
    const n = trigger.candidates.length;
    const offset = drawInt(trigger.seedRoot, n - 1, "randarm", trigger.id);
    const chosenIndex = (trigger.bestIndex + 1 + offset) % n;
    const agreed = actionsEqual(
      trigger.candidates[chosenIndex]!.action,
      trigger.candidates[trigger.bestIndex]!.action,
    );
    return {
      triggerId: trigger.id, model: "random-control", displayChoice: null, chosenIndex,
      agreed,
      ...(agreed
        ? { outcome: null as const, marginLlm: null, marginBest: null }
        : evaluateDivergent(manifest, roster, params, trigger, chosenIndex)),
      latencyMs: 0, tokensIn: 0, tokensOut: 0, error: null,
    };
  });
  return summarize("random-control", trials, 1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/orchestrate.test.ts && npm test && npm run typecheck`
Expected: all PASS (full suite; no network access anywhere).

- [ ] **Step 5: Commit**

```bash
git add src/bench/orchestrate.ts tests/orchestrate.test.ts
git commit -m "feat: benchmark orchestrator with resumable persistence and random-arm control"
```

---

### Task 8: Bench CLI + report rendering

**Files:**
- Create: `src/bench/report.ts`, `src/cli/bench.ts`
- Modify: `package.json` (add `"bench": "tsx src/cli/bench.ts"` script)
- Test: `tests/report.test.ts`

**Interfaces:**
- Produces: `renderReportMd(summaries: ModelSummary[], params: BenchParams, meta: { promptVersion: string; triggerCount: number; startedAt: string }): string` — a markdown table (model, trials, failures, agreement rate, divergent n, W/L/T, win rate with CI, verdict, p50/p95 latency, mean tokens) with the preregistered gate stated above the table and an honest MDE note (n=300 → ~58% at 80% power). CLI usage:

```
npm run bench -- [--models qwen3:0.6b,qwen3:1.7b,qwen3:4b] [--seeds 8] [--ticks 800]
                 [--epsilon 60] [--horizon 100] [--cap 200] [--timeout 30000]
                 [--out runs/bench-<label>] [--label official-v1] [--harvest-only]
```

CLI flow: build demo manifest/roster (`makeDemoManifest`/`makeDemoRoster("bench-roster")` from `src/cli/demo.ts`); seeds are `bench-1..bench-N`; harvest; `--harvest-only` prints trigger counts, per-seed and gap distribution, then exits 0 (calibration mode); otherwise for each model sequentially: `runBenchForModel` persisting to `<out>/trials-<model-sanitized>.jsonl` with a progress line; then `randomArmSummary`; write `<out>/report.json` (params + meta + all summaries) and `<out>/report.md`; print the markdown to stdout. `startedAt` = `new Date().toISOString()` (CLI instrumentation layer — same documented exception as runtime.ts).

- [ ] **Step 1: Write the failing tests**

`tests/report.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderReportMd } from "../src/bench/report.js";
import type { ModelSummary, BenchParams } from "../src/bench/orchestrate.js";

const params: BenchParams = {
  seeds: ["bench-1"], ticks: 800, epsilon: 60, horizonTicks: 100, timeoutMs: 30000, capPerSeed: 200,
};
const summary: ModelSummary = {
  model: "qwen3:0.6b", trials: 200, failures: 4, agreements: 90,
  divergent: 106, wins: 60, losses: 40, ties: 6,
  winRate: { p: 0.6, lo: 0.52, hi: 0.68 },
  latencyP50: 900, latencyP95: 2500, tokensInMean: 250, tokensOutMean: 30,
  verdict: "gain",
};

describe("renderReportMd", () => {
  const md = renderReportMd([summary], params, {
    promptVersion: "bench-v1", triggerCount: 200, startedAt: "2026-07-21T00:00:00Z",
  });
  it("contains the preregistered gate and MDE note", () => {
    expect(md).toContain("0.55");
    expect(md).toContain("0.50");
    expect(md.toLowerCase()).toContain("power");
  });
  it("tabulates the model row with verdict and CI", () => {
    expect(md).toContain("qwen3:0.6b");
    expect(md).toContain("gain");
    expect(md).toContain("0.52");
    expect(md).toContain("60/40/6");
  });
  it("records params and prompt version", () => {
    expect(md).toContain("bench-v1");
    expect(md).toContain("epsilon 60");
    expect(md).toContain("horizon 100");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/report.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement report.ts**

`src/bench/report.ts`:

```typescript
import type { BenchParams, ModelSummary } from "./orchestrate.js";

export function renderReportMd(
  summaries: ModelSummary[],
  params: BenchParams,
  meta: { promptVersion: string; triggerCount: number; startedAt: string },
): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`# Deliberation Benchmark Report`);
  lines.push(``);
  lines.push(`- started: ${meta.startedAt}`);
  lines.push(`- prompt version: ${meta.promptVersion}`);
  lines.push(`- params: seeds ${params.seeds.length}, ticks ${params.ticks}, epsilon ${params.epsilon}, horizon ${params.horizonTicks}, cap/seed ${params.capPerSeed}, timeout ${params.timeoutMs}ms`);
  lines.push(`- triggers harvested: ${meta.triggerCount}`);
  lines.push(``);
  lines.push(`**Preregistered gate:** a model shows gain iff win-rate over decisive divergent trials ≥ 0.55 AND the Wilson 95% lower bound > 0.50.`);
  lines.push(`**MDE note:** at n=300 decisive trials this design has ~80% power to detect a true rate of ~0.58; detecting 0.55 needs n≈780. Verdicts on smaller n are correspondingly weaker evidence.`);
  lines.push(``);
  lines.push(`| model | trials | fail | agree | divergent | W/L/T | win rate | 95% CI | p50 ms | p95 ms | tok in/out | verdict |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const s of summaries) {
    const agreeRate = s.trials - s.failures === 0 ? 0 : s.agreements / (s.trials - s.failures);
    lines.push(
      `| ${s.model} | ${s.trials} | ${s.failures} | ${pct(agreeRate)} | ${s.divergent} | ${s.wins}/${s.losses}/${s.ties} | ${pct(s.winRate.p)} | ${s.winRate.lo.toFixed(2)}–${s.winRate.hi.toFixed(2)} | ${Math.round(s.latencyP50)} | ${Math.round(s.latencyP95)} | ${Math.round(s.tokensInMean)}/${Math.round(s.tokensOutMean)} | ${s.verdict} |`,
    );
  }
  lines.push(``);
  lines.push(`Branch guidance (v0.5 §18 P0): all models no-gain → **B0**; gain but over budget → **B±**; gain within budget → **B+**. The random-control row is the sanity floor — any model at or below it is unambiguous no-gain.`);
  return lines.join("\n");
}
```

- [ ] **Step 4: Implement the CLI**

`src/cli/bench.ts`:

```typescript
// CLI instrumentation layer: wall-clock timestamps for report metadata only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeDemoManifest, makeDemoRoster } from "./demo.js";
import { harvestAll, runBenchForModel, summarize, randomArmSummary, type BenchParams } from "../bench/orchestrate.js";
import { OllamaRuntime } from "../bench/runtime.js";
import { renderReportMd } from "../bench/report.js";
import { PROMPT_VERSION } from "../bench/prompt.js";
import type { ModelSummary } from "../bench/orchestrate.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const models = arg("models", "qwen3:0.6b,qwen3:1.7b,qwen3:4b").split(",").map((m) => m.trim());
const seedCount = parseInt(arg("seeds", "8"), 10);
const label = arg("label", "dev");
const params: BenchParams = {
  seeds: Array.from({ length: seedCount }, (_, i) => `bench-${i + 1}`),
  ticks: parseInt(arg("ticks", "800"), 10),
  epsilon: parseInt(arg("epsilon", "60"), 10),
  horizonTicks: parseInt(arg("horizon", "100"), 10),
  timeoutMs: parseInt(arg("timeout", "30000"), 10),
  capPerSeed: parseInt(arg("cap", "200"), 10),
};
const outDir = arg("out", join("runs", `bench-${label}`));

const manifest = makeDemoManifest();
const roster = makeDemoRoster("bench-roster");
const triggers = harvestAll(manifest, roster, params);
console.log(`harvested ${triggers.length} triggers (epsilon ${params.epsilon}) across ${params.seeds.length} seeds`);

if (hasFlag("harvest-only")) {
  const bySeed = new Map<string, number>();
  for (const t of triggers) bySeed.set(t.seedRoot, (bySeed.get(t.seedRoot) ?? 0) + 1);
  for (const [seed, n] of bySeed) console.log(`  ${seed}: ${n}`);
  const gaps = triggers.map((t) => t.gap).sort((a, b) => a - b);
  console.log(`gap distribution: min ${gaps[0]}, median ${gaps[Math.floor(gaps.length / 2)]}, max ${gaps[gaps.length - 1]}`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const startedAt = new Date().toISOString();
const summaries: ModelSummary[] = [];

for (const model of models) {
  const persist = join(outDir, `trials-${model.replace(/[^a-z0-9.]/gi, "_")}.jsonl`);
  console.log(`\n=== ${model} → ${persist}`);
  const runtime = new OllamaRuntime(model);
  const trials = await runBenchForModel(manifest, roster, params, triggers, runtime, persist, (d, t) => {
    if (d % 25 === 0 || d === t) process.stdout.write(`\r  ${d}/${t}`);
  });
  console.log();
  summaries.push(summarize(model, trials, 100));
}

console.log(`\n=== random-control`);
summaries.push(randomArmSummary(manifest, roster, params, triggers));

const md = renderReportMd(summaries, params, { promptVersion: PROMPT_VERSION, triggerCount: triggers.length, startedAt });
writeFileSync(join(outDir, "report.json"), JSON.stringify({ params, promptVersion: PROMPT_VERSION, startedAt, triggerCount: triggers.length, summaries }, null, 2));
writeFileSync(join(outDir, "report.md"), md + "\n");
console.log(`\n${md}\nreport → ${outDir}/report.md`);
```

Add to `package.json` scripts: `"bench": "tsx src/cli/bench.ts"`.

- [ ] **Step 5: Run tests + harvest smoke**

Run: `npx vitest run tests/report.test.ts && npm test && npm run typecheck`
Expected: all PASS.

Run: `npm run bench -- --harvest-only --seeds 2 --ticks 300`
Expected: prints harvested trigger count > 0, per-seed counts, gap distribution; exit 0. No network access.

- [ ] **Step 6: Commit**

```bash
git add src/bench/report.ts src/cli/bench.ts package.json tests/report.test.ts
git commit -m "feat: bench CLI with markdown report and harvest-only calibration mode"
```

---

### Task 9: Preregistration doc + README + full verification

**Files:**
- Create: `docs/bench-prereg-v1.md`
- Modify: `README.md`

- [ ] **Step 1: Full verification**

Run: `npm test && npm run typecheck`
Expected: all tests pass (75 kernel + ~30 new), tsc clean.

- [ ] **Step 2: Write the preregistration document**

`docs/bench-prereg-v1.md`:

```markdown
# 审议增益判定：预注册方案 v1

对应 living-worlds-v0.5.md §18 P0 第一条。本文件冻结判定参数；官方运行开始后不得修改。
修改需发布 v2 并重新运行。

## 固定参数（官方运行前冻结）

| 参数 | 值 | 说明 |
|---|---|---|
| 模型 | qwen3:0.6b / qwen3:1.7b / qwen3:4b | Ollama，temperature 0，think:false |
| 运行时 | Ollama（DeliberationRuntime 接口，llama.cpp 对照留待有增益后） |
| 世界 | makeDemoManifest()，roster seed "bench-roster" |
| seeds | bench-1 … bench-8 |
| ticks/seed | 800（2 个完整季节） |
| epsilon | 校准后填入：＿＿（用 --harvest-only 校准，目标 ≥1500 总触发；校准只看数量分布，不看任何 LLM 结果） |
| horizon H | 100 tick |
| margin | alive ? 10000 + hp + energy + 100×berries : (deathTick − triggerTick) |
| 超时 | 30000 ms（超时/非法输出计为 failure，不进胜负） |
| prompt | bench-v1（候选顺序按 trigger id 确定性洗牌；不泄露效用分数） |

## 判定规则

- 只统计**分歧试验**（LLM 选择 ≠ 效用层最优，按动作值相等判定）。
- 胜负由影子 rollout margin 严格比较；平局报告但不入二项检验。
- **增益判定**：decisive（胜+负）≥ 300，且 win rate ≥ 0.55，且 Wilson 95% 下界 > 0.50。
- decisive < 300 → insufficient-n（不下结论，扩 seeds/cap 重跑）。
- random-control 臂为下限对照：模型不显著优于它 → 明确 no-gain。

## 功效声明（诚实版）

n=300 decisive：80% 功效可检出真实胜率 ~0.58；检出 0.55 需 n≈780。
若结果落在 [0.52, 0.58] 且 CI 含 0.50，结论是"未证明增益"而非"证明无增益"。

## 分支决策（v0.5 §18）

- 所有尺寸 no-gain → **B0**：审议层移除，换人格加权确定性决胜；LLM 收缩为表现层。
- 某尺寸 gain 但成本超预算（40k token/sim-day 折算或 p95 延迟不可接受）→ **B±**：审议只留出生/濒死/初遇。
- gain 且预算内 → **B+**：维持三层设计。

## 已知限制

- 世界为 Phase 0 内核：无社交、无繁殖，候选集偏简单。结论只约束"结构化候选裁决"能力，不外推到 Phase 1 全场景。
- rollout 为单确定性分支（K=1）：世界确定性使同 seed 重复无意义；统计功效来自场景多样性（N 大）而非 K。
- Ollama 单运行时：6.3 的双运行时对比在增益成立后补做。
```

- [ ] **Step 3: Update README**

Add to `README.md` under Commands:

```markdown
- `npm run bench -- --harvest-only` — calibrate deliberation trigger harvesting
- `npm run bench -- --label official-v1` — run the deliberation benchmark (requires `ollama pull qwen3:0.6b qwen3:1.7b qwen3:4b`; see `docs/bench-prereg-v1.md`)
```

And a one-line pointer in the Design docs section: `- docs/bench-prereg-v1.md — preregistered deliberation-gain judgment (P0)`.

- [ ] **Step 4: Commit**

```bash
git add docs/bench-prereg-v1.md README.md
git commit -m "docs: preregistered deliberation benchmark protocol and README update"
```

---

## Self-Review Notes

- **Spec coverage:** v0.5 §18 P0 判定基准 → Tasks 2–8 (trigger points, shadow rollouts, divergent-only counting, ≥55% + CI gate); §6.2 candidate presentation (2–5 candidates, LLM returns choice number + short reason) → Tasks 5–6; §6.3 instrumentation (tokens, latency, failure/fallback rate) → Tasks 6–8; B+/B0/B± branches → Task 9 prereg doc; random sanity floor → Task 7. The K-rollout phrasing in the doc is adapted to K=1 + many scenarios (deterministic world makes same-seed repeats meaningless) — documented in the prereg doc's 已知限制.
- **Type consistency:** `ScoredCandidate` defined once in Task 1, imported by Tasks 2/5/7; `TriggerPoint` (Task 2) consumed by 3/5/7; `RenderedPrompt.order` mapping used identically in Task 5 (producer) and Task 7 (`prompt.order[out.choice - 1]`); `DeliberationOutcome`/`Runtime` (Task 6) consumed by 7/8; margin formula identical in Task 3 code, Global Constraints, and prereg doc.
- **No-network test suite:** OllamaRuntime unit-tested via injected fake fetch (Task 6); orchestrator via MockRuntime (Task 7); CLI harvest-only smoke needs no Ollama (Task 8).
- **Known deliberate simplifications:** demo-world only (no per-arm worlds yet); no dedup/stratification of triggers beyond per-seed caps (distribution reported instead); latency via `Date.now()` confined to the bench/CLI instrumentation layer with documented exception comments; second runtime deferred per user decision.
```
