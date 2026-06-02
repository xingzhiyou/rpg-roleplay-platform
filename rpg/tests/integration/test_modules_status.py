"""test_modules_status — phase_backend: GET /api/scripts/{id}/modules-status
应返 7 模块 done/total/stale/last_job_id 结构。
"""
from __future__ import annotations

import unittest

from platform_app.api import scripts as api_scripts_mod


class ModulesStatusEndpointShape(unittest.TestCase):
    def test_endpoint_registered(self):
        # 路由必须在 router 里
        routes = [r.path for r in api_scripts_mod.router.routes]
        self.assertIn("/api/scripts/{script_id}/modules-status", routes)

    def test_endpoint_returns_seven_modules(self):
        """直接 import handler 后用 mock connect 测返回结构。"""
        from unittest.mock import MagicMock, patch
        with patch.object(api_scripts_mod, "connect") as mock_connect:
            ctx = MagicMock()
            ctx.__enter__.return_value = ctx
            ctx.__exit__.return_value = False
            # owner check + 各模块 count + job rows
            ctx.execute.return_value.fetchone.side_effect = [
                {"chapter_count": 430, "updated_at": "2026-06-01"},  # owner
                {"c": 430},  # chunks
                {"c": 213},  # facts
                {"c": 0},    # canon
                {"c": 0},    # cards
                {"c": 0},    # worldbook
                {"c": 213},  # anchors
                {"c": 0},    # embed
            ]
            ctx.execute.return_value.fetchall.return_value = []  # no jobs
            mock_connect.return_value = ctx

            import asyncio
            res = asyncio.new_event_loop().run_until_complete(
                api_scripts_mod.api_script_modules_status(12, user={"id": 1})
            )
            import json as _json
            body = _json.loads(res.body)
            self.assertTrue(body.get("ok"))
            mods = body.get("modules") or []
            names = [m["module"] for m in mods]
            self.assertEqual(
                names,
                ["chunks", "chapter-facts", "canon", "cards",
                 "worldbook", "anchors", "embeddings"],
            )
            # 每个 module 必须含 done/total/stale/last_job_id keys
            for m in mods:
                for k in ("done", "total", "stale", "last_job_id"):
                    self.assertIn(k, m, f"module {m['module']} 缺 {k}")


if __name__ == "__main__":
    unittest.main()
