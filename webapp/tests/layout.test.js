// tests/layout.test.js — Spec v2 §8 BottleLayout 驗收 + Render / AdSlots 常數
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeLayout, validateNoLiquidOcclusion, safeLayout, allInBounds, minCenterDistance } from '../src/core/layout.js';
import { LAYOUT, CLOTH } from '../src/config/layout.js';
import { RENDER, PATTERN_UV, patternUV, AD_SLOTS, assertAdSlotLimit } from '../src/config/render.js';
import { LIQUID_COLORS, EXCLUSIVE_PAIRS } from '../src/config/theme.js';
import { decodeBoard, unitColor, unitPattern } from '../src/core/board.js';
import { PALETTE, colorsCompatible, patternsCompatible } from '../src/core/palette.js';

// 手機直向杯陣安全區（1080 × 1150 設計像素）；瓶 ≈ 4 欄
const W = 1080, H = 1150;
const input = { levelId: 1, bottleCount: 9, areaWidth: W, areaHeight: H, bottleWidth: 200, bottleHeight: 300 };

describe('BottleLayout', () => {
  test('決定性：同 levelId 兩次結果相同', () => {
    assert.deepEqual(computeLayout(input), computeLayout(input));
  });
  test('不同 levelId 產生不同版面', () => {
    assert.notDeepEqual(computeLayout({ ...input, levelId: 1 }), computeLayout({ ...input, levelId: 2 }));
  });
  test('R2：L1–24 全部無液體遮擋（safeLayout 永遠唔放行 violation）', () => {
    const d = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
    for (let lv = 1; lv <= 40; lv++) {
      const n = decodeBoard(d.levels[lv - 1].board).cups.length;
      const r = safeLayout({ ...input, levelId: lv, bottleCount: n });
      assert.ok(validateNoLiquidOcclusion(r.layout, r.bottleWidth, r.bottleHeight).ok, `L${lv}`);
      assert.ok(allInBounds(r.layout, { ...input, bottleWidth: r.bottleWidth, bottleHeight: r.bottleHeight }), `L${lv} bounds`);
    }
  });
  test('R2 驗證函數本身：前瓶頂高於後瓶液體層 → violation', () => {
    const layout = [
      { index: 0, position: { x: 100, y: 100 }, rotation: 0, zIndex: 0 },
      { index: 1, position: { x: 120, y: 200 }, rotation: 0, zIndex: 1 },   // 前瓶頂 = 50，後瓶底 = 250 → 遮 200px > 12%
    ];
    assert.equal(validateNoLiquidOcclusion(layout, 200, 300).ok, false);
    const ok = [
      { index: 0, position: { x: 100, y: 100 }, rotation: 0, zIndex: 0 },
      { index: 1, position: { x: 120, y: 380 }, rotation: 0, zIndex: 1 },   // 前瓶頂 = 230，後瓶底 = 250 → 遮 20px ≤ 36
    ];
    assert.equal(validateNoLiquidOcclusion(ok, 200, 300).ok, true);
  });
  test('R3：最小圓心距 ≥ minDistanceRatio × 瓶闊（分離迭代後）', () => {
    for (let lv = 1; lv <= 12; lv++) {
      const r = safeLayout({ ...input, levelId: lv, bottleCount: 8 });
      assert.ok(minCenterDistance(r.layout) >= r.bottleWidth * LAYOUT.minDistanceRatio - 1, `L${lv} ${minCenterDistance(r.layout)}`);
    }
  });
  test('R4：zIndex 按 Y 由細到大', () => {
    const l = computeLayout(input);
    const byZ = [...l].sort((a, b) => a.zIndex - b.zIndex);
    for (let i = 1; i < byZ.length; i++) assert.ok(byZ[i].position.y >= byZ[i - 1].position.y);
  });
  test('全部瓶喺邊界內；旋轉 ≤ rotationMaxDeg（用戶 2026-09-06：0 = 一律打直）', () => {
    for (let lv = 1; lv <= 12; lv++) {
      const l = computeLayout({ ...input, levelId: lv });
      assert.ok(allInBounds(l, input));
      for (const p of l) assert.ok(Math.abs(p.rotation) <= LAYOUT.rotationMaxDeg);
    }
  });
  test('jitter 0 = 純網格（先關 jitter 驗證用）', () => {
    const l = computeLayout({ ...input, bottleCount: 8 }, { jitterX: 0, jitterY: 0, rotationMaxDeg: 0 });
    assert.ok(l.every(p => p.rotation === 0));
    assert.equal(new Set(l.map(p => Math.round(p.position.y))).size, 2);
  });
  test('R2 木塞凸出：前瓶頂以上 7.5% 瓶高都算遮擋（frontOverhangRatio）；平線 = 液帶頂（橢圓畫喺帶入面）', () => {
    // 兩隻瓶同 x，前瓶頂剛好貼住後瓶底座（1.5% 底座）→ 冇塞通過、有塞（+7.5%）違規
    const h = 100, w = 42;
    const mk = (yBack, yFront) => [{ index: 0, position: { x: 50, y: yBack }, rotation: 0, zIndex: 0 }, { index: 1, position: { x: 50, y: yFront }, rotation: 0, zIndex: 1 }];
    const touching = mk(50, 50 + h - 1.4);          // 前瓶頂喺後瓶底 1.4px 以上（< 1.5% 底座）
    assert.equal(validateNoLiquidOcclusion(touching, w, h, 0.985).ok, true);
    assert.equal(validateNoLiquidOcclusion(touching, w, h, 0.985, 0.075).ok, false);
    const spaced = mk(50, 50 + h + 7);               // 隔開 7px：有塞（7.5px − 1.5px 底座 = 6px）都通過
    assert.equal(validateNoLiquidOcclusion(spaced, w, h, 0.985, 0.075).ok, true);
    // safeLayout 帶 overhang 永遠唔放行
    for (const n of [9, 10, 11]) {
      const r = safeLayout({ ...input, levelId: 20, bottleCount: n }, null, { liquidTopRatio: 0.985, frontOverhangRatio: 0.075 });
      assert.equal(validateNoLiquidOcclusion(r.layout, r.bottleWidth, r.bottleHeight, 0.985, 0.075).ok, true, `n=${n}`);
    }
  });
  test('常數：jitter 唔超過「凌亂」門檻；布固定尺寸 1.34 / 頂 7%', () => {
    assert.ok(LAYOUT.jitterX <= 0.10 && LAYOUT.jitterY <= 0.15);
    assert.equal(LAYOUT.rotationMaxDeg, 0);   // 樽打直
    assert.equal(CLOTH.fixedWidthRatio, 1.34); assert.equal(CLOTH.topOffsetRatio, 0.07);
  });
});

