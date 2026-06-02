"""save_history.py — 存档独立时间线·历史锚点。

跟 agents/anchor_seed_agent.py(剧本未来锚点)平行的另一套:
- agents/anchor_seed_agent.py        → save_anchor_states 表 → list_pending_for_phase
                                       语义:"原著接下来必须发生什么" (未来)
- agents/save_history.py (本模块)   → save_history_anchors 表 → list_recent_history
                                       语义:"玩家在这个世界线创造了什么" (过去)

GM 视角:
  · retrieve_context 同时注入两段:
    [世界线收束·接下来的锚点]    ← 来自 save_anchor_states (剧本未来)
    [存档独立时间线·历史锚点]    ← 来自 save_history_anchors (玩家过去)
  · 工具集分两套:
    list_pending_anchors / mark_anchor_satisfied  → 剧本未来侧
    record_history_anchor / list_recent_history   → 存档过去侧

GM 看清"过去 vs 未来"边界,避免把【pending 原著未来】误叙为【已发生历史】(记忆污染)。
"""
from __future__ import annotations

from typing import Any

from platform_app.db import connect, init_db


def record_history_anchor(
    save_id: int,
    *,
    summary: str,
    importance: int = 50,
    turn_occurred: int | None = None,
    story_time_label: str = "",
    ingame_chapter: int | None = None,
    tags: list[str] | None = None,
    characters: list[str] | None = None,
    locations: list[str] | None = None,
    linked_canon_keys: list[str] | None = None,
    linked_pending_anchors: list[str] | None = None,
    source: str = "gm_generated",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """记录"玩家在这个世界线创造的"重要历史事件。

    typical use:
      GM 在叙事末尾决定:玩家本轮做的事够"创世级"应留档 → 调本函数。
      不需要每轮都调 (流水账有 state.history 兜)。importance 阈值建议:
        ≥60: 改变了至少 1 个 NPC 关系或势力立场
        ≥80: 改写了某个原著锚点 (linked_pending_anchors 不空)
        ≥90: 引入了原著不存在的新角色 / 新势力

    返回 {"ok": bool, "id": int, ...} 或 {"ok": false, "error": str}。
    """
    summary = (summary or "").strip()
    if not summary:
        return {"ok": False, "error": "summary 必填"}
    if len(summary) > 800:
        summary = summary[:800]
    importance = max(0, min(100, int(importance)))
    init_db()
    from psycopg.types.json import Jsonb
    with connect() as db:
        # turn 没传 → 取存档当前 turn
        if turn_occurred is None:
            row = db.execute(
                "select coalesce((state_snapshot->>'turn')::int, 0) as t "
                "from game_saves where id = %s", (int(save_id),),
            ).fetchone()
            turn_occurred = int(row["t"]) if row else 0
        ret = db.execute(
            """
            insert into save_history_anchors (
              save_id, turn_occurred, story_time_label, ingame_chapter,
              summary, importance, tags,
              characters, locations, linked_canon_keys, linked_pending_anchors,
              source, metadata
            )
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            returning id, created_at
            """,
            (
                int(save_id), int(turn_occurred), story_time_label.strip(),
                ingame_chapter if ingame_chapter is None else int(ingame_chapter),
                summary, importance, Jsonb(tags or []),
                Jsonb(characters or []), Jsonb(locations or []),
                Jsonb(linked_canon_keys or []), Jsonb(linked_pending_anchors or []),
                source.strip() or "gm_generated", Jsonb(metadata or {}),
            ),
        ).fetchone()
    return {"ok": True, "id": int(ret["id"]), "turn_occurred": turn_occurred,
            "importance": importance}


def list_recent_history(
    save_id: int,
    *,
    limit: int = 8,
    min_importance: int = 0,
    character_filter: str | None = None,
) -> list[dict[str, Any]]:
    """查存档最近的历史锚点(按 turn 倒序)。

    character_filter 不空时,只返 characters 数组含该名字的(用于追溯某角色相关历史)。
    """
    init_db()
    where = ["save_id = %s"]
    params: list[Any] = [int(save_id)]
    if min_importance > 0:
        where.append("importance >= %s")
        params.append(int(min_importance))
    if character_filter:
        where.append("characters @> %s::jsonb")
        from psycopg.types.json import Jsonb
        params.append(Jsonb([character_filter.strip()]))
    sql = f"""
        select id, turn_occurred, story_time_label, ingame_chapter,
               summary, importance, tags,
               characters, locations, linked_canon_keys, linked_pending_anchors,
               source, created_at
        from save_history_anchors
        where {' and '.join(where)}
        order by turn_occurred desc, importance desc
        limit %s
    """
    params.append(max(1, int(limit)))
    with connect() as db:
        rows = db.execute(sql, tuple(params)).fetchall()
    return [
        {
            "id": r["id"],
            "turn": r["turn_occurred"],
            "story_time": r["story_time_label"],
            "ingame_chapter": r["ingame_chapter"],
            "summary": r["summary"],
            "importance": r["importance"],
            "tags": r["tags"] or [],
            "characters": r["characters"] or [],
            "locations": r["locations"] or [],
            "linked_canon": r["linked_canon_keys"] or [],
            "linked_anchors": r["linked_pending_anchors"] or [],
            "source": r["source"],
        }
        for r in rows
    ]


def find_history_for_pending(save_id: int, anchor_keys: list[str]) -> dict[str, list[dict[str, Any]]]:
    """反向查询:对一批 pending anchor key,各自查 save_history_anchors 里
    linked_pending_anchors @> [anchor_key] 的历史条目。

    返回 {anchor_key: [history_item, ...]},空数组表示该 anchor 未被任何 history 改写。
    用于 retrieve_context 注入【世界线收束】段时标记"⚠ 已被改写,勿重复触发"。
    """
    init_db()
    if not anchor_keys:
        return {}
    result: dict[str, list[dict[str, Any]]] = {ak: [] for ak in anchor_keys}
    from psycopg.types.json import Jsonb
    with connect() as db:
        # PG jsonb @> 操作可以一次性查所有 anchor (or 拼接),但这里逐个 ak 调
        # 简单点(锚点本身就少,~5-10 个)。生产负载下不会成瓶颈。
        for ak in anchor_keys:
            ak_str = str(ak).strip()
            if not ak_str:
                continue
            rows = db.execute(
                """
                select id, turn_occurred, story_time_label, summary, importance, characters
                from save_history_anchors
                where save_id = %s and linked_pending_anchors @> %s::jsonb
                order by turn_occurred desc
                limit 3
                """,
                (int(save_id), Jsonb([ak_str])),
            ).fetchall()
            result[ak_str] = [
                {
                    "id": r["id"], "turn": r["turn_occurred"],
                    "summary": r["summary"], "importance": r["importance"],
                    "characters": r["characters"] or [],
                }
                for r in rows
            ]
    return result


def history_summary(save_id: int) -> dict[str, Any]:
    """快速统计:有多少历史锚点 / 最高 importance / 最近 turn。"""
    init_db()
    with connect() as db:
        row = db.execute(
            """
            select count(*) as total,
                   max(importance) as max_importance,
                   max(turn_occurred) as last_turn,
                   sum(case when source = 'gm_generated' then 1 else 0 end) as gm_count,
                   sum(case when source = 'player_declared' then 1 else 0 end) as player_count
            from save_history_anchors
            where save_id = %s
            """,
            (int(save_id),),
        ).fetchone()
    return {
        "total": int(row["total"] or 0),
        "max_importance": int(row["max_importance"] or 0),
        "last_turn": int(row["last_turn"] or 0),
        "gm_count": int(row["gm_count"] or 0),
        "player_count": int(row["player_count"] or 0),
    }
