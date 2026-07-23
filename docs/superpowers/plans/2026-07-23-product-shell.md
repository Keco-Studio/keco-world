# First-Five-Minutes Product Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** living-worlds.md §17.1 step 8: a clickable first-five-minutes product shell (§4.2 journey, Chinese UI) rendering the real deterministic kernel in the browser via Excalibur.js — including the 守望 (patron) mechanism landed authoritatively in the Resolver (§4.1, B0 hook point), a Moment Director v0 that picks the default opening moment (resolving the §18 P0 open question: 冬前储备不足), template-only why-cards from audit data, and the Chronicle v0 biography path in-product.

**Architecture:** Three kernel additions first: (1) hash portability — swap `node:crypto` for `@noble/hashes` (sync, pure JS, same SHA-256 values) so the whole kernel runs in-browser unchanged; (2) patron mechanism — schema v4: `patronThemes` in WorldState, patron directives as replayable world inputs, Resolver band tilt with counterfactual (shadow) audit and a calibrated `PATRON_TILT` honoring the ≤5% red line; (3) Moment Director v0 — deterministic scan for the frozen default opening. Then the shell: a `web/` Vite app; Excalibur renders grid/actors/camera; DOM overlays carry the five-minute beats as an interaction-gated state machine; a pure, vitest-tested viewmodel module maps kernel structures to Chinese UI strings; sim steps by chunked `runFromState` chaining (proven hash-identical).

**Tech Stack:** existing kernel; new deps: `@noble/hashes` (runtime), `vite` + `excalibur` (dev/web). No server — the sim runs client-side, seeded, deterministic.

## Global Constraints

- `SCHEMA_VERSION` becomes `"phase1a-v4"`. Manifest construction sites needing edits: `src/cli/demo.ts`, `src/scenarios/library.ts`, `tests/helpers.ts` (version constant only — no new manifest fields this time).
- Hash values must be UNCHANGED by the crypto swap (same SHA-256; Task 1 pins a golden hash).
- Patron mechanism (frozen semantics):
  - `WorldState.patronThemes: Record<string, UtilityKey>` (npcId → theme; absent key = no patron). Hashed state.
  - Directives are world INPUTS (like roster/seed): `RunOptions.patronDirectives?: Map<number, { npcId: string; theme: UtilityKey | null }[]>`, applied at tick start before any decision; each application emits SemanticEvent kind `"patron_set"` (data: `{ theme: key | null }`); `null` clears.
  - Resolver tilt ONLY inside the hesitation band (epsilon > 0, band length > 1): the band candidate whose key === theme gets `+PATRON_TILT` lottery weight. Reflex and non-band decisions are NEVER affected (§4.1: 不越过反射与生存规则).
  - Dual audit: `patronApplied` (tilt entered a lottery) and `patronDecisive` (outcome differs from a counterfactual resolve without tilt — the 无守望影子对照, computed by resolving twice). The action log's `patronInfluence` field (schema v4 makes it a real field) records `patronApplied`; `DecideInfo` carries both.
  - Red line (invariant 4): patron-decisive decisions ≤5% of the followed NPC's total decisions. `PATRON_TILT` is CALIBRATED in Task 2 (largest of 150/100/60/30 satisfying the red line on 3 seeds × 5000 ticks with the theme always on) then frozen in code and doc.
  - Replay: injectedActions carry `patronInfluence` through (regenerated log must byte-match); `replayRun`/`verifyReplay` accept the same `patronDirectives` input.
- Moment Director (frozen): default opening = **冬前储备不足** (winter-shortfall). Candidate: alive adult in summer with `0 < ticksToWinter ≤ 200` and `shortfall = seasonLengthTicks*energyDrainPerTick − (energy + berries*berryEnergy) > 0`. Score = `min(shortfall, 2000) + (200 − ticksToWinter)`. Pick max score; ties: earlier tick, then smaller npcId (UTF-16). Fallback when the scan window has no candidate: at scan end pick the alive adult with the lowest `energy + berries*berryEnergy` (still a readable problem). All integers.
- Display convention (shell only, frozen): `DAY_TICKS = 100` → 1 季 = 4 天. UI language: Chinese. No 算力/代币/模型/锦标赛/LoRA/世界进化 terms anywhere in the shell (§4.2).
- Five-minute beats are interaction-gated, not wall-clock-gated: opening card → (dismiss) live view + why-card available → (first why viewed) patron card offered → (theme chosen) consequence watching + 接下来值得看 hooks + biography available → return-hook line. The §4.2 timings are targets, not timers.
- Why-card renders ONLY structured audit data (candidates + scores + chosenKey + actionSource + current-season-active beliefs). No LLM anywhere.
- Patron UI copy must be honest per §4.1: theme selection says 这不是命令，只会在它犹豫时形成轻微影响; when `patronDecisive` occurred, the event card carries the 标注 (e.g. 它犹豫时，你的守望让它倾向了探索).
- Root `npm run typecheck` must also cover `web/` (`tsc -p web --noEmit` chained). Web rendering code is exempt from unit tests; ALL viewmodel/director/patron logic is vitest-covered and DOM-free.
- Determinism: no `Date.now`/`Math.random` under `src/` (web/ may use wall-clock only for UI pacing, never for sim inputs).
- Commits end with the Co-Authored-By trailer from the harness rules.

