/**
 * MobileCaps.jsx — 能力与反馈(移动原生 UI)
 * 覆盖路由: plugins / mcp / skills / apis / feedback
 * 铁律:零 Cloudscape / 零电脑端组件复用。数据层全接 window.api.*。
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../icons.jsx';
import { Sheet } from '../Sheet.jsx';
import { sha256hex } from '../../lib/crypto-safe.js';
import { feedbackDecisionLabel } from '../../lib/feedback.js';

/* ──────────────────────────────────────────────────────────────────
   Constants
   ────────────────────────────────────────────────────────────────── */
const TABS = [
  { id: 'plugins', labelKey: 'mobile.caps.tab.plugins', icon: 'plug'    },
  { id: 'mcp',     labelKey: 'mobile.caps.tab.mcp',     icon: 'diamond' },
  { id: 'skills',  labelKey: 'mobile.caps.tab.skills',  icon: 'spark'   },
  { id: 'apis',    labelKey: 'mobile.caps.tab.apis',    icon: 'braces'  },
  { id: 'feedback',labelKey: 'mobile.caps.tab.feedback',icon: 'feedback'},
];

const CONSENT_TEXT = '我已阅读 AUP §2.J,理解不得包含成人主题节选,同意(此操作记录我的同意)';
const AUP_LINK = 'https://play.stellatrix.icu/legal/aup#2J';
const MAX_FREE_TEXT = 10000;
const QQ_GROUP_NUMBER = '584876566';
const QQ_JOIN_URL = 'https://qm.qq.com/q/49Dqcr0aw0';

/* ──────────────────────────────────────────────────────────────────
   Shared micro-components
   ────────────────────────────────────────────────────────────────── */
function Toggle({ on, onChange, disabled }) {
  return (
    <button
      className={'pl-toggle' + (on ? ' on' : '')}
      onClick={() => !disabled && onChange(!on)}
      role="switch"
      aria-checked={on}
      style={disabled ? { opacity: 0.45, pointerEvents: 'none' } : undefined}
    />
  );
}

function StatusPill({ on, label }) {
  const color = on ? 'ok' : '';
  return (
    <span className={`pill ${color}`} style={{ fontSize: 11 }}>
      <span className={`dot ${color}`} /> {label}
    </span>
  );
}

/* Bottom Sheet(新增/编辑表单)收口到 mobile/Sheet.jsx 的 <Sheet>(语义统一 Batch 6b)。
   通用底抽屉超集:grip + scrim 点关 + title/hint + children body。调用点保留原 zIndex=70/
   maxHeight=88% 以保视觉 1:1。 */

