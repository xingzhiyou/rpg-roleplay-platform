/* ModuleStatusCard — Editorial × 古籍数字化 重设计版.
   保持所有 props contract 不变 (module / status / doneCount / totalCount / lastJobId /
   lastRebuiltAt / source / onRebuild / onViewDetail / activeJobId / extraActions /
   title / description / metadata).
   去除 Cloudscape 依赖 — 纯 CSS module + inline style.
*/

import React from 'react';
import { useTranslation } from 'react-i18next';
import s from './editorial.module.css';

/* ── Source tag text (小型 dotted label) ── */
const SOURCE_LABEL = { llm: 'LLM', zero_llm: '零 LLM', mixed: '可选 LLM' };
const SOURCE_CSS   = { llm: s.sourceTagLlm, zero_llm: s.sourceTagZero, mixed: s.sourceTagMixed };

const MODULE_META = {
  chunks:        { source: 'zero_llm' },
  chapter_facts: { source: 'zero_llm' },
  canon:         { source: 'llm' },
  cards:         { source: 'llm' },
  worldbook:     { source: 'mixed' },
  anchors:       { source: 'zero_llm' },
  embeddings:    { source: 'zero_llm' },
};

/* ── Status badge helpers ── */
function statusGlyph(status) {
  switch (status) {
    case 'ready':   return '✓';
    case 'partial': return '◑';
    case 'missing': return '○';
    case 'running': return '◷';
    case 'stale':   return '△';
    default:        return '·';
  }
}

function statusCls(status) {
  switch (status) {
    case 'ready':   return s.ok;
    case 'partial':
    case 'stale':   return s.warn;
    case 'missing': return s.danger;
    case 'running': return s.run;
    default:        return s.dim;
  }
}

function statusText(t, status) {
  switch (status) {
    case 'ready':   return t('modules.status.ready',   { defaultValue: '就绪' });
    case 'partial': return t('modules.status.partial', { defaultValue: '部分' });
    case 'missing': return t('modules.status.missing', { defaultValue: '缺失' });
    case 'running': return t('modules.status.running', { defaultValue: '运行中' });
    case 'stale':   return t('modules.status.stale',   { defaultValue: '已过期' });
    default:        return t('modules.status.unknown', { defaultValue: '未知' });
  }
}

/* ── Character progress bar (10 blocks) ── */
const BLOCK_FULL  = '▰';
const BLOCK_EMPTY = '▱';
const BAR_CELLS   = 10;

function charProgressBar(done, total) {
  if (done == null || total == null || total === 0) return null;
  const ratio = Math.max(0, Math.min(1, done / total));
  const filled = Math.round(ratio * BAR_CELLS);
  const bar    = BLOCK_FULL.repeat(filled) + BLOCK_EMPTY.repeat(BAR_CELLS - filled);
  const pct    = Math.round(ratio * 100);
  return { bar, pct };
}

/* ── Time-since helper ── */
function fmtCountdown(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const m = Math.floor((Date.now() - d.getTime()) / 60000);
    if (m < 1)  return '刚刚';
    if (m < 60) return `${m} 分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时前`;
    return `${Math.floor(h / 24)} 天前`;
  } catch (_) { return null; }
}

