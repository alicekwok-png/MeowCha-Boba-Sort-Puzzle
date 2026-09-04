// tests/background.test.js — Spec v2 §7 背景驗收：單張 BG_lab_full（1170×2532、不透明）、無階段過渡、
// 灰階對比測試（液體色板平均 L* − 背景瓶區帶 L* ≥ 25）、可讀性遮罩幾何常數、BackgroundManager 唔再做視差 / 氛圍。
// L_bg 由 tools/build-assets-v2.py 寫入 assets/v2/asset-check.json（checks.bgBandL / bgBandRgb：y 25%–73% 平均）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  STAGES, SAFE_TOP, SAFE_BOTTOM, FADE, MASK_COLOR, MASK_ALPHA, BG_OBJECT_POSITION,
  stageForLevel, stageTransitionAfter, backgroundUrl, BackgroundManager,
} from '../src/client/background.js';
import { ASSET_MAP } from '../src/config/assets.js';
import { COLORS } from '../src/config/theme.js';
import { PALETTE } from '../src/core/palette.js';

const root = (p) => new URL('../' + p, import.meta.url);
const check = JSON.parse(readFileSync(root('assets/v2/asset-check.json'), 'utf8')).checks;

const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const unlin = v => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const lstar = ([r, g, b]) => {
  const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return 116 * (y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116) - 16;
};
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
/** 線性空間 alpha 合成 */
const over = (bgRgb, fgRgb, a) => bgRgb.map((c, i) => unlin(lin(c) * (1 - a) + lin(fgRgb[i]) * a));

/** 讀 WebP 尺寸（VP8 / VP8L / VP8X 三種 chunk 都支援） */
function webpSize(buf) {
  assert.equal(buf.toString('latin1', 0, 4), 'RIFF');
  assert.equal(buf.toString('latin1', 8, 12), 'WEBP');
  const chunk = buf.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    assert.deepEqual([buf[23], buf[24], buf[25]], [0x9d, 0x01, 0x2a], 'VP8 start code');
    return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  }
  if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return [(b & 0x3fff) + 1, ((b >>> 14) & 0x3fff) + 1];
  }
  if (chunk === 'VP8X') return [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1];
  throw new Error('unknown WebP chunk ' + chunk);
}

// 由 hex 計真正 L*（palette 嘅 L 欄係 HSL 明度，唔係 L*）
const LIQUID_L = PALETTE.reduce((a, p) => a + lstar(hex(p.hex)), 0) / PALETTE.length;

/** 假 DOM：夠 BackgroundManager 行（無 Image / requestAnimationFrame） */
function fakeRoot(ids = ['bg-far', 'bg-far-next', 'bg-mid', 'bg-ambient', 'bg-mask']) {
  const els = Object.fromEntries(ids.map(id => [id, { id, style: {}, hidden: false, src: '' }]));
  return { els, querySelector: (sel) => els[sel.replace('#', '')] ?? null };
}

