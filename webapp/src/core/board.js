// core/board.js — 狀態表示、遮罩、緊湊編碼。純 JS，零瀏覽器 / Node 依賴。
//
// Spec v2：每格液體係 LiquidUnit { colorId, patternId }。為咗唔郁 solver / rules 嘅比較邏輯，
// 一格用一個整數 unit key 表示：key = colorId | (patternId << 4)。同 key 先可以合併（canMerge）。
// 第 1–40 關全部 patternId = 0（P0），所以 key === colorId；圖案系統只係基建。

export const EMPTY = 255;
export const CAP_NORMAL = 4;
export const CAP_TAKEAWAY = 3;
export const PATTERN_COUNT = 5;          // P0–P4

/** 器皿種類（實作指令 v4：全遊戲單一樽型，capacity 固定 4）：
 *  normal   標準樽（全部可見）
 *  hidden   `?` 隱藏層樽（只顯示頂層，下面畫 ?；倒走頂層下一層即刻揭露）— v4 §5，L2 起
 *  covered  布遮樽 cloth（全部隱藏，蠟封顯示頂層色；鎖死，交兩單解鎖 → 變 normal）
 *  ad       廣告樽（v4 §4：空、鎖死，撳一下睇廣告 → 變 normal 空樽；關卡唔解鎖都必須可解）
 *  gone     已交貨飛走（v4 §7：交貨後盤面釋放位置，唔留空樽）
 *  takeaway / cracked：v4 已移除（只留 decode 相容，唔會再生成）
 */
export const KINDS = ['normal', 'covered', 'takeaway', 'cracked', 'hidden', 'ad', 'gone'];   // 索引入編碼（kind << 5），改次序要 bump VERSION
export const HIDDEN_KINDS = new Set(['hidden', 'covered']);
export const INERT_KINDS = new Set(['ad', 'gone']);   // 唔可以倒入亦唔可以倒出

/** @typedef {'normal'|'covered'|'takeaway'|'cracked'|'hidden'|'ad'|'gone'} CupKind */
/** @typedef {{kind:CupKind, cap:number, seg:number[], locked:boolean}} Cup  — seg 由底至頂，每格一個 unit key */
/** @typedef {{color:number, filled:boolean}} OrderSlot  — color 係 unit key；Spec v3：filled = 隊列已空、呢個槽收工（empty）
 *  訂單槽（orders）= 已開放嘅槽（免費槽 + 已解鎖嘅廣告槽）；queue = 未派出嘅訂單色（必須涵蓋關內全部顏色）。
 *  交貨後只有嗰個槽補隊列下一單；隊列空 → 槽 filled。過關 = 隊列空 + 全部槽 filled。 */
/** @typedef {{cups:Cup[], colors:number, orders:OrderSlot[], queue:number[], delivered:number, moveCount:number}} Board */
/** @typedef {{from:number, to:number}} Move */

// ---------- LiquidUnit ----------
export const makeUnit = (colorId, patternId = 0) => (colorId & 15) | ((patternId & 7) << 4);
export const unitColor = (u) => u & 15;
export const unitPattern = (u) => (u >> 4) & 7;
export const canMerge = (a, b) => a === b;   // 同色同圖案先合併（Spec v2 §2）

/**
 * hid = 每格獨立嘅隱藏位元遮罩（bit i = 第 i 格隱藏；i 由底數起）。用戶 2026-09-06：
 * 舊做法「頂格可見、下面全部 ?」令每隻樽嘅 pattern 都一模一樣；參考遊戲係 ? 散喺唔同位置
 * （色 / ? / 色 / ? …）。硬規則：頂格永遠唔可以隱藏（否則變成盲倒，用戶早前已否決）。
 * 布罩樽（covered）唔用 hid：佢係整枝遮，頂格由蠟封提示。
 */
export function makeCup(kind = 'normal', seg = [], locked = false, hid = 0) {
  return {
    kind,
    cap: kind === 'takeaway' ? CAP_TAKEAWAY : CAP_NORMAL,
    seg: [...seg],
    locked: kind === 'covered' ? locked : false,
    hid: kind === 'hidden' ? (hid & 15) : 0,
  };
}

/** 第 i 格（由底數起）係咪隱藏？covered = 頂格以外全部；hidden = 睇 hid 遮罩 */
export function isHiddenCell(c, i) {
  if (c.kind === 'covered') return i < c.seg.length - 1;
  if (c.kind === 'hidden') return !!((c.hid >> i) & 1) && i < c.seg.length;
  return false;
}

/** 隱藏格數 */
export function hiddenCount(c) {
  if (c.kind === 'covered') return Math.max(0, c.seg.length - 1);
  if (c.kind === 'hidden') { let n = 0; for (let i = 0; i < c.seg.length; i++) if ((c.hid >> i) & 1) n++; return n; }
  return 0;
}

