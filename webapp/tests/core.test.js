// tests/core.test.js — §8 測試套件（node --test）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeCup, makeBoard, encodeBoard, decodeBoard, encodeMoves, decodeMoves, mask, countSegments } from '../src/core/board.js';
import { canPour, applyMove, isSolved, isDead, legalMoves, IllegalMoveError } from '../src/core/rules.js';
import { heuristic, solve, solveEx, canonical } from '../src/core/solver.js';
import { generateLevelEx, colorSafe, randomFill, pickColors } from '../src/core/generator.js';
import { CAMPAIGN, PRACTICE } from '../src/core/levels.js';
import { mulberry32 } from '../src/core/prng.js';
import { LocalServer, rhythmRisk, MIN_MS_PER_MOVE } from '../src/client/local-server.js';

const B = (cups, colors, orders = []) => makeBoard(cups, colors, orders);
const N = (seg) => makeCup('normal', seg);

describe('rules', () => {
  test('拒絕倒入已滿杯', () => {
    const b = B([N([1, 1, 1, 2]), N([2, 2, 2, 2])], 2);
    assert.equal(canPour(b, 0, 1), false);
  });
  test('拒絕不同色相疊', () => {
    const b = B([N([1, 2]), N([3])], 3);
    assert.equal(canPour(b, 0, 1), false);
    assert.throws(() => applyMove(b, { from: 0, to: 1 }), IllegalMoveError);
  });
  test('拒絕操作封膜杯', () => {
    const b = B([makeCup('sealed', [1, 2], true), N([2]), N([])], 2);
    assert.equal(canPour(b, 0, 2), false);
    assert.equal(canPour(b, 1, 0), false);
  });
  test('部分倒出時來源保留餘量', () => {
    const b = B([N([2, 1, 1, 1]), N([3, 3, 1])], 3);
    const n = applyMove(b, { from: 0, to: 1 });
    assert.deepEqual(n.cups[0].seg, [2, 1, 1]);
    assert.deepEqual(n.cups[1].seg, [3, 3, 1, 1]);
    assert.equal(n.moveCount, 1);
  });
  test('倒空 frosted 杯後降級為 normal', () => {
    const b = B([makeCup('frosted', [1, 1]), N([1]), N([])], 1);
    const n = applyMove(b, { from: 0, to: 1 });
    assert.equal(n.cups[0].kind, 'normal');
    assert.equal(n.cups[0].seg.length, 0);
  });
  test('外帶杯 cap 為 3 且永不可純色滿', () => {
    const t = makeCup('takeaway', [1, 1, 1]);
    assert.equal(t.cap, 3);
    const b = B([t, N([1]), N([])], 1);
    assert.equal(isSolved(b), false);           // 外帶杯裝滿都唔算完成
    const n = applyMove(b, { from: 0, to: 1 });
    assert.equal(isSolved(n), true);            // 倒返落 normal 杯先算
  });
  test('一步同時完成兩單訂單時兩單皆結算', () => {
    // 倒液後杯 1 完成（紅）；同時杯 2 本來已滿但係封膜杯，交付第 2 單後解封… 呢度測純粹雙結算：
    // 杯 0: [1,1,1] + 杯 3 頂 1 → 完成；杯 2: [2,2,2,2] 已經係純色滿杯但未被結算（初始狀態），倒液後 settle 一併結算
    const b = B([N([1, 1, 1]), N([]), N([2, 2, 2, 2]), N([3, 1])], 3, [1, 2]);
    const n = applyMove(b, { from: 3, to: 0 });
    assert.equal(n.delivered, 2);
    assert.ok(n.orders.every(o => o.filled));
    assert.deepEqual(n.cups[0].seg, []);
    assert.deepEqual(n.cups[2].seg, []);
  });
  test('交付 2 單後自動解封一隻封膜杯', () => {
    const b = B([N([1, 1, 1]), N([1]), N([2, 2, 2]), N([2]), makeCup('sealed', [3, 3, 3, 4], true), N([])], 4, [1, 2]);
    let n = applyMove(b, { from: 1, to: 0 });
    assert.equal(n.delivered, 1);
    assert.equal(n.cups[4].locked, true);
    n = applyMove(n, { from: 3, to: 2 });
    assert.equal(n.delivered, 2);
    assert.equal(n.cups[4].locked, false);
    assert.equal(n.cups[4].kind, 'normal');
  });
  test('解封觸發嘅連鎖結算正確', () => {
    // 封膜杯本身係純色滿杯且被點單：解封即時交付（第 3 單），delivered = 3
    const b = B([N([1, 1, 1]), N([1]), N([2, 2, 2]), N([2]), makeCup('sealed', [3, 3, 3, 3], true), N([])], 3, [1, 2, 3]);
    let n = applyMove(b, { from: 1, to: 0 });
    n = applyMove(n, { from: 3, to: 2 });
    assert.equal(n.delivered, 3);
    assert.ok(n.orders.every(o => o.filled));
    assert.deepEqual(n.cups[4].seg, []);
    assert.equal(isSolved(n), true);
  });
  test('已完成純色滿杯唔准再動', () => {
    const b = B([N([1, 1, 1, 1]), N([])], 1);
    assert.equal(canPour(b, 0, 1), false);
  });
});

