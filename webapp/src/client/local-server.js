// client/local-server.js — 喺瀏覽器入面模擬 server 權威層（§5）。
// 真實盤面（含磨砂杯隱藏層）只存喺呢個 class 嘅 session 入面；client 只攞到遮罩視圖。
// 換成真 server 時，只需要將呢啲方法改成 fetch('/v1/level/...')。

import { decodeBoard, encodeBoard, mask, decodeMoves, cloneBoard, hiddenCount, makeCup, HIDDEN_KINDS } from '../core/board.js';
import { canPour, applyMove, isSolved, topColor, pourAmount, isComplete, settleOrders, openSlot } from '../core/rules.js';
import { starThresholds } from '../core/generator.js';
import { hash32 } from '../core/prng.js';
import { computeMoveLimit } from '../core/difficulty.js';

export const MIN_MS_PER_MOVE = 180;   // 含倒液動畫最短時長
export const MAX_CUPS = 16;           // 走步編碼 from/to 各 4 bit → 最多 16 隻瓶（含廣告加嘅空瓶）

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
      moveLimit: level.moveLimit !== undefined ? level.moveLimit : computeMoveLimit(typeof level.id === 'number' ? level.id : 0, level.optimal),
      startedAt: Date.now(),
      revealCalls: 0, hintCalls: 0,
      extraOrders: [],          // 廣告解鎖嘅額外委託 {atMove, color}，重放時喺同一步插入
      extraCups: [],            // 廣告加嘅空燒瓶 {atMove}，重放時喺同一步 append（Spec v2 §6 addEmptyBottle）
      adUnlocks: [],            // v4 §4 廣告樽解鎖 {atMove, cup}：重放時喺同一步將 ad 樽變 normal 空樽
    };
    this.sessions.set(s.id, s);
    return {
      sessionId: s.id,
      maskedBoard: mask(s.board, s.revealed),
      publicSeed: level.publicSeed,
      optimalMoves: s.optimalMoves,
      starThresholds: s.thresholds,
      moveLimit: s.moveLimit,
    };
  }

  _session(id) {
    const s = this.sessions.get(id);
    if (!s) throw new Error('SESSION_NOT_FOUND');
    return s;
  }

  /** 額外訂單：喺第 atMove 步之後（即已套用 atMove 步時）插入盤面 */
  /** 廣告解鎖訂單槽（Spec v3 §3）：喺第 atMove 步之後開一個新槽，由隊列攞下一單（唔係隨機色）；已封樽嘅色追上就即刻飛走 */
  static _insertExtraOrders(board, extra, applied, events = null) {
    for (const o of extra) if (o.atMove === applied && !o.inserted) {
      openSlot(board, events);
      o.inserted = true;
    }
  }

  /** 額外空燒瓶：喺第 atMove 步之後 append 一隻 normal 空瓶（cap 4）；append 唔會郁到現有瓶嘅 index，之前嘅走步照樣合法 */
  static _insertExtraCups(board, extra, applied) {
    for (const c of extra) if (c.atMove === applied && !c.inserted) {
      board.cups.push(makeCup('normal'));
      c.inserted = true;
    }
  }

  /** 廣告樽解鎖：喺第 atMove 步之後將該樽由 ad 變 normal（空）；已經唔係 ad 就略過 */
  static _applyAdUnlocks(board, list, applied) {
    for (const u of list) if (u.atMove === applied && !u.applied) {
      const c = board.cups[u.cup];
      if (c && c.kind === 'ad') { c.kind = 'normal'; c.locked = false; }
      u.applied = true;
    }
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
      // 撤銷到解鎖之前：額外訂單改為由而家開始生效（解鎖當關有效，唔會因撤銷消失）
      for (const o of s.extraOrders) { if (o.atMove > moves.length) o.atMove = moves.length; o.inserted = false; }
      for (const c of s.extraCups) { if (c.atMove > moves.length) c.atMove = moves.length; c.inserted = false; }
      for (const u of s.adUnlocks) { if (u.atMove > moves.length) u.atMove = moves.length; u.applied = false; }
      LocalServer._insertExtraCups(s.board, s.extraCups, 0);
      LocalServer._applyAdUnlocks(s.board, s.adUnlocks, 0);
      LocalServer._insertExtraOrders(s.board, s.extraOrders, 0);
    }
    let last = null;
    for (let i = prefix; i < moves.length; i++) {
      const m = moves[i];
      if (!canPour(s.board, m.from, m.to)) throw new Error('ILLEGAL_MOVE');
      const src = s.board.cups[m.from], dst = s.board.cups[m.to];
      const events = [];
      const poured = pourAmount(s.board, m.from, m.to);
      // 倒入 `?` 樽：原本可見嘅頂格同新倒入嘅格玩家都見過 → 永久露出（否則倒滿都唔算完成、撤銷後又遮返）
      if (HIDDEN_KINDS.has(dst.kind)) {   // hidden / covered：倒入嘅格同原頂格玩家見過 → 永久露出（1 格嘅 ? 樽 hiddenCount 係 0，要用 kind 判）
        if (dst.seg.length > 0) s.revealed.add(m.to + ':' + (dst.seg.length - 1));
        for (let i = dst.seg.length; i < dst.seg.length + poured; i++) s.revealed.add(m.to + ':' + i);
      }
      s.board = applyMove(s.board, m, events);
      s.applied.push(m);
      LocalServer._insertExtraCups(s.board, s.extraCups, s.applied.length);
      LocalServer._applyAdUnlocks(s.board, s.adUnlocks, s.applied.length);
      LocalServer._insertExtraOrders(s.board, s.extraOrders, s.applied.length);
      // 磨砂瓶倒走頂格 → 露出新頂格（永久）；被倒走嘅格玩家已經見到係乜色，撤銷後亦唔再遮
      const after = s.board.cups[m.from];
      if (hiddenCount(src) > 0) {
        if (after.seg.length > 0) s.revealed.add(m.from + ':' + (after.seg.length - 1));
        for (let i = after.seg.length; i < src.seg.length; i++) s.revealed.add(m.from + ':' + i);
      }
      // 任何瓶變成純色滿瓶：內容已經可以完全推斷（交貨 / 完成判定 client 要睇得到），全部露出
      s.board.cups.forEach((c, ci) => { if (HIDDEN_KINDS.has(c.kind) && isComplete(c)) for (let i = 0; i < c.seg.length; i++) s.revealed.add(ci + ':' + i); });
      last = { poured, events };
    }
    return last;
  }

  // ---------- 廣告解鎖訂單槽（工單 #4 任務 3）----------
  /**
   * 由當前真實盤面剩餘「未完成」嘅顏色中隨機揀一隻加做新訂單：
   * 排除已有訂單嘅色、已經係純色滿杯嘅色。回傳 { ok, color, maskedBoard }。
   */
  /** 廣告紋章出現之前先問：隊列仲有冇單可以開新槽（唔好等玩家睇完廣告先話冇） */
  canAddOrder(sessionId, moves) {
    const s = this._session(sessionId);
    this._sync(s, moves);
    return (s.board.queue || []).length > 0;
  }

  /** 廣告解鎖一個訂單槽：由隊列攞下一單；回傳結算事件（已封樽追上會即刻 deliver）畀 client 播動畫 */
  addOrder(sessionId, moves) {
    const s = this._session(sessionId);
    this._sync(s, moves);
    if (!(s.board.queue || []).length) return { ok: false, reason: 'QUEUE_EMPTY' };
    const events = [];
    s.extraOrders.push({ atMove: s.applied.length, inserted: false });
    LocalServer._insertExtraOrders(s.board, s.extraOrders, s.applied.length, events);
    // color = 新開嗰單嘅色（events 第一個 order）；已封樽追上會即刻 deliver，槽可能已經補咗下一單
    const opened = events.find(e => e.type === 'order');
    const slot = s.board.orders[s.board.orders.length - 1];
    return { ok: true, color: opened ? opened.color : slot.color, slotColor: slot.color, events, maskedBoard: mask(s.board, s.revealed) };
  }

  // ---------- 廣告樽解鎖（v4 §4：一開波喺盤面嘅 ad 樽，撳一下睇廣告 → 變 normal 空樽，當關有效）----------
  unlockAdCup(sessionId, moves, cupIdx) {
    const s = this._session(sessionId);
    this._sync(s, moves);
    const c = s.board.cups[cupIdx];
    if (!c || c.kind !== 'ad') return { ok: false, reason: 'NOT_AD_CUP' };
    s.adUnlocks.push({ atMove: s.applied.length, cup: cupIdx, applied: false });
    LocalServer._applyAdUnlocks(s.board, s.adUnlocks, s.applied.length);
    return { ok: true, cup: cupIdx, maskedBoard: mask(s.board, s.revealed) };
  }

  // ---------- 廣告加空燒瓶（Spec v2 §6 addEmptyBottle，第 11 關起）----------
  /**
   * 喺真實盤面尾端 append 一隻空燒瓶（kind normal，cap 4），同 extraOrders 一樣記低 atMove，
   * 撤銷 / 過關重放時喺同一步 append，驗證先會一致。瓶數上限 16（走步編碼 4 bit index）。
   * 回傳 { ok, cup(index), maskedBoard }。
   */
  addEmptyCup(sessionId, moves) {
    const s = this._session(sessionId);
    this._sync(s, moves);
    if (s.board.cups.length >= MAX_CUPS) return { ok: false, reason: 'MAX_CUPS' };
    s.extraCups.push({ atMove: s.applied.length, inserted: false });
    LocalServer._insertExtraCups(s.board, s.extraCups, s.applied.length);
    return { ok: true, cup: s.board.cups.length - 1, maskedBoard: mask(s.board, s.revealed) };
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
    const r = await this._call('solve', { board: encodeBoard(s.board), maxDepth: 40 });
    if (r.moves && r.moves.length) s.hintCalls++;   // 真係派咗提示先扣「零提示」加分
    return { move: r.moves && r.moves.length ? r.moves[0] : null, remaining: r.moves ? r.moves.length : null };
  }

  // ---------- 練習關：server 生成後只下發遮罩 ----------
  async generatePractice(cfg, seedStr, opts = {}) {
    const r = await this._call('generate', { cfg, seed: hash32(seedStr), budgetMs: opts.budgetMs ?? null });
    if (!r) return null;
    return { id: 'p:' + seedStr, title: cfg.title, board: r.board, optimal: r.optimal, thresholds: r.thresholds, publicSeed: seedStr, config: cfg };
  }

  // ---------- POST /v1/level/complete ----------
  complete(sessionId, req) {
    const s = this._session(sessionId);
    const moves = typeof req.moves === 'string' ? decodeMoves(req.moves) : req.moves;
    if (moves.length > s.optimalMoves + (s.moveLimit === null ? 400 : 60)) return { verified: false, reason: 'MOVE_FLOOD' };   // 冇上限嘅教學關容許新手亂試
    if (s.moveLimit !== null && moves.length > s.moveLimit) return { verified: false, reason: 'MOVE_LIMIT' };   // 步數上限（server 亦驗）

    // 1. 由 server 存嘅真實盤面重放全部走步（唔信 client 任何盤面狀態）
    let b = decodeBoard(s.trueBoard);
    const extra = s.extraOrders.map(o => ({ atMove: Math.min(o.atMove, moves.length), inserted: false }));
    const extraCups = s.extraCups.map(c => ({ atMove: Math.min(c.atMove, moves.length), inserted: false }));
    const adUnlocks = s.adUnlocks.map(u => ({ atMove: Math.min(u.atMove, moves.length), cup: u.cup, applied: false }));
    LocalServer._insertExtraCups(b, extraCups, 0);
    LocalServer._applyAdUnlocks(b, adUnlocks, 0);
    LocalServer._insertExtraOrders(b, extra, 0);
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (!canPour(b, m.from, m.to)) return { verified: false, reason: 'ILLEGAL_MOVE' };
      b = applyMove(b, m);
      LocalServer._insertExtraCups(b, extraCups, i + 1);
      LocalServer._applyAdUnlocks(b, adUnlocks, i + 1);
      LocalServer._insertExtraOrders(b, extra, i + 1);
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
