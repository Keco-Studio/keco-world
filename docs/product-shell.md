# 产品壳 — 首五分钟（§17.1 step 8 交付记录）

**Status:** §17.1 step 8（"做首个五分钟产品壳"）— 官方交付记录。内核（守望机制、时刻导演 v0）与产品壳（`web/`）随本记录一并交付；本文档同时是 §4.2 实现记录、守望机制的红线审计记录、时刻导演的决策记录，以及可视化验证记录。
**Date:** 2026-07-23
**运行方式：** `npm run web`（Vite dev server，端口 5273，见 `.claude/launch.json`），种子固定为 `"shell-1"`（`web/src/main.ts`）。

---

## 1. 交付范围一览

- 内核三项前置能力：`@noble/hashes` 浏览器可移植哈希（哈希值不变）、守望机制（schema v4：`WorldState.patronThemes` + `patron_set` SemanticEvent + Resolver 决胜层倾斜 + 双重审计）、时刻导演 v0（`src/director/director.ts`）。
- 产品壳：`web/` 下的 Vite + Excalibur 应用，纯函数视图模型（`web/src/viewmodel.ts`，DOM-free，vitest 全覆盖）+ 交互门控的五分钟状态机（`web/src/flow.ts`）+ DOM 覆盖层（`web/src/ui.ts`）+ Excalibur 渲染（`web/src/render.ts`，人工验证，不做单测）。
- 明确不在本次范围内的内容见第 7 节。

---

## 2. §4.2 首个五分钟：分拍实现记录

### 2.1 交互门控决策（而非墙钟门控）

§4.2 原文按 0:00–0:20 / 0:20–1:00 / 1:00–2:00 / 2:00–4:00 / 4:00–5:00 的时间轴描述五个阶段。实现时冻结的决策是：**这些时间轴是产品设计目标，不是计时器**——五个阶段用 `web/src/flow.ts` 里一个纯、DOM-free 的有限状态机实现，节拍推进只由玩家交互触发，不由 `setInterval`/墙钟触发：

```
opening --dismiss-opening--> watching
watching --why-viewed--> patron-offer
patron-offer --choose-theme--> living
```

理由：真实玩家阅读开场卡、点开"为什么"卡片、做出守望选择的用时因人而异；若按墙钟硬切阶段，慢读的玩家会被打断，快速点击的玩家会被卡住等一个不存在的计时器。`flowReduce` 对不合法事件（例如 `opening` 阶段收到 `choose-theme`）是无操作（no-op），保证状态机在任何交互顺序下都不会进入非法状态——这一点由 `tests/web-flow.test.ts` 的第一个用例直接断言。世界本身（sim tick）在所有阶段背后持续运行，不会因玩家还停留在某张卡片上而暂停；`hookable` 事件（见下）在门控阶段之外也会持续累积进 `hooks` 数组。

### 2.2 逐拍记录

**0:00–0:20 先看到一个问题。** `showOpeningCard`：镜头默认跟随时刻导演选出的 NPC，卡片只显示名字、血脉、`goalLine(moment)`（"当前目标：赶在寒冬前，把过冬的储备补满" / 冬前储备不足以外的兜底文案）、`riskLine(moment, energyDrainPerTick)`（如"冬天还有 1.0 天，他的储备只够 2.0 天"）。背景村落持续运行，不因卡片暂停。实测（见第 6 节）：seed `shell-1` → 时刻导演选中 Lorn（`winter-shortfall`，约第 300 拍）。

**0:20–1:00 建立因果。** 玩家点击常驻按钮"他为什么这么做？"展开为什么卡片（`buildWhyCard`）：标题"第 {tick} 拍的抉择"，需求行（饥饿状态 vs 阈值），人格特质（8 项冻结映射，如"急性子"/"谨小慎微"），候选动作列表（`verbLabel` 中文标签 + 分数 + 是否被选中），来源行按 `actionSource` 区分反射/效用/决胜三种措辞。整张卡片只读取审计记录里已有的结构化字段（`DecideInfo`），没有 LLM 参与，也不展示完整 prompt——符合 §4.2 "系统不展示完整提示词，只展示可读的因果摘要"的要求。

