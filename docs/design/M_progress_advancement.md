# M — 进度推进信号重设计(progress_chapter)

状态:设计待审(2026-06-15)。用户:行者无疆(`1027403637@qq.com`,id 115)反复踩进度卡死。
关联:[[D_gm_serving]] [[L_progress_aware_cards]]、`ba640f414`(本次回归来源)、`cca51bc69`(reconciler)。

---

## 1. 问题(prod 实证)

`game_sessions.worldline->>'progress_chapter'` 是**单一进度真源**,驱动两件事:
- 时间线面板「当前」节点高亮([game-panels.jsx](../../frontend/src/game-panels.jsx) `ch_min ≤ 当前 ≤ ch_max`)。
- 剧透门控 / 实体召回天花板([retrieval.py](../../rpg/retrieval.py) `_progress_chapter`、canon `_reveal_clause`)。

**现象**:用户 115 的 save 139(script 143「无限流_最终版」)玩了 15 回合、故事已深入「生化危机·蜂巢」线(B2 实验室/激光通道/丧尸),进度表却死在**第 1 章**;面板把第 1 章两个「序章」节点都标「当前」(后者是 Bug A 重复锚点,已另修)。

**实证数据(prod, script 143):**

| 章 | story_time_label | events 数 |
|---|---|---|
| 1 | 序章 | 10 |
| 2–8 | 名为生化 / 醒来 / 死亡擦肩而过 / 活下去的欲望 / 救命的激光通道 / 活着的证明 / 强化 | **全 0** |
| 9 | 准备完毕 | 1 |
| 11 | 极限恐怖 | 7 |

`save_anchor_states` 只在 ch1/ch9/ch11 有锚点(与 events 密度一致)。ch2–8(整段蜂巢线)**有完整 summary、0 event → 0 锚点 → 进度全盲**。

## 2. 根因链

1. `ba640f414` 把进度改成「只认已确认锚点的最大原著章」(`max(source_chapter where status in occurred/variant)`),`advance_progress` max-only 单调。**可靠但稀疏**。
2. 锚点来自 `chapter_facts.events`,密度极不均(本书 ch2–8 抽取 0 event)。玩家走完事件空白章,无任何锚点可标 → 进度冻结。
3. 历史:`ba640f414` 之前进度由 `get_progress_window.chapter_min`(含 world.time→timeline 映射)物化 → 因 `story_time_label` 不是可靠「时间」→ 早期标签误命中远章 → bogus jump 到 ch77。所以那条信号被**整条砍掉** → 矫枉过正成今天的冻结。
4. world.time 标签信号实测**不可用**:GM 自编自由标签(save 139 = "无限历元年·任务初始·进入蜂巢")与抽取标签("第①部 第一集 名为生化")**零 token 重叠**,`resolve_timeline_anchor` 返回 None(实测「进入蜂巢/蜂巢/任务初始」全 no-match;只有「名为生化」「序章」命中)。

## 3. 可用信号盘点

| 信号 | 可靠性 | 密度 | 备注 |
|---|---|---|---|
| 已确认锚点 occurred/variant | 高(地面真值) | 稀疏 | 当前唯一信号;空事件章冻结 |
| world.time 标签 → 锚点 | 低 | — | GM 自由标签 resolve 不到,**弃用** |
| reconciler judge 读本回合正文 | 中(LLM) | 每回合 | **已在每回合跑**,读真实剧情 |
| `chapter_facts.summary` | 高(数据) | 每章(密) | 每章都有 label+summary(ch2–8 实测 100–240 字、内容真实) |
| `save_phase_digests` | 中 | 每 phase | 太粗,本例仍停"序章·不明时段" |

## 4. 设计:有界叙事章估计(judge)+ 锚点地板 + 确定性 clamp

核心:**LLM 提供平滑(读真实剧情估当前章),确定性 clamp 提供安全(钳在地面真值附近,杜绝乱跳)**。符合 [[feedback_harness_determinism]]——失败模式由确定性 clamp 兜死,LLM 只在安全区间内补平滑,**不可能再 catastrophic 乱跳**。

### 4.1 三个量

1. **地板 `floor`(可靠,不可回退)**:`max(source_chapter where status in ('occurred','variant'))`。即当前行为,绝不低于它。
2. **叙事估计 `est`(平滑)**:扩展现有每回合 `anchor_reconcile` 判定器,**顺带**返回 `estimated_chapter` —— 「本回合正文最接近原著第几章」。判定器本就读 turn 正文 + 窗口内 pending 锚点;额外喂窗口章的 `chapter_facts.summary` 作参照,让它挑最接近的章。**读真实剧情,不依赖 GM 标签是否匹配**。无 key / 判定器不可用 → `est=None` → 回退纯锚点地板(零回归)。
3. **上限 clamp(确定性护栏)**:
   ```
   ceiling   = max(floor, prev_progress) + LOOKAHEAD_CAP
   candidate = clamp(est, prev_progress, ceiling)          # est 为 None 时跳过
   new       = max(prev_progress, floor, candidate)        # 单调,经 advance_progress
   ```
   - **已实现 `LOOKAHEAD_CAP = 12`**:叙事估计最多越过「max(已确认锚点, 当前进度)」12 章。
   - bogus 兜底:floor=0 时 ceiling = **prev + CAP**(prev 至少为 1,即上限 ≥13),即使 judge 误估 77 也被钳到 prev+CAP(根治 ch77,blast radius = CAP 章而非整书)。
   - 锚点确认后 floor 升 → ceiling 升 → 进度自然跟着往前放。
   - **不变量**:progress 的叙事估章【只由 `anchor_reconcile._apply_estimate` 写】;`retrieval.py` 进度块只做 anchor-floor 同步、绝不引入估章;两路径都经 `gm_serving.settings.advance_progress`(max-only)收敛 → 双写不抖动、不互相拉低。改任一方前须维持此契约。

