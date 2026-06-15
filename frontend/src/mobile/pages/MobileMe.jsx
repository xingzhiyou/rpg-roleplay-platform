/* MobileMe.jsx — 移动端"我的中心"(单文件,内部 view 状态切换)
   覆盖路由: me(个人主页) / me-edit(编辑资料) / me-settings(账户设置)
            / usage(用量) / wall(公开成就墙)
   铁律:零 Cloudscape / 零电脑端 UI 复用。数据全接 window.api.*。
   nav={go, switchTab, push, pop, toast, page, params:{section}}
   ─────────────────────────────────────────────────────────────────── */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '../icons.jsx';
import { usePlatformData, useReactiveUser, publishUser } from '../../platform-app.jsx';
import AvatarImg from '../../components/AvatarImg.jsx';

/* ── 工具函数 ────────────────────────────────────────────────────── */
const fmtN = (n) => n == null ? '—' : Number(n).toLocaleString();
const fmtWan = (n) => {
  const v = Number(n) || 0;
  if (!v) return '—';
  return v >= 10000 ? (v / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : v.toLocaleString();
};
// 统一到 window.__fmt.date(data-loader.js;YYYY-MM-DD),保留本地兜底。
const fmtDate = (iso) => {
  if (window.__fmt && window.__fmt.date) return window.__fmt.date(iso);
  if (!iso) return '—';
  try { return new Date(iso).toISOString().slice(0, 10); } catch { return '—'; }
};
const fmtAgo = (iso) => {
  if (!iso) return '—';
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return '刚刚';
    if (ms < 3_600_000) return Math.floor(ms / 60_000) + ' 分钟前';
    if (ms < 86_400_000) return Math.floor(ms / 3_600_000) + ' 小时前';
    return Math.floor(ms / 86_400_000) + ' 天前';
  } catch { return '—'; }
};

/* ── 成就分类顺序 ──────────────────────────────────────────────── */
const ACHV_CAT_ORDER = ['启程', '叙事', '探索', '收藏', '坚持', '隐藏'];
const TIER_RANK = { gold: 3, silver: 2, bronze: 1 };
const TIER_COLOR = { gold: '#d4a35c', silver: '#aab0be', bronze: '#b97a5a' };

/* ── 共用头部 ──────────────────────────────────────────────────── */
function PageHead({ title, sub, onBack, actions }) {
  return (
    <div className="pl-head">
      {onBack && (
        <button className="pl-back" onClick={onBack} aria-label="返回">
          <Icon name="chevron_left" size={20} />
        </button>
      )}
      <div className={'pl-head-title' + (onBack ? '' : ' center')}>
        <strong style={{ fontSize: 15 }}>{title}</strong>
        {sub && <span className="sub">{sub}</span>}
      </div>
      {actions && <div className="pl-head-actions">{actions}</div>}
    </div>
  );
}

/* ── Toggle 开关 ───────────────────────────────────────────────── */
function Toggle({ on, onChange, disabled }) {
  return (
    <button
      style={{
        width: 44, height: 26, borderRadius: 13, flexShrink: 0, position: 'relative',
        background: on ? 'var(--accent)' : 'var(--panel-3)',
        border: '1px solid ' + (on ? 'var(--accent-2)' : 'var(--line)'),
        transition: 'background .18s, border-color .18s',
        opacity: disabled ? 0.45 : 1,
      }}
      onClick={() => !disabled && onChange(!on)}
      role="switch" aria-checked={!!on}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 20 : 2, width: 20, height: 20, borderRadius: 10,
        background: '#fff', transition: 'left .18s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
      }} />
    </button>
  );
}

/* ── SetRow 设置行 ─────────────────────────────────────────────── */
function SetRow({ label, desc, children, danger }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderBottom: '1px solid var(--line-soft)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: danger ? 'var(--danger)' : 'var(--text)', lineHeight: 1.4 }}>{label}</div>
        {desc && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.55 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

/* ── 底部操作按钮 ──────────────────────────────────────────────── */
function ActionBtn({ label, icon, onClick, danger, loading, style: s }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 36, padding: '0 14px', borderRadius: 10,
        fontSize: 13, fontWeight: 500,
        color: danger ? 'var(--danger)' : 'var(--text-quiet)',
        background: danger ? 'var(--danger-soft)' : 'var(--panel-2)',
        border: '1px solid ' + (danger ? 'rgba(200,103,93,0.3)' : 'var(--line-soft)'),
        opacity: loading ? 0.6 : 1, flexShrink: 0, ...s,
      }}
    >
      {icon && <Icon name={icon} size={14} />}
      {loading ? '处理中…' : label}
    </button>
  );
}

/* ── 文本输入框 ────────────────────────────────────────────────── */
function Input({ label, hint, value, onChange, type = 'text', placeholder, multiline, rows = 3 }) {
  const inputStyle = {
    width: '100%', background: 'var(--panel)', border: '1px solid var(--line)',
    borderRadius: 10, color: 'var(--text)', fontSize: 16, padding: '10px 12px',
    outline: 'none', fontFamily: 'var(--font-sans)', lineHeight: 1.5,
    boxSizing: 'border-box',
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 5, letterSpacing: '0.04em' }}>{label}</div>
      {multiline ? (
        <textarea
          value={value} onChange={e => onChange(e.target.value)}
          rows={rows} placeholder={placeholder}
          style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
        />
      ) : (
        <input
          type={type} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} style={inputStyle}
        />
      )}
      {hint && <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/* ── Select ────────────────────────────────────────────────────── */
function Select({ label, value, onChange, options }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 5 }}>{label}</div>}
      <select
        value={value} onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', background: 'var(--panel)', border: '1px solid var(--line)',
          borderRadius: 10, color: 'var(--text)', fontSize: 16, padding: '10px 12px',
          outline: 'none', fontFamily: 'var(--font-sans)',
        }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/* ── 底部动作 Sheet ───────────────────────────────────────────────
   语义统一 Batch 6b GUARD:本站不收口到 mobile/Sheet.jsx。本实现是纯 inline-style 抽屉,
   与 class-based .sheet 视觉/行为不同:scrim rgba(0.6)≠.sheet-scrim(0.5)、圆角 20px≠22px、
   无 .sheet-wrap.show 的从底滑入 transform 动画。强迁会改变视觉/行为 → 按铁律保留原样。 */
