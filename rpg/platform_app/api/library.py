"""platform_app.api.library — /api/library/* 路由。

task 141: 测试期禁用 — 资产库无 mime 白名单可绕过任意文件上传,等接入
文件类型白名单 + 病毒扫描后再开放。所有 endpoint 短路 403。
"""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from .. import library as _library
from ._deps import json_response, require_user

router = APIRouter()

# 环境变量开关:RPG_LIBRARY_ENABLED=1 才放行,默认禁用
_LIBRARY_ENABLED = os.environ.get("RPG_LIBRARY_ENABLED", "").strip() in {"1", "true", "yes"}


def _disabled():
    return json_response(
        {"ok": False, "error": "文件库测试期暂停 — 只允许通过「导入剧本」上传 .txt/.md", "code": "library_disabled"},
        status_code=403,
    )


def _disabled_list():
    # 仅 GET 列目录用:禁用期返回空 200(只读、无 mime 绕过风险),避免前端每次加载急切调用
    # 产生 403 控制台红字。写端点(upload/mkdir/delete/download)仍走 _disabled() 403 ——
    # 那才是"无白名单可绕过任意文件上传"的安全边界。
    return json_response({
        "ok": True, "entries": [], "items": [], "disabled": True,
        "note": "文件库测试期暂停 — 只允许通过「导入剧本」上传 .txt/.md", "code": "library_disabled",
    })


@router.get("/api/library")
async def api_library(path: str = "", limit: int | None = None, cursor: str | None = None, user=Depends(require_user)):
    if not _LIBRARY_ENABLED:
        return _disabled_list()
    try:
        return json_response(_library.list_dir(user["id"], path, limit, cursor))
    except ValueError as exc:
        return json_response({"ok": False, "error": str(exc)}, status_code=400)


@router.post("/api/library/upload")
async def api_library_upload(request: Request, user=Depends(require_user)):
    if not _LIBRARY_ENABLED:
        return _disabled()
    body = await request.json()
    try:
        return json_response(_library.upload(user["id"], body.get("path", ""), body.get("files") or []))
    except ValueError as exc:
        return json_response({"ok": False, "error": str(exc)}, status_code=400)


@router.post("/api/library/mkdir")
async def api_library_mkdir(request: Request, user=Depends(require_user)):
    if not _LIBRARY_ENABLED:
        return _disabled()
    body = await request.json()
    try:
        return json_response(_library.mkdir(user["id"], body.get("path", "")))
    except ValueError as exc:
        return json_response({"ok": False, "error": str(exc)}, status_code=400)


@router.post("/api/library/delete")
async def api_library_delete(request: Request, user=Depends(require_user)):
    if not _LIBRARY_ENABLED:
        return _disabled()
    body = await request.json()
    try:
        return json_response(_library.delete(user["id"], body.get("path", "")))
    except ValueError as exc:
        return json_response({"ok": False, "error": str(exc)}, status_code=400)


@router.get("/api/library/download")
async def api_library_download(path: str, user=Depends(require_user)) -> FileResponse:
    if not _LIBRARY_ENABLED:
        raise HTTPException(status_code=403, detail="文件库测试期暂停")
    try:
        target = _library.download_path(user["id"], path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not target.exists():
        raise HTTPException(status_code=404, detail="file not found")
    # 安全：所有用户上传文件强制下载，不允许浏览器把它当 html/svg/js 解析执行
    # 这避免了上传 .html → 同源 XSS、上传 .svg → 内嵌 JS 等场景
    download_name = target.name
    return FileResponse(
        target,
        media_type="application/octet-stream",
        filename=download_name,
        headers={
            "Content-Disposition": f'attachment; filename="{download_name}"',
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
        },
    )
