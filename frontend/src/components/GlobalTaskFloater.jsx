import React from 'react';
import { createPortal } from 'react-dom';
import CSFlashbar from '@cloudscape-design/components/flashbar';
import CSProgressBar from '@cloudscape-design/components/progress-bar';
import CSButton from '@cloudscape-design/components/button';

/* GlobalTaskFloater — 右下角全局「后台任务」浮窗。
   数据源:GET /api/me/tasks/active(导入 / 各模块重建 / 生图 统一聚合)。
   交互(按用户要求):用 Cloudscape Flashbar stackItems 的「堆叠卡片」动画;默认收起成
   堆叠(顶卡 + 后面卡片露边);鼠标经过浮窗 → 展开成完整列表(悬停展开,移开收回);
   通知条改成暖色(不要默认那块蓝色面板)。
   如实状态:import 类有真实 overall_progress 进度条;生图只给 spinner + 已用时间。
   每任务带「取消」按钮——取消只能显式触发,关闭弹窗/页面绝不取消队列。
*/

const POLL_ACTIVE_MS = 3000;
const POLL_IDLE_MS = 7000;
const POLL_BACKOFF_MS = 60000;

// 暖色板。loading=true 的项渲染成 info 态,故覆盖 info 颜色;notificationBar 改暖色(去蓝)。
const FLASHBAR_STYLE = {
  item: { root: {
    background: { info: '#2a2620' },
    color: { info: '#ebe7df' },
    borderColor: { info: '#46413a' },
  } },
  notificationBar: { root: {
    background: { default: '#2a2620', hover: '#352f27', active: '#352f27' },
    color: { default: '#ebe7df', hover: '#ffffff', active: '#ffffff' },
    borderColor: { default: '#46413a', hover: '#5a5249', active: '#5a5249' },
  } },
};
const PROGRESS_STYLE = {
  progressValue: { backgroundColor: '#c96442' },
  progressBar: { backgroundColor: 'rgba(201,100,66,0.18)' },
};

function fmtElapsed(sec) {
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return sec + 's';
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return m + 'm' + (s ? ' ' + s + 's' : '');
  const h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm';
}

const ACTIVE_ST = { queued: 1, running: 1 };

// 隐藏 stackItems 通知条里那串按类型计数(0 0 0 0 3)——累赘,留下「N 个后台任务」+ 展开钮即可。
if (typeof document !== 'undefined' && !document.getElementById('rpg-task-dock-style')) {
  const st = document.createElement('style');
  st.id = 'rpg-task-dock-style';
  st.textContent = '.rpg-task-dock [class*="item-count"]{display:none !important;}';
  document.head.appendChild(st);
}

// 找 Flashbar stackItems 的折叠/展开开关按钮(通知条上的那个 toggle)
function findStackToggle(root) {
  if (!root) return null;
  const sel = [
    '[class*="notification-bar"] button',
    '[class*="notificationBar"] button',
    'button[class*="toggle"]',
  ];
  for (const s of sel) {
    const el = root.querySelector(s);
    if (el) return el;
  }
  // 兜底:通知条容器本身可点
  return root.querySelector('[class*="notification-bar"], [class*="notificationBar"]');
}

