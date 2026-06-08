/* MobileSaves — 移动端存档列表 + 详情 + 设置 + 分支树 (saves / saves-branches)
   覆盖桌面端 src/pages/saves.jsx 全部功能:
   - 存档列表 (搜索 / 排序 / 分页)
   - 存档详情 (overview KV / 重命名 / 继续游戏 / 激活 / 导出 Bundle / 删除)
   - 存档设置 (SaveSettingsForm 等价)
   - 分支节点列表 (SaveBranchList 等价)
   - 分支树页 (saves-branches: 选存档 + 真 branch tree + 激活节点 + 删除节点)
   - 新游戏入口 (新建存档 —— 跳转 scripts tab 或使用 NewGameWizard 最简版)
   - 导入存档 (.json / .zip)
   - 继续游戏 → nav.openGame(save)

   铁律:零 Cloudscape / 零桌面 UI 组件;仅用 window.api.*。
*/
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Icon } from '../icons.jsx';

/* ── 工具函数 ─────────────────────────────────────────────── */
const API = () => window.__API_BASE || '';
const fmtDate = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch (_) { return String(v); }
};
const normSave = (x) => (window.__normalizeSave ? window.__normalizeSave(x) : x);
const normScript = (x) => (window.__normalizeScript ? window.__normalizeScript(x) : x);

/* ── 排序选项 ─────────────────────────────────────────────── */
const SORT_OPTS = [
  { value: 'played', label: '最近游玩' },
  { value: 'name',   label: '名称' },
  { value: 'created', label: '创建时间' },
];
const PAGE_SIZE = 50;

