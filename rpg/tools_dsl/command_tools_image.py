"""command_tools_image.py — Phase 1-C: generate_image 工具 + 确定性门控。

ToolSpec 语义：
  scope   = "save"         — 复用 save 级用户围栏（用户只能对自己存档发起生图）
  origins = llm_chat / autonomous_agent / ui_button / api_direct
            （不含 llm_set / mcp_call / console_assistant）

门控逻辑（确定性，不靠 LLM 自觉）：
  - chat_pipeline.py run_gm_phase 起点初始化 state.data["_turn_images_generated"] = 0
  - executor 读 args["__call_origin__"]（调用方显式注入）：
      * ui_button / api_direct          → 不计数，直接入队
      * llm_chat / autonomous_agent（缺省 / 未注入） → 计数
  - 自主 origin 且 count >= 1 → 入 pending_writes，返回"待确认"
  - 自主 origin 且 count == 0 → count+1，入队，返回 {image_id, status}

强制性：即使 permission_mode=full_access，第 2 张也 pending（executor 主动入队，
  绕过 _write_path_allowed 的自动放行）。

注册：由 register_image_tools() 调用，在 command_tools_register.ensure_registered 末尾追加。
"""
from __future__ import annotations

import logging
import secrets
from typing import Any

log = logging.getLogger(__name__)

# ── 自主 origin 集合（计数 / 门控）────────────────────────────────────────
_AUTONOMOUS_ORIGINS: frozenset[str] = frozenset({"llm_chat", "autonomous_agent"})

# ── 不计数 origin 集合（用户主动触发 = 隐式审批）──────────────────────────
_UNRESTRICTED_ORIGINS: frozenset[str] = frozenset({"ui_button", "api_direct"})


# ── config_card pending_question 写入器 ─────────────────────────────────────
# 前端 ConfirmStrip / 阻塞弹窗据 kind=="config_card" 渲染「模型/Key 配置引导卡」。
# 写入路径与 ask_player_choice 完全一致(state.data["permissions"]["pending_questions"]),
# 故无需任何额外的前端传输改动 —— 同一份 permissions 随回合 done/status state 下发。

def append_config_card(
    state: Any,
    *,
    capability: str,
    mode: str,
    model: str = "",
    api_id: str = "",
    hard: bool = False,
    question: str,
    options: list[str] | None = None,
) -> str:
    """向玩家弹一张「配置引导卡」(config_card pending_question)。

    返回写入的卡 id(cfg_<token>)。调用方据自身语义返回面向用户的文案。

    复用 ask_player_choice 的 id/turn/state 习惯:
      id   = "cfg_" + token_urlsafe(8)
      turn = state.data.get("turn", 0)
      写入 state.data["permissions"]["pending_questions"]。
    """
    permissions: dict[str, Any] = state.data.setdefault("permissions", {})
    pending: list = permissions.setdefault("pending_questions", [])
    # 去重:同 capability 已有未应答的 config_card → 跳过,不堆叠/不重弹。
    for _q in pending:
        if (
            isinstance(_q, dict)
            and _q.get("kind") == "config_card"
            and _q.get("capability") == capability
            and not _q.get("answered")
        ):
            existing_id = str(_q.get("id") or "")
            log.info(
                "[config_card] dedup skip capability=%s mode=%s (existing cid=%s)",
                capability, mode, existing_id,
            )
            return existing_id
    cid = f"cfg_{secrets.token_urlsafe(8)}"
    card: dict[str, Any] = {
        "id": cid,
        "kind": "config_card",
        "capability": capability,
        "mode": mode,
        "model": model or "",
        "api_id": api_id or "",
        "hard": bool(hard),
        "question": question,
        "options": [str(o) for o in (options or [])],
        "source": "agent:config_card",
        "turn": state.data.get("turn", 0),
    }
    pending.append(card)
    permissions["pending_questions"] = pending[-32:]  # 上限防膨胀(与 pending_writes 一致)
    log.info(
        "[config_card] appended cid=%s capability=%s mode=%s hard=%s model=%s api_id=%s",
        cid, capability, mode, hard, model, api_id,
    )
    return cid