---

### Task 1: Hash portability — @noble/hashes

**Files:**
- Modify: `src/canon/canonicalize.ts`, `package.json` (dependency)
- Test: `tests/canonicalize.test.ts` (append)

**Interfaces:** unchanged (`canonicalize`, `hashCanonical`, `CANON_VERSION` stays `"int-canon-v1"` — the algorithm and output are identical, only the implementation moves).

- [ ] **Step 1: Write the failing-by-intent golden test** — append to `tests/canonicalize.test.ts`:

```typescript
it("golden hash pins SHA-256 across implementations", () => {
  // sha256('{"a":1}') — independently verifiable: echo -n '{"a":1}' | shasum -a 256
  expect(hashCanonical({ a: 1 })).toBe("b8b2bc2d1bb0e1cbcc6f8dc1eabbe2a175236c5cba1971a11b71ca344a83c3db");
});
```

Run it BEFORE the swap (`npx vitest run tests/canonicalize.test.ts`) — it must PASS against node:crypto (verify the constant with `echo -n '{"a":1}' | shasum -a 256` first; if the constant above disagrees with your local shasum output, the shasum output governs — fix the constant). This pins equivalence.

- [ ] **Step 2: Swap the implementation**

```bash
npm install @noble/hashes
```

```typescript
// src/canon/canonicalize.ts — replace the node:crypto import and hashCanonical body:
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export function hashCanonical(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalize(value))));
}
```

(If the installed @noble/hashes version exposes `"@noble/hashes/sha256"` instead of `"@noble/hashes/sha2.js"`, use the installed path — check `node_modules/@noble/hashes/package.json` exports. Keep the golden test green.)

- [ ] **Step 3: `npm test && npm run typecheck` fully green** (every existing pinned hash in the suite doubles as an equivalence check)
- [ ] **Step 4: Commit**

```bash
git add src/canon/canonicalize.ts package.json package-lock.json tests/canonicalize.test.ts
git commit -m "feat: browser-portable hashing via @noble/hashes (hash values unchanged)"
```

---

### Task 2: Patron mechanism in the kernel (schema v4)

**Files:**
- Modify: `src/schema/core.ts` (SCHEMA_VERSION v4), `src/schema/log.ts` (SemanticEvent kind `"patron_set"`; `patronInfluence` documented as live), `src/world/state.ts` (patronThemes), `src/mind/resolver.ts` (tilt + counterfactual), `src/sim/engine.ts` (directives, audit wiring), `src/replay/replay.ts` (directives pass-through, patronInfluence injection), `src/cli/demo.ts` + `src/scenarios/library.ts` + `tests/helpers.ts` (version constant)
- Create: `src/cli/patron-calibrate.ts` (calibration script; package.json script `"patron-calibrate": "tsx src/cli/patron-calibrate.ts"`)
- Test: `tests/patron.test.ts`

**Interfaces (Produces):**

```typescript
// src/mind/resolver.ts
export interface Resolution {
  action: Action; key: UtilityKey; source: "utility" | "resolver";
  patronApplied: boolean;   // tilt entered a band lottery
  patronDecisive: boolean;  // outcome differs from the counterfactual no-tilt resolve
}
export const PATRON_TILT = 150; // ← replaced by the calibrated value in Step 4
export function resolve(candidates, identity, epsilon, seedRoot, npcId, tick, patronTheme?: UtilityKey | null): Resolution;

// src/sim/engine.ts
export interface RunOptions { /* existing */ patronDirectives?: Map<number, { npcId: string; theme: UtilityKey | null }[]>; }
// DecideInfo gains: patronApplied: boolean; patronDecisive: boolean;

// src/world/state.ts — WorldState gains: patronThemes: Record<string, UtilityKey>;
// createInitialState returns patronThemes: {}

// src/replay/replay.ts — replayRun/verifyReplay gain trailing optional param
//   patronDirectives?: RunOptions["patronDirectives"]
// and replayRun's injected map entries carry patronInfluence from the log event.
```

**Implementation — resolver:** compute the band as today. If `epsilon === 0 || band.length === 1` → `{ ...utility result, patronApplied: false, patronDecisive: false }`. Otherwise run the weighted draw as an inner helper `drawFromBand(tiltKey: UtilityKey | null)` (weight = `RESOLVER_BASE_WEIGHT + affinity(c.key, identity) + (c.key === tiltKey ? PATRON_TILT : 0)`; same `drawInt(seedRoot, totalWeight, "resolver", npcId, tick)` call — NOTE the raw draw r is in `[0, totalWeight)` and totalWeight differs with tilt; that is fine and deterministic, both draws use their own totalWeight). `hasTheme = patronTheme != null && band.some(c => c.key === patronTheme)`. If `!hasTheme` → single untilted draw, flags false. Else: `tilted = drawFromBand(patronTheme)`, `counter = drawFromBand(null)`, return tilted's action/key/source with `patronApplied: true`, `patronDecisive: tilted.key !== counter.key`.

