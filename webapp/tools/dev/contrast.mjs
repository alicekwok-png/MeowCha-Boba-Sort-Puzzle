import { readFileSync } from 'node:fs';
import { STAGES } from '../../src/client/background.js';
import { PALETTE } from '../../src/core/palette.js';
const m = JSON.parse(readFileSync(new URL('../../assets/bg/manifest.json', import.meta.url), 'utf8'));
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const unlin = v => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const L = ([r, g, b]) => { const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); return 116 * (y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116) - 16; };
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const over = (bg, fg, a) => bg.map((c, i) => unlin(lin(c) * (1 - a) + lin(fg[i]) * a));
const LQ = PALETTE.reduce((a, p) => a + p.L, 0) / PALETTE.length;
for (const s of m.stages) {
  const cfg = STAGES.find(x => x.id === s.id);
  for (let a = cfg.maskAlpha; a <= 1; a = +(a + 0.05).toFixed(2)) {
    const bg = over(s.safeZoneRgb, hex(cfg.maskColor), a);
    const cup = 0.7 * LQ + 0.3 * L(over(bg, [255, 255, 255], 0.42));
    const d = Math.abs(cup - L(bg));
    if (d >= 25 || a >= 1) { console.log(`stage ${s.id}: alpha ${cfg.maskAlpha} -> ${a} diff ${d.toFixed(1)}`); break; }
  }
}
