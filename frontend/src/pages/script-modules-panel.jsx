/* script-modules-panel.jsx — Rebuild Panel 编排层 (phase_rebuild_panel).
   职责:把 ModuleStatusCard / ModuleMatrixOverview / RebuildJobBanner / RebuildEstimateModal 串成一个
   可在 ScriptDetailPanel 内消费的 React hook + view 组件.

   核心 useScriptRebuild(scriptId) 返回:
     - statusPayload     当前 /modules-status 快照
     - statusLoading     是否在 reload 状态
     - activeJob         { job_id, kind, module, before_count, after_count, overall_progress, ... }
     - openEstimate({ module, options? })  打开 estimate modal
     - bannerProps       传给 <RebuildJobBanner>
     - matrixProps       传给 <ModuleMatrixOverview>
     - modalProps        传给 <RebuildEstimateModal>
     - cardProps(module) 传给单卡 <ModuleStatusCard module={...} {...cardProps('canon')} />

   后端契约假设(任务说明里硬约束 3):
     GET    /api/scripts/{sid}/modules-status                   → { ok, modules: {...}, active_job? }
     POST   /api/scripts/{sid}/rebuild/{module}/estimate        → { ok, tokens_est, cost_est, model, affects[], prereqs[], note }
     POST   /api/scripts/{sid}/rebuild/{module}                 → { ok, job_id }
     POST   /api/scripts/{sid}/rebuild/embeddings  body:{include:[]} → { ok, job_id }
     SSE    /api/scripts/import-jobs/{job_id}/stream            (复用现有 streamImport)
*/

import React from 'react';
import { useTranslation } from 'react-i18next';
import CSSpaceBetween from '@cloudscape-design/components/space-between';

import { ModuleStatusCard } from '../components/ModuleStatusCard.jsx';
import { ModuleMatrixOverview } from '../components/ModuleMatrixOverview.jsx';
import { RebuildJobBanner } from '../components/RebuildJobBanner.jsx';
import { RebuildEstimateModal } from '../components/RebuildEstimateModal.jsx';

