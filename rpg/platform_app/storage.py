"""platform_app/storage.py — 统一存储抽象（S1 基座）。

单一真相源：所有用户文件路径均从此模块的常量派生，消除各处 parents[N] 硬编码。

OSS 替换点：store_bytes() 函数体 —— 目前写本地磁盘；换 OSS 时只改这一函数即可，
public_url() 也需同步返回 CDN URL。
"""
from __future__ import annotations

import os
from pathlib import Path

# ---------------------------------------------------------------------------
# 根目录 & 子目录常量
# ---------------------------------------------------------------------------

PLATFORM_DATA_ROOT = Path(
    os.environ.get(
        "RPG_DATA_ROOT",
        str(Path(__file__).resolve().parents[1] / "platform_data"),
    )
)

AI_IMAGES_DIR     = PLATFORM_DATA_ROOT / "ai_images"
AVATARS_DIR       = PLATFORM_DATA_ROOT / "avatars"
SCRIPTS_DIR       = PLATFORM_DATA_ROOT / "scripts"
LIBRARY_DIR       = PLATFORM_DATA_ROOT / "library"
UPLOAD_CHUNKS_DIR = PLATFORM_DATA_ROOT / "upload_chunks"


# ---------------------------------------------------------------------------
# 公共 URL 构造
# ---------------------------------------------------------------------------

def public_url(storage_key: str) -> str:
    """把 storage_key（形如 'kind/filename'）转成对外 HTTP URL。

    OSS 替换点：换 CDN 时此处返回 CDN 绝对 URL。
    """
    return f"/api/storage/{storage_key}"


# ---------------------------------------------------------------------------
# 路径解析（含穿越防护）
# ---------------------------------------------------------------------------

def resolve_path(storage_key: str) -> Path:
    """把 storage_key 解析为绝对 Path，并校验不逃出 PLATFORM_DATA_ROOT。

    Raises ValueError if the resolved path escapes the root (path traversal
    防护）。
    """
    candidate = (PLATFORM_DATA_ROOT / storage_key).resolve()
    root_resolved = PLATFORM_DATA_ROOT.resolve()
    # 必须是 root 的严格子路径（不允许恰好等于 root）
    if root_resolved not in candidate.parents:
        raise ValueError(
            f"storage_key 路径越界（穿越防护）：{storage_key!r}"
        )
    return candidate


# ---------------------------------------------------------------------------
# 落盘
# ---------------------------------------------------------------------------

def store_bytes(data: bytes, *, kind: str, filename: str) -> tuple[str, str]:
    """把 data 落盘到 PLATFORM_DATA_ROOT/{kind}/{filename}（mkdir -p）。

    返回 (storage_key, url)。

    OSS 替换点：换 OSS 时把此函数体替换为上传到对象存储桶的逻辑，
    storage_key 保持不变（仍为 f"{kind}/{filename}"），url 改为 CDN URL。
    """
    dest_dir = PLATFORM_DATA_ROOT / kind
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / filename
    dest.write_bytes(data)
    storage_key = f"{kind}/{filename}"
    url = public_url(storage_key)
    return storage_key, url


# ---------------------------------------------------------------------------
# 删除
# ---------------------------------------------------------------------------

def delete_file(storage_key: str) -> None:
    """删除物理文件（missing_ok：不存在则静默）。"""
    try:
        path = resolve_path(storage_key)
    except ValueError:
        return
    path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# 关联反查（供删除前检查引用）
# ---------------------------------------------------------------------------

def find_references(url: str) -> list[dict]:
    """查询哪些业务记录引用了该 URL/路径。

    扫描列：
      users.avatar_url
      scripts.cover_image_url
      character_cards.avatar_path
      card_persona_images.image_url

    返回 list[{kind, table, id, title/name}]，供前端删除确认弹窗展示。
    用户量有限，全扫可接受；迁移到 user_assets 后可改用 ref_kind/ref_id 结构化反查。
    """
    from .db import connect, init_db

    init_db()
    results: list[dict] = []

    with connect() as db:
        # users.avatar_url
        rows = db.execute(
            "select id, username from users where avatar_url = %s",
            (url,),
        ).fetchall()
        for r in rows:
            results.append({
                "kind": "avatar",
                "table": "users",
                "id": r["id"],
                "name": r["username"],
            })

        # scripts.cover_image_url
        try:
            rows = db.execute(
                "select id, title from scripts where cover_image_url = %s",
                (url,),
            ).fetchall()
            for r in rows:
                results.append({
                    "kind": "cover",
                    "table": "scripts",
                    "id": r["id"],
                    "title": r["title"],
                })
        except Exception:
            pass

        # character_cards.avatar_path
        try:
            rows = db.execute(
                "select id, name from character_cards where avatar_path = %s",
                (url,),
            ).fetchall()
            for r in rows:
                results.append({
                    "kind": "card_avatar",
                    "table": "character_cards",
                    "id": r["id"],
                    "name": r["name"],
                })
        except Exception:
            pass

        # card_persona_images.image_url
        try:
            rows = db.execute(
                "select id from card_persona_images where image_url = %s",
                (url,),
            ).fetchall()
            for r in rows:
                results.append({
                    "kind": "persona_image",
                    "table": "card_persona_images",
                    "id": r["id"],
                })
        except Exception:
            pass

    return results
