"""core.vertex_sa — 共享 Vertex Service Account 加载器。

生产鉴权模式下只允许 user BYOK SA。服务器全局 SA 仅保留给本地/匿名开发模式，
避免任何登录用户的模型调用 fallback 到平台凭证。
"""
from __future__ import annotations

import json as _json
import logging
import os
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# rpg/ 根目录（rpg/core/vertex_sa.py → rpg/）
_RPG_BASE = Path(__file__).resolve().parent.parent


def load_sa_credentials(
    user_id: int | None,
    api_id: str = "AgentPlatform",
    allow_platform_fallback: bool = False,
) -> tuple[Any, str | None]:
    """返回 (google.oauth2.service_account.Credentials, project_id) 或 (None, None)。

    生产鉴权模式 (require_auth=True):
      1. user_id 非 None → 从 user_api_credentials 取用户上传的 SA JSON (BYOK)
      2. 无用户 SA:
         - allow_platform_fallback=False (默认,LLM 路径): 返 None,绝不 fallback
         - allow_platform_fallback=True (Embedder 平台兜底): 走全局 SA fallback

    本地/匿名开发模式: 永远允许全局 SA fallback

    Args:
        allow_platform_fallback: Embedder RAG 路径传 True — 测试服平台为用户
            兜底 RAG embedding 成本(text-embedding-004 在 Vertex 有免费配额)。
            LLM 路径保持 False — 严格 BYOK,平台不为用户付 LLM 调用钱。
    """
    from google.oauth2 import service_account

    _SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]

    # 1. 用户级 BYOK
    if user_id:
        try:
            from platform_app.user_credentials import get_credential
            cred = get_credential(int(user_id), api_id)
            if cred and cred.get("key"):
                sa = _json.loads(cred["key"])
                credentials = service_account.Credentials.from_service_account_info(
                    sa, scopes=_SCOPES,
                )
                log.debug("[vertex_sa] user %s: loaded BYOK SA (project=%s)", user_id, sa.get("project_id"))
                return credentials, sa.get("project_id")
        except Exception as exc:
            log.warning("[vertex_sa] user %s BYOK SA load failed: %s", user_id, exc)

    try:
        from core.config import require_auth as _require_auth
        if _require_auth() and not allow_platform_fallback:
            log.debug("[vertex_sa] auth mode: no user BYOK SA; global SA fallback disabled (user_id=%s)", user_id)
            return None, None
    except Exception:
        # 配置读取失败时按更保守的生产策略处理(LLM 路径)。
        if not allow_platform_fallback:
            log.warning("[vertex_sa] require_auth check failed; global SA fallback disabled", exc_info=True)
            return None, None

    # 2. 本地/匿名开发模式可用全局 SA (env 或文件)
    sa_file: Path | None = None
    env_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    if env_path and Path(env_path).exists():
        sa_file = Path(env_path)
    else:
        candidate = _RPG_BASE / "vertex_sa.json"
        if candidate.exists():
            sa_file = candidate

    if sa_file:
        try:
            with open(sa_file) as f:
                sa = _json.load(f)
            credentials = service_account.Credentials.from_service_account_info(
                sa, scopes=_SCOPES,
            )
            log.debug("[vertex_sa] loaded global SA from %s (project=%s)", sa_file, sa.get("project_id"))
            return credentials, sa.get("project_id")
        except Exception as exc:
            log.warning("[vertex_sa] global SA load failed (%s): %s", sa_file, exc)

    log.debug("[vertex_sa] no SA available (user_id=%s)", user_id)
    return None, None


def has_user_sa(user_id: int | None, api_id: str = "AgentPlatform") -> bool:
    """轻量检查用户是否配置了 SA（不构建 Credentials 对象）。"""
    if not user_id:
        return False
    try:
        from platform_app.user_credentials import get_credential
        cred = get_credential(int(user_id), api_id)
        return bool(cred and cred.get("key"))
    except Exception:
        return False