**1:00–2:00 第一次表达。** 玩家点击"关注这个血脉"后自动进入守望卡片（`showPatronCard`）：探索/关系/储备/建造四个主题按钮，诚实文案原文照搬 §4.1："这不是命令，只会在它犹豫时形成轻微影响"。选择后下一拍生效（一个 pending-directive 队列，见 §3.1），事件流出现 `patron_set` 的中文播报（"你的守望开始眷顾 {name}，引向{verb}。"）。

**2:00–4:00 看到后果或悬念。** 已发生的短期后果直接进事件流；尚未发生的长期后果被标记为 `hookable: true`（季节转冬、关注血脉内出生、关注 NPC 的信念形成、决胜标注）并推入"接下来值得看"面板（`renderHooks`，最多 3 条，最新在前，容量满时丢最旧一条）。玩家可点开传记按钮查看父母/子代/近期关键事件。

**4:00–5:00 形成回访理由。** 进入 `living` 节拍时固定生成回访钩子："第一场寒潮之后，{守望主题}的守望会接受检验"，并附带 §4.2 原文的收尾句"世界不会因你离线暂停——他们会继续生活、繁衍，也可能死去。"（未接入真实的站内提醒订阅，见第 7 节）。

**全程禁用词检查：** `web/src` 中未出现"算力/代币/模型/锦标赛/LoRA/世界进化"任一词（人工 grep 确认）。

---

## 3. 守望（Patron）机制记录

### 3.1 语义（schema v4，冻结）

- `WorldState.patronThemes: Record<string, UtilityKey>`（npcId → 主题；缺键 = 无守望），进入哈希状态。
- 守望指令是**世界输入**，不是派生状态：`RunOptions.patronDirectives?: Map<tick, { npcId, theme: UtilityKey | null }[]>`，在每拍开始（`state.tick = t` 之后、`environmentStep` 之前）按数组顺序应用，每次应用都产出一条 `patron_set` SemanticEvent（`data: { theme }`，`null` 表示取消关注）。产品壳里，选择主题会把指令排进"下一拍生效"的队列（`sim.step(new Map([[state.tick + 1, [...]]]))`），由下一次 `step()` 消费并清空。
- Resolver 倾斜**只发生在犹豫带内**（`epsilon > 0` 且候选带长度 > 1）：候选带中 `key === theme` 的候选获得 `+PATRON_TILT` 抽签权重。反射层和非犹豫带的决策完全不受影响（§4.1："不越过反射与生存规则"）。
- **双重审计**：`patronApplied`（倾斜确实进入了一次抽签）与 `patronDecisive`（结果与"无守望影子对照"不同——即结果因为倾斜而改变，decisive ⊆ applied）。两者都持久化进行动日志（schema v4 字段，均为必填、均纳入事件哈希链）：`patronInfluence` 记录 `patronApplied`，`patronDecisive` 字段记录同名标志；`DecideInfo` 同时携带两个标志供运行时读取。为什么卡片的决胜标注（"它犹豫时，你的守望让它倾向了{verb}"）只在 `patronDecisive` 为真时出现，UI 标注与日志里的 `patronDecisive` 字段一一对应：红线份额（关注 NPC 的决胜决策占比）可以直接从一份已保存的日志复核——`decisive 事件数 / 该 NPC 总事件数`——不需要重新运行进程内的 `onDecide` 回调。
- **红线（不变量四）：** 关注 NPC 的决胜决策占比 ≤5%。`PATRON_TILT` 在 Task 2 用测量协议校准（而非假设）：候选值 `[150, 100, 60, 30]`，3 个种子 × 5000 拍，全程开启主题 `"explore"`，取所有种子都过线的最大候选值。

### 3.2 校准表（最终版，经耦合修正后重新测量）

