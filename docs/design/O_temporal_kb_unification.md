# O — 统一时间感知知识库(Temporal Knowledge Base)迁移方案

> 状态:设计定稿(待审阅 → 实施)
> 作者:首席架构师
> 关联前序设计:A0/A(摄入·提取)、BC(规范层 KB + 世界树)、D(GM serving)、L(进度感知卡)、M(进度推进信号)、N(剧本编辑器)
> 下游真相基准:`docs/design/AUDIT_ground_truth.md`
> 当前 DB 迁移最高版本 = **v73**,本方案新表/新列从 **v74** 起编号

---

## 0. 一句话目标

把当前**五张并行子系统**(动态人设 `character_cards` / 时间线锚点 `script_timeline_anchors`+`save_anchor_states` / 世界书 `worldbook_entries` / 章节原文派生链 `script_chapters`→`document_chunks`→`chapter_facts` / 规范层 `kb_canon_entities`)收敛成**一层逻辑统一的「KB 节点 + 类型 + 时间标签 + 关系边 + 揭示状态 + 向量」模型**;用**「已到达锚点前沿(reached-set / DAG frontier)」**替代脆弱的标量 `progress_chapter` 作为揭示天花板;**退役事后「猜章号」判定器**(overshoot 源);全程**前端零改动**(API 契约由适配视图/适配层保住)。

铁律(贯穿全文,不可破):
- **A. API 契约稳定** —— 第 7 节兼容性映射表里列出的字段一个都不能删/改名/改类型。后端可以重构地基,前端不动一行。
- **B. 确定性原则** —— 进度推进、揭示门控、召回打分、向量召回必须是**确定性代码**。LLM(GM)只能做三件事:声明「发生了什么」、标记「哪条锚点到达/被改写」、在分叉时「新建一条锚点」。**GM 永不猜进度、永不决定能看什么**。
- **C. 线性叙事 + 防剧透** —— 揭示天花板 = **已到达锚点前沿**(集合/DAG frontier),不是单调整数。既保线性,又原生支持分叉/平行/穿越/倒叙。
- **D. 退役 overshoot** —— 删掉「读正文估当前第几章」的事后判定路径(`anchor_reconcile._apply_estimate`),改为「GM 显式声明到达哪条锚点 → 确定性代码把该锚点纳入前沿」。

---

## 1. 统一数据模型

### 1.1 设计取向:一张「节点表 + 边表」的逻辑层,物理上加性叠加

不推倒五张现有表(它们各自带着前端契约、提取写路径、护手编辑语义)。而是在它们之上**抽象出统一的节点/边视图**,并新建**两张真正承载「时间感知 + 揭示前沿」的薄表**:

- 新建 `kb_nodes`(统一节点登记表,可选物化,默认是**视图**)—— 给召回层一个单一入口。
- 新建 `kb_edges`(统一关系边表,**真表**)—— 把 `chapter_facts.relationships`(已存在但 GM 从未消费)+ `kb_canon_entities.parent_logical_key` + 角色卡关系投影**全部行级化**,这是本迁移的**核心价值点**。
- 新建 `reveal_anchors`(剧本级**揭示锚点 DAG**,真表)+ `save_reveal_frontier`(存档级**已到达前沿**,真表)—— 替代 `progress_chapter` 标量做天花板。
- `script_timeline_anchors` / `save_anchor_states` **保留不动**,作为 `reveal_anchors` / `save_reveal_frontier` 的**上游 seed + 前端时间线 DTO 数据源**;新表从它们确定性回填。

五者各自映射成什么:

| 子系统 | 现表 | 映射成 KB 节点类型 | 时间标签来源 | 关系边贡献 | 揭示状态来源 | 向量 |
|---|---|---|---|---|---|---|
| 动态人设 | `character_cards` | `node_kind='character'`(card_type→subtype npc/pc/persona) | `first_revealed_chapter` → 绑 reveal_anchor | 角色↔角色关系投影写 `kb_edges(kind='relationship')` | `reveal_anchor_key`(由 first_revealed_chapter 回填) | `embedding_vec` |
| 规范实体 | `kb_canon_entities` | `node_kind='canon_entity'`(type→subtype char/faction/location/concept/item/event) | `first_revealed_chapter` | `parent_logical_key` → `kb_edges(kind='parent')` | `reveal_anchor_key` | `embedding`(统一改名→见 §5) |
| 世界书 | `worldbook_entries` | `node_kind='worldbook'` | `first_revealed_chapter`(+ `metadata.chapter_min`) | keys/regex 命中实体 → `kb_edges(kind='mentions')` | `reveal_anchor_key` | `embedding_vec` |
| 章节原文 chunk | `document_chunks` | `node_kind='chunk'` | `chapter_index`(直接是章号) | chunk↔chapter `kb_edges(kind='in_chapter')` | `chapter_index` → reveal_anchor(按章) | `embedding_vec` |
| 每章事实 | `chapter_facts` | `node_kind='chapter_fact'` | `chapter` + `story_time_label`/`story_phase` | `relationships`/`events.participants` → `kb_edges` | `chapter` → reveal_anchor | (沿用 chunk 召回,不单独嵌) |
| 时间线锚点(剧本) | `script_timeline_anchors` | 不是节点 → seed `reveal_anchors` | `chapter_min/max`+`story_time_label` | DAG 边 `reveal_anchors.requires[]` | —— | —— |
| 锚点状态(存档) | `save_anchor_states` | 不是节点 → seed/同步 `save_reveal_frontier` | `source_chapter`+`status` | —— | —— | —— |

### 1.2 新表 DDL(全部加性,标注新表/新列/视图)

#### (新表) `reveal_anchors` —— 剧本级揭示锚点 DAG(替代「整数天花板」的图骨架)