# ── executor ──────────────────────────────────────────────────────────────

def _execute_generate_image(state: Any, args: dict[str, Any]) -> str | dict[str, Any]:
    """generate_image save 级 executor。

    origin 解析：
      args["__call_origin__"] 由调用方（API 端点 / ui_button handler）显式注入。
      LLM 生成的 tool_use args 不会包含此字段 → 默认为 "llm_chat"（触发计数门控）。
    """
    from platform_app.image_jobs import enqueue_image_generation

    prompt: str = str(args.get("prompt") or "").strip()
    if not prompt:
        return "失败：prompt 不能为空"

    kind: str = str(args.get("kind") or "chat").strip()
    size: str | None = args.get("size") or None
    api_id: str | None = args.get("api_id") or None
    model: str | None = args.get("model") or None
    origin: str = str(args.get("__call_origin__") or "llm_chat")

    # ── 用户 ID：save 级 executor 签名是 (state, args)，user_id 不直传。
    # dispatcher 已将 env.save_id 无条件注入 args["save_id"]（覆盖 LLM 传值）。
    # 从 game_saves 表用 save_id 反查 user_id — 单次 DB 点查，仅在执行生图时触发。
    user_id: int = 0
    save_id_raw = args.get("save_id")
    if save_id_raw is not None:
        try:
            from platform_app.db import connect, init_db
            init_db()
            with connect() as _db:
                _row = _db.execute(
                    "SELECT user_id FROM game_saves WHERE id = %s",
                    (int(save_id_raw),),
                ).fetchone()
            if _row:
                user_id = int(_row["user_id"])
        except Exception as _uid_exc:
            log.warning("[image_gate] user_id lookup failed save_id=%s: %s", save_id_raw, _uid_exc)
    if not user_id:
        return "失败：无法确定 user_id（save_id=%s），生图中止" % save_id_raw

    extra: dict[str, Any] = {}
    if size:
        extra["size"] = size
    ref: str | None = args.get("ref") or None
    if ref:
        extra["ref"] = ref

    # ── 入队前·生图模型配置门控(确定性,先于一切门控/入队)────────────────────
    # 只对自主 origin(llm_chat / autonomous_agent)做引导:用户主动触发(ui_button /
    # api_direct)视为已知自己在干什么,不弹卡、直接走原逻辑。
    if origin in _AUTONOMOUS_ORIGINS:
        from core.llm_backend import (
            _model_in_catalog,
            first_user_model,
            resolve_preferred_model,
        )
        # (a) LLM 显式指定了模型,但该模型不在用户 catalog → 阻塞式配置卡,不入队。
        if model and not _model_in_catalog(user_id, model):
            append_config_card(
                state,
                capability="image",
                mode="model_not_configured",
                model=model,
                api_id=api_id or "",
                hard=True,
                question=(
                    f"你想用的生图模型「{model}」还没在你的账户配置,"
                    f"选一个已有模型或为它添加 API Key。"
                ),
            )
            return f"【生图已暂停】模型「{model}」未配置,已弹出模型配置。"
        # (b) 未指定模型,且用户从未设默认生图模型 → 询问 / 缺 Key 引导,不入队。
        if not model and resolve_preferred_model(user_id, "image_gen.model_real_name") is None:
            default = first_user_model(user_id)
            if default:
                _api, _model = default
                append_config_card(
                    state,
                    capability="image",
                    mode="ask_default",
                    model=_model,
                    api_id=_api,
                    hard=False,
                    question=f"你还没设默认生图模型,用识别到的「{_model}」生成吗?",
                    options=[f"用 {_model} 生成", "去模型设置"],
                )
                return (
                    f"【生图待确认】尚未设默认生图模型,"
                    f"已询问是否用识别到的「{_model}」。"
                )
            # 完全没有可用凭证 → 缺 Key 引导卡(非阻塞),不入队。
            append_config_card(
                state,
                capability="image",
                mode="missing_key",
                hard=False,
                question="你还没配置生图模型的 API Key,去配置一下就能生图了。",
            )
            return "【生图未配置】你还没配置生图模型的 API Key,已弹出配置引导,配置后即可生图。"

    # ── 确定性门控 ─────────────────────────────────────────────────────────
    if origin in _AUTONOMOUS_ORIGINS:
        count: int = int(state.data.get("_turn_images_generated") or 0)
        if count >= 1:
            # 第 2 张及以上：入 pending_writes，不生图
            pw_id = secrets.token_urlsafe(8)
            permissions: dict[str, Any] = state.data.setdefault("permissions", {})
            pending: list = permissions.setdefault("pending_writes", [])
            pending.append({
                "id": pw_id,
                "path": "generate_image",
                "value": {
                    "prompt": prompt,
                    "kind": kind,
                    "api_id": api_id,
                    "model": model,
                    "extra": extra,
                    "user_id": user_id,
                    # 审批时以 api_direct 执行（视为玩家已手动审批）
                    "__approved_origin__": "api_direct",
                },
                "source": "gm:image",
                "reason": f"本轮第 {count + 1} 张图需玩家确认后生成",
            })
            permissions["pending_writes"] = pending[-32:]  # 上限防膨胀
            log.info(
                "[image_gate] 第 %d 张图 pending user_id=%s pw_id=%s",
                count + 1, user_id, pw_id,
            )
            return (
                f"【生图门控】本轮已生成 {count} 张图；第 {count + 1} 张已加入待审队列"
                f"（id={pw_id}），玩家确认后执行。prompt={prompt!r}"
            )
        # count == 0：自主调用第 1 张，计数后入队
        state.data["_turn_images_generated"] = count + 1

    # ── save_id 透传：dispatcher 已把 env.save_id 注入 args["save_id"]（覆盖 LLM 传值）
    # user_id 查询时已用过 save_id_raw；直接复用，转为 str 传给 enqueue。
    enqueue_save_id: str | None = str(save_id_raw) if save_id_raw is not None else None

    # ── 反馈#74:聊天内生图记录所属 assistant 消息索引,刷新后据此确定性还原(不再靠前端
    # localStorage + 有竞态的 SSE 映射)。本回合 user+assistant 由 record_turn 在回合末才追加,
    # 故此刻 state.history 仅含既往回合;本回合 assistant 的未来索引 = len(history)+1。
    _msg_index: int | None = None
    if kind == "chat":
        try:
            _hist = (getattr(state, "data", {}) or {}).get("history") or []
            _msg_index = len(_hist) + 1
        except Exception:
            _msg_index = None

    # ── 入队 ──────────────────────────────────────────────────────────────
    try:
        result = enqueue_image_generation(
            user_id,
            prompt,
            kind,
            api_id=api_id,
            model=model,
            origin=origin,
            extra=extra if extra else None,
            save_id=enqueue_save_id,
            message_index=_msg_index,
        )
        # 每日配额超限
        if result.get("error") == "quota_exceeded":
            log.warning(
                "[image_gate] quota_exceeded user=%s save_id=%s",
                user_id, enqueue_save_id,
            )
            return "【生图配额】今日生图次数已达上限，请明天再试。"

        image_id = result.get("image_id")
        log.info(
            "[image_jobs] generate_image enqueued image_id=%s user=%s kind=%s origin=%s save_id=%s",
            image_id, user_id, kind, origin, enqueue_save_id,
        )
        # 闭环(用户:生图后 LLM 不知道好没好)——LLM 自主路径上【确定性】等真实结果,把成功/失败
        # 回灌进 agentic 工具循环(不靠模型自己去轮询=不违背 harness 确定性铁律);手动路径
        # (ui_button/api_direct)仍即时返回回执,前端走 SSE 浮窗,不阻塞用户。
        if image_id and origin in _AUTONOMOUS_ORIGINS:
            from platform_app.image_jobs import wait_for_image
            _r = wait_for_image(int(image_id))
            _st = _r.get("status")
            if _st == "done":
                return f"生图成功(image_id={image_id}):图片已插入本轮对话,可据此继续叙述。"
            if _st == "failed":
                return f"生图失败(image_id={image_id}):{_r.get('error') or '未知错误'}。可调整提示词重试,或如实告知用户。"
            if _st == "cancelled":
                return f"生图已被取消(image_id={image_id})。"
            return f"生图仍在后台生成中(image_id={image_id}),稍后会自动出现在对话里;本轮可先继续,无需空等。"
        return f"生图已入队：image_id={image_id}，status=pending。生成完成后通过 SSE 推送 URL。"
    except Exception as exc:
        log.exception("[image_jobs] enqueue_image_generation failed")
        return f"失败：生图入队出错 — {exc}"


