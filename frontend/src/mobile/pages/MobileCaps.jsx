/**
 * MobileCaps.jsx — 能力与反馈(移动原生 UI)
 * 覆盖路由: plugins / mcp / skills / apis / feedback
 * 铁律:零 Cloudscape / 零电脑端组件复用。数据层全接 window.api.*。
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from '../icons.jsx';
import { Sheet } from '../Sheet.jsx';
import { sha256hex } from '../../lib/crypto-safe.js';
import { feedbackDecisionLabel } from '../../lib/feedback.js';

/* ──────────────────────────────────────────────────────────────────
   Constants
   ────────────────────────────────────────────────────────────────── */
const TABS = [
  { id: 'plugins', label: '插件',    icon: 'plug'    },
  { id: 'mcp',     label: 'MCP',     icon: 'diamond' },
  { id: 'skills',  label: 'Skill',   icon: 'spark'   },
  { id: 'apis',    label: 'API',     icon: 'braces'  },
  { id: 'feedback',label: '反馈',    icon: 'feedback'},
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
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await window.api.tools.list();
      const t = (r && r.tools) || {};
      setItems((t.plugins || []).map(p => ({
        id: p.id || p.name,
        name: p.name || p.id,
        desc: p.description || '平台内置插件',
        tag: p.kind || 'plugin',
        on: p.enabled !== false,
      })));
    } catch (e) {
      setErr(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && items.length === 0) return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>加载中…</div>
  );
  if (err) return (
    <div style={{ margin: '16px', padding: '12px 14px', borderRadius: 12, background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.3)', color: 'var(--danger)', fontSize: 13 }}>
      {err}
      <button className="pl-btn-ghost" style={{ marginTop: 10, height: 38 }} onClick={load}>重试</button>
    </div>
  );
  if (items.length === 0) return (
    <div className="pl-empty">
      <div className="ic"><Icon name="plug" size={22} /></div>
      <h3>暂无插件</h3>
      <p>插件由平台预置,目前无可用插件。</p>
    </div>
  );

  return (
    <div className="pl-pad">
      <div className="pl-sec-head" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>插件</h2>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{items.length} 项 · {items.filter(i => i.on).length} 已启用</span>
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
              <Toggle on={it.on} onChange={() => toast('插件状态由平台管理 · 暂不支持手动切换', 'warn')} />
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>{it.desc}</div>
            <StatusPill on={it.on} label={it.on ? '已启用' : '未启用'} />
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
      const t = (toolsRes && toolsRes.tools) || {};
      const servers = ((t.mcp || {}).servers) || [];
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
          status: isRunning ? '已连接' : (isOn ? '未连接' : '未启用'),
          _raw: s,
        };
      }));
    } catch (e) {
      setErr(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (it, next) => {
    const prev = it.on;
    setItems(list => list.map(x => x.id === it.id ? { ...x, on: next, status: next ? '未连接' : '未启用' } : x));
    try {
      await window.api.mcp.enabled({ id: it.id, server_id: it.id, enabled: next });
      toast(next ? '已启用' : '已停用', 'ok');
      if (next) {
        try { await window.api.mcp.start({ id: it.id, server_id: it.id }); } catch (_) {}
      } else {
        try { await window.api.mcp.stop({ id: it.id, server_id: it.id }); } catch (_) {}
      }
      load();
    } catch (e) {
      setItems(list => list.map(x => x.id === it.id ? { ...x, on: prev } : x));
      toast('切换失败', 'danger');
    }
  };

  const handleDelete = async (it) => {
    if (!window.confirm(`删除 MCP 服务器「${it.name}」?`)) return;
    try {
      await window.api.mcp.remove({ id: it.id, server_id: it.id });
      toast('已删除', 'ok');
      load();
    } catch (e) {
      toast('删除失败: ' + (e?.message || ''), 'danger');
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
      toast('名称和命令/URL 不能为空', 'warn');
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
      toast(editTarget ? '已保存' : 'MCP 服务器已添加 · 正在校验', 'ok');
      if (!editTarget) {
        try { await window.api.mcp.validate({ name: form.name }); } catch (_) {}
      }
      setAddOpen(false);
      load();
    } catch (e) {
      toast((editTarget ? '保存失败: ' : '添加失败: ') + (e?.message || ''), 'danger');
    } finally {
      setFormBusy(false);
    }
  };

  const isEdit = !!editTarget;

  return (
    <>
      <div className="pl-pad">
        <div className="pl-sec-head" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>MCP 服务器</h2>
          <button className="pl-btn-primary" style={{ height: 36, width: 'auto', padding: '0 16px', fontSize: 13 }} onClick={openAdd}>
            <Icon name="plus" size={14} />新增
          </button>
        </div>
        {err && (
          <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.3)', color: 'var(--danger)', fontSize: 13 }}>
            {err}
          </div>
        )}
        {loading && items.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px 0' }}>加载中…</div>
        ) : items.length === 0 ? (
          <div className="pl-empty">
            <div className="ic"><Icon name="diamond" size={22} /></div>
            <h3>尚未配置 MCP 服务器</h3>
            <p>点击「新增」添加第一个 MCP 端点。</p>
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
                      <Icon name="edit" size={12} />编辑
                    </button>
                    <button onClick={() => handleDelete(it)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(200,103,93,0.3)', background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 12 }}>
                      <Icon name="trash" size={12} />删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={addOpen} title={isEdit ? '编辑 MCP 服务器' : '新增 MCP 服务器'} hint="POST /api/v1/mcp/server" onClose={() => setAddOpen(false)} zIndex={70} maxHeight="88%">
        <div style={{ padding: '4px 4px 8px' }}>
          <MField label="名称" desc="服务器显示名称">
            <input className="pl-input" placeholder="例：filesystem · 本地" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={{ fontSize: 16 }} />
          </MField>
          <MField label="传输">
            <div className="pl-seg2" style={{ marginTop: 4 }}>
              <button className={form.transport === 'stdio' ? 'active' : ''} onClick={() => setForm(f => ({ ...f, transport: 'stdio' }))}>stdio · 本地</button>
              <button className={form.transport === 'http' ? 'active' : ''} onClick={() => setForm(f => ({ ...f, transport: 'http' }))}>http · 远程</button>
            </div>
          </MField>
          <MField label={form.transport === 'http' ? 'URL' : '命令'} desc={form.transport === 'http' ? 'https://host:port' : 'uvx my-mcp 或完整命令行'}>
            <input className="pl-input mono" placeholder={form.transport === 'http' ? 'https://localhost:7300' : 'uvx my-mcp'} value={form.command} onChange={e => setForm(f => ({ ...f, command: e.target.value }))} style={{ fontSize: 16 }} />
          </MField>
          <MField label="环境变量" desc="可选,每行 KEY=VALUE">
            <textarea className="pl-input" placeholder="例：API_KEY=sk-…" value={form.env} onChange={e => setForm(f => ({ ...f, env: e.target.value }))} style={{ minHeight: 72, fontSize: 16 }} />
          </MField>
          <div className="sheet-actions" style={{ marginTop: 8 }}>
            <button className="sheet-btn" onClick={() => setAddOpen(false)}>取消</button>
            <button className="sheet-btn primary" onClick={handleSubmit} disabled={formBusy}>
              {formBusy ? '提交中…' : (isEdit ? '保存' : '校验并启用')}
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
      const t = (r && r.tools) || {};
      setItems((t.skills || []).map(s => ({
        id: s.id || s.slug || s.name,
        name: s.name || s.id,
        desc: s.description || s.summary || '',
        tag: s.version || s.kind || 'v1',
        on: s.enabled !== false,
      })));
    } catch (e) {
      setErr(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleImport = async () => {
    if (!file) { toast('请选择 Skill 包文件', 'warn'); return; }
    setImportBusy(true);
    try {
      await window.api.skills.importPack(file);
      toast('Skill 已导入', 'ok');
      setImportOpen(false);
      setFile(null);
      load();
    } catch (e) {
      toast('导入失败: ' + (e?.message || ''), 'danger');
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <>
      <div className="pl-pad">
        <div className="pl-sec-head" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Skill 包</h2>
          <button className="pl-btn-primary" style={{ height: 36, width: 'auto', padding: '0 16px', fontSize: 13 }} onClick={() => setImportOpen(true)}>
            <Icon name="upload" size={14} />导入
          </button>
        </div>
        {err && (
          <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.3)', color: 'var(--danger)', fontSize: 13 }}>
            {err}
          </div>
        )}
        {loading && items.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px 0' }}>加载中…</div>
        ) : items.length === 0 ? (
          <div className="pl-empty">
            <div className="ic"><Icon name="spark" size={22} /></div>
            <h3>尚未导入 Skill 包</h3>
            <p>点击「导入」上传 .zip / .tar.gz Skill 包。</p>
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
                  <Toggle on={it.on} onChange={() => toast('Skill 默认全部启用 · 暂不支持单独停用', 'warn')} />
                </div>
                {it.desc ? <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>{it.desc}</div> : null}
                <StatusPill on={it.on} label={it.on ? '已部署' : '未启用'} />
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={importOpen} title="导入 Skill 包" hint="POST /api/v1/skills/import" onClose={() => setImportOpen(false)} zIndex={70} maxHeight="88%">
        <div style={{ padding: '4px 4px 8px' }}>
          <MField label="Skill 包文件" desc=".zip / .tar.gz 格式">
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
              {file ? file.name : '选择文件…'}
            </button>
          </MField>
          <div className="sheet-actions" style={{ marginTop: 8 }}>
            <button className="sheet-btn" onClick={() => setImportOpen(false)}>取消</button>
            <button className="sheet-btn primary" onClick={handleImport} disabled={importBusy || !file}>
              {importBusy ? '导入中…' : '导入并部署'}
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
      setErr(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (prov) => {
    setEditProv(prov);
    setKeyVal('');
    setTestResult(null);
  };

  const handleSave = async () => {
    if (!keyVal.trim()) { toast('请填写 API Key', 'warn'); return; }
    setSaveBusy(true);
    try {
      await window.api.credentials.set({ api_id: editProv.id, api_key: keyVal.trim() });
      toast('API Key 已保存', 'ok');
      setEditProv(null);
      load();
    } catch (e) {
      toast('保存失败: ' + (e?.message || ''), 'danger');
    } finally {
      setSaveBusy(false);
    }
  };

  const handleRemove = async (prov) => {
    if (!window.confirm(`删除「${prov.name || prov.id}」的 API Key?`)) return;
    try {
      await window.api.credentials.remove({ api_id: prov.id });
      toast('已删除', 'ok');
      load();
    } catch (e) {
      toast('删除失败: ' + (e?.message || ''), 'danger');
    }
  };

  const handleTest = async (prov) => {
    setTestResult({ id: prov.id, busy: true });
    try {
      const r = await window.api.credentials.test({ api_id: prov.id });
      setTestResult({ id: prov.id, ok: r?.ok !== false, message: r?.message || (r?.ok !== false ? '连通' : '失败') });
    } catch (e) {
      setTestResult({ id: prov.id, ok: false, message: e?.message || '请求失败' });
    }
  };

  const credOf = (prov) => creds[prov.id] || creds[prov.id?.toLowerCase()] || null;
  const isSet = (prov) => !!(credOf(prov)?.key_set);

  return (
    <>
      <div className="pl-pad">
        <div className="pl-sec-head" style={{ marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>API 凭证 (BYOK)</h2>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 16 }}>
          填写各供应商 API Key,系统将优先使用你的密钥调用对应模型。
        </div>
        {err && (
          <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.3)', color: 'var(--danger)', fontSize: 13 }}>
            {err}
          </div>
        )}
        {loading && providers.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px 0' }}>加载中…</div>
        ) : providers.length === 0 ? (
          <div className="pl-empty">
            <div className="ic"><Icon name="braces" size={22} /></div>
            <h3>无可用供应商</h3>
            <p>暂无已配置的 API 供应商。</p>
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
                      <div className="key mono">{set ? (cred?.key_hint ? `…${cred.key_hint}` : '已设置') : '未设置'}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                      {set && (
                        <button onClick={() => handleTest(prov)} style={{ padding: '5px 9px', borderRadius: 8, border: '1px solid var(--line-soft)', background: 'var(--panel-2)', color: 'var(--muted)', fontSize: 11.5 }}>
                          {tr?.busy ? '…' : '测试'}
                        </button>
                      )}
                      <button onClick={() => openEdit(prov)} style={{ padding: '5px 9px', borderRadius: 8, border: '1px solid var(--accent-edge)', background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 11.5 }}>
                        {set ? '更换' : '设置'}
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
                      删除密钥
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Key Sheet */}
      <Sheet open={!!editProv} title={`设置 API Key · ${editProv?.name || editProv?.id || ''}`} hint="POST /api/v1/me/credentials" onClose={() => setEditProv(null)} zIndex={70} maxHeight="88%">
        <div style={{ padding: '4px 4px 8px' }}>
          <MField label="API Key" desc={isSet(editProv || {}) ? '留空则保留现有密钥' : '填写供应商提供的 API Key'}>
            <input
              className="pl-input"
              type="password"
              placeholder={isSet(editProv || {}) ? '不修改则留空' : 'sk-…'}
              autoComplete="new-password"
              value={keyVal}
              onChange={e => setKeyVal(e.target.value)}
              style={{ fontSize: 16 }}
            />
          </MField>
          <div className="sheet-actions" style={{ marginTop: 8 }}>
            <button className="sheet-btn" onClick={() => setEditProv(null)}>取消</button>
            <button className="sheet-btn primary" onClick={handleSave} disabled={saveBusy || !keyVal.trim()}>
              {saveBusy ? '保存中…' : '保存'}
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
      if (!data || !data.ok) throw new Error(data?.error || '读取反馈记录失败');
      setHistory(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setHistErr(e?.message || '读取失败');
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
          label: n.role === 'user' ? '玩家' : 'GM',
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
      toast('已收到你的反馈', 'ok');
      loadHistory();
    } catch (e) {
      setSubmitErr(e?.message || '提交失败,请稍后重试');
    } finally {
      setSubmitBusy(false);
    }
  };

  const handleWithdraw = async (id) => {
    if (!window.confirm(`撤回反馈 #${id}?`)) return;
    try {
      const res = await fetch(`/api/feedback/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast('已撤回', 'ok');
      loadHistory();
    } catch (e) {
      toast('撤回失败', 'danger');
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
        <button className={view === 'form' ? 'active' : ''} onClick={() => setView('form')}>提交反馈</button>
        <button className={view === 'history' ? 'active accent' : ''} onClick={() => setView('history')}>
          我的记录{counts.total > 0 ? ` (${counts.total})` : ''}
        </button>
      </div>

      {view === 'form' && (
        <div style={{ display: 'grid', gap: 14 }}>
          {/* Warning */}
          <div style={{ padding: '11px 13px', borderRadius: 12, background: 'var(--warn-soft)', border: '1px solid rgba(212,179,102,0.3)', fontSize: 12.5, color: 'var(--text-quiet)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--warn)' }}>内容限制</strong> 反馈渠道不得包含 NSFW 等成人材料,违规将永久封号。
            详见 <a href={AUP_LINK} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>AUP §2.J</a>
          </div>

          {submitDone && (
            <div style={{ padding: '11px 13px', borderRadius: 12, background: 'var(--ok-soft)', border: '1px solid rgba(126,184,142,0.3)', fontSize: 12.5, color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="check" size={14} />
              已收到你的反馈!可在「我的记录」跟进处理进度。
              <button onClick={() => setSubmitDone(false)} style={{ marginLeft: 'auto', color: 'var(--ok)', fontSize: 11 }}>关闭</button>
            </div>
          )}
          {submitErr && (
            <div style={{ padding: '11px 13px', borderRadius: 12, background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.3)', fontSize: 12.5, color: 'var(--danger)' }}>
              {submitErr}
            </div>
          )}

          <MField label="问题 / 建议" desc={`最多 ${MAX_FREE_TEXT} 字`}>
            <textarea
              className="pl-input"
              placeholder="请描述你遇到的问题或建议…(复现步骤 / 期望 / 实际 越具体越好)"
              value={freeText}
              onChange={e => setFreeText(e.target.value)}
              style={{ minHeight: 120, fontSize: 16, lineHeight: 1.6 }}
              disabled={submitBusy}
            />
            {freeText.length > MAX_FREE_TEXT && (
              <span style={{ fontSize: 11, color: 'var(--danger)' }}>超过 {MAX_FREE_TEXT} 字限制</span>
            )}
          </MField>

          {/* Checkboxes */}
          <div style={{ display: 'grid', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--text-quiet)', lineHeight: 1.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={includeRuntime} onChange={e => setIncludeRuntime(e.target.checked)} disabled={submitBusy} style={{ marginTop: 2, accentColor: 'var(--accent)', width: 16, height: 16, flex: 'none' }} />
              附带运行环境信息(页面 / 活动剧本存档 / 最近错误,仅管理员可见,强烈建议)
            </label>
            {includeRuntime && runtimePreview && (
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', padding: '8px 10px', borderRadius: 8, background: 'var(--bg-deep)', border: '1px solid var(--line-soft)', lineHeight: 1.7 }}>
                页面 {runtimePreview.hash || runtimePreview.url || '—'} · 存档 {String(runtimePreview.active?.save_id ?? '—')}
                {'\n'}错误 {runtimePreview.errors?.length || 0} 条 · API失败 {runtimePreview.api_failures?.length || 0} 条
              </div>
            )}

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--text-quiet)', lineHeight: 1.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={includeExcerpts} onChange={e => setIncludeExcerpts(e.target.checked)} disabled={submitBusy} style={{ marginTop: 2, accentColor: 'var(--accent)', width: 16, height: 16, flex: 'none' }} />
              包含对话节选(最多 5 段)
            </label>
            {includeExcerpts && (
              recentTurns.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--muted)', paddingLeft: 26 }}>暂无可用对话节选</div>
                : <div style={{ paddingLeft: 26, display: 'grid', gap: 7 }}>
                    {recentTurns.map(t => (
                      <label key={t.idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: 'var(--muted)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={selectedExcerpts.includes(t.idx)} onChange={() => setSelectedExcerpts(p => p.includes(t.idx) ? p.filter(i => i !== t.idx) : [...p, t.idx])} disabled={submitBusy} style={{ marginTop: 2, accentColor: 'var(--accent)', flex: 'none' }} />
                        <span><strong style={{ color: 'var(--text-quiet)' }}>{t.label}</strong> {t.plaintext.slice(0, 60)}{t.plaintext.length > 60 ? '…' : ''}</span>
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
            {submitBusy ? <><span>提交中…</span></> : <><Icon name="upload" size={17} />提交反馈</>}
          </button>

          {/* QQ group footer */}
          <div style={{ padding: '14px', borderRadius: 13, border: '1px solid var(--line-soft)', background: 'var(--panel)', marginTop: 4 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--muted-2)', marginBottom: 8 }}>玩家交流群</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 10 }}>
              遇到问题欢迎加入玩家 QQ 群(群号 {QQ_GROUP_NUMBER})。
            </div>
            <a href={QQ_JOIN_URL} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, padding: '0 16px', borderRadius: 10, background: 'var(--accent)', color: '#fff8f3', fontSize: 13.5, fontWeight: 500, textDecoration: 'none' }}>
              <Icon name="link" size={14} />加入 QQ 群
            </a>
          </div>
        </div>
      )}

      {view === 'history' && (
        <div style={{ display: 'grid', gap: 14 }}>
          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { label: '全部', value: counts.total, color: '' },
              { label: '处理中', value: counts.pending, color: 'var(--info)' },
              { label: '已采纳', value: counts.ok, color: 'var(--ok)' },
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
              { id: 'all', label: `全部 ${counts.total}` },
              { id: 'pending', label: `待处理 ${counts.pending}` },
              { id: 'ok', label: `已采纳 ${counts.ok}` },
              { id: 'other', label: '其它' },
            ].map(opt => (
              <button key={opt.id} className={'pl-pill' + (filter === opt.id ? ' active' : '')} onClick={() => setFilter(opt.id)}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button className="pl-btn-ghost" style={{ height: 40 }} onClick={loadHistory} disabled={histLoading}>
            <Icon name="refresh" size={14} />{histLoading ? '加载中…' : '刷新'}
          </button>

          {/* List */}
          {histErr ? (
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.3)', color: 'var(--danger)', fontSize: 13 }}>{histErr}</div>
          ) : history.length === 0 ? (
            <div className="pl-empty">
              <div className="ic"><Icon name="feedback" size={22} /></div>
              <h3>还没有提交过反馈</h3>
              <p>切换到「提交反馈」写两句。</p>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '24px 0' }}>该筛选下暂无反馈。</div>
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
                        撤回
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                    {fmtTime(it.created_at)}
                    {it.reviewed_at ? ` · 处理 ${fmtTime(it.reviewed_at)}` : ''}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-quiet)', lineHeight: 1.6 }}>
                    {it.free_text_preview || '(无文字内容)'}
                  </div>
                  {it.admin_reply && (
                    <div style={{ padding: '10px 12px', borderRadius: 9, background: 'var(--accent-soft)', borderLeft: '3px solid var(--accent)', fontSize: 13, lineHeight: 1.65 }}>
                      <strong style={{ fontSize: 12, letterSpacing: '0.04em' }}>官方回复</strong>
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
  // Derive initial section from nav.page
  const initial = (() => {
    const p = nav?.page || '';
    if (TABS.find(t => t.id === p)) return p;
    return 'plugins';
  })();
  const [section, setSection] = useState(initial);

  // Sync when nav.page changes externally
  const prevPage = useRef(nav?.page);
  if (nav?.page !== prevPage.current) {
    prevPage.current = nav?.page;
    const p = nav?.page || '';
    if (TABS.find(t => t.id === p) && p !== section) {
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
        <button className="pl-back" onClick={() => nav?.pop?.() || nav?.switchTab?.('me')} aria-label="返回">
          <Icon name="chevron_left" size={18} />
        </button>
        <div className="pl-head-title">
          <strong>能力与反馈</strong>
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
            {tab.label}
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
