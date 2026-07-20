# Phase 0 Deterministic Simulation Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A no-LLM, fully deterministic survival simulation (25 NPCs, grid world, seasons, foraging, a predator) with a canonical action log, checkpoint hashing, and replay verification that localizes divergence — Living Worlds doc §3.1 (Layer-1 replay), §6.2 (Reflex/Utility only), §16 schemas with P4 patches, §17.1 steps 1–2.

**Architecture:** Pure-data world state (JSON-safe, integers only) advanced by a deterministic engine: environment step → per-NPC decide (Reflex, then Utility) → apply action → needs/death step → periodic checkpoint hash. Minds see only an `Observation` object. All randomness is stateless, derived from `(seedRoot, purpose, entity, tick)` — no RNG state to checkpoint. Replay mode re-runs the engine feeding logged actions instead of deciding; checkpoint hash comparison verifies, per-tick hash diffing localizes divergence.

**Tech Stack:** TypeScript (strict), Node 20+, Zod (schemas), Vitest (tests), tsx (CLI runner), `node:crypto` SHA-256. Zero runtime deps beyond zod.

## Global Constraints

- All values inside hashed structures are **safe integers**, strings, booleans, null, arrays, plain objects. `canonicalize` throws on non-integer numbers. (Kills float-formatting nondeterminism; canon version `"int-canon-v1"`.)
- **No `Date.now()`, `Math.random()`, `new Date()` anywhere under `src/`.** All randomness via `src/rng/rng.ts` (`rngSchemeVersion: "fnv1a-mulberry32-v1"`).
- All Zod object schemas use `.strict()`. `utilityWeights` has **closed keys** (P4/R10) — no `z.record`.
- `CanonicalActionEvent` carries `deliberationTriggered: boolean` and `energyCharged: number` (P4); Phase 0 always writes `false` / `0`.
- NPC iteration is always **roster order**; all sorts specify explicit deterministic tie-breaks.
- Schema version string everywhere: `"phase0-v1"`.
- Node ESM project (`"type": "module"`); imports between local files use `.js` extension (TS ESM convention).
- Commit after every task; conventional-commit messages ending with the Co-Authored-By trailer from the harness rules.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `tests/smoke.test.ts`

**Interfaces:**
- Produces: a repo where `npm test` runs Vitest and passes.

- [ ] **Step 1: Init git and npm project**

```bash
cd /Users/wooden/Workspace/keco/keco-world
git init
npm init -y
npm install zod
npm install -D typescript vitest tsx @types/node
```

- [ ] **Step 2: Write config files**

