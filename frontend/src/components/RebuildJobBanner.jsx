/* RebuildJobBanner — Editorial × 古籍数字化 重设计版.
   保留完整 SSE 数据流逻辑,只替换 Cloudscape Alert 视觉层.
*/

import React from 'react';
import { useTranslation } from 'react-i18next';
import s from './editorial.module.css';

function moduleLabel(t, module) {
  if (!module) return '';
  return t(`modules.${module}.title`, { defaultValue: module });
}

const SHOWN_KINDS = ['full_pipeline', 'llm_extract', 'knowledge_sync'];
function shouldShowBanner(job) {
  if (!job) return false;
  if (!(job.job_id || job.id)) return false;
  const kind = String(job.kind || '');
  if (kind.startsWith('rebuild_')) return true;
  if (SHOWN_KINDS.includes(kind)) return true;
  if (job.module) return true;
  return false;
}

const KIND_FALLBACK_LABEL = {
  full_pipeline:   '导入流水线',
  llm_extract:     'LLM 二次提取',
  knowledge_sync:  '知识库索引同步',
};

/* Character progress bar helper (20 blocks for the banner — wider context) */
const B_FULL  = '▰';
const B_EMPTY = '▱';
const BANNER_CELLS = 20;
function bannerBar(pct) {
  const filled = Math.round((pct / 100) * BANNER_CELLS);
  return B_FULL.repeat(filled) + B_EMPTY.repeat(BANNER_CELLS - filled);
}

export function RebuildJobBanner({ scriptId, activeJob, onChange, onDone }) {
  const { t } = useTranslation();
  const [job, setJob] = React.useState(activeJob || null);
  const esRef = React.useRef(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => { setJob(activeJob || null); }, [activeJob && activeJob.job_id]);

  React.useEffect(() => {
    const jid = activeJob && (activeJob.job_id || activeJob.id);
    if (!jid) return;
    if (!window.api?.scripts?.streamImport) return;
    try { esRef.current && esRef.current.close && esRef.current.close(); } catch (_) {}
    esRef.current = window.api.scripts.streamImport(jid, {
      on_message: (jb) => {
        if (!jb || typeof jb !== 'object') return;
        const next = { ...jb, job_id: jb.job_id || jb.id || jid };
        setJob(next);
        onChange && onChange(next);
      },
      on_done: (jb) => {
        const final = jb || job;
        setJob(prev => ({ ...(prev || {}), ...(final || {}), status: (final && final.status) || 'done' }));
        onDone && onDone(final);
      },
      on_error: () => {},
    });
    return () => {
      try { esRef.current && esRef.current.close && esRef.current.close(); } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob && (activeJob.job_id || activeJob.id)]);

  if (!shouldShowBanner(job)) return null;
  const status = job.status || 'running';

  /* ── Error state ── */
  if (status === 'failed') {
    return (
      <div className={`${s.banner} ${s.bannerError}`}>
        <div className={s.bannerHead}>
          <span className={`${s.bannerTitle} ${s.bannerErrorTitle}`}>
            ⚠ {t('modules.banner.failed', { defaultValue: '重做失败' })}
          </span>
        </div>
        <div className={s.bannerErrorMsg}>
          {job.error || t('modules.banner.failed_detail', { defaultValue: '后端日志可查询任务 ID' })}
        </div>
      </div>
    );
  }

  /* ── Done / cancelled — don't render ── */
  if (status === 'done' || status === 'cancelled') return null;

  /* ── Running ── */
  const overall      = job.overall_progress || 0;
  const overallTotal = job.overall_total || 100;
  const pct          = overallTotal ? Math.round((overall / overallTotal) * 100) : 0;

  const kindStr = String(job.kind || '');
  let moduleName;
  if (kindStr.startsWith('rebuild_') || job.module) {
    moduleName = moduleLabel(t, job.module || kindStr.replace(/^rebuild_/, ''));
  } else if (KIND_FALLBACK_LABEL[kindStr]) {
    moduleName = KIND_FALLBACK_LABEL[kindStr];
  } else {
    moduleName = job.title || kindStr || '后台任务';
  }

  const before = job.before_count;
  const after  = job.after_count;
  const arrow  = (before != null && after != null)
    ? `${before} → ${after}`
    : (before != null ? `${before} → …` : null);

  const onCancel = async () => {
    try { await window.api?.scripts?.jobCancel?.(job.job_id || job.id); } catch (_) {}
  };

  return (
    <div className={s.banner}>
      {/* Head */}
      <div className={s.bannerHead}>
        <span className={s.bannerTitle}>
          {t('modules.banner.running', { defaultValue: '正在重做' })}
          &nbsp;·&nbsp;
          <span className={s.bannerModule}>{moduleName}</span>
          {arrow && <span className={s.bannerArrow}>{arrow}</span>}
        </span>
        <button className={s.bannerCancel} type="button" onClick={onCancel}>
          {t('common.cancel', { defaultValue: '取消' })}
        </button>
      </div>

      {/* Character progress bar */}
      <div className={s.bannerProgressRow}>
        <span className={s.bannerCharBar}>{bannerBar(pct)}</span>
        <span className={s.bannerPct}>{pct}% · {overall}/{overallTotal}</span>
      </div>

      {/* Stage label */}
      {job.stage_label && (
        <div className={s.bannerStage}>{job.stage_label}</div>
      )}
    </div>
  );
}

export default RebuildJobBanner;