**Implementation — engine:** at tick start (right after `state.tick = t`, before environmentStep): apply `opts.patronDirectives?.get(t)` in array order — set/delete `state.patronThemes[d.npcId]`, push SemanticEvent `{ tick: t, kind: "patron_set", npcId: d.npcId, data: { theme: d.theme } }`. In the utility/resolver branch pass `state.patronThemes[npc.npcId] ?? null` to `resolve`; set the action event's `patronInfluence` field from `resolution.patronApplied` (injected actions: from the injected record, see below). DecideInfo gains the two flags (false for reflex/injected/random paths). Random decisionMode ignores patron (uniform draw is not a hesitation band).

**Implementation — replay:** `replayRun` builds injected entries `{ action, actionSource, patronInfluence: ev.patronInfluence }` and the engine uses that value verbatim when regenerating the log event for injected actions; `replayRun(…, patronDirectives?)` forwards them into RunOptions so `state.patronThemes` (hashed) evolves identically; `verifyReplay` gains the same trailing param and forwards it.

**Implementation — calibration CLI** (`src/cli/patron-calibrate.ts`): for each candidate tilt in `[150, 100, 60, 30]` (patching a module-level `let` export or accepting tilt as a resolve arg is over-engineering — instead export `PATRON_TILT` as a `const` and have the calibration CLI import an internal `resolveWithTilt(candidates, identity, epsilon, seedRoot, npcId, tick, theme, tilt)` that `resolve` itself delegates to with `PATRON_TILT`): run seeds `patron-cal-1..3`, demo manifest/roster, 5000 ticks, with a directive at tick 1 setting theme `"explore"` on `"npc-1"`; count npc-1's total decisions and patron-decisive decisions via onDecide; print per-tilt per-seed `decisiveShare1000` and whether `≤50` (5%). Choose the largest tilt passing on ALL 3 seeds.

- [ ] **Step 1: Write the failing tests** — `tests/patron.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runSim } from "../src/sim/engine.js";
import { verifyReplay } from "../src/replay/replay.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { resolve, PATRON_TILT } from "../src/mind/resolver.js";
import { makeDemoManifest, makeDemoRoster } from "../src/cli/demo.js";
import type { ScoredCandidate } from "../src/mind/utility.js";

const IDENT = { riskTolerance: 500, socialTrust: 500, explorationBias: 500, patience: 500, voiceStyle: "" };
const cand = (key: string, score: number): ScoredCandidate =>
  ({ key, score, action: { verb: "idle" } }) as unknown as ScoredCandidate;

describe("patron mechanism", () => {
  it("tilt applies only inside a multi-member band", () => {
    const r0 = resolve([cand("explore", 100), cand("idle", 10)], IDENT, 0, "p", "n", 1, "idle");
    expect(r0.patronApplied).toBe(false);
    const r1 = resolve([cand("explore", 100), cand("idle", 98)], IDENT, 60, "p", "n", 1, "idle");
    expect(r1.patronApplied).toBe(true);
    const r2 = resolve([cand("explore", 100), cand("idle", 98)], IDENT, 60, "p", "n", 1, "forage");
    expect(r2.patronApplied).toBe(false); // theme not in band
  });
  it("patronDecisive is exactly 'outcome differs from counterfactual'", () => {
    // Scan ticks to find at least one decisive and one applied-but-not-decisive case
    let decisive = 0, applied = 0;
    for (let t = 1; t <= 500; t++) {
      const r = resolve([cand("explore", 100), cand("idle", 99)], IDENT, 60, "p", "n", t, "idle");
      if (r.patronApplied) applied++;
      if (r.patronDecisive) { decisive++; expect(r.key).toBe("idle"); } // tilt can only pull TOWARD the theme
    }
    expect(applied).toBe(500);
    expect(decisive).toBeGreaterThan(0);
    expect(decisive).toBeLessThan(500);
  });
  it("directives are deterministic, hashed into state, and replayable", () => {
    const m = makeDemoManifest();
    const roster = makeDemoRoster("pat-e2e");
    const dirs = new Map([[1, [{ npcId: "npc-1", theme: "explore" as const }]], [400, [{ npcId: "npc-1", theme: null }]]]);
    const a = runSim(m, roster, "pat-e2e", { ticks: 800, patronDirectives: dirs });
    const b = runSim(m, roster, "pat-e2e", { ticks: 800, patronDirectives: dirs });
    expect(hashCanonical(a.finalState)).toBe(hashCanonical(b.finalState));
    const plain = runSim(m, roster, "pat-e2e", { ticks: 800 });
    expect(hashCanonical(a.finalState)).not.toBe(hashCanonical(plain.finalState)); // theme actually mattered somewhere
    expect(a.events.filter((e) => e.kind === "patron_set").length).toBe(2);
    expect(a.finalState.patronThemes["npc-1"]).toBeUndefined(); // cleared at 400
    const rep = verifyReplay(m, roster, "pat-e2e", a.actionLog, a.checkpoints, 800, dirs);
    expect(rep.ok).toBe(true);
  });
  it("patronInfluence lands in the action log and PATRON_TILT is frozen", () => {
    const m = makeDemoManifest();
    const roster = makeDemoRoster("pat-log");
    const dirs = new Map([[1, [{ npcId: "npc-1", theme: "explore" as const }]]]);
    const r = runSim(m, roster, "pat-log", { ticks: 2000, patronDirectives: dirs });
    const mine = r.actionLog.filter((e) => e.npcId === "npc-1");
    expect(mine.some((e) => e.patronInfluence)).toBe(true);
    expect(r.actionLog.filter((e) => e.npcId !== "npc-1").every((e) => !e.patronInfluence)).toBe(true);
    expect([150, 100, 60, 30]).toContain(PATRON_TILT);
  });
});
```