每条剧本锚点既是「线性叙事的节点」也是「揭示门控的钥匙」。一个节点要被看见 ⇔ 它的 `reveal_anchor_key` 在存档前沿的「已到达可见集」里。

```sql
-- migration v74
create table if not exists reveal_anchors (
  id              bigserial primary key,
  script_id       integer not null references scripts(id) on delete cascade,
  anchor_key      text    not null,              -- 稳定 key, 形如 "ch:{n}:ev:{idx}" 或 editor 自定
  -- 时间标签(多分辨率,允许稀疏)
  chapter_min     integer,                        -- 该锚点对应原著章范围(seed 自 script_timeline_anchors / chapter_facts)
  chapter_max     integer,
  story_phase     text,
  story_time_label text,
  -- DAG 结构(线性 + 分叉/平行/穿越/倒叙)
  requires        jsonb   not null default '[]'::jsonb,  -- 前驱 anchor_key 数组 = 线性序; 多前驱=汇流; 空=根
  worldline_key   text    not null default 'main',       -- 平行/穿越世界线; main=原著主线
  kind            text    not null default 'beat',       -- beat|fork|merge|parallel|flashback|birthpoint
  -- 内容(给 GM 注入的「接下来会发生」)
  summary         text,
  must_preserve   jsonb   not null default '{}'::jsonb,
  may_vary        jsonb   not null default '{}'::jsonb,
  importance      integer not null default 50,
  is_fatal        boolean not null default false,        -- 死神来了: 不可被 supersede
  confidence      numeric(4,3),
  source          text    not null default 'novel',      -- novel(ETL) | editor(人工) | gm(分叉时新建)
  metadata        jsonb   not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (script_id, anchor_key)
);
create index if not exists idx_reveal_anchors_script on reveal_anchors(script_id);
create index if not exists idx_reveal_anchors_chapter on reveal_anchors(script_id, chapter_min, chapter_max);
create index if not exists idx_reveal_anchors_worldline on reveal_anchors(script_id, worldline_key);
-- requires GIN 用于「找某锚点的后继」
create index if not exists idx_reveal_anchors_requires on reveal_anchors using gin (requires);
```

> 关键:`reveal_anchors` 是 `script_timeline_anchors` 的**超集骨架**。两者并存,不删旧表。`reveal_anchors` 从 `script_timeline_anchors` + `chapter_facts.events`(按 importance)确定性回填(见 §6 P1)。`requires` 让「线性序」从单调整数升级成 **DAG 偏序**:主线是一条链,分叉/穿越是新增带新 `worldline_key` 的子图,倒叙是 `chapter_min` 小但 `requires` 指向后发生锚点的节点。

#### (新表) `save_reveal_frontier` —— 存档级「已到达前沿」(替代 `progress_chapter` 做天花板)

```sql
-- migration v74
create table if not exists save_reveal_frontier (
  id            bigserial primary key,
  save_id       integer not null references game_saves(id) on delete cascade,
  script_id     integer not null,
  anchor_key    text    not null,
  reached_at_turn integer,
  reached_via   text    not null default 'gm',   -- gm(声明) | player(显式satisfy) | seed(出生点) | rewind(回退保留)
  drift_score   numeric(3,2) default 0,
  worldline_key text    not null default 'main',
  metadata      jsonb   not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (save_id, anchor_key)
);
create index if not exists idx_frontier_save on save_reveal_frontier(save_id);
create index if not exists idx_frontier_worldline on save_reveal_frontier(save_id, worldline_key);
```

> **这是天花板的新载体。** 「玩家能看到节点 X」⇔「X.reveal_anchor_key 的传递闭包 ⊆ 当前存档前沿的可见集」。前沿是**集合**,不是整数:支持分叉(前沿在某点分两枝)、平行(多 worldline_key 同时在前沿)、穿越/倒叙(前沿可包含高章号锚点而不污染低章号的可见性,因为按 DAG 可达性而非数值比较)。

#### (新表) `kb_edges` —— 统一关系边(把闲置的 relationships jsonb 行级化)

```sql
-- migration v74
create table if not exists kb_edges (
  id            bigserial primary key,
  script_id     integer not null references scripts(id) on delete cascade,
  save_id       integer,                          -- NULL=剧本规范边; 非NULL=存档活态边(COW)
  born_commit   bigint,                           -- 活态边的分支隔离键 → branch_commits.id
  retired_at_commit bigint,
  src_kind      text    not null,                 -- 节点类型(同 §1.3 node_kind)
  src_key       text    not null,                 -- logical_key / card name / anchor_key / 'chapter:{n}'
  dst_kind      text    not null,
  dst_key       text    not null,
  kind          text    not null,                 -- relationship|parent|mentions|in_chapter|participates|located_at|reveals
  label         text,                             -- 关系语义(如 "师徒"/"敌对")
  note          text,
  weight        numeric(6,3) default 1.0,
  first_revealed_chapter integer default 0,       -- 边本身也可有揭示门控(关系到第N章才揭露)
  reveal_anchor_key text,                         -- 边的揭示锚点(优先于上面整数)
  origin        text    not null default 'extracted', -- extracted|editor|player|canon
  metadata      jsonb   not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (script_id, save_id, src_kind, src_key, dst_kind, dst_key, kind)
);
create index if not exists idx_kb_edges_src on kb_edges(script_id, src_kind, src_key);
create index if not exists idx_kb_edges_dst on kb_edges(script_id, dst_kind, dst_key);
create index if not exists idx_kb_edges_kind on kb_edges(script_id, kind);
create index if not exists idx_kb_edges_save on kb_edges(save_id) where save_id is not null;
```

> `kb_edges` 一次性解决调研里反复出现的痛点:`chapter_facts.relationships`(source/target/note)从未被 GM 消费、`parent_logical_key` 无 FK 纯文本自连、角色卡关系投影散落在运行时。全部确定性回填进这张表(§6 P2),GM 工具 `graph_neighbors(entity)` 第一次有真数据。

