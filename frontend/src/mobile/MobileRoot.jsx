/* MobileRoot — 移动端专用外壳(路线 A)。
   ★ 与电脑端共用同一套路由:本组件由 entries/platform.jsx 传入的 `page`(来自 URL 的
     plPathToPage)驱动,导航统一调 `setPage`(= plNavigate)。同 URL、同深链、浏览器
     前进后退一致。绝不改动电脑端路由逻辑——只是把渲染换成移动 UI。

   对应关系:
     · 每个电脑端 page id 归属一个底部 Tab(PAGE_TAB / 前缀规则),Tab 高亮由 page 反推。
     · Tab 根页 = TAB_ROOT[tab];点 Tab → setPage(根页),与电脑端落到同一路由。
     · 路由级子页(scripts-import / settings-models / me-edit …)= 同一 page id,
       手机端渲染对应移动页(P4-P6 逐步实装,未实装走占位,带返回)。
     · 实体级详情(某张卡/某个存档,电脑端也无独立路由,是页内 split)→ 用页内局部栈
       nav.push,不改 URL,与电脑端"同页选中详情"语义一致。

   注册:
     MOBILE_PAGES[pageId] — 已移植的移动页(home/saves 已实装,其余 P4-P6 补)
     PAGES[localId]       — nav.push 进栈的实体详情页(P4+ 注册) */
import React from 'react';
import { useState, useCallback, useRef, useEffect } from 'react';
import { Icon } from './icons.jsx';
import { PageHeader, Layer } from './chrome.jsx';
import { launchSave } from './launch.js';
import { MobileHome } from './MobileHome.jsx';
import { Placeholder } from './MobilePlaceholder.jsx';
import { MobileScripts } from './pages/MobileScripts.jsx';
import { MobileSaves } from './pages/MobileSaves.jsx';
import { MobileCards } from './pages/MobileCards.jsx';
import { MobileSettings } from './pages/MobileSettings.jsx';
import { MobileCaps } from './pages/MobileCaps.jsx';
import { MobileMe } from './pages/MobileMe.jsx';
import { MobileTavern } from './pages/MobileTavern.jsx';
import { MobileAdmin } from './pages/MobileAdmin.jsx';
import { MobileNewGame } from './pages/MobileNewGame.jsx';

const TAB_DEFS = [
  { id: 'home', label: '主页', icon: 'home', root: 'profile' },
  { id: 'scripts', label: '剧本', icon: 'book', root: 'scripts' },
  { id: 'saves', label: '游戏', icon: 'play', center: true, root: 'saves' },
  { id: 'cards', label: '角色', icon: 'cards', root: 'cards' },
  { id: 'me', label: '我的', icon: 'user', root: 'me' },
];
const TAB_ROOT = { home: 'profile', scripts: 'scripts', saves: 'saves', cards: 'cards', me: 'me' };
const ROOT_PAGES = new Set(['profile', 'scripts', 'saves', 'cards', 'me']);

// 电脑端 page id → 底部 Tab(覆盖 entries/platform.jsx 路由表里的全部 id)
const PAGE_TAB = {
  profile: 'home', search: 'home',
  scripts: 'scripts', 'scripts-import': 'scripts', 'scripts-library': 'scripts',
  'scripts-editor': 'scripts', 'scripts-settings': 'scripts',
  saves: 'saves', 'saves-branches': 'saves', 'play-settings': 'saves', modules: 'saves', tavern: 'saves',
  cards: 'cards', 'cards-npc': 'cards', 'cards-online': 'cards',
  me: 'me', 'me-edit': 'me', 'me-settings': 'me',
  settings: 'me', 'settings-models': 'me', 'settings-modelparams': 'me', 'settings-modules': 'me',
  'settings-memory': 'me', 'settings-permissions': 'me', 'settings-account': 'me', 'settings-danger': 'me',
  usage: 'me', plugins: 'me', mcp: 'me', skills: 'me', apis: 'me', feedback: 'me', device: 'me', wall: 'me',
};
function tabOf(page) {
  if (!page) return 'home';
  if (page === 'admin' || page.startsWith('admin-')) return 'me';
  return PAGE_TAB[page] || 'home';
}

