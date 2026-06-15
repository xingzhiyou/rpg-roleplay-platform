/* launch.js — 移动端进入游戏台。
   桌面 __openContinue 会开新标签;移动端改为同标签全屏跳转(无弹窗拦截、贴合手机)。
   P2 上线后会被"页内移动游戏台 overlay"取代。

   ⚠ 反馈可见性:本模块是纯 js 工具,拿不到 nav。其失败提示此前硬走 window.__apiToast
   (Platform 移动外壳 = game 通道,MobileRoot 无 GameToastStack → 静默)。修法:接收可选
   onToast(msg, kind, icon) 回调(由 MobileRoot.openGame 传入 nav.toast),优先用它弹原生
   .toast;无回调时回落 window.__apiToast(MobileRoot 已把该全局总线桥到 fireToast 兜底)。 */
export async function launchSave(save, nodeId, onToast) {
  const _toast = (msg, kind, icon) => {
    if (typeof onToast === 'function') { try { onToast(msg, kind, icon); } catch (_) {} return; }
    try { window.__apiToast?.(msg, { kind: kind === 'accent' ? 'warn' : kind }); } catch (_) {}
  };
  const id = (save && typeof save === 'object') ? save.id : save;
  if (!id) { _toast('没有可进入的存档', 'accent', 'warn'); return; }
  try {
    if (nodeId != null && nodeId !== '') {
      await window.api.branches.activate({ node_id: nodeId, commit_id: nodeId });
    } else {
      await window.api.saves.activate(id);
    }
  } catch (e) {
    _toast(e?.message ? `切换存档失败 · ${e.message}` : '切换存档失败', 'danger', 'warn');
    return;
  }
  try { window.location.href = new URL('Game Console.html', window.location.href).href; }
  catch (_) { window.location.href = 'Game Console.html'; }
}
