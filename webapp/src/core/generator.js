// core/generator.js — 隨機生成 + 驗證。段數係難度主旋鈕，所以唔用逆向生成。

import { makeCup, countSegments, hiddenCount, CAP_NORMAL, CAP_TAKEAWAY } from './board.js';
import { isComplete, isSolved, topColor } from './rules.js';
import { solveEx, countOptimalPaths, safeOpening } from './solver.js';
import { mulberry32, shuffle, randInt } from './prng.js';
import { PALETTE, colorsCompatible, MAX_COLORS_BY_HUE } from './palette.js';

/**
 * @typedef {{cups:number, colors:number, empties:number, segments:number,
 *            frosted:number, sealed:number, takeaway:number, orders:number,
 *            optimalMin:number, optimalMax:number}} LevelConfig
 */

export function validateConfig(cfg) {
  const filled = cfg.cups - cfg.empties;
  const capacity = (filled - cfg.takeaway) * CAP_NORMAL + cfg.takeaway * CAP_TAKEAWAY;
  const units = cfg.colors * CAP_NORMAL;
  if (cfg.colors > MAX_COLORS_BY_HUE) throw new Error(`colors > ${MAX_COLORS_BY_HUE}: 夜市色板純靠顏色最多 6 色同關（7 色以上要圖案系統 P3）`);
  if (cfg.palette && (cfg.palette.length !== cfg.colors || !colorsCompatible(cfg.palette))) throw new Error('palette 指定色組唔符合互斥規則或色數');
  if (cfg.empties < 1) throw new Error('need at least 1 empty cup');
  if (filled < cfg.colors) throw new Error('filled cups < colors');
  if (capacity < units) throw new Error(`capacity ${capacity} < units ${units}`);
  if (capacity - units > filled * 2) throw new Error('too much slack: cups would be nearly empty');
  const lockedCups = cfg.sealed + (cfg.covered || 0);
  if (cfg.frosted + lockedCups + cfg.takeaway > filled) throw new Error('special cups exceed filled cups');
  if (lockedCups > 0 && cfg.orders < 2 * lockedCups) throw new Error('sealed/covered cups need >= 2 orders each');
  if (cfg.orders > cfg.colors) throw new Error('orders > colors');
  if (cfg.segments < cfg.colors || cfg.segments > units) throw new Error('segments out of range');
  if (cfg.cups > 16) throw new Error('max 16 cups (4-bit move encoding)');
  return true;
}

/**
 * 揀出 n 隻顏色（隨機回溯）：夜市 brief A3 互斥規則（色相距 < 40° 且明度差 < 25% 唔可以同關；F×H 只限 ≤4 色關）。
 * fixed 有指定色組（第 1–12 關分配表）就直接用，只打亂次序。
 */
export function pickColors(n, rng, fixed = null) {
  if (fixed) return colorsCompatible(fixed) && fixed.length === n ? shuffle(fixed.slice(), rng) : null;
  const order = shuffle(PALETTE.map(p => p.id), rng);
  const chosen = [];
  const ok = (id) => colorsCompatible([...chosen, id]);
  const bt = (i) => {
    if (chosen.length === n) return true;
    for (let k = i; k < order.length; k++) {
      if (order.length - k < n - chosen.length) return false;
      if (!ok(order[k])) continue;
      chosen.push(order[k]);
      if (bt(k + 1)) return true;
      chosen.pop();
    }
    return false;
  };
  return bt(0) ? chosen : null;
}

