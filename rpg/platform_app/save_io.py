"""
save_io.py — 存档导入 / 导出

导出包含：
  - game_saves 主记录
  - branch_commits(剧情分支历史)+ branch_refs
  - messages(对话)+ memories(via game_sessions)
  - save_anchor_states(锚点状态,游戏体验核心)
  - kb_entities / kb_events / kb_relationships / kb_worldline_vars / kb_checkpoints
  - identity_cards / save_character_identities / save_history_anchors

不导出: token_usage(跨用户敏感)/ user_runtime(运行态,瞬时)
导入时按当前 user_id 重映射 owner,分配新 save_id / commit_id。
"""
from __future__ import annotations

import secrets
from typing import Any

from psycopg.types.json import Jsonb

from .db import connect, expose, init_db

EXPORT_VERSION = 2  # task 69: v1 (commits+messages+memories only) → v2 (+ 8 状态表)

MAX_COMMITS = 50000
MAX_TEXT_BYTES = 65536          # gm_output / player_input / summary 字段
MAX_SNAPSHOT_JSON_BYTES = 1024 * 1024  # state_snapshot / metadata JSON

# task 69: 每张 per-save 状态表的导出/导入定义
# 顺序按依赖: 先核心,后辅助。导入时同序 insert。
_STATE_TABLES: tuple[tuple[str, str], ...] = (
    # (table_name, allow_missing) — allow_missing=True 表示老 schema 可能没这表(向后兼容)
    ("save_anchor_states", False),
    ("kb_entities", False),
    ("kb_events", False),
    ("kb_relationships", False),
    ("kb_worldline_vars", False),
    ("kb_checkpoints", True),
    ("identity_cards", True),
    ("save_character_identities", True),
    ("save_history_anchors", True),
)


def _check_json_size(obj: Any, field: str) -> Any:
    """序列化后检查字节数，超限抛 ValueError。"""
    import json as _j
    if len(_j.dumps(obj, ensure_ascii=False).encode()) > MAX_SNAPSHOT_JSON_BYTES:
        raise ValueError(f"{field} 超过 {MAX_SNAPSHOT_JSON_BYTES} 字节上限")
    return obj


def _dump_rows(db, table: str, save_id: int, allow_missing: bool) -> list[dict[str, Any]]:
    """通用 select * 导出。表不存在 / 列名变动 → 空列表 + warning,不阻断整盘导出。"""
    try:
        rows = db.execute(f"select * from {table} where save_id = %s order by id", (save_id,)).fetchall() or []
        return [expose(r) for r in rows]
    except Exception:
        if allow_missing:
            return []
        raise


def export_save(user_id: int, save_id: int) -> dict[str, Any]:
    """打包整份存档为 JSON。task 69: 加入 9 张状态表。"""
    init_db()
    with connect() as db:
        save = db.execute(
            "select * from game_saves where id = %s and user_id = %s",
            (save_id, user_id),
        ).fetchone()
        if not save:
            raise ValueError("无权访问该存档")
        commits = db.execute(
            "select * from branch_commits where save_id = %s order by id",
            (save_id,),
        ).fetchall()
        refs = db.execute(
            "select * from branch_refs where save_id = %s order by id",
            (save_id,),
        ).fetchall()
        sessions = db.execute(
            "select id from game_sessions where save_id = %s",
            (save_id,),
        ).fetchall()
        session_ids = [int(s["id"]) for s in sessions]
        messages = []
        memories_rows = []
        if session_ids:
            messages = db.execute(
                "select * from messages where session_id = ANY(%s::bigint[]) order by id",
                (session_ids,),
            ).fetchall()
            memories_rows = db.execute(
                "select * from memories where session_id = ANY(%s::bigint[]) order by id",
                (session_ids,),
            ).fetchall()

        # task 69: 9 张 per-save 状态表导出
        state_tables: dict[str, list[dict[str, Any]]] = {}
        for table, allow_missing in _STATE_TABLES:
            state_tables[table] = _dump_rows(db, table, save_id, allow_missing)

    return {
        "export_version": EXPORT_VERSION,
        "exported_at": __import__("time").time(),
        "save": expose(save),
        "commits": [expose(c) for c in commits],
        "refs": [expose(r) for r in refs],
        "messages": [expose(m) for m in messages],
        "memories": [expose(m) for m in memories_rows],
        "state_tables": state_tables,
    }


def _strip_id_and_save_id(row: dict[str, Any], extra_strip: tuple[str, ...] = ()) -> dict[str, Any]:
    """剥离 id / save_id / created_at — 由数据库重新分配。"""
    out = dict(row)
    out.pop("id", None)
    out.pop("save_id", None)
    out.pop("created_at", None)
    for k in extra_strip:
        out.pop(k, None)
    return out


def _build_insert(table: str, row: dict[str, Any], new_save_id: int) -> tuple[str, tuple]:
    """根据 row 实际包含的列动态构造 INSERT,容忍前后端 schema 漂移。"""
    cols = ["save_id"]
    vals: list[Any] = [new_save_id]
    for k, v in row.items():
        cols.append(k)
        # jsonb 列 — 凡是 dict/list 一律包 Jsonb
        if isinstance(v, (dict, list)):
            vals.append(Jsonb(_check_json_size(v, f"{table}.{k}")))
        else:
            vals.append(v)
    placeholders = ", ".join(["%s"] * len(cols))
    col_list = ", ".join(cols)
    sql = f"insert into {table} ({col_list}) values ({placeholders}) on conflict do nothing"
    return sql, tuple(vals)


