"""
test_worldline_preserves_settings.py
====================================

回归:游戏内设置「剧情引导强度」(steering_strength) 等改完后,下一回合对话
又自动跳回默认「软引导」。

根因:game_sessions.worldline jsonb 列被两个互不重叠命名空间共用 —
  (1) 世界树运行态(user_variables / projection),每回合由 state 快照整列重写;
  (2) 玩家可改设置(steering_strength 等,见 gm_serving/settings.py)+ progress_chapter。
旧代码每回合 _db_upsert_game_session 用 `worldline = excluded.worldline` 裸覆盖,
把 (2) 抹掉 → read_settings 读不到 → 回退默认。set/remove_worldline_variable 同病。

修复:所有「整列写 worldline」处都叠加保留设置键
(`worldline = <新世界树态> || _PRESERVE_SETTINGS_SQL`)。

本测试两层:
  Layer A — 源码不变量:三处写入都不能是裸覆盖,必须带保留片段。
  Layer B — 保留片段本身覆盖了全部用户设置键 + progress_chapter。
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[3]
SESSION_REPO_PY = (PROJECT / "rpg" / "platform_app" / "knowledge" / "_session_repo.py").read_text(encoding="utf-8")
WORLDLINE_PY = (PROJECT / "rpg" / "platform_app" / "knowledge" / "worldline.py").read_text(encoding="utf-8")
SETTINGS_PY = (PROJECT / "rpg" / "gm_serving" / "settings.py").read_text(encoding="utf-8")


class WorldlineUpsertPreservesSettings(unittest.TestCase):
    def test_session_upsert_not_naive_overwrite(self):
        """每回合的 _db_upsert_game_session 不能裸覆盖 worldline(那正是 bug 现场)。"""
        self.assertNotRegex(
            SESSION_REPO_PY,
            r"worldline\s*=\s*excluded\.worldline\s*,",
            "_db_upsert_game_session 不能用 `worldline = excluded.worldline,` 裸覆盖 —"
            " 会抹掉玩家设置(steering_strength 等),导致下一回合跳回默认。",
        )

    def test_session_upsert_uses_preserve_overlay(self):
        """ON CONFLICT 必须把旧行设置键叠加回新 worldline。"""
        self.assertIn("_PRESERVE_SETTINGS_SQL", SESSION_REPO_PY)
        self.assertRegex(
            SESSION_REPO_PY,
            r"worldline\s*=\s*excluded\.worldline\s*\|\|",
            "worldline 覆盖必须 `excluded.worldline || <保留设置键>`。",
        )

    def test_worldline_variable_writes_preserve_settings(self):
        """set/remove_worldline_variable 整列写 worldline 时也必须叠加保留设置键。"""
        self.assertIn("_PRESERVE_SETTINGS_SQL", WORLDLINE_PY)
        # 不能再出现裸 `worldline = %s,`(后面紧跟其它列)的整列覆盖
        self.assertNotRegex(
            WORLDLINE_PY,
            r"set\s+state\s*=\s*%s,\s*worldline\s*=\s*%s\s*,",
            "set/remove_worldline_variable 不能裸覆盖 worldline。",
        )

    def test_preserve_fragment_covers_all_setting_keys(self):
        """保留片段必须覆盖 SETTINGS_SCHEMA 全部键 + progress_chapter,
        否则漏掉的设置仍会被每回合抹掉。"""
        # 从 settings.py 源码抽出所有 setting key
        schema_keys = set(re.findall(r'"key"\s*:\s*"([a-z_]+)"', SETTINGS_PY))
        self.assertIn("steering_strength", schema_keys, "前置校验:settings.py 应含 steering_strength")

        idx = SESSION_REPO_PY.find("_PRESERVE_SETTINGS_SQL")
        end = SESSION_REPO_PY.find(")", SESSION_REPO_PY.find("'{}'::jsonb", idx))
        fragment = SESSION_REPO_PY[idx:end]
        for k in schema_keys | {"progress_chapter"}:
            self.assertIn(
                f"'{k}'", fragment,
                f"保留片段漏了设置键 {k} — 它会在下一回合被世界树覆盖抹掉。",
            )


if __name__ == "__main__":
    unittest.main()