#### (视图,非物化) `kb_nodes` —— 统一节点入口

不复制数据,用 `UNION ALL` 把五张源表投影成同构行。召回层只查这个视图 + `kb_edges` + `save_reveal_frontier`。

```sql
-- migration v74  (CREATE OR REPLACE VIEW, 零数据搬运)
create or replace view kb_nodes as
  select 'canon_entity'::text as node_kind, cce.script_id, cce.logical_key as node_key,
         cce.name, cce.type as subtype, cce.summary as body,
         cce.first_revealed_chapter,
         (cce.metadata->>'reveal_anchor_key') as reveal_anchor_key,
         cce.embedding as embedding_vec,           -- 统一暴露为 embedding_vec(见 §5 列名收敛)
         cce.public_knowledge, cce.importance, cce.aliases, cce.metadata
    from kb_canon_entities cce where cce.importance >= 0   -- 过滤软删 importance=-1
  union all
  select 'character', cc.script_id, cc.name, cc.name, cc.card_type,
         coalesce(cc.identity, cc.personality),
         cc.first_revealed_chapter,
         (cc.metadata->>'reveal_anchor_key'),
         cc.embedding_vec,
         false, cc.importance, cc.aliases, cc.metadata
    from character_cards cc where cc.card_type='npc' and cc.enabled
  union all
  select 'worldbook', wb.script_id, wb.title, wb.title, wb.insertion_position,
         wb.content, wb.first_revealed_chapter,
         (wb.metadata->>'reveal_anchor_key'),
         wb.embedding_vec,
         false, wb.priority, '[]'::jsonb, wb.metadata
    from worldbook_entries wb where wb.enabled;
  -- chunk / chapter_fact 不进 kb_nodes 视图(它们章号即天花板,走原章窗口召回,见 §4)
```

#### (新列,加在现有表上,全部 `ADD COLUMN IF NOT EXISTS`)

```sql
-- migration v74: 给三张实体表补「揭示锚点」列(优先于整数 first_revealed_chapter)
alter table kb_canon_entities add column if not exists reveal_anchor_key text;  -- 也可只存进 metadata, 见兼容性
alter table character_cards   add column if not exists reveal_anchor_key text;
alter table worldbook_entries add column if not exists reveal_anchor_key text;

-- 区分「真·第0章揭示」vs「未知揭示章」(根治 first_revealed_chapter=0 双语义痛点)
alter table character_cards   add column if not exists reveal_known boolean not null default false;
alter table kb_canon_entities add column if not exists reveal_known boolean not null default false;
alter table worldbook_entries add column if not exists reveal_known boolean not null default false;
-- reveal_known=false ⇒ 0 表示"未知,保守可见"; reveal_known=true ⇒ first_revealed_chapter 是真实揭示章

-- 向量卫生: 脏化标记(根治"编辑后向量永过期" + "重做秒完成")
alter table worldbook_entries add column if not exists embedding_dirty boolean not null default false;
alter table character_cards   add column if not exists embedding_dirty boolean not null default false;
alter table kb_canon_entities add column if not exists embedding_dirty boolean not null default false;
alter table document_chunks   add column if not exists embedding_dirty boolean not null default false;
-- 统一向量空间指纹(切 embedder 后判脏)
alter table scripts add column if not exists embed_space_fingerprint text;  -- = hash(embed_api_id|embed_model|EMBED_DIM)
```

### 1.3 节点类型枚举(`node_kind`)与子类型

```
node_kind        subtype 取值
-----------      --------------------------------------------
canon_entity     character | faction | location | concept | item | event
character        npc | pc | persona          (= card_type)
worldbook        worldbook | constant | vector | keyed   (= insertion_position)
chunk            (无 subtype, 按 chapter_index 定位)
chapter_fact     (无 subtype, 按 chapter 定位)
```

边类型(`kb_edges.kind`):`relationship`(角色↔角色) / `parent`(层级:门派→分舵) / `mentions`(世界书↔实体) / `in_chapter`(实体↔章) / `participates`(实体↔事件) / `located_at`(实体↔地点) / `reveals`(锚点↔它解锁的节点)。

---

## 2. 相关性与关系

### 2.1 节点之间如何产生相关性(确定性回填,非 LLM)

相关性来自三种确定性信号,全部物化进 `kb_edges`:

1. **共现(co-occurrence)** —— `chapter_facts.events[].participants` 同一事件里出现的实体两两建 `participates`/`relationship` 边;`chapter_facts.characters` 出现在第 N 章 → `in_chapter` 边(章号即时间标签)。这把「某角色出现在哪些章」从全表扫(现痛点)变成 `kb_edges WHERE dst_kind='chapter'` 的索引查。
2. **结构(structure)** —— `kb_canon_entities.parent_logical_key` → `parent` 边;`character_cards` 关系投影(现在散在 `project_character_state`)→ `relationship` 边。
3. **文本(textual)** —— `worldbook_entries.keys/regex_keys` 与实体名/别名匹配 → `mentions` 边(确定性字符串匹配,建库时算一次)。

### 2.2 召回打分(确定性公式)

每个候选节点的最终分 = 三路加权和(权重是常量,可 env 调,默认值固定):

```
score(node) =
    W_vec   * cosine(query_vec, node.embedding_vec)        -- 语义(pgvector,统一空间)
  + W_kw    * keyword_hits(node, scan_text) * priority_norm -- 关键词命中(沿用现 priority+len*6 逻辑)
  + W_graph * graph_proximity(node, active_entities)        -- 图邻近: 与当前在场实体的边距(1跳=1.0,2跳=0.4)
  + W_recency * recency(node.chapter, current_frontier_ceil)-- 时近: 越靠近前沿越相关
其中所有项在 [0,1] 归一; W_vec=0.45, W_kw=0.25, W_graph=0.20, W_recency=0.10 (常量)
```

