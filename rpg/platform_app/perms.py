"""platform_app.perms — 跨模块复用的资源归属鉴权原语。

把散落在各 router / repo 里重复手写的「存档归属」「剧本可读 / 可写」SQL 收敛到
唯一来源,语义【纯等价】,行为零变化。

设计铁律(改错 = 生产越权回归):
  1. 剧本读 vs 写绝不合并成一个函数:
       script_readable = owner_id ∪ user_script_subscriptions(订阅者可只读)
       script_owned    = 严格 owner_id(订阅者拒绝,需先 fork)
     两个并列函数,签名统一为 (db, script_id, user_id)。
  2. 谓词版(owns_save / script_readable / script_owned)纯查询、不抛异常
     (返回 bool / row | None),供调用点按其【原本的响应形态】自行决定:
       - 原本 json_response 403 → `if not owns_save(...): return json_response(... 403)`
       - 原本 raise ValueError  → `if not owns_save(...): raise ValueError("...")`
       - 原本 raise HTTPException→ `if not owns_save(...): raise HTTPException(403, ...)`
     需要统一抛异常的新调用点用 require_* 版(抛 PermissionError)。
  3. 所有函数都【复用传入的 db / cursor】,绝不在函数内部新开连接 —— 否则会在
     advisory lock 持锁期间嵌套开连接,导致 PgBouncer 池死锁(见 server_self_heal)。
"""
from __future__ import annotations

from typing import Any


class PermissionError(Exception):  # noqa: A001 — 故意遮蔽内建,统一鉴权异常类型
    """统一鉴权异常 —— 供 require_* 版抛出,上层可按需转 4xx。

    注意:仅 require_* 抛它;原本抛 ValueError / HTTPException / 返 403 的调用点
    继续用谓词版自己保持原响应契约,不要改成抛 PermissionError。
    """


# ──────────────────────────────────────────────────────────────────────────────
# 存档归属(game_saves.user_id)
# ──────────────────────────────────────────────────────────────────────────────

def owns_save(db, save_id: int, user_id: int) -> bool:
    """save 是否属于 user_id。纯查询、不抛。"""
    row = db.execute(
        "select 1 from game_saves where id = %s and user_id = %s",
        (save_id, user_id),
    ).fetchone()
    return bool(row)


def require_save(db, save_id: int, user_id: int) -> None:
    """save 不属于 user_id 时抛统一 PermissionError。"""
    if not owns_save(db, save_id, user_id):
        raise PermissionError("无权访问该存档")


# ──────────────────────────────────────────────────────────────────────────────
# 剧本只读(owner ∪ subscription)—— 订阅公开剧本者可只读
# ──────────────────────────────────────────────────────────────────────────────

def script_readable(db, script_id: int, user_id: int) -> dict[str, Any] | None:
    """user 可【读】该剧本(owner 或已订阅)→ 返回 scripts 整行;否则 None。纯查询、不抛。

    公开剧本订阅者可读 worldbook / character_cards / chapter_facts 等。
    编辑类调用方必须用 script_owned / require_script_owner(订阅者只读)。
    """
    return db.execute(
        """
        select s.* from scripts s
        where s.id = %s and (
          s.owner_id = %s
          or s.id in (select script_id from user_script_subscriptions where user_id = %s)
        )
        """,
        (script_id, user_id, user_id),
    ).fetchone()


def require_script(db, script_id: int, user_id: int) -> dict[str, Any]:
    """不可读时抛统一 PermissionError;可读则返回 scripts 整行。"""
    row = script_readable(db, script_id, user_id)
    if not row:
        raise PermissionError("无权访问该剧本")
    return row


# ──────────────────────────────────────────────────────────────────────────────
# 剧本可写(严格 owner)—— 订阅者拒绝,需先 fork
# ──────────────────────────────────────────────────────────────────────────────

def script_owned(db, script_id: int, user_id: int) -> dict[str, Any] | None:
    """user 是否【严格 owner】→ 返回 scripts 整行;否则 None(含订阅者)。纯查询、不抛。

    所有改 character_cards / worldbook / canon / overrides / 章节内容 / 封面 的入口
    必须用这个。订阅者要改剧本须先 fork。
    """
    return db.execute(
        "select * from scripts where id = %s and owner_id = %s",
        (script_id, user_id),
    ).fetchone()


def require_script_owner(db, script_id: int, user_id: int) -> dict[str, Any]:
    """非 owner 时抛统一 PermissionError;是 owner 则返回 scripts 整行。"""
    row = script_owned(db, script_id, user_id)
    if not row:
        raise PermissionError("仅原作者可编辑该剧本。订阅剧本只读;如需改动请先「另存为可编辑副本」(fork)。")
    return row
