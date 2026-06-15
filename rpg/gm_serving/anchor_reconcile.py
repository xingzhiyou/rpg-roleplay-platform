"""gm_serving/anchor_reconcile.py — 每回合确定性「世界线锚点」兜底判定器。

动机
====
世界线收束(task 136)此前只有两条路径标记原著锚点已发生:
  1. GM 自觉调 mark_anchor_satisfied 工具(靠提示词自律,会漏)
  2. 玩家手动点 UI 按钮

两条都不保证「每回合」都核对一遍 pending 锚点。结果:剧情已经明确演到某个
原著锚点(例如某人物登场 / 某事件发生),但 GM 这一轮恰好没调工具 → 锚点永远
卡在 pending,下一轮上下文又把它当「还没发生」注入 → GM 反复重演同一桥段 /
进度窗口冻结。

本模块加第三条【确定性·每回合都跑】的兜底:回合 GM 正文流完后,系统主动拿本回合
正文 + 当前进度窗口内的 pending 锚点,做一次**严格保守**的廉价判定,只把本回合
剧情【明确到达】的锚点确定性落库(复用 command_tools_anchors 的 UPDATE 写逻辑 +
gm_serving.settings.advance_progress)。原两条路径全部保留。

铁律
====
- 保守:误推 = 跳过原著内容,比不推更糟。判定器宁漏勿误,低置信不标。
- 成本门控(BYOK 付费):
    · 仅当「进度窗口内有 pending 锚点」才跑(否则零 LLM 调用直接 return)
    · 用最廉价模型(复用 phase_digest / agent 通配偏好);解析不到模型 / 无 key
      → 静默 return,绝不报错不破回合
    · env RPG_ANCHOR_AUTO_RECONCILE 默认 '1' 可关
- 防剧透:只判定/推进【当前进度窗口内】的锚点,绝不跳到远未来锚点。
- 不破回合:整函数 try/except 包裹,任何失败只 log.warning 后吞掉。
- 确定性落库:命中后复用既有写逻辑,在 (user,save) scope lock + connect() 内,
  不另造写路径。

公开 API
========
    reconcile_anchors_for_turn(save_id, user_id, turn_text, *, db=None,
                               _judge=None) -> int
        返回本回合确定性标记的锚点数(供调用方 log / 派发刷新事件)。
        _judge / db 仅供离线单测注入(默认 None = 走真实路径)。
"""
from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any

from agents.anchor_seed_agent import get_progress_window, list_pending_for_phase
from core.json_parse import parse_llm_json
from core.logging import get_logger

log = get_logger(__name__)

# 进度窗口内单回合最多核对的 pending 锚点数(控 prompt 体积 + 成本)。
_MAX_PENDING_PER_TURN = 12
# 单回合最多确定性标记的锚点数(保守,防判定器一次性吞掉一大段原著)。
_MAX_MARK_PER_TURN = 4
# GM 正文截断长度(判定器只需要本回合发生了什么)。
_TURN_TEXT_CAP = 6000

# ── Bug B(进度冻结)修复:有界叙事章估计 — 详见 docs/design/M_progress_advancement.md ──
# 事件抽取稀疏的章(本书 ch2-8 有摘要、0 event → 0 锚点)进度系统全盲,玩家走完整段
# 进度表死在第 1 章。本回合判定器【顺带】(常态:同一次 LLM 调用,零新增成本)读正文估「当前最
# 接近原著第几章」,再 clamp 到 [当前进度, max(已确认锚点,当前进度) + CAP] 推进进度 —— 既补平滑又防
# ch77 乱跳(floor=0 时上限 = prev+CAP,有界)。GM 自由 world.time 标签 resolve 不到锚点,故弃用标签
# 路径、改读真实剧情正文。
_LOOKAHEAD_CAP = 12
# 喂给判定器估章的章节摘要截断(每章),控 prompt 体积。
_EST_SUMMARY_CAP = 160


def _enabled() -> bool:
    """env RPG_ANCHOR_AUTO_RECONCILE 默认 '1';设 '0'/'false' 关。"""
    return os.environ.get("RPG_ANCHOR_AUTO_RECONCILE", "1").strip().lower() not in (
        "0", "false", "no", "off", "",
    )


