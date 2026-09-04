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
  test('公式：≤5 為 0；第 6 關 12%（brief 隱藏層登場）；第 10 關 15%；第 11 關 15.8%；第 30 關 31%；上限 65%', () => {
    assert.equal(hiddenRatio(5), 0);
    assert.ok(Math.abs(hiddenRatio(6) - 0.12) < 1e-9);
    assert.ok(Math.abs(hiddenRatio(10) - 0.15) < 1e-9);
    assert.ok(Math.abs(hiddenRatio(11) - 0.158) < 1e-9);
    assert.ok(Math.abs(hiddenRatio(30) - 0.31) < 1e-9);
    assert.equal(hiddenRatio(100), 0.65);
  });
});

describe('機制登場表', () => {
  test('固定訂單槽上限：<7 → 0，<17 → 1，<36 → 2，36+ → 3', () => {
    assert.equal(maxOrders(6), 0); assert.equal(maxOrders(7), 1); assert.equal(maxOrders(16), 1);
    assert.equal(maxOrders(17), 2); assert.equal(maxOrders(35), 2); assert.equal(maxOrders(36), 3);
  });
  test('關卡表 40 關全部冇提早出現機制', () => {
    CAMPAIGN.forEach((cfg, i) => {
      const v = gatingViolations(i + 1, cfg);
      assert.deepEqual(v, [], `L${i + 1} ${cfg.title}: ${v.join(', ')}`);
    });
  });
  test('登場表數值', () => {
    assert.deepEqual(UNLOCK_LEVEL, { undo: 5, frosted: 6, orders: 7, takeaway: 6, adEmptyCup: 11, moveLimit: 12, hint: 14, cracked: 15, secondOrder: 17, adOrderSlot: 17, covered: 19, thirdOrder: 36 });
  });
  test('登場：L1–3 教學 2 隻空瓶、L4 起 1 隻；第 6 關首次磨砂 + 曲頸瓶；第 12 關首次限步；第 15 關裂瓶；第 19 關布遮瓶（campaign.json 實際盤面）', () => {
    const d = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
    const { decodeBoard } = decodeMod;
    const board = id => decodeBoard(d.levels[id - 1].board);
    const kinds = id => board(id).cups.map(c => c.kind);
    const empties = id => board(id).cups.filter(c => c.seg.length === 0).length;
    for (let id = 1; id <= 3; id++) assert.equal(empties(id), 2, `L${id} empties`);
    for (let id = 4; id <= 40; id++) assert.equal(empties(id), 1, `L${id} empties`);
    for (let id = 1; id <= 5; id++) { assert.ok(!kinds(id).includes('frosted'), `L${id} frosted`); assert.ok(!kinds(id).includes('takeaway'), `L${id} takeaway`); assert.equal(d.levels[id - 1].hiddenCells, 0); }
    assert.ok(kinds(6).includes('frosted')); assert.ok(kinds(6).includes('takeaway'));
    for (let id = 1; id <= 11; id++) assert.equal(d.levels[id - 1].moveLimit, null, `L${id} limit`);
    assert.ok(d.levels[11].moveLimit > 0);
    for (let id = 1; id <= 14; id++) assert.ok(!kinds(id).includes('cracked'), `L${id} cracked`);
    assert.ok(kinds(15).includes('cracked'));
    for (let id = 1; id <= 18; id++) assert.ok(!kinds(id).includes('covered'), `L${id} covered`);
    assert.ok(kinds(19).includes('covered'));
    for (const l of d.levels) for (const c of decodeBoard(l.board).cups) { assert.ok(c.kind !== 'sealed'); assert.equal(c.hidden, undefined); }
  });
});
