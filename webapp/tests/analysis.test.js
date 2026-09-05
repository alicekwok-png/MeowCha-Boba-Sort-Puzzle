// tests/analysis.test.js — 亂撳模擬（core/analysis.js）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeCup, makeBoard } from '../src/core/board.js';
import { simulateRandom, twoStarBudget } from '../src/core/analysis.js';

const N = (seg) => makeCup('normal', seg);

describe('亂撳模擬', () => {
  test('同 seed 結果可重現；budget = 最優 × 1.5 向上取整', () => {
    const b = makeBoard([N([1, 2]), N([2, 1]), N([])], 2, [1], [2]);
    const a = simulateRandom(b, { trials: 200, seed: 7, budget: 6 });
    const c = simulateRandom(b, { trials: 200, seed: 7, budget: 6 });
    assert.deepEqual(a, c);
    assert.equal(twoStarBudget(7), 11); assert.equal(twoStarBudget(8), 12);
  });
  test('一步就過關嘅盤：budget 1 之下亂撳率 = 合法走步入面正確嗰步嘅比例（≈1/合法步數）', () => {
    // 合法步：0→1（完成 1 → 交貨）、0→2、1→2、1→0？（1 頂係 1，0 頂係 1 → 合法）
    const b = makeBoard([N([1, 1, 1]), N([1]), N([])], 1, [1], []);
    const r = simulateRandom(b, { trials: 4000, seed: 3, budget: 1 });
    // 過關步：1→0（1 入 0 變 [1,1,1,1] → 交貨 → 過關）；0→1 只倒 3 格入 cap 4 嘅 [1] → [1,1,1,1] 亦過關
    assert.ok(r.rate > 0.4 && r.rate < 0.6, String(r.rate));
    assert.equal(r.dead, 0);
  });
  test('冇合法走步 = 死局', () => {
    const b = makeBoard([makeCup('covered', [1, 2], true), N([2, 1, 2, 1])], 2, [1], [2]);
    const r = simulateRandom(b, { trials: 5, seed: 1, budget: 3 });
    assert.equal(r.dead, 5); assert.equal(r.solved, 0);
  });
});