> `graph_proximity` 是 `kb_edges` 带来的新能力:GM 上下文里出现某 NPC 时,与它直接有 `relationship` 边的角色、它 `located_at` 的地点、它所属 `parent` 门派会被自动拉高分召回。这是「让闲置关系图真正被 GM 用到」的落点。

### 2.3 关系边怎么用

- **召回阶段**:`graph_proximity` 项(见上)。
- **注入阶段**:`graph_neighbors` GM 工具直接读 `kb_edges`,返回结构化邻居(不是片段猜测)。层级图注入(现 `retrieval.py:738-812` 的 CTE self-join)改读 `kb_edges WHERE kind='parent'`,去掉脆弱的纯文本自连。
- **揭示阶段**:边自己也有 `reveal_anchor_key`,「关系到第 N 章才被揭露」可以确定性门控(如「A 是 B 的私生子」这条边到揭秘章才进上下文)。

---

## 3. 线性叙事保证(前沿替代标量)

### 3.1 前沿(reached-set / DAG frontier)的定义

```
Frontier(save) = { anchor_key | row in save_reveal_frontier where save_id = save }   -- 已到达集合
VisibleSet(save) = TransitiveClosureOfRequires(Frontier)                              -- 已到达 + 其所有前驱
RevealCeiling(node) = node.reveal_anchor_key                                          -- 节点要求的钥匙

node 可见 ⇔ node.reveal_anchor_key IS NULL                  -- 无门控(始终可见,= 旧 reveal_known=false 语义)
          OR node.reveal_anchor_key ∈ VisibleSet(save)      -- 钥匙已在可见集
          OR mode = 'omniscient'                            -- 上帝视角豁免
          OR (mode='partial' AND node.public_knowledge)     -- 穿越者模糊先知
```

确定性物化:`VisibleSet` 用一条递归 CTE 算(`reveal_anchors.requires` 偏序),或维护物化表 `save_visible_anchors`(增量:每加入一个前沿锚点,把它的前驱闭包并进去)。**召回 SQL 不再写 `first_revealed_chapter <= 标量`,改写 `reveal_anchor_key IN (SELECT anchor_key FROM save_visible_anchors WHERE save_id=%s)` 或 `reveal_anchor_key IS NULL`。**

> 为什么这保线性又防剧透:可见性是 DAG **可达性**判断,不是数值比较。第 80 章的伏笔锚点即使 `chapter_min=80`,只要它不在玩家前沿的可达集里就不可见——哪怕玩家因穿越剧情前沿里有某个 `chapter_min=200` 的锚点。整数天花板做不到这点(200 > 80 必放行 = 剧透)。

### 3.2 GM 如何维护前沿(mark / supersede / create —— 这是 GM 仅有的三种权力)

GM 通过 `command_dispatcher`(scope=user,(user,save) 锁保护)调三类工具,**全部是声明,不做计算**:

1. **mark(到达)** —— `mark_anchor_reached(anchor_key)`:确定性代码把该 `anchor_key` INSERT 进 `save_reveal_frontier`(reached_via='gm'),并把其 `requires` 闭包并入 `save_visible_anchors`。**前沿只增不减**(回退只走 rewind 端点)。
2. **supersede(改写)** —— `mark_anchor_superseded(anchor_key, drift, variant_desc)`:玩家把原著事件改写了。锚点进前沿但标 `drift_score`>0;`is_fatal=true` 锚点拒绝 supersede(死神来了,必须经历)。
3. **create(分叉)** —— `fork_anchor(new_key, requires=[当前前沿锚点], worldline_key, summary)`:玩家走出原著没有的剧情。GM 新建一条 `reveal_anchors` 行(source='gm',新 `worldline_key`),并立刻 mark 进前沿。**这就是「跳新剧情 + 引到新锚点」的机制**:新锚点的 `requires` 指向分叉点,后续召回/引导以新 worldline 的锚点为软目标。

> 对照铁律 B/D:GM 永远只说「我到了 ch:12:ev:3」或「我新建了 fork:player_saved_villain」,**确定性代码**决定这对可见集意味着什么。退役的 `_apply_estimate`(读正文猜「现在大概第几章」)被删除——它是 overshoot 的唯一来源,且违反铁律 B。

### 3.3 分叉时如何「跳新剧情 + 引到新锚点」

```
玩家做出原著没有的选择
      │
      ▼
GM 调 fork_anchor(new_key="fork:X", requires=[frontier_tip], worldline_key="wl:player_1")
      │  (确定性代码新建 reveal_anchors 行 + mark 进前沿)
      ▼
下一回合 steering(gm_serving/steering.py): resolve_steering_target 读
  reveal_anchors WHERE worldline_key='wl:player_1' AND requires OVERLAP 当前前沿
  → next_node = 新世界线上的下一个软目标
      │
      ▼
召回层: 候选节点按「与新 worldline 锚点的 graph_proximity」加权 → 优先召回分叉相关素材
原主线锚点不再作为硬目标,但仍可见(已到达部分),GM 可在叙事上"回归"或"彻底分叉"
```

平行/穿越:同一存档前沿可同时含多个 `worldline_key` 的锚点(玩家在两条时间线间切换);倒叙:`fork` 一个 `chapter_min` 较小但 `requires` 指向当前前沿的 flashback 锚点,可见性由 DAG 保证不剧透。

### 3.4 确定性门控如何防剧透(三处统一收口)

调研里 `progress_chapter` 被硬引用的 5 处 + 关键词/常量层 2 个无门控缺口,**全部收口到一个函数** `reveal_clause_v2(save_id, mode, prefix='')`(替代 `_reveal_clause`),返回 SQL 片段:

