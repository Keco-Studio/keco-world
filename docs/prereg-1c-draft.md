# 1C 正式验证：预注册方案 v2 —— 草案

> **状态：草案（DRAFT）。未冻结，不约束任何运行。**
> 冻结条件（全部满足后由项目所有者签字冻结，改为 prereg-1c-v2.md 并在 §17.1/§18 登记）：
> 1. 项目所有者审定本方案全部参数（尤其"待拍板"清单）；
> 2. 运行与分析代码全部落库（见 §9 交付物清单）并通过评审；
> 3. 形成性小样（非官方 seed）跑通全流程。
> 冻结后按 §6.7 预注册纪律执行：改任何终点/阈值/抽取规则 = 发布 v3 + 换新 seed 组。

对应 living-worlds.md §17.1 步骤 9、§6.7 三轴成功闸门、§16 阶段 1C。
本方案整合四项已记录的 1C 前置修正：信念累积混淆对照（evolve-calibration.md）、传记跨代分层采样（同上）、epsilon 臂政策（baseline-arms.md 发现 2）、D3 窗口化判据（degradation-check.md）。

---

## 1. 实验臂与规模

| 臂 | 配置（makeArmSetup / cognition） | seeds | 用途 |
|---|---|---|---|
| Random | random / clone / off | 12 | sanity 下限（预期灭绝，见 baseline-arms.md） |
| Fixed Utility | utility / clone / off，epsilon=0 | 12 | 无进化基线（与 Evolutionary 同创始分布） |
| Handcrafted | utility / clone / off，设计 epsilon 0–150 | 12 | 人工内容基线（25 原型 + 20 规则，工时已记录） |
| Evolutionary | utility / breed / on | 12 | 处理组 |
| Evo-NoCulture | utility / breed / **off** | 12 | 信念清零对照（§6.6 文化消融子臂；归因分析用，不投闸门票） |

- 每 seed 运行 **50_000 tick**（观测换算：15k tick ≈ 15–16 代 → 50k ≈ 50+ 代），chunk=1000 分块链（哈希等价已测试钉死）。
- 世界：`makeDemoManifest()`（与全部校准/退化记录同一世界，参数不动）。
- 官方 seeds（冻结命名）：`c1-<arm>-1` … `c1-<arm>-12`，arm ∈ {random, fixed, handcrafted, evolutionary, noculture}。
- 形成性/试跑一律使用 `pilot-` 前缀 seed，与官方 seed 空间不相交。
- 预算估算：按退化检查实测速率折算 ≈ 6–8 小时本机计算（可过夜、可断点续跑——runner 须支持按 seed 粒度续跑）。

## 2. 生存稳定性硬闸门（S 组，全部必须过）

沿用退化检查 D1–D5，按其发现修订：

- **S1 存续**：Random 臂除外的每臂 ≥10/12 seed 存活至 50k tick 且 maxGeneration ≥ 50（Evolutionary/NoCulture 臂）；Fixed/Handcrafted 臂免 maxGen 要求（clone 遗传的代数语义不同），只要求存活。
- **S2 无单一化塌缩**（仅 Evolutionary/NoCulture）：终局基因组空间多样性 ≥ 创始值 30%（v2 无偏 drawInt 采样仪器）。
- **S3 世界保持活跃（窗口化，退化检查建议落地）**：任一 seed 不得出现**连续 3 个 chunk（3000 tick）idle 份额 > 600‰**；末块判据一并保留。瞬时单块越线记录为发现，不判失败。
- **S4 变异有界**：终局全部存活基因组过 zod 校验。
- **S5 信念有界**：全程快照 max beliefs/NPC ≤ 16。
- 报告不设闸门：epsilon 轨迹、idle 斜率、血脉数轨迹、人口曲线。

## 3. 行为新颖性硬闸门（N 组，Evolutionary 臂）

仪器：31 固定情境套件 + verbL1/n-gram（现有 `npm run behavior` 管线）。
**epsilon 混淆应对（冻结口径）**：跨臂原始多样性数字不可比（baseline-arms 发现 2：犹豫带压制多样性 ~47%）；因此 N 组闸门全部采用**臂内自参照**（evolved vs 同 seed 自己的 founders）或**方向性比较**，不用跨臂绝对值。

