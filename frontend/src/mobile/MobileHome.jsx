/* MobileHome — 移动端主页(home Tab 根)。
   设计稿 HomePage 的 ESM 实现,接真实数据:usePlatformData()/useReactiveUser()。
   继续游戏 → 同标签进入游戏台;统计/最近剧本/最近存档/快捷入口全接真数据。 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { Icon } from './icons.jsx';
import { launchSave } from './launch.js';
import { usePlatformData, useReactiveUser } from '../platform-app.jsx';

const fmtWan = (w) => {
  const n = Number(w) || 0;
  return n > 0 ? (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + ' ' + i18n.t('mobile.home.wan_suffix') : '—';
};
// null 安全千分位统一到 window.__fmt.n(data-loader.js),保留本地兜底。
const fmtN = (n) => (window.__fmt && window.__fmt.n)
  ? window.__fmt.n(n)
  : (n == null ? '—' : (typeof n === 'number' ? n.toLocaleString() : String(n)));

export function MobileHome({ nav }) {
  const { t } = useTranslation();
  const platform = usePlatformData();
  const user = useReactiveUser();
  const scripts = Array.isArray(platform.scripts) ? platform.scripts : [];
  // 存档 = 游戏模式专属;酒馆会话(save_kind='tavern')不算存档(继续游戏/最近存档都不该指向它)。
  const saves = (Array.isArray(platform.saves) ? platform.saves : []).filter((s) => (s && (s.save_kind || 'game')) !== 'tavern');
  const stats = platform.stats || {};
  const database = platform.database || {};

  const hr = (() => { try { return new Date().getHours(); } catch (_) { return 12; } })();
  const greet = hr < 5 ? t('mobile.home.greet.late_night') : hr < 11 ? t('mobile.home.greet.morning') : hr < 14 ? t('mobile.home.greet.noon') : hr < 18 ? t('mobile.home.greet.afternoon') : t('mobile.home.greet.evening');
  const name = user.display_name || t('mobile.home.default_name');

  const cur = saves.find((s) => s && s.current) || saves[0] || null;
  const scriptOf = (s) => (s ? scripts.find((sc) => sc && sc.id === s.script_id) : null);
  const branchAgg = saves.reduce((a, s) => a + (Number(s && s.branch_count) || 0), 0);
  const wordTotal = scripts.reduce((a, s) => a + (Number(s && s.word_count) || 0), 0);

  const recentScripts = scripts.slice(0, 4);
  const recentSaves = saves.slice(0, 3);

  const initial = name.slice(0, 1);

  return (
    <>
      <div className="pl-head">
        <div className="save-thumb" style={{ width: 36, height: 36, borderRadius: 11 }}><Icon name="logo" size={17} /></div>
        <div className="pl-head-title">
          <strong style={{ fontSize: 15 }}>RPG Roleplay</strong>
          <span className="sub">{t('mobile.home.greet_line', { greet, name })}</span>
        </div>
        <div className="pl-head-actions">
          <button className="pl-headbtn" onClick={() => nav.toast(t('mobile.home.toast.search_wip'), 'ok', 'search')} aria-label={t('mobile.home.aria.search')}><Icon name="search" size={18} /></button>
          <button className="pl-headbtn" onClick={() => nav.toast(t('mobile.home.toast.no_notifications'), 'ok', 'bell')} aria-label={t('mobile.home.aria.notifications')}><Icon name="bell" size={18} /></button>
          <button className="pl-headbtn" onClick={() => nav.switchTab('me')} aria-label={t('mobile.home.aria.profile')}>
            <span style={{ width: 22, height: 22, borderRadius: 999, display: 'grid', placeItems: 'center', background: 'var(--accent)', color: '#fff8f3', font: '600 11px var(--font-serif)' }}>{initial}</span>
          </button>
        </div>
      </div>

      <div className="pl-body tabbed">
        <div className="pl-pad">
          {/* 继续游戏 */}
          {cur ? (
            <div className="pl-continue pl-anim-rise">
              <div>
                <div className="ct-eyebrow">{t('mobile.home.continue.eyebrow')}</div>
                <div className="ct-title">{cur.title || t('mobile.home.save_fallback', { id: cur.id })}</div>
                <div className="ct-sub">{scriptOf(cur)?.title || t('mobile.home.free_mode')} · {Number(cur.branch_count) || 0} {t('mobile.home.branches')}{cur.updated_at ? ` · ${cur.updated_at}` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 9 }}>
                <button className="pl-btn-primary" style={{ flex: 2 }} onClick={() => nav.openGame(cur)}><Icon name="play" size={18} />{t('mobile.home.continue.enter_btn')}</button>
                <button className="pl-btn-ghost" style={{ flex: 1 }} onClick={() => nav.switchTab('saves')}><Icon name="branch" size={16} />{t('mobile.home.continue.saves_btn')}</button>
              </div>
            </div>
          ) : (
            <div className="pl-continue pl-anim-rise">
              <div>
                <div className="ct-eyebrow">{t('mobile.home.empty.eyebrow')}</div>
                <div className="ct-title">{t('mobile.home.empty.title')}</div>
                <div className="ct-sub">{scripts.length ? t('mobile.home.empty.has_scripts', { count: scripts.length }) : t('mobile.home.empty.no_scripts')}</div>
              </div>
              <div style={{ display: 'flex', gap: 9 }}>
                <button className="pl-btn-primary" style={{ flex: 1 }} onClick={() => nav.switchTab('scripts')}><Icon name="book_open" size={18} />{t('mobile.home.empty.browse_btn')}</button>
              </div>
            </div>
          )}

          {/* 统计 */}
          <div className="pl-stats" style={{ marginTop: 18 }}>
            <div className="pl-stat"><span className="n accent">{scripts.length}</span><div className="l">{t('mobile.home.stats.scripts')}</div></div>
            <div className="pl-stat"><span className="n">{saves.length}</span><div className="l">{t('mobile.home.stats.saves')}</div></div>
            <div className="pl-stat"><span className="n">{fmtN(branchAgg)}</span><div className="l">{t('mobile.home.stats.branches')}</div></div>
            <div className="pl-stat"><span className="n">{fmtN(stats.assets)}</span><div className="l">{t('mobile.home.stats.assets')}</div></div>
          </div>

          {/* 最近剧本 */}
          {recentScripts.length > 0 && (
            <>
              <div className="pl-sec">
                <div className="pl-sec-head"><h2>{t('mobile.home.recent_scripts.title')}</h2><button className="act" onClick={() => nav.switchTab('scripts')}>{t('common.all')} <Icon name="chevron_right" size={13} /></button></div>
              </div>
              <div style={{ display: 'flex', gap: 11, overflowX: 'auto', padding: '2px 2px 6px', margin: '0 -2px', WebkitOverflowScrolling: 'touch' }} className="scroll">
                {recentScripts.map((s) => (
                  <button key={s.id} className="pl-cover-card" style={{ flex: 'none', width: 200 }} onClick={() => nav.switchTab('scripts')}>
                    <div className="pl-cover"><span className="pl-cover-spine" /><h3>{s.title}</h3></div>
                    <div className="pl-cover-body">
                      <div className="pl-cover-meta"><Icon name="book_open" size={11} />{Number(s.chapter_count) || 0} {t('mobile.home.chapters')}<span className="sep">·</span>{fmtWan(s.word_count)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* 最近存档 */}
          {recentSaves.length > 0 && (
            <div className="pl-sec">
              <div className="pl-sec-head"><h2>{t('mobile.home.recent_saves.title')}</h2><button className="act" onClick={() => nav.switchTab('saves')}>{t('common.all')} <Icon name="chevron_right" size={13} /></button></div>
              {recentSaves.map((s) => (
                <button key={s.id} className="pl-row" onClick={() => nav.openGame(s)}>
                  <span className={'pl-row-ic ' + (s.current ? 'accent' : '')}><Icon name={s.current ? 'play' : 'save'} size={18} /></span>
                  <span className="pl-row-tx">
                    <strong className="serif">{s.title || t('mobile.home.save_fallback', { id: s.id })}</strong>
                    <span>{scriptOf(s)?.title || t('mobile.home.free_mode')} <span className="mono">· {Number(s.branch_count) || 0} {t('mobile.home.branches')}{s.updated_at ? ` · ${s.updated_at}` : ''}</span></span>
                  </span>
                  <span className="pl-row-chev"><Icon name="chevron_right" size={17} /></span>
                </button>
              ))}
            </div>
          )}

          {/* 系统状态(对齐电脑端 ProfilePage) */}
          <div className="pl-sec">
            <div className="pl-sec-head"><h2>{t('mobile.home.system.title')}</h2></div>
            <div className="pl-row" style={{ margin: 0 }}>
              <span className={'pl-row-ic ' + (database.ok ? 'ok' : 'warn')}><Icon name="cpu" size={17} /></span>
              <span className="pl-row-tx">
                <strong style={{ fontSize: 13.5 }}>{t('mobile.home.system.database')}</strong>
                <span className="mono">{database.driver || '—'} · {database.ok ? 'online' : 'offline'} · API v1</span>
              </span>
            </div>
            <button className="pl-row" style={{ marginTop: 9 }} onClick={() => nav.switchTab('me')}>
              <span className="pl-row-ic"><Icon name="user" size={17} /></span>
              <span className="pl-row-tx">
                <strong style={{ fontSize: 13.5 }}>@{user.username || '—'}</strong>
                <span>{user.role || 'user'} · {t('mobile.home.system.profile_link')}</span>
              </span>
              <span className="pl-row-chev"><Icon name="chevron_right" size={17} /></span>
            </button>
          </div>

          {/* 快捷入口 */}
          <div className="pl-sec">
            <div className="pl-sec-head"><h2>{t('mobile.home.shortcuts.title')}</h2></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              <button className="pl-row" style={{ margin: 0 }} onClick={() => nav.switchTab('scripts')}>
                <span className="pl-row-ic info"><Icon name="upload" size={17} /></span>
                <span className="pl-row-tx"><strong style={{ fontSize: 13.5 }}>{t('mobile.home.shortcuts.scripts.label')}</strong><span>{t('mobile.home.shortcuts.scripts.sub')}</span></span>
              </button>
              <button className="pl-row" style={{ margin: 0 }} onClick={() => nav.switchTab('cards')}>
                <span className="pl-row-ic ok"><Icon name="add_card" size={17} /></span>
                <span className="pl-row-tx"><strong style={{ fontSize: 13.5 }}>{t('mobile.home.shortcuts.cards.label')}</strong><span>{t('mobile.home.shortcuts.cards.sub')}</span></span>
              </button>
              <button className="pl-row" style={{ margin: 0 }} onClick={() => nav.openTavern && nav.openTavern()}>
                <span className="pl-row-ic warn"><Icon name="feedback" size={17} /></span>
                <span className="pl-row-tx"><strong style={{ fontSize: 13.5 }}>{t('mobile.home.shortcuts.tavern.label')}</strong><span>{t('mobile.home.shortcuts.tavern.sub')}</span></span>
              </button>
              <button className="pl-row" style={{ margin: 0 }} onClick={() => nav.switchTab('me')}>
                <span className="pl-row-ic"><Icon name="cpu" size={17} /></span>
                <span className="pl-row-tx"><strong style={{ fontSize: 13.5 }}>{t('mobile.home.shortcuts.profile.label')}</strong><span>{t('mobile.home.shortcuts.profile.sub')}</span></span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