```sql
-- mode='none':
  ({prefix}reveal_anchor_key is null
   or {prefix}reveal_anchor_key in (select anchor_key from save_visible_anchors where save_id=%s))
-- mode='partial': 上 + or {prefix}public_knowledge
-- mode='omniscient': true
```

收口点(全改成调 `reveal_clause_v2`):
1. `kb/canon_repo.py:read_canon_entities/lookup_canon_entity`
2. `platform_app/knowledge/_search.py:_search_entities`(character_cards + worldbook_entries 向量召回)
3. `context_engine/loaders.py:_load_characters_db`
4. `context_engine/loaders.py:_load_worldbook_db` + `formatters.py:_active_worldbook`(**修复关键词激活无门控缺口**)
5. `gm_serving/context_inject.py:build_constant_layer`(**修复常量层无门控缺口**:常量层 WHERE 追加 reveal_clause)
6. `gm_serving/steering.py:read_worldline_nodes`
7. `retrieval.py` 层级图 CTE + `_load_worldbook_for_retrieval`

> 注意:`document_chunks`/`chapter_facts` 仍按 **章窗口**门控(它们的「揭示锚点」就是章号本身),章窗口的上界 = 前沿可见集里锚点的 `MAX(chapter_max)`(确定性派生,不是 GM 猜的)。这保留了原文召回的时间线顺序语义。

---

## 4. 召回 / 注入统一层

### 4.1 一套代码召回所有 KB 节点

新建 `kb/recall.py:recall(save_id, query, *, mode, token_budget, db) -> RecallResult`,取代散落在 `retrieval.py`(600+ 行 8 步)、`_search.py`、`context_inject.py`、`loaders.py`、`formatters.py` 的多入口。统一流程:

```
recall(save_id, query):
  1. frontier   = load_frontier(save_id)            # save_reveal_frontier
     visible     = visible_anchors(frontier)          # save_visible_anchors(物化或CTE)
     ceil_chap   = max chapter_max of visible anchors # 章窗口上界(确定性)
  2. clause      = reveal_clause_v2(save_id, mode)     # 单一门控
  3. 并联召回 (全走 kb_nodes 视图 + kb_edges):
       a. vector  : kb_nodes WHERE clause ORDER BY embedding_vec <=> qvec  (统一向量空间)
       b. keyword : kb_nodes WHERE clause AND keys/name match scan_text
       c. graph   : kb_edges 从 active_entities 扩 1-2 跳,拉邻居节点 (WHERE clause)
       d. chunks  : document_chunks WHERE chapter_index <= ceil_chap (章窗口, 向量+ILIKE双路)
       e. facts   : chapter_facts WHERE chapter <= ceil_chap
  4. 打分: score() 公式(§2.2)合并去重
  5. token 预算: 按 score desc + node.token_budget 贪心填到 budget, constant 层优先保底
  6. 组装成 ContextContribution(priority 不变, 见 §7), 交 context_engine/build_context_bundle
```

### 4.2 注入 GM(契约保持)

`recall()` 的输出仍包装成现有的 `ContextContribution`(priority=40 RAG body / 70 worldbook / 72 anchor_pending / 常驻层),`context_engine/build_context_bundle` 不变,`bundle['prompt']` 结构不变 → **GM 侧和 chat_pipeline 零改动**。`assemble_gm_context`(Phase D)内部改读统一层,但函数签名/返回 dict 键(`injection_text/tokens/budget/steering/...`)不变。

> 重构 `_split_anchor_pending` 的脆弱字符串切割(现痛点):统一层直接产出独立的 anchor_pending contribution,不再从拼接文本里用 marker 反切。

---

## 5. 嵌入 / 向量一致性

### 5.1 统一向量空间

- **列名收敛**:`kb_canon_entities.embedding` 在 `kb_nodes` 视图里**对外暴露为 `embedding_vec`**(视图别名),物理列名可保留(零迁移风险),也可在 P3 加 `embedding_vec` 影子列同步写。四张表(chunks/cards/worldbook/canon)逻辑上统一成 `vector(EMBED_DIM=768)`,HNSW cosine。
- **空间指纹**:`scripts.embed_space_fingerprint = hash(embed_api_id|embed_model|EMBED_DIM)`。召回时若 query 用的 embedder 指纹 ≠ 建库指纹 → 拒绝向量路径,降级 BM25(避免现痛点「不同空间余弦距离无效」静默错召回)。

### 5.2 KB 卫生:编辑脏化 + 重做强制重嵌

**根治调研里两个确认 bug + 「编辑后重做秒完成」**:

1. **编辑节点 → 脏化向量**:任何写路径(`api_worldbook_update`、canon PUT、卡 upsert、`_sync` 护手编)当 `content/title/identity/summary/name` 变化时,确定性追加:
   ```sql
   SET embedding_vec = NULL, embedding_dirty = true, embedded_at = NULL
   ```
   这一条同时修复 Bug 1(向量永过期:增量循环 `WHERE embedding_vec IS NULL` 现在能捡到)。
2. **重做 → 强制重嵌**:`/rebuild/embeddings` 加 `force` 语义(或 `include` 命中即视为 force):先
   ```sql
   UPDATE <table> SET embedding_vec=NULL, embedding_dirty=true WHERE script_id=%s AND <module命中>
   ```
   再跑增量循环。这修复 Bug 2(重做秒完成空操作)。**「世界书编辑后重做秒完成」的根因正是 Bug1+Bug2 叠加**:编辑没脏化 → 行仍有旧向量 → 重做的增量查询 `WHERE embedding_vec IS NULL` 命中 0 行 → 秒完成。脏化 + force 双修后,编辑过的条目重做时被强制重嵌,行为符合预期。
3. **embed 状态计数修正**:`embed_status` 的 done/total 改成 `done = COUNT(embedding_vec IS NOT NULL AND NOT embedding_dirty)`,区分「新建待嵌」与「编辑后过期」,前端不再看到「100% 但其实过期」。

---

