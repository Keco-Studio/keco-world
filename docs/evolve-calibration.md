# Evolve calibration runs (Task 11)

**Date** 2026-07-21
**Command** `npm run evolve -- --seed <seed> --ticks 60000`, seeds `evo-1`, `evo-2`, `evo-3`
**World** `makeDemoManifest()` / `makeDemoRoster(seed)` — the same 25-NPC demo world used by `npm run sim`
**Purpose** First calibration pass for the genome-breeding + in-world reproduction system (Tasks 1–10), and pre-work for Living Worlds §17.1 step 7 (10-generation degradation check). Per the plan's self-review notes, **this task does not tune parameters** — reproduction/population-balance values in `makeDemoManifest()` are first guesses, and the outcome below is recorded as a finding, not fixed.

## Results

| Metric | evo-1 | evo-2 | evo-3 |
|---|---|---|---|
| Final population | 0 | 0 | 0 |
| Total births | 16 | 22 | 11 |
| Deaths — old_age | 32 | 33 | 27 |
| Deaths — starvation | 7 | 6 | 4 |
| Deaths — cold | 1 | 8 | 5 |
| Deaths — wolf | 1 | 0 | 0 |
| Total deaths | 41 | 47 | 36 |
| Max generation reached | 5 | 9 | 2 |
| Mean generation (alive) | n/a (pop 0) | n/a (pop 0) | n/a (pop 0) |
| Living lineages | 0/25 | 0/25 | 0/25 |
| Extinct lineages | 25/25 | 25/25 | 25/25 |
| Beliefs held (all NPCs, end of run) | 32 | 53 | 40 |
| Mean beliefs/NPC (×100) | 78 | 112 | 111 |
| Belief-formed events | 31 | 37 | 46 |
| Weight diversity (×100) | 0 | 0 | 0 |
| Tick of last recorded birth | 4166 | 8268 | 2127 |
| Approx. share of the 60k-tick run spent extinct | ≥93% | ≥86% | ≥96% |

(Total deaths equal founders + births in every run — 25 + 16 = 41, 25 + 22 = 47, 25 + 11 = 36 — confirming every NPC that ever existed in these three runs eventually died, and none of the 25 founder lineages survived to tick 60,000.)

Raw outputs (`summary.json`, `births.jsonl`) were generated under `runs/evolve-evo-{1,2,3}/` and inspected for this report; the `runs/` directories were deleted afterward per the plan (calibration artifacts are not meant to be committed — only this summary is).

## Observations

All three seeds converge on the same outcome: **the demo world goes extinct.** Population is not stable — it heads monotonically to zero, and does so early: the last successful birth in any run lands at tick 2127–8268, i.e. within the first 3.5–14% of the 60,000-tick window, after which the world sits at population 0 for the remaining 50,000+ ticks with nothing left to observe. Deaths are dominated by `old_age` (66–77% of all deaths across the three runs), meaning most NPCs simply age past `elderAgeTicks` without ever reproducing — this is a birth-rate problem, not a survival (starvation/cold/wolf) problem. The arithmetic explains why: founders are spawned at a staggered age between `adultAgeTicks` (800) and `elderAgeTicks` (2400) (`birthTick = -(800 + rand[0,1600))`), so a founder's *average* remaining fertile window at tick 0 is only ~800 ticks, not the full 1600-tick span. Reproduction additionally requires two eligible NPCs to be Chebyshev-adjacent on the same tick (`reproductionStep` in `src/world/rules.ts`), and there is no mate-seeking behavior in the utility layer — NPCs forage, shelter, and explore, but never move *toward* a potential partner. Adjacency is therefore incidental, arising mostly from NPCs converging on the same bush or shelter, not from anything resembling courtship. Once two eligible NPCs are adjacent, the per-tick success chance (`birthChancePpm = 15000`, i.e. 1.5%) is high enough that sustained adjacency reliably produces a birth (expected failures to reach ~50% cumulative chance is ~46 adjacent ticks) — so the bottleneck is almost entirely *getting and staying adjacent while both parties are still fertile*, not the roll itself. This is consistent with what the birth logs show: in evo-2 (the longest-lived run, max generation 9), the entire late-run lineage is a single narrow chain alternating between two founder lineages (`npc-7` and `npc-9` descendants) — one fragile breeding pair carrying the whole population's future. When that chain's next link fails to form in time (a partner ages out, starves, or freezes before its next fertile encounter), the whole population collapses at once, since the other 23 founder lineages had already gone extinct earlier without ever producing a second generation. Belief formation (31–46 `belief_formed` events, 0.78–1.12 mean beliefs per NPC at end of run) and weight diversity (always 0.00, since the diversity metric requires ≥2 living NPCs) are both too sparse and too short-lived to say anything about cultural or genomic drift trends — the population dies before those systems accumulate enough history to evaluate.