describe('board encoding', () => {
  test('encode/decode 盤面 round-trip（含 frosted / sealed / takeaway / 訂單）', () => {
    const b = B([makeCup('frosted', [1, 2]), makeCup('sealed', [3, 3, 4, 5], true), makeCup('takeaway', [6]), N([]), N([7, 8, 9, 10])], 10, [1, 3]);
    b.orders[1].filled = true; b.delivered = 1; b.moveCount = 300;
    const d = decodeBoard(encodeBoard(b));
    assert.deepEqual(d, b);
  });
  test('encode/decode 走步 round-trip', () => {
    const m = [{ from: 0, to: 15 }, { from: 7, to: 3 }, { from: 12, to: 12 }];
    assert.deepEqual(decodeMoves(encodeMoves(m)), m);
  });
  test('mask 只露出磨砂杯頂格；revealed 集合可補露', () => {
    const b = B([makeCup('frosted', [1, 2, 3]), N([4])], 4);
    const m = mask(b);
    assert.deepEqual(m.cups[0].seg, [null, null, 3]);
    assert.deepEqual(m.cups[1].seg, [4]);
    const m2 = mask(b, new Set(['0:1']));
    assert.deepEqual(m2.cups[0].seg, [null, 2, 3]);
  });
});

// 小盤面 BFS 最優步（用嚟驗證 heuristic 同 solver）
function bfsOptimal(start, cap = 200000) {
  const seen = new Set([canonical(start)]);
  let frontier = [start];
  for (let d = 0; frontier.length; d++) {
    const next = [];
    for (const b of frontier) {
      if (isSolved(b)) return d;
      for (const m of legalMoves(b)) {
        const nb = applyMove(b, m);
        const k = canonical(nb);
        if (seen.has(k)) continue;
        seen.add(k);
        if (seen.size > cap) return null;
        next.push(nb);
      }
    }
    frontier = next;
  }
  return null;
}

function randomSmallBoard(rng) {
  const colors = 2 + Math.floor(rng() * 2);       // 2–3 色
  const cups = colors + 1 + Math.floor(rng() * 2); // 1–2 空杯
  const pool = [];
  for (let c = 0; c < colors; c++) for (let i = 0; i < 4; i++) pool.push(c + 1);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const segs = Array.from({ length: cups }, () => []);
  for (const v of pool) {
    // 隨機揀一隻未滿嘅杯（偏向前面嘅杯，令部分杯留空）
    let k = Math.floor(rng() * cups * 0.8);
    let guard = 0;
    while (segs[k].length >= 4 && guard++ < cups) k = (k + 1) % cups;
    if (segs[k].length >= 4) k = segs.findIndex(s => s.length < 4);
    segs[k].push(v);
  }
  const orders = rng() < 0.4 ? [1] : [];
  return makeBoard(segs.map(s => makeCup(rng() < 0.15 && s.length <= 3 ? 'takeaway' : 'normal', s)), colors, orders);
}