export default function GlobalTaskFloater() {
  const { useState, useEffect, useRef } = React;
  const [tasks, setTasks] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [, tick] = useState(0);
  const mounted = useRef(true);
  const prevActive = useRef(new Set());
  const toasted = useRef(new Set());
  const dockRef = useRef(null);
  const expandedRef = useRef(false);   // 跟踪 stackItems 当前是否已展开(避免重复 toggle)

  // ── 轮询 ──
  useEffect(() => {
    mounted.current = true;
    let timer = null;
    const api = (typeof window !== 'undefined' && window.api) || null;
    const schedule = (ms) => { if (timer) clearTimeout(timer); timer = setTimeout(run, ms); };
    const run = async () => {
      if (!mounted.current) return;
      if (!api || !api.tasks || !api.tasks.active) return schedule(POLL_BACKOFF_MS);
      if (typeof document !== 'undefined' && document.hidden) return schedule(POLL_IDLE_MS);
      try {
        const r = await api.tasks.active();
        if (!mounted.current) return;
        const list = (r && r.tasks) || [];
        const byId = {};
        list.forEach((t) => { byId[t.id] = t; });
        const curActive = new Set(list.filter((t) => ACTIVE_ST[t.status]).map((t) => t.id));
        prevActive.current.forEach((id) => {
          if (curActive.has(id) || toasted.current.has(id)) return;
          const t = byId[id];
          if (!t) return;
          const toast = (typeof window !== 'undefined' && window.__apiToast) || null;
          if (!toast) return;
          toasted.current.add(id);
          if (t.status === 'done') toast(t.title + ' 已完成', { kind: 'ok', duration: 3500 });
          else if (t.status === 'done_with_errors') toast(t.title + ' 完成(有警告)', { kind: 'warning', duration: 5000 });
          else if (t.status === 'failed') toast(t.title + ' 失败' + (t.error ? '：' + t.error : ''), { kind: 'danger', duration: 7000 });
          else if (t.status === 'cancelled') toast(t.title + ' 已取消', { kind: 'info', duration: 3000 });
        });
        prevActive.current = curActive;
        if (toasted.current.size > 80) toasted.current = new Set([...toasted.current].filter((id) => byId[id]));
        setTasks(list);
        setFetchedAt(Date.now());
        schedule(curActive.size > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS);
      } catch (e) {
        if (!mounted.current) return;
        schedule((e && e.status) === 401 ? POLL_BACKOFF_MS : POLL_IDLE_MS);
      }
    };
    const kick = () => { if (timer) clearTimeout(timer); run(); };
    const onVis = () => { if (!document.hidden) kick(); };
    run();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    window.addEventListener('rpg-task-refresh', kick);
    return () => {
      mounted.current = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
      window.removeEventListener('rpg-task-refresh', kick);
    };
  }, []);

  const active = tasks.filter((t) => ACTIVE_ST[t.status]);

  useEffect(() => {
    if (active.length === 0) return undefined;
    const id = setInterval(() => { if (mounted.current) tick((x) => x + 1); }, 1000);
    return () => clearInterval(id);
  }, [active.length]);

  if (active.length === 0) return null;
  const portalTarget = typeof document !== 'undefined' ? document.body : null;
  if (!portalTarget) return null;

  const cancelTask = async (t) => {
    const api = (typeof window !== 'undefined' && window.api) || null;
    const toast = (typeof window !== 'undefined' && window.__apiToast) || null;
    try {
      if (t.source === 'import') await api?.scripts?.jobCancel(String(t.id).slice('import:'.length));
      else if (t.source === 'image') await api?.images?.cancel(String(t.id).slice('image:'.length));
      if (toast) toast('已请求取消', { kind: 'info', duration: 2500 });
      window.dispatchEvent(new Event('rpg-task-refresh'));
    } catch (e) {
      if (toast) toast('取消失败', { kind: 'danger', detail: e && e.message });
    }
  };

  // 悬停 → 展开堆叠;移开 → 收回。靠模拟点击 stackItems 通知条的 toggle(Cloudscape 无受控 API)。
  const setStackExpanded = (want) => {
    if (active.length < 2) return;       // 单任务无堆叠,不需要 toggle
    if (expandedRef.current === want) return;
    const btn = findStackToggle(dockRef.current);
    if (!btn) return;
    btn.click();
    expandedRef.current = want;
  };
  const onEnter = () => setStackExpanded(true);
  const onLeave = () => setStackExpanded(false);

  const nowMs = Date.now();
  const items = active.map((t) => {
    const elapsed = fmtElapsed((t.elapsed_sec || 0) + (fetchedAt ? (nowMs - fetchedAt) / 1000 : 0));
    const hasProg = t.progress != null && t.progress_total;
    const pct = hasProg ? Math.max(0, Math.min(100, Math.round((t.progress / t.progress_total) * 100))) : 0;
    const canceling = !!t.canceling;
    const statusText = (canceling ? '取消中…' : (t.status === 'queued' ? '排队中' : '进行中'))
      + (t.phase ? ' · ' + t.phase : '')
      + ' · 已用 ' + elapsed;
    return {
      id: t.id,
      loading: true,
      dismissible: false,
      header: t.title,
      action: (t.cancelable && !canceling)
        ? <CSButton variant="inline-link" onClick={() => cancelTask(t)}>取消</CSButton>
        : undefined,
      content: (
        <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          <div style={{ opacity: 0.85 }}>{statusText}</div>
          {hasProg && (
            <div style={{ marginTop: 5 }}>
              <CSProgressBar variant="flash" status="in-progress" value={pct} style={PROGRESS_STYLE} />
            </div>
          )}
        </div>
      ),
    };
  });

  const dock = (
    <div ref={dockRef} className="rpg-task-dock"
      style={{ position: 'fixed', right: 16, bottom: 16, width: 380, maxWidth: 'calc(100vw - 32px)', zIndex: 1500 }}
      onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <CSFlashbar
        items={items}
        stackItems
        style={FLASHBAR_STYLE}
        i18nStrings={{
          ariaLabel: '后台任务',
          notificationBarText: active.length + ' 个后台任务',
          notificationBarAriaLabel: '展开 / 收起后台任务',
          infoIconAriaLabel: '进行中',
          inProgressIconAriaLabel: '进行中',
          errorIconAriaLabel: '错误',
          successIconAriaLabel: '完成',
          warningIconAriaLabel: '警告',
        }}
      />
    </div>
  );
  return createPortal(dock, portalTarget);
}
