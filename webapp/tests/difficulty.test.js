// tests/difficulty.test.js — 工單 #5：步數上限、隱藏密度、機制登場表，以及生成器有冇真係讀呢啲參數
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeMoveLimit, hiddenRatio, maxOrders, gatingViolations, UNLOCK_LEVEL } from '../src/core/difficulty.js';
import { CAMPAIGN } from '../src/core/levels.js';
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
  test('公式：L1 0；L2–5 10%（v4 `?` L2 登場）；第 6 關 12%；第 10 關 15%；第 11 關 15.8%；第 30 關 31%；上限 65%', () => {
    assert.equal(hiddenRatio(1), 0);
    assert.ok(Math.abs(hiddenRatio(2) - 0.10) < 1e-9); assert.ok(Math.abs(hiddenRatio(5) - 0.10) < 1e-9);
    assert.ok(Math.abs(hiddenRatio(6) - 0.12) < 1e-9);
    assert.ok(Math.abs(hiddenRatio(10) - 0.15) < 1e-9);
    assert.ok(Math.abs(hiddenRatio(11) - 0.158) < 1e-9);
    assert.ok(Math.abs(hiddenRatio(30) - 0.31) < 1e-9);
    assert.equal(hiddenRatio(100), 0.65);
  });
});

describe('機制登場表', () => {
  test('免費訂單槽上限（Spec v3 §7）：L1–2 → 1，L3–35 → 2，36+ → 3', () => {
    assert.equal(maxOrders(1), 1); assert.equal(maxOrders(2), 1); assert.equal(maxOrders(3), 2);
    assert.equal(maxOrders(17), 2); assert.equal(maxOrders(35), 2); assert.equal(maxOrders(36), 3);
  });
  test('關卡表 40 關全部冇提早出現機制', () => {
    CAMPAIGN.forEach((cfg, i) => {
      const v = gatingViolations(i + 1, cfg);
      assert.deepEqual(v, [], `L${i + 1} ${cfg.title}: ${v.join(', ')}`);
    });
  });
  test('登場表數值', () => {
    assert.deepEqual(UNLOCK_LEVEL, { hidden: 2, adBottle: 2, undo: 5, orders: 1, adEmptyCup: 11, moveLimit: 12, hint: 14, secondOrder: 3, adOrderSlot: 11, covered: 19, thirdOrder: 36 });
  });
  test('登場（v4）：L1–3 教學 2 隻空樽、L4 起 1 隻；L2 起 `?` 樽 + 廣告樽（L2 兩隻）；全部 capacity 4；第 12 關限步；第 19 關布遮樽（campaign.json 實際盤面）', () => {
    const d = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
    const { decodeBoard } = decodeMod;
    const board = id => decodeBoard(d.levels[id - 1].board);
    const kinds = id => board(id).cups.map(c => c.kind);
    const empties = id => board(id).cups.filter(c => c.seg.length === 0).length;
    const empties2 = id => board(id).cups.filter(c => c.seg.length === 0 && c.kind === 'normal').length;
    const ads = id => board(id).cups.filter(c => c.kind === 'ad').length;
    for (let id = 1; id <= 3; id++) assert.equal(empties2(id), 2, `L${id} empties`);
    for (let id = 4; id <= 40; id++) assert.equal(empties2(id), 1, `L${id} empties`);
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
