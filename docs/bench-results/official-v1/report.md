# Deliberation Benchmark Report

- started: 2026-07-21T16:07:11.082Z
- prompt version: bench-v1
- params: seeds 8, ticks 800, epsilon 60, horizon 100, cap/seed 200, timeout 30000ms
- triggers harvested: 1600

**Preregistered gate:** a model shows gain iff win-rate over decisive divergent trials ≥ 0.55 AND the Wilson 95% lower bound > 0.50.
**MDE note:** at n=300 decisive trials this design has ~80% power to detect a true rate of ~0.58; detecting 0.55 needs n≈780. Verdicts on smaller n are correspondingly weaker evidence.

| model | trials | fail | agree | divergent | W/L/T | win rate | 95% CI | p50 ms | p95 ms | tok in/out | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| qwen3:0.6b | 1600 | 0 | 23.2% | 1229 | 327/412/490 | 44.2% | 0.41–0.48 | 544 | 681 | 248/51 | no-gain |
| qwen3:1.7b | 1600 | 0 | 22.1% | 1246 | 331/415/500 | 44.4% | 0.41–0.48 | 703 | 859 | 248/34 | no-gain |
| qwen3:4b | 1600 | 0 | 20.4% | 1274 | 339/456/479 | 42.6% | 0.39–0.46 | 1497 | 1856 | 242/42 | no-gain |
| random-control | 1600 | 0 | 5.7% | 1509 | 447/382/680 | 53.9% | 0.51–0.57 | 0 | 0 | 0/0 | no-gain |

Branch guidance (v0.5 §18 P0): all models no-gain → **B0**; gain but over budget → **B±**; gain within budget → **B+**. The random-control row is the sanity floor — any model at or below it is unambiguous no-gain.
