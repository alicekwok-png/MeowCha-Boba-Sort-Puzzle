#!/usr/bin/env node
// tools/verify-levels.js — 用 solver 重新驗證 levels/campaign.json 全部關卡（可解、最優步數同記錄一致）
//   node tools/verify-levels.js
import { readFileSync } from 'node:fs';
import { decodeBoard } from '../src/core/board.js';
import { solveEx } from '../src/core/solver.js';
import { applyMove, isSolved } from '../src/core/rules.js';

const data = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
let bad = 0;
const t0 = Date.now();
for (const l of data.levels) {
  const b = decodeBoard(l.board);
  const r = solveEx(b, l.optimal + 2, 2_000_000);
  let ok = !!r.moves;
  let replay = false;
  if (ok) { let s = b; for (const m of r.moves) s = applyMove(s, m); replay = isSolved(s); }
  const status = !ok ? 'UNSOLVABLE' : r.moves.length !== l.optimal ? `OPTIMAL ${r.moves.length} != ${l.optimal}` : !replay ? 'REPLAY FAIL' : 'ok';
  if (status !== 'ok') bad++;
  console.log(`L${String(l.id).padStart(2)} ${status}${r.aborted ? ' (aborted)' : ''}`);
}
console.log(`${data.levels.length} levels, ${bad} problems, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(bad ? 1 : 0);
