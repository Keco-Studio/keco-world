# Audit Closure (strict verification + directive persistence) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two audit follow-ups recorded in docs/product-shell.md §3.4: (1) a strict verification mode — full no-injection live re-simulation that regenerates ground-truth logs and catches annotation-field tampering that injected replay structurally cannot; (2) the run/replay CLIs persist and load `patronDirectives`, so patronized runs are disk-auditable end to end.

**Architecture:** `verifyStrict` in src/replay/replay.ts runs `runSim` with NO injectedActions (same manifest/roster/seed/directives), hash-compares the regenerated action log event-by-event and the regenerated checkpoint set against the provided record. A directives JSON file (flat array, grouped to the engine Map on load) becomes part of the run directory; replay CLI gains a `--strict` flag.

**Tech Stack:** existing kernel. No new dependencies. No schema-version bump (directives.json is a new sidecar file, not a schema change; absent file = no directives, backward compatible with existing run dirs).

## Global Constraints

- Strict mode semantics (frozen): regenerate via live simulation — `runSim(manifest, roster, seedRoot, { ticks, patronDirectives })` — then compare (a) action logs event-by-event via `hashCanonical` (count mismatch or first differing index both reported with the event's tick), (b) checkpoint sets exactly (same rule as verifyReplay). Strict PASS ⇒ every field of every event, including annotation fields (`actionSource`/`patronInfluence`/`patronDecisive`), matches ground truth.
- Directive file format (frozen): `directives.json` = JSON array of `{ tick, npcId, theme }` (theme: UtilityKey or null), zod-validated (`PatronDirectiveFileS`), sorted by (tick, npcId) on write; loader groups into `Map<tick, {npcId, theme}[]>` preserving array order within a tick. An ABSENT file means no directives; an empty array is written when a run had none (explicit record).
- verifyStrict must NOT modify verifyReplay's behavior — the two verdicts are complementary (injected replay = world-trajectory faithfulness + completeness localization; strict = annotation ground truth) and the CLI reports them separately.
- Determinism doctrine: integer-only, no Date.now/Math.random under src/.
- Commits end with the Co-Authored-By trailer from the harness rules.

---

### Task 1: verifyStrict + directive file codec

**Files:**
- Modify: `src/replay/replay.ts` (add StrictReport, verifyStrict)
- Modify: `src/schema/log.ts` (add PatronDirectiveFileS)
- Test: `tests/strict-verify.test.ts`

**Interfaces (Produces):**

```typescript
// src/schema/log.ts
export const PatronDirectiveFileS = z.array(
  z.object({ tick: z.number().int().min(0), npcId: z.string(), theme: z.enum(UTILITY_KEYS).nullable() }).strict(),
);
export type PatronDirectiveFile = z.infer<typeof PatronDirectiveFileS>;

// src/replay/replay.ts
export interface StrictReport {
  ok: boolean;
  eventCountProvided: number;
  eventCountRegenerated: number;
  /** index into the provided log of the first event whose hashCanonical differs (null when ok
   * or when the mismatch is count-only past the shorter log's end) */
  firstDivergentEventIndex: number | null;
  /** tick of that event (from whichever log has it) */
  firstDivergentEventTick: number | null;
  checkpointsOk: boolean;
}
export function verifyStrict(
  manifest: WorldManifest,
  roster: RosterEntry[],
  seedRoot: string,
  actionLog: CanonicalActionEvent[],
  recordedCheckpoints: Checkpoint[],
  ticks: number,
  patronDirectives?: RunOptions["patronDirectives"],
): StrictReport;
export function directivesToMap(file: PatronDirectiveFile): NonNullable<RunOptions["patronDirectives"]>;
export function directivesToFile(map: RunOptions["patronDirectives"] | undefined): PatronDirectiveFile;
```

`verifyStrict`: run `runSim(manifest, roster, seedRoot, { ticks, patronDirectives })` (live, retainActionLog default true); compare logs: first differing index by `hashCanonical(provided[i]) !== hashCanonical(regenerated[i])` over `i < min(lengths)`; if none differ but lengths differ, `firstDivergentEventIndex = null` and `firstDivergentEventTick = ` the tick of the first extra event in the longer log; checkpointsOk: regenerated checkpoints array deep-equals recorded (same ticks, same hashes, via hashCanonical of the two arrays). `ok = logs fully match && checkpointsOk`.
`directivesToFile`: flatten the map to `{tick, npcId, theme}` rows sorted by (tick asc, npcId UTF-16 asc); undefined map → `[]`. `directivesToMap`: group rows by tick preserving file order.

- [ ] **Step 1: Write the failing tests** — `tests/strict-verify.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runSim } from "../src/sim/engine.js";
import { verifyStrict, verifyReplay, directivesToMap, directivesToFile } from "../src/replay/replay.js";
import { PatronDirectiveFileS } from "../src/schema/log.js";
import { makeDemoManifest, makeDemoRoster } from "../src/cli/demo.js";

const DIRS_FILE = [{ tick: 50, npcId: "npc-1", theme: "forage" as const }];

describe("strict verification", () => {
  const manifest = makeDemoManifest();
  const roster = makeDemoRoster("strict-t");
  const dirs = directivesToMap(PatronDirectiveFileS.parse(DIRS_FILE));
  const run = runSim(manifest, roster, "strict-t", { ticks: 400, patronDirectives: dirs });

  it("passes on an untampered patronized run", () => {
    const r = verifyStrict(manifest, roster, "strict-t", run.actionLog, run.checkpoints, 400, dirs);
    expect(r.ok).toBe(true);
    expect(r.eventCountProvided).toBe(r.eventCountRegenerated);
  });

  it("catches a fully re-chained annotation flip that injected replay accepts", () => {
    // Flip patronDecisive on a decisive event (or patronInfluence on any event), then re-stitch
    // the entire hash chain so the log is internally consistent.
    const tampered = structuredClone(run.actionLog);
    const idx = tampered.findIndex((e) => e.patronInfluence);
    expect(idx).toBeGreaterThanOrEqual(0);
    tampered[idx]!.patronInfluence = false;
    tampered[idx]!.patronDecisive = false;
    // re-chain from idx onward
    const { hashCanonical } = await_import_guard();
    for (let i = idx; i < tampered.length; i++) {
      tampered[i]!.previousEventHash = i === 0 ? null : hashCanonical(tampered[i - 1]!);
    }
    // Injected replay passes (documented blind spot):
    const rep = verifyReplay(manifest, roster, "strict-t", tampered, run.checkpoints, 400, dirs);
    expect(rep.ok).toBe(true);
    // Strict catches it:
    const strict = verifyStrict(manifest, roster, "strict-t", tampered, run.checkpoints, 400, dirs);
    expect(strict.ok).toBe(false);
    expect(strict.firstDivergentEventIndex).toBe(idx);
    expect(strict.firstDivergentEventTick).toBe(run.actionLog[idx]!.tick);
  });

  it("catches directive omission (regenerated log lacks tilted trajectory)", () => {
    const strict = verifyStrict(manifest, roster, "strict-t", run.actionLog, run.checkpoints, 400, undefined);
    expect(strict.ok).toBe(false);
  });

  it("directive codec round-trips and sorts deterministically", () => {
    const file = directivesToFile(dirs);
    expect(file).toEqual(DIRS_FILE);
    expect(directivesToFile(directivesToMap(file))).toEqual(file);
    expect(directivesToFile(undefined)).toEqual([]);
  });
});
```

(`await_import_guard` is a placeholder in this plan text ONLY — the implementer imports `hashCanonical` from `../src/canon/canonicalize.js` at the top of the file like every other test; do not create such a function.)

NOTE for the implementer: the second test assumes checkpoint hashes do NOT cover annotation fields (they don't — annotations never touch WorldState) and that verifyReplay's regenerated-log comparison reproduces injected annotations verbatim (it does — that is the documented blind spot this task closes). If `rep.ok` comes back false, investigate rather than deleting the assertion: something about the tamper construction (e.g. the re-chaining) is wrong.

- [ ] **Step 2: Run tests, verify fail; implement; `npm test && npm run typecheck` green**
- [ ] **Step 3: Commit**

```bash
git add src/replay/replay.ts src/schema/log.ts tests/strict-verify.test.ts
git commit -m "feat: strict verification - no-injection re-simulation catches annotation tampering"
```

---

### Task 2: CLI wiring + docs

**Files:**
- Modify: `src/cli/run.ts` (accept `--directives <file>`, always write `directives.json`)
- Modify: `src/cli/replay.ts` (load `directives.json` when present, pass to both verifiers; `--strict` flag)
- Modify: `docs/product-shell.md` (§3.4: mark both follow-ups closed, describe the two-verdict model), `README.md` (replay --strict, run --directives)
- Test: `tests/run-replay-cli.test.ts` (extend if it exists — check first; else create)

**Implementation:**
- run.ts: `--directives <path>` reads + `PatronDirectiveFileS.parse`s the file, `directivesToMap`s it into runSim opts; ALWAYS writes `directives.json` to the run dir (the parsed file's canonical sorted form, `[]` when none) so every new run dir is explicit.
- replay.ts: after loading the existing artifacts, attempt `directives.json` (absent → undefined, no error — old run dirs stay verifiable); run `verifyLogChain` + `verifyReplay` as today, and when `--strict` is passed also `verifyStrict`; print three labeled verdicts (`log chain` / `replay` / `strict`); exit 0 only if all requested checks pass. Strict output on failure prints `first divergent event index/tick`.
- CLI test: use node's child_process? NO — keep it in-process like other tests: extract nothing; instead test the two pure loaders indirectly via Task 1's codec tests, and add ONE integration test here that writes a small run dir via the run CLI's building blocks (runSim + the same writeFileSync layout, or simply call the run CLI via `execFileSync` with tsx — mirror however existing CLI tests in this repo do it; check `ls tests/*cli*` first and follow the established pattern; if no CLI-spawning test exists, test at the function level by refactoring run.ts's body into an exported `runAndPersist(opts)` + replay.ts's into `loadAndVerify(runDir, {strict})`, each with a guarded-main, and unit-test those).

Required behaviors pinned by the test (whatever the mechanism):
1. A patronized run persisted to disk, then verified with strict mode, passes.
2. Deleting/omitting `directives.json` from that run dir makes strict verification fail (and replay verification fail too — patronThemes state diverges).
3. An unpatronized legacy-layout run dir (no directives.json) still verifies clean including `--strict`.

- [ ] **Step 1: Check `ls tests/` for existing CLI test patterns; write the failing tests per the pinned behaviors**
- [ ] **Step 2: Implement; `npm test && npm run typecheck` green**
- [ ] **Step 3: Update docs/product-shell.md §3.4 (both follow-up items → closed, with the two-verdict model: 注入式重放=世界轨迹忠实性+完整性定位；严格模式=注记真值；何时用哪个) and README**
- [ ] **Step 4: Commit**

```bash
git add src/cli/run.ts src/cli/replay.ts tests/ docs/product-shell.md README.md
git commit -m "feat: run/replay CLIs persist and verify patron directives; --strict mode"
```

---

## Self-Review Notes

- The strict-mode test reproduces the EXACT attack the final review adjudicated (fully re-chained annotation flip passing injected replay) and pins both halves: the blind spot stays documented-and-true, the new mode closes it.
- Directive sidecar avoids a schema bump; absent-file semantics keep every existing run dir verifiable.
- Task 2 leaves test mechanism flexible (repo may or may not have CLI-spawn precedent) but pins the three behaviors that matter.
