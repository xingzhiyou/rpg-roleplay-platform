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
        # chunks/cards/worldbook 三张表向量列就叫 embedding_vec,绝不能查回 stale jsonb 'embedding'。
        # 注:kb_canon_entities 的向量列**本就叫 `embedding`**(vector 类型,非 stale jsonb),所以全局
        # 「禁止 embedding is」的旧启发式已失效(会误伤 canon 的合法列 + 注释);改为精确断言这三张表查 embedding_vec。
        for tbl in ("document_chunks", "character_cards", "worldbook_entries"):
            self.assertNotIn(
                f"from {tbl} where script_id = %s and embedding is not null", src,
                f"{tbl} 必须查 embedding_vec,不能查 stale jsonb embedding",
            )

    def test_modules_status_uses_embedding_vec(self):
        from platform_app.api import scripts as api_scripts
        src = inspect.getsource(api_scripts.api_script_modules_status)
        self.assertIn("embedding_vec is not null", src,
                      "modules-status 也必须查 embedding_vec")


if __name__ == "__main__":
    unittest.main()
