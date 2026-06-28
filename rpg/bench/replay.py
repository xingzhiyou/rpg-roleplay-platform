"""RP harness 基准 — replay 对比。

run_replay(cases, harnesses): 每个 case 用每个 harness 生成回复 → 同一 metrics 打分 →
逐 harness 出 scorecard,并排对比。这是"换模型/提示词跑同一批真实上下文,看谁更好"的引擎。

  from bench.harness import RecordedHarness, OpenAICompatHarness
  res = run_replay(cases, [RecordedHarness(), OpenAICompatHarness("ds-v4-flash", model, base, key)])
"""
from __future__ import annotations

from typing import Any

from bench.runner import run_scorecard


def run_replay(cases: list[dict], harnesses: list, on_progress=None) -> dict[str, Any]:
    per_harness_cases: dict[str, list[dict]] = {h.name: [] for h in harnesses}
    gen_errors: dict[str, int] = {h.name: 0 for h in harnesses}

    for i, case in enumerate(cases):
        for h in harnesses:
            resp = h.generate(case)
            if isinstance(resp, str) and resp.startswith("__GEN_ERROR__"):
                gen_errors[h.name] += 1
                continue
            # 复用 case 上下文(canon/prior)给指标,只换被打分的 response
            scored = dict(case)
            scored["gm_response"] = resp
            per_harness_cases[h.name].append(scored)
        if on_progress:
            on_progress(i + 1, len(cases))

    scorecards = {name: run_scorecard(cs, label=name) for name, cs in per_harness_cases.items()}
    return {"n_cases": len(cases), "gen_errors": gen_errors, "scorecards": scorecards}


def render_compare(replay: dict) -> str:
    scs = replay["scorecards"]
    names = list(scs.keys())
    L = [f"== replay A/B · {replay['n_cases']} cases · harness: {', '.join(names)} =="]
    if any(replay["gen_errors"].values()):
        L.append(f"生成失败: {replay['gen_errors']}")
    # 收集所有 bad_rate / 连续字段
    all_fields: dict[str, str] = {}
    for sc in scs.values():
        for f, a in sc["fields"].items():
            all_fields[f] = a.get("kind", "info")
    L.append("\n坏指标命中率(越低越好):")
    for f, kind in all_fields.items():
        if kind == "bad_rate":
            row = "  " + f"{f:<16}"
            for name in names:
                a = scs[name]["fields"].get(f, {})
                row += f"{name[:14]}={a.get('rate', 0) * 100:5.1f}%  "
            L.append(row)
    L.append("\n连续/观测(mean):")
    for f, kind in all_fields.items():
        if kind != "bad_rate":
            row = "  " + f"{f:<16}"
            for name in names:
                a = scs[name]["fields"].get(f, {})
                v = a.get("mean", a.get("rate"))
                row += f"{name[:14]}={v if v is not None else '-':>8}  "
            L.append(row)
    return "\n".join(L)