- **N1 行为漂移**：每 seed 取终局存活基因组池与创始池做池化比较（评审已裁定的等权采样法），verbL1 ≥ **0.30** 的 seed 数 ≥ 9/12。（锚点：evo-1 单 seed 59 代实测 0.656。）
- **N2 多样性维持**：终局池内两两行为多样性 ≥ 同 seed 创始值的 **60%** 且绝对值 ≥ **0.25** 的 seed 数 ≥ **9/12**（与 N1/N3 同一 seed-count 口径统一分母；草案原文遗漏此 qualifier，代码 `DEFAULT_NOVELTY_THRESHOLDS.minPassingSeeds` 对 N1/N2/N3 一视同仁地应用同一门槛，属编码落地时的补齐而非新引入判据——2026-07-24 补记，已列入 §10 待拍板供项目所有者确认）。（锚点：evo-1 实测 0.471 vs 创始 0.369 = 128%。）
- **N3 远离固定基线**：cross(evolved_evo, founders_fixed) ≥ cross(founders_evo, founders_fixed) 的 seed 数 ≥ 9/12（进化在行为空间里离开而非收敛回无进化基线）。
- **归因分析（不设闸门）**：Evolutionary vs Evo-NoCulture 同 seed 对比，分解"可遗传结构漂移"与"信念累积"对 N1/N2 的贡献；若 NoCulture 臂单独也能过 N1/N2，须在报告中如实声明"文化层非必要"。

## 4. 主要终点：盲化成对偏好（§6.7 冻结结构，本节补齐操作细节）

- **判断任务**：一对等长盲化血脉传记（Evolutionary vs Handcrafted），问题唯一："更想继续看哪条血脉的后续？"二选一强制。
- **功效参数（§6.7 已冻结，照搬）**：H0 p=0.5 双侧 α=0.05；最小产品意义效应量 **0.62**；判断数下限 **150、目标 200**；每人 ≤8 判断且素材不重叠；聚类稳健标准误复核。
- **素材生成（机械规则，冻结）**：
  - 每臂每 seed 取存活血脉中**代数最深**的 1 条 + `drawInt(seedRoot, n, "bio-pick", 2)` 抽 2 条 → 每臂 36 条候选传记；
  - **跨代分层采样（修正传记截断偏置）**：把血脉存续代数等分为 4 段，12 条成员事件预算按 3/段分配；段内优先级 死亡(带死因) > belief_formed > 出生，同级取更早 tick；某段不足时余额顺延后段；结语规则不变；
  - **配对**：按代数带（如 1–15/16–30/31+）匹配 Evolutionary×Handcrafted 各一条，渲染字符长度差 ≤20%（超出则重抽该臂候选）；
  - **盲化核查表**：无 seed/tick/臂名/机制词；两臂共用 NAME_POOL，名字不泄臂；渲染器输出禁用词 grep 过检（算力/代币/模型/锦标赛/LoRA/世界进化 + random/fixed/handcrafted/evolutionary）；**信念句对称性**：若传记含"信念"类语句（如"它相信……"/"它认为……"），两臂必须用**同一模板寄存器**（措辞结构、出现位置、密度）呈现——不能只有一臂的传记带信念句、另一臂没有，因为"是否出现信念句"本身就是机制指纹，比任何禁用词都更隐蔽的去盲泄露点（代码评审中发现的具体去盲漏洞，2026-07-24 补记）。
- **评委**：官方 ≥25 人（200 判断 ÷ 8）；形成性 12–20 人先行（用 pilot seed 素材，不消耗官方素材池）。
- **形成性去盲探测（仅 pilot，不进官方问卷）**：每份形成性问卷末尾追加一道开放文本题——"你能猜出两条传记来自不同的生成系统吗？依据是什么？"——用于在冻结前发现盲化设计的漏洞（如上条信念句对称性问题的类型）；官方正式问卷不含此题，避免主动提示评委去找机制差异，反而制造新的去盲。
- **通过判定**：偏好 Evolutionary 比例的双侧二项检验显著且方向为正，且点估计 ≥ 0.62。"显著但 < 0.62" = 方向成立但不足以支撑产品主张 → Iterate。

## 5. 次要终点（Holm–Bonferroni 家族校正）

1. 血脉特征回忆准确率（读后 3 项单选，如"这条血脉最怕什么"）；
2. 三代因果复述完整度（自由文本，双盲双评分员按 rubric 0–3 分）；
3. 关注转化率（读完后"愿意订阅这条血脉的后续吗"，是/否）。
个体层指标（隔日回访、观看时长）本轮不采集——无产品化会话循环（1B 未做），采了也是噪声；按 DEC-4 它们本就不投票。

