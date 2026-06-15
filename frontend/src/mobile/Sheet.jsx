/* mobile/Sheet.jsx — 移动端通用底抽屉(语义统一 Batch 6b)
 *
 * 把分散在各移动页的「从底部滑出 + grip 拉手 + scrim 点击关闭」抽屉收口成两个组件:
 *   <Sheet>        通用底抽屉:title/hint + 任意 children 作为 body(MobileCaps 表单抽屉的超集)
 *   <ConfirmSheet> Sheet 的 specialization:title + body(confirm-note)+ 取消/确认(danger 变红/loading 禁用)
 *
 * 视觉/行为以 mobile.css 既有 class 为准(.sheet-wrap/.sheet-scrim/.sheet/.sheet-grip/
 * .sheet-title/.sheet-sub/.confirm-note/.sheet-actions/.sheet-btn),零新 CSS、零视觉改动:
 *   - grip 拉手、scrim 点击关闭、底部安全区 padding(.sheet 内置 calc(var(--safe-bottom)+12px))
 *   - 从底部滑入动画来自 .sheet-wrap.show .sheet 的 transform 过渡
 *
 * 注:本组件只承载「class-based .sheet」写法的站点。纯 inline-style 写的抽屉(不同 scrim 透明度/
 * 圆角/无滑入动画)若强迁会改变视觉,按语义统一铁律保留原样,不在此收口。
 */
import React from 'react';

/* ── 通用底抽屉 ──────────────────────────────────────────────────────
 * open      是否显示(false → 不渲染)
 * title     标题(.sheet-title)
 * hint      副标题/提示(.sheet-sub mono,小字;MobileCaps 端点路径用)
 * onClose   点击 scrim / 包裹层关闭
 * maxHeight .sheet 最大高度(默认 80%,与 CSS 默认一致)
 * zIndex    .sheet-wrap 层级(默认走 CSS 的 60)
 * children  抽屉 body
 */
export function Sheet({ open, title, hint, onClose, maxHeight, zIndex, children }) {
  if (!open) return null;
  return (
    <div
      className="sheet-wrap show"
      style={zIndex != null ? { zIndex } : undefined}
      onClick={onClose}
    >
      <div className="sheet-scrim" />
      <div
        className="sheet"
        style={maxHeight != null ? { maxHeight } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" />
        {title && <div className="sheet-title">{title}</div>}
        {hint && <div className="sheet-sub mono" style={{ fontSize: 10.5 }}>{hint}</div>}
        {children}
      </div>
    </div>
  );
}

/* ── 确认底抽屉 ──────────────────────────────────────────────────────
 * 在 <Sheet> 之上加 confirm-note 正文 + 取消/确认两钮。
 * open / title / onClose 同 <Sheet>。
 * body         正文(.confirm-note,可含 JSX,strong 会被 CSS 标红)
 * danger       确认钮变红(.sheet-btn.danger)否则主色(.sheet-btn.primary)
 * confirmLabel 确认钮文案(默认「确认」)
 * cancelLabel  取消钮文案(默认「取消」)
 * loading      处理中:确认钮显示「处理中…」并禁用
 * onConfirm / onCancel 回调
 */
export function ConfirmSheet({
  open, title, body, danger,
  confirmLabel = '确认', cancelLabel = '取消',
  loading, onConfirm, onCancel,
}) {
  if (!open) return null;
  return (
    <Sheet open title={title} onClose={onCancel}>
      {body && <div className="confirm-note">{body}</div>}
      <div className="sheet-actions" style={{ marginTop: 8 }}>
        <button className="sheet-btn" onClick={onCancel}>{cancelLabel}</button>
        <button
          className={'sheet-btn ' + (danger ? 'danger' : 'primary')}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? '处理中…' : confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

export default Sheet;
