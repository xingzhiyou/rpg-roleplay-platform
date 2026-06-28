# rpg/bench — RPG Roleplay 专属 harness 基准框架

用真实用户交互数据,量化迭代 harness(模型 / 提示词 / 管线开关)。离线工具,零运行时影响。

## 三个模式

### 1. 基线 scorecard — 给【当前线上 harness】真实产出打分
```
BENCH_DSN=postgresql://... python -m bench.run_bench --min-turns 5 --out scorecard.json
```
读真实存档已记录的 GM 回复 → 确定性指标 → scorecard(坏指标命中率 / 观测率 / 连续分位 /
worst offenders)。纯 JSON,跨 run 比较 = harness 改动的"涨跌表"。

### 2. replay A/B — 把真实上下文喂【候选 harness】现生成再对比
```
BENCH_DSN=... CAND_KEY=sk-... python -m bench.run_replay \
  --model evomap-deepseek-v4-flash --base-url https://api.evomap.ai/v1 --limit 20
```
基线(线上记录)vs 候选(任意 OpenAI 兼容模型/提示词)在同一批真实上下文上,同一 metrics
并排打分。这是"换模型/换提示词,看谁更好"的引擎。`bench/harness.py` 里换 `system_prompt` /
`OpenAICompatHarness` 参数即换配置。

### 3. 写小说续写基准 — 给真实章节前半,续写,跟真实后半比
```python
from bench.writing import make_continuation_cases, run_writing, render_writing
cases = make_continuation_cases(chapters)      # chapters: [{script_id,chapter,content,canon}]
res = run_writing(cases, candidate_harness)
print(render_writing(res))
```
数据自带 ground truth(真实后文)。指标:style_overlap(与真实后文 4-gram Jaccard)/
canon_drift(凭空人名)/ prefix_copy(抄前文)/ gen_repeat / length_ratio。

## 扩展点

- **加指标**:`bench/metrics.py` 里 `@metric("name", {field: kind})` 装饰一个 `metric(resp, ctx)->dict`。
  kind: `bad_rate`(布尔,越低越好)/ `lower` / `higher` / `info`。
- **加 harness**:`bench/harness.py` 里实现 `Harness.generate(case)->str`(或复用 `OpenAICompatHarness`)。

## 确定性指标(首版,FP-safe)

degeneration(复读)· language(整轮降级)· ooc(出戏/AI 自曝)· protocol(ops/工具泄漏)·
length(截断/失控,排除澄清轮)· canon(接地)· unknown_speaker(凭空说话者)· prior_echo(复述上一轮)。

> ⚠️ 指标也得对着真实数据校准 —— latin_burst / too_short / leak 首版都误伤过(见 git 历史)。
> ⚠️ 语义矛盾类(死者复活 / 关系反转 / 语气漂移)确定性撞精度-召回墙不可靠,**不进确定性核心**,
> 归"可选 LLM 裁判层"(确定性最多当紧规则预筛)。
> ⚠️ 无人工质量标注 → 指标是代理/自动信号(测一致/接地/遵循/退化),"文笔好不好/好不好玩"需
> 模型裁判 rubric(后接)。

## 隐私

基准仅内部用;原始用户正文不发布、不外泄。replay/写作经外部模型会把上下文发给该 provider(数据处理决策,需符合隐私政策)。在 prod 跑:scp `bench/` 到服务器 `.venv` 跑,只取回聚合 findings。
