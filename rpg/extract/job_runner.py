"""extract/job_runner.py — 把 llm-extract 接进 import_jobs job 体系。

设计:与 import_pipeline.schedule_full_import 同款,**复用同一张 import_jobs 表 +
同一套 SSE 流端点**(GET /api/scripts/import-jobs/{job_id}/stream)。前端无需新建组件。

差异:
- kind='llm_extract'(import_pipeline 是 'full_pipeline')
- 阶段:seed / arc_extract / resolve / embed(stages JSONB)
- options 传给 run_llm_extraction:algorithm/model/api_id/target_arcs/concurrency/...
"""
from __future__ import annotations

import secrets
import threading
from typing import Any

from psycopg.types.json import Jsonb

from platform_app.db import connect, init_db
from platform_app.import_pipeline import JobController

# 阶段定义(stages JSONB 初始化用)。前端按 id 显示 label
_STAGES = [
    {"id": "seed", "label": "种子词表 (Pass 0)", "status": "pending"},
    {"id": "arc_extract", "label": "弧段提取 (Pass 1)", "status": "pending"},
    {"id": "resolve", "label": "实体消歧聚合 (Pass 2)", "status": "pending"},
    {"id": "embed", "label": "嵌入入库 (Pass 3)", "status": "pending"},
]


def schedule_llm_extraction(user_id: int, script_id: int,
                            options: dict[str, Any] | None = None) -> dict[str, Any]:
    """异步调度 LLM 提取。立即返回 {ok, job_id};真活在后台线程跑,进度落 import_jobs 表。

    options(全可选):
      algorithm: 'arc'(默认) | 'per_chapter'
      model / api_id / target_arcs / concurrency / author_era / sample_chapters
      confirmed / max_book_usd / chapter_min / chapter_max
    """
    init_db()
    options = dict(options or {})

    with connect() as db:
        # 校验 owner(防止越权调度别人剧本)
        owned = db.execute("select 1 from scripts where id=%s and owner_id=%s",
                           (script_id, user_id)).fetchone()
        if not owned:
            raise ValueError("无权访问该剧本")

        # 去重 + per-user 并发上限:先查活跃任务
        existing = db.execute(
            "select job_id from import_jobs "
            "where user_id=%s and script_id=%s and kind='llm_extract' "
            "and status in ('pending','running') order by id desc limit 1",
            (user_id, script_id),
        ).fetchone()
        if existing:
            return {"ok": True, "job_id": existing["job_id"], "reused": True}

        active = db.execute(
            "select count(*) as n from import_jobs where user_id=%s "
            "and kind='llm_extract' and status in ('pending','running')",
            (user_id,),
        ).fetchone()
        if int(active["n"] if active else 0) >= 1:
            raise ValueError("您已有 1 个 LLM 提取任务在跑,请等其完成或取消")

        # 原子写入:利用 v13 unique partial index (user_id, script_id, kind)
        # where status in ('pending','running') 防止 TOCTOU 竞态。
        # 若并发两个请求同时通过上面的 SELECT 检查,只有一个 INSERT 会成功,
        # 另一个命中 ON CONFLICT DO NOTHING,RETURNING 为空,调用方再查一遍复用。
        job_id = f"llm_{script_id}_{secrets.token_hex(6)}"
        row = db.execute(
            """
            insert into import_jobs(job_id, user_id, script_id, kind, status, stage,
              overall_total, stages, budget_estimate)
            values (%s, %s, %s, 'llm_extract', 'pending', 'pending', %s, %s, %s)
            on conflict (user_id, script_id, kind)
              where status in ('pending','running')
            do nothing
            returning job_id
            """,
            (job_id, user_id, script_id, len(_STAGES), Jsonb(_STAGES),
             Jsonb({"options": options})),
        ).fetchone()
        if row is None:
            # 并发写入竞争失败:复用已存在的任务
            dup = db.execute(
                "select job_id from import_jobs "
                "where user_id=%s and script_id=%s and kind='llm_extract' "
                "and status in ('pending','running') order by id desc limit 1",
                (user_id, script_id),
            ).fetchone()
            if dup:
                return {"ok": True, "job_id": dup["job_id"], "reused": True}
            raise RuntimeError("无法创建也无法找到活跃的 llm_extract 任务")

    th = threading.Thread(
        target=_run, args=(job_id, user_id, script_id, options), daemon=True,
    )
    th.start()
    return {"ok": True, "job_id": job_id, "reused": False}


