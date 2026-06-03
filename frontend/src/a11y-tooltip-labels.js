// a11y-tooltip-labels.js — 无障碍补丁(side-effect 模块)。
//
// 全站大量图标按钮只有 data-tip(自定义 hover tooltip 文案)而无 aria-label,
// 屏幕阅读器读到的是空按钮(只有 SVG)。这里把每个 data-tip 镜像到缺失的 aria-label,
// 一次覆盖现有 ~40+ 个按钮 + React 后续动态渲染的(MutationObserver)。
// 纯增量、零视觉影响:只在元素「有 data-tip 且无 aria-label 且无可见文字」时补 label。

function _hasVisibleText(el) {
  // 有非空文本子节点(非纯 SVG/icon)就不补 — 阅读器已能读到
  const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
  return txt.length > 0;
}

function _applyTo(el) {
  try {
    const tip = el.getAttribute("data-tip");
    if (!tip) return;
    if (el.getAttribute("aria-label")) return;        // 已有显式 label,尊重之
    if (el.getAttribute("aria-labelledby")) return;
    if (_hasVisibleText(el)) return;                  // 有可读文字,无需补
    el.setAttribute("aria-label", tip);
  } catch (_) { /* 防御:任何 DOM 异常都不影响页面 */ }
}

function _scan(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll("[data-tip]").forEach(_applyTo);
}

function _init() {
  _scan(document.body);
  // React 重渲/路由切换会动态插入新按钮 → MutationObserver 增量补
  try {
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;          // 只看 Element
          if (node.hasAttribute && node.hasAttribute("data-tip")) _applyTo(node);
          _scan(node);
        }
        // data-tip 属性后置变更也补一次
        if (m.type === "attributes" && m.target.nodeType === 1) _applyTo(m.target);
      }
    });
    obs.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ["data-tip"],
    });
  } catch (_) { /* MutationObserver 不可用时退化为仅首屏扫描 */ }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _init, { once: true });
  } else {
    _init();
  }
}
