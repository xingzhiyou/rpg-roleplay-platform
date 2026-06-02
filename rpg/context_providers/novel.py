"""
Novel providers — 只在 manifest.kind == 'novel_adaptation' 时启用。

把原来 context_agent.py / context_engine.py 里硬编码的小说专用逻辑
（timeline_filter_for_label / retrieve_context / character_cards / worldbook）
下沉到 4 个独立 provider：

- NovelTimelineProvider     — 原著章节锚点
- NovelRetrievalProvider    — script-scoped 检索 / ChapterFact / source snippets
- NovelCharactersProvider   — 激活角色卡
- NovelWorldbookProvider    — 激活世界书条目

模组（module_adventure）不启用这些，所以 Ash Mine 不会再混入小说残渣。
"""
from __future__ import annotations

from .base import ContextContribution, ContextProvider
from .registry import register_provider


def _is_novel_manifest(manifest) -> bool:
    return manifest.get("kind") == "novel_adaptation"


def _allow_retrieval(manifest) -> bool:
    pol = manifest.get("retrieval_policy") or {}
    return bool(pol.get("allow_script_retrieval", True))


def _allow_chapter_facts(manifest) -> bool:
    pol = manifest.get("retrieval_policy") or {}
    return bool(pol.get("allow_chapter_facts", True))


class NovelTimelineProvider(ContextProvider):
    """注入小说时间线锚点。仅 novel_adaptation 启用。"""
    id = "novel_timeline"

    def applies(self, state, manifest, demand) -> bool:
        if not super().applies(state, manifest, demand):
            return False
        return _is_novel_manifest(manifest)

    def collect(self, state, manifest, demand, services) -> ContextContribution:
        data = getattr(state, "data", state) or {}
        world = data.get("world") or {}
        timeline = world.get("timeline") or {}
        pending = timeline.get("pending_jump") or {}
        label = pending.get("to") or world.get("time", "")

        anchor: dict = {}
        if services.timeline_filter_fn and label:
            try:
                anchor = services.timeline_filter_fn(label) or {}
            except Exception as exc:
                anchor = {"error": str(exc)}

        lines: list[str] = []
        lines.append(f"【时间线】当前 label：{label or '（无）'}")
        if pending:
            lines.append(f"【待确认跳跃】{pending.get('from', '')} → {pending.get('to', '')}")
        if anchor.get("anchor_chapter"):
            lines.append(
                f"【原著锚点】第 {anchor.get('anchor_chapter')} 章，"
                f"窗口 {anchor.get('chapter_min')}-{anchor.get('chapter_max')}"
            )
        elif label:
            lines.append("【原著锚点】未精确命中")
        text = "\n".join(lines)
        layer = self.make_layer(
            "novel_timeline", "时间线事务", text,
            sticky=True, priority=70,
        )
        return ContextContribution(
            provider_id=self.id,
            kind="novel_timeline",
            priority=70,
            layers=[layer],
            tokens_estimate=len(text) // 2,
            debug={"label": label, "anchor": anchor, "pending_jump": pending},
        )


class NovelRetrievalProvider(ContextProvider):
    """script-scoped 章节 / 摘要 / source snippet 检索。仅 novel_adaptation 启用。"""
    id = "novel_retrieval"

    def applies(self, state, manifest, demand) -> bool:
        if not super().applies(state, manifest, demand):
            return False
        return _is_novel_manifest(manifest) and _allow_retrieval(manifest)

    def collect(self, state, manifest, demand, services) -> ContextContribution:
        if not services.retrieve_fn:
            return ContextContribution.skipped(self.id, "no retrieve_fn injected")

        query = (demand.retrieval_query if demand else "") or ""
        try:
            text = services.retrieve_fn(
                query,
                state=state,
                user_id=services.user_id,
                script_id=services.script_id,
            )
        except Exception as exc:
            return ContextContribution(
                provider_id=self.id, applied=False,
                warnings=[f"retrieve_fn 异常：{exc}"],
                debug={"error": str(exc)},
            )
        if not text:
            return ContextContribution.skipped(self.id, "no retrieval content")
        try:
            state.set_last_retrieval(text)
        except Exception:
            pass

        # 把 "世界线收束·接下来的锚点" 段拆出来独立成 high-priority layer。
        # 整段 retrieved text 通常 6-7K,做单一 layer 进 context_engine 会被
        # MAX_LAYER_CHARS["novel_retrieval"] (默认 1800) 截掉,世界线收束段在 pos 3000+
        # 必然丢 → GM 永远收不到 pending anchors,玩家进 ch1 GM 不知道该让 [卡切尔] 登场。
        # 拆开后 anchor_pending 独立 trim 上限 3000,RAG body 保留原 1800 上限,各取所需。
        anchor_section, rag_body = _split_anchor_pending(text)

        layers = []
        if anchor_section:
            layers.append(self.make_layer(
                "anchor_pending", "世界线收束·接下来的锚点",
                anchor_section,
                sticky=False, priority=72,  # 高于 worldbook(70),低于玩家 directive(95)
            ))
        if rag_body:
            layers.append(self.make_layer(
                "novel_retrieval", "检索参考（原著 / ChapterFact）", rag_body,
                sticky=False, priority=40,
            ))
        if not layers:
            return ContextContribution.skipped(self.id, "no usable retrieval content after split")
        return ContextContribution(
            provider_id=self.id,
            kind="novel_retrieval",
            priority=72 if anchor_section else 40,
            layers=layers,
            retrieval_items=[{"text": text}],
            tokens_estimate=len(text) // 2,
            debug={"query": query, "chars": len(text), "has_anchor_pending": bool(anchor_section)},
        )