```
tilt | seed           | total | decisive | decisiveShare1000 | ≤50 (5%)?
-----|----------------|-------|----------|--------------------|-----------
 150 | patron-cal-1   |   712 |       22 |                 31 | PASS
 100 | patron-cal-1   |   712 |       21 |                 29 | PASS
  60 | patron-cal-1   |   712 |        8 |                 11 | PASS
  30 | patron-cal-1   |   712 |       11 |                 15 | PASS
 150 | patron-cal-2   |   755 |       25 |                 33 | PASS
 100 | patron-cal-2   |   755 |       17 |                 23 | PASS
  60 | patron-cal-2   |   755 |       14 |                 19 | PASS
  30 | patron-cal-2   |   755 |        7 |                  9 | PASS
 150 | patron-cal-3   |   742 |       13 |                 18 | PASS
 100 | patron-cal-3   |   742 |        9 |                 12 | PASS
  60 | patron-cal-3   |   742 |        4 |                  5 | PASS
  30 | patron-cal-3   |   742 |        1 |                  1 | PASS

chosen PATRON_TILT = 150（所有候选值中最大且在 3 个种子上都过线）
```

四个候选倾斜值在三个种子上都稳定低于 5%（50/1000）红线；**最坏观测值为 3.3%**（tilt=150，seed `patron-cal-2`）。因为 150 既是最大候选值又已在所有种子上过线，`PATRON_TILT` 无需改动，保持 150（`src/mind/resolver.ts`）。运行时的产品壳里 `hookable` 决胜标注也观测到相近频率：可视化验证记录了 4× 倍速下约 11 次标注 / 230 拍窗口 ≈ 4.8%，与校准结论一致（见第 6 节）。

### 3.3 耦合修正的故事（如实记录，审计可信度是本项目的硬要求）

这段历史值得完整记录，因为它直接决定了 `patronDecisive` 这个红线信号本身是否可信。

**第一版实现（brief 字面描述）：** 分别对"倾斜总权重"和"未倾斜总权重"各调用一次 `drawInt(seedRoot, totalWeight, "resolver", npcId, tick)`，用同一个 key 但不同的模。这个方案在 `tests/patron.test.ts` 的决胜性断言上**确定性地**（不是偶发）失败：`drawInt` 的底层 key 不含 `n`，两次调用取到同一个原始 32 位值，分别对不同的模数取余——两次独立的模约减在真实输入（`PATRON_TILT=150`，两候选带）下产生 75/500 次"方向错误"（倾斜后选中的候选，在未倾斜对照里反而是被倾斜挤掉的那个），即倾斜本该拉向"idle"，实际却选出了"explore"。

**修正一（本次计划落地的第一稿）：** 改为单次抽签，`r = drawInt(seedRoot, untiltedTotal + tilt, ...)`，`[0, tilt)` 强制落到主题候选，`[tilt, tilt+untiltedTotal)` 走未倾斜的常规游走，同一个游走结果同时作为倾斜结果和对照结果复用。这个方案通过了当时的测试（0/500 方向错误），但留下了一个**未被发现的结构性 bug**。

**opus 评审发现的问题：** 这个"强制区/常规区"切分是**带序相关**的——强制区 `[0, tilt)` 到底"吞掉"的是谁的权重份额，取决于主题候选在候选带生成顺序里排第几。具体地：当主题候选排在候选带**最前面**、且它自身的未倾斜权重 `w_theme ≥ tilt` 时，强制区 `[0, tilt)` 在对照游走里也完全落在主题自己的常规区间内——这使得 `patronDecisive` 对这种带形状**结构性恒为 false**，即便倾斜确实真实地移动了概率质量。评审在校准种子上测得这种"结构性零"占已应用抽签的 75%–87%（主题 "explore" 在实际候选带里经常排在最前，因为候选带生成顺序是 consume→forage→shelter→seekMate→explore→idle，而 explore 常常是过滤掉更靠前的键之后带内实际排第一的那个）。这直接低估了产品的因果审计信号——`patronDecisive` 正是红线检查依赖的那个数字。

