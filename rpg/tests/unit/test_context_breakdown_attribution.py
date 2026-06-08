"""test_context_breakdown_attribution.py — 上下文用量 breakdown 归类回归。

修复:酒馆角色卡层错归 system_prompt(角色卡显示 0);历史/系统模板/工具不是 context 层
→ master 在 respond_stream_with_tools 记 system_prompt_tokens/tools_tokens/history_tokens 到
last_context,endpoint 还原到对应类目。
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


class LayerCategoryMapping(unittest.TestCase):
    def test_tavern_card_layers_map_to_character_cards(self):
        from routes.game import _LAYER_CATEGORY
        for lid in ("tavern_character", "tavern_persona", "tavern_card_system"):
            self.assertIn(lid, _LAYER_CATEGORY, f"{lid} 未映射 → 会错归 system_prompt")
            self.assertEqual(_LAYER_CATEGORY[lid][0], "character_cards",
                             f"{lid} 应归 角色卡(character_cards)")

    def test_game_player_card_still_mapped(self):
        from routes.game import _LAYER_CATEGORY
        self.assertEqual(_LAYER_CATEGORY["player_card"][0], "character_cards")

    def test_category_order_covers_history_and_tools(self):
        from routes.game import _CATEGORY_ORDER
        keys = [k for k, _, _ in _CATEGORY_ORDER]
        for k in ("history", "system_prompt", "character_cards", "tools"):
            self.assertIn(k, keys)


class RecordedExtrasBucketing(unittest.TestCase):
    """模拟 endpoint 的类目累加:layer 桶 + last_context 记录的 system/tools/history 还原。"""

    def test_recorded_tokens_land_in_right_categories(self):
        from routes.game import _LAYER_CATEGORY
        # 模拟一个酒馆 last_context:卡层 + memory 层 + user_input 层
        layers = [
            {"id": "tavern_card_system", "estimated_tokens": 400},
            {"id": "tavern_character", "estimated_tokens": 900},
            {"id": "tavern_persona", "estimated_tokens": 200},
            {"id": "memory", "estimated_tokens": 32},
            {"id": "user_input", "estimated_tokens": 8},
        ]
        last_ctx = {
            "layers": layers,
            "system_prompt_tokens": 350,   # 基座系统模板
            "tools_tokens": 1200,          # 工具定义
            "history_tokens": 2600,        # 多轮历史 messages
        }
        cat = {}
        for ly in last_ctx["layers"]:
            key = _LAYER_CATEGORY.get(ly["id"], ("system_prompt",))[0]
            cat[key] = cat.get(key, 0) + ly["estimated_tokens"]
        cat["system_prompt"] = cat.get("system_prompt", 0) + last_ctx["system_prompt_tokens"]
        cat["tools"] = cat.get("tools", 0) + last_ctx["tools_tokens"]
        cat["history"] = cat.get("history", 0) + last_ctx["history_tokens"]
        # 角色卡 = 三张卡层之和(不再是 0,也不再混入 system_prompt)
        self.assertEqual(cat["character_cards"], 400 + 900 + 200)
        # 对话历史 = user_input(8) + 多轮历史(2600)
        self.assertEqual(cat["history"], 8 + 2600)
        # 工具 = 工具定义(1200),不再是 0
        self.assertEqual(cat["tools"], 1200)
        # 系统提示 = 基座模板(350),卡层不再错归这里
        self.assertEqual(cat["system_prompt"], 350)


if __name__ == "__main__":
    unittest.main()
