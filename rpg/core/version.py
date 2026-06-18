"""core.version — 运行时应用版本号(单一真源 = 仓库根 VERSION 文件)。

版本规则:SemVer `MAJOR.MINOR.PATCH[-channel.N][+build]`,自 v0.5.0 起(详见 CHANGELOG / docs)。
解析优先级:env RPG_APP_VERSION(CI/桌面壳注入)> 仓库根 VERSION 文件 > "0.0.0-dev"。
桌面壳与更新检查、/api/health、反馈上报(app_version)均读这里,保证全栈同一版本号。
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def app_version() -> str:
    env = (os.environ.get("RPG_APP_VERSION") or "").strip()
    if env:
        return env
    # rpg/core/version.py → 仓库根在上两级(rpg/.. = repo root)
    for cand in (Path(__file__).resolve().parents[2] / "VERSION",
                 Path(__file__).resolve().parents[1] / "VERSION"):
        try:
            v = cand.read_text(encoding="utf-8").strip()
            if v:
                return v
        except Exception:
            continue
    return "0.0.0-dev"


APP_VERSION = app_version()
