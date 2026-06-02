"""test_embed_status_pgvector — phase_backend: /embed/status 查 embedding_vec (pgvector)
而非 stale embedding (jsonb) 列。
"""
from __future__ import annotations

import inspect
import unittest


class EmbedStatusQueriesVectorColumn(unittest.TestCase):
    def test_embed_status_uses_embedding_vec(self):
        """embed_status() SQL 必须查 embedding_vec is not null。"""
        from platform_app.knowledge import embedding as _embed
        src = inspect.getsource(_embed.embed_status)
        self.assertIn("embedding_vec is not null", src,
                      "embed_status 必须查 pgvector 列 embedding_vec")
        # 不应该查 jsonb 'embedding' 列(那是 stale)
        # 单引号查 'embedding' 不在 string 字面里出现(不应被 'where embedding' 匹配)
        # 这里只要确保没有 "where embedding is" 模式
        self.assertNotIn("where embedding is", src.lower())

    def test_modules_status_uses_embedding_vec(self):
        from platform_app.api import scripts as api_scripts
        src = inspect.getsource(api_scripts.api_script_modules_status)
        self.assertIn("embedding_vec is not null", src,
                      "modules-status 也必须查 embedding_vec")


if __name__ == "__main__":
    unittest.main()
