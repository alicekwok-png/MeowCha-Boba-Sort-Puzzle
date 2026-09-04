// core/rules.js — 合法性判定、走步套用、訂單結算、勝負判定。
// Client 同 server 用同一份；server 用佢重放玩家走步，client 造唔出 server 唔認嘅狀態。

import { EMPTY, cloneBoard } from './board.js';

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
  if (F.locked || T.locked) return false;                    // 封膜杯
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

  // frosted 杯倒空之後降級為 normal（冇嘢再需要隱藏）
  if (next.cups[m.from].kind === 'frosted' && next.cups[m.from].seg.length === 0) next.cups[m.from].kind = 'normal';

  next.moveCount++;
  settleOrders(next, events);
  return next;
}

/** 交付：純色滿杯 + 顏色被點單 → 清空該杯，訂單推進；每交付 2 單解封一隻封膜杯 */
export function settleOrders(b, events = null) {
  let changed = true;
  while (changed) {
    changed = false;
    for (let ci = 0; ci < b.cups.length; ci++) {
      const cup = b.cups[ci];
      if (cup.locked || !isComplete(cup)) continue;
      const slot = b.orders.find(o => !o.filled && o.color === cup.seg[0]);
      if (!slot) continue;
      slot.filled = true;
      if (events) events.push({ type: 'deliver', cup: ci, color: cup.seg[0] });
      cup.seg = [];                 // 交付後變返空杯 —— 玩家賺返嘅空間
      if (cup.kind === 'frosted') cup.kind = 'normal';
      b.delivered++;
      changed = true;
      if (b.delivered % 2 === 0) unlockSealed(b, events);   // 每交付 2 單解封一隻
    }
  }
}

function unlockSealed(b, events) {
  const ci = b.cups.findIndex(x => (x.kind === 'sealed' || x.kind === 'covered') && x.locked);
  if (ci < 0) return;
  b.cups[ci].locked = false;
  b.cups[ci].kind = 'normal';
  if (events) events.push({ type: 'unlock', cup: ci });
}

export function isSolved(b) {
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
