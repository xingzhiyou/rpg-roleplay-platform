/* responsive.jsx — task 102A: 通用响应式 + 拖动基础组件
 *
 * 暴露到 window (babel-standalone 无 import,挂全局):
 *
 *   useBreakpoint() → { width, bp ('xs'|'sm'|'md'|'lg'|'xl'),
 *                       is: { xs, sm, md, lg, xl, ltMd, ltLg, ... } }
 *     断点 (max-width based):
 *       xs <480   sm 480–767   md 768–1023   lg 1024–1279   xl ≥1280
 *
 *   useResizable({ storageKey, defaultSize, min, max, side }) →
 *     { size, setSize, dragHandleProps }
 *     side='left'  ← 拖元素自身右边缘 (sidebar 模式)
 *     side='right' ← 拖元素自身左边缘 (右侧浮窗模式)
 *     storageKey: localStorage key, undefined 则不持久化
 *
 *   <ResizeHandle side="left|right" {...dragHandleProps} />
 *     视觉化拖动条 (默认 4px 宽 hover 高亮)
 *
 * 用法 (典型 sidebar):
 *   const { size, dragHandleProps } = useResizable({
 *     storageKey: "pl.sidebar.w", defaultSize: 244, min: 64, max: 380, side: "left"
 *   });
 *   return (
 *     <aside style={{width: size, position: "relative"}}>
 *       <ResizeHandle side="left" {...dragHandleProps} />
 *       ...
 *     </aside>
 *   );
 */
import React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { lsGet, lsSet } from './lib/storage.js';


// ── 断点 ─────────────────────────────────────────────────
const BREAKPOINTS = { xs: 0, sm: 480, md: 768, lg: 1024, xl: 1280 };

function _bpName(w) {
  if (w < BREAKPOINTS.sm) return "xs";
  if (w < BREAKPOINTS.md) return "sm";
  if (w < BREAKPOINTS.lg) return "md";
  if (w < BREAKPOINTS.xl) return "lg";
  return "xl";
}