## 6. 决策规则（Go / Iterate / Stop）

- **Go**：S 组全过 + N 组全过 + 主终点通过。→ 进入 1B 产品化与阶段二准备。
- **Iterate**：S 组全过，N 或主终点未过但方向为正（主终点点估计 > 0.5 或 N 组 ≥ 2/3 过）。→ 允许改指标/内容后换 seed 组重跑（v3）。
- **Stop**：S 组任一失败（世界本身不稳定），或主终点方向为负且 CI 上界 < 0.5（观众明确更爱手工内容）。→ 回§15 威胁模型重审"进化是否产品必需"。
- Random 臂灭绝**不算** S 组失败（它是 sanity 下限，预期灭绝）。

## 7. 运行纪律

- 首个官方 seed 启动前：本方案冻结 + 分析代码 commit hash 写入本文件 + 全部阈值不可变。
- 首次官方运行即记录；任何"重跑到通过"= 违规，发现即作废整组 seed。
- 官方运行目录含 `directives.json`（本实验恒为 `[]`——无守望介入）+ `manifest.json`/`roster.json`/`meta.json`/`checkpoints.json`/`snapshots.jsonl`/`events.jsonl.gz`/`final-state.json.gz`（`src/cli/formal.ts` `runFormalSeed` 落盘格式），全部归档（tar + sha256 入 docs/bench-results 同款仓库路径）。
- **归档范围修正（2026-07-24，任务 4 落地时确认）**：官方归档**不含逐 tick 原始 action log**。`meta.json` 只留 `actionChainTip`（每 chunk 末尾事件的哈希链尾，定义见 `FormalSeedMeta.actionChainTip` 的文档注释）和 `finalStateHash`；`events.jsonl.gz` 只含粗粒度语义事件（传记提取用，不是逐 tick 决策日志）；`checkpoints.json` 只是稀疏 state hash 序列。理由：内核是确定性的——同一 `seedRoot` + 同一 manifest + 同一 tick 数必然重放出逐字节相同的 actionLog，原始日志因此是**冗余信息**，任何时候都能用相同参数重新调用 `runFormalSeed`/`runFromState` 完整复现，不需要预先落盘占用归档空间。校验路径因此是"chain tip + 稀疏 checkpoint state hash + 需要时对该 seed 做无插入严格重跑，比对 `finalStateHash`/`actionChainTip`"，而不是从磁盘读原始日志逐条核对——这与 `npm run replay -- --strict` 对单次 `sim` 运行"重放优于存档"的验证哲学一致，只是在正式 1C 归档规模（12 seed × 5 臂 × 50k tick）下把"该存什么"也收紧到了这个哲学的逻辑终点。原草案文字中的 "actions" 一词（归档清单）随本条修正作废，以此条为准。
- 中途发现 runner bug：修复后整臂重跑（同 seed 允许——确定性内核下这是重放而非重采样），并在报告中记录修复。

## 8. 成本与招募（待项目所有者拍板）

| 项 | 方案 A（形成性先行，推荐） | 方案 B（直接正式） |
|---|---|---|
| 计算 | ~6–8h 本机（过夜） | 同左 |
| 人评规模 | 先 12–20 人形成性（pilot 素材）→ 达标后再正式 25+ 人 | 直接 25+ 人 × 8 判断 |
| 招募渠道 | 社群/朋友（成本≈0）+ 正式轮用平台 | Prolific/众包平台 |
| 现金成本估算 | 正式轮 ~$100–200（按 15–20 分钟任务 $3–5/人 × 25–40 人） | 同左 |
| 风险 | 慢 1–2 周 | 素材/问卷缺陷直接烧掉正式 seed 组 |

## 9. 冻结前须交付的代码（下一个实施计划的范围）

以下五项均已完成代码交付，标注**已交付(待冻结)**——"待冻结"是因为按本文件顶部的冻结条件，
正式冻结仍需项目所有者审定 §10 待拍板清单 + 形成性小样跑通全流程；代码交付完成不等同于协
议冻结，阈值/规则在冻结前仍可调整（调整只需改参数，不需要改产出接口，见每项的实现落点）。

