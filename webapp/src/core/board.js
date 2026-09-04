// core/board.js — 狀態表示、遮罩、緊湊編碼。純 JS，零瀏覽器 / Node 依賴。
//
// Spec v2：每格液體係 LiquidUnit { colorId, patternId }。為咗唔郁 solver / rules 嘅比較邏輯，
// 一格用一個整數 unit key 表示：key = colorId | (patternId << 4)。同 key 先可以合併（canMerge）。
// 第 1–40 關全部 patternId = 0（P0），所以 key === colorId；圖案系統只係基建。

export const EMPTY = 255;
export const CAP_NORMAL = 4;
export const CAP_TAKEAWAY = 3;
export const PATTERN_COUNT = 5;          // P0–P4

/** 器皿種類（Spec v2 §2 vessel + cover 壓成一個 kind）：
 *  normal   燒瓶 flask（4 格，全部可見）
 *  frosted  磨砂瓶（4 格，只有頂格可見，倒走一格露一格）
 *  covered  布遮瓶 cloth（全部隱藏，蠟封顯示頂層色；鎖死，交兩單解鎖 → 變 normal）
 *  takeaway 曲頸瓶 retort（3 格，永遠裝唔滿一色）
 *  cracked  裂瓶（4 格，只出不入）
 */
export const KINDS = ['normal', 'frosted', 'covered', 'takeaway', 'cracked'];

/** @typedef {'normal'|'frosted'|'covered'|'takeaway'|'cracked'} CupKind */
/** @typedef {{kind:CupKind, cap:number, seg:number[], locked:boolean}} Cup  — seg 由底至頂，每格一個 unit key */
/** @typedef {{color:number, filled:boolean}} OrderSlot  — color 係 unit key */
/** @typedef {{cups:Cup[], colors:number, orders:OrderSlot[], delivered:number, moveCount:number}} Board */
/** @typedef {{from:number, to:number}} Move */

// ---------- LiquidUnit ----------
export const makeUnit = (colorId, patternId = 0) => (colorId & 15) | ((patternId & 7) << 4);
export const unitColor = (u) => u & 15;
export const unitPattern = (u) => (u >> 4) & 7;
export const canMerge = (a, b) => a === b;   // 同色同圖案先合併（Spec v2 §2）

export function makeCup(kind = 'normal', seg = [], locked = false) {
  return {
    kind,
    cap: kind === 'takeaway' ? CAP_TAKEAWAY : CAP_NORMAL,
    seg: [...seg],
    locked: kind === 'covered' ? locked : false,
  };
}

/** 隱藏格數（由底數起）：布遮瓶 = 頂格以外全部（頂格由蠟封提示）；磨砂瓶 = 頂格以外全部；其餘 0 */
export function hiddenCount(c) {
  if (c.kind === 'covered' || c.kind === 'frosted') return Math.max(0, c.seg.length - 1);
  return 0;
}

/** 可以操作（揀嚟倒出 / 倒入）？布遮瓶鎖死期間唔得 */
export const canInteract = (c) => c.kind !== 'covered' || !c.locked;

export function makeBoard(cups, colors, orders = []) {
  return { cups, colors, orders: orders.map(c => ({ color: c, filled: false })), delivered: 0, moveCount: 0 };
}

export function cloneBoard(b) {
  return {
    cups: b.cups.map(c => ({ kind: c.kind, cap: c.cap, seg: c.seg.slice(), locked: c.locked })),
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
 * 隱藏格為 null（client 渲染成磨砂 / 布）：
 *  - 磨砂瓶：只有最頂一格可見（露出過嘅格由 revealed 補返）
 *  - 布遮瓶：只有最頂一格可見（蠟封提示色），其餘隱藏；解鎖後變 normal
 * `revealed` 係一個 Set<"cupIdx:layerIdx">，記錄已經露出過嘅格（撤銷後唔會再遮返）。
 */
export function mask(board, revealed = null) {
  return {
    colors: board.colors,
    orders: board.orders.map(o => ({ color: o.color, filled: o.filled })),
    delivered: board.delivered,
    moveCount: board.moveCount,
    cups: board.cups.map((c, ci) => {
      const base = { kind: c.kind, cap: c.cap, locked: c.locked };
      const k = hiddenCount(c);
      if (k === 0) return { ...base, seg: c.seg.slice() };
      return { ...base, seg: c.seg.map((v, i) => (i >= k || (revealed && revealed.has(ci + ':' + i))) ? v : null) };
    }),
  };
}

// ---------- 緊湊編碼（v2） ----------
// 標頭: [version=2][colors][nOrders][delivered][moveCount lo][moveCount hi][nCups]
// 每張訂單 1 byte: unit key（訂單只用 P0–P3 色 + 圖案，key < 128）<<1 | filled
// 每隻杯: 1 byte 標頭 (kind<<5 | locked<<2 | capFlag) + cap byte，每格 1 byte unit key（EMPTY=255 補位）
//   capFlag：0 = cap 4，1 = cap 3（曲頸瓶）

const VERSION = 2;

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
  const bytes = [VERSION, b.colors, b.orders.length, b.delivered, b.moveCount & 0xff, (b.moveCount >> 8) & 0xff, b.cups.length];
  for (const o of b.orders) bytes.push(((o.color & 127) << 1) | (o.filled ? 1 : 0));
  for (const c of b.cups) {
    bytes.push((KINDS.indexOf(c.kind) << 5) | ((c.locked ? 1 : 0) << 2) | (c.cap === 3 ? 1 : 0));
    for (let i = 0; i < c.cap; i++) bytes.push(i < c.seg.length ? c.seg[i] : EMPTY);
  }
  return toBase64Url(bytes);
}

export function decodeBoard(s) {
  const bytes = fromBase64Url(s);
  let p = 0;
  const version = bytes[p++];
  if (version !== VERSION) throw new Error(`board encoding version ${version} unsupported (want ${VERSION}) — regenerate levels/campaign.json`);
  const colors = bytes[p++], nOrders = bytes[p++], delivered = bytes[p++];
  const moveCount = bytes[p++] | (bytes[p++] << 8);
  const nCups = bytes[p++];
  const orders = [];
  for (let i = 0; i < nOrders; i++) { const v = bytes[p++]; orders.push({ color: v >> 1, filled: !!(v & 1) }); }
  const cups = [];
  for (let i = 0; i < nCups; i++) {
    const h = bytes[p++];
    const kind = KINDS[h >> 5], locked = !!((h >> 2) & 1), cap = (h & 1) ? 3 : 4;
    const seg = [];
    for (let k = 0; k < cap; k++) { const v = bytes[p++]; if (v !== EMPTY) seg.push(v); }
    cups.push({ kind, cap, seg, locked });
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