def _estimate_enabled() -> bool:
    """env RPG_PROGRESS_NARRATIVE_ESTIMATE 默认 '1';设 '0'/'false' 关有界叙事章估计。"""
    return os.environ.get("RPG_PROGRESS_NARRATIVE_ESTIMATE", "1").strip().lower() not in (
        "0", "false", "no", "off", "",
    )


_SYSTEM_PROMPT = """\
你是一个【世界线锚点判定器】。读本回合 GM 写的剧情正文,完成两件事:
(A) 判断其中是否**明确叙述到了**某些「待发生的原著锚点事件」;
(B) 判断本回合剧情**最接近原著的第几章**(进度估计)。

【任务 A — 锚点到达判定·极度保守,宁漏勿误】
1. 只有当本回合正文【明确、确凿地叙述了】某锚点事件**实际发生 / 实际到达**时,
   才把它列出来。仅仅提到、暗示、铺垫、即将发生、有人计划、做梦、回忆、假设、
   讨论某事件 —— 都【不算】到达,绝不列出。
2. 拿不准就【不列】。漏标的代价(下回合再核对一次)远小于误标(直接跳过原著内容)。
3. 你只能从给定的 pending 锚点列表里选,绝不发明新锚点、绝不改 anchor_key。
4. 只看本回合正文这一段材料,不要脑补正文之外的剧情。
drift_score(偏离度 0.0-1.0):0.0=完全按原著;0.3=核心保留但过程/场景不同(变体);
0.7+=核心结果保留但发生方式大改。拿不准给 0.2。

【任务 B — 当前章估计·保守】
给你一份「原著章节地图」(章号 + 该章梗概)。判断本回合正文最接近哪一章,返回该章号。
1. 只能返回章节地图里列出的章号;正文明显还没到地图最早那章 → 返回 null。
2. 看正文实际演到哪里,不要被人物的回忆/预告/计划带偏。
3. 拿不准、正文太抽象无法定位 → 返回 null(漏估的代价远小于误估推快进度)。

【两任务独立】先独立完成任务 A(锚点到达,极度保守),再做任务 B(当前章估计)。
任务 B 的章号推理【绝不可】反过来改变任务 A 对锚点的取舍。

【输出格式(严格)】
仅输出一个 JSON 对象,以 `{` 开头、以 `}` 结尾。不要 markdown 围栏、不要解释:
  {"reached": [{"anchor_key":"<来自列表>","drift_score":<0.0-1.0>}], "current_chapter": <章号整数 或 null>}
没有锚点到达 → reached 为 []。无法定位章节 → current_chapter 为 null。
"""


def _build_user_prompt(
    turn_text: str,
    pending: list[dict[str, Any]],
    window_chapters: list[dict[str, Any]] | None = None,
) -> str:
    lines = ["【待发生的原著锚点(任务 A,只能从这里选)】"]
    if pending:
        for a in pending:
            key = a.get("anchor_key") or ""
            summ = (a.get("summary") or "").strip().replace("\n", " ")
            if len(summ) > 240:
                summ = summ[:240]
            fatal = "[死神来了·必发生]" if a.get("is_fatal") else ""
            lines.append(f"- anchor_key={key} {fatal} 概要:{summ}")
    else:
        lines.append("(本窗口暂无待发生锚点)")
    if window_chapters:
        lines.append("")
        lines.append("【原著章节地图(任务 B,current_chapter 只能从这些章号里选或 null)】")
        for c in window_chapters:
            ch = c.get("chapter")
            label = (c.get("label") or "").strip().replace("\n", " ")
            summ = (c.get("summary") or "").strip().replace("\n", " ")
            if len(summ) > _EST_SUMMARY_CAP:
                summ = summ[:_EST_SUMMARY_CAP]
            head = f"第{ch}章" + (f"「{label}」" if label else "")
            lines.append(f"- chapter={ch} {head}:{summ}")
    lines.append("")
    lines.append("【本回合 GM 剧情正文】")
    lines.append(turn_text.strip())
    lines.append("")
    lines.append(
        "请完成任务 A(到达了哪些锚点)+ 任务 B(最接近第几章)。极度保守,宁漏勿误/宁漏勿快,"
        "只输出 JSON 对象。"
    )
    return "\n".join(lines)


