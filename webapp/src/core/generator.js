// core/generator.js — 隨機生成 + 驗證。段數係難度主旋鈕，所以唔用逆向生成。

import { makeCup, makeUnit, countSegments, hiddenCount, CAP_NORMAL } from './board.js';
import { isComplete, isSolved, applyMove } from './rules.js';
import { simulateRandom, twoStarBudget, fatalMistakeRate } from './analysis.js';
import { solveEx, countOptimalPaths, safeOpening } from './solver.js';
import { mulberry32, shuffle, randInt } from './prng.js';
import { PALETTE, colorsCompatible, unitsCompatible, MAX_COLORS_BY_HUE } from './palette.js';

/**
 * @typedef {{cups:number, colors:number, empties:number, segments:number,
 *            hidden:number, covered:number, ad:number, orders:number, bottlesPerColor?:number,
 *            optimalMin:number, optimalMax:number, palette?:number[], patterns?:number[], hiddenRatio?:number,
 *            randomTwoStarMax?:number|null, minFatalRate?:number|null}} LevelConfig
 *  randomTwoStarMax = 亂撳★2 率上限；null = 唔篩（緊湊盤面同呢個指標本質衝突，2026-09-06 起唔再用）
 *  minFatalRate = 致命錯步率下限：貪心玩家行 8 步之後盤面無解嘅比例。低過呢個數 = 呢一關輸唔到 → 棄掉重抽
 *  colors = 元素數（色 × 圖案）；patterns = 每個元素嘅 patternId（預設全部 P0）
 */

