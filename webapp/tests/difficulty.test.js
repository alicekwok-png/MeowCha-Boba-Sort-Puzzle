// tests/difficulty.test.js — 工單 #5：步數上限、隱藏密度、機制登場表，以及生成器有冇真係讀呢啲參數
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeMoveLimit, hiddenRatio, maxOrders, gatingViolations, UNLOCK_LEVEL } from '../src/core/difficulty.js';
import { CAMPAIGN, bottlesPerColorFor } from '../src/core/levels.js';
import { makeCup, makeBoard, encodeBoard } from '../src/core/board.js';
import * as decodeMod from '../src/core/board.js';
import { LocalServer, MIN_MS_PER_MOVE } from '../src/client/local-server.js';
import { solve } from '../src/core/solver.js';

describe('步數上限', () => {
  test('公式：≤11 無上限（brief 第 12 關先限步）；12–20 +12；21–30 +10；31–40 +8；41+ +6', () => {
    assert.equal(computeMoveLimit(1, 5), null);
    assert.equal(computeMoveLimit(11, 9), null);
    assert.equal(computeMoveLimit(12, 10), 22);
    assert.equal(computeMoveLimit(20, 18), 30);
    assert.equal(computeMoveLimit(21, 18), 28);
    assert.equal(computeMoveLimit(30, 20), 30);
    assert.equal(computeMoveLimit(40, 29), 37);
    assert.equal(computeMoveLimit(41, 30), 36);
  });
  test('campaign.json 每關都寫咗 moveLimit，同公式一致', () => {
    const d = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
    for (const l of d.levels) assert.equal(l.moveLimit, computeMoveLimit(l.id, l.optimal), `L${l.id}`);
  });
  test('server 亦驗步數上限：超過上限嘅完成提交被拒', () => {
    const N = (seg) => makeCup('normal', seg);
    const b = makeBoard([N([1, 1, 1]), N([2, 2, 2]), N([2, 1]), N([])], 2, []);
    const sol = solve(b, 20);
    const srv = new LocalServer();
    const st = srv.start({ id: 15, board: encodeBoard(b), optimal: sol.length, thresholds: { three: 9, two: 14 }, moveLimit: sol.length - 1 });
    assert.equal(st.moveLimit, sol.length - 1);
    srv.sessions.get(st.sessionId).startedAt -= sol.length * MIN_MS_PER_MOVE + 1000;
    assert.equal(srv.complete(st.sessionId, { moves: sol, moveTimestamps: [] }).reason, 'MOVE_LIMIT');
  });
});

describe('隱藏密度', () => {
  test('公式（2026-09-06 加強）：L1 0；L2 30%；L3 35%；L4–6 40%；L7–10 45%；L11 50%；L30 59.5%；上限 65%', () => {
    assert.equal(hiddenRatio(1), 0);
    assert.ok(Math.abs(hiddenRatio(2) - 0.30) < 1e-9); assert.ok(Math.abs(hiddenRatio(3) - 0.35) < 1e-9);
    assert.ok(Math.abs(hiddenRatio(4) - 0.40) < 1e-9); assert.ok(Math.abs(hiddenRatio(6) - 0.40) < 1e-9);
    assert.ok(Math.abs(hiddenRatio(7) - 0.45) < 1e-9); assert.ok(Math.abs(hiddenRatio(10) - 0.45) < 1e-9);
    assert.ok(Math.abs(hiddenRatio(11) - 0.50) < 1e-9);
    assert.ok(Math.abs(hiddenRatio(30) - 0.595) < 1e-9);
    assert.equal(hiddenRatio(100), 0.65);
  });
  test('campaign.json：L2 起每關至少一隻樽有 ≥ 2 個隱藏格', () => {
    const { decodeBoard } = decodeMod;
    const d = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
    for (const l of d.levels) if (l.id >= 2) {
      const b = decodeBoard(l.board);
      assert.ok(b.cups.some(c => c.kind === 'hidden' && c.seg.length - 1 >= 2), `L${l.id}`);
    }
  });
});

