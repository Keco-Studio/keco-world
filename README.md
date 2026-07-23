# keco-world — Living Worlds Phase 0 kernel

Deterministic no-LLM survival simulation kernel (Living Worlds design doc §17.1
steps 1–2). 25 NPCs on a grid: seasons, foraging, shelter, a predator; Reflex +
Utility decision layers; canonical hash-chained action log; checkpoint hashing;
replay verification with tick-level divergence localization.

## Commands

- `npm test` — run the test suite
- `npm run sim -- --seed <s> --ticks <n> [--directives <file>]` — run a simulation, write `runs/<s>-<n>/`; `--directives` reads a `PatronDirectiveFileS`-shaped JSON file of `{tick, npcId, theme}` rows and applies them as patron directives; the run dir always gets a `directives.json` (canonical sorted form, `[]` when none)
- `npm run replay -- runs/<s>-<n> [--strict]` — verify the run replays identically; loads `directives.json` from the run dir when present (absent is fine — older run dirs stay verifiable); `--strict` additionally runs a full no-injection re-simulation to verify the annotation fields (`actionSource`/`patronInfluence`/`patronDecisive`) themselves, not just that the log replays consistently — see `docs/product-shell.md` §3.4 for the two-verdict model
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

## Web shell (first five minutes)

`web/` is a Vite + Excalibur browser shell rendering the real deterministic kernel — no server, no LLM, the sim runs client-side off a fixed seed. It implements the §4.2 首个五分钟 journey (opening moment → why-card → patron selection → hooks → biography) as an interaction-gated flow, plus the 守望 (patron) mechanism (schema v4, Resolver band tilt with a shadow-counterfactual audit) and a Moment Director v0 that deterministically picks the default opening event (冬前储备不足 / winter-shortfall).

- `npm run web` — start the dev server (port 5273, see `.claude/launch.json`), fixed seed `"shell-1"`
- `npx vite build web` — production build check

See `docs/product-shell.md` for the full record: §4.2 beat-by-beat implementation, the patron mechanism's calibrated `PATRON_TILT` and red-line audit (including the counterfactual-coupling correction), the Moment Director decision, the `DAY_TICKS` display convention, visual-verification findings, and what's explicitly out of scope for this shell (deferred to the 1B roadmap in `docs/living-worlds.md`).

## Design docs

Single-version policy: `docs/living-worlds.md` is the one authoritative spec; historical versions live in git history. One-off records (reviews, decisions, preregistrations) are separate immutable files.

- `docs/living-worlds.md` — the design document (current: v0.5.2)
- `docs/review-v0.4.1.md` — critique of the v0.4.1 draft (historical record)
- `docs/proposals-v0.5.md` — adopted proposals P1–P5 (historical record)
- `docs/bench-prereg-v1.md` — preregistered deliberation-gain judgment (frozen protocol)
- `docs/evolve-calibration.md` — genome-breeding calibration runs (population/births/deaths, observations, known unknowns for §17.1 step 7; includes a 行为漂移初测 behavior-drift paragraph)
- `docs/degradation-check.md` — 10-generation degradation check official run record (§17.1 step 7): frozen D1–D5 criteria, per-seed time series, idle-share drift trend, findings and implications for the step 9 formal 50-generation runs
- `docs/baseline-arms.md` — four-arm (Random/Fixed/Handcrafted/Evolutionary) official run record (§17.1 step 3): arm definitions, the 25-archetype Handcrafted content table and 工时记录, per-arm × per-seed results, cross-arm scenario comparison, and findings
- `docs/product-shell.md` — first-five-minutes product shell record (§17.1 step 8): §4.2 beat-by-beat implementation, patron mechanism calibration + counterfactual-coupling correction, Moment Director decision, `DAY_TICKS` convention, visual-verification findings, 1B backlog
- `docs/examples/` — real artifacts from an evo-1 run: a lineage biography and a founders-vs-evolved behavior report, for a concrete sense of the CLI output
- `docs/decisions/` — decision records (DEC-P0 → B0)
- `docs/bench-results/` — official benchmark reports + audit trails
