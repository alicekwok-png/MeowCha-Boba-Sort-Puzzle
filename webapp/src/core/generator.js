// core/generator.js — 隨機生成 + 驗證。段數係難度主旋鈕，所以唔用逆向生成。

import { makeCup, makeUnit, countSegments, hiddenCount, CAP_NORMAL, CAP_TAKEAWAY } from './board.js';
import { isComplete, isSolved } from './rules.js';
import { solveEx, countOptimalPaths, safeOpening } from './solver.js';
import { mulberry32, shuffle, randInt } from './prng.js';
import { PALETTE, colorsCompatible, unitsCompatible, MAX_COLORS_BY_HUE } from './palette.js';

/**
 * @typedef {{cups:number, colors:number, empties:number, segments:number,
 *            frosted:number, covered:number, takeaway:number, cracked:number, orders:number,
 *            optimalMin:number, optimalMax:number, palette?:number[], patterns?:number[], hiddenRatio?:number}} LevelConfig
 *  colors = 元素數（色 × 圖案）；patterns = 每個元素嘅 patternId（預設全部 P0）
 */

export function validateConfig(cfg) {
  const filled = cfg.cups - cfg.empties;
  const capacity = (filled - cfg.takeaway) * CAP_NORMAL + cfg.takeaway * CAP_TAKEAWAY;
  const units = cfg.colors * CAP_NORMAL;
  const patterns = cfg.patterns || new Array(cfg.colors).fill(0);
  if (patterns.length !== cfg.colors) throw new Error('patterns length != colors');
  const distinctColors = cfg.palette ? new Set(cfg.palette).size : cfg.colors;
  if (!cfg.palette && cfg.colors > MAX_COLORS_BY_HUE && patterns.every(p => p === 0)) throw new Error(`colors > ${MAX_COLORS_BY_HUE}: 純靠顏色最多 6 色同關（7 色以上要圖案）`);
  if (cfg.palette && cfg.palette.length !== cfg.colors) throw new Error('palette length != colors');
  if (cfg.palette && !unitsCompatible(cfg.palette.map((c, i) => makeUnit(c, patterns[i])))) throw new Error('palette 指定色組唔符合互斥 / 圖案規則');
  if (distinctColors > MAX_COLORS_BY_HUE) throw new Error(`distinct colors > ${MAX_COLORS_BY_HUE}`);
  if (cfg.empties < 1) throw new Error('need at least 1 empty cup');
  if (filled < cfg.colors) throw new Error('filled cups < colors');
  if (capacity < units) throw new Error(`capacity ${capacity} < units ${units}`);
  if (capacity - units > filled * 2) throw new Error('too much slack: cups would be nearly empty');
  const covered = cfg.covered || 0, cracked = cfg.cracked || 0;
  if (cfg.frosted + covered + cfg.takeaway + cracked > filled) throw new Error('special cups exceed filled cups');
  if (covered > 0 && cfg.orders < 2 * covered) throw new Error('covered cups need >= 2 orders each');
  if (cfg.orders > cfg.colors) throw new Error('orders > colors');
  if (cfg.segments < cfg.colors || cfg.segments > units) throw new Error('segments out of range');
  if (cfg.cups > 16) throw new Error('max 16 cups (4-bit move encoding)');
  return true;
}

/**
 * 揀出 n 隻顏色（隨機回溯）：互斥規則（EXCLUSIVE_PAIRS；F×H 只限 ≤4 色關）。
 * fixed 有指定色組（第 1–12 關分配表）就直接用，只打亂次序。
 */
export function pickColors(n, rng, fixed = null) {
  if (fixed) return colorsCompatible([...new Set(fixed)]) && fixed.length === n ? shuffle(fixed.slice(), rng) : null;
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
  // 元素 = 色 × 圖案（unit key）。palette 指定時 colors 陣列可以有重複色（配唔同圖案）
  const patterns = cfg.patterns || new Array(cfg.colors).fill(0);
  const picked = cfg.palette ? cfg.palette.slice() : pickColors(cfg.colors, rng);
  if (!picked) return null;
  const colors = shuffle(picked.map((c, i) => makeUnit(c, patterns[i])), rng);
  const filled = cfg.cups - cfg.empties;

  // 器皿分配：曲頸瓶 / 布遮瓶 / 裂瓶 / 磨砂瓶（關卡表指定最少數量）；磨砂瓶數量之後按隱藏密度補足
  const kinds = [];
  for (let i = 0; i < cfg.takeaway; i++) kinds.push('takeaway');
  for (let i = 0; i < (cfg.covered || 0); i++) kinds.push('covered');
  for (let i = 0; i < (cfg.cracked || 0); i++) kinds.push('cracked');
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

  // 隱藏密度（工單 #5 公式）：目標隱藏格 = ratio × 有色格總數。
  // 布遮瓶（頂格以外）同關卡表指定嘅磨砂瓶先扣走，餘下由普通瓶隨機轉做磨砂瓶（每隻隱藏 size−1 格）補足，最接近目標就停。
  if (cfg.hiddenRatio !== undefined && cfg.hiddenRatio > 0) {
    const fixedCells = kinds.reduce((a, k, i) => a + ((k === 'covered' || k === 'frosted') ? Math.max(0, sizes[i] - 1) : 0), 0);
    const target = Math.max(0, Math.round(cfg.hiddenRatio * units) - fixedCells);
    const cand = shuffle(kinds.map((k, i) => (k === 'normal' && sizes[i] >= 2 ? i : -1)).filter(i => i >= 0), rng);
    let hidden = 0;
    for (const i of cand) {
      const add = sizes[i] - 1;
      if (hidden >= target) break;
      if (hidden + add - target > target - hidden) break;   // 加咗會離目標更遠就停
      kinds[i] = 'frosted'; hidden += add;
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

  const cups = kinds.map((k, i) => makeCup(k, segs[i], k === 'covered'));
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

/** 檢查 5：同關元素（色 × 圖案）符合互斥 / 圖案規則 */
export function colorSafe(b) {
  const used = [...new Set(b.cups.flatMap(c => c.seg))];
  return unitsCompatible(used);
}

/** 檢查 6：被點單嘅元素必須有部分喺初始就可見（磨砂 / 布遮瓶只有頂格可見——布遮瓶頂格由蠟封提示） */
export function ordersReachable(b) {
  const visible = new Set();
  for (const c of b.cups) {
    const k = hiddenCount(c);
    c.seg.forEach((v, i) => { if (i >= k) visible.add(v); });
  }
  return b.orders.every(o => visible.has(o.color));
}

/** 檢查 7：磨砂瓶 / 布遮瓶唔可以有 3 格以上連續同色（否則隱藏冇意義） */
export function frostedMeaningful(b) {
  return b.cups.filter(c => hiddenCount(c) > 0).every(c => {
    let run = 1;
    for (let i = 1; i < c.seg.length; i++) {
      run = c.seg[i] === c.seg[i - 1] ? run + 1 : 1;
      if (run >= 3) return false;
    }
    return true;
  });
}

/** 隱藏格數：磨砂瓶 / 布遮瓶頂格以外全部 */
export function countHidden(b) {
  return b.cups.reduce((a, c) => a + hiddenCount(c), 0);
}

/** 三星門檻：無隱藏關卡 = 最優 + 3；有隱藏 = 最優 + 3 + (磨砂瓶數 × 2) */
export function starThresholds(optimal, board) {
  const q = board.cups.filter(c => c.kind === 'frosted').length;
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
    if (opts.deadline && Date.now() > opts.deadline) { rejects.aborted++; return null; }   // 牆鐘預算（練習關即時生成用）
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
