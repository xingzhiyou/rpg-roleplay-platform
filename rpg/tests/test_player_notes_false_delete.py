"""玩家笔记「假删除」复现 + 回归测试。

行者无疆反馈:玩家笔记删了,点「推进剧情」又自动加回来,时有时无。

根因(本测试钉死):
  add_memory(bucket, text) 会 dual-write —— 既进 legacy bucket(memory[bucket]),
  又进结构化 memory.items(legacy_bucket=bucket, status=active)。GM 上下文
  (context_engine.layers._fact_groups_layer)只读 memory.items 且只取 active。
  旧 remove_memory 只 pop legacy bucket、不清 items → 被删条目仍 active 留在
  items → 下回合注入 GM 上下文 → GM 复述 → apply_ops 又写回 bucket = 复活。
  「时有时无」= 是否复活取决于 GM 这回合是否复述(LLM 非确定)。

修复:remove_memory 同步硬删 items 中匹配条目,两套表示删除时严格一致。
本测试断言确定性缝(删除后 items / GM 上下文都不含该条目),不依赖 LLM。
"""
import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from state.core import GameState  # noqa: E402


def _active_item_texts(state, bucket="notes"):
    return [
        i["text"]
        for i in state.data["memory"].get("items", [])
        if i.get("legacy_bucket") == bucket and (i.get("status") or "active") == "active"
    ]


def _gm_memory_context(state):
    """渲染 GM 实际看到的记忆上下文(复活的真正来源)。"""
    from context_engine.layers import _fact_groups_layer
    return _fact_groups_layer(state)


def test_remove_note_purges_structured_items_and_gm_context():
    s = GameState({"turn": 1, "memory": {}})
    s.add_memory("notes", "阿衡可能不是守人亲女")
    s.add_memory("notes", "守人房间有暗格")

    # 前置:两套表示都含两条
    assert s.data["memory"]["notes"] == ["阿衡可能不是守人亲女", "守人房间有暗格"]
    assert _active_item_texts(s) == ["阿衡可能不是守人亲女", "守人房间有暗格"]
    assert "阿衡可能不是守人亲女" in _gm_memory_context(s)

    # 删第 0 条(前端走的就是 remove_memory(bucket, index))
    s.remove_memory("notes", 0)

    # 修复后:legacy bucket 没了
    assert s.data["memory"]["notes"] == ["守人房间有暗格"]
    # 关键:结构化 items 里也必须没了(否则下回合注入 GM 上下文 → 复活)
    assert "阿衡可能不是守人亲女" not in _active_item_texts(s), "被删笔记仍滞留在 memory.items(复活源)"
    assert _active_item_texts(s) == ["守人房间有暗格"]
    # 关键:GM 实际看到的记忆上下文里不能再出现被删笔记
    ctx = _gm_memory_context(s)
    assert "阿衡可能不是守人亲女" not in ctx, "被删笔记仍出现在 GM 上下文(会被复述写回)"
    assert "守人房间有暗格" in ctx, "未删的笔记不应被误删"


def test_remove_survives_save_load_roundtrip():
    """模拟「推进剧情」:一回合会存档→读档(跑 _migrate)。删除必须挺过这个循环。"""
    s = GameState({"turn": 3, "memory": {}})
    s.add_memory("notes", "唯一一条笔记")
    s.remove_memory("notes", 0)

    # 存→读(回合的真实路径,会触发 items 为空时的 legacy 回填 migration)
    reloaded = GameState(copy.deepcopy(s.data))
    assert reloaded.data["memory"].get("notes", []) == []
    assert _active_item_texts(reloaded) == [], "读档后被删笔记又从 legacy bucket 回填进 items"
    assert "唯一一条笔记" not in _gm_memory_context(reloaded)


def test_remove_only_targets_matching_active_item():
    """同文本多条 / 多 bucket 不串删:只删对应 bucket 的一条 active。"""
    s = GameState({"turn": 1, "memory": {}})
    s.add_memory("notes", "相同文本")
    s.add_memory("facts", "相同文本")  # 不同 bucket,同文本
    assert _active_item_texts(s, "notes") == ["相同文本"]
    assert _active_item_texts(s, "facts") == ["相同文本"]

    s.remove_memory("notes", 0)
    # 只删 notes 那条,facts 的同文本保留
    assert _active_item_texts(s, "notes") == []
    assert _active_item_texts(s, "facts") == ["相同文本"]


def test_remove_then_readd_same_text_works():
    """删后重新添加同文本应成功(bucket dedup 不被残留 items 干扰)。"""
    s = GameState({"turn": 1, "memory": {}})
    s.add_memory("notes", "可重添的笔记")
    s.remove_memory("notes", 0)
    assert s.add_memory("notes", "可重添的笔记") is True
    assert s.data["memory"]["notes"] == ["可重添的笔记"]
    assert _active_item_texts(s) == ["可重添的笔记"]


def test_remove_pinned_purges_items_and_gm_context():
    """固定记忆(pinned)同样的「假删除」—— 行者无疆二次反馈。

    pin_memory 走 add_memory('pinned',…)(legacy_bucket=pinned)同样 dual-write,
    旧 remove_memory 同样只 pop bucket → 删了的固定记忆仍 active 留 items →
    复活。本根因修复对 bucket 通用,这里显式钉死 pinned 也被覆盖。"""
    s = GameState({"turn": 1, "memory": {}})
    s.add_memory("pinned", "主角是穿越者")
    s.add_memory("pinned", "守人房间有暗格")
    assert "主角是穿越者" in _gm_memory_context(s)

    s.remove_memory("pinned", 0)
    assert s.data["memory"]["pinned"] == ["守人房间有暗格"]
    assert "主角是穿越者" not in _active_item_texts(s, "pinned"), "被删固定记忆仍滞留 items(复活源)"
    assert "主角是穿越者" not in _gm_memory_context(s), "被删固定记忆仍在 GM 上下文"
    assert "守人房间有暗格" in _gm_memory_context(s)
