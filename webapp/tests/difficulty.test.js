// tests/difficulty.test.js — 工單 #5：步數上限、隱藏密度、機制登場表，以及生成器有冇真係讀呢啲參數
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeMoveLimit, hiddenRatio, maxOrders, gatingViolations, UNLOCK_LEVEL } from '../src/core/difficulty.js';
import { CAMPAIGN } from '../src/core/levels.js';
import { makeCup, makeBoard, encodeBoard } from '../src/core/board.js';
import { LocalServer, MIN_MS_PER_MOVE } from '../src/client/local-server.js';
import { solve } from '../src/core/solver.js';

describe('步數上限', () => {
  test('公式：≤10 無上限；11–20 +12；21–30 +10；31–40 +8；41+ +6', () => {
    assert.equal(computeMoveLimit(1, 5), null);
    assert.equal(computeMoveLimit(10, 9), null);
    assert.equal(computeMoveLimit(11, 10), 22);
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
  test('公式：≤10 為 0；第 11 關 15.8%；第 30 關 31%；上限 65%', () => {
    assert.equal(hiddenRatio(10), 0);
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
    assert.deepEqual(UNLOCK_LEVEL, { orders: 7, undo: 5, frosted: 11, hint: 14, secondOrder: 17, sealed: 19, covered: 25, adEmptyCup: 11, adOrderSlot: 17, thirdOrder: 36 });
  });
});
