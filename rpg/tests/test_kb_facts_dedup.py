"""回归:KB 事实库不得出现重复条目(群反馈 行者无疆「事实库大量重复条目,这一条就有9条」)。

根因:事实/事件用 index-keyed logical_key(fact:{i}/kevt:{i})。桶收缩或重排后,高 index 的旧
fact:{i} 行不会退役 → 同一文本残留在多个 logical_key 上,_newest_visible 各取一行 → materialize
重复读出(真库 save 268 实测 memory.facts 149 条仅 41 唯一,某条 ×15)。

修两层:① materialize 按 summary 去重(保序)→ 所有存档下次加载即干净;② import_state 写前桶去重 +
写后按当前长度退役高 index 孤儿 → 根治累积、下回合自愈。本测试真库复现两层。

需本机 PG。各 helper 用同一连接 autocommit + 末尾删 save 清理。
"""
import os
import secrets
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("RPG_REQUIRE_AUTH", "1")

psycopg = pytest.importorskip("psycopg")
from psycopg.rows import dict_row  # noqa: E402
from psycopg.types.json import Jsonb  # noqa: E402


@pytest.fixture()
def conn():
    try:
        c = psycopg.connect("host=localhost port=5432 dbname=rpg_platform", row_factory=dict_row)
    except Exception as exc:
        pytest.skip(f"no local rpg_platform DB: {exc}")
    c.autocommit = True
    yield c
    c.close()


def _save_with_commit(c):
    uid = c.execute("insert into users(username,display_name) values(%s,'e') returning id",
                    ("e2e_kbf_" + secrets.token_hex(4),)).fetchone()["id"]
    sid = c.execute("insert into scripts(owner_id,title) values(%s,'d') returning id", (uid,)).fetchone()["id"]
    save = c.execute("insert into game_saves(user_id,script_id,title,state_path,kb_native,state_snapshot) "
                     "values(%s,%s,'s','',true,%s) returning id", (uid, sid, Jsonb({"turn": 1}))).fetchone()["id"]
    cm = c.execute("insert into branch_commits(save_id,object_hash,turn_index,kind,title,state_path,state_snapshot) "
                   "values(%s,'h1',1,'turn','t','',%s) returning id", (save, Jsonb({"turn": 1}))).fetchone()["id"]
    return uid, save, cm


def test_materialize_dedups_facts(conn):
    """3 个 logical_key 同文本(模拟孤儿)→ materialize 只还原 1 条。"""
    from kb import save_kb
    uid, save, cm = _save_with_commit(conn)
    try:
        for lk in ("fact:0", "fact:1", "fact:5"):  # 三个不同 key、同文本(孤儿堆积)
            conn.execute("insert into kb_events(save_id,born_commit,logical_key,summary,metadata) "
                         "values(%s,%s,%s,%s,%s)", (save, cm, lk, "与素世观看MyGO", Jsonb({"source": "memory.facts"})))
        conn.execute("insert into kb_events(save_id,born_commit,logical_key,summary,metadata) "
                     "values(%s,%s,'fact:2',%s,%s)", (save, cm, "另一条事实", Jsonb({"source": "memory.facts"})))
        facts = (save_kb.materialize(conn, save, cm).get("memory") or {}).get("facts") or []
        assert facts.count("与素世观看MyGO") == 1, f"materialize 没去重,facts={facts}"
        assert "另一条事实" in facts and len(facts) == 2, f"去重过头/漏,facts={facts}"
    finally:
        conn.execute("delete from users where id=%s", (uid,))


def test_import_retires_orphan_indices(conn):
    """桶从 3 条缩到 1 条 → import 后 fact:1/fact:2 孤儿被退役,materialize 不再读出。"""
    from kb import save_kb
    uid, save, cm = _save_with_commit(conn)
    try:
        save_kb.import_state(conn, save, cm, {"turn": 1, "memory": {"facts": ["A", "B", "C"]}})
        assert sorted((save_kb.materialize(conn, save, cm).get("memory") or {}).get("facts") or []) == ["A", "B", "C"]
        # 桶缩成 1 条 → 应退役 fact:1(B)、fact:2(C)
        cm2 = conn.execute("insert into branch_commits(save_id,parent_id,object_hash,turn_index,kind,title,state_path,state_snapshot) "
                           "values(%s,%s,'h2',2,'turn','t','',%s) returning id", (save, cm, Jsonb({"turn": 2}))).fetchone()["id"]
        save_kb.import_state(conn, save, cm2, {"turn": 2, "memory": {"facts": ["A"]}})
        facts2 = (save_kb.materialize(conn, save, cm2).get("memory") or {}).get("facts") or []
        assert facts2 == ["A"], f"孤儿 index 没退役,materialize 仍读出 B/C:{facts2}"
    finally:
        conn.execute("delete from users where id=%s", (uid,))
