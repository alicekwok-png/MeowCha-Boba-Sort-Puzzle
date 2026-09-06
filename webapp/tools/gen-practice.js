#!/usr/bin/env node
// tools/gen-practice.js — 練習池預生成（用戶 2026-09-05）：每個桶 30 個合格盤面存入 levels/practice_pool.json，runtime 隨機抽一個（0 ms）。
//   node tools/gen-practice.js                       三桶各 30
//   node tools/gen-practice.js --per 30 --salt xxx   每桶數量 / 換一批
// 每個盤面都經 generateLevelEx 全套檢查（可解、最優區間、不唯一、起手安全、亂撳★2 < 10% 篩選），
// 之後再用 2000 局重掃確認亂撳率，超標嘅唔入池（雙重保險）。

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { PRACTICE } from '../src/core/levels.js';
import { generateLevelEx } from '../src/core/generator.js';
import { encodeBoard } from '../src/core/board.js';
import { hash32 } from '../src/core/prng.js';
import { hiddenRatio } from '../src/core/difficulty.js';
import { simulateRandom, twoStarBudget } from '../src/core/analysis.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('--out', 'levels/practice_pool.json');
const PER = Number(opt('--per', 30));
const SALT = opt('--salt', 'meowcha-practice-1');   // 換一批就改 salt（例如每次 app 更新）
const PSEUDO = { easy: 8, medium: 15, hard: 25 };    // 隱藏密度照正關公式（同 main.js 一致）

const pool = { version: 1, salt: SALT, buckets: {} };
const t0 = Date.now();
for (const [bucket, base] of Object.entries(PRACTICE)) {
  const cfg = { ...base, hiddenRatio: hiddenRatio(PSEUDO[bucket]) };
  const list = [];
  let n = 0, rejectedByRescan = 0;
  while (list.length < PER && n < PER * 40) {   // 2026-09-06 加咗致命錯步篩選之後，×10 唔夠（輕鬆桶只收到 29 個）
    const seedStr = `v1:pp:${bucket}:${SALT}:${n++}`;
    const res = generateLevelEx(cfg, hash32(createHash('sha256').update(seedStr).digest('hex').slice(0, 8)), { maxAttempts: 2000 });
    if (!res) continue;
    const rate = simulateRandom(res.board, { trials: 2000, seed: n, budget: twoStarBudget(res.optimal) }).rate;
    if (cfg.randomTwoStarMax != null && rate >= cfg.randomTwoStarMax) { rejectedByRescan++; continue; }
    list.push({ seed: seedStr, board: encodeBoard(res.board), optimal: res.optimal, thresholds: res.thresholds, randomRate: +rate.toFixed(3) });
  }
  const rates = list.map(x => x.randomRate * 100);
  console.log(`${bucket.padEnd(6)} ${cfg.cups} 樽 ${cfg.colors} 色  ${list.length}/${PER}  亂撳★2 ${Math.min(...rates).toFixed(1)}–${Math.max(...rates).toFixed(1)}%  最優 ${Math.min(...list.map(x => x.optimal))}–${Math.max(...list.map(x => x.optimal))}  重掃棄 ${rejectedByRescan}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (list.length < PER) { console.error(`${bucket}: only ${list.length} boards`); process.exitCode = 1; }
  pool.buckets[bucket] = { config: cfg, levels: list };
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(pool));
console.log(`wrote ${OUT} (${(JSON.stringify(pool).length / 1024).toFixed(1)} KB)`);
