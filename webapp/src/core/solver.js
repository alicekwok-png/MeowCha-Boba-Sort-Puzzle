// core/solver.js — IDA* 求解。永遠喺完整資訊（真實盤面）上運行。

import { applyMove, isSolved, isDead, legalMoves, isUniform, isComplete, topColor, topRun, pourAmount } from './rules.js';
import { INERT_KINDS, CAP_NORMAL } from './board.js';

const FOUND = -1;
const INF = Number.MAX_SAFE_INTEGER;

/**
 * 可採納啟發函數。
 *
 * 每隻顏色最終要佔 homes = ceil(該色格數 / 樽容量) 隻樽（一色 4 格 → 1 隻；一色 8 格 → 2 隻，用戶 2026-09-06）。
 * 已經坐喺某隻合資格樽最底嘅段可以原地不動當「最終家」，但最多只可以認 homes 個。
 * 所以：h = Σ_color ( 該色段數 − min(該色底段數, homes) )。
 *
 * 仍然唔會高估：倒一次液最多令 h 減 1 ——
 *   · 倒落同色頂 → 合併，段數 −1，底段數唔變；
 *   · 倒落空樽 → 來源少一段、目標多一段（段數淨變 0），最多多認一個家 → −1。
 * homes 封頂係關鍵：冇佢，一色兩樽嘅盤面會扣多咗，變成高估，IDA* 會剪走真正最優解。
 */
export function heuristic(b) {
  // unit key = color | pattern<<4，最大 15 | 4<<4 = 79 → 陣列 128 夠用
  const segs = new Uint8Array(128);
  const bottoms = new Uint8Array(128);
  const cells = new Uint8Array(128);
  for (const c of b.cups) {
    const s = c.seg;
    const n = s.length;
    if (n === 0) continue;
    if (c.cap === CAP_NORMAL && c.kind !== 'cracked') bottoms[s[0]]++;   // 裂瓶只出不入：底段唔可以做最終家（除非已經純色滿）
    else if (c.kind === 'cracked' && n === CAP_NORMAL && isUniform(c)) bottoms[s[0]]++;
    segs[s[0]]++;
    cells[s[0]]++;
    for (let i = 1; i < n; i++) { if (s[i] !== s[i - 1]) segs[s[i]]++; cells[s[i]]++; }
  }
  let h = 0;
  for (let k = 0; k < 128; k++) {
    if (!segs[k]) continue;
    const homes = Math.ceil(cells[k] / CAP_NORMAL);
    h += segs[k] - Math.min(bottoms[k], homes);
  }
  return h;
}

/** 正規化：空杯之間、內容相同嘅杯之間可互換。每隻杯壓成一個整數再排序。 */
export function canonical(b) {
  const n = b.cups.length;
  const keys = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = b.cups[i];
    // 4 bit 杯標頭（locked / cap / cracked）+ 4 格 × 7 bit unit key（127 = 空）= 32 bit
    let k = ((c.locked || INERT_KINDS.has(c.kind)) ? 1 : 0) | ((c.cap === 3 ? 1 : 0) << 1) | ((c.kind === 'cracked' ? 1 : 0) << 2);
    const s = c.seg;
    for (let j = 0; j < 4; j++) k |= ((j < s.length ? s[j] & 127 : 127) << (4 + j * 7));
    keys[i] = k;
  }
  keys.sort((a, c) => a - c);
  let str = '';
  for (let i = 0; i < n; i++) str += String.fromCharCode(keys[i] & 0xffff, (keys[i] >>> 16) & 0xffff);
  // 訂單狀態：每個槽 (color | filled<<7)，再加隊列長度（隊列順序係固定嘅，長度足以決定剩餘內容）
  let os = '';
  for (let i = 0; i < b.orders.length; i++) os += String.fromCharCode((b.orders[i].color & 127) | (b.orders[i].filled ? 128 : 0));
  return str + os + String.fromCharCode((b.queue || []).length);
}

function score(b, m) {
  const F = b.cups[m.from], T = b.cups[m.to];
  let s = 0;
  const n = pourAmount(b, m.from, m.to);
  const tc = topColor(F);
  if (T.cap === 4 && T.seg.length + n === T.cap && (T.seg.length === 0 || topColor(T) === tc)) s += 100; // 完成一杯
  if (topRun(F) === F.seg.length) s += 30;      // 倒空來源
  if (T.seg.length > 0) s += 20;                // 合併優於佔用空杯
  for (const o of b.orders) if (!o.filled && o.color === tc) { s += 40; break; } // 推進訂單
  return s;
}

/** 走步排序與剪枝 */
export function orderedMoves(b, last) {
  const cups = b.cups;
  // 剪枝 3 前置：每種 cap 只保留第一隻可用空杯
  let firstEmpty4 = -1, firstEmpty3 = -1;
  for (let i = 0; i < cups.length; i++) {
    const c = cups[i];
    if (c.seg.length === 0 && !c.locked && c.kind !== 'cracked' && !INERT_KINDS.has(c.kind)) {
      if (c.cap === 4 && firstEmpty4 < 0) firstEmpty4 = i;
      else if (c.cap === 3 && firstEmpty3 < 0) firstEmpty3 = i;
    }
  }
  const moves = [];
  const sc = [];
  for (let i = 0; i < cups.length; i++) {
    const F = cups[i];
    if (F.locked || F.seg.length === 0 || INERT_KINDS.has(F.kind)) continue;
    if (isComplete(F)) continue;
    const fUniform = isUniform(F);
    const tc = topColor(F);
    for (let j = 0; j < cups.length; j++) {
      if (i === j) continue;
      const T = cups[j];
      if (T.locked || T.seg.length >= T.cap || T.kind === 'cracked' || INERT_KINDS.has(T.kind)) continue;   // 廣告樽 / 已飛走：唔入
      if (T.seg.length === 0) {
        if (fUniform && F.cap === 4) continue;                    // 剪枝 2（外帶杯例外：佢最終必須清空）
        if (j !== (T.cap === 4 ? firstEmpty4 : firstEmpty3)) continue; // 剪枝 3
      } else if (topColor(T) !== tc) continue;
      if (last && i === last.to && j === last.from) continue;     // 剪枝 1
      const m = { from: i, to: j };
      moves.push(m);
      sc.push(score(b, m));
    }
  }
  const idx = moves.map((_, i) => i).sort((a, c) => sc[c] - sc[a]);
  return idx.map(i => moves[i]);
}

