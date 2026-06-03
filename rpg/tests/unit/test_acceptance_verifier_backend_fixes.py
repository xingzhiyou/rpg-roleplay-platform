"""acceptance verifier 后端选择层两处修复(都会致 verifier 静默降级 rule):
- vertex 通道必须透传 user_id(否则生产鉴权下 SA 凭证拿不到 → backend 失效)。
- openai-compat 通道必须传 verifier 自己的 json_hint={"unmet":[...]}(否则复用 extractor 的
  硬编码 {"ops":[...]} 与 verifier schema 矛盾)。
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AV = (ROOT / "agents" / "acceptance_verifier.py").read_text(encoding="utf-8")
EX = (ROOT / "agents" / "extractor.py").read_text(encoding="utf-8")


class VertexUserIdPassed(unittest.TestCase):
    def test_vertex_backend_gets_user_id(self):
        i = AV.find('api_id == "vertex_ai"')
        self.assertNotEqual(i, -1)
        block = AV[i:i + 900]
        self.assertTrue(re.search(r"_VertexBackend\([^)]*user_id\s*=\s*user_id", block),
                        "vertex verifier backend 未透传 user_id → 生产鉴权下静默降级 rule")


class OpenAICompatJsonHint(unittest.TestCase):
    def test_helper_has_json_hint_param(self):
        i = EX.find("def _call_openai_compat_json_mode(")
        sig = EX[i:i + 250]
        self.assertIn("json_hint", sig, "helper 未加 json_hint 参数")
        # 默认值保留 ops(extractor 行为不变)
        self.assertTrue(re.search(r'json_hint[^\n]*ops', sig), "json_hint 默认值应保留 ops(不破坏 extractor)")

    def test_verifier_passes_unmet_hint(self):
        i = AV.find("_call_openai_compat_json_mode(")
        block = AV[i:i + 400]
        self.assertTrue(re.search(r'json_hint\s*=\s*[\'"]\{"unmet"', block),
                        "verifier 未传 unmet json_hint → 与 extractor 的 ops 提示矛盾,降级 rule")

    def test_helper_uses_json_hint_in_prompt(self):
        # extractor 拼 system prompt 时用的是 json_hint 变量而非硬编码
        self.assertIn("{json_hint}", EX, "extractor system prompt 仍硬编码格式提示")


if __name__ == "__main__":
    unittest.main()