Note for the `not.toBe(plain)` assertion: theme "explore" on npc-1 over 800 ticks with demo epsilon (~20–100) makes a decisive divergence overwhelmingly likely; if this assertion flakes on the fixed seed it will fail DETERMINISTICALLY (same result every run) — in that case extend ticks to 1500 in BOTH runs rather than weakening the assertion.

- [ ] **Step 2: Run tests, verify fail; implement everything above; `npm test && npm run typecheck` green** (existing suites: schema-version literals may need the v4 constant — update the same way Task 1 of the previous plan did; no other behavior may change for runs without directives — patronThemes `{}` hashes into every state, which changes ALL state hashes vs v3: this is expected and why the version bumps; no test outside docs pins cross-version hashes)
- [ ] **Step 3: Commit** (`feat: patron mechanism - resolver band tilt with shadow audit, replayable directives (schema v4)`)
- [ ] **Step 4: Calibrate** — run `npm run patron-calibrate`; set `PATRON_TILT` to the chosen value; if the chosen value ≠ 150, update it in resolver.ts; rerun `npm test`; record the full calibration table in the task report (Task 6 copies it into the doc). Commit (`feat: calibrate PATRON_TILT to red-line (<=5% decisive share)`).

---

### Task 3: Moment Director v0

**Files:**
- Create: `src/director/director.ts`
- Test: `tests/director.test.ts`

**Interfaces (Produces):**

```typescript
export const DIRECTOR_SCAN_DEFAULT = 1200;
export interface OpeningMoment {
  npcId: string; tick: number; score: number;
  ticksToWinter: number; reserves: number; shortfall: number;
  kind: "winter-shortfall" | "fallback-low-reserves";
}
export interface DirectedOpening { moment: OpeningMoment; state: WorldState; events: SemanticEvent[]; }
export function findOpening(manifest: WorldManifest, roster: RosterEntry[], seedRoot: string, scanTicks?: number): DirectedOpening;
```

**Implementation:** run chunked (`chunk = 100`) from tick 0 collecting candidates each chunk boundary AND each tick is unnecessary — evaluate candidates at every tick boundary would need per-tick states; instead evaluate at each chunk end (ticks 100, 200, …, scanTicks) — the 200-tick candidate window makes 100-tick granularity sufficient and keeps the scan cheap. For each alive NPC with `npcAge(npc, t) >= manifest.adultAgeTicks` at a boundary in summer: `ticksToWinter = seasonLengthTicks − (t % (2*seasonLengthTicks))` when in the first (summer) half else skip; candidate iff `0 < ticksToWinter <= 200`; `reserves = npc.energy + npc.berries * manifest.berryEnergy`; `shortfall = seasonLengthTicks * manifest.energyDrainPerTick − reserves`; candidate iff `shortfall > 0`; `score = Math.min(shortfall, 2000) + (200 − ticksToWinter)`. Track the best (max score; tie: earlier tick, then smaller npcId UTF-16). THE OPENING STATE MUST BE THE STATE AT THE MOMENT'S TICK: track `bestState`/`bestEvents` snapshots (structuredClone at each boundary where the best updates — events sliced 0..current length). If no candidate by scan end: fallback — at `scanTicks`, among alive adults pick lowest reserves (tie: smaller npcId); `kind: "fallback-low-reserves"`, `ticksToWinter`/`shortfall` computed the same way (may be ≤0/negative — report as-is). Throws if no NPC is alive at scan end (caller's world is broken).

