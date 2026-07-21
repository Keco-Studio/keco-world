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

## Determinism invariants

- Hashed data is integers/strings/bools/null only (`int-canon-v1`)
- All randomness is stateless, keyed draws (`fnv1a-mulberry32-v1`) — no RNG state
- No `Date.now()` / `Math.random()` under `src/`
- NPCs act in roster order; all tie-breaks are explicit

## Design docs

- `docs/review-v0.4.1.md` — critique of design doc v0.4.1
- `docs/proposals-v0.5.md` — adopted proposals P1–P5 (P4 fields appear in the log schema)
- `docs/bench-prereg-v1.md` — preregistered deliberation-gain judgment (P0)
