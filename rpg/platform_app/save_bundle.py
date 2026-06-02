"""platform_app.save_bundle — 自包含存档导出/导入(开源自托管可脱离原服务器)。

设计见 docs/design/oss_self_contained_export.md。核心 = **组合两块现成能力**,不重造:
  - knowledge.script_pack.export_script_pack / import_script_pack
      剧本本体 + 章节 + 知识库(canon/worldbook/timeline/worldlines) + 可选 chunks(含向量)。
      **owner_id 强制门控**(只导自有剧本,订阅的版权剧本 PermissionError) +
      import 端已硬化(zip 大小 / zip-slip / 解压炸弹预检 / owner 强制覆写)。
  - save_io.export_save / import_save
      per-save 状态(game_saves / branch_commits+快照 / refs / messages / memories / 9 张状态表)。

导出 = 把 save_io 的 per-save payload 作为 `save.json` 塞进 script_pack 的 zip,合成一个自包含 zip。
导入 = import_script_pack 重建剧本拿到 new_script_id → 把 save payload 的 script_id 全部重映射 →
       import_save 落 per-save。import_script_pack 读具名条目、忽略额外的 save.json,故同一个 zip 复用。

档位(tier) —— full / no_vectors 都含知识库,只切 chunks:
  full        章节 + 知识库 + chunks(含向量)  → 导入即用,RAG 立即可检索;包最大。
  no_vectors  章节 + 知识库,无 chunks/向量    → 导入端「嵌入」重建向量(默认推荐)。
  (lite       仅章节、无知识库 —— 需扩展 export_script_pack 的 include_knowledge,本期暂缓。)
"""
from __future__ import annotations

import io
import json
import zipfile
from typing import Any

from . import save_io
from .db import connect
from .knowledge import script_pack

BUNDLE_VERSION = 1
DEFAULT_TIER = "no_vectors"

# tier → include_chunks(是否把 document_chunks + 向量打进包)。full/no_vectors 都含知识库。
_TIER_INCLUDE_CHUNKS: dict[str, bool] = {
    "full": True,
    "no_vectors": False,
}


def _save_script_id(user_id: int, save_id: int) -> int:
    with connect() as db:
        row = db.execute(
            "select script_id from game_saves where id = %s and user_id = %s",
            (save_id, user_id),
        ).fetchone()
    if not row:
        raise ValueError("无权访问该存档")
    return int(row["script_id"])


def export_save_bundle(user_id: int, save_id: int, tier: str = DEFAULT_TIER) -> tuple[bytes, str]:
    """打包自包含存档 zip = 剧本 pack(script_pack) + save.json(per-save)。返回 (zip_bytes, filename)。

    门控:export_script_pack 内部强制 owner_id == user_id —— 订阅的公开剧本会抛 PermissionError,
    正好满足"只能完整导出自己拥有的剧本"(版权)。
    """
    tier = tier if tier in _TIER_INCLUDE_CHUNKS else DEFAULT_TIER
    include_chunks = _TIER_INCLUDE_CHUNKS[tier]

    script_id = _save_script_id(user_id, save_id)
    # 1. 剧本 pack(owner 门控 + chunks 按档)
    pack_bytes, _ = script_pack.export_script_pack(script_id, user_id, include_chunks=include_chunks)
    # 2. per-save payload
    save_payload = save_io.export_save(user_id, save_id)
    save_title = (save_payload.get("save") or {}).get("title") or f"save-{save_id}"

    # 3. 合成:重打一个 zip,把 script_pack 全部条目 + save.json + save_bundle.json 写进去
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(pack_bytes), "r") as src, \
            zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for name in src.namelist():
            dst.writestr(name, src.read(name))
        dst.writestr("save.json", json.dumps(save_payload, ensure_ascii=False, default=str))
        dst.writestr("save_bundle.json", json.dumps({
            "bundle_version": BUNDLE_VERSION,
            "tier": tier,
            "save_title": save_title,
            "origin_save_id": save_id,
        }, ensure_ascii=False))

    slug = str(save_title).replace("/", "-").replace("\\", "-")[:40]
    return out.getvalue(), f"save-bundle-{save_id}-{slug}.zip"


def is_save_bundle(zip_bytes: bytes) -> bool:
    """zip 里有 save.json = 自包含存档包(区别于纯剧本 pack)。"""
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
            return "save.json" in set(zf.namelist())
    except zipfile.BadZipFile:
        return False


