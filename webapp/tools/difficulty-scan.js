#!/usr/bin/env node
// tools/difficulty-scan.js — 40 關難度掃描（v4.1 第 12 步）。
//   node tools/difficulty-scan.js                 全部關卡，每關 2000 局
//   node tools/difficulty-scan.js --trials 500    局數
//   node tools/difficulty-scan.js --only 4,5,6    指定關卡
//   node tools/difficulty-scan.js --json          機器可讀輸出
//
// 主要指標：亂撳★2 率 = 隨機玩家（合法走步均勻抽）喺 最優 × 1.5 步內過關嘅比例；目標 L4 之後全部 < 10%。
// 另外報：隨機玩家喺實際 2★ 門檻（thresholds.two）內過關率、貪心玩家（優先倒同色）★2 率、走入死局率。
// 亂撳玩家唔解鎖廣告樽 / 廣告槽（同 verify-levels 一樣，只用免費槽）。

import { readFileSync } from 'node:fs';
import { decodeBoard } from '../src/core/board.js';
import { simulateRandom, twoStarBudget } from '../src/core/analysis.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const TRIALS = Number(opt('--trials', 2000));
const ONLY = opt('--only', null)?.split(',').map(Number);
const JSON_OUT = args.includes('--json');
const TARGET_FROM = 4, TARGET_RATE = 0.10;

const data = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
const t0 = Date.now();
const rows = [];
for (const l of data.levels) {
  if (ONLY && !ONLY.includes(l.id)) continue;
  const b = decodeBoard(l.board);
  const budget = twoStarBudget(l.optimal);
  const rnd = simulateRandom(b, { trials: TRIALS, seed: l.id, budget });
  const rnd2 = simulateRandom(b, { trials: TRIALS, seed: l.id + 1000, budget: l.thresholds.two });
  const grd = simulateRandom(b, { trials: TRIALS, seed: l.id + 2000, budget, policy: 'greedy' });
  const fail = l.id >= TARGET_FROM && rnd.rate >= TARGET_RATE;
  rows.push({
    id: l.id, cups: b.cups.length, colors: b.colors, optimal: l.optimal, budget, twoStar: l.thresholds.two,
    randomRate: rnd.rate, randomWithinTwoStar: rnd2.rate, greedyRate: grd.rate, deadRate: rnd.deadRate,
    meanSolvedMoves: rnd.meanSolvedMoves, fail,
  });
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);

if (JSON_OUT) {
  console.log(JSON.stringify({ trials: TRIALS, rows }, null, 1));
} else {
  const pct = x => (x * 100).toFixed(1).padStart(5) + '%';
  console.log(`關  樽 色 最優 預算(×1.5) 2★門檻 | 亂撳★2率 亂撳≤2★門檻 貪心★2率 死局率 | 平均過關步`);
  for (const r of rows) {
    console.log(
      `${String(r.id).padStart(2)}  ${String(r.cups).padStart(2)} ${r.colors}  ${String(r.optimal).padStart(3)}  ${String(r.budget).padStart(6)}     ${String(r.twoStar).padStart(4)}   | ` +
      `${pct(r.randomRate)}   ${pct(r.randomWithinTwoStar)}     ${pct(r.greedyRate)}  ${pct(r.deadRate)} | ${r.meanSolvedMoves ? r.meanSolvedMoves.toFixed(1) : '—'}` +
      (r.fail ? '   ⚠ ≥10%' : ''),
    );
  }
  const fails = rows.filter(r => r.fail);
  console.log(`\n${rows.length} levels × ${TRIALS} trials, ${secs} s. L${TARGET_FROM}+ 亂撳★2率 ≥ ${TARGET_RATE * 100}%：${fails.length ? fails.map(r => 'L' + r.id).join(', ') : '無'}`);
  process.exitCode = fails.length ? 1 : 0;
}
