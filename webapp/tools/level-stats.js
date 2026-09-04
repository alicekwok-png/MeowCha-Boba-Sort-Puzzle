#!/usr/bin/env node
// tools/level-stats.js — 輸出關卡數據表（工單 #5 第三部分）
//   node tools/level-stats.js            全部 40 關
//   node tools/level-stats.js 1 10 20    指定關卡
import { readFileSync } from 'node:fs';
import { decodeBoard, hiddenCount } from '../src/core/board.js';
import { computeMoveLimit, hiddenRatio } from '../src/core/difficulty.js';

const data = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
const want = process.argv.slice(2).map(Number);
const rows = data.levels.filter(l => !want.length || want.includes(l.id)).map(l => {
  const b = decodeBoard(l.board);
  const count = k => b.cups.filter(c => c.kind === k).length;
  const units = b.cups.reduce((a, c) => a + c.seg.length, 0);
  const segs = b.cups.reduce((a, c) => a + c.seg.filter((v, i) => i === 0 || v !== c.seg[i - 1]).length, 0);
  const empties = b.cups.filter(c => !c.seg.length).length;
  const hidden = b.cups.reduce((a, c) => a + hiddenCount(c), 0);   // 布遮全部 + 磨砂非頂格 + 普通杯隱藏層
  const layerCups = b.cups.filter(c => c.kind === 'normal' && (c.hidden || 0) > 0).length;
  return {
    關卡: l.id, 容器數: b.cups.length, 色數: b.colors, 空杯: empties, 每色平均段數: +(segs / b.colors).toFixed(2),
    '隱藏格%': `${Math.round(hidden / units * 100)}% (目標 ${Math.round(hiddenRatio(l.id) * 100)}%)`,
    最優步: l.optimal, 步數上限: computeMoveLimit(l.id, l.optimal) ?? '無',
    隱藏層杯: layerCups, 磨砂杯: count('frosted'), 封膜杯: count('sealed'), 布遮杯: count('covered'), 外帶: count('takeaway'), 訂單: b.orders.length,
  };
});
console.table(rows);
