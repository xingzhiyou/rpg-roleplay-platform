"""agents/provider_errors.py — LLM 提供商错误 → 用户可行动文案(确定性分类,单一真相)。

BYOK 场景下「余额耗尽 / key 无效 / 限流」是用户自己能解决的三类错误,绝不能落进
「请重试」泛化兜底(生产实况:DeepSeek 402 余额耗尽,玩家按提示连撞 7 次)。
routes/game.py 的 SSE 错误面与 console_assistant 的 llm loop 共用此分类。

文案必须客户端安全:固定中文文案,不回显 str(exc)(可能含路径/凭据/SDK 内部细节)。
"""
from __future__ import annotations

# 余额/计费配额耗尽:充值才能解决。注意 OpenAI 的 insufficient_quota 走 HTTP 429,
# 但本质是计费问题,必须先于限流判定。
_BALANCE_MARKERS = (
    "insufficient balance",          # DeepSeek 402
    "insufficient_quota",            # OpenAI 429(计费)
    "exceeded your current quota",   # OpenAI 429(计费)
    "insufficient credits",          # OpenRouter 402
    "payment required",              # 通用 402 reason phrase
)

_AUTH_MARKERS = (
    "incorrect api key",
    "invalid api key",
    "please pass a valid api key",   # Google "API key not valid. Please pass a valid API key."
    "401 unauthorized",
    "authentication fails",          # DeepSeek 401 "Authentication Fails (no such user)"
)

# 限流/速率配额:稍后重试可恢复。Google/Vertex 的 RESOURCE_EXHAUSTED(429)归这类
# (google.genai 的 ClientError 只有 .code 没有 .status_code,必须靠 message 兜住)。
_RATELIMIT_MARKERS = (
    "rate limit",
    "rate_limit",
    "too many requests",
    "resource_exhausted",
    "resource has been exhausted",
    "quota exceeded",                # Google "Quota exceeded for quota metric ..."
)


def _http_status(exc: Exception) -> int | None:
    """从 SDK 异常上取 HTTP 状态码。

    openai/anthropic APIStatusError 用 .status_code;google.genai ClientError /
    urllib HTTPError 用 .code。只认 int 且在合法 HTTP 区间,避免误读 sqlstate 等字段。
    """
    for attr in ("status_code", "code"):
        v = getattr(exc, attr, None)
        if isinstance(v, int) and 100 <= v <= 599:
            return v
    return None


def classify_provider_error(exc: Exception) -> tuple[str, str] | None:
    """已知提供商错误 → (category, 客户端安全文案);未知返回 None(调用方走各自兜底)。

    category ∈ {"balance", "auth", "ratelimit"}。文案不含 error_id,调用方自行追加。
    """
    raw_lower = str(exc).strip().lower()
    status = _http_status(exc)
    if status == 402 or any(m in raw_lower for m in _BALANCE_MARKERS):
        return ("balance",
                "当前模型的 API 账户余额不足或配额已用尽，重试无法恢复。"
                "请前往对应 API 提供商充值，或到「设置 → API 设置」切换其他已配置的模型。")
    if status == 401 or any(m in raw_lower for m in _AUTH_MARKERS):
        return ("auth",
                "当前模型的 API Key 无效或已过期。"
                "请到「设置 → API 设置」重新测试凭证，或切换到已配置的模型。")
    if status == 429 or any(m in raw_lower for m in _RATELIMIT_MARKERS):
        return ("ratelimit",
                "当前模型请求过于频繁（提供商限流）。"
                "请稍候片刻再重试，或切换到其他模型。")
    return None
