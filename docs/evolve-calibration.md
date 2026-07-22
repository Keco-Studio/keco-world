# Evolve calibration runs

## Before: pre-seekMate baseline (Task 11, 2026-07-21)

**Date** 2026-07-21
**Command** `npm run evolve -- --seed <seed> --ticks 60000`, seeds `evo-1`, `evo-2`, `evo-3`
**World** `makeDemoManifest()` / `makeDemoRoster(seed)` — the same 25-NPC demo world used by `npm run sim`
**Purpose** First calibration pass for the genome-breeding + in-world reproduction system (Tasks 1–10), and pre-work for Living Worlds §17.1 step 7 (10-generation degradation check). Per the plan's self-review notes, **this task does not tune parameters** — reproduction/population-balance values in `makeDemoManifest()` are first guesses, and the outcome below is recorded as a finding, not fixed. This is the evidence that motivated the mate-seeking (`seekMate`) plan (`docs/superpowers/plans/2026-07-22-mate-seeking.md`) and the Task 5 sweep below.

### Results

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

### Observations (pre-seekMate)

All three seeds converge on the same outcome: **the demo world goes extinct.** Population is not stable — it heads monotonically to zero, and does so early: the last successful birth in any run lands at tick 2127–8268, i.e. within the first 3.5–14% of the 60,000-tick window, after which the world sits at population 0 for the remaining 50,000+ ticks with nothing left to observe. Deaths are dominated by `old_age` (66–77% of all deaths across the three runs), meaning most NPCs simply age past `elderAgeTicks` without ever reproducing — this is a birth-rate problem, not a survival (starvation/cold/wolf) problem. The arithmetic explains why: founders are spawned at a staggered age between `adultAgeTicks` (800) and `elderAgeTicks` (2400) (`birthTick = -(800 + rand[0,1600))`), so a founder's *average* remaining fertile window at tick 0 is only ~800 ticks, not the full 1600-tick span. Reproduction additionally requires two eligible NPCs to be Chebyshev-adjacent on the same tick (`reproductionStep` in `src/world/rules.ts`), and there is no mate-seeking behavior in the utility layer — NPCs forage, shelter, and explore, but never move *toward* a potential partner. Adjacency is therefore incidental, arising mostly from NPCs converging on the same bush or shelter, not from anything resembling courtship. Once two eligible NPCs are adjacent, the per-tick success chance (`birthChancePpm = 15000`, i.e. 1.5%) is high enough that sustained adjacency reliably produces a birth (expected failures to reach ~50% cumulative chance is ~46 adjacent ticks) — so the bottleneck is almost entirely *getting and staying adjacent while both parties are still fertile*, not the roll itself. This is consistent with what the birth logs show: in evo-2 (the longest-lived run, max generation 9), the entire late-run lineage is a single narrow chain alternating between two founder lineages (`npc-7` and `npc-9` descendants) — one fragile breeding pair carrying the whole population's future. When that chain's next link fails to form in time (a partner ages out, starves, or freezes before its next fertile encounter), the whole population collapses at once, since the other 23 founder lineages had already gone extinct earlier without ever producing a second generation. Belief formation (31–46 `belief_formed` events, 0.78–1.12 mean beliefs per NPC at end of run) and weight diversity (always 0.00, since the diversity metric requires ≥2 living NPCs) are both too sparse and too short-lived to say anything about cultural or genomic drift trends — the population dies before those systems accumulate enough history to evaluate.

Comparing against the DEC-4 pacing anchors in `docs/living-worlds.md` (§3: target NPC lifespan ≈ 60–90 sim-days, generational interval ≈ real 1–2 weeks, covering 2–4 generational turnovers per month of attention) is only possible qualitatively right now, because **the codebase has no tick-to-sim-day (or tick-to-real-time) conversion constant** — see Known Unknowns below. What we can say without that mapping: the demo manifest's fertile window (1600 ticks between `adultAgeTicks` and `elderAgeTicks`) is narrow relative to the 60,000-tick run length (≈2.6% of it), and the *effective* breeding population per generation collapses to 1–2 lineages almost immediately rather than the 25 the roster starts with — i.e. this manifest was evidently tuned for the Phase-0 single-life survival demo (Tasks 1–10's 25-NPC/session simulation), not for a self-sustaining multi-generational population, and nothing in the birth/aging parameters was chosen with generational turnover in mind. That is exactly the kind of "first guess, needs its own follow-up" the plan anticipated.

### Known unknowns as of this baseline (superseded — see refreshed list below)

