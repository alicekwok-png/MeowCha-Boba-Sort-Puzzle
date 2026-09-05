// core/rules.js — 合法性判定、走步套用、訂單結算、勝負判定。
// Client 同 server 用同一份；server 用佢重放玩家走步，client 造唔出 server 唔認嘅狀態。

import { EMPTY, cloneBoard, INERT_KINDS } from './board.js';

export class IllegalMoveError extends Error {
  constructor(m) { super(`illegal move ${m.from}->${m.to}`); this.move = m; }
}

export function topColor(cup) {
  return cup.seg.length ? cup.seg[cup.seg.length - 1] : EMPTY;
}

/** 頂部連續同色格數 */
export function topRun(cup) {
  if (!cup.seg.length) return 0;
  const c = topColor(cup);
  let n = 0;
  for (let i = cup.seg.length - 1; i >= 0 && cup.seg[i] === c; i--) n++;
  return n;
}

export function isUniform(cup) {
  return cup.seg.length > 0 && topRun(cup) === cup.seg.length;
}

/**
 * 已完成嘅純色滿杯（cap 4）。外帶杯 cap 3 永遠裝唔滿一色，就算三格同色都唔算完成，
 * 仍然可以再倒出去（否則會凍結成死局）。
 */
export function isComplete(cup) {
  return cup.cap === 4 && cup.seg.length === cup.cap && isUniform(cup);
}

export function canPour(b, from, to) {
  if (from === to) return false;
  if (from < 0 || to < 0 || from >= b.cups.length || to >= b.cups.length) return false;
  const F = b.cups[from], T = b.cups[to];
  if (F.locked || T.locked) return false;                    // 布遮樽鎖死
  if (INERT_KINDS.has(F.kind) || INERT_KINDS.has(T.kind)) return false;   // 廣告樽 / 已飛走：唔入唔出
  if (T.kind === 'cracked') return false;                    // 裂瓶（v4 已移除，留相容）
  if (F.seg.length === 0) return false;                      // 空杯冇嘢倒
  if (T.seg.length >= T.cap) return false;                   // 目標滿
  if (isComplete(F)) return false;                           // 已完成純色滿杯唔准再動
  if (T.seg.length === 0) return true;                       // 倒入空杯永遠合法
  return topColor(T) === topColor(F);
}

export function pourAmount(b, from, to) {
  const F = b.cups[from], T = b.cups[to];
  return Math.min(topRun(F), T.cap - T.seg.length);
}

/**
 * 套用走步，回傳新盤面（不改原盤面）。含訂單結算 + 封膜解鎖。
 * 若傳入 `events` 陣列，會記錄 {type:'deliver', cup, color} / {type:'unlock', cup} 供 client 做動畫。
 */
export function applyMove(b, m, events = null) {
  if (!canPour(b, m.from, m.to)) throw new IllegalMoveError(m);
  const next = cloneBoard(b);
  const n = pourAmount(b, m.from, m.to);
  const color = topColor(next.cups[m.from]);

  next.cups[m.from].seg.splice(-n, n);
  for (let i = 0; i < n; i++) next.cups[m.to].seg.push(color);

  // hidden / frosted 樽倒空之後降級為 normal（冇嘢再需要隱藏）
  if ((next.cups[m.from].kind === 'frosted' || next.cups[m.from].kind === 'hidden') && next.cups[m.from].seg.length === 0) next.cups[m.from].kind = 'normal';

  next.moveCount++;
  settleOrders(next, events);
  return next;
}

/** v4.1 §5.1：交夠 2 單，一次過解開關內全部布罩樽 */
export const CLOTH_UNLOCK_ORDERS = 2;

/**
 * Spec v3 §2：純色滿樽 + 該色有 active 訂單槽 → 交貨（樽飛走 gone、盤面釋放位置），只有嗰個槽補隊列下一單（隊列空 → 槽 filled）；
 * 純色滿樽冇訂單 → 留喺盤面（已封：isComplete，唔入唔出）；隊列推進後再掃一次 → 已封樽嘅色追上就自動飛走（§2.3）。
 * 交夠 CLOTH_UNLOCK_ORDERS 單 → 全部布罩樽一次過解開。
 */
export function settleOrders(b, events = null) {
  if (!b.queue) b.queue = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let ci = 0; ci < b.cups.length; ci++) {
      const cup = b.cups[ci];
      if (cup.locked || !isComplete(cup)) continue;
      const slot = b.orders.find(o => !o.filled && o.color === cup.seg[0]);
      if (!slot) continue;
      const color = cup.seg[0];
      if (events) events.push({ type: 'deliver', cup: ci, color, slot: b.orders.indexOf(slot) });
      cup.seg = [];                 // v4 §7：交貨後樽飛向訂單槽，盤面釋放位置（唔留空樽）
      cup.kind = 'gone';
      b.delivered++;
      advanceQueue(b, slot, events);
      changed = true;
      if (b.delivered === CLOTH_UNLOCK_ORDERS) unlockAllCloth(b, events);
    }
  }
}

/** Spec v3 §2.4：一個槽交完貨，只有嗰個槽補新訂單；隊列空 → 槽收工（filled） */
export function advanceQueue(b, slot, events = null) {
  if (b.queue && b.queue.length) {
    slot.color = b.queue.shift();
    slot.filled = false;
    if (events) events.push({ type: 'order', slot: b.orders.indexOf(slot), color: slot.color });
  } else {
    slot.filled = true;
  }
}

/** 開一個新槽（廣告解鎖）：由隊列攞下一單；隊列空就開唔到 */
export function openSlot(b, events = null) {
  if (!b.queue || !b.queue.length) return null;
  const slot = { color: b.queue.shift(), filled: false };
  b.orders.push(slot);
  if (events) events.push({ type: 'order', slot: b.orders.length - 1, color: slot.color });
  settleOrders(b, events);   // 已封樽嘅色追上 → 即刻飛走
  return slot;
}

function unlockAllCloth(b, events) {
  b.cups.forEach((c, ci) => {
    if (c.kind !== 'covered' || !c.locked) return;
    c.locked = false; c.kind = 'normal';
    if (events) events.push({ type: 'unlock', cup: ci });
  });
}

/** Spec v3 §2.5：過關 = 隊列空 + 所有槽收工（全部顏色都交咗貨）。唔係「全部樽純色」 */
export function isSolved(b) {
  if (b.queue && b.queue.length) return false;
  if (b.orders.some(o => !o.filled)) return false;
  return b.cups.every(c => c.seg.length === 0 || isComplete(c));
}

export function legalMoves(b) {
  const out = [];
  for (let i = 0; i < b.cups.length; i++)
    for (let j = 0; j < b.cups.length; j++)
      if (canPour(b, i, j)) out.push({ from: i, to: j });
  return out;
}

export function isDead(b) {
  return legalMoves(b).length === 0 && !isSolved(b);
}
