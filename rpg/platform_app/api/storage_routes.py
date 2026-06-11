"""platform_app/api/storage_routes.py — 统一文件服务路由（S1）。

GET /api/storage/{kind}/{filename}
  · kind 白名单：ai_images / avatars / scripts / library
  · 扩展名白名单：png / jpg / jpeg / webp（scripts 额外允许 txt / md）
  · 穿越防护：经 storage.resolve_path 校验
  · 返回 FileResponse

旧路由 /api/images/file/* 由 api/images.py 保留（W1-B 改）。
旧路由 /api/profile/avatar/file/* 由 frontend_routes.py 保留（老 URL 不破）。
"""
from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..storage import resolve_path

router = APIRouter()

# ---------------------------------------------------------------------------
# 白名单配置
# ---------------------------------------------------------------------------

_KIND_ALLOWLIST = frozenset({"ai_images", "avatars", "scripts", "library"})

_EXT_ALLOWLIST = frozenset({".png", ".jpg", ".jpeg", ".webp"})
_EXT_ALLOWLIST_SCRIPTS = frozenset({".png", ".jpg", ".jpeg", ".webp", ".txt", ".md"})


# ---------------------------------------------------------------------------
# 服务端点
# ---------------------------------------------------------------------------

@router.get("/api/storage/{kind}/{filename}")
async def serve_storage_file(kind: str, filename: str) -> FileResponse:
    """统一文件服务：白名单 kind + 扩展名 + 穿越防护 → FileResponse。"""
    # kind 白名单
    if kind not in _KIND_ALLOWLIST:
        raise HTTPException(status_code=404, detail="未知 kind")

    # 扩展名白名单（按 kind 选取）
    ext = os.path.splitext(filename)[-1].lower()
    allowed_exts = _EXT_ALLOWLIST_SCRIPTS if kind == "scripts" else _EXT_ALLOWLIST
    if ext not in allowed_exts:
        raise HTTPException(status_code=404, detail="不支持的文件类型")

    # 穿越防护（resolve_path 内部校验）
    storage_key = f"{kind}/{filename}"
    try:
        path = resolve_path(storage_key)
    except ValueError:
        raise HTTPException(status_code=404, detail="路径非法")

    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404)

    return FileResponse(str(path))