### 4.2 对 save 139 的效果(验证设计正确性)
- floor=1、prev=1、CAP=12 → ceiling=max(1,1)+12=13。
- judge 读第 15 回合正文(B2/激光通道/蜂巢)+ ch5–13 summary → 估 ≈ ch6(「救命的激光通道」)。
- candidate=max(1,1,min(6,13))=6 → new=**6**。进度推到 6,面板高亮 ch6。**下一回合即修复,无需回填**。

### 4.3 对 ch77 历史 bug 的效果
- floor=0、prev=1、ceiling=max(0,1)+12=13。即使 judge 误估 77 → clamp 到 13。**有界**;用户仍可用 rewind 端点下修。

## 5. 成本 / 回退 / 开关
- **常态零新增 LLM 调用**:复用 `anchor_reconcile` 每回合已有的 judge call,只在其输出 schema 加 `estimated_chapter` + 喂窗口章 summary。窗口内有 pending 锚点时(绝大多数回合),估章纯搭便车。
- **唯一新增成本场景**:窗口(默认 50 章)内**无任何 pending 锚点**的稀疏空白段——为兑现「估章不依赖 pending」(根治锚点间隔 >50 章的冻结),此时仍发 1 次廉价判定器调用只为估章。属罕见情形;`RPG_PROGRESS_NARRATIVE_ESTIMATE=0` 可整体关闭估章退回纯锚点地板。
- 判定器无 key / 异常 / 备料失败(无 script_id)→ `est=None` 或 est_ctx=None → 本回合纯锚点地板(= 旧行为,零回归)。
- 判定器返回兼容:`parse_llm_json(want=None)` 同时吃下新式 `{reached, current_chapter}` 与廉价模型退回的裸数组 `[{...}]`(裸数组按只含 reached 处理,不丢锚点命中)。

## 6. 存量存档影响
- judge-估章:**无需回填**;存量卡死存档(如 139)下一回合自然推进。
- 不动 `save_anchor_states` 结构。

## 7. 备选(评估后不作首选)
**按章补播种锚点**:给空事件章从 `chapter_facts`(label+summary)确定性补一个粗粒度章级锚点,reconciler 逐章标。
- 优点:锚点是真实数据,更"确定性"。
- 缺点:① 要改播种逻辑 ② 要**回填存量存档**的 `save_anchor_states`(prod 写)③ reconciler 的"事件满足"语义被迫变成"章满足"——其实和 judge 估章是同一份 LLM 工作,却多出一堆行。
- 结论:judge-估章用更少改动达成同效 + 立即救存量;按章播种可作**二级加密**(可选,后续)。

## 8. 回归测试
- clamp 单元:est>ceiling→钳;est<prev→地板赢;est=None→纯锚点;单调不回退。
- ch77 场景:floor=0、误估 77 → 进度 ≤ CAP。
- save 139 场景:floor=1、估 6 → 进度 6。
- judge schema:加 `estimated_chapter` 不破坏既有 anchor 命中解析。

## 9. 决策(用户授权「你拍板」,2026-06-16 已定)
1. **`LOOKAHEAD_CAP = 12`** —— 覆盖事件稀疏弧段(本书 RE 蜂巢线 ch2–8),同时把误估 blast radius 钳在 prev+12。
2. **允许 floor=0 时靠估计推进(钳到 prev+CAP)** —— 必须,否则事件稀疏开局章永不动(正是本 bug)。
3. **只上 judge-估章,不做「按章补播种」** —— 二者填同一缺口,同时上 = 冗余;judge-估章用更少改动达成同效 + 立即救存量。
4. **估章不被 pending 短路挡住**(经评审采纳):窗口内无 pending 也估章(罕见的 >50 章空白段会因此多 1 次廉价调用,可 env 关)。

## 10. 已实现 + 验证(2026-06-16)
- 实现落 `rpg/gm_serving/anchor_reconcile.py`(`_default_judge` 返回 `{reached, estimated_chapter}`、`_normalize_judge_result`、`_load_estimate_context`、`_apply_estimate`、`_reconcile_impl` 重排)。
- 4 路对抗评审(clamp 数学 / 判定器成本门控 / 双写循环依赖 / 回归测试)→ 修齐:裸数组解析回归、估章前置短路、floor 纳入下界、章节地图口径对齐、备料失败关估章、2 条旧测同步、补 `_load_estimate_context` 覆盖。
- 回归测试见 `rpg/tests/unit/test_anchor_reconcile.py`(估章推进/超 CAP 钳顶/低于 prev 不退/env 关/floor 抬 ceiling/normalize 新旧兼容/备料列映射+边界/关估章不连累锚点)。
