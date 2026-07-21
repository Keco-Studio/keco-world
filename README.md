# keco-world — Living Worlds Phase 0 kernel

Deterministic no-LLM survival simulation kernel (Living Worlds design doc §17.1
steps 1–2). 25 NPCs on a grid: seasons, foraging, shelter, a predator; Reflex +
Utility decision layers; canonical hash-chained action log; checkpoint hashing;
replay verification with tick-level divergence localization.

## Commands

- `npm test` — run the test suite
- `npm run sim -- --seed <s> --ticks <n>` — run a simulation, write `runs/<s>-<n>/`
- `npm run replay -- runs/<s>-<n>` — verify the run replays identically
- `npm run bench -- --harvest-only` — calibrate deliberation trigger harvesting
- `npm run bench -- --label official-v1` — run the deliberation benchmark (requires `ollama pull qwen3:0.6b qwen3:1.7b qwen3:4b`; see `docs/bench-prereg-v1.md`)
- `npm run evolve -- --seed <s> --ticks <n>` — run the generational driver (genome breeding, in-world reproduction, aging), write `runs/evolve-<s>/`; see `docs/evolve-calibration.md`

## Determinism invariants

- Hashed data is integers/strings/bools/null only (`int-canon-v1`)
- All randomness is stateless, keyed draws (`fnv1a-mulberry32-v1`) — no RNG state
- No `Date.now()` / `Math.random()` under `src/`
- NPCs act in roster order; all tie-breaks are explicit

## Design docs

Single-version policy: `docs/living-worlds.md` is the one authoritative spec; historical versions live in git history. One-off records (reviews, decisions, preregistrations) are separate immutable files.

- `docs/living-worlds.md` — the design document (current: v0.5.1)
- `docs/review-v0.4.1.md` — critique of the v0.4.1 draft (historical record)
- `docs/proposals-v0.5.md` — adopted proposals P1–P5 (historical record)
- `docs/bench-prereg-v1.md` — preregistered deliberation-gain judgment (frozen protocol)
- `docs/evolve-calibration.md` — genome-breeding calibration runs (population/births/deaths, observations, known unknowns for §17.1 step 7)
- `docs/decisions/` — decision records (DEC-P0 → B0)
- `docs/bench-results/` — official benchmark reports + audit trails