def import_save(user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """从导出 payload 重建存档。按当前 user 创建新 save_id。

    不导入 sessions / context_runs / token_usage 这些跨用户敏感数据。
    task 69: v1 / v2 双格式兼容。v1 缺 state_tables 不报错,只 warning。
    """
    init_db()
    if not isinstance(payload, dict):
        raise ValueError("payload 必须是对象")
    pv = int(payload.get("export_version") or 0)
    if pv not in (1, 2):
        raise ValueError(f"export_version 不支持({pv}),需 1 或 2")
    save_data = payload.get("save") or {}
    if not save_data:
        raise ValueError("payload.save 缺失")

    new_title = (save_data.get("title") or "导入存档")
    script_id_raw = save_data.get("script_id")
    state_snapshot = save_data.get("state_snapshot") or {}
    warnings: list[str] = []
    if pv == 1:
        warnings.append("v1 存档包未含 anchor/kb/identity 状态表,建议在游戏内 /reseed 重建锚点")

    with connect() as db:
        # 校验 script_id 归属（用户必须拥有这个剧本，否则用 user 第一个 script 兜底）
        script_id = None
        if script_id_raw:
            owned = db.execute(
                "select 1 from scripts where id = %s and owner_id = %s",
                (int(script_id_raw), user_id),
            ).fetchone()
            if owned:
                script_id = int(script_id_raw)
        if script_id is None:
            row = db.execute(
                "select id from scripts where owner_id = %s order by id limit 1",
                (user_id,),
            ).fetchone()
            if not row:
                raise ValueError("当前用户没有剧本，无法导入存档")
            script_id = int(row["id"])
            warnings.append(f"原 script_id={script_id_raw} 不在当前账户,改挂到 script_id={script_id}")

        # 1. 新建 save
        new_save = db.execute(
            """
            insert into game_saves(user_id, script_id, title, state_path, state_snapshot)
            values (%s, %s, %s, %s, %s)
            returning *
            """,
            (user_id, script_id, new_title, "", Jsonb(state_snapshot)),
        ).fetchone()
        new_save_id = int(new_save["id"])

        # 2. 重建 branch_commits（保留 parent 关系，但 ID 重映射）
        commits_raw = payload.get("commits") or []
        if len(commits_raw) > MAX_COMMITS:
            raise ValueError(f"commits 数量超上限 {MAX_COMMITS}")
        old_to_new: dict[int, int] = {}
        for c in commits_raw:
            old_id = int(c.get("id") or 0)
            old_parent = c.get("parent_id")
            new_parent = old_to_new.get(int(old_parent)) if old_parent else None
            new_commit = db.execute(
                """
                insert into branch_commits(
                  save_id, parent_id, object_hash, tree_hash, turn_index,
                  kind, title, message, summary, content_preview,
                  state_path, player_input, gm_output, metadata, state_snapshot
                ) values (
                  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                ) returning id
                """,
                (
                    new_save_id, new_parent,
                    c.get("object_hash") or secrets.token_hex(20),
                    c.get("tree_hash") or "",
                    int(c.get("turn_index") or 0),
                    c.get("kind") or "round",
                    c.get("title") or "",
                    c.get("message") or "",
                    (c.get("summary") or "")[:MAX_TEXT_BYTES],
                    c.get("content_preview") or "",
                    "",
                    (c.get("player_input") or "")[:MAX_TEXT_BYTES],
                    (c.get("gm_output") or "")[:MAX_TEXT_BYTES],
                    Jsonb(_check_json_size(c.get("metadata") or {}, "metadata")),
                    Jsonb(_check_json_size(c.get("state_snapshot") or {}, "state_snapshot")),
                ),
            ).fetchone()
            old_to_new[old_id] = int(new_commit["id"])

        # 3. 创建 active ref 指向最新 commit
        if old_to_new:
            last_commit_id = list(old_to_new.values())[-1]
            db.execute(
                """
                insert into branch_refs(save_id, name, kind, target_commit_id, is_active)
                values (%s, %s, %s, %s, true)
                """,
                (new_save_id, "refs/heads/main", "head", last_commit_id),
            )
            db.execute(
                "update game_saves set active_commit_id = %s where id = %s",
                (last_commit_id, new_save_id),
            )

        # 4. task 69: 导入 9 张 per-save 状态表(v2 才有)
        state_imported: dict[str, int] = {}
        if pv >= 2:
            state_tables = payload.get("state_tables") or {}
            for table, allow_missing in _STATE_TABLES:
                rows = state_tables.get(table) or []
                count = 0
                for raw_row in rows:
                    if not isinstance(raw_row, dict):
                        continue
                    row = _strip_id_and_save_id(raw_row)
                    if not row:
                        continue
                    try:
                        sql, vals = _build_insert(table, row, new_save_id)
                        db.execute(sql, vals)
                        count += 1
                    except Exception as exc:
                        # 单行失败不阻断整体导入(schema 漂移容错)
                        if not allow_missing:
                            warnings.append(f"{table} 单行导入失败: {type(exc).__name__}: {str(exc)[:120]}")
                        # else: 静默吞,allow_missing 表整张表都可能不存在
                        break  # 同表多行同样错就别再撞了
                state_imported[table] = count

    return {
        "ok": True,
        "save_id": new_save_id,
        "commits_imported": len(old_to_new),
        "state_imported": state_imported,
        "warnings": warnings,
        "script_id": script_id,
    }
