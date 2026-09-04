#!/usr/bin/env node
// tools/level-stats.js — 輸出關卡數據表（工單 #5 第三部分）
//   node tools/level-stats.js            全部 40 關
//   node tools/level-stats.js 1 10 20    指定關卡
import { readFileSync } from 'node:fs';
import { decodeBoard } from '../src/core/board.js';
import { computeMoveLimit, hiddenRatio } from '../src/core/difficulty.js';

const data = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
const want = process.argv.slice(2).map(Number);
const rows = data.levels.filter(l => !want.length || want.includes(l.id)).map(l => {
  const b = decodeBoard(l.board);
  const count = k => b.cups.filter(c => c.kind === k).length;
  const units = b.cups.reduce((a, c) => a + c.seg.length, 0);
  const hidden = b.cups.reduce((a, c) => a + (c.kind === 'frosted' ? Math.max(0, c.seg.length - 1) : 0) + (c.kind === 'covered' ? c.seg.length : 0), 0);
  return {
    關卡: l.id, 容器數: b.cups.length, 色數: b.colors,
    '隱藏格%': `${Math.round(hidden / units * 100)}% (目標 ${Math.round(hiddenRatio(l.id) * 100)}%)`,
    最優步: l.optimal, 步數上限: computeMoveLimit(l.id, l.optimal) ?? '無',
    磨砂杯: count('frosted'), 封膜杯: count('sealed'), 布遮杯: count('covered'), 外帶: count('takeaway'), 訂單: b.orders.length,
  };
});
console.table(rows);
