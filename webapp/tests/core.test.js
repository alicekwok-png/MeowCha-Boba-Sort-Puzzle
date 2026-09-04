// tests/core.test.js — §8 測試套件（node --test）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeCup, makeBoard, encodeBoard, decodeBoard, encodeMoves, decodeMoves, mask, countSegments } from '../src/core/board.js';
import { canPour, applyMove, isSolved, isDead, legalMoves, IllegalMoveError } from '../src/core/rules.js';
import { heuristic, solve, solveEx, canonical } from '../src/core/solver.js';
import { generateLevelEx, colorSafe, randomFill, pickColors } from '../src/core/generator.js';
import { CAMPAIGN, PRACTICE } from '../src/core/levels.js';
import { mulberry32 } from '../src/core/prng.js';
import { PALETTE, isExclusive, colorsCompatible, hueDist, BY_KEY, MAX_COLORS_BY_HUE } from '../src/core/palette.js';
import { readFileSync } from 'node:fs';
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

describe('palette', () => {
  test('色板 id 連續、hex 全部有效、campaign 所有格都有對應顏色（冇 undefined）', () => {
    PALETTE.forEach((p, i) => { assert.equal(p.id, i); assert.match(p.hex, /^#[0-9A-F]{6}$/); assert.ok(p.L > 0 && p.L < 100); });
    const d = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
    for (const l of d.levels) for (const c of decodeBoard(l.board).cups) for (const v of c.seg) assert.ok(PALETTE[v] && PALETTE[v].hex, `L${l.id} colour id ${v} has no hex`);
  });
  test('夜市 brief A3 互斥對：A↔B、C↔D、E↔F、G↔H、B↔D 禁止；J 奶蓋白同任何色都安全', () => {
    const K = BY_KEY;
    for (const [x, y] of [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H'], ['B', 'D']]) assert.ok(isExclusive(K[x], K[y]), `${x}↔${y}`);
    assert.ok(!isExclusive(K.F, K.H), 'F↔H 係慎用，唔係禁止');
    for (const p of PALETTE) if (p.key !== 'J') assert.ok(!isExclusive(K.J, p.id), 'J vs ' + p.key);
    assert.equal(hueDist(K.A, K.B), 24); assert.equal(hueDist(K.C, K.D), 20); assert.equal(hueDist(K.F, K.H), 37);
  });
  test('F×H 只可以喺 ≤4 色關同關', () => {
    const K = BY_KEY;
    assert.ok(colorsCompatible([K.F, K.H, K.A, K.I]));
    assert.ok(!colorsCompatible([K.F, K.H, K.A, K.I, K.J]));
  });
  test('純靠顏色最多 6 色同關：pickColors(6) 一定得，pickColors(7) 一定唔得', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 20; i++) { const cs = pickColors(6, rng); assert.ok(cs && cs.length === 6); assert.ok(colorSafe(B(cs.map(c => N([c])), 6))); }
    assert.equal(pickColors(7, rng), null);
    assert.equal(MAX_COLORS_BY_HUE, 6);
  });
  test('第 1–12 關色組照 brief A4 分配表', () => {
    const want = ['AG', 'AGC', 'IEB', 'AGCI', 'BHEJ', 'AGDI', 'AGCIF', 'BHEIJ', 'AGDFI', 'BHCIJ', 'AGCIFJ', 'BHEIJC'];
    const d = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
    want.forEach((keys, i) => {
      const ids = keys.split('').map(k => BY_KEY[k]).sort();
      assert.deepEqual([...CAMPAIGN[i].palette].sort(), ids, `L${i + 1} 表`);
      const used = [...new Set(decodeBoard(d.levels[i].board).cups.flatMap(c => c.seg))].sort();
      assert.deepEqual(used, ids, `L${i + 1} 生成盤面`);
    });
  });
  test('40 關每關色組都符合互斥規則且 ≤ 6 色', () => {
    const d = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
    for (const l of d.levels) {
      const used = [...new Set(decodeBoard(l.board).cups.flatMap(c => c.seg))];
      assert.ok(used.length <= MAX_COLORS_BY_HUE, `L${l.id} ${used.length} colours`);
      assert.ok(colorsCompatible(used), `L${l.id} exclusive pair`);
    }
  });
});

describe('board encoding', () => {
  test('encode/decode 盤面 round-trip（含 frosted / sealed / takeaway / 隱藏層 / 訂單）', () => {
    const b = B([makeCup('frosted', [1, 2]), makeCup('sealed', [3, 3, 4, 5], true), makeCup('takeaway', [6]), N([]), makeCup('normal', [7, 8, 9, 10], false, 3), makeCup('covered', [1, 2], true)], 10, [1, 3]);
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
  test('隱藏層：普通杯底部 hidden 格為 null，頂格永遠可見；倒空後 hidden 清零', () => {
    const b = B([makeCup('normal', [1, 2, 3, 4], false, 2), makeCup('normal', [5, 6], false, 3), makeCup('covered', [7, 8], true), N([])], 8);
    const m = mask(b);
    assert.deepEqual(m.cups[0].seg, [null, null, 3, 4]);
    assert.deepEqual(m.cups[1].seg, [null, 6]);       // hidden 3 但只得 2 格：頂格照樣可見
    assert.deepEqual(m.cups[2].seg, [null, null]);     // 布遮杯連頂格都隱藏
    assert.equal(m.cups[0].hidden, 2);
    const one = B([makeCup('normal', [1], false, 1), N([])], 1);
    assert.equal(applyMove(one, { from: 0, to: 1 }).cups[0].hidden, 0);
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
  test('7 色 config 直接被 validateConfig 拒絕（要等 P3 圖案系統）', () => {
    assert.throws(() => generateLevelEx({ cups: 10, colors: 7, empties: 2, segments: 21, frosted: 0, sealed: 0, takeaway: 0, orders: 0, optimalMin: 3, optimalMax: 40 }, 1), /colors > 6/);
  });
  test('隱藏層生成：有 hiddenRatio 但 frosted = 0 時，隱藏格全部落喺普通杯底部；訂單色初始可見', () => {
    const cfg = { ...CAMPAIGN[5], hiddenRatio: 0.12 };   // 第 6 關「蓋住咗」
    const r = generateLevelEx(cfg, 99);
    assert.ok(r);
    assert.ok(r.board.cups.every(c => c.kind !== 'frosted'));
    assert.ok(r.hiddenCells >= 1 && r.hiddenCells <= 3, String(r.hiddenCells));
    for (const c of r.board.cups) if (c.hidden) { assert.ok(c.kind === 'normal'); assert.ok(c.hidden <= c.seg.length - 1); }
    const m = mask(r.board);
    assert.equal(m.cups.reduce((a, c) => a + c.seg.filter(v => v === null).length, 0), r.hiddenCells);
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
  test('reveal 隱藏層：倒走頂格露出下一格，撤銷後唔會再遮返', () => {
    const b = B([makeCup('normal', [1, 2, 2], false, 2), N([2]), N([])], 2);
    const srv = new LocalServer();
    const st = srv.start({ id: 't', board: encodeBoard(b), optimal: 3, thresholds: { three: 6, two: 11 } });
    assert.deepEqual(st.maskedBoard.cups[0].seg, [null, null, 2]);
    const r = srv.reveal(st.sessionId, [{ from: 0, to: 1 }]);
    assert.deepEqual(r.maskedBoard.cups[0].seg, [1]);
    const back = srv.reveal(st.sessionId, []);          // 撤銷
    assert.deepEqual(back.maskedBoard.cups[0].seg, [1, 2, 2]);   // 第 0 格曾經做過頂格、第 1 格已經倒出過（玩家見到係 2）→ 全部永久露出
    const b2 = B([makeCup('normal', [1, 3, 2], false, 2), N([2]), N([])], 3);
    const st2 = srv.start({ id: 't', board: encodeBoard(b2), optimal: 3, thresholds: { three: 6, two: 11 } });
    srv.reveal(st2.sessionId, [{ from: 0, to: 1 }]);
    assert.deepEqual(srv.reveal(st2.sessionId, []).maskedBoard.cups[0].seg, [null, 3, 2]);   // 只倒走 1 格 → 第 1 格露出，第 0 格仍然隱藏
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
