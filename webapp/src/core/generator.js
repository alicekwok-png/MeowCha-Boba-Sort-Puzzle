// core/generator.js — 隨機生成 + 驗證。段數係難度主旋鈕，所以唔用逆向生成。

import { makeCup, makeUnit, countSegments, hiddenCount, CAP_NORMAL } from './board.js';
import { isComplete, isSolved, applyMove } from './rules.js';
import { simulateRandom, twoStarBudget } from './analysis.js';
import { solveEx, countOptimalPaths, safeOpening } from './solver.js';
import { mulberry32, shuffle, randInt } from './prng.js';
import { PALETTE, colorsCompatible, unitsCompatible, MAX_COLORS_BY_HUE } from './palette.js';

/**
 * @typedef {{cups:number, colors:number, empties:number, segments:number,
 *            hidden:number, covered:number, ad:number, orders:number,
 *            optimalMin:number, optimalMax:number, palette?:number[], patterns?:number[], hiddenRatio?:number,
 *            randomTwoStarMax?:number|null}} LevelConfig
 *  randomTwoStarMax = 亂撳★2 率上限（隨機玩家喺最優 × 1.5 步內過關嘅比例，core/analysis.js）；超過就棄掉重抽（seed 篩選）。null = 唔篩
 *  colors = 元素數（色 × 圖案）；patterns = 每個元素嘅 patternId（預設全部 P0）
 */

