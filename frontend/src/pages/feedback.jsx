/**
 * feedback.jsx — 「支持与反馈」页(参考 AWS 支持中心)。路由 /feedback。
 * 职责:历史反馈(状态/官方回复)+ 完整新反馈表单。快速新反馈走顶栏「反馈」弹窗(FeedbackQuickModal)。
 * 后端契约:POST /api/feedback · GET /api/me/feedback · DELETE /api/feedback/{id}
 *
 * 布局:单列居中(无空旷右栏)。内容限制 → 提交反馈 → 我的反馈记录(KPI + 状态筛选 + 卡片)
 *       → 玩家群/提示(等宽双列页脚)。
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import CSBox from '@cloudscape-design/components/box';
import CSButton from '@cloudscape-design/components/button';
import CSAlert from '@cloudscape-design/components/alert';
import CSSpaceBetween from '@cloudscape-design/components/space-between';
import CSTextarea from '@cloudscape-design/components/textarea';
import CSCheckbox from '@cloudscape-design/components/checkbox';
import CSFormField from '@cloudscape-design/components/form-field';
import CSContainer from '@cloudscape-design/components/container';
import CSHeader from '@cloudscape-design/components/header';
import CSBadge from '@cloudscape-design/components/badge';
import CSColumnLayout from '@cloudscape-design/components/column-layout';
import CSSegmentedControl from '@cloudscape-design/components/segmented-control';
import { sha256hex } from '../lib/crypto-safe.js';
import { feedbackDecisionLabel } from '../lib/feedback.js';

const CONSENT_TEXT = '我已阅读 AUP §2.J,理解不得包含成人主题节选,同意(此操作记录我的同意)';
const AUP_LINK = 'https://play.stellatrix.icu/legal/aup#2J';
const MAX_FREE_TEXT = 10000;
const QQ_GROUP_NUMBER = '584876566';
const QQ_JOIN_URL = 'https://qm.qq.com/q/49Dqcr0aw0';
const QQ_QR_SRC = '/qq-group.jpg';

const statusLabel = feedbackDecisionLabel;  // 语义统一 #26:用户侧决策标签(共享 lib/feedback.js)
function statusColor(d) {
  return !d ? 'blue' : d === 'ok' ? 'green' : d === 'spam' ? 'grey' : 'red';
}
// 统一到 window.__fmt.time(data-loader.js;zh-CN 24h 制),保留本地别名免改调用点。
function fmtTime(ts) {
  if (window.__fmt && window.__fmt.time) return window.__fmt.time(ts);
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); } catch (_) { return ts; }
}

function Kpi({ label, value, color }) {
  return (
    <div style={{ padding: '14px 16px', border: '1px solid var(--line, #36322d)', borderRadius: 10, background: 'var(--panel, #211f1d)' }}>
      <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: color || 'var(--text, #e8e3d9)' }}>{value}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-quiet, #968f85)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

export function FeedbackPage() {
  const { t } = useTranslation();
  const [freeText, setFreeText] = React.useState('');
  const [includeRuntime, setIncludeRuntime] = React.useState(true);
  const [includeExcerpts, setIncludeExcerpts] = React.useState(false);
  const [selectedExcerpts, setSelectedExcerpts] = React.useState([]);
  const [recentTurns, setRecentTurns] = React.useState([]);
  const [consent, setConsent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [runtimePreview, setRuntimePreview] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historyError, setHistoryError] = React.useState(null);
  const [filter, setFilter] = React.useState('all');   // all | pending | ok | other

  const loadHistory = React.useCallback(async () => {
    setHistoryLoading(true); setHistoryError(null);
    try {
      const res = await fetch('/api/me/feedback?limit=50', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !data.ok) throw new Error(data?.error || i18n.t('feedback_page.error.load_history'));
      setHistory(Array.isArray(data.items) ? data.items : []);
    } catch (e) { setHistoryError(e?.message || i18n.t('feedback_page.error.load_history')); }
    finally { setHistoryLoading(false); }
  }, []);

  React.useEffect(() => {
    try {
      const snap = window.__getRuntimeSnapshot && window.__getRuntimeSnapshot();
      setRuntimePreview(snap ? snap.__runtime__ : null);
    } catch (_) { setRuntimePreview(null); }
    loadHistory();
  }, [loadHistory]);

  React.useEffect(() => {
    if (!includeExcerpts) return;
    let cancelled = false;
    (async () => {
      try {
        let nodes = null;
        let saveId = '';
        try {
          const state = await window.api?.game?.state?.();
          nodes = state?.history || state?.branch_nodes || state?.turns || null;
          saveId = state?.save_id || state?._raw?.save_id || '';
        } catch (_) { /* 回退 */ }
        if (!Array.isArray(nodes) || nodes.length === 0) {
          if (window.MOCK_STATE && Array.isArray(window.MOCK_STATE.history)) nodes = window.MOCK_STATE.history;
          saveId = saveId || window.MOCK_STATE?._raw?.save_id || '';
        }
        const recent = (Array.isArray(nodes) ? nodes : [])
          .filter((n) => n && (n.role === 'user' || n.role === 'assistant' || n.role === 'gm') && (n.content || n.text));
        const turns = recent.slice(-6).map((n, i) => ({
          idx: i, session_id: saveId, range: String(n.turn_index ?? n.turn ?? i),
          plaintext: ((n.content || n.text || '') + '').slice(0, 200),
          label: n.role === 'user' ? i18n.t('feedback_page.excerpt.label_player') : i18n.t('feedback_page.excerpt.label_gm'),
        }));
        if (!cancelled) setRecentTurns(turns);
      } catch (_) { if (!cancelled) setRecentTurns([]); }
    })();
    return () => { cancelled = true; };
  }, [includeExcerpts]);

  const toggleExcerpt = (idx) => setSelectedExcerpts((p) => p.includes(idx) ? p.filter((i) => i !== idx) : [...p, idx]);
  const canSubmit = consent && freeText.trim().length > 0 && freeText.length <= MAX_FREE_TEXT && !busy;

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true); setError(null);
    try {
      const token = await sha256hex(CONSENT_TEXT);
      const excerpts = includeExcerpts
        ? recentTurns.filter((t) => selectedExcerpts.includes(t.idx)).map(({ session_id, range, plaintext }) => ({ session_id, range, plaintext }))
        : [];
      if (includeRuntime) {
        try {
          let freshHistory = null;
          try {
            const st = await window.api?.game?.state?.();
            if (st && Array.isArray(st.history)) freshHistory = st.history;
          } catch (_) {}
          const snap = window.__getRuntimeSnapshot && window.__getRuntimeSnapshot({ includeRecentDialog: true, recentDialog: freshHistory });
          if (snap && snap.__runtime__) excerpts.push(snap);
        } catch (_) {}
      }
      const res = await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ free_text: freeText, excerpts, consent_token: token, app_version: window.__APP_VERSION__ || '' }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      setDone(true); setFreeText(''); setConsent(false); setIncludeExcerpts(false); setSelectedExcerpts([]);
      await loadHistory();
    } catch (e) { setError(e?.message || i18n.t('feedback_page.error.submit_failed')); }
    finally { setBusy(false); }
  }

  async function withdraw(id) {
    if (!(window.__confirm ? await window.__confirm({ title: i18n.t('feedback_page.withdraw.confirm_title'), message: i18n.t('feedback_page.withdraw.confirm_message', { id }), danger: true, confirmText: i18n.t('feedback_page.withdraw.confirm_btn') }) : window.confirm(i18n.t('feedback_page.withdraw.confirm_message', { id })))) return;
    try {
      const res = await fetch(`/api/feedback/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      window.__apiToast?.(i18n.t('feedback_page.withdraw.toast_success'), { kind: 'ok', duration: 1800 });
      loadHistory();
    } catch (e) { window.__apiToast?.(i18n.t('feedback_page.withdraw.toast_error'), { kind: 'danger', detail: e?.message }); }
  }

  // 统计 + 筛选
  const counts = React.useMemo(() => {
    let pending = 0, ok = 0;
    for (const it of history) { if (!it.review_decision) pending++; else if (it.review_decision === 'ok') ok++; }
    return { total: history.length, pending, ok };
  }, [history]);
  const filtered = React.useMemo(() => history.filter((it) => {
    if (filter === 'all') return true;
    if (filter === 'pending') return !it.review_decision;
    if (filter === 'ok') return it.review_decision === 'ok';
    return it.review_decision && it.review_decision !== 'ok';
  }), [history, filter]);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', paddingBottom: 32 }}>
      <CSSpaceBetween size="l">
        <CSHeader
          variant="h1"
          description={t('feedback_page.header_description')}
          actions={<CSButton iconName="refresh" loading={historyLoading} onClick={loadHistory}>{t('common.refresh')}</CSButton>}
        >{t('feedback_page.header_title')}</CSHeader>

        <CSAlert type="warning" header={t('feedback_page.content_limit.title')}>
          {t('feedback_page.content_limit.body')} <a href={AUP_LINK} target="_blank" rel="noopener noreferrer">AUP §2.J</a>。
        </CSAlert>

        {/* ── 提交反馈 ── */}
        <CSContainer header={<CSHeader variant="h2" description={t('feedback_page.form.container_description')}>{t('feedback_page.form.container_title')}</CSHeader>}>
          <CSSpaceBetween size="m">
            {done && <CSAlert type="success" header={t('feedback_page.form.success_title')} dismissible onDismiss={() => setDone(false)}>{t('feedback_page.form.success_body')}</CSAlert>}
            {error && <CSAlert type="error" header={t('feedback_page.error.submit_title')}>{error}</CSAlert>}
            <CSFormField label={t('feedback_page.form.text_label')} description={t('feedback_page.form.text_description', { max: MAX_FREE_TEXT })} errorText={freeText.length > MAX_FREE_TEXT ? t('feedback_page.form.text_over_limit', { max: MAX_FREE_TEXT }) : undefined}>
              <CSTextarea value={freeText} onChange={({ detail }) => setFreeText(detail.value)} placeholder={t('feedback_page.form.text_placeholder')} rows={6} disabled={busy} />
            </CSFormField>
            <CSCheckbox checked={includeRuntime} onChange={({ detail }) => setIncludeRuntime(detail.checked)} disabled={busy}>
              {t('feedback_page.form.include_runtime')}
            </CSCheckbox>
            {includeRuntime && runtimePreview && (
              <CSBox fontSize="body-s" color="text-body-secondary">
                <div>{t('feedback_page.runtime.page')} <code>{runtimePreview.hash || runtimePreview.url || '—'}</code> · {t('feedback_page.runtime.script')} {String(runtimePreview.active?.script_id ?? '—')} / {t('feedback_page.runtime.save')} {String(runtimePreview.active?.save_id ?? '—')}</div>
                <div>{t('feedback_page.runtime.errors', { count: runtimePreview.errors?.length || 0 })} · {t('feedback_page.runtime.api_failures', { count: runtimePreview.api_failures?.length || 0 })} · {runtimePreview.viewport}</div>
              </CSBox>
            )}
            <CSCheckbox checked={includeExcerpts} onChange={({ detail }) => setIncludeExcerpts(detail.checked)} disabled={busy}>{t('feedback_page.form.include_excerpts')}</CSCheckbox>
            {includeExcerpts && (
              recentTurns.length === 0
                ? <CSBox color="text-body-secondary" fontSize="body-s">{t('feedback_page.excerpt.empty')}</CSBox>
                : <CSSpaceBetween size="xs">{recentTurns.map((t) => (
                    <CSCheckbox key={t.idx} checked={selectedExcerpts.includes(t.idx)} onChange={() => toggleExcerpt(t.idx)} disabled={busy}>
                      <strong>{t.label}</strong> <CSBox color="text-body-secondary" fontSize="body-s" display="inline">{t.plaintext.slice(0, 70)}{t.plaintext.length > 70 ? '…' : ''}</CSBox>
                    </CSCheckbox>
                  ))}</CSSpaceBetween>
            )}
            <CSFormField errorText={!consent && freeText.trim() ? t('feedback_page.form.consent_required') : undefined}>
              <CSCheckbox checked={consent} onChange={({ detail }) => setConsent(detail.checked)} disabled={busy}>{t('feedback_page.consent_text')}</CSCheckbox>
            </CSFormField>
            <CSBox><CSButton variant="primary" iconName="upload" onClick={handleSubmit} loading={busy} disabled={!canSubmit}>{t('feedback_page.form.submit_btn')}</CSButton></CSBox>
          </CSSpaceBetween>
        </CSContainer>

        {/* ── 我的反馈记录 ── */}
        <CSContainer header={<CSHeader variant="h2" counter={history.length ? `(${history.length})` : undefined}>{t('feedback_page.history.title')}</CSHeader>}>
          <CSSpaceBetween size="m">
            <CSColumnLayout columns={3} variant="text-grid">
              <Kpi label={t('feedback_page.history.kpi_total')} value={counts.total} />
              <Kpi label={t('feedback_page.history.kpi_pending')} value={counts.pending} color="#5b9bd5" />
              <Kpi label={t('feedback_page.history.kpi_accepted')} value={counts.ok} color="#6cc04a" />
            </CSColumnLayout>

            <CSSegmentedControl
              selectedId={filter}
              onChange={({ detail }) => setFilter(detail.selectedId)}
              options={[
                { id: 'all', text: t('feedback_page.history.filter_all', { count: counts.total }) },
                { id: 'pending', text: t('feedback_page.history.filter_pending', { count: counts.pending }) },
                { id: 'ok', text: t('feedback_page.history.filter_ok', { count: counts.ok }) },
                { id: 'other', text: t('feedback_page.history.filter_other') },
              ]}
            />

            {historyError ? <CSAlert type="error" header={t('feedback_page.error.load_title')}>{historyError}</CSAlert>
              : historyLoading && history.length === 0 ? <CSBox color="text-body-secondary" padding="m">{t('feedback_page.history.loading')}</CSBox>
              : history.length === 0 ? (
                <CSBox textAlign="center" color="text-body-secondary" padding={{ vertical: 'xl' }}>
                  {t('feedback_page.history.empty')}
                </CSBox>
              ) : filtered.length === 0 ? (
                <CSBox textAlign="center" color="text-body-secondary" padding={{ vertical: 'l' }}>{t('feedback_page.history.filter_empty')}</CSBox>
              ) : (
                <CSSpaceBetween size="s">{filtered.map((it) => (
                  <div key={it.id} style={{ padding: '14px 16px', border: '1px solid var(--line, #36322d)', borderRadius: 10, background: 'var(--panel, #211f1d)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13.5 }}>#{it.id}</strong>
                      <CSBadge color={statusColor(it.review_decision)}>{statusLabel(it.review_decision)}</CSBadge>
                      <CSBox fontSize="body-s" color="text-body-secondary">{t('feedback_page.history.submitted_at', { time: fmtTime(it.created_at) })}{it.reviewed_at ? ` · ${t('feedback_page.history.reviewed_at', { time: fmtTime(it.reviewed_at) })}` : ''}</CSBox>
                      {!it.review_decision && <span style={{ marginLeft: 'auto' }}><CSButton variant="inline-link" iconName="remove" onClick={() => withdraw(it.id)}>{t('feedback_page.withdraw.btn')}</CSButton></span>}
                    </div>
                    <CSBox fontSize="body-s" color="text-body-secondary">{it.free_text_preview || t('feedback_page.history.no_text')}</CSBox>
                    {it.admin_reply && (
                      <div style={{ marginTop: 10, padding: '10px 13px', borderRadius: 8, background: 'var(--accent-soft, rgba(201,100,66,.12))', borderLeft: '3px solid var(--accent, #c96442)', fontSize: 13, lineHeight: 1.6 }}>
                        <strong>{t('feedback_page.history.admin_reply')}</strong>{it.replied_at ? <span style={{ color: 'var(--text-quiet,#968f85)', fontWeight: 400 }}> · {fmtTime(it.replied_at)}</span> : null}
                        <div style={{ marginTop: 3, whiteSpace: 'pre-wrap' }}>{it.admin_reply}</div>
                      </div>
                    )}
                  </div>
                ))}</CSSpaceBetween>
              )}
          </CSSpaceBetween>
        </CSContainer>

        {/* ── 页脚:玩家群 + 提示(等宽双列,填满宽度,无空旷)── */}
        <CSColumnLayout columns={2} variant="text-grid">
          <CSContainer header={<CSHeader variant="h3">{t('feedback_page.community.title')}</CSHeader>}>
            <CSSpaceBetween size="s">
              <CSBox fontSize="body-s" color="text-body-secondary">{t('feedback_page.community.description', { group: QQ_GROUP_NUMBER })}</CSBox>
              <img src={QQ_QR_SRC} alt={t('feedback_page.community.qr_alt', { group: QQ_GROUP_NUMBER })} loading="lazy" style={{ width: 140, height: 'auto', borderRadius: 10, border: '1px solid var(--line, #36322d)' }} />
              <CSBox><CSButton variant="primary" href={QQ_JOIN_URL} target="_blank" iconName="external">{t('feedback_page.community.join_btn')}</CSButton></CSBox>
            </CSSpaceBetween>
          </CSContainer>
          <CSContainer header={<CSHeader variant="h3">{t('feedback_page.tips.title')}</CSHeader>}>
            <CSBox fontSize="body-s" color="text-body-secondary">
              {t('feedback_page.tips.line1')}<br />
              {t('feedback_page.tips.line2')}<br />
              {t('feedback_page.tips.line3')}<br />
              {t('feedback_page.tips.line4')}
            </CSBox>
          </CSContainer>
        </CSColumnLayout>
      </CSSpaceBetween>
    </div>
  );
}

export default FeedbackPage;