/* ── 确认弹窗 (底部 Sheet) ─────────────────────────────────── */
function ConfirmSheet({ open, title, body, danger, confirmLabel = '确认', onClose, onConfirm, loading }) {
  if (!open) return null;
  return (
    <div className="sheet-wrap show" onClick={onClose}>
      <div className="sheet-scrim" />
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        {title && <div className="sheet-title">{title}</div>}
        {body && <div className="confirm-note">{body}</div>}
        <div className="sheet-actions" style={{ marginTop: 8 }}>
          <button className="sheet-btn" onClick={onClose}>取消</button>
          <button
            className={'sheet-btn ' + (danger ? 'danger' : 'primary')}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? '处理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 导出弹窗 ────────────────────────────────────────────── */
function ExportSheet({ open, save, onClose, onToast }) {
  const [tier, setTier] = useState('no_vectors');
  const [estimate, setEstimate] = useState(null);
  const [estLoading, setEstLoading] = useState(false);

  useEffect(() => {
    if (!open || !save?.id) return;
    let dead = false;
    setEstimate(null); setEstLoading(true);
    fetch(`${API()}/api/v1/saves/${save.id}/export/estimate`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (dead) return;
        if (d?.tiers) { setEstimate(d); if (d.default_tier) setTier(d.default_tier); }
      })
      .catch(() => {})
      .finally(() => { if (!dead) setEstLoading(false); });
    return () => { dead = true; };
  }, [open, save?.id]);

  if (!open || !save) return null;

  const fmtBytes = (b) => {
    if (b == null) return estLoading ? '估算中…' : '未知';
    const mb = b / (1024 * 1024);
    if (mb >= 0.1) return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB';
    return Math.round(b / 1024) + ' KB';
  };
  const sizeOf = (k) => estimate?.tiers ? fmtBytes(estimate.tiers[k]) : (estLoading ? '估算中…' : '—');

  const doDownload = () => {
    const safe = (save.title || 'save').replace(/[^\w一-鿿]+/g, '_');
    const a = document.createElement('a');
    a.href = `${API()}/api/v1/saves/${save.id}/export/bundle?tier=${tier}`;
    a.download = `save-${save.id}-${safe}-${tier}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    onClose();
    onToast('导出已开始', 'ok');
  };

  const TIERS = [
    { key: 'no_vectors', label: '标准包', desc: '存档数据 + 历史，不含向量索引', isDefault: estimate?.default_tier === 'no_vectors' || !estimate },
    { key: 'full',       label: '完整包', desc: '含全部向量嵌入，文件较大', isDefault: estimate?.default_tier === 'full' },
  ];

  return (
    <div className="sheet-wrap show" onClick={onClose}>
      <div className="sheet-scrim" />
      <div className="sheet" style={{ maxHeight: '70%' }} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-title">导出存档包</div>
        <div className="sheet-sub">选择导出规格后下载 .zip 文件，可在其他设备导入。</div>
        <div style={{ display: 'grid', gap: 9, marginBottom: 16 }}>
          {TIERS.map(({ key, label, desc, isDefault }) => {
            const sel = tier === key;
            return (
              <label key={key} style={{
                display: 'grid', gridTemplateColumns: '18px 1fr auto', gap: 12,
                padding: '12px 14px', borderRadius: 12,
                border: sel ? '1px solid var(--accent-edge)' : '1px solid var(--line-soft)',
                background: sel ? 'var(--accent-soft)' : 'var(--panel)',
                cursor: 'pointer', alignItems: 'start',
              }}>
                <input type="radio" name="export-tier" value={key} checked={sel}
                  onChange={() => setTier(key)}
                  style={{ marginTop: 3, accentColor: 'var(--accent)' }} />
                <div style={{ display: 'grid', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}>
                    {label}
                    {isDefault && (
                      <span style={{
                        fontSize: 10, padding: '2px 7px', borderRadius: 99,
                        background: 'var(--ok-soft)', color: 'var(--ok)',
                        border: '1px solid rgba(126,184,142,0.3)', fontWeight: 600,
                      }}>推荐</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{desc}</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted-2)', whiteSpace: 'nowrap', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                  {sizeOf(key)}
                </div>
              </label>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 9 }}>
          <button className="sheet-btn" onClick={onClose} style={{ flex: 1 }}>取消</button>
          <button className="sheet-btn primary" onClick={doDownload} style={{ flex: 2 }}>
            <Icon name="download" size={16} /> 下载
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 存档设置表单(内嵌) ─────────────────────────────────── */
function SaveSettingsPane({ saveId, onToast }) {
  const [schema, setSchema] = useState(null);
  const [vals, setVals] = useState({});
  const [init, setInit] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [loadErr, setLoadErr] = useState('');

  useEffect(() => {
    let dead = false; setSchema(null); setErr(''); setLoadErr('');
    fetch(`${API()}/api/saves/${saveId}/settings`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (dead) return;
        if (d.ok !== false) {
          setSchema(d.schema);
          const v = {};
          (d.schema?.fields || []).forEach(f => { v[f.key] = (d.settings && d.settings[f.key]) ?? f.default; });
          setVals(v); setInit(v);
        } else setLoadErr(d.error || '加载失败');
      })
      .catch(e => { if (!dead) setLoadErr(String(e)); });
    return () => { dead = true; };
  }, [saveId]);

  if (loadErr) return (
    <div className="pl-empty"><p>{loadErr}</p></div>
  );
  if (!schema) return (
    <div className="pl-empty" style={{ padding: 32 }}>
      <div className="ic"><Icon name="settings" size={22} /></div>
      <p>加载设置中…</p>
    </div>
  );

  const fields = schema.fields || [];
  const dirty = JSON.stringify(vals) !== JSON.stringify(init);

  const save = async () => {
    const changed = {};
    Object.keys(vals).forEach(k => { if (vals[k] !== init[k]) changed[k] = vals[k]; });
    if (!Object.keys(changed).length) return;
    setSaving(true); setErr('');
    try {
      const r = await fetch(`${API()}/api/saves/${saveId}/settings`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: changed, is_create: false }),
      }).then(x => x.json());
      if (r.applied !== undefined) {
        setInit(vals);
        const rej = r.rejected && Object.keys(r.rejected);
        if (rej && rej.length) onToast(`部分字段锁定无法修改：${rej.join('/')}`, 'warn');
        else onToast('设置已保存', 'ok');
      } else { setErr(r.error || '保存失败'); }
    } catch (e) { setErr(String(e)); }
    setSaving(false);
  };

  return (
    <div style={{ padding: '4px 0' }}>
      {fields.map(f => (
        <div key={f.key} className="pl-field" style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12.5, color: 'var(--text-quiet)', fontWeight: 500 }}>{f.label}</label>
          {f.help && <div className="desc" style={{ fontSize: 11.5, color: 'var(--muted-2)', marginBottom: 4, lineHeight: 1.5 }}>{f.help}</div>}
          {f.options ? (
            <select
              value={vals[f.key] ?? ''}
              onChange={e => setVals(p => ({ ...p, [f.key]: e.target.value }))}
              style={{ width: '100%', height: 46, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--bg-deep)', color: 'var(--text)', fontSize: 16, padding: '0 14px', outline: 'none' }}
            >
              {f.options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              className="pl-input"
              value={vals[f.key] ?? ''}
              onChange={e => setVals(p => ({ ...p, [f.key]: e.target.value }))}
              style={{ fontSize: 16 }}
            />
          )}
        </div>
      ))}
      {err && (
        <div style={{
          color: 'var(--danger)', padding: '9px 12px', borderRadius: 10,
          background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.3)',
          fontSize: 13, marginBottom: 12,
        }}>{err}</div>
      )}
      <button
        className="pl-btn-primary"
        disabled={!dirty || saving}
        onClick={save}
        style={{ opacity: (!dirty || saving) ? 0.5 : 1 }}
      >
        {saving ? '保存中…' : '保存设置'}
      </button>
    </div>
  );
}

/* ── 分支节点列表(内嵌) ─────────────────────────────────── */
function BranchListPane({ save, onToast, onContinue }) {
  const [nodes, setNodes] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [activating, setActivating] = useState(null);

  const reload = useCallback(async () => {
    if (!save?.id) return;
    setNodes(null);
    try {
      const r = await window.api.branches.list(save.id);
      const aid = r?.active_commit_id || r?.active_branch_node_id;
      setActiveId(aid);
      const ns = (r?.nodes || r?.commits || []).map((n, i) => ({
        id: n.id,
        summary: n.summary || n.message || n.content_preview || `节点 #${n.id}`,
        turn: n.turn_index ?? i,
        kind: n.kind || 'round',
        current: n.id === aid,
        short_refs: Array.isArray(n.ref_names)
          ? n.ref_names.map(rn => String(rn).startsWith('refs/') ? String(rn).split('/').slice(2).join('/') : rn)
          : [],
        deleted: !!n.deleted,
      }));
      setNodes(ns);
    } catch (_) { setNodes([]); }
  }, [save?.id]);

  useEffect(() => { reload(); }, [reload]);

  const doActivate = async (n) => {
    setActivating(n.id);
    try {
      await window.api.branches.activate({ save_id: save.id, commit_id: n.id, node_id: n.id });
      onToast('已切换到该节点', 'ok');
      await reload();
    } catch (e) { onToast('切换失败：' + (e?.message || ''), 'danger'); }
    setActivating(null);
  };

  if (!nodes) return (
    <div className="pl-empty" style={{ padding: 32 }}>
      <div className="ic"><Icon name="branch" size={22} /></div>
      <p>加载分支中…</p>
    </div>
  );
  if (!nodes.length) return (
    <div className="pl-empty" style={{ padding: 32 }}>
      <div className="ic"><Icon name="branch" size={22} /></div>
      <h3>暂无分支节点</h3>
      <p>进入游戏后会自动生成分支记录。</p>
    </div>
  );

  return (
    <div className="branch-tree">
      {nodes.filter(n => !n.deleted).map((n) => (
        <div key={n.id} className="branch-row">
          <div className="branch-rail">
            <span className={'branch-node ' + (n.current ? 'accent' : (n.kind === 'root' ? 'info' : ''))} />
            <span className="branch-line" />
          </div>
          <button
            className={'branch-card ' + (n.current ? 'current' : '')}
            style={{ width: '100%', textAlign: 'left' }}
            onClick={() => n.current ? onContinue(n) : doActivate(n)}
            disabled={activating === n.id}
          >
            <div className="branch-top">
              <span className="branch-label serif">{n.summary}</span>
              {n.current && (
                <span style={{
                  fontSize: 9.5, padding: '2px 8px', borderRadius: 99,
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  border: '1px solid var(--accent-edge)', fontWeight: 600, flexShrink: 0,
                }}>HEAD</span>
              )}
              {n.short_refs.length > 0 && !n.current && (
                <span style={{
                  fontSize: 9.5, padding: '2px 7px', borderRadius: 99,
                  background: 'var(--panel-3)', color: 'var(--muted)', border: '1px solid var(--line)', flexShrink: 0,
                }}>{n.short_refs[0]}</span>
              )}
            </div>
            <div className="branch-at">
              turn {n.turn} · {n.kind}
              {activating === n.id ? ' · 切换中…' : ''}
              {!n.current && ' · 点击切换'}
            </div>
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── 存档详情 (overview / 设置 / 分支) ─────────────────────── */
function SaveDetail({ save, scripts, onBack, onContinue, onToast, onReload }) {
  const [tab, setTab] = useState('overview');
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const [delConfirm, setDelConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activating, setActivating] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const script = scripts.find(sc => sc.id === save.script_id);

  const doRename = async () => {
    const v = renameVal.trim();
    if (!v || v === save.title) { setRenaming(false); return; }
    try {
      await window.api.saves.rename(save.id, v);
      onToast('已重命名', 'ok');
      setRenaming(false);
      onReload();
    } catch (e) { onToast('重命名失败：' + (e?.message || ''), 'danger'); }
  };

  const doActivate = async () => {
    setActivating(true);
    try {
      await window.api.saves.activate(save.id);
      onToast('已设为当前存档', 'ok');
      onReload();
    } catch (e) { onToast('激活失败：' + (e?.message || ''), 'danger'); }
    setActivating(false);
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await window.api.saves.remove(save.id);
      onToast('已删除', 'ok');
      setDelConfirm(false);
      onBack();
      onReload();
    } catch (e) { onToast('删除失败：' + (e?.message || ''), 'danger'); }
    setDeleting(false);
  };

  const TABS = [
    { id: 'overview', label: '概览' },
    { id: 'settings', label: '设置' },
    { id: 'branches', label: '分支' },
  ];

  return (
    <>
      {/* 顶部 */}
      <div className="pl-head">
        <button className="pl-back" onClick={onBack}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title">
          {renaming ? (
            <div className="pl-input-row" style={{ width: '100%' }}>
              <input
                className="pl-input"
                value={renameVal}
                onChange={e => setRenameVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') setRenaming(false); }}
                autoFocus
                style={{ fontSize: 16, flex: 1 }}
              />
              <button className="pl-headbtn accent" onClick={doRename}><Icon name="check" size={18} /></button>
              <button className="pl-headbtn" onClick={() => setRenaming(false)}><Icon name="close" size={17} /></button>
            </div>
          ) : (
            <>
              <strong className="serif" style={{ fontSize: 15 }}>{save.title || `存档 #${save.id}`}</strong>
              <span className="sub">{script?.title || '自由模式'}</span>
            </>
          )}
        </div>
        {!renaming && (
          <div className="pl-head-actions">
            <button className="pl-headbtn" onClick={() => { setRenameVal(save.title || ''); setRenaming(true); }}>
              <Icon name="edit" size={18} />
            </button>
            <button className="pl-headbtn" onClick={() => setExportOpen(true)}>
              <Icon name="download" size={18} />
            </button>
            <button className="pl-headbtn" style={{ color: 'var(--danger)' }} onClick={() => setDelConfirm(true)}>
              <Icon name="trash" size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Tab 切换 */}
      <div className="panel-tabs">
        {TABS.map(t => (
          <button key={t.id} className={'ptab ' + (tab === t.id ? 'active' : '')} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 内容 */}
      <div className="pl-body">
        <div className="pl-pad">

          {/* 继续游戏 + 激活按钮 */}
          <div style={{ display: 'flex', gap: 9, marginBottom: 18 }}>
            <button className="pl-btn-primary" style={{ flex: 2 }} onClick={() => onContinue(save)}>
              <Icon name="play" size={18} />继续游戏
            </button>
            {!save.current && (
              <button className="pl-btn-ghost" style={{ flex: 1 }} onClick={doActivate} disabled={activating}>
                {activating ? '…' : '设为当前'}
              </button>
            )}
            {save.current && (
              <span className="pill accent" style={{ alignSelf: 'center', height: 36, paddingInline: 12, fontSize: 12 }}>
                <span className="dot accent" style={{ animation: 'mk-pulse-dot 1.6s infinite' }} /> 当前
              </span>
            )}
          </div>

          {/* ── overview ─────────────────────────────────────────── */}
          {tab === 'overview' && (
            <>
              <div className="pl-kvgrid" style={{ marginBottom: 16 }}>
                {[
                  { k: '剧本', v: script?.title || '自由模式' },
                  { k: '玩家', v: save._raw?.player_name || '—' },
                  { k: '回合', v: save._raw?.turn != null ? `第 ${save._raw.turn} 回合` : '—' },
                  { k: '分支节点', v: `${Number(save.branch_count) || 0} 个` },
                  { k: '世界时间', v: save._raw?.world_time || '—' },
                  { k: '最近游玩', v: fmtDate(save.last_played_at || save.last_played_ts) },
                  { k: '创建时间', v: fmtDate(save.created_ts) },
                  { k: '状态', v: save.current ? '当前存档' : '闲置' },
                ].map(({ k, v }) => (
                  <div key={k} className="pl-kv">
                    <div className="k">{k}</div>
                    <div className="v serif">{v}</div>
                  </div>
                ))}
              </div>

              {/* 最新片段 */}
              {(save._raw?.snippet || save._raw?.last_message) && (
                <div className="pl-sec">
                  <div className="pl-sec-head"><h2>最新片段</h2></div>
                  <blockquote className="quote">
                    {save._raw.snippet || save._raw.last_message}
                  </blockquote>
                </div>
              )}
            </>
          )}

          {/* ── settings ─────────────────────────────────────────── */}
          {tab === 'settings' && (
            <div className="pl-sec" style={{ marginTop: 0 }}>
              <div className="pl-sec-head"><h2>游戏设置</h2></div>
              <SaveSettingsPane saveId={save.id} onToast={onToast} />
            </div>
          )}

          {/* ── branches ─────────────────────────────────────────── */}
          {tab === 'branches' && (
            <div className="pl-sec" style={{ marginTop: 0 }}>
              <div className="pl-sec-head">
                <h2>分支节点 · {Number(save.branch_count) || '?'} 个</h2>
              </div>
              <BranchListPane save={save} onToast={onToast} onContinue={() => onContinue(save)} />
            </div>
          )}
        </div>
      </div>

      {/* 删除确认 */}
      <ConfirmSheet
        open={delConfirm}
        title="删除存档"
        body={`确定要删除「${save.title}」吗？此操作不可恢复。`}
        danger
        confirmLabel="删除"
        onClose={() => setDelConfirm(false)}
        onConfirm={doDelete}
        loading={deleting}
      />

      {/* 导出弹窗 */}
      <ExportSheet
        open={exportOpen}
        save={save}
        onClose={() => setExportOpen(false)}
        onToast={onToast}
      />
    </>
  );
}

/* ── 分支树页 (saves-branches) ───────────────────────────── */
function BranchesPage({ nav }) {
  const [saves, setSaves] = useState([]);
  const [savesLoaded, setSavesLoaded] = useState(false);
  const [selectedSave, setSelectedSave] = useState(null);
  const [treePayload, setTreePayload] = useState(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeErr, setTreeErr] = useState('');
  const [selectedNode, setSelectedNode] = useState(null);
  const [activating, setActivating] = useState(null);
  const [delTarget, setDelTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // 拉 saves 列表
  useEffect(() => {
    (async () => {
      try {
        const r = await window.api.saves.list();
        // 存档 = 游戏模式专属;酒馆会话(save_kind='tavern')不进存档列表(它们在酒馆页)。
        const list = (Array.isArray(r) ? r : (r?.items || r?.saves || []))
          .filter(s => (s && (s.save_kind || 'game')) !== 'tavern')
          .map(normSave);
        setSaves(list);
        if (list.length) setSelectedSave(prev => prev && list.some(s => s.id === prev) ? prev : list[0].id);
      } catch (_) {}
      setSavesLoaded(true);
    })();
  }, []);

  // 拉 branch tree
  const reloadTree = useCallback(async () => {
    if (!selectedSave) { setTreePayload(null); return; }
    setTreeLoading(true); setTreeErr('');
    try {
      const r = await window.api.branches.list(selectedSave);
      const aid = r?.active_commit_id || r?.active_branch_node_id;
      const nodes = (r?.nodes || r?.commits || []).map((n, i) => {
        const refNames = Array.isArray(n.ref_names) ? n.ref_names : [];
        const shortRefs = refNames.map(rn => String(rn).startsWith('refs/') ? String(rn).split('/').slice(2).join('/') : rn);
        return {
          id: n.id,
          summary: n.summary || n.message || n.content_preview || `节点 #${n.id}`,
          turn: n.turn_index ?? i,
          kind: n.kind || 'round',
          ref_names: refNames,
          short_refs: shortRefs,
          current: n.id === aid,
          deleted: !!n.deleted,
        };
      });
      setTreePayload({ nodes, refs: r?.refs || [], active_commit_id: aid });
    } catch (e) { setTreeErr(e?.message || '加载失败'); setTreePayload(null); }
    setTreeLoading(false);
  }, [selectedSave]);

  useEffect(() => { reloadTree(); }, [reloadTree]);

  const doActivate = async (nodeId) => {
    setActivating(nodeId);
    try {
      await window.api.branches.activate({ save_id: selectedSave, commit_id: nodeId, node_id: nodeId });
      nav.toast('已切换到该节点', 'ok');
      await reloadTree();
    } catch (e) { nav.toast('切换失败', 'danger'); }
    setActivating(null);
  };

  const doDelete = async () => {
    if (!delTarget) return;
    const cid = delTarget.id;
    setDeleting(true);
    try {
      await window.api.branches.delete({ save_id: selectedSave, node_id: cid, commit_id: cid });
      nav.toast('已删除节点', 'ok');
      setDelTarget(null);
      await reloadTree();
    } catch (e) { nav.toast('删除失败', 'danger'); }
    setDeleting(false);
  };

  const doContinue = () => {
    const save = saves.find(s => s.id === selectedSave);
    if (save) nav.openGame(save);
  };

  const nodes = treePayload?.nodes || [];

  // 空态
  if (savesLoaded && saves.length === 0) {
    return (
      <>
        <div className="pl-head">
          <button className="pl-back" onClick={() => nav.go('saves')}><Icon name="chevron_left" size={20} /></button>
          <div className="pl-head-title center"><strong>分支树</strong></div>
        </div>
        <div className="pl-body tabbed">
          <div className="pl-pad">
            <div className="pl-empty">
              <div className="ic"><Icon name="branch" size={24} /></div>
              <h3>还没有存档</h3>
              <p>先创建一个存档，再来这里查看分支历史。</p>
              <button className="pl-btn-primary" style={{ marginTop: 16, maxWidth: 200 }} onClick={() => nav.go('saves')}>
                <Icon name="save" size={17} />去存档页
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="pl-head">
        <button className="pl-back" onClick={() => nav.go('saves')}><Icon name="chevron_left" size={20} /></button>
        <div className="pl-head-title">
          <strong>分支树</strong>
          <span className="sub">{nodes.length} 个节点</span>
        </div>
        <div className="pl-head-actions">
          <button className="pl-headbtn" onClick={reloadTree}><Icon name="refresh" size={18} /></button>
          <button className="pl-headbtn accent" onClick={doContinue}><Icon name="play" size={18} /></button>
        </div>
      </div>

      {/* 存档选择器 */}
      {saves.length > 1 && (
        <div style={{ padding: '8px 16px 0' }}>
          <select
            value={selectedSave || ''}
            onChange={e => setSelectedSave(Number(e.target.value))}
            style={{
              width: '100%', height: 40, borderRadius: 11,
              border: '1px solid var(--line-soft)', background: 'var(--panel)',
              color: 'var(--text)', fontSize: 16, padding: '0 12px', outline: 'none',
            }}
          >
            {saves.map(s => <option key={s.id} value={s.id}>{s.title || `存档 #${s.id}`}</option>)}
          </select>
        </div>
      )}

      <div className="pl-body tabbed">
        <div className="pl-pad">
          {treeLoading && (
            <div className="pl-empty" style={{ padding: 32 }}>
              <div className="ic"><Icon name="branch" size={22} /></div>
              <p>加载中…</p>
            </div>
          )}
          {!treeLoading && treeErr && (
            <div className="pl-empty">
              <div className="ic"><Icon name="warn" size={22} /></div>
              <h3>加载失败</h3>
              <p>{treeErr}</p>
              <button className="pl-btn-ghost" style={{ marginTop: 14, maxWidth: 160 }} onClick={reloadTree}>
                <Icon name="refresh" size={16} />重试
              </button>
            </div>
          )}
          {!treeLoading && !treeErr && nodes.length === 0 && (
            <div className="pl-empty">
              <div className="ic"><Icon name="branch" size={22} /></div>
              <h3>暂无分支节点</h3>
              <p>进入游戏后会自动生成提交记录。</p>
            </div>
          )}
          {!treeLoading && !treeErr && nodes.length > 0 && (
            <>
              <div className="branch-tree">
                {nodes.filter(n => !n.deleted).map(n => (
                  <div key={n.id} className={'branch-row ' + (n.id === selectedNode ? 'sel' : '')}>
                    <div className="branch-rail">
                      <span className={'branch-node ' + (n.current ? 'accent' : (n.kind === 'root' ? 'info' : ''))} />
                      <span className="branch-line" />
                    </div>
                    <div style={{ display: 'grid', gap: 5 }}>
                      <button
                        className={'branch-card ' + (n.current ? 'current' : '')}
                        style={{ width: '100%', textAlign: 'left' }}
                        onClick={() => setSelectedNode(n.id === selectedNode ? null : n.id)}
                      >
                        <div className="branch-top">
                          <span className="branch-label serif">{n.summary}</span>
                          {n.current && <span className="branch-ref">HEAD</span>}
                          {n.short_refs.filter(r => r !== 'HEAD').slice(0, 1).map(r => (
                            <span key={r} className="branch-ref" style={{ background: 'var(--info-soft)', color: 'var(--info)', borderColor: 'rgba(122,166,194,.3)' }}>{r}</span>
                          ))}
                        </div>
                        <div className="branch-at">turn {n.turn} · {n.kind}</div>
                      </button>

                      {/* 展开操作 */}
                      {n.id === selectedNode && (
                        <div style={{ display: 'flex', gap: 7, paddingBottom: 4 }}>
                          <button
                            style={{
                              flex: 1, height: 34, borderRadius: 9,
                              border: '1px solid var(--accent-edge)', background: 'var(--accent-soft)',
                              color: 'var(--accent)', fontSize: 12.5, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                            }}
                            onClick={() => n.current ? doContinue() : doActivate(n.id)}
                            disabled={activating === n.id}
                          >
                            <Icon name="play" size={14} />
                            {n.current ? '从此继续' : (activating === n.id ? '切换中…' : '切换到此')}
                          </button>
                          {!n.current && (
                            <button
                              style={{
                                width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                                border: '1px solid rgba(200,103,93,0.3)', background: 'var(--danger-soft)',
                                color: 'var(--danger)', display: 'grid', placeItems: 'center',
                              }}
                              onClick={() => setDelTarget(n)}
                            >
                              <Icon name="trash" size={15} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="pl-note" style={{ marginTop: 14 }}>
                分支像 Git 一样工作。删除节点后历史仍保留在 <span className="mono" style={{ fontSize: 11 }}>refs/trash</span>，30 天内可恢复。
              </div>
            </>
          )}
        </div>
      </div>

      {/* 删除节点确认 */}
      <ConfirmSheet
        open={!!delTarget}
        title={`删除节点 #${delTarget?.id}`}
        body={`确定删除「${delTarget?.summary || '该节点'}」？此操作不可立即恢复，30 天内可在 refs/trash 找回。`}
        danger
        confirmLabel="删除节点"
        onClose={() => setDelTarget(null)}
        onConfirm={doDelete}
        loading={deleting}
      />
    </>
  );
}

/* ══════════════════════════════════════════════════════════
   主组件 MobileSaves
   路由:saves(列表/详情) + saves-branches(分支树页)
   ══════════════════════════════════════════════════════════ */
export function MobileSaves({ nav }) {
  /* ── 路由:saves-branches 分支树整页 ─────────────────────── */
  if (nav?.currentPage === 'saves-branches') {
    return (
      <div className="m-root">
        <div className="pl-root">
          <BranchesPage nav={nav} />
        </div>
      </div>
    );
  }

  /* ── 内部视图状态 ──────────────────────────────────────── */
  const [view, setView] = useState('list'); // list | detail
  const [selectedSave, setSelectedSave] = useState(null);

  const [saves, setSaves] = useState([]);
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('played');
  const [page, setPage] = useState(1);
  const [sortOpen, setSortOpen] = useState(false);

  const importRef = useRef(null);

  /* ── Toast (inline) ─────────────────────────────────────── */
  const [toast, setToastState] = useState({ msg: '', kind: 'ok', show: false });
  const showToast = useCallback((msg, kind = 'ok') => {
    setToastState({ msg, kind, show: true });
    setTimeout(() => setToastState(p => ({ ...p, show: false })), 2600);
  }, []);

  /* ── 数据加载 ─────────────────────────────────────────── */
  const reload = useCallback(async () => {
    try {
      const r = await window.api.saves.list();
      // 存档 = 游戏模式专属;酒馆会话(save_kind='tavern')不进存档列表(它们在酒馆页)。
      const list = (Array.isArray(r) ? r : (r?.items || r?.saves || []))
        .filter(s => (s && (s.save_kind || 'game')) !== 'tavern')
        .map(normSave);
      setSaves(list);
    } catch (_) { setSaves([]); }
    try {
      const s = await window.api.scripts.list();
      const list = (Array.isArray(s) ? s : (s?.items || s?.scripts || [])).map(normScript);
      setScripts(list);
    } catch (_) { setScripts([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
    const refresh = () => reload();
    window.addEventListener('rpg-saves-updated', refresh);
    window.addEventListener('rpg-scripts-updated', refresh);
    return () => {
      window.removeEventListener('rpg-saves-updated', refresh);
      window.removeEventListener('rpg-scripts-updated', refresh);
    };
  }, [reload]);

  /* ── 搜索 + 排序 + 分页 ───────────────────────────────── */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let xs = saves;
    if (q) xs = saves.filter(s => {
      const sc = scripts.find(x => x.id === s.script_id);
      return (s.title || '').toLowerCase().includes(q) || (sc?.title || '').toLowerCase().includes(q);
    });
    const ts = v => (v ? new Date(v).getTime() || 0 : 0);
    const sorted = [...xs];
    if (sortBy === 'name') sorted.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh'));
    else if (sortBy === 'created') sorted.sort((a, b) => ts(b.created_ts) - ts(a.created_ts));
    else sorted.sort((a, b) => ts(b.last_played_ts) - ts(a.last_played_ts));
    return sorted;
  }, [saves, scripts, query, sortBy]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const paged = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, sortBy]);

  const scriptTitle = s => scripts.find(x => x.id === s.script_id)?.title || '自由模式';

  /* ── 导入存档 ─────────────────────────────────────────── */
  const onImport = async (file) => {
    if (!file) return;
    if (!/\.(json|zip)$/i.test(file.name || '')) {
      showToast('只支持 .json / .zip 格式', 'danger'); return;
    }
    if (file.size > 200 * 1024 * 1024) {
      showToast('文件过大 (>200MB)', 'danger'); return;
    }
    showToast('导入中…', 'ok');
    try {
      const r = await window.api.saves.importFile(file);
      if (r && r.ok === false) throw new Error(r.error || r.detail || '导入失败');
      if (r?.warnings?.length) showToast(`导入完成，${r.warnings.length} 条警告`, 'ok');
      else showToast('导入成功', 'ok');
      reload();
    } catch (e) { showToast('导入失败：' + (e?.message || ''), 'danger'); }
  };

  /* ── 详情视图 ─────────────────────────────────────────── */
  if (view === 'detail' && selectedSave) {
    return (
      <>
        <SaveDetail
          save={selectedSave}
          scripts={scripts}
          onBack={() => { setView('list'); setSelectedSave(null); }}
          onContinue={s => nav.openGame(s)}
          onToast={showToast}
          onReload={reload}
        />
        {/* Toast */}
        <div className={'toast ' + (toast.kind === 'ok' ? 'ok' : toast.kind === 'danger' ? 'danger' : '') + (toast.show ? ' show' : '')}>
          <Icon name={toast.kind === 'ok' ? 'check' : toast.kind === 'danger' ? 'warn' : 'info'} size={14} />
          {toast.msg}
        </div>
      </>
    );
  }

  /* ── 列表视图 ─────────────────────────────────────────── */
  return (
    <>
      {/* 头部 */}
      <div className="pl-head">
        <div className="pl-head-title">
          <strong style={{ fontSize: 17, fontFamily: 'var(--font-serif)' }}>存档</strong>
          <span className="sub">{saves.length} 个存档</span>
        </div>
        <div className="pl-head-actions">
          <button className="pl-headbtn" onClick={() => importRef.current?.click()}>
            <Icon name="upload" size={18} />
          </button>
          <button className="pl-headbtn accent" onClick={() => nav.go('saves-branches')}>
            <Icon name="branch" size={18} />
          </button>
          <button className="pl-headbtn accent" onClick={() => (nav.push ? nav.push('new-game') : nav.switchTab && nav.switchTab('scripts'))}>
            <Icon name="plus" size={20} />
          </button>
        </div>
        <input
          ref={importRef}
          type="file"
          accept=".json,.zip,application/json,application/zip"
          style={{ display: 'none' }}
          onChange={e => { onImport(e.target.files?.[0]); e.target.value = ''; }}
        />
      </div>

      {/* 搜索栏 + 排序 */}
      <div className="pl-toolbar">
        <div className="pl-search">
          <Icon name="search" size={16} />
          <input
            placeholder="搜索存档或剧本名…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ fontSize: 16 }}
          />
          {query && (
            <button onClick={() => setQuery('')}><Icon name="close" size={15} /></button>
          )}
        </div>
        <button
          style={{
            height: 40, padding: '0 12px', borderRadius: 11, border: '1px solid var(--line-soft)',
            background: 'var(--panel)', color: 'var(--text-quiet)', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
          }}
          onClick={() => setSortOpen(p => !p)}
        >
          <Icon name="filter" size={14} />
          {SORT_OPTS.find(o => o.value === sortBy)?.label}
        </button>
      </div>

      {/* 排序 Sheet */}
      {sortOpen && (
        <div className="sheet-wrap show" onClick={() => setSortOpen(false)}>
          <div className="sheet-scrim" />
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-grip" />
            <div className="sheet-title">排序方式</div>
            <div className="sheet-list" style={{ marginTop: 8 }}>
              {SORT_OPTS.map(o => (
                <button
                  key={o.value}
                  className={'sheet-item ' + (sortBy === o.value ? 'active' : '')}
                  onClick={() => { setSortBy(o.value); setSortOpen(false); }}
                >
                  <span className={'sheet-ico ' + (sortBy === o.value ? 'active' : '')}>
                    <Icon name={o.value === 'played' ? 'clock' : o.value === 'name' ? 'list' : 'history'} size={18} />
                  </span>
                  <span className="sheet-tx"><strong>{o.label}</strong></span>
                  {sortBy === o.value && <Icon name="check" size={17} className="sheet-check" style={{ color: 'var(--accent)' }} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 主体列表 */}
      <div className="pl-body tabbed">
        <div className="pl-pad" style={{ paddingTop: 8 }}>

          {loading && (
            <div className="pl-empty">
              <div className="ic"><Icon name="save" size={22} /></div>
              <p>加载中…</p>
            </div>
          )}

          {!loading && saves.length === 0 && (
            <div className="pl-empty">
              <div className="ic"><Icon name="save" size={22} /></div>
              <h3>还没有存档</h3>
              <p>选一部剧本开始新游戏，或导入已有存档。</p>
              <button className="pl-btn-primary" style={{ marginTop: 16, maxWidth: 220 }} onClick={() => (nav.push ? nav.push('new-game') : nav.switchTab && nav.switchTab('scripts'))}>
                <Icon name="book_open" size={17} />浏览剧本
              </button>
            </div>
          )}

          {!loading && saves.length > 0 && visible.length === 0 && (
            <div className="pl-empty">
              <div className="ic"><Icon name="search" size={22} /></div>
              <h3>没有匹配结果</h3>
              <p>试试其他关键词。</p>
            </div>
          )}

          {paged.map(s => {
            const isCur = !!s.current;
            return (
              <button
                key={s.id}
                className={'pl-row ' + (isCur ? 'sel' : '')}
                onClick={() => { setSelectedSave(s); setView('detail'); }}
              >
                <span className={'pl-row-ic ' + (isCur ? 'accent' : '')}>
                  <Icon name={isCur ? 'play' : 'save'} size={18} />
                </span>
                <span className="pl-row-tx">
                  <strong className="serif">{s.title || `存档 #${s.id}`}</strong>
                  <span>
                    {scriptTitle(s)}
                    <span className="mono">
                      {' '}· {Number(s.branch_count) || 0} 分支
                      {s.last_played_at ? ` · ${fmtDate(s.last_played_at)}` : ''}
                    </span>
                  </span>
                </span>
                <span className="pl-row-end" style={{ flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                  {isCur && (
                    <span style={{ fontSize: 9.5, padding: '2px 7px', borderRadius: 99, background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-edge)', fontWeight: 600, whiteSpace: 'nowrap' }}>当前</span>
                  )}
                  <button
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5,
                      color: isCur ? 'var(--accent)' : 'var(--muted)',
                      padding: '5px 8px', borderRadius: 8,
                      border: '1px solid ' + (isCur ? 'var(--accent-edge)' : 'var(--line-soft)'),
                      background: isCur ? 'var(--accent-soft)' : 'var(--panel-2)',
                    }}
                    onClick={e => { e.stopPropagation(); nav.openGame(s); }}
                  >
                    <Icon name="play" size={13} />继续
                  </button>
                </span>
              </button>
            );
          })}

          {/* 分页 */}
          {pageCount > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '16px 0 4px', fontSize: 13, color: 'var(--muted)' }}>
              <button
                style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid var(--line-soft)', background: 'var(--panel)', color: 'var(--text-quiet)', display: 'grid', placeItems: 'center' }}
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                <Icon name="chevron_left" size={18} />
              </button>
              <span className="mono">{page} / {pageCount}</span>
              <button
                style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid var(--line-soft)', background: 'var(--panel)', color: 'var(--text-quiet)', display: 'grid', placeItems: 'center' }}
                disabled={page >= pageCount}
                onClick={() => setPage(p => p + 1)}
              >
                <Icon name="chevron_right" size={18} />
              </button>
            </div>
          )}

          {/* 底部操作区 */}
          {!loading && (
            <div className="pl-sec" style={{ marginTop: 24 }}>
              <div className="pl-sec-head"><h2>操作</h2></div>
              <div style={{ display: 'grid', gap: 8 }}>
                <button className="pl-row" onClick={() => importRef.current?.click()}>
                  <span className="pl-row-ic info"><Icon name="upload" size={18} /></span>
                  <span className="pl-row-tx">
                    <strong>导入存档</strong>
                    <span>支持 .json / .zip 存档包</span>
                  </span>
                  <span className="pl-row-chev"><Icon name="chevron_right" size={17} /></span>
                </button>
                <button className="pl-row" onClick={() => nav.go('saves-branches')}>
                  <span className="pl-row-ic"><Icon name="branch" size={18} /></span>
                  <span className="pl-row-tx">
                    <strong>分支树</strong>
                    <span>查看全部存档的分支历史</span>
                  </span>
                  <span className="pl-row-chev"><Icon name="chevron_right" size={17} /></span>
                </button>
                <button className="pl-row" onClick={() => (nav.push ? nav.push('new-game') : nav.switchTab && nav.switchTab('scripts'))}>
                  <span className="pl-row-ic accent"><Icon name="plus" size={18} /></span>
                  <span className="pl-row-tx">
                    <strong>新游戏</strong>
                    <span>从剧本页选择剧本开始</span>
                  </span>
                  <span className="pl-row-chev"><Icon name="chevron_right" size={17} /></span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      <div className={'toast ' + (toast.kind === 'ok' ? 'ok' : toast.kind === 'danger' ? 'danger' : '') + (toast.show ? ' show' : '')}>
        <Icon name={toast.kind === 'ok' ? 'check' : 'warn'} size={14} />
        {toast.msg}
      </div>
    </>
  );
}

export default MobileSaves;