- [ ] **Step 1: Write the failing tests** — `tests/director.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { findOpening, DIRECTOR_SCAN_DEFAULT } from "../src/director/director.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { runSim } from "../src/sim/engine.js";
import { makeDemoManifest, makeDemoRoster } from "../src/cli/demo.js";
import { seasonAt } from "../src/world/state.js";

describe("moment director v0", () => {
  it("finds a deterministic opening with a live state snapshot at the moment tick", () => {
    const m = makeDemoManifest();
    const roster = makeDemoRoster("dir-1");
    const a = findOpening(m, roster, "dir-1");
    const b = findOpening(m, roster, "dir-1");
    expect(hashCanonical(a.state)).toBe(hashCanonical(b.state));
    expect(a.moment.npcId).toBe(b.moment.npcId);
    expect(a.state.tick).toBe(a.moment.tick);
    expect(a.moment.tick).toBeGreaterThan(0);
    expect(a.moment.tick).toBeLessThanOrEqual(DIRECTOR_SCAN_DEFAULT);
    const focal = a.state.npcs.find((n) => n.npcId === a.moment.npcId)!;
    expect(focal.alive).toBe(true);
    // snapshot equals an independent run to the same tick
    const indep = runSim(m, roster, "dir-1", { ticks: a.moment.tick });
    expect(hashCanonical(indep.finalState)).toBe(hashCanonical(a.state));
  });
  it("winter-shortfall moments satisfy their own definition", () => {
    const m = makeDemoManifest();
    const a = findOpening(m, makeDemoRoster("dir-2"), "dir-2");
    if (a.moment.kind === "winter-shortfall") {
      expect(seasonAt(a.moment.tick, m)).toBe("summer");
      expect(a.moment.ticksToWinter).toBeGreaterThan(0);
      expect(a.moment.ticksToWinter).toBeLessThanOrEqual(200);
      expect(a.moment.shortfall).toBeGreaterThan(0);
      expect(a.moment.score).toBe(Math.min(a.moment.shortfall, 2000) + (200 - a.moment.ticksToWinter));
    } else {
      expect(a.moment.kind).toBe("fallback-low-reserves");
    }
  });
});
```

- [ ] **Step 2: Run tests, verify fail; implement; `npm test && npm run typecheck` green**
- [ ] **Step 3: Commit** (`feat: moment director v0 - deterministic winter-shortfall opening scan`)

---

### Task 4: Web scaffold — Vite + Excalibur world view

**Files:**
- Create: `web/index.html`, `web/tsconfig.json`, `web/src/main.ts`, `web/src/render.ts`, `web/src/sim.ts`, `web/src/viewmodel.ts`, `.claude/launch.json`
- Modify: `package.json` (devDeps `vite`, `excalibur`; scripts `"web": "vite web"`, `"web:build": "vite build web"`, typecheck chain), root `tsconfig.json` (exclude `web`)
- Test: `tests/web-viewmodel.test.ts`

**API-drift note for the implementer:** the Excalibur snippets below target Excalibur ~0.30. If the installed version's API differs (check `node_modules/excalibur`), adapt mechanically (same behavior) and record the deviation in your report. Rendering code is verified visually in Task 6, not unit-tested; keep ALL testable logic in `viewmodel.ts`/`sim.ts` (DOM-free, Excalibur-free).

**Interfaces (Produces):**

```typescript
// web/src/sim.ts — DOM-free sim driver
export interface SimHandle {
  state: WorldState; events: SemanticEvent[];
  lastDecisions: Map<string, DecideInfo>;       // npcId → latest DecideInfo this tick
  step(patronDirectives?: RunOptions["patronDirectives"]): void;  // advance exactly 1 tick
}
export function createSim(manifest: WorldManifest, roster: RosterEntry[], seedRoot: string, opening: DirectedOpening): SimHandle;

// web/src/viewmodel.ts — pure, Chinese strings
export const DAY_TICKS = 100;
export function fmtDays(ticks: number): string;                    // 130 → "1.3 天"
export function riskLine(moment: OpeningMoment): string;           // e.g. "冬天还有 1.6 天，他的储备只够 0.9 天"
export interface WhyCard { title: string; need: string; personality: string[]; experience: string[]; candidates: { label: string; score: number; chosen: boolean }[]; sourceLine: string; }
export function buildWhyCard(info: DecideInfo, npc: NpcState, season: "summer" | "winter"): WhyCard;
export function verbLabel(key: string): string;                    // forage→采集 consume→进食 shelter→避护 seekMate→亲近 explore→探索 idle→歇息
export function patronMark(theme: UtilityKey): string;             // "它犹豫时，你的守望让它倾向了" + verbLabel(theme)
export function eventLine(ev: SemanticEvent, names: Map<string, string>): string | null; // birth/death/season/belief/patron → one Chinese line; null = not player-facing
```

**Implementation sketches (complete these into working code):**

`web/src/sim.ts`: hold `{ state, events, lastDecisions }`; `step()` calls `runFromState(state, manifest, seedRoot, { ticks: 1, retainActionLog: false, patronDirectives, onDecide })` starting from the opening's state/events; append `result.events` to the rolling `events` array; replace `state` with `result.finalState`; `lastDecisions` rebuilt each step from onDecide callbacks. (Chunked chaining is hash-identical to a continuous run — pinned by tests/degradation.test.ts.)

