// core/analysis.js — 難度分析：模擬「亂撳」玩家（Spec v3 之後、v4.1 第 12 步難度掃描用）。
// 純函數，用 seed 可重現；tools/difficulty-scan.js 同 generator 質檢共用。
//
// 亂撳★2 率 = 隨機玩家（每步喺合法走步入面均勻抽一步）能否喺 budget 步（預設 最優 × 1.5）內過關嘅比例。
// 目標（用戶 2026-09-05）：L4 之後全部 < 10%。

import { legalMoves, applyMove, isSolved, topColor } from './rules.js';
import { solveEx } from './solver.js';
import { cloneBoard } from './board.js';
import { mulberry32 } from './prng.js';

/**
 * 揀步策略：
 *  random — 合法走步均勻抽（「亂撳」基準）
 *  greedy — 優先揀「倒落同色頂」嘅走步（休閒玩家嘅本能），冇就先倒落空樽，都冇就隨機
 */
function pick(policy, b, moves, rng, prev) {
  if (policy === 'greedy') {
    // 唔即刻倒返轉頭（否則兩隻同色頂之間無限來回）
    const fwd = prev ? moves.filter(m => !(m.from === prev.to && m.to === prev.from)) : moves;
    const pool = fwd.length ? fwd : moves;
    const merge = pool.filter(m => b.cups[m.to].seg.length > 0 && topColor(b.cups[m.to]) === topColor(b.cups[m.from]));
    if (merge.length) return merge[Math.floor(rng() * merge.length)];
    return pool[Math.floor(rng() * pool.length)];
  }
  return moves[Math.floor(rng() * moves.length)];
}

/**
 * @param {import('./board.js').Board} board 真實盤面（隨機玩家唔用資訊，遮罩與否無分別）
 * @param {{trials?:number, seed?:number, budget:number, policy?:'random'|'greedy'}} opts
 * @returns {{trials:number, budget:number, solved:number, dead:number, rate:number, deadRate:number, meanSolvedMoves:number|null}}
 */
export function simulateRandom(board, opts) {
  const trials = opts.trials ?? 1000;
  const budget = opts.budget;
  const policy = opts.policy ?? 'random';
  const rng = mulberry32((opts.seed ?? 1) >>> 0);
  let solved = 0, dead = 0, movesSum = 0;
  for (let t = 0; t < trials; t++) {
    let b = cloneBoard(board), prev = null;
    for (let step = 0; step < budget; step++) {
      const moves = legalMoves(b);
      if (!moves.length) { dead++; break; }
      const m = pick(policy, b, moves, rng, prev);
      b = applyMove(b, m); prev = m;
      if (isSolved(b)) { solved++; movesSum += step + 1; break; }
    }
  }
  return { trials, budget, solved, dead, rate: solved / trials, deadRate: dead / trials, meanSolvedMoves: solved ? movesSum / solved : null };
}

/**
 * 致命錯步率（用戶 2026-09-06「行錯一步就玩唔到」）：用貪心策略行 steps 步之後，盤面仲解唔解到？
 * 呢個先係「要唔要用腦」嘅真指標 —— 空位多過 2 樽嘅盤面，呢個數字係 0%，即係字面意義上輸唔到。
 * 亂撳★2 率量嘅係「隨機撳會唔會撞中」，同呢個係兩回事。
 */
export function fatalMistakeRate(board, { steps = 10, trials = 150, seed = 7, maxNodes = 400_000 } = {}) {
  const rng = mulberry32(seed >>> 0);
  let fatal = 0, wonEarly = 0;
  for (let t = 0; t < trials; t++) {
    let b = cloneBoard(board), early = false;
    for (let s = 0; s < steps; s++) {
      const moves = legalMoves(b);
      if (!moves.length) break;
      const merge = moves.filter(m => b.cups[m.to].seg.length > 0 && topColor(b.cups[m.to]) === topColor(b.cups[m.from]));
      const pool = merge.length ? merge : moves;
      b = applyMove(b, pool[Math.floor(rng() * pool.length)]);
      if (isSolved(b)) { early = true; break; }
    }
    if (early) { wonEarly++; continue; }
    if (!solveEx(b, 60, maxNodes).moves) fatal++;
  }
  return { steps, trials, fatal: fatal / trials, wonEarly: wonEarly / trials };
}

/** 亂撳★2 率預設 budget：最優 × 1.5（向上取整） */
export function twoStarBudget(optimal) {
  return Math.ceil(optimal * 1.5);
}