1. **已交付(待冻结)** — `npm run formal -- run --arm <id|noculture> [--seeds 12] [--ticks 50000] [--chunk 1000]`：按 seed 粒度断点续跑、按 chunk 落盘快照指标、终局全量基因组/事件归档（`src/cli/formal.ts` `runFormalSeed`）；`npm run formal -- gates --arm <id>` 做 S 组判据代码化（`evaluateSGates`/`aggregateSGates`）。测试：`tests/formal.test.ts`。
2. **已交付(待冻结)** — 传记采样器 v2 跨代分层（`src/chronicle/sample.ts` `stratifiedSelect`）+ 配对/盲化/核查表管线（`src/eval/pairing.ts` `pickLineages`/`buildPairs`/`blindingViolations`）+ 评委问卷素材打包 `npm run evalpack`（`src/cli/evalpack.ts`，产出 `packet.html` + 独立的 `answer-key.json`）。测试：`tests/sample.test.ts`、`tests/pairing.test.ts`；`evalpack.ts` 本身的 CLI 装配未另建专属测试文件，按端到端手动冒烟验证（与本次 `analyze.ts` 同一惯例）。
3. **已交付(待冻结)** — N 组判据代码化：池化比较（`comparePooled`，`src/cli/behavior.ts`）+ 方向性比较（`meanPairwiseVerbL1`/`meanCrossVerbL1`，`src/scenarios/metrics.ts`），全部输出进 `npm run formal -- novelty --arm <evolutionary|noculture>` 的 `novelty-<arm>.json`（`src/analysis/novelty.ts` `evaluateNoveltyForSeed`/`evaluateNovelty`）。测试：`tests/novelty.test.ts`。
4. **已交付(待冻结)** — 次要终点评分 rubric 文档（`docs/eval-rubric.md`：回忆准确率 3 题模板、因果复述 0–3 锚定量表、转化率是/否）+ 双评分员一致性计算（`src/analysis/stats.ts` `cohenKappa`）。测试：`tests/analysis-stats.test.ts`。
5. **已交付(待冻结)** — 分析主脚本 `npm run analyze -- --out runs/formal [--judgments <csv>]`（`src/cli/analyze.ts`）：聚合各臂 S/N 判定（优先读 `sgates-<arm>.json`/`novelty-<arm>.json`，缺失时按需现算），提供 `--judgments` 时联表 `answer-key.json` 计算主终点统计（精确二项检验 `binomTwoSided` + Wilson CI + 聚类稳健复核 `clusterRobustPrefSE`，均在 `src/analysis/stats.ts`），并打印 §6 的 Go/Iterate/Stop 建议行（`computeRecommendation`，仅供参考，决策仍为人工）；写 `analysis.json`。统计核心测试：`tests/analysis-stats.test.ts`（CLI 本身按本仓库既有惯例做了端到端手动冒烟验证，未另建 CLI 专属测试文件）。

## 10. 待拍板清单（冻结前必须逐项确认）

- [ ] N1/N2/N3 阈值（0.30 / 60%+0.25 / 9:12）——基于 evo-1 单 seed 锚点的保守取值，是否接受；
- [ ] N2 的 seed 数量门槛是否应与 N1/N3 共用同一 9/12 分母（当前实现口径：三者共用同一个 `minPassingSeeds` 参数，`src/analysis/novelty.ts` `DEFAULT_NOVELTY_THRESHOLDS`；§3 N2 行 2026-07-24 已据此补上 qualifier），还是 N2 应该有独立的、可能更严格或更宽松的门槛——控制器裁定（controller ruling）待项目所有者确认；
- [ ] 传记预算 12 事件 4 段 3/段，代数带切分（1–15/16–30/31+）；
- [ ] 人评走方案 A 还是 B；招募渠道与预算；
- [ ] 次要终点三项是否全做（回忆准确率成本最低；因果复述需双评分员）；
- [ ] Evo-NoCulture 臂是否保留（+12 seed ≈ +20% 计算，换取信念混淆归因）；
- [ ] 50k tick 是否足够（若 12 seed 中多数在 50k 未达 50 代，是延长 tick 还是接受"46 代也算数"——建议：S1 改为 maxGen ≥ 45 的兜底措辞，或干脆延到 60k，冻结前二选一）。

---

*草案作者：项目 AI，2026-07-23。依据：living-worlds.md v0.5.2 §6.6/§6.7/§16/§17.1/§18；bench-prereg-v1.md（格式与纪律先例）；evolve-calibration.md；degradation-check.md；baseline-arms.md；product-shell.md。*