`package.json` — edit the generated file so these fields are set (keep npm's other generated fields):

```json
{
  "name": "keco-world",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "sim": "tsx src/cli/run.ts",
    "replay": "tsx src/cli/replay.ts"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

`vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
```

`.gitignore`:

```
node_modules/
runs/
```

- [ ] **Step 3: Write smoke test**

`tests/smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("toolchain", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: 1 test passes; tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold TypeScript project with vitest and zod"
```

---

### Task 2: Canonical JSON + hashing

**Files:**
- Create: `src/canon/canonicalize.ts`
- Test: `tests/canonicalize.test.ts`

**Interfaces:**
- Produces: `canonicalize(value: unknown): string`, `hashCanonical(value: unknown): string` (64-char hex), `CANON_VERSION = "int-canon-v1"`.

- [ ] **Step 1: Write the failing tests**

`tests/canonicalize.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { canonicalize, hashCanonical, CANON_VERSION } from "../src/canon/canonicalize.js";

describe("canonicalize", () => {
  it("sorts object keys and strips whitespace", () => {
    expect(canonicalize({ b: 1, a: [2, "x"] })).toBe('{"a":[2,"x"],"b":1}');
  });
  it("is insensitive to key insertion order", () => {
    const a = { x: 1, y: { q: 2, p: 3 } };
    const b = { y: { p: 3, q: 2 }, x: 1 };
    expect(hashCanonical(a)).toBe(hashCanonical(b));
  });
  it("rejects non-integer numbers", () => {
    expect(() => canonicalize({ v: 0.5 })).toThrow(/non-integer/);
    expect(() => canonicalize({ v: NaN })).toThrow(/non-integer/);
  });
  it("rejects undefined values", () => {
    expect(() => canonicalize({ v: undefined })).toThrow(/unsupported/);
  });
  it("handles null, booleans, nested arrays", () => {
    expect(canonicalize({ n: null, t: true, arr: [[1], []] })).toBe('{"arr":[[1],[]],"n":null,"t":true}');
  });
  it("produces a 64-char hex sha256", () => {
    expect(hashCanonical({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
  it("exports the canon version", () => {
    expect(CANON_VERSION).toBe("int-canon-v1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/canonicalize.test.ts`
Expected: FAIL — cannot resolve `../src/canon/canonicalize.js`.

- [ ] **Step 3: Implement**

`src/canon/canonicalize.ts`:

```typescript
import { createHash } from "node:crypto";

export const CANON_VERSION = "int-canon-v1";

/** Deterministic canonical JSON: sorted keys, no whitespace, integers only. */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new Error(`non-integer number in canonical data: ${value}`);
      }
      return String(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(",")}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
      return `{${parts.join(",")}}`;
    }
    default:
      throw new Error(`unsupported type in canonical data: ${typeof value}`);
  }
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/canonicalize.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/canon tests/canonicalize.test.ts
git commit -m "feat: canonical integer-only JSON serialization and sha256 hashing"
```

---

### Task 3: Deterministic stateless RNG

**Files:**
- Create: `src/rng/rng.ts`
- Test: `tests/rng.test.ts`

**Interfaces:**
- Produces: `fnv1a32(s: string): number`, `drawInt(seedRoot: string, n: number, ...parts: (string | number)[]): number` (uniform-ish in `[0, n)`, stateless), `RNG_SCHEME_VERSION = "fnv1a-mulberry32-v1"`.

- [ ] **Step 1: Write the failing tests**

`tests/rng.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fnv1a32, drawInt, RNG_SCHEME_VERSION } from "../src/rng/rng.js";

describe("rng", () => {
  it("fnv1a32 matches the known offset basis for empty string", () => {
    expect(fnv1a32("")).toBe(2166136261); // 0x811c9dc5
  });
  it("drawInt is deterministic for identical keys", () => {
    expect(drawInt("seed-a", 1000, "explore", "npc-1", 42)).toBe(
      drawInt("seed-a", 1000, "explore", "npc-1", 42),
    );
  });
  it("drawInt stays in range", () => {
    for (let t = 0; t < 500; t++) {
      const v = drawInt("seed-a", 8, "dir", t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(8);
    }
  });
  it("different keys give different streams (statistically)", () => {
    let same = 0;
    for (let t = 0; t < 200; t++) {
      if (drawInt("seed-a", 1000, "x", t) === drawInt("seed-b", 1000, "x", t)) same++;
    }
    expect(same).toBeLessThan(10);
  });
  it("exports the scheme version", () => {
    expect(RNG_SCHEME_VERSION).toBe("fnv1a-mulberry32-v1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/rng.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/rng/rng.ts`:

```typescript
export const RNG_SCHEME_VERSION = "fnv1a-mulberry32-v1";

/** 32-bit FNV-1a hash of a string. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/**
 * Stateless draw in [0, n). Keyed entirely by (seedRoot, ...parts) — the same
 * key always yields the same value, so replay never needs RNG state.
 * Modulo bias is acceptable at game scale (documented, n << 2^32).
 */
export function drawInt(seedRoot: string, n: number, ...parts: (string | number)[]): number {
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`drawInt: bad n=${n}`);
  const key = `${seedRoot}|${parts.join("|")}`;
  return mulberry32(fnv1a32(key))() % n;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/rng.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rng tests/rng.test.ts
git commit -m "feat: stateless deterministic rng (fnv1a + mulberry32)"
```

---

### Task 4: Schemas (core + log) with P4 patches

**Files:**
- Create: `src/schema/core.ts`, `src/schema/log.ts`
- Test: `tests/schema.test.ts`

**Interfaces:**
- Produces from `core.ts`: `UTILITY_KEYS`, `UtilityKey`, zod schemas `Vec2S`, `IdentityS`, `PolicyS`, `RosterEntryS`, `WorldManifestS` and inferred types `Vec2`, `Identity`, `Policy`, `RosterEntry`, `WorldManifest`, plus `SCHEMA_VERSION = "phase0-v1"`.
- Produces from `log.ts`: `ActionS` / `Action`, `CanonicalActionEventS` / `CanonicalActionEvent`, `SemanticEventS` / `SemanticEvent`, `CheckpointS` / `Checkpoint`.

- [ ] **Step 1: Write the failing tests**

`tests/schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { PolicyS, WorldManifestS, SCHEMA_VERSION, UTILITY_KEYS } from "../src/schema/core.js";
import { ActionS, CanonicalActionEventS } from "../src/schema/log.js";

const validWeights = { forage: 500, consume: 800, shelter: 600, explore: 200, idle: 50 };

describe("core schemas", () => {
  it("accepts a valid policy", () => {
    const p = PolicyS.parse({ utilityWeights: validWeights, thresholds: { hungerUrgent: 150 } });
    expect(p.utilityWeights.forage).toBe(500);
  });
  it("rejects unknown utility weight keys (closed key set, P4)", () => {
    expect(() =>
      PolicyS.parse({
        utilityWeights: { ...validWeights, hoard: 100 },
        thresholds: { hungerUrgent: 150 },
      }),
    ).toThrow();
  });
  it("rejects out-of-range weights", () => {
    expect(() =>
      PolicyS.parse({
        utilityWeights: { ...validWeights, forage: 1001 },
        thresholds: { hungerUrgent: 150 },
      }),
    ).toThrow();
  });
  it("UTILITY_KEYS is the closed key list", () => {
    expect(UTILITY_KEYS).toEqual(["forage", "consume", "shelter", "explore", "idle"]);
  });
  it("manifest requires schemaVersion", () => {
    expect(SCHEMA_VERSION).toBe("phase0-v1");
    expect(() => WorldManifestS.parse({})).toThrow();
  });
});

describe("log schemas", () => {
  it("parses each action verb", () => {
    expect(ActionS.parse({ verb: "move", to: { x: 1, y: 2 } }).verb).toBe("move");
    expect(ActionS.parse({ verb: "take", target: "bush-1" }).verb).toBe("take");
    expect(ActionS.parse({ verb: "consume" }).verb).toBe("consume");
    expect(ActionS.parse({ verb: "flee", from: "wolf" }).verb).toBe("flee");
    expect(ActionS.parse({ verb: "idle" }).verb).toBe("idle");
  });
  it("rejects unknown verbs", () => {
    expect(() => ActionS.parse({ verb: "teleport" })).toThrow();
  });
  it("action event carries P4 fields", () => {
    const ev = CanonicalActionEventS.parse({
      eventId: "5:npc-1",
      tick: 5,
      npcId: "npc-1",
      observationHash: "a".repeat(64),
      action: { verb: "idle" },
      actionSource: "utility",
      deliberationTriggered: false,
      energyCharged: 0,
      previousEventHash: null,
    });
    expect(ev.deliberationTriggered).toBe(false);
    expect(ev.energyCharged).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/schema.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement core schemas**

`src/schema/core.ts`:

```typescript
import { z } from "zod";

export const SCHEMA_VERSION = "phase0-v1";

const Int = z.number().int();
const Milli = Int.min(0).max(1000); // 0..1000 fixed-point "per-mille" scale

export const Vec2S = z.object({ x: Int, y: Int }).strict();
export type Vec2 = z.infer<typeof Vec2S>;

export const UTILITY_KEYS = ["forage", "consume", "shelter", "explore", "idle"] as const;
export type UtilityKey = (typeof UTILITY_KEYS)[number];

/** Closed key set (P4/R10): evolution may change values, never keys. */
export const UtilityWeightsS = z
  .object({ forage: Milli, consume: Milli, shelter: Milli, explore: Milli, idle: Milli })
  .strict();

export const IdentityS = z
  .object({
    riskTolerance: Milli,
    socialTrust: Milli,
    explorationBias: Milli,
    patience: Milli,
    voiceStyle: z.string().max(300),
  })
  .strict();
export type Identity = z.infer<typeof IdentityS>;

export const PolicyS = z
  .object({
    utilityWeights: UtilityWeightsS,
    thresholds: z.object({ hungerUrgent: Milli }).strict(),
  })
  .strict();
export type Policy = z.infer<typeof PolicyS>;

export const RosterEntryS = z
  .object({ npcId: z.string(), name: z.string(), identity: IdentityS, policy: PolicyS })
  .strict();
export type RosterEntry = z.infer<typeof RosterEntryS>;

export const WorldManifestS = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    gridWidth: Int.min(4),
    gridHeight: Int.min(4),
    seasonLengthTicks: Int.min(1),
    energyDrainPerTick: Int.min(0),
    starvationHpDrain: Int.min(0),
    winterColdHpDrain: Int.min(0),
    berryEnergy: Int.min(0),
    berryRegrowPpmSummer: Int.min(0).max(1_000_000),
    berryRegrowPpmWinter: Int.min(0).max(1_000_000),
    wolfDamage: Int.min(0),
    hpRegenPerTick: Int.min(0),
    hpRegenEnergyMin: Int.min(0),
    maxHp: Int.min(1),
    maxEnergy: Int.min(1),
    visionRadius: Int.min(1),
    checkpointInterval: Int.min(1),
    shelters: z.array(Vec2S),
    bushes: z.array(z.object({ id: z.string(), pos: Vec2S, capacity: Int.min(1) }).strict()),
    wolfStart: Vec2S,
  })
  .strict();
export type WorldManifest = z.infer<typeof WorldManifestS>;
```

- [ ] **Step 4: Implement log schemas**

`src/schema/log.ts`:

```typescript
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
    actionSource: z.enum(["reflex", "utility"]),
    deliberationTriggered: z.boolean(),
    energyCharged: Int.min(0),
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
    ]),
    npcId: z.string().nullable(),
    data: z.record(z.union([z.string(), z.number().int()])),
  })
  .strict();
export type SemanticEvent = z.infer<typeof SemanticEventS>;

export const CheckpointS = z.object({ tick: Int.min(0), stateHash: Hash }).strict();
export type Checkpoint = z.infer<typeof CheckpointS>;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/schema.test.ts && npm run typecheck`
Expected: all PASS; tsc exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/schema tests/schema.test.ts
git commit -m "feat: zod schemas for manifest, genome-lite, actions, log (P4 patches)"
```

---

### Task 5: World state + worldgen

**Files:**
- Create: `src/world/state.ts`
- Test: `tests/state.test.ts`

**Interfaces:**
- Consumes: `WorldManifest`, `RosterEntry` (Task 4); `drawInt` (Task 3).
- Produces: types `NpcState`, `BushState`, `WorldState`; `createInitialState(manifest: WorldManifest, roster: RosterEntry[], seedRoot: string): WorldState`; `seasonAt(tick: number, manifest: WorldManifest): "summer" | "winter"`; `chebyshev(a: Vec2, b: Vec2): number`; `isOnShelter(pos: Vec2, manifest: WorldManifest): boolean`.

- [ ] **Step 1: Write the failing tests**

`tests/state.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createInitialState, seasonAt, chebyshev, isOnShelter } from "../src/world/state.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

describe("world state", () => {
  const manifest = makeTestManifest();
  const roster = makeTestRoster(5);

  it("creates NPCs in roster order with full hp/energy", () => {
    const s = createInitialState(manifest, roster, "seed-1");
    expect(s.npcs.map((n) => n.npcId)).toEqual(roster.map((r) => r.npcId));
    expect(s.npcs.every((n) => n.hp === manifest.maxHp && n.energy === manifest.maxEnergy)).toBe(true);
    expect(s.npcs.every((n) => n.alive)).toBe(true);
  });
  it("placement is deterministic and in-bounds", () => {
    const a = createInitialState(manifest, roster, "seed-1");
    const b = createInitialState(manifest, roster, "seed-1");
    expect(a).toEqual(b);
    for (const n of a.npcs) {
      expect(n.pos.x).toBeGreaterThanOrEqual(0);
      expect(n.pos.x).toBeLessThan(manifest.gridWidth);
      expect(n.pos.y).toBeGreaterThanOrEqual(0);
      expect(n.pos.y).toBeLessThan(manifest.gridHeight);
    }
  });
  it("bushes start at capacity; wolf at wolfStart", () => {
    const s = createInitialState(manifest, roster, "seed-1");
    expect(s.bushes.every((b) => b.berries === b.capacity)).toBe(true);
    expect(s.wolf.pos).toEqual(manifest.wolfStart);
  });
  it("seasonAt alternates summer/winter", () => {
    expect(seasonAt(0, manifest)).toBe("summer");
    expect(seasonAt(manifest.seasonLengthTicks, manifest)).toBe("winter");
    expect(seasonAt(manifest.seasonLengthTicks * 2, manifest)).toBe("summer");
  });
  it("chebyshev and shelter helpers", () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3);
    expect(isOnShelter(manifest.shelters[0]!, manifest)).toBe(true);
    expect(isOnShelter({ x: -1, y: -1 }, manifest)).toBe(false);
  });
});
```

- [ ] **Step 2: Write shared test helpers**

`tests/helpers.ts`:

```typescript
import type { WorldManifest, RosterEntry } from "../src/schema/core.js";
import { SCHEMA_VERSION } from "../src/schema/core.js";

export function makeTestManifest(overrides: Partial<WorldManifest> = {}): WorldManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    gridWidth: 16,
    gridHeight: 16,
    seasonLengthTicks: 100,
    energyDrainPerTick: 2,
    starvationHpDrain: 5,
    winterColdHpDrain: 3,
    berryEnergy: 200,
    berryRegrowPpmSummer: 60_000,
    berryRegrowPpmWinter: 5_000,
    wolfDamage: 50,
    hpRegenPerTick: 1,
    hpRegenEnergyMin: 500,
    maxHp: 1000,
    maxEnergy: 1000,
    visionRadius: 8,
    checkpointInterval: 50,
    shelters: [{ x: 2, y: 2 }, { x: 12, y: 12 }],
    bushes: [
      { id: "bush-1", pos: { x: 5, y: 5 }, capacity: 5 },
      { id: "bush-2", pos: { x: 10, y: 3 }, capacity: 5 },
    ],
    wolfStart: { x: 15, y: 15 },
    ...overrides,
  };
}

export function makeTestRoster(n: number): RosterEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    npcId: `npc-${i + 1}`,
    name: `NPC ${i + 1}`,
    identity: { riskTolerance: 500, socialTrust: 500, explorationBias: 400, patience: 500, voiceStyle: "" },
    policy: {
      utilityWeights: { forage: 600, consume: 800, shelter: 700, explore: 200, idle: 50 },
      thresholds: { hungerUrgent: 150 },
    },
  }));
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/state.test.ts`
Expected: FAIL — `src/world/state.js` not found.

- [ ] **Step 4: Implement**

`src/world/state.ts`:

```typescript
import type { Vec2, WorldManifest, RosterEntry } from "../schema/core.js";
import { drawInt } from "../rng/rng.js";

export interface NpcState {
  npcId: string;
  name: string;
  pos: Vec2;
  hp: number;
  energy: number;
  berries: number;
  alive: boolean;
  deathTick: number | null;
  deathCause: string | null;
  /** last source of hp damage, used as death cause chain root */
  lastDamage: string | null;
}

export interface BushState {
  id: string;
  pos: Vec2;
  berries: number;
  capacity: number;
}

export interface WorldState {
  tick: number;
  npcs: NpcState[];
  bushes: BushState[];
  wolf: { pos: Vec2 };
}

export function seasonAt(tick: number, manifest: WorldManifest): "summer" | "winter" {
  return Math.floor(tick / manifest.seasonLengthTicks) % 2 === 0 ? "summer" : "winter";
}

export function chebyshev(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function isOnShelter(pos: Vec2, manifest: WorldManifest): boolean {
  return manifest.shelters.some((s) => s.x === pos.x && s.y === pos.y);
}

export function createInitialState(
  manifest: WorldManifest,
  roster: RosterEntry[],
  seedRoot: string,
): WorldState {
  const npcs: NpcState[] = roster.map((r) => ({
    npcId: r.npcId,
    name: r.name,
    pos: {
      x: drawInt(seedRoot, manifest.gridWidth, "spawn-x", r.npcId),
      y: drawInt(seedRoot, manifest.gridHeight, "spawn-y", r.npcId),
    },
    hp: manifest.maxHp,
    energy: manifest.maxEnergy,
    berries: 0,
    alive: true,
    deathTick: null,
    deathCause: null,
    lastDamage: null,
  }));
  const bushes: BushState[] = manifest.bushes.map((b) => ({
    id: b.id,
    pos: { x: b.pos.x, y: b.pos.y },
    berries: b.capacity,
    capacity: b.capacity,
  }));
  return { tick: 0, npcs, bushes, wolf: { pos: { x: manifest.wolfStart.x, y: manifest.wolfStart.y } } };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/state.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/world/state.ts tests/state.test.ts tests/helpers.ts
git commit -m "feat: world state model, worldgen, season and geometry helpers"
```

---

### Task 6: Observation builder

**Files:**
- Create: `src/mind/observe.ts`
- Test: `tests/observe.test.ts`

**Interfaces:**
- Consumes: `WorldState`, `NpcState`, `chebyshev`, `seasonAt`, `isOnShelter` (Task 5).
- Produces: type `Observation`; `buildObservation(state: WorldState, manifest: WorldManifest, npc: NpcState): Observation`. Minds (Tasks 7–8) see **only** this object.

- [ ] **Step 1: Write the failing tests**

`tests/observe.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildObservation } from "../src/mind/observe.js";
import { createInitialState } from "../src/world/state.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

describe("observation", () => {
  const manifest = makeTestManifest();
  const roster = makeTestRoster(2);

  it("sees bushes within vision radius sorted by (dist, id), not beyond", () => {
    const s = createInitialState(manifest, roster, "seed-1");
    const npc = s.npcs[0]!;
    npc.pos = { x: 5, y: 5 }; // on bush-1, dist 5 to bush-2 (10,3)
    const obs = buildObservation(s, manifest, npc);
    expect(obs.visibleBushes.map((b) => b.id)).toEqual(["bush-1", "bush-2"]);
    expect(obs.visibleBushes[0]!.dist).toBe(0);
    npc.pos = { x: 0, y: 15 }; // dist 10 to bush-1 → out of radius 8
    const obs2 = buildObservation(s, manifest, npc);
    expect(obs2.visibleBushes.map((b) => b.id)).toEqual([]);
  });
  it("reports wolf only within radius; nearest shelter always known", () => {
    const s = createInitialState(manifest, roster, "seed-1");
    const npc = s.npcs[0]!;
    npc.pos = { x: 0, y: 0 }; // wolf at (15,15), dist 15 → unseen
    const obs = buildObservation(s, manifest, npc);
    expect(obs.wolf).toBeNull();
    expect(obs.nearestShelter).toEqual({ pos: { x: 2, y: 2 }, dist: 2 });
    npc.pos = { x: 14, y: 14 };
    expect(buildObservation(s, manifest, npc).wolf).toEqual({ pos: { x: 15, y: 15 }, dist: 1 });
  });
  it("carries self, tick, season, onShelter", () => {
    const s = createInitialState(manifest, roster, "seed-1");
    s.tick = 150; // winter (seasonLength 100)
    const npc = s.npcs[0]!;
    npc.pos = { x: 2, y: 2 };
    const obs = buildObservation(s, manifest, npc);
    expect(obs.tick).toBe(150);
    expect(obs.season).toBe("winter");
    expect(obs.onShelter).toBe(true);
    expect(obs.self).toEqual({ npcId: npc.npcId, pos: { x: 2, y: 2 }, hp: npc.hp, energy: npc.energy, berries: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/observe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/mind/observe.ts`:

```typescript
import type { Vec2, WorldManifest } from "../schema/core.js";
import type { WorldState, NpcState } from "../world/state.js";
import { chebyshev, seasonAt, isOnShelter } from "../world/state.js";

export interface Observation {
  tick: number;
  season: "summer" | "winter";
  onShelter: boolean;
  self: { npcId: string; pos: Vec2; hp: number; energy: number; berries: number };
  visibleBushes: { id: string; pos: Vec2; berries: number; dist: number }[];
  wolf: { pos: Vec2; dist: number } | null;
  nearestShelter: { pos: Vec2; dist: number } | null;
}

export function buildObservation(
  state: WorldState,
  manifest: WorldManifest,
  npc: NpcState,
): Observation {
  const visibleBushes = state.bushes
    .map((b) => ({ id: b.id, pos: { x: b.pos.x, y: b.pos.y }, berries: b.berries, dist: chebyshev(npc.pos, b.pos) }))
    .filter((b) => b.dist <= manifest.visionRadius)
    .sort((a, b) => (a.dist - b.dist) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const wolfDist = chebyshev(npc.pos, state.wolf.pos);
  const wolf =
    wolfDist <= manifest.visionRadius
      ? { pos: { x: state.wolf.pos.x, y: state.wolf.pos.y }, dist: wolfDist }
      : null;

  let nearestShelter: Observation["nearestShelter"] = null;
  for (const s of manifest.shelters) {
    const d = chebyshev(npc.pos, s);
    if (nearestShelter === null || d < nearestShelter.dist) {
      nearestShelter = { pos: { x: s.x, y: s.y }, dist: d };
    }
  }

  return {
    tick: state.tick,
    season: seasonAt(state.tick, manifest),
    onShelter: isOnShelter(npc.pos, manifest),
    self: { npcId: npc.npcId, pos: { x: npc.pos.x, y: npc.pos.y }, hp: npc.hp, energy: npc.energy, berries: npc.berries },
    visibleBushes,
    wolf,
    nearestShelter,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/observe.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mind/observe.ts tests/observe.test.ts
git commit -m "feat: observation builder - minds see only Observation objects"
```

---

### Task 7: Reflex layer

**Files:**
- Create: `src/mind/reflex.ts`
- Test: `tests/reflex.test.ts`

**Interfaces:**
- Consumes: `Observation` (Task 6), `Policy`, `Action` types.
- Produces: `reflexDecide(obs: Observation, policy: Policy): Action | null` — null means "no reflex fired, fall through to utility".

- [ ] **Step 1: Write the failing tests**

`tests/reflex.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { reflexDecide } from "../src/mind/reflex.js";
import type { Observation } from "../src/mind/observe.js";
import { makeTestRoster } from "./helpers.js";

function baseObs(overrides: Partial<Observation> = {}): Observation {
  return {
    tick: 10,
    season: "summer",
    onShelter: false,
    self: { npcId: "npc-1", pos: { x: 5, y: 5 }, hp: 1000, energy: 900, berries: 0 },
    visibleBushes: [],
    wolf: null,
    nearestShelter: { pos: { x: 2, y: 2 }, dist: 3 },
    ...overrides,
  };
}
const policy = makeTestRoster(1)[0]!.policy; // hungerUrgent: 150

describe("reflex", () => {
  it("flees when wolf within 2", () => {
    const obs = baseObs({ wolf: { pos: { x: 6, y: 5 }, dist: 1 } });
    expect(reflexDecide(obs, policy)).toEqual({ verb: "flee", from: "wolf" });
  });
  it("does not flee a distant wolf", () => {
    const obs = baseObs({ wolf: { pos: { x: 9, y: 5 }, dist: 4 } });
    expect(reflexDecide(obs, policy)).toBeNull();
  });
  it("eats when starving and holding berries", () => {
    const obs = baseObs({ self: { ...baseObs().self, energy: 100, berries: 2 } });
    expect(reflexDecide(obs, policy)).toEqual({ verb: "consume" });
  });
  it("flee outranks eating", () => {
    const obs = baseObs({
      wolf: { pos: { x: 6, y: 5 }, dist: 1 },
      self: { ...baseObs().self, energy: 100, berries: 2 },
    });
    expect(reflexDecide(obs, policy)!.verb).toBe("flee");
  });
  it("returns null when nothing urgent", () => {
    expect(reflexDecide(baseObs(), policy)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/reflex.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/mind/reflex.ts`:

```typescript
import type { Policy } from "../schema/core.js";
import type { Action } from "../schema/log.js";
import type { Observation } from "./observe.js";

const FLEE_RADIUS = 2;

/** Fixed priority order; returns null when no reflex fires. Doc §6.2. */
export function reflexDecide(obs: Observation, policy: Policy): Action | null {
  if (obs.wolf !== null && obs.wolf.dist <= FLEE_RADIUS) {
    return { verb: "flee", from: "wolf" };
  }
  if (obs.self.energy < policy.thresholds.hungerUrgent && obs.self.berries > 0) {
    return { verb: "consume" };
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/reflex.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mind/reflex.ts tests/reflex.test.ts
git commit -m "feat: reflex layer - flee predator, eat when starving"
```

---

### Task 8: Utility layer

**Files:**
- Create: `src/mind/utility.ts`
- Test: `tests/utility.test.ts`

**Interfaces:**
- Consumes: `Observation` (Task 6), `Identity`, `Policy`, `WorldManifest`, `UtilityKey` (Task 4), `drawInt` (Task 3).
- Produces: `utilityDecide(obs: Observation, identity: Identity, policy: Policy, manifest: WorldManifest, seedRoot: string): { action: Action; key: UtilityKey }`; helper `moveToward(from: Vec2, to: Vec2): Action` (single Chebyshev step, exported for reuse in Task 9's flee resolution).

**Scoring spec (all integer arithmetic, `Math.floor` divisions):**
- `hungerNeed = floor((maxEnergy - energy) * 1000 / maxEnergy)` → 0..1000.
- Candidates evaluated in this fixed order (ties → earlier wins):
  1. `consume` (if `berries > 0`): `score = floor(w.consume * hungerNeed / 1000)`
  2. `forage` (if some visible bush has berries; target = first in the observation's (dist,id) sort with `berries > 0`): `score = floor(w.forage * hungerNeed / 1000) - 20 * dist`; action = `take` if `dist <= 1` else `moveToward(bush)`
  3. `shelter` (if winter and not on shelter and shelter known): `score = w.shelter - 15 * dist`; action = `moveToward(shelter)`
  4. `explore`: `score = floor(w.explore * identity.explorationBias / 1000)`; action = move one step in direction `drawInt(seedRoot, 8, "explore", npcId, tick)` (8-neighborhood, index into fixed `DIRS` array), clamped to grid via the target being validated later (emit the move; if it would leave the grid, emit `idle`)
  5. `idle` (always): `score = w.idle`

- [ ] **Step 1: Write the failing tests**

`tests/utility.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { utilityDecide, moveToward } from "../src/mind/utility.js";
import type { Observation } from "../src/mind/observe.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest();
const { identity, policy } = makeTestRoster(1)[0]!;

function obs(overrides: Partial<Observation> = {}): Observation {
  return {
    tick: 10,
    season: "summer",
    onShelter: false,
    self: { npcId: "npc-1", pos: { x: 5, y: 5 }, hp: 1000, energy: 1000, berries: 0 },
    visibleBushes: [],
    wolf: null,
    nearestShelter: { pos: { x: 2, y: 2 }, dist: 3 },
    ...overrides,
  };
}

describe("utility", () => {
  it("hungry with berries → consume beats forage", () => {
    const o = obs({
      self: { ...obs().self, energy: 300, berries: 1 },
      visibleBushes: [{ id: "bush-1", pos: { x: 6, y: 5 }, berries: 3, dist: 1 }],
    });
    const d = utilityDecide(o, identity, policy, manifest, "seed-1");
    expect(d.key).toBe("consume"); // w.consume 800 > w.forage 600 at same need
    expect(d.action).toEqual({ verb: "consume" });
  });
  it("hungry, no berries, bush adjacent → take", () => {
    const o = obs({
      self: { ...obs().self, energy: 300 },
      visibleBushes: [{ id: "bush-1", pos: { x: 6, y: 5 }, berries: 3, dist: 1 }],
    });
    const d = utilityDecide(o, identity, policy, manifest, "seed-1");
    expect(d).toEqual({ key: "forage", action: { verb: "take", target: "bush-1" } });
  });
  it("hungry, bush far → single step toward it", () => {
    const o = obs({
      self: { ...obs().self, energy: 300 },
      visibleBushes: [{ id: "bush-2", pos: { x: 10, y: 3 }, berries: 3, dist: 5 }],
    });
    const d = utilityDecide(o, identity, policy, manifest, "seed-1");
    expect(d.key).toBe("forage");
    expect(d.action).toEqual({ verb: "move", to: { x: 6, y: 4 } });
  });
  it("winter off-shelter, not hungry → heads to shelter", () => {
    const o = obs({ season: "winter" });
    const d = utilityDecide(o, identity, policy, manifest, "seed-1");
    expect(d.key).toBe("shelter");
    expect(d.action).toEqual({ verb: "move", to: { x: 4, y: 4 } });
  });
  it("nothing pressing → explore or idle, deterministically", () => {
    const o = obs();
    const a = utilityDecide(o, identity, policy, manifest, "seed-1");
    const b = utilityDecide(o, identity, policy, manifest, "seed-1");
    expect(a).toEqual(b);
    expect(["explore", "idle"]).toContain(a.key);
  });
  it("moveToward takes one chebyshev step with sign()", () => {
    expect(moveToward({ x: 5, y: 5 }, { x: 10, y: 3 })).toEqual({ verb: "move", to: { x: 6, y: 4 } });
    expect(moveToward({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ verb: "idle" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/utility.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/mind/utility.ts`:

```typescript
import type { Vec2, Identity, Policy, WorldManifest, UtilityKey } from "../schema/core.js";
import type { Action } from "../schema/log.js";
import type { Observation } from "./observe.js";
import { drawInt } from "../rng/rng.js";

export const DIRS: readonly Vec2[] = [
  { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
  { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
] as const;

export function moveToward(from: Vec2, to: Vec2): Action {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy === 0) return { verb: "idle" };
  return { verb: "move", to: { x: from.x + dx, y: from.y + dy } };
}

interface Candidate { key: UtilityKey; score: number; action: Action }

/** Deterministic integer scoring per plan spec; ties resolved by candidate order. */
export function utilityDecide(
  obs: Observation,
  identity: Identity,
  policy: Policy,
  manifest: WorldManifest,
  seedRoot: string,
): { action: Action; key: UtilityKey } {
  const w = policy.utilityWeights;
  const hungerNeed = Math.floor(((manifest.maxEnergy - obs.self.energy) * 1000) / manifest.maxEnergy);
  const candidates: Candidate[] = [];

  if (obs.self.berries > 0) {
    candidates.push({ key: "consume", score: Math.floor((w.consume * hungerNeed) / 1000), action: { verb: "consume" } });
  }

  const bush = obs.visibleBushes.find((b) => b.berries > 0);
  if (bush !== undefined) {
    const action: Action =
      bush.dist <= 1 ? { verb: "take", target: bush.id } : moveToward(obs.self.pos, bush.pos);
    candidates.push({ key: "forage", score: Math.floor((w.forage * hungerNeed) / 1000) - 20 * bush.dist, action });
  }

  if (obs.season === "winter" && !obs.onShelter && obs.nearestShelter !== null) {
    candidates.push({
      key: "shelter",
      score: w.shelter - 15 * obs.nearestShelter.dist,
      action: moveToward(obs.self.pos, obs.nearestShelter.pos),
    });
  }

  {
    const dir = DIRS[drawInt(seedRoot, 8, "explore", obs.self.npcId, obs.tick)]!;
    const to = { x: obs.self.pos.x + dir.x, y: obs.self.pos.y + dir.y };
    const inBounds = to.x >= 0 && to.x < manifest.gridWidth && to.y >= 0 && to.y < manifest.gridHeight;
    candidates.push({
      key: "explore",
      score: Math.floor((w.explore * identity.explorationBias) / 1000),
      action: inBounds ? { verb: "move", to } : { verb: "idle" },
    });
  }

  candidates.push({ key: "idle", score: w.idle, action: { verb: "idle" } });

  let best = candidates[0]!;
  for (const c of candidates) {
    if (c.score > best.score) best = c; // strict > keeps earliest on ties
  }
  return { action: best.action, key: best.key };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/utility.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mind/utility.ts tests/utility.test.ts
git commit -m "feat: utility layer - integer-scored candidates with deterministic tie-breaks"
```

---

### Task 9: Action application + legality

**Files:**
- Create: `src/world/actions.ts`
- Test: `tests/actions.test.ts`

**Interfaces:**
- Consumes: `WorldState`, `NpcState`, `chebyshev` (Task 5); `Action` (Task 4); `DIRS` (Task 8).
- Produces: `applyAction(state: WorldState, manifest: WorldManifest, npc: NpcState, action: Action): boolean` — mutates state, returns legality. Illegal actions apply as no-op. `flee` resolves deterministically to the position (8-neighborhood + stay, in-bounds) maximizing Chebyshev distance to the wolf; ties → first in `[stay, ...DIRS]` order.

- [ ] **Step 1: Write the failing tests**

`tests/actions.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { applyAction } from "../src/world/actions.js";
import { createInitialState } from "../src/world/state.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";

const manifest = makeTestManifest();

function fresh() {
  const s = createInitialState(manifest, makeTestRoster(2), "seed-1");
  return { s, npc: s.npcs[0]! };
}

describe("applyAction", () => {
  it("move: adjacent legal, teleport illegal (no-op)", () => {
    const { s, npc } = fresh();
    npc.pos = { x: 5, y: 5 };
    expect(applyAction(s, manifest, npc, { verb: "move", to: { x: 6, y: 6 } })).toBe(true);
    expect(npc.pos).toEqual({ x: 6, y: 6 });
    expect(applyAction(s, manifest, npc, { verb: "move", to: { x: 9, y: 9 } })).toBe(false);
    expect(npc.pos).toEqual({ x: 6, y: 6 });
  });
  it("move out of bounds is illegal", () => {
    const { s, npc } = fresh();
    npc.pos = { x: 0, y: 0 };
    expect(applyAction(s, manifest, npc, { verb: "move", to: { x: -1, y: 0 } })).toBe(false);
  });
  it("take: adjacent bush with berries decrements bush, increments inventory", () => {
    const { s, npc } = fresh();
    npc.pos = { x: 5, y: 5 }; // bush-1 here
    expect(applyAction(s, manifest, npc, { verb: "take", target: "bush-1" })).toBe(true);
    expect(s.bushes.find((b) => b.id === "bush-1")!.berries).toBe(4);
    expect(npc.berries).toBe(1);
  });
  it("take: empty or distant bush illegal", () => {
    const { s, npc } = fresh();
    npc.pos = { x: 5, y: 5 };
    s.bushes.find((b) => b.id === "bush-1")!.berries = 0;
    expect(applyAction(s, manifest, npc, { verb: "take", target: "bush-1" })).toBe(false);
    expect(applyAction(s, manifest, npc, { verb: "take", target: "bush-2" })).toBe(false); // dist 5
  });
  it("consume: eats a berry up to maxEnergy cap", () => {
    const { s, npc } = fresh();
    npc.berries = 2;
    npc.energy = 900;
    expect(applyAction(s, manifest, npc, { verb: "consume" })).toBe(true);
    expect(npc.energy).toBe(1000); // capped, berryEnergy 200
    expect(npc.berries).toBe(1);
  });
  it("consume with no berries is illegal", () => {
    const { s, npc } = fresh();
    expect(applyAction(s, manifest, npc, { verb: "consume" })).toBe(false);
  });
  it("flee: moves to maximize distance from wolf, deterministically", () => {
    const { s, npc } = fresh();
    npc.pos = { x: 14, y: 14 };
    s.wolf.pos = { x: 15, y: 15 };
    expect(applyAction(s, manifest, npc, { verb: "flee", from: "wolf" })).toBe(true);
    expect(npc.pos).toEqual({ x: 13, y: 13 }); // dist 2, unique maximum
    const again = { ...npc.pos };
    applyAction(s, manifest, npc, { verb: "flee", from: "wolf" });
    expect(npc.pos).toEqual({ x: again.x - 1, y: again.y - 1 });
  });
  it("idle is always legal and changes nothing", () => {
    const { s, npc } = fresh();
    const before = JSON.stringify(s);
    expect(applyAction(s, manifest, npc, { verb: "idle" })).toBe(true);
    expect(JSON.stringify(s)).toBe(before);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/world/actions.ts`:

```typescript
import type { WorldManifest } from "../schema/core.js";
import type { Action } from "../schema/log.js";
import type { WorldState, NpcState } from "./state.js";
import { chebyshev } from "./state.js";
import { DIRS } from "../mind/utility.js";

function inBounds(x: number, y: number, manifest: WorldManifest): boolean {
  return x >= 0 && x < manifest.gridWidth && y >= 0 && y < manifest.gridHeight;
}

/** Applies an action, mutating state. Returns false (and no-ops) when illegal. */
export function applyAction(
  state: WorldState,
  manifest: WorldManifest,
  npc: NpcState,
  action: Action,
): boolean {
  switch (action.verb) {
    case "move": {
      const { to } = action;
      if (!inBounds(to.x, to.y, manifest)) return false;
      if (chebyshev(npc.pos, to) > 1) return false;
      npc.pos = { x: to.x, y: to.y };
      return true;
    }
    case "take": {
      const bush = state.bushes.find((b) => b.id === action.target);
      if (bush === undefined) return false;
      if (chebyshev(npc.pos, bush.pos) > 1) return false;
      if (bush.berries <= 0) return false;
      bush.berries -= 1;
      npc.berries += 1;
      return true;
    }
    case "consume": {
      if (npc.berries <= 0) return false;
      npc.berries -= 1;
      npc.energy = Math.min(manifest.maxEnergy, npc.energy + manifest.berryEnergy);
      return true;
    }
    case "flee": {
      // candidates: stay + 8 dirs, in-bounds; pick max distance to wolf, first wins ties
      let best = { x: npc.pos.x, y: npc.pos.y };
      let bestDist = chebyshev(best, state.wolf.pos);
      for (const d of DIRS) {
        const cand = { x: npc.pos.x + d.x, y: npc.pos.y + d.y };
        if (!inBounds(cand.x, cand.y, manifest)) continue;
        const dist = chebyshev(cand, state.wolf.pos);
        if (dist > bestDist) {
          best = cand;
          bestDist = dist;
        }
      }
      npc.pos = best;
      return true;
    }
    case "idle":
      return true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/actions.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/actions.ts tests/actions.test.ts
git commit -m "feat: action application with legality checks and deterministic flee"
```

---

### Task 10: World rules — environment, needs, death

**Files:**
- Create: `src/world/rules.ts`
- Test: `tests/rules.test.ts`

**Interfaces:**
- Consumes: `WorldState`, `seasonAt`, `chebyshev`, `isOnShelter` (Task 5); `drawInt` (Task 3); `SemanticEvent` (Task 4).
- Produces: `environmentStep(state, manifest, seedRoot, events: SemanticEvent[]): void` (bush regrowth, wolf random walk, wolf attacks) and `needsStep(state, manifest, events: SemanticEvent[]): void` (energy drain, starvation, winter cold, regen, death). Both mutate in place and append semantic events. Death sets `alive=false`, `deathTick=state.tick`, `deathCause=npc.lastDamage ?? "starvation"` and emits a `death` event with `data: { cause }`.

**Rule spec:**
- Regrowth: per bush below capacity, `drawInt(seedRoot, 1_000_000, "regrow", bush.id, state.tick) < ppm(season)` → `berries += 1`.
- Wolf: moves one step in direction `drawInt(seedRoot, 8, "wolf", state.tick)`, clamped in-bounds (skip move if out); then damages every **alive** NPC with `chebyshev ≤ 1` by `wolfDamage`, sets their `lastDamage = "wolf"`, emits `wolf_attack` per victim.
- Needs (per alive NPC, roster order): `energy = max(0, energy - energyDrainPerTick)`; if `energy === 0` → `hp -= starvationHpDrain`, `lastDamage = "starvation"`, emit `starving` (once per tick per NPC); if winter and not on shelter → `hp -= winterColdHpDrain`, `lastDamage = "cold"`; if `energy >= hpRegenEnergyMin` → `hp = min(maxHp, hp + hpRegenPerTick)`; if `hp <= 0` → death as above.

- [ ] **Step 1: Write the failing tests**

`tests/rules.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { environmentStep, needsStep } from "../src/world/rules.js";
import { createInitialState } from "../src/world/state.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import type { SemanticEvent } from "../src/schema/log.js";

const manifest = makeTestManifest();

describe("environmentStep", () => {
  it("wolf attacks adjacent NPCs and stays deterministic", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    s.wolf.pos = { x: 8, y: 8 };
    npc.pos = { x: 8, y: 8 };
    const ev: SemanticEvent[] = [];
    environmentStep(s, manifest, "seed-1", ev);
    // wolf moved one step but npc was adjacent before/after? attack happens after move:
    // place npc adjacent to every possible post-move position instead — re-run controlled:
    const s2 = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc2 = s2.npcs[0]!;
    s2.wolf.pos = { x: 8, y: 8 };
    npc2.pos = { x: 8, y: 8 };
    const ev2: SemanticEvent[] = [];
    environmentStep(s2, manifest, "seed-1", ev2);
    expect(s2.wolf.pos).toEqual(s.wolf.pos); // deterministic walk
    expect(npc2.hp).toBe(npc.hp); // deterministic damage outcome
  });
  it("wolf damage applies when adjacent after move", () => {
    const wideManifest = makeTestManifest({ wolfDamage: 50 });
    const s = createInitialState(wideManifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    // surround-proof: npc shares tile with wolf after any 1-step move if npc sits on wolf start
    s.wolf.pos = { x: 8, y: 8 };
    npc.pos = { x: 8, y: 8 };
    const ev: SemanticEvent[] = [];
    environmentStep(s, wideManifest, "seed-1", ev);
    expect(npc.hp).toBe(1000 - 50); // any 1-step move keeps chebyshev ≤ 1
    expect(ev.some((e) => e.kind === "wolf_attack" && e.npcId === npc.npcId)).toBe(true);
    expect(npc.lastDamage).toBe("wolf");
  });
  it("bushes regrow toward capacity over enough summer ticks", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const bush = s.bushes[0]!;
    bush.berries = 0;
    for (let t = 1; t <= 200; t++) {
      s.tick = t;
      environmentStep(s, manifest, "seed-1", []);
    }
    expect(bush.berries).toBeGreaterThan(0); // 6% ppm per tick × 100 summer ticks
    expect(bush.berries).toBeLessThanOrEqual(bush.capacity);
  });
});

describe("needsStep", () => {
  it("drains energy; starvation damages hp and emits event", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    npc.energy = 1;
    const ev: SemanticEvent[] = [];
    needsStep(s, manifest, ev); // energy → 0, starvation hp drain
    expect(npc.energy).toBe(0);
    expect(npc.hp).toBe(1000 - manifest.starvationHpDrain);
    expect(ev.some((e) => e.kind === "starving")).toBe(true);
  });
  it("winter cold drains hp off-shelter but not on shelter", () => {
    const s = createInitialState(manifest, makeTestRoster(2), "seed-1");
    s.tick = 150; // winter
    const [outside, inside] = [s.npcs[0]!, s.npcs[1]!];
    outside.pos = { x: 8, y: 8 };
    inside.pos = { x: 2, y: 2 }; // shelter
    outside.energy = 1000; // isolate cold from starvation; but drain makes 998 < regen min? 998 ≥ 500 → regen applies
    inside.energy = 1000;
    needsStep(s, manifest, []);
    // outside: -3 cold +1 regen = 998; inside: +1 regen capped at 1000
    expect(outside.hp).toBe(998);
    expect(inside.hp).toBe(1000);
  });
  it("death sets cause from lastDamage and emits death event", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    npc.hp = 2;
    npc.energy = 0;
    npc.lastDamage = "wolf";
    const ev: SemanticEvent[] = [];
    needsStep(s, manifest, ev); // starvation overwrites lastDamage → cause "starvation"
    expect(npc.alive).toBe(false);
    expect(npc.deathTick).toBe(s.tick);
    expect(npc.deathCause).toBe("starvation");
    const death = ev.find((e) => e.kind === "death");
    expect(death).toBeDefined();
    expect(death!.data["cause"]).toBe("starvation");
  });
  it("dead NPCs are skipped", () => {
    const s = createInitialState(manifest, makeTestRoster(1), "seed-1");
    const npc = s.npcs[0]!;
    npc.alive = false;
    npc.hp = 0;
    const before = npc.energy;
    needsStep(s, manifest, []);
    expect(npc.energy).toBe(before);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/rules.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/world/rules.ts`:

```typescript
import type { WorldManifest } from "../schema/core.js";
import type { SemanticEvent } from "../schema/log.js";
import type { WorldState } from "./state.js";
import { seasonAt, chebyshev, isOnShelter } from "./state.js";
import { drawInt } from "../rng/rng.js";
import { DIRS } from "../mind/utility.js";

/** Bush regrowth, wolf walk + attacks. Runs before NPC decisions each tick. */
export function environmentStep(
  state: WorldState,
  manifest: WorldManifest,
  seedRoot: string,
  events: SemanticEvent[],
): void {
  const season = seasonAt(state.tick, manifest);
  const ppm = season === "summer" ? manifest.berryRegrowPpmSummer : manifest.berryRegrowPpmWinter;
  for (const bush of state.bushes) {
    if (bush.berries < bush.capacity && drawInt(seedRoot, 1_000_000, "regrow", bush.id, state.tick) < ppm) {
      bush.berries += 1;
    }
  }

  const dir = DIRS[drawInt(seedRoot, 8, "wolf", state.tick)]!;
  const nx = state.wolf.pos.x + dir.x;
  const ny = state.wolf.pos.y + dir.y;
  if (nx >= 0 && nx < manifest.gridWidth && ny >= 0 && ny < manifest.gridHeight) {
    state.wolf.pos = { x: nx, y: ny };
  }
  for (const npc of state.npcs) {
    if (!npc.alive) continue;
    if (chebyshev(npc.pos, state.wolf.pos) <= 1) {
      npc.hp -= manifest.wolfDamage;
      npc.lastDamage = "wolf";
      events.push({ tick: state.tick, kind: "wolf_attack", npcId: npc.npcId, data: { damage: manifest.wolfDamage } });
    }
  }
}

/** Energy drain, starvation, cold, regen, death. Runs after NPC actions each tick. */
export function needsStep(
  state: WorldState,
  manifest: WorldManifest,
  events: SemanticEvent[],
): void {
  const season = seasonAt(state.tick, manifest);
  for (const npc of state.npcs) {
    if (!npc.alive) continue;
    npc.energy = Math.max(0, npc.energy - manifest.energyDrainPerTick);
    if (npc.energy === 0) {
      npc.hp -= manifest.starvationHpDrain;
      npc.lastDamage = "starvation";
      events.push({ tick: state.tick, kind: "starving", npcId: npc.npcId, data: {} });
    }
    if (season === "winter" && !isOnShelter(npc.pos, manifest)) {
      npc.hp -= manifest.winterColdHpDrain;
      npc.lastDamage = "cold";
    }
    if (npc.energy >= manifest.hpRegenEnergyMin) {
      npc.hp = Math.min(manifest.maxHp, npc.hp + manifest.hpRegenPerTick);
    }
    if (npc.hp <= 0) {
      npc.hp = 0;
      npc.alive = false;
      npc.deathTick = state.tick;
      npc.deathCause = npc.lastDamage ?? "unknown";
      events.push({ tick: state.tick, kind: "death", npcId: npc.npcId, data: { cause: npc.deathCause } });
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/rules.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/rules.ts tests/rules.test.ts
git commit -m "feat: environment and needs rules - regrowth, predator, starvation, cold, death"
```

---

### Task 11: Engine (live mode), determinism + smoke tests

**Files:**
- Create: `src/sim/engine.ts`
- Test: `tests/engine.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:

```typescript
export interface RunOptions {
  ticks: number;
  /** replay mode: actions injected instead of decided; key `${tick}:${npcId}` */
  injectedActions?: Map<string, { action: Action; actionSource: "reflex" | "utility" }>;
  /** collect a per-tick state hash (for divergence localization) */
  collectTickHashes?: boolean;
}
export interface RunResult {
  finalState: WorldState;
  actionLog: CanonicalActionEvent[];
  checkpoints: Checkpoint[];
  events: SemanticEvent[];
  tickHashes: { tick: number; stateHash: string }[]; // empty unless collectTickHashes
}
export function runSim(manifest: WorldManifest, roster: RosterEntry[], seedRoot: string, opts: RunOptions): RunResult;
export function verifyLogChain(log: CanonicalActionEvent[]): boolean;
```

**Tick sequence (state.tick goes 1..ticks):** set `state.tick = t` → emit `season_change` event when `seasonAt(t) !== seasonAt(t-1)` (npcId null, data `{ season }`) → `environmentStep` → for each **alive** NPC in roster order: build observation, hash it, decide (reflex ?? utility) or take injected action, `applyAction` (throw on illegal in live mode; in replay mode illegal actions throw too — the log is authoritative and must replay legally), append `CanonicalActionEvent` with hash-chained `previousEventHash` → `needsStep` → if `t % checkpointInterval === 0` push `{ tick: t, stateHash: hashCanonical(state) }`; if `collectTickHashes` push per-tick hash.

- [ ] **Step 1: Write the failing tests**

`tests/engine.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runSim, verifyLogChain } from "../src/sim/engine.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import { CanonicalActionEventS } from "../src/schema/log.js";

const manifest = makeTestManifest();

describe("engine", () => {
  it("same seed → identical final state, log, checkpoints", () => {
    const roster = makeTestRoster(5);
    const a = runSim(manifest, roster, "seed-1", { ticks: 300 });
    const b = runSim(manifest, roster, "seed-1", { ticks: 300 });
    expect(hashCanonical(a.finalState)).toBe(hashCanonical(b.finalState));
    expect(a.actionLog).toEqual(b.actionLog);
    expect(a.checkpoints).toEqual(b.checkpoints);
  });
  it("different seed → different trajectory", () => {
    const roster = makeTestRoster(5);
    const a = runSim(manifest, roster, "seed-1", { ticks: 300 });
    const b = runSim(manifest, roster, "seed-2", { ticks: 300 });
    expect(hashCanonical(a.finalState)).not.toBe(hashCanonical(b.finalState));
  });
  it("action log entries validate and hash-chain correctly", () => {
    const r = runSim(manifest, makeTestRoster(3), "seed-1", { ticks: 50 });
    for (const ev of r.actionLog) CanonicalActionEventS.parse(ev);
    expect(r.actionLog[0]!.previousEventHash).toBeNull();
    expect(verifyLogChain(r.actionLog)).toBe(true);
    const tampered = r.actionLog.map((e) => ({ ...e }));
    tampered[10]!.action = { verb: "idle" };
    expect(verifyLogChain(tampered)).toBe(false);
  });
  it("checkpoints at fixed interval", () => {
    const r = runSim(manifest, makeTestRoster(3), "seed-1", { ticks: 200 });
    expect(r.checkpoints.map((c) => c.tick)).toEqual([50, 100, 150, 200]);
  });
  it("25-NPC 1200-tick smoke: bounded state, no crash, chain valid", () => {
    const roster = makeTestRoster(25);
    const r = runSim(manifest, roster, "smoke-seed", { ticks: 1200 });
    for (const n of r.finalState.npcs) {
      expect(n.hp).toBeGreaterThanOrEqual(0);
      expect(n.hp).toBeLessThanOrEqual(manifest.maxHp);
      expect(n.energy).toBeGreaterThanOrEqual(0);
      expect(n.energy).toBeLessThanOrEqual(manifest.maxEnergy);
    }
    expect(verifyLogChain(r.actionLog)).toBe(true);
    expect(r.events.some((e) => e.kind === "season_change")).toBe(true);
    // dead NPCs stop producing actions
    for (const n of r.finalState.npcs.filter((n) => !n.alive)) {
      const after = r.actionLog.filter((e) => e.npcId === n.npcId && e.tick > n.deathTick!);
      expect(after).toEqual([]);
    }
  });
  it("collectTickHashes returns one hash per tick", () => {
    const r = runSim(manifest, makeTestRoster(2), "seed-1", { ticks: 40, collectTickHashes: true });
    expect(r.tickHashes.length).toBe(40);
    expect(r.tickHashes[0]!.tick).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/sim/engine.ts`:

```typescript
import type { WorldManifest, RosterEntry } from "../schema/core.js";
import type { Action, CanonicalActionEvent, Checkpoint, SemanticEvent } from "../schema/log.js";
import type { WorldState } from "../world/state.js";
import { createInitialState, seasonAt } from "../world/state.js";
import { environmentStep, needsStep } from "../world/rules.js";
import { applyAction } from "../world/actions.js";
import { buildObservation } from "../mind/observe.js";
import { reflexDecide } from "../mind/reflex.js";
import { utilityDecide } from "../mind/utility.js";
import { hashCanonical } from "../canon/canonicalize.js";

export interface RunOptions {
  ticks: number;
  injectedActions?: Map<string, { action: Action; actionSource: "reflex" | "utility" }>;
  collectTickHashes?: boolean;
}

export interface RunResult {
  finalState: WorldState;
  actionLog: CanonicalActionEvent[];
  checkpoints: Checkpoint[];
  events: SemanticEvent[];
  tickHashes: { tick: number; stateHash: string }[];
}

export function runSim(
  manifest: WorldManifest,
  roster: RosterEntry[],
  seedRoot: string,
  opts: RunOptions,
): RunResult {
  const state = createInitialState(manifest, roster, seedRoot);
  const actionLog: CanonicalActionEvent[] = [];
  const checkpoints: Checkpoint[] = [];
  const events: SemanticEvent[] = [];
  const tickHashes: RunResult["tickHashes"] = [];
  const rosterById = new Map(roster.map((r) => [r.npcId, r]));
  let lastEventHash: string | null = null;

  for (let t = 1; t <= opts.ticks; t++) {
    if (seasonAt(t, manifest) !== seasonAt(t - 1, manifest)) {
      events.push({ tick: t, kind: "season_change", npcId: null, data: { season: seasonAt(t, manifest) } });
    }
    state.tick = t;
    environmentStep(state, manifest, seedRoot, events);

    for (const npc of state.npcs) {
      if (!npc.alive) continue;
      const entry = rosterById.get(npc.npcId);
      if (entry === undefined) throw new Error(`npc ${npc.npcId} missing from roster`);
      const obs = buildObservation(state, manifest, npc);
      const observationHash = hashCanonical(obs);

      let action: Action;
      let actionSource: "reflex" | "utility";
      const injected = opts.injectedActions?.get(`${t}:${npc.npcId}`);
      if (injected !== undefined) {
        ({ action, actionSource } = injected);
      } else {
        const reflex = reflexDecide(obs, entry.policy);
        if (reflex !== null) {
          action = reflex;
          actionSource = "reflex";
        } else {
          action = utilityDecide(obs, entry.identity, entry.policy, manifest, seedRoot).action;
          actionSource = "utility";
        }
      }

      const legal = applyAction(state, manifest, npc, action);
      if (!legal) {
        throw new Error(`illegal action at tick ${t} for ${npc.npcId}: ${JSON.stringify(action)}`);
      }

      const event: CanonicalActionEvent = {
        eventId: `${t}:${npc.npcId}`,
        tick: t,
        npcId: npc.npcId,
        observationHash,
        action,
        actionSource,
        deliberationTriggered: false, // P4: fixed in Phase 0 (no deliberative layer)
        energyCharged: 0,
        previousEventHash: lastEventHash,
      };
      lastEventHash = hashCanonical(event);
      actionLog.push(event);
    }

    needsStep(state, manifest, events);

    if (t % manifest.checkpointInterval === 0) {
      checkpoints.push({ tick: t, stateHash: hashCanonical(state) });
    }
    if (opts.collectTickHashes === true) {
      tickHashes.push({ tick: t, stateHash: hashCanonical(state) });
    }
  }

  return { finalState: state, actionLog, checkpoints, events, tickHashes };
}

/** Recomputes the previousEventHash chain. */
export function verifyLogChain(log: CanonicalActionEvent[]): boolean {
  let prev: string | null = null;
  for (const ev of log) {
    if (ev.previousEventHash !== prev) return false;
    prev = hashCanonical(ev);
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine.test.ts && npm run typecheck`
Expected: all PASS (smoke test may take a few seconds); tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/sim tests/engine.test.ts
git commit -m "feat: deterministic engine with hash-chained action log and checkpoints"
```

---

### Task 12: Replay + verification + divergence localization

**Files:**
- Create: `src/replay/replay.ts`
- Test: `tests/replay.test.ts`

**Interfaces:**
- Consumes: `runSim`, `RunResult` (Task 11); `CanonicalActionEvent`, `Checkpoint` types.
- Produces:

```typescript
export interface ReplayReport {
  ok: boolean;
  checkpointCount: number;
  firstDivergentCheckpoint: number | null; // tick of first mismatching checkpoint
  firstDivergentTick: number | null;       // exact tick, from per-tick re-run diff
}
export function replayRun(manifest, roster, seedRoot, actionLog, ticks, collectTickHashes?): RunResult;
export function verifyReplay(manifest, roster, seedRoot, actionLog, recordedCheckpoints, ticks): ReplayReport;
```

`replayRun` builds the `injectedActions` map from the log and calls `runSim`. `verifyReplay` compares replay checkpoints to recorded ones; on mismatch it re-runs **both** a fresh live run and the replay with `collectTickHashes` and reports the first tick where hashes differ (doc §3.1: divergence localizable to first inconsistent tick).

- [ ] **Step 1: Write the failing tests**

`tests/replay.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runSim } from "../src/sim/engine.js";
import { replayRun, verifyReplay } from "../src/replay/replay.js";
import { hashCanonical } from "../src/canon/canonicalize.js";
import { makeTestManifest, makeTestRoster } from "./helpers.js";
import type { Action } from "../src/schema/log.js";

const manifest = makeTestManifest();
const roster = makeTestRoster(5);

describe("replay", () => {
  it("replaying a live log reproduces the exact state trajectory", () => {
    const live = runSim(manifest, roster, "seed-1", { ticks: 300 });
    const replayed = replayRun(manifest, roster, "seed-1", live.actionLog, 300);
    expect(hashCanonical(replayed.finalState)).toBe(hashCanonical(live.finalState));
    expect(replayed.checkpoints).toEqual(live.checkpoints);
  });
  it("verifyReplay passes on an untampered log", () => {
    const live = runSim(manifest, roster, "seed-1", { ticks: 300 });
    const report = verifyReplay(manifest, roster, "seed-1", live.actionLog, live.checkpoints, 300);
    expect(report).toEqual({
      ok: true,
      checkpointCount: 6,
      firstDivergentCheckpoint: null,
      firstDivergentTick: null,
    });
  });
  it("a tampered action is detected and localized to its tick", () => {
    const live = runSim(manifest, roster, "seed-1", { ticks: 300 });
    const tampered = live.actionLog.map((e) => ({ ...e }));
    // find a 'move' event past tick 100 and null it out to idle
    const idx = tampered.findIndex((e) => e.tick > 100 && e.action.verb === "move");
    expect(idx).toBeGreaterThan(-1);
    const badTick = tampered[idx]!.tick;
    tampered[idx]!.action = { verb: "idle" } as Action;
    const report = verifyReplay(manifest, roster, "seed-1", tampered, live.checkpoints, 300);
    expect(report.ok).toBe(false);
    expect(report.firstDivergentCheckpoint).not.toBeNull();
    expect(report.firstDivergentTick).toBe(badTick);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/replay.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/replay/replay.ts`:

```typescript
import type { WorldManifest, RosterEntry } from "../schema/core.js";
import type { Action, CanonicalActionEvent, Checkpoint } from "../schema/log.js";
import { runSim, type RunResult } from "../sim/engine.js";

export interface ReplayReport {
  ok: boolean;
  checkpointCount: number;
  firstDivergentCheckpoint: number | null;
  firstDivergentTick: number | null;
}

export function replayRun(
  manifest: WorldManifest,
  roster: RosterEntry[],
  seedRoot: string,
  actionLog: CanonicalActionEvent[],
  ticks: number,
  collectTickHashes = false,
): RunResult {
  const injected = new Map<string, { action: Action; actionSource: "reflex" | "utility" }>();
  for (const ev of actionLog) {
    injected.set(ev.eventId, { action: ev.action, actionSource: ev.actionSource });
  }
  return runSim(manifest, roster, seedRoot, { ticks, injectedActions: injected, collectTickHashes });
}

/**
 * Layer-1 verification (doc §3.1): replay the log, compare checkpoint hashes.
 * On divergence, re-run live + replay with per-tick hashes to find the first
 * inconsistent tick.
 */
export function verifyReplay(
  manifest: WorldManifest,
  roster: RosterEntry[],
  seedRoot: string,
  actionLog: CanonicalActionEvent[],
  recordedCheckpoints: Checkpoint[],
  ticks: number,
): ReplayReport {
  const replayed = replayRun(manifest, roster, seedRoot, actionLog, ticks);
  let firstDivergentCheckpoint: number | null = null;
  for (let i = 0; i < recordedCheckpoints.length; i++) {
    const rec = recordedCheckpoints[i]!;
    const got = replayed.checkpoints[i];
    if (got === undefined || got.tick !== rec.tick || got.stateHash !== rec.stateHash) {
      firstDivergentCheckpoint = rec.tick;
      break;
    }
  }
  if (firstDivergentCheckpoint === null) {
    return {
      ok: true,
      checkpointCount: recordedCheckpoints.length,
      firstDivergentCheckpoint: null,
      firstDivergentTick: null,
    };
  }

  const liveTicks = runSim(manifest, roster, seedRoot, { ticks, collectTickHashes: true }).tickHashes;
  const replayTicks = replayRun(manifest, roster, seedRoot, actionLog, ticks, true).tickHashes;
  let firstDivergentTick: number | null = null;
  for (let i = 0; i < liveTicks.length; i++) {
    if (replayTicks[i] === undefined || liveTicks[i]!.stateHash !== replayTicks[i]!.stateHash) {
      firstDivergentTick = liveTicks[i]!.tick;
      break;
    }
  }
  return {
    ok: false,
    checkpointCount: recordedCheckpoints.length,
    firstDivergentCheckpoint,
    firstDivergentTick,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/replay.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/replay tests/replay.test.ts
git commit -m "feat: replay verification with checkpoint diff and tick-level divergence localization"
```

---

### Task 13: CLI — run, replay, narration, demo world

**Files:**
- Create: `src/cli/demo.ts`, `src/cli/narrate.ts`, `src/cli/run.ts`, `src/cli/replay.ts`
- Test: `tests/cli.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `makeDemoManifest(): WorldManifest` (32×32, 12 bushes, 3 shelters), `makeDemoRoster(seedRoot: string): RosterEntry[]` (25 NPCs, weights varied via `drawInt`), `narrate(event: SemanticEvent, names: Map<string, string>): string`; CLI commands `npm run sim -- --seed <s> --ticks <n> [--out runs/<dir>]` and `npm run replay -- <runDir>`.

**Run directory layout:** `manifest.json`, `roster.json`, `meta.json` (`{ seedRoot, ticks, schemaVersion, canonVersion, rngSchemeVersion }`), `actions.jsonl`, `checkpoints.json`, `events.jsonl`.

- [ ] **Step 1: Write the failing tests**

`tests/cli.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { makeDemoManifest, makeDemoRoster } from "../src/cli/demo.js";
import { narrate } from "../src/cli/narrate.js";
import { WorldManifestS, RosterEntryS } from "../src/schema/core.js";
import { runSim } from "../src/sim/engine.js";

describe("demo world", () => {
  it("manifest and roster validate against schemas", () => {
    WorldManifestS.parse(makeDemoManifest());
    const roster = makeDemoRoster("demo-seed");
    expect(roster.length).toBe(25);
    for (const r of roster) RosterEntryS.parse(r);
  });
  it("roster weights actually vary across NPCs", () => {
    const roster = makeDemoRoster("demo-seed");
    const forages = new Set(roster.map((r) => r.policy.utilityWeights.forage));
    expect(forages.size).toBeGreaterThan(3);
  });
  it("25 NPCs survive-or-die plausibly over 2 seasons (no mass instant death)", () => {
    const r = runSim(makeDemoManifest(), makeDemoRoster("demo-seed"), "demo-seed", { ticks: 800 });
    const alive = r.finalState.npcs.filter((n) => n.alive).length;
    expect(alive).toBeGreaterThan(0);
  });
});

describe("narration", () => {
  const names = new Map([["npc-1", "Rill"]]);
  it("narrates death with cause", () => {
    const line = narrate({ tick: 412, kind: "death", npcId: "npc-1", data: { cause: "cold" } }, names);
    expect(line).toContain("Rill");
    expect(line).toContain("cold");
    expect(line).toContain("412");
  });
  it("narrates season change", () => {
    const line = narrate({ tick: 400, kind: "season_change", npcId: null, data: { season: "winter" } }, names);
    expect(line.toLowerCase()).toContain("winter");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cli.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement demo world and narration**

`src/cli/demo.ts`:

```typescript
import type { WorldManifest, RosterEntry } from "../schema/core.js";
import { SCHEMA_VERSION } from "../schema/core.js";
import { drawInt } from "../rng/rng.js";

const NAMES = [
  "Rill", "Ash", "Fenna", "Bram", "Sorrel", "Wren", "Tarn", "Isla", "Corin", "Vesna",
  "Odo", "Merle", "Sable", "Quinn", "Petra", "Lorn", "Hazel", "Garen", "Nyx", "Ives",
  "Runa", "Col", "Tamsin", "Ebba", "Joss",
] as const;

export function makeDemoManifest(): WorldManifest {
  const bushes = Array.from({ length: 12 }, (_, i) => ({
    id: `bush-${i + 1}`,
    pos: { x: drawInt("demo-layout", 32, "bush-x", i), y: drawInt("demo-layout", 32, "bush-y", i) },
    capacity: 5,
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    gridWidth: 32,
    gridHeight: 32,
    seasonLengthTicks: 400,
    energyDrainPerTick: 2,
    starvationHpDrain: 5,
    winterColdHpDrain: 3,
    berryEnergy: 200,
    berryRegrowPpmSummer: 60_000,
    berryRegrowPpmWinter: 5_000,
    wolfDamage: 50,
    hpRegenPerTick: 1,
    hpRegenEnergyMin: 500,
    maxHp: 1000,
    maxEnergy: 1000,
    visionRadius: 8,
    checkpointInterval: 100,
    shelters: [{ x: 6, y: 6 }, { x: 25, y: 8 }, { x: 15, y: 26 }],
    bushes,
    wolfStart: { x: 31, y: 31 },
  };
}

function vary(seedRoot: string, base: number, spread: number, ...key: (string | number)[]): number {
  const v = base - spread + drawInt(seedRoot, spread * 2 + 1, ...key);
  return Math.max(0, Math.min(1000, v));
}

export function makeDemoRoster(seedRoot: string): RosterEntry[] {
  return NAMES.map((name, i) => {
    const npcId = `npc-${i + 1}`;
    return {
      npcId,
      name,
      identity: {
        riskTolerance: vary(seedRoot, 500, 300, "risk", i),
        socialTrust: vary(seedRoot, 500, 300, "trust", i),
        explorationBias: vary(seedRoot, 400, 300, "explore", i),
        patience: vary(seedRoot, 500, 300, "patience", i),
        voiceStyle: "",
      },
      policy: {
        utilityWeights: {
          forage: vary(seedRoot, 600, 250, "w-forage", i),
          consume: vary(seedRoot, 800, 150, "w-consume", i),
          shelter: vary(seedRoot, 700, 250, "w-shelter", i),
          explore: vary(seedRoot, 200, 180, "w-explore", i),
          idle: vary(seedRoot, 50, 40, "w-idle", i),
        },
        thresholds: { hungerUrgent: vary(seedRoot, 150, 100, "t-hunger", i) },
      },
    };
  });
}
```

`src/cli/narrate.ts`:

```typescript
import type { SemanticEvent } from "../schema/log.js";

export function narrate(event: SemanticEvent, names: Map<string, string>): string {
  const who = event.npcId === null ? "" : (names.get(event.npcId) ?? event.npcId);
  switch (event.kind) {
    case "death":
      return `[tick ${event.tick}] ${who} died (${event.data["cause"]}).`;
    case "wolf_attack":
      return `[tick ${event.tick}] The wolf attacked ${who} (-${event.data["damage"]} hp).`;
    case "starving":
      return `[tick ${event.tick}] ${who} is starving.`;
    case "season_change":
      return `[tick ${event.tick}] The season turned to ${event.data["season"]}.`;
  }
}
```

- [ ] **Step 4: Implement CLI entrypoints**

`src/cli/run.ts`:

```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runSim } from "../sim/engine.js";
import { makeDemoManifest, makeDemoRoster } from "./demo.js";
import { narrate } from "./narrate.js";
import { SCHEMA_VERSION } from "../schema/core.js";
import { CANON_VERSION } from "../canon/canonicalize.js";
import { RNG_SCHEME_VERSION } from "../rng/rng.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
}

const seedRoot = arg("seed", "demo-seed");
const ticks = parseInt(arg("ticks", "1200"), 10);
const outDir = arg("out", join("runs", `${seedRoot}-${ticks}`));

const manifest = makeDemoManifest();
const roster = makeDemoRoster(seedRoot);
const result = runSim(manifest, roster, seedRoot, { ticks });

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(join(outDir, "roster.json"), JSON.stringify(roster, null, 2));
writeFileSync(
  join(outDir, "meta.json"),
  JSON.stringify({ seedRoot, ticks, schemaVersion: SCHEMA_VERSION, canonVersion: CANON_VERSION, rngSchemeVersion: RNG_SCHEME_VERSION }, null, 2),
);
writeFileSync(join(outDir, "actions.jsonl"), result.actionLog.map((e) => JSON.stringify(e)).join("\n") + "\n");
writeFileSync(join(outDir, "checkpoints.json"), JSON.stringify(result.checkpoints, null, 2));
writeFileSync(join(outDir, "events.jsonl"), result.events.map((e) => JSON.stringify(e)).join("\n") + "\n");

const names = new Map(roster.map((r) => [r.npcId, r.name]));
const alive = result.finalState.npcs.filter((n) => n.alive).length;
console.log(`Simulated ${ticks} ticks, seed "${seedRoot}" → ${outDir}`);
console.log(`Alive: ${alive}/${roster.length}, actions: ${result.actionLog.length}, checkpoints: ${result.checkpoints.length}`);
console.log("--- events ---");
for (const ev of result.events) console.log(narrate(ev, names));
```

`src/cli/replay.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyReplay } from "../replay/replay.js";
import { verifyLogChain } from "../sim/engine.js";
import { WorldManifestS, RosterEntryS } from "../schema/core.js";
import { CanonicalActionEventS, CheckpointS } from "../schema/log.js";
import { z } from "zod";

const runDir = process.argv[2];
if (runDir === undefined) {
  console.error("usage: npm run replay -- <runDir>");
  process.exit(2);
}

const manifest = WorldManifestS.parse(JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8")));
const roster = z.array(RosterEntryS).parse(JSON.parse(readFileSync(join(runDir, "roster.json"), "utf8")));
const meta = JSON.parse(readFileSync(join(runDir, "meta.json"), "utf8")) as { seedRoot: string; ticks: number };
const actionLog = readFileSync(join(runDir, "actions.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.length > 0)
  .map((l) => CanonicalActionEventS.parse(JSON.parse(l)));
const checkpoints = z.array(CheckpointS).parse(JSON.parse(readFileSync(join(runDir, "checkpoints.json"), "utf8")));

const chainOk = verifyLogChain(actionLog);
const report = verifyReplay(manifest, roster, meta.seedRoot, actionLog, checkpoints, meta.ticks);
console.log(`log chain: ${chainOk ? "OK" : "BROKEN"}`);
console.log(`replay: ${report.ok ? "OK" : "DIVERGED"} (${report.checkpointCount} checkpoints)`);
if (!report.ok) {
  console.log(`first divergent checkpoint tick: ${report.firstDivergentCheckpoint}`);
  console.log(`first divergent tick: ${report.firstDivergentTick}`);
}
process.exit(chainOk && report.ok ? 0 : 1);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/cli.test.ts && npm run typecheck`
Expected: all PASS; tsc exits 0.

- [ ] **Step 6: End-to-end check**

```bash
npm run sim -- --seed hello --ticks 1200
npm run replay -- runs/hello-1200
```

Expected: sim prints alive count, event narration lines (season changes at 400/800; likely some wolf attacks/deaths); replay prints `log chain: OK` and `replay: OK (12 checkpoints)`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/cli tests/cli.test.ts
git commit -m "feat: CLI sim runner and replay verifier with demo world and narration"
```

---

### Task 14: Full-suite verification + README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Run the entire suite**

Run: `npm test && npm run typecheck`
Expected: all tests pass, tsc exits 0.

- [ ] **Step 2: Write README**

`README.md`:

```markdown
# keco-world — Living Worlds Phase 0 kernel

Deterministic no-LLM survival simulation kernel (Living Worlds design doc §17.1
steps 1–2). 25 NPCs on a grid: seasons, foraging, shelter, a predator; Reflex +
Utility decision layers; canonical hash-chained action log; checkpoint hashing;
replay verification with tick-level divergence localization.

## Commands

- `npm test` — run the test suite
- `npm run sim -- --seed <s> --ticks <n>` — run a simulation, write `runs/<s>-<n>/`
- `npm run replay -- runs/<s>-<n>` — verify the run replays identically

## Determinism invariants

- Hashed data is integers/strings/bools/null only (`int-canon-v1`)
- All randomness is stateless, keyed draws (`fnv1a-mulberry32-v1`) — no RNG state
- No `Date.now()` / `Math.random()` under `src/`
- NPCs act in roster order; all tie-breaks are explicit

## Design docs

- `docs/review-v0.4.1.md` — critique of design doc v0.4.1
- `docs/proposals-v0.5.md` — adopted proposals P1–P5 (P4 fields appear in the log schema)
```

- [ ] **Step 3: Commit (including design docs already in the tree)**

```bash
git add README.md docs
git commit -m "docs: README and design review/proposal documents"
```

---

## Self-Review Notes

- **Spec coverage:** §3.1 Layer-1 replay → Tasks 11–12 (Layer-2 decision audit is N/A in Phase 0 — no LLM decisions exist; `observationHash`/`actionSource` fields keep the seam). §6.2 Reflex/Utility → Tasks 7–8 (Deliberative deferred per plan scope; utility recomputes every tick — the 10–30-tick cadence in §6.2 is a cost optimization for the LLM era, meaningless without one). §16 schemas → Task 4 with P4 patches (closed `utilityWeights` keys, `deliberationTriggered`, `energyCharged`). §17.1 steps 1–2 → whole plan; steps 3+ (baselines, benchmarks, Genome) are the next plan. Phase-0 exit criterion "single understandable event" → Task 13 narration.
- **Type consistency check:** `drawInt(seedRoot, n, ...parts)` used identically in Tasks 3/5/8/10/13; `DIRS` defined once in Task 8, imported by Tasks 9–10; `RunOptions.injectedActions` keyed by `eventId` format `${tick}:${npcId}` matches Task 11's eventId construction and Task 12's map building; `Observation` shape identical across Tasks 6–8 tests.
- **Known deliberate simplifications (YAGNI):** no NPC-to-NPC interaction verbs (`give`/`speak` deferred with the social system), single wolf, no pathfinding obstacles, utility recompute every tick, mutation-in-place state (determinism unaffected; snapshots are hashed, not aliased — `hashCanonical` serializes at call time).