## 6. 迁移方案(分阶段,env flag 可回滚)

总开关:`RPG_TEMPORAL_KB`(default `off`)。每阶段独立 flag,可单独回滚。**所有阶段对前端透明**(契约由旧表/视图/适配层保住)。

### P0 — 地基(纯加性,零行为变化)
- **改什么**:跑 v74 migration(建 `reveal_anchors`/`save_reveal_frontier`/`kb_edges`/`save_visible_anchors` 物化表 + 新列 + `kb_nodes` 视图)。
- **数据回填**:无(空表)。新列默认值不影响现有读路径。
- **契约稳定**:无读路径改动。
- **回滚**:`DROP` 新表/新列(加性,安全)。
- **风险**:极低。HNSW 索引建立耗时(大库),后台建。

### P1 — 揭示锚点回填(`reveal_anchors` ← 现有时间线)
- **改什么**:确定性 ETL `backfill_reveal_anchors(script_id)`:从 `script_timeline_anchors` + `chapter_facts.events`(importance 排序)生成 `reveal_anchors` 行,`requires` 按章序连成主线链(`worldline_key='main'`);`anchor_key` 与 `save_anchor_states.anchor_key` 对齐(复用 `ch:{n}:ev:{idx}` 格式)。区分 `reveal_known`(根治 0 双语义)。
- **数据回填**:每剧本跑一次,幂等(ON CONFLICT)。
- **契约稳定**:`reveal_anchors` 只写不读(P1 不切召回)。前端 timeline 仍读旧 `script_timeline_anchors`。
- **回滚**:`TRUNCATE reveal_anchors`,flag `RPG_TKB_ANCHORS=off`。
- **风险**:回填质量依赖现有锚点质量;**保守策略**:回填失败的剧本 `reveal_anchor_key` 留 NULL = 始终可见(不剧透回归,只是不增强)。

### P2 — 关系边回填(`kb_edges` ← chapter_facts/parent/卡关系)
- **改什么**:`backfill_kb_edges(script_id)`:`chapter_facts.relationships`→relationship 边、`events.participants`→participates+co-occur 边、`parent_logical_key`→parent 边、`worldbook.keys`匹配→mentions 边、`characters`按章→in_chapter 边。
- **数据回填**:每剧本一次,幂等。
- **契约稳定**:`kb_edges` 此阶段只供新召回层用,旧路径不读。GM 工具 `graph_neighbors` 可灰度切到读 `kb_edges`(flag `RPG_TKB_EDGES`)。
- **回滚**:`TRUNCATE kb_edges`,flag off → `graph_neighbors` 回退原 view 路径。
- **风险**:边数量大(co-occur 可能爆),建库时按 importance 截断 + 去重唯一约束兜底。

### P3 — 向量卫生 + 统一空间(可独立上线,价值立竿见影)
- **改什么**:写路径加脏化(§5.2);`/rebuild/embeddings` 加 force;`embed_status` 计数修正;`scripts.embed_space_fingerprint` 回填 + 召回侧指纹校验降级;canon `embedding` 影子列 `embedding_vec` 同步。
- **数据回填**:回填 fingerprint;**一次性全量脏化重嵌**(用户感知 = 卡过期向量被修)。
- **契约稳定**:`embed_status` 返回体字段名不变(done/total 语义修正,前端无感)。`/rebuild/embeddings` 的 `include` body 不变。
- **回滚**:flag `RPG_TKB_HYGIENE=off`(脏化列保留但不参与;增量循环回退原 `WHERE IS NULL`)。
- **风险**:全量重嵌成本(钱)。分批 + 后台任务浮窗(已有 `GET /api/me/tasks/active`)展示进度。
- **独立价值**:**P3 可先于 P4 单独上线**——它直接修三个用户可感 bug,不依赖前沿改造。

### P4 — 前沿门控切换(`progress_chapter` → 前沿,核心)
- **改什么**:`save_reveal_frontier` 从 `save_anchor_states`(occurred/variant)确定性回填;`_reveal_clause`→`reveal_clause_v2`(7 处收口);GM 工具 `mark_anchor_satisfied`→也写前沿;**删除 `anchor_reconcile._apply_estimate` 猜章路径**(退役 overshoot)。
- **数据回填**:每存档 `seed_frontier(save_id)`:把 occurred/variant 锚点写入前沿 + 算可见闭包进 `save_visible_anchors`。
- **契约稳定**(**前端零改动关键**):
  - `progress_chapter` **不删**——保留为**派生只读视图字段** `progress_chapter = MAX(chapter_max of visible anchors)`,由前沿确定性算出,写进 `game_sessions.worldline`(供任何还读它的旧代码 + `GET /api/v1/state` 的 `world.timeline`)。前端读到的 `current_chapter`/`progress` 数值语义不变。
  - `GET /api/saves/{id}/timeline` DTO(`script_anchors`/`save_phases`/`current_chapter`)由适配层从 `reveal_anchors`+`save_reveal_frontier` 重新组装,**字段名/形状逐一保持**(含 `anchor_id` vs `id` 双名、`chapter_min/max`)。
  - `GET /api/saves/{id}/anchors` DTO(`summary`/`by_phase`/`recent_pending`/`recent_occurred` + `convergence_pressure`/`is_fatal`/`drift_score`)由前沿 + reveal_anchors 适配出,**3 处裸 fetch 的路径与字段全部不动**。
  - `POST .../satisfy`、`POST .../progress/rewind` 端点保留:satisfy→写前沿;rewind→从前沿移除 `chapter > target` 的锚点并重算可见集(前沿**可回退仅经此端点**)。
- **回滚**:flag `RPG_TKB_FRONTIER=off` → `reveal_clause_v2` 内部回退成 `first_revealed_chapter <= progress_chapter`(双实现一函数,运行时分支),`_apply_estimate` 用 flag 包住可复活。**这是最高风险改动,双实现共存一个 release,灰度按 save 切。**
- **风险**:门控语义变化可能漏放/错放节点 → 大量回归测试(§8)+ 影子比对(同一回合两套门控结果 diff 落日志,人工核对后才切)。