/** 隨機鋪一個盤面（未驗證）。回傳 null 代表呢次抽樣唔符合基本形狀。 */
export function randomFill(cfg, rng) {
  const colors = pickColors(cfg.colors, rng, cfg.palette || null);
  if (!colors) return null;
  const filled = cfg.cups - cfg.empties;

  // 杯種分配：外帶 / 封膜 / 布遮 / 磨砂（關卡表指定數量）；餘下隱藏密度由普通杯嘅「隱藏層」補足
  const kinds = [];
  for (let i = 0; i < cfg.takeaway; i++) kinds.push('takeaway');
  for (let i = 0; i < cfg.sealed; i++) kinds.push('sealed');
  for (let i = 0; i < (cfg.covered || 0); i++) kinds.push('covered');
  for (let i = 0; i < cfg.frosted; i++) kinds.push('frosted');
  while (kinds.length < filled) kinds.push('normal');
  shuffle(kinds, rng);

  // 每杯目標格數：由滿開始隨機扣減，扣到總量 = 4 × 色數
  const caps = kinds.map(k => (k === 'takeaway' ? CAP_TAKEAWAY : CAP_NORMAL));
  const sizes = caps.slice();
  const minSize = kinds.map(k => (k === 'frosted' ? 2 : 1));
  const units = cfg.colors * CAP_NORMAL;
  let slack = sizes.reduce((a, b) => a + b, 0) - units;
  let guard = 0;
  while (slack > 0 && guard++ < 1000) {
    const i = randInt(rng, 0, sizes.length - 1);
    if (sizes[i] > minSize[i]) { sizes[i]--; slack--; }
  }
  if (slack > 0) return null;

  // 隱藏密度（工單 #5 公式 + 夜市 brief 隱藏層）：目標隱藏格 = ratio × 有色格總數。
  // 布遮杯（全部格）同磨砂杯（size−1 格）先扣走，餘下由普通杯嘅隱藏層（底部 1..size−1 格為 ?）補足。
  const hiddenPer = kinds.map(() => 0);
  if (cfg.hiddenRatio !== undefined && cfg.hiddenRatio > 0) {
    const fixedCells = kinds.reduce((a, k, i) => a + (k === 'covered' ? sizes[i] : k === 'frosted' ? sizes[i] - 1 : 0), 0);
    let left = Math.max(0, Math.round(cfg.hiddenRatio * units) - fixedCells);
    const cand = shuffle(kinds.map((k, i) => (k === 'normal' && sizes[i] >= 2 ? i : -1)).filter(i => i >= 0), rng);
    for (const i of cand) {
      if (left <= 0) break;
      const k = Math.min(left, sizes[i] - 1, 3);
      hiddenPer[i] = k; left -= k;
    }
  }

  // 段數控制：先決定每色分成幾多段（總數 = 目標段數），再隨機組合
  const runsPerColor = new Array(cfg.colors).fill(1);
  let extra = cfg.segments - cfg.colors;
  guard = 0;
  while (extra > 0 && guard++ < 1000) {
    const i = randInt(rng, 0, cfg.colors - 1);
    if (runsPerColor[i] < CAP_NORMAL) { runsPerColor[i]++; extra--; }
  }
  const runs = [];
  for (let ci = 0; ci < cfg.colors; ci++) {
    // 將 4 格拆成 k 段（每段 ≥ 1）
    const k = runsPerColor[ci];
    const cuts = shuffle([1, 2, 3], rng).slice(0, k - 1).sort((a, b) => a - b);
    let prev = 0;
    for (const c of [...cuts, CAP_NORMAL]) { runs.push({ color: colors[ci], n: c - prev }); prev = c; }
  }
  shuffle(runs, rng);

  // 順序倒入各杯，段落裝唔落就切開落下一杯
  const segs = kinds.map(() => []);
  let cupIdx = 0;
  for (const r of runs) {
    let left = r.n;
    while (left > 0) {
      while (cupIdx < segs.length && segs[cupIdx].length >= sizes[cupIdx]) cupIdx++;
      if (cupIdx >= segs.length) return null;
      const room = sizes[cupIdx] - segs[cupIdx].length;
      const put = Math.min(room, left);
      for (let i = 0; i < put; i++) segs[cupIdx].push(r.color);
      left -= put;
    }
  }

  const cups = kinds.map((k, i) => makeCup(k, segs[i], k === 'sealed' || k === 'covered', hiddenPer[i]));
  for (let i = 0; i < cfg.empties; i++) cups.push(makeCup('normal', []));
  shuffle(cups, rng);

  // 訂單：由本關顏色抽
  const orderColors = shuffle(colors.slice(), rng).slice(0, cfg.orders);

  return {
    cups,
    colors: cfg.colors,
    orders: orderColors.map(c => ({ color: c, filled: false })),
    delivered: 0,
    moveCount: 0,
  };
}

// ---------- 質量檢查 ----------

