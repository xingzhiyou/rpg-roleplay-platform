/* MobileCards — 移动端角色卡管理(我的 / NPC / 在线库)
   覆盖路由: cards / cards-npc / cards-online
   铁律:
   - 零 Cloudscape/CS* 组件
   - 数据层 100% 复用 window.api.cards.*
   - 样式只用 mobile.css 已有 class + inline style
   - 子视图(列表→详情→编辑)用 useState 管理,不依赖外部路由 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from '../icons.jsx';
import AvatarImg from '../../components/AvatarImg.jsx';
// 卡表单读/写 helper 与桌面端字段集逐字一致 → 复用单一规范实现,避免 shape 漂移。
import { cardFormInit, cardFormPayload } from '../../pages/cards.jsx';
// 开关行统一到 mobile/Field.jsx(语义统一 #36);本地原 SetRow(toggle)与之 DOM/CSS 逐字节一致,
// import 为同名 SetRow,调用点零变化。本文件的竖排 Field(内置 input,非通用控件)保留本地实现。
import { ToggleRow as SetRow } from '../Field.jsx';

/* ── helpers ─────────────────────────────────────────────────────── */
const clamp2 = { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden', wordBreak: 'break-word' };
const clamp3 = { ...clamp2, WebkitLineClamp: 3 };

// 语义统一 #40(needs-care,保留):falsy → '0 B'(非 window.__fmt.bytes 的 '—'),且无 GB 档,
// 改用统一版会改显示(空值文案 + ≥1GB 档),刻意不动。
function fmtBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

/* cardFormInit / cardFormPayload 复用 pages/cards.jsx 的规范实现(见顶部 import)。 */

/* ── shared sub-components ──────────────────────────────────────── */

/** 顶部 back 头 */
function SubHead({ title, sub, onBack, actions }) {
  return (
    <div className="pl-head">
      <button className="pl-back" onClick={onBack} aria-label="返回">
        <Icon name="chevron_left" size={20} />
      </button>
      <div className="pl-head-title">
        <strong style={{ fontFamily: 'var(--font-serif)', fontSize: 16 }}>{title}</strong>
        {sub && <span className="sub">{sub}</span>}
      </div>
      {actions && <div className="pl-head-actions">{actions}</div>}
    </div>
  );
}

/** 角色 avatar — 有 src 则渲图片(AvatarImg 内部 onError 自动回退)，无 src 则首字母色块
 *  fill 模式:网格卡用全幅 92px banner(mc-card-av-wrap/img/letter CSS 控制尺寸),
 *  渲与原内联手写 img→onError→首字母完全等价的两元素结构(行为零变化),
 *  badge(off-dot/pinned/public)由调用方作为兄弟节点叠加。 */
function CardAv({ src, name, enabled, size = 72, radius = 20, colorClass = 'accent', zoomable = false, fill = false }) {
  const initial = (name || '?').trim().slice(0, 1);

  if (fill) {
    return (
      <>
        {src ? (
          <img
            src={src}
            alt={name}
            loading="lazy"
            className="mc-card-av-img"
            onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling && (e.currentTarget.nextSibling.style.display = 'grid'); }}
          />
        ) : null}
        <div className="mc-card-av-letter" style={{ display: src ? 'none' : 'grid' }}>
          {(name || '').slice(0, 1)}
        </div>
      </>
    );
  }

  const shapeStyle = { width: size, height: size, borderRadius: radius, flexShrink: 0 };

  if (src) {
    return (
      <div style={{ ...shapeStyle, position: 'relative', overflow: 'hidden' }}>
        <AvatarImg
          src={src}
          name={name}
          size={size}
          shape="square"
          zoomable={zoomable}
          className="mc-card-av-img"
        />
        {enabled === false && (
          <span style={{ position: 'absolute', top: 7, right: 7, width: 9, height: 9, borderRadius: 999, background: 'var(--muted-3)', zIndex: 1 }} />
        )}
      </div>
    );
  }

  return (
    <div style={{
      ...shapeStyle,
      display: 'grid', placeItems: 'center', position: 'relative',
      font: `600 ${Math.round(size * 0.42)}px var(--font-serif)`,
      background: colorClass === 'accent'
        ? 'linear-gradient(140deg, rgba(201,100,66,0.26), rgba(201,100,66,0.05))'
        : colorClass === 'info'
          ? 'linear-gradient(140deg, rgba(122,166,194,0.24), rgba(122,166,194,0.05))'
          : 'linear-gradient(140deg, var(--panel-3), var(--panel-2))',
      color: colorClass === 'accent' ? 'var(--accent)' : colorClass === 'info' ? 'var(--info)' : 'var(--text)',
    }}>
      {initial}
      {enabled === false && (
        <span style={{ position: 'absolute', top: 7, right: 7, width: 9, height: 9, borderRadius: 999, background: 'var(--muted-3)' }} />
      )}
    </div>
  );
}