describe('solver', () => {
  test('heuristic 從不高估：隨機 3000 局，h ≤ 實際最優步', () => {
    const rng = mulberry32(7);
    let checked = 0;
    for (let i = 0; i < 3000; i++) {
      const b = randomSmallBoard(rng);
      const opt = bfsOptimal(b, 50000);
      if (opt === null) continue;
      assert.ok(heuristic(b) <= opt, `h=${heuristic(b)} > opt=${opt} for ${encodeBoard(b)}`);
      checked++;
    }
    assert.ok(checked > 500);
  });
  test('IDA* 解長度等於 BFS 最優（隨機 400 局）', () => {
    const rng = mulberry32(99);
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const b = randomSmallBoard(rng);
      const opt = bfsOptimal(b, 50000);
      if (opt === null) continue;
      const sol = solve(b, 30);
      assert.ok(sol, 'solver returned null on solvable board ' + encodeBoard(b));
      assert.equal(sol.length, opt, `IDA* ${sol.length} vs BFS ${opt} for ${encodeBoard(b)}`);
      // 解可以重放
      let s = b; for (const m of sol) s = applyMove(s, m);
      assert.ok(isSolved(s));
      checked++;
    }
    assert.ok(checked > 100);
  });
  test('已解狀態回傳空解', () => {
    const b = B([N([1, 1, 1, 1]), N([])], 1);
    assert.deepEqual(solve(b), []);
  });
  test('死局回傳 null', () => {
    const b = B([N([1, 2, 1, 2]), N([2, 1, 2, 1])], 2);   // 冇空杯，頂色不同 → 死局
    assert.equal(isDead(b), true);
    assert.equal(solve(b, 20), null);
  });
  test('node 預算超出時回報 aborted', () => {
    const b = B([N([1, 2, 3, 4]), N([4, 3, 2, 1]), N([1, 2, 3, 4]), N([4, 3, 2, 1]), N([]), N([])], 4);
    const r = solveEx(b, 40, 2);
    assert.equal(r.aborted, true);
    assert.equal(r.moves, null);
  });
});

describe('generator', () => {
  test('生成 30 關全部可解、段數落喺目標 ±1、全部通過色盲檢查', () => {
    const cfg = CAMPAIGN[6];   // 8 杯 6 色
    for (let seed = 1; seed <= 30; seed++) {
      const r = generateLevelEx(cfg, seed * 1013, { maxAttempts: 200 });
      assert.ok(r, 'generate failed for seed ' + seed);
      assert.ok(Math.abs(countSegments(r.board) - cfg.segments) <= 1);
      assert.ok(colorSafe(r.board));
      let s = r.board; for (const m of r.solution) s = applyMove(s, m);
      assert.ok(isSolved(s));
      assert.ok(r.optimal >= cfg.optimalMin && r.optimal <= cfg.optimalMax);
    }
  });
  test('相同 seed 產生完全相同盤面（client/server 一致性）', () => {
    const cfg = CAMPAIGN[9];
    const a = generateLevelEx(cfg, 424242), b = generateLevelEx(cfg, 424242);
    assert.ok(a && b);
    assert.equal(encodeBoard(a.board), encodeBoard(b.board));
    assert.equal(a.optimal, b.optimal);
  });
  test('pickColors 揀 10 色都滿足 L* 差 ≥ 8 及避開高危組合', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 20; i++) {
      const cs = pickColors(10, rng);
      assert.ok(cs && cs.length === 10);
      assert.ok(colorSafe(B(cs.map(c => N([c])), 10)));
    }
  });
  test('練習難度 config 全部可生成', () => {
    for (const cfg of Object.values(PRACTICE)) assert.ok(generateLevelEx(cfg, 777, { maxAttempts: 300 }), cfg.title);
  });
});