- No tick↔sim-day↔real-day mapping exists in code.
- The demo manifest cannot sustain 10 generations (max observed: 2, 5, 9).
- "Never meet" vs. "meet but don't conceive" was not instrumented — inferred from birth-log timing only.
- Whether founder age-staggering is intentional pacing or an accidental headwind was unresolved.
- Weight diversity was untested as a signal (always 0.00 because `finalPopulation` was always 0).
- Belief/cultural-layer accumulation over multiple generations was unobserved.
- The engine/CLI has no early-exit on extinction (86–96% of wall-clock spent simulating an already-dead world).

### Explicitly out of scope for Task 11

No manifest or genome parameters were changed as a result of these runs. Population collapse was recorded here as a finding for the parameter-tuning follow-up (the mate-seeking plan, then this Task 5 sweep) to act on.

---

## After: Task 5 sweep with seekMate courtship active (2026-07-22)

**Date** 2026-07-22
**Command** `npm run evolve -- --seed <seed> --ticks 60000`, seeds `evo-1`, `evo-2`, `evo-3`, run once per swept `birthChancePpm` value
**World** Same `makeDemoManifest()` / `makeDemoRoster(seed)` demo world, now with the `seekMate` utility key live (Tasks 1–4 of the mate-seeking plan: schema key, `visibleNpcs`/`reproReady` observation, `seekMate` candidate generation, courtship-integration tests — `npm test` at 195/195 before this sweep started).
**Purpose** Task 5 of `docs/superpowers/plans/2026-07-22-mate-seeking.md`: with courtship-driven adjacency now live, check whether the demo world can sustain a population under the success gate (≥2 of 3 seeds: no extinction, final population ∈ [10, 60], maxGeneration ≥ 8), sweeping `birthChancePpm` if the current value (15,000) doesn't clear the gate.

### Sweep methodology and order

Per the plan: start at the current demo value (15,000 ppm). If undershooting (extinction, no cap-pinning), sweep UP through {50,000, 100,000} ppm, one value at a time, rerunning all 3 seeds per value. Only sweep DOWN {10,000, 5,000} if the *opposite* failure mode is observed (population pinned at the 60-NPC cap with mass starvation). All three values below were run in full; every run's summary was recorded before its `runs/evolve-evo-*` directory was deleted (per the plan, calibration artifacts are not committed).

### birthChancePpm = 15,000 (current demo value, seekMate active)

| Metric | evo-1 | evo-2 | evo-3 |
|---|---|---|---|
| Final population | 0 | 0 | 0 |
| Total births | 28 | 44 | 35 |
| Deaths — old_age | 35 | 48 | 42 |
| Deaths — starvation | 4 | 0 | 8 |
| Deaths — cold | 14 | 18 | 9 |
| Deaths — wolf | 0 | 3 | 1 |
| Total deaths | 53 | 69 | 60 |
| Max generation reached | 4 | 11 | 9 |
| Living lineages | 0/25 | 0/25 | 0/25 |
| Beliefs held (end of run) | 49 | 64 | 65 |
| Mean beliefs/NPC (×100) | 92 | 92 | 108 |
| Belief-formed events | 41 | 47 | 42 |
| Weight diversity (×100) | 0 | 0 | 0 |
| **Gate pass?** | No (extinct) | No (extinct) | No (extinct) |

**0/3 seeds pass.** All extinct, but a clear improvement over pre-seekMate: births roughly doubled (16/22/11 → 28/44/35) and maxGeneration roughly doubled (5/9/2 → 4/11/9). This is undershooting per the gate, so the plan calls for sweeping UP.

### birthChancePpm = 50,000

| Metric | evo-1 | evo-2 | evo-3 |
|---|---|---|---|
| Final population | 0 | 0 | 0 |
| Total births | 115 | 85 | 69 |
| Deaths — old_age | 101 | 76 | 70 |
| Deaths — starvation | 10 | 7 | 3 |
| Deaths — cold | 29 | 27 | 20 |
| Deaths — wolf | 0 | 0 | 1 |
| Total deaths | 140 | 110 | 94 |
| Max generation reached | 18 | 17 | 20 |
| Living lineages | 0/25 | 0/25 | 0/25 |
| Beliefs held (end of run) | 149 | 108 | 102 |
| Mean beliefs/NPC (×100) | 106 | 98 | 108 |
| Belief-formed events | 103 | 82 | 67 |
| Weight diversity (×100) | 0 | 0 | 0 |
| **Gate pass?** | No (extinct) | No (extinct) | No (extinct) |

**0/3 seeds pass.** Births and maxGeneration jump substantially again (up to 4x and 2x the 15,000-ppm run respectively), but every seed still ends at population 0.

### birthChancePpm = 100,000