### P5 — 召回统一层 + 清理
- **改什么**:`kb/recall.py` 统一入口替换 8 步 `retrieve_context`;`_split_anchor_pending` 文本切割退役;`graph_proximity` 打分接 `kb_edges`;层级图改读 `kb_edges`。
- **契约稳定**:输出仍是 `ContextContribution`,bundle 结构不变。
- **回滚**:flag `RPG_TKB_RECALL=off` 回退旧 `retrieve_context`。
- **风险**:召回结果集变化 → A/B token 用量与召回命中对比,守住「不漏召回」。

### 「现有前端零改动」如何做到(总纲)
1. **不删任何旧表**(旧表是契约的物理底座 + 回滚锚)。
2. **`progress_chapter` 降级为派生只读字段**,继续出现在 `GET /api/v1/state`。
3. **所有前端读端点用适配层/视图**从新表重组出**逐字段同构**的旧 DTO(含历史多态:数组/`{entries}`/`{items}`、`anchor_id`/`id`、`nodes`/`commits`、`job_id`/`id` 全保留)。
4. **3 处裸 fetch 的硬编码路径不变**(`/api/saves/{id}/anchors|timeline|settings|progress/rewind`)。
5. **`GET /api/v1/state` 顶层键集冻结**(`emptyGameStateFallback()` 的骨架是最硬边界,不增不删顶层键)。

---

## 7. 兼容性映射表(前端组件/端点 → 迁移后由什么支撑,契约不变)

| 前端组件 / 端点 | 现数据源 | 迁移后支撑 | 契约保障 |
|---|---|---|---|
| `GET /api/v1/state`(超级胖端点) | `game_sessions.worldline` jsonb | 不变;`progress_chapter` 改派生只读写回 worldline | 顶层键集冻结,`world.timeline.{current_label,current_phase,anchor_state}` 不动 |
| `PanelCharacters` 读 `state.active_entities` | `_sync_active_entities_from_bundle` | 不变;bundle 的 npc_cards 层由统一召回填 | `{id,name,kind,disposition,source,card_id,identity,avatar_path}` 逐字段保留 |
| `GET /scripts/{sid}/worldbook` | `worldbook_entries` | 不变(同表);适配层兼容三态返回 | `id/title/content/enabled/priority` + 数组/`{entries}`/`{items}` 全留 |
| `GET /scripts/{sid}/cards`+`/{id}` | `character_cards` | 不变(同表) | `id/name/full_name/avatar_path`(+详情 description/personality)留 |
| `GET /saves/{id}/anchors`(裸 fetch) | `save_anchor_states` | 适配层从 `save_reveal_frontier`+`reveal_anchors` 重组 | `summary/by_phase/recent_pending/recent_occurred` + `convergence_pressure/is_fatal/drift_score/how_it_happened` 逐字段 |
| `POST /saves/{id}/anchors/{key}/satisfy`(裸 fetch) | `command_tools_anchors` | 改写前沿 `save_reveal_frontier` | body 空,响应 `{ok:true}`,`anchor_key` URL 段大小写敏感保留 |
| `GET /saves/{id}/timeline`(裸 fetch) | `routes/timeline.py` 双线 DTO | 适配层从 `reveal_anchors`(script_anchors)+前沿/phase_digests(save_phases) | `script_anchors[]`/`save_phases[]`/`current_chapter` 字段名不动 |
| `POST /saves/{id}/progress/rewind`(裸 fetch) | `advance_progress` 逆操作 | 前沿移除 `chapter>target` + 重算可见集 + 派生 progress_chapter | body `{target_chapter}`,响应 `{ok:true}` |
| `GET /saves/{id}/settings`(裸 fetch) | `gm_serving/settings` | 不变 | `settings.steering_strength` 枚举 rail/guided/free 不动 |
| `PanelTimeline` 三态(isDone/isCurrent/isPending) | `timeline` DTO 的 chapter_max/current_chapter | 同上适配层,数值语义不变 | 渲染逻辑零改 |
| `WorldlineAnchorsSection` is_fatal/convergence | `/anchors` DTO | `reveal_anchors.is_fatal` + 前沿 pending 统计 | 高亮/致命提示逻辑零改 |
| `GET /scripts/{sid}/timeline` | `scripts.py:289-348` phase 聚合 | 适配层从 `reveal_anchors` GROUP BY story_phase | `phases[].anchors[].{anchor_id,story_time_label,chapter_min,chapter_max,sample_summary}` + `anchor_id`/`id` 双名留 |
| `GET /scripts/{sid}/canon-entities`+`/{key}` | `kb_canon_entities` | 不变(同表) | `logical_key/name/type/summary/identity/background/...` + `{entities}`/`{items}` 双名 |
| `GET /scripts/{sid}/chapter-facts` | `chapter_facts`(仅摘要列) | 不变;可选新增 `?include_graph` 暴露 `kb_edges` | 现有摘要字段不动(新字段加性) |
| `GET /scripts/{sid}/modules-status` | 各模块 done/total | 加 `reveal_anchors`/`kb_edges` 模块?**否**——不新增 module 名(前端枚举 7 个写死) | 7 个 module 名不变;新模块走内部不暴露 |
| `POST /scripts/{sid}/rebuild/embeddings`{include} | embed loop | 加 force 脏化(§5) | body `{include:[chunks,cards,worldbook,canon]}` 不变 |
| `GET /scripts/{sid}/embed/status` | `embedding_vec IS NOT NULL` 计数 | 计数改 `NOT NULL AND NOT dirty` | 返回体 `{chunks,cards,worldbook,canon:{done,total}}` 形状不变 |
| `md-editor` worldbook/anchor 详情(复用列表) | `fetchGroupList` + 本地 find | 不变;若 P 后做分页需补 `GET /worldbook/{id}` 详情端点 | 列表端点 `{chapters}`/`{items}` 双名留 |
| GM 工具 `graph_neighbors/lookup_entity/search_canon` | view self-join / canon vector | 改读 `kb_edges`+`kb_nodes`(flag 切) | 工具签名/返回结构不变 |

