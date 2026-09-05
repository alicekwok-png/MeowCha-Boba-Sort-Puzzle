#!/usr/bin/env node
// tools/verify-levels.js — 用 solver 重新驗證 levels/campaign.json 全部關卡（可解、最優步數同記錄一致）+ levels/practice_pool.json 練習池
//   node tools/verify-levels.js
import { readFileSync } from 'node:fs';
import { decodeBoard } from '../src/core/board.js';
import { solveEx } from '../src/core/solver.js';
import { applyMove, isSolved } from '../src/core/rules.js';
import { queueCoversAllColors } from '../src/core/generator.js';
import { gatingViolations } from '../src/core/difficulty.js';
import { CAMPAIGN } from '../src/core/levels.js';
import { existsSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
let bad = 0;
const t0 = Date.now();
for (const l of data.levels) {
  const b = decodeBoard(l.board);
  // Spec v3 / v4 必驗：隊列 + 槽涵蓋全部顏色；只用免費槽（唔開廣告槽）、唔解鎖廣告樽（ad 樽 solver 當唔存在）都可解；機制登場合規
  const cover = queueCoversAllColors(b);
  const adCups = b.cups.filter(c => c.kind === 'ad').length;
  const gating = gatingViolations(l.id, CAMPAIGN[l.id - 1] || {});
  const r = solveEx(b, l.optimal + 2, 2_000_000);
  let ok = !!r.moves;
  let replay = false;
  if (ok) { let s = b; for (const m of r.moves) s = applyMove(s, m); replay = isSolved(s); }
  const status = !cover ? 'QUEUE MISSING COLOUR' : gating.length ? `GATING ${gating.join(',')}` : !ok ? 'UNSOLVABLE (free slots only, no ad bottles)' : r.moves.length !== l.optimal ? `OPTIMAL ${r.moves.length} != ${l.optimal}` : !replay ? 'REPLAY FAIL' : 'ok';
  if (status !== 'ok') bad++;
  console.log(`L${String(l.id).padStart(2)} ${status}${r.aborted ? ' (aborted)' : ''}  slots=${b.orders.length} queue=${(b.queue || []).length} ad=${adCups}`);
}
console.log(`${data.levels.length} levels, ${bad} problems, ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// 練習池：每個盤都要可解（只用免費槽）、最優同記錄一致、隊列涵蓋全部顏色
const poolUrl = new URL('../levels/practice_pool.json', import.meta.url);
if (existsSync(poolUrl)) {
  const pool = JSON.parse(readFileSync(poolUrl, 'utf8'));
  let pbad = 0, n = 0;
  for (const [bucket, bk] of Object.entries(pool.buckets)) {
    for (const l of bk.levels) {
      n++;
      const b = decodeBoard(l.board);
      const r = solveEx(b, l.optimal + 2, 2_000_000);
      const status = !queueCoversAllColors(b) ? 'QUEUE MISSING COLOUR' : !r.moves ? 'UNSOLVABLE' : r.moves.length !== l.optimal ? `OPTIMAL ${r.moves.length} != ${l.optimal}` : b.cups.length !== bk.config.cups ? `CUPS ${b.cups.length} != ${bk.config.cups}` : 'ok';
      if (status !== 'ok') { pbad++; console.log(`practice ${bucket} ${l.seed}: ${status}`); }
    }
  }
  console.log(`practice pool: ${n} boards, ${pbad} problems`);
  bad += pbad;
}
process.exit(bad ? 1 : 0);
