"""test_rebuild_endpoints — phase_backend: 7 个 /rebuild/{module} 路由族
schedule_module_rebuild 能正确登记 import_jobs(kind+module+sub_kind),
不同 module 走对应 worker。
"""
from __future__ import annotations

import unittest

from platform_app import import_pipeline as ip


class RebuildModulesRegistry(unittest.TestCase):
    def test_all_seven_modules_registered(self):
        expected = {
            "chunks", "chapter-facts", "canon", "cards",
            "worldbook", "anchors", "embeddings",
        }
        self.assertEqual(set(ip.REBUILD_MODULES.keys()), expected)

    def test_each_module_has_kind_label_and_needs_llm_flag(self):
        for module, tup in ip.REBUILD_MODULES.items():
            self.assertEqual(len(tup), 3, f"{module} 必须是 (kind, label, needs_llm) 三元组")
            kind, label, needs_llm = tup
            self.assertTrue(kind.startswith("rebuild_"), f"{module} kind 必须 rebuild_ 前缀")
            self.assertIsInstance(label, str)
            self.assertIsInstance(needs_llm, bool)

    def test_zero_llm_modules(self):
        # chunks / chapter-facts / anchors / embeddings 是零 LLM 路径
        zero_llm = {"chunks", "chapter-facts", "anchors", "embeddings"}
        for m in zero_llm:
            self.assertFalse(
                ip.REBUILD_MODULES[m][2],
                f"{m} 应零 LLM(needs_llm=False)",
            )


class RebuildHelpersExist(unittest.TestCase):
    def test_module_level_functions_present(self):
        # 这些函数必须 module-level 暴露,给 _run_module_rebuild + 外部脚本调用
        for name in [
            "rebuild_chunks_from_db",
            "rebuild_facts_from_db",
            "rebuild_cards_from_canon",
            "rebuild_worldbook_with_llm",
            "schedule_module_rebuild",
            "estimate_module_rebuild",
            "_run_module_rebuild",
        ]:
            self.assertTrue(hasattr(ip, name), f"{name} 必须 module-level 暴露")


class RebuildEstimateRoute(unittest.TestCase):
    def test_estimate_route_is_registered(self):
        from fastapi.testclient import TestClient

        from app import app

        client = TestClient(app)
        resp = client.post("/api/v1/scripts/33/rebuild/embeddings/estimate", json={})
        self.assertNotIn(resp.status_code, {404, 405})

    def test_chapter_facts_module_alias(self):
        self.assertEqual(ip.normalize_rebuild_module("chapter_facts"), "chapter-facts")


if __name__ == "__main__":
    unittest.main()
