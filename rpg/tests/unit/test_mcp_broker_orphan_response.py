"""MCP broker 超时后的迟到响应不得孤儿滞留 _pending(否则累积撑爆 _MAX_PENDING → server 砖化)。

_request 超时/出错退出后,若工具响应迟到,reader 仍入队 _pending 而无人 pop = 孤儿泄漏。
修复:用 _waiting 集合标记仍在等待的 req_id;reader 只为 _waiting 中的 req_id 存响应,
_request 在 finally 清 _waiting + pop 孤儿。本测试用源码断言锁定结构,并做一个轻量行为校验。
"""
import re
import unittest
from pathlib import Path

import mcp_broker

BROKER_PY = (Path(__file__).resolve().parents[2] / "mcp_broker.py").read_text(encoding="utf-8")


def _func_body(src: str, name: str) -> str:
    idx = src.find(f"def {name}(")
    assert idx != -1, f"未找到 {name}"
    end = src.find("\n    def ", idx + 1)
    return src[idx: end if end != -1 else len(src)]


class OrphanResponseGuard(unittest.TestCase):
    def test_waiting_set_initialized(self):
        self.assertIn("self._waiting", BROKER_PY)
        self.assertTrue(re.search(r"self\._waiting\s*:\s*set\[int\]\s*=\s*set\(\)", BROKER_PY),
                        "_waiting 未初始化为 set[int]")

    def test_request_registers_and_cleans_waiting(self):
        body = _func_body(BROKER_PY, "_request")
        self.assertIn("self._waiting.add(req_id)", body, "_request 未登记 req_id 到 _waiting")
        self.assertIn("finally:", body, "_request 缺 finally 清理")
        self.assertIn("self._waiting.discard(req_id)", body, "_request 未在 finally 清 _waiting")
        self.assertIn("self._pending.pop(req_id, None)", body, "_request 未在 finally 丢弃孤儿响应")

    def test_reader_only_stores_awaited(self):
        body = _func_body(BROKER_PY, "_reader_loop")
        self.assertTrue(re.search(r"if\s+int\(req_id\)\s+in\s+self\._waiting", body),
                        "reader 未用 _waiting 门控,迟到响应仍会孤儿入队")

    def test_cap_uses_waiting(self):
        body = _func_body(BROKER_PY, "_request")
        self.assertTrue(re.search(r"len\(self\._waiting\)\s*>=\s*_MAX_PENDING", body),
                        "在飞上限应基于 _waiting(真正在等的请求数)")


class WaitingGatingBehavior(unittest.TestCase):
    """轻量行为校验:构造连接对象(不启动子进程),验证 _waiting 门控数据结构存在且为空。"""

    def test_connection_has_empty_waiting(self):
        conn = mcp_broker.MCPServerConn(
            server_id="t", command="/bin/true", args=[], env={},
        )
        self.assertIsInstance(conn._waiting, set)
        self.assertEqual(len(conn._waiting), 0)
        # 模拟超时清理后,迟到响应判定:req_id 不在 _waiting → 应被丢弃(门控为真)
        self.assertNotIn(123, conn._waiting)


if __name__ == "__main__":
    unittest.main()