| Metric | evo-1 | evo-2 | evo-3 |
|---|---|---|---|
| Final population | 0 | 0 | 0 |
| Total births | 103 | 90 | 150 |
| Deaths — old_age | 94 | 80 | 119 |
| Deaths — starvation | 5 | 7 | 7 |
| Deaths — cold | 26 | 28 | 41 |
| Deaths — wolf | 3 | 0 | 8 |
| Total deaths | 128 | 115 | 175 |
| Max generation reached | 20 | 24 | 22 |
| Living lineages | 0/25 | 0/25 | 0/25 |
| Beliefs held (end of run) | 126 | 121 | 199 |
| Mean beliefs/NPC (×100) | 98 | 105 | 113 |
| Belief-formed events | 82 | 92 | 97 |
| Weight diversity (×100) | 0 | 0 | 0 |
| **Gate pass?** | No (extinct) | No (extinct) | No (extinct) |

**0/3 seeds pass.** At 100,000 ppm (a 10% birth chance per tick for an adjacent, eligible pair — nearly 7x the original value), total births and maxGeneration are similar to or only marginally better than 50,000 ppm (not a clean monotonic improvement: evo-1 births actually *dropped* from 115 to 103), and the population still collapses to zero in all three seeds. This is the signature of diminishing/plateaued returns from the birth-chance roll itself — the sweep has stopped moving the outcome.

For evo-1 @ 100,000 ppm, the tail of `births.jsonl` was inspected before deletion: the last five births (ticks 18876–20917, generations 18–20) all share `lineageId: "npc-14"`, i.e. the population has narrowed to a single breeding chain by generation 18, exactly the failure mode observed in the pre-seekMate baseline. The last birth in that run lands at tick 20917 (35% into the 60,000-tick window) — later than the pre-seekMate baseline's 2127–8268, but the population still runs out of road once that one remaining chain's next link fails to form before the partner ages out.

### Gate result table (value × seed: final population / total births / max generation)

| birthChancePpm | evo-1 | evo-2 | evo-3 | Seeds passing gate |
|---|---|---|---|---|
| 15,000 (baseline) | 0 / 28 / 4 | 0 / 44 / 11 | 0 / 35 / 9 | 0/3 |
| 50,000 | 0 / 115 / 18 | 0 / 85 / 17 | 0 / 69 / 20 | 0/3 |
| 100,000 | 0 / 103 / 20 | 0 / 90 / 24 | 0 / 150 / 22 | 0/3 |

No swept value reaches the required ≥2/3 seeds. The DOWN sweep {10,000, 5,000} was **not** triggered: the overshoot failure mode (population pinned at the 60-NPC cap with mass starvation) never appeared — `maxPopulation` (60) was never approached in any of the 9 runs above (highest final-population-before-collapse was well under the cap at every observed point in every run).

### Chosen parameter and rationale

**`birthChancePpm` stays at 15,000** — `src/cli/demo.ts` is unchanged from before this sweep (verified via `git diff`, no diff). Rationale: none of the three swept values (15,000 / 50,000 / 100,000) clears the gate, and the trend from 50,000 → 100,000 shows diminishing and inconsistent returns (evo-1 births went *down*), which means the birth-chance roll is no longer the limiting factor at higher values — the population is failing for a different, structural reason (see below). Moving the demo default to 50,000 or 100,000 would not fix sustainability, would make the reproduction roll unrealistically high (100,000 ppm = 10% chance per tick for any adjacent eligible pair, compounding every tick they stay adjacent), and is not supported by any of the three runs at that value. Since no candidate value is actually better on the metric that matters (sustained population), the honest choice is to leave the parameter at its pre-sweep value rather than pick an arbitrary "least-bad" number that still fails the gate.

### Generation-turnover observations vs. DEC-4 anchors (`docs/living-worlds.md`)