describe('background (Spec v2 單張背景)', () => {
  test('(a) BG_lab_full 存在、1170×2532、體積 > 50 KB，asset-check 亦報 bgSize [1170,2532]', () => {
    assert.equal(ASSET_MAP.BG_lab_full, 'assets/v2/bg_lab_full.webp');
    const file = root(ASSET_MAP.BG_lab_full);
    assert.ok(statSync(file).size > 50 * 1024, 'bg_lab_full.webp 應 > 50 KB');
    assert.deepEqual(webpSize(readFileSync(file)), [1170, 2532]);
    assert.deepEqual(check.bgSize, [1170, 2532]);
    // 細圖（標題 / loading）都要喺度
    assert.ok(statSync(root(ASSET_MAP.BG_lab_full_small)).size > 10 * 1024);
    assert.ok(backgroundUrl().endsWith('/assets/v2/bg_lab_full.webp'));
  });

  test('(b) 只有一個階段覆蓋 1–9999；40 / 120 / 250 / 450 之後唔再過渡', () => {
    assert.equal(STAGES.length, 1);
    assert.equal(STAGES[0].id, 1);
    assert.equal(STAGES[0].name, '實驗室');
    assert.equal(STAGES[0].levelFrom, 1);
    assert.equal(STAGES[0].levelTo, 9999);
    assert.equal(typeof STAGES[0].line, 'string');
    for (const lv of [1, 40, 41, 120, 250, 450, 9999]) assert.equal(stageForLevel(lv), STAGES[0]);
    for (const lv of [39, 40, 120, 250, 450, 9999]) assert.equal(stageTransitionAfter(lv), null);
  });

  test('(c) 灰階對比：液體色板平均 L* − 背景瓶區帶 L* ≥ 25（遮罩前後都要過）', () => {
    assert.equal(typeof check.bgBandL, 'number');
    assert.equal(check.bgBandRgb.length, 3);
    const diff = LIQUID_L - check.bgBandL;
    assert.ok(diff >= 25, `L_liquid ${LIQUID_L.toFixed(1)} − L_bg ${check.bgBandL} = ${diff.toFixed(1)} < 25`);
    // 疊上可讀性遮罩（只會更暗）之後
    const masked = lstar(over(check.bgBandRgb, hex(MASK_COLOR), MASK_ALPHA));
    assert.ok(masked <= lstar(check.bgBandRgb) + 0.5, '遮罩唔應該令背景變光');
    assert.ok(LIQUID_L - masked >= 25);
    // 由 asset-check 嘅 RGB 重算 L*，同 python 端寫嘅值一致（±1）
    assert.ok(Math.abs(lstar(check.bgBandRgb) - check.bgBandL) < 1.5);
  });

  test('(d) 可讀性遮罩幾何：安全區 600–1750 / 2400，上下 100px 過渡；COLORS.bgTop @ 0.28', () => {
    assert.ok(Math.abs(SAFE_TOP - 600 / 2400) < 1e-3);   // 工單 #4
    assert.ok(Math.abs(SAFE_BOTTOM - 1750 / 2400) < 1e-3);
    assert.ok(Math.abs(FADE - 100 / 2400) < 1e-3);
    assert.equal(MASK_COLOR, COLORS.bgTop);
    assert.equal(MASK_ALPHA, 0.28);
    assert.equal(STAGES[0].maskColor, MASK_COLOR);
    assert.equal(STAGES[0].maskAlpha, MASK_ALPHA);
    assert.equal(BG_OBJECT_POSITION, 'center 40%');
  });

  test('BackgroundManager：單張 cover 圖 + 遮罩 gradient；廢棄層收埋；過渡即時 resolve；onPour / ambient 無作用', async () => {
    const r = fakeRoot();
    const bg = new BackgroundManager(r, 'assets/bg/');
    for (const id of ['bg-far-next', 'bg-mid', 'bg-ambient']) assert.equal(r.els[id].hidden, true, id + ' 應收埋');
    bg.setStage(stageForLevel(1));
    const far = r.els['bg-far'];
    assert.ok(far.src.endsWith('/assets/v2/bg_lab_full.webp'));
    assert.equal(far.style.objectFit, 'cover');
    assert.equal(far.style.objectPosition, 'center 40%');
    assert.equal(far.hidden, false);
    const [cr, cg, cb] = hex(MASK_COLOR);
    const g = r.els['bg-mask'].style.background;
    assert.ok(g.startsWith('linear-gradient(to bottom,'));
    assert.ok(g.includes(`rgba(${cr},${cg},${cb},0.280) 25.00%`), g);
    assert.ok(g.includes(`rgba(${cr},${cg},${cb},0.280) 72.90%`), g);
    assert.ok(g.includes(`rgba(${cr},${cg},${cb},0.000) 20.80%`), g);
    assert.ok(g.includes(`rgba(${cr},${cg},${cb},0.000) 77.10%`), g);
    // alpha 覆蓋
    bg.setMaskAlpha(0.1);
    assert.ok(r.els['bg-mask'].style.background.includes('0.100) 25.00%'));
    // 過渡 / 視差 / 氛圍：全部無作用，src 唔變
    const before = far.src;
    await bg.transitionTo(STAGES[0]);
    bg.onPour(); bg.setAmbientEnabled(true); bg.preloadAround(5); bg.destroy();
    assert.equal(far.src, before);
    assert.equal(far.style.transform, 'none');
    assert.equal(bg.stage, STAGES[0]);
  });

  test('BackgroundManager：#bg 元素缺席都唔會掉（index.html 由 UI agent 管）', () => {
    const bg = new BackgroundManager(fakeRoot(['bg-far']), '');
    assert.doesNotThrow(() => { bg.setStage(STAGES[0]); bg.setMaskAlpha(0.2); bg.drawMask(); });
    const bg2 = new BackgroundManager(fakeRoot([]), '');
    assert.doesNotThrow(() => { bg2.setStage(); bg2.preload(); bg2.onPour(); });
    assert.doesNotThrow(() => new BackgroundManager(null, ''));
  });
});
