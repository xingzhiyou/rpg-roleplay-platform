"""Phase D 无剧本存档(酒馆未绑剧本/自由模式)防炸:script_id=None 不得进 int()。

生产实况(2026-06-10):assemble_gm_context 对 script_id=None 的存档一路传到
build_constant_layer 的 int(script_id) 抛 TypeError,Phase D 注入整轮静默跳过
(chat_pipeline 兜底吞掉,只留 warning)。应:无剧本 → 空注入早退,不碰 script 域查询。
"""
from gm_serving.context_inject import build_constant_layer
from gm_serving.serve import assemble_gm_context


class _NoScriptDB:
    """game_saves 行 script_id=NULL、无 game_sessions 行;其余查询一律不该发生。"""

    def __init__(self):
        self._last_sql = ""

    def execute(self, sql, params=None):
        self._last_sql = sql
        return self

    def fetchone(self):
        if "game_saves" in self._last_sql:
            return {"script_id": None, "active_commit_id": None, "state_snapshot": None}
        if "game_sessions" in self._last_sql:
            return None
        raise AssertionError(f"无剧本存档不应再发起 script 域查询: {self._last_sql}")


class _BoomDB:
    def execute(self, *a, **kw):
        raise AssertionError("script_id 为空时不应触碰 DB")


def test_assemble_gm_context_no_script_returns_empty_injection():
    out = assemble_gm_context(_NoScriptDB(), save_id=1, user_id=53, user_input="你好")
    assert out["injection_text"] == ""
    assert out["kb_tools"] == []
    assert "error" not in out
    # impact 与 script 无关,仍应正常分级
    assert out["impact"]["level"]


def test_build_constant_layer_none_script_returns_empty():
    assert build_constant_layer(_BoomDB(), None) == ""
    assert build_constant_layer(_BoomDB(), 0) == ""
