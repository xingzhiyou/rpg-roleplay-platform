from __future__ import annotations

from typing import Any

from platform_app.db import connect, init_db, limit_value, page_payload
from platform_app.knowledge._memory_repo import _db_select_memories
from platform_app.knowledge._utils import _cursor_int
from platform_app.perms import owns_save


def list_memories(user_id: int, save_id: int, bucket: str | None = None, limit: int | str | None = None, cursor: str | None = None) -> dict[str, Any]:
    """前端面板用：列出某存档的记忆，可按 bucket 过滤。"""
    init_db()
    page_limit = limit_value(limit)
    before_id = _cursor_int(cursor)
    with connect() as db:
        if not owns_save(db, save_id, user_id):
            raise ValueError("无权访问该存档")
        rows = _db_select_memories(db, save_id, bucket, page_limit, before_id)
    return page_payload(rows, page_limit)
