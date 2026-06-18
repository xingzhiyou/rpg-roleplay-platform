"""test_frontier_gating_equiv.py — P4 前沿门控等价性回归(O 方案 temporal KB 统一)。

证明:flag on 时 reveal_clause_v2(save_id) 前沿门控 ≡ 旧标量 first_revealed_chapter<=progress
(对锚点范围内的实体),且 derived_progress_chapter 由前沿确定性派生。这是「切换前影子零 diff」的
单元级证明 —— 各收口点(S1 canon / S3 角色 / S4 世界书)都是把同一 reveal_clause_v2 嵌进各自 SQL,
故本等价性成立即可放心按 save 灰度。

需要本地 Postgres(与其它 integration 测试一致)。
"""
from __future__ import annotations

import os
import unittest

from psycopg.types.json import Jsonb

from tests.helpers import cleanup_test_users, make_client, register_user

_LAST_REACHED = 5      # 标记原著 ch1..ch5 锚点 occurred
_MAX_CH = 10           # chapter_facts 覆盖 ch1..ch10 → 10 条揭示锚点


class FrontierGatingEquiv(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cleanup_test_users()
        cls.client = make_client()
        u = register_user(cls.client)
        from platform_app.db import connect, init_db
        from kb.reveal import (backfill_entity_reveal_anchors, backfill_reveal_anchors,
                               seed_frontier)
        init_db()
        with connect() as db:
            cls.owner_id = int(db.execute(
                "select id from users where username=%s", (u["username"],)).fetchone()["id"])
            cls.book_id = int(db.execute(
                "insert into books(owner_id, slug, title) values (%s,%s,%s) returning id",
                (cls.owner_id, f"fg_book_{cls.owner_id}", "fg_book")).fetchone()["id"])
            cls.script_id = int(db.execute(
                "insert into scripts(owner_id, title) values (%s,%s) returning id",
                (cls.owner_id, "fg_script")).fetchone()["id"])
            cls.save_id = int(db.execute(
                "insert into game_saves(user_id, script_id, title, state_path) "
                "values (%s,%s,%s,%s) returning id",
                (cls.owner_id, cls.script_id, "fg_save",
                 f"/tmp/fg_save_{cls.owner_id}.json")).fetchone()["id"])

            # chapter_facts ch1..10,每章一个事件 → backfill 出 10 条揭示锚点 chapter:{n}:event:0
            for n in range(1, _MAX_CH + 1):
                db.execute(
                    "insert into chapter_facts(book_id, script_id, chapter, events) "
                    "values (%s,%s,%s,%s)",
                    (cls.book_id, cls.script_id, n,
                     Jsonb([{"event": f"第{n}章发生的关键事件", "importance": "high"}])),
                )
            # canon faction:frc 1/5/10(锚点范围内)+ 0(恒可见)
            from kb import canon_repo
            for lk, name, frc in (("f1", "势力1", 1), ("f5", "势力5", 5),
                                  ("f10", "势力10", 10), ("f0", "势力0", 0)):
                canon_repo.upsert_canon_entity(
                    db, cls.script_id, lk, name=name, type="faction",
                    first_revealed_chapter=frc, importance=80, entity_subtype="x")
            # 角色卡 npc:同 frc 谱
            for name, frc in (("角色1", 1), ("角色5", 5), ("角色10", 10), ("角色0", 0)):
                db.execute(
                    "insert into character_cards(script_id, book_id, name, card_type, enabled, "
                    "first_revealed_chapter) values (%s,%s,%s,'npc',true,%s)",
                    (cls.script_id, cls.book_id, name, frc))
            # 世界书:同 frc 谱(旧无门控,S4 是新增门控)
            for title, frc in (("设定1", 1), ("设定5", 5), ("设定10", 10), ("设定0", 0)):
                db.execute(
                    "insert into worldbook_entries(script_id, book_id, title, content, enabled, "
                    "first_revealed_chapter) values (%s,%s,%s,%s,true,%s)",
                    (cls.script_id, cls.book_id, title, "内容", frc))
            # 标记 ch1..ch5 锚点 occurred(玩家已到达)
            for n in range(1, _LAST_REACHED + 1):
                db.execute(
                    "insert into save_anchor_states(save_id, script_id, anchor_key, source_chapter, "
                    "status, summary) values (%s,%s,%s,%s,'occurred',%s)",
                    (cls.save_id, cls.script_id, f"chapter:{n}:event:0", n, f"ch{n} 锚点"))

        # 回填揭示锚点 DAG + 实体映射 + 存档前沿(确定性 ETL)
        r1 = backfill_reveal_anchors(cls.script_id)
        assert r1["ok"] and r1["anchors"] == _MAX_CH, r1
        r2 = backfill_entity_reveal_anchors(cls.script_id)
        assert r2["ok"] and r2["total"] > 0, r2
        r3 = seed_frontier(cls.save_id)
        assert r3["ok"] and r3["visible"] == _LAST_REACHED, r3  # 闭包 = ch1..ch5

    @classmethod
    def tearDownClass(cls):
        cleanup_test_users()
        for k in ("RPG_TKB_FRONTIER", "RPG_TKB_FRONTIER_SHADOW", "RPG_TKB_FRONTIER_SAVES"):
            os.environ.pop(k, None)

    def _flag_on(self):
        os.environ["RPG_TKB_FRONTIER"] = "on"
        os.environ.pop("RPG_TKB_FRONTIER_SAVES", None)

    def _flag_off(self):
        os.environ["RPG_TKB_FRONTIER"] = "off"

    # ── 1. 派生进度 ────────────────────────────────────────────────────────────
    def test_derived_progress_equals_frontier_floor(self):
        from kb.reveal import derived_progress_chapter
        self.assertEqual(derived_progress_chapter(self.save_id), _LAST_REACHED)

    # ── 2. S1 canon:新前沿门控 ≡ 旧标量门控 ─────────────────────────────────────
    def test_canon_new_gating_equals_old(self):
        from kb import canon_repo
        from platform_app.db import connect
        with connect() as db:
            self._flag_off()
            old = {r["name"] for r in canon_repo.read_canon_entities(
                db, self.script_id, progress_chapter=_LAST_REACHED, mode="none",
                entity_type="faction")}
            self._flag_on()
            new = {r["name"] for r in canon_repo.read_canon_entities(
                db, self.script_id, progress_chapter=None, mode="none",
                entity_type="faction", save_id=self.save_id)}
        self.assertEqual(old, new, "前沿门控与旧标量门控不等价(canon)")
        self.assertEqual(new, {"势力1", "势力5", "势力0"})  # 势力10(ch10>5)被挡

    # ── 3. S3 角色卡:新 ≡ 旧 ────────────────────────────────────────────────────
    def test_characters_new_gating_equals_old(self):
        from context_engine.loaders import _load_characters_db
        self._flag_off()
        old = set(_load_characters_db(self.script_id, None, progress_chapter=_LAST_REACHED,
                                      foreknowledge_mode="none").keys())
        self._flag_on()
        new = set(_load_characters_db(self.script_id, None, progress_chapter=None,
                                      foreknowledge_mode="none", save_id=self.save_id).keys())
        self.assertEqual(old, new, "前沿门控与旧标量门控不等价(角色卡)")
        self.assertEqual(new, {"角色1", "角色5", "角色0"})

    # ── 4. NULL(frc=0)恒可见(I2 不变式) ──────────────────────────────────────
    def test_null_anchor_always_visible(self):
        from kb.reveal import reveal_clause_v2
        from platform_app.db import connect
        clause, params = reveal_clause_v2(self.save_id, "none", prefix="")
        with connect() as db:
            rows = db.execute(
                f"select logical_key from kb_canon_entities where script_id=%s and {clause}",
                (self.script_id, *params)).fetchall()
        keys = {r["logical_key"] for r in rows}
        self.assertIn("f0", keys, "reveal_anchor_key IS NULL 必须恒可见(等价旧 frc=0)")
        self.assertNotIn("f10", keys)

    # ── 5. S4 世界书:flag on 时新增门控挡掉未揭示条目(非等价,gap-fix) ──────────
    def test_worldbook_new_gate_hides_future(self):
        from context_engine.loaders import _load_worldbook_db
        self._flag_off()
        old = {e["title"] for e in _load_worldbook_db(self.script_id, None)}
        self._flag_on()
        new = {e["title"] for e in _load_worldbook_db(self.script_id, None,
                                                      save_id=self.save_id, mode="none")}
        self.assertEqual(old, {"设定1", "设定5", "设定10", "设定0"}, "旧路径应无门控(全集)")
        self.assertEqual(new, {"设定1", "设定5", "设定0"}, "新门控应挡掉 ch10 未揭示条目")
        self.assertTrue(new < old)

    # ── 6. omniscient 模式不门控(两路一致) ─────────────────────────────────────
    def test_omniscient_unfiltered(self):
        from kb import canon_repo
        from platform_app.db import connect
        self._flag_on()
        with connect() as db:
            rows = canon_repo.read_canon_entities(
                db, self.script_id, mode="omniscient", entity_type="faction",
                save_id=self.save_id)
        self.assertEqual({r["name"] for r in rows}, {"势力1", "势力5", "势力10", "势力0"})


if __name__ == "__main__":
    unittest.main()