def _remap_script_id(payload: dict[str, Any], old_sid: int | None, new_sid: int) -> None:
    """把 per-save payload 里引用的 old script_id 全换成 new(剧本已在导入端重建为 new_sid)。
    覆盖 save.script_id + 9 张 per-save 状态表里带 script_id 的行(如 save_anchor_states)。"""
    if old_sid is None:
        return
    save = payload.get("save")
    if isinstance(save, dict) and save.get("script_id") == old_sid:
        save["script_id"] = new_sid
    for _table, rows in (payload.get("state_tables") or {}).items():
        for r in (rows or []):
            if isinstance(r, dict) and r.get("script_id") == old_sid:
                r["script_id"] = new_sid


def import_save_bundle(user_id: int, zip_bytes: bytes) -> dict[str, Any]:
    """导入自包含存档:import_script_pack 重建剧本(new_script_id)→ remap → import_save。

    安全完全沿用 import_script_pack 的硬化(zip 大小 / zip-slip / 解压炸弹 / owner 强制覆写)。
    """
    # 取 save.json(import_script_pack 只读具名条目、忽略它)
    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
        if "save.json" not in set(zf.namelist()):
            raise ValueError("不是自包含存档包(缺 save.json)")
        raw = zf.read("save.json")
    try:
        save_payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"save.json 解析失败: {exc}") from exc
    if not isinstance(save_payload, dict):
        raise ValueError("save.json 不是对象")

    # 1. 重建剧本(自带硬化 + owner 强制覆写为导入者)
    pack_res = script_pack.import_script_pack(zip_bytes, user_id)
    new_script_id = int(pack_res["script_id"])

    # 2. per-save payload 的 script_id 重映射到新剧本
    old_raw = (save_payload.get("save") or {}).get("script_id")
    _remap_script_id(save_payload, int(old_raw) if old_raw is not None else None, new_script_id)

    # 3. 导入 per-save(import_save 校验 script_id 归属 → 现在是导入者自己的新剧本)
    save_res = save_io.import_save(user_id, save_payload)

    warnings = list(pack_res.get("warnings", [])) + list(save_res.get("warnings", []))
    return {
        "ok": True,
        "save_id": save_res.get("save_id"),
        "script_id": new_script_id,
        "warnings": warnings,
    }


# ── 即时算各档包大小(给前端导出弹窗) ──────────────────────────────────────────
# pg_column_size = 行的存储字节(未压缩);zip 后实际更小,这里给的是上界估计,用于"哪档更大"的判断。

def _sum_bytes(db, sql: str, args: tuple) -> int:
    try:
        r = db.execute(sql, args).fetchone()
        return int((r["b"] if r else 0) or 0)
    except Exception:
        return 0


def estimate_bundle_sizes(user_id: int, save_id: int) -> dict[str, Any]:
    """按所选存档实时聚合各档预估大小。前端切档即显，无需静态预估。"""
    script_id = _save_script_id(user_id, save_id)
    with connect() as db:
        chapters = _sum_bytes(db, "select coalesce(sum(pg_column_size(t.*)),0) b from script_chapters t where script_id=%s", (script_id,))
        knowledge = 0
        for tbl in ("kb_canon_entities", "worldbook_entries", "script_timeline_anchors",
                    "script_worldlines", "script_worldline_nodes", "chapter_facts", "documents", "character_cards"):
            knowledge += _sum_bytes(db, f"select coalesce(sum(pg_column_size(t.*)),0) b from {tbl} t where script_id=%s", (script_id,))
        chunks_text = _sum_bytes(db, "select coalesce(sum(pg_column_size(content)+pg_column_size(coalesce(metadata,'{}'::jsonb))),0) b from document_chunks where script_id=%s", (script_id,))
        embeddings = _sum_bytes(db, "select coalesce(sum(pg_column_size(embedding)),0) b from document_chunks where script_id=%s", (script_id,))
        per_save = _sum_bytes(db, "select coalesce(sum(pg_column_size(t.*)),0) b from branch_commits t where save_id=%s", (save_id,))
        per_save += _sum_bytes(db, "select coalesce(sum(pg_column_size(t.*)),0) b from messages t where session_id in (select id from game_sessions where save_id=%s)", (save_id,))

    base = chapters + knowledge + per_save  # no_vectors 档
    full = base + chunks_text + embeddings
    return {
        "ok": True,
        "tiers": {"full": full, "no_vectors": base},
        "default_tier": DEFAULT_TIER,
        "breakdown": {
            "chapters": chapters, "knowledge": knowledge,
            "chunks_text": chunks_text, "embeddings": embeddings, "per_save": per_save,
        },
        "note": "未压缩数据上界;实际 zip 包更小(文本压缩比高,向量压缩比低)",
    }