- **Empirical NPC lifespan under the demo manifest is ~2400–3400 ticks**, not directly configured but derivable from the aging model: `elderAgeTicks = 2400` is when `senescenceHpDrain` (2 HP/tick) starts being applied on top of `maxHp = 1000`; an unfed elder loses net 2 HP/tick and dies ~500 ticks later (~tick 2900), while a fed elder gets `hpRegenPerTick = 1` back whenever `energy ≥ hpRegenEnergyMin (500)`, netting -1 HP/tick and surviving up to ~1000 ticks past `elderAgeTicks` (~tick 3400). This matches the `lifespan ~2400-3400 ticks` anchor and is consistent with `old_age` being the dominant death cause (66–94% of deaths) across every run in both the before and after tables.
- **Measured generation interval** (from the retained 15,000-ppm/evo-1 run, `births.jsonl` first-appearance tick per generation): gen 1 @ tick 24, gen 2 @ tick 908, gen 3 @ tick 1749, gen 4 @ tick 3345 → successive intervals of 884, 841, 1596 ticks (mean ≈ 1107 ticks). This is a single-seed, small-sample measurement (only 4 generations reached before the population's last birth at tick 4094), so treat it as indicative, not definitive.
- **DEC-4 anchors** (`docs/living-worlds.md` §3, lines 104–106): 1 real day ≈ 4 sim-days (with nighttime slowdown to 2); NPC target lifespan ≈ 60–90 sim-days (→ real 2–3 weeks); generational interval ≈ real 1–2 weeks (2–4 turnovers per month of attention). No formal tick↔sim-day constant exists in code (this known-unknown persists — see below), but if we provisionally back-derive one from the lifespan match above (2400–3400 ticks ≈ 60–90 sim-days ⇒ roughly 30–40 ticks/sim-day), the measured ~841–1596-tick generation interval maps to roughly 21–53 sim-days ≈ 5–13 real days — in the right *order of magnitude* as DEC-4's "1–2 real weeks" anchor.
- **The pacing looks plausible; the population dynamics do not.** Per-generation timing is roughly compatible with the DEC-4 anchors when the mapping above is applied, but this is moot in practice: the population that produced this timing data goes extinct after its 4th generation (last birth at tick 4094, well within a single elder lifespan of the run's start). Higher birthChancePpm extends this — up to generation 20–24 and last-birth ticks in the 15,000–20,000+ range — but always still collapses to zero before 60,000 ticks. The bottleneck is not tick-rate/pacing; it's that the *breeding population* (distinct concurrent lineages, not total births) contracts to a single fragile chain within the first several generations regardless of birthChancePpm, and that chain eventually breaks.

### Success gate verdict

**FAILED.** The gate (≥2 of 3 seeds: no extinction, final population ∈ [10, 60], maxGeneration ≥ 8) did not pass at any of the three swept `birthChancePpm` values (15,000 / 50,000 / 100,000); 0/3 seeds passed at every value tested. Per the plan's Step 3 instruction, no new mechanism was invented to force a pass — this is recorded as an honest failure for the controller to escalate.

### Why seekMate alone (+ any birthChancePpm) can't clear the gate

seekMate courtship works as designed — it measurably increases adjacency and therefore both total births (up to ~5x baseline) and maxGeneration (up to ~5x baseline) across the sweep. But it does not change the structural failure mode identified in the pre-seekMate baseline: the population's *effective breeding pool* still contracts from 25 founder lineages down to a single narrow chain within the first handful of generations (confirmed again in the 100,000-ppm/evo-1 `births.jsonl` tail: generations 18–20 are all one lineage, `npc-14`). Once that sole surviving chain's current fertile pair fails to reconnect before one partner ages past `elderAgeTicks`, starves, freezes, or drifts apart, the entire population dies simultaneously — because every other founder lineage already went extinct earlier without ever reaching a second generation. Raising `birthChancePpm` makes each individual reproduction *roll* more likely to succeed once a pair is adjacent and both are still fertile, and courtship (seekMate) makes adjacency itself more likely — both push the same lever (the last chain lives longer, deeper into generations) but neither addresses *why* only one chain out of 25 founder lineages ever becomes self-sustaining in the first place. That is a lineage-diversity / concurrent-pairing problem, not a per-roll-probability problem, and is out of this task's scope (birthChancePpm sweep only) per the plan's self-review notes on scope honesty.

### Known unknowns for §17.1 step 7 (refreshed, 2026-07-22)

- **`birthChancePpm` is now experimentally ruled out as the sole lever**, not just inferred. All three swept values (15,000 / 50,000 / 100,000 ppm) were run to completion across 3 seeds each (9 runs total) and every one ends in extinction. A future calibration pass should not re-sweep this parameter alone; it needs a mechanism that increases the number of *concurrently viable* breeding lineages, not just the odds or frequency of any single roll.
- **The single-narrow-chain collapse pattern is now confirmed twice** (pre-seekMate baseline and this sweep, including under seekMate at 100,000 ppm) — this looks like the actual root cause, not an artifact of low adjacency alone. Candidate mechanisms for a follow-up plan (none implemented or endorsed here): allowing/encouraging multiple concurrent breeding pairs rather than one dominant chain, migration or lower `reproEnergyMin`/`reproCooldownTicks` to let more of the original founder lineages reach a second generation before the population narrows, or an explicitly non-demo manifest sized/tuned for sustained multi-generational play rather than the Phase-0 25-NPC/session demo.
- **No tick↔sim-day↔real-day mapping exists formally in code** — still true. This document now offers a *provisional, non-authoritative* back-derived estimate (~30–40 ticks/sim-day, from matching the observed 2400–3400-tick lifespan to DEC-4's 60–90-sim-day target) for qualitative comparison only; it has not been validated against any independent source and should not be treated as an agreed constant.
- **`maxPopulation` (60) and the cap-pinning/mass-starvation failure mode were never observed** across any of the 9 sweep runs — the DOWN-sweep branch {10,000, 5,000} of the plan was correctly never triggered. This confirms the demo world's problem is population *contraction*, not overshoot, at every birthChancePpm value tested so far.
- **Weight diversity (`weightDiversity100`) remains untested as a signal** — still 0.00 in all 9 new runs (as in the original 3), since the metric requires ≥2 living NPCs and `finalPopulation` was 0 in every run.
- **Belief/cultural-layer accumulation over many generations is still unobserved** for a genuinely surviving population — belief counts scale with total births (up to 199 beliefs held, 97 formed events at 100,000 ppm/evo-3) but the population that generated them still dies, so multi-generation cultural drift trends remain unmeasured.
- **Whether founder age-staggering (`birthTick = -(800 + rand[0,1600))`) is a meaningful headwind is now lower-priority to investigate in isolation** — even a 4–5x increase in early-cohort births and maxGeneration (via seekMate + higher birthChancePpm) does not prevent eventual collapse, so age-staggering is very unlikely to be the dominant lever; not tested directly in this task.
- **The engine/CLI still has no early-exit on extinction.** Lower priority than in the pre-seekMate baseline, since `evolve` runs are local/deterministic (no LLM calls) and complete in low single-digit minutes even at 60,000 ticks; still worth fixing for iterative calibration convenience.

### Explicitly out of scope for Task 5

Per the plan's Step 3 and the self-review notes on scope honesty: this task swept `birthChancePpm` only, exactly as scoped, and did not implement any new reproduction/adjacency mechanism (migration, multi-pair concurrency, lowered `reproEnergyMin`/`reproCooldownTicks`, non-demo manifest, etc.) to force a gate pass. The gate FAILED after the full prescribed sweep. This is recorded here as the honest outcome for the controller to escalate into a new, explicitly-scoped follow-up plan.

---

## Task 5b: replacement-rate diagnosis and sustainable demo-world parameters (2026-07-22)

**Date** 2026-07-22
**Purpose** Test the follow-up hypothesis Task 5 left open — that the demo world's lifetime reproduction budget is below replacement (`reproCooldownTicks = 600` against a 1600-tick fertile window caps each NPC to ~2–3 lifetime births, and with child mortality that nets out below sustainability) — with an in-process diagnostic script (throwaway, not committed), then run a targeted parameter sweep guided by the result.
**World** Same `makeDemoManifest()` / `makeDemoRoster(seed)` demo world, `birthChancePpm` at the pre-Task-5b default (15,000, i.e. before this task's parameter change) for the diagnostic phase.
**Method** `runSim` invoked directly (not via the `evolve` CLI) for the diagnostic phase, 3 seeds (`diag-1`, `diag-2`, `diag-3`) × 60,000 ticks, instrumented to compute per-NPC lifetime birth counts, survival-to-adulthood rate, deaths by cause × age band, inter-birth intervals, and a population-count trajectory reconstructed from the birth/death event log. All figures below are from that instrumentation; the script was deleted after this write-up per the "calibration artifacts are not committed" convention.

### Phase 1 — Diagnostic results (current demo params: `reproCooldownTicks=600`, `reproEnergyMin=600`, `birthChancePpm=15,000`, `childStartHp/Energy=600`)

| Metric | diag-1 | diag-2 | diag-3 |
|---|---|---|---|
| Final population | 0 | 0 | 0 |
| Children born | 53 | 50 | 63 |
| Children surviving to `adultAgeTicks` (800) | 45 | 43 | 58 |
| Survival-to-adulthood rate | 84.9% | 86.0% | 92.1% |
| Adults-ever (founders + children who reached age ≥800 at some point) | 70 | 68 | 83 |
| NPCs that completed the full fertile window (reached age ≥2400) | 46 | 51 | 67 |
| Mean lifetime births, NPCs completing fertile window (mean / median / max) | 1.87 / 2 / 3 | 1.67 / 2 / 3 | 1.67 / 2 / 3 |
| Mean lifetime births, all adults-ever (mean / median / max) | 1.51 / 2 / 3 | 1.47 / 1 / 3 | 1.52 / 2 / 3 |
| Birth-count histogram (adults-ever): 0 / 1 / 2 / 3 / 4+ | 10 / 22 / 30 / 8 / 0 | 8 / 27 / 26 / 7 / 0 | 10 / 28 / 37 / 8 / 0 |
| Mean inter-birth interval per parent (ticks; cooldown = 600) | 795.5 | 751.2 | 770.3 |
| **Births-per-adult-lifetime** (2×births / adults-ever) | 1.514 | 1.471 | 1.518 |
| **Net replacement rate** (births-per-adult-lifetime × survival-to-adulthood) | **1.286** | **1.265** | **1.398** |
| Deaths — old_age (all elder-band) | 46 | 51 | 67 |
| Deaths — cold (adult / juvenile) | 20 / 6 | 13 / 4 | 15 / 3 |
| Deaths — starvation (adult / juvenile) | 4 / 1 | 4 / 2 | 1 / 2 |
| Deaths — wolf (juvenile) | 1 | 1 | 0 |
| Last birth tick / population-extinct tick | 8276 / 10255 | 13388 / 16003 | 12874 / 15744 |

**Aggregate replacement arithmetic**: births-per-adult-lifetime ≈ **1.50**, survival-to-adulthood ≈ **87.7%**, **net replacement rate ≈ 1.32** — i.e. **the mean-field arithmetic is comfortably above the 1.0 sustainability threshold**, not below it. This directly **refutes** the stated hypothesis: an average adult that lives out its fertile life produces ~1.5 births (in a system where each birth consumes two parent-slots), and with ~88% of those children surviving to adulthood, the long-run expected number of self-replacing offspring per adult is ~1.3, not <1.

Additional evidence against the "cooldown-capped budget" framing specifically: the **mean inter-birth interval per parent (751–796 ticks) already exceeds `reproCooldownTicks` (600) by ~150–195 ticks** in every seed — i.e. cooldown is not the saturated/binding constraint on how often a parent reproduces; the gap between successive births is dominated by time-to-next-successful-pairing (adjacency + the `birthChancePpm` roll), not by the cooldown timer expiring. This is consistent with Task 5's finding that `birthChancePpm` alone (15k/50k/100k) could not fix extinction — the bottleneck was never purely "the roll" or purely "the cooldown."

**So why does every seed still go extinct if the average math is sustainable?** The reconstructed population trajectory (alive-count every 2000 ticks) explains it:

- diag-1: `17, 13, 15, 4, 1, 0, 0, …` (extinct tick 10255)
- diag-2: `18, 9, 5, 3, 4, 4, 3, 1, 0, …` (extinct tick 16003)
- diag-3: `21, 12, 10, 7, 8, 5, 4, 0, …` (extinct tick 15744)

Population **peaks at the founder count (25, tick 0) and then declines monotonically in every seed** — it never grows, even transiently, despite the >1.0 mean replacement rate. Two compounding structural effects explain the gap between the mean-field math and the observed monotonic collapse:

1. **Founder age-staggering front-loads the die-off.** `birthTick = -(adultAgeTicks + rand[0, elderAgeTicks - adultAgeTicks))` means founders start with an *average* remaining fertile window of only ~800 of the full 1600 ticks (some start already at the edge of `elderAgeTicks` and are one unlucky mate-search away from aging out having never reproduced — the birth-count histogram's "0 births" bucket, 8–10 of ~68–83 adults-ever per seed, is largely this group). Founders begin dying of old age within the first ~2000–3400 ticks, in a synchronized wave, while the *first* native-born cohort needs a full 800 ticks just to reach adulthood itself before it can contribute to reproduction — a generational-lag deficit between the founder die-off and the replacement cohort's maturation.
2. **Once population falls into the single digits (every seed, by tick ~4000–8000), demographic stochasticity dominates the mean.** A population-average net replacement rate of 1.3 describes the expected trajectory of a large population; at N=3–5 individuals, the variance around that mean is large relative to the mean itself, and extinction (population 0) is an **absorbing state** — there is no immigration or spontaneous generation to recover from a bad run of luck (a mate search that fails right before a partner ages out, a cold-season death removing the only fertile pair, etc.). Every seed's trajectory shows small rebounds (e.g. diag-2's `3, 4, 4, 3`) before eventually hitting the absorbing zero — consistent with a minimum-viable-population bottleneck, not a mean-arithmetic shortfall. This matches (and gives a quantitative mechanism for) Task 5's qualitative "single narrow chain" observation.

**Conclusion for Phase 2**: the originally-stated hypothesis (reproduction budget below replacement) is not supported by the data. The real lever is **throughput during the early bottleneck window** — anything that lets more founders reproduce at least once before their remaining fertile window runs out, and/or builds population size faster before it falls into the stochastic-collapse zone, should help even though it isn't fixing a mean-arithmetic deficit that doesn't actually exist.

### Phase 2 — Targeted sweep

Per the diagnosis, `reproCooldownTicks` was identified as *not* the saturated constraint (actual inter-birth intervals already exceed it), but reducing it further still increases the theoretical ceiling on reproduction attempts per fertile window and was the prescribed "most promising single change" to try first. `birthChancePpm` was set to 50,000 (middle of the Task-5-tested 15k–100k range that showed real, if insufficient on its own, improvement) as backdrop for all Phase 2 attempts, held fixed while `reproCooldownTicks`/`reproEnergyMin`/`childStartHp`/`childStartEnergy` were varied.

**Attempt 1 (first and only attempt needed): `reproCooldownTicks: 600 → 200`, `birthChancePpm: 15,000 → 50,000`, `reproEnergyMin` and `childStartHp`/`childStartEnergy` left unchanged.**

Run via `npm run evolve -- --seed <seed> --ticks 60000`, seeds `evo-1`/`evo-2`/`evo-3` (same seeds as Task 5, for direct comparability):

| Metric | evo-1 | evo-2 | evo-3 |
|---|---|---|---|
| Final population | 24 | 15 | 22 |
| Total births | 1170 | 1066 | 1008 |
| Deaths — old_age | 289 | 271 | 268 |
| Deaths — cold | 424 | 395 | 400 |
| Deaths — starvation | 428 | 369 | 307 |
| Deaths — wolf | 30 | 41 | 36 |
| Max generation reached | 59 | 62 | 58 |
| Mean generation (alive) | 57.58 | 60.80 | 56.68 |
| Living lineages | 1/25 | 1/25 | 1/25 |
| Beliefs held (mean/NPC) | 1734 (1.45) | 1797 (1.64) | 1605 (1.55) |
| Beliefs formed | 879 | 900 | 826 |
| Weight diversity | 90.56 | 95.10 | 94.35 |
| **Gate pass?** (no extinction, final pop ∈ [10,60], maxGen ≥ 8) | **Yes** | **Yes** | **Yes** |

**3/3 seeds pass.** Final populations (15–24) sit comfortably inside `[10, 60]` — well clear of both extinction and the 60-NPC cap (no cap-pinning/mass-starvation signature observed) — and max generation (58–62) is far above the ≥8 threshold. No second attempt or dimension combination was needed; the sweep stopped after Attempt 1 per the plan's "stop as soon as a config passes" instruction.

**Interesting residual pattern**: living lineages is 1/25 in all three seeds — i.e. the same single-narrow-chain dynamic identified in Task 5 (and explained mechanistically in Phase 1 above) still occurs; only one of the 25 founder lineages survives long-term in each run. What changed is not the *dominance pattern* but its **stochastic robustness**: at this throughput, the one surviving lineage's reproduction rate is high enough (1000+ total births per run, vs. 28–150 pre-sweep) to reliably escape the early bottleneck and sustain a stable population (15–24 NPCs) for the rest of the 60,000-tick run instead of eventually hitting the tick where the single remaining chain's next link fails to form. Fixing the lineage-diversity pattern itself (getting more than 1 of 25 founder lineages to survive long-term) remains unaddressed and would need mechanism-level work (e.g. reducing founder age-staggering variance, or migration/multi-pair-concurrency) — out of scope for this parameter-only sweep, consistent with Task 5's scope notes.

### Chosen parameters and rationale

`src/cli/demo.ts` (`makeDemoManifest()`) changed:

```
reproCooldownTicks: 600 → 200
birthChancePpm:     15,000 → 50,000
```

(`reproEnergyMin`, `childStartHp`, `childStartEnergy` left at their prior values — 600/600/600 — since Attempt 1 already cleared the gate and no further dimensions needed testing.)

### Success gate verdict

**PASSED.** The gate (≥2 of 3 seeds: no extinction, final population ∈ [10, 60], maxGeneration ≥ 8) passed on **3/3 seeds** at `reproCooldownTicks=200` / `birthChancePpm=50,000`, on the first Phase 2 attempt.

### Known unknowns refreshed after Task 5b

- **The "reproduction budget below replacement" hypothesis is now experimentally refuted** for the pre-Task-5b parameters: mean-field net replacement rate was ≈1.32, above the 1.0 threshold, computed directly from births-per-adult-lifetime × survival-to-adulthood across 3 seeds. The actual failure mode was a founder-age-staggering-driven early bottleneck combined with small-population demographic stochasticity (extinction as an absorbing state), not an insufficient average lifetime birth count.
- **The single-narrow-chain / low-lineage-diversity pattern persists even after the gate passes** (1/25 living lineages in all three post-sweep runs) — it no longer causes extinction at this throughput, but it means the demo world's genetic/cultural diversity is still concentrated in one lineage, not spread across founders. A future task aimed at lineage diversity (rather than bare survival) would need a different, explicitly-scoped mechanism (e.g. reduced founder age-staggering variance, migration, or multi-pair concurrency), per Task 5's original candidate list.
- **`reproCooldownTicks` was confirmed non-saturated pre-sweep** (mean inter-birth interval exceeded the cooldown by ~150–195 ticks) yet reducing it further still helped — most plausibly by raising the *ceiling* on reproduction attempts during the critical early-bottleneck ticks for the few NPCs that do successfully pair repeatedly, rather than by relieving a binding constraint on the population average.
- **`reproEnergyMin` and `childStartHp`/`childStartEnergy` were not tested** in this task, since Attempt 1 already passed. If a future change to `reproCooldownTicks`/`birthChancePpm` needs to be reverted or tuned differently, these remain untried levers per Phase 1's juvenile-mortality data (survival-to-adulthood was already 85–92% pre-sweep, so their expected marginal effect is smaller than the throughput levers that were tried).

---

## 行为漂移初测 (2026-07-22)

**Date** 2026-07-22
**Command** `npm run behavior -- --seed evo-1 --ticks 60000` (fresh rerun for this paragraph; report copied to `docs/examples/behavior-evo1.json`), plus `npm run biography -- --seed evo-1 --ticks 60000 --top 2` (best biography copied to `docs/examples/biography-evo1-Garen.md`)
**World** Same `makeDemoManifest()` / `makeDemoRoster("evo-1")` demo world as the calibration runs above, post-Task-5b parameters (`reproCooldownTicks=200`, `birthChancePpm=50,000`).
**Purpose** First measurement of the founders-vs-evolved behavioral distance instruments built in this plan (Tasks 1–7): fixed-scenario verb histograms, n-gram profiles, per-key proportion shifts, and disagreement rate, applied to a real 60,000-tick evo-1 run (25 founders, max generation 59, 24 alive at the end) rather than the small unit-test worlds.

**Headline numbers (actuals from the fresh rerun above, `docs/examples/behavior-evo1.json`):**

| Metric | Value |
|---|---|
| verbL1 (founders vs. evolved, pooled) | 0.6562 |
| disagreementRate | 25.8% (0.2581) |
| bigramL1 | 0.7986 |
| Top key shift #1 | `idle` +0.3030 |
| Top key shift #2 | `explore` −0.2877 |
| Top key shift #3 | `shelter` −0.0379 |
| Intra-founder diversity (mean pairwise verbL1) | 0.3689 |
| Intra-evolved diversity (mean pairwise verbL1) | 0.4711 |
| Cross distance (founders × evolved, mean pairwise verbL1) | 0.8694 |

These match the plan's stated headline figures (verbL1 0.656, disagreementRate 25.8%, evolved intra-diversity 0.471 vs. founders 0.369) to the precision given. The dominant behavioral shift across the 31 fixed scenarios is founders-to-evolved substituting `explore` for `idle` — evolved genomes are noticeably less exploratory and more prone to standing still than their founders, consistent with the `explore` weight drift narrated in the Garen-lineage biography's closing paragraph ("更疏于远行"). Evolved NPCs also disagree with founders on the modal first-decision verb in just over a quarter of scenarios (25.8%), and are themselves more behaviorally diverse from each other (intra-evolved 0.471) than founders were from each other (intra-founder 0.369) — i.e. 59 generations of drift under in-world selection produced both a population-level shift (toward idling, away from exploring) and increased within-population spread, not convergence to a single optimum.

**Status: 初测, not a validated novelty gate.** This is a single-seed (evo-1), single-run measurement with no preregistration, no statistical comparison against a Fixed-Utility/Handcrafted baseline of the same size, and no effect-size/significance testing — exactly the kind of first look the plan's self-review notes flag as distinct from 1C's preregistered primary-endpoint gate (§6.7, effect size ≥0.62, Holm–Bonferroni correction, 150–200 judgments). These numbers establish that the instruments run end-to-end on a real, richly-evolved world and produce plausible, non-degenerate output; they do not establish that 59 generations of drift constitute meaningful behavioral novelty by any calibrated threshold.

**Known gaps to address:**

1. 创始人基因组 beliefs 为空、进化基因组携带一生累积的信念——0.656 的距离混合了可遗传漂移与信念累积两种机制（进化组内部多样性 0.471 高于创始组 0.369、且 24/25 存活个体同出一脉，提示信念异质性贡献显著）；1C 预注册前须补做"信念清零"对照变体，才能把该数字当作基因组新颖性。

2. 传记长度上限按时间顺序截断（Garen 传记 59 代仅展示前 4 代，结语宣称的漂移正文未呈现）——1C 成对偏好测试前必须改为跨代分层采样。

**Known gap carried forward:** §6.7's 行为新颖性 instrument list includes 状态访问分布 ("state-visit distribution") alongside action-distribution distance and n-grams. This plan implements the latter two (verb histograms, n-gram profiles) but does not implement state-visit-distribution tracking — that requires position/state-trace instrumentation through the scenario evaluator (`src/scenarios/`) that was out of scope for Tasks 1–7. It remains a deliberately deferred gap, not an oversight, per the plan's Task 7 self-review note.
