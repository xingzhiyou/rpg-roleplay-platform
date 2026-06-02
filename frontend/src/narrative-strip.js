/* narrative-strip — 把 GM 输出里的结构化 JSON ops fence / bare 数组从展示文本中剥离。

历史保留:state.history[*].content 仍保存完整原文 (含 JSON),后端有 apply_structured_updates
解析这些 ops 写回 state。这个 strip 只在「给人看」的展示层调用 (ChatArea / HistoryDrawer /
搜索 index),不修改 source-of-truth。

匹配两类 ops 包:
  (1) ```json ... "op": ... ``` (带 fence,最常见,LLM 自己加 fence)
  (2) 裸 [ { "op": "..." } ] 数组 (无 fence,80 字内出现 "op" key)

旧的 stripOps 实现散在 entries/game-console.jsx:721 chat on_done。
这里抽到模块级,供 NarrativeBlock / HistoryDrawer / search index 复用。*/

export function stripNarrativeOps(txt) {
  if (!txt) return txt;
  let out = String(txt);
  // 1. ```json [...] ``` 或 ```json {...} ``` 形态
  out = out.replace(/```(?:json)?\s*\[[\s\S]*?"op"\s*:[\s\S]*?\]\s*```/gi, '');
  out = out.replace(/```(?:json)?\s*\{[\s\S]*?"op"\s*:[\s\S]*?\}\s*```/gi, '');
  // 2. 裸 JSON ops 数组: [{...,"op":...}, ...]  — 80 字内出现 "op" key 即视为 ops
  let idx;
  while ((idx = out.search(/\[\s*\{[^[\]]{0,80}"op"\s*:/)) !== -1) {
    let depth = 0, end = -1;
    for (let i = idx; i < out.length; i++) {
      if (out[i] === '[') depth++;
      else if (out[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
    }
    let start = idx;
    while (start > 0 && out[start - 1] === '\n') start--;
    if (end === -1) {
      // #21: 截断的 ops 数组(GM 输出被 max_tokens 截断,没闭合 ]) — 整段剥到末尾,
      // 否则像 `[{"op":"set",...`(半截)会泄漏进正文。
      out = out.slice(0, start);
      break;
    }
    out = out.slice(0, start) + out.slice(end + 1);
  }
  // #21: 末尾残留的畸形 json 数组残片(如 `[,,` / `[{` / `[ ,`,只剩结构字符、无叙事文字)——
  // 被截断更早的 op 包漏过上面基于 "op" 的匹配,这里兜底剥掉(仅当 [ 之后到行尾只有结构
  // 字符 ,:{}]" 和空白时,不碰正文里合法的 [方括号])。
  out = out.replace(/\n*\[[\s,:{}\]"]*$/, '');
  return out.trimEnd();
}

export default stripNarrativeOps;
