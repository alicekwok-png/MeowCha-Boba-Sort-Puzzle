// core/board.js — 狀態表示、遮罩、緊湊編碼。純 JS，零瀏覽器 / Node 依賴。

export const EMPTY = 15;
export const CAP_NORMAL = 4;
export const CAP_TAKEAWAY = 3;

/** @typedef {'normal'|'frosted'|'sealed'|'takeaway'|'covered'} CupKind  — covered 布遮杯：鎖死 + 完全睇唔到內容（工單 #5） */
/** @typedef {{kind:CupKind, cap:number, seg:number[], locked:boolean, hidden:number}} Cup  — hidden：普通杯底部 k 格為「隱藏層」（?），露出後唔會再遮返（夜市 brief A4 第 6 關起） */
/** @typedef {{color:number, filled:boolean}} OrderSlot */
/** @typedef {{cups:Cup[], colors:number, orders:OrderSlot[], delivered:number, moveCount:number}} Board */
/** @typedef {{from:number, to:number}} Move */

export function makeCup(kind = 'normal', seg = [], locked = false, hidden = 0) {
  return {
    kind,
    cap: kind === 'takeaway' ? CAP_TAKEAWAY : CAP_NORMAL,
    seg: [...seg],
    locked: (kind === 'sealed' || kind === 'covered') ? locked : false,
    hidden: Math.max(0, Math.min(3, hidden | 0)),
  };
}

/** 該杯有幾多格由底數起係隱藏格（頂格永遠可見）：磨砂杯 = 全部非頂格；布遮杯 = 全部；普通杯 = hidden 欄 */
export function hiddenCount(c) {
  if (c.kind === 'covered') return c.seg.length;
  if (c.kind === 'frosted') return Math.max(0, c.seg.length - 1);
  return Math.min(c.hidden || 0, Math.max(0, c.seg.length - 1));
}

export function makeBoard(cups, colors, orders = []) {
  return { cups, colors, orders: orders.map(c => ({ color: c, filled: false })), delivered: 0, moveCount: 0 };
}

export function cloneBoard(b) {
  return {
    cups: b.cups.map(c => ({ kind: c.kind, cap: c.cap, seg: c.seg.slice(), locked: c.locked, hidden: c.hidden || 0 })),
    colors: b.colors,
    orders: b.orders.map(o => ({ color: o.color, filled: o.filled })),
    delivered: b.delivered,
    moveCount: b.moveCount,
  };
}

export function countSegments(b) {
  let segs = 0;
  for (const c of b.cups)
    for (let i = 0; i < c.seg.length; i++)
      if (i === 0 || c.seg[i] !== c.seg[i - 1]) segs++;
  return segs;
}

// ---------- 遮罩視圖（送去 client 嘅嘢） ----------

/**
 * 隱藏格為 null（client 渲染成 ?）：
 *  - 布遮杯：全部格隱藏（連頂格）
 *  - 磨砂杯：只有最頂一格可見
 *  - 普通杯隱藏層：底部 hidden 格隱藏，頂格永遠可見
 * `revealed` 係一個 Set<"cupIdx:layerIdx">，記錄已經露出過嘅格（撤銷後唔會再遮返）。
 */
export function mask(board, revealed = null) {
  return {
    colors: board.colors,
    orders: board.orders.map(o => ({ color: o.color, filled: o.filled })),
    delivered: board.delivered,
    moveCount: board.moveCount,
    cups: board.cups.map((c, ci) => {
      const base = { kind: c.kind, cap: c.cap, locked: c.locked, hidden: c.hidden || 0 };
      if (c.kind === 'covered') return { ...base, seg: c.seg.map(() => null) };   // 布遮杯：全部隱藏，包括頂格
      const k = hiddenCount(c);
      if (k === 0) return { ...base, seg: c.seg.slice() };
      return { ...base, seg: c.seg.map((v, i) => (i >= k || i === c.seg.length - 1 || (revealed && revealed.has(ci + ':' + i))) ? v : null) };
    }),
  };
}

// ---------- 緊湊編碼 ----------
// 標頭: [colors][nOrders][delivered][moveCount lo][moveCount hi][nCups]
// 每張訂單 1 byte: color<<1 | filled
// 每隻杯: 1 byte 標頭 (kind<<5 | hidden<<3 | locked<<2 | capFlag) + ceil(cap/2) byte，每格 4 bit（EMPTY=15 補位）
//   capFlag：0 = cap 4，1 = cap 3（外帶）。hidden：普通杯隱藏層格數 0–3。

const KINDS = ['normal', 'frosted', 'sealed', 'takeaway', 'covered'];

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeBoard(b) {
  const bytes = [b.colors, b.orders.length, b.delivered, b.moveCount & 0xff, (b.moveCount >> 8) & 0xff, b.cups.length];
  for (const o of b.orders) bytes.push((o.color << 1) | (o.filled ? 1 : 0));
  for (const c of b.cups) {
    bytes.push((KINDS.indexOf(c.kind) << 5) | (((c.hidden || 0) & 3) << 3) | ((c.locked ? 1 : 0) << 2) | (c.cap === 3 ? 1 : 0));
    const n = Math.ceil(c.cap / 2);
    for (let i = 0; i < n; i++) {
      const lo = i * 2 < c.seg.length ? c.seg[i * 2] : EMPTY;
      const hi = i * 2 + 1 < c.seg.length ? c.seg[i * 2 + 1] : EMPTY;
      bytes.push((hi << 4) | lo);
    }
  }
  return toBase64Url(bytes);
}

export function decodeBoard(s) {
  const bytes = fromBase64Url(s);
  let p = 0;
  const colors = bytes[p++], nOrders = bytes[p++], delivered = bytes[p++];
  const moveCount = bytes[p++] | (bytes[p++] << 8);
  const nCups = bytes[p++];
  const orders = [];
  for (let i = 0; i < nOrders; i++) { const v = bytes[p++]; orders.push({ color: v >> 1, filled: !!(v & 1) }); }
  const cups = [];
  for (let i = 0; i < nCups; i++) {
    const h = bytes[p++];
    const kind = KINDS[h >> 5], hidden = (h >> 3) & 3, locked = !!((h >> 2) & 1), cap = (h & 1) ? 3 : 4;
    const seg = [];
    const n = Math.ceil(cap / 2);
    for (let k = 0; k < n; k++) {
      const v = bytes[p++];
      const lo = v & 15, hi = v >> 4;
      if (lo !== EMPTY) seg.push(lo);
      if (hi !== EMPTY) seg.push(hi);
    }
    cups.push({ kind, cap, seg, locked, hidden });
  }
  return { cups, colors, orders, delivered, moveCount };
}

/** 走步：from 4 bit + to 4 bit = 1 byte */
export function encodeMoves(moves) {
  return toBase64Url(moves.map(m => (m.from << 4) | m.to));
}

export function decodeMoves(s) {
  return Array.from(fromBase64Url(s), v => ({ from: v >> 4, to: v & 15 }));
}