def _default_judge(
    user_id: int | None, turn_text: str, pending: list[dict[str, Any]],
    *, save_id: int | None = None, window_chapters: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """默认判定器:廉价模型一次聚焦判定(同一次调用顺带估当前章,零新增成本)。

    返回 {"reached": [{anchor_key, drift_score}], "estimated_chapter": int|None}。
    解析不到模型 / 无 key / 任何 LLM 错误 → 返回 {"reached": [], "estimated_chapter": None}
    (静默跳过,绝不抛)。
    """
    empty: dict[str, Any] = {"reached": [], "estimated_chapter": None}
    try:
        from agents._harness import call_agent_json, resolve_api_and_model
    except Exception as exc:  # pragma: no cover - import 兜底
        log.warning("[anchor_reconcile] harness import 失败,跳过判定: %s", exc)
        return empty

    # 成本门控②:复用 agent 通配廉价模型偏好;解析不到 / 无可用 BYOK → 静默跳过。
    try:
        api_id, model = resolve_api_and_model(
            user_id,
            api_pref_key="anchor_reconcile.api_id",
            model_pref_key="anchor_reconcile.model_real_name",
        )
    except Exception as exc:
        log.info("[anchor_reconcile] 无可用廉价模型(静默跳过): %s", exc)
        return empty
    if not api_id or not model:
        return empty

    try:
        text, _usage = call_agent_json(
            api_id=api_id,
            model=model,
            system_prompt=_SYSTEM_PROMPT,
            user_prompt=_build_user_prompt(turn_text, pending, window_chapters),
            user_id=user_id,
            tool_schema=None,  # 文本 JSON 即可,保持最廉价路径
            max_tokens=500,
            timeout_sec=20,
            agent_kind="anchor_reconcile",
            save_id=save_id,
        )
    except Exception as exc:
        # 无 key / 网络 / 凭证错误等一律静默跳过,绝不破回合。
        log.info("[anchor_reconcile] 判定调用失败(静默跳过): %s", exc)
        return empty

    # want=None 先原样拿到:廉价模型(haiku/flash)常忽略「对象 vs 数组」要求、退回裸数组
    # [{...}]。若用 want=dict,顶层 list 会被过滤成 None → 锚点命中被静默吞掉(任务 A 退化)。
    # 故 want=None,裸数组按「只含 reached」兼容,仍非 dict → 视空。
    parsed = parse_llm_json(text or "", want=None)
    if isinstance(parsed, list):
        parsed = {"reached": parsed, "current_chapter": None}
    if not isinstance(parsed, dict):
        return empty

    reached_raw = parsed.get("reached")
    reached: list[dict[str, Any]] = []
    if isinstance(reached_raw, list):
        for item in reached_raw:
            if not isinstance(item, dict):
                continue
            key = (item.get("anchor_key") or "").strip()
            if not key:
                continue
            try:
                drift = float(item.get("drift_score"))
            except (TypeError, ValueError):
                drift = 0.2
            drift = max(0.0, min(1.0, drift))
            reached.append({"anchor_key": key, "drift_score": drift})

    est_raw = parsed.get("current_chapter")
    estimated_chapter: int | None = None
    try:
        if est_raw is not None:
            estimated_chapter = int(est_raw)
            if estimated_chapter < 1:
                estimated_chapter = None
    except (TypeError, ValueError):
        estimated_chapter = None

    return {"reached": reached, "estimated_chapter": estimated_chapter}


def reconcile_anchors_for_turn(
    save_id: int | None,
    user_id: int | None,
    turn_text: str | None,
    *,
    db: Any = None,
    _judge: Callable[..., list[dict[str, Any]]] | None = None,
) -> int:
    """每回合确定性兜底:把本回合明确到达的 pending 锚点确定性标记 occurred/variant。

    返回标记的锚点数。任何异常被吞掉返回 0(绝不破回合)。

    参数:
      save_id / user_id : 当前存档与用户
      turn_text         : 本回合 GM 正文
      db                : 可选,复用调用方已有连接(否则内部 connect())
      _judge            : 可选,注入判定器(离线测试用)。签名
                          (user_id, turn_text, pending, *, save_id) -> list[{anchor_key, drift_score}]
    """
    try:
        return _reconcile_impl(save_id, user_id, turn_text, db=db, _judge=_judge)
    except Exception as exc:  # 不破回合:任何失败 log.warning 后吞掉
        log.warning("[anchor_reconcile] reconcile 整体失败(已吞,不影响回合): %s", exc)
        return 0


def _normalize_judge_result(raw: Any) -> tuple[list[dict[str, Any]], int | None]:
    """统一判定器返回:新式 dict {reached, estimated_chapter} / 旧式裸 list(只含 reached)。

    返回 (reached_list, estimated_chapter)。
    """
    if isinstance(raw, dict):
        reached = raw.get("reached")
        reached = reached if isinstance(reached, list) else []
        est = raw.get("estimated_chapter")
        try:
            est = int(est) if est is not None else None
        except (TypeError, ValueError):
            est = None
        return reached, (est if (est is None or est >= 1) else None)
    if isinstance(raw, list):
        return raw, None
    return [], None


def _load_estimate_context(save_id: int) -> dict[str, Any] | None:
    """一次连接备齐有界叙事章估计所需上下文(自连接,与 get_progress_window 同模式):
      · prev   = 当前 progress_chapter(权威进度)
      · floor  = 已确认锚点(occurred/variant)最大原著章 —— ceiling 的地面真值
      · script_id
      · window_chapters = 章节地图 [max(floor,prev), max(floor,prev)+CAP] —— 与 ceiling 口径对齐,
        让判定器既能定位「进度落后于 floor」的存档实际所处章,又不越过 clamp 上限。

    无 script_id → 返 None(本回合跳过估章,调用方据此关估章基线失真)。
    """
    from platform_app.db import connect, init_db
    init_db()
    with connect() as db:
        prev = 1
        r = db.execute(
            "select worldline->>'progress_chapter' as pc from game_sessions where save_id=%s",
            (save_id,),
        ).fetchone()
        if r and r.get("pc") is not None:
            try:
                prev = max(1, int(r["pc"]))
            except (TypeError, ValueError):
                prev = 1
        s = db.execute("select script_id from game_saves where id=%s", (save_id,)).fetchone()
        script_id = int(s["script_id"]) if (s and s.get("script_id") is not None) else None
        if not script_id:
            return None
        fr = db.execute(
            "select coalesce(max(source_chapter), 0) as c from save_anchor_states "
            "where save_id=%s and status in ('occurred','variant')",
            (save_id,),
        ).fetchone()
        floor = int((fr or {}).get("c") or 0)
        lo = max(1, floor, prev)
        hi = lo + _LOOKAHEAD_CAP
        rows = db.execute(
            "select chapter, story_time_label as label, summary from chapter_facts "
            "where script_id=%s and chapter between %s and %s order by chapter",
            (script_id, lo, hi),
        ).fetchall()
    window_chapters = [
        {"chapter": r["chapter"], "label": r.get("label") or "", "summary": r.get("summary") or ""}
        for r in rows
    ]
    return {"prev": prev, "floor": floor, "script_id": script_id, "window_chapters": window_chapters}


def _apply_estimate(db: Any, save_id: int, prev_progress: int, estimated_chapter: int) -> int:
    """有界叙事章估计落库:new = max(prev, floor, clamp(估计, ≤ max(floor,prev)+CAP))(设计 §4.1)。

    · floor = 已确认锚点(occurred/variant)最大原著章 —— 可靠地面真值(此处 fresh 重查,
      故能反映本回合 _apply_hits 刚标记的锚点)。
    · ceiling = max(floor, prev) + CAP —— 估计最多越过地面真值 CAP 章(floor=0 时上限 = prev+CAP,
      根治 ch77 远跳:blast radius 有界)。
    · 单调:绝不低于当前进度(回退是 rewind 端点的显式职责)。
    · prev_progress 是标记前快照;floor 重查 + advance_progress max-only 共同保证不回退,故快照偏旧无害。

    不变量(进度推进的唯一估章写者):progress_chapter 的叙事估章只由本函数写;retrieval.py 进度块
    只做 anchor-floor 同步、绝不引入估章;两路径都经 gm_serving.settings.advance_progress(max-only)
    收敛,故双写不抖动、不互相拉低。改动任一方前请维持此契约。

    返回新进度(未推进返 0)。
    """
    row = db.execute(
        "select coalesce(max(source_chapter), 0) as c from save_anchor_states "
        "where save_id = %s and status in ('occurred', 'variant')",
        (save_id,),
    ).fetchone()
    floor = int((row or {}).get("c") or 0)
    prev = max(1, int(prev_progress or 1))
    ceiling = max(floor, prev) + _LOOKAHEAD_CAP
    candidate = max(prev, floor, min(int(estimated_chapter), ceiling))
    if candidate <= prev:
        return 0
    from gm_serving.settings import advance_progress
    advance_progress(db, save_id, candidate)
    log.info(
        "[anchor_reconcile] 叙事估章推进进度 save=%s %s→%s (floor=%s, est=%s, ceil=%s)",
        save_id, prev, candidate, floor, estimated_chapter, ceiling,
    )
    return candidate


def _reconcile_impl(
    save_id: int | None,
    user_id: int | None,
    turn_text: str | None,
    *,
    db: Any,
    _judge: Callable[..., Any] | None,
) -> int:
    # 1. env 门控
    if not _enabled():
        return 0
    if not save_id or not user_id:
        return 0
    save_id = int(save_id)
    user_id = int(user_id)
    text = (turn_text or "").strip()
    if not text:
        return 0
    if len(text) > _TURN_TEXT_CAP:
        text = text[:_TURN_TEXT_CAP]

    # 2. 进度窗口 + 窗口内 pending 锚点。
    win = get_progress_window(save_id)
    ch_min = win.get("chapter_min")
    ch_max = win.get("chapter_max")
    pending = list_pending_for_phase(
        save_id, None,
        limit=_MAX_PENDING_PER_TURN,
        chapter_min=ch_min, chapter_max=ch_max,
        order_by_chapter=True,
    )
    # 窗口内 pending 的 anchor_key → 后续校验命中合法性(防越界/编造)。
    win_by_key: dict[str, dict[str, Any]] = {}
    for a in pending:
        k = a.get("anchor_key")
        if k:
            win_by_key[k] = a

    # 3. Bug B 有界叙事章估计上下文。只在【真实默认判定器】路径备料(只读自连接);注入式 _judge
    #    (离线测试)不备料、不连库,估章值由注入判定器自带。备料失败 → est_ctx=None → 本回合关估章
    #    (避免 prev 基线失真还参与落库)。
    est_on = _estimate_enabled()
    est_ctx: dict[str, Any] | None = None
    if est_on and _judge is None:
        try:
            est_ctx = _load_estimate_context(save_id)
        except Exception as exc:
            log.info("[anchor_reconcile] 估章上下文备料失败(本回合跳过估章): %s", exc)
            est_ctx = None

    # 成本门控:窗口内无 pending 且本回合不会估章 → 零 LLM 调用直接 return。
    #   · 有 pending → 判定器照常跑,估章搭这次调用便车(零新增成本,常态)。
    #   · 无 pending 但估章就绪(设计 §73:估章不依赖 pending)→ 仍跑判定器只估章不标锚点。
    #     此时该回合产生 1 次廉价调用,仅在「进度窗口(默认 50 章)内无任何 pending 锚点」的稀疏空白段
    #     触发(根治锚点间隔 > 窗口时的进度冻结);env RPG_PROGRESS_NARRATIVE_ESTIMATE=0 可关此行为。
    will_estimate = bool(est_on and (est_ctx is not None or _judge is not None))
    if not pending and not will_estimate:
        return 0

    # 4. 廉价判定(同一次调用:任务 A 锚点命中 + 任务 B 当前章估计)。
    #    注入式 _judge 保持旧签名契约(老测试不破);默认判定器才接 window_chapters。
    window_chapters = est_ctx.get("window_chapters") if est_ctx else None
    if _judge is not None:
        raw = _judge(user_id, text, pending, save_id=save_id)
    else:
        raw = _default_judge(user_id, text, pending, save_id=save_id, window_chapters=window_chapters)
    reached, estimated_chapter = _normalize_judge_result(raw)

    # 只保留窗口内、合法 anchor_key 的命中(防判定器越界到远未来/编造 key)。去重。
    seen: set[str] = set()
    valid_hits: list[dict[str, Any]] = []
    for h in reached:
        if not isinstance(h, dict):
            continue
        key = (h.get("anchor_key") or "").strip()
        if not key or key in seen or key not in win_by_key:
            continue
        seen.add(key)
        try:
            drift = float(h.get("drift_score"))
        except (TypeError, ValueError):
            drift = 0.2
        valid_hits.append({"anchor_key": key, "drift_score": max(0.0, min(1.0, drift))})
        if len(valid_hits) >= _MAX_MARK_PER_TURN:
            break  # 保守:单回合最多标 N 个

    # 估章是否落库:本回合会估章 + 估章值有效。无锚点命中且不估章 → 无事可做。
    do_estimate = bool(will_estimate and estimated_chapter)
    if not valid_hits and not do_estimate:
        return 0

    # 5. 确定性落库:锚点标记 + 有界估章推进,同一 (user,save) scope lock + 单连接内。
    est_prev = int(est_ctx.get("prev")) if est_ctx else 1
    def _do(conn: Any) -> int:
        marked = _apply_hits(conn, save_id, user_id, valid_hits) if valid_hits else 0
        if do_estimate:
            # 锚点标记后 floor 可能已升,_apply_estimate 内重查 floor 算 ceiling。
            _apply_estimate(conn, save_id, est_prev, int(estimated_chapter))
        return marked

    if db is not None:
        return _do(db)

    from platform_app.db import connect, init_db
    from tools_dsl.command_dispatcher import _get_sync_scope_lock
    init_db()
    with _get_sync_scope_lock((user_id, save_id)), connect() as conn:
        return _do(conn)


def _apply_hits(
    db: Any, save_id: int, user_id: int, hits: list[dict[str, Any]],
) -> int:
    """对每个命中锚点:仅处理仍 pending 的,复用 command_tools_anchors 的 UPDATE
    (status occurred/variant 按 drift)+ advance_progress(max-only)。

    已被 GM 本轮自调工具标过 occurred/variant 的天然不在 pending,不会重复处理。
    """
    marked = 0
    for h in hits:
        key = h["anchor_key"]
        drift = h["drift_score"]
        # status 阈值与 mark_anchor_satisfied 完全一致(drift>=0.15 → variant)。
        new_status = "variant" if drift >= 0.15 else "occurred"
        # 默认 occurred_turn 从 branch_commits 最大值取(与 mark_anchor_satisfied 一致)。
        r = db.execute(
            "select coalesce(max(turn_index), 0) as t from branch_commits where save_id = %s",
            (save_id,),
        ).fetchone()
        occurred_turn = int((r or {}).get("t") or 0)
        # 只 UPDATE 仍 pending 的(WHERE status='pending' 幂等 + 防覆盖 GM 已标的)。
        row = db.execute(
            """
            update save_anchor_states set
              status = %s,
              variant_description = %s,
              occurred_at_turn = %s,
              drift_score = %s,
              updated_at = now()
            where save_id = %s and anchor_key = %s and status = 'pending'
            returning id, source_chapter
            """,
            (
                new_status,
                "系统每回合确定性兜底判定:本回合剧情明确到达此锚点",
                occurred_turn, drift, save_id, key,
            ),
        ).fetchone()
        if not row:
            continue  # 已非 pending(GM 本轮自调过 / 并发已标)→ 跳过
        marked += 1
        # 推进玩家进度(max-only,只增不减,幂等)。复用既有 advance_progress。
        src_ch = row.get("source_chapter")
        if isinstance(src_ch, int) and src_ch >= 1:
            try:
                from gm_serving.settings import advance_progress
                advance_progress(db, save_id, src_ch)
            except Exception as adv_exc:  # 进度同步失败不阻断锚点标记
                log.warning("[anchor_reconcile] advance_progress 失败(忽略): %s", adv_exc)
    return marked


__all__ = ["reconcile_anchors_for_turn"]