`web/src/viewmodel.ts` content rules: `fmtDays` = one decimal from integer ticks (`(ticks / DAY_TICKS).toFixed(1)`); `riskLine` uses fmtDays(ticksToWinter) and fmtDays(reserves / manifest-drain — pass precomputed days from caller if needed; keep the signature above by computing reserve days as `moment.reserves / (2 /* energyDrainPerTick of demo */) ` is WRONG — instead extend riskLine to `riskLine(moment: OpeningMoment, energyDrainPerTick: number)`); `buildWhyCard`: need line from observation (hunger state via energy vs threshold), personality = top-2 identity fields by distance from 500 rendered as Chinese traits (e.g. explorationBias>650 → "天性好奇", patience>650 → "沉得住气", riskTolerance<350 → "谨小慎微" — freeze a 8-entry mapping: high/low × 4 fields), experience = beliefs whose condition is null or matches season, rendered as `『proposition』`, capped 3 by confidence desc; candidates sorted score desc with `chosen` on chosenKey, labels via verbLabel; sourceLine: reflex→"求生本能接管了这一步", utility→"它权衡后选了最优", resolver→"它犹豫了——最终凭性情倾向了这个选择"; append patronMark when `info.patronDecisive`.

`web/src/render.ts` (Excalibur): `TILE = 24`; Engine into `#game` canvas (fixed 960×640, `DisplayMode.FitScreen`); flat-color rects: grass background, bushes (green circle, radius scaled by berries/capacity, gray when 0), shelters (brown square), wolf (dark red square), NPCs (per-lineage hue from a 25-color palette by founder index, 2px black outline on the followed NPC, name `ex.Label` above); one `ex.Actor` per entity keyed by id, positions synced from `SimHandle.state` in a `syncWorld(handle, followedId)` function called after each sim step; camera: follow mode `engine.currentScene.camera.pos = followedPos` each sync with zoom 1.6, overview mode zoom 0.75 centered on grid center; winter tint: translucent white overlay rect toggled by season.

`web/src/main.ts` (this task only): boot Excalibur; `findOpening(makeDemoManifest(), makeDemoRoster(seed), seed)` with `seed = "shell-1"`; `createSim`; a `setInterval`-driven stepper honoring a speed control (`暂停/1×/4×` = 0/2/8 ticks-per-second; UI pacing wall-clock is allowed in web/); minimal DOM: speed buttons + 跟随/俯瞰 toggle + a bare event feed `<ul>` fed by `eventLine`. The five-minute flow overlays come in Task 5.

`web/index.html`: minimal shell, `<div id="ui">` overlay root + `<canvas id="game">`, dark background, system-ui font, lang="zh-CN".

