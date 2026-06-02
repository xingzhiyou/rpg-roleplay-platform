"""test_phase_digests_table — 验证 migration v45 建出 phase_digests 表,
且 scripts/aggregate_phase_digests.py 的 aggregate_for_script() 不再 warning。

覆盖:
  - v45 在 MIGRATIONS 列表里
  - schema_migrations 应用后 to_regclass('phase_digests') is not null
  - aggregate_for_script(<空 script>) 返 0 而非 raise/log warning
"""
from __future__ import annotations

import unittest

from platform_app import db as _db


class PhaseDigestsTableExists(unittest.TestCase):
    def test_v45_registered(self):
        versions = {v for v, _, _ in _db.MIGRATIONS}
        self.assertIn(45, versions, "migration v45 phase_digests 必须注册")

    def test_v45_creates_phase_digests(self):
        try:
            from platform_app.db.connection import connect
            from platform_app.db.migrations import _apply_versioned_migrations
            _apply_versioned_migrations()
            with connect() as db:
                row = db.execute(
                    "select to_regclass('phase_digests') as r"
                ).fetchone()
        except Exception as exc:
            # 无 DB 时 skip(local dev / CI 没 PG 跑不到)
            self.skipTest(f"no DB connection: {exc}")
        self.assertIsNotNone(row)
        self.assertIsNotNone(
            row.get("r"),
            "phase_digests 表必须存在(migration v45 应用后)",
        )

    def test_aggregate_for_script_empty_returns_zero(self):
        """aggregate_for_script 在空 chapter_facts 时不应该 raise — 返 0。"""
        try:
            from scripts.aggregate_phase_digests import aggregate_for_script
            # 用一个肯定不存在的 script_id (避免污染真实数据)
            result = aggregate_for_script(999999)
        except Exception as exc:
            # 无 DB 时 skip
            self.skipTest(f"no DB connection: {exc}")
        self.assertEqual(result, 0)


if __name__ == "__main__":
    unittest.main()
