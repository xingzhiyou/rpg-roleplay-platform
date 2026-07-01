"""流水线去 fork · 批次5:/set story_intent 口径 + weather 白名单(信号打架收尾)。"""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))


def test_set_story_intent_routes_to_player_private():
    """/set story_intent=X 必须落到 WorldlineProvider 实际读的 player_private.story_intent,
    而非没人读的顶层 data['story_intent']。"""
    from state.core import GameState
    g = GameState.new()
    g.apply_state_write_typed("story_intent", "向林有德复仇", source="user:/set", force=True)
    assert (g.data.get("player_private") or {}).get("story_intent") == "向林有德复仇"
    assert not g.data.get("story_intent"), "不应再写到没人读的顶层 story_intent"


def test_weather_writable_in_default_and_auto_review():
    """recorder/extractor 提示词声明 world.weather 可写,权限白名单必须一致(否则静默入 pending)。"""
    from state.path_ops import _write_path_allowed
    assert _write_path_allowed("world.weather", "default")
    assert _write_path_allowed("world.weather", "auto_review")
    # 只读模式仍然拦(不放松安全)
    assert not _write_path_allowed("world.weather", "read_only")


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-q"]))