/** deadline（牆鐘 ms）：每 DEADLINE_STRIDE 個節點檢查一次，超時即刻 abort（成本近乎零；練習關即時生成 / 關卡 generator 都靠佢） */
const DEADLINE_STRIDE = 50_000;
const pastDeadline = (state) => state.deadline && (state.nodes % DEADLINE_STRIDE === 0) && Date.now() > state.deadline;

/**
 * IDA* 主體。回傳 { moves, nodes, aborted }。
 * moves === null 代表 maxDepth 內無解（或 nodes 超出 maxNodes / 過咗 deadline，此時 aborted = true）。
 */
export function solveEx(start, maxDepth = 40, maxNodes = 4_000_000, deadline = 0) {
  if (isSolved(start)) return { moves: [], nodes: 0, aborted: false };
  const path = [];
  const onPath = new Set([canonical(start)]);
  const state = { nodes: 0, maxNodes, deadline, aborted: false, seen: new Map() };

  let bound = heuristic(start);
  while (bound <= maxDepth) {
    state.seen.clear();
    const t = search(start, 0, bound, path, onPath, state, null);
    if (t === FOUND) return { moves: path.slice(), nodes: state.nodes, aborted: false };
    if (state.aborted) return { moves: null, nodes: state.nodes, aborted: true };
    if (t === INF) return { moves: null, nodes: state.nodes, aborted: false };
    bound = t;
  }
  return { moves: null, nodes: state.nodes, aborted: false };
}

export function solve(start, maxDepth = 40, maxNodes = 4_000_000, deadline = 0) {
  return solveEx(start, maxDepth, maxNodes, deadline).moves;
}

function search(b, g, bound, path, onPath, state, last) {
  if (isSolved(b)) return FOUND;
  if (++state.nodes > state.maxNodes || pastDeadline(state)) { state.aborted = true; return INF; }

  let min = INF;
  for (const m of orderedMoves(b, last)) {
    const nb = applyMove(b, m);
    const f = g + 1 + heuristic(nb);
    if (f > bound) { if (f < min) min = f; continue; }   // 邊界節點：唔使計 canonical

    const key = canonical(nb);
    if (onPath.has(key)) continue;
    // 同一輪 bound 內，同一狀態以 ≤ g+1 到達過而未找到解 → 唔使再展開
    const prev = state.seen.get(key);
    if (prev !== undefined && prev.g <= g + 1) { if (prev.t < min) min = prev.t; continue; }

    onPath.add(key); path.push(m);
    const t = search(nb, g + 1, bound, path, onPath, state, m);
    if (t === FOUND) return FOUND;
    if (state.aborted) return INF;
    path.pop(); onPath.delete(key);
    state.seen.set(key, { g: g + 1, t });
    if (t < min) min = t;
  }
  return min;
}

/**
 * 計算長度恰為 `len` 嘅最優解條數，數到 `limit` 即停。
 * 用於「最優解不唯一」質量檢查。以 (狀態, 深度) 記憶化。
 */
export function countOptimalPaths(start, len, limit = 2, maxNodes = 2_000_000, deadline = 0) {
  const memo = new Map();
  const state = { nodes: 0, deadline };
  const dfs = (b, g, last) => {
    if (isSolved(b)) return g === len ? 1 : 0;
    if (g + heuristic(b) > len) return 0;
    const key = canonical(b) + String.fromCharCode(g);
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    if (++state.nodes > maxNodes || pastDeadline(state)) return limit;   // 超預算 / 超時：當「不唯一」放行，由 caller 嘅 deadline 決定棄唔棄
    let total = 0;
    for (const m of orderedMoves(b, last)) {
      total += dfs(applyMove(b, m), g + 1, m);
      if (total >= limit) { total = limit; break; }
    }
    memo.set(key, total);
    return total;
  };
  return dfs(start, 0, null);
}

/**
 * 起手安全區：由起始狀態出發，任何深度 ≤ K 嘅走法（不剪枝）都唔可以進入死局 / 無解。
 * 葉節點求解超出 node 預算會視為不安全（寧可拒收，唔會誤放）。
 */
export function safeOpening(b, K, depthCap, maxNodes = 150_000, deadline = 0) {
  const memo = new Map();
  const dfs = (s, d) => {
    if (isDead(s)) return false;
    if (deadline && Date.now() > deadline) return false;   // 超時當不安全（拒收）
    const key = canonical(s) + String.fromCharCode(d);
    if (memo.has(key)) return memo.get(key);
    let ok;
    if (d === 0) ok = solve(s, depthCap, maxNodes, deadline) !== null;
    else {
      ok = true;
      for (const m of legalMoves(s)) {
        if (!dfs(applyMove(s, m), d - 1)) { ok = false; break; }
      }
    }
    memo.set(key, ok);
    return ok;
  };
  return dfs(b, K);
}