function ConfirmSheet({ open, title, body, confirmLabel, onClose, onConfirm, danger, loading }) {
  if (!open) return null;
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(10,9,8,0.6)', display: 'flex', alignItems: 'flex-end' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', background: 'var(--panel)', borderRadius: '20px 20px 0 0',
          padding: '20px 18px calc(var(--safe-bottom,20px) + 16px)',
          borderTop: '1px solid var(--line)',
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line-strong)', margin: '0 auto 16px' }} />
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{title}</div>
        {body && <div style={{ fontSize: 13, color: 'var(--text-quiet)', marginBottom: 18, lineHeight: 1.65 }}>{body}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, height: 46, borderRadius: 12, fontSize: 14, fontWeight: 500, background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--text-quiet)' }}>取消</button>
          <button
            onClick={onConfirm} disabled={loading}
            style={{ flex: 1, height: 46, borderRadius: 12, fontSize: 14, fontWeight: 600, background: danger ? 'var(--danger)' : 'var(--accent)', border: 'none', color: '#fff8f3', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? '处理中…' : (confirmLabel || '确认')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   VIEW: 个人主页 Overview
   ═══════════════════════════════════════════════════════════════════ */
function ViewOverview({ nav, user }) {
  const { saves = [] } = usePlatformData();
  const [meStats, setMeStats] = useState(null);
  const [activity, setActivity] = useState(null);
  const [achv, setAchv] = useState(null);
  const [actFilter, setActFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await window.api.account.stats();
        if (!cancelled) setMeStats(r || null);
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await window.api.account.activity();
        if (!cancelled) setActivity((r && r.activity) || []);
      } catch (_) { if (!cancelled) setActivity([]); }
    })();
    return () => { cancelled = true; };
  }, [saves.length]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await window.api.account.achievements();
        if (!cancelled) setAchv((r && r.items) || []);
      } catch (_) { if (!cancelled) setAchv([]); }
    })();
    return () => { cancelled = true; };
  }, [saves.length]);

  const regAt = fmtDate(user.created_at);
  const totalRounds = meStats?.total_rounds;
  const branches = meStats?.branches;
  const importedScripts = meStats?.imported?.scripts;
  const importedWords = meStats?.imported?.words;
  const loginStreak = meStats?.login_streak;
  const longestStreak = meStats?.longest_login_streak;
  const playMinutes = meStats?.play_minutes_total;
  const playHours = playMinutes != null ? (playMinutes / 60).toFixed(1) : null;
  const playMinutesWeek = meStats?.play_minutes_week;
  const maxDepth = meStats?.max_branch_depth;

  const unlockedCount = (achv || []).filter(a => a.unlocked).length;
  const topAchv = (achv || []).filter(a => a.unlocked).sort((a, b) => (TIER_RANK[b.tier] || 0) - (TIER_RANK[a.tier] || 0)).slice(0, 6);

  const filteredAct = actFilter === 'all' ? (activity || []) : (activity || []).filter(a => a.tag === actFilter);

  return (
    <>
      <PageHead
        title="个人主页"
        actions={
          <button className="pl-headbtn" onClick={() => nav.go('me-edit')} aria-label="编辑资料">
            <Icon name="edit" size={18} />
          </button>
        }
      />
      <div className="pl-body tabbed">
        <div className="pl-pad">

          {/* Hero */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '16px 16px 14px',
            background: 'var(--panel)', border: '1px solid var(--line-soft)',
            borderRadius: 14, marginBottom: 16,
          }}>
            <AvatarImg
              src={user.avatar_url || user._raw?.avatar_url}
              name={user.display_name || user.username}
              size={56}
              shape="rounded"
              className="mc-me-avatar"
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, fontFamily: 'var(--font-serif)', color: 'var(--text)' }}>
                {user.display_name || '—'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                @{user.username || '—'}
                {user.role && <span style={{ marginLeft: 8, padding: '1px 7px', borderRadius: 999, fontSize: 10.5, background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-edge)' }}>{user.role}</span>}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-quiet)', marginTop: 5, lineHeight: 1.5 }}>
                {user.bio || <span style={{ color: 'var(--muted-2)' }}>暂无简介</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 5, fontFamily: 'var(--font-mono)' }}>
                注册于 {regAt}
              </div>
            </div>
          </div>

          {/* 统计 */}
          <div className="pl-stats" style={{ marginBottom: 16 }}>
            <div className="pl-stat">
              <span className="n accent">{playHours != null ? playHours : '—'}</span>
              <div className="l">游玩时长h{playMinutesWeek != null ? <span style={{ display: 'block', fontSize: 9 }}>+{(playMinutesWeek/60).toFixed(1)}h/周</span> : ''}</div>
            </div>
            <div className="pl-stat">
              <span className="n">{totalRounds != null ? fmtN(totalRounds) : '—'}</span>
              <div className="l">总回合</div>
            </div>
            <div className="pl-stat">
              <span className="n">{branches != null ? fmtN(branches) : '—'}</span>
              <div className="l">分支{maxDepth ? <span style={{ display: 'block', fontSize: 9 }}>最深{maxDepth}层</span> : ''}</div>
            </div>
            <div className="pl-stat">
              <span className="n">{loginStreak != null ? loginStreak : '—'}</span>
              <div className="l">连续天{longestStreak ? <span style={{ display: 'block', fontSize: 9 }}>最长{longestStreak}天</span> : ''}</div>
            </div>
          </div>
          <div className="pl-stats" style={{ marginBottom: 16 }}>
            <div className="pl-stat">
              <span className="n">{importedScripts != null ? importedScripts : '—'}</span>
              <div className="l">导入剧本</div>
            </div>
            <div className="pl-stat">
              <span className="n">{importedWords != null ? fmtWan(importedWords) : '—'}</span>
              <div className="l">导入字数</div>
            </div>
            <div className="pl-stat">
              <span className="n">{unlockedCount}</span>
              <div className="l">已解锁成就</div>
            </div>
            <div className="pl-stat">
              <span className="n">{saves.length}</span>
              <div className="l">存档</div>
            </div>
          </div>

          {/* 成就摘要 */}
          <div className="pl-sec">
            <div className="pl-sec-head">
              <h2>成就</h2>
              <button className="act" onClick={() => nav.go('wall')}>全部 <Icon name="chevron_right" size={13} /></button>
            </div>
            {achv === null ? (
              <div className="pl-empty">加载中…</div>
            ) : achv.length === 0 ? (
              <div className="pl-empty">暂无成就记录。</div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingBottom: 4 }}>
                {topAchv.map(a => (
                  <div key={a.id} title={a.name + (a.desc ? ': ' + a.desc : '')} style={{
                    display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    padding: '8px 10px', borderRadius: 10, minWidth: 60, maxWidth: 80,
                    background: 'var(--panel)', border: '1px solid ' + (TIER_COLOR[a.tier] ? TIER_COLOR[a.tier] + '55' : 'var(--line-soft)'),
                  }}>
                    <span style={{ fontSize: 20 }}>{a.icon || '🏆'}</span>
                    <span style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.3, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                  </div>
                ))}
                {(achv || []).filter(a => a.unlocked).length > 6 && (
                  <button onClick={() => nav.go('wall')} style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 60, height: 70, borderRadius: 10, flexDirection: 'column', gap: 4,
                    background: 'var(--panel)', border: '1px solid var(--line-soft)', color: 'var(--muted)', fontSize: 12,
                  }}>
                    <Icon name="more" size={16} />
                    <span style={{ fontSize: 10 }}>更多</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 最近活动 */}
          <div className="pl-sec">
            <div className="pl-sec-head">
              <h2>最近活动</h2>
            </div>
            {/* 活动筛选标签 */}
            <div style={{ display: 'flex', gap: 7, marginBottom: 10, overflowX: 'auto', paddingBottom: 2 }} className="scroll">
              {['all', '回合', '分支', '剧本'].map(f => (
                <button key={f} onClick={() => setActFilter(f)} style={{
                  flexShrink: 0, height: 28, padding: '0 12px', borderRadius: 999,
                  fontSize: 12, fontWeight: 500,
                  background: actFilter === f ? 'var(--accent-soft)' : 'var(--panel-2)',
                  color: actFilter === f ? 'var(--accent)' : 'var(--muted)',
                  border: '1px solid ' + (actFilter === f ? 'var(--accent-edge)' : 'var(--line-soft)'),
                }}>
                  {f === 'all' ? '全部' : f}
                </button>
              ))}
            </div>
            {activity === null ? (
              <div className="pl-empty">加载中…</div>
            ) : filteredAct.length === 0 ? (
              <div className="pl-empty" style={{ fontSize: 12.5 }}>
                {activity.length === 0 ? '暂无活动记录。' : '该分类暂无记录。'}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 1 }}>
                {filteredAct.slice(0, 12).map((a, i) => (
                  <div key={i} className="pl-row" style={{ margin: 0, pointerEvents: 'none' }}>
                    <span className="pl-row-ic info"><Icon name={a.icon || 'clock'} size={16} /></span>
                    <span className="pl-row-tx">
                      <strong style={{ fontSize: 13 }}>{a.text}</strong>
                      <span className="mono" style={{ fontSize: 11 }}>
                        {a.tag && <span style={{ marginRight: 6, padding: '1px 6px', borderRadius: 999, background: 'var(--panel-2)', border: '1px solid var(--line-soft)' }}>{a.tag}</span>}
                        {a.ts ? fmtAgo(a.ts) : ''}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 快捷跳转 */}
          <div className="pl-sec">
            <div className="pl-sec-head"><h2>账户管理</h2></div>
            <button className="pl-row" onClick={() => nav.go('me-edit')}>
              <span className="pl-row-ic"><Icon name="edit" size={17} /></span>
              <span className="pl-row-tx"><strong>编辑资料</strong><span>显示名、简介、头像、联系方式</span></span>
              <span className="pl-row-chev"><Icon name="chevron_right" size={17} /></span>
            </button>
            <button className="pl-row" onClick={() => nav.go('me-settings')}>
              <span className="pl-row-ic"><Icon name="settings" size={17} /></span>
              <span className="pl-row-tx"><strong>账户设置</strong><span>安全、会话、人格、数据导出</span></span>
              <span className="pl-row-chev"><Icon name="chevron_right" size={17} /></span>
            </button>
            <button className="pl-row" onClick={() => nav.go('usage')}>
              <span className="pl-row-ic info"><Icon name="usage" size={17} /></span>
              <span className="pl-row-tx"><strong>用量统计</strong><span>Token 消耗、成本、趋势图</span></span>
              <span className="pl-row-chev"><Icon name="chevron_right" size={17} /></span>
            </button>
            <button className="pl-row" onClick={() => nav.go('wall')}>
              <span className="pl-row-ic ok"><Icon name="trophy" size={17} /></span>
              <span className="pl-row-tx"><strong>成就墙</strong><span>{unlockedCount} 个已解锁</span></span>
              <span className="pl-row-chev"><Icon name="chevron_right" size={17} /></span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   VIEW: 编辑资料 Edit
   ═══════════════════════════════════════════════════════════════════ */
function ViewEdit({ nav, user }) {
  const [form, setForm] = useState({
    display_name: user.display_name || '',
    username: user.username || '',
    email: user._raw?.email || '',
    phone: user._raw?.phone || '',
    real_name: user._raw?.real_name || '',
    gender: user._raw?.gender || 'unspecified',
    birthday: user._raw?.birthday || '',
    location: user._raw?.location || '',
    website: user._raw?.website || '',
    bio: user.bio || '',
    pronouns: user._raw?.pronouns || '',
    language: user._raw?.language || 'zh-CN',
    timezone: user._raw?.timezone || 'Asia/Shanghai',
  });
  const [saving, setSaving] = useState(false);
  // 头像预览 URL：先用当前 user，上传成功后刷新
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url || user._raw?.avatar_url || null);
  const avatarRef = useRef(null);
  const u = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // 从后端拉真实资料
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await window.api.account.profile();
        if (cancelled) return;
        const src = (p && (p.profile || p.user)) || p || {};
        const keys = ['display_name', 'username', 'email', 'phone', 'real_name', 'gender', 'birthday', 'location', 'website', 'bio', 'pronouns', 'language', 'timezone'];
        const picked = {};
        for (const k of keys) if (src[k] != null) picked[k] = src[k];
        if (Object.keys(picked).length) setForm(f => ({ ...f, ...picked }));
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, []);

  const onSave = async () => {
    setSaving(true);
    try {
      await window.api.account.saveProfile(form);
      try {
        const me = await window.api?.auth?.me?.();
        if (me && me.user) {
          publishUser({ id: me.user.id, username: me.user.username, display_name: me.user.display_name || form.display_name, role: me.user.role, bio: me.user.bio ?? form.bio });
        } else {
          publishUser({ ...form });
        }
      } catch (_) { publishUser({ ...form }); }
      nav.toast('资料已保存', 'ok', 'check');
      nav.go('me');
    } catch (e) {
      nav.toast('保存失败: ' + (e?.message || ''), 'danger', 'warn');
    } finally { setSaving(false); }
  };

  const onAvatarFile = async (file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { nav.toast('文件最大 2MB', 'danger', 'warn'); return; }
    try {
      // 乐观预览：用 object URL 即时显示选中的图片
      const previewUrl = URL.createObjectURL(file);
      setAvatarUrl(previewUrl);
      const r = await window.api.account.avatar(file);
      // 上传完成后用后端返回的正式 URL 替换（若有）
      const serverUrl = r?.avatar_url || r?.url || null;
      if (serverUrl) setAvatarUrl(serverUrl);
      nav.toast('头像已更新', 'ok', 'check');
    } catch (e) {
      // 上传失败：还原到原始头像
      setAvatarUrl(user.avatar_url || user._raw?.avatar_url || null);
      nav.toast('上传失败', 'danger', 'warn');
    }
  };

  const onResetAvatar = async () => {
    try {
      await window.api.account.avatarReset();
      setAvatarUrl(null);
      nav.toast('已恢复默认头像', 'ok', 'check');
    } catch (e) { nav.toast('操作失败', 'danger', 'warn'); }
  };

  return (
    <>
      <PageHead title="编辑资料" onBack={() => nav.go('me')} />
      <div className="pl-body tabbed">
        <div className="pl-pad">

          {/* 头像 */}
          <div className="pl-sec">
            <div className="pl-sec-head"><h2>头像</h2></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0 12px' }}>
              <AvatarImg
                src={avatarUrl}
                name={form.display_name || user.display_name || user.username}
                size={64}
                shape="rounded"
                className="mc-me-avatar-edit"
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <ActionBtn label="上传新头像" icon="upload" onClick={() => avatarRef.current?.click()} />
                <ActionBtn label="恢复默认" icon="user" onClick={onResetAvatar} />
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>PNG/JPG/WEBP · 最大 2MB</div>
              </div>
            </div>
            <input ref={avatarRef} type="file" accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }} onChange={e => onAvatarFile(e.target.files?.[0])} />
          </div>

          {/* 基本资料 */}
          <div className="pl-sec">
            <div className="pl-sec-head"><h2>基本资料</h2></div>
            <Input label="显示名" hint="出现在游戏和评论里" value={form.display_name} onChange={v => u('display_name', v)} />
            <Input label="用户名" hint="登录用，6 个月可改一次" value={form.username} onChange={v => u('username', v)} />
            <Input label="真实姓名" hint="仅自己可见" value={form.real_name} onChange={v => u('real_name', v)} />
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>性别</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[{ v: 'female', l: '女' }, { v: 'male', l: '男' }, { v: 'other', l: '其他' }, { v: 'unspecified', l: '不公开' }].map(o => (
                  <button key={o.v} onClick={() => u('gender', o.v)} style={{
                    height: 34, padding: '0 16px', borderRadius: 999, fontSize: 13,
                    background: form.gender === o.v ? 'var(--accent)' : 'var(--panel)',
                    color: form.gender === o.v ? '#fff8f3' : 'var(--text-quiet)',
                    border: '1px solid ' + (form.gender === o.v ? 'var(--accent-2)' : 'var(--line-soft)'),
                  }}>{o.l}</button>
                ))}
              </div>
            </div>
            <Select label="代词" value={form.pronouns || '不公开'}
              onChange={v => u('pronouns', v)}
              options={[{ value: '她/她', label: '她/她' }, { value: '他/他', label: '他/他' }, { value: 'TA/TA', label: 'TA/TA' }, { value: '不公开', label: '不公开' }]} />
            <Input label="生日" type="date" value={form.birthday} onChange={v => u('birthday', v)} />
            <Input label="所在地" placeholder="例：上海" value={form.location} onChange={v => u('location', v)} />
            <Input label="个人网站" placeholder="https://..." value={form.website} onChange={v => u('website', v)} />
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 5 }}>简介 <span style={{ float: 'right', color: 'var(--muted-2)' }}>{form.bio.length}/280</span></div>
              <textarea
                value={form.bio} onChange={e => u('bio', e.target.value)} rows={4}
                placeholder="280 字以内"
                style={{
                  width: '100%', background: 'var(--panel)', border: '1px solid var(--line)',
                  borderRadius: 10, color: 'var(--text)', fontSize: 16, padding: '10px 12px',
                  outline: 'none', fontFamily: 'var(--font-sans)', resize: 'vertical', boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* 联系方式 */}
          <div className="pl-sec">
            <div className="pl-sec-head"><h2>联系方式</h2></div>
            <Input label="邮箱" hint="用于通知与找回密码" type="email" value={form.email} onChange={v => u('email', v)} placeholder="you@example.com" />
            <Input label="手机" hint="选填，仅自己可见" type="tel" value={form.phone} onChange={v => u('phone', v)} placeholder="选填" />
          </div>

          {/* 本地化 */}
          <div className="pl-sec">
            <div className="pl-sec-head"><h2>本地化</h2></div>
            <Select label="界面语言" value={form.language} onChange={v => u('language', v)}
              options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'zh-TW', label: '繁體中文' }, { value: 'en', label: 'English (Beta)' }, { value: 'ja', label: '日本語' }]} />
            <Select label="时区" value={form.timezone} onChange={v => u('timezone', v)}
              options={[{ value: 'Asia/Shanghai', label: 'UTC+8 · 上海' }, { value: 'Asia/Tokyo', label: 'UTC+9 · 东京' }, { value: 'UTC', label: 'UTC' }, { value: 'America/Los_Angeles', label: 'UTC-8 · 洛杉矶' }]} />
          </div>

          {/* 保存 */}
          <div style={{ display: 'flex', gap: 10, padding: '8px 0 32px' }}>
            <button onClick={() => nav.go('me')} style={{ flex: 1, height: 46, borderRadius: 12, fontSize: 14, background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--text-quiet)' }}>取消</button>
            <button onClick={onSave} disabled={saving} style={{ flex: 2, height: 46, borderRadius: 12, fontSize: 14, fontWeight: 600, background: 'var(--accent)', border: 'none', color: '#fff8f3', opacity: saving ? 0.7 : 1 }}>
              {saving ? '保存中…' : '保存资料'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   VIEW: 账户设置 Settings
   ═══════════════════════════════════════════════════════════════════ */
function ViewSettings({ nav, user }) {
  const hasPassword = user.has_password !== false;

  /* 偏好开关 */
  const [prefLoaded, setPrefLoaded] = useState(false);
  const [twofa, setTwofa] = useState(null);
  const [emailNotif, setEmailNotif] = useState(null);
  const [publicProfile, setPublicProfile] = useState(null);
  const [searchable, setSearchable] = useState(null);
  const [shareUsage, setShareUsage] = useState(null);
  const [shareCrash, setShareCrash] = useState(null);

  /* 会话/历史 */
  const [sessions, setSessions] = useState([]);
  const [loginHistory, setLoginHistory] = useState([]);

  /* 子视图 */
  const [subView, setSubView] = useState(null); // 'sessions'|'history'|'pw'|'personas'|'export'|'visibility'|'policy'|'delete-confirm'|'deact-confirm'

  /* 表单状态 */
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);
  const [exportForm, setExportForm] = useState({ scope: 'all', format: 'zip', email: '' });
  const [exportBusy, setExportBusy] = useState(false);
  const [visForm, setVisForm] = useState({ real_name: 'self', gender: 'friends', birthday: 'self', location: 'public', email: 'self', phone: 'self' });
  const [visBusy, setVisBusy] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deactBusy, setDeactBusy] = useState(false);
  const [revokeAllBusy, setRevokeAllBusy] = useState(false);

  /* 人格 */
  const [personas, setPersonas] = useState(null);
  const [personaEdit, setPersonaEdit] = useState(null); // null | persona obj
  const [personaSaving, setPersonaSaving] = useState(false);

  /* 加载偏好 */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await window.api.account.preferences();
        if (cancelled) return;
        const p = r?.preferences || r || {};
        setTwofa(p.two_fa != null ? !!p.two_fa : true);
        setEmailNotif(p.email_notif != null ? !!p.email_notif : true);
        setPublicProfile(p.public_profile != null ? !!p.public_profile : false);
        setSearchable(p.searchable != null ? !!p.searchable : true);
        setShareUsage(p.share_usage != null ? !!p.share_usage : false);
        setShareCrash(p.share_crash != null ? !!p.share_crash : true);
      } catch (_) {
        if (!cancelled) { setTwofa(true); setEmailNotif(true); setPublicProfile(false); setSearchable(true); setShareUsage(false); setShareCrash(true); }
      } finally { if (!cancelled) setPrefLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  /* 加载会话/登录历史 */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await window.api.auth.sessionsList();
        const list = r?.sessions || r?.items || [];
        if (!cancelled) setSessions(list.map(s => ({
          id: s.id || s.session_id,
          device: s.device || s.user_agent || '—',
          loc: s.location || s.loc || '—',
          ip: s.ip || s.remote_ip || '—',
          ts: fmtAgo(s.last_seen_at || s.created_at),
          current: !!s.current,
        })));
      } catch (_) {}
      try {
        const r = await window.api.auth.loginHistory();
        const list = r?.entries || r?.items || [];
        if (!cancelled) setLoginHistory(list.map(s => ({
          ts: fmtAgo(s.at),
          at: s.at,
          dev: s.user_agent || s.device || '—',
          ip: s.ip || '—',
          result: s.result || (s.ok ? 'ok' : 'blocked'),
        })));
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, []);

  /* 加载人格 */
  useEffect(() => {
    if (subView !== 'personas') return;
    let cancelled = false;
    (async () => {
      try {
        const r = await window.api.account.personas.list();
        if (!cancelled) setPersonas(r?.personas || r?.items || []);
      } catch (_) { if (!cancelled) setPersonas([]); }
    })();
    return () => { cancelled = true; };
  }, [subView]);

  /* 偏好持久化 */
  const savePref = useCallback(async (key, val) => {
    try { await window.api.account.preferences({ [key]: val }); } catch (_) {}
  }, []);

  useEffect(() => { if (twofa !== null && prefLoaded) savePref('two_fa', twofa); }, [twofa, prefLoaded]);
  useEffect(() => { if (emailNotif !== null && prefLoaded) savePref('email_notif', emailNotif); }, [emailNotif, prefLoaded]);
  useEffect(() => { if (publicProfile !== null && prefLoaded) savePref('public_profile', publicProfile); }, [publicProfile, prefLoaded]);
  useEffect(() => { if (searchable !== null && prefLoaded) savePref('searchable', searchable); }, [searchable, prefLoaded]);
  useEffect(() => { if (shareUsage !== null && prefLoaded) savePref('share_usage', shareUsage); }, [shareUsage, prefLoaded]);
  useEffect(() => { if (shareCrash !== null && prefLoaded) savePref('share_crash', shareCrash); }, [shareCrash, prefLoaded]);

  const nSess = sessions.length;
  const curSess = sessions.find(s => s.current) || sessions[0];
  const sessDesc = nSess === 0 ? '暂无活跃会话' : `${nSess} 个登录会话${curSess ? ` · 最近 ${curSess.ts}` : ''}`;

  const cutoff = Date.now() - 30 * 86_400_000;
  const okIn30d = loginHistory.filter(h => h.result === 'ok' && (() => { try { return new Date(h.at).getTime() >= cutoff; } catch { return false; } })()).length;
  const blocked = loginHistory.filter(h => h.result !== 'ok').length;
  const histDesc = loginHistory.length === 0 ? '暂无登录历史' : `近30天 ${okIn30d} 次成功${blocked ? `，${blocked} 次拦截` : ''}`;

  const onRevokeSession = async (sid) => {
    try {
      await window.api.auth.sessionsRevoke(sid);
      setSessions(s => s.filter(x => x.id !== sid));
      nav.toast('已下线', 'ok', 'check');
    } catch (e) { nav.toast('下线失败', 'danger', 'warn'); }
  };

  const onRevokeAll = async () => {
    setRevokeAllBusy(true);
    try {
      await window.api.auth.revokeAllSessions();
      setSessions(s => s.filter(x => x.current));
      nav.toast('已全部下线', 'ok', 'check');
    } catch (e) { nav.toast('操作失败', 'danger', 'warn'); }
    finally { setRevokeAllBusy(false); }
  };

  const onChangePassword = async () => {
    if (hasPassword && !pwForm.current) { nav.toast('请输入当前密码', 'danger', 'warn'); return; }
    if (!pwForm.next) { nav.toast('请输入新密码', 'danger', 'warn'); return; }
    if (pwForm.next !== pwForm.confirm) { nav.toast('两次密码不一致', 'danger', 'warn'); return; }
    setSavingPw(true);
    try {
      await window.api.auth.changePassword({ current: pwForm.current, next: pwForm.next });
      nav.toast('密码已修改', 'ok', 'check');
      setSubView(null); setPwForm({ current: '', next: '', confirm: '' });
    } catch (e) { nav.toast('修改失败: ' + (e?.message || ''), 'danger', 'warn'); }
    finally { setSavingPw(false); }
  };

  const onExportData = async () => {
    setExportBusy(true);
    try {
      const r = await window.api.account.exportData(exportForm);
      nav.toast('已申请导出，完成后邮件通知', 'ok', 'check');
      setSubView(null);
    } catch (e) { nav.toast('申请失败', 'danger', 'warn'); }
    finally { setExportBusy(false); }
  };

  const onSaveVisibility = async () => {
    setVisBusy(true);
    try {
      await window.api.account.visibility(visForm);
      nav.toast('可见性已保存', 'ok', 'check');
      setSubView(null);
    } catch (e) { nav.toast('保存失败', 'danger', 'warn'); }
    finally { setVisBusy(false); }
  };

  const onDeleteAccount = async () => {
    setDeleteBusy(true);
    try {
      await window.api.account.requestDelete();
      nav.toast('删除申请已提交', 'ok', 'check');
      setSubView(null);
    } catch (e) { nav.toast('操作失败: ' + (e?.message || ''), 'danger', 'warn'); }
    finally { setDeleteBusy(false); }
  };

  const onDeactivate = async () => {
    setDeactBusy(true);
    try {
      await window.api.account.deactivate?.();
      nav.toast('账号已停用', 'ok', 'check');
      setSubView(null);
    } catch (e) { nav.toast('操作失败: ' + (e?.message || ''), 'danger', 'warn'); }
    finally { setDeactBusy(false); }
  };

  const onPersonaSave = async () => {
    if (!personaEdit) return;
    setPersonaSaving(true);
    try {
      await window.api.account.personas.upsert(personaEdit);
      const r = await window.api.account.personas.list();
      setPersonas(r?.personas || r?.items || []);
      setPersonaEdit(null);
      nav.toast('人格已保存', 'ok', 'check');
    } catch (e) { nav.toast('保存失败', 'danger', 'warn'); }
    finally { setPersonaSaving(false); }
  };

  const onPersonaDelete = async (id) => {
    try {
      await window.api.account.personas.remove(id);
      setPersonas(ps => ps.filter(p => p.id !== id));
      nav.toast('已删除', 'ok', 'check');
    } catch (e) { nav.toast('删除失败', 'danger', 'warn'); }
  };

  /* ── 子视图渲染 ─── */
  if (subView === 'sessions') return (
    <>
      <PageHead title="活跃会话" sub={`${nSess} 个`} onBack={() => setSubView(null)} />
      <div className="pl-body tabbed">
        <div className="pl-pad">
          {sessions.length === 0 ? (
            <div className="pl-empty">暂无活跃会话</div>
          ) : sessions.map((s, i) => (
            <div key={s.id || i} className="pl-row" style={{ margin: '0 0 6px' }}>
              <span className={'pl-row-ic' + (s.current ? ' accent' : '')}><Icon name="world" size={17} /></span>
              <span className="pl-row-tx">
                <strong style={{ fontSize: 13 }}>{s.device}{s.current && <span style={{ marginLeft: 6, fontSize: 10.5, padding: '1px 6px', borderRadius: 999, background: 'var(--ok-soft)', color: 'var(--ok)', border: '1px solid rgba(126,184,142,0.3)' }}>当前</span>}</strong>
                <span className="mono">{s.loc} · {s.ip} · {s.ts}</span>
              </span>
              {!s.current && (
                <button onClick={() => onRevokeSession(s.id)} style={{ flexShrink: 0, height: 30, padding: '0 10px', borderRadius: 8, fontSize: 12, background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid rgba(200,103,93,0.3)' }}>
                  下线
                </button>
              )}
            </div>
          ))}
          {nSess > 1 && (
            <button onClick={onRevokeAll} disabled={revokeAllBusy} className="pl-btn-ghost" style={{ marginTop: 12, width: '100%' }}>
              <Icon name="logout" size={15} />{revokeAllBusy ? '处理中…' : '全部下线（保留当前）'}
            </button>
          )}
        </div>
      </div>
    </>
  );

  if (subView === 'history') return (
    <>
      <PageHead title="登录历史" sub={`${loginHistory.length} 条`} onBack={() => setSubView(null)} />
      <div className="pl-body tabbed">
        <div className="pl-pad">
          {loginHistory.length === 0 ? <div className="pl-empty">暂无登录记录</div> :
            loginHistory.map((r, i) => (
              <div key={i} className="pl-row" style={{ margin: '0 0 5px' }}>
                <span className={'pl-row-ic ' + (r.result === 'ok' ? 'ok' : 'warn')}><Icon name={r.result === 'ok' ? 'check' : 'shield'} size={16} /></span>
                <span className="pl-row-tx">
                  <strong style={{ fontSize: 12.5 }}>{r.dev}</strong>
                  <span className="mono">{r.ip} · {r.ts}</span>
                </span>
                <span style={{ flexShrink: 0, fontSize: 11, padding: '2px 8px', borderRadius: 999, background: r.result === 'ok' ? 'var(--ok-soft)' : 'var(--danger-soft)', color: r.result === 'ok' ? 'var(--ok)' : 'var(--danger)', border: '1px solid ' + (r.result === 'ok' ? 'rgba(126,184,142,0.3)' : 'rgba(200,103,93,0.3)') }}>
                  {r.result === 'ok' ? '成功' : '拦截'}
                </span>
              </div>
            ))
          }
        </div>
      </div>
    </>
  );

  if (subView === 'pw') return (
    <>
      <PageHead title={hasPassword ? '修改密码' : '设置密码'} onBack={() => setSubView(null)} />
      <div className="pl-body tabbed">
        <div className="pl-pad">
          <div className="pl-sec" style={{ paddingTop: 8 }}>
            {hasPassword && (
              <Input label="当前密码" type="password" value={pwForm.current} onChange={v => setPwForm(f => ({ ...f, current: v }))} />
            )}
            <Input label="新密码" hint="至少 12 位 · 含大小写 + 数字" type="password" value={pwForm.next} onChange={v => setPwForm(f => ({ ...f, next: v }))} />
            <Input label="确认新密码" type="password" value={pwForm.confirm} onChange={v => setPwForm(f => ({ ...f, confirm: v }))} />
          </div>
          <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
            <button onClick={() => setSubView(null)} style={{ flex: 1, height: 46, borderRadius: 12, fontSize: 14, background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--text-quiet)' }}>取消</button>
            <button onClick={onChangePassword} disabled={savingPw} style={{ flex: 2, height: 46, borderRadius: 12, fontSize: 14, fontWeight: 600, background: 'var(--accent)', border: 'none', color: '#fff8f3', opacity: savingPw ? 0.7 : 1 }}>
              {savingPw ? '修改中…' : (hasPassword ? '修改密码' : '设置密码')}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  if (subView === 'personas') return (
    <>
      <PageHead
        title="人格 Persona"
        onBack={() => { setSubView(null); setPersonaEdit(null); }}
        actions={
          <button className="pl-headbtn" onClick={() => setPersonaEdit({ id: '', name: '', description: '', prompt: '' })} aria-label="新建">
            <Icon name="plus" size={18} />
          </button>
        }
      />
      <div className="pl-body tabbed">
        <div className="pl-pad">
          {personaEdit && (
            <div style={{ background: 'var(--panel)', border: '1px solid var(--accent-edge)', borderRadius: 14, padding: '14px 14px 10px', marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginBottom: 12 }}>{personaEdit.id ? '编辑人格' : '新建人格'}</div>
              <Input label="名称" value={personaEdit.name || ''} onChange={v => setPersonaEdit(p => ({ ...p, name: v }))} />
              <Input label="简介" value={personaEdit.description || ''} onChange={v => setPersonaEdit(p => ({ ...p, description: v }))} />
              <Input label="提示词" multiline value={personaEdit.prompt || ''} onChange={v => setPersonaEdit(p => ({ ...p, prompt: v }))} rows={4} />
              <div style={{ display: 'flex', gap: 9 }}>
                <button onClick={() => setPersonaEdit(null)} style={{ flex: 1, height: 40, borderRadius: 10, fontSize: 13, background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--text-quiet)' }}>取消</button>
                <button onClick={onPersonaSave} disabled={personaSaving} style={{ flex: 2, height: 40, borderRadius: 10, fontSize: 13, fontWeight: 600, background: 'var(--accent)', border: 'none', color: '#fff8f3', opacity: personaSaving ? 0.7 : 1 }}>
                  {personaSaving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          )}
          {personas === null ? (
            <div className="pl-empty">加载中…</div>
          ) : personas.length === 0 ? (
            <div className="pl-empty">暂无人格。点击右上角新建。</div>
          ) : personas.map(p => (
            <div key={p.id} className="pl-row" style={{ margin: '0 0 6px', alignItems: 'flex-start' }}>
              <span className="pl-row-ic"><Icon name="user" size={17} /></span>
              <span className="pl-row-tx">
                <strong>{p.name || '未命名'}</strong>
                {p.description && <span style={{ fontSize: 12 }}>{p.description}</span>}
                {p.prompt && <span className="mono" style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.prompt}</span>}
              </span>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => setPersonaEdit({ ...p })} style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--panel-2)', border: '1px solid var(--line-soft)', color: 'var(--muted)', display: 'grid', placeItems: 'center' }}>
                  <Icon name="edit" size={14} />
                </button>
                <button onClick={() => onPersonaDelete(p.id)} style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--danger-soft)', border: '1px solid rgba(200,103,93,0.3)', color: 'var(--danger)', display: 'grid', placeItems: 'center' }}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  if (subView === 'export') return (
    <>
      <PageHead title="导出数据" onBack={() => setSubView(null)} />
      <div className="pl-body tabbed">
        <div className="pl-pad">
          <div className="pl-sec" style={{ paddingTop: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.7 }}>
              打包导出全部剧本、存档、记忆、库资产、用量记录。生成后通过邮件发送下载链接（7 天有效）。
            </div>
            <Select label="范围" value={exportForm.scope} onChange={v => setExportForm(f => ({ ...f, scope: v }))}
              options={[{ value: 'all', label: '全部 · 剧本 · 存档 · 库 · 用量' }, { value: 'scripts', label: '仅剧本与章节' }, { value: 'saves', label: '仅存档与分支' }, { value: 'library', label: '仅库资产' }, { value: 'usage', label: '仅用量日志' }]} />
            <Select label="格式" value={exportForm.format} onChange={v => setExportForm(f => ({ ...f, format: v }))}
              options={[{ value: 'zip', label: 'ZIP · 含 JSON + 附件' }, { value: 'json', label: 'JSON · 仅元数据' }]} />
            <Input label="接收邮箱" type="email" value={exportForm.email} onChange={v => setExportForm(f => ({ ...f, email: v }))} placeholder="用于接收下载链接" />
          </div>
          <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
            <button onClick={() => setSubView(null)} style={{ flex: 1, height: 46, borderRadius: 12, fontSize: 14, background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--text-quiet)' }}>取消</button>
            <button onClick={onExportData} disabled={exportBusy} style={{ flex: 2, height: 46, borderRadius: 12, fontSize: 14, fontWeight: 600, background: 'var(--accent)', border: 'none', color: '#fff8f3', opacity: exportBusy ? 0.7 : 1 }}>
              {exportBusy ? '申请中…' : '申请导出'}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  if (subView === 'visibility') return (
    <>
      <PageHead title="资料可见性" onBack={() => setSubView(null)} />
      <div className="pl-body tabbed">
        <div className="pl-pad">
          <div className="pl-sec" style={{ paddingTop: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>逐项控制谁能看到你的个人资料字段。</div>
            {[{ k: 'real_name', l: '真实姓名' }, { k: 'gender', l: '性别' }, { k: 'birthday', l: '生日' }, { k: 'location', l: '所在地' }, { k: 'email', l: '邮箱' }, { k: 'phone', l: '手机' }].map(({ k, l }) => (
              <Select key={k} label={l} value={visForm[k] || 'self'} onChange={v => setVisForm(f => ({ ...f, [k]: v }))}
                options={[{ value: 'self', label: '仅自己' }, { value: 'friends', label: '好友' }, { value: 'public', label: '所有人' }]} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
            <button onClick={() => setSubView(null)} style={{ flex: 1, height: 46, borderRadius: 12, fontSize: 14, background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--text-quiet)' }}>取消</button>
            <button onClick={onSaveVisibility} disabled={visBusy} style={{ flex: 2, height: 46, borderRadius: 12, fontSize: 14, fontWeight: 600, background: 'var(--accent)', border: 'none', color: '#fff8f3', opacity: visBusy ? 0.7 : 1 }}>
              {visBusy ? '保存中…' : '保存可见性'}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  if (subView === 'policy') return (
    <>
      <PageHead title="隐私政策" onBack={() => setSubView(null)} />
      <div className="pl-body tabbed">
        <div className="pl-pad">
          <div style={{ fontSize: 13.5, lineHeight: 1.8, color: 'var(--text-quiet)' }}>
            <p><strong style={{ color: 'var(--text)' }}>1. 我们收集什么</strong><br />账号信息（用户名、邮箱、可选手机）、设备指纹（用于会话）、用量遥测（仅在你开启时）。</p>
            <p><strong style={{ color: 'var(--text)' }}>2. 我们不收集什么</strong><br />剧本正文、玩家变量、私聊、长期记忆、世界书条目——这些数据加密存储在你的工作区，团队无任何访问。</p>
            <p><strong style={{ color: 'var(--text)' }}>3. 与第三方</strong><br />不向第三方分享剧本内容。模型 API 调用按你配置直接发往对应厂商，团队不代理也不留存。</p>
            <p><strong style={{ color: 'var(--text)' }}>4. 数据所有权</strong><br />你可以随时申请完整归档；可随时停用账号（90 天保留）或永久删除（立刻执行）。</p>
            <p><strong style={{ color: 'var(--text)' }}>5. 合规</strong><br />本平台符合 GDPR · 中国《个人信息保护法》· 加州 CCPA。</p>
          </div>
          <button onClick={() => setSubView(null)} className="pl-btn-primary" style={{ width: '100%', marginTop: 20 }}>我已阅读</button>
        </div>
      </div>
    </>
  );

  /* ── 主设置页 ─── */
  return (
    <>
      <PageHead title="账户设置" onBack={() => nav.go('me')} />
      <div className="pl-body tabbed">
        <div className="pl-pad">

          {/* 隐私 · 公开范围 */}
          <div className="pl-sec">
            <div className="pl-sec-head"><h2>隐私 · 公开范围</h2></div>
            <SetRow label="公开个人主页" desc="开启后，他人可通过 @用户名 查看你的成就墙和最近活动。">
              <Toggle on={!!publicProfile} onChange={v => setPublicProfile(v)} disabled={!prefLoaded} />
            </SetRow>
            <SetRow label="允许搜索" desc="允许通过显示名或用户名在平台内搜索找到你。">
              <Toggle on={!!searchable} onChange={v => setSearchable(v)} disabled={!prefLoaded} />
            </SetRow>
            <SetRow label="资料字段可见性" desc="逐项控制谁能看到你的真实姓名、所在地、生日等。">
              <ActionBtn label="逐项配置" icon="sliders" onClick={() => setSubView('visibility')} />
            </SetRow>
          </div>

          {/* 账号 · 安全 */}
          <div className="pl-sec">
            <div className="pl-sec-head"><h2>账号 · 安全</h2></div>
            <SetRow label={hasPassword ? '修改密码' : '设置密码'} desc={hasPassword ? '建议每 90 天更换，至少 12 位 + 大小写 + 数字。' : '当前通过邮箱链接登录，尚未设置密码。'}>
              <ActionBtn label={hasPassword ? '修改密码' : '设置密码'} icon="lock" onClick={() => setSubView('pw')} />
            </SetRow>
            <SetRow label="二次验证（2FA）" desc="通过 Authenticator App 或手机短信进行二次验证。">
              <Toggle on={!!twofa} onChange={v => setTwofa(v)} disabled={!prefLoaded} />
            </SetRow>
            <SetRow label="活跃会话" desc={sessDesc}>
              <ActionBtn label="查看会话" icon="eye" onClick={() => setSubView('sessions')} />
            </SetRow>
            <SetRow label="登录历史" desc={histDesc}>
              <ActionBtn label="查看日志" icon="history" onClick={() => setSubView('history')} />
            </SetRow>
          </div>

          {/* 人格 Persona */}
          <div className="pl-sec">
            <div className="pl-sec-head"><h2>人格 Persona</h2></div>
            <SetRow label="我的人格" desc="在游戏中使用的玩家人格设定，可创建多个切换。">
              <ActionBtn label="管理人格" icon="user" onClick={() => setSubView('personas')} />
            </SetRow>
          </div>

          {/* 通知 */}
          <div className="pl-sec">
            <div className="pl-sec-head"><h2>通知</h2></div>
            <SetRow label="邮件通知" desc="重要安全事件、订阅变更、长时间未登录提醒。">
              <Toggle on={!!emailNotif} onChange={v => setEmailNotif(v)} disabled={!prefLoaded} />
            </SetRow>
          </div>

          {/* 数据共享 */}
          <div className="pl-sec">
            <div className="pl-sec-head"><h2>数据共享 · 合规</h2></div>
            <SetRow label="匿名用量统计" desc="将按钮点击/页面停留时长（不含剧本内容）匿名上报，用于改进体验。">
              <Toggle on={!!shareUsage} onChange={v => setShareUsage(v)} disabled={!prefLoaded} />
            </SetRow>
            <SetRow label="崩溃 / 错误报告" desc="出现错误时上传堆栈信息和最近操作，剧本内容不会被上传。">
              <Toggle on={!!shareCrash} onChange={v => setShareCrash(v)} disabled={!prefLoaded} />
            </SetRow>
            <SetRow label="GDPR / 隐私政策">
              <ActionBtn label="查看政策" icon="file" onClick={() => setSubView('policy')} />
            </SetRow>
          </div>

          {/* 数据所有权 */}
          <div className="pl-sec">
            <div className="pl-sec-head"><h2>数据所有权</h2></div>
            <SetRow label="导出我的数据" desc="打包导出全部剧本、存档、记忆、库资产、用量记录。">
              <ActionBtn label="申请导出" icon="download" onClick={() => setSubView('export')} />
            </SetRow>
            <SetRow label="停用账号" desc="停用后无法登录，剧本和存档保留 90 天，期间可随时恢复。">
              <ActionBtn label="停用账号" onClick={() => setSubView('deact-confirm')} />
            </SetRow>
            <SetRow label="永久删除账号" desc="立刻删除全部账号信息、剧本、存档，无法恢复。" danger>
              <ActionBtn label="删除账号" icon="trash" danger onClick={() => setSubView('delete-confirm')} />
            </SetRow>
          </div>

        </div>
      </div>

      {/* 停用确认 Sheet */}
      <ConfirmSheet
        open={subView === 'deact-confirm'}
        title="停用账号？"
        body="账号停用 90 天内可登录恢复。期间剧本与存档保留但不可访问。"
        confirmLabel="停用"
        onClose={() => setSubView(null)}
        onConfirm={onDeactivate}
        loading={deactBusy}
      />

      {/* 删除确认 Sheet */}
      {subView === 'delete-confirm' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(10,9,8,0.6)', display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ width: '100%', background: 'var(--panel)', borderRadius: '20px 20px 0 0', padding: '20px 18px calc(var(--safe-bottom,20px) + 16px)', borderTop: '1px solid var(--line)' }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line-strong)', margin: '0 auto 16px' }} />
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, color: 'var(--danger)' }}>永久删除账号？</div>
            <div style={{ fontSize: 13, color: 'var(--text-quiet)', marginBottom: 16, lineHeight: 1.7 }}>
              这会<strong style={{ color: 'var(--danger)' }}>立刻</strong>删除你的账号、剧本、存档、库资产，<strong style={{ color: 'var(--danger)' }}>无法恢复</strong>。<br />删除后无法用同一邮箱再注册（30 天冷冻期）。
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>输入"确认删除"以继续</div>
              <input
                value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="确认删除"
                style={{ width: '100%', background: 'var(--panel-2)', border: '1px solid var(--danger)', borderRadius: 10, color: 'var(--text)', fontSize: 16, padding: '10px 12px', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setSubView(null); setDeleteConfirmText(''); }} style={{ flex: 1, height: 46, borderRadius: 12, fontSize: 14, background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--text-quiet)' }}>取消</button>
              <button
                onClick={onDeleteAccount} disabled={deleteConfirmText !== '确认删除' || deleteBusy}
                style={{ flex: 1, height: 46, borderRadius: 12, fontSize: 14, fontWeight: 600, background: 'var(--danger)', border: 'none', color: '#fff', opacity: (deleteConfirmText !== '确认删除' || deleteBusy) ? 0.45 : 1 }}
              >
                {deleteBusy ? '处理中…' : '永久删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   VIEW: 用量统计 Usage
   ═══════════════════════════════════════════════════════════════════ */
const USAGE_RANGES = [
  { id: '7d', label: '7 天', days: 7 },
  { id: '30d', label: '30 天', days: 30 },
  { id: '90d', label: '90 天', days: 90 },
];

function BarChart({ buckets, valueKey, color, height = 60 }) {
  if (!buckets || buckets.length === 0) return null;
  const vals = buckets.map(b => Number(b[valueKey] || 0));
  const maxV = Math.max(...vals, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height, padding: '0 2px' }}>
      {vals.map((v, i) => (
        <div key={i} title={`${buckets[i]?.date || i}: ${fmtN(v)}`} style={{
          flex: 1, minWidth: 2, borderRadius: '2px 2px 0 0',
          height: Math.max(2, Math.round((v / maxV) * height)),
          background: color || 'var(--accent)',
          opacity: 0.8,
        }} />
      ))}
    </div>
  );
}

function ViewUsage({ nav }) {
  const [range, setRange] = useState('30d');
  const [data, setData] = useState(null);
  const [series, setSeries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const days = USAGE_RANGES.find(r => r.id === range)?.days || 30;

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr('');
    (async () => {
      try {
        const [u, t] = await Promise.all([
          window.api.account.usage(days),
          window.api.account.usageTimeline(days, 'day'),
        ]);
        if (!cancelled) { setData(u || null); setSeries(t || null); }
      } catch (e) {
        if (!cancelled) setErr(e?.message || '拉取用量失败');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [days]);

  const totals = data?.totals || {};
  const byModel = data?.by_model || [];
  const forecast = data?.forecast || null;
  const buckets = series?.series || [];
  const byScenario = data?.by_scenario || null;

  const totalTurns = Number(totals.turns || 0);
  const totalTokIn = Number(totals.input_tokens || 0);
  const totalTokOut = Number(totals.output_tokens || 0);
  const totalCost = Number(totals.cost_usd || 0);
  const totalCachedIn = Number(totals.cached_input_tokens || 0);

  const SCENARIO_META = { chat: { l: '对话', ic: 'feedback' }, opening: { l: '开场', ic: 'play' }, extract: { l: '提取', ic: 'search' }, embedding: { l: '向量化', ic: 'layers' }, assistant: { l: '助手', ic: 'sparkle' }, tool: { l: '工具', ic: 'plug' } };

  return (
    <>
      <PageHead
        title="用量统计"
        onBack={() => nav.go('me')}
        actions={
          <button className="pl-headbtn" onClick={() => setRange(r => { const idx = USAGE_RANGES.findIndex(x => x.id === r); return USAGE_RANGES[(idx + 1) % USAGE_RANGES.length].id; })} aria-label="切换时间范围">
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{USAGE_RANGES.find(r2 => r2.id === range)?.label}</span>
          </button>
        }
      />
      <div className="pl-body tabbed">
        <div className="pl-pad">

          {/* 时间范围选择 */}
          <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
            {USAGE_RANGES.map(r => (
              <button key={r.id} onClick={() => setRange(r.id)} style={{
                flex: 1, height: 34, borderRadius: 999, fontSize: 12.5, fontWeight: 500,
                background: range === r.id ? 'var(--accent-soft)' : 'var(--panel-2)',
                color: range === r.id ? 'var(--accent)' : 'var(--muted)',
                border: '1px solid ' + (range === r.id ? 'var(--accent-edge)' : 'var(--line-soft)'),
              }}>{r.label}</button>
            ))}
          </div>

          {err && (
            <div className="pl-row" style={{ margin: '0 0 14px', background: 'var(--danger-soft)', borderRadius: 10 }}>
              <span className="pl-row-ic warn"><Icon name="warn" size={16} /></span>
              <span className="pl-row-tx"><strong>{err}</strong></span>
            </div>
          )}

          {loading && !data && <div className="pl-empty">加载中…</div>}

          {/* 核心统计 */}
          <div className="pl-stats" style={{ marginBottom: 14 }}>
            <div className="pl-stat">
              <span className="n accent">{fmtN(totalTurns)}</span>
              <div className="l">请求数{totalTurns ? <span style={{ display: 'block', fontSize: 9 }}>日均{Math.round(totalTurns/days)}</span> : ''}</div>
            </div>
            <div className="pl-stat">
              <span className="n">{fmtN(totalTokIn)}</span>
              <div className="l">输入Token</div>
            </div>
            <div className="pl-stat">
              <span className="n">{fmtN(totalTokOut)}</span>
              <div className="l">输出Token</div>
            </div>
            <div className="pl-stat">
              <span className="n">${totalCost.toFixed(2)}</span>
              <div className="l">成本</div>
            </div>
          </div>
          <div className="pl-stats" style={{ marginBottom: 16 }}>
            <div className="pl-stat">
              <span className="n">{totalCachedIn ? fmtN(totalCachedIn) : '—'}</span>
              <div className="l">缓存输入{totalTokIn > 0 && totalCachedIn ? <span style={{ display: 'block', fontSize: 9 }}>{Math.round(totalCachedIn/totalTokIn*100)}%占比</span> : ''}</div>
            </div>
            <div className="pl-stat">
              <span className="n">
                {totalCachedIn > 0 && totalTokIn > 0 ? '$' + ((totalCachedIn / totalTokIn) * totalCost * 0.75).toFixed(3) : '—'}
              </span>
              <div className="l">缓存节省</div>
            </div>
            {forecast && <div className="pl-stat">
              <span className="n">${Number(forecast.avg_daily_cost_usd || 0).toFixed(3)}</span>
              <div className="l">日均成本</div>
            </div>}
            {forecast && <div className="pl-stat">
              <span className="n">${Number(forecast.projected_30d_cost || 0).toFixed(2)}</span>
              <div className="l">30天预测</div>
            </div>}
          </div>

          {/* 趋势图 */}
          {buckets.length > 0 && (
            <div className="pl-sec">
              <div className="pl-sec-head"><h2>趋势</h2></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>请求数 <span className="mono" style={{ float: 'right' }}>{fmtN(buckets.reduce((a, b) => a + Number(b.turns || 0), 0))}</span></div>
                  <BarChart buckets={buckets} valueKey="turns" color="var(--accent)" />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>成本 $<span className="mono" style={{ float: 'right' }}>{buckets.reduce((a, b) => a + Number(b.cost_usd || 0), 0).toFixed(2)}</span></div>
                  <BarChart buckets={buckets} valueKey="cost_usd" color="var(--ok)" />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>输入 Token <span className="mono" style={{ float: 'right' }}>{fmtN(buckets.reduce((a, b) => a + Number(b.input_tokens || 0), 0))}</span></div>
                  <BarChart buckets={buckets} valueKey="input_tokens" color="var(--info)" />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>输出 Token <span className="mono" style={{ float: 'right' }}>{fmtN(buckets.reduce((a, b) => a + Number(b.output_tokens || 0), 0))}</span></div>
                  <BarChart buckets={buckets} valueKey="output_tokens" color="var(--warn)" />
                </div>
              </div>
            </div>
          )}

          {/* 按场景拆分 */}
          {byScenario && Object.keys(byScenario).length > 0 && (
            <div className="pl-sec">
              <div className="pl-sec-head"><h2>按场景</h2></div>
              {(() => {
                const keys = Object.keys(byScenario);
                const totalSc = keys.reduce((s, k) => s + Number(byScenario[k]?.turns || 0), 0) || 1;
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {keys.map(k => {
                      const meta = SCENARIO_META[k] || { l: k, ic: 'chart' };
                      const sc = byScenario[k] || {};
                      const turns = Number(sc.turns || 0);
                      const cost = Number(sc.cost_usd || 0);
                      const pct = Math.round(turns / totalSc * 100);
                      return (
                        <div key={k} style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--line-soft)' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{meta.l}</div>
                          <div className="mono" style={{ fontSize: 17, fontWeight: 700 }}>{fmtN(turns)}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted-2)' }}>${cost.toFixed(3)}</div>
                          <div style={{ marginTop: 6, height: 3, borderRadius: 999, background: 'var(--panel-3)', overflow: 'hidden' }}>
                            <div style={{ width: pct + '%', height: '100%', background: 'var(--accent)', borderRadius: 999 }} />
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--muted-2)', marginTop: 2 }}>{pct}%</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* 按模型拆分 */}
          {byModel.length > 0 && (
            <div className="pl-sec">
              <div className="pl-sec-head"><h2>按模型</h2></div>
              {byModel.map((m, i) => (
                <div key={i} className="pl-row" style={{ margin: '0 0 5px', pointerEvents: 'none' }}>
                  <span className="pl-row-ic info"><Icon name="sparkle" size={15} /></span>
                  <span className="pl-row-tx">
                    <strong className="mono" style={{ fontSize: 12 }}>{m.model_id || m.api_id || '—'}</strong>
                    <span className="mono" style={{ fontSize: 11 }}>
                      {fmtN(Number(m.turns || 0))} 次 · {fmtN(Number(m.input_tokens || 0))}↑ {fmtN(Number(m.output_tokens || 0))}↓ · ${Number(m.cost_usd || 0).toFixed(3)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   VIEW: 成就墙 Wall
   ═══════════════════════════════════════════════════════════════════ */
function ViewWall({ nav, user }) {
  const [achv, setAchv] = useState(null);
  const [err, setErr] = useState('');
  // 支持查看他人公开墙：从 nav.params.username 读 or 查自己
  const targetUser = (nav.params && nav.params.username) || null;
  const isOther = !!targetUser && targetUser !== user?.username;

  useEffect(() => {
    let cancelled = false;
    setErr('');
    (async () => {
      try {
        if (isOther) {
          const r = await window.api.account.publicWall(targetUser);
          if (!cancelled) setAchv(r);
        } else {
          const r = await window.api.account.achievements();
          if (!cancelled) setAchv({ items: (r && r.items) || [], display_name: user?.display_name, username: user?.username, unlocked_count: ((r && r.items) || []).filter(a => a.unlocked).length, total: ((r && r.items) || []).length });
        }
      } catch (e) {
        if (!cancelled) setErr((e && e.message) || '加载失败');
      }
    })();
    return () => { cancelled = true; };
  }, [isOther, targetUser]);

  const items = achv?.items || [];
  const unlockedCount = achv?.unlocked_count ?? items.filter(a => a.unlocked).length;
  const total = achv?.total ?? items.length;

  // 按分类分组
  const groups = (() => {
    const m = new Map();
    items.forEach(a => {
      const cat = a.category || '其他';
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat).push(a);
    });
    return [...m.keys()]
      .sort((x, y) => (ACHV_CAT_ORDER.indexOf(x) < 0 ? 99 : ACHV_CAT_ORDER.indexOf(x)) - (ACHV_CAT_ORDER.indexOf(y) < 0 ? 99 : ACHV_CAT_ORDER.indexOf(y)))
      .map(k => [k, m.get(k)]);
  })();

  const onCopyWallLink = async () => {
    const u = user?.username || '';
    const url = `${location.origin}/wall?u=${encodeURIComponent(u)}`;
    try {
      await navigator.clipboard.writeText(url);
      nav.toast('链接已复制', 'ok', 'copy');
    } catch (_) {
      nav.toast(url, 'ok', 'info');
    }
  };

  return (
    <>
      <PageHead
        title={isOther ? (achv?.display_name || targetUser || '成就墙') : '我的成就墙'}
        sub={achv ? `${unlockedCount} / ${total} 已解锁` : '加载中…'}
        onBack={() => nav.go('me')}
        actions={!isOther && unlockedCount > 0 && (
          <button className="pl-headbtn" onClick={onCopyWallLink} aria-label="分享链接">
            <Icon name="link" size={17} />
          </button>
        )}
      />
      <div className="pl-body tabbed">
        <div className="pl-pad">
          {err ? (
            <div className="pl-empty">{err.includes('404') || err.includes('not found') ? '该用户未公开成就墙，或不存在。' : err}</div>
          ) : achv === null ? (
            <div className="pl-empty">加载中…</div>
          ) : items.length === 0 ? (
            <div className="pl-empty">暂无成就记录。</div>
          ) : (
            groups.map(([cat, list]) => {
              const unl = list.filter(a => a.unlocked).length;
              return (
                <div key={cat} className="pl-sec">
                  <div className="pl-sec-head">
                    <h2>{cat}</h2>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--muted-2)' }}>{unl}/{list.length}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {list.map(a => (
                      <div key={a.id} style={{
                        padding: '10px 11px', borderRadius: 10,
                        background: a.unlocked ? 'var(--panel)' : 'var(--bg)',
                        border: '1px solid ' + (a.unlocked ? (TIER_COLOR[a.tier] ? TIER_COLOR[a.tier] + '66' : 'var(--line-soft)') : 'var(--line-soft)'),
                        opacity: a.unlocked ? 1 : 0.55,
                        display: 'flex', gap: 9, alignItems: 'flex-start',
                      }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                          display: 'grid', placeItems: 'center', fontSize: 18,
                          background: a.unlocked ? (TIER_COLOR[a.tier] ? TIER_COLOR[a.tier] + '22' : 'var(--panel-2)') : 'var(--panel-3)',
                          border: '1px solid ' + (a.unlocked && TIER_COLOR[a.tier] ? TIER_COLOR[a.tier] + '44' : 'var(--line-soft)'),
                        }}>
                          {a.icon ? a.icon : (a.unlocked ? <Icon name="check" size={14} /> : <Icon name="lock" size={12} />)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>{a.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, lineHeight: 1.4 }}>{a.desc}</div>
                          {a.unlocked ? (
                            <div className="mono" style={{ fontSize: 10, color: TIER_COLOR[a.tier] || 'var(--ok)', marginTop: 3 }}>
                              {a.unlocked_at ? fmtDate(a.unlocked_at) : '✓ 已达成'}
                              {a.rarity != null ? ` · ${a.rarity}%` : ''}
                            </div>
                          ) : (
                            a.target != null && (
                              <div style={{ marginTop: 5 }}>
                                <div style={{ height: 3, borderRadius: 2, background: 'var(--panel-3)', overflow: 'hidden', marginBottom: 2 }}>
                                  <div style={{ width: (a.pct || 0) + '%', height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
                                </div>
                                <div className="mono" style={{ fontSize: 10, color: 'var(--muted-2)' }}>
                                  {Number(a.value || 0).toLocaleString()} / {Number(a.target || 0).toLocaleString()}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   主组件 MobileMe
   ═══════════════════════════════════════════════════════════════════ */
export function MobileMe({ nav }) {
  const user = useReactiveUser();

  // 初始 view 由 nav.page 决定
  const [view, setView] = useState(() => {
    const p = nav?.page || 'me';
    if (p === 'me-edit') return 'edit';
    if (p === 'me-settings') return 'settings';
    if (p === 'usage') return 'usage';
    if (p === 'wall') return 'wall';
    return 'overview';
  });

  // 包装 nav.go 使内部可跳转到同组件的其他 view
  const innerNav = {
    ...nav,
    go: (pageId) => {
      const viewMap = { me: 'overview', 'me-edit': 'edit', 'me-settings': 'settings', usage: 'usage', wall: 'wall' };
      if (viewMap[pageId] !== undefined) {
        setView(viewMap[pageId]);
      } else {
        nav.go?.(pageId);
      }
    },
  };

  if (view === 'edit') return <ViewEdit nav={innerNav} user={user} />;
  if (view === 'settings') return <ViewSettings nav={innerNav} user={user} />;
  if (view === 'usage') return <ViewUsage nav={innerNav} />;
  if (view === 'wall') return <ViewWall nav={innerNav} user={user} />;
  return <ViewOverview nav={innerNav} user={user} />;
}

export default MobileMe;
