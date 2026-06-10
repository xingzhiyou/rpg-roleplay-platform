"""console assistant 的 llm loop 错误面与 routes/game.py 共用提供商错误分类:
BYOK 余额耗尽/key 无效/限流必须给可行动文案,不能一刀切「助手内部错误,请稍后重试」。"""
from pathlib import Path

from agents.provider_errors import classify_provider_error

SRC = (Path(__file__).resolve().parents[2] / "console_assistant" / "llm_loop.py").read_text(encoding="utf-8")


def test_classify_balance():
    class _E(Exception):
        status_code = 402
    cat, msg = classify_provider_error(_E("Insufficient Balance"))
    assert cat == "balance"
    assert "充值" in msg
    assert "Insufficient" not in msg


def test_classify_auth():
    cat, msg = classify_provider_error(RuntimeError("Incorrect API key provided: sk-123"))
    assert cat == "auth"
    assert "sk-123" not in msg


def test_classify_ratelimit():
    class _E(Exception):
        code = 429
    cat, msg = classify_provider_error(_E("Resource has been exhausted (e.g. check quota)."))
    assert cat == "ratelimit"


def test_classify_unknown_returns_none():
    assert classify_provider_error(RuntimeError("connection to server at 10.0.0.5 failed")) is None
    assert classify_provider_error(FileNotFoundError("/opt/rpg-roleplay/.env")) is None


def test_llm_loop_uses_shared_classifier():
    # 防回归:console 错误面必须走统一分类,而非只回泛化文案
    assert "classify_provider_error" in SRC, "console llm loop 未接入 provider 错误分类"