/* Text input field wrapper */
// 语义统一 #36(保留):此 MField 的 desc 用内联 11px/line-height 1.5 的 <span>,与
// mobile/Field.jsx 的 .desc(11.5px/1.55)显示不同 → 强迁会改字号/行高,刻意保留本地实现。
function MField({ label, desc, children }) {
  return (
    <div className="pl-field">
      <label style={{ fontSize: 12.5, color: 'var(--text-quiet)', fontWeight: 500 }}>{label}</label>
      {desc && <span style={{ fontSize: 11, color: 'var(--muted-2)', lineHeight: 1.5 }}>{desc}</span>}
      {children}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   PLUGINS
   ────────────────────────────────────────────────────────────────── */
function PluginsSection({ toast }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await window.api.tools.list();
      const tl = (r && r.tools) || {};
      setItems((tl.plugins || []).map(p => ({
        id: p.id || p.name,
        name: p.name || p.id,
        desc: p.description || t('mobile.caps.plugins.builtin_desc'),
        tag: p.kind || 'plugin',
        on: p.enabled !== false,
      })));
    } catch (e) {
      setErr(e?.message || t('mobile.caps.error.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  if (loading && items.length === 0) return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>{t('common.loading')}</div>
  );
  if (err) return (
    <div style={{ margin: '16px', padding: '12px 14px', borderRadius: 12, background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.3)', color: 'var(--danger)', fontSize: 13 }}>
      {err}
      <button className="pl-btn-ghost" style={{ marginTop: 10, height: 38 }} onClick={load}>{t('mobile.caps.error.retry')}</button>
    </div>
  );
  if (items.length === 0) return (
    <div className="pl-empty">
      <div className="ic"><Icon name="plug" size={22} /></div>
      <h3>{t('mobile.caps.plugins.empty_title')}</h3>
      <p>{t('mobile.caps.plugins.empty_desc')}</p>
    </div>
  );

  return (
    <div className="pl-pad">
      <div className="pl-sec-head" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>{t('mobile.caps.tab.plugins')}</h2>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('mobile.caps.plugins.count', { total: items.length, enabled: items.filter(i => i.on).length })}</span>
      </div>
      <div style={{ display: 'grid', gap: 9 }}>
        {items.map((it) => (
          <div key={it.id} style={{ border: '1px solid var(--line-soft)', borderRadius: 14, background: 'var(--panel)', padding: '13px 14px', display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="pl-row-ic" style={{ width: 36, height: 36, borderRadius: 10 }}>
                <Icon name="plug" size={16} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted-2)' }}>{it.tag}</div>
              </div>
              <Toggle on={it.on} onChange={() => toast(t('mobile.caps.plugins.managed_by_platform'), 'warn')} />
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>{it.desc}</div>
            <StatusPill on={it.on} label={it.on ? t('common.enabled') : t('common.disabled')} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   MCP
   ────────────────────────────────────────────────────────────────── */
function McpSection({ toast }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ name: '', transport: 'stdio', command: '', env: '' });
  const [formBusy, setFormBusy] = useState(false);
  const tick = useRef(0);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [toolsRes, rtRes] = await Promise.all([
        window.api.tools.list(),
        window.api.mcp.runtime().catch(() => null),
      ]);
      const tl = (toolsRes && toolsRes.tools) || {};
      const servers = ((tl.mcp || {}).servers) || [];
      const running = (rtRes && (rtRes.running || [])) || [];
      const runSet = new Set(running.map(r => r.id || r.server_id || r.name));
      setItems(servers.map(s => {
        const isOn = !!s.enabled;
        const isRunning = isOn && (runSet.has(s.id) || runSet.has(s.server_id) || runSet.has(s.name));
        return {
          id: s.id || s.server_id || s.name,
          name: s.name || s.id,
          desc: s.description || (s.transport === 'http' ? `HTTP · ${s.url || s.endpoint || '—'}` : `stdio · ${s.command || '—'}`),
          tag: s.transport || (s.url || s.endpoint ? 'http' : 'stdio'),
          on: isOn,
          status: isRunning ? t('mobile.caps.mcp.status.connected') : (isOn ? t('mobile.caps.mcp.status.disconnected') : t('common.disabled')),
          _raw: s,
        };
      }));
    } catch (e) {
      setErr(e?.message || t('mobile.caps.error.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (it, next) => {
    const prev = it.on;
    setItems(list => list.map(x => x.id === it.id ? { ...x, on: next, status: next ? t('mobile.caps.mcp.status.disconnected') : t('common.disabled') } : x));
    try {
      await window.api.mcp.enabled({ id: it.id, server_id: it.id, enabled: next });
      toast(next ? t('mobile.caps.mcp.toast.enabled') : t('mobile.caps.mcp.toast.disabled'), 'ok');
      if (next) {
        try { await window.api.mcp.start({ id: it.id, server_id: it.id }); } catch (_) {}
      } else {
        try { await window.api.mcp.stop({ id: it.id, server_id: it.id }); } catch (_) {}
      }
      load();
    } catch (e) {
      setItems(list => list.map(x => x.id === it.id ? { ...x, on: prev } : x));
      toast(t('mobile.caps.mcp.toast.toggle_failed'), 'danger');
    }
  };

  const handleDelete = async (it) => {
    if (!window.confirm(t('mobile.caps.mcp.confirm.delete', { name: it.name }))) return;
    try {
      await window.api.mcp.remove({ id: it.id, server_id: it.id });
      toast(t('mobile.caps.toast.deleted'), 'ok');
      load();
    } catch (e) {
      toast(t('mobile.caps.toast.delete_failed', { msg: e?.message || '' }), 'danger');
    }
  };

  const openAdd = () => {
    setForm({ name: '', transport: 'stdio', command: '', env: '' });
    setEditTarget(null);
    setAddOpen(true);
  };

  const openEdit = (it) => {
    const raw = it._raw || {};
    setForm({
      name: it.name,
      transport: it.tag || 'stdio',
      command: raw.command || raw.url || raw.endpoint || '',
      env: Object.entries(raw.env || {}).map(([k, v]) => `${k}=${v}`).join('\n'),
    });
    setEditTarget(it);
    setAddOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.command.trim()) {
      toast(t('mobile.caps.mcp.form.name_command_required'), 'warn');
      return;
    }
    setFormBusy(true);
    try {
      const envObj = {};
      for (const line of String(form.env || '').split('\n')) {
        const m = line.trim().match(/^([^=]+)=(.*)$/);
        if (m) envObj[m[1].trim()] = m[2];
      }
      const body = {
        name: form.name,
        transport: form.transport,
        enabled: true,
        ...(editTarget ? { id: editTarget.id, server_id: editTarget.id } : {}),
      };
      if (form.transport === 'http') body.url = form.command;
      else body.command = form.command;
      if (Object.keys(envObj).length) body.env = envObj;
      await window.api.mcp.upsert(body);
      toast(editTarget ? t('mobile.caps.mcp.toast.saved') : t('mobile.caps.mcp.toast.added'), 'ok');
      if (!editTarget) {
        try { await window.api.mcp.validate({ name: form.name }); } catch (_) {}
      }
      setAddOpen(false);
      load();
    } catch (e) {
      toast((editTarget ? t('mobile.caps.toast.save_failed') : t('mobile.caps.mcp.toast.add_failed')) + (e?.message ? ': ' + e.message : ''), 'danger');
    } finally {
      setFormBusy(false);
    }
  };

  const isEdit = !!editTarget;

  return (
    <>
      <div className="pl-pad">
        <div className="pl-sec-head" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>{t('mobile.caps.mcp.title')}</h2>
          <button className="pl-btn-primary" style={{ height: 36, width: 'auto', padding: '0 16px', fontSize: 13 }} onClick={openAdd}>
            <Icon name="plus" size={14} />{t('mobile.caps.mcp.add_btn')}
          </button>
        </div>
        {err && (
          <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.3)', color: 'var(--danger)', fontSize: 13 }}>
            {err}
          </div>
        )}
        {loading && items.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px 0' }}>{t('common.loading')}</div>
        ) : items.length === 0 ? (
          <div className="pl-empty">
            <div className="ic"><Icon name="diamond" size={22} /></div>
            <h3>{t('mobile.caps.mcp.empty_title')}</h3>
            <p>{t('mobile.caps.mcp.empty_desc')}</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 9 }}>
            {items.map((it) => (
              <div key={it.id} style={{ border: '1px solid var(--line-soft)', borderRadius: 14, background: 'var(--panel)', padding: '13px 14px', display: 'grid', gap: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="pl-row-ic" style={{ width: 36, height: 36, borderRadius: 10 }}>
                    <Icon name="diamond" size={16} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                    <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted-2)' }}>{it.tag}</div>
                  </div>
                  <Toggle on={it.on} onChange={(next) => handleToggle(it, next)} />
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>{it.desc}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <StatusPill on={it.on} label={it.status} />
                  <div style={{ display: 'flex', gap: 7 }}>
                    <button onClick={() => openEdit(it)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--line-soft)', background: 'var(--panel-2)', color: 'var(--muted)', fontSize: 12 }}>
                      <Icon name="edit" size={12} />{t('common.edit')}
                    </button>
                    <button onClick={() => handleDelete(it)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(200,103,93,0.3)', background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 12 }}>
                      <Icon name="trash" size={12} />{t('common.delete')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={addOpen} title={isEdit ? t('mobile.caps.mcp.sheet.edit_title') : t('mobile.caps.mcp.sheet.add_title')} hint="POST /api/v1/mcp/server" onClose={() => setAddOpen(false)} zIndex={70} maxHeight="88%">
        <div style={{ padding: '4px 4px 8px' }}>
          <MField label={t('mobile.caps.mcp.form.name_label')} desc={t('mobile.caps.mcp.form.name_desc')}>
            <input className="pl-input" placeholder={t('mobile.caps.mcp.form.name_placeholder')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ fontSize: 16 }} />
          </MField>
          <MField label={t('mobile.caps.mcp.form.transport_label')}>
            <div className="pl-seg2" style={{ marginTop: 4 }}>
              <button className={form.transport === 'stdio' ? 'active' : ''} onClick={() => setForm(f => ({ ...f, transport: 'stdio' }))}>{t('mobile.caps.mcp.form.transport_stdio')}</button>
              <button className={form.transport === 'http' ? 'active' : ''} onClick={() => setForm(f => ({ ...f, transport: 'http' }))}>{t('mobile.caps.mcp.form.transport_http')}</button>
            </div>
          </MField>
          <MField label={form.transport === 'http' ? 'URL' : t('mobile.caps.mcp.form.command_label')} desc={form.transport === 'http' ? 'https://host:port' : t('mobile.caps.mcp.form.command_desc')}>
            <input className="pl-input mono" placeholder={form.transport === 'http' ? 'https://localhost:7300' : 'uvx my-mcp'} value={form.command} onChange={e => setForm(f => ({ ...f, command: e.target.value }))} style={{ fontSize: 16 }} />
          </MField>
          <MField label={t('mobile.caps.mcp.form.env_label')} desc={t('mobile.caps.mcp.form.env_desc')}>
            <textarea className="pl-input" placeholder={t('mobile.caps.mcp.form.env_placeholder')} value={form.env} onChange={e => setForm(f => ({ ...f, env: e.target.value }))} style={{ minHeight: 72, fontSize: 16 }} />
          </MField>
          <div className="sheet-actions" style={{ marginTop: 8 }}>
            <button className="sheet-btn" onClick={() => setAddOpen(false)}>{t('common.cancel')}</button>
            <button className="sheet-btn primary" onClick={handleSubmit} disabled={formBusy}>
              {formBusy ? t('mobile.caps.mcp.form.submitting') : (isEdit ? t('common.save') : t('mobile.caps.mcp.form.validate_enable'))}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────
   SKILLS
   ────────────────────────────────────────────────────────────────── */
function SkillsSection({ toast }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await window.api.tools.list();
      const tl = (r && r.tools) || {};
      setItems((tl.skills || []).map(s => ({
        id: s.id || s.slug || s.name,
        name: s.name || s.id,
        desc: s.description || s.summary || '',
        tag: s.version || s.kind || 'v1',
        on: s.enabled !== false,
      })));
    } catch (e) {
      setErr(e?.message || t('mobile.caps.error.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const handleImport = async () => {
    if (!file) { toast(t('mobile.caps.skills.select_file_required'), 'warn'); return; }
    setImportBusy(true);
    try {
      await window.api.skills.importPack(file);
      toast(t('mobile.caps.skills.toast.imported'), 'ok');
      setImportOpen(false);
      setFile(null);
      load();
    } catch (e) {
      toast(t('mobile.caps.skills.toast.import_failed', { msg: e?.message || '' }), 'danger');
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <>
      <div className="pl-pad">
        <div className="pl-sec-head" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>{t('mobile.caps.skills.title')}</h2>
          <button className="pl-btn-primary" style={{ height: 36, width: 'auto', padding: '0 16px', fontSize: 13 }} onClick={() => setImportOpen(true)}>
            <Icon name="upload" size={14} />{t('mobile.caps.skills.import_btn')}
          </button>
        </div>
        {err && (
          <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.3)', color: 'var(--danger)', fontSize: 13 }}>
            {err}
          </div>
        )}
        {loading && items.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px 0' }}>{t('common.loading')}</div>
        ) : items.length === 0 ? (
          <div className="pl-empty">
            <div className="ic"><Icon name="spark" size={22} /></div>
            <h3>{t('mobile.caps.skills.empty_title')}</h3>
            <p>{t('mobile.caps.skills.empty_desc')}</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 9 }}>
            {items.map((it) => (
              <div key={it.id} style={{ border: '1px solid var(--line-soft)', borderRadius: 14, background: 'var(--panel)', padding: '13px 14px', display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="pl-row-ic" style={{ width: 36, height: 36, borderRadius: 10 }}>
                    <Icon name="spark" size={16} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                    <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted-2)' }}>{it.tag}</div>
                  </div>
                  <Toggle on={it.on} onChange={() => toast(t('mobile.caps.skills.all_enabled_notice'), 'warn')} />
                </div>
                {it.desc ? <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>{it.desc}</div> : null}
                <StatusPill on={it.on} label={it.on ? t('mobile.caps.skills.status.deployed') : t('common.disabled')} />
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={importOpen} title={t('mobile.caps.skills.sheet.title')} hint="POST /api/v1/skills/import" onClose={() => setImportOpen(false)} zIndex={70} maxHeight="88%">
        <div style={{ padding: '4px 4px 8px' }}>
          <MField label={t('mobile.caps.skills.form.file_label')} desc={t('mobile.caps.skills.form.file_desc')}>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,.tar.gz,.tgz"
              style={{ display: 'none' }}
              onChange={e => setFile(e.target.files?.[0] || null)}
            />
            <button
              className="pl-btn-ghost"
              style={{ marginTop: 4, height: 46, justifyContent: 'flex-start', gap: 10, paddingLeft: 14 }}
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="upload" size={16} />
              {file ? file.name : t('mobile.caps.skills.form.select_file')}
            </button>
          </MField>
          <div className="sheet-actions" style={{ marginTop: 8 }}>
            <button className="sheet-btn" onClick={() => setImportOpen(false)}>{t('common.cancel')}</button>
            <button className="sheet-btn primary" onClick={handleImport} disabled={importBusy || !file}>
              {importBusy ? t('mobile.caps.skills.form.importing') : t('mobile.caps.skills.form.import_deploy')}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────
   APIS — BYOK 凭证管理
   ────────────────────────────────────────────────────────────────── */
function ApisSection({ toast }) {
  const { t } = useTranslation();
  const [creds, setCreds] = useState({});       // api_id → { key_set, key_hint }
  const [providers, setProviders] = useState([]); // from /api/models catalog
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [editProv, setEditProv] = useState(null); // provider being edited
  const [keyVal, setKeyVal] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [testResult, setTestResult] = useState(null); // { id, ok, message }

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [credsRes, modelsRes] = await Promise.all([
        window.api.credentials.list().catch(() => ({ items: [] })),
        window.api.models.list().catch(() => null),
      ]);
      const credMap = {};
      for (const c of (credsRes?.items || credsRes?.credentials || [])) {
        credMap[c.api_id || c.id] = c;
      }
      setCreds(credMap);

      const apis = (modelsRes && modelsRes.apis) || [];
      setProviders(apis.filter(a => a.id !== 'local' && a.id !== 'builtin'));
    } catch (e) {
      setErr(e?.message || t('mobile.caps.error.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const openEdit = (prov) => {
    setEditProv(prov);
    setKeyVal('');
    setTestResult(null);
  };

  const handleSave = async () => {
    if (!keyVal.trim()) { toast(t('mobile.caps.apis.form.key_required'), 'warn'); return; }
    setSaveBusy(true);
    try {
      await window.api.credentials.set({ api_id: editProv.id, api_key: keyVal.trim() });
      toast(t('mobile.caps.apis.toast.key_saved'), 'ok');
      setEditProv(null);
      load();
    } catch (e) {
      toast(t('mobile.caps.toast.save_failed') + ': ' + (e?.message || ''), 'danger');
    } finally {
      setSaveBusy(false);
    }
  };

  const handleRemove = async (prov) => {
    if (!window.confirm(t('mobile.caps.apis.confirm.delete_key', { name: prov.name || prov.id }))) return;
    try {
      await window.api.credentials.remove({ api_id: prov.id });
      toast(t('mobile.caps.toast.deleted'), 'ok');
      load();
    } catch (e) {
      toast(t('mobile.caps.toast.delete_failed', { msg: e?.message || '' }), 'danger');
    }
  };

  const handleTest = async (prov) => {
    setTestResult({ id: prov.id, busy: true });
    try {
      const r = await window.api.credentials.test({ api_id: prov.id });
      setTestResult({ id: prov.id, ok: r?.ok !== false, message: r?.message || (r?.ok !== false ? t('mobile.caps.apis.test.ok') : t('mobile.caps.apis.test.failed')) });
    } catch (e) {
      setTestResult({ id: prov.id, ok: false, message: e?.message || t('mobile.caps.apis.test.request_failed') });
    }
  };

  const credOf = (prov) => creds[prov.id] || creds[prov.id?.toLowerCase()] || null;
  const isSet = (prov) => !!(credOf(prov)?.key_set);

  return (
    <>
      <div className="pl-pad">
        <div className="pl-sec-head" style={{ marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>{t('mobile.caps.apis.title')}</h2>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 16 }}>
          {t('mobile.caps.apis.description')}
        </div>
        {err && (
          <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.3)', color: 'var(--danger)', fontSize: 13 }}>
            {err}
          </div>
        )}
        {loading && providers.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px 0' }}>{t('common.loading')}</div>
        ) : providers.length === 0 ? (
          <div className="pl-empty">
            <div className="ic"><Icon name="braces" size={22} /></div>
            <h3>{t('mobile.caps.apis.empty_title')}</h3>
            <p>{t('mobile.caps.apis.empty_desc')}</p>
          </div>
        ) : (
          <div className="pl-group">
            {providers.map((prov, idx) => {
              const set = isSet(prov);
              const cred = credOf(prov);
              const tr = testResult?.id === prov.id ? testResult : null;
              return (
                <div key={prov.id} style={{ padding: '13px 14px', borderBottom: idx < providers.length - 1 ? '1px solid var(--line-soft)' : 'none', display: 'grid', gap: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="pl-prov-logo">
                      {(prov.name || prov.id || '?').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="pl-prov-id" style={{ flex: 1, minWidth: 0 }}>
                      <strong>{prov.name || prov.id}</strong>
                      <div className="key mono">{set ? (cred?.key_hint ? `…${cred.key_hint}` : t('mobile.caps.apis.key_set')) : t('mobile.caps.apis.key_unset')}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                      {set && (
                        <button onClick={() => handleTest(prov)} style={{ padding: '5px 9px', borderRadius: 8, border: '1px solid var(--line-soft)', background: 'var(--panel-2)', color: 'var(--muted)', fontSize: 11.5 }}>
                          {tr?.busy ? '…' : t('mobile.caps.apis.test_btn')}
                        </button>
                      )}
                      <button onClick={() => openEdit(prov)} style={{ padding: '5px 9px', borderRadius: 8, border: '1px solid var(--accent-edge)', background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 11.5 }}>
                        {set ? t('mobile.caps.apis.replace_btn') : t('mobile.caps.apis.set_btn')}
                      </button>
                    </div>
                  </div>
                  {tr && !tr.busy && (
                    <div style={{ fontSize: 12, padding: '7px 10px', borderRadius: 8, background: tr.ok ? 'var(--ok-soft)' : 'var(--danger-soft)', color: tr.ok ? 'var(--ok)' : 'var(--danger)', border: `1px solid ${tr.ok ? 'rgba(126,184,142,0.3)' : 'rgba(200,103,93,0.3)'}` }}>
                      {tr.ok ? '✓' : '✗'} {tr.message}
                    </div>
                  )}
                  {set && (
                    <button onClick={() => handleRemove(prov)} style={{ alignSelf: 'start', fontSize: 11.5, color: 'var(--danger)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                      {t('mobile.caps.apis.delete_key_btn')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Key Sheet */}
      <Sheet open={!!editProv} title={t('mobile.caps.apis.sheet.title', { name: editProv?.name || editProv?.id || '' })} hint="POST /api/v1/me/credentials" onClose={() => setEditProv(null)} zIndex={70} maxHeight="88%">
        <div style={{ padding: '4px 4px 8px' }}>
          <MField label="API Key" desc={isSet(editProv || {}) ? t('mobile.caps.apis.form.key_desc_existing') : t('mobile.caps.apis.form.key_desc_new')}>
            <input
              className="pl-input"
              type="password"
              placeholder={isSet(editProv || {}) ? t('mobile.caps.apis.form.key_placeholder_existing') : 'sk-…'}
              autoComplete="new-password"
              value={keyVal}
              onChange={e => setKeyVal(e.target.value)}
              style={{ fontSize: 16 }}
            />
          </MField>
          <div className="sheet-actions" style={{ marginTop: 8 }}>
            <button className="sheet-btn" onClick={() => setEditProv(null)}>{t('common.cancel')}</button>
            <button className="sheet-btn primary" onClick={handleSave} disabled={saveBusy || !keyVal.trim()}>
              {saveBusy ? t('mobile.caps.apis.form.saving') : t('common.save')}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────
   FEEDBACK
   ────────────────────────────────────────────────────────────────── */
const statusLabel = feedbackDecisionLabel;  // 语义统一 #26:用户侧决策标签(共享 lib/feedback.js)
function statusColor(d) {
  return !d ? 'info' : d === 'ok' ? 'ok' : d === 'spam' ? '' : 'danger';
}
// 统一到 window.__fmt.time(data-loader.js;zh-CN 24h 制),保留本地别名免改调用点。
function fmtTime(ts) {
  if (window.__fmt && window.__fmt.time) return window.__fmt.time(ts);
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); } catch (_) { return ts; }
}

function FeedbackSection({ toast }) {
  const { t } = useTranslation();
  // Submit form state
  const [freeText, setFreeText] = useState('');
  const [includeRuntime, setIncludeRuntime] = useState(true);
  const [includeExcerpts, setIncludeExcerpts] = useState(false);
  const [recentTurns, setRecentTurns] = useState([]);
  const [selectedExcerpts, setSelectedExcerpts] = useState([]);
  const [consent, setConsent] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitDone, setSubmitDone] = useState(false);
  const [submitErr, setSubmitErr] = useState('');
  const [runtimePreview, setRuntimePreview] = useState(null);

  // History state
  const [history, setHistory] = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histErr, setHistErr] = useState('');
  const [filter, setFilter] = useState('all');

  // Section toggle: form vs history
  const [view, setView] = useState('form'); // 'form' | 'history'

  const loadHistory = useCallback(async () => {
    setHistLoading(true); setHistErr('');
    try {
      const res = await fetch('/api/me/feedback?limit=50', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !data.ok) throw new Error(data?.error || t('mobile.caps.feedback.history.load_error'));
      setHistory(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setHistErr(e?.message || t('mobile.caps.feedback.history.load_error'));
    } finally {
      setHistLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const snap = window.__getRuntimeSnapshot && window.__getRuntimeSnapshot();
      setRuntimePreview(snap ? snap.__runtime__ : null);
    } catch (_) {}
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
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
        } catch (_) {}
        if (!Array.isArray(nodes) || nodes.length === 0) {
          if (window.MOCK_STATE && Array.isArray(window.MOCK_STATE.history)) nodes = window.MOCK_STATE.history;
        }
        const recent = (Array.isArray(nodes) ? nodes : [])
          .filter(n => n && (n.role === 'user' || n.role === 'assistant' || n.role === 'gm') && (n.content || n.text));
        const turns = recent.slice(-6).map((n, i) => ({
          idx: i, session_id: saveId, range: String(n.turn_index ?? n.turn ?? i),
          plaintext: ((n.content || n.text || '') + '').slice(0, 200),
          label: n.role === 'user' ? t('mobile.caps.feedback.turn_label.player') : 'GM',
        }));
        if (!cancelled) setRecentTurns(turns);
      } catch (_) { if (!cancelled) setRecentTurns([]); }
    })();
    return () => { cancelled = true; };
  }, [includeExcerpts]);

  const canSubmit = consent && freeText.trim().length > 0 && freeText.length <= MAX_FREE_TEXT && !submitBusy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitBusy(true); setSubmitErr('');
    try {
      const token = await sha256hex(CONSENT_TEXT);
      const excerpts = includeExcerpts
        ? recentTurns.filter(t => selectedExcerpts.includes(t.idx)).map(({ session_id, range, plaintext }) => ({ session_id, range, plaintext }))
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ free_text: freeText, excerpts, consent_token: token, app_version: window.__APP_VERSION__ || '' }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      setSubmitDone(true);
      setFreeText(''); setConsent(false); setIncludeExcerpts(false); setSelectedExcerpts([]);
      toast(t('mobile.caps.feedback.toast.submitted'), 'ok');
      loadHistory();
    } catch (e) {
      setSubmitErr(e?.message || t('mobile.caps.feedback.submit_error'));
    } finally {
      setSubmitBusy(false);
    }
  };

  const handleWithdraw = async (id) => {
    if (!window.confirm(t('mobile.caps.feedback.confirm.withdraw', { id }))) return;
    try {
      const res = await fetch(`/api/feedback/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast(t('mobile.caps.feedback.toast.withdrawn'), 'ok');
      loadHistory();
    } catch (e) {
      toast(t('mobile.caps.feedback.toast.withdraw_failed'), 'danger');
    }
  };

  const counts = {
    total: history.length,
    pending: history.filter(it => !it.review_decision).length,
    ok: history.filter(it => it.review_decision === 'ok').length,
  };

  const filtered = history.filter(it => {
    if (filter === 'all') return true;
    if (filter === 'pending') return !it.review_decision;
    if (filter === 'ok') return it.review_decision === 'ok';
    return it.review_decision && it.review_decision !== 'ok';
  });

  return (
    <div className="pl-pad">
      {/* View toggle */}
      <div className="pl-seg2" style={{ marginBottom: 18 }}>
        <button className={view === 'form' ? 'active' : ''} onClick={() => setView('form')}>{t('mobile.caps.feedback.tab.submit')}</button>
        <button className={view === 'history' ? 'active accent' : ''} onClick={() => setView('history')}>
          {t('mobile.caps.feedback.tab.history')}{counts.total > 0 ? ` (${counts.total})` : ''}
        </button>
      </div>

      {view === 'form' && (
        <div style={{ display: 'grid', gap: 14 }}>
          {/* Warning */}
          <div style={{ padding: '11px 13px', borderRadius: 12, background: 'var(--warn-soft)', border: '1px solid rgba(212,179,102,0.3)', fontSize: 12.5, color: 'var(--text-quiet)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--warn)' }}>{t('mobile.caps.feedback.warning.title')}</strong> {t('mobile.caps.feedback.warning.body')}
            {t('mobile.caps.feedback.warning.see')} <a href={AUP_LINK} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>AUP §2.J</a>
          </div>

          {submitDone && (
            <div style={{ padding: '11px 13px', borderRadius: 12, background: 'var(--ok-soft)', border: '1px solid rgba(126,184,142,0.3)', fontSize: 12.5, color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="check" size={14} />
              {t('mobile.caps.feedback.submit_done')}
              <button onClick={() => setSubmitDone(false)} style={{ marginLeft: 'auto', color: 'var(--ok)', fontSize: 11 }}>{t('common.close')}</button>
            </div>
          )}
          {submitErr && (
            <div style={{ padding: '11px 13px', borderRadius: 12, background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.3)', fontSize: 12.5, color: 'var(--danger)' }}>
              {submitErr}
            </div>
          )}

          <MField label={t('mobile.caps.feedback.form.label')} desc={t('mobile.caps.feedback.form.max_chars', { max: MAX_FREE_TEXT })}>
            <textarea
              className="pl-input"
              placeholder={t('mobile.caps.feedback.form.placeholder')}
              value={freeText}
              onChange={e => setFreeText(e.target.value)}
              style={{ minHeight: 120, fontSize: 16, lineHeight: 1.6 }}
              disabled={submitBusy}
            />
            {freeText.length > MAX_FREE_TEXT && (
              <span style={{ fontSize: 11, color: 'var(--danger)' }}>{t('mobile.caps.feedback.form.over_limit', { max: MAX_FREE_TEXT })}</span>
            )}
          </MField>

          {/* Checkboxes */}
          <div style={{ display: 'grid', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--text-quiet)', lineHeight: 1.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={includeRuntime} onChange={e => setIncludeRuntime(e.target.checked)} disabled={submitBusy} style={{ marginTop: 2, accentColor: 'var(--accent)', width: 16, height: 16, flex: 'none' }} />
              {t('mobile.caps.feedback.form.include_runtime')}
            </label>
            {includeRuntime && runtimePreview && (
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', padding: '8px 10px', borderRadius: 8, background: 'var(--bg-deep)', border: '1px solid var(--line-soft)', lineHeight: 1.7 }}>
                {t('mobile.caps.feedback.runtime_preview.page')} {runtimePreview.hash || runtimePreview.url || '—'} · {t('mobile.caps.feedback.runtime_preview.save')} {String(runtimePreview.active?.save_id ?? '—')}
                {'\n'}{t('mobile.caps.feedback.runtime_preview.errors')} {runtimePreview.errors?.length || 0} · {t('mobile.caps.feedback.runtime_preview.api_failures')} {runtimePreview.api_failures?.length || 0}
              </div>
            )}

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--text-quiet)', lineHeight: 1.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={includeExcerpts} onChange={e => setIncludeExcerpts(e.target.checked)} disabled={submitBusy} style={{ marginTop: 2, accentColor: 'var(--accent)', width: 16, height: 16, flex: 'none' }} />
              {t('mobile.caps.feedback.form.include_excerpts')}
            </label>
            {includeExcerpts && (
              recentTurns.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--muted)', paddingLeft: 26 }}>{t('mobile.caps.feedback.form.no_excerpts')}</div>
                : <div style={{ paddingLeft: 26, display: 'grid', gap: 7 }}>
                    {recentTurns.map(turn => (
                      <label key={turn.idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: 'var(--muted)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={selectedExcerpts.includes(turn.idx)} onChange={() => setSelectedExcerpts(p => p.includes(turn.idx) ? p.filter(i => i !== turn.idx) : [...p, turn.idx])} disabled={submitBusy} style={{ marginTop: 2, accentColor: 'var(--accent)', flex: 'none' }} />
                        <span><strong style={{ color: 'var(--text-quiet)' }}>{turn.label}</strong> {turn.plaintext.slice(0, 60)}{turn.plaintext.length > 60 ? '…' : ''}</span>
                      </label>
                    ))}
                  </div>
            )}
          </div>

          {/* Consent */}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12, color: 'var(--muted)', lineHeight: 1.55, cursor: 'pointer', padding: '11px 13px', borderRadius: 11, border: '1px solid var(--line-soft)', background: 'var(--panel)' }}>
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={submitBusy} style={{ marginTop: 2, accentColor: 'var(--accent)', width: 16, height: 16, flex: 'none' }} />
            {CONSENT_TEXT}
          </label>

          <button
            className="pl-btn-primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{ opacity: !canSubmit ? 0.5 : 1 }}
          >
            {submitBusy ? <><span>{t('mobile.caps.feedback.form.submitting')}</span></> : <><Icon name="upload" size={17} />{t('mobile.caps.feedback.form.submit_btn')}</>}
          </button>

          {/* QQ group footer */}
          <div style={{ padding: '14px', borderRadius: 13, border: '1px solid var(--line-soft)', background: 'var(--panel)', marginTop: 4 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--muted-2)', marginBottom: 8 }}>{t('mobile.caps.feedback.qq.heading')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 10 }}>
              {t('mobile.caps.feedback.qq.body', { group: QQ_GROUP_NUMBER })}
            </div>
            <a href={QQ_JOIN_URL} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, padding: '0 16px', borderRadius: 10, background: 'var(--accent)', color: '#fff8f3', fontSize: 13.5, fontWeight: 500, textDecoration: 'none' }}>
              <Icon name="link" size={14} />{t('mobile.caps.feedback.qq.join_btn')}
            </a>
          </div>
        </div>
      )}

      {view === 'history' && (
        <div style={{ display: 'grid', gap: 14 }}>
          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { label: t('mobile.caps.feedback.kpi.total'), value: counts.total, color: '' },
              { label: t('mobile.caps.feedback.kpi.pending'), value: counts.pending, color: 'var(--info)' },
              { label: t('mobile.caps.feedback.kpi.accepted'), value: counts.ok, color: 'var(--ok)' },
            ].map(k => (
              <div key={k.label} style={{ border: '1px solid var(--line-soft)', borderRadius: 11, background: 'var(--panel)', padding: '11px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-serif)', color: k.color || 'var(--text)', lineHeight: 1.1 }}>{k.value}</div>
                <div style={{ fontSize: 10.5, color: 'var(--muted-2)', marginTop: 3 }}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Filter pills */}
          <div className="pl-seg-scroll" style={{ padding: '0 0 2px', gap: 7 }}>
            {[
              { id: 'all', label: `${t('common.all')} ${counts.total}` },
              { id: 'pending', label: `${t('mobile.caps.feedback.filter.pending')} ${counts.pending}` },
              { id: 'ok', label: `${t('mobile.caps.feedback.filter.accepted')} ${counts.ok}` },
              { id: 'other', label: t('mobile.caps.feedback.filter.other') },
            ].map(opt => (
              <button key={opt.id} className={'pl-pill' + (filter === opt.id ? ' active' : '')} onClick={() => setFilter(opt.id)}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button className="pl-btn-ghost" style={{ height: 40 }} onClick={loadHistory} disabled={histLoading}>
            <Icon name="refresh" size={14} />{histLoading ? t('common.loading') : t('common.refresh')}
          </button>

          {/* List */}
          {histErr ? (
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.3)', color: 'var(--danger)', fontSize: 13 }}>{histErr}</div>
          ) : history.length === 0 ? (
            <div className="pl-empty">
              <div className="ic"><Icon name="feedback" size={22} /></div>
              <h3>{t('mobile.caps.feedback.history.empty_title')}</h3>
              <p>{t('mobile.caps.feedback.history.empty_desc')}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '24px 0' }}>{t('mobile.caps.feedback.history.filter_empty')}</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {filtered.map(it => (
                <div key={it.id} style={{ border: '1px solid var(--line-soft)', borderRadius: 13, background: 'var(--panel)', padding: '13px 14px', display: 'grid', gap: 9 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13.5, fontFamily: 'var(--font-mono)' }}>#{it.id}</strong>
                    <span className={`pill ${statusColor(it.review_decision)}`}>
                      <span className={`dot ${statusColor(it.review_decision)}`} />
                      {statusLabel(it.review_decision)}
                    </span>
                    {!it.review_decision && (
                      <button onClick={() => handleWithdraw(it.id)} style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--danger)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                        {t('mobile.caps.feedback.history.withdraw_btn')}
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                    {fmtTime(it.created_at)}
                    {it.reviewed_at ? ` · ${t('mobile.caps.feedback.history.reviewed_at')} ${fmtTime(it.reviewed_at)}` : ''}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-quiet)', lineHeight: 1.6 }}>
                    {it.free_text_preview || t('mobile.caps.feedback.history.no_text')}
                  </div>
                  {it.admin_reply && (
                    <div style={{ padding: '10px 12px', borderRadius: 9, background: 'var(--accent-soft)', borderLeft: '3px solid var(--accent)', fontSize: 13, lineHeight: 1.65 }}>
                      <strong style={{ fontSize: 12, letterSpacing: '0.04em' }}>{t('mobile.caps.feedback.history.official_reply')}</strong>
                      {it.replied_at && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}> · {fmtTime(it.replied_at)}</span>}
                      <div style={{ marginTop: 5, whiteSpace: 'pre-wrap', color: 'var(--text-quiet)' }}>{it.admin_reply}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Root Component
   ────────────────────────────────────────────────────────────────── */
export function MobileCaps({ nav }) {
  const { t } = useTranslation();
  // Derive initial section from nav.page
  const initial = (() => {
    const p = nav?.page || '';
    if (TABS.find(tab => tab.id === p)) return p;
    return 'plugins';
  })();
  const [section, setSection] = useState(initial);

  // Sync when nav.page changes externally
  const prevPage = useRef(nav?.page);
  if (nav?.page !== prevPage.current) {
    prevPage.current = nav?.page;
    const p = nav?.page || '';
    if (TABS.find(tab => tab.id === p) && p !== section) {
      setSection(p);
    }
  }

  const toast = useCallback((msg, kind = 'info') => {
    nav?.toast?.(msg, kind);
  }, [nav]);

  return (
    <>
      {/* Header */}
      <div className="pl-head">
        <button className="pl-back" onClick={() => nav?.pop?.() || nav?.switchTab?.('me')} aria-label={t('mobile.caps.header.back')}>
          <Icon name="chevron_left" size={18} />
        </button>
        <div className="pl-head-title">
          <strong>{t('mobile.caps.header.title')}</strong>
        </div>
      </div>

      {/* Tab bar (horizontal scrollable pill row) */}
      <div className="pl-seg-scroll" style={{ borderBottom: '1px solid var(--line-soft)', padding: '10px 16px 11px' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={'pl-pill' + (section === tab.id ? ' active' : '')}
            onClick={() => setSection(tab.id)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name={tab.icon} size={13} />
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="pl-body">
        {section === 'plugins'  && <PluginsSection  toast={toast} />}
        {section === 'mcp'      && <McpSection      toast={toast} />}
        {section === 'skills'   && <SkillsSection   toast={toast} />}
        {section === 'apis'     && <ApisSection     toast={toast} />}
        {section === 'feedback' && <FeedbackSection toast={toast} />}
      </div>
    </>
  );
}

export default MobileCaps;
