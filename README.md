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
- `npm run behavior -- --seed <s> --ticks <n>` — rerun the demo world and compare founder vs. evolved genome behavior on the fixed scenario suite (verb/n-gram distances, key shifts, disagreement rate), write `runs/behavior-<s>/report.json`
- `npm run biography -- --seed <s> --ticks <n> [--lineage <founderNpcId>] [--top N]` — rerun the demo world and extract a grounded, blinded markdown biography per lineage (named lineage, or top-N by member count), write `runs/biography-<s>/<founderName>.md` + `index.json`
- `npm run degradation -- --seeds 6 --ticks 15000 --chunk 1000` — chain the demo world in fixed-size chunks across multiple seeds, snapshot cheap time-series metrics (population, diversity, epsilon, beliefs, verb shares) at each chunk boundary, and evaluate the pre-declared D1–D5 degradation criteria (§17.1 step 7); write `runs/degradation/report.json`; see `docs/degradation-check.md`
- `npm run arms -- run --arm <random|fixed|handcrafted|evolutionary> [--seeds 3] [--ticks 15000] [--chunk 1000]` — chunked long run of one of the four baseline arms (§17.1 step 3), write `runs/arms/report-<arm>.json`
- `npm run arms -- compare [--seed arms-cmp]` — evaluate all four arms' 25 founder genomes against the shared scenario suite; reports intra-arm diversity and 6 cross-arm distances, write `runs/arms/compare.json`; see `docs/baseline-arms.md`

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
- `docs/evolve-calibration.md` — genome-breeding calibration runs (population/births/deaths, observations, known unknowns for §17.1 step 7; includes a 行为漂移初测 behavior-drift paragraph)
- `docs/degradation-check.md` — 10-generation degradation check official run record (§17.1 step 7): frozen D1–D5 criteria, per-seed time series, idle-share drift trend, findings and implications for the step 9 formal 50-generation runs
- `docs/baseline-arms.md` — four-arm (Random/Fixed/Handcrafted/Evolutionary) official run record (§17.1 step 3): arm definitions, the 25-archetype Handcrafted content table and 工时记录, per-arm × per-seed results, cross-arm scenario comparison, and findings
- `docs/examples/` — real artifacts from an evo-1 run: a lineage biography and a founders-vs-evolved behavior report, for a concrete sense of the CLI output
- `docs/decisions/` — decision records (DEC-P0 → B0)
- `docs/bench-results/` — official benchmark reports + audit trails