describe('server', () => {
  const mkLevel = () => {
    const r = generateLevelEx(CAMPAIGN[3], 555);
    return { level: { id: 4, board: encodeBoard(r.board), optimal: r.optimal, thresholds: r.thresholds, publicSeed: 'v1:c:4:test:0000' }, solution: r.solution };
  };
  test('偽造盤面被拒：client 傳嘅盤面唔會被採用，只信 session 真實盤面 + 走步', () => {
    const { level } = mkLevel();
    const srv = new LocalServer();
    const st = srv.start(level);
    // client 話「我已經解咗」但走步序列係空 → NOT_SOLVED
    const res = srv.complete(st.sessionId, { moves: [], moveTimestamps: [] });
    assert.equal(res.verified, false);
    assert.equal(res.reason, 'NOT_SOLVED');
  });
  test('非法走步序列被拒', () => {
    const { level } = mkLevel();
    const srv = new LocalServer();
    const st = srv.start(level);
    const res = srv.complete(st.sessionId, { moves: [{ from: 0, to: 0 }], moveTimestamps: [] });
    assert.equal(res.reason, 'ILLEGAL_MOVE');
  });
  test('未解狀態提交被拒', () => {
    const { level, solution } = mkLevel();
    const srv = new LocalServer();
    const st = srv.start(level);
    const res = srv.complete(st.sessionId, { moves: solution.slice(0, -1), moveTimestamps: [] });
    assert.equal(res.reason, 'NOT_SOLVED');
  });
  test('步數 < MIN_MS 被標記 TOO_FAST；等夠時間就 verified', async () => {
    const { level, solution } = mkLevel();
    const srv = new LocalServer();
    const st = srv.start(level);
    const fast = srv.complete(st.sessionId, { moves: solution, moveTimestamps: [] });
    assert.equal(fast.reason, 'TOO_FAST');
    // 倒撥 startedAt 模擬真人用時
    srv.sessions.get(st.sessionId).startedAt -= solution.length * MIN_MS_PER_MOVE + 1000;
    const ok = srv.complete(st.sessionId, { moves: solution, moveTimestamps: [] });
    assert.equal(ok.verified, true);
    assert.equal(ok.stars, 3);
  });
  test('reveal 只露出磨砂杯新頂格，唔會下發隱藏層', () => {
    const b = B([makeCup('frosted', [1, 2, 2]), N([2]), N([])], 2);
    const srv = new LocalServer();
    const st = srv.start({ id: 't', board: encodeBoard(b), optimal: 3, thresholds: { three: 6, two: 11 } });
    assert.deepEqual(st.maskedBoard.cups[0].seg, [null, null, 2]);
    const r = srv.reveal(st.sessionId, [{ from: 0, to: 1 }]);
    assert.deepEqual(r.maskedBoard.cups[0].seg, [1]);     // 倒走 2 格 2 → 露出 1
    assert.deepEqual(r.maskedBoard.cups[1].seg, [2, 2, 2]);
  });
  test('等間隔走步 rhythmRisk > 70', () => {
    const ts = Array.from({ length: 20 }, (_, i) => 200 + i * 230);
    assert.ok(rhythmRisk(ts) > 70, String(rhythmRisk(ts)));
  });
  test('模擬真人節奏（隨機停頓）rhythmRisk < 30', () => {
    const rng = mulberry32(2024);
    for (let k = 0; k < 50; k++) {
      const ts = []; let t = 800 + rng() * 2000;
      for (let i = 0; i < 25; i++) { ts.push(Math.round(t)); t += 400 + rng() * 1800 + (rng() < 0.2 ? 3000 * rng() : 0); }
      assert.ok(rhythmRisk(ts) < 30, `game ${k} risk ${rhythmRisk(ts)}`);
    }
  });
});
