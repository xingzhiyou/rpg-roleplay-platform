"""
test_script_fork_edit.py — schema v44 剧本 fork + worldbook 编辑 API 契约

测试目标:
  1. fork → 校验新 script_id 不同于原 script_id, owner=当前用户, forked_from_script_id 正确
  2. edit worldbook → 校验 commit 写入 (GET /commits 返回条目)
  3. 非 owner 编辑 → 403 + 错误信息含「必须 fork」
"""
from __future__ import annotations

import base64
import unittest
from pathlib import Path

from tests.helpers import cleanup_test_users, make_client, register_user

REPO = Path(__file__).resolve().parents[3]
TEST_NOVEL = REPO / "output" / "playwright" / "timeline_set_test_novel.md"

# 最小测试正文,不依赖外部文件
_MINI_NOVEL = """\
# 第一章 序章
这是第一章的内容，测试用。

# 第二章 正文
这是第二章的内容，测试用。
"""


def _import_script(client, cookies: dict, title: str = "测试剧本") -> int:
    """辅助:导入一个最小剧本,返回 script_id。"""
    raw = _MINI_NOVEL.encode("utf-8")
    r = client.post(
        "/api/v1/scripts/import",
        json={
            "file": {"name": "mini.txt", "base64": base64.b64encode(raw).decode("ascii")},
            "title": title,
            "split_rule": "auto",
        },
        cookies=cookies,
    )
    assert r.status_code == 200, f"import 失败: {r.status_code} {r.text[:300]}"
    body = r.json()
    assert body.get("ok"), f"import ok=false: {body}"
    return int(body["script"]["id"])


class ScriptForkAndEditContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cleanup_test_users()
        cls.client = make_client()

    @classmethod
    def tearDownClass(cls):
        cleanup_test_users()

    def test_fork_creates_new_script(self):
        """fork 后新 script_id != 原 script_id,owner=当前用户,forked_from_script_id 正确。"""
        u = register_user(self.client)
        cookies = u["cookies"]

        src_id = _import_script(self.client, cookies, title="原剧本")

        r = self.client.post(
            f"/api/v1/scripts/{src_id}/fork",
            json={"title": "fork版本", "message": "test fork"},
            cookies=cookies,
        )
        self.assertEqual(r.status_code, 200, f"fork 必须 200: {r.status_code} {r.text[:300]}")
        body = r.json()
        self.assertTrue(body.get("ok"), f"fork ok=false: {body}")
        self.assertIn("script", body)
        self.assertIn("commit_id", body)

        forked = body["script"]
        self.assertNotEqual(int(forked["id"]), src_id, "fork 后 script_id 必须不同")
        self.assertEqual(int(forked["forked_from_script_id"]), src_id, "forked_from_script_id 必须指向原 script")

    def test_edit_worldbook_writes_commit(self):
        """编辑 worldbook entry 后, GET /commits 应返回至少一条 worldbook_edit commit。"""
        u = register_user(self.client)
        cookies = u["cookies"]

        src_id = _import_script(self.client, cookies, title="worldbook编辑测试")

        # fork
        r_fork = self.client.post(
            f"/api/v1/scripts/{src_id}/fork",
            json={"title": "fork for edit", "message": "fork"},
            cookies=cookies,
        )
        self.assertEqual(r_fork.status_code, 200)
        fork_id = int(r_fork.json()["script"]["id"])

        # 先列 worldbook（可能为空）
        r_wb = self.client.get(f"/api/v1/scripts/{fork_id}/worldbook", cookies=cookies)
        self.assertEqual(r_wb.status_code, 200)
        wb_items = r_wb.json().get("items") or []

        if wb_items:
            # 有条目则 PUT 编辑
            entry_id = int(wb_items[0]["id"])
            r_edit = self.client.put(
                f"/api/v1/scripts/{fork_id}/worldbook/{entry_id}",
                json={"content": "测试编辑内容 updated", "priority": 80},
                cookies=cookies,
            )
            self.assertEqual(r_edit.status_code, 200, f"worldbook PUT 必须 200: {r_edit.text[:200]}")
            edit_body = r_edit.json()
            self.assertTrue(edit_body.get("ok"))
            self.assertIn("commit_id", edit_body)
            expected_kind = "worldbook_edit"
        else:
            # 没有条目则 POST 新增
            r_add = self.client.post(
                f"/api/v1/scripts/{fork_id}/worldbook",
                json={"title": "测试条目", "content": "测试内容", "priority": 50},
                cookies=cookies,
            )
            self.assertEqual(r_add.status_code, 200, f"worldbook POST 必须 200: {r_add.text[:200]}")
            add_body = r_add.json()
            self.assertTrue(add_body.get("ok"))
            self.assertIn("commit_id", add_body)
            expected_kind = "worldbook_add"

        # GET /commits 确认 commit 写入
        r_commits = self.client.get(
            f"/api/v1/scripts/{fork_id}/commits?limit=10",
            cookies=cookies,
        )
        self.assertEqual(r_commits.status_code, 200, f"GET commits 必须 200: {r_commits.text[:200]}")
        commits_body = r_commits.json()
        self.assertTrue(commits_body.get("ok"))
        commits = commits_body.get("commits") or []
        kinds = [c.get("kind") for c in commits]
        self.assertIn(expected_kind, kinds, f"commits 中应有 {expected_kind}，实际: {kinds}")

    def test_non_owner_edit_returns_403(self):
        """非 owner 调用 PUT worldbook 应返 403，提示必须 fork。"""
        owner = register_user(self.client)
        other = register_user(self.client)

        src_id = _import_script(self.client, owner["cookies"], title="鉴权测试剧本")

        # 用 other 的 cookies 尝试 POST worldbook
        r = self.client.post(
            f"/api/v1/scripts/{src_id}/worldbook",
            json={"title": "攻击条目", "content": "恶意内容"},
            cookies=other["cookies"],
        )
        self.assertEqual(r.status_code, 403, f"非 owner 必须 403，实际: {r.status_code}")
        body = r.json()
        # 错误信息应含 "fork"
        error_msg = body.get("error") or ""
        self.assertIn("fork", error_msg, f"403 错误信息应提示 fork，实际: {error_msg}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