**最终修正（评审给出的构造，已落地）：** 把候选带概念性地重排为 `[...非主题候选, 主题候选]`（只是记号上的重排，不改变分布）。设 `S = untiltedTotal`，用同一个 key 单次抽签 `r = drawInt(seedRoot, S + tilt, "resolver", npcId, tick)`：
- `r < S`：倾斜结果与对照结果复用**同一次** `walk()` 调用——永远非决胜，无论 `r` 落在重排后哪个候选的区间。
- `r` 落在被搬移的那一小段 `[S, S+tilt)`：倾斜结果强制为主题候选；这个 `r` 在"无倾斜"世界里没有对应意义，因此对照结果**独立重新抽签**：`r2 = drawInt(seedRoot, S, "resolver-cf", npcId, tick)`（换用独立 key `"resolver-cf"`），按未倾斜权重游走。`patronDecisive` 当且仅当这次重抽的结果不是主题候选。

这个构造在任意候选带大小、任意主题候选位置下都是**严格带序无关且精确**的（`src/mind/resolver.ts` 内有完整推导注释）：倾斜边际分布精确还原 `(w_theme+tilt)/(S+tilt)`；对照边际分布精确还原未倾斜彩票 `w_c/S`；**决胜概率的解析解为 `tilt·(S−w_theme) / (S·(S+tilt))`**——这正是倾斜前后两个彩票分布之间的精确全变差距离（total variation distance），公式中不含任何带序项。用评审指出的具体反例（主题候选排最前、`w_theme=600 ≥ tilt=150`）重新验证：110/2000 决胜（旧构造下这里结构性恒为 0），0 次方向错误。

结论：`patronDecisive` 现在是一个可信的因果审计信号，红线校准表（3.2 节）用的正是修正后的构造重新测量所得。

### 3.4 已知缺口

- **磁盘重放 CLI（`src/cli/replay.ts`）尚未持久化/加载 `patronDirectives`**——用过守望指令的运行目前只能通过进程内的 `verifyReplay(..., patronDirectives)` API 验证重放一致性（`tests/patron.test.ts` 走的正是这条路径），无法端到端走磁盘重放 CLI。这是一个已知的后续任务，不阻塞本次交付（守望指令仍会哈希进状态、行动日志里的 `patronInfluence`/`patronDecisive` 仍会随内存重放校验）。
- 守望审计字段（`patronInfluence`/`patronDecisive`）是被行动日志事件哈希链保护的标注字段，不是状态锚定的——一份把哈希链完整重新拼接过的篡改日志，只有在验证时把原始运行用过的 `patronDirectives` 一并提供给验证器时，才会被 checkpoint 哈希发散捕获。

---

## 4. 时刻导演 v0 — 决策记录

本节正式关闭 §18 P0 遗留的开放问题："首个五分钟使用哪一个具体事件作为默认开场"。**决议：冬前储备不足（`winter-shortfall`）。**

### 4.1 冻结规则

- **候选资格**：存活成年 NPC，处于夏季，且 `0 < ticksToWinter ≤ 200`。
- **短缺量**：`shortfall = seasonLengthTicks × energyDrainPerTick − (energy + berries × berryEnergy)`，要求 `> 0`。
- **打分**：`score = min(shortfall, 2000) + (200 − ticksToWinter)`——短缺越严重、离冬天越近，分越高（短缺量封顶 2000 防止极端值压过临近度）。
- **选取**：取最高分；同分先取更早的 tick，再同分取 npcId 的 UTF-16 序更小者（确定性 tie-break，不依赖 locale）。
- **兜底**：扫描窗口（默认 `DIRECTOR_SCAN_DEFAULT = 1200` 拍）内若无合格候选，在窗口末尾从存活成年 NPC 中取"能量 + 浆果换算能量"最低者（`kind: "fallback-low-reserves"`），仍是一个可读的问题场景。扫描窗口内所有存活 NPC 都不存在时抛错（视为世界本身损坏）。
- 实现：`src/director/director.ts`，`findOpening(manifest, roster, seedRoot, scanTicks?)`，每 100 拍一个 chunk 边界评估候选（200 拍候选窗口足以让 100 拍粒度不遗漏），确定性、可重放（同一 seed 两次调用哈希相同，`tests/director.test.ts` 验证）。

### 4.2 实际结果