function useBreakpoint() {
  const [width, setWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280
  );
  useEffect(() => {
    const onR = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  const bp = _bpName(width);
  const order = ["xs", "sm", "md", "lg", "xl"];
  const idx = order.indexOf(bp);
  return {
    width,
    bp,
    is: {
      xs: bp === "xs",
      sm: bp === "sm",
      md: bp === "md",
      lg: bp === "lg",
      xl: bp === "xl",
      // 便捷比较: lt = less than
      ltSm: idx < 1, ltMd: idx < 2, ltLg: idx < 3, ltXl: idx < 4,
      gteSm: idx >= 1, gteMd: idx >= 2, gteLg: idx >= 3, gteXl: idx >= 4,
    },
  };
}

// ── useResizable ─────────────────────────────────────────
// task 104b: 上一版 (rAF + :root mutate) 反而更卡 — 根因是 React 写在元素
// 上的 inline style `--cap-w: capW + "px"` specificity 高于 :root, 我写到
// :root 的值被 React 写的 inline 覆盖, DOM 不响应。
//
// 新方案 (最快路径):
//   1. ResizeHandle onMouseDown 时, 从 e.currentTarget.parentElement 找到
//      被拖元素 (handle 一般是 panel 的第一个 child, 父元素就是 target)
//   2. mousemove 期间直接 `target.style.setProperty(cssVar, ...)` 或 width
//      — 元素 inline style 自身覆盖, 不依赖任何 cascade
//   3. 不用 rAF (mousemove 浏览器自己已经 ~60fps, 直接 DOM write 廉价)
//   4. mouseup setSize 一次, React 重渲, inline style 同步
function useResizable({
  storageKey,
  defaultSize = 244,
  min = 64,
  max = 600,
  side = "left",
  cssVar,
} = {}) {
  const [size, setSize] = useState(() => {
    if (storageKey) {
      const v = parseInt(lsGet(storageKey) || "", 10);
      if (Number.isFinite(v) && v >= min && v <= max) return v;
    }
    return defaultSize;
  });
  const sizeRef = useRef(size);
  useEffect(() => { sizeRef.current = size; }, [size]);

  // 统一鼠标 + 触摸:触屏平板(pointer:coarse)上拖拽手柄可见(CSS 加宽到 12px),
  // 但原实现只监听 mouse 事件 → 触屏拖不动。这里抽出共用逻辑,鼠标走 mouse* 事件,
  // 触摸走 touch* 事件,从 e.clientX 或 e.touches[0].clientX 统一取坐标。
  const _startDrag = useCallback((e, startX, isTouch) => {
    const target = e.currentTarget.parentElement;
    if (!target) return;
    const startSize = sizeRef.current;
    let pending = startSize;
    if (!isTouch) {
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    const apply = (clientX) => {
      const dx = clientX - startX;
      let next = side === "left" ? startSize + dx : startSize - dx;
      next = Math.max(min, Math.min(max, next));
      if (next === pending) return;
      pending = next;
      if (cssVar) target.style.setProperty(cssVar, next + "px");
      else target.style.width = next + "px";
    };
    const onMouseMove = (ev) => apply(ev.clientX);
    const onTouchMove = (ev) => {
      if (ev.touches && ev.touches.length) {
        ev.preventDefault();  // 阻止拖拽时页面滚动
        apply(ev.touches[0].clientX);
      }
    };
    const onEnd = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
      setSize(pending);
      if (storageKey) lsSet(storageKey, String(pending));
    };
    if (isTouch) {
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      window.addEventListener("touchend", onEnd);
      window.addEventListener("touchcancel", onEnd);
    } else {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onEnd);
    }
  }, [side, min, max, cssVar, storageKey]);

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    _startDrag(e, e.clientX, false);
  }, [_startDrag]);

  const onTouchStart = useCallback((e) => {
    if (!e.touches || !e.touches.length) return;
    _startDrag(e, e.touches[0].clientX, true);
  }, [_startDrag]);

  const onDoubleClick = useCallback(() => {
    setSize(defaultSize);
    if (storageKey) lsSet(storageKey, String(defaultSize));
  }, [defaultSize, storageKey]);

  return {
    size,
    setSize,
    dragHandleProps: {
      onMouseDown,
      onTouchStart,
      onDoubleClick,
      role: "separator",
      "aria-orientation": "vertical",
      tabIndex: 0,
    },
  };
}

// ── ResizeHandle ─────────────────────────────────────────
function ResizeHandle({ side = "left", ...rest }) {
  // side='left' → 手柄出现在被拖元素的右边缘
  // side='right' → 手柄出现在被拖元素的左边缘
  const { t } = useTranslation();
  return (
    <div
      className={`pl-resize-handle pl-resize-handle-${side}`}
      title={t('responsive.resize_handle_title')}
      {...rest}
    />
  );
}

// ── chatComposerKey ──────────────────────────────────────
// task 115: Claude Code Desktop 同款聊天输入键位 — 给 textarea onKeyDown 用。
// 行为:
//   · IME composition 中 (中文/日文输入法候选未确认) → Enter 留给 IME, 不发送
//   · Enter → 默认发送；可通过 enterToSend=false 改成换行
//   · Shift+Enter → 换行 (浏览器默认)
//   · Cmd/Ctrl+Enter → 也发送 (备用)
// 用法:
//   <textarea onKeyDown={(e) => chatComposerKey(e, sendFn, { enterToSend })} />
function chatComposerKey(e, onSend, options = {}) {
  const enterToSend = options.enterToSend !== false;
  // IME composing 检测 (3 种 fallback)
  if (e.nativeEvent && e.nativeEvent.isComposing) return;
  if (e.isComposing) return;
  if (e.keyCode === 229) return;  // 老浏览器 IME 兼容码
  if (e.key !== "Enter") return;
  if (e.metaKey || e.ctrlKey) {
    e.preventDefault();
    if (typeof onSend === "function") onSend();
    return;
  }
  // Shift+Enter: 让默认行为生效 (换行)
  if (e.shiftKey) return;
  if (!enterToSend) return;
  // Enter → 发送
  e.preventDefault();
  if (typeof onSend === "function") onSend();
}

export { useBreakpoint, useResizable, chatComposerKey, ResizeHandle, BREAKPOINTS as PL_BREAKPOINTS };
