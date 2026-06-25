"""回归:GM/史官 绝不能改写玩家姓名(群反馈:AI 把玩家主角改成原著男主郑吒,删回合也回不来)。

确定性硬拒:apply_state_write_typed 对 source=gm* 的 player.name 改名,在已有非空姓名且值不同时一律拒。
玩家本人(/set,source=player*)、建档(空姓名→首次设定)不受影响。
"""
from __future__ import annotations

import copy
import os
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
os.environ.setdefault("RPG_REQUIRE_AUTH", "0")

from state import DEFAULT_STATE, GameState  # noqa: E402


def _state(name: str = "") -> GameState:
    s = GameState(copy.deepcopy(DEFAULT_STATE))
    if name:
        s.data["player"]["name"] = name
    return s


class PlayerNameProtection(unittest.TestCase):
    def test_gm_cannot_rename_player(self):
        s = _state("我的自定义主角")
        res = s.apply_state_write_typed("player.name", "郑吒", source="gm")
        self.assertIn("拒绝", res)
        self.assertEqual(s.data["player"]["name"], "我的自定义主角", "GM 不应改写玩家姓名")

    def test_recorder_json_origin_also_blocked(self):
        s = _state("林有德")
        res = s.apply_state_write_typed("player.name", "郑吒", source="gm:json")
        self.assertIn("拒绝", res)
        self.assertEqual(s.data["player"]["name"], "林有德")

    def test_first_time_set_allowed_when_empty(self):
        """空姓名(尚未建档)→ 允许首次设定(不是覆盖)。"""
        s = _state("")
        s.apply_state_write_typed("player.name", "初设之名", source="gm")
        self.assertEqual(s.data["player"]["name"], "初设之名")

    def test_same_value_noop_not_rejected(self):
        """GM 写回相同姓名(no-op)不算改写,不报拒绝。"""
        s = _state("郑吒")
        res = s.apply_state_write_typed("player.name", "郑吒", source="gm")
        self.assertNotIn("拒绝", res)
        self.assertEqual(s.data["player"]["name"], "郑吒")

    def test_player_set_can_change_own_name(self):
        s = _state("旧名")
        s.apply_state_write_typed("player.name", "玩家改的新名", source="player_set")
        self.assertEqual(s.data["player"]["name"], "玩家改的新名", "玩家本人应能改自己的名字")


if __name__ == "__main__":
    unittest.main()