产品壳固定种子 `"shell-1"`：时刻导演选中 **Lorn**，`kind: "winter-shortfall"`，约第 300 拍——开场卡片文案（"赶在寒冬前，把过冬的储备补满"）、风险行（"冬天还有 1.0 天，他的储备只够 2.0 天"）均来自这次真实扫描的结果，非硬编码文案，人工验证确认。

---

## 5. DAY_TICKS 展示约定

产品壳内冻结的展示换算：`DAY_TICKS = 100` → 一拍（tick）的百分之一天，即 **1 季 = 4 天**（`seasonLengthTicks` 与该换算的具体关系见 `web/src/viewmodel.ts` 的 `fmtDays`）。所有面向玩家的时间量（风险行、回访钩子）都走 `fmtDays(ticks) = (ticks / DAY_TICKS).toFixed(1) + " 天"` 这条路径，不直接暴露原始 tick 整数。**例外（已知缺口，见第 7 节）：** 事件流仍以"第 N 拍"格式展示原始 tick，未套用这一换算——留给后续统一。

---

## 6. 可视化验证摘要

**方式：** 控制者本人（非子代理）在浏览器内针对 `npm run web`（端口 5273，种子 `"shell-1"`）走完整的五分钟旅程；4× 倍速用于在合理时间内观测到决胜标注等低频事件。完整原始记录见 `.superpowers/sdd/task-6-visual-verification.md`；本节是其摘要。

### 6.1 验证通过项（均有实测证据）

- 开场（0:00–0:20）：时刻导演结果与卡片文案一致（见 4.2）；背景村落持续运行；整页刷新可复现同一开场（同 seed → 同开场，确定性）。
- 为什么卡片（0:20–1:00）：真实审计数据——第 364 拍抉择，尚不饥饿（能量 872），人格急性子/谨小慎微，候选探索 112（选中）/歇息 56/采集 9，来源行"它犹豫了——最终凭性情倾向了这个选择"（Resolver 路径真实生效，非占位文案）。
- 守望（1:00–2:00）：四个主题按钮 + 诚实文案"这不是命令，只会在它犹豫时形成轻微影响"；选择"储备"后第 413 拍事件流出现"你的守望开始眷顾 Lorn，引向采集。"
- **决胜标注：** 首次出现于第 428 拍"它犹豫时，你的守望让它倾向了采集"，后续决胜拍持续出现——观测窗口约 230 拍内 11 次标注 ≈ 4.8%，与 3.2 节校准结论（≤5% 红线）一致。
- 悬念钩子与回访钩子（2:00–5:00）：接下来值得看正确携带寒冬降临/出生等条目；回访钩子"第一场寒潮之后，采集的守望会接受检验"；收尾句"世界不会因你离线暂停——他们会继续生活、繁衍，也可能死去"如实展示。
- **死亡路径实测：** 验证过程中 Lorn 于第 819 拍寿终正寝；传记按钮出现；点开后渲染出接地的"Lorn一脉纪事"（信念形成、Runa/Joss 出生、死亡、结语漂移句），内容全部来自这次真实运行。
- 冬季色调、镜头跟随/俯瞰、速度控制均按设计工作；中文死因（死于严寒/死于饥饿/寿终正寝）均实测出现。

### 6.2 验证中发现并修复的问题

**1. 守望标注挤占了前瞻性钩子。** 标注是"已发生的结果"，不该占"接下来值得看"的位置——改为仅进事件流（`hookable: false`），保留"接下来值得看"给真正前瞻性的条目（提交 `cf260e7`）。

**2. WebGL 上下文在约 900 拍（4× 倍速）时崩溃，根因排查经过三轮：**

