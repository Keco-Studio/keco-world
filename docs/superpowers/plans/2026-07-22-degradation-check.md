# 10-Generation Degradation Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** living-worlds.md §17.1 step 7: run small multi-seed experiments past generation 10 and check for degradation — with pre-declared criteria, time-series evidence, and an honest report. Special attention: quantify the explore→idle drift trend (threat model §15 "生存最优但观看无聊").

**Architecture:** A degradation CLI chains `runFromState` in fixed-size chunks (deterministically identical to one long run — the engine is per-tick pure), snapshotting cheap metrics at each boundary: population/generations/lineages, direct genome-space weight diversity (no scenario sims), epsilon distribution, belief stats, and in-world verb shares from the chunk's actionLog (counted then discarded — bounded memory). Criteria are evaluated in code; the verdict is data, not vibes.

**Tech Stack:** existing kernel. No new dependencies.

## Global Constraints

- Chunked chaining must be trajectory-identical to a single continuous run (test-pinned via hash comparison).
- **Pre-declared degradation criteria (frozen here, before any official run):**
  - D1 sustainability: ≥5/6 seeds alive at the end with maxGeneration ≥ 10;
  - D2 no monoculture collapse: final genome-space weight diversity ≥ 30% of the founder value (per surviving seed);
  - D3 world stays active: final-chunk idle verb share < 0.60 (per surviving seed);
  - D4 mutation bounds hold: every alive genome zod-validates (IdentityS/PolicyS/BeliefS) at end;
  - D5 belief system bounded: max beliefs per NPC ≤ 16 at every snapshot.
  - Reported but NOT gated: epsilon mean/min/max trend (pinning at 0 or 1000 is a finding to discuss, not an auto-fail); idle-share slope; lineage count trend.
- A failed criterion is a recorded finding — the run itself must still complete and report.
- Genome-space diversity here is DIRECT weight distance (mean pairwise L1 over utilityWeights, /1000 per key, over alive NPCs, capped 200 pairs deterministic) — cheap, no scenario evaluation; document that it is a different (genotypic) instrument than the behavioral verbL1.
- Commits end with the Co-Authored-By trailer from the harness rules.

---

### Task 1: Degradation CLI with chunked time-series collection

**Files:**
- Create: `src/cli/degradation.ts`
- Modify: `package.json` (script `"degradation": "tsx src/cli/degradation.ts"`)
- Test: `tests/degradation.test.ts`

**Interfaces:**

```typescript
export interface Snapshot {
  tick: number;
  alive: number;
  maxGeneration: number;
  meanGeneration100: number;         // floor(mean*100)
  livingLineages: number;
  weightDiversity1000: number;       // floor(mean pairwise L1 proportion * 1000); 0 when <2 alive
  epsilon: { mean: number; min: number; max: number };   // over alive, mean floored int
  beliefs: { meanPer100: number; maxPerNpc: number };
  verbShares1000: Record<string, number>;                // this CHUNK's actionLog verb proportions ×1000 floored
}
export interface SeedResult {
  seedRoot: string;
  snapshots: Snapshot[];
  survived: boolean;
  finalMaxGeneration: number;
  criteria: { d2DiversityRatio1000: number | null; d3IdleShare1000: number | null; d4ZodValid: boolean; d5BeliefCapOk: boolean };
}
export interface DegradationReport {
  seeds: SeedResult[];
  d1Pass: boolean; d2Pass: boolean; d3Pass: boolean; d4Pass: boolean; d5Pass: boolean;
  verdict: "no-degradation" | "findings";   // findings when any D fails
}
export function runDegradation(seedRoots: string[], ticks: number, chunk: number): DegradationReport;
```

Chunking: start from `createInitialState`; loop `runFromState(state, manifest, seed, { ticks: chunk, retainActionLog: true })`; after each chunk: snapshot from `finalState` + verb counts from that chunk's `actionLog` (then drop the result object); carry `finalState` forward as the next input. Stop early when population hits 0 (record, `survived:false`). D2 ratio: final diversity ×1000 / snapshot[0] diversity (null if extinct or founder diversity 0). D3 from the last snapshot's `verbShares1000["idle"] ?? 0`. D4: zod-parse every alive NPC's identity/policy/beliefs. D5: max beliefs across ALL snapshots. CLI: `npm run degradation -- [--seeds 6] [--ticks 15000] [--chunk 1000] [--out runs/degradation]` — demo world, seeds `deg-1..N`, writes `report.json` + prints a per-seed table and the D-verdicts.

