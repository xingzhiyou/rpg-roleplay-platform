"""回归:GM 正文里『提及』某能力,绝不等于玩家『掌握』了它。

历史 bug(uid115 反馈 #85 相邻、截图实锤):apply_structured_updates 里有一段「作者写死
regex 兜底」——只要 GM 叙事正文出现「重力控制/肉身飞行/悬浮/特殊小队」就无条件给玩家注入
《无限恐怖》某具体存档的能力/资源。后果:任意剧本里 GM 只是『伏笔/提及』重力控制(甚至只是
写了通用词「悬浮」),系统就弹「你已掌握重力控制」,且开新档也会突然触发。

修复=彻底删除该 regex 注入(不再回退此路径)。能力/资源只能由 GM 显式结构化标签(「能力：X」)、
JSON op 或 extractor 写入。本测试钉死:正文提及不注入 + 显式标签仍生效。
"""
from __future__ import annotations

import copy
import json
import os
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

os.environ.setdefault("RPG_REQUIRE_AUTH", "0")

from state import DEFAULT_STATE, GameState  # noqa: E402

HARDCODED_ABILITY = "重力控制/肉身飞行（初步掌握）"
HARDCODED_RESOURCE = "特殊小队建制"


def _make_state() -> GameState:
    s = GameState(copy.deepcopy(DEFAULT_STATE))
    s.update_time("序章")
    s.update_location("主神空间列车")
    return s


class NoHardcodedAbilityInjection(unittest.TestCase):
    def test_prose_mention_of_gravity_control_does_not_grant_ability(self):
        """复现截图:GM 把『重力控制』当伏笔写进正文 + 用了通用词『悬浮』→ 不应注入能力。"""
        s = _make_state()
        gm_response = (
            "他扣下扳机时有一种额外的稳定感。重力控制。这四个字又浮了上来——"
            "不是来自手掌,是来自更深的、还没完全摸透的地方。空气里有微尘在缓缓悬浮,"
            "他还远没有真正掌握肉身飞行那样的力量。"
        )
        s.apply_structured_updates(gm_response)
        blob = json.dumps(s.data, ensure_ascii=False)
        self.assertNotIn(HARDCODED_ABILITY, blob,
                         "GM 正文仅『提及』重力控制/悬浮/肉身飞行,绝不能注入该能力")

    def test_prose_mention_of_special_squad_does_not_grant_resource(self):
        s = _make_state()
        gm_response = "远处传来消息:雇佣兵那边似乎在筹建某种特殊小队,但与你无关。"
        s.apply_structured_updates(gm_response)
        blob = json.dumps(s.data, ensure_ascii=False)
        self.assertNotIn(HARDCODED_RESOURCE, blob,
                         "GM 正文提及『特殊小队』不应给玩家注入『特殊小队建制』资源")

    def test_explicit_ability_tag_still_works(self):
        """确认我们没误伤正路:GM 用显式结构化标签授予能力,仍应写入。"""
        s = _make_state()
        updates = s.apply_structured_updates("一股暖流涌入四肢。【能力：风之祝福】")
        mem_blob = json.dumps(s.data.get("memory", {}), ensure_ascii=False)
        self.assertIn("风之祝福", mem_blob,
                      f"显式『能力：X』标签应写入 memory.abilities;updates={updates}")


if __name__ == "__main__":
    unittest.main()
