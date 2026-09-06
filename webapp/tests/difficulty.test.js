// tests/difficulty.test.js — 工單 #5：步數上限、隱藏密度、機制登場表，以及生成器有冇真係讀呢啲參數
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeMoveLimit, hiddenRatio, maxOrders, gatingViolations, UNLOCK_LEVEL } from '../src/core/difficulty.js';
import { CAMPAIGN, bottlesPerColorFor, emptiesFor } from '../src/core/levels.js';
import { makeCup, makeBoard, encodeBoard } from '../src/core/board.js';
import * as decodeMod from '../src/core/board.js';
import { LocalServer, MIN_MS_PER_MOVE } from '../src/client/local-server.js';
import { solve } from '../src/core/solver.js';

describe('步數上限', () => {
  test('公式：≤11 無上限（brief 第 12 關先限步）；餘量加喺 2★ 門檻之上；12–20 +12；21–30 +10；31–40 +8；41–55 +7；56–70 +6；71+ +5', () => {
    assert.equal(computeMoveLimit(1, 5), null);
    assert.equal(computeMoveLimit(11, 9), null);
    assert.equal(computeMoveLimit(12, 10), 22);
    assert.equal(computeMoveLimit(20, 18), 30);
    assert.equal(computeMoveLimit(21, 18), 28);
    assert.equal(computeMoveLimit(30, 20), 30);
    assert.equal(computeMoveLimit(40, 29), 37);
    assert.equal(computeMoveLimit(41, 30), 37);
    assert.equal(computeMoveLimit(56, 30), 36);
    assert.equal(computeMoveLimit(71, 30), 35);
    // 用戶 2026-09-07：L30 行到 58 步就死，但 2★ 門檻係 68 —— 上限唔可以低過 2★ 門檻
    assert.equal(computeMoveLimit(30, 48, 68), 78);
    assert.ok(computeMoveLimit(30, 48, 68) > 68);
  });
  test('campaign.json 每關都寫咗 moveLimit，同公式一致', () => {
    const d = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
    for (const l of d.levels) {
      assert.equal(l.moveLimit, computeMoveLimit(l.id, l.optimal, l.thresholds.two), `L${l.id}`);
      if (l.moveLimit !== null) assert.ok(l.moveLimit > l.thresholds.two, `L${l.id} 上限要高過 2★ 門檻`);
    }
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
  test('公式（2026-09-06 對齊參考遊戲）：L1 0；L2 30%；L3 35%；L4 40%；L5 起 45% + 每關 3%，L14 到上限 72%', () => {
    assert.equal(hiddenRatio(1), 0);
    assert.ok(Math.abs(hiddenRatio(2) - 0.30) < 1e-9); assert.ok(Math.abs(hiddenRatio(3) - 0.35) < 1e-9);
    assert.ok(Math.abs(hiddenRatio(4) - 0.40) < 1e-9);
    // 用戶 2026-09-06「唔好去到咁後先加強」：L5 起每關 +3%
    assert.ok(Math.abs(hiddenRatio(5) - 0.45) < 1e-9);
    assert.ok(Math.abs(hiddenRatio(10) - 0.60) < 1e-9);
    // 參考遊戲 L42/L43：幾乎每隻樽只露頂一格，密度約 65–75% —— 難度主要嚟自「睇唔到」
    assert.ok(Math.abs(hiddenRatio(12) - 0.66) < 1e-9);
    assert.equal(hiddenRatio(14), 0.72);
    assert.equal(hiddenRatio(100), 0.72);   // 上限：頂格永遠可見，滿樽最多遮 3/4
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
    assert.deepEqual(UNLOCK_LEVEL, { hidden: 2, adBottle: 2, orders: 1, adEmptyCup: 11, moveLimit: 12, secondOrder: 3, adOrderSlot: 11, covered: 13 });   // 提示 / 撤銷 2026-09-06 拎走
  });
  test('登場：空樽 L1–12 兩隻 / L13 起一隻（自由格 = 空樽 × 4，難度唯一有效桿）、真樽 = 色數 × 每色樽數 + 空樽；L2 起 `?` 樽 + 廣告樽（L2 兩隻）；全部 capacity 4；第 12 關限步；第 19 關布遮樽（campaign.json 實際盤面）', () => {
    const d = JSON.parse(readFileSync(new URL('../levels/campaign.json', import.meta.url), 'utf8'));
    const { decodeBoard } = decodeMod;
    const board = id => decodeBoard(d.levels[id - 1].board);
    const kinds = id => board(id).cups.map(c => c.kind);
    const empties = id => board(id).cups.filter(c => c.seg.length === 0).length;
    const empties2 = id => board(id).cups.filter(c => c.seg.length === 0 && c.kind === 'normal').length;
    const ads = id => board(id).cups.filter(c => c.kind === 'ad').length;
    // 用戶 2026-09-06：自由格數係難度唯一有效桿（實測同一盤面 8 格 → 致命錯步 0–15%、4 格 → 78–98%）。
    // L1–12 兩隻空樽（學規則），L13 起一隻。L13 起用倒推生成，自由格會散落喺唔同樽頂，
    // 所以驗嘅係「自由格總數」，唔係「有幾多隻樽係全空」。
    for (let id = 1; id <= CAMPAIGN.length; id++) {
      const b = board(id);
      const real = b.cups.filter(c => c.kind !== 'ad');
      const bpc = bottlesPerColorFor(id);
      const free = real.reduce((a, c) => a + (4 - c.seg.length), 0);
      assert.equal(real.length, b.colors * bpc + emptiesFor(id), `L${id} 真樽 = 色數 × ${bpc} + 空樽`);
      assert.equal(free, emptiesFor(id) * 4, `L${id} 自由格 = 空樽 × 4`);
      assert.equal(real.reduce((a, c) => a + c.seg.length, 0), b.colors * 4 * bpc, `L${id} 液體格數`);
    }
    assert.equal(kinds(1).includes('hidden'), false); assert.equal(ads(1), 0); assert.equal(d.levels[0].hiddenCells, 0);
    assert.ok(kinds(2).includes('hidden'), 'L2 `?`'); assert.equal(ads(2), 2, 'L2 兩隻廣告樽');
    for (let id = 2; id <= CAMPAIGN.length; id++) assert.ok(ads(id) >= 1, `L${id} ad`);
    for (let id = 1; id <= 11; id++) assert.equal(d.levels[id - 1].moveLimit, null, `L${id} limit`);
    assert.ok(d.levels[11].moveLimit > 0);
    for (let id = 1; id <= 12; id++) assert.ok(!kinds(id).includes('covered'), `L${id} covered`);
    assert.ok(kinds(13).includes('covered'));   // 2026-09-06 由 L19 提前到 L13
    for (const l of d.levels) for (const c of decodeBoard(l.board).cups) { assert.equal(c.cap, 4, `L${l.id} capacity 4`); assert.ok(!['takeaway', 'cracked', 'sealed'].includes(c.kind), `L${l.id} ${c.kind}`); }
  });
});
