# 1C Formal Toolchain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build everything docs/prereg-1c-draft.md §9 requires BEFORE the prereg can be frozen: the formal 50k-tick runner with codified S-gates, codified N-gates, the stratified biography sampler + pairing/blinding/judge-packet pipeline, endpoint statistics (binomial, Holm–Bonferroni, cluster-robust SE, Cohen's κ), and a one-command analysis master. No official `c1-*` seeds are run in this plan — pilot seeds only.

**Architecture:** A `formal` CLI archives per-seed run dirs (deterministic-minimal: no raw action log — the chain tip + checkpoint set pin the run; semantic events kept for biographies). Analysis modules live under `src/analysis/` and are pure functions over archives; CLIs are thin wrappers. Biography sampling v2 is a pure selector over `LineageChronicle` feeding a renderer that accepts an explicit selection.

**Tech Stack:** existing kernel; node:zlib gzip for archives (node CLI layer only, not kernel). No new dependencies.

## Global Constraints

- **Archive policy (amends prereg draft §7 — Task 4 updates the draft accordingly):** a formal run dir contains `manifest.json`, `roster.json`, `meta.json` (incl. `actionChainTip` — the final `previousEventHash`-chain hash — and `finalStateHash`), `directives.json` (`[]`), `checkpoints.json`, `events.jsonl.gz` (semantic events), `snapshots.jsonl` (per-chunk metrics), `final-state.json.gz`. Raw action logs are NOT archived: the deterministic kernel regenerates them; re-verification = live re-run comparing chain tip + checkpoints (the strict model from docs/product-shell.md §3.4).
- Frozen S-gate semantics (from prereg draft §2): S1 survival (per arm ≥10/12 alive at end; maxGeneration ≥ 50 additionally required only for arms with `inheritanceMode: "breed"`); S2 (breed arms only) final weightDiversity1000 ≥ 30% of snapshot[0] value, unbiased drawInt-keyed pair sampling (reuse degradation's corrected sampler); S3 windowed: FAIL iff any seed has ≥3 CONSECUTIVE chunks with idle share > 600‰; S4 all alive genomes zod-validate at end; S5 max beliefs/NPC ≤ 16 across all snapshots. Random arm is exempt from S1–S3 (sanity arm, expected extinct) but still reported.
- Frozen N-gate semantics (prereg draft §3): evaluated per breed-arm seed with the scenario suite. N1 pooled founders-vs-evolved verbL1 ≥ 0.30 (comparePooled — equal genome weighting); N2 evolved intra meanPairwiseVerbL1 ≥ 0.60 × same-seed founder intra AND ≥ 0.25 absolute; N3 meanCrossVerbL1(evolved_evo, founders_fixed_sameIndexSeed) ≥ meanCrossVerbL1(founders_evo, founders_fixed_sameIndexSeed). Gate passes at arm level with ≥9/12 seeds. Thresholds are PARAMETERS of the analysis functions (defaults from the draft) so freezing can adjust them without code edits.
- Frozen biography sampling v2 (prereg draft §4): partition the lineage's generation span [0..peakGeneration] into 4 equal bands (last band takes remainder); budget 12 member events at 3/band; within a band priority death(with cause) > belief_formed > birth, ties → earlier tick, then npcId UTF-16; unused band budget rolls to the NEXT band (then wraps once from the start band if budget remains after the last). Belief sentences come from the SAME selection (no separate belief cap). 结语 (weightDrift closing line) unchanged.
- Pairing (draft §4): generation-band matching (1–15 / 16–30 / 31+ by peakGeneration), rendered char length within ±20% (otherwise redraw that arm's candidate); left/right position per pair via drawInt; blinding checklist = forbidden-string scan over every packet: seeds, "tick", "拍", arm names (random/fixed/handcrafted/evolutionary/noculture), 算力/代币/模型/锦标赛/LoRA/世界进化.
- Stats float-tolerance: analysis-layer code (src/analysis/, src/eval/) may use floats — determinism doctrine (drawInt-only randomness, no Date.now/Math.random) still applies everywhere under src/.
- CLI style: exported functions + guarded main (degradation.ts pattern). Commits end with the Co-Authored-By trailer from the harness rules.

---

### Task 1: Formal runner CLI + S-gates

**Files:**
- Create: `src/cli/formal.ts`
- Modify: `package.json` (script `"formal": "tsx src/cli/formal.ts"`)
- Test: `tests/formal.test.ts`

**Interfaces (Produces):**

```typescript
export interface FormalSnapshot {   // per chunk — superset of degradation's Snapshot fields it reuses
  tick: number; alive: number; maxGeneration: number; livingLineages: number;
  weightDiversity1000: number;      // breed arms; 0 when <2 alive
  beliefsMaxPerNpc: number;
  verbShares1000: Record<string, number>;   // THIS chunk's shares
}
export interface FormalSeedMeta {
  arm: ArmId | "noculture"; seedRoot: string; ticks: number; chunk: number;
  schemaVersion: string; canonVersion: string; rngSchemeVersion: string;
  complete: boolean; survived: boolean; finalAlive: number; maxGeneration: number;
  actionChainTip: string | null;    // hash chain tip over the full run's action log
  finalStateHash: string;
}
export interface SGateReport {
  perSeed: { seedRoot: string; survived: boolean; maxGeneration: number; s2Ratio1000: number | null; s3MaxConsecutiveIdleBreaches: number; s4ZodValid: boolean; s5BeliefCapOk: boolean }[];
  s1Pass: boolean; s2Pass: boolean; s3Pass: boolean; s4Pass: boolean; s5Pass: boolean;
  exempt: boolean;                  // random arm: reported but exempt from S1–S3
}
export function runFormalSeed(arm: ArmId | "noculture", seedRoot: string, ticks: number, chunk: number, outDir: string): FormalSeedMeta;
export function evaluateSGates(armDir: string, arm: ArmId | "noculture", opts?: { minAlive?: number; minGen?: number }): SGateReport;
export function makeNocultureSetup(seedRoot: string): ArmSetup;   // evolutionary roster + cognition {utility, breed, off}
```

**Implementation:**
- `makeNocultureSetup`: `makeArmSetup("evolutionary", seedRoot)` with `cognition.beliefDynamics` overridden to `"off"` (manifest copy, not mutation).
- `runFormalSeed`: chunked chaining (arms.ts pattern) with `retainActionLog: true` per chunk; per chunk: append a FormalSnapshot line to `snapshots.jsonl`, extend the action hash chain tip incrementally (`hashCanonical` over each event with its `previousEventHash` — reuse the chain the engine already wrote: tip = hash of last event of the chunk; verify continuity across chunks: first event of chunk N must chain to the tip of chunk N−1; throw if not), append semantic events to `events.jsonl.gz` (gzip stream or buffer-then-gzip), then DROP the chunk result. Early stop on extinction. At end write `checkpoints.json` (accumulated), `final-state.json.gz`, `meta.json` (`complete: true`), `directives.json` = `[]`, `manifest.json`, `roster.json`.
- Resume: if `<outDir>/<arm>/<seedRoot>/meta.json` exists with `complete: true`, skip (print "skip (complete)"). Per-seed granularity only.
- S-gates (`evaluateSGates`): read all seed dirs of an arm; S1 alive-count + (breed arms) maxGen ≥ opts.minGen (default 50); S2 last snapshot's weightDiversity1000 ×1000 / first snapshot's (breed arms, null otherwise); S3 scan snapshots for the longest consecutive run of chunks with `verbShares1000.idle > 600`, FAIL iff ≥3; S4 zod-parse alive genomes from final-state; S5 max over snapshots. Weight diversity uses the corrected drawInt-keyed unbiased pair sampler — extract it from `src/cli/degradation.ts` into a shared export rather than duplicating (modify degradation.ts to import the shared function; its tests must stay green unchanged).
- CLI: `npm run formal -- run --arm <id|noculture> [--seeds 12] [--ticks 50000] [--chunk 1000] [--out runs/formal] [--seed-prefix pilot]` — seeds named `<prefix>-<arm>-1..N` (OFFICIAL prefix `c1` is typed explicitly at freeze time; default prefix `pilot` so accidental official runs are impossible); `npm run formal -- gates --arm <id> [--out runs/formal]` prints + writes `sgates-<arm>.json`.

- [ ] **Step 1: Write failing tests** — `tests/formal.test.ts` (pilot-scale): run `runFormalSeed("fixed", "pilot-fmt-1", 3000, 1000, tmpDir)` (use a scratch dir under the repo's gitignored `runs/`): assert meta.complete, actionChainTip non-null, finalStateHash equals an independent `runSim` 3000-tick hash for the same setup; snapshots.jsonl has 3 lines; resume: second call returns without re-running (assert via mtime unchanged or a sentinel); `evaluateSGates` over a dir with that one seed returns structurally valid report (s4ZodValid true, s5 true). Add a noculture test: `makeNocultureSetup("x").manifest.cognition` equals `{ decisionMode: "utility", inheritanceMode: "breed", beliefDynamics: "off" }` and roster equals evolutionary roster for same seed. Chain-continuity: tamper test optional here (covered conceptually by strict-verify suite).
- [ ] **Step 2: Verify fail; implement; `npm test && npm run typecheck` green** (degradation suite must stay green after the sampler extraction)
- [ ] **Step 3: Commit** — `git commit -m "feat: formal 1C runner - archived seeds, resumable, codified S-gates"`

---

### Task 2: N-gates codification

**Files:**
- Create: `src/analysis/novelty.ts`
- Modify: `src/cli/behavior.ts` (export `comparePooled`)
- Modify: `src/cli/formal.ts` (subcommand `novelty`)
- Test: `tests/novelty.test.ts`

**Interfaces (Produces):**

```typescript
export interface NoveltyThresholds { n1MinVerbL1: number; n2RatioMin: number; n2AbsMin: number; minPassingSeeds: number; }
export const DEFAULT_NOVELTY_THRESHOLDS: NoveltyThresholds; // { 0.30, 0.60, 0.25, 9 } per prereg draft §3
export interface SeedNovelty {
  seedRoot: string; n1VerbL1: number; n2Intra: number; n2FounderIntra: number;
  n3EvolvedVsFixed: number; n3FoundersVsFixed: number;
  n1Pass: boolean; n2Pass: boolean; n3Pass: boolean;
}
export interface NoveltyReport { perSeed: SeedNovelty[]; n1Pass: boolean; n2Pass: boolean; n3Pass: boolean; }
export function evaluateNovelty(armDir: string, fixedFounderRosters: Map<string, GenomeUnderTest[]>, thresholds?: NoveltyThresholds): NoveltyReport;
```

**Implementation:** per seed dir: founders from `roster.json`; evolved from `final-state.json.gz` alive NPCs (identity/policy/beliefs); N1 `comparePooled(founders, evolved).verbL1`; N2 `meanPairwiseVerbL1(evolved, SCENARIOS, 2000)` vs founders' (25 founders = 300 pairs exhaustive; evolved up to 60 → cap 2000 = C(60,2)+margin, exhaustive); N3 cross vs the fixed arm's founder roster of the SAME seed index (`fixedFounderRosters` keyed by seed index — for seed `<prefix>-evolutionary-4` use `<prefix>-fixed-4`'s roster). Arm gates: count seeds passing each; pass iff ≥ minPassingSeeds. CLI `formal novelty --arm evolutionary|noculture --out runs/formal` writes `novelty-<arm>.json` (requires the fixed arm's dirs present for N3).

- [ ] **Step 1: Failing tests** — construct two tiny in-memory "runs" without disk: test the pure core by refactoring: `evaluateNoveltyForSeed(founders, evolved, fixedFounders, thresholds)` exported; assert: identical evolved==founders population → n1≈0 → n1Pass false; a hand-mutated evolved set (shift every forage weight by 400, epsilon 0) → n1 > 0 and pass flags consistent with thresholds; N2 ratio math checked against direct meanPairwiseVerbL1 calls; thresholds parameterization honored (pass with loose thresholds, fail with strict). Disk-level `evaluateNovelty` covered by one integration case reading a Task-1-produced pilot dir (reuse the fixture from tests/formal.test.ts if runtime allows; timeout 120s ok).
- [ ] **Step 2: Verify fail; implement; suite green**
- [ ] **Step 3: Commit** — `git commit -m "feat: N-gate codification - pooled drift, diversity maintenance, directional novelty"`

---

### Task 3: Biography sampler v2 + pairing/blinding + judge packet

**Files:**
- Create: `src/chronicle/sample.ts`, `src/eval/pairing.ts`, `src/cli/evalpack.ts`
- Modify: `src/chronicle/biography.ts` (accept explicit selection; default path unchanged), `package.json` (script `"evalpack": "tsx src/cli/evalpack.ts"`)
- Test: `tests/sample.test.ts`, `tests/pairing.test.ts`

**Interfaces (Produces):**

```typescript
// src/chronicle/sample.ts
export interface SampledEvent { kind: "birth" | "death" | "belief"; tick: number; npcId: string; }
export function stratifiedSelect(c: LineageChronicle, budget?: number, bands?: number): SampledEvent[]; // frozen rule, defaults 12/4
// src/chronicle/biography.ts
export function renderBiography(c: LineageChronicle, manifest: WorldManifest, selection?: SampledEvent[]): string;
// selection given: render EXACTLY the selected events (same sentence templates, chronological within the doc's existing section structure); selection omitted: v1 behavior byte-identical (existing committed examples must not change).
// src/eval/pairing.ts
export interface BioCandidate { arm: string; seedRoot: string; lineageId: string; peakGeneration: number; text: string; }
export interface EvalPair { pairId: string; left: BioCandidate; right: BioCandidate; leftIsEvolutionary: boolean; }
export function pickLineages(events: SemanticEvent[], finalState: WorldState, roster: RosterEntry[], seedRoot: string): string[]; // deepest surviving lineage + drawInt(seedRoot, n, "bio-pick", k) for k=0,1 over remaining survivors (dedup); <3 survivors → all
export function buildPairs(evo: BioCandidate[], hand: BioCandidate[], seedRoot: string): EvalPair[]; // band match (1–15/16–30/31+), length ±20% else redraw within band, left/right via drawInt(seedRoot, 2, "bio-side", pairId)
export function blindingViolations(text: string): string[];  // returns matched forbidden strings (empty = clean)
```

Forbidden strings for `blindingViolations` (frozen list): `"tick"`, `"拍"`, `"random"`, `"fixed"`, `"handcrafted"`, `"evolutionary"`, `"noculture"`, `"算力"`, `"代币"`, `"模型"`, `"锦标赛"`, `"LoRA"`, `"世界进化"`, plus any seedRoot passed in as an extra argument list. (Biographies use 第X年夏 notation so "拍" must not appear.)

CLI `npm run evalpack -- --out runs/formal --arms evolutionary,handcrafted --pairs 25 --packet runs/evalpack`: reads archived dirs, extracts chronicles (from events.jsonl.gz + final-state + roster), samples, renders, pairs, checks blinding (violations → hard error listing them), writes `packet.html` (pairs sequentially, per pair: two `<pre>` columns labeled 甲/乙 + the single question + radio placeholder text — a printable static file, no JS needed) and `answer-key.json` (pairId → which side is evolutionary; NOT included in packet).

- [ ] **Step 1: Failing tests** — sample.test.ts: build a synthetic LineageChronicle (30 generations, dense events: ≥2 deaths+2 births+2 beliefs per 5-generation stretch) and assert: total selected ≤ 12; per-band initial allocation 3 with documented rollover behavior (construct a chronicle with an EMPTY band 2 and assert its budget lands in band 3); priority (a band with 4 deaths + 4 births selects 3 deaths); determinism (same input → same output); v1 renderer unchanged: `renderBiography(c, manifest)` for the committed example inputs stays byte-identical (reuse the existing biography test fixture/goldens — find them via `ls tests/*biography*` / `ls tests/*chronicle*` and extend, do not weaken). pairing.test.ts: band matching, length-±20% redraw (construct one long + one short candidate then a fitting one), drawInt side assignment determinism, blindingViolations catches each forbidden string and passes a clean biography.
- [ ] **Step 2: Verify fail; implement; suite green**
- [ ] **Step 3: Commit** — `git commit -m "feat: stratified biography sampling v2 + blinded pairing and judge packet"`

---

### Task 4: Endpoint stats + rubric + analysis master + docs

**Files:**
- Create: `src/analysis/stats.ts`, `src/cli/analyze.ts`, `docs/eval-rubric.md`
- Modify: `package.json` (`"analyze": "tsx src/cli/analyze.ts"`), `docs/prereg-1c-draft.md` (§7 archive policy amendment; §9 items marked 已交付(待冻结)), `README.md`
- Test: `tests/analysis-stats.test.ts`

**Interfaces (Produces):**

```typescript
// src/analysis/stats.ts
export function binomTwoSided(k: number, n: number, p0?: number): number;   // exact two-sided p (sum of ≤-likely outcomes), p0 default 0.5
export function holmBonferroni(pvals: { name: string; p: number }[], alpha?: number): { name: string; p: number; adjustedAlpha: number; reject: boolean }[];
export function clusterRobustPrefSE(judgments: { judgeId: string; choseEvolutionary: boolean }[]): { pHat: number; se: number; z: number; pValue: number }; // cluster-sandwich over judges
export function cohenKappa(a: number[], b: number[]): number;               // two raters, categorical codes
```

`docs/eval-rubric.md`: the three secondary endpoints' operational rubrics — recall accuracy (3 single-choice questions template + scoring), causal-retelling completeness (0–3 anchored rubric: 0 无因果 / 1 单代事实 / 2 两代因果链 / 3 三代完整链条，含评分例句), conversion (single yes/no wording). Double-rater protocol: both raters score all retellings; κ ≥ 0.6 required else adjudicate + re-rubric. Written in the repo's doc register.

`src/cli/analyze.ts`: `npm run analyze -- --out runs/formal [--judgments <csv>]` → aggregates: per-arm S-gate reports (reuse evaluateSGates), novelty reports if present, and — when `--judgments` given (CSV `pairId,judgeId,choice` with choice ∈ {left,right}) — joins with `answer-key.json`, computes primary endpoint (exact binomial two-sided vs 0.5 + point estimate vs 0.62 + Wilson CI + cluster-robust recheck) and prints the Go/Iterate/Stop mapping from prereg draft §6 (as a RECOMMENDATION line, decision stays human). Writes `analysis.json`.

- [ ] **Step 1: Failing tests** — stats: binomTwoSided(10,20)≈1; binomTwoSided(15,20) < 0.05 → check against known value (0.0414 two-sided exact for p0=0.5 — implementer: verify with an independent hand computation in the test comment); holm ordering + rejection cascade on a worked example; clusterRobustPrefSE degenerates to ~binomial SE when every judge has 1 judgment, shrinks vs naive when judges agree within cluster (construct both); cohenKappa: perfect agreement → 1, independent-looking constructed example → known hand-computed value (show the arithmetic in a comment).
- [ ] **Step 2: Verify fail; implement; suite green**
- [ ] **Step 3: Docs** — prereg draft: §7 amend archive policy (state the rationale: determinism makes raw action logs redundant; chain tip + checkpoints + strict re-run is the verification path); §9 each item → 已交付(待冻结) with file pointers; add analyze/evalpack/formal commands to README.
- [ ] **Step 4: `npm test && npm run typecheck` green; commit** — `git commit -m "feat: endpoint statistics + rubric + analysis master; prereg draft updated"`

---

## Self-Review Notes

- Prereg §9 items 1–5 each map to a task (runner+S=T1, N=T2, sampler/pairing/packet=T3, rubric/κ/stats/master=T4). Analysis thresholds are parameters, so freeze-time adjustments (§10 待拍板) don't require code edits.
- Archive policy change is surfaced as an explicit prereg-draft amendment (Task 4), not a silent divergence.
- v1 biography path pinned byte-identical to protect committed examples; official-seed prefix guarded by an explicit non-default flag value.
- Pilot-scale tests keep suite runtime sane (3000-tick fixture reused across T1/T2).
