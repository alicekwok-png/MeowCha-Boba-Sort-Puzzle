// tests/orders.test.js — 工單 #4 任務 3：廣告解鎖訂單槽（server 端）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeCup, makeBoard, encodeBoard } from '../src/core/board.js';
import { applyMove, isSolved } from '../src/core/rules.js';
import { solve } from '../src/core/solver.js';
import { LocalServer, MIN_MS_PER_MOVE } from '../src/client/local-server.js';

const N = (seg) => makeCup('normal', seg);
const level = (board, id = 20) => ({ id, board: encodeBoard(board), optimal: solve(board, 30).length, thresholds: { three: 30, two: 40 } });

describe('廣告訂單槽', () => {
  test('新訂單顏色一定係板面上未完成、未被點嘅色', () => {
    // 色 1 已經係純色滿杯；色 2 已有訂單；只剩色 3 可以加
    const b = makeBoard([N([1, 1, 1, 1]), N([2, 2, 3]), N([3, 3, 3, 2]), N([2]), N([])], 3, [2]);
    const srv = new LocalServer();
    const st = srv.start(level(b));
    const r = srv.addOrder(st.sessionId, [], () => 0.99);
    assert.equal(r.ok, true);
    assert.equal(r.color, 3);
    assert.equal(r.maskedBoard.orders.length, 2);
    // 再加：冇未完成色可揀 → 拒絕，唔會亂加
    assert.equal(srv.addOrder(st.sessionId, []).ok, false);
  });

  test('解鎖後嘅訂單喺 complete() 重放時同一步插入，交付結果一致，驗證通過', () => {
    const b = makeBoard([N([1, 1, 1]), N([2, 2, 2]), N([2, 1]), N([])], 2, []);
    const srv = new LocalServer();
    const st = srv.start(level(b));
    // 第 1 步先，再解鎖（atMove = 1），揀到色 1 或 2 都得
    const m1 = { from: 2, to: 3 };            // 1 → 空杯
    srv.reveal(st.sessionId, [m1]);
    const r = srv.addOrder(st.sessionId, [m1], () => 0);
    assert.equal(r.ok, true);
    const color = r.color;
    // client 用 server 畀嘅盤面繼續玩到完
    let board = r.maskedBoard;
    const moves = [m1];
    const rest = solve(board, 20);
    assert.ok(rest, 'still solvable after extra order');
    for (const m of rest) { board = applyMove(board, m); moves.push(m); }
    assert.ok(isSolved(board));
    assert.ok(board.orders.find(o => o.color === color).filled, 'extra order delivered');
    srv.sessions.get(st.sessionId).startedAt -= moves.length * MIN_MS_PER_MOVE + 1000;
    const res = srv.complete(st.sessionId, { moves, moveTimestamps: [] });
    assert.equal(res.verified, true, res.reason);
  });

  test('撤銷到解鎖之前，訂單仍然存在（當關有效），server 同 client 盤面一致', () => {
    const b = makeBoard([N([1, 1, 1]), N([2, 2, 2]), N([2, 1]), N([])], 2, []);
    const srv = new LocalServer();
    const st = srv.start(level(b));
    const m1 = { from: 2, to: 3 };
    srv.reveal(st.sessionId, [m1]);
    const r = srv.addOrder(st.sessionId, [m1], () => 0);
    const undone = srv.reveal(st.sessionId, []);             // 撤銷第 1 步
    assert.equal(undone.maskedBoard.orders.length, 1);
    assert.equal(undone.maskedBoard.orders[0].color, r.color);
    assert.equal(undone.maskedBoard.cups[3].seg.length, 0);   // 走步真係撤銷咗
  });
});
