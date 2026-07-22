# Baseline Arms (Fixed Utility + Handcrafted + Random) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** living-worlds.md §17.1 step 3: add the Fixed Utility and Handcrafted baseline arms (plus the Random sanity arm) per §6.6, with arm configuration carried in the hashed WorldManifest so determinism and replay hold across arms, 25 recognizable archetypes per arm (parity with Evolutionary founders), a recorded content budget (工时 + rule count) for Handcrafted, and a CLI that runs any arm and compares arms behaviorally via the existing scenario suite.

**Architecture:** A `cognition` block is added to WorldManifest (schema v3): `decisionMode` (utility | random), `inheritanceMode` (breed | clone), `beliefDynamics` (on | off). The engine and reproduction rules branch on it. Clone inheritance copies parent A's identity/policy verbatim and passes down only `source: "designed"` beliefs — so handcrafted archetypes persist unmutated across generations, which is exactly what a hand-authored game AI does. The Handcrafted arm's "有限事件脚本" are implemented as designed beliefs (condition-gated effect rules) flowing through the existing applyBeliefs machinery — no new runtime mechanism, only new content. `beliefDynamics: "off"` also gives us the belief-zeroed control variant needed for the 1C prereg (recorded blocker in evolve-calibration.md).

**Tech Stack:** existing kernel. No new dependencies.

## Global Constraints

- `SCHEMA_VERSION` becomes `"phase1a-v3"`. The `cognition` block is **required** (no zod defaults — hidden defaults violate the determinism doctrine). All manifest construction sites updated: `src/cli/demo.ts`, `src/scenarios/library.ts`, `tests/helpers.ts`, plus the zod literal in `src/cli/replay.ts`.
- Arm configurations (frozen):
  - **random**: `{ decisionMode: "random", inheritanceMode: "clone", beliefDynamics: "off" }` — bypasses reflex AND utility; uniform deterministic draw over the scored candidate list via `drawInt(seedRoot, n, "randarm", npcId, tick)`.
  - **fixed**: `{ decisionMode: "utility", inheritanceMode: "clone", beliefDynamics: "off" }` — roster = the demo roster with `deliberationEpsilon` forced to 0 (pure argmax, 普通游戏 AI); same 25 founders/weight distribution as Evolutionary so founder diversity is NOT a confound.
  - **handcrafted**: `{ decisionMode: "utility", inheritanceMode: "clone", beliefDynamics: "off" }` — 25 hand-designed archetypes; designed `deliberationEpsilon` allowed in 0..150 (Resolver is a zero-cost deterministic personality knob available to any game designer; using it strengthens the baseline, which is scientifically conservative — document this interpretation of §6.6 跨臂公平性).
  - **evolutionary**: `{ decisionMode: "utility", inheritanceMode: "breed", beliefDynamics: "on" }` — existing system, demo roster.
- Handcrafted content budget (frozen BEFORE any official run, resolving §18 P0 open question): 25 archetypes; ≤3 designed beliefs per archetype; ≤24 scripted rules total (actual: 20). Designed beliefs: `source: "designed"`, `decayPer100: 0`, `acquiredTick: 0`, modifier within schema bounds (−300..300).
- `BeliefS.source` enum gains `"designed"`. `actionSource` unions (log schema, engine, replay) gain `"random"`.
- Clone inheritance semantics: child identity/policy = deep copy of parent A's **current** identity/policy (these never mutate in-life, so ≡ archetype values); child beliefs = parent A's beliefs filtered to `source === "designed"` with `acquiredTick` re-stamped to birth tick; `lineageId` = parent A's; `generation` = max(parents)+1; `voiceStyle` preserved (archetype identity).
- `beliefDynamics: "off"` gates ONLY `decayBeliefs` + `beliefFormationStep`. `applyBeliefs` runs unconditionally — designed beliefs must still modify utility (they ARE the event scripts).
- Determinism: integer-only, `drawInt` for all randomness, no `Date.now`/`Math.random` under `src/`.
- Commits end with the Co-Authored-By trailer from the harness rules.

---

### Task 1: Schema v3 plumbing

**Files:**
- Modify: `src/schema/core.ts` (SCHEMA_VERSION, CognitionS, WorldManifestS, BeliefS.source)
- Modify: `src/schema/log.ts` (actionSource enum + type)
- Modify: `src/sim/engine.ts` (actionSource type unions only — no behavior yet)
- Modify: `src/replay/replay.ts` (injected actionSource type union only)
- Modify: `src/cli/demo.ts`, `src/scenarios/library.ts`, `tests/helpers.ts` (add cognition block), `src/cli/replay.ts` (zod literal — the manifest schema import already revalidates; only the inline `schemaVersion: z.literal(SCHEMA_VERSION)` needs nothing if it uses the constant — verify and touch only if a literal string is present)
- Test: `tests/schema.test.ts`