`web/tsconfig.json`: `{ "extends": "../tsconfig.json", "compilerOptions": { "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": [] }, "include": ["src"] }` (adjust to the root config's shape — verify `moduleResolution` supports the `.js`-suffixed relative imports used across `src/`).

`.claude/launch.json`: `{ "version": "0.0.1", "configurations": [{ "name": "web", "runtimeExecutable": "npm", "runtimeArgs": ["run", "web"], "port": 5173 }] }`.

package.json: `"typecheck": "tsc --noEmit && tsc -p web --noEmit"`.

- [ ] **Step 1: Write the failing tests** — `tests/web-viewmodel.test.ts` (node-side, imports from `web/src/viewmodel.ts` — confirm root vitest picks it up; the file must not import excalibur or touch DOM):

```typescript
import { describe, it, expect } from "vitest";
import { fmtDays, riskLine, verbLabel, buildWhyCard, eventLine, patronMark, DAY_TICKS } from "../web/src/viewmodel.js";

describe("shell viewmodel", () => {
  it("formats days and verbs in Chinese", () => {
    expect(DAY_TICKS).toBe(100);
    expect(fmtDays(130)).toBe("1.3 天");
    expect(verbLabel("forage")).toBe("采集");
    expect(verbLabel("idle")).toBe("歇息");
  });
  it("risk line matches the §4.2 register", () => {
    const line = riskLine({ npcId: "npc-1", tick: 300, score: 0, ticksToWinter: 160, reserves: 180, shortfall: 620, kind: "winter-shortfall" }, 2);
    expect(line).toContain("冬天还有 1.6 天");
    expect(line).toContain("0.9 天");
  });
  it("why card is grounded in the decision record", () => {
    const info = {
      tick: 5, npcId: "npc-1", observation: {} as never, actionSource: "resolver" as const,
      action: { verb: "move" } as never,
      candidates: [
        { key: "explore", score: 400, action: { verb: "move" } },
        { key: "forage", score: 390, action: { verb: "move" } },
      ] as never,
      chosenKey: "explore" as const, patronApplied: true, patronDecisive: true,
    };
    const npc = {
      identity: { riskTolerance: 500, socialTrust: 500, explorationBias: 900, patience: 200, voiceStyle: "" },
      beliefs: [
        { proposition: "远方总有新的浆果丛", effect: { target: "w:explore", modifier: 150, condition: null }, confidence: 700, source: "designed", acquiredTick: 0, decayPer100: 0 },
        { proposition: "冬季闭户", effect: { target: "w:shelter", modifier: 250, condition: "winter" }, confidence: 950, source: "designed", acquiredTick: 0, decayPer100: 0 },
      ], energy: 800, policy: { thresholds: { hungerUrgent: 150 } },
    };
    const card = buildWhyCard(info as never, npc as never, "summer");
    expect(card.candidates[0]!.label).toBe("探索");
    expect(card.candidates[0]!.chosen).toBe(true);
    expect(card.experience).toContain("『远方总有新的浆果丛』");
    expect(card.experience).not.toContain("『冬季闭户』"); // winter-gated belief hidden in summer
    expect(card.sourceLine).toContain("犹豫");
    expect(card.sourceLine).toContain(patronMark("explore"));
  });
  it("event lines cover the player-facing kinds", () => {
    const names = new Map([["npc-1", "Rill"]]);
    expect(eventLine({ tick: 1, kind: "birth", npcId: "npc-1", data: {} }, names)).toContain("Rill");
    expect(eventLine({ tick: 1, kind: "season_change", npcId: null, data: { season: "winter" } }, names)).toContain("冬");
    expect(eventLine({ tick: 1, kind: "patron_set", npcId: "npc-1", data: { theme: "explore" } }, names)).toContain("守望");
  });
});
```

- [ ] **Step 2: `npm install -D vite excalibur`; implement all files; tests + full typecheck green**
- [ ] **Step 3: Smoke-boot** — `npx vite build web` must succeed (a full visual check happens in Task 6; the build catches import/DOM/bundling errors now)
- [ ] **Step 4: Commit** (`feat: web shell scaffold - excalibur world view over the in-browser kernel`)

---

### Task 5: The five-minute flow

**Files:**
- Create: `web/src/flow.ts`, `web/src/ui.ts`, `web/src/style.css`
- Modify: `web/src/main.ts`, `web/index.html`
- Test: `tests/web-flow.test.ts`

**Interfaces (Produces):**

```typescript
// web/src/flow.ts — pure state machine, DOM-free
export type Beat = "opening" | "watching" | "patron-offer" | "living" ;
export interface FlowState {
  beat: Beat;
  whyViewed: boolean;
  patronTheme: UtilityKey | null;
  followedId: string;
  hooks: string[];              // 接下来值得看 lines, max 3, newest first
  returnHook: string | null;    // set once when beat reaches "living" and a hook exists
}
export function createFlow(followedId: string): FlowState;
export type FlowEvent =
  | { type: "dismiss-opening" } | { type: "why-viewed" }
  | { type: "choose-theme"; theme: UtilityKey }
  | { type: "sim-event"; line: string; hookable: boolean };
export function flowReduce(f: FlowState, e: FlowEvent): FlowState;  // pure; invalid events are no-ops
```

Beat transitions: `opening --dismiss-opening--> watching`; `watching --why-viewed--> patron-offer` (sets whyViewed); `patron-offer --choose-theme--> living` (sets patronTheme); `sim-event` with `hookable: true` pushes into hooks (cap 3, drop oldest); on entering `living`, `returnHook` = a fixed template around the chosen theme: `第一场寒潮之后，${verbLabel(theme)}的守望会接受检验` (compose in ui layer if flow shouldn't import viewmodel — acceptable either way; keep flow.ts importing only verbLabel from viewmodel).

Hookable events (decided in ui/main wiring): season_change to winter, birth in followed lineage, belief_formed on followed NPC, patron_decisive marks.

**`web/src/ui.ts`:** DOM builders (no framework): `showOpeningCard(name, lineageName, goalLine, riskLine, onDismiss)` (§4.2 0:00–0:20 register: 名字/血脉/当前目标/一句风险); `showWhyButton(onClick)` + `renderWhyCard(card: WhyCard)` (§4.2 0:20–1:00, dismissable panel); `showPatronCard(onChoose)` — four theme buttons (探索/关系/储备/建造 → explore/seekMate/forage/shelter) with the honesty line 这不是命令，只会在它犹豫时形成轻微影响; `renderEventFeed(lines)`; `renderHooks(hooks)` panel 接下来值得看; `showReturnHook(line)` + a closing line 世界不会因你离线暂停——他们会继续生活、繁衍，也可能死去; `showBiography(text)` modal rendering `renderBiography(extractLineage(events, state, roster, lineageId), manifest)` output in `<pre>`; a 血脉传记 button available from beat "living".

**`web/src/main.ts` wiring:** flow state drives which overlays exist; choosing a theme issues a patron directive at the NEXT tick (`sim.step(new Map([[state.tick + 1, [{ npcId: followedId, theme }]]]))` — implement as a pending-directive queue consumed by the stepper); every step: convert new SemanticEvents via `eventLine` (followed-lineage filter for birth/belief), mark hookable ones, feed `flowReduce`; when a followed NPC's DecideInfo has `patronDecisive`, push the `patronMark(theme)` line into the feed (§4.1 标注); death of the followed NPC → the feed line + biography button highlighted (§4.4: cause chain shown, no punishment framing — reuse eventLine's death line with cause).

- [ ] **Step 1: Write the failing tests** — `tests/web-flow.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createFlow, flowReduce } from "../web/src/flow.js";

describe("five-minute flow state machine", () => {
  it("walks the interaction-gated beats in order and ignores invalid events", () => {
    let f = createFlow("npc-1");
    expect(f.beat).toBe("opening");
    f = flowReduce(f, { type: "choose-theme", theme: "explore" }); // invalid now
    expect(f.beat).toBe("opening");
    f = flowReduce(f, { type: "dismiss-opening" });
    expect(f.beat).toBe("watching");
    f = flowReduce(f, { type: "why-viewed" });
    expect(f.beat).toBe("patron-offer");
    f = flowReduce(f, { type: "choose-theme", theme: "forage" });
    expect(f.beat).toBe("living");
    expect(f.patronTheme).toBe("forage");
    expect(f.returnHook).toContain("守望");
  });
  it("hooks cap at 3 newest-first", () => {
    let f = createFlow("npc-1");
    f = flowReduce(f, { type: "dismiss-opening" });
    for (const n of ["一", "二", "三", "四"]) f = flowReduce(f, { type: "sim-event", line: n, hookable: true });
    expect(f.hooks).toEqual(["四", "三", "二"]);
    f = flowReduce(f, { type: "sim-event", line: "噪音", hookable: false });
    expect(f.hooks).toEqual(["四", "三", "二"]);
  });
  it("reducer is pure (input not mutated)", () => {
    const f = createFlow("npc-1");
    const before = JSON.stringify(f);
    flowReduce(f, { type: "dismiss-opening" });
    expect(JSON.stringify(f)).toBe(before);
  });
});
```

- [ ] **Step 2: Run tests, verify fail; implement flow.ts / ui.ts / style.css / main.ts wiring; tests + full typecheck green; `npx vite build web` succeeds**
- [ ] **Step 3: Commit** (`feat: first-five-minutes flow - opening/why/patron/hooks/biography over live sim`)

---

### Task 6: Visual verification, docs, spec updates

**Files:**
- Create: `docs/product-shell.md`
- Modify: `README.md`, `docs/living-worlds.md`

- [ ] **Step 1: Visual verification (CONTROLLER does this personally, not a subagent)** — start the `web` preview, walk the full five-minute journey in the browser (opening card content vs the director's moment; why-card grounding; patron selection; a decisive-patron 标注 appearing (run at 4× as needed); hooks; biography modal; death handling if it occurs), and fix-or-file anything broken. Screenshots into the task record where useful.
- [ ] **Step 2: `docs/product-shell.md`** — what the shell implements per §4.2 beat (with the interaction-gating decision recorded); the patron mechanism record: semantics, calibrated `PATRON_TILT` + the full calibration table from Task 2, red-line audit definition (applied vs decisive, shadow counterfactual); the Moment Director decision record (§18 P0 开场事件 → 冬前储备不足, scoring, fallback); DAY_TICKS display convention; what is explicitly NOT in the shell (Moment Director as a live service, subscriptions/提醒, session loop §4.3, 纪念/墓志, multi-player, server persistence) and where each lives in the 1B scope; how to run (`npm run web`).
- [ ] **Step 3: Spec updates in `docs/living-worlds.md`**:
  - Header version → `v0.5.2`, one added 修订说明 line: 守望机制按 B0 挂接点落地内核（决胜层倾斜 + 影子对照审计 + 红线校准），产品壳交付首五分钟，默认开场事件已定;
  - §4.1 守望者段落: append `（v0.5.2 注：决胜层倾斜已实现——PATRON_TILT=<calibrated>，patronInfluence/影子对照审计与红线度量见 docs/product-shell.md）`;
  - §17.1 step 8 strike-through + 已交付 line (mention: 内核浏览器可运行、守望落地、导演 v0、传记入产品);
  - §18 P0: mark 首个五分钟默认开场 resolved → 冬前储备不足（决策记录 docs/product-shell.md）.
- [ ] **Step 4: README** — web shell section (run instructions, what it is, doc pointer).
- [ ] **Step 5: `npm test && npm run typecheck` green; `npx vite build web` green; commit** (`docs: product shell record; mark 17.1 step 8 delivered; spec v0.5.2`)

---

## Self-Review Notes

- §4.2 beats traced task-by-task (opening/why/patron/consequence-hooks/return-hook all in Task 5; forbidden-terms rule in Global Constraints). §4.1 honesty rules (not-a-command copy, decisive 标注, audit traceability) are explicit requirements, not vibes.
- Patron determinism: directives are inputs, patronThemes is hashed state, injected-action replay carries patronInfluence — the regenerated-log byte-equality check keeps the audit trail honest. Red line calibrated with a measurement protocol, not assumed.
- The §18 P0 open questions resolved here (default opening) and previously (handcrafted budget) are both closed with pointers, keeping the ledger accurate.
- Web code split keeps everything testable DOM-free except render/ui glue, which gets a mandatory human-eyes pass (Task 6 Step 1 is assigned to the controller deliberately).
- Type-consistency check done: Resolution flags flow resolver→engine DecideInfo→viewmodel WhyCard; OpeningMoment flows director→sim→riskLine; UtilityKey theme flows ui→flow→directive→resolver.