def _split_anchor_pending(text: str) -> tuple[str, str]:
    """从 retrieve_context 拼出来的整段文本里,拆出 "=== 世界线收束·接下来的锚点 ===" 段。

    返回 (anchor_section, rag_body)。没匹配时返回 ("", text)。
    """
    if not text:
        return "", text or ""
    marker = "=== 世界线收束·接下来的锚点 ==="
    start = text.find(marker)
    if start < 0:
        return "", text
    next_section = text.find("\n=== ", start + len(marker))
    if next_section < 0:
        return text[start:].strip(), text[:start].strip()
    return (
        text[start:next_section].strip(),
        (text[:start] + text[next_section + 1:]).strip(),
    )


def _extract_anchor_npc_names(state, save_id: int | None) -> list[str]:
    """从 save_anchor_states 的 pending 锚点里提取 NPC 名字 (character 类型实体登场)。

    返回去重 list,按 importance desc 排。让 NovelCharactersProvider 强制把
    这些 NPC 的 character_card 注入到 GM context,绕过 grep-by-scan-text 限制。
    """
    if not save_id:
        return []
    try:
        from agents.anchor_seed_agent import (
            get_progress_window,
            list_pending_for_phase,
        )
        data = getattr(state, "data", state) or {}
        world = data.get("world", {}) or {}
        _wt = (world.get("time") or "").strip()
        prog = get_progress_window(int(save_id), world_time_label=_wt, window_size=50)
        anchors = list_pending_for_phase(
            int(save_id), None, limit=20,
            chapter_min=prog["chapter_min"], chapter_max=prog["chapter_max"],
            order_by_chapter=True,
        ) or []
        out: list[str] = []
        seen: set[str] = set()
        for a in anchors:
            summary = a.get("summary", "") or ""
            # 匹配"X(character)首次登场" 模式
            import re as _re
            m = _re.match(r"^([^(（]+)[（(]character[)）]首次登场", summary)
            if m:
                nm = m.group(1).strip()
                if nm and nm not in seen:
                    seen.add(nm)
                    out.append(nm)
                continue
            # 备用:must_preserve 里有 "X 参与" 也算 (location/concept anchor 的 participant 字段)
            mp = a.get("must_preserve") or []
            for s in (mp if isinstance(mp, list) else []):
                m2 = _re.match(r"^([^\s]+)\s+参与", str(s))
                if m2:
                    nm = m2.group(1).strip()
                    if nm and nm not in seen:
                        seen.add(nm)
                        out.append(nm)
        return out
    except Exception:
        return []


def _format_card_local(name: str, card: dict) -> str:
    """轻量包装 — 走 context_engine 的 _format_card,这里只是给本模块统一名字防 import cycle。"""
    try:
        from context_engine import _format_card
        return _format_card(name, card)
    except Exception:
        return f"【{name}】\n身份：{card.get('identity', '')}\n性格：{card.get('personality', '')}\n说话风格：{card.get('speech_style', '')}"


