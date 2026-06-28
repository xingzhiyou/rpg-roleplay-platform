"""回归:回合后指针发散时,persist_runtime_state 不得丢弃 out-of-turn 编辑(固定记忆等)。

群反馈(行者无疆)第四层根因:删固定记忆「可以删但一推进剧情就回归原样」。
真因=persist_runtime_state 的发散守卫:回合后 game_saves.active 领先、user_runtime 异步同步滞后,
旧逻辑按"指针滞后"无条件 state_data=db_snapshot,把刚做的记忆删除一并丢掉。
修=指针滞后≠state 过时;仅当 incoming 质量确实更低(基于更早回合)才采用 db_snapshot。

需本机 PG(server 模式 db backend)。persist_runtime_state 自开连接 + commit,故用 autocommit + 末尾清理。
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


def _mem(pins, turn, hist):
    return {
        "memory": {"pinned": list(pins),
                   "items": [{"id": f"m{x}", "text": x, "status": "active",
                              "legacy_bucket": "pinned", "kind": "runtime_fact"} for x in pins]},
        "turn": turn, "player": {"name": "P"},
        "history": [{"role": "assistant", "content": f"h{i}"} for i in range(hist)], "world": {},
    }


@pytest.fixture()
def conn():
    try:
        c = psycopg.connect("host=localhost port=5432 dbname=rpg_platform", row_factory=dict_row)
    except Exception as exc:
        pytest.skip(f"no local rpg_platform DB: {exc}")
    c.autocommit = True
    yield c
    c.close()


def _diverged_save(c, db_turn, db_hist):
    """建 kb_native 存档:game_saves.active=N1(领先),user_runtime.active=N(滞后)。返回 (uid, save)。"""
    uid = c.execute("insert into users(username,display_name) values(%s,'e') returning id",
                    ("e2e_pdv_" + secrets.token_hex(4),)).fetchone()["id"]
    sid = c.execute("insert into scripts(owner_id,title) values(%s,'d') returning id", (uid,)).fetchone()["id"]
    save = c.execute("insert into game_saves(user_id,script_id,title,state_path,kb_native,state_snapshot) "
                     "values(%s,%s,'s','',true,%s) returning id",
                     (uid, sid, Jsonb(_mem(["A", "B"], db_turn, db_hist)))).fetchone()["id"]
    N = c.execute("insert into branch_commits(save_id,object_hash,turn_index,kind,title,state_path,state_snapshot) "
                  "values(%s,'hN',1,'turn','t','',%s) returning id", (save, Jsonb(_mem(["A", "B"], 1, 2)))).fetchone()["id"]
    N1 = c.execute("insert into branch_commits(save_id,parent_id,object_hash,turn_index,kind,title,state_path,state_snapshot) "
                   "values(%s,%s,'hN1',%s,'turn','t','',%s) returning id",
                   (save, N, db_turn, Jsonb(_mem(["A", "B"], db_turn, db_hist)))).fetchone()["id"]
    ref = c.execute("insert into branch_refs(save_id,name,target_commit_id,is_active) values(%s,'main',%s,true) returning id",
                    (save, N1)).fetchone()["id"]
    c.execute("update game_saves set active_commit_id=%s,active_branch_ref_id=%s where id=%s", (N1, ref, save))
    c.execute("insert into user_runtime(user_id,save_id,active_commit_id,active_ref_id,source_state_path,runtime_state_path) "
              "values(%s,%s,%s,%s,'','')", (uid, save, N, ref))  # 滞后在 N
    c.execute("insert into runtime_checkouts(user_id,save_id,ref_id,commit_id,runtime_state_path,state_snapshot,snapshot_hash,dirty,turn_at_commit,turn_runtime) "
              "values(%s,%s,%s,%s,'',%s,'h',false,1,1)", (uid, save, ref, N, Jsonb(_mem(["A", "B"], 1, 2))))
    from kb import save_kb
    save_kb.import_state(c, save, N1, _mem(["A", "B"], db_turn, db_hist))
    return uid, save


def _active_pinned(c, save):
    from kb import save_kb
    ac = c.execute("select active_commit_id from game_saves where id=%s", (save,)).fetchone()["active_commit_id"]
    return save_kb.materialize(c, save, ac)["memory"]["pinned"]


def test_diverged_pointer_keeps_memory_delete(conn):
    """发散(回合后滞后)+ 同回合的记忆删除 → 删除必须保留(不被 db_snapshot 覆盖)。"""
    from platform_app.branches import runtime as rt
    uid, save = _diverged_save(conn, db_turn=2, db_hist=2)
    try:
        rt.persist_runtime_state(user_id=uid, state_data=_mem(["B"], 2, 2))  # 删 A,与 db 同 turn(非过时)
        assert _active_pinned(conn, save) == ["B"], "发散时记忆删除被守卫丢弃(回归)"
    finally:
        conn.execute("delete from users where id=%s", (uid,))


def test_genuinely_stale_autosave_still_protected(conn):
    """真过时 autosave(基于更早回合、history 更短)仍应被 db_snapshot 保护,防丢回合。"""
    from platform_app.branches import runtime as rt
    uid, save = _diverged_save(conn, db_turn=3, db_hist=6)
    try:
        rt.persist_runtime_state(user_id=uid, state_data=_mem(["B"], 1, 2))  # 真过时
        row = conn.execute("select jsonb_array_length(state_snapshot->'history') hl from game_saves where id=%s", (save,)).fetchone()
        assert row["hl"] == 6, "真过时 autosave 覆盖了更富的回合(丢回合)"
    finally:
        conn.execute("delete from users where id=%s", (uid,))