/** 檢查 5：同關色組符合夜市 brief A3 互斥規則 */
export function colorSafe(b) {
  const used = [...new Set(b.cups.flatMap(c => c.seg))];
  return colorsCompatible(used);
}

/** 檢查 6：被點單嘅顏色必須有部分喺初始就可見（隱藏格 / 布遮杯唔計） */
export function ordersReachable(b) {
  const visible = new Set();
  for (const c of b.cups) {
    if (c.kind === 'covered') continue;   // 布遮杯：完全睇唔到
    const k = hiddenCount(c);
    c.seg.forEach((v, i) => { if (i >= k || i === c.seg.length - 1) visible.add(v); });
  }
  return b.orders.every(o => visible.has(o.color));
}

/** 檢查 7：磨砂杯 / 有隱藏層嘅杯唔可以有 3 格以上連續同色（否則 ? 冇意義） */
export function frostedMeaningful(b) {
  return b.cups.filter(c => c.kind === 'frosted' || hiddenCount(c) > 0).every(c => {
    let run = 1;
    for (let i = 1; i < c.seg.length; i++) {
      run = c.seg[i] === c.seg[i - 1] ? run + 1 : 1;
      if (run >= 3) return false;
    }
    return true;
  });
}

/** 隱藏格數：布遮杯全部 + 磨砂杯非頂格 + 普通杯隱藏層 */
export function countHidden(b) {
  return b.cups.reduce((a, c) => a + hiddenCount(c), 0);
}

/** 三星門檻：無 ? 關卡 = 最優 + 3；有 ? 關卡 = 最優 + 3 + (? 杯數 × 2) */
export function starThresholds(optimal, board) {
  const q = board.cups.filter(c => c.kind === 'frosted' || (c.kind !== 'covered' && (c.hidden || 0) > 0)).length;
  const three = optimal + 3 + q * 2;
  return { three, two: three + 5 };
}

/**
 * 生成關卡。回傳 { board, optimal, thresholds, attempts, rejects } 或 null。
 * opts.maxAttempts 預設 400；opts.onReject 可用作統計。
 */
export function generateLevelEx(cfg, seed, opts = {}) {
  validateConfig(cfg);
  const rng = mulberry32(seed);
  const maxAttempts = opts.maxAttempts ?? 400;
  const rejects = { shape: 0, segments: 0, unsolvable: 0, length: 0, unique: 0, opening: 0, color: 0, orders: 0, frosted: 0, aborted: 0 };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const b = randomFill(cfg, rng);
    if (!b) { rejects.shape++; continue; }
    if (b.cups.some(isComplete) || isSolved(b)) { rejects.shape++; continue; }

    // 檢查 1：段數命中
    if (Math.abs(countSegments(b) - cfg.segments) > 1) { rejects.segments++; continue; }
    // 平嘢先：色盲 / 訂單 / 磨砂
    if (!colorSafe(b)) { rejects.color++; continue; }
    if (!ordersReachable(b)) { rejects.orders++; continue; }
    if (!frostedMeaningful(b)) { rejects.frosted++; continue; }

    // 檢查 2：可解，且步數落喺目標區間
    const r = solveEx(b, cfg.optimalMax + 2, opts.maxNodes ?? 150_000);
    if (r.aborted) { rejects.aborted++; continue; }
    if (!r.moves) { rejects.unsolvable++; continue; }
    const sol = r.moves;
    if (sol.length < cfg.optimalMin || sol.length > cfg.optimalMax) { rejects.length++; continue; }

    // 檢查 3：最優解不唯一
    if (countOptimalPaths(b, sol.length, 2) < 2) { rejects.unique++; continue; }

    // 檢查 4：起手安全區
    const K = cfg.cups <= 8 ? 3 : 2;
    if (!safeOpening(b, K, sol.length + 4)) { rejects.opening++; continue; }

    return { board: b, optimal: sol.length, solution: sol, thresholds: starThresholds(sol.length, b), attempts: attempt, rejects, hiddenCells: countHidden(b), units: cfg.colors * CAP_NORMAL };
  }
  return null;
}

export function generateLevel(cfg, seed, opts) {
  const r = generateLevelEx(cfg, seed, opts);
  return r ? r.board : null;
}