describe('機制登場表', () => {
  test('免費訂單槽上限：L1–2 → 1，L3+ → 2（第三免費槽已取消，L36+ 免費 2 + 廣告 2）', () => {
    assert.equal(maxOrders(1), 1); assert.equal(maxOrders(2), 1); assert.equal(maxOrders(3), 2);
    assert.equal(maxOrders(17), 2); assert.equal(maxOrders(35), 2); assert.equal(maxOrders(36), 2); assert.equal(maxOrders(40), 2);
  });
  test('關卡表 40 關全部冇提早出現機制', () => {
    CAMPAIGN.forEach((cfg, i) => {
      const v = gatingViolations(i + 1, cfg);
      assert.deepEqual(v, [], `L${i + 1} ${cfg.title}: ${v.join(', ')}`);
    });
  });
  test('登場表數值', () => {
    assert.deepEqual(UNLOCK_LEVEL, { hidden: 2, adBottle: 2, orders: 1, adEmptyCup: 11, moveLimit: 12, secondOrder: 3, adOrderSlot: 11, covered: 19 });   // 提示 / 撤銷 2026-09-06 拎走
  });
  test('登場：每關 2 隻空樽（空位 = 2 樽先輸得到）、真樽 = 色數 × 每色樽數 + 2；L2 起 `?` 樽 + 廣告樽（L2 兩隻）；全部 capacity 4；第 12 關限步；第 19 關布遮樽（campaign.json 實際盤面）', () => {
    const d = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
    const { decodeBoard } = decodeMod;
    const board = id => decodeBoard(d.levels[id - 1].board);
    const kinds = id => board(id).cups.map(c => c.kind);
    const empties = id => board(id).cups.filter(c => c.seg.length === 0).length;
    const empties2 = id => board(id).cups.filter(c => c.seg.length === 0 && c.kind === 'normal').length;
    const ads = id => board(id).cups.filter(c => c.kind === 'ad').length;
    // 用戶 2026-09-06：空樽固定 2 隻；真樽 = 色數 × 每色樽數 + 2（每隻色啱啱裝滿佢嘅樽）
    //   → 空位多過 2 樽就永遠輸唔到。L27 起一色兩樽，盤面 15 → 21 隻。
    for (let id = 1; id <= 40; id++) {
      const b = board(id);
      const real = b.cups.filter(c => c.kind !== 'ad');
      const bpc = bottlesPerColorFor(id);
      assert.equal(real.filter(c => c.seg.length === 0).length, 2, `L${id} 兩隻空樽`);
      assert.equal(real.length, b.colors * bpc + 2, `L${id} 真樽 = 色數 × ${bpc} + 2`);
      assert.equal(real.reduce((a, c) => a + c.seg.length, 0), b.colors * 4 * bpc, `L${id} 液體格數`);
    }
    assert.equal(kinds(1).includes('hidden'), false); assert.equal(ads(1), 0); assert.equal(d.levels[0].hiddenCells, 0);
    assert.ok(kinds(2).includes('hidden'), 'L2 `?`'); assert.equal(ads(2), 2, 'L2 兩隻廣告樽');
    for (let id = 2; id <= 40; id++) assert.ok(ads(id) >= 1, `L${id} ad`);
    for (let id = 1; id <= 11; id++) assert.equal(d.levels[id - 1].moveLimit, null, `L${id} limit`);
    assert.ok(d.levels[11].moveLimit > 0);
    for (let id = 1; id <= 18; id++) assert.ok(!kinds(id).includes('covered'), `L${id} covered`);
    assert.ok(kinds(19).includes('covered'));
    for (const l of d.levels) for (const c of decodeBoard(l.board).cups) { assert.equal(c.cap, 4, `L${l.id} capacity 4`); assert.ok(!['takeaway', 'cracked', 'sealed'].includes(c.kind), `L${l.id} ${c.kind}`); }
  });
});
