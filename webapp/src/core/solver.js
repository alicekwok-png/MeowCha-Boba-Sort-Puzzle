// core/solver.js — IDA* 求解。永遠喺完整資訊（真實盤面）上運行。

import { applyMove, isSolved, isDead, legalMoves, isUniform, isComplete, topColor, topRun, pourAmount } from './rules.js';

const FOUND = -1;
const INF = Number.MAX_SAFE_INTEGER;

/**
 * 可採納啟發函數。
 * 每隻顏色最終只可以留喺一隻杯（或者被交付），而留低嘅嗰段必須係某隻非外帶杯嘅底段。
 * 所以：h = Σ_color ( 該色段數 − (該色有冇底段 ? 1 : 0) )。
 * 每步最多令 h 減 1（合併減一段；倒入空杯製造一個新底段），故此永不高估。
 * 呢個比「段數 − 色數」更緊，因為冇底段嘅顏色全部段都要郁。
 */
export function heuristic(b) {
  const segs = new Uint8Array(16);
  const hasBottom = new Uint8Array(16);
  for (const c of b.cups) {
    const s = c.seg;
    const n = s.length;
    if (n === 0) continue;
    if (c.cap === 4) hasBottom[s[0]] = 1;
    segs[s[0]]++;
    for (let i = 1; i < n; i++) if (s[i] !== s[i - 1]) segs[s[i]]++;
  }
  let h = 0;
  for (let k = 0; k < 16; k++) if (segs[k]) h += segs[k] - hasBottom[k];
  return h;
}

/** 正規化：空杯之間、內容相同嘅杯之間可互換。每隻杯壓成一個整數再排序。 */
export function canonical(b) {
  const n = b.cups.length;
  const keys = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = b.cups[i];
    let k = (c.locked ? 1 : 0) | ((c.cap & 7) << 1);          // 4 bit
    const s = c.seg;
    for (let j = 0; j < 4; j++) k |= ((j < s.length ? s[j] : 15) << (4 + j * 4));  // 16 bit
    keys[i] = k;
  }
  keys.sort((a, c) => a - c);
  let str = '';
  for (let i = 0; i < n; i++) str += String.fromCharCode(keys[i] & 0xffff, keys[i] >>> 16);
  let o = 0;
  for (let i = 0; i < b.orders.length; i++) if (b.orders[i].filled) o |= 1 << i;
  return str + String.fromCharCode(o);
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
    if (c.seg.length === 0 && !c.locked) {
      if (c.cap === 4 && firstEmpty4 < 0) firstEmpty4 = i;
      else if (c.cap === 3 && firstEmpty3 < 0) firstEmpty3 = i;
    }
  }
  const moves = [];
  const sc = [];
  for (let i = 0; i < cups.length; i++) {
    const F = cups[i];
    if (F.locked || F.seg.length === 0) continue;
    if (isComplete(F)) continue;
    const fUniform = isUniform(F);
    const tc = topColor(F);
    for (let j = 0; j < cups.length; j++) {
      if (i === j) continue;
      const T = cups[j];
      if (T.locked || T.seg.length >= T.cap) continue;
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

/**
 * IDA* 主體。回傳 { moves, nodes, aborted }。
 * moves === null 代表 maxDepth 內無解（或 nodes 超出 maxNodes，此時 aborted = true）。
 */
export function solveEx(start, maxDepth = 40, maxNodes = 4_000_000) {
  if (isSolved(start)) return { moves: [], nodes: 0, aborted: false };
  const path = [];
  const onPath = new Set([canonical(start)]);
  const state = { nodes: 0, maxNodes, aborted: false, seen: new Map() };

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

export function solve(start, maxDepth = 40, maxNodes = 4_000_000) {
  return solveEx(start, maxDepth, maxNodes).moves;
}

function search(b, g, bound, path, onPath, state, last) {
  if (isSolved(b)) return FOUND;
  if (++state.nodes > state.maxNodes) { state.aborted = true; return INF; }

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
export function countOptimalPaths(start, len, limit = 2, maxNodes = 2_000_000) {
  const memo = new Map();
  const state = { nodes: 0 };
  const dfs = (b, g, last) => {
    if (isSolved(b)) return g === len ? 1 : 0;
    if (g + heuristic(b) > len) return 0;
    const key = canonical(b) + String.fromCharCode(g);
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    if (++state.nodes > maxNodes) return limit;
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
export function safeOpening(b, K, depthCap, maxNodes = 150_000) {
  const memo = new Map();
  const dfs = (s, d) => {
    if (isDead(s)) return false;
    const key = canonical(s) + String.fromCharCode(d);
    if (memo.has(key)) return memo.get(key);
    let ok;
    if (d === 0) ok = solve(s, depthCap, maxNodes) !== null;
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
