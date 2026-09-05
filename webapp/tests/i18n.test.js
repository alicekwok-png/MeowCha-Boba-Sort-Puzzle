// tests/i18n.test.js — 字串表完整性：每個 key 三種語言齊；code / HTML 引用嘅 key 全部存在
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strings = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/strings.json'), 'utf8'));
const LOCALES = strings._meta.locales;

/** 攤平成 key → {locale: string}（葉 = 有齊 locale 欄位嘅物件） */
function flatten(node, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(node)) {
    if (k === '_meta') continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && LOCALES.some(l => typeof v[l] === 'string')) out.set(key, v);
    else if (v && typeof v === 'object') flatten(v, key, out);
    else assert.fail(`unexpected leaf at ${key}`);
  }
  return out;
}
const flat = flatten(strings);

describe('i18n · strings.json', () => {
  test('_meta 有三種語言', () => {
    assert.deepEqual(LOCALES, ['en', 'zh-Hant', 'zh-Hans']);
  });
  test('每個 key 三種語言都係非空字串', () => {
    const bad = [];
    for (const [key, v] of flat) for (const l of LOCALES) if (typeof v[l] !== 'string' || !v[l].trim()) bad.push(`${key}[${l}]`);
    assert.deepEqual(bad, []);
  });
  test('同一 key 三種語言嘅 {param} 一致', () => {
    const bad = [];
    for (const [key, v] of flat) {
      const params = (s) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
      const ref = params(v.en);
      for (const l of LOCALES) if (params(v[l]) !== ref) bad.push(`${key}[${l}]`);
    }
    assert.deepEqual(bad, []);
  });
  test('extra 區存在，而且冇同用戶交付嘅頂層 key 撞名', () => {
    assert.ok(strings.extra);
    for (const k of Object.keys(strings.extra)) assert.ok(k, k);
  });
});

/** 收集原始碼引用嘅 key：t('…') / t("…") / has('…') / data-i18n="…" / data-i18n-key="…"，同 t('prefix.' + …) 嘅前綴 */
function collectRefs() {
  const exact = new Set(), prefixes = new Set();
  const files = fs.readdirSync(path.join(ROOT, 'src/client')).filter(f => f.endsWith('.js')).map(f => path.join(ROOT, 'src/client', f));
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\b(?:t|has)\(\s*(['"])([^'"]+)\1\s*[,)]/g)) exact.add(m[2]);
    for (const m of src.matchAll(/(['"])((?:[\w]+\.)+[\w]*)\1\s*\+/g)) prefixes.add(m[2]);   // 'extra.levels.l' + id 之類
    // 對白表 / tips：'catLines.x' 呢類純字串 key（以已知頂層區開頭）
    for (const m of src.matchAll(/(['"])((?:app|menu|hud|actions|vessels|liquids|patterns|clients|tutorial|catLines|results|settings|ads|languageNames|extra)\.[\w.]+)\1/g)) exact.add(m[2]);
  }
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-key)?="([^"]+)"/g)) exact.add(m[1]);
  for (const p of prefixes) exact.delete(p);   // 'extra.levels.l' 呢類前綴唔係完整 key
  return { exact, prefixes };
}

describe('i18n · 原始碼引用', () => {
  const { exact, prefixes } = collectRefs();
  test('有引用先有意義（至少幾十個 key）', () => { assert.ok(exact.size > 50, String(exact.size)); });
  test('每個 t()/has()/data-i18n 引用嘅 key 都喺 strings.json', () => {
    const missing = [...exact].filter(k => !flat.has(k));
    assert.deepEqual(missing, []);
  });
  test('動態前綴（t(prefix + x)）都對應到一個存在嘅群組', () => {
    const missing = [...prefixes].filter(p => ![...flat.keys()].some(k => k.startsWith(p)));
    assert.deepEqual(missing, []);
  });
  test('動態組合 key 齊全：liquids.A–J、clients.<4 位>、extra.levels.l1–40、extra.chapters.c1–8、results.stars1–3、languageNames.<locale>', () => {
    for (const k of 'ABCDEFGHIJ') assert.ok(flat.has('liquids.' + k), 'liquids.' + k);
    for (const w of ['raven', 'badger', 'owl', 'hare']) assert.ok(flat.has('clients.' + w), 'clients.' + w);
    for (let i = 1; i <= 40; i++) assert.ok(flat.has('extra.levels.l' + i), 'extra.levels.l' + i);
    for (let i = 1; i <= 8; i++) assert.ok(flat.has('extra.chapters.c' + i), 'extra.chapters.c' + i);
    for (let i = 1; i <= 3; i++) assert.ok(flat.has('results.stars' + i), 'results.stars' + i);
    for (const l of LOCALES) assert.ok(flat.has('languageNames.' + l), 'languageNames.' + l);
    for (const d of ['easy', 'medium', 'hard']) assert.ok(flat.has('extra.practice.' + d), 'extra.practice.' + d);
  });
});