export function useScriptRebuild(scriptId) {
  const { t } = useTranslation();
  const [statusPayload, setStatusPayload] = React.useState(null);
  const [statusLoading, setStatusLoading] = React.useState(false);
  const [activeJob, setActiveJob] = React.useState(null);

  // estimate modal state
  const [pendingModule, setPendingModule] = React.useState(null); // string|null
  const [pendingOptions, setPendingOptions] = React.useState(null);
  const [estimate, setEstimate] = React.useState(null);
  const [estimateLoading, setEstimateLoading] = React.useState(false);

  const reload = React.useCallback(async () => {
    if (!scriptId) return;
    setStatusLoading(true);
    try {
      const r = await window.api?.scripts?.getModulesStatus?.(scriptId);
      if (r && r.ok !== false) {
        // 后端返 modules: [{module: 'chunks', done_count, total_count, status, ...}, ...]
        // 前端组件 (ModuleMatrixOverview / cardProps) 期望 dict: { chunks: {...}, chapter_facts: {...} }
        // 同时把后端的 'chapter-facts' (dash) 归一化成 'chapter_facts' (underscore) 跟 MODULE_META 对齐
        let modulesDict = r.modules;
        if (Array.isArray(r.modules)) {
          modulesDict = {};
          for (const m of r.modules) {
            if (!m || typeof m !== 'object') continue;
            const key = String(m.module || '').replace(/-/g, '_');
            if (!key) continue;
            modulesDict[key] = m;
          }
        }
        setStatusPayload({ ...r, modules: modulesDict || {} });
        if (r.active_job && (r.active_job.job_id || r.active_job.id)) {
          setActiveJob(r.active_job);
        }
      }
    } catch (_) {
      // backend not deployed yet — leave payload null, cards render in 'unknown'
      setStatusPayload({ modules: {} });
    } finally {
      setStatusLoading(false);
    }
    // P1-5: modules-status 现在不返 active_job,所以单独拉 /active-job 看有没有 full_pipeline / llm_extract / knowledge_sync 在跑
    try {
      if (window.api?.scripts?.activeJob) {
        const aj = await window.api.scripts.activeJob(scriptId);
        if (aj && aj.ok !== false && aj.active && aj.job) {
          const j = aj.job;
          const jid = j.job_id || j.id;
          if (jid) {
            setActiveJob((prev) => {
              // 不覆盖 confirmRebuild 刚设的 rebuild_* job(那个 jid 已正确)
              if (prev && (prev.job_id || prev.id) === jid) return prev;
              return {
                job_id: jid,
                kind: j.kind,
                module: j.module || (j.kind && !String(j.kind).startsWith('rebuild_') ? null : String(j.kind || '').replace(/^rebuild_/, '')),
                status: j.status || 'running',
                overall_progress: j.overall_progress || 0,
                overall_total: j.overall_total || 100,
                stage_label: j.stage_label,
              };
            });
          }
        }
      }
    } catch (_) {}
  }, [scriptId]);

  React.useEffect(() => { reload(); }, [reload]);

  const openEstimate = React.useCallback(async ({ module, options }) => {
    if (!module || !scriptId) return;
    setPendingModule(module);
    setPendingOptions(options || null);
    setEstimate(null);
    setEstimateLoading(true);
    try {
      const r = await window.api?.scripts?.rebuildEstimate?.(scriptId, module, options || {});
      setEstimate(r || { ok: false, error: 'no_response' });
    } catch (e) {
      const payload = (e && e.payload) || {};
      setEstimate({ ok: false, error: payload.error || e?.message || 'estimate_failed' });
    } finally {
      setEstimateLoading(false);
    }
  }, [scriptId]);

  const closeEstimate = React.useCallback(() => {
    setPendingModule(null);
    setPendingOptions(null);
    setEstimate(null);
  }, []);

  const confirmRebuild = React.useCallback(async () => {
    if (!pendingModule || !scriptId) return;
    try {
      let r;
      if (pendingModule === 'embeddings') {
        r = await window.api?.scripts?.rebuildEmbeddings?.(scriptId, pendingOptions || {});
      } else {
        r = await window.api?.scripts?.rebuild?.(scriptId, pendingModule, pendingOptions || {});
      }
      const jid = r && (r.job_id || r.id);
      if (jid) {
        setActiveJob({ job_id: jid, kind: `rebuild_${pendingModule}`, module: pendingModule, status: 'running', overall_progress: 0, overall_total: 100 });
        window.__apiToast?.(t('modules.toast.dispatched', { defaultValue: '重做任务已派发' }), { kind: 'ok', duration: 2400 });
      } else {
        window.__apiToast?.(t('modules.toast.dispatch_fail', { defaultValue: '派发失败' }), { kind: 'danger', detail: (r && r.error) || '' });
      }
    } catch (e) {
      const p = (e && e.payload) || {};
      if (p.job_id) {
        // 409 conflict — 复用已在跑的 job
        setActiveJob({ job_id: p.job_id, kind: `rebuild_${pendingModule}`, module: pendingModule, status: 'running', overall_progress: 0, overall_total: 100 });
      } else {
        window.__apiToast?.(t('modules.toast.dispatch_fail', { defaultValue: '派发失败' }), { kind: 'danger', detail: p.error || e?.message || '' });
      }
    } finally {
      closeEstimate();
    }
  }, [pendingModule, pendingOptions, scriptId, closeEstimate, t]);

  const onBannerDone = React.useCallback((finalJob) => {
    setActiveJob(null);
    // reload status → 让所有卡片刷新计数
    reload();
    try { window.dispatchEvent(new CustomEvent('rpg-scripts-updated')); } catch (_) {}
    window.__apiToast?.(t('modules.toast.rebuild_done', { defaultValue: '重做完成' }), { kind: 'ok', duration: 2800 });
  }, [reload, t]);

  const cardProps = React.useCallback((module) => {
    const m = (statusPayload && statusPayload.modules && statusPayload.modules[module]) || {};
    return {
      module,
      scriptId,
      status: m.status || 'unknown',
      doneCount: m.done_count,
      totalCount: m.total_count,
      lastJobId: m.last_job_id,
      lastRebuiltAt: m.last_rebuilt_at,
      source: m.source,
      activeJobId: activeJob ? (activeJob.job_id || activeJob.id) : null,
      onRebuild: openEstimate,
    };
  }, [statusPayload, scriptId, activeJob, openEstimate]);

  const bannerProps = {
    scriptId,
    activeJob,
    onChange: (j) => setActiveJob(j),
    onDone: onBannerDone,
  };
  const matrixProps = {
    scriptId,
    status: statusPayload,
    loading: statusLoading,
    activeJobId: activeJob ? (activeJob.job_id || activeJob.id) : null,
    onRebuild: openEstimate,
  };
  const modalProps = {
    open: !!pendingModule,
    module: pendingModule,
    scriptId,
    estimate,
    loading: estimateLoading,
    onClose: closeEstimate,
    onConfirm: confirmRebuild,
  };

  return {
    statusPayload,
    statusLoading,
    activeJob,
    reload,
    openEstimate,
    cardProps,
    bannerProps,
    matrixProps,
    modalProps,
  };
}

/* ModuleRebuildPanel — 整 tab 用,把 matrix + banner + modal 合成一个 view.
   ScriptDetailPanel 在 "模块" tab 直接 <ModuleRebuildPanel scriptId={s.id} /> */
export function ModuleRebuildPanel({ scriptId }) {
  const rb = useScriptRebuild(scriptId);
  return (
    <CSSpaceBetween size="l">
      <RebuildJobBanner {...rb.bannerProps} />
      <ModuleMatrixOverview {...rb.matrixProps} />
      <RebuildEstimateModal {...rb.modalProps} />
    </CSSpaceBetween>
  );
}

export default ModuleRebuildPanel;
