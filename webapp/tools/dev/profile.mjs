import { readFileSync } from 'node:fs';
import { decodeBoard } from '../../src/core/board.js';
const file = process.argv[2] || new URL('../../levels/campaign.json', import.meta.url);
const d = JSON.parse(readFileSync(file, 'utf8'));
console.log('generatedAt', d.generatedAt);
for (const l of d.levels) {
  if (![1, 5, 8, 10, 12, 15, 20, 25, 30, 35, 40].includes(l.id)) continue;
  const b = decodeBoard(l.board);
  const segs = b.cups.reduce((a, c) => a + c.seg.filter((v, i) => i === 0 || v !== c.seg[i - 1]).length, 0);
  const empt = b.cups.filter(c => !c.seg.length).length;
  console.log('L' + String(l.id).padStart(2), 'cups', b.cups.length, 'colors', b.colors, 'empties', empt, 'segs', segs, 'segs/colour', (segs / b.colors).toFixed(2), 'optimal', l.optimal, 'limit', l.moveLimit, '3star', l.thresholds.three);
}
