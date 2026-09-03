// client/local-server.js — 喺瀏覽器入面模擬 server 權威層（§5）。
// 真實盤面（含磨砂杯隱藏層）只存喺呢個 class 嘅 session 入面；client 只攞到遮罩視圖。
// 換成真 server 時，只需要將呢啲方法改成 fetch('/v1/level/...')。

import { decodeBoard, encodeBoard, mask, decodeMoves, cloneBoard } from '../core/board.js';
import { canPour, applyMove, isSolved, topColor, pourAmount } from '../core/rules.js';
import { starThresholds } from '../core/generator.js';
import { hash32 } from '../core/prng.js';

export const MIN_MS_PER_MOVE = 180;   // 含倒液動畫最短時長

/** 節奏風險評分（0–100）。人類 CV 通常 > 0.35；bot 固定 delay 接近 0。 */
export function rhythmRisk(ts) {
  if (ts.length < 8) return 0;
  const gaps = ts.slice(1).map((t, i) => t - ts[i]);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean <= 0) return 100;
  const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
  const cv = sd / mean;
  let risk = 0;
  if (cv < 0.15) risk += 50;                      // 機械式等間隔
  if (cv < 0.08) risk += 30;
  if (mean < 250) risk += 25;                     // 快過人手極限
  if (new Set(gaps.map(g => Math.round(g / 10))).size < gaps.length * 0.3) risk += 20;
  if (ts[0] < 400) risk += 15;                    // 開局零思考時間
  return Math.min(100, risk);
}

export function computeStars(moves, thresholds) {
  if (moves <= thresholds.three) return 3;
  if (moves <= thresholds.two) return 2;
  return 1;
}

export const COINS_BY_STARS = { 1: 10, 2: 20, 3: 40 };

