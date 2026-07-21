# 审议增益判定：预注册方案 v1

对应 living-worlds-v0.5.md §18 P0 第一条。本文件冻结判定参数；官方运行开始后不得修改。
修改需发布 v2 并重新运行。

## 固定参数（官方运行前冻结）

| 参数 | 值 | 说明 |
|---|---|---|
| 模型 | qwen3:0.6b / qwen3:1.7b / qwen3:4b | Ollama，temperature 0，think:false |
| 运行时 | Ollama（DeliberationRuntime 接口，llama.cpp 对照留待有增益后） |
| 世界 | makeDemoManifest()，roster seed "bench-roster" |
| seeds | bench-1 … bench-8 |
| ticks/seed | 800（2 个完整季节） |
| epsilon | 校准后填入：＿＿（用 --harvest-only 校准，目标 ≥1500 总触发；校准只看数量分布，不看任何 LLM 结果） |
| horizon H | 100 tick |
| margin | alive ? 10000 + hp + energy + 100×berries : (deathTick − triggerTick) |
| 超时 | 30000 ms（超时/非法输出计为 failure，不进胜负） |
| prompt | bench-v1（候选顺序按 trigger id 确定性洗牌；不泄露效用分数） |

## 判定规则

- 只统计**分歧试验**（LLM 选择 ≠ 效用层最优，按动作值相等判定）。
- 胜负由影子 rollout margin 严格比较；平局报告但不入二项检验。
- **增益判定**：decisive（胜+负）≥ 300，且 win rate ≥ 0.55，且 Wilson 95% 下界 > 0.50。
- decisive < 300 → insufficient-n（不下结论，扩 seeds/cap 重跑）。
- random-control 臂为下限对照：模型不显著优于它 → 明确 no-gain。

## 功效声明（诚实版）

n=300 decisive：80% 功效可检出真实胜率 ~0.58；检出 0.55 需 n≈780。
若结果落在 [0.52, 0.58] 且 CI 含 0.50，结论是"未证明增益"而非"证明无增益"。

## 分支决策（v0.5 §18）

- 所有尺寸 no-gain → **B0**：审议层移除，换人格加权确定性决胜；LLM 收缩为表现层。
- 某尺寸 gain 但成本超预算（40k token/sim-day 折算或 p95 延迟不可接受）→ **B±**：审议只留出生/濒死/初遇。
- gain 且预算内 → **B+**：维持三层设计。

## 已知限制

- 世界为 Phase 0 内核：无社交、无繁殖，候选集偏简单。结论只约束"结构化候选裁决"能力，不外推到 Phase 1 全场景。
- rollout 为单确定性分支（K=1）：世界确定性使同 seed 重复无意义；统计功效来自场景多样性（N 大）而非 K。
- Ollama 单运行时：6.3 的双运行时对比在增益成立后补做。
