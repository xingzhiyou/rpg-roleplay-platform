"""test_pinned_memory_persists.py — 固定记忆(pinned)out-of-turn 编辑必须穿过 KB materialize。

用户反馈(uid115):固定上下文(本轮上下文必带)「解除后还在、加不了新的」。根因:kb_state(默认开)
下读路径从 KB materialize,而 out-of-turn 编辑走的 autosave 路径 persist_runtime_state **此前不把
blob re-import 进 KB**(只有 record_runtime_turn 每回合 import)。于是冷 worker / 缓存失效后从旧 KB
materialize,把增删回退。修复=persist_runtime_state 也在现 commit 上幂等 import_state。

本测试用 _persist_runtime_checkpoint(memory 路由的确切持久化路径)+ _invalidate_runtime(模拟冷
重载/换 worker)钉死:pinned 增删都能穿过 materialize 存活。
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

os.environ.setdefault("RPG_REQUIRE_AUTH", "1")
os.environ.setdefault("RPG_KB_STATE", "1")  # 显式确保走 KB-backed 读路径(本 bug 的前提)

from tests.helpers import cleanup_test_users, make_client, register_user  # noqa: E402


def _runtime_state(user_id: int):
    import app as _ui
    state = _ui._state_by_user.get(user_id)
    assert state is not None, f"user {user_id} 没有活跃 runtime"
    return state


def _invalidate(user_id: int) -> None:
    import app as _ui
    _ui._invalidate_user_cache({"id": user_id})


def _persist(user_id: int) -> None:
    """走 memory 路由的确切持久化路径(state.save + _persist_runtime_checkpoint)。"""
    import app as _ui
    state = _ui._state_by_user.get(user_id)
    state.save()
    _ui._persist_runtime_checkpoint(state, {"id": user_id})


def _pinned_from_state(body: dict) -> list:
    mem = body.get("memory") or body.get("state", {}).get("memory") or {}
    return list(mem.get("pinned") or [])


class PinnedMemoryPersistsThroughMaterialize(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cleanup_test_users()
        cls.client = make_client()

    @classmethod
    def tearDownClass(cls):
        cleanup_test_users()

    def _mk_script(self, uid: int, title: str) -> int:
        from platform_app.db import connect
        with connect() as db:
            scr = db.execute(
                "insert into scripts(owner_id, title) values (%s, %s) returning id",
                (uid, title),
            ).fetchone()
        return int(scr["id"])

    def _setup(self):
        u = register_user(self.client)
        self.assertEqual(u["status"], 200, f"register failed: {u['body']}")
        cookies = u["cookies"]
        me = self.client.get("/api/v1/auth/me", cookies=cookies)
        user_id = int(me.json()["user"]["id"])
        # 建一个可持久化的活跃存档(否则没有 runtime 绑定,persist 是 no-op)
        script_id = self._mk_script(user_id, "integtest_pinned")
        r = self.client.post("/api/v1/saves", json={
            "title": "integtest pinned save", "script_id": script_id,
            "new_card": {"name": "测试玩家", "role": "测试身份", "background": "bg"},
        }, cookies=cookies)
        self.assertEqual(r.status_code, 200, r.text[:300])
        save_id = int(((r.json() or {}).get("save") or {}).get("id") or 0)
        self.assertGreater(save_id, 0)
        ra = self.client.post(f"/api/v1/saves/{save_id}/activate", json={}, cookies=cookies)
        self.assertEqual(ra.status_code, 200, ra.text[:300])
        # 触发 _ensure_loaded → KB materialize 注册 runtime
        self.client.get("/api/v1/state", cookies=cookies)
        return cookies, user_id

    def test_pin_add_survives_cold_reload(self):
        """加固定记忆 → autosave → 清缓存冷重载 → 仍在(修前会被旧 KB materialize 回退)。"""
        cookies, user_id = self._setup()
        PIN = "轮回者加上赵时人数应为7人"

        state = _runtime_state(user_id)
        self.assertTrue(state.add_memory("pinned", PIN))
        _persist(user_id)

        _invalidate(user_id)  # 模拟换 worker / 重新打开页面 → 从 KB materialize
        body = self.client.get("/api/v1/state", cookies=cookies).json()
        self.assertIn(PIN, _pinned_from_state(body),
                      f"冷重载后固定记忆丢失(persist 未同步进 KB?): {_pinned_from_state(body)}")

    def test_pin_remove_survives_cold_reload(self):
        """解除固定记忆 → autosave → 冷重载 → 真没了(修前会『解除后还在』)。"""
        cookies, user_id = self._setup()
        KEEP, DROP = "詹岚在张杰身边", "李萧毅偷看詹岚"

        state = _runtime_state(user_id)
        state.add_memory("pinned", KEEP)
        state.add_memory("pinned", DROP)
        _persist(user_id)
        _invalidate(user_id)
        body = self.client.get("/api/v1/state", cookies=cookies).json()
        pinned = _pinned_from_state(body)
        self.assertIn(DROP, pinned)
        drop_idx = pinned.index(DROP)

        # 解除 DROP(materialize 后重取 state,索引以材料化结果为准)
        state = _runtime_state(user_id)
        state.remove_memory("pinned", drop_idx)
        _persist(user_id)
        _invalidate(user_id)

        body2 = self.client.get("/api/v1/state", cookies=cookies).json()
        pinned2 = _pinned_from_state(body2)
        self.assertNotIn(DROP, pinned2, f"解除后固定记忆仍在(persist 未同步删除进 KB): {pinned2}")
        self.assertIn(KEEP, pinned2, f"误删了应保留的固定记忆: {pinned2}")


if __name__ == "__main__":
    unittest.main()