# ── ToolSpec 工厂 ─────────────────────────────────────────────────────────

def _make_generate_image_spec():
    """返回 generate_image ToolSpec。延迟导入避免循环。"""
    from tools_dsl.command_dispatcher import ToolSpec

    return ToolSpec(
        name="generate_image",
        description=(
            "异步生成一张图片。提交后立即返回 image_id，图片生成完成后通过 SSE 推送 URL。"
            "\n每回合自主调用限 1 张；第 2 张起需玩家审批后执行。"
            "\nui_button / api_direct 来源不受每回合限制（用户主动触发即视为已审批）。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "生图文本提示词（必填）",
                },
                "kind": {
                    "type": "string",
                    "enum": ["cover", "avatar", "card", "chat", "game", "persona"],
                    "description": (
                        "图片用途：cover=剧本封面, avatar=用户/角色头像, "
                        "card=角色卡立绘, chat=聊天插图, game=游戏场景, persona=人设图"
                    ),
                    "default": "chat",
                },
                "size": {
                    "type": "string",
                    "description": "图片尺寸（provider 相关，如 '1024x1024'）。不填由 provider 决定。",
                },
                "api_id": {
                    "type": "string",
                    "description": "生图 provider（doubao / dashscope / openai / vertex_ai）。不填用用户偏好回退。",
                },
                "model": {
                    "type": "string",
                    "description": "具体模型名（如 'doubao-seedream-4-x'）。不填由 provider 决定。",
                },
                "ref": {
                    "type": "string",
                    "description": "可选关联 ID（如 card_id / save_id），仅用于记录，不影响生图。",
                },
            },
            "required": ["prompt"],
        },
        executor=_execute_generate_image,
        scope="save",
        origins=frozenset({
            "llm_chat",
            "autonomous_agent",
            "ui_button",
            "api_direct",
        }),
        destructive=False,
        intent_keywords=("生图", "画图", "插画", "封面", "头像", "立绘"),
        side_effect_topics=(),  # 生图完成由 worker SSE 推送，不走 tool side_effect
        input_examples=(
            {"prompt": "一位红发魔法师站在古老图书馆", "kind": "chat"},
            {"prompt": "夕阳下的废弃城堡，史诗奇幻风格", "kind": "cover"},
        ),
    )


# ── 注册入口 ──────────────────────────────────────────────────────────────

def register_image_tools() -> None:
    """注册 generate_image 工具到全局 registry。幂等（二次注册静默跳过）。"""
    from tools_dsl.command_dispatcher import get_registry
    registry = get_registry()
    spec = _make_generate_image_spec()
    if not registry.has(spec.name):
        registry.register(spec)
        log.info("[command_tools_image] registered tool: %s", spec.name)
