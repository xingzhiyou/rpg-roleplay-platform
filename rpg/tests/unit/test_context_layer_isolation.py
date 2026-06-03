"""build_context_bundle 的 universal layer 须逐层错误隔离:某 builder 抛异常只让该层为空,
不连累其余层(规则/状态/schema)与整轮上下文。"""
import unittest

from context_engine.core import _safe, _safe_list


class SafeLayerHelpers(unittest.TestCase):
    def test_safe_returns_value_on_success(self):
        self.assertEqual(_safe(lambda: "hello"), "hello")

    def test_safe_returns_default_on_exception(self):
        def boom():
            raise ValueError("malformed state field")
        self.assertEqual(_safe(boom), "")
        self.assertEqual(_safe(boom, default="fallback"), "fallback")

    def test_safe_coerces_none_to_empty(self):
        self.assertEqual(_safe(lambda: None), "")

    def test_safe_list_returns_list_on_success(self):
        self.assertEqual(_safe_list(lambda: [1, 2]), [1, 2])

    def test_safe_list_returns_empty_on_exception(self):
        def boom():
            raise KeyError("bad")
        self.assertEqual(_safe_list(boom), [])

    def test_safe_list_coerces_none(self):
        self.assertEqual(_safe_list(lambda: None), [])

    def test_one_failing_layer_does_not_sink_others(self):
        # 模拟 universal_layers 构造:一个 builder 抛异常,其余仍产出内容
        layers = [
            ("rules", _safe(lambda: "规则文本")),
            ("fact_groups", _safe(lambda: (_ for _ in ()).throw(RuntimeError("坏 fact")))),
            ("state", _safe(lambda: "状态文本")),
        ]
        contents = dict(layers)
        self.assertEqual(contents["rules"], "规则文本")     # 未受坏层连累
        self.assertEqual(contents["fact_groups"], "")        # 坏层降级为空
        self.assertEqual(contents["state"], "状态文本")     # 后续层仍正常


if __name__ == "__main__":
    unittest.main()