/** v4：單一樽型（capacity 4）。cfg.hidden = `?` 隱藏層樽最少數量（hiddenRatio 會補足）；cfg.ad = 廣告樽數（額外、鎖死、空）；cfg.covered = 布遮樽 */
export function validateConfig(cfg) {
  const filled = cfg.cups - cfg.empties;
  const capacity = filled * CAP_NORMAL;
  const units = cfg.colors * CAP_NORMAL;
  if ((cfg.takeaway || 0) > 0 || (cfg.cracked || 0) > 0) throw new Error('v4：曲頸瓶 / 裂瓶已移除，全遊戲單一樽型');
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
  const covered = cfg.covered || 0, hidden = cfg.hidden || 0, ad = cfg.ad || 0;
  if (hidden + covered > filled) throw new Error('special cups exceed filled cups');
  if (cfg.orders < 1) throw new Error('Spec v3：每關最少 1 個免費訂單槽（過關 = 交晒全部顏色）');
  if (cfg.orders > cfg.colors) throw new Error('orders > colors');
  if (cfg.segments < cfg.colors || cfg.segments > units) throw new Error('segments out of range');
  if (cfg.cups + ad > 16) throw new Error('max 16 cups incl. ad bottles (4-bit move encoding)');
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

  // 樽分配（v4 單一樽型）：布遮樽 / `?` 隱藏層樽（關卡表指定最少數量）；隱藏層樽數量之後按隱藏密度補足
  const kinds = [];
  for (let i = 0; i < (cfg.covered || 0); i++) kinds.push('covered');
  for (let i = 0; i < (cfg.hidden || 0); i++) kinds.push('hidden');
  while (kinds.length < filled) kinds.push('normal');
  shuffle(kinds, rng);

  // 每杯目標格數：由滿開始隨機扣減，扣到總量 = 4 × 色數
  const caps = kinds.map(() => CAP_NORMAL);
  const sizes = caps.slice();
  const minSize = kinds.map(k => (k === 'hidden' ? 2 : 1));
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
    const fixedCells = kinds.reduce((a, k, i) => a + ((k === 'covered' || k === 'hidden') ? Math.max(0, sizes[i] - 1) : 0), 0);
    const target = Math.max(0, Math.round(cfg.hiddenRatio * units) - fixedCells);
    const cand = shuffle(kinds.map((k, i) => (k === 'normal' && sizes[i] >= 2 ? i : -1)).filter(i => i >= 0), rng);
    let hidden = 0;
    for (const i of cand) {
      const add = sizes[i] - 1;
      if (hidden >= target) break;
      if (hidden + add - target > target - hidden) break;   // 加咗會離目標更遠就停
      kinds[i] = 'hidden'; hidden += add;
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
  // 廣告樽（v4 §4）：一開波就喺盤面，空 + 鎖死；solver 當佢唔存在 → 唔解鎖都可解
  for (let i = 0; i < (cfg.ad || 0); i++) cups.splice(randInt(rng, 0, cups.length), 0, makeCup('ad', []));

  // Spec v3：訂單隊列 = 關內全部顏色（隨機次序，必須涵蓋全部——否則某色永遠交唔到，必然無解）；
  // 免費槽先攞隊列頭 cfg.orders 單；廣告槽解鎖時再由隊列攞（openSlot）
  const queue = shuffle(colors.slice(), rng);
  const orderColors = queue.splice(0, cfg.orders);

  return {
    cups,
    colors: cfg.colors,
    orders: orderColors.map(c => ({ color: c, filled: false })),
    queue,
    delivered: 0,
    moveCount: 0,
  };
}

/** 隊列 + 槽係咪涵蓋關內全部顏色（Spec v3 §6 必驗：肉眼睇唔出嘅 bug） */
export function queueCoversAllColors(b) {
  const present = new Set(b.cups.flatMap(c => c.seg));
  const listed = new Set([...b.orders.map(o => o.color), ...(b.queue || [])]);
  for (const c of present) if (!listed.has(c)) return false;
  return true;
}

/** 重放走步，記錄每步嘅完成 / 交貨事件（教學排序用） */
export function replayEvents(b0, moves) {
  let b = b0;
  const out = [];
  for (let i = 0; i < moves.length; i++) {
    const before = b.cups.map(c => isComplete(c));
    const events = [];
    b = applyMove(b, moves[i], events);
    const delivered = new Set(events.filter(e => e.type === 'deliver').map(e => e.cup));
    b.cups.forEach((c, ci) => {
      if (delivered.has(ci)) out.push({ move: i, type: 'deliver', cup: ci, color: events.find(e => e.type === 'deliver' && e.cup === ci).color });
      else if (isComplete(c) && !before[ci]) out.push({ move: i, type: 'seal', cup: ci, color: c.seg[0] });
    });
    for (const e of events) if (e.type === 'deliver' && !delivered.has(e.cup)) out.push({ move: i, type: 'deliver', cup: e.cup, color: e.color });
  }
  return out;
}

/**
 * Spec v3 §7 教學：
 *  'firstDelivered' — L1：訂單槽係盤面最先完成到嘅色（保證即刻成功）
 *  'sealThenCatchUp' — L2：最先完成嘅樽冇訂單（封存變暗），之後訂單追上、自動飛走
 */
export function tutorialQueueOk(kind, board, solution) {
  const ev = replayEvents(board, solution);
  const first = ev[0];
  if (!first) return false;
  if (kind === 'firstDelivered') return first.type === 'deliver';
  if (kind === 'sealThenCatchUp') return first.type === 'seal' && ev.some(e => e.type === 'deliver' && e.color === first.color && e.move > first.move);
  return true;
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

/** 檢查 7：隱藏層樽 / 布遮樽唔可以有 3 格以上連續同色（否則隱藏冇意義） */
export function hiddenMeaningful(b) {
  return b.cups.filter(c => hiddenCount(c) > 0).every(c => {
    let run = 1;
    for (let i = 1; i < c.seg.length; i++) {
      run = c.seg[i] === c.seg[i - 1] ? run + 1 : 1;
      if (run >= 3) return false;
    }
    return true;
  });
}

/** 隱藏格數：hidden / 布遮樽頂格以外全部 */
export function countHidden(b) {
  return b.cups.reduce((a, c) => a + hiddenCount(c), 0);
}

/** 三星門檻：無隱藏關卡 = 最優 + 3；有隱藏 = 最優 + 3 + (`?` 樽數 × 2) */
export function starThresholds(optimal, board) {
  const q = board.cups.filter(c => c.kind === 'hidden').length;
  const three = optimal + 3 + q * 2;
  return { three, two: three + 5 };
}

/**
 * 生成關卡。回傳 { board, optimal, thresholds, attempts, rejects } 或 null。
 * opts.maxAttempts 預設 400；opts.onReject 可用作統計。
 */
const RANDOM_TRIALS = 1000;    // 亂撳篩選局數（1000 局 SD ≈ 0.95% @ 10%）
// 邊際 2.5%，唔係 1.5%：篩選係「揀最好嗰次估計」，會偏向低估（winner's curse）。實際案例（2026-09-05）：L11 用 400 局估 8.4%
// 通過咗 1.5% 邊際，5000 局真值係 10.0%，重掃即刻超標。2.5% ≈ 2.6 SD，先擋得住估計誤差 + 揀最好嗰次嘅偏差。唔好改細。
const RANDOM_MARGIN = 0.025;

export function generateLevelEx(cfg, seed, opts = {}) {
  validateConfig(cfg);
  const rng = mulberry32(seed);
  const maxAttempts = opts.maxAttempts ?? 400;
  const rejects = { shape: 0, segments: 0, unsolvable: 0, length: 0, unique: 0, opening: 0, color: 0, orders: 0, hidden: 0, random: 0, aborted: 0 };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.deadline && Date.now() > opts.deadline) { rejects.aborted++; return null; }   // 牆鐘預算（練習關即時生成用）
    const b = randomFill(cfg, rng);
    if (!b) { rejects.shape++; continue; }
    if (b.cups.some(isComplete) || isSolved(b)) { rejects.shape++; continue; }

    // 檢查 1：段數命中
    if (Math.abs(countSegments(b) - cfg.segments) > 1) { rejects.segments++; continue; }
    // 平嘢先：色盲 / 訂單 / 磨砂
    if (!colorSafe(b)) { rejects.color++; continue; }
    if (!queueCoversAllColors(b)) { rejects.orders++; continue; }
    if (!ordersReachable(b)) { rejects.orders++; continue; }
    if (!hiddenMeaningful(b)) { rejects.hidden++; continue; }

    // 檢查 2：可解，且步數落喺目標區間
    const r = solveEx(b, cfg.optimalMax + 2, opts.maxNodes ?? 150_000);
    if (r.aborted) { rejects.aborted++; continue; }
    if (!r.moves) { rejects.unsolvable++; continue; }
    const sol = r.moves;
    if (sol.length < cfg.optimalMin || sol.length > cfg.optimalMax) { rejects.length++; continue; }

    // 檢查 2b：教學排序（Spec v3 §7）——唔啱就轉隊列次序再試（最多 colors 次）
    if (cfg.tutorialQueue) {
      let ok = tutorialQueueOk(cfg.tutorialQueue, b, sol), tries = 0, sol2 = sol;
      while (!ok && tries++ < cfg.colors * 2) {
        const all = [...b.orders.map(o => o.color), ...b.queue];
        all.push(all.shift());                                   // 輪轉
        b.orders = all.slice(0, b.orders.length).map(c => ({ color: c, filled: false }));
        b.queue = all.slice(b.orders.length);
        const r2 = solveEx(b, cfg.optimalMax + 2, opts.maxNodes ?? 150_000);
        if (!r2.moves) continue;
        sol2 = r2.moves;
        ok = tutorialQueueOk(cfg.tutorialQueue, b, sol2);
      }
      if (!ok) { rejects.orders++; continue; }
      if (sol2.length < cfg.optimalMin || sol2.length > cfg.optimalMax) { rejects.length++; continue; }
      sol.length = 0; sol.push(...sol2);
    }
    // 檢查 3：最優解不唯一
    if (countOptimalPaths(b, sol.length, 2) < 2) { rejects.unique++; continue; }

    // 檢查 3b：亂撳★2 率（用戶 2026-09-05：L4 起 < 10%）— 隨機玩家太易撞到過關就棄掉重抽
    if (cfg.randomTwoStarMax != null) {
      const r = simulateRandom(b, { trials: RANDOM_TRIALS, seed: attempt + 1, budget: twoStarBudget(sol.length) });
      if (r.rate + RANDOM_MARGIN >= cfg.randomTwoStarMax) { rejects.random++; continue; }
    }
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