// 已移植的移动页(按 page id)。未列出的走占位。me/admin 待 workflow 完成后补。
const MOBILE_PAGES = {
  profile: MobileHome,
  saves: MobileSaves, 'saves-branches': MobileSaves, 'play-settings': MobileSaves,
  scripts: MobileScripts, 'scripts-import': MobileScripts, 'scripts-library': MobileScripts,
  'scripts-editor': MobileScripts, 'scripts-settings': MobileScripts,
  cards: MobileCards, 'cards-npc': MobileCards, 'cards-online': MobileCards,
  settings: MobileSettings, 'settings-models': MobileSettings, 'settings-modelparams': MobileSettings,
  'settings-modules': MobileSettings, 'settings-memory': MobileSettings, 'settings-permissions': MobileSettings,
  'settings-account': MobileSettings, 'settings-danger': MobileSettings,
  plugins: MobileCaps, mcp: MobileCaps, skills: MobileCaps, apis: MobileCaps, feedback: MobileCaps,
  me: MobileMe, 'me-edit': MobileMe, 'me-settings': MobileMe, usage: MobileMe, wall: MobileMe,
  tavern: MobileTavern,
};
// 占位文案(按 Tab / 路由)
const PLACEHOLDER = {
  scripts: { title: '剧本', icon: 'book', desc: '剧本库 / 详情 / 导入的移动版正在迁移中。', phase: 'P4' },
  cards: { title: '角色卡', icon: 'cards', desc: '用户卡 / NPC / 在线卡库的移动版正在迁移中。', phase: 'P4' },
  me: { title: '我的', icon: 'user', desc: '个人主页 / 用量 / 成就 / 设置的移动版正在迁移中。', phase: 'P6' },
  tavern: { title: '酒馆', icon: 'feedback', desc: '1:1 角色对话的移动版正在迁移中。', phase: 'P3' },
  settings: { title: '设置', icon: 'settings', desc: '设置与模型管理的移动版正在迁移中。', phase: 'P6' },
};
const PAGE_TITLE = {
  'scripts-import': '导入剧本', 'scripts-library': '剧本库', modules: '技能模组',
  'saves-branches': '分支', 'cards-online': '在线角色卡库', 'cards-npc': 'NPC 卡',
  'me-edit': '编辑资料', 'me-settings': '账户设置', usage: '用量', feedback: '反馈',
  'settings-models': '模型', 'settings-memory': '记忆', 'settings-permissions': '权限',
  plugins: '插件', mcp: 'MCP', skills: 'Skill', apis: 'API', wall: '成就墙',
};

// nav.push 进栈的实体详情页(键为 push 的逻辑 id)
const PAGES = { 'new-game': MobileNewGame };

