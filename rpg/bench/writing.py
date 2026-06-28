"""写小说 harness 基准 — 续写任务。

数据自带 ground truth:给真实章节的前半,让候选 harness 续写,跟【真实后半】对比。
指标(确定性代理,无人工标注):
  - style_overlap:续写与真实后文的 4-gram Jaccard(词汇/文风/人名接近度,越高越贴)
  - canon_drift:续写里出现、但前文与剧本 canon 都没有的人名数(越低越接地)
  - prefix_copy:续写与"前文"的 8-gram 重叠(越高=越在抄已有内容,坏)
  - gen_repeat:续写自身复读率(degeneration,越低越好)
  - length_ratio:续写长度 / 真实后文长度(节奏)

诚实:style_overlap 是代理(创作允许发散),衡量"在分布内/词汇一致",非"文笔好坏";
后者需模型裁判 rubric(可后接,放可选 LLM 层)。
"""
from __future__ import annotations

import re
import statistics
from typing import Any

from bench.metrics import m_degeneration

_SENT_END = "。！？”」』\n"


def _cut_at_sentence(text: str, approx: int) -> int:
    for j in range(approx, min(len(text), approx + 200)):
        if text[j] in _SENT_END:
            return j + 1
    return approx


def make_continuation_cases(chapters: list[dict], prefix_frac: float = 0.6,
                            min_len: int = 1500) -> list[dict]:
    cases = []
    for ch in chapters:
        c = ch.get("content") or ""
        if len(c) < min_len:
            continue
        cut = _cut_at_sentence(c, int(len(c) * prefix_frac))
        cases.append({
            "script_id": ch.get("script_id"), "chapter": ch.get("chapter"),
            "prefix": c[:cut], "target": c[cut:], "canon_aliases": ch.get("canon") or {},
        })
    return cases


WRITING_SYSTEM = (
    "你是这部长篇小说的续写助手。严格延续给定正文的文风、人称、语气、节奏与世界设定,"
    "自然地往下写。只输出续写正文;不要复述已给内容,不要任何解释、标题或元说明。"
)


def writing_messages(case: dict) -> list[dict]:
    pre = case["prefix"]
    return [{"role": "system", "content": WRITING_SYSTEM},
            {"role": "user", "content": "延续下面这段小说,往后写约 500 字:\n\n" + pre[-2400:]}]


def _ngrams(s: str, n: int) -> set:
    return {s[i:i + n] for i in range(max(0, len(s) - n))}


def _jaccard(a: str, b: str, n: int) -> float:
    A, B = _ngrams(a, n), _ngrams(b, n)
    if not A or not B:
        return 0.0
    return round(len(A & B) / len(A | B), 4)


_NAME_RE = re.compile(r"([一-鿿]{2,4})(?:说道|说|道|问|答|喊|叫|低声|沉声|笑道|喝道)")
_PRON = {"你", "我", "他", "她", "它", "我们", "你们", "他们", "她们", "对方", "众人", "有人"}


def score_writing(gen: str, case: dict) -> dict:
    target, prefix = case["target"], case["prefix"]
    aliases = case.get("canon_aliases") or {}
    canon = {nm for names in aliases.values() for nm in names if nm}
    speakers = {m.group(1) for m in _NAME_RE.finditer(gen)}
    drift = {s for s in speakers if s not in _PRON
             and s not in prefix and not any(s in c or c in s for c in canon)}
    return {
        "style_overlap": _jaccard(gen, target, 4),
        "prefix_copy": _jaccard(gen, prefix[-len(gen) - 1:] if gen else prefix, 8),
        "canon_drift": len(drift),
        "gen_repeat": m_degeneration(gen, {}).get("repeat_ratio", 0.0),
        "length_ratio": round(len(gen) / max(1, len(target)), 3),
        "gen_chars": len(gen),
    }


def run_writing(cases: list[dict], harness, on_progress=None) -> dict[str, Any]:
    rows = []
    errors = 0
    for i, case in enumerate(cases):
        gen = harness.chat(writing_messages(case), max_tokens=800) if hasattr(harness, "chat") else harness.generate(case)
        if isinstance(gen, str) and gen.startswith("__GEN_ERROR__"):
            errors += 1
            continue
        rows.append(score_writing(gen, case))
        if on_progress:
            on_progress(i + 1, len(cases))

    def agg(field):
        vals = [r[field] for r in rows if isinstance(r.get(field), (int, float))]
        return round(statistics.fmean(vals), 4) if vals else None

    fields = ["style_overlap", "prefix_copy", "canon_drift", "gen_repeat", "length_ratio", "gen_chars"]
    return {"n_cases": len(cases), "scored": len(rows), "gen_errors": errors,
            "means": {f: agg(f) for f in fields}, "rows": rows}


def render_writing(res: dict, harness_name: str = "candidate") -> str:
    m = res["means"]
    L = [f"== 写小说续写基准 · {res['scored']}/{res['n_cases']} 章 · harness={harness_name} =="]
    if res["gen_errors"]:
        L.append(f"生成失败: {res['gen_errors']}")
    L.append(f"  style_overlap(↑越贴真实后文)  {m['style_overlap']}")
    L.append(f"  canon_drift  (↓越接地,凭空人名) {m['canon_drift']}")
    L.append(f"  prefix_copy  (↓越好,抄前文)     {m['prefix_copy']}")
    L.append(f"  gen_repeat   (↓越好,自身复读)   {m['gen_repeat']}")
    L.append(f"  length_ratio (≈1 节奏匹配)       {m['length_ratio']}")
    return "\n".join(L)