describe('LevelValidation', () => {
  const d = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
  test('冇關卡使用互斥色對', () => {
    for (const l of d.levels) {
      const colors = [...new Set(decodeBoard(l.board).cups.flatMap(c => c.seg.map(unitColor)))];
      assert.ok(colorsCompatible(colors), `L${l.id}`);
      for (const [x, y] of EXCLUSIVE_PAIRS) {
        const ix = PALETTE.findIndex(p => p.key === x), iy = PALETTE.findIndex(p => p.key === y);
        assert.ok(!(colors.includes(ix) && colors.includes(iy)), `L${l.id} ${x}${y}`);
      }
    }
  });
  test('冇關卡超過 3 種圖案（含 P0）；L1–40 全部 P0', () => {
    for (const l of d.levels) {
      const units = decodeBoard(l.board).cups.flatMap(c => c.seg);
      const patterns = units.map(unitPattern);
      assert.ok(patternsCompatible(patterns, new Set(units).size), `L${l.id}`);
      assert.ok(patterns.every(p => p === 0), `L${l.id} patternId 應全部 P0`);
    }
  });
  test('液體 hex 同 Spec v2 一致（唔准改）', () => {
    assert.equal(LIQUID_COLORS.A.hex, '#E8BD13'); assert.equal(LIQUID_COLORS.F.hex, '#4A3FD4'); assert.equal(LIQUID_COLORS.J.hex, '#E8DCC0');   // v4 §1.1
    for (const k of Object.keys(LIQUID_COLORS)) if (k !== 'J') assert.ok(LIQUID_COLORS[k].lum >= 42 && LIQUID_COLORS[k].lum <= 54, k + ' 中明度');
    for (const [x, y] of EXCLUSIVE_PAIRS) assert.ok(x !== y);   // 色相冇郁過 → 互斥表照舊
    assert.equal(PALETTE.length, 10);
  });
});

describe('Render', () => {
  test('v4 §1.2：液體純色填（source-over），玻璃只加光 luma>215 / range 40 / 0.55；圓柱模型頂面橢圓 ry 0.14 / lighten 0.32', () => {
    assert.equal(RENDER.liquidBlend, 'source-over');
    assert.deepEqual(RENDER.glassHighlight, { lumaThreshold: 215, lumaRange: 40, strength: 0.55 });
    assert.deepEqual(RENDER.surfaceEllipse, { ryRatio: 0.14, lighten: 0.32 });   // 液面線已由圓柱頂面橢圓取代（2026-09-06）
    assert.equal(LAYOUT.bottleHeightRatio, 0.19); assert.equal(+(LAYOUT.playfieldBottom - LAYOUT.playfieldTop).toFixed(3), 0.68); assert.equal(LAYOUT.topBarBottom, 0.055); assert.equal(+(LAYOUT.clientsBottom - LAYOUT.clientsTop).toFixed(3), 0.15); assert.equal(+(LAYOUT.orderSlotsBottom - LAYOUT.orderSlotsTop).toFixed(3), 0.045); assert.equal(LAYOUT.toolbarTop, 0.93);
  });
  test('v4 §2.2：深色標準樽樽身中央明度 < 80/255', () => {
    const c = JSON.parse(readFileSync(new URL('../assets/v2/asset-check.json', import.meta.url), 'utf8')).checks;
    assert.ok(c.bottleStdCentreLuma < 80, String(c.bottleStdCentreLuma));
  });
  test('P3 用 repeat，其餘 clamp', () => {
    assert.equal(RENDER.patternWrap.P3, 'repeat');
    assert.equal(RENDER.patternWrap.P1, 'clamp');
  });
  test('UV inset：四象限 + 半像素內縮', () => {
    assert.equal(RENDER.patternUVInset, 0.5 / 256);
    const uv = patternUV('P1');
    assert.ok(uv.u0 > PATTERN_UV.P1.u0 && uv.u1 < PATTERN_UV.P1.u1);
    assert.equal(patternUV('P0'), null);
  });
});

describe('AdSlots', () => {
  test('同屏廣告入口 ≤ 2', () => { assert.doesNotThrow(assertAdSlotLimit); assert.equal(assertAdSlotLimit(), 2); });
  test('超過 2 個就 throw', () => {
    assert.throws(() => assertAdSlotLimit({ ...AD_SLOTS, extraMove: { enabled: true, location: 'topBar' } }), /max 2/);
  });
});
