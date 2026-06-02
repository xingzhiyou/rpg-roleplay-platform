"""agents.gm.backends._effort — 思考深度 (effort) 跨 backend 抽象。

task 141:
- 用户在 ModelPopover UI 选 Off / Low / Medium / High / Extra / Max
- 偏好写 user_preferences.preferences.model_effort["{api_id}:{model_id}"] = effort
- 各 backend (Vertex / Anthropic / OpenAI compat) 调本模块拿 (effort, budget_tokens),
  再用各自 SDK 字段格式发请求

设计原则:
- 单一 effort 枚举,backend 自己负责 SDK 字段适配
- 不在 effort 抽象里 hardcode 哪个模型不支持 thinking — 让 backend 自己
  (e.g. Anthropic claude-3.5-sonnet 不支持 thinking,backend 自己 swallow
  budget 当 effort=off)
- 没配偏好 → 默认 "high"
- "high" 是 sweet spot: 大部分 thinking 模型 8k budget 足够,边际成本不高
"""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)


# effort 枚举 → 预算 token 数 (各 backend 共用映射, SDK 实际字段名各异)
EFFORT_TO_BUDGET_TOKENS = {
    "off":    0,
    "low":    1024,
    "medium": 4096,
    "high":   8192,
    "extra":  16384,
    "max":    24576,
}

# OpenAI / GPT-5 系列 reasoning.effort 是 string,不是 token 数,单独映射
EFFORT_TO_OPENAI_REASONING = {
    "off":    None,       # 不传 reasoning 字段 = 禁用
    "low":    "minimal",  # 部分模型只认 "minimal"/"low"
    "medium": "medium",
    "high":   "high",
    "extra":  "high",     # OpenAI 暂无 "extra" 档,映射到 high
    "max":    "high",
}

DEFAULT_EFFORT = "high"
VALID_EFFORTS = set(EFFORT_TO_BUDGET_TOKENS.keys())


def resolve_effort(user_id: int | None, api_id: str, model_id: str) -> str:
    """读 user_preferences,返回 effort 枚举 ("off"/"low"/.../"max")。
    没配或异常 → DEFAULT_EFFORT ("high")。
    """
    if not user_id or not api_id or not model_id:
        return DEFAULT_EFFORT
    try:
        from platform_app.db import connect as _conn
        with _conn() as db:
            r = db.execute(
                "select preferences from user_preferences where user_id = %s",
                (int(user_id),),
            ).fetchone()
        if not r:
            return DEFAULT_EFFORT
        prefs = dict(r["preferences"] or {})
        model_effort = prefs.get("model_effort") or {}
        key = f"{api_id}:{model_id}"
        effort = str(model_effort.get(key) or "").lower()
        return effort if effort in VALID_EFFORTS else DEFAULT_EFFORT
    except Exception as exc:
        log.warning("[effort] resolve failed user_id=%s key=%s:%s: %s",
                    user_id, api_id, model_id, exc)
        return DEFAULT_EFFORT


def resolve_budget_tokens(user_id: int | None, api_id: str, model_id: str) -> int:
    """读 effort → token budget (Vertex / Anthropic 用)。"""
    return EFFORT_TO_BUDGET_TOKENS[resolve_effort(user_id, api_id, model_id)]


def resolve_openai_reasoning(user_id: int | None, api_id: str, model_id: str) -> str | None:
    """读 effort → OpenAI reasoning.effort 字符串 ("minimal"/"medium"/"high"/None)。
    None 表示不传 reasoning 字段。"""
    return EFFORT_TO_OPENAI_REASONING[resolve_effort(user_id, api_id, model_id)]
