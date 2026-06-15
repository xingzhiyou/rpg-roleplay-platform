"""gm_serving/steering.py — Phase D 规范世界线引导(D §5)。

每轮:定位玩家最近在哪条线/下一节点 → 引导(锚点软目标)→ 放权(怎么达成交玩家)→
重锚(偏到另一条规范枝叉切锚点)。粗弧层(script_worldline_nodes)坐在细 save_anchor_states 之上。
"""
from __future__ import annotations

from kb import canon_repo


def resolve_steering_target(db, *, save_id: int, script_id: int,
                            progress_chapter: int | None = None,
                            steering_strength: str = "guided") -> dict:
    """产出 ① 层软目标。

    返回 {worldline, passed_nodes, next_node, soft_goal, pending_anchors}。
    定位:看已 occurred 的 save_anchor_states 簇匹配到哪个 worldline 节点;取序号下一个节点。

    steering_strength:
      rail    — 强化注入,明确要求贴合节点描述(用词更强硬)
      guided  — 现状默认,软目标引导但不强制(保守措辞)
      free    — 不注入软目标,完全自由发挥
    """
    worldlines = canon_repo.read_worldlines(db, script_id)
    if not worldlines:
        return _fallback_soft_goal(save_id, wl_key=None, steering_strength=steering_strength)
    # 默认主线(is_primary),否则第一条
    wl = next((w for w in worldlines if w.get("is_primary")), worldlines[0])
    nodes = canon_repo.read_worldline_nodes(db, script_id, wl["wl_key"], progress_chapter=progress_chapter)
    if not nodes:
        # 粗弧层 script_worldline_nodes 没建(很多剧本只 seed 了细 save_anchor_states,
        # 没跑世界树脊柱)→ 旧代码静默返回空 soft_goal,GM 完全无引导、玩家「锚点推不动」。
        # 降级:用细锚点层的 top-1 pending 合成温和 soft_goal,受 steering_strength 控制。
        return _fallback_soft_goal(save_id, wl_key=wl["wl_key"], steering_strength=steering_strength)

    # 已 occurred 的锚点 keys
    occurred = {
        r["anchor_key"]
        for r in db.execute(
            "select anchor_key from save_anchor_states where save_id=%s and status in ('occurred','variant')",
            (save_id,),
        ).fetchall()
    }
    # 找最后一个"其 anchor_keys 已大部分 occurred"的节点 → 下一个就是目标
    passed_idx = -1
    for i, node in enumerate(nodes):
        aks = node.get("anchor_keys") or []
        if aks and sum(1 for a in aks if a in occurred) >= max(1, len(aks) // 2):
            passed_idx = i
    next_node = nodes[passed_idx + 1] if passed_idx + 1 < len(nodes) else None

    pending = []
    if next_node:
        must = next_node.get("must_preserve") or []
        must_str = f" 须保留:{'、'.join(must)}。" if must else ""
        if steering_strength == "free":
            # 自由模式:不注入软目标,让 GM 自由发挥
            soft = ""
        elif steering_strength == "rail":
            # 强贴模式:明确要求紧贴节点走向
            soft = (
                f"【强制引导】当前必须推进到节点「{next_node['label']}」:{next_node.get('summary', '')}"
                + must_str
                + " ——请严格按照该节点方向推进剧情,不可大幅偏离原著走向。"
            )
        else:
            # guided(默认):软目标,温和引导
            soft = (
                f"下一关键节点「{next_node['label']}」:{next_node.get('summary', '')}"
                + must_str
                + " ——朝这个方向自然推进即可,具体怎么发生交给玩家选择;不要生硬照搬原著。"
            )
        pending = next_node.get("anchor_keys") or []
    else:
        soft = "已抵达/超出当前规范世界线末节点,自由发挥并尽量保持世界自洽。"

    return {
        "worldline": wl["wl_key"],
        "passed_nodes": passed_idx + 1,
        "next_node": next_node["node_key"] if next_node else None,
        "soft_goal": soft,
        "pending_anchors": pending,
    }


def _fallback_soft_goal(save_id: int, *, wl_key: str | None,
                        steering_strength: str = "guided") -> dict:
    """粗弧层(script_worldline_nodes)缺失时的确定性降级:用细锚点层的 top-1 pending
    锚点合成一个温和 soft_goal,别让 GM 完全失去引导(用户「锚点推不动」根因之一)。

    free 模式仍不注入(尊重玩家选择)。其余强度都给最高 importance 的待发生锚点当软目标。
    """
    base = {"worldline": wl_key, "passed_nodes": 0, "next_node": None,
            "soft_goal": "", "pending_anchors": []}
    if steering_strength == "free":
        return base
    try:
        from agents.anchor_seed_agent import list_pending_for_phase
        # 限当前进度窗口内,按 importance desc 取首个(防剧透 + 取最该推进的)。
        from agents.anchor_seed_agent import get_progress_window
        win = get_progress_window(int(save_id))
        pend = list_pending_for_phase(
            int(save_id), None, limit=1,
            chapter_min=win.get("chapter_min"), chapter_max=win.get("chapter_max"),
        )
        if not pend:
            # 窗口内没有 → 放宽到全档 top-1 pending(仍只读不写)。
            pend = list_pending_for_phase(int(save_id), None, limit=1)
    except Exception:
        pend = []
    if not pend:
        return base
    a = pend[0]
    summary = (a.get("summary") or "").strip()
    must = a.get("must_preserve") or []
    must_str = f" 须保留:{'、'.join(must)}。" if must else ""
    if steering_strength == "rail":
        soft = (
            f"【强制引导】当前应朝原著关键事件推进:{summary}"
            + must_str
            + " ——请把剧情自然引向这个事件,不可大幅偏离原著走向。"
        )
    else:  # guided(默认)
        soft = (
            f"下一关键原著事件:{summary}"
            + must_str
            + " ——朝这个方向自然推进即可,具体怎么发生交给玩家选择;不要生硬照搬原著。"
        )
    base["soft_goal"] = soft
    base["pending_anchors"] = [a.get("anchor_key")] if a.get("anchor_key") else []
    return base