function randomId() {
  const a = new Uint8Array(16);
  (globalThis.crypto || { getRandomValues: x => x.forEach((_, i) => (x[i] = Math.random() * 256)) }).getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

export class LocalServer {
  constructor({ solverWorkerUrl = null } = {}) {
    this.sessions = new Map();
    this.worker = null;
    this.workerUrl = solverWorkerUrl;
    this.reqId = 0;
    this.pending = new Map();
  }

  // ---------- worker（解題 / 練習關生成）----------
  _ensureWorker() {
    if (this.worker || !this.workerUrl || typeof Worker === 'undefined') return this.worker;
    this.worker = new Worker(this.workerUrl, { type: 'module' });
    this.worker.onmessage = (e) => {
      const { id, result, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      error ? p.reject(new Error(error)) : p.resolve(result);
    };
    return this.worker;
  }

  _call(type, payload) {
    const w = this._ensureWorker();
    if (!w) return Promise.reject(new Error('no worker'));
    const id = ++this.reqId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ id, type, ...payload });
    });
  }

  // ---------- POST /v1/level/start ----------
  /** level: { id, board(encoded), optimal, thresholds, publicSeed, title } */
  start(level, userId = 'local') {
    const trueBoard = decodeBoard(level.board);
    const s = {
      id: randomId(), userId, levelId: level.id,
      trueBoard: level.board,
      board: cloneBoard(trueBoard),
      applied: [],
      revealed: new Set(),
      optimalMoves: level.optimal,
      thresholds: level.thresholds || starThresholds(level.optimal, trueBoard),
      startedAt: Date.now(),
      revealCalls: 0, hintCalls: 0,
    };
    this.sessions.set(s.id, s);
    return {
      sessionId: s.id,
      maskedBoard: mask(s.board, s.revealed),
      publicSeed: level.publicSeed,
      optimalMoves: s.optimalMoves,
      starThresholds: s.thresholds,
    };
  }

  _session(id) {
    const s = this.sessions.get(id);
    if (!s) throw new Error('SESSION_NOT_FOUND');
    return s;
  }

  /** 將 client 嘅走步序列同步到 session（共同前綴只補新步；撤銷就由頭重放） */
  _sync(s, moves) {
    let prefix = 0;
    while (prefix < moves.length && prefix < s.applied.length &&
      moves[prefix].from === s.applied[prefix].from && moves[prefix].to === s.applied[prefix].to) prefix++;
    if (prefix < s.applied.length) {           // 撤銷咗：由頭重放（已露出嘅格保留）
      s.board = decodeBoard(s.trueBoard);
      s.applied = [];
      prefix = 0;
    }
    let last = null;
    for (let i = prefix; i < moves.length; i++) {
      const m = moves[i];
      if (!canPour(s.board, m.from, m.to)) throw new Error('ILLEGAL_MOVE');
      const src = s.board.cups[m.from];
      const events = [];
      const poured = pourAmount(s.board, m.from, m.to);
      s.board = applyMove(s.board, m, events);
      s.applied.push(m);
      // 磨砂杯倒走頂格 → 露出新頂格
      const after = s.board.cups[m.from];
      if (src.kind === 'frosted' && after.seg.length > 0) s.revealed.add(m.from + ':' + (after.seg.length - 1));
      last = { poured, events };
    }
    return last;
  }

  // ---------- POST /v1/level/reveal ----------
  /** 回傳同步後嘅遮罩盤面（只補露出格，唔會回傳隱藏層），以及最後一步嘅結算事件 */
  reveal(sessionId, moves) {
    const s = this._session(sessionId);
    s.revealCalls++;
    const last = this._sync(s, moves);
    return { ok: true, maskedBoard: mask(s.board, s.revealed), poured: last ? last.poured : 0, events: last ? last.events : [] };
  }

  // ---------- 提示（server 用當前真實盤面即時 solve）----------
  async hint(sessionId, moves) {
    const s = this._session(sessionId);
    this._sync(s, moves);
    s.hintCalls++;
    const r = await this._call('solve', { board: encodeBoard(s.board), maxDepth: 40 });
    return { move: r.moves && r.moves.length ? r.moves[0] : null, remaining: r.moves ? r.moves.length : null };
  }

  // ---------- 練習關：server 生成後只下發遮罩 ----------
  async generatePractice(cfg, seedStr) {
    const r = await this._call('generate', { cfg, seed: hash32(seedStr) });
    if (!r) return null;
    return { id: 'p:' + seedStr, title: cfg.title, board: r.board, optimal: r.optimal, thresholds: r.thresholds, publicSeed: seedStr, config: cfg };
  }

  // ---------- POST /v1/level/complete ----------
  complete(sessionId, req) {
    const s = this._session(sessionId);
    const moves = typeof req.moves === 'string' ? decodeMoves(req.moves) : req.moves;
    if (moves.length > s.optimalMoves + 60) return { verified: false, reason: 'MOVE_FLOOD' };

    // 1. 由 server 存嘅真實盤面重放全部走步（唔信 client 任何盤面狀態）
    let b = decodeBoard(s.trueBoard);
    for (const m of moves) {
      if (!canPour(b, m.from, m.to)) return { verified: false, reason: 'ILLEGAL_MOVE' };
      b = applyMove(b, m);
    }
    if (!isSolved(b)) return { verified: false, reason: 'NOT_SOLVED' };

    // 2. 時間下界
    const elapsed = Date.now() - s.startedAt;
    if (elapsed < moves.length * MIN_MS_PER_MOVE) return { verified: false, reason: 'TOO_FAST' };

    // 3. 節奏分析（只記錄，唔即時封）
    const risk = rhythmRisk(req.moveTimestamps || []);

    // 4. 發獎
    const stars = computeStars(moves.length, s.thresholds);
    const coinsAwarded = COINS_BY_STARS[stars] + (s.hintCalls ? 0 : 5);
    this.sessions.delete(sessionId);
    return { verified: true, stars, coinsAwarded, moves: moves.length, optimal: s.optimalMoves, risk, elapsedMs: elapsed, hintsUsed: s.hintCalls };
  }

  /** 目前真實盤面頂格顏色（除錯用；正式 server 唔會有呢個端點） */
  _debugTop(sessionId, cup) { return topColor(this._session(sessionId).board.cups[cup]); }
}
