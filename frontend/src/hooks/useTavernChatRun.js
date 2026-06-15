/* useTavernChatRun — 酒馆 SSE 状态机的 React hook 封装(收口蓝图 #11/#38)。
 *
 * 三宿主(tavern-app.jsx 独立页 / pages/tavern.jsx 平台内嵌 / mobile MobileTavern.jsx)
 * 共用同一份 startRun/stopRun/applyState 折叠逻辑(见 lib/tavern-chat-run.js)。本 hook
 * 持有 runRef + 把宿主差异以参数/回调注入,返回 { startRun, stopRun, runRef, isCurrentRunSse }。
 *
 * 行为零变化:七个 on_* handler 的折叠语义、run-id 守卫、120s idle、restoreFailedDraft
 * 全部逐字保留(在 lib 里),此处只做 React 绑定与差异装配。
 *
 * 用法(见各宿主 startRun):
 *   const { runRef, makeStartRun, stopRun } = useTavernChatRun({ api, setRunning, onStopExtra });
 *   const startRun = useCallback((playerText, opts) => makeStartRun({ ...perRunCfg }), [deps]);
 */
import { useRef, useCallback } from 'react';
import {
  startTavernRun, makeStopRun, abortRun, applyTavernState,
  toolCallInlineAnchor, toolResultInline, toolCallInline,
} from '../lib/tavern-chat-run.js';

export {
  applyTavernState, abortRun,
  toolCallInlineAnchor, toolResultInline, toolCallInline,
};

/**
 * @param {object} opts
 *   @param {object}   [opts.api]         默认 window.api
 *   @param {function} opts.setRunning    React setState(stopRun 需要)
 *   @param {function} [opts.onStopExtra] stopRun 附加收尾(pages:stopTicker)
 * @returns {{ runRef, stopRun, startRun, abort }}
 *   - startRun(cfg):转调 lib.startTavernRun(rc 自动注入);返回 SSE 句柄或 null
 *   - stopRun():主动停止当前轮
 *   - abort(reason):卸载/切换清理(标记 stopped + 停在途流)
 */
export function useTavernChatRun(opts = {}) {
  const { setRunning, onStopExtra } = opts;
  const api = opts.api || (typeof window !== 'undefined' && window.api);
  const runRef = useRef({ stopped: false, sse: null, runId: 0, inactivityTimer: null });

  const stopRun = useCallback(() => {
    makeStopRun(runRef.current, setRunning, api, onStopExtra)();
  }, [setRunning, api, onStopExtra]);

  const abort = useCallback((reason) => {
    abortRun(runRef.current, reason);
  }, []);

  // startRun:宿主把每轮 cfg 传进来(saveId/model/playerText + 各 setters + 差异回调),
  // rc 由 hook 自动注入。返回 lib.startTavernRun 的结果(SSE 句柄或 null)。
  const startRun = useCallback((cfg) => {
    return startTavernRun({ api, rc: runRef.current, ...cfg });
  }, [api]);

  return { runRef, stopRun, startRun, abort };
}

export default useTavernChatRun;