class NovelCharactersProvider(ContextProvider):
    """激活角色卡。仅 novel_adaptation 启用。委托给 context_engine 的现有 helper。"""
    id = "novel_characters"

    def applies(self, state, manifest, demand) -> bool:
        if not super().applies(state, manifest, demand):
            return False
        return _is_novel_manifest(manifest)

    def collect(self, state, manifest, demand, services) -> ContextContribution:
        # 委托给 context_engine 现有的 character cards 逻辑（避免重新实现 NPC 卡选）。
        try:
            from context_engine import (
                _active_character_cards,
                _load_characters,
                _player_card,
                _recent_text,
                _strip_card_text,
            )
        except Exception as exc:
            return ContextContribution(
                provider_id=self.id, applied=False,
                warnings=[f"import context_engine failed: {exc}"],
            )
        data = getattr(state, "data", state) or {}
        try:
            chars = _load_characters(script_id=services.script_id, book_id=services.book_id)
            history = state.history_messages()
            scan_text = "\n".join([
                (demand.player_intent if demand else "") or "",
                _recent_text(history),
                data.get("player", {}).get("current_location", ""),
                data.get("world", {}).get("time", ""),
                "\n".join(data.get("world", {}).get("known_events") or []),
                data.get("memory", {}).get("current_objective", ""),
            ])
            player_card = _player_card(state, chars)
            # #6 代入去重: 传入 player.aliases,让玩家代入的原作角色(及其别名)对应的
            # NPC 卡不再被当独立角色注入。
            npc_cards = _active_character_cards(scan_text, chars, player_card.get("name", ""),
                                                data.get("player", {}).get("aliases") or [])
            # harness 闭环: pending anchor 里点名要登场的 NPC 应该被强制注入卡,
            # 即使他们的名字不在 scan_text 里。否则:
            #   anchor 说"卡切尔首次登场" → 但卡切尔没在玩家输入/history 里 →
            #   _active_character_cards (grep 模式) 漏掉 → GM 没卡数据 →
            #   不知道演谁 → 永远不让 NPC 出场 = 死循环。
            anchor_npc_names = _extract_anchor_npc_names(state, services.save_id)
            existing_npc_names = {c["name"] for c in npc_cards}
            for npc_name in anchor_npc_names:
                if npc_name == player_card.get("name", "") or npc_name in existing_npc_names:
                    continue
                card = chars.get(npc_name)
                if not card:
                    continue
                npc_cards.append({
                    "name": npc_name,
                    "matched": ["(anchor 强制注入)"],
                    "priority": 95,  # 高于 grep 命中的(典型 100-130),让 anchor NPC 排前
                    "text": _format_card_local(npc_name, card),
                    "_source": "anchor_pending",
                })
                existing_npc_names.add(npc_name)
        except Exception as exc:
            return ContextContribution(
                provider_id=self.id, applied=False,
                warnings=[f"load characters failed: {exc}"],
            )
        layers = []
        if player_card.get("text"):
            layers.append(self.make_layer(
                "player_card", "玩家角色卡", player_card["text"],
                sticky=True, priority=88,
                source=player_card.get("name", ""),
            ))
        if npc_cards:
            layers.append(self.make_layer(
                "npc_cards", "当前角色卡（NPC）",
                "\n\n".join(c["text"] for c in npc_cards),
                sticky=False, priority=78,
                items=[_strip_card_text(c) for c in npc_cards],
            ))
        if not layers:
            return ContextContribution.skipped(self.id, "no cards loaded")
        return ContextContribution(
            provider_id=self.id,
            kind="novel_characters",
            priority=80,
            layers=layers,
            tokens_estimate=sum(len(lyr["content"]) for lyr in layers) // 2,
            debug={"cards_count": len(npc_cards)},
        )


class NovelWorldbookProvider(ContextProvider):
    """激活世界书条目。仅 novel_adaptation 启用。"""
    id = "novel_worldbook"

    def applies(self, state, manifest, demand) -> bool:
        if not super().applies(state, manifest, demand):
            return False
        return _is_novel_manifest(manifest)

    def collect(self, state, manifest, demand, services) -> ContextContribution:
        try:
            from context_engine import (
                _active_worldbook,
                _load_world,
                _recent_text,
                _strip_worldbook_text,
            )
        except Exception as exc:
            return ContextContribution(
                provider_id=self.id, applied=False,
                warnings=[f"import context_engine failed: {exc}"],
            )
        data = getattr(state, "data", state) or {}
        try:
            world = _load_world()
            history = state.history_messages()
            scan_text = "\n".join([
                (demand.player_intent if demand else "") or "",
                _recent_text(history),
                data.get("player", {}).get("current_location", ""),
                data.get("world", {}).get("time", ""),
            ])
            entries = _active_worldbook(scan_text, world, state,
                                        script_id=services.script_id,
                                        book_id=services.book_id)
        except Exception as exc:
            return ContextContribution(
                provider_id=self.id, applied=False,
                warnings=[f"load worldbook failed: {exc}"],
            )
        if not entries:
            return ContextContribution.skipped(self.id, "no worldbook entries")
        content = "\n\n".join(e.get("text", "") for e in entries)
        layer = self.make_layer(
            "novel_worldbook", "激活世界书", content,
            sticky=False, priority=72,
            items=[_strip_worldbook_text(e) for e in entries],
        )
        return ContextContribution(
            provider_id=self.id,
            kind="novel_worldbook",
            priority=72,
            layers=[layer],
            tokens_estimate=len(content) // 2,
            debug={"entries_count": len(entries)},
        )


register_provider(NovelTimelineProvider())
register_provider(NovelRetrievalProvider())
register_provider(NovelCharactersProvider())
register_provider(NovelWorldbookProvider())
