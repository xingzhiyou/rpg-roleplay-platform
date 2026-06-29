"""回归:游戏内切模型必须真正落到 DB(runtime_checkouts),让跨 worker 漂移检测读得到。

群反馈(白玖)「切换模型,但后端仍复用切换前的模型」——反复出现。真根因:
`state_repository.persist_session_model` 的 SELECT `join user_runtime ur on ur.checkout_id=rc.id`
引用了 **user_runtime 根本不存在的列 checkout_id** → 每次抛 UndefinedColumn 被外层 except 静默吞掉
→ session_model 从不落 runtime_checkouts → `read_runtime/_attach_db_state`(读 runtime_checkouts.
state_snapshot->session_model)永远拿不到新值 → app.py 的跨 worker model_drift 检测形同虚设
(逻辑对、数据源被静默掐断)。workers=4 下切换只在处理该请求的 worker 内存里生效,绝大多数 GM
请求落到没切过的 worker → 旧模型。

修:persist 改按 (user_id,save_id) 取 runtime_checkouts(与 _attach_db_state 同一行,该组合唯一)。
本测试真库复现:persist 后 read_runtime 必须能读到新 session_model。

需本机 PG(server 模式)。各函数自开连接 + commit,故 autocommit + 末尾删 user 清理。
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


def _active_save(c):
    """建一个带 runtime_checkout + user_runtime 的活跃存档。返回 (uid, save)。"""
    uid = c.execute("insert into users(username,display_name) values(%s,'e') returning id",
                    ("e2e_sm_" + secrets.token_hex(4),)).fetchone()["id"]
    sid = c.execute("insert into scripts(owner_id,title) values(%s,'d') returning id", (uid,)).fetchone()["id"]
    save = c.execute("insert into game_saves(user_id,script_id,title,state_path,kb_native,state_snapshot) "
                     "values(%s,%s,'s','',false,%s) returning id",
                     (uid, sid, Jsonb({"turn": 1}))).fetchone()["id"]
    cm = c.execute("insert into branch_commits(save_id,object_hash,turn_index,kind,title,state_path,state_snapshot) "
                   "values(%s,'h1',1,'turn','t','',%s) returning id", (save, Jsonb({"turn": 1}))).fetchone()["id"]
    ref = c.execute("insert into branch_refs(save_id,name,target_commit_id,is_active) values(%s,'main',%s,true) returning id",
                    (save, cm)).fetchone()["id"]
    c.execute("update game_saves set active_commit_id=%s,active_branch_ref_id=%s where id=%s", (cm, ref, save))
    c.execute("insert into user_runtime(user_id,save_id,active_commit_id,active_ref_id,source_state_path,runtime_state_path) "
              "values(%s,%s,%s,%s,'','')", (uid, save, cm, ref))
    c.execute("insert into runtime_checkouts(user_id,save_id,ref_id,commit_id,runtime_state_path,state_snapshot,snapshot_hash,dirty,turn_at_commit,turn_runtime) "
              "values(%s,%s,%s,%s,'',%s,'h',false,1,1)", (uid, save, ref, cm, Jsonb({"turn": 1})))
    return uid, save


def test_persist_session_model_readable_by_read_runtime(conn):
    """切模型 → persist → read_runtime 必须读到新值(否则跨 worker 漂移检测拿不到 = 切了不生效)。"""
    from platform_app.runtime import read_runtime
    from state_repository import persist_session_model
    uid, save = _active_save(conn)
    try:
        # 切前:read_runtime 无 session_model
        assert not (read_runtime(user_id=uid) or {}).get("session_model", {}).get("model_id")
        persist_session_model(save_id=save, model_id="deepseek-v4-flash", api_id="evomap", user_id=uid)
        sm = (read_runtime(user_id=uid) or {}).get("session_model") or {}
        assert sm.get("model_id") == "deepseek-v4-flash" and sm.get("api_id") == "evomap", \
            f"persist 没落到 read_runtime 能读到的 runtime_checkouts(切了不生效根因);实读={sm}"
    finally:
        conn.execute("delete from users where id=%s", (uid,))


def test_persist_writes_runtime_checkouts_row(conn):
    """直接看 runtime_checkouts.state_snapshot 确实被写入 session_model。"""
    from state_repository import persist_session_model
    uid, save = _active_save(conn)
    try:
        persist_session_model(save_id=save, model_id="m1", api_id="a1", user_id=uid)
        row = conn.execute("select state_snapshot->'session_model' as sm from runtime_checkouts "
                           "where user_id=%s and save_id=%s", (uid, save)).fetchone()
        assert (row["sm"] or {}).get("model_id") == "m1", f"runtime_checkouts 没写进 session_model: {row['sm']}"
    finally:
        conn.execute("delete from users where id=%s", (uid,))