> **键空间冲突防范**(调研痛点):save 级 `anchor_key` 与 script 级 `anchor_id` 是两套体系。统一表里 `reveal_anchors` 用 `anchor_key`(text,script 级),`save_reveal_frontier` 用同名 `anchor_key`(指回 reveal_anchors)。前端 timeline 展示用的 `anchor_id`(整数)由适配层从 `reveal_anchors.id` 映射,satisfy 用的 `anchor_key`(text)直传——**两个 ID 空间在适配层显式分离,不混用**。

---

## 8. UX 提升点 + 确定性/回滚/测试守护

### 8.1 UX 提升点(操作逻辑不变,体验更好)

1. **进度不再卡死/远跳**:前沿是集合,纯摘要章(ch2-8 无 events)不再让进度冻结;退役猜章后不再 overshoot 到 ch77。玩家时间线显示稳定。
2. **关系图真正生效**:在场某 NPC 时,与其有关系的角色/地点/门派被自动召回,GM 叙事连贯度提升(现 relationships 完全闲置)。
3. **分叉剧情有引导**:玩家走出原著后,steering 引到新世界线锚点,而不是反复把玩家拽回原著主线。
4. **世界书编辑即时生效**:编辑后重做真的重嵌(修 Bug),向量与正文一致;状态显示区分「待嵌/已过期/已完成」,不再骗用户 100%。
5. **防剧透更精确**:关键词激活和常量层补门控,未来章节世界书不再泄漏。
6. **穿越/平行/倒叙剧本可玩**:前沿 DAG 原生支持,以前标量模型装不下。

### 8.2 确定性守护(铁律 B 落地清单)

- 前沿推进、可见集闭包、章窗口上界、召回打分、向量脏化判定 —— **全部纯 SQL/Python,无 LLM**。
- LLM(GM)只产出三类**声明性 token**:`mark_anchor_reached` / `mark_anchor_superseded` / `fork_anchor`。声明经 dispatcher 校验(锚点 key 合法性、(user,save) 锁、is_fatal 拒 supersede)后由确定性代码执行。
- **删除** `anchor_reconcile._apply_estimate`(读正文猜章)—— 它是唯一一处「LLM 决定进度」的违规路径,也是 overshoot 源。

### 8.3 回滚守护

- 总开关 `RPG_TEMPORAL_KB` + 每阶段 flag(`RPG_TKB_ANCHORS/EDGES/HYGIENE/FRONTIER/RECALL`),全 default off,可独立回退。
- P4 门控双实现共存一个 release(`reveal_clause_v2` 内部按 flag 分支新旧),按 save 灰度,**影子比对**(两套门控结果 diff 落日志)核对无回归后才全切。
- 所有新表/新列加性,回滚 = flag off(数据保留不参与)或 DROP(P0)。
- 旧表全程不删,是回滚的物理锚。

### 8.4 测试守护

- **单测**:reveal DAG 可见集闭包(线性/分叉/平行/倒叙/穿越 5 形态)、`reveal_clause_v2` SQL 三 mode、向量脏化触发、召回打分公式、章窗口派生。
- **回归(防剧透)**:对真书《我蕾穆丽娜不爱你》save 35801,固定前沿,断言**未到达锚点的实体/世界书一律不出现在 bundle**(新旧门控同输入 diff = 0 关键节点)。
- **集成(进度稳定)**:复现历史两病灶——ch2-8 稀疏段不冻结、不 overshoot 到 ch77。
- **契约快照测试**:对第 7 节每个端点存 DTO golden snapshot(含所有多态字段),迁移后逐字段比对,任一字段缺失即 CI 红。
- **真库 + 浏览器 e2e**(MEMORY 铁律:别 ad-hoc DB 写,用真存档只读 + monkeypatch):登录→进游戏→右栏人物/时间线/世界书面板加载→satisfy/rewind→分叉一回合,核对前端零报错、面板数据正确。
- **向量 e2e**:编辑世界书条目→重做向量→断言该条目被重嵌(`embedded_at` 更新)、`embed_status` 计数正确。

---

## 9. 实施顺序建议

```
P0(地基,零风险) ──► P3(向量卫生,独立价值,先上修 bug)
                  └► P1(锚点回填) ──► P2(边回填) ──► P4(前沿门控,核心,灰度+影子比对) ──► P5(召回统一)
```

P3 与 P1 可并行(互不依赖)。P4 是唯一高风险阶段,必须影子比对 + 按 save 灰度。整个迁移**任何时刻前端零改动**;若中途中止,系统停在「新表已建、旧路径仍跑」的安全态。

---

## 附录 A — 与现有设计文档的关系

- 本方案是 **BC 篇「blob→kb_* 行级迁移」的时间感知特化版**:`kb_edges`/`reveal_anchors`/`save_reveal_frontier` 把 BC 设计的活态 KB 与 M 篇进度信号、L 篇进度感知卡统一收口。
- **退役 M 篇的 `_apply_estimate` 猜章**:M 篇是标量进度时代的最佳工程妥协(floor+judge+clamp);本方案用前沿 DAG 从根上消除 overshoot,故猜章判定器退役。M 篇的 `floor`(occurred/variant 锚点)语义保留,成为前沿 seed。
- **接通 AUDIT 坐实的两大技术债**:pgvector 检索接通(§4/§5)+ blob→行级(`kb_edges` 是第一块)。
