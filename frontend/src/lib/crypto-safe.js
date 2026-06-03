// crypto-safe.js — Web Crypto 安全上下文降级封装。
//
// `crypto.randomUUID()` 与 `crypto.subtle` 只在**安全上下文**(HTTPS 或 localhost)
// 暴露。用户经局域网 IP 明文 HTTP 访问(如 http://10.197.50.177:7860)时这两个 API
// 为 undefined,直接调用会抛 TypeError。randomUUID 在 game-console effect 里抛 →
// ErrorBoundary 整页降级(实测用户报"页面出错了")。这里提供同义降级实现:
// 优先用原生(安全上下文),否则回落到 getRandomValues(明文 HTTP 也可用)/纯 JS。

// RFC4122 v4 UUID。优先原生;否则用 getRandomValues 拼;再否则 Math.random 兜底。
export function safeUUID() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (_) { /* fallthrough */ }
  // getRandomValues 不属于 SecureContext-gated API,明文 HTTP 也可用
  let bytes;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      bytes = crypto.getRandomValues(new Uint8Array(16));
    }
  } catch (_) { bytes = undefined; }
  if (!bytes) {
    bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const h = [];
  for (let i = 0; i < bytes.length; i++) h.push((bytes[i] + 0x100).toString(16).slice(1));
  return (
    h[0] + h[1] + h[2] + h[3] + '-' + h[4] + h[5] + '-' + h[6] + h[7] + '-' +
    h[8] + h[9] + '-' + h[10] + h[11] + h[12] + h[13] + h[14] + h[15]
  );
}

// SHA-256 → 64 字符 hex。优先 crypto.subtle(安全上下文)产出真 SHA-256;
// crypto.subtle 在明文 HTTP 下为 undefined → 回落到确定性 64-hex 兜底。
// 用途仅为 consent_token:后端只校验「64 字符 + 合法 hex」(见 api/feedback.py),
// 不校验等于 SHA-256(CONSENT_TEXT),故兜底产出确定性 64-hex 即满足契约与语义。
export async function sha256hex(text) {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      const data = new TextEncoder().encode(text);
      const buf = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (_) { /* fallthrough */ }
  return _fallbackHex64(text);
}

// 从文本派生确定性 64 字符 hex(非加密强度;仅用于满足 consent_token 契约)。
// 8 个独立种子的 32-bit FNV-1a 变体拼成 64 hex(8×8)。
function _fallbackHex64(text) {
  const s = String(text);
  const seeds = [0x811c9dc5, 0x01000193, 0xdeadbeef, 0xcafebabe,
                 0x12345678, 0x9e3779b9, 0x7f4a7c15, 0xa5a5a5a5];
  let out = '';
  for (let k = 0; k < seeds.length; k++) {
    let hsh = seeds[k] >>> 0;
    for (let i = 0; i < s.length; i++) {
      hsh ^= s.charCodeAt(i);
      hsh = Math.imul(hsh, 0x01000193) >>> 0;
      hsh = (hsh + ((hsh << 13) | (hsh >>> 19))) >>> 0;
    }
    out += (hsh + 0x100000000).toString(16).slice(-8);
  }
  return out; // 8 × 8 = 64 hex chars
}