/** 可以操作（揀嚟倒出 / 倒入）？布遮樽鎖死期間、廣告樽、已飛走嘅樽都唔得 */
export const canInteract = (c) => !INERT_KINDS.has(c.kind) && (c.kind !== 'covered' || !c.locked);

export function makeBoard(cups, colors, orders = [], queue = []) {
  return { cups, colors, orders: orders.map(c => ({ color: c, filled: false })), queue: queue.slice(), delivered: 0, moveCount: 0 };
}

export function cloneBoard(b) {
  return {
    cups: b.cups.map(c => ({ kind: c.kind, cap: c.cap, seg: c.seg.slice(), locked: c.locked, hid: c.hid | 0 })),
    colors: b.colors,
    orders: b.orders.map(o => ({ color: o.color, filled: o.filled })),
    queue: (b.queue || []).slice(),
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
    queueLeft: (board.queue || []).length,        // client 只知仲有幾多單，唔知係咩色（Spec v3：隊列順序係關卡資訊）
    delivered: board.delivered,
    moveCount: board.moveCount,
    cups: board.cups.map((c, ci) => {
      const base = { kind: c.kind, cap: c.cap, locked: c.locked, hid: c.hid | 0 };
      if (hiddenCount(c) === 0) return { ...base, seg: c.seg.slice() };
      return { ...base, seg: c.seg.map((v, i) => (!isHiddenCell(c, i) || (revealed && revealed.has(ci + ':' + i))) ? v : null) };
    }),
  };
}

// ---------- 緊湊編碼（v3） ----------
// 標頭: [version=3][colors][nOrders][nQueue][delivered][moveCount lo][moveCount hi][nCups]
// 每張訂單 1 byte: unit key（key < 128）<<1 | filled；之後 nQueue byte 隊列 unit key
// 每隻杯: 1 byte 標頭 (kind<<5 | locked<<2 | capFlag) + cap byte，每格 1 byte unit key（EMPTY=255 補位）
//   capFlag：0 = cap 4，1 = cap 3（曲頸瓶）；cap byte 之後跟 1 byte hid（每格隱藏遮罩，低 4 bit）

const VERSION = 5;   // v5：每隻杯多一個 hid byte（每格獨立隱藏遮罩）

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
  const queue = b.queue || [];
  const bytes = [VERSION, b.colors, b.orders.length, queue.length, b.delivered, b.moveCount & 0xff, (b.moveCount >> 8) & 0xff, b.cups.length];
  for (const o of b.orders) bytes.push(((o.color & 127) << 1) | (o.filled ? 1 : 0));
  for (const q of queue) bytes.push(q & 127);
  for (const c of b.cups) {
    bytes.push((KINDS.indexOf(c.kind) << 5) | ((c.locked ? 1 : 0) << 2) | (c.cap === 3 ? 1 : 0));
    bytes.push(c.hid | 0);
    for (let i = 0; i < c.cap; i++) bytes.push(i < c.seg.length ? c.seg[i] : EMPTY);
  }
  return toBase64Url(bytes);
}

export function decodeBoard(s) {
  const bytes = fromBase64Url(s);
  let p = 0;
  const version = bytes[p++];
  if (version !== VERSION) throw new Error(`board encoding version ${version} unsupported (want ${VERSION}) — regenerate levels/campaign.json`);
  const colors = bytes[p++], nOrders = bytes[p++], nQueue = bytes[p++], delivered = bytes[p++];
  const moveCount = bytes[p++] | (bytes[p++] << 8);
  const nCups = bytes[p++];
  const orders = [];
  for (let i = 0; i < nOrders; i++) { const v = bytes[p++]; orders.push({ color: v >> 1, filled: !!(v & 1) }); }
  const queue = [];
  for (let i = 0; i < nQueue; i++) queue.push(bytes[p++]);
  const cups = [];
  for (let i = 0; i < nCups; i++) {
    const h = bytes[p++];
    const kind = KINDS[h >> 5], locked = !!((h >> 2) & 1), cap = (h & 1) ? 3 : 4;
    const hid = bytes[p++];
    const seg = [];
    for (let k = 0; k < cap; k++) { const v = bytes[p++]; if (v !== EMPTY) seg.push(v); }
    cups.push({ kind, cap, seg, locked, hid });
  }
  return { cups, colors, orders, queue, delivered, moveCount };
}

/** 走步：from 4 bit + to 4 bit = 1 byte */
export function encodeMoves(moves) {
  return toBase64Url(moves.map(m => (m.from << 4) | m.to));
}

export function decodeMoves(s) {
  return Array.from(fromBase64Url(s), v => ({ from: v >> 4, to: v & 15 }));
}