- [ ] **Step 1: Write the failing tests**

`tests/degradation.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runDegradation } from "../src/cli/degradation.js";
import { runSim } from "../src/sim/engine.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { createInitialState } from "../src/world/state.js";
import { runFromState } from "../src/sim/engine.js";
import { makeDemoManifest, makeDemoRoster } from "../src/cli/demo.js";

describe("degradation check", () => {
  it("chunked chaining is trajectory-identical to one continuous run", () => {
    const manifest = makeDemoManifest();
    const roster = makeDemoRoster("chunk-eq");
    const single = runSim(manifest, roster, "chunk-eq", { ticks: 3000, retainActionLog: false });
    let state = createInitialState(manifest, roster, "chunk-eq");
    for (let i = 0; i < 3; i++) {
      state = runFromState(state, manifest, "chunk-eq", { ticks: 1000, retainActionLog: false }).finalState;
    }
    expect(hashCanonical(state)).toBe(hashCanonical(single.finalState));
  });
  it("produces snapshots, criteria, and a deterministic report", () => {
    const r = runDegradation(["deg-t1", "deg-t2"], 4000, 1000);
    expect(r.seeds.length).toBe(2);
    for (const s of r.seeds) {
      expect(s.snapshots.length).toBeGreaterThanOrEqual(1);
      expect(s.snapshots.length).toBeLessThanOrEqual(4);
      const first = s.snapshots[0]!;
      expect(first.alive).toBeGreaterThan(0);
      expect(first.weightDiversity1000).toBeGreaterThan(0);   // founders are diverse
      const shareSum = Object.values(first.verbShares1000).reduce((a, b) => a + b, 0);
      expect(shareSum).toBeGreaterThan(900);                  // proportions ×1000, floor rounding
      expect(shareSum).toBeLessThanOrEqual(1000);
      expect(first.beliefs.maxPerNpc).toBeLessThanOrEqual(16);
    }
    expect(runDegradation(["deg-t1", "deg-t2"], 4000, 1000)).toEqual(r);
  });
  it("criteria fields populate and zod validation runs", () => {
    const r = runDegradation(["deg-t1"], 3000, 1000);
    const s = r.seeds[0]!;
    expect(typeof s.criteria.d4ZodValid).toBe("boolean");
    expect(s.criteria.d5BeliefCapOk).toBe(true);
    if (s.survived) {
      expect(s.criteria.d2DiversityRatio1000).not.toBeNull();
      expect(s.criteria.d3IdleShare1000).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Verify fail, implement (guarded CLI main per existing patterns), `npm test && npm run typecheck` green**

- [ ] **Step 3: Commit**

```bash
git add src/cli/degradation.ts package.json tests/degradation.test.ts
git commit -m "feat: degradation check CLI - chunked multi-seed time series with frozen criteria"
```

---

### Task 2: Official run + report doc

**Files:**
- Create: `docs/degradation-check.md`
- Modify: `README.md`

- [ ] **Step 1: Official run** — `npm run degradation -- --seeds 6 --ticks 15000 --chunk 1000` (~10-15 min total). Do NOT rerun with different params if criteria fail — the first official run is the record (rerunning until pass is the exact anti-pattern the criteria exist to prevent).

- [ ] **Step 2: Write `docs/degradation-check.md`**: frozen criteria restated; per-seed table (survival, maxGen, diversity ratio, idle share, epsilon trend); D1–D5 verdicts; time-series observations (idle-share slope across chunks — is the explore→idle drift monotone? plateauing? — and lineage-count collapse curve); explicit findings section for any failures; implications for §17.1 step 9 (the 50-generation formal runs) and for the 观看无聊 threat.

- [ ] **Step 3: README**: add the degradation command; add the doc pointer.

- [ ] **Step 4: `npm test && npm run typecheck` green; clean runs/; commit**

```bash
git add docs/degradation-check.md README.md
git commit -m "docs: 10-generation degradation check - official run record"
```

---

## Self-Review Notes

- Criteria frozen in this plan BEFORE the official run; Task 2 explicitly forbids rerun-until-pass.
- Chunk-equivalence is hash-pinned (Task 1 test) so the time series is trustworthy.
- Genotypic diversity vs behavioral verbL1 distinction documented; epsilon reported-not-gated to avoid encoding a premature judgment about personality-expressivity evolution.
```
