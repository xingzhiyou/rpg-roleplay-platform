from __future__ import annotations

from typing import Any

from platform_app.db import connect, init_db, limit_value, page_payload
from platform_app.knowledge._utils import _cursor_int, _require_script
from platform_app.knowledge._worldbook_repo import (
    _db_select_all_worldbook_entries,
    _db_select_worldbook_entries,
)


def list_worldbook_entries(
    user_id: int, script_id: int, limit: int | str | None = None,
    cursor: str | None = None, fetch_all: bool = False,
) -> dict[str, Any]:
    init_db()
    # fetch_all:编辑器全量加载(绕开 priority/id 游标不一致导致的漏条),仍走 _require_script
    # 读权限门(owner 或订阅者)。page_payload(rows, len(rows)) 让 has_more 恒 false 且复用 expose。
    if fetch_all:
        with connect() as db:
            _require_script(db, user_id, script_id)
            rows = _db_select_all_worldbook_entries(db, script_id)
        return page_payload(rows, len(rows))
    page_limit = limit_value(limit)
    before_id = _cursor_int(cursor)
    with connect() as db:
        _require_script(db, user_id, script_id)
        rows = _db_select_worldbook_entries(db, script_id, before_id, page_limit)
    return page_payload(rows, page_limit)
