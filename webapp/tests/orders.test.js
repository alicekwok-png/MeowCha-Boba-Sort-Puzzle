// tests/orders.test.js — 工單 #4 任務 3：廣告解鎖訂單槽（server 端）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeCup, makeBoard, encodeBoard } from '../src/core/board.js';
import { applyMove, isSolved } from '../src/core/rules.js';
import { solve } from '../src/core/solver.js';
import { LocalServer, MIN_MS_PER_MOVE } from '../src/client/local-server.js';

const N = (seg) => makeCup('normal', seg);
const level = (board, id = 20) => ({ id, board: encodeBoard(board), optimal: solve(board, 30).length, thresholds: { three: 30, two: 40 } });

describe('廣告訂單槽（Spec v3 §3：由隊列攞下一單，當關有效）', () => {
  test('addOrder 開新槽 = 隊列下一單；隊列空就開唔到；已封樽嘅色追上即刻飛走（events 帶 deliver）', () => {
    // 色 1 已封（純色滿、冇訂單）；槽只有色 2；隊列 [1]
    const b = makeBoard([N([1, 1, 1, 1]), N([2, 2, 3]), N([3, 3, 3, 2]), N([2]), N([])], 3, [2], [1, 3]);
    const srv = new LocalServer();
    const st = srv.start(level(b));
    const r = srv.addOrder(st.sessionId, []);
    assert.equal(r.ok, true);
    assert.equal(r.color, 1);                                   // 隊列頭
    assert.ok(r.events.some(e => e.type === 'deliver' && e.color === 1), '已封樽追上 → deliver event');
    assert.equal(r.maskedBoard.cups[0].kind, 'gone');
    assert.equal(r.maskedBoard.orders.length, 2);
    assert.equal(r.slotColor, 3);                               // 交完 1 即刻補隊列下一單 3
    assert.equal(r.maskedBoard.queueLeft, 0);
    assert.equal(srv.addOrder(st.sessionId, []).ok, false);     // 隊列空
  });

  test('解鎖後嘅槽喺 complete() 重放時同一步插入，交貨結果一致，驗證通過', () => {
    const b = makeBoard([N([1, 1, 1]), N([2, 2, 2]), N([2, 1]), N([])], 2, [1], [2]);
    const srv = new LocalServer();
    const st = srv.start(level(b));
    const m1 = { from: 2, to: 3 };            // 1 → 空樽
    srv.reveal(st.sessionId, [m1]);
    const r = srv.addOrder(st.sessionId, [m1]);
    assert.equal(r.ok, true); assert.equal(r.color, 2);
    let board = r.maskedBoard;
    const moves = [m1];
    const rest = solve(board, 20);
    assert.ok(rest, 'still solvable after extra slot');
    for (const m of rest) { board = applyMove(board, m); moves.push(m); }
    assert.ok(isSolved(board));
    srv.sessions.get(st.sessionId).startedAt -= moves.length * MIN_MS_PER_MOVE + 1000;
    const res = srv.complete(st.sessionId, { moves, moveTimestamps: [] });
    assert.equal(res.verified, true, res.reason);
  });

  test('撤銷到解鎖之前，新槽仍然存在（當關有效），server 同 client 盤面一致', () => {
    const b = makeBoard([N([1, 1, 1]), N([2, 2, 2]), N([2, 1]), N([])], 2, [1], [2]);
    const srv = new LocalServer();
    const st = srv.start(level(b));
    const m1 = { from: 2, to: 3 };
    srv.reveal(st.sessionId, [m1]);
    srv.addOrder(st.sessionId, [m1]);
    const undone = srv.reveal(st.sessionId, []);             // 撤銷第 1 步
    assert.equal(undone.maskedBoard.orders.length, 2);
    assert.equal(undone.maskedBoard.queueLeft, 0);
  });

  test('隊列推進：交完貨只有嗰個槽補下一單；隊列空 → 槽收工；過關 = 隊列空 + 全部槽收工', () => {
    const b = makeBoard([N([1, 1, 1]), N([1]), N([2, 2, 2]), N([2]), N([3, 3, 3, 3]), N([])], 3, [1], [3, 2]);
    let n = applyMove(b, { from: 1, to: 0 });                 // 交 1 → 槽補 3 → 已封色 3 即刻飛走 → 槽補 2
    assert.equal(n.cups[0].kind, 'gone'); assert.equal(n.cups[4].kind, 'gone');
    assert.equal(n.orders[0].color, 2); assert.equal(n.orders[0].filled, false); assert.equal(n.queue.length, 0);
    assert.equal(isSolved(n), false);
    n = applyMove(n, { from: 3, to: 2 });                     // 交 2 → 隊列空 → 槽收工
    assert.equal(n.orders[0].filled, true);
    assert.equal(isSolved(n), true);
  });

  test('布罩：交夠 2 單一次過全開（v4.1 §5.1）', () => {
    const b = makeBoard([N([1, 1, 1]), N([1]), N([2, 2, 2]), N([2]), makeCup('covered', [3, 3, 4, 4], true), makeCup('covered', [4, 4, 3, 3], true), N([])], 4, [1, 2], [3, 4]);
    let n = applyMove(b, { from: 1, to: 0 });
    assert.ok(n.cups[4].locked && n.cups[5].locked);
    n = applyMove(n, { from: 3, to: 2 });
    assert.ok(!n.cups[4].locked && !n.cups[5].locked && n.cups[4].kind === 'normal' && n.cups[5].kind === 'normal');
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
