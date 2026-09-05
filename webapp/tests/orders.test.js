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
  test('新委託顏色一定係板面上未被點嘅色（v4：已封樽嘅色都可以點，點咗即刻飛走）', () => {
    // 色 2 已有委託；色 1 係已封樽（純色滿）、色 3 未完成 → 兩者都可以加；加色 1 會即刻交貨飛走
    const b = makeBoard([N([1, 1, 1, 1]), N([2, 2, 3]), N([3, 3, 3, 2]), N([2]), N([])], 3, [2]);
    const srv = new LocalServer();
    const st = srv.start(level(b));
    const r = srv.addOrder(st.sessionId, [], () => 0.99);
    assert.equal(r.ok, true);
    assert.ok([1, 3].includes(r.color));
    assert.equal(r.maskedBoard.orders.length, 2);
    if (r.color === 1) assert.equal(r.maskedBoard.cups[0].kind, 'gone');
    const r2 = srv.addOrder(st.sessionId, [], () => 0.99);
    assert.equal(r2.ok, true);
    // 再加：三色都點晒 → 拒絕，唔會亂加
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

describe('廣告加空瓶（Spec v2 §6 addEmptyBottle）', () => {
  test('加咗一隻空燒瓶：盤面多一隻 normal 空瓶，之後嘅走步可以用佢，complete() 重放驗證通過', () => {
    const b = makeBoard([N([1, 1, 1]), N([2, 2, 2]), N([2, 1]), N([])], 2, []);
    const srv = new LocalServer();
    const st = srv.start(level(b));
    const r = srv.addEmptyCup(st.sessionId, []);
    assert.equal(r.ok, true);
    assert.equal(r.maskedBoard.cups.length, 5);
    assert.deepEqual(r.maskedBoard.cups[4], { kind: 'normal', cap: 4, locked: false, seg: [] });
    // 用新瓶（index 4）：瓶 2 = [2,1]（頂係 1）→ 1 落新瓶、2 落原本空瓶，再各自倒滿 → 兩色完成
    const moves = [{ from: 2, to: 4 }, { from: 2, to: 3 }, { from: 0, to: 4 }, { from: 1, to: 3 }];
    srv.sessions.get(st.sessionId).startedAt -= moves.length * MIN_MS_PER_MOVE + 1000;
    const res = srv.complete(st.sessionId, { moves, moveTimestamps: [] });
    assert.equal(res.verified, true, res.reason);
  });
  test('撤銷到加瓶之前：空瓶仍然存在（當關有效），server 同 client 盤面一致', () => {
    const b = makeBoard([N([1, 1, 1]), N([2, 2, 2]), N([2, 1]), N([])], 2, []);
    const srv = new LocalServer();
    const st = srv.start(level(b));
    srv.reveal(st.sessionId, [{ from: 2, to: 3 }]);
    const r = srv.addEmptyCup(st.sessionId, [{ from: 2, to: 3 }]);   // atMove = 1
    assert.equal(r.ok, true);
    const back = srv.reveal(st.sessionId, []);                         // 撤銷第 1 步
    assert.equal(back.maskedBoard.cups.length, 5);
    assert.deepEqual(back.maskedBoard.cups[4].seg, []);
    assert.deepEqual(back.maskedBoard.cups[3].seg, []);
  });
  test('16 隻瓶封頂（走步編碼 4 bit）', () => {
    const cups = Array.from({ length: 16 }, (_, i) => (i < 2 ? N([1, 1]) : N([])));
    const b = makeBoard(cups, 1, []);
    const srv = new LocalServer();
    const st = srv.start({ id: 20, board: encodeBoard(b), optimal: 1, thresholds: { three: 4, two: 9 } });
    assert.equal(srv.addEmptyCup(st.sessionId, []).ok, false);
  });
});