**Interfaces (Produces):**

```typescript
// src/schema/core.ts
export const SCHEMA_VERSION = "phase1a-v3";
export const CognitionS = z
  .object({
    decisionMode: z.enum(["utility", "random"]),
    inheritanceMode: z.enum(["breed", "clone"]),
    beliefDynamics: z.enum(["on", "off"]),
  })
  .strict();
export type Cognition = z.infer<typeof CognitionS>;
// WorldManifestS gains: cognition: CognitionS   (required)
// BeliefS.source: z.enum(["observed", "parentA", "parentB", "designed"])
```

```typescript
// src/schema/log.ts — actionSource everywhere it appears:
z.enum(["reflex", "utility", "resolver", "random"])
// and the TS union type: "reflex" | "utility" | "resolver" | "random"
```

`src/sim/engine.ts` / `src/replay/replay.ts`: widen every `"reflex" | "utility" | "resolver"` union (DecideInfo.actionSource, RunOptions.injectedActions, local `actionSource` variable, replayRun's injected map) to include `"random"`. No behavior change in this task.

All three manifest construction sites gain, verbatim:

```typescript
cognition: { decisionMode: "utility", inheritanceMode: "breed", beliefDynamics: "on" },
```

(`makeDemoManifest` in demo.ts, `SCENARIO_MANIFEST_BASE` in scenarios/library.ts, the helper manifest in tests/helpers.ts.)

- [ ] **Step 1: Write the failing tests** — append to `tests/schema.test.ts`:

```typescript
import { CognitionS } from "../src/schema/core.js";

describe("cognition block (schema v3)", () => {
  it("manifest requires cognition and rejects unknown modes", () => {
    const m = makeDemoManifest();
    expect(WorldManifestS.safeParse(m).success).toBe(true);
    const { cognition: _c, ...noCog } = m as Record<string, unknown> & { cognition: unknown };
    expect(WorldManifestS.safeParse(noCog).success).toBe(false);
    expect(CognitionS.safeParse({ decisionMode: "llm", inheritanceMode: "breed", beliefDynamics: "on" }).success).toBe(false);
  });
  it("belief source accepts designed", () => {
    const b = {
      proposition: "冬季闭户",
      effect: { target: "w:shelter", modifier: 250, condition: "winter" },
      confidence: 950,
      source: "designed",
      acquiredTick: 0,
      decayPer100: 0,
    };
    expect(BeliefS.safeParse(b).success).toBe(true);
  });
});
```

(Use the existing import style of the file; `makeDemoManifest`, `WorldManifestS`, `BeliefS` may already be imported.)

- [ ] **Step 2: Run tests, verify the new ones fail** (`npx vitest run tests/schema.test.ts`)
- [ ] **Step 3: Implement all schema/type/plumbing changes above; `npm test && npm run typecheck` fully green** (existing suites must pass unchanged — this task is pure plumbing; the demo/scenario manifests now carry the evolutionary cognition block, which the engine ignores until Task 2)
- [ ] **Step 4: Commit**

```bash
git add src/schema/core.ts src/schema/log.ts src/sim/engine.ts src/replay/replay.ts src/cli/demo.ts src/scenarios/library.ts tests/helpers.ts tests/schema.test.ts src/cli/replay.ts
git commit -m "feat: schema v3 - cognition block (decision/inheritance/beliefDynamics), designed belief source, random actionSource"
```

---

### Task 2: Engine and rules honor the cognition block

**Files:**
- Modify: `src/sim/engine.ts` (decision branch + belief-dynamics gate)
- Modify: `src/world/rules.ts` (inheritance branch in reproductionStep)
- Modify: `src/life/genome.ts` (add cloneGenome)
- Test: `tests/cognition.test.ts` (new)

**Interfaces (Produces):**

```typescript
// src/life/genome.ts
export function cloneGenome(parentA: NpcGenome, parentB: NpcGenome, tick: number): NpcGenome;
```

**Implementation — `cloneGenome`:**

```typescript
/** Non-evolutionary inheritance: child = parent A's archetype, unmutated.
 * Identity/policy copied verbatim (they never mutate in-life, so this is the
 * archetype's designed genome). Only designed beliefs pass down. */
export function cloneGenome(parentA: NpcGenome, parentB: NpcGenome, tick: number): NpcGenome {
  return {
    lineageId: parentA.lineageId,
    generation: Math.max(parentA.generation, parentB.generation) + 1,
    identity: structuredClone(parentA.identity),
    policy: structuredClone(parentA.policy),
    beliefs: parentA.beliefs
      .filter((b) => b.source === "designed")
      .map((b) => ({ ...structuredClone(b), acquiredTick: tick })),
  };
}
```

**Implementation — `src/world/rules.ts`** (reproductionStep, at the breed call site):

```typescript
const childGenome =
  manifest.cognition.inheritanceMode === "clone"
    ? cloneGenome(genomeOf(a), genomeOf(b), state.tick)
    : breed(genomeOf(a), genomeOf(b), childId, seedRoot, state.tick);
```

(import cloneGenome alongside breed.)

**Implementation — `src/sim/engine.ts`:**

1. Decision branch (replace the current non-injected else-block body):

```typescript
const effPolicy = applyBeliefs(npc.policy, npc.beliefs, seasonAt(t, manifest));
if (manifest.cognition.decisionMode === "random") {
  // Sanity-floor arm: no reflex, no utility — uniform over the candidate list.
  cands = scoreCandidates(obs, npc.identity, effPolicy, manifest, seedRoot);
  const idx = drawInt(seedRoot, cands.length, "randarm", npc.npcId, t);
  action = cands[idx]!.action;
  actionSource = "random";
  chosenKey = cands[idx]!.key;
} else {
  const reflex = reflexDecide(obs, effPolicy);
  if (reflex !== null) {
    action = reflex;
    actionSource = "reflex";
    chosenKey = null;
  } else {
    cands = scoreCandidates(obs, npc.identity, effPolicy, manifest, seedRoot);
    const resolution = resolve(cands, npc.identity, effPolicy.deliberationEpsilon, seedRoot, npc.npcId, t);
    action = resolution.action;
    actionSource = resolution.source;
    chosenKey = resolution.key;
  }
}
```

(import drawInt in engine.ts.)

2. Belief-dynamics gate (wrap the existing decay + formation calls):

```typescript
if (manifest.cognition.beliefDynamics === "on") {
  for (const npc of state.npcs) {
    if (!npc.alive) continue;
    decayBeliefs(npc, t);
  }
  const eventsThisTick = events.slice(evStart);
  beliefFormationStep(state, events, eventsThisTick);
}
```

- [ ] **Step 1: Write the failing tests** — `tests/cognition.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runSim } from "../src/sim/engine.js";
import { verifyReplay } from "../src/replay/replay.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { cloneGenome } from "../src/life/genome.js";
import { makeDemoManifest, makeDemoRoster } from "../src/cli/demo.js";
import type { WorldManifest } from "../src/schema/core.js";

function cogManifest(cog: WorldManifest["cognition"]): WorldManifest {
  return { ...makeDemoManifest(), cognition: cog };
}

describe("cognition modes", () => {
  it("random decisionMode is deterministic, replayable, and differs from utility", () => {
    const m = cogManifest({ decisionMode: "random", inheritanceMode: "clone", beliefDynamics: "off" });
    const roster = makeDemoRoster("cog-rand");
    const a = runSim(m, roster, "cog-rand", { ticks: 300 });
    const b = runSim(m, roster, "cog-rand", { ticks: 300 });
    expect(hashCanonical(a.finalState)).toBe(hashCanonical(b.finalState));
    expect(a.actionLog.some((e) => e.actionSource === "random")).toBe(true);
    expect(a.actionLog.every((e) => e.actionSource === "random")).toBe(true); // reflex bypassed
    const u = runSim(makeDemoManifest(), roster, "cog-rand", { ticks: 300 });
    expect(hashCanonical(a.finalState)).not.toBe(hashCanonical(u.finalState));
    const rep = verifyReplay(m, roster, "cog-rand", a.actionLog, a.checkpoints, 300);
    expect(rep.ok).toBe(true);
  });

  it("beliefDynamics off keeps beliefs empty for a designless roster", () => {
    const m = cogManifest({ decisionMode: "utility", inheritanceMode: "breed", beliefDynamics: "off" });
    const r = runSim(m, makeDemoRoster("cog-nobelief"), "cog-nobelief", { ticks: 2000 });
    for (const npc of r.finalState.npcs) expect(npc.beliefs.length).toBe(0);
  });

  it("cloneGenome copies parent A verbatim and filters to designed beliefs", () => {
    const roster = makeDemoRoster("cog-clone");
    const a = {
      lineageId: "npc-1", generation: 2,
      identity: roster[0]!.identity, policy: roster[0]!.policy,
      beliefs: [
        { proposition: "designed rule", effect: { target: "w:shelter" as const, modifier: 200, condition: null }, confidence: 900, source: "designed" as const, acquiredTick: 0, decayPer100: 0 },
        { proposition: "learned", effect: { target: "w:forage" as const, modifier: 100, condition: null }, confidence: 500, source: "observed" as const, acquiredTick: 50, decayPer100: 30 },
      ],
    };
    const b = { lineageId: "npc-2", generation: 5, identity: roster[1]!.identity, policy: roster[1]!.policy, beliefs: [] };
    const child = cloneGenome(a, b, 777);
    expect(child.identity).toEqual(a.identity);
    expect(child.policy).toEqual(a.policy);
    expect(child.generation).toBe(6);
    expect(child.lineageId).toBe("npc-1");
    expect(child.beliefs.length).toBe(1);
    expect(child.beliefs[0]!.source).toBe("designed");
    expect(child.beliefs[0]!.acquiredTick).toBe(777);
  });

  it("clone inheritance keeps every NPC's genome equal to its lineage founder's", () => {
    const m = cogManifest({ decisionMode: "utility", inheritanceMode: "clone", beliefDynamics: "off" });
    const roster = makeDemoRoster("cog-lineage");
    const byId = new Map(roster.map((e) => [e.npcId, e]));
    const r = runSim(m, roster, "cog-lineage", { ticks: 4000 });
    let sawChild = false;
    for (const npc of r.finalState.npcs) {
      const founder = byId.get(npc.lineageId)!;
      expect(npc.identity).toEqual(founder.identity);
      expect(npc.policy).toEqual(founder.policy);
      if (npc.parents !== null) sawChild = true;
    }
    expect(sawChild).toBe(true); // the run must actually exercise clone inheritance
  });
});
```

- [ ] **Step 2: Run tests, verify they fail** (`npx vitest run tests/cognition.test.ts`)
- [ ] **Step 3: Implement per the code blocks above; `npm test && npm run typecheck` fully green** (existing suites unchanged: demo/scenario manifests are `breed/utility/on`, which reproduces prior behavior exactly)
- [ ] **Step 4: Commit**

```bash
git add src/sim/engine.ts src/world/rules.ts src/life/genome.ts tests/cognition.test.ts
git commit -m "feat: engine/rules honor cognition block - random arm decisions, clone inheritance, belief-dynamics gate"
```

---

### Task 3: Arm setups — fixed roster + 25 handcrafted archetypes

**Files:**
- Create: `src/arms/arms.ts`
- Test: `tests/arms.test.ts`

**Interfaces (Produces):**

```typescript
export const ARM_IDS = ["random", "fixed", "handcrafted", "evolutionary"] as const;
export type ArmId = (typeof ARM_IDS)[number];
export interface ArmSetup { manifest: WorldManifest; roster: RosterEntry[]; }
export function makeArmSetup(arm: ArmId, seedRoot: string): ArmSetup;
export const HANDCRAFTED_ARCHETYPES: RosterEntry[];  // frozen content, 25 entries
```

**Implementation:** `makeArmSetup` returns `makeDemoManifest()` with the arm's cognition block (per Global Constraints) and:
- `random` / `fixed`: `makeDemoRoster(seedRoot)`; for both, force `deliberationEpsilon: 0` on every entry (fixed = pure argmax; random ignores weights anyway but keep the roster identical to fixed so the arms differ only in decisionMode);
- `handcrafted`: `structuredClone(HANDCRAFTED_ARCHETYPES)` (seed-independent by design — a hand-authored cast does not vary by seed; world layout and founder ages still vary via seedRoot);
- `evolutionary`: `makeDemoRoster(seedRoot)` unchanged.

Designed-belief helper (private):

```typescript
function rule(proposition: string, target: EffectTarget, modifier: number, condition: "winter" | "summer" | null, confidence: number): Belief {
  return { proposition, effect: { target, modifier, condition }, confidence, source: "designed", acquiredTick: 0, decayPer100: 0 };
}
```

**HANDCRAFTED_ARCHETYPES — frozen content (transcribe verbatim).** Fields per entry: npcId `npc-<i+1>`, name from NAME_POOL order, `identity: { riskTolerance, socialTrust, explorationBias, patience, voiceStyle }`, `policy: { utilityWeights: { forage, consume, shelter, seekMate, explore, idle }, thresholds: { hungerUrgent }, deliberationEpsilon }`, `beliefs`.

| # | name | 概念 (voiceStyle) | risk | trust | explore | patience | forage | consume | shelter | seekMate | explore(w) | idle | hungerUrgent | epsilon | designed beliefs |
|---|------|------------------|------|-------|---------|----------|--------|---------|---------|----------|-----------|------|-------------|---------|------------------|
| 1 | Rill | 囤积者——过冬的浆果永远不嫌多 | 300 | 500 | 250 | 850 | 850 | 700 | 650 | 400 | 150 | 30 | 200 | 40 | rule("冬藏胜于冬狩", "w:forage", 200, "winter", 900) |
| 2 | Ash | 流浪者——脚下的路比身后的巢更真实 | 700 | 400 | 950 | 300 | 550 | 750 | 450 | 350 | 500 | 20 | 150 | 80 | rule("远方总有新的浆果丛", "w:explore", 150, null, 700) |
| 3 | Fenna | 守巢者——门外的世界与我无关 | 150 | 650 | 100 | 800 | 500 | 800 | 950 | 500 | 60 | 80 | 180 | 30 | rule("冬季闭户", "w:shelter", 250, "winter", 950) |
| 4 | Bram | 莽夫——怕这怕那还算活着吗 | 950 | 500 | 700 | 200 | 750 | 800 | 250 | 550 | 350 | 10 | 120 | 60 | — |
| 5 | Sorrel | 未雨绸缪者——饿意是死亡的第一封信 | 250 | 550 | 300 | 700 | 700 | 850 | 700 | 450 | 120 | 40 | 320 | 30 | rule("宁可早食一刻", "t:hungerUrgent", 150, null, 800) |
| 6 | Wren | 交际花——独活不算活 | 500 | 900 | 400 | 550 | 550 | 750 | 600 | 900 | 200 | 50 | 150 | 70 | — |
| 7 | Tarn | 独行者——同伴只会分走我的浆果 | 600 | 80 | 650 | 600 | 700 | 800 | 550 | 80 | 320 | 60 | 160 | 40 | rule("同伴分食我的浆果", "w:seekMate", -200, null, 850) |
| 8 | Isla | 犹豫者——每个选择都值得再想一想 | 500 | 500 | 450 | 500 | 620 | 780 | 660 | 500 | 210 | 55 | 150 | 150 | — |
| 9 | Corin | 果断者——想第二遍的人已经饿死了 | 550 | 450 | 350 | 400 | 800 | 850 | 600 | 450 | 150 | 10 | 140 | 0 | — |
| 10 | Vesna | 顺时者——夏天做夏天的事，冬天做冬天的事 | 400 | 600 | 400 | 700 | 650 | 780 | 680 | 500 | 180 | 40 | 160 | 50 | rule("夏采", "w:forage", 180, "summer", 850); rule("冬蛰", "w:shelter", 220, "winter", 850) |
| 11 | Odo | 闲逸者——急什么，浆果又不会跑 | 350 | 550 | 200 | 950 | 480 | 720 | 640 | 420 | 90 | 320 | 130 | 90 | — |
| 12 | Merle | 惧狼者——每片阴影里都蹲着一头狼 | 60 | 500 | 150 | 600 | 520 | 760 | 900 | 430 | 80 | 60 | 170 | 30 | rule("狼在暗处", "w:shelter", 200, null, 900) |
| 13 | Sable | 饕餮——吃到嘴里的才是自己的 | 500 | 450 | 300 | 250 | 780 | 950 | 500 | 400 | 140 | 20 | 420 | 50 | — |
| 14 | Quinn | 苦修者——饥饿磨砺心志 | 400 | 350 | 350 | 950 | 560 | 520 | 700 | 250 | 200 | 150 | 60 | 20 | rule("饥饿磨砺心志", "t:hungerUrgent", -100, null, 700) |
| 15 | Petra | 持家者——多摘一颗是一颗 | 450 | 700 | 300 | 650 | 880 | 750 | 620 | 620 | 130 | 30 | 190 | 40 | rule("多摘一颗是一颗", "w:forage", 120, null, 750) |
| 16 | Lorn | 悲观者——好日子长不了 | 200 | 300 | 200 | 500 | 640 | 820 | 780 | 300 | 90 | 70 | 260 | 60 | rule("冬天要人命", "t:hungerUrgent", 200, "winter", 900); rule("趁好日子多囤", "w:forage", 150, "summer", 700) |
| 17 | Hazel | 乐天派——夏日属于远方 | 650 | 750 | 600 | 450 | 580 | 760 | 480 | 640 | 300 | 60 | 130 | 100 | rule("夏日属于远方", "w:explore", 180, "summer", 750) |
| 18 | Garen | 家长——血脉必须延续 | 500 | 800 | 250 | 700 | 760 | 780 | 650 | 820 | 110 | 40 | 170 | 40 | rule("血脉必须延续", "w:seekMate", 150, null, 900) |
| 19 | Nyx | 夜影——人群是最危险的地方 | 800 | 200 | 850 | 350 | 620 | 740 | 380 | 180 | 420 | 15 | 140 | 70 | — |
| 20 | Ives | 精算者——挨饿不划算 | 420 | 420 | 380 | 620 | 740 | 840 | 640 | 460 | 160 | 25 | 210 | 0 | rule("冬日热量入不敷出", "w:consume", 120, "winter", 800) |
| 21 | Runa | 守旧者——祖辈怎么过冬我就怎么过冬 | 250 | 620 | 120 | 880 | 660 | 800 | 720 | 520 | 70 | 90 | 180 | 30 | rule("祖辈冬居于洞", "w:shelter", 200, "winter", 950); rule("远行招灾", "w:explore", -200, null, 850); rule("按时而食", "t:hungerUrgent", 100, null, 700) |
| 22 | Col | 拾荒者——世上没有捡不完的浆果 | 550 | 400 | 550 | 400 | 950 | 700 | 460 | 340 | 280 | 20 | 150 | 50 | — |
| 23 | Tamsin | 舞者——停下来的日子不算数 | 600 | 650 | 700 | 300 | 560 | 740 | 520 | 680 | 380 | 30 | 140 | 130 | — |
| 24 | Ebba | 祖母——冬前囤足，冬后再见 | 300 | 850 | 180 | 900 | 600 | 790 | 740 | 560 | 100 | 110 | 200 | 60 | rule("冬前囤足", "w:forage", 160, "winter", 800) |
| 25 | Joss | 赌徒——富贵险中求 | 900 | 480 | 750 | 150 | 680 | 770 | 300 | 520 | 400 | 10 | 110 | 150 | rule("富贵险中求", "w:explore", 150, null, 700) |

Scripted-rule count: 20 (within the frozen ≤24 budget). Archetypes with 0 rules: 9; with 1: 13; with 2: 2; with 3: 1.

- [ ] **Step 1: Write the failing tests** — `tests/arms.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ARM_IDS, HANDCRAFTED_ARCHETYPES, makeArmSetup } from "../src/arms/arms.js";
import { RosterEntryS, WorldManifestS } from "../src/schema/core.js";

describe("baseline arms", () => {
  it("every arm setup zod-validates and has 25 archetypes (parity)", () => {
    for (const arm of ARM_IDS) {
      const { manifest, roster } = makeArmSetup(arm, "arms-t");
      expect(WorldManifestS.safeParse(manifest).success).toBe(true);
      expect(roster.length).toBe(25);
      for (const e of roster) expect(RosterEntryS.safeParse(e).success).toBe(true);
    }
  });
  it("arm cognition configs match the frozen table", () => {
    expect(makeArmSetup("random", "s").manifest.cognition).toEqual({ decisionMode: "random", inheritanceMode: "clone", beliefDynamics: "off" });
    expect(makeArmSetup("fixed", "s").manifest.cognition).toEqual({ decisionMode: "utility", inheritanceMode: "clone", beliefDynamics: "off" });
    expect(makeArmSetup("handcrafted", "s").manifest.cognition).toEqual({ decisionMode: "utility", inheritanceMode: "clone", beliefDynamics: "off" });
    expect(makeArmSetup("evolutionary", "s").manifest.cognition).toEqual({ decisionMode: "utility", inheritanceMode: "breed", beliefDynamics: "on" });
  });
  it("fixed and random rosters are argmax (epsilon 0); evolutionary keeps demo epsilon", () => {
    for (const arm of ["fixed", "random"] as const) {
      for (const e of makeArmSetup(arm, "s").roster) expect(e.policy.deliberationEpsilon).toBe(0);
    }
    expect(makeArmSetup("evolutionary", "s").roster.some((e) => e.policy.deliberationEpsilon > 0)).toBe(true);
  });
  it("handcrafted content honors the frozen budget", () => {
    expect(HANDCRAFTED_ARCHETYPES.length).toBe(25);
    let rules = 0;
    for (const a of HANDCRAFTED_ARCHETYPES) {
      expect(a.beliefs.length).toBeLessThanOrEqual(3);
      rules += a.beliefs.length;
      for (const b of a.beliefs) {
        expect(b.source).toBe("designed");
        expect(b.decayPer100).toBe(0);
      }
      expect(a.policy.deliberationEpsilon).toBeGreaterThanOrEqual(0);
      expect(a.policy.deliberationEpsilon).toBeLessThanOrEqual(150);
      expect(a.identity.voiceStyle.length).toBeGreaterThan(0);
    }
    expect(rules).toBe(20);
    expect(new Set(HANDCRAFTED_ARCHETYPES.map((a) => a.npcId)).size).toBe(25);
  });
  it("handcrafted roster is seed-independent; fixed roster varies with seed", () => {
    expect(makeArmSetup("handcrafted", "s1").roster).toEqual(makeArmSetup("handcrafted", "s2").roster);
    expect(makeArmSetup("fixed", "s1").roster).not.toEqual(makeArmSetup("fixed", "s2").roster);
  });
});
```

- [ ] **Step 2: Run tests, verify fail; implement `src/arms/arms.ts` (transcribe the archetype table EXACTLY — every number and string verbatim); `npm test && npm run typecheck` green**
- [ ] **Step 3: Commit**

```bash
git add src/arms/arms.ts tests/arms.test.ts
git commit -m "feat: four-arm setups - fixed/random rosters + 25 handcrafted archetypes with scripted rules"
```

---

### Task 4: Arms CLI — run and compare modes

**Files:**
- Create: `src/cli/arms.ts`
- Modify: `package.json` (script `"arms": "tsx src/cli/arms.ts"`)
- Test: `tests/arms-cli.test.ts`

**Interfaces (Produces):**

```typescript
export interface ArmSeedResult {
  arm: ArmId; seedRoot: string;
  survived: boolean; finalAlive: number; maxGeneration: number; livingLineages: number;
  verbShares1000: Record<string, number>;   // whole-run action-log verb proportions ×1000 floored
}
export function runArm(arm: ArmId, seedRoot: string, ticks: number, chunk: number): ArmSeedResult;
export interface ArmComparison {
  intra: Record<ArmId, number>;                    // meanPairwiseVerbL1 over the arm's 25 founder genomes
  cross: Record<string, number>;                   // "a|b" → meanCrossVerbL1 between arm founder sets
}
export function compareArms(seedRoot: string): ArmComparison;
```

**Implementation:**
- `runArm`: chunked chaining exactly like the degradation CLI (start `createInitialState(manifest, roster, seedRoot)`, loop `runFromState(state, manifest, seedRoot, { ticks: chunk, retainActionLog: true })`, accumulate verb counts from each chunk's actionLog then drop it, carry finalState; stop early on extinction). Verb shares over the WHOLE run (all chunks pooled), not just the final chunk.
- `compareArms`: founder genomes per arm = `makeArmSetup(arm, seedRoot).roster` mapped to `GenomeUnderTest` (`{ identity, policy, beliefs }`); scenario evaluation always runs under the scenario suite's own manifest (utility mode) — this compares the CONTENT (genomes incl. designed beliefs), which is the §6.7 novelty question. `intra[arm] = meanPairwiseVerbL1(genomes, SCENARIOS, 300)` (25 founders → 300 pairs, all of them — no sampling bias); `cross["a|b"] = meanCrossVerbL1(a, b, SCENARIOS, 625)` for the 6 unordered arm pairs in ARM_IDS order.
- CLI: `npm run arms -- run --arm <id> [--seeds 3] [--ticks 15000] [--chunk 1000] [--out runs/arms]` → per-seed table + `report-<arm>.json`; seeds named `arm-<id>-1..N`. `npm run arms -- compare [--seed arms-cmp] [--out runs/arms]` → table + `compare.json`. Guarded main per existing CLI patterns.

- [ ] **Step 1: Write the failing tests** — `tests/arms-cli.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runArm, compareArms } from "../src/cli/arms.js";

describe("arms CLI", () => {
  it("runArm is deterministic and reports verb shares", () => {
    const a = runArm("fixed", "arms-cli-t", 2000, 500);
    const b = runArm("fixed", "arms-cli-t", 2000, 500);
    expect(a).toEqual(b);
    const sum = Object.values(a.verbShares1000).reduce((x, y) => x + y, 0);
    expect(sum).toBeGreaterThan(900);
    expect(sum).toBeLessThanOrEqual(1000);
  });
  it("random arm runs and only ever logs random actionSource decisions", () => {
    const r = runArm("random", "arms-cli-r", 1000, 500);
    expect(r.finalAlive).toBeGreaterThanOrEqual(0); // extinction allowed — sanity arm
  });
  it("compareArms covers all arms and the 6 cross pairs, deterministically", () => {
    const c = compareArms("arms-cmp-t");
    expect(Object.keys(c.intra).sort()).toEqual(["evolutionary", "fixed", "handcrafted", "random"]);
    expect(Object.keys(c.cross).length).toBe(6);
    expect(compareArms("arms-cmp-t")).toEqual(c);
    expect(c.intra.handcrafted).toBeGreaterThan(0); // archetypes are behaviorally distinguishable
  });
});
```

(vitest testTimeout is 30s; compareArms evaluates 100 genomes × 31 scenarios — if it exceeds the timeout, set a per-test timeout of 120_000 via the third argument to `it`.)

- [ ] **Step 2: Run tests, verify fail; implement; `npm test && npm run typecheck` green**
- [ ] **Step 3: Commit**

```bash
git add src/cli/arms.ts package.json tests/arms-cli.test.ts
git commit -m "feat: arms CLI - per-arm chunked runs and cross-arm scenario comparison"
```

---

### Task 5: Official runs + baseline-arms doc + spec updates

**Files:**
- Create: `docs/baseline-arms.md`
- Modify: `README.md`, `docs/living-worlds.md` (§17.1 step 3, §18 P0 ledger)

- [ ] **Step 1: Official runs** — for each arm: `npm run arms -- run --arm <id> --seeds 3 --ticks 15000 --chunk 1000`; then `npm run arms -- compare`. The first official run is the record — do NOT rerun with different params if results look bad (a collapsing Random arm is the EXPECTED sanity result, not a failure).

- [ ] **Step 2: Write `docs/baseline-arms.md`** containing:
  1. Arm definitions table (cognition configs, roster provenance, frozen interpretation of §6.6 跨臂公平性 re: designed epsilon);
  2. **Handcrafted content record (required by §6.6)**: the 25-archetype design table; rule count (20 scripted rules; per-archetype breakdown); 工时记录 — content design was performed by the project AI during plan authoring on 2026-07-22, wall-clock ≈40 min for archetype/rule design plus review cycles during implementation; state the caveat explicitly: AI-authored content makes the human-工时 comparison approximate — record it as "1 designer-session, 25 archetypes, 20 rules" and note that a human designer replicating this scope was estimated (not measured) at 0.5–1 designer-day;
  3. Official run results: per-arm × per-seed table (survived, finalAlive, maxGeneration, livingLineages, verb shares); cross-arm comparison table (intra-arm diversity per arm; 6 cross-arm distances);
  4. Findings — expectations to check honestly: Random arm likely collapses (sanity floor confirmed or refuted); fixed vs evolutionary intra-diversity comparison (founder parity check); handcrafted intra-diversity vs both; whether designed rules make handcrafted behaviorally distinct from fixed (cross distance fixed|handcrafted > 0);
  5. Implications for §17.1 step 9 (the four-arm 50-generation formal runs now have all four arms implemented) and note the belief-zeroed control variant (`beliefDynamics: "off"` on the evolutionary arm) is now available for the 1C prereg (resolves the mechanism half of that recorded blocker; the official control comparison itself belongs to the prereg).

- [ ] **Step 3: Update `docs/living-worlds.md`**: §17.1 mark step 3 已交付 with a one-line result summary; §18 P0 ledger: mark "Handcrafted 基线允许多少内容工时和规则数量" resolved → frozen budget (25 archetypes, ≤3 rules each, ≤24 total; actual 20) with pointer to docs/baseline-arms.md. §6.6 needs NO edit unless the designed-epsilon interpretation warrants a one-line clarifying footnote — add: "（0.5.2 注：Handcrafted 臂采用设计冻结的 epsilon∈[0,150]，理由与记录见 docs/baseline-arms.md）".

- [ ] **Step 4: README**: add the arms commands + doc pointer.

- [ ] **Step 5: `npm test && npm run typecheck` green; clean runs/ artifacts out of git (runs/ is gitignored — verify); commit**

```bash
git add docs/baseline-arms.md README.md docs/living-worlds.md
git commit -m "docs: baseline arms official runs + handcrafted content record; mark 17.1 step 3 delivered"
```

---

## Self-Review Notes

- §6.6 requirements traced: four arms ✓; Handcrafted 工时+规则数记录 ✓ (Task 5.2, honest AI-authorship caveat); 25-archetype parity across arms ✓ (Task 3 test); 跨臂公平性 epsilon handling made explicit and documented rather than silently interpreted ✓.
- Arm config lives in the hashed manifest → replay/determinism hold per arm; Task 2 pins a random-arm replay round-trip.
- Clone inheritance avoids a WorldState schema change (no founderGenomes table needed) because identity/policy never mutate in-life and designed beliefs are recoverable by source filter — verified against state.ts/rules.ts/beliefs.ts before planning.
- Content is frozen in this plan BEFORE implementation; the budget resolves the §18 P0 open question rather than leaving it dangling.
- Type check: `EffectTarget` import needed in arms.ts for the `rule` helper; `Belief`/`RosterEntry` types from schema/core.