export function MobileRoot({ page = 'profile', setPage }) {
  const [stack, setStack] = useState([]);   // 页内实体详情局部栈(不改 URL)
  const [toast, setToast] = useState(null);
  const seen = useRef(new Set());

  // 路由变化(URL/Tab 切换)→ 清空页内局部栈,回到该路由的根视图
  useEffect(() => { setStack([]); }, [page]);

  const fireToast = useCallback((msg, kind = 'ok', icon = 'check') => {
    setToast({ msg, kind, icon });
    clearTimeout(fireToast._t);
    fireToast._t = setTimeout(() => setToast(null), 2000);
  }, []);

  // ── 全局总线桥接(铁律):shared/工具代码(api-client.js 的 window.toast / 429+503、
  //    launch.js 与 cards.jsx/ImageLightbox/CharacterCardHero 复用路径的 window.__apiToast)
  //    在 Platform 移动外壳下指向无渲染器的 platform/game 总线 → 静默。这里把两条全局总线
  //    都桥到本组件的原生 fireToast,使其经 .toast 可见。契约转换:pl-toast 是 (msg, opts)
  //    {kind,icon,detail,duration},fireToast 是 (msg, kind, icon) 位置参数;映射 kind→原生
  //    色(warn/warning→accent、info→默认)、detail 拼进 msg、icon 缺省按 kind 兜。
  //    挂载期接管、卸载还原,绝不破坏其它宿主(桌面 platform/game/tavern)的现有总线。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const NATIVE_KIND = (k) => (k === 'danger' ? 'danger' : k === 'ok' ? 'ok' : (k === 'warn' || k === 'warning') ? 'accent' : 'info');
    const NATIVE_ICON = (k, icon) => {
      // 沿用调用方给的合法图标;否则按 kind 兜底为 mobile/icons 里存在的名字。
      const known = new Set(['check', 'info', 'warn', 'close', 'copy', 'image', 'upload', 'trash', 'save', 'refresh', 'spark', 'sparkle']);
      if (icon && known.has(icon)) return icon;
      return k === 'danger' ? 'warn' : k === 'ok' ? 'check' : (k === 'warn' || k === 'warning') ? 'warn' : 'info';
    };
    const bridge = (msg, o = {}) => {
      const opts = (o && typeof o === 'object') ? o : {};
      const kind = opts.kind || 'ok';
      const full = opts.detail ? `${msg} · ${opts.detail}` : msg;
      fireToast(full, NATIVE_KIND(kind), NATIVE_ICON(kind, opts.icon));
    };
    const prevToast = window.toast;
    const prevApiToast = window.__apiToast;
    window.toast = bridge;
    window.__apiToast = bridge;
    return () => {
      // 仅在仍是我们装的桥时还原,避免覆盖期间被他者替换。
      if (window.toast === bridge) window.toast = prevToast;
      if (window.__apiToast === bridge) window.__apiToast = prevApiToast;
    };
  }, [fireToast]);

  const goRoute = useCallback((id) => { try { setPage && setPage(id); } catch (_) {} }, [setPage]);
  const pushLocal = useCallback((page2, params = {}) => {
    setStack((s) => [...s, { page: page2, params, key: 'k' + Date.now() + Math.random() }]);
  }, []);
  const popLocal = useCallback(() => setStack((s) => (s.length ? s.slice(0, -1) : s)), []);

  const tab = tabOf(page);

  // 子页 section/参数:仅在带连字符的子路由时取后缀(settings-models→models / me-edit→edit / cards-npc→npc);
  // 根路由(settings/cards/me)section=undefined,让组件回落到 hub/默认视图(组件另读 nav.page/pageId 判 tab)。
  const _section = page && page.includes('-') ? page.split('-').slice(1).join('-') : undefined;
  const nav = {
    page, tab,
    currentPage: page, pageId: page,               // 别名(移植组件用到)
    params: { section: _section, tab: _section },
    go: goRoute,                                   // 路由级导航(同 URL)
    switchTab: (t) => goRoute(TAB_ROOT[t] || 'profile'),
    push: pushLocal,                               // 页内实体详情(不改 URL)
    pop: popLocal,
    back: () => { if (stack.length) popLocal(); else goRoute(TAB_ROOT[tab] || 'profile'); },
    openGame: (save, nodeId) => launchSave(save, nodeId, fireToast),
    openTavern: () => goRoute('tavern'),
    toast: fireToast,
  };

  // 当前路由视图
  const renderRoute = () => {
    if (page === 'admin' || (page || '').startsWith('admin-')) return <MobileAdmin nav={nav} />;
    const Comp = MOBILE_PAGES[page];
    if (Comp) return <Comp nav={nav} />;
    const isRoot = ROOT_PAGES.has(page) || page === TAB_ROOT[tab];
    const ph = PLACEHOLDER[page] || PLACEHOLDER[tab] || { title: PAGE_TITLE[page] || page, icon: 'layers', desc: '移动版迁移中。' };
    return (
      <>
        {!isRoot && <PageHeader title={PAGE_TITLE[page] || ph.title} onBack={() => goRoute(TAB_ROOT[tab] || 'profile')} />}
        <Placeholder title={ph.title} icon={ph.icon} desc={ph.desc} phase={ph.phase} />
      </>
    );
  };

  // 页内局部栈视图
  const renderLocal = (item) => {
    const P = PAGES[item.page];
    if (P) return <P nav={nav} {...item.params} />;
    return (
      <>
        <PageHeader title={item.params?.title || item.page} onBack={popLocal} />
        <div className="pl-body"><div className="pl-pad pl-empty">页面占位</div></div>
      </>
    );
  };

  const layers = [{ kind: 'route', key: 'route-' + page }, ...stack.map((it) => ({ kind: 'local', item: it, key: it.key }))];
  const atRootView = stack.length === 0 && (ROOT_PAGES.has(page) || page === TAB_ROOT[tab]);

  return (
    <div className="m-root">
      <div className="pl-root">
        <div className="pl-tabhost">
          {layers.map((L, i) => {
            const isTop = i === layers.length - 1;
            const animateIn = L.key !== ('route-' + page) && !seen.current.has(L.key);
            if (animateIn) seen.current.add(L.key);
            return (
              <Layer key={L.key} top={isTop} pushed={animateIn}>
                {L.kind === 'route' ? renderRoute() : renderLocal(L.item)}
              </Layer>
            );
          })}
        </div>

        {atRootView && (
          <div className="pl-tabbar">
            {TAB_DEFS.map((td) => (
              <button key={td.id} className={'pl-tab' + (tab === td.id ? ' active' : '')} onClick={() => goRoute(td.root)}>
                {td.center ? (
                  <span className="play-center"><Icon name="play" size={20} /></span>
                ) : (
                  <>
                    <span className="ic"><Icon name={td.icon} size={22} /></span>
                    <span>{td.label}</span>
                  </>
                )}
                {td.center && <span style={{ marginTop: 2 }}>{td.label}</span>}
              </button>
            ))}
          </div>
        )}

        {toast && <div className={`toast show ${toast.kind}`} style={{ zIndex: 200 }}><Icon name={toast.icon} size={15} />{toast.msg}</div>}
      </div>
    </div>
  );
}

export default MobileRoot;
