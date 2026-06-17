"""KB 卫生(设计 O §5.2)回归:编辑世界书条目的正文/标题 → 脏化向量(NULL embedding_vec)。

群反馈 行者无疆「改了世界书条目后重做秒完成、实际没重新生成」的根因:编辑不脏化向量 →
重做的增量循环 `WHERE embedding_vec IS NULL` 命中 0 行 → 秒完成且向量过期。
本测试守住:改 content/title 必脏化;只改 priority 等非嵌入字段不脏化(不浪费重嵌)。
"""
from __future__ import annotations

import os
import unittest

os.environ.setdefault("RPG_DEPLOYMENT_MODE", "local")

from tests.helpers import make_client, register_user  # noqa: E402


class TestWorldbookEmbedHygiene(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from platform_app.db import connect, init_db
        from platform_app.knowledge import embedding as E
        init_db()
        cls.client = make_client()
        cls.username = "wbhyg_uat"
        register_user(cls.client, username=cls.username, password="Test12345!")
        with connect() as db:
            u = db.execute("select id from users where username=%s", (cls.username,)).fetchone()
            cls.uid = int(u["id"])
            cls.sid = int(db.execute(
                "insert into scripts(owner_id,title) values(%s,'wb-hygiene-test') returning id", (cls.uid,),
            ).fetchone()["id"])
            cls.bid = int(db.execute(
                "insert into books(owner_id,script_id,title,slug) values(%s,%s,'wbh','wbh-uat') returning id",
                (cls.uid, cls.sid),
            ).fetchone()["id"])
            cls.vec = "[" + ",".join(["0.03"] * E.EMBED_DIM) + "]"

    @classmethod
    def tearDownClass(cls):
        from platform_app.db import connect
        with connect() as db:
            db.execute("delete from scripts where id=%s", (cls.sid,))
            db.execute("delete from users where id=%s", (cls.uid,))

    @staticmethod
    def _fresh_conn():
        # 用独立 autocommit 连接读/写,避开「TestClient 同进程写 + 池化 connect() 读」的快照串扰
        # (READ COMMITTED 下新连接的每条语句都见最新提交)。
        import psycopg
        from psycopg.rows import dict_row
        return psycopg.connect(os.environ["DATABASE_URL"], autocommit=True, row_factory=dict_row)

    def _seed_entry(self, title=None, content="旧内容"):
        import uuid
        title = title or ("设定-" + uuid.uuid4().hex[:8])  # (script_id,title) 有唯一约束 → 每条唯一
        with self._fresh_conn() as db:
            return int(db.execute(
                "insert into worldbook_entries(script_id,book_id,title,content,embedding_vec,embedded_at) "
                "values(%s,%s,%s,%s,%s::vector,now()) returning id",
                (self.sid, self.bid, title, content, self.vec),
            ).fetchone()["id"])

    def _vec_null(self, eid: int) -> bool:
        with self._fresh_conn() as db:
            return bool(db.execute(
                "select (embedding_vec is null) as n from worldbook_entries where id=%s", (eid,),
            ).fetchone()["n"])

    def test_edit_content_dirties_vector(self):
        eid = self._seed_entry()
        r = self.client.put(f"/api/v1/scripts/{self.sid}/worldbook/{eid}", json={"content": "改过的新内容"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(self._vec_null(eid), "改 content 必须脏化向量(NULL),否则重做秒完成留旧向量")

    def test_edit_title_dirties_vector(self):
        eid = self._seed_entry()
        r = self.client.put(f"/api/v1/scripts/{self.sid}/worldbook/{eid}", json={"title": "新标题"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(self._vec_null(eid), "改 title 也必须脏化向量")

    def test_edit_priority_only_keeps_vector(self):
        eid = self._seed_entry()
        r = self.client.put(f"/api/v1/scripts/{self.sid}/worldbook/{eid}", json={"priority": 88})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertFalse(self._vec_null(eid), "只改 priority 不影响嵌入,不应脏化(避免浪费重嵌)")


if __name__ == "__main__":
    unittest.main()
