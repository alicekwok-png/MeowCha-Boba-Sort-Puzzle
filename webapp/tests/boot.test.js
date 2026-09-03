// tests/boot.test.js — 開場流程規格：決策、並行載入、timeout / 重試、續玩例外
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decideLogoDuration, decideEntry, loadCore, CORE_ASSETS, LOGO_FIRST_MS, LOGO_REPEAT_MS } from '../src/client/boot.js';

const mem = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};

describe('boot · logo 時長', () => {
  test('首次 2.0s，第二次 1.2s，flag 會寫', () => {
    const s = mem();
    assert.equal(decideLogoDuration({ search: '', storage: s }).duration, LOGO_FIRST_MS);
    assert.equal(s.getItem('mc_seen_logo'), '1');
    assert.equal(decideLogoDuration({ search: '', storage: s }).duration, LOGO_REPEAT_MS);
  });
  test('?host=app 完全跳過 logo，並帶出 uid / sig', () => {
    const r = decideLogoDuration({ search: '?host=app&uid=u1&sig=abc', storage: mem() });
    assert.equal(r.duration, 0);
    assert.equal(r.fromHostApp, true);
    assert.equal(r.uid, 'u1'); assert.equal(r.sig, 'abc');
  });
});

describe('boot · 續玩', () => {
  test('一律落上次關卡：last 未過 → last；否則第一個未過嘅關', () => {
    assert.deepEqual(decideEntry({ storage: mem(), progress: { stars: { 1: 3, 2: 3 }, last: 2 }, levelCount: 40 }), { screen: 'level', levelId: 3 });
    assert.deepEqual(decideEntry({ storage: mem(), progress: { stars: { 1: 3, 2: 3, 3: 1 }, last: 7 }, levelCount: 40 }), { screen: 'level', levelId: 7 });
    assert.deepEqual(decideEntry({ storage: mem(), progress: { stars: {} }, levelCount: 40 }), { screen: 'level', levelId: 1 });
  });
  test('剛跨階段 → 落主畫面播過渡', () => {
    const r = decideEntry({ storage: mem({ mc_pending_stage: '2' }), progress: { stars: {} }, levelCount: 40 });
    assert.equal(r.screen, 'cafe'); assert.equal(r.reason, 'stage'); assert.equal(r.stageId, 2);
  });
  test('首次完成第 10 關後回訪 → 主畫面介紹店舖（只一次）', () => {
    const s = mem();
    assert.equal(decideEntry({ storage: s, progress: { stars: { 10: 2 } }, levelCount: 40 }).reason, 'intro');
    s.setItem('mc_intro_cafe', '1');
    assert.equal(decideEntry({ storage: s, progress: { stars: { 10: 2 } }, levelCount: 40 }).screen, 'level');
  });
  test('未領獎勵 / 賽事未讀 → 主畫面', () => {
    assert.equal(decideEntry({ storage: mem({ mc_unclaimed_reward: '1' }), progress: { stars: {} }, levelCount: 40 }).reason, 'reward');
    assert.equal(decideEntry({ storage: mem({ mc_unread_tournament: '1' }), progress: { stars: {} }, levelCount: 40 }).reason, 'tournament');
  });
});

describe('boot · 並行載入', () => {
  const assets = [{ url: 'a', bytes: 100 }, { url: 'b', bytes: 300 }];
  const okFetch = (url) => Promise.resolve(new Response(new Uint8Array(url === 'a' ? 100 : 300)));

  test('全部成功 → resolve，進度去到 1，資源同時（唔係順序）發出', async () => {
    const started = [];
    let p = 0;
    await loadCore(assets, { fetchImpl: (u) => { started.push(u); return okFetch(u); }, onProgress: v => { p = v; } });
    assert.deepEqual(started, ['a', 'b']);
    assert.equal(p, 1);
  });
  test('一個資源永遠唔返 → timeout 後重試 1 次再 reject（唔會永遠 pending）', async () => {
    let calls = 0;
    const hang = (u, { signal }) => { calls++; return new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))); };
    await assert.rejects(loadCore([{ url: 'x', bytes: 10 }], { fetchImpl: hang, timeoutMs: 20 }), /asset failed: x \(timeout\)/);
    assert.equal(calls, 2);
  });
  test('HTTP 錯誤第一次、第二次成功 → resolve（自動重試）', async () => {
    let n = 0;
    const flaky = () => Promise.resolve(n++ === 0 ? new Response('', { status: 503 }) : new Response(new Uint8Array(10)));
    await loadCore([{ url: 'y', bytes: 10 }], { fetchImpl: flaky });
    assert.equal(n, 2);
  });
  test('核心批次總量 ≤ 2.4 MB（規格預算）', () => {
    assert.ok(CORE_ASSETS.reduce((a, x) => a + x.bytes, 0) <= 2_400_000);
  });
});
