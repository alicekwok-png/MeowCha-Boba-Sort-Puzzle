// tests/assets.test.js — 資產版本號一致（Safari cache 事故防線）+ 液體幾何（四層等高、唔超出樽身）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAssetVersion } from '../tools/asset-version.js';
import { ASSET_VERSION, versioned } from '../src/config/assets.js';
import { bandPolygon, extentsAt } from '../src/client/render-assets.js';

const root = (p) => new URL('../' + p, import.meta.url);

describe('資產版本號', () => {
  test('ASSET_VERSION = assets/v2 + icons + levels + config + i18n 內容 hash；改咗檔案冇跑 npm run version:assets 就炸', () => {
    assert.equal(ASSET_VERSION, computeAssetVersion(), '跑 npm run version:assets');
    assert.equal(versioned('assets/v2/x.webp'), 'assets/v2/x.webp?v=' + ASSET_VERSION);
  });
  test('index.html / styles.css 每個 assets/v2 靜態引用同 main.js / styles.css 都帶住同一個 ?v=', () => {
    for (const f of ['index.html', 'styles.css']) {
      const s = readFileSync(root(f), 'utf8');
      const refs = s.match(/assets\/v2\/[A-Za-z0-9_\-]+\.(?:webp|png)(\?v=[A-Za-z0-9]+)?/g) || [];
      for (const r of refs) assert.ok(r.endsWith('?v=' + ASSET_VERSION), `${f}: ${r}`);
      for (const v of s.match(/\?v=[A-Za-z0-9]+/g) || []) assert.equal(v, '?v=' + ASSET_VERSION, f);
    }
  });
});

describe('液體幾何（vessels.json bottle_std）', () => {
  const g = JSON.parse(readFileSync(root('assets/v2/vessels.json'), 'utf8')).bottle_std;
  test('填滿 4 層：每層高度相等（= (liquid.bottom − liquid.top) / 4），液體 bbox 唔超出樽身內壁 bbox', () => {
    const unit = (g.liquid.bottom - g.liquid.top) / 4;
    const bodyL = Math.min(...g.rows.map(r => r[1])), bodyR = Math.max(...g.rows.map(r => r[2]));
    for (let i = 0; i < 4; i++) {
      const yBot = g.liquid.bottom - i * unit, yTop = yBot - unit;
      const poly = bandPolygon(g, yTop, yBot);
      const ys = poly.map(p => p[1]), us = poly.map(p => p[0]);
      assert.ok(Math.abs((Math.max(...ys) - Math.min(...ys)) - unit) < 1e-9, `layer ${i} height`);
      assert.ok(Math.min(...us) >= bodyL - 1e-9 && Math.max(...us) <= bodyR + 1e-9, `layer ${i} inside body`);
      assert.ok(Math.max(...us) - Math.min(...us) <= g.maxWidth + 1e-9, `layer ${i} narrower than maxWidth`);
    }
    // 樽身內壁：唔係圓肚（舊燒瓶幾何嘅症狀），中段闊度變化 < 2%
    const mid = g.rows.filter(r => r[0] > 0.35 && r[0] < 0.9).map(r => r[2] - r[1]);
    assert.ok(Math.max(...mid) - Math.min(...mid) < 0.02, 'body width nearly constant');
    // 液體坐喺玻璃內壁：明顯窄過樽身剪影（每邊縮走壁厚），但唔可以縮到得返一條
    const e = extentsAt(g, (g.liquid.top + g.liquid.bottom) / 2);
    const ratio = (e.r - e.l) / g.maxWidth;
    assert.ok(ratio > 0.75 && ratio < 0.95, `液體闊度 / 樽身闊度 = ${ratio.toFixed(3)}`);
  });
});
