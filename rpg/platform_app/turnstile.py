"""platform_app.turnstile — Cloudflare Turnstile 人机验证（注册防机器人）。

配置门控（**fail-safe**：未配置 secret 即整体关闭，不改变现有行为）:
  RPG_TURNSTILE_SECRET   — 后端 secret key。设置后注册接口强制校验 token。
  RPG_TURNSTILE_SITEKEY  — 前端 site key。经 /api/auth/schema 透出，前端据此渲染挂件。

契约（两个 env 应**同时**设置，由同一次部署动作提供）:
  - secret 未设      → enabled()=False  → 后端跳过（=当前行为，零改动）。
  - sitekey 未设     → schema 不透出   → 前端不渲染挂件。
  - 两者都设         → 前端渲染挂件并随注册请求带上 token；后端强制校验。
  - secret 设了但请求缺 token / 校验失败 → 运行时拒绝（fail-closed）。

校验目标是固定可信端点 challenges.cloudflare.com，无 SSRF 面，直连即可。
"""
from __future__ import annotations

import json
import logging
import os
import time
import urllib.parse
import urllib.request

_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
_log = logging.getLogger(__name__)


def secret() -> str:
    return (os.environ.get("RPG_TURNSTILE_SECRET") or "").strip()


def sitekey() -> str:
    return (os.environ.get("RPG_TURNSTILE_SITEKEY") or "").strip()


def misconfigured() -> bool:
    """仅配了 secret 或仅配了 sitekey（XOR）—— 应同时配置或同时留空。"""
    return bool(secret()) != bool(sitekey())


def enabled() -> bool:
    """后端是否强制校验。

    **必须 secret 与 sitekey 同时配置** —— 否则若只配 secret:前端拿不到 sitekey
    →不渲染挂件→提交不带 token→后端 fail-closed→所有真实用户被锁死注册。
    要求两者齐备时,「只配 secret」回退为关闭态(=不强制,与 fail-safe 取向一致),
    再由 misconfigured() + 调用方日志提醒运维「配了一半=没生效」。
    """
    return bool(secret()) and bool(sitekey())


def verify(token: str, *, ip: str | None = None, timeout: float = 8.0) -> bool:
    """向 Cloudflare 校验 Turnstile token。

    secret 未配置 → 直接放行（关闭态）。已配置时:
      - token 为空        → False
      - 网络/解析异常     → False（fail-closed：宁可拒绝也不放过机器人；有界重试 + 告警）
      - Cloudflare 返回 success=true → True
    """
    s = secret()
    if not s:
        return True
    token = (token or "").strip()
    if not token:
        return False
    data = {"secret": s, "response": token}
    if ip:
        data["remoteip"] = ip
    body = urllib.parse.urlencode(data).encode("utf-8")
    # 网络异常有界重试(2 次, 0.5s backoff);CF 明确 success=false 不重试。坚持 fail-closed。
    last_exc: Exception | None = None
    for attempt in range(2):
        req = urllib.request.Request(_VERIFY_URL, data=body, method="POST")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (固定可信端点)
                payload = json.loads(resp.read().decode("utf-8") or "{}")
            return bool(payload.get("success"))
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt == 0:
                time.sleep(0.5)
    _log.warning("[turnstile] siteverify network/parse error (fail-closed): %s", last_exc)
    return False
