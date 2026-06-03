"""phase digest backfill 必须挂进 run_cron COMMANDS(被每日 `run_cron all` 跑),
且命令对内部异常必须吞掉(返回 dict、绝不抛),否则一次 compact 失败会中断
`run_cron all` 的后续清理任务。

背景:异步 compact 失败/重启会留下 status='closed' summary='' 的 phase 行,
phase_digest_worker.py 有重试逻辑但此前没挂任何 cron → 永不自动重试。
"""
import unittest
from unittest import mock

from scripts import run_cron


class CronPhaseDigestBackfill(unittest.TestCase):
    def test_registered_in_commands(self):
        self.assertIn("phase_digest_backfill", run_cron.COMMANDS,
                      "phase_digest_backfill 未注册进 COMMANDS,`run_cron all` 不会跑它")
        self.assertIs(run_cron.COMMANDS["phase_digest_backfill"],
                      run_cron.cmd_phase_digest_backfill)

    def test_command_never_raises_on_find_pending_error(self):
        # find_pending 抛异常时命令必须吞掉(否则中断 run_cron all)
        fake_db = mock.MagicMock()
        with mock.patch("scripts.phase_digest_worker.find_pending",
                        side_effect=RuntimeError("db down")):
            result = run_cron.cmd_phase_digest_backfill(fake_db)
        self.assertIsInstance(result, dict)
        self.assertEqual(result["done"], 0)

    def test_command_isolates_per_phase_failure(self):
        # 单个 compact_phase 抛异常不应中断整批,计入 failed
        fake_db = mock.MagicMock()
        pend = [
            {"save_id": 1, "phase_index": 0, "user_id": 9},
            {"save_id": 1, "phase_index": 1, "user_id": 9},
        ]
        with mock.patch("scripts.phase_digest_worker.find_pending", return_value=pend), \
             mock.patch("agents.phase_digest_agent.compact_phase",
                        side_effect=[{"summary": "ok"}, RuntimeError("llm boom")]):
            result = run_cron.cmd_phase_digest_backfill(fake_db)
        self.assertEqual(result["pending"], 2)
        self.assertEqual(result["done"], 1)
        self.assertEqual(result["failed"], 1)

    def test_no_key_error_counted_separately(self):
        fake_db = mock.MagicMock()
        pend = [{"save_id": 1, "phase_index": 0, "user_id": 9}]
        with mock.patch("scripts.phase_digest_worker.find_pending", return_value=pend), \
             mock.patch("agents.phase_digest_agent.compact_phase",
                        return_value={"error": "no api key configured"}):
            result = run_cron.cmd_phase_digest_backfill(fake_db)
        self.assertEqual(result["skipped_no_key"], 1)
        self.assertEqual(result["failed"], 0)


if __name__ == "__main__":
    unittest.main()
