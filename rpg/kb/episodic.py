"""kb/episodic.py — 永恒记忆 · 情景召回(玩家自己的游戏历史)。

把存档域 COW 事件表 kb_events 向量化 + 按当前情境语义召回 top-k。与原著 RAG(检索剧本正文)
正交:这是"玩家创造的过去时态"。检索沿 born_commit 谱系 CTE 过滤 → **分支隔离天然**:一个分支
只召回自己血缘的事件(rewind / 平行线不串味)。绝不写 script 域、绝不写扁平 save_history_anchors。

嵌入走用户 embed 偏好(廉价 embedder),失败 / 未配置 / pgvector 不可用时**静默降级**
(embedding_vec 留 NULL / 召回为空,退回近因检索),绝不阻断回合。写嵌入在回合之外异步做,
不进 GM 关键路径事务。
"""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)

_EMBED_BATCH = 16  # 每次后处理最多补嵌入多少条(防一回合事件过多拖慢)


def embed_pending_events(save_id: int, user_id: int | None, *, limit: int = _EMBED_BATCH) -> int:
    """把本存档尚未嵌入的 kb_events(embedding_vec IS NULL)补嵌入。回合后 fire-and-forget 调。
    返回成功嵌入条数;无 embedder / pgvector 时返 0(静默,保持 NULL 等下次)。"""
    if not save_id:
        return 0
    try:
        from platform_app.db import connect, init_db
        from platform_app.knowledge.embedding import embed_query
        init_db()
        with connect() as db:
            rows = db.execute(
                "select id, summary from kb_events "
                "where save_id=%s and embedding_vec is null and coalesce(summary,'')<>'' "
                "order by id desc limit %s",
                (int(save_id), int(limit)),
            ).fetchall()
        n = 0
        for r in rows or []:
            vec = embed_query(str(r.get("summary") or ""), user_id)  # 用户 embed 偏好
            if not vec:
                break  # 无可用 embedder → 整批放弃(下次或换 embedder 再补),不空转
            with connect() as db:
                db.execute(
                    "update kb_events set embedding_vec=%s::vector where id=%s and save_id=%s",
                    (vec, int(r["id"]), int(save_id)),
                )
                if hasattr(db, "commit"):
                    db.commit()
            n += 1
        return n
    except Exception as exc:
        log.warning("[episodic] embed_pending_events skip: %s", exc)
        return 0


def retrieve_episodic(
    save_id: int, commit_id: int, user_id: int | None, query_text: str, *, k: int = 5,
) -> list[dict]:
    """沿当前分支谱系语义召回 top-k 相关历史事件。无 embedder / pgvector / 无嵌入数据 → 返 []。

    返回 [{logical_key, summary, story_time, location, participants, score}],score 越高越相关。"""
    if not (save_id and commit_id and (query_text or "").strip()):
        return []
    try:
        from kb.live_repo import _ANCESTRY
        from platform_app.db import connect, init_db
        from platform_app.knowledge.embedding import embed_query
        init_db()
        qv = embed_query(query_text, user_id)
        if not qv:
            return []
        sql = _ANCESTRY + """
        select logical_key, summary, story_time, location, participants,
               (1 - (embedding_vec <=> %(qv)s::vector)) as score
        from kb_events
        where save_id = %(save)s
          and born_commit in (select cid from ancestry)
          and retired_at_commit is null
          and embedding_vec is not null
        order by embedding_vec <=> %(qv)s::vector
        limit %(k)s
        """
        with connect() as db:
            rows = db.execute(
                sql, {"commit": int(commit_id), "save": int(save_id), "qv": qv, "k": int(k)},
            ).fetchall()
        return [dict(r) for r in (rows or [])]
    except Exception as exc:
        log.warning("[episodic] retrieve_episodic skip: %s", exc)
        return []