/** v4：單一樽型（capacity 4）。cfg.hidden = `?` 隱藏層樽最少數量（hiddenRatio 會補足）；cfg.ad = 廣告樽數（額外、鎖死、空）；cfg.covered = 布遮樽 */
export function validateConfig(cfg) {
  const bpc = cfg.bottlesPerColor || 1;   // 每隻色佔幾多樽（用戶 2026-09-06：後期關一色兩樽）
  const filled = cfg.cups - cfg.empties;
  const capacity = filled * CAP_NORMAL;
  const units = cfg.colors * CAP_NORMAL * bpc;
  if ((cfg.takeaway || 0) > 0 || (cfg.cracked || 0) > 0) throw new Error('v4：曲頸瓶 / 裂瓶已移除，全遊戲單一樽型');
  const patterns = cfg.patterns || new Array(cfg.colors).fill(0);
  if (patterns.length !== cfg.colors) throw new Error('patterns length != colors');
  const distinctColors = cfg.palette ? new Set(cfg.palette).size : cfg.colors;
  if (!cfg.palette && cfg.colors > MAX_COLORS_BY_HUE && patterns.every(p => p === 0)) throw new Error(`colors > ${MAX_COLORS_BY_HUE}: 純靠顏色最多 ${MAX_COLORS_BY_HUE} 色同關（再多要靠圖案做第二維度）`);
  if (cfg.palette && cfg.palette.length !== cfg.colors) throw new Error('palette length != colors');
  if (cfg.palette && !unitsCompatible(cfg.palette.map((c, i) => makeUnit(c, patterns[i])))) throw new Error('palette 指定色組唔符合互斥 / 圖案規則');
  if (distinctColors > MAX_COLORS_BY_HUE) throw new Error(`distinct colors > ${MAX_COLORS_BY_HUE}`);
  if (cfg.empties < 1) throw new Error('need at least 1 empty cup');
  if (filled < cfg.colors * bpc) throw new Error('filled cups < colors × bottlesPerColor');
  if (capacity < units) throw new Error(`capacity ${capacity} < units ${units}`);
  if (capacity - units > filled * 2) throw new Error('too much slack: cups would be nearly empty');
  const covered = cfg.covered || 0, hidden = cfg.hidden || 0, ad = cfg.ad || 0;
  if (hidden + covered > filled) throw new Error('special cups exceed filled cups');
  if (cfg.orders < 1) throw new Error('Spec v3：每關最少 1 個免費訂單槽（過關 = 交晒全部顏色）');
  if (cfg.orders > cfg.colors) throw new Error('orders > colors');
  if (cfg.segments < cfg.colors || cfg.segments > units) throw new Error('segments out of range');
  if (cfg.cups + ad > 255) throw new Error('max 255 cups incl. ad bottles (move encoding)');
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
  const bpc = cfg.bottlesPerColor || 1;
  const units = cfg.colors * CAP_NORMAL * bpc;
  let slack = sizes.reduce((a, b) => a + b, 0) - units;
  let guard = 0;
  while (slack > 0 && guard++ < 1000) {
    const i = randInt(rng, 0, sizes.length - 1);
    if (sizes[i] > minSize[i]) { sizes[i]--; slack--; }
  }
  if (slack > 0) return null;

  // 段數控制：先決定每色分成幾多段（總數 = 目標段數），再隨機組合
  const perColorCells = CAP_NORMAL * bpc;                    // 一色 4 格（一樽）或 8 格（兩樽）
  const runsPerColor = new Array(cfg.colors).fill(1);
  let extra = cfg.segments - cfg.colors;
  guard = 0;
  while (extra > 0 && guard++ < 2000) {
    const i = randInt(rng, 0, cfg.colors - 1);
    if (runsPerColor[i] < perColorCells) { runsPerColor[i]++; extra--; }
  }
  const cutPool = Array.from({ length: perColorCells - 1 }, (_, i) => i + 1);
  const runs = [];
  for (let ci = 0; ci < cfg.colors; ci++) {
    // 將 perColorCells 格拆成 k 段（每段 ≥ 1）
    const k = runsPerColor[ci];
    const cuts = shuffle(cutPool.slice(), rng).slice(0, k - 1).sort((a, b) => a - b);
    let prev = 0;
    for (const c of [...cuts, perColorCells]) {
      // 一段長過一樽容量就切開：段本身唔可以跨樽做成「一格都倒唔郁」
      let left = c - prev;
      while (left > 0) { const n = Math.min(CAP_NORMAL, left); runs.push({ color: colors[ci], n }); left -= n; }
      prev = c;
    }
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

  for (let i = 0; i < cfg.empties; i++) { segs.push([]); kinds.push('normal'); }
  return assemble(cfg, rng, segs, kinds, colors);
}

/**
 * 倒推生成（用戶 2026-09-06「行錯一步就玩唔到」）：由「已完成」狀態開始行 N 步反向倒液。
 * 點解要有呢個：空樽減到 1 隻（自由 4 格）之後，隨機填充嘅盤面 99.6% 係無解 —— 段數高就無解、
 * 段數低就一開波已經有樽完成，中間冇窗口（實測 L20/L26 兩萬次全滅）。倒推法嘅可解性係構造出嚟：
 * 每一步反向倒液都留低一步合法嘅正向倒液可以倒返轉頭，所以盤面必然喺 N 步內解得到。
 *
 * 反向一步 = 由 A 嘅頂段攞 j 格倒去 B，條件係 B 空或者 B 頂色 ≠ 該色 —— 咁正向 B→A 就啱啱好
 * 倒返嗰 j 格（唔會多倒），逆轉性先嚴格成立。
 */
export function reverseFill(cfg, rng) {
  const patterns = cfg.patterns || new Array(cfg.colors).fill(0);
  const picked = cfg.palette ? cfg.palette.slice() : pickColors(cfg.colors, rng);
  if (!picked) return null;
  const colors = shuffle(picked.map((c, i) => makeUnit(c, patterns[i])), rng);
  const bpc = cfg.bottlesPerColor || 1;
  const filled = cfg.cups - cfg.empties;
  if (filled !== cfg.colors * bpc) return null;   // 倒推法要求「一色 = 整數隻樽」

  // 已完成狀態：每隻色佔 bpc 隻滿樽，再加空樽
  const segs = [];
  for (const c of colors) for (let k = 0; k < bpc; k++) segs.push(new Array(CAP_NORMAL).fill(c));
  for (let i = 0; i < cfg.empties; i++) segs.push([]);

  const target = cfg.segments;
  const maxSteps = cfg.reverseSteps || filled * 40;
  // 第二階段：段數夠咗之後淨係行「整段搬走」嘅反向步（段數不變，但盤面打亂得更深）。
  // 冇呢一段嘅話，最優步數 ≈ 段數 − 樽數，解法太短 —— 盤面緊但一眼睇得穿。
  const extra = cfg.reverseExtra ?? filled * 5;
  let count = filled;            // 已完成狀態嘅段數 = 滿樽數
  let last = null;
  let done = 0;
  for (let step = 0; step < maxSteps + extra; step++) {
    if (count >= target && ++done > extra) break;
    const froms = [];
    for (let i = 0; i < segs.length; i++) if (segs[i].length) froms.push(i);
    const a = froms[randInt(rng, 0, froms.length - 1)];
    const A = segs[a];
    const color = A[A.length - 1];
    let run = 1;
    while (run < A.length && A[A.length - 1 - run] === color) run++;
    const tos = [];
    for (let i = 0; i < segs.length; i++) {
      if (i === a || segs[i].length >= CAP_NORMAL) continue;
      if (segs[i].length && segs[i][segs[i].length - 1] === color) continue;   // 頂色相同 → 正向會多倒，破壞逆轉性
      if (last && last.from === i && last.to === a) continue;                  // 唔即刻倒返轉頭
      tos.push(i);
    }
    if (!tos.length) { last = null; continue; }
    const b = tos[randInt(rng, 0, tos.length - 1)];
    const room = CAP_NORMAL - segs[b].length;
    if (count >= target && run > room) { last = null; continue; }   // 第二階段只准整段搬（段數不變）
    const j = count >= target ? run : randInt(rng, 1, Math.min(run, room));
    A.splice(-j, j);
    for (let i = 0; i < j; i++) segs[b].push(color);
    count += 1 - (j === run ? 1 : 0);   // B 多咗一段；A 段數只有喺整段搬走嗰陣先減
    last = { from: a, to: b };
  }
  if (count !== target) return null;

  // 樽種喺倒推之後先派（倒推嘅結果每隻樽格數唔同，要見到實際格數先派得準）
  const kinds = segs.map(() => 'normal');
  const nonEmpty = shuffle(segs.map((sg, i) => i).filter(i => segs[i].length > 0), rng);
  let ki = 0;
  for (let i = 0; i < (cfg.covered || 0) && ki < nonEmpty.length; i++, ki++) kinds[nonEmpty[ki]] = 'covered';
  for (let i = 0; i < (cfg.hidden || 0); i++) {
    while (ki < nonEmpty.length && segs[nonEmpty[ki]].length < 2) ki++;
    if (ki >= nonEmpty.length) break;
    kinds[nonEmpty[ki++]] = 'hidden';
  }
  return assemble(cfg, rng, segs, kinds, colors);
}

/** 砌返一個 Board：樽種 → 隱藏格 → 空樽 / 廣告樽 → 訂單隊列（randomFill 同 reverseFill 共用） */
function assemble(cfg, rng, segs, kinds, colors) {
  const bpc = cfg.bottlesPerColor || 1;
  const units = cfg.colors * CAP_NORMAL * bpc;
  const cups = kinds.map((k, i) => makeCup(k, segs[i], k === 'covered'));
  // 隱藏格（用戶 2026-09-06）：逐格隨機揀，唔再係「一整隻樽頂格以外全部 ?」——
  // 咁 pattern 先會似參考遊戲（色 / ? / 色 / ?）而唔係每隻樽一個樣。頂格永遠可見（唔准盲倒）。
  if (cfg.hiddenRatio !== undefined && cfg.hiddenRatio > 0) {
    const fixed = cups.reduce((a, c) => a + (c.kind === 'covered' ? Math.max(0, c.seg.length - 1) : 0), 0);
    const target = Math.max(0, Math.round(cfg.hiddenRatio * units) - fixed);
    // 輪流分配（每隻樽先攞一格，再第二格…）：同一個密度之下，? 會散開喺唔同樽嘅唔同位置，
    // 而唔係一隻樽由底填到頂 —— 咁先會出到「色 / ? / 色」呢類 pattern。
    // 關卡表 cfg.hidden 會預先標某幾隻做 `?` 樽；佢哋一齊入候選，最後冇攞到格就降返做 normal
    const perCup = cups.map((c) => ((c.kind === 'normal' || c.kind === 'hidden') && c.seg.length >= 2)
      ? shuffle(Array.from({ length: c.seg.length - 1 }, (_, i) => i), rng) : []);
    const order = shuffle(cups.map((_, ci) => ci), rng);
    let placed = 0;
    for (let round = 0; round < CAP_NORMAL && placed < target; round++) {
      for (const ci of order) {
        if (placed >= target) break;
        const list = perCup[ci];
        if (round >= list.length) continue;
        cups[ci].kind = 'hidden';
        cups[ci].hid |= (1 << list[round]);
        placed++;
      }
    }
    for (const c of cups) if (c.kind === 'hidden' && !c.hid) c.kind = 'normal';   // 冇攞到隱藏格就唔算 ? 樽
  }
  shuffle(cups, rng);

  // Spec v3：訂單隊列 = 關內全部顏色（隨機次序，必須涵蓋全部——否則某色永遠交唔到，必然無解）；
  // 免費槽先攞隊列頭 cfg.orders 單；廣告槽解鎖時再由隊列攞（openSlot）
  const order = shuffle(colors.slice(), rng);

  // 布遮樽鑰匙色（用戶 2026-09-07：「要完成指定顏色嘅訂單先揭開」）。
  // 兩條硬規則，否則會出死局：
  //  ① 鑰匙色喺全部布遮樽以外要仲有齊一樽嘅份量（CAP_NORMAL 格）—— 唔使開任何布都湊得齊，先交得出。
  //  ② 每隻布遮樽用唔同鑰匙色 —— 唔係咁就會出現「交一單開曬幾隻」，即係用戶報嗰個情況。
  // 揀色按訂單隊列次序，等布遮樽隨住進度一隻一隻開，而唔係全部塞喺最尾。
  const coveredIdx = cups.map((c, i) => i).filter(i => cups[i].kind === 'covered');
  if (coveredIdx.length) {
    const outside = new Map();
    for (const c of cups) { if (c.kind === 'covered') continue; for (const v of c.seg) outside.set(v, (outside.get(v) || 0) + 1); }
    const pool = order.filter(u => (outside.get(u) || 0) >= CAP_NORMAL);
    for (const i of coveredIdx) {
      const inside = new Set(cups[i].seg);
      let pick = pool.findIndex(u => !inside.has(u));
      if (pick < 0) pick = pool.length ? 0 : -1;
      if (pick < 0) { cups[i].kind = 'normal'; cups[i].locked = false; cups[i].unlockColor = null; continue; }
      cups[i].unlockColor = pool.splice(pick, 1)[0];
    }
  }

  // 廣告樽（v4 §4）：一開波就喺盤面，空 + 鎖死；solver 當佢唔存在 → 唔解鎖都可解
  for (let i = 0; i < (cfg.ad || 0); i++) cups.splice(randInt(rng, 0, cups.length), 0, makeCup('ad', []));

  const queue = order.slice();
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

/** 用戶 2026-09-06：有隱藏嘅關，至少一隻樽要有 ≥ minDepth 個隱藏格（一隻樽 2–3 個 ?），唔可以全部得一格 */
export function hiddenDepthOk(b, minDepth) {
  return b.cups.some(c => c.kind === 'hidden' && hiddenCount(c) >= minDepth);
}

/** 隱藏格數：hidden / 布遮樽頂格以外全部 */
export function countHidden(b) {
  return b.cups.reduce((a, c) => a + hiddenCount(c), 0);
}

/** 三星門檻：無隱藏關卡 = 最優 + 3；有隱藏 = 最優 + 3 + (`?` 樽數 × 2，封頂 +12) */
export function starThresholds(optimal, board) {
  const q = board.cups.filter(c => c.kind === 'hidden').length;
  const three = optimal + 3 + Math.min(12, q * 2);
  return { three, two: three + 5 };
}

/**
 * 生成關卡。回傳 { board, optimal, thresholds, attempts, rejects } 或 null。
 * opts.maxAttempts 預設 400；opts.onReject 可用作統計。
 */
const RANDOM_TRIALS = 1000;    // 亂撳篩選局數（1000 局 SD ≈ 0.95% @ 10%）
const FATAL_TRIALS = 80;       // 致命錯步粗篩局數（每局要跑一次 solver，貴啲）
const FATAL_CONFIRM = 250;     // 過咗粗篩先跑嘅確認局數
// 邊際 2.5%，唔係 1.5%：篩選係「揀最好嗰次估計」，會偏向低估（winner's curse）。實際案例（2026-09-05）：L11 用 400 局估 8.4%
// 通過咗 1.5% 邊際，5000 局真值係 10.0%，重掃即刻超標。2.5% ≈ 2.6 SD，先擋得住估計誤差 + 揀最好嗰次嘅偏差。唔好改細。
const RANDOM_MARGIN = 0.025;

export function generateLevelEx(cfg, seed, opts = {}) {
  validateConfig(cfg);
  const rng = mulberry32(seed);
  const maxAttempts = opts.maxAttempts ?? 2000;   // 2026-09-06 加咗致命錯步篩選之後，400 次唔夠
  const rejects = { shape: 0, segments: 0, unsolvable: 0, length: 0, unique: 0, opening: 0, color: 0, orders: 0, hidden: 0, random: 0, fatal: 0, aborted: 0 };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.deadline && Date.now() > opts.deadline) { rejects.aborted++; return null; }   // 牆鐘預算（練習關即時生成用）
    const b = cfg.reverse ? reverseFill(cfg, rng) : randomFill(cfg, rng);
    if (!b) { rejects.shape++; continue; }
    if (b.cups.some(isComplete) || isSolved(b)) { rejects.shape++; continue; }

    // 檢查 1：段數命中
    if (Math.abs(countSegments(b) - cfg.segments) > 1) { rejects.segments++; continue; }
    // 平嘢先：色盲 / 訂單 / 磨砂
    if (!colorSafe(b)) { rejects.color++; continue; }
    if (!queueCoversAllColors(b)) { rejects.orders++; continue; }
    if (!ordersReachable(b)) { rejects.orders++; continue; }
    if (!hiddenMeaningful(b)) { rejects.hidden++; continue; }
    if (cfg.hiddenRatio > 0 && !hiddenDepthOk(b, cfg.minHiddenDepth ?? 2)) { rejects.hidden++; continue; }

    // 檢查 2：可解，且步數落喺目標區間
    const r = solveEx(b, cfg.optimalMax + 2, opts.maxNodes ?? 150_000, opts.deadline || 0);
    if (r.aborted) { rejects.aborted++; if (opts.deadline && Date.now() > opts.deadline) return null; continue; }
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
        const r2 = solveEx(b, cfg.optimalMax + 2, opts.maxNodes ?? 150_000, opts.deadline || 0);
        if (r2.aborted && opts.deadline && Date.now() > opts.deadline) { rejects.aborted++; return null; }
        if (!r2.moves) continue;
        sol2 = r2.moves;
        ok = tutorialQueueOk(cfg.tutorialQueue, b, sol2);
      }
      if (!ok) { rejects.orders++; continue; }
      if (sol2.length < cfg.optimalMin || sol2.length > cfg.optimalMax) { rejects.length++; continue; }
      sol.length = 0; sol.push(...sol2);
    }
    // 檢查 3：最優解不唯一
    if (countOptimalPaths(b, sol.length, 2, 2_000_000, opts.deadline || 0) < 2) { rejects.unique++; continue; }
    if (opts.deadline && Date.now() > opts.deadline) { rejects.aborted++; return null; }

    // 檢查 3b：亂撳★2 率（可選；緊湊盤面唔再用）
    if (cfg.randomTwoStarMax != null) {
      const r = simulateRandom(b, { trials: RANDOM_TRIALS, seed: attempt + 1, budget: twoStarBudget(sol.length) });
      if (r.rate + RANDOM_MARGIN >= cfg.randomTwoStarMax) { rejects.random++; continue; }
    }
    // 檢查 3c：一定要輸得到（用戶 2026-09-06「行錯一步就玩唔到」）——
    // 貪心玩家行 8 步之後盤面無解嘅比例要達標，否則呢一關點行都贏，唔使用腦
    if (cfg.minFatalRate != null || cfg.maxFatalRate != null) {
      // 兩段：先平嘅 80 局粗篩（要高過門檻 1.6 倍，抵銷「揀最好嗰次」嘅偏差），
      // 過到先跑 250 局確認。單靠 80 局會漏網（L11 / L12 曾經跌返落 1%）。
      // 局數跟盤面大細收縮：每一局要跑一次 solver，20 隻樽一次 solve ≈ 0.1s，
      // 用返細盤面嗰個局數會變成每個候選幾十秒。
      const big = cfg.cups > 12;
      const rough = fatalMistakeRate(b, { steps: 8, trials: big ? 30 : FATAL_TRIALS, seed: attempt + 11, maxNodes: big ? 80_000 : 200_000 });
      if (cfg.minFatalRate != null && rough.fatal < cfg.minFatalRate * 1.6) { rejects.fatal++; continue; }
      const confirm = fatalMistakeRate(b, { steps: 10, trials: big ? 90 : FATAL_CONFIRM, seed: attempt + 977, maxNodes: big ? 80_000 : 200_000 });
      if (cfg.minFatalRate != null && confirm.fatal < cfg.minFatalRate * 1.3) { rejects.fatal++; continue; }   // 留 margin：重掃（其他 seed）先唔會跌返落門檻下
      // 上限（用戶 2026-09-06 空樽減到 1 隻之後）：1 空樽嘅盤面天然去到 90%+ 致命錯步，
      // 嗰啲盤面唔係「要諗」係「隨便行都死」，唔好玩 → 篩返落區間入面。
      if (cfg.maxFatalRate != null && confirm.fatal > cfg.maxFatalRate) { rejects.fatal++; continue; }
    }
    // 檢查 4：起手安全區。深度成本係 (合法步數)^K × 一次 solve —— 20 隻樽有成百合法步，
    // K=2 就係幾千次 solve，生成會慢到停唔到。大盤面收到 K=1（第一步唔可以即死）。
    const K = cfg.cups <= 8 ? 3 : cfg.cups <= 12 ? 2 : 1;
    if (!safeOpening(b, K, sol.length + 4, 150_000, opts.deadline || 0)) { rejects.opening++; if (opts.deadline && Date.now() > opts.deadline) { rejects.aborted++; return null; } continue; }

    return { board: b, optimal: sol.length, solution: sol, thresholds: starThresholds(sol.length, b), attempts: attempt, rejects, hiddenCells: countHidden(b), units: cfg.colors * CAP_NORMAL * (cfg.bottlesPerColor || 1) };
  }
  opts.onReject?.(rejects);   // 失敗嗰陣先知道卡喺邊個檢查（緊 config 除錯用）
  return null;
}

export function generateLevel(cfg, seed, opts) {
  const r = generateLevelEx(cfg, seed, opts);
  return r ? r.board : null;
}