/* ── Zhuyin (朱印) protagonist badge ── */
function ZhuyinBadge() {
  return (
    <div className={s.zhuyinBadge} title="主角">
      <span className={s.zhuyinChar}>主</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */

export function ModuleStatusCard({
  module,
  scriptId,
  status = 'unknown',
  doneCount,
  totalCount,
  lastJobId,
  lastRebuiltAt,
  source: sourceOverride,
  onRebuild,
  onViewDetail,
  activeJobId,
  extraActions,
  title,
  description,
  metadata,        /* { is_protagonist? } — 后端已写 */
}) {
  const { t } = useTranslation();
  const meta   = MODULE_META[module] || {};
  const source = sourceOverride || meta.source || 'unknown';

  const displayTitle = title
    || t(`modules.${module}.title`, { defaultValue: module });
  const displayDesc  = description
    || t(`modules.${module}.desc`, { defaultValue: '' });

  const sinceStr       = fmtCountdown(lastRebuiltAt);
  const rebuildDisabled = !!activeJobId || status === 'running';
  const isProtagonist  = metadata && metadata.is_protagonist;

  /* ── progress bar ── */
  const progress = charProgressBar(doneCount, totalCount);

  /* ── count display parts ── */
  const hasBoth = doneCount != null && totalCount != null && totalCount > 0;
  const hasDone = doneCount != null;

  /* ── card root class ── */
  let cardCls = s.card;
  if (status === 'running') cardCls += ' ' + s.cardRunning;
  if (status === 'missing') cardCls += ' ' + s.cardMissing;

  /* ── action label ── */
  const rebuildLabel = status === 'missing'
    ? t('modules.action.build',   { defaultValue: '生成' })
    : t('modules.action.rebuild', { defaultValue: '重做' });

  return (
    <div className={cardCls}>
      {/* 朱印 — rendered absolutely inside card */}
      {isProtagonist && <ZhuyinBadge />}

      {/* ── Head row: title + source tag + actions ── */}
      <div className={s.cardHead}>
        <div className={s.cardTitleGroup}>
          <span className={s.cardTitle}>{displayTitle}</span>
          {source !== 'unknown' && (
            <span className={`${s.sourceTag} ${SOURCE_CSS[source] || ''}`}>
              {SOURCE_LABEL[source] || source}
            </span>
          )}
        </div>
        <div className={s.cardActions}>
          {onViewDetail && (
            <button
              className={s.detailLink}
              onClick={() => onViewDetail({ module, scriptId, lastJobId })}
              type="button"
            >
              明细 ↗
            </button>
          )}
          {onRebuild && (
            <button
              className={s.rebuildBtn}
              disabled={rebuildDisabled}
              onClick={() => onRebuild({ module, scriptId, source })}
              type="button"
            >
              <span className={s.rebuildArrow}>↻</span>
              {rebuildLabel}
            </button>
          )}
        </div>
      </div>

      {/* ── Description ── */}
      {displayDesc && (
        <div className={s.cardDesc}>{displayDesc}</div>
      )}

      {/* ── Body: big serif count + status badge + time ── */}
      <div className={s.cardBody}>
        {/* Count */}
        <div className={s.countBlock}>
          {hasBoth ? (
            <>
              <span className={s.countNum}>{doneCount}</span>
              <span className={s.countSep}>/</span>
              <span className={s.countTotal}>{totalCount}</span>
              <span className={s.countUnit}>条</span>
            </>
          ) : hasDone ? (
            <>
              <span className={s.countNum}>{doneCount}</span>
              <span className={s.countUnit}>条</span>
            </>
          ) : (
            <span className={s.countDash}>—</span>
          )}
        </div>

        {/* Status */}
        <div className={s.statusArea}>
          <span className={s.statusLabel}>
            {t('modules.field.status', { defaultValue: '状态' })}
          </span>
          <span className={`${s.statusBadge} ${statusCls(status)}`}>
            {statusGlyph(status)}&nbsp;{statusText(t, status)}
          </span>
        </div>

        {/* Time since */}
        {sinceStr && (
          <span className={s.timeLabel}>{sinceStr}</span>
        )}
      </div>

      {/* ── Character progress bar ── */}
      {progress && (
        <div className={s.progressArea}>
          <span className={s.progressBar}>{progress.bar}</span>
          <span className={s.progressPct}>{progress.pct}%</span>
        </div>
      )}

      {/* ── Extra actions (e.g. worldbook double-button) ── */}
      {extraActions && (
        <div className={s.extraActionsRow}>
          {extraActions}
        </div>
      )}
    </div>
  );
}

export default ModuleStatusCard;
