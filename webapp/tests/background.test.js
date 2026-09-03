// tests/background.test.js — 背景規格 §3 驗收：灰階對比測試 |L_cup − L_bg| ≥ 25，每階段都跑。
// L_bg = 遠景安全區平均色（tools/build-bg.py 寫入 manifest）疊上遮罩之後嘅明度
// L_cup = 杯身（半透明奶白）疊喺該背景上嘅明度
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STAGES, SAFE_TOP, SAFE_BOTTOM, FADE, stageForLevel, stageTransitionAfter } from '../src/client/background.js';
import { PALETTE } from '../src/core/palette.js';

const manifest = JSON.parse(readFileSync(new URL('../assets/bg/manifest.json', import.meta.url), 'utf8'));

const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const unlin = v => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const lstar = ([r, g, b]) => {
  const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return 116 * (y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116) - 16;
};
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
/** 線性空間 alpha 合成 */
const over = (bgRgb, fgRgb, a) => bgRgb.map((c, i) => unlin(lin(c) * (1 - a) + lin(fgRgb[i]) * a));

const CUP_BODY = [255, 255, 255], CUP_ALPHA = 0.42;   // game.js 杯身：白色漸變 ~0.28–0.55
// 杯陣截圖入面一隻典型杯：約 70% 面積係飲品（取 15 色平均明度），30% 係杯身 / 空格
const LIQUID_L = PALETTE.reduce((a, p) => a + p.L, 0) / PALETTE.length;
const LIQUID_SHARE = 0.7;

describe('background', () => {
  test('五個階段嘅遠景圖都存在且喺體積預算內（≤ 200 KB）', () => {
    assert.equal(manifest.stages.length, 5);
    for (const s of manifest.stages) assert.ok(s.bytes <= 200 * 1024, `stage ${s.id} ${s.bytes} bytes`);
    assert.equal(manifest.width, 1080); assert.equal(manifest.height, 2800); assert.equal(manifest.bleed, 200);
  });

  test('灰階對比測試：每階段 |L_cup − L_bg| ≥ 25', () => {
    for (const s of manifest.stages) {
      const cfg = STAGES.find(x => x.id === s.id);
      const bgMasked = over(s.safeZoneRgb, hex(cfg.maskColor), cfg.maskAlpha);
      const body = over(bgMasked, CUP_BODY, CUP_ALPHA);
      const cupL = LIQUID_SHARE * LIQUID_L + (1 - LIQUID_SHARE) * lstar(body);
      const diff = Math.abs(cupL - lstar(bgMasked));
      assert.ok(diff >= 25, `stage ${s.id} (${s.desc}): |L_cup − L_bg| = ${diff.toFixed(1)} < 25 → 提高 maskAlpha 0.05 再測`);
    }
  });

  test('遮罩幾何：安全區 470–1750 / 2400，上下 100px 過渡', () => {
    assert.ok(Math.abs(SAFE_TOP - 470 / 2400) < 1e-3);
    assert.ok(Math.abs(SAFE_BOTTOM - 1750 / 2400) < 1e-3);
    assert.ok(Math.abs(FADE - 100 / 2400) < 1e-3);
  });

  test('階段表覆蓋 1–9999 無縫，夜市階段遮罩最強', () => {
    for (let i = 0; i < STAGES.length - 1; i++) assert.equal(STAGES[i].levelTo + 1, STAGES[i + 1].levelFrom);
    assert.equal(stageForLevel(1).id, 1);
    assert.equal(stageForLevel(40).id, 1);
    assert.equal(stageForLevel(41).id, 2);
    assert.equal(stageForLevel(9999).id, 5);
    assert.equal(Math.max(...STAGES.map(s => s.maskAlpha)), STAGES[3].maskAlpha);
  });

  test('跨階段關（40 / 120 / 250 / 450）之後觸發過渡', () => {
    assert.equal(stageTransitionAfter(40).id, 2);
    assert.equal(stageTransitionAfter(120).id, 3);
    assert.equal(stageTransitionAfter(39), null);
    assert.equal(stageTransitionAfter(9999), null);
  });
});