def _run(job_id: str, user_id: int, script_id: int, options: dict[str, Any]) -> None:
    """后台 worker。把 run_llm_extraction 的 progress_cb 映射到 JobController.update。"""
    # 多 worker 部署 advisory lock
    try:
        from platform_app.cluster import release_job_lock, try_acquire_job_lock
        if not try_acquire_job_lock(f"llm_extract_job:{job_id}"):
            return  # 已被别的 worker 占
    except Exception:
        try_acquire_job_lock = release_job_lock = None  # type: ignore[assignment]

    ctl = JobController(job_id)
    ctl.update(status="running", stage="seed", overall_progress=0)
    init_db()
    with connect() as db:
        db.execute("update import_jobs set started_at=now() where job_id=%s", (job_id,))

    # progress_cb 映射 stage 名 → import_jobs 字段。run_llm_extraction 当前发的 stage:
    #   'arc_split' / 'seed' / 'arc_extract' / 'resolve' / 'embed' / 'done' / 'era_fallback'
    #   (per_chapter 模式发: 'seed' / 'per_chapter' / 'resolve' / 'embed' / 'done')
    _stage_index = {"seed": 0, "arc_extract": 1, "per_chapter": 1, "resolve": 2, "embed": 3}
    # 注意 list(_STAGES) 是浅拷贝,会污染模块级 _STAGES;deep-copy 每个 dict
    _stages_state = [dict(s) for s in _STAGES]

    def _set_stage_status(stage_id: str, status: str) -> None:
        for s in _stages_state:
            if s["id"] == stage_id:
                s["status"] = status

    def _advance_to(stage_id: str) -> None:
        """把 < stage_id 的所有阶段标 done,>= stage_id 保留当前。

        防御性:如果某阶段(seed/...)结束时漏发 done 事件,后续阶段一进
        就把它扫成 done,前端 stage 灯就不会卡在前一段 running。
        """
        cur = _stage_index.get(stage_id, 0)
        for s in _stages_state:
            idx = _stage_index.get(s["id"], 999)
            if idx < cur and s["status"] != "done":
                s["status"] = "done"

    def cb(stage: str, info: dict) -> None:
        if ctl.is_cancelled():
            raise InterruptedError("cancelled")
        try:
            if stage == "arc_split":
                # 弧段切完,记入元数据(JobController.update 内部已 Jsonb 包装)
                ctl.update(
                    budget_estimate={"options": options,
                                     "arcs": info.get("arcs"),
                                     "chapters": info.get("chapters")},
                )
            elif stage in ("seed", "arc_extract", "per_chapter", "resolve", "embed"):
                idx = _stage_index.get(stage, 0)
                done = int(info.get("done", 0))
                total = int(info.get("total") or info.get("sample") or info.get("chapters") or 1)
                # 进入这阶段意味着前序阶段都跑完了 — 防御性扫一遍
                _advance_to(stage)
                _set_stage_status(stage, "running")
                # 标完成
                if "succeeded" in info or done >= total:
                    _set_stage_status(stage, "done")
                ctl.update(
                    stage=stage,
                    stage_progress=done,
                    stage_total=total,
                    overall_progress=idx,
                    stages=_stages_state,
                )
            elif stage == "era_fallback":
                # 不阻塞,只更 meta
                pass
            elif stage == "done":
                _set_stage_status("embed", "done")
                ctl.update(stage="done", overall_progress=len(_STAGES), stages=_stages_state)
        except InterruptedError:
            raise
        except Exception as _exc:
            # phase_backend: 不静默 pass — 写 warning,不阻塞主流程但留 trace
            import logging as _logging
            _logging.getLogger(__name__).warning(
                "[job_runner.cb] progress report failed for stage=%s: %s",
                stage, _exc, exc_info=True,
            )

    scope = str(options.get("scope") or "full")
    try:
        # 零 LLM 重建分支 — 跳过整条 LLM 流水线,直接调 extract/rebuild.py 函数。
        # 三个 scope 走同一套早退逻辑,只是调用的目标函数不同:
        #   embed_only      → embed_canon_entities(向量重生成)
        #   worldbook_only  → rebuild_worldbook_from_db(canon → worldbook 重算)
        #   anchors_only    → rebuild_timeline_from_db(chapter_facts → anchors 重算)
        # 前端面板逻辑:把 seed/arc_extract/resolve 标 done(用户看着像跳过),只点亮 resolve/embed
        REBUILD_SCOPES = {
            "embed_only":     ("embed",   "向量重新嵌入"),
            "worldbook_only": ("resolve", "世界书重建"),
            "anchors_only":   ("resolve", "时间线重建"),
        }
        if scope in REBUILD_SCOPES:
            target_stage, action_label = REBUILD_SCOPES[scope]
            # phase_backend: zero-LLM 分支只标 active module 状态,不撒谎 4/4。
            # 之前所有 stage 标 done 让用户以为整套 seed/arc_extract/resolve 都跑了 LLM。
            # 现在只把当前 module 的 stage 标 running → done/error,其他保持 pending(跳过)。
            for s in _stages_state:
                if s["id"] == target_stage:
                    s["status"] = "running"
                else:
                    s["status"] = "skipped"
            ctl.update(
                stage=target_stage,
                overall_progress=_stage_index.get(target_stage, 3),
                stage_progress=0, stage_total=1, stages=_stages_state,
                module=scope.replace("_only", ""),
                source="canon" if scope in ("worldbook_only", "embed_only") else "chapter_facts",
            )
            before_count = 0
            after_count = 0
            with connect() as db:
                if scope == "embed_only":
                    before_row = db.execute(
                        "select count(*) as c from kb_canon_entities "
                        "where script_id=%s and embedding_vec is not null",
                        (script_id,),
                    ).fetchone()
                    before_count = int(before_row["c"]) if before_row else 0
                    from extract.embed import embed_canon_entities
                    res = embed_canon_entities(db, script_id, user_id=user_id, only_missing=False)
                    after_row = db.execute(
                        "select count(*) as c from kb_canon_entities "
                        "where script_id=%s and embedding_vec is not null",
                        (script_id,),
                    ).fetchone()
                    after_count = int(after_row["c"]) if after_row else 0
                elif scope == "worldbook_only":
                    from extract.rebuild import rebuild_worldbook_from_db
                    res = rebuild_worldbook_from_db(db, script_id)
                    before_count = int(res.get("before_count") or 0)
                    after_count = int(res.get("after_count") or 0)
                elif scope == "anchors_only":
                    from extract.rebuild import rebuild_timeline_from_db
                    res = rebuild_timeline_from_db(db, script_id)
                    before_count = int(res.get("before_count") or 0)
                    after_count = int(res.get("after_count") or 0)
                else:
                    res = {"ok": False, "error": f"unknown scope {scope}"}
            # rebuild 函数返 {ok:False} 当数据缺失 → 标 failed 让用户看到原因
            if not res.get("ok"):
                _set_stage_status(target_stage, "error")
                ctl.update(status="failed",
                           error=f"{action_label}失败: {res.get('error', '未知错误')}",
                           stages=_stages_state,
                           before_count=before_count,
                           after_count=after_count,
                           warnings=list(res.get("partial_failures") or []))
                with connect() as db:
                    db.execute("update import_jobs set finished_at=now() where job_id=%s", (job_id,))
            else:
                _set_stage_status(target_stage, "done")
                # phase_backend: 不再把其他 stage 一锅标 done — 已 skipped 保持 skipped。
                # 这样前端看到的就是"我只跑了 worldbook 这一段",不是"全套都跑了"。
                final_status = "done"
                if res.get("partial_failures"):
                    final_status = "done_with_errors"
                ctl.update(status=final_status, stage=target_stage,
                           overall_progress=_stage_index.get(target_stage, 3) + 1,
                           stage_progress=1, stage_total=1, stages=_stages_state,
                           before_count=before_count,
                           after_count=after_count,
                           warnings=list(res.get("partial_failures") or []))
                with connect() as db:
                    db.execute("update import_jobs set finished_at=now() where job_id=%s", (job_id,))
            try:
                from platform_app.cluster import release_job_lock as _rel
                _rel(f"llm_extract_job:{job_id}")
            except Exception as _exc:
                import logging as _logging
                _logging.getLogger(__name__).warning(
                    "release_job_lock failed for %s: %s", job_id, _exc,
                )
            return  # 早退 — 不进 run_llm_extraction

        from platform_app.knowledge.llm_extract import run_llm_extraction
        result = run_llm_extraction(
            user_id, script_id,
            algorithm=str(options.get("algorithm") or "arc"),
            author_era=str(options.get("author_era") or ""),
            author_power_system=options.get("author_power_system") or None,
            model=str(options.get("model") or "deepseek-v4-flash"),
            api_id=str(options.get("api_id") or "deepseek"),
            target_arcs=int(options.get("target_arcs") or 100),
            concurrency=int(options.get("concurrency") or 15),
            sample_chapters=options.get("sample_chapters"),
            chapter_min=options.get("chapter_min"),
            chapter_max=options.get("chapter_max"),
            confirmed=bool(options.get("confirmed", True)),  # 调度路径默认确认(否则一直卡在 needs_confirm)
            max_book_usd=float(options.get("max_book_usd") or 10.0),
            progress_cb=cb,
        )

        if result.get("ok"):
            # 累计 actual usage(import_jobs.usage_actual)+ KB 刚改回 unreviewed + 标终态
            act = result.get("actual_usage") or {}
            for s in _stages_state:
                if s["status"] != "done":
                    s["status"] = "done"
            with connect() as db:
                if act:
                    db.execute(
                        "update import_jobs set usage_actual=%s where job_id=%s",
                        (Jsonb(act), job_id),
                    )
                db.execute(
                    "update scripts set review_status='unreviewed', reviewed_at=null, "
                    "updated_at=now() where id=%s and owner_id=%s",
                    (script_id, user_id),
                )
            ctl.update(status="done", stage="done", overall_progress=len(_STAGES),
                       stages=_stages_state)
            with connect() as db:
                db.execute("update import_jobs set finished_at=now() where job_id=%s", (job_id,))
        else:
            # needs_confirm / quota_exceeded / error
            err_msg = str(result.get("message") or result.get("error") or "未知错误")
            ctl.update(status="failed", error=err_msg)
            with connect() as db:
                db.execute("update import_jobs set finished_at=now() where job_id=%s", (job_id,))
    except InterruptedError:
        ctl.update(status="cancelled")
        with connect() as db:
            db.execute("update import_jobs set finished_at=now() where job_id=%s", (job_id,))
    except Exception as exc:
        ctl.update(status="failed", error=f"{type(exc).__name__}: {str(exc)[:500]}")
        with connect() as db:
            db.execute("update import_jobs set finished_at=now() where job_id=%s", (job_id,))
    finally:
        # 兜底:无论上面走哪条路径(正常 / rebuild 早退 / except / 被吞的取消信号),
        # 都确保不留 status='running' 的僵尸行。已收尾的行 finalize 是 no-op(幂等)。
        try:
            from platform_app.import_pipeline import finalize_job_if_unterminated
            finalize_job_if_unterminated(job_id)
        except Exception as _exc:
            import logging as _logging
            _logging.getLogger(__name__).warning(
                "finalize_job_if_unterminated failed for %s: %s", job_id, _exc, exc_info=True,
            )
        try:
            if release_job_lock is not None:
                release_job_lock(f"llm_extract_job:{job_id}")
        except Exception as _exc:
            # phase_backend: lock release 失败 log.warning,不再 silent
            import logging as _logging
            _logging.getLogger(__name__).warning(
                "release_job_lock final failed for %s: %s",
                job_id, _exc, exc_info=True,
            )
