import React from 'react';

/* AvatarImg — 通用头像组件（v2）
   有 src → 渲 <img>，onError 回退到首字母 div；
   无 src → 直接渲首字母 div，复用调用方传入的 className 现有样式。

   props:
     src         : 图片 URL（可为空/null/undefined）
     name        : 显示名，用于取首字母兜底
     size        : 宽高 px（number；传 null/undefined 则使用默认 40px，除非 className 已控制尺寸）
     shape       : 'circle'(border-radius:50%) | 'rounded'(r-2 变量) | 'square'
     className   : 透传给 img 或 div 的 CSS class（复用现有如 pl-card-avatar / tv-chat-avatar）
     alt         : img alt 文本（默认取 name）
     zoomable    : bool，默认 false；为 true 且有 src 时点击可全屏 lightbox 查看
     aspectRatio : string|null，如 '1/1'/'2/3'；设了则启用 aspect-ratio CSS，
                   宽度由 size 决定，高度由比例计算（适合竖版立绘）；
                   不设则保持现有方形 size 行为（向后兼容）
*/
export default function AvatarImg({
  src,
  name,
  size,
  shape,
  className,
  alt,
  zoomable = false,
  aspectRatio = null,
}) {
  const { useState, useEffect, useCallback } = React;
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Esc 键关闭 lightbox
  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e) => {
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxOpen]);

  const openLightbox = useCallback((e) => {
    e.stopPropagation();
    setLightboxOpen(true);
  }, []);

  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  const initial = (typeof name === 'string' && name.length > 0)
    ? name.slice(0, 1)
    : '?';

  const altText = alt != null ? alt : (name || '');

  const shapeStyle = shape === 'circle'
    ? { borderRadius: '50%' }
    : shape === 'rounded'
      ? { borderRadius: 'var(--r-2, 6px)' }
      : {};

  // size 为 null/undefined 且无 className 时给默认 40px 防止 0×0 失控
  // 有 className 的调用方（如 pl-card-avatar）通过 CSS 控制尺寸，不注入默认值
  const resolvedSize = (size != null && typeof size === 'number')
    ? size
    : (className ? null : 40);

  // aspectRatio 模式：宽 = resolvedSize（或 null），高由比例算
  let sizeStyle;
  if (aspectRatio) {
    // 解析比例字符串，如 '2/3' → w/h = 2/3 → height = width * h/w
    const parts = aspectRatio.split('/').map(Number);
    const ratioW = parts[0] || 1;
    const ratioH = parts[1] || 1;
    if (resolvedSize != null) {
      const computedHeight = Math.round(resolvedSize * ratioH / ratioW);
      sizeStyle = {
        width: resolvedSize,
        height: computedHeight,
        flexShrink: 0,
        aspectRatio,
      };
    } else {
      sizeStyle = { flexShrink: 0, aspectRatio };
    }
  } else {
    sizeStyle = resolvedSize != null
      ? { width: resolvedSize, height: resolvedSize, flexShrink: 0 }
      : {};
  }

  const commonStyle = { ...sizeStyle, ...shapeStyle };

  // 加载占位背景色（加载完成或出错后移除）
  const loadingPlaceholder = (!imgLoaded && !imgError)
    ? { background: 'var(--color-surface-2, rgba(128,128,128,0.15))' }
    : {};

  // 有 src 且尚未出错 → 渲 img
  if (src && !imgError) {
    const canZoom = zoomable && src;

    return (
      <>
        <img
          src={src}
          alt={altText}
          title={name || undefined}
          className={className || ''}
          loading="lazy"
          decoding="async"
          style={{
            objectFit: 'cover',
            display: 'block',
            ...loadingPlaceholder,
            ...commonStyle,
            ...(canZoom ? { cursor: 'zoom-in' } : {}),
          }}
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
          onClick={canZoom ? openLightbox : undefined}
        />

        {canZoom && lightboxOpen && (
          <div
            onClick={closeLightbox}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9000,
              background: 'rgba(0,0,0,0.85)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            role="dialog"
            aria-modal="true"
            aria-label={altText || '图片预览'}
          >
            <img
              src={src}
              alt={altText}
              style={{
                maxWidth: '92vw',
                maxHeight: '92vh',
                objectFit: 'contain',
                borderRadius: 8,
                boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
                display: 'block',
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={closeLightbox}
              aria-label="关闭"
              style={{
                position: 'absolute',
                top: 20,
                right: 24,
                background: 'rgba(255,255,255,0.13)',
                border: 0,
                color: '#fff',
                borderRadius: 99,
                width: 36,
                height: 36,
                fontSize: 18,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
              }}
            >×</button>
          </div>
        )}
      </>
    );
  }

  // 无 src 或 img 加载失败 → 渲首字母 div（复用传入的 className，如 pl-card-avatar）
  return (
    <div
      className={className || ''}
      style={commonStyle}
      aria-label={altText}
      title={name || undefined}
    >
      {initial}
    </div>
  );
}
