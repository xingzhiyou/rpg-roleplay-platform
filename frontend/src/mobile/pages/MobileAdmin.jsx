/* MobileAdmin.jsx — 管理后台移动端
   nav.page = admin-xxx 决定 section。
   铁律:零 Cloudscape/CS* 组件;数据全走 window.api.admin.*;样式只用 mobile.css 已有 class + inline。 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../icons.jsx';

/* ── 工具 ─────────────────────────────────────────────── */
// 统一到 window.__fmt.time(data-loader.js;zh-CN 24h 制),保留本地别名免改调用点。
function fmtTime(iso) {
  if (window.__fmt && window.__fmt.time) return window.__fmt.time(iso);
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('zh-CN', { hour12: false }); } catch (_) { return iso; }
}
function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('zh-CN'); } catch (_) { return iso; }
}

function LoadingRow() {
  const { t } = useTranslation();
  return <div className="pl-row" style={{ justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>{t('common.loading')}</div>;
}
function ErrRow({ msg, onRetry }) {
  const { t } = useTranslation();
  return (
    <div className="pl-row" style={{ flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
      <span className="pl-row-ic warn"><Icon name="warn" size={17} /></span>
      <span style={{ fontSize: 13, color: 'var(--danger)' }}>{msg}</span>
      {onRetry && <button className="pl-btn-ghost" style={{ fontSize: 12 }} onClick={onRetry}>{t('mobile.admin.retry')}</button>}
    </div>
  );
}
function EmptyRow({ text }) {
  const { t } = useTranslation();
  return <div className="pl-empty" style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{text ?? t('mobile.admin.no_data')}</div>;
}

/* 底部操作确认 sheet
   语义统一 Batch 6b GUARD:本站不收口到 mobile/Sheet.jsx。差异点(迁则改视觉/行为):
   ① body 走 .sheet-sub(11.5px/lh1.5)而非统一版的 .confirm-note(12px/lh1.65)
   ② scrim 点关由 busy 守护(处理中禁止关闭)③ sheet-actions marginTop:14(统一版 8)
   ④ 与本文件 InputSheet 共用 position:fixed 内联模式 + busy/onCancel 契约(非 open/loading)。
   1:1 复刻不了 → 按铁律保留原样。 */
function ConfirmSheet({ title, body, confirmLabel, danger = false, busy, onConfirm, onCancel }) {
  const { t } = useTranslation();
  const label = confirmLabel ?? t('common.confirm');
  return (
    <div className="sheet-wrap show" style={{ position: 'fixed', inset: 0, zIndex: 60, pointerEvents: 'auto' }}>
      <div className="sheet-scrim" onClick={!busy ? onCancel : undefined} />
      <div className="sheet show" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 61 }}>
        <div className="sheet-grip" />
        <div className="sheet-title">{title}</div>
        {body && <div className="sheet-sub">{body}</div>}
        <div className="sheet-actions" style={{ marginTop: 14 }}>
          <button className="sheet-btn" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
          <button className={`sheet-btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? t('mobile.admin.processing') : label}
          </button>
        </div>
      </div>
    </div>
  );
}

/* 输入 sheet */
function InputSheet({ title, fields, busy, onConfirm, onCancel }) {
  const { t } = useTranslation();
  const [vals, setVals] = React.useState(() => {
    const v = {};
    fields.forEach((f) => { v[f.key] = f.default || ''; });
    return v;
  });
  return (
    <div className="sheet-wrap show" style={{ position: 'fixed', inset: 0, zIndex: 60, pointerEvents: 'auto' }}>
      <div className="sheet-scrim" onClick={!busy ? onCancel : undefined} />
      <div className="sheet show" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 61 }}>
        <div className="sheet-grip" />
        <div className="sheet-title">{title}</div>
        <div style={{ display: 'grid', gap: 12, margin: '12px 0' }}>
          {fields.map((f) => (
            <div key={f.key}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{f.label}</div>
              {f.multiline ? (
                <textarea
                  value={vals[f.key]}
                  onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.placeholder || ''}
                  rows={3}
                  style={{ width: '100%', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
                />
              ) : (
                <input
                  type={f.type || 'text'}
                  value={vals[f.key]}
                  onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.placeholder || ''}
                  style={{ width: '100%', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
              )}
            </div>
          ))}
        </div>
        <div className="sheet-actions">
          <button className="sheet-btn" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
          <button className="sheet-btn primary" onClick={() => onConfirm(vals)} disabled={busy}>{busy ? t('mobile.admin.processing') : t('common.confirm')}</button>
        </div>
      </div>
    </div>
  );
}

/* ── section nav 菜单(admin-xxx 列表) ─────────────────── */
function getSections(t) {
  return [
    { key: 'admin-users', icon: 'user', label: t('mobile.admin.section.users') },
    { key: 'admin-usage', icon: 'usage', label: t('mobile.admin.section.usage') },
    { key: 'admin-audit', icon: 'history', label: t('mobile.admin.section.audit') },
    { key: 'admin-health', icon: 'cpu', label: t('mobile.admin.section.health') },
    { key: 'admin-logs', icon: 'list', label: t('mobile.admin.section.logs') },
    { key: 'admin-registration', icon: 'key', label: t('mobile.admin.section.registration') },
    { key: 'admin-security', icon: 'shield', label: t('mobile.admin.section.security') },
    { key: 'admin-maintenance', icon: 'settings', label: t('mobile.admin.section.maintenance') },
    { key: 'admin-dmca-takedowns', icon: 'flag', label: t('mobile.admin.section.dmca_takedowns') },
    { key: 'admin-dmca-strikes', icon: 'warn', label: t('mobile.admin.section.dmca_strikes') },
    { key: 'admin-csam-reports', icon: 'lock', label: t('mobile.admin.section.csam_reports') },
    { key: 'admin-aup-actions', icon: 'slash', label: t('mobile.admin.section.aup_actions') },
    { key: 'admin-feedback', icon: 'feedback', label: t('mobile.admin.section.feedback') },
    { key: 'admin-achievements', icon: 'trophy', label: t('mobile.admin.section.achievements') },
    { key: 'admin-deploy', icon: 'cloud', label: t('mobile.admin.section.deploy') },
  ];
}

function AdminMenu({ nav }) {
  const { t } = useTranslation();
  const sections = getSections(t);
  return (
    <>
      <div className="pl-head">
        <button className="pl-headbtn" onClick={() => nav.pop?.() || nav.switchTab?.('me')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title"><strong style={{ fontSize: 15 }}>{t('mobile.admin.title')}</strong></div>
      </div>
      <div className="pl-body tabbed">
        <div className="pl-pad">
          <div className="pl-sec">
            <div className="pl-sec-head"><h2>{t('mobile.admin.modules_heading')}</h2></div>
            {sections.map((s) => (
              <button key={s.key} className="pl-row" onClick={() => nav.go(s.key)}>
                <span className="pl-row-ic"><Icon name={s.icon} size={17} /></span>
                <span className="pl-row-tx"><strong style={{ fontSize: 13.5 }}>{s.label}</strong></span>
                <span className="pl-row-chev"><Icon name="chevron_right" size={17} /></span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════
   Section: admin-users
══════════════════════════════════════════ */
function SectionUsers({ nav }) {
  const { t } = useTranslation();
  const [users, setUsers] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [roleFilter, setRoleFilter] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [confirm, setConfirm] = React.useState(null); // { action, user, title, body }
  const [busy, setBusy] = React.useState(false);
  const me = window.RPG_AUTH?.user;
  const LIMIT = 20;

  const load = React.useCallback(async (p = 1) => {
    setLoading(true); setErr(null);
    try {
      const params = { page: p, limit: LIMIT };
      if (search.trim()) params.search = search.trim();
      if (roleFilter) params.role = roleFilter;
      if (statusFilter) params.status = statusFilter;
      const res = await window.api.admin.users(params);
      setUsers(res.users || res.items || res || []);
      setTotal(res.total || (res.users || res.items || res || []).length);
      setPage(p);
    } catch (e) { setErr(e?.message || t('mobile.admin.load_failed')); }
    finally { setLoading(false); }
  }, [search, roleFilter, statusFilter]);

  React.useEffect(() => { load(1); }, [roleFilter, statusFilter]);

  async function doAction() {
    if (!confirm) return;
    setBusy(true);
    try {
      const { action, user } = confirm;
      if (action === 'deactivate') await window.api.admin.deactivateUser(user.id);
      else if (action === 'reactivate') await window.api.admin.reactivateUser(user.id);
      else if (action === 'force-logout') await window.api.admin.forceLogout(user.id);
      else if (action === 'set-admin') await window.api.admin.updateUser(user.id, { role: 'admin' });
      else if (action === 'set-user') await window.api.admin.updateUser(user.id, { role: 'user' });
      nav.toast(t('mobile.admin.action_success'), 'ok');
      setConfirm(null);
      load(page);
    } catch (e) { nav.toast(t('mobile.admin.action_failed', { msg: e?.message || '' }), 'danger'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="pl-head">
        <button className="pl-headbtn" onClick={() => nav.go('admin')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title"><strong style={{ fontSize: 15 }}>{t('mobile.admin.section.users')}</strong><span className="sub">{total > 0 ? t('mobile.admin.users.total', { count: total }) : ''}</span></div>
        <button className="pl-headbtn" onClick={() => load(page)} disabled={loading}><Icon name="refresh" size={18} /></button>
      </div>
      <div className="pl-body tabbed">
        <div className="pl-pad">
          {/* 搜索 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              type="search"
              placeholder={t('mobile.admin.users.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') load(1); }}
              style={{ flex: 1, background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit' }}
            />
            <button className="pl-btn-primary" style={{ padding: '0 14px', height: 38 }} onClick={() => load(1)}>{t('mobile.admin.search')}</button>
          </div>
          {/* 过滤 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {[['', t('mobile.admin.users.role_all')], ['admin', t('mobile.admin.users.role_admin')], ['user', t('mobile.admin.users.role_user')]].map(([v, l]) => (
              <button key={v} onClick={() => setRoleFilter(v)}
                style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, border: '1px solid', borderColor: roleFilter === v ? 'var(--accent-edge)' : 'var(--line)', background: roleFilter === v ? 'var(--accent-soft)' : 'var(--panel-2)', color: roleFilter === v ? 'var(--accent)' : 'var(--muted)' }}>
                {l}
              </button>
            ))}
            {[['', t('mobile.admin.users.status_all')], ['active', t('mobile.admin.users.status_active')], ['deactivated', t('mobile.admin.users.status_deactivated')]].map(([v, l]) => (
              <button key={v} onClick={() => setStatusFilter(v)}
                style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, border: '1px solid', borderColor: statusFilter === v ? 'var(--accent-edge)' : 'var(--line)', background: statusFilter === v ? 'var(--accent-soft)' : 'var(--panel-2)', color: statusFilter === v ? 'var(--accent)' : 'var(--muted)' }}>
                {l}
              </button>
            ))}
          </div>

          {loading ? <LoadingRow /> : err ? <ErrRow msg={err} onRetry={() => load(page)} /> : users.length === 0 ? <EmptyRow text={t('mobile.admin.users.empty')} /> : (
            <div className="pl-sec">
              {users.map((u) => {
                const isSelf = me && (me.id === u.id || me.username === u.username);
                const isAdmin = u.role === 'admin';
                const isDeact = !!u.deactivated_at;
                return (
                  <div key={u.id} style={{ border: '1px solid var(--line-soft)', borderRadius: 12, background: 'var(--panel)', marginBottom: 8, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px' }}>
                      <span className={`pl-row-ic ${isAdmin ? 'accent' : ''}`}><Icon name="user" size={17} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          @{u.username || '—'} {isSelf && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{t('mobile.admin.users.me_label')}</span>}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--muted-2)', display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                          <span style={{ color: isAdmin ? 'var(--accent)' : 'var(--muted)' }}>{isAdmin ? 'admin' : 'user'}</span>
                          <span>·</span>
                          <span style={{ color: isDeact ? 'var(--danger)' : 'var(--ok)' }}>{isDeact ? t('mobile.admin.users.status_deactivated') : t('mobile.admin.users.status_active')}</span>
                          {u.last_login_at && <><span>·</span><span>{fmtDate(u.last_login_at)}</span></>}
                        </div>
                      </div>
                    </div>
                    {!isSelf && (
                      <div style={{ display: 'flex', gap: 0, borderTop: '1px solid var(--line-soft)' }}>
                        {!isDeact ? (
                          <button style={{ flex: 1, padding: '9px 4px', fontSize: 12, color: 'var(--danger)', borderRight: '1px solid var(--line-soft)' }}
                            onClick={() => setConfirm({ action: 'deactivate', user: u, title: t('mobile.admin.users.deactivate_title', { username: u.username }), body: t('mobile.admin.users.deactivate_body') })}>
                            {t('mobile.admin.users.deactivate_btn')}
                          </button>
                        ) : (
                          <button style={{ flex: 1, padding: '9px 4px', fontSize: 12, color: 'var(--ok)', borderRight: '1px solid var(--line-soft)' }}
                            onClick={() => setConfirm({ action: 'reactivate', user: u, title: t('mobile.admin.users.reactivate_title', { username: u.username }), body: t('mobile.admin.users.reactivate_body') })}>
                            {t('mobile.admin.users.reactivate_btn')}
                          </button>
                        )}
                        <button style={{ flex: 1, padding: '9px 4px', fontSize: 12, color: 'var(--warn)', borderRight: '1px solid var(--line-soft)' }}
                          onClick={() => setConfirm({ action: 'force-logout', user: u, title: t('mobile.admin.users.force_logout_title', { username: u.username }), body: t('mobile.admin.users.force_logout_body') })}>
                          {t('mobile.admin.users.force_logout_btn')}
                        </button>
                        {!isAdmin ? (
                          <button style={{ flex: 1, padding: '9px 4px', fontSize: 12, color: 'var(--accent)' }}
                            onClick={() => setConfirm({ action: 'set-admin', user: u, title: t('mobile.admin.users.set_admin_title'), body: t('mobile.admin.users.set_admin_body', { username: u.username }) })}>
                            {t('mobile.admin.users.set_admin_btn')}
                          </button>
                        ) : (
                          <button style={{ flex: 1, padding: '9px 4px', fontSize: 12, color: 'var(--muted)' }}
                            onClick={() => setConfirm({ action: 'set-user', user: u, title: t('mobile.admin.users.demote_title'), body: t('mobile.admin.users.demote_body', { username: u.username }) })}>
                            {t('mobile.admin.users.demote_btn')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 分页 */}
          {!loading && !err && users.length > 0 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
              <button className="pl-btn-ghost" disabled={page <= 1} onClick={() => load(page - 1)} style={{ padding: '6px 16px', fontSize: 13 }}>{t('mobile.admin.prev_page')}</button>
              <span style={{ fontSize: 13, color: 'var(--muted)', lineHeight: '34px' }}>{t('mobile.admin.page_n', { n: page })}</span>
              <button className="pl-btn-ghost" disabled={users.length < LIMIT} onClick={() => load(page + 1)} style={{ padding: '6px 16px', fontSize: 13 }}>{t('mobile.admin.next_page')}</button>
            </div>
          )}
        </div>
      </div>

      {confirm && (
        <ConfirmSheet
          title={confirm.title} body={confirm.body}
          danger={['deactivate', 'force-logout', 'set-user'].includes(confirm.action)}
          busy={busy} onConfirm={doAction} onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}

/* ══════════════════════════════════════════
   Section: admin-usage
══════════════════════════════════════════ */
function SectionUsage({ nav }) {
  const { t } = useTranslation();
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [days, setDays] = React.useState(30);

  const load = React.useCallback(async () => {
    setLoading(true); setErr(null);
    try { const r = await window.api.admin.globalUsage({ days }); setData(r); }
    catch (e) { setErr(e?.message || t('mobile.admin.load_failed')); }
    finally { setLoading(false); }
  }, [days]);

  React.useEffect(() => { load(); }, [load]);

  const summary = data?.summary || {};
  const byUser = data?.by_user || [];
  const byDay = data?.by_day || [];
  const maxDay = byDay.reduce((m, d) => Math.max(m, d.tokens || 0), 1);

  return (
    <>
      <div className="pl-head">
        <button className="pl-headbtn" onClick={() => nav.go('admin')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title"><strong style={{ fontSize: 15 }}>{t('mobile.admin.section.usage')}</strong></div>
        <button className="pl-headbtn" onClick={load} disabled={loading}><Icon name="refresh" size={18} /></button>
      </div>
      <div className="pl-body tabbed">
        <div className="pl-pad">
          {/* 时间范围选择 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {[7, 14, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                style={{ padding: '4px 14px', borderRadius: 999, fontSize: 12, border: '1px solid', borderColor: days === d ? 'var(--accent-edge)' : 'var(--line)', background: days === d ? 'var(--accent-soft)' : 'var(--panel-2)', color: days === d ? 'var(--accent)' : 'var(--muted)' }}>
                {t('mobile.admin.usage.days', { count: d })}
              </button>
            ))}
          </div>

          {loading ? <LoadingRow /> : err ? <ErrRow msg={err} onRetry={load} /> : !data ? <EmptyRow /> : (
            <>
              {/* 汇总卡片 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
                {[
                  [t('mobile.admin.usage.requests'), (summary.total_requests || 0).toLocaleString()],
                  ['Tokens', (summary.total_tokens || 0).toLocaleString()],
                  [t('mobile.admin.usage.cost'), typeof summary.total_cost === 'number' ? `$${summary.total_cost.toFixed(3)}` : '—'],
                ].map(([k, v]) => (
                  <div key={k} style={{ border: '1px solid var(--line-soft)', borderRadius: 10, background: 'var(--panel)', padding: '10px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-serif)' }}>{v}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted-2)', marginTop: 2 }}>{k}</div>
                  </div>
                ))}
              </div>

              {/* 每日柱状 */}
              {byDay.length > 0 && (
                <div className="pl-sec">
                  <div className="pl-sec-head"><h2>{t('mobile.admin.usage.daily_tokens')}</h2></div>
                  <div style={{ display: 'grid', gap: 4 }}>
                    {byDay.slice(-14).map((d) => {
                      const pct = Math.max(2, Math.round((d.tokens || 0) / maxDay * 100));
                      return (
                        <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                          <span style={{ minWidth: 76, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>{d.date?.slice(5)}</span>
                          <div style={{ flex: 1, height: 12, background: 'var(--panel-3)', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--info)', borderRadius: 4 }} />
                          </div>
                          <span style={{ minWidth: 64, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-quiet)' }}>{(d.tokens || 0).toLocaleString()}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 按用户 */}
              {byUser.length > 0 && (
                <div className="pl-sec">
                  <div className="pl-sec-head"><h2>{t('mobile.admin.usage.top_users')}</h2></div>
                  {byUser.slice(0, 10).map((u, i) => (
                    <div key={u.user_id || i} className="pl-row" style={{ cursor: 'default' }}>
                      <span className="pl-row-ic info" style={{ width: 24, height: 24, fontSize: 11, fontFamily: 'var(--font-mono)', display: 'grid', placeItems: 'center' }}>{i + 1}</span>
                      <span className="pl-row-tx">
                        <strong style={{ fontSize: 13 }}>{u.username || u.user_id || '—'}</strong>
                        <span className="mono">{(u.tokens || 0).toLocaleString()} tokens {typeof u.cost === 'number' ? ` · $${u.cost.toFixed(3)}` : ''}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════
   Section: admin-audit
══════════════════════════════════════════ */
function SectionAudit({ nav }) {
  const { t } = useTranslation();
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [page, setPage] = React.useState(1);
  const [actionFilter, setActionFilter] = React.useState('');
  const LIMIT = 50;

  const load = React.useCallback(async (p = 1) => {
    setLoading(true); setErr(null);
    try {
      const params = { page: p, limit: LIMIT };
      if (actionFilter) params.action_prefix = actionFilter;
      const res = await window.api.admin.auditLog(params);
      setItems(res.items || res.logs || res || []);
      setPage(p);
    } catch (e) { setErr(e?.message || t('mobile.admin.load_failed')); }
    finally { setLoading(false); }
  }, [actionFilter]);

  React.useEffect(() => { load(1); }, [actionFilter]);

  return (
    <>
      <div className="pl-head">
        <button className="pl-headbtn" onClick={() => nav.go('admin')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title"><strong style={{ fontSize: 15 }}>{t('mobile.admin.section.audit')}</strong></div>
        <button className="pl-headbtn" onClick={() => load(page)} disabled={loading}><Icon name="refresh" size={18} /></button>
      </div>
      <div className="pl-body tabbed">
        <div className="pl-pad">
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {[['', t('common.all')], ['user', 'user.*'], ['config', 'config.*'], ['maintenance', 'maintenance.*'], ['invite', 'invite.*']].map(([v, l]) => (
              <button key={v} onClick={() => setActionFilter(v)}
                style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, border: '1px solid', borderColor: actionFilter === v ? 'var(--accent-edge)' : 'var(--line)', background: actionFilter === v ? 'var(--accent-soft)' : 'var(--panel-2)', color: actionFilter === v ? 'var(--accent)' : 'var(--muted)' }}>
                {l}
              </button>
            ))}
          </div>

          {loading ? <LoadingRow /> : err ? <ErrRow msg={err} onRetry={() => load(page)} /> : items.length === 0 ? <EmptyRow /> : (
            <div className="pl-sec">
              {items.map((item, i) => (
                <div key={item.id || i} style={{ padding: '10px 0', borderBottom: '1px solid var(--line-soft)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '2px 7px', borderRadius: 6, border: '1px solid var(--accent-edge)' }}>{item.action || '—'}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>{item.actor_username || item.actor_id || '—'}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--muted-3)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>{fmtTime(item.created_at)}</span>
                  </div>
                  {item.target_type && (
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', paddingLeft: 4 }}>{item.target_type}{item.target_id ? ` #${item.target_id}` : ''}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!loading && !err && items.length > 0 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
              <button className="pl-btn-ghost" disabled={page <= 1} onClick={() => load(page - 1)} style={{ padding: '6px 16px', fontSize: 13 }}>{t('mobile.admin.prev_page')}</button>
              <span style={{ fontSize: 13, color: 'var(--muted)', lineHeight: '34px' }}>{t('mobile.admin.page_n', { n: page })}</span>
              <button className="pl-btn-ghost" disabled={items.length < LIMIT} onClick={() => load(page + 1)} style={{ padding: '6px 16px', fontSize: 13 }}>{t('mobile.admin.next_page')}</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════
   Section: admin-health
══════════════════════════════════════════ */
function SectionHealth({ nav }) {
  const { t } = useTranslation();
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);

  const load = React.useCallback(async () => {
    setLoading(true); setErr(null);
    try { const r = await window.api.admin.health(); setData(r); }
    catch (e) { setErr(e?.message || t('mobile.admin.load_failed')); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const db = data?.database || data?.db || {};
  const mem = data?.memory || {};
  const disk = data?.disk || {};
  const proc = data?.process || data?.proc || {};

  const rows = data ? [
    { key: t('mobile.admin.health.database'), ok: db.ok !== false, val: db.ok !== false ? `online${typeof db.latency_ms === 'number' ? ` · ${db.latency_ms}ms` : ''}` : t('mobile.admin.health.offline'), icon: 'cpu' },
    { key: t('mobile.admin.health.memory'), ok: typeof mem.rss_mb === 'number', val: typeof mem.rss_mb === 'number' ? `RSS ${mem.rss_mb} MB` : '—', icon: 'layers' },
    { key: t('mobile.admin.health.disk'), ok: (disk.used_percent || 0) < 90, val: disk.used_percent != null ? t('mobile.admin.health.disk_used', { pct: disk.used_percent }) : '—', icon: 'folder' },
    { key: t('mobile.admin.health.process'), ok: !!proc.pid, val: proc.pid ? `PID ${proc.pid}${proc.uptime_s ? ` · ${Math.round(proc.uptime_s / 60)}min` : ''}` : '—', icon: 'plug' },
  ] : [];

  return (
    <>
      <div className="pl-head">
        <button className="pl-headbtn" onClick={() => nav.go('admin')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title"><strong style={{ fontSize: 15 }}>{t('mobile.admin.section.health')}</strong></div>
        <button className="pl-headbtn" onClick={load} disabled={loading}><Icon name="refresh" size={18} /></button>
      </div>
      <div className="pl-body tabbed">
        <div className="pl-pad">
          {loading && !data ? <LoadingRow /> : err ? <ErrRow msg={err} onRetry={load} /> : (
            <div className="pl-sec">
              {rows.map((r) => (
                <div key={r.key} className="pl-row" style={{ cursor: 'default' }}>
                  <span className={`pl-row-ic ${r.ok ? 'ok' : 'warn'}`}><Icon name={r.icon} size={17} /></span>
                  <span className="pl-row-tx">
                    <strong style={{ fontSize: 13.5 }}>{r.key}</strong>
                    <span className="mono">{r.val}</span>
                  </span>
                  <span style={{ fontSize: 11, color: r.ok ? 'var(--ok)' : 'var(--danger)', fontFamily: 'var(--font-mono)' }}>{r.ok ? 'OK' : 'FAIL'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════
   Section: admin-logs
══════════════════════════════════════════ */
function SectionLogs({ nav }) {
  const { t } = useTranslation();
  const [lines, setLines] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [lineCount, setLineCount] = React.useState(100);
  const [levelFilter, setLevelFilter] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true); setErr(null);
    try { const r = await window.api.admin.logs({ lines: lineCount }); setLines(r.lines || r || []); }
    catch (e) { setErr(e?.message || t('mobile.admin.load_failed')); }
    finally { setLoading(false); }
  }, [lineCount]);

  React.useEffect(() => { load(); }, [load]);

  const filtered = levelFilter ? lines.filter((l) => String(l).includes(levelFilter)) : lines;

  function lineColor(line) {
    const s = String(line);
    if (s.includes('ERROR')) return 'var(--danger)';
    if (s.includes('WARN')) return 'var(--warn)';
    return 'var(--text-quiet)';
  }

  return (
    <>
      <div className="pl-head">
        <button className="pl-headbtn" onClick={() => nav.go('admin')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title"><strong style={{ fontSize: 15 }}>{t('mobile.admin.section.logs')}</strong></div>
        <button className="pl-headbtn" onClick={load} disabled={loading}><Icon name="refresh" size={18} /></button>
      </div>
      <div className="pl-body tabbed">
        <div className="pl-pad">
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            {[50, 100, 200].map((n) => (
              <button key={n} onClick={() => setLineCount(n)}
                style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, border: '1px solid', borderColor: lineCount === n ? 'var(--accent-edge)' : 'var(--line)', background: lineCount === n ? 'var(--accent-soft)' : 'var(--panel-2)', color: lineCount === n ? 'var(--accent)' : 'var(--muted)' }}>
                {t('mobile.admin.logs.lines', { count: n })}
              </button>
            ))}
            {[['', t('common.all')], ['ERROR', 'ERROR'], ['WARN', 'WARN']].map(([v, l]) => (
              <button key={v} onClick={() => setLevelFilter(v)}
                style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, border: '1px solid', borderColor: levelFilter === v ? 'var(--accent-edge)' : 'var(--line)', background: levelFilter === v ? 'var(--accent-soft)' : 'var(--panel-2)', color: levelFilter === v ? 'var(--accent)' : 'var(--muted)' }}>
                {l}
              </button>
            ))}
          </div>

          {loading ? <LoadingRow /> : err ? <ErrRow msg={err} onRetry={load} /> : filtered.length === 0 ? <EmptyRow text={t('mobile.admin.logs.empty')} /> : (
            <div style={{ background: 'var(--bg-deep)', borderRadius: 10, border: '1px solid var(--line-soft)', padding: '10px 12px', maxHeight: '60vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
              {filtered.map((line, i) => (
                <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.7, color: lineColor(line), wordBreak: 'break-all' }}>{String(line)}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════
   Section: admin-registration
══════════════════════════════════════════ */
function SectionRegistration({ nav }) {
  const { t } = useTranslation();
  const [regConfig, setRegConfig] = React.useState(null);
  const [inviteCodes, setInviteCodes] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [showCreate, setShowCreate] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState(null);
  const [deleting, setDeleting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [reg, codes] = await Promise.all([window.api.admin.registration(), window.api.admin.inviteCodes()]);
      setRegConfig(reg);
      setInviteCodes(codes.items || codes.codes || codes || []);
    } catch (e) { setErr(e?.message || t('mobile.admin.load_failed')); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  async function saveReg(patch) {
    setSaving(true);
    try {
      const next = { ...regConfig, ...patch };
      await window.api.admin.saveRegistration(next);
      setRegConfig(next);
      nav.toast(t('mobile.admin.save_success'), 'ok');
    } catch (e) { nav.toast(t('mobile.admin.save_failed', { msg: e?.message || '' }), 'danger'); }
    finally { setSaving(false); }
  }

  async function handleCreate(vals) {
    setCreating(true);
    try {
      await window.api.admin.createInviteCodes({ count: Number(vals.count) || 1, expires_days: Number(vals.expires_days) || 30, note: vals.note || undefined });
      nav.toast(t('mobile.admin.registration.invite_created'), 'ok');
      setShowCreate(false);
      const codes = await window.api.admin.inviteCodes();
      setInviteCodes(codes.items || codes.codes || codes || []);
    } catch (e) { nav.toast(t('mobile.admin.registration.create_failed', { msg: e?.message || '' }), 'danger'); }
    finally { setCreating(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await window.api.admin.deleteInviteCode(deleteTarget);
      nav.toast(t('mobile.admin.deleted'), 'ok');
      setDeleteTarget(null);
      const codes = await window.api.admin.inviteCodes();
      setInviteCodes(codes.items || codes.codes || codes || []);
    } catch (e) { nav.toast(t('mobile.admin.delete_failed', { msg: e?.message || '' }), 'danger'); }
    finally { setDeleting(false); }
  }

  return (
    <>
      <div className="pl-head">
        <button className="pl-headbtn" onClick={() => nav.go('admin')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title"><strong style={{ fontSize: 15 }}>{t('mobile.admin.section.registration')}</strong></div>
        <button className="pl-headbtn" onClick={load} disabled={loading}><Icon name="refresh" size={18} /></button>
      </div>
      <div className="pl-body tabbed">
        <div className="pl-pad">
          {loading ? <LoadingRow /> : err ? <ErrRow msg={err} onRetry={load} /> : !regConfig ? <EmptyRow /> : (
            <>
              <div className="pl-sec">
                <div className="pl-sec-head"><h2>{t('mobile.admin.registration.mode_heading')}</h2></div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  {[['open', t('mobile.admin.registration.mode_open')], ['invite', t('mobile.admin.registration.mode_invite')], ['closed', t('mobile.admin.registration.mode_closed')]].map(([v, l]) => (
                    <button key={v}
                      onClick={() => saveReg({ mode: v })}
                      style={{ flex: 1, padding: '10px 4px', borderRadius: 10, fontSize: 13, fontWeight: regConfig.mode === v ? 600 : 400, border: '1px solid', borderColor: regConfig.mode === v ? 'var(--accent-edge)' : 'var(--line)', background: regConfig.mode === v ? 'var(--accent-soft)' : 'var(--panel-2)', color: regConfig.mode === v ? 'var(--accent)' : 'var(--muted)' }}>
                      {saving ? '…' : l}
                    </button>
                  ))}
                </div>

                {[
                  { key: 'email_verification', label: t('mobile.admin.registration.email_verification') },
                  { key: 'auto_approve', label: t('mobile.admin.registration.auto_approve') },
                ].map(({ key, label }) => (
                  <div key={key} className="pl-row" style={{ cursor: 'pointer' }} onClick={() => saveReg({ [key]: !regConfig[key] })}>
                    <span className={`pl-row-ic ${regConfig[key] ? 'ok' : ''}`}><Icon name={regConfig[key] ? 'check' : 'close'} size={17} /></span>
                    <span className="pl-row-tx"><strong style={{ fontSize: 13.5 }}>{label}</strong></span>
                    <span style={{ fontSize: 12, color: regConfig[key] ? 'var(--ok)' : 'var(--muted)' }}>{regConfig[key] ? t('mobile.admin.registration.on') : t('mobile.admin.registration.off')}</span>
                  </div>
                ))}
              </div>

              <div className="pl-sec">
                <div className="pl-sec-head"><h2>{t('mobile.admin.registration.invite_codes_heading', { count: inviteCodes.length })}</h2>
                  <button className="act" onClick={() => setShowCreate(true)}><Icon name="plus" size={13} /> {t('mobile.admin.registration.create_btn')}</button>
                </div>
                {inviteCodes.length === 0 ? <EmptyRow text={t('mobile.admin.registration.no_codes')} /> : inviteCodes.map((c) => (
                  <div key={c.code} className="pl-row" style={{ cursor: 'default' }}>
                    <span className="pl-row-ic info"><Icon name="key" size={17} /></span>
                    <span className="pl-row-tx">
                      <strong className="mono" style={{ fontSize: 13 }}>{c.code}</strong>
                      <span>{c.used ? t('mobile.admin.registration.code_used') : t('mobile.admin.registration.code_unused')}{c.expires_at ? ` · ${t('mobile.admin.registration.expires')} ${fmtDate(c.expires_at)}` : ''}{c.note ? ` · ${c.note}` : ''}</span>
                    </span>
                    {!c.used && <button style={{ fontSize: 12, color: 'var(--danger)', padding: '4px 8px' }} onClick={() => setDeleteTarget(c.code)}>{t('common.delete')}</button>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {showCreate && (
        <InputSheet
          title={t('mobile.admin.registration.create_sheet_title')}
          fields={[
            { key: 'count', label: t('mobile.admin.registration.field_count'), default: '1', type: 'number' },
            { key: 'expires_days', label: t('mobile.admin.registration.field_expires_days'), default: '30', type: 'number' },
            { key: 'note', label: t('mobile.admin.registration.field_note'), default: '' },
          ]}
          busy={creating}
          onConfirm={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      )}
      {deleteTarget && (
        <ConfirmSheet
          title={t('mobile.admin.registration.delete_code_title', { code: deleteTarget })} body={t('mobile.admin.registration.delete_code_body')}
          danger busy={deleting} onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}

/* ══════════════════════════════════════════
   Section: admin-security
══════════════════════════════════════════ */
function SectionSecurity({ nav }) {
  const { t } = useTranslation();
  const [draft, setDraft] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      try { const r = await window.api.admin.securityConfig(); if (!cancelled) setDraft(JSON.parse(JSON.stringify(r))); }
      catch (e) { if (!cancelled) setErr(e?.message || t('mobile.admin.load_failed')); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  function upd(path, val) {
    setDraft((d) => {
      const next = JSON.parse(JSON.stringify(d));
      const keys = path.split('.');
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) { if (!cur[keys[i]]) cur[keys[i]] = {}; cur = cur[keys[i]]; }
      cur[keys[keys.length - 1]] = val;
      return next;
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try { await window.api.admin.saveSecurityConfig(draft); nav.toast(t('mobile.admin.save_success'), 'ok'); }
    catch (e) { nav.toast(t('mobile.admin.save_failed', { msg: e?.message || '' }), 'danger'); }
    finally { setSaving(false); }
  }

  const d = draft || {};

  const numField = (label, path, placeholder) => (
    <div key={path}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <input type="number" value={String(d[path.split('.')[0]]?.[path.split('.')[1]] ?? '')}
        onChange={(e) => upd(path, Number(e.target.value))}
        placeholder={placeholder}
        style={{ width: '100%', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }}
      />
    </div>
  );

  return (
    <>
      <div className="pl-head">
        <button className="pl-headbtn" onClick={() => nav.go('admin')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title"><strong style={{ fontSize: 15 }}>{t('mobile.admin.section.security')}</strong></div>
      </div>
      <div className="pl-body tabbed">
        <div className="pl-pad">
          {loading ? <LoadingRow /> : err ? <ErrRow msg={err} /> : !draft ? <EmptyRow /> : (
            <>
              <div className="pl-sec">
                <div className="pl-sec-head"><h2>{t('mobile.admin.security.rate_limit_heading')}</h2></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {numField(t('mobile.admin.security.max_per_ip'), 'rate_limit.max_per_ip', '100')}
                  {numField(t('mobile.admin.security.max_per_user'), 'rate_limit.max_per_user', '50')}
                  {numField(t('mobile.admin.security.window_minutes'), 'rate_limit.window_minutes', '60')}
                </div>
              </div>

              <div className="pl-sec">
                <div className="pl-sec-head"><h2>{t('mobile.admin.security.password_heading')}</h2></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {numField(t('mobile.admin.security.min_length'), 'password.min_length', '8')}
                </div>
                <div className="pl-row" style={{ cursor: 'pointer', marginTop: 8 }} onClick={() => upd('password.require_digit', !d.password?.require_digit)}>
                  <span className={`pl-row-ic ${d.password?.require_digit ? 'ok' : ''}`}><Icon name={d.password?.require_digit ? 'check' : 'close'} size={17} /></span>
                  <span className="pl-row-tx"><strong style={{ fontSize: 13.5 }}>{t('mobile.admin.security.require_digit')}</strong></span>
                  <span style={{ fontSize: 12, color: d.password?.require_digit ? 'var(--ok)' : 'var(--muted)' }}>{d.password?.require_digit ? t('mobile.admin.yes') : t('mobile.admin.no')}</span>
                </div>
              </div>

              <div className="pl-sec">
                <div className="pl-sec-head"><h2>{t('mobile.admin.security.session_heading')}</h2></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {numField(t('mobile.admin.security.session_timeout'), 'session.timeout_days', '30')}
                  {numField(t('mobile.admin.security.max_attempts'), 'lockout.max_attempts', '5')}
                  {numField(t('mobile.admin.security.lockout_minutes'), 'lockout.lockout_minutes', '15')}
                </div>
              </div>

              <div className="pl-sec">
                <div className="pl-sec-head"><h2>{t('mobile.admin.security.ip_blocklist_heading')}</h2></div>
                <textarea
                  value={Array.isArray(d.ip_blocklist) ? d.ip_blocklist.join('\n') : (d.ip_blocklist || '')}
                  onChange={(e) => upd('ip_blocklist', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                  rows={4}
                  placeholder={t('mobile.admin.security.ip_blocklist_placeholder')}
                  style={{ width: '100%', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)', resize: 'vertical', boxSizing: 'border-box' }}
                />
              </div>

              <button className="pl-btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={save} disabled={saving}>
                {saving ? t('mobile.admin.saving') : t('mobile.admin.security.save_btn')}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════
   Section: admin-maintenance
══════════════════════════════════════════ */
function SectionMaintenance({ nav }) {
  const { t } = useTranslation();
  const [draft, setDraft] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [restartConfirm, setRestartConfirm] = React.useState(false);
  const [restarting, setRestarting] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      try { const r = await window.api.admin.maintenance(); if (!cancelled) setDraft(JSON.parse(JSON.stringify(r))); }
      catch (e) { if (!cancelled) setErr(e?.message || t('mobile.admin.load_failed')); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try { await window.api.admin.saveMaintenance(draft); nav.toast(t('mobile.admin.save_success'), 'ok'); }
    catch (e) { nav.toast(t('mobile.admin.save_failed', { msg: e?.message || '' }), 'danger'); }
    finally { setSaving(false); }
  }

  async function doRestart() {
    setRestarting(true);
    try { await window.api.admin.restart(); nav.toast(t('mobile.admin.maintenance.restart_sent'), 'ok'); setRestartConfirm(false); }
    catch (e) { nav.toast(t('mobile.admin.maintenance.restart_failed', { msg: e?.message || '' }), 'danger'); }
    finally { setRestarting(false); }
  }

  const d = draft || {};

  return (
    <>
      <div className="pl-head">
        <button className="pl-headbtn" onClick={() => nav.go('admin')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title"><strong style={{ fontSize: 15 }}>{t('mobile.admin.section.maintenance')}</strong></div>
      </div>
      <div className="pl-body tabbed">
        <div className="pl-pad">
          {loading ? <LoadingRow /> : err ? <ErrRow msg={err} /> : !draft ? <EmptyRow /> : (
            <>
              {d.enabled && (
                <div style={{ padding: '10px 13px', borderRadius: 10, background: 'var(--warn-soft)', border: '1px solid rgba(212,179,102,0.4)', fontSize: 13, color: 'var(--warn)', marginBottom: 12 }}>
                  {t('mobile.admin.maintenance.active_notice')}
                </div>
              )}
              <div className="pl-row" style={{ cursor: 'pointer' }} onClick={() => setDraft((prev) => ({ ...prev, enabled: !prev.enabled }))}>
                <span className={`pl-row-ic ${d.enabled ? 'warn' : ''}`}><Icon name={d.enabled ? 'lock' : 'unlock'} size={17} /></span>
                <span className="pl-row-tx"><strong style={{ fontSize: 13.5 }}>{t('mobile.admin.section.maintenance')}</strong></span>
                <span style={{ fontSize: 12, color: d.enabled ? 'var(--warn)' : 'var(--muted)' }}>{d.enabled ? t('mobile.admin.maintenance.on') : t('mobile.admin.maintenance.off')}</span>
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{t('mobile.admin.maintenance.message_label')}</div>
                <textarea
                  value={d.message || ''}
                  onChange={(e) => setDraft((prev) => ({ ...prev, message: e.target.value }))}
                  rows={3}
                  placeholder={t('mobile.admin.maintenance.message_placeholder')}
                  style={{ width: '100%', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
                />
              </div>

              {d.started_at && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>{t('mobile.admin.maintenance.started_at')}{fmtTime(d.started_at)}</div>}

              <button className="pl-btn-primary" style={{ width: '100%', marginTop: 14 }} onClick={save} disabled={saving}>
                {saving ? t('mobile.admin.saving') : t('mobile.admin.maintenance.save_btn')}
              </button>

              <div className="pl-sec" style={{ marginTop: 20 }}>
                <div className="pl-sec-head"><h2>{t('mobile.admin.maintenance.restart_heading')}</h2></div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>{t('mobile.admin.maintenance.restart_hint')}</div>
                <button style={{ width: '100%', padding: '11px', borderRadius: 12, background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.4)', color: 'var(--danger)', fontSize: 14, fontWeight: 500 }}
                  onClick={() => setRestartConfirm(true)}>
                  {t('mobile.admin.maintenance.restart_btn')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {restartConfirm && (
        <ConfirmSheet
          title={t('mobile.admin.maintenance.confirm_restart_title')} body={t('mobile.admin.maintenance.confirm_restart_body')}
          confirmLabel={t('mobile.admin.maintenance.confirm_restart_label')} danger busy={restarting}
          onConfirm={doRestart} onCancel={() => setRestartConfirm(false)}
        />
      )}
    </>
  );
}

/* ══════════════════════════════════════════
   Section: admin-dmca-takedowns
══════════════════════════════════════════ */
function SectionDmcaTakedowns({ nav }) {
  const { t } = useTranslation();
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [statusFilter, setStatusFilter] = React.useState('open');
  const [actionSheet, setActionSheet] = React.useState(null); // { item, action }
  const [actionBusy, setActionBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true); setErr(null);
    try { const r = await window.api.admin.dmcaTakedowns.list({ status: statusFilter }); setItems(r.takedowns || r || []); }
    catch (e) { setErr(e?.message || t('mobile.admin.load_failed')); }
    finally { setLoading(false); }
  }, [statusFilter]);

  React.useEffect(() => { load(); }, [load]);

  async function doAction(vals) {
    if (!actionSheet) return;
    setActionBusy(true);
    try {
      await window.api.admin.dmcaTakedowns.action(actionSheet.item.id, { action: actionSheet.action, reason: vals?.reason || '' });
      nav.toast(t('mobile.admin.action_success'), 'ok');
      setActionSheet(null);
      load();
    } catch (e) { nav.toast(t('mobile.admin.action_failed', { msg: e?.message || '' }), 'danger'); }
    finally { setActionBusy(false); }
  }

  const statusColor = { open: 'var(--danger)', counter_received: 'var(--info)', closed: 'var(--muted)', restored: 'var(--ok)', rejected: 'var(--muted)' };
  const statusLabel = {
    open: t('mobile.admin.dmca.status_open'),
    counter_received: t('mobile.admin.dmca.status_counter_received'),
    closed: t('mobile.admin.dmca.status_closed'),
    restored: t('mobile.admin.dmca.status_restored'),
    rejected: t('mobile.admin.dmca.status_rejected'),
  };

  return (
    <>
      <div className="pl-head">
        <button className="pl-headbtn" onClick={() => nav.go('admin')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title"><strong style={{ fontSize: 15 }}>{t('mobile.admin.section.dmca_takedowns')}</strong></div>
        <button className="pl-headbtn" onClick={load} disabled={loading}><Icon name="refresh" size={18} /></button>
      </div>
      <div className="pl-body tabbed">
        <div className="pl-pad">
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {Object.entries(statusLabel).concat([['all', t('common.all')]]).map(([v, l]) => (
              <button key={v} onClick={() => setStatusFilter(v)}
                style={{ padding: '4px 11px', borderRadius: 999, fontSize: 12, border: '1px solid', borderColor: statusFilter === v ? 'var(--accent-edge)' : 'var(--line)', background: statusFilter === v ? 'var(--accent-soft)' : 'var(--panel-2)', color: statusFilter === v ? 'var(--accent)' : 'var(--muted)' }}>
                {l}
              </button>
            ))}
          </div>

          {loading ? <LoadingRow /> : err ? <ErrRow msg={err} onRetry={load} /> : items.length === 0 ? <EmptyRow text={t('mobile.admin.no_records')} /> : (
            <div className="pl-sec">
              {items.map((item) => (
                <div key={item.id} style={{ border: '1px solid var(--line-soft)', borderRadius: 12, background: 'var(--panel)', marginBottom: 8, overflow: 'hidden' }}>
                  <div style={{ padding: '11px 13px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: statusColor[item.status] || 'var(--muted)' }}>{statusLabel[item.status] || item.status}</span>
                      <span style={{ fontSize: 10.5, color: 'var(--muted-3)', marginLeft: 'auto' }}>#{item.id} · {fmtDate(item.created_at)}</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-quiet)', marginBottom: 3 }}>{item.complainant_name || '—'}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.infringing_url || '—'}</div>
                  </div>
                  {item.status === 'open' && (
                    <div style={{ display: 'flex', borderTop: '1px solid var(--line-soft)' }}>
                      {['grant', 'reject'].map((action, i) => (
                        <button key={action}
                          style={{ flex: 1, padding: '9px 4px', fontSize: 12, color: action === 'grant' ? 'var(--ok)' : 'var(--danger)', borderRight: i === 0 ? '1px solid var(--line-soft)' : 'none' }}
                          onClick={() => setActionSheet({ item, action })}>
                          {action === 'grant' ? t('mobile.admin.dmca.grant_btn') : t('mobile.admin.dmca.reject_btn')}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {actionSheet && (
        <InputSheet
          title={actionSheet.action === 'grant' ? t('mobile.admin.dmca.grant_sheet_title') : t('mobile.admin.dmca.reject_sheet_title')}
          fields={[{ key: 'reason', label: t('mobile.admin.dmca.reason_label'), multiline: true, placeholder: t('mobile.admin.dmca.reason_placeholder') }]}
          busy={actionBusy}
          onConfirm={doAction}
          onCancel={() => setActionSheet(null)}
        />
      )}
    </>
  );
}

/* ══════════════════════════════════════════
   Section: admin-dmca-strikes
══════════════════════════════════════════ */
function SectionDmcaStrikes({ nav }) {
  const { t } = useTranslation();
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [incTarget, setIncTarget] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true); setErr(null);
    try { const r = await window.api.admin.dmcaStrikes.list(); setItems(r.strikes || r || []); }
    catch (e) { setErr(e?.message || t('mobile.admin.load_failed')); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  async function doIncrement(vals) {
    if (!incTarget) return;
    setBusy(true);
    try {
      await window.api.admin.dmcaStrikes.increment(incTarget.user_id, { reason: vals?.reason || '' });
      nav.toast(t('mobile.admin.strikes.added'), 'ok');
      setIncTarget(null);
      load();
    } catch (e) { nav.toast(t('mobile.admin.action_failed', { msg: e?.message || '' }), 'danger'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="pl-head">
        <button className="pl-headbtn" onClick={() => nav.go('admin')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title"><strong style={{ fontSize: 15 }}>{t('mobile.admin.strikes.title')}</strong></div>
        <button className="pl-headbtn" onClick={load} disabled={loading}><Icon name="refresh" size={18} /></button>
      </div>
      <div className="pl-body tabbed">
        <div className="pl-pad">
          {loading ? <LoadingRow /> : err ? <ErrRow msg={err} onRetry={load} /> : items.length === 0 ? <EmptyRow text={t('mobile.admin.strikes.empty')} /> : (
            <div className="pl-sec">
              {items.map((s) => (
                <div key={s.user_id} className="pl-row">
                  <span className="pl-row-ic warn"><Icon name="warn" size={17} /></span>
                  <span className="pl-row-tx">
                    <strong style={{ fontSize: 13 }}>{s.username || s.user_id}</strong>
                    <span className="mono">{t('mobile.admin.strikes.count', { count: s.strike_count || 0 })}</span>
                  </span>
                  <button style={{ fontSize: 12, color: 'var(--warn)', padding: '4px 8px' }} onClick={() => setIncTarget(s)}>{t('mobile.admin.strikes.add_btn')}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {incTarget && (
        <InputSheet
          title={t('mobile.admin.strikes.sheet_title', { username: incTarget.username || incTarget.user_id })}
          fields={[{ key: 'reason', label: t('mobile.admin.strikes.reason_label'), multiline: true, placeholder: t('mobile.admin.strikes.reason_placeholder') }]}
          busy={busy} onConfirm={doIncrement} onCancel={() => setIncTarget(null)}
        />
      )}
    </>
  );
}

/* ══════════════════════════════════════════
   Section: admin-csam-reports
══════════════════════════════════════════ */
function SectionCsamReports({ nav }) {
  const { t } = useTranslation();
  const [reports, setReports] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [statusFilter, setStatusFilter] = React.useState('pending');
  const [decideTarget, setDecideTarget] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true); setErr(null);
    try { const r = await window.api.admin.csamReports.list({ status: statusFilter }); setReports(r.reports || r || []); }
    catch (e) { setErr(e?.message || t('mobile.admin.load_failed')); }
    finally { setLoading(false); }
  }, [statusFilter]);

  React.useEffect(() => { load(); }, [load]);

  async function doDecide(vals) {
    if (!decideTarget || !vals.decision) return;
    setBusy(true);
    try {
      await window.api.admin.csamReports.decision(decideTarget.id, { decision: vals.decision, notes: vals.notes || '' });
      nav.toast(t('mobile.admin.processed'), 'ok');
      setDecideTarget(null);
      load();
    } catch (e) { nav.toast(t('mobile.admin.action_failed', { msg: e?.message || '' }), 'danger'); }
    finally { setBusy(false); }
  }

  const decisionColor = { founded: 'var(--danger)', escalate: 'var(--info)', unfounded: 'var(--muted)' };

  return (
    <>
      <div className="pl-head">
        <button className="pl-headbtn" onClick={() => nav.go('admin')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title"><strong style={{ fontSize: 15 }}>{t('mobile.admin.section.csam_reports')}</strong></div>
        <button className="pl-headbtn" onClick={load} disabled={loading}><Icon name="refresh" size={18} /></button>
      </div>
      <div className="pl-body tabbed">
        <div className="pl-pad">
          <div style={{ padding: '10px 13px', borderRadius: 10, background: 'var(--warn-soft)', border: '1px solid rgba(212,179,102,0.4)', fontSize: 12.5, color: 'var(--warn)', marginBottom: 12 }}>
            {t('mobile.admin.csam.review_notice')}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {[['pending', t('mobile.admin.csam.status_pending')], ['decided', t('mobile.admin.csam.status_decided')], ['all', t('common.all')]].map(([v, l]) => (
              <button key={v} onClick={() => setStatusFilter(v)}
                style={{ flex: 1, padding: '7px 4px', borderRadius: 999, fontSize: 12, border: '1px solid', borderColor: statusFilter === v ? 'var(--accent-edge)' : 'var(--line)', background: statusFilter === v ? 'var(--accent-soft)' : 'var(--panel-2)', color: statusFilter === v ? 'var(--accent)' : 'var(--muted)' }}>
                {l}
              </button>
            ))}
          </div>

          {loading ? <LoadingRow /> : err ? <ErrRow msg={err} onRetry={load} /> : reports.length === 0 ? <EmptyRow text={t('mobile.admin.csam.empty')} /> : (
            <div className="pl-sec">
              {reports.map((r) => (
                <div key={r.id} style={{ border: '1px solid var(--line-soft)', borderRadius: 12, background: 'var(--panel)', marginBottom: 8, overflow: 'hidden' }}>
                  <div style={{ padding: '11px 13px' }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: r.status === 'pending' ? 'var(--danger)' : 'var(--muted)' }}>{r.status === 'pending' ? t('mobile.admin.csam.status_pending') : t('mobile.admin.csam.status_decided')}</span>
                      {r.decision && <span style={{ fontSize: 11, color: decisionColor[r.decision] || 'var(--muted)' }}>{r.decision}</span>}
                      <span style={{ fontSize: 10.5, color: 'var(--muted-3)', marginLeft: 'auto' }}>#{r.id}</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-quiet)' }}>{t('mobile.admin.csam.reported_user')}{r.reported_username || `uid:${r.reported_user_id}`}</div>
                    {r.cybertip_report_id && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>CyberTip: {r.cybertip_report_id}</div>}
                  </div>
                  {r.status === 'pending' && (
                    <button style={{ width: '100%', padding: '9px', fontSize: 12.5, color: 'var(--info)', borderTop: '1px solid var(--line-soft)' }}
                      onClick={() => setDecideTarget(r)}>
                      {t('mobile.admin.csam.decide_btn')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {decideTarget && (
        <InputSheet
          title={t('mobile.admin.csam.decide_sheet_title', { id: decideTarget.id })}
          fields={[
            { key: 'decision', label: t('mobile.admin.csam.decision_label'), placeholder: 'founded' },
            { key: 'notes', label: t('mobile.admin.csam.notes_label'), multiline: true, placeholder: t('mobile.admin.csam.notes_placeholder') },
          ]}
          busy={busy} onConfirm={doDecide} onCancel={() => setDecideTarget(null)}
        />
      )}
    </>
  );
}

/* ══════════════════════════════════════════
   Section: admin-aup-actions
══════════════════════════════════════════ */
function SectionAupActions({ nav }) {
  const { t } = useTranslation();
  const [search, setSearch] = React.useState('');
  const [users, setUsers] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [sheet, setSheet] = React.useState(null); // { action, user }
  const [busy, setBusy] = React.useState(false);

  async function doSearch() {
    if (!search.trim()) return;
    setLoading(true); setErr(null);
    try { const r = await window.api.admin.users({ search, limit: 20 }); setUsers(r.users || []); }
    catch (e) { setErr(e?.message || t('mobile.admin.search_failed')); }
    finally { setLoading(false); }
  }

  async function doAction(vals) {
    if (!sheet) return;
    setBusy(true);
    try {
      const { action, user } = sheet;
      if (action === 'suspend') await window.api.admin.suspendUser(user.id, { reason: vals?.reason || '', duration_days: vals?.duration_days ? Number(vals.duration_days) : undefined });
      else if (action === 'unsuspend') await window.api.admin.unsuspendUser(user.id);
      else if (action === 'terminate') await window.api.admin.terminateUser(user.id, { reason: vals?.reason || '' });
      nav.toast(t('mobile.admin.action_success'), 'ok');
      setSheet(null);
      doSearch();
    } catch (e) { nav.toast(t('mobile.admin.action_failed', { msg: e?.message || '' }), 'danger'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="pl-head">
        <button className="pl-headbtn" onClick={() => nav.go('admin')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title"><strong style={{ fontSize: 15 }}>{t('mobile.admin.section.aup_actions')}</strong></div>
      </div>
      <div className="pl-body tabbed">
        <div className="pl-pad">
          <div style={{ padding: '10px 13px', borderRadius: 10, background: 'var(--info-soft)', border: '1px solid rgba(122,166,194,0.3)', fontSize: 12.5, color: 'var(--info)', marginBottom: 12 }}>
            {t('mobile.admin.aup.notice')}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              type="search" placeholder={t('mobile.admin.users.search_placeholder')} value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }}
              style={{ flex: 1, background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit' }}
            />
            <button className="pl-btn-primary" style={{ padding: '0 14px', height: 38 }} onClick={doSearch} disabled={loading}>{t('mobile.admin.search')}</button>
          </div>

          {loading ? <LoadingRow /> : err ? <ErrRow msg={err} /> : users.length === 0 ? null : (
            <div className="pl-sec">
              {users.map((u) => (
                <div key={u.id} style={{ border: '1px solid var(--line-soft)', borderRadius: 12, background: 'var(--panel)', marginBottom: 8, overflow: 'hidden' }}>
                  <div style={{ padding: '11px 13px' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>@{u.username}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 2 }}>
                      {u.deactivated_at ? <span style={{ color: 'var(--danger)' }}>{t('mobile.admin.users.status_deactivated')}</span> : <span style={{ color: 'var(--ok)' }}>{t('mobile.admin.users.status_active')}</span>}
                      {u.ban_reason && <span> · {u.ban_reason}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', borderTop: '1px solid var(--line-soft)' }}>
                    {!u.deactivated_at ? (
                      <button style={{ flex: 1, padding: '9px 4px', fontSize: 12, color: 'var(--warn)', borderRight: '1px solid var(--line-soft)' }}
                        onClick={() => setSheet({ action: 'suspend', user: u })}>{t('mobile.admin.aup.suspend_btn')}</button>
                    ) : (
                      <button style={{ flex: 1, padding: '9px 4px', fontSize: 12, color: 'var(--ok)', borderRight: '1px solid var(--line-soft)' }}
                        onClick={() => setSheet({ action: 'unsuspend', user: u })}>{t('mobile.admin.aup.unsuspend_btn')}</button>
                    )}
                    <button style={{ flex: 1, padding: '9px 4px', fontSize: 12, color: 'var(--danger)' }}
                      onClick={() => setSheet({ action: 'terminate', user: u })}>{t('mobile.admin.aup.terminate_btn')}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {sheet?.action === 'suspend' && (
        <InputSheet
          title={t('mobile.admin.aup.suspend_sheet_title', { username: sheet.user.username })}
          fields={[
            { key: 'reason', label: t('mobile.admin.aup.reason_label'), multiline: true, placeholder: t('mobile.admin.aup.suspend_reason_placeholder') },
            { key: 'duration_days', label: t('mobile.admin.aup.duration_label'), type: 'number', placeholder: t('mobile.admin.aup.duration_placeholder') },
          ]}
          busy={busy} onConfirm={doAction} onCancel={() => setSheet(null)}
        />
      )}
      {sheet?.action === 'unsuspend' && (
        <ConfirmSheet
          title={t('mobile.admin.aup.unsuspend_sheet_title', { username: sheet.user.username })} body={t('mobile.admin.aup.unsuspend_body')}
          busy={busy} onConfirm={() => doAction({})} onCancel={() => setSheet(null)}
        />
      )}
      {sheet?.action === 'terminate' && (
        <InputSheet
          title={t('mobile.admin.aup.terminate_sheet_title', { username: sheet.user.username })}
          fields={[{ key: 'reason', label: t('mobile.admin.aup.terminate_reason_label'), multiline: true, placeholder: t('mobile.admin.aup.terminate_reason_placeholder') }]}
          busy={busy} onConfirm={doAction} onCancel={() => setSheet(null)}
        />
      )}
    </>
  );
}

/* ══════════════════════════════════════════
   Section: admin-feedback
══════════════════════════════════════════ */
function SectionFeedback({ nav }) {
  const { t } = useTranslation();
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [statusFilter, setStatusFilter] = React.useState('unreviewed');
  const [detail, setDetail] = React.useState(null);
  const [replyText, setReplyText] = React.useState('');
  const [actionBusy, setActionBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/admin/feedback?status=${encodeURIComponent(statusFilter)}&limit=50`, { credentials: 'include' });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.detail || data.error || `HTTP ${r.status}`);
      setItems(data.items || []);
    } catch (e) { setErr(e?.message || t('mobile.admin.load_failed')); }
    finally { setLoading(false); }
  }, [statusFilter]);

  React.useEffect(() => { load(); }, [load]);

  async function doDecision(id, decision, notes = '') {
    setActionBusy(true);
    try {
      const r = await fetch(`/api/admin/feedback/${id}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ decision, notes }) });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.detail || data.error || `HTTP ${r.status}`);
      nav.toast(t('mobile.admin.processed'), 'ok');
      setDetail(null);
      load();
    } catch (e) { nav.toast(t('mobile.admin.action_failed', { msg: e?.message || '' }), 'danger'); }
    finally { setActionBusy(false); }
  }

  async function doReply(id, reply) {
    setActionBusy(true);
    try {
      const r = await fetch(`/api/admin/feedback/${id}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ reply }) });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.detail || data.error || `HTTP ${r.status}`);
      nav.toast(reply ? t('mobile.admin.feedback.reply_sent') : t('mobile.admin.feedback.reply_withdrawn'), 'ok');
      setDetail((d) => d ? { ...d, admin_reply: reply || null } : d);
    } catch (e) { nav.toast(t('mobile.admin.feedback.reply_failed', { msg: e?.message || '' }), 'danger'); }
    finally { setActionBusy(false); }
  }

  const decisionColor = { ok: 'var(--ok)', nsfw_terminate: 'var(--danger)', spam: 'var(--warn)' };
  const decisionLabel = { ok: 'OK', nsfw_terminate: t('mobile.admin.feedback.decision_terminate'), spam: t('mobile.admin.feedback.decision_spam') };

  return (
    <>
      <div className="pl-head">
        <button className="pl-headbtn" onClick={detail ? () => setDetail(null) : () => nav.go('admin')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title"><strong style={{ fontSize: 15 }}>{detail ? t('mobile.admin.feedback.detail_title', { id: detail.id }) : t('mobile.admin.section.feedback')}</strong></div>
        {!detail && <button className="pl-headbtn" onClick={load} disabled={loading}><Icon name="refresh" size={18} /></button>}
      </div>

      {detail ? (
        /* 详情页 */
        <div className="pl-body tabbed">
          <div className="pl-pad">
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>{t('mobile.admin.feedback.submitter_label')}</div>
              <div style={{ fontSize: 13.5, color: 'var(--text)' }}>@{detail.username || '—'} · {fmtTime(detail.created_at)}</div>
              {detail.review_decision && (
                <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--panel-3)', color: decisionColor[detail.review_decision] || 'var(--muted)' }}>
                  {decisionLabel[detail.review_decision] || detail.review_decision}
                </span>
              )}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>{t('mobile.admin.feedback.content_label')}</div>
              <div style={{ background: 'var(--panel-2)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, lineHeight: 1.7, color: 'var(--text-quiet)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {detail.free_text || t('mobile.admin.feedback.no_content')}
              </div>
            </div>

            {/* 回复 */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>{t('mobile.admin.feedback.reply_label')}</div>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={3}
                placeholder={t('mobile.admin.feedback.reply_placeholder')}
                style={{ width: '100%', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
              />
              <button className="pl-btn-ghost" style={{ marginTop: 8, fontSize: 13 }} onClick={() => doReply(detail.id, replyText.trim())} disabled={actionBusy}>
                {detail.admin_reply ? t('mobile.admin.feedback.update_reply') : t('mobile.admin.feedback.send_reply')}
              </button>
            </div>

            {/* 审核操作 */}
            {!detail.review_decision && (
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>{t('mobile.admin.feedback.review_heading')}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="pl-btn-ghost" style={{ flex: 1, fontSize: 13 }} onClick={() => doDecision(detail.id, 'spam')} disabled={actionBusy}>{t('mobile.admin.feedback.decision_spam')}</button>
                  <button className="pl-btn-primary" style={{ flex: 1, fontSize: 13 }} onClick={() => doDecision(detail.id, 'ok')} disabled={actionBusy}>{t('mobile.admin.feedback.mark_ok')}</button>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '12px 0 6px' }}>{t('mobile.admin.feedback.terminate_notice')}</div>
                <button style={{ width: '100%', padding: '10px', borderRadius: 12, background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.4)', color: 'var(--danger)', fontSize: 13 }}
                  onClick={() => { const reason = window.prompt(t('mobile.admin.feedback.terminate_prompt')); if (reason) doDecision(detail.id, 'nsfw_terminate', reason); }}>
                  {t('mobile.admin.feedback.terminate_btn')}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* 列表 */
        <div className="pl-body tabbed">
          <div className="pl-pad">
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {[['unreviewed', t('mobile.admin.feedback.status_unreviewed')], ['reviewed', t('mobile.admin.feedback.status_reviewed')], ['all', t('common.all')]].map(([v, l]) => (
                <button key={v} onClick={() => setStatusFilter(v)}
                  style={{ flex: 1, padding: '7px 4px', borderRadius: 999, fontSize: 12, border: '1px solid', borderColor: statusFilter === v ? 'var(--accent-edge)' : 'var(--line)', background: statusFilter === v ? 'var(--accent-soft)' : 'var(--panel-2)', color: statusFilter === v ? 'var(--accent)' : 'var(--muted)' }}>
                  {l}
                </button>
              ))}
            </div>

            {loading ? <LoadingRow /> : err ? <ErrRow msg={err} onRetry={load} /> : items.length === 0 ? <EmptyRow text={t('mobile.admin.feedback.empty')} /> : (
              <div className="pl-sec">
                {items.map((f) => (
                  <button key={f.id} className="pl-row" onClick={() => { setDetail(f); setReplyText(f.admin_reply || ''); }}>
                    <span className={`pl-row-ic ${!f.review_decision ? 'warn' : 'ok'}`}><Icon name="feedback" size={17} /></span>
                    <span className="pl-row-tx">
                      <strong style={{ fontSize: 13 }}>@{f.username || '—'} <span className="mono" style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--muted-2)' }}>#{f.id}</span></strong>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(f.free_text || '').slice(0, 60) || t('mobile.admin.feedback.no_content_short')}</span>
                    </span>
                    <span className="pl-row-chev"><Icon name="chevron_right" size={17} /></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ══════════════════════════════════════════
   Section: admin-achievements
══════════════════════════════════════════ */
function SectionAchievements({ nav }) {
  const { t } = useTranslation();
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [disableTarget, setDisableTarget] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true); setErr(null);
    try { const r = await window.api.admin.achievements.list(); setItems(r.items || r || []); }
    catch (e) { setErr(e?.message || t('mobile.admin.load_failed')); }
    finally { setLoading(false); }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  async function doDisable() {
    if (!disableTarget) return;
    setBusy(true);
    try {
      await window.api.admin.achievements.remove(disableTarget.id);
      nav.toast(t('mobile.admin.achievements.disabled'), 'ok');
      setDisableTarget(null);
      load();
    } catch (e) { nav.toast(t('mobile.admin.action_failed', { msg: e?.message || '' }), 'danger'); }
    finally { setBusy(false); }
  }

  const tierColor = { bronze: '#cd7f32', silver: '#a8a9ad', gold: '#ffd700' };

  return (
    <>
      <div className="pl-head">
        <button className="pl-headbtn" onClick={() => nav.go('admin')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title"><strong style={{ fontSize: 15 }}>{t('mobile.admin.section.achievements')}</strong><span className="sub">{items.length > 0 ? t('mobile.admin.achievements.count', { count: items.length }) : ''}</span></div>
        <button className="pl-headbtn" onClick={load} disabled={loading}><Icon name="refresh" size={18} /></button>
      </div>
      <div className="pl-body tabbed">
        <div className="pl-pad">
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{t('mobile.admin.achievements.hint')}</div>

          {loading ? <LoadingRow /> : err ? <ErrRow msg={err} onRetry={load} /> : items.length === 0 ? <EmptyRow text={t('mobile.admin.achievements.empty')} /> : (
            <div className="pl-sec">
              {items.map((a) => (
                <div key={a.id} className="pl-row" style={{ cursor: 'default' }}>
                  <span style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', fontSize: 20, flex: 'none' }}>{a.icon || '🏆'}</span>
                  <span className="pl-row-tx">
                    <strong style={{ fontSize: 13 }}>
                      {a.name}
                      {a.tier && <span style={{ fontSize: 10, marginLeft: 6, color: tierColor[a.tier] || 'var(--muted)' }}>{a.tier}</span>}
                    </strong>
                    <span className="mono">{a.id} · {a.category}{a.hidden ? ` · ${t('mobile.admin.achievements.hidden')}` : ''} · {a.enabled ? <span style={{ color: 'var(--ok)' }}>{t('common.enabled')}</span> : <span style={{ color: 'var(--muted)' }}>{t('common.disabled')}</span>}</span>
                  </span>
                  {a.enabled && (
                    <button style={{ fontSize: 12, color: 'var(--danger)', padding: '4px 8px', flex: 'none' }} onClick={() => setDisableTarget(a)}>{t('mobile.admin.achievements.disable_btn')}</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {disableTarget && (
        <ConfirmSheet
          title={t('mobile.admin.achievements.disable_title', { name: disableTarget.name })}
          body={t('mobile.admin.achievements.disable_body')}
          confirmLabel={t('mobile.admin.achievements.disable_confirm')} danger
          busy={busy} onConfirm={doDisable} onCancel={() => setDisableTarget(null)}
        />
      )}
    </>
  );
}

/* ══════════════════════════════════════════
   Section: admin-deploy
══════════════════════════════════════════ */
function SectionDeploy({ nav }) {
  const { t } = useTranslation();
  const [config, setConfig] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [testingSmtp, setTestingSmtp] = React.useState(false);
  const [draft, setDraft] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const r = await window.api.admin.deploymentConfig();
        if (!cancelled) { setConfig(r); setDraft(JSON.parse(JSON.stringify(r))); }
      } catch (e) { if (!cancelled) setErr(e?.message || t('mobile.admin.load_failed')); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  function upd(key, val) {
    setDraft((d) => ({ ...d, [key]: val }));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try { await window.api.admin.saveDeploymentConfig(draft); setConfig(draft); nav.toast(t('mobile.admin.save_success'), 'ok'); }
    catch (e) { nav.toast(t('mobile.admin.save_failed', { msg: e?.message || '' }), 'danger'); }
    finally { setSaving(false); }
  }

  async function testSmtp() {
    setTestingSmtp(true);
    try { await window.api.admin.smtpTest(); nav.toast(t('mobile.admin.deploy.smtp_test_sent'), 'ok'); }
    catch (e) { nav.toast(t('mobile.admin.deploy.smtp_test_failed', { msg: e?.message || '' }), 'danger'); }
    finally { setTestingSmtp(false); }
  }

  const d = draft || {};

  const textField = (label, key, placeholder, type = 'text') => (
    <div key={key}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <input type={type} value={d[key] || ''} onChange={(e) => upd(key, e.target.value)} placeholder={placeholder || ''}
        style={{ width: '100%', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }} />
    </div>
  );

  return (
    <>
      <div className="pl-head">
        <button className="pl-headbtn" onClick={() => nav.go('admin')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title"><strong style={{ fontSize: 15 }}>{t('mobile.admin.section.deploy')}</strong></div>
      </div>
      <div className="pl-body tabbed">
        <div className="pl-pad">
          <div style={{ fontSize: 12, color: 'var(--warn)', background: 'var(--warn-soft)', border: '1px solid rgba(212,179,102,0.4)', borderRadius: 10, padding: '10px 13px', marginBottom: 14 }}>
            {t('mobile.admin.deploy.simplified_notice')}
          </div>

          {loading ? <LoadingRow /> : err ? <ErrRow msg={err} /> : !draft ? <EmptyRow /> : (
            <>
              <div className="pl-sec">
                <div className="pl-sec-head"><h2>{t('mobile.admin.deploy.basic_heading')}</h2></div>
                <div style={{ display: 'grid', gap: 12 }}>
                  {textField(t('mobile.admin.deploy.site_name'), 'site_name', 'RPG Roleplay')}
                  {textField(t('mobile.admin.deploy.site_url'), 'site_url', 'https://example.com')}
                  {textField(t('mobile.admin.deploy.contact_email'), 'contact_email', 'admin@example.com', 'email')}
                </div>
              </div>

              <div className="pl-sec" style={{ marginTop: 16 }}>
                <div className="pl-sec-head"><h2>{t('mobile.admin.deploy.smtp_heading')}</h2></div>
                <div style={{ display: 'grid', gap: 12 }}>
                  {textField('SMTP Host', 'smtp_host', 'smtp.example.com')}
                  {textField('SMTP Port', 'smtp_port', '587', 'number')}
                  {textField('SMTP User', 'smtp_user', 'user@example.com')}
                  {textField('SMTP Password', 'smtp_password', '••••••••', 'password')}
                </div>
                <button className="pl-btn-ghost" style={{ marginTop: 10, fontSize: 13 }} onClick={testSmtp} disabled={testingSmtp}>
                  {testingSmtp ? t('mobile.admin.deploy.smtp_sending') : t('mobile.admin.deploy.smtp_test_btn')}
                </button>
              </div>

              <button className="pl-btn-primary" style={{ width: '100%', marginTop: 18 }} onClick={save} disabled={saving}>
                {saving ? t('mobile.admin.saving') : t('mobile.admin.deploy.save_btn')}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════
   主入口
══════════════════════════════════════════ */
export function MobileAdmin({ nav }) {
  const page = nav.page || 'admin';

  switch (page) {
    case 'admin-users':       return <SectionUsers nav={nav} />;
    case 'admin-usage':       return <SectionUsage nav={nav} />;
    case 'admin-audit':       return <SectionAudit nav={nav} />;
    case 'admin-health':      return <SectionHealth nav={nav} />;
    case 'admin-logs':        return <SectionLogs nav={nav} />;
    case 'admin-registration': return <SectionRegistration nav={nav} />;
    case 'admin-security':    return <SectionSecurity nav={nav} />;
    case 'admin-maintenance': return <SectionMaintenance nav={nav} />;
    case 'admin-dmca-takedowns': return <SectionDmcaTakedowns nav={nav} />;
    case 'admin-dmca-strikes': return <SectionDmcaStrikes nav={nav} />;
    case 'admin-csam-reports': return <SectionCsamReports nav={nav} />;
    case 'admin-aup-actions': return <SectionAupActions nav={nav} />;
    case 'admin-feedback':    return <SectionFeedback nav={nav} />;
    case 'admin-achievements': return <SectionAchievements nav={nav} />;
    case 'admin-deploy':      return <SectionDeploy nav={nav} />;
    default:                  return <AdminMenu nav={nav} />;
  }
}

export default MobileAdmin;
