"""knowledge._worldbook_repo — worldbook 的 SQL 层 (private)."""
from __future__ import annotations


def _db_select_worldbook_entries(db, script_id: int, before_id: int | None, page_limit: int) -> list:
    """repository: 按 script_id/cursor 分页查 worldbook_entries，返回 rows。"""
    return db.execute(
        """
        select * from worldbook_entries
        where script_id = %s and (%s::bigint is null or id < %s)
        order by priority desc, id desc
        limit %s
        """,
        (script_id, before_id, before_id, page_limit + 1),
    ).fetchall()


def _db_select_all_worldbook_entries(db, script_id: int) -> list:
    """repository: 一次性取某剧本【全部】 worldbook_entries(供 owner 编辑器全量加载)。

    注:游标分页(`id < before_id`)与排序(`priority desc, id desc`)不一致,多页会漏掉
    低优先级/高 id 的条目 —— 编辑器需要全量管理,故走此无分页路径,绕开该游标缺陷。
    """
    return db.execute(
        """
        select * from worldbook_entries
        where script_id = %s
        order by priority desc, id desc
        """,
        (script_id,),
    ).fetchall()