- **现象：** Excalibur `ImageRendererV2` 反复报"Uniform u_matrix doesn't exist ... optimized away"致命错误，最终"WebGL Graphics Context Lost"并弹出 Excalibur 自带的刷新提示。
- **排除项：** `ex.Flags.useLegacyImageRenderer()` 无效（实测确认）；单独把 `ex.Label` 文字光栅化移出画布（名字改成 DOM 徽标）也无效——崩溃点只是推迟到约第 972 拍再次出现。
- **真实根因：GPU 纹理churn。** `ex.Circle`/`ex.Rectangle` 是 Raster 图形——每次 `new` 都分配一块画布支撑的新纹理，而 `syncWorld` 此前在**每一拍**都为每一株灌木/每个 NPC/狼重新分配图形对象，4× 倍速下相当于每秒数百次纹理分配，直到 GPU 上下文被拖垮。
- **修复：** 图形实例缓存——每种外观（按血脉着色的 NPC 圆、8 档量化的灌木饱满度、单一样式的狼方块）只分配一次共享纹理，`graphics.use()` 只在外观真的变化时调用；顺带把跟随 NPC 的名字改为 DOM 徽标（`#followed-badge`），画布本身不再含文字。**耐久性复测：** 4× 倍速连续运行 3 分钟（约 1400+ 拍，越过此前两次崩溃点），无异常。

---

## 7. 已知限制 / 1B 待办清单

**产品壳自身的已知限制（如实记录）：**

- 标注行未做聚合：同一主题下反复犹豫的 NPC 可能在短时间内产出多条几乎相同的标注（这是按 §4.1"每次生效必须标注"的字面要求实现的；§4.1 提到的"历史摘要中累计展示"属于 1B 的 Session 循环范畴，见下）。
- 事件流里的名字碰撞（子代从 `NAME_POOL` 抽取创始人同款名字，例如两个不同的 Ives 先后死亡）没有"另一位"消歧——这个消歧目前只存在于传记渲染器（`src/chronicle/biography.ts`）里，事件流没有复用。
- 信念命题以英文渲染在中文界面里（内核内容本身如此，例如『winter nearly killed me』）——Chronicle 命题的本地化是一个内容决策，随表达层一起推迟。
- 会话状态不持久化：刷新页面会从开场重新开始（确定性重放，同一 seed 结果相同）；产品壳够用，1B 需要持久化。
- 事件流展示原始 tick 单位（"第 N 拍"），未套用第 5 节的 `DAY_TICKS` 展示换算（风险行已套用）。
- WebGL 上下文丢失若再次发生（例如真实的 GPU 重置），会退回 Excalibur 自带的刷新提示；届时未持久化的模拟状态会丢失（与上一条持久化缺口相关）。
- 磁盘重放 CLI 尚不支持守望指令的持久化/加载，见 3.4 节。

**明确不在本次产品壳范围内（按 1B 路线图，`docs/living-worlds.md` §16 相应章节）：**

| 未交付项 | 1B 中对应位置 |
|---|---|
| 时刻导演作为常驻线上服务（而非一次性扫描）+ 张力供给率仪表化 | §5 体验层架构、§6.3 推理预算与仪表化 |
| 订阅 / 站内提醒（回访钩子目前只是一句文案，不驱动真实通知） | §4.2 结尾"允许玩家订阅站内提醒"、§4.3 |
| 典型 Session 循环（历史回顾/检查关系/表达意图/观看/回访锚点五段式） | §4.3 典型 Session 循环 |
| 纪念 / 墓志系统 | §4.4 死亡、失败与纪念 |
| 服务端持久化（跨会话保留世界状态） | 架构总览（§5）与 1B 路线图对"权威状态"的规划 |
| 多用户 / 多玩家共享同一世界 | 不变量三（§3.3，权威状态不在浏览器间分片）及后续多人设计 |

---

## 8. 如何运行

```bash
npm run web
```

启动 Vite dev server（端口 5273，`.claude/launch.json` 固定），种子固定为 `"shell-1"`（`web/src/main.ts`），浏览器打开后自动进入开场卡片。生产构建校验：

```bash
npx vite build web
```

相关校准 / 验证命令（不属于产品壳运行路径，用于复现本文档的数字）：

```bash
npm run patron-calibrate   # 3.2 节校准表
npm test                   # 覆盖 tests/patron.test.ts、tests/director.test.ts、tests/web-flow.test.ts、tests/web-viewmodel.test.ts
npm run typecheck          # tsc --noEmit && tsc -p web --noEmit
```