/** 标签 pill */
function Tag({ label, color }) {
  const map = {
    green: { color: 'var(--ok)', border: 'rgba(126,184,142,0.3)', bg: 'var(--ok-soft)' },
    accent: { color: 'var(--accent)', border: 'var(--accent-edge)', bg: 'var(--accent-soft)' },
    default: { color: 'var(--text-quiet)', border: 'var(--line-soft)', bg: 'var(--bg)' },
  };
  const s = map[color] || map.default;
  return (
    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 7, border: `1px solid ${s.border}`, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

/** 只读档案文字块 */
function ProseBlock({ label, value }) {
  if (!value) return null;
  return (
    <div className="pl-prose-block">
      <div className="lbl">{label}</div>
      <div className="tx serif" style={{ whiteSpace: 'pre-wrap' }}>{value}</div>
    </div>
  );
}

/** 表单字段(input / textarea) */
// 语义统一 #36(保留):此 Field 内置 input/textarea 控件(非通用 children 控件),且 desc 用
// <div className="desc">(mobile/Field.jsx 的 Field 用 <span className="desc">)→ 形态不同,保留本地实现。
function Field({ label, value, rows, placeholder, desc, onChange, type = 'text' }) {
  return (
    <div className="pl-field">
      <label>{label}</label>
      {desc && <div className="desc">{desc}</div>}
      {rows
        ? <textarea className="pl-input" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <input className="pl-input" type={type} inputMode={type === 'number' ? 'numeric' : undefined} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      }
    </div>
  );
}

/** Scope 选择器 */
function ScopeSelect({ value, onChange, isNpc = false }) {
  const opts = isNpc
    ? [{ v: 'script', l: '剧本内' }, { v: 'private', l: '私有' }, { v: 'public', l: '公开' }]
    : [{ v: 'private', l: '私有' }, { v: 'public', l: '公开' }];
  return (
    <div className="pl-field">
      <label>可见范围</label>
      <div style={{ display: 'flex', gap: 8 }}>
        {opts.map((o) => (
          <button key={o.v} onClick={() => onChange(o.v)} style={{
            flex: 1, height: 40, borderRadius: 11, fontSize: 13.5,
            border: `1px solid ${value === o.v ? 'var(--accent-edge)' : 'var(--line-soft)'}`,
            background: value === o.v ? 'var(--accent-soft)' : 'var(--bg-deep)',
            color: value === o.v ? 'var(--accent)' : 'var(--muted)',
            fontWeight: value === o.v ? 600 : 400,
          }}>{o.l}</button>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   卡片编辑表单(用户卡 + NPC 共用)
   ═══════════════════════════════════════════════════════════════════ */
function CardEditForm({ form, u, kind = 'user' }) {
  const isNpc = kind === 'npc';
  return (
    <>
      {/* 基本信息 */}
      <div className="pl-sec-head" style={{ marginTop: 0, marginBottom: 12, padding: '0 2px' }}>
        <h2>基本信息</h2>
      </div>
      <Field label="名称 *" value={form.name} placeholder="例如 沈知微" onChange={(v) => u('name', v)} />
      <Field label="全名" value={form.full_name} placeholder="可选" desc="与名称不同时显示" onChange={(v) => u('full_name', v)} />
      <Field label="身份 / 一句话定位" value={form.identity} placeholder="例如 雾港医师" onChange={(v) => u('identity', v)} />
      <Field label="别名" value={form.aliases} placeholder="逗号分隔" desc="多个别名用逗号隔开" onChange={(v) => u('aliases', v)} />
      <Field label="标签" value={form.tags} placeholder="逗号分隔" desc="用于检索与语义激活" onChange={(v) => u('tags', v)} />

      {/* 人物档案 */}
      <div className="pl-sec-head" style={{ marginTop: 8, marginBottom: 12, padding: '0 2px' }}>
        <h2>人物档案</h2>
      </div>
      <Field label="背景" value={form.background} rows={3} placeholder="她的来历与处境…" onChange={(v) => u('background', v)} />
      <Field label="外貌" value={form.appearance} rows={2} placeholder="穿着、神态…" onChange={(v) => u('appearance', v)} />
      <Field label="性格" value={form.personality} rows={3} placeholder="行为倾向…" onChange={(v) => u('personality', v)} />
      <Field label="语言风格" value={form.speech_style} rows={2} placeholder="说话的方式…" onChange={(v) => u('speech_style', v)} />
      <Field label="当前状态" value={form.current_status} rows={2} placeholder="在游戏中的现状…" desc="每轮注入,反映实时情况" onChange={(v) => u('current_status', v)} />

      {/* 叙事设定 */}
      <div className="pl-sec-head" style={{ marginTop: 8, marginBottom: 12, padding: '0 2px' }}>
        <h2>叙事设定</h2>
      </div>
      <Field label="秘密" value={form.secrets} rows={3} placeholder="只有 GM 知道的设定…" desc="不会直接注入给玩家" onChange={(v) => u('secrets', v)} />
      <Field label="对话示例" value={form.sample_dialogue} rows={4} placeholder="每行一条示例对话" desc="每行一条" onChange={(v) => u('sample_dialogue', v)} />

      {/* 注入参数 */}
      <div className="pl-sec-head" style={{ marginTop: 8, marginBottom: 12, padding: '0 2px' }}>
        <h2>注入参数</h2>
      </div>
      <div className="pl-field">
        <div className="pl-slider-head">
          <span className="lab">Token 预算</span>
          <span className="val">{form.token_budget}</span>
        </div>
        <input className="pl-slider" type="range" min={100} max={1200} step={20}
          value={form.token_budget} onChange={(e) => u('token_budget', +e.target.value)} />
        <div className="pl-slider-desc">每轮注入该卡的最大上下文预算。越高越细,占用也越多。</div>
      </div>
      <Field label="重要度" value={String(form.importance)} type="number" placeholder="100" desc="影响召回优先级(0–1000)" onChange={(v) => u('importance', v)} />
      {isNpc && (
        <Field label="首次出场章节" value={String(form.first_revealed_chapter)} type="number" placeholder="1" desc="在此章节之前不注入" onChange={(v) => u('first_revealed_chapter', v)} />
      )}
      <Field label="优先级" value={String(form.priority)} type="number" placeholder="100" desc="注入顺序优先级" onChange={(v) => u('priority', v)} />
      <ScopeSelect value={form.scope} onChange={(v) => u('scope', v)} isNpc={isNpc} />
      <div className="pl-group" style={{ marginBottom: 18 }}>
        <SetRow label="启用此卡" desc="禁用后不参与召回" checked={!!form.enabled} onChange={(v) => u('enabled', v)} />
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   卡片详情只读面板(信息 / 设定 两 Tab)
   ═══════════════════════════════════════════════════════════════════ */
function CardDetail({ card, kind, onEdit, onDuplicate, onDelete, onBack, onExportTavern, children }) {
  const [tab, setTab] = useState('info');
  const raw = card._raw || card;
  const fullName = raw.full_name && raw.full_name !== raw.name ? raw.full_name : null;
  const aliases = Array.isArray(raw.aliases) ? raw.aliases : [];
  const tags = Array.isArray(raw.tags) ? raw.tags : [];
  const dialogues = Array.isArray(raw.sample_dialogue) ? raw.sample_dialogue : [];
  const isPublic = !!(raw.is_public ?? card.is_public);

  const scopeLabel = { script: '剧本内', private: '私有', public: '公开' };
  const sourceLabel = { extracted: '从剧本提取', user: '手动创建', persona: '人格', platform: '平台内置' };
  const cardTypeLabel = { npc: 'NPC', pc: 'PC 玩家卡', persona: '人格' };

  return (
    <>
      <SubHead
        title={card.name || '(未命名)'}
        sub={kind === 'npc' ? 'NPC 角色卡' : '玩家角色卡'}
        onBack={onBack}
        actions={
          <button className="pl-headbtn accent" onClick={onEdit} aria-label="编辑">
            <Icon name="edit" size={17} />
          </button>
        }
      />
      <div className="pl-body tabbed">
        {/* Tab 切换 */}
        <div style={{ display: 'flex', gap: 7, padding: '10px 16px 4px', borderBottom: '1px solid var(--line-soft)' }}>
          {[{ id: 'info', l: '角色信息' }, { id: 'lore', l: '设定档案' }].map((t) => (
            <button key={t.id} className={'pl-pill' + (tab === t.id ? ' active' : '')} onClick={() => setTab(t.id)}>
              {t.l}
            </button>
          ))}
        </div>

        <div className="pl-pad">
          {/* 头像 + 名字 */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 18 }}>
            <CardAv src={raw.avatar_path || raw.avatar_url} name={card.name} enabled={raw.enabled} size={72} radius={20} zoomable />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>
                {card.name || '(未命名)'}
              </div>
              {fullName && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2, fontStyle: 'italic' }}>{fullName}</div>}
              {(raw.identity || card.role) && (
                <div style={{ fontSize: 13, color: 'var(--accent)', marginTop: 4 }}>
                  {String(raw.identity || card.role).slice(0, 60)}
                </div>
              )}
              {(aliases.length > 0 || tags.length > 0) && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                  {aliases.map((a) => <Tag key={'a' + a} label={a} />)}
                  {tags.map((tg) => <Tag key={'t' + tg} label={tg} color="green" />)}
                </div>
              )}
            </div>
          </div>

          {tab === 'info' && (
            <div className="pl-kvgrid">
              {[
                ['类型', cardTypeLabel[raw.card_type] || (kind === 'npc' ? 'NPC' : '玩家卡')],
                ['来源', sourceLabel[raw.source] || card.origin || '—'],
                ['作用域', scopeLabel[raw.scope] || '私有'],
                ['状态', raw.enabled === false ? '已禁用' : '启用中'],
                ['重要度', raw.importance != null ? String(raw.importance) : '—'],
                ...(kind === 'npc' && raw.first_revealed_chapter > 1 ? [['出场章节', `第 ${raw.first_revealed_chapter} 章`]] : []),
                ['Token 预算', String(raw.token_budget ?? 450)],
                ['优先级', String(raw.priority ?? 100)],
                ['使用次数', String(card.uses || 0)],
                ['更新时间', card.updated || '—'],
              ].map(([k, v]) => (
                <div key={k} className="pl-kv">
                  <div className="k">{k}</div>
                  <div className="v">{v}</div>
                </div>
              ))}
              {isPublic && kind !== 'npc' && (
                <div className="pl-kv" style={{ gridColumn: '1/-1' }}>
                  <div className="k">公开状态</div>
                  <div className="v" style={{ color: 'var(--ok)' }}>已发布到在线卡库</div>
                </div>
              )}
            </div>
          )}

          {tab === 'lore' && (
            <>
              {[
                ['背景', raw.background],
                ['外貌', raw.appearance],
                ['性格', raw.personality],
                ['语言风格', raw.speech_style],
                ['当前状态', raw.current_status],
                ['秘密', raw.secrets],
              ].map(([lbl, val]) => <ProseBlock key={lbl} label={lbl} value={val} />)}
              {dialogues.length > 0 && (
                <div className="pl-prose-block">
                  <div className="lbl">对话示例</div>
                  <div style={{ display: 'grid', gap: 7 }}>
                    {dialogues.map((d, i) => (
                      <div key={i} style={{ borderLeft: '2px solid var(--accent-edge)', paddingLeft: 10, color: 'var(--text-quiet)', fontSize: 13, lineHeight: 1.65, fontFamily: 'var(--font-serif)' }}>
                        {typeof d === 'string' ? d : `${d.role ? d.role + ': ' : ''}${d.content || ''}`}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!raw.background && !raw.appearance && !raw.personality && !raw.speech_style && !raw.current_status && !raw.secrets && dialogues.length === 0 && (
                <div className="pl-empty">暂无设定内容</div>
              )}
            </>
          )}

          {/* 操作区 */}
          <div style={{ display: 'grid', gap: 9, marginTop: 22 }}>
            <button className="pl-btn-primary" onClick={onEdit}>
              <Icon name="edit" size={16} /> 编辑角色卡
            </button>
            {kind === 'user' && (
              <button className="pl-btn-ghost" onClick={onExportTavern}>
                <Icon name="download" size={16} /> 导出 SillyTavern 卡(.json)
              </button>
            )}
            {kind === 'user' && (
              <button className="pl-btn-ghost" onClick={() => {
                const url = window.api?.cards?.exportPng?.(card.id);
                if (url) window.open(url, '_blank');
              }}>
                <Icon name="image" size={16} /> 导出角色卡图片(.png)
              </button>
            )}
            <button className="pl-btn-ghost" onClick={onDuplicate}>
              <Icon name="copy" size={16} /> 复制为新卡
            </button>
            <button className="pl-btn-ghost danger" onClick={onDelete}>
              <Icon name="trash" size={16} /> 删除此卡
            </button>
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   卡片编辑器子视图
   ═══════════════════════════════════════════════════════════════════ */
function CardEditor({ card, isNew, kind, onBack, onSave, targetScripts = [], targetScriptId = '', onTargetScriptChange }) {
  const [form, setForm] = useState(() => cardFormInit(card));
  const [saving, setSaving] = useState(false);
  const u = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const nameOk = !!form.name.trim();

  const doSave = async () => {
    if (!nameOk || saving) return;
    if (!nameOk) { nav?.toast?.('名称不能为空', 'warn', 'warn'); return; }
    setSaving(true);
    try {
      await onSave(cardFormPayload(form, card));
    } catch (_) {
      // 父级已 toast
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SubHead
        title={isNew ? '新建角色卡' : `编辑 · ${card?.name || ''}`}
        sub={kind === 'npc' ? 'NPC' : '玩家卡'}
        onBack={onBack}
        actions={
          <button className="pl-headbtn accent" onClick={doSave} disabled={!nameOk || saving} aria-label="保存">
            {saving
              ? <span style={{ width: 17, height: 17, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: 999, display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
              : <Icon name="check" size={19} />
            }
          </button>
        }
      />
      <div className="pl-body tabbed">
        <div className="pl-pad">
          {/* 头像预览 */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <CardAv src={card?.avatar_path || card?.avatar_url} name={form.name} enabled={form.enabled} size={76} radius={22} />
          </div>

          {/* 新建 NPC 时选剧本 */}
          {isNew && kind === 'npc' && targetScripts.length > 0 && (
            <div className="pl-field" style={{ marginBottom: 20 }}>
              <label>所属剧本</label>
              <div className="desc">新建的 NPC 卡将挂载到此剧本</div>
              <select className="pl-input" value={targetScriptId} onChange={(e) => onTargetScriptChange?.(e.target.value)}
                style={{ height: 46, paddingTop: 0, paddingBottom: 0 }}>
                {targetScripts.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          )}

          <CardEditForm form={form} u={u} kind={kind} />

          <button className="pl-btn-primary" onClick={doSave} disabled={!nameOk || saving}
            style={{ opacity: nameOk && !saving ? 1 : 0.5 }}>
            {saving ? '保存中…' : isNew ? '创建角色卡' : '保存修改'}
          </button>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   酒馆导入 Sheet(底部滑出)
   ═══════════════════════════════════════════════════════════════════ */
function ImportSheet({ show, onClose, onConfirm }) {
  const [importType, setImportType] = useState('card'); // 'card' | 'chat'
  const [mode, setMode] = useState('file'); // 'file' | 'paste'
  const [files, setFiles] = useState([]);
  const [json, setJson] = useState('');
  const [parsed, setParsed] = useState(null);
  const [parseError, setParseError] = useState('');
  const [aiSplit, setAiSplit] = useState(false);
  const [chatFile, setChatFile] = useState(null);
  const [chatParsed, setChatParsed] = useState(null);
  const [chatError, setChatError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  const chatFileRef = useRef(null);

  // 重置
  useEffect(() => {
    if (!show) return;
    setImportType('card'); setMode('file'); setFiles([]); setJson('');
    setParsed(null); setParseError(''); setAiSplit(false);
    setChatFile(null); setChatParsed(null); setChatError('');
  }, [show]);

  const handleFiles = (list) => {
    const MAX = 5 * 1024 * 1024;
    const MAX_FILES = 8;
    const arr = [...list].slice(0, MAX_FILES);
    const valid = arr.filter((f) => {
      if (!f) return false;
      if (!/\.(png|json|webp)$/i.test(f.name || '')) return false;
      if (f.size > MAX) return false;
      return true;
    });
    setFiles(valid);
    if (valid[0]) {
      const f = valid[0];
      const sizeKb = (f.size / 1024).toFixed(1);
      const fmt = f.name.match(/\.png$/i) ? 'SillyTavern · PNG v2' : 'SillyTavern · JSON';
      setParsed({
        name: f.name.replace(/\.(png|json|webp)$/i, '').replace(/[_-]/g, ' '),
        format: fmt,
        description: `${sizeKb} KB · 待解析`,
        tags: ['导入'],
        first_mes: '(提交后后端解析)',
        _file: f,
      });
    }
  };

  const tryParseJson = () => {
    setParseError('');
    try {
      const obj = JSON.parse(json);
      // 解包常见的外层包装（如 {"ok":true,"card":{...}}）
      const inner = obj.card?.data ? obj.card : obj.character?.data ? obj.character : obj;
      const d = inner.data || {};
      const name = inner.name || inner.char_name || d.name || '(未命名)';
      const desc = inner.description || d.description || '暂无简介';
      const spec = inner.spec || obj.spec;
      const specVersion = inner.spec_version || obj.spec_version;
      setParsed({
        name,
        format: spec ? `${spec} · ${specVersion || 'v1'}` : 'JSON',
        description: desc.length > 120 ? desc.slice(0, 120) + '…' : desc,
        tags: inner.tags || d.tags || [],
        first_mes: inner.first_mes || d.first_mes || '—',
        _jsonString: json,
      });
    } catch (e) {
      setParseError('JSON 解析失败: ' + e.message);
      setParsed(null);
    }
  };

  const handleChatFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.(jsonl?)$/i.test(f.name || '')) { setChatError('仅支持 .jsonl / .json'); return; }
    if (f.size > 20 * 1024 * 1024) { setChatError('文件过大 (>20MB)'); return; }
    setChatFile(f); setChatError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const lines = ev.target.result.split('\n').filter((l) => l.trim());
        const header = JSON.parse(lines[0] || '{}');
        setChatParsed({
          charName: header.character_name || header.char_name || f.name.replace(/\.jsonl?$/i, ''),
          userName: header.user_name || 'User',
          msgCount: lines.slice(1).filter((l) => l.trim()).length,
          sizeKb: (f.size / 1024).toFixed(1),
          _text: ev.target.result,
        });
      } catch { setChatError('文件解析失败'); }
    };
    reader.readAsText(f);
  };

  const doConfirm = () => {
    if (importType === 'card') {
      if (!parsed) return;
      if (parsed._file) onConfirm({ type: 'card', file: parsed._file, aiSplit });
      else if (parsed._jsonString) onConfirm({ type: 'card_json', json_string: parsed._jsonString, aiSplit });
    } else {
      if (!chatParsed?._text) return;
      onConfirm({ type: 'chat', jsonl: chatParsed._text, charName: chatParsed.charName });
    }
  };

  const canSubmit = importType === 'card' ? !!parsed && !parseError : !!chatParsed && !chatError;

  return (
    <div className="sheet-wrap" style={{ position: 'fixed', inset: 0, zIndex: 60, pointerEvents: show ? 'auto' : 'none' }}>
      <div className="sheet-scrim" style={{ opacity: show ? 1 : 0 }} onClick={onClose} />
      <div className="sheet" style={{ transform: show ? 'translateY(0)' : 'translateY(101%)', maxHeight: '88%' }}>
        <div className="sheet-grip" />
        <div className="sheet-title">导入角色卡</div>
        <div className="sheet-sub">兼容 SillyTavern V2 / V3 格式(PNG · JSON · WEBP)和聊天记录(JSONL)</div>

        {/* 顶层类型切换 */}
        <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
          {[{ id: 'card', l: '角色卡' }, { id: 'chat', l: '聊天记录' }].map((t) => (
            <button key={t.id} className={'pl-pill' + (importType === t.id ? ' active' : '')} onClick={() => setImportType(t.id)}>
              {t.l}
            </button>
          ))}
        </div>

        {/* ── 角色卡导入 ── */}
        {importType === 'card' && (
          <>
            <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
              {[{ id: 'file', l: '上传文件' }, { id: 'paste', l: '粘贴 JSON' }].map((t) => (
                <button key={t.id} className={'pl-pill' + (mode === t.id ? ' active' : '')} onClick={() => setMode(t.id)}>
                  {t.l}
                </button>
              ))}
            </div>

            {mode === 'file' && (
              <>
                <div
                  style={{
                    border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--line-strong)'}`,
                    borderRadius: 14, padding: '28px 16px', textAlign: 'center',
                    background: dragOver ? 'var(--accent-soft)' : 'var(--bg)',
                    cursor: 'pointer', marginBottom: 12,
                  }}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                >
                  <Icon name="upload" size={28} style={{ color: dragOver ? 'var(--accent)' : 'var(--muted)', marginBottom: 10, display: 'block', margin: '0 auto 10px' }} />
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: dragOver ? 'var(--accent)' : 'var(--text)' }}>
                    {dragOver ? '松手导入' : '点击选择或拖入文件'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 5 }}>PNG · JSON · WEBP,最多 8 张，每张 5MB</div>
                  <input ref={fileRef} type="file" accept=".png,.json,.webp" multiple style={{ display: 'none' }}
                    onChange={(e) => handleFiles(e.target.files)} />
                </div>
                {files.length > 0 && (
                  <div style={{ display: 'grid', gap: 4, marginBottom: 12 }}>
                    {files.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderRadius: 9, background: 'var(--bg-deep)', fontSize: 12 }}>
                        <Icon name={f.name.endsWith('.png') || f.name.endsWith('.webp') ? 'image' : 'file'} size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        <span style={{ color: 'var(--muted-2)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{fmtBytes(f.size)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {mode === 'paste' && (
              <>
                <div className="pl-field" style={{ marginBottom: 10 }}>
                  <label>JSON 文本</label>
                  <textarea className="pl-input" rows={6} value={json} onChange={(e) => setJson(e.target.value)}
                    placeholder={'{\n  "name": "...",\n  "description": "...",\n  "first_mes": "..."\n}'}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
                </div>
                <button className="pl-btn-ghost" style={{ marginBottom: 12 }} onClick={tryParseJson} disabled={!json.trim()}>
                  <Icon name="check" size={14} /> 解析 JSON
                </button>
                {parseError && (
                  <div style={{ padding: '9px 12px', borderRadius: 9, background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.3)', color: 'var(--danger)', fontSize: 12.5, marginBottom: 10 }}>
                    <Icon name="warn" size={12} style={{ marginRight: 6 }} /> {parseError}
                  </div>
                )}
              </>
            )}

            {/* 预览卡 */}
            {parsed && (
              <div style={{ border: '1px solid var(--line-soft)', borderRadius: 12, padding: '12px 14px', background: 'var(--panel)', marginBottom: 12 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--muted-2)', marginBottom: 8 }}>
                  预览 · {parsed.format}
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 13, background: 'var(--info-soft)', border: '1px solid rgba(122,166,194,0.3)', display: 'grid', placeItems: 'center', color: 'var(--info)', font: '600 20px var(--font-serif)', flexShrink: 0, overflow: 'hidden', position: 'relative' }}>
                    {parsed._imageUrl ? (
                      <img src={parsed._imageUrl} alt={parsed.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', position: 'absolute', inset: 0 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    ) : null}
                    {parsed.name.slice(0, 1)}
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontFamily: 'var(--font-serif)', color: 'var(--text)', fontWeight: 600 }}>{parsed.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{parsed.description}</div>
                  </div>
                </div>
                {parsed.tags?.length > 0 && (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {parsed.tags.map((tg) => <Tag key={tg} label={tg} />)}
                  </div>
                )}
              </div>
            )}

            {/* AI 字段拆分 opt-in */}
            <div className="pl-group" style={{ marginBottom: 12 }}>
              <SetRow
                label="AI 字段拆分"
                desc="把长描述自动拆分到背景/性格/外貌字段（消耗 AI 额度）"
                checked={aiSplit}
                onChange={setAiSplit}
              />
            </div>
          </>
        )}

        {/* ── 聊天记录导入 ── */}
        {importType === 'chat' && (
          <>
            <div className="pl-note" style={{ marginBottom: 12 }}>
              选择 <strong>SillyTavern .jsonl</strong> 聊天记录文件,会转成一个新存档。
            </div>
            <button className="pl-btn-ghost" style={{ marginBottom: 12 }}
              onClick={() => chatFileRef.current?.click()}>
              <Icon name="upload" size={15} /> 选择聊天记录文件
            </button>
            <input ref={chatFileRef} type="file" accept=".jsonl,.json" style={{ display: 'none' }} onChange={handleChatFile} />
            {chatFile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderRadius: 9, background: 'var(--bg-deep)', fontSize: 12, marginBottom: 10 }}>
                <Icon name="file" size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chatFile.name}</span>
                <span style={{ color: 'var(--muted-2)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{(chatFile.size / 1024).toFixed(1)} KB</span>
              </div>
            )}
            {chatError && (
              <div style={{ padding: '9px 12px', borderRadius: 9, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 12.5, marginBottom: 10 }}>
                <Icon name="warn" size={12} style={{ marginRight: 6 }} />{chatError}
              </div>
            )}
            {chatParsed && (
              <div style={{ border: '1px solid var(--line-soft)', borderRadius: 12, padding: '12px 14px', background: 'var(--panel)', marginBottom: 12 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--muted-2)', marginBottom: 8 }}>解析预览</div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--ok-soft)', display: 'grid', placeItems: 'center', color: 'var(--ok)', font: '600 18px var(--font-serif)', flexShrink: 0 }}>
                    {chatParsed.charName.slice(0, 1)}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{chatParsed.charName}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                      {chatParsed.msgCount} 条消息 · {chatParsed.sizeKb} KB · 用户: {chatParsed.userName}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* 底部按钮 */}
        <div className="sheet-actions" style={{ marginTop: 4 }}>
          <button className="sheet-btn" onClick={onClose}>取消</button>
          <button className="sheet-btn primary" onClick={doConfirm} disabled={!canSubmit}
            style={{ opacity: canSubmit ? 1 : 0.45 }}>
            <Icon name="check" size={15} /> {importType === 'chat' ? '导入记录' : `导入${files.length > 1 ? ` (${files.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   删除确认 Sheet
   ═══════════════════════════════════════════════════════════════════ */
function DeleteSheet({ show, name, onClose, onConfirm }) {
  return (
    <div className="sheet-wrap" style={{ position: 'fixed', inset: 0, zIndex: 61, pointerEvents: show ? 'auto' : 'none' }}>
      <div className="sheet-scrim" style={{ opacity: show ? 1 : 0 }} onClick={onClose} />
      <div className="sheet" style={{ transform: show ? 'translateY(0)' : 'translateY(101%)' }}>
        <div className="sheet-grip" />
        <div className="sheet-title">删除角色卡</div>
        <div className="confirm-preview">「{name}」将被永久删除,无法恢复。</div>
        <div className="confirm-note"><strong>此操作不可撤销。</strong></div>
        <div className="sheet-actions">
          <button className="sheet-btn" onClick={onClose}>取消</button>
          <button className="sheet-btn danger" onClick={onConfirm}>
            <Icon name="trash" size={15} /> 确认删除
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   我的角色卡(user)列表视图
   ═══════════════════════════════════════════════════════════════════ */
function UserView({ nav }) {
  const [view, setView] = useState('list'); // 'list' | 'detail' | 'edit'
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' | 'pinned' | 'public'
  const [selected, setSelected] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const reload = useCallback(async () => {
    try {
      const r = await window.api.cards.myList();
      const list = Array.isArray(r) ? r : (r?.cards || r?.items || []);
      setCards(list.map((c) => ({
        id: String(c.id),
        name: c.name || '(未命名)',
        role: c.identity || c.role || '—',
        origin: c.origin || '—',
        bio: c.description || c.summary || c.bio || c.personality || c.current_status || c.appearance || '',
        tags: c.tags || [],
        pinned: !!c.pinned,
        is_public: !!c.is_public,
        uses: c.uses || 0,
        updated: window.__fmt?.ago(c.updated_at) || c.updated_at || '—',
        _raw: c,
      })));
    } catch (_) {
      // 匿名/离线下忽略
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const h = () => reload();
    window.addEventListener('rpg-user-cards-updated', h);
    return () => window.removeEventListener('rpg-user-cards-updated', h);
  }, [reload]);

  let filtered = cards;
  if (filter === 'pinned') filtered = filtered.filter((c) => c.pinned);
  if (filter === 'public') filtered = filtered.filter((c) => c.is_public);
  if (q) filtered = filtered.filter((c) =>
    (c.name + c.role + c.bio + (c.tags || []).join(' ')).toLowerCase().includes(q.toLowerCase())
  );

  const onSave = async (vals) => {
    try {
      await window.api.cards.myUpsert(vals);
      nav.toast(vals.id ? '已保存' : '已创建', 'ok', 'check');
      setView('list');
      setSelected(null);
      reload();
    } catch (e) {
      nav.toast('保存失败', 'danger', 'warn');
    }
  };

  const onImport = async (payload) => {
    try {
      if (payload.type === 'card' && payload.file) {
        await window.api.cards.importTavern(payload.file, { aiSplit: payload.aiSplit });
      } else if (payload.type === 'card_json' && payload.json_string) {
        await window.api.cards.importJson({ json_string: payload.json_string, ai_split: payload.aiSplit });
      } else if (payload.type === 'chat' && payload.jsonl) {
        const title = payload.charName ? `[酒馆导入] ${payload.charName}` : undefined;
        await window.api.chats.importTavern({ jsonl: payload.jsonl, title });
        nav.toast('聊天记录已导入为存档', 'ok', 'check');
        setShowImport(false);
        return;
      }
      nav.toast('导入成功', 'ok', 'check');
      setShowImport(false);
      reload();
    } catch (e) {
      nav.toast('导入失败: ' + (e?.message || ''), 'danger', 'warn');
    }
  };

  const onDuplicate = async (c) => {
    try {
      const src = c._raw || {};
      const body = { ...src, id: undefined, slug: undefined, name: (src.name || c.name) + ' (副本)' };
      await window.api.cards.myUpsert(body);
      nav.toast('已复制为新卡', 'ok', 'copy');
      reload();
    } catch (e) {
      nav.toast('复制失败', 'danger', 'warn');
    }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    try {
      await window.api.cards.myDelete(deleteTarget.id);
      nav.toast(`「${deleteTarget.name}」已删除`, 'ok', 'trash');
      setDeleteTarget(null);
      setView('list');
      setSelected(null);
      reload();
    } catch (e) {
      nav.toast('删除失败', 'danger', 'warn');
    }
  };

  const onExportTavern = (c) => {
    const url = window.api.cards.exportTavern(c.id);
    window.open(url, '_blank');
  };

  const onSetPublic = async (c, pub) => {
    try {
      await window.api.cards.setPublic(c.id, pub);
      nav.toast(pub ? '已发布到在线库' : '已取消公开', 'ok', 'check');
      reload();
    } catch (e) {
      nav.toast('操作失败', 'danger', 'warn');
    }
  };

  // ── 编辑子视图 ──
  if (view === 'edit') {
    return (
      <>
        <CardEditor
          card={selected?._raw || selected}
          isNew={!selected}
          kind="user"
          onBack={() => setView(selected ? 'detail' : 'list')}
          onSave={onSave}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </>
    );
  }

  // ── 详情子视图 ──
  if (view === 'detail' && selected) {
    return (
      <>
        <CardDetail
          card={selected}
          kind="user"
          onBack={() => setView('list')}
          onEdit={() => setView('edit')}
          onDuplicate={() => onDuplicate(selected)}
          onDelete={() => setDeleteTarget(selected)}
          onExportTavern={() => onExportTavern(selected)}
        />
        <DeleteSheet
          show={!!deleteTarget}
          name={deleteTarget?.name || ''}
          onClose={() => setDeleteTarget(null)}
          onConfirm={onDelete}
        />
      </>
    );
  }

  // ── 列表视图 ──
  return (
    <>
      <div className="pl-head">
        <div className="pl-head-title">
          <strong style={{ fontFamily: 'var(--font-serif)', fontSize: 20 }}>我的角色卡</strong>
          <span className="sub">{cards.length} 张</span>
        </div>
        <div className="pl-head-actions">
          <button className="pl-headbtn" onClick={() => setShowImport(true)} aria-label="导入">
            <Icon name="upload" size={17} />
          </button>
          <button className="pl-headbtn accent" onClick={() => { setSelected(null); setView('edit'); }} aria-label="新建">
            <Icon name="plus" size={20} />
          </button>
        </div>
      </div>

      {/* 搜索 */}
      <div className="pl-toolbar">
        <div className="pl-search">
          <Icon name="search" size={15} style={{ flexShrink: 0 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜角色名 / 身份 / 标签…" />
        </div>
      </div>

      {/* 筛选 pill */}
      <div className="pl-seg-scroll" style={{ paddingTop: 0, paddingBottom: 10 }}>
        {[{ id: 'all', l: '全部' }, { id: 'pinned', l: '置顶' }, { id: 'public', l: '已公开' }].map((t) => (
          <button key={t.id} className={'pl-pill' + (filter === t.id ? ' active' : '')} onClick={() => setFilter(t.id)}>
            {t.l}
          </button>
        ))}
      </div>

      <div className="pl-body tabbed">
        <div className="pl-pad" style={{ paddingTop: 4 }}>
          {loading && cards.length === 0 && (
            <div className="pl-empty">正在加载…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="pl-empty">
              {q ? '没有匹配的角色卡' : filter !== 'all' ? '此分类暂无卡' : '还没有角色卡,点右上角 + 新建'}
            </div>
          )}
          {/* 卡网格 */}
          <div className="pl-grid">
            {filtered.map((c) => (
              <button key={c.id} className="pl-charcard" onClick={() => { setSelected(c); setView('detail'); }}>
                <div className="av accent mc-card-av-wrap" style={{ position: 'relative' }}>
                  <CardAv fill src={c._raw?.avatar_path || c._raw?.avatar_url} name={c.name} />
                  {c.enabled === false && <span className="off-dot" />}
                  {c.pinned && <span style={{ position: 'absolute', top: 7, left: 7, fontSize: 10, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '2px 5px', borderRadius: 6, zIndex: 1 }}>置顶</span>}
                  {c.is_public && <span style={{ position: 'absolute', bottom: 7, right: 7, fontSize: 9, color: 'var(--ok)', background: 'var(--ok-soft)', padding: '2px 5px', borderRadius: 6, zIndex: 1 }}>公开</span>}
                </div>
                <div className="cc-body">
                  <div className="cc-name">{c.name}</div>
                  <div className="cc-id">{c.role !== '—' ? c.role : ''}</div>
                  <div className="cc-desc" style={{ minHeight: 34 }}>{c.bio || '—'}</div>
                  <div className="cc-foot">
                    <Icon name="layers" size={11} />
                    {c.origin !== '—' ? c.origin : '通用'}
                    <span style={{ flex: 1 }} />
                    {c.uses > 0 ? `${c.uses} 次` : c.updated}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <ImportSheet show={showImport} onClose={() => setShowImport(false)} onConfirm={onImport} />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   NPC 卡视图
   ═══════════════════════════════════════════════════════════════════ */
function NpcView({ nav }) {
  const [view, setView] = useState('list');
  const [cards, setCards] = useState([]);
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [scriptFilter, setScriptFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [newScriptId, setNewScriptId] = useState('');

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const sr = await window.api.scripts.list();
      const scriptList = Array.isArray(sr) ? sr : (sr?.items || sr?.scripts || []);
      setScripts(scriptList);
      if (!scriptList.length) { setCards([]); setLoading(false); return; }
      const lists = await Promise.all(scriptList.map(async (s) => {
        try {
          const r = await window.api.cards.scriptList(s.id);
          const arr = Array.isArray(r) ? r : (r?.items || r?.cards || []);
          return arr.map((c) => ({
            id: String(c.id),
            name: c.name || '(未命名)',
            role: c.identity || c.role || '—',
            save: s.title || `剧本 #${s.id}`,
            script_id: s.id,
            bio: c.appearance || c.personality || c.summary || c.description || '',
            tags: Array.isArray(c.tags) ? c.tags : [],
            uses: c.uses || 0,
            updated: window.__fmt?.ago(c.updated_at) || c.updated_at || '—',
            _raw: c,
          }));
        } catch (_) { return []; }
      }));
      setCards(lists.flat());
    } catch (e) {
      setError(e?.message || '加载失败');
      setCards([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const scriptKeys = [...new Set(cards.map((c) => String(c.script_id)))].filter((k) => k && k !== 'null');
  const titleOfScript = (sid) => {
    const s = scripts.find((x) => String(x.id) === String(sid));
    return s?.title || cards.find((c) => String(c.script_id) === String(sid))?.save || `剧本 #${sid}`;
  };

  let filtered = cards;
  if (scriptFilter !== 'all') filtered = filtered.filter((c) => String(c.script_id) === scriptFilter);
  if (q) filtered = filtered.filter((c) =>
    (String(c.name) + String(c.role) + String(c.bio) + (c.tags || []).join(' ')).toLowerCase().includes(q.toLowerCase())
  );

  const scriptOptions = scripts.map((s) => ({ value: String(s.id), label: s.title || `剧本 #${s.id}` }));

  useEffect(() => {
    const fallback = scriptFilter !== 'all' ? scriptFilter : scripts[0]?.id ? String(scripts[0].id) : '';
    setNewScriptId((prev) => (prev && scripts.some((s) => String(s.id) === prev) ? prev : fallback));
  }, [scripts, scriptFilter]);

  const onSaveNpc = async (vals) => {
    const sid = selected?.script_id || selected?._raw?.script_id || (scriptFilter !== 'all' ? scriptFilter : newScriptId) || (scripts.length === 1 ? String(scripts[0].id) : null);
    if (!sid) { nav.toast('请先选择所属剧本', 'warn', 'warn'); throw new Error('script_id required'); }
    try {
      const body = { ...vals, id: selected?._raw?.id ?? selected?.id ?? vals?.id };
      const r = await window.api.cards.scriptUpsert(sid, body);
      if (r && r.ok === false) throw new Error(r.error || r.detail || '保存失败');
      nav.toast(vals.id ? '已保存' : '已创建', 'ok', 'check');
      setView('list');
      setSelected(null);
      reload();
    } catch (e) {
      nav.toast('保存失败: ' + (e?.message || ''), 'danger', 'warn');
      throw e;
    }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    const sid = deleteTarget.script_id || deleteTarget._raw?.script_id;
    if (!sid) { nav.toast('找不到所属剧本', 'danger', 'warn'); setDeleteTarget(null); return; }
    try {
      await window.api.cards.scriptDelete(sid, deleteTarget.id);
      nav.toast(`「${deleteTarget.name}」已删除`, 'ok', 'trash');
      setDeleteTarget(null);
      setView('list');
      setSelected(null);
      reload();
    } catch (e) {
      nav.toast('删除失败', 'danger', 'warn');
    }
  };

  const onPromoteToUser = async (c) => {
    const raw = c._raw || c;
    const body = {
      name: c.name || raw.name || '(未命名)',
      identity: c.role || raw.identity || raw.role || '—',
      appearance: raw.appearance || c.bio || '',
      personality: raw.personality || '',
      speech_style: raw.speech_style || '',
      current_status: raw.current_status || '',
      secrets: raw.secrets || '',
      sample_dialogue: Array.isArray(raw.sample_dialogue) ? raw.sample_dialogue : [],
      tags: [...(Array.isArray(c.tags) && c.tags.length ? c.tags : []), '从NPC迁移'],
      enabled: true,
    };
    try {
      const r = await window.api.cards.myUpsert(body);
      if (r && r.ok === false) throw new Error(r.error || r.detail || '迁移失败');
      nav.toast(`「${body.name}」已迁移到我的角色卡`, 'ok', 'check');
      try { window.dispatchEvent(new CustomEvent('rpg-user-cards-updated')); } catch (_) {}
    } catch (e) {
      nav.toast('迁移失败', 'danger', 'warn');
    }
  };

  // ── 编辑 ──
  if (view === 'edit') {
    return (
      <>
        <CardEditor
          card={selected?._raw || selected}
          isNew={!selected}
          kind="npc"
          onBack={() => setView(selected ? 'detail' : 'list')}
          onSave={onSaveNpc}
          targetScripts={!selected ? scriptOptions : []}
          targetScriptId={!selected ? newScriptId : ''}
          onTargetScriptChange={setNewScriptId}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </>
    );
  }

  // ── 详情 ──
  if (view === 'detail' && selected) {
    return (
      <>
        <CardDetail
          card={selected}
          kind="npc"
          onBack={() => setView('list')}
          onEdit={() => setView('edit')}
          onDuplicate={() => {}}
          onDelete={() => setDeleteTarget(selected)}
          onExportTavern={() => {}}
        >
          <button className="pl-btn-ghost" style={{ marginTop: 9 }} onClick={() => onPromoteToUser(selected)}>
            <Icon name="user" size={15} /> 迁移到我的角色卡
          </button>
        </CardDetail>
        <DeleteSheet
          show={!!deleteTarget}
          name={deleteTarget?.name || ''}
          onClose={() => setDeleteTarget(null)}
          onConfirm={onDelete}
        />
      </>
    );
  }

  // ── 列表 ──
  return (
    <>
      <div className="pl-head">
        <div className="pl-head-title">
          <strong style={{ fontFamily: 'var(--font-serif)', fontSize: 20 }}>NPC 卡</strong>
          <span className="sub">{loading ? '加载中…' : `${cards.length} 张`}</span>
        </div>
        <div className="pl-head-actions">
          <button className="pl-headbtn" onClick={reload} aria-label="刷新">
            <Icon name="refresh" size={17} />
          </button>
          <button className="pl-headbtn accent" onClick={() => { setSelected(null); setView('edit'); }} aria-label="新建">
            <Icon name="plus" size={20} />
          </button>
        </div>
      </div>

      {/* 搜索 */}
      <div className="pl-toolbar">
        <div className="pl-search">
          <Icon name="search" size={15} style={{ flexShrink: 0 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜角色名 / 身份…" />
        </div>
      </div>

      {/* 剧本筛选 */}
      <div className="pl-seg-scroll" style={{ paddingTop: 0, paddingBottom: 10 }}>
        <button className={'pl-pill' + (scriptFilter === 'all' ? ' active' : '')} onClick={() => setScriptFilter('all')}>
          全部剧本
        </button>
        {scriptKeys.map((sid) => (
          <button key={sid} className={'pl-pill' + (scriptFilter === sid ? ' active' : '')} onClick={() => setScriptFilter(sid)}>
            {titleOfScript(sid)}
          </button>
        ))}
      </div>

      <div className="pl-body tabbed">
        <div className="pl-pad" style={{ paddingTop: 4 }}>
          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 13, marginBottom: 14 }}>
              <Icon name="warn" size={13} style={{ marginRight: 6 }} />{error}
            </div>
          )}
          {loading && cards.length === 0 && <div className="pl-empty">正在加载…</div>}
          {!loading && filtered.length === 0 && (
            <div className="pl-empty">
              {q ? '没有匹配的 NPC' : scriptFilter !== 'all' ? '此剧本暂无 NPC 卡' : '还没有 NPC 卡,点右上角 + 新建'}
            </div>
          )}
          <div className="pl-grid">
            {filtered.map((c) => (
              <button key={c.id} className="pl-charcard" onClick={() => { setSelected(c); setView('detail'); }}>
                <div className="av mc-card-av-wrap" style={{ position: 'relative' }}>
                  <CardAv fill src={c._raw?.avatar_path || c._raw?.avatar_url} name={c.name} />
                </div>
                <div className="cc-body">
                  <div className="cc-name">{c.name}</div>
                  <div className="cc-id">{c.role !== '—' ? c.role : ''}</div>
                  <div className="cc-desc" style={{ minHeight: 34 }}>{c.bio || '—'}</div>
                  <div className="cc-foot">
                    <Icon name="book_open" size={11} />
                    {c.save}
                    <span style={{ flex: 1 }} />
                    {c.uses > 0 ? `${c.uses} 次` : c.updated}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   在线卡库视图
   ═══════════════════════════════════════════════════════════════════ */
function OnlineView({ nav }) {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState({});
  const [selected, setSelected] = useState(null); // 在线卡详情

  const load = useCallback(async (query) => {
    setLoading(true); setError('');
    try {
      const r = await window.api.cards.publicList(query ? { q: query } : undefined);
      setItems((r && r.items) || []);
    } catch (e) {
      setError(e?.message || '加载失败');
      setItems([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(''); }, [load]);

  const doImport = async (c) => {
    setImporting((p) => ({ ...p, [c.id]: true }));
    try {
      await window.api.cards.cloneFromPublic(c.id);
      nav.toast(`「${c.name}」已导入到我的角色卡`, 'ok', 'download');
      try { window.dispatchEvent(new CustomEvent('rpg-user-cards-updated')); } catch (_) {}
      load(q);
    } catch (e) {
      nav.toast('导入失败: ' + (e?.payload?.error || e?.message || ''), 'danger', 'warn');
    } finally {
      setImporting((p) => ({ ...p, [c.id]: false }));
    }
  };

  // 在线卡详情
  if (selected) {
    const c = selected;
    const tags = c.tags || [];
    return (
      <>
        <SubHead
          title={c.name || '(未命名)'}
          sub={`在线库 · by ${c.owner_name || '匿名'}`}
          onBack={() => setSelected(null)}
        />
        <div className="pl-body tabbed">
          <div className="pl-pad">
            {/* 封面块 */}
            <div style={{ height: 108, borderRadius: 16, marginBottom: 16, background: 'linear-gradient(135deg, rgba(201,100,66,0.28), rgba(201,100,66,0.05))', position: 'relative', display: 'flex', alignItems: 'flex-end', padding: '12px 16px' }}>
              <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: 'var(--accent)', opacity: 0.6, borderRadius: '16px 0 0 16px' }} />
              <div style={{ position: 'relative' }}>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 600, color: 'var(--text)' }}>{c.name}</div>
                {c.identity && <div style={{ fontSize: 12, color: 'var(--text-quiet)', marginTop: 3 }}>{String(c.identity).slice(0, 50)}</div>}
              </div>
            </div>

            <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--text-quiet)', lineHeight: 1.75, fontFamily: 'var(--font-serif)' }}>
              {c.personality || c.background || c.appearance || '暂无简介'}
            </p>

            <div className="pl-kvgrid" style={{ marginBottom: 16 }}>
              {[
                ['作者', c.owner_name || '匿名'],
                ['导入次数', String(c.clone_count || 0)],
                ['标签数', String((c.tags || []).length)],
                ['身份', c.identity ? String(c.identity).slice(0, 30) : '—'],
              ].map(([k, v]) => (
                <div key={k} className="pl-kv"><div className="k">{k}</div><div className="v">{v}</div></div>
              ))}
            </div>

            {tags.length > 0 && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 18 }}>
                {tags.map((tg) => <Tag key={tg} label={tg} />)}
              </div>
            )}

            <button className="pl-btn-primary" onClick={() => doImport(c)} disabled={!!importing[c.id]}
              style={{ opacity: importing[c.id] ? 0.6 : 1 }}>
              <Icon name="download" size={16} />
              {importing[c.id] ? '导入中…' : '导入到我的卡库'}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="pl-head">
        <div className="pl-head-title">
          <strong style={{ fontFamily: 'var(--font-serif)', fontSize: 20 }}>在线卡库</strong>
        </div>
        <div className="pl-head-actions">
          <button className="pl-headbtn" onClick={() => load(q)} aria-label="刷新">
            <Icon name="refresh" size={17} />
          </button>
        </div>
      </div>

      {/* 搜索 */}
      <div className="pl-toolbar">
        <div className="pl-search">
          <Icon name="search" size={15} style={{ flexShrink: 0 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(q); }}
            placeholder="搜角色名 / 身份…" />
        </div>
        <button className="pl-headbtn" onClick={() => load(q)} aria-label="搜索">
          <Icon name="search" size={16} />
        </button>
      </div>

      <div className="pl-body tabbed">
        <div className="pl-pad" style={{ paddingTop: 4 }}>
          <div className="pl-note" style={{ marginBottom: 16 }}>
            浏览其他玩家公开分享的角色卡,点「导入」会把整张卡完整复制进你的「我的角色卡」,可自由编辑。
          </div>

          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 13, marginBottom: 14 }}>
              <Icon name="warn" size={13} style={{ marginRight: 6 }} />{error}
            </div>
          )}

          {loading && items == null && <div className="pl-empty">正在加载在线角色卡…</div>}
          {!loading && items?.length === 0 && (
            <div className="pl-empty">暂无公开角色卡。你可以在「我的角色卡」中把卡设为公开,分享给大家。</div>
          )}

          <div style={{ display: 'grid', gap: 12 }}>
            {(items || []).map((c) => (
              <button key={c.id} className="pl-row" onClick={() => setSelected(c)}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  display: 'grid', placeItems: 'center',
                  font: '600 20px var(--font-serif)',
                  background: 'linear-gradient(140deg, rgba(201,100,66,0.2), rgba(201,100,66,0.04))',
                  color: 'var(--accent)',
                }}>
                  {(c.name || '?').slice(0, 1)}
                </div>
                <div className="pl-row-tx">
                  <strong className="serif">{c.name || '(未命名)'}</strong>
                  <span style={{ color: 'var(--accent)', fontSize: 11.5 }}>
                    {c.identity ? String(c.identity).slice(0, 36) : ''}
                  </span>
                  <span style={{ ...clamp2, fontSize: 11, color: 'var(--muted)' }}>
                    {(c.personality || c.background || c.appearance || '').slice(0, 80)}
                  </span>
                  <span style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', marginTop: 3 }}>
                    {(c.tags || []).slice(0, 3).map((tg) => <Tag key={tg} label={tg} />)}
                    <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--muted-2)' }}>
                      by {c.owner_name || '匿名'} · ♥ {c.clone_count || 0}
                    </span>
                  </span>
                </div>
                <button className="pl-headbtn accent" style={{ height: 36, width: 60, borderRadius: 10, fontSize: 12.5 }}
                  onClick={(e) => { e.stopPropagation(); doImport(c); }}
                  disabled={!!importing[c.id]}>
                  {importing[c.id] ? '…' : '导入'}
                </button>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   根组件 MobileCards
   pageId 区分: 'cards' → 用户卡, 'cards-npc' → NPC, 'cards-online' → 在线库
   ═══════════════════════════════════════════════════════════════════ */
export function MobileCards({ nav }) {
  // 由 pageId 决定初始 tab,也支持底部 tab pill 切换
  const initTab = () => {
    const pid = nav?.pageId || 'cards';
    if (pid === 'cards-npc') return 'npc';
    if (pid === 'cards-online') return 'online';
    return 'user';
  };
  const [tab, setTab] = useState(initTab);

  const TABS = [
    { id: 'user', l: '我的' },
    { id: 'npc', l: 'NPC' },
    { id: 'online', l: '在线库' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab 切换条(固定在顶部下方) */}
      <div className="pl-seg-scroll" style={{ flexShrink: 0, padding: '8px 16px 0', borderBottom: '1px solid var(--line-soft)', background: 'var(--bg)' }}>
        {TABS.map((t) => (
          <button key={t.id} className={'pl-pill' + (tab === t.id ? ' active' : '')} onClick={() => setTab(t.id)}>
            {t.l}
          </button>
        ))}
        <div style={{ flex: 1 }} />
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {tab === 'user' && <UserView key="user" nav={nav} />}
        {tab === 'npc' && <NpcView key="npc" nav={nav} />}
        {tab === 'online' && <OnlineView key="online" nav={nav} />}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default MobileCards;
