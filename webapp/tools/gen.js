#!/usr/bin/env node
// tools/gen.js — 離線批次生成 campaign 關卡。
//   node tools/gen.js --out levels/campaign.json
//   node tools/gen.js --only 12          只生成第 12 關（除錯）
//   node tools/gen.js --salt mysalt      改 server salt（seed 會全變）
// 生成失敗嘅 config 會 log 出嚟，唔會靜靜跳過。

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { CAMPAIGN } from '../src/core/levels.js';
import { generateLevelEx } from '../src/core/generator.js';
import { encodeBoard } from '../src/core/board.js';
import { hash32 } from '../src/core/prng.js';
import { computeMoveLimit, hiddenRatio } from '../src/core/difficulty.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('--out', 'levels/campaign.json');
const ONLY = opt('--only', null);
const MERGE = args.includes('--merge');   // --only N --merge：只重生第 N 關並寫入現有檔案
const SALT = opt('--salt', 'meowcha-dev-salt');   // 正式環境用環境變數，永不下發 client
const MAX_ATTEMPTS = Number(opt('--attempts', 2000));   // 2026-09-06 隱藏密度加大之後，緊 config（L12）要千幾次先撞到

function configHash(cfg) {
  const { title, ...rest } = cfg;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 8);
}

function campaignSeed(levelId) {
  return createHash('sha256').update(SALT + 'c' + levelId).digest('hex').slice(0, 8);
}

const out = [];
const failed = [];
const t0 = Date.now();
for (let i = 0; i < CAMPAIGN.length; i++) {
  const id = i + 1;
  if (ONLY && Number(ONLY) !== id) continue;
  const cfg = CAMPAIGN[i];
  const seedHex = campaignSeed(id);
  const publicSeed = `v1:c:${id}:${configHash(cfg)}:${seedHex}`;
  const t1 = Date.now();
  let res = null;
  try {
    res = generateLevelEx({ ...cfg, hiddenRatio: hiddenRatio(id) }, hash32(publicSeed), { maxAttempts: MAX_ATTEMPTS });
  } catch (e) {
    console.error(`L${id} config error: ${e.message}`);
    failed.push(id);
    continue;
  }
  const ms = Date.now() - t1;
  if (!res) {
    console.error(`L${id} FAILED after ${MAX_ATTEMPTS} attempts (${ms} ms) — config too tight, relax segments/optimal range`);
    failed.push(id);
    continue;
  }
  const rj = Object.entries(res.rejects).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`L${id.toString().padStart(2)} ${cfg.title.padEnd(10)} opt=${res.optimal} 3★≤${res.thresholds.three} hidden=${res.hiddenCells}/${res.units} (${Math.round(hiddenRatio(id) * 100)}%) attempts=${res.attempts} ${ms}ms  [${rj}]`);
  out.push({
    id, title: cfg.title, config: cfg, publicSeed,
    board: encodeBoard(res.board),
    optimal: res.optimal,
    thresholds: res.thresholds,
    moveLimit: computeMoveLimit(id, res.optimal),   // 工單 #5：步數上限（≤10 關 null）
    hiddenRatio: hiddenRatio(id), hiddenCells: res.hiddenCells, units: res.units,   // 工單 #5：隱藏密度（目標 / 實際）
  });
}

console.log(`\n${out.length} levels in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (failed.length) {
  console.error(`FAILED: ${failed.join(', ')}`);
}
if (!ONLY) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), levels: out }, null, 1));
  console.log(`wrote ${OUT}`);
} else if (MERGE && out.length) {
  const cur = JSON.parse(readFileSync(OUT, 'utf8'));
  for (const l of out) { const i = cur.levels.findIndex(x => x.id === l.id); if (i >= 0) cur.levels[i] = l; else cur.levels.push(l); }
  cur.levels.sort((a, b) => a.id - b.id);
  cur.generatedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(cur, null, 1));
  console.log(`merged ${out.map(l => 'L' + l.id).join(',')} into ${OUT}`);
}
process.exit(failed.length ? 1 : 0);