Comparing against the DEC-4 pacing anchors in `docs/living-worlds.md` (§3: target NPC lifespan ≈ 60–90 sim-days, generational interval ≈ real 1–2 weeks, covering 2–4 generational turnovers per month of attention) is only possible qualitatively right now, because **the codebase has no tick-to-sim-day (or tick-to-real-time) conversion constant** — see Known Unknowns below. What we can say without that mapping: the demo manifest's fertile window (1600 ticks between `adultAgeTicks` and `elderAgeTicks`) is narrow relative to the 60,000-tick run length (≈2.6% of it), and the *effective* breeding population per generation collapses to 1–2 lineages almost immediately rather than the 25 the roster starts with — i.e. this manifest was evidently tuned for the Phase-0 single-life survival demo (Tasks 1–10's 25-NPC/session simulation), not for a self-sustaining multi-generational population, and nothing in the birth/aging parameters was chosen with generational turnover in mind. That is exactly the kind of "first guess, needs its own follow-up" the plan anticipated.

## Known unknowns (for §17.1 step 7's 10-generation degradation check)

- **No tick↔sim-day↔real-day mapping exists in code.** DEC-4's anchors (60–90 sim-day lifespan, 1–2 real-week generational interval, "1 real day ≈ 4 sim days") cannot be directly cross-checked against tick counts until such a constant is defined and agreed. Any future calibration pass should establish this mapping *before* trying to compare tick-based results to the design doc's pacing targets.
- **The demo manifest cannot sustain 10 generations.** Max generation observed across all three runs was 2, 5, and 9 — never 10, and always ending in extinction (generation count stops growing, it doesn't plateau). Whoever picks up the §17.1 step 7 degradation check needs either a re-tuned parameter set or an explicitly non-demo manifest with a surviving population; the check literally has nothing to measure against as configured today.
- **"Never meet" vs. "meet but don't conceive" is not instrumented.** The observed bottleneck looks like adjacency scarcity (no mate-seeking behavior) rather than a low `birthChancePpm`, but this is inferred from birth-log timing, not measured directly. A follow-up should log eligible-adjacent-pair-tick counts to confirm which failure mode actually dominates before touching any single parameter.
- **Whether founder age-staggering (`birthTick = -(800 + rand[0,1600))`) is intentional pacing or an accidental headwind is unresolved.** It puts the average founder about halfway through their fertile window at tick 0, which mechanically halves the expected reproductive opportunity for the starting cohort.
- **Weight diversity (`weightDiversity100`) is untested as a signal.** It read 0.00 in all three runs purely because `finalPopulation` was 0 (the metric requires ≥2 living NPCs); its behavior under a population that actually survives and diversifies is unknown.
- **Belief/cultural-layer accumulation over multiple generations is unobserved.** Only 31–46 `belief_formed` events occurred in total per run, concentrated in the handful of NPCs on the surviving chain, before the lineage died out — there isn't enough history yet to say whether beliefs decay, compound, or drift sensibly across generations.
- **The engine/CLI has no early-exit on extinction.** All three runs spent 86–96% of their 60,000-tick, multi-minute wall-clock budget simulating an already-dead world (last birth at tick 2127–8268). This doesn't affect correctness, but it makes iterative calibration (the explicit follow-up this task defers) unnecessarily slow; worth flagging as an operational fix, separate from any parameter tuning.

## Explicitly out of scope for this task

No manifest or genome parameters were changed as a result of these runs. Population collapse is recorded here as a finding for the parameter-tuning follow-up to act on, per the plan's instruction not to tune in Task 11.
