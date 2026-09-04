// client/main.js — 畫面流程、進度、輸入處理。規則永遠交畀 core/，權威判定交畀 LocalServer，背景交畀 BackgroundManager。

import { CAMPAIGN, CHAPTERS, PRACTICE } from '../core/levels.js';
import { PALETTE } from '../core/palette.js';
import { canPour, pourAmount, applyMove, isSolved, isDead, isComplete } from '../core/rules.js';
import { LocalServer } from './local-server.js';
import { GameView } from './game.js';
import { Sfx } from './audio.js';
import { BackgroundManager, STAGES, stageForLevel, stageTransitionAfter } from './background.js';
import { BootFlow, decideEntry } from './boot.js';

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const server = new LocalServer({ solverWorkerUrl: new URL('./solver.worker.js', import.meta.url) });
const sfx = new Sfx();
const bg = new BackgroundManager($('#bg-layers'), new URL('../../assets/bg/', import.meta.url).href);
const PARAMS = new URLSearchParams(location.search);

// ---------- 遠端可調參數（config.json；載入失敗用預設）----------
const CONFIG = {
  orderText: false,
  orderSlots: { ad: [{ from: 1, to: 10, count: 0 }, { from: 11, to: 16, count: 0 }, { from: 17, to: 35, count: 1 }, { from: 36, to: 9999, count: 1 }] },
  adUnits: { extraOrderSlot: 'rewarded_extra_order_slot', extraEmptyCup: 'rewarded_extra_empty_cup' },
};
async function loadConfig() {
  try {
    const r = await fetch(new URL('../../config.json', import.meta.url), { cache: 'no-cache' });
    if (r.ok) Object.assign(CONFIG, await r.json());
  } catch { /* 用預設 */ }
}
/** 飲品名文字：預設關（色塊本身就係訊號）；用戶可喺「點樣玩」開，存 localStorage */
function orderTextOn() {
  try { const v = localStorage.getItem('mc_order_text'); if (v !== null) return v === '1'; } catch { /* ignore */ }
  return !!CONFIG.orderText;
}
const hexScale = (hex, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');

// ---------- 進度 ----------
const PKEY = 'meowcha.progress.v1';
const progress = (() => {
  try { return Object.assign({ stars: {}, coins: 0 }, JSON.parse(localStorage.getItem(PKEY) || '{}')); }
  catch { return { stars: {}, coins: 0 }; }
})();
function saveProgress() { try { localStorage.setItem(PKEY, JSON.stringify(progress)); } catch { /* ignore */ } }
function nextLevelId() {
  let id = 1;
  while (progress.stars[id] && id < CAMPAIGN.length) id++;
  return id;
}
function totalStars() { return Object.values(progress.stars).reduce((a, b) => a + b, 0); }

// ---------- 關卡資料 ----------
let LEVELS = null;
async function loadLevels() {
  if (LEVELS) return LEVELS;
  const res = await fetch(new URL('../../levels/campaign.json', import.meta.url));
  const data = await res.json();
  LEVELS = new Map(data.levels.map(l => [l.id, l]));
  return LEVELS;
}

// ---------- 畫面 ----------
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  if (id === 'screen-game' && G.view) G.view.resize();
}
function refreshTitle() {
  const n = nextLevelId();
  $('#btn-continue').textContent = progress.stars[n] ? `重玩 第 ${n} 關` : (n === 1 ? '開始' : `繼續 · 第 ${n} 關`);
  $('#coins-title').textContent = progress.coins;
  $('#stars-title').textContent = totalStars();
  $('#coins-levels').textContent = progress.coins;
}

function renderLevelGrid() {
  const grid = $('#level-grid');
  grid.innerHTML = '';
  const unlockedTo = nextLevelId();
  for (const ch of CHAPTERS) {
    const h = document.createElement('div');
    h.className = 'chapter';
    h.textContent = `第${['一', '二', '三', '四', '五', '六', '七', '八'][CHAPTERS.indexOf(ch)]}章 · ${ch.name}`;
    grid.appendChild(h);
    const g = document.createElement('div');
    g.className = 'chapter-grid';
    for (let id = ch.from; id <= ch.to; id++) {
      const b = document.createElement('button');
      const st = progress.stars[id] || 0;
      const locked = id > unlockedTo && !st;
      b.className = 'lv' + (locked ? ' locked' : '') + (id === unlockedTo ? ' current' : '');
      b.innerHTML = `${id}<span class="st">${'★'.repeat(st)}<span class="off">${'★'.repeat(3 - st)}</span></span>`;
      b.title = CAMPAIGN[id - 1].title;
      b.addEventListener('click', () => { sfx.click(); playCampaign(id); });
      g.appendChild(b);
    }
    grid.appendChild(g);
  }
}

// ---------- Modal / Toast ----------
function modal(html, { dismiss = false } = {}) {
  const m = $('#modal');
  $('#modal-card').innerHTML = html;
  m.classList.remove('hidden');
  m.onclick = dismiss ? (e) => { if (e.target === m) closeModal(); } : null;
}
function closeModal() { $('#modal').classList.add('hidden'); }
let toastTimer = null;
function toast(text, ms = 1600) {
  const t = $('#toast');
  t.textContent = text; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---------- Mocha ----------
const LINES = {
  idle: ['揀一隻杯，再揀倒去邊隻～', '同色先可以疊埋一齊喎', '空杯乜嘢都裝得', '諗清楚先倒，唔急～', '客人要純色滿杯先收貨'],
  serve: ['叮！有單出咗～', '多謝惠顧喵～', '呢杯正！'],
  almost: ['就快得喇！', '仲差少少～'],
  stuck: ['唔…冇得郁喇，撤銷一步試下？', '卡住咗…重新嚟過？'],
  clear: ['收工！你係最叻嘅茶記店員～', '全部出晒單，勁！'],
  hint: ['試下呢步？', '我會咁倒～'],
  frosted: ['磨砂杯睇唔到入面，倒走頂層先知～'],
  unlock: ['封膜開咗！可以用呢隻杯喇'],
  pour: ['倒緊…'],
};
function mocha(state, text) {
  const img = $('#mocha-img');
  const src = `assets/mocha-${state}.webp`;
  if (!img.src.endsWith(src)) img.src = new URL('../../' + src, import.meta.url).href;
  if (text !== undefined) $('#mocha-bubble').textContent = text;
  else if (LINES[state]) $('#mocha-bubble').textContent = LINES[state][Math.floor(Math.random() * LINES[state].length)];
  if (state === 'serve' || state === 'clear') { img.classList.remove('hop'); void img.offsetWidth; img.classList.add('hop'); }
}

// ---------- 客人區 ----------
/** 空椅剪影（訂單槽少於 4 個時填空位，alpha 0.3） */
function chairSvg() {
  return `<svg class="chair" viewBox="0 0 60 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="12" y="4" width="36" height="34" rx="8" fill="#7A4E1E"/>
    <rect x="6" y="40" width="48" height="12" rx="5" fill="#7A4E1E"/>
    <rect x="10" y="52" width="6" height="26" rx="2" fill="#7A4E1E"/><rect x="44" y="52" width="6" height="26" rx="2" fill="#7A4E1E"/>
  </svg>`;
}

const SLOT_COUNT = 4;   // 客人區固定四個槽位；空位用空椅剪影

function renderCustomers(popColor = null) {
  const el = $('#customers');
  const orders = G.board.orders;
  el.innerHTML = '';
  // 四位食客（貓 / 兔 / 柴犬 / 熊）× 三表情：等待 wait · 出單 happy · 步數超三星門檻仍未出單 angry
  const late = G.session && G.moves.length > G.session.starThresholds.three;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const o = orders[i];
    const slot = document.createElement('div');
    if (!o) {
      slot.className = 'slot empty';
      slot.innerHTML = chairSvg();
    } else {
      const p = PALETTE[o.color];
      const who = ((G.seatSeed + i) % 4) + 1;
      const mood = o.filled ? 'happy' : late ? 'angry' : 'wait';
      slot.className = 'slot' + (o.filled ? ' done' : '') + (popColor === o.color ? ' pop' : '');
      // 色塊托盤：顏色 = 板面液體同一個 hex；文字預設唔顯示（L* > 55 用深啡，否則白）
      const textColor = p.L > 55 ? '#5C3A14' : '#FFFFFF';
      slot.innerHTML = `<img class="body" src="${new URL(`../../assets/customer-${who}-${mood}-body.webp`, import.meta.url).href}" alt="">
        <div class="tray" style="--c:${p.hex};--cd:${hexScale(p.hex, 0.82)};--ci:${hexScale(p.hex, 0.9)};--ct:${textColor}" title="${p.zh}" aria-label="${p.zh}">${orderTextOn() && !o.filled ? `<span class="name">${p.zh}</span>` : ''}</div>`;
    }
    el.appendChild(slot);
  }
  if (!orders.length) {
    const s = document.createElement('span'); s.className = 'customers-note'; s.textContent = '今日冇客人落單 · 每種飲品裝滿一杯就收工';
    el.appendChild(s);
  }
  const sealed = G.board.cups.filter(c => c.locked).length;
  if (sealed) {
    const n = document.createElement('span'); n.className = 'customers-note lock';
    n.textContent = `🔒 再交 ${2 - (G.board.delivered % 2)} 單解封`;
    el.appendChild(n);
  }
}

// ---------- 遊戲狀態 ----------
const G = {
  view: null, level: null, session: null, board: null, moves: [], ts: [], history: [],
  selected: null, busy: false, startedAt: 0, practice: false, hints: 0, seatSeed: 0, stage: null,
};

function updatePace() {
  const n = G.moves.length, th = G.session.starThresholds;
  const lit = n <= th.three ? 3 : n <= th.two ? 2 : 1;
  $('#pace-stars').innerHTML = '★'.repeat(lit) + `<span class="off">${'★'.repeat(3 - lit)}</span>`;
  $('#pace-moves').textContent = `${n} 步`;
  $('#pace').title = `步數 ${n} · 三星 ≤ ${th.three} · 最優 ${G.session.optimalMoves}`;
  $('#btn-undo').disabled = G.moves.length === 0 || G.busy;
}

function canBeSource(cup) {
  return cup.seg.length > 0 && !cup.locked && !isComplete(cup);
}

async function startLevel(levelData, { practice = false } = {}) {
  G.level = levelData; G.practice = practice;
  const st = server.start(levelData);
  G.session = st;
  G.board = st.maskedBoard;
  G.moves = []; G.ts = []; G.history = []; G.selected = null; G.busy = false; G.hints = 0;
  G.seatSeed = Math.floor(Math.random() * 4);
  G.startedAt = performance.now();
  if (!practice) { progress.last = levelData.id; saveProgress(); }   // 續玩：下次直接落返呢關
  if (!G.view) G.view = new GameView($('#board'), { onCupTap });
  G.view.setBoard(G.board);
  G.view.select(null);
  G.view.clearHint();
  $('#game-level-no').textContent = practice ? '練習' : `第 ${levelData.id} 關`;
  $('#game-level-title').textContent = levelData.title || '';

  // 背景階段（?stage=N 可強制預覽）
  const forced = Number(PARAMS.get('stage'));
  const stage = forced ? STAGES.find(s => s.id === forced) : stageForLevel(practice ? nextLevelId() : levelData.id);
  if (!G.stage || G.stage.id !== stage.id) { bg.setStage(stage); G.stage = stage; }
  if (!practice) bg.preloadAround(levelData.id);

  show('screen-game');
  updatePace();
  renderCustomers();
  const frosted = G.board.cups.some(c => c.kind === 'frosted');
  mocha('idle', frosted && Math.random() < 0.6 ? LINES.frosted[0] : undefined);
}

async function playCampaign(id) {
  const levels = await loadLevels();
  const l = levels.get(id);
  if (!l) { toast('關卡資料未生成'); return; }
  await startLevel(l);
}

// ---------- 走步 ----------
async function onCupTap(idx) {
  if (G.busy) return;
  const cup = G.board.cups[idx];

  if (G.selected === null) {
    if (canBeSource(cup)) { G.selected = idx; G.view.select(idx); sfx.select(); }
    else { G.view.shake(idx); sfx.shake(); if (cup.locked) toast('封膜杯：交 2 單先解封'); }
    return;
  }
  if (G.selected === idx) { G.selected = null; G.view.select(null); sfx.deselect(); return; }

  const m = { from: G.selected, to: idx };
  if (!canPour(G.board, m.from, m.to)) {
    if (canBeSource(cup)) { G.selected = idx; G.view.select(idx); sfx.select(); }
    else { G.view.shake(idx); sfx.shake(); }
    return;
  }

  // ---- 樂觀執行 ----
  G.busy = true; G.selected = null; G.view.select(null); G.view.clearHint();
  $('#btn-undo').disabled = true; $('#btn-hint').disabled = true;
  const src = G.board.cups[m.from];
  const color = src.seg[src.seg.length - 1];
  const prevBoard = G.board;
  const nextMoves = [...G.moves, m];
  let n, next, events = [];

  if (src.kind === 'frosted') {
    // 磨砂杯：真實倒出量 client 唔知（頂層下面可能同色），先問 server（回應被倒液動畫遮蓋）
    const r = server.reveal(G.session.sessionId, nextMoves);
    n = r.poured; next = r.maskedBoard; events = r.events;
  } else {
    n = pourAmount(G.board, m.from, m.to);
    next = applyMove(G.board, m, events);
  }

  G.moves = nextMoves; G.ts.push(Math.round(performance.now() - G.startedAt)); G.history.push(prevBoard);
  mocha('pouring', LINES.pour[0]);
  sfx.pour(n);
  bg.onPour();                                   // 倒液微視差
  await G.view.animatePour(m.from, m.to, n, color);

  G.board = next;
  G.view.setBoard(G.board);
  updatePace();

  // 結算事件動畫
  let served = false;
  for (const ev of events) {
    if (ev.type === 'deliver') {
      served = true; sfx.deliver();
      renderCustomers(ev.color);
      mocha('serve');
      await G.view.animateDeliver(ev.cup, `✓ ${PALETTE[ev.color].zh} 出單`);
    } else if (ev.type === 'unlock') {
      sfx.unlock(); mocha('serve', LINES.unlock[0]);
      await G.view.animateUnlock(ev.cup);
      renderCustomers();
    }
  }
  G.view.setBoard(G.board);
  G.busy = false;
  $('#btn-hint').disabled = false;
  updatePace();
  if (!served) renderCustomers();   // 步數超門檻 → 食客轉不耐煩表情

  if (isSolved(G.board)) { await onSolved(); return; }
  if (isDead(G.board)) { mocha('stuck'); sfx.stuck(); await sleep(350); showStuck(); return; }
  if (!served) {
    const left = G.board.orders.filter(o => !o.filled).length;
    const segsLeft = G.board.cups.reduce((a, c) => a + c.seg.filter((v, i) => i === 0 || v !== c.seg[i - 1]).length, 0);
    if (segsLeft - G.board.colors <= 2 || (G.board.orders.length && left === 1 && Math.random() < 0.5)) mocha('almost');
    else mocha('idle', Math.random() < 0.25 ? undefined : $('#mocha-bubble').textContent === LINES.pour[0] ? LINES.idle[0] : $('#mocha-bubble').textContent);
  }
}

async function undo() {
  if (G.busy || !G.moves.length) return;
  G.moves.pop(); G.ts.pop();
  G.history.pop();
  const r = server.reveal(G.session.sessionId, G.moves);   // 由 server 取回同步後嘅遮罩盤面（已露出嘅格保留）
  G.board = r.maskedBoard;
  G.selected = null; G.view.select(null); G.view.clearHint();
  G.view.setBoard(G.board);
  sfx.undo();
  updatePace(); renderCustomers();
  mocha('idle', '好，退返一步～');
}

async function hint() {
  if (G.busy) return;
  G.busy = true; $('#btn-hint').disabled = true;
  mocha('idle', '等我諗諗…');
  try {
    const r = await server.hint(G.session.sessionId, G.moves);
    if (!r.move) { mocha('stuck', '呢個局面我都解唔到…撤銷幾步試下？'); }
    else {
      G.hints++;
      G.selected = null; G.view.select(null);
      G.view.showHint(r.move.from, r.move.to);
      sfx.hint();
      mocha('idle', `${LINES.hint[Math.floor(Math.random() * LINES.hint.length)]}（仲有 ${r.remaining} 步就得）`);
    }
  } catch (e) {
    toast('提示暫時用唔到');
    console.error(e);
  }
  G.busy = false; $('#btn-hint').disabled = false; updatePace();
}

function restart() {
  if (G.busy) return;
  sfx.click();
  startLevel(G.level, { practice: G.practice });
}

// ---------- 完成 / 卡關 ----------
async function onSolved() {
  G.busy = true;
  mocha('clear');
  sfx.win();
  G.view.animateWin();
  const res = server.complete(G.session.sessionId, {
    moves: G.moves, clientElapsedMs: Math.round(performance.now() - G.startedAt), moveTimestamps: G.ts,
  });
  await sleep(700);
  if (!res.verified) {
    modal(`<img class="mascot" src="assets/mocha-stuck.webp"><h3>驗證失敗</h3><p>${res.reason}</p>
      <div class="row"><button class="btn" id="m-retry">再嚟一次</button></div>`);
    $('#m-retry').onclick = () => { closeModal(); restart(); };
    return;
  }
  let coins = res.coinsAwarded;
  if (!G.practice) {
    const prev = progress.stars[G.level.id] || 0;
    if (res.stars > prev) progress.stars[G.level.id] = res.stars; else coins = 5;
  } else coins = Math.round(coins / 2);
  progress.coins += coins;
  saveProgress(); refreshTitle();

  const isLast = !G.practice && G.level.id >= CAMPAIGN.length;
  const nextStage = G.practice ? null : stageTransitionAfter(G.level.id);
  // 跨階段：記低旗標，下次開 app 會先落主畫面播過渡（開場規格 §7）
  if (nextStage) { try { localStorage.setItem('mc_pending_stage', String(nextStage.id)); } catch { /* ignore */ } }
  modal(`
    <img class="mascot" src="assets/mocha-clear.webp">
    <h3>${G.practice ? '練習完成！' : `第 ${G.level.id} 關完成！`}</h3>
    <div class="stars">${[1, 2, 3].map(i => `<span class="s${i <= res.stars ? ' on' : ''}">★</span>`).join('')}</div>
    <div class="result">
      <div><span class="lbl">你嘅步數</span><b>${res.moves}</b></div>
      <div><span class="lbl">最優</span><b>${res.optimal}</b></div>
      <div><span class="lbl">三星門檻</span><b>≤ ${G.session.starThresholds.three}</b></div>
      <div><span class="lbl">金幣</span><b>+${coins}</b></div>
    </div>
    ${res.stars < 3 ? `<p style="font-size:13px">${res.moves > G.session.starThresholds.two ? '過到就係贏！' : '再少幾步就三星～'}</p>` : '<p style="font-size:13px">完美！Mocha 都拍手～</p>'}
    <div class="row">
      <button class="btn" id="m-replay">再玩</button>
      ${G.practice ? '<button class="btn primary" id="m-practice">再嚟一局</button>'
        : nextStage ? '<button class="btn primary" id="m-continue">繼續 ›</button>'
        : isLast ? '' : '<button class="btn primary" id="m-next">下一關 ›</button>'}
    </div>
    <div class="row"><button class="btn ghost" id="m-menu">返回主頁</button></div>
  `);
  $('#m-replay').onclick = () => { closeModal(); restart(); };
  $('#m-menu').onclick = () => { closeModal(); refreshTitle(); show('screen-title'); };
  if ($('#m-next')) $('#m-next').onclick = () => { closeModal(); playCampaign(G.level.id + 1); };
  if ($('#m-practice')) $('#m-practice').onclick = () => { closeModal(); pickPractice(); };
  if ($('#m-continue')) $('#m-continue').onclick = async () => {
    closeModal();
    await playStageTransition(nextStage);
    try { localStorage.removeItem('mc_pending_stage'); } catch { /* ignore */ }
    const levels = await loadLevels();
    if (levels.has(G.level.id + 1)) playCampaign(G.level.id + 1);
    else { refreshTitle(); renderLevelGrid(); show('screen-levels'); }
  };
}

/** 階段過渡時刻（背景規格 §6）：鏡頭橫移 3 秒 → 摩卡跳入講對白 → 字卡 → 回到關卡 */
async function playStageTransition(nextStage) {
  G.busy = true;
  const col = $('.game-col');
  col.classList.add('dim');
  $('#mocha-bubble').textContent = '…';
  await bg.transitionTo(nextStage);
  G.stage = nextStage;
  col.classList.remove('dim');
  mocha('serve', nextStage.line);
  sfx.win();
  const card = $('#stage-card');
  card.innerHTML = `<small>第 ${nextStage.id} 階段</small><b>${nextStage.name}</b>`;
  card.classList.remove('hidden');
  await sleep(2200);
  card.classList.add('hidden');
  G.busy = false;
}

function showStuck() {
  modal(`
    <img class="mascot" src="assets/mocha-stuck.webp">
    <h3>冇路行喇…</h3>
    <p>所有杯都倒唔到。撤銷幾步，或者重新嚟過？</p>
    <div class="row">
      <button class="btn" id="m-undo">↶ 撤銷</button>
      <button class="btn primary" id="m-restart">↻ 重來</button>
    </div>
  `);
  $('#m-undo').onclick = () => { closeModal(); undo(); };
  $('#m-restart').onclick = () => { closeModal(); restart(); };
}

// ---------- 練習模式 ----------
function pickPractice() {
  modal(`
    <h3>練習模式</h3>
    <p style="font-size:13px">每局隨機生成，唔計入關卡進度。</p>
    <div class="diff">
      <button class="btn" data-d="easy">輕鬆<small>8 杯 · 6 色 · 1 位客人</small></button>
      <button class="btn" data-d="medium">普通<small>10 杯 · 7 色 · 磨砂 + 外帶</small></button>
      <button class="btn primary" data-d="hard">困難<small>12 杯 · 9 色 · 全部杯種</small></button>
    </div>
    <div class="row"><button class="btn ghost" id="m-close">取消</button></div>
  `, { dismiss: true });
  $('#m-close').onclick = closeModal;
  document.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
    const cfg = PRACTICE[b.dataset.d];
    sfx.click();
    modal(`<img class="mascot" src="assets/mocha-pouring.webp"><h3>Mocha 整緊飲品…</h3><div class="spinner"></div><p style="font-size:13px">生成緊隨機關卡，稍等一陣</p>`);
    try {
      const seed = `v1:p:${b.dataset.d}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
      const lvl = await server.generatePractice(cfg, seed);
      closeModal();
      if (!lvl) { toast('生成失敗，再試一次'); return; }
      await startLevel(lvl, { practice: true });
    } catch (e) {
      closeModal(); toast('生成失敗：' + e.message); console.error(e);
    }
  });
}

// ---------- 說明 ----------
function showHelp() {
  const cup = (img, name, desc) => `<div class="cuptype"><img src="assets/${img}.webp" alt=""><div><b>${name}</b><span>${desc}</span></div></div>`;
  modal(`
    <h3>點樣玩？</h3>
    <div class="help">
      <h4>基本</h4>
      <ul>
        <li>㩒一隻杯揀起，再㩒另一隻杯就會倒過去。</li>
        <li>只可以倒落<b>空杯</b>或者<b>頂層同色</b>嘅杯，一次倒晒頂層連續同色嘅幾格。</li>
        <li>每種飲品裝滿一隻杯（4 格純色）就完成；全部完成即過關。</li>
        <li>步數越少星越多：三星 = 最優步數 + 3（有磨砂杯每隻再 +2）。頂欄嘅三粒星會跟住你嘅步數變。</li>
      </ul>
      <h4>客人</h4>
      <ul><li>排隊嘅客人手上寫住想飲乜。裝滿一杯佢要嘅飲品會即刻<b>出單</b>，隻杯清空變返空杯——多咗空間！</li></ul>
      <h4>杯種</h4>
      <div class="cuptypes">
        ${cup('cup-body', '普通杯', '透明，睇晒入面。')}
        ${cup('cup-frosted', '磨砂杯 ?', '只見到最頂一格，倒走先知下面係乜。')}
        ${cup('cup-sealed', '封膜杯 🔒', '鎖住唔郁得，每交 2 張單解封一隻。')}
        ${cup('cup-takeaway', '外帶袋', '只裝 3 格，永遠裝唔滿一色，係暫存用嘅。最後要清空。')}
      </div>
      <h4>工具</h4>
      <ul><li>撤銷：退返一步。提示：Mocha 會指出下一步（唔影響過關，但冇「零提示」加分）。</li></ul>
      <h4>設定</h4>
      <label style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700"><input type="checkbox" id="opt-order-text" ${orderTextOn() ? 'checked' : ''}> 訂單色塊上顯示飲品名（無障礙）</label>
    </div>
    <div class="row"><button class="btn primary" id="m-ok">明白！</button></div>
  `, { dismiss: true });
  $('#m-ok').onclick = closeModal;
  $('#opt-order-text').onchange = (e) => {
    try { localStorage.setItem('mc_order_text', e.target.checked ? '1' : '0'); } catch { /* ignore */ }
    if (G.board) renderCustomers();
  };
}

// ---------- 綁定 ----------
function bind() {
  $('#btn-continue').onclick = () => { sfx.click(); playCampaign(nextLevelId()); };
  $('#btn-levels').onclick = () => { sfx.click(); renderLevelGrid(); refreshTitle(); show('screen-levels'); };
  $('#btn-practice').onclick = () => { sfx.click(); pickPractice(); };
  $('#btn-help').onclick = () => { sfx.click(); showHelp(); };
  $('#btn-levels-back').onclick = () => { sfx.click(); refreshTitle(); show('screen-title'); };
  // 關卡角落 🏪 → 返回店舖（主畫面）
  $('#btn-game-back').onclick = () => {
    if (G.busy) return;
    sfx.click(); refreshTitle();
    show('screen-title');
  };
  $('#btn-undo').onclick = undo;
  $('#btn-hint').onclick = hint;
  $('#btn-restart').onclick = restart;
  const muteBtn = $('#btn-mute');
  const syncMute = () => { muteBtn.textContent = sfx.muted ? '🔇' : '🔊'; };
  muteBtn.onclick = () => { sfx.setMuted(!sfx.muted); syncMute(); if (!sfx.muted) sfx.click(); };
  syncMute();
  document.addEventListener('keydown', (e) => {
    if (!$('#screen-game').classList.contains('active') || !$('#modal').classList.contains('hidden')) return;
    if (e.key === 'Escape') { G.selected = null; G.view && G.view.select(null); }
    else if (e.key === 'u' || e.key === 'z') undo();
    else if (e.key === 'h') hint();
    else if (e.key === 'r') restart();
    else if (/^[1-9]$/.test(e.key)) { const i = Number(e.key) - 1; if (G.board && i < G.board.cups.length) onCupTap(i); }
  });
}

// ---------- 開場：Boot → 公司 Logo（並行下載）→ Loading → 直接落上次關卡 ----------
async function enterCafe(entry) {
  const banner = $('#cafe-banner');
  banner.hidden = false;
  if (entry.reason === 'stage') {
    const st = STAGES.find(s => s.id === entry.stageId) || STAGES[0];
    banner.textContent = `🎉 第 ${st.id} 階段「${st.name}」開張！${st.line}`;
    try { localStorage.removeItem('mc_pending_stage'); } catch { /* ignore */ }
  } else if (entry.reason === 'intro') {
    banner.textContent = '🏪 恭喜過咗 10 關！呢度係你嘅店舖：可以揀關卡、練習，或者睇玩法。';
    try { localStorage.setItem('mc_intro_cafe', '1'); } catch { /* ignore */ }
  } else if (entry.reason === 'reward') {
    banner.textContent = '🎁 有獎勵未領！';
  } else if (entry.reason === 'tournament') {
    banner.textContent = '🏆 賽事已結算，去睇名次！';
  } else banner.hidden = true;
  refreshTitle();
  show('screen-title');
}

async function startApp() {
  bind();
  const boot = new BootFlow({
    logoScreen: $('#screen-logo'), loadingScreen: $('#screen-loading'),
    liquidColors: PALETTE.map(p => p.hex), base: new URL('../../', import.meta.url).href,
  });
  const timing = await boot.run();
  if (!timing) return;                      // 重試畫面已接手（重試成功會再入嚟）
  console.info('[boot]', `logo ${Math.round(timing.logoDone)} ms · total ${Math.round(timing.total)} ms`, timing.fromHostApp ? '(host=app)' : '');
  window.meowcha.bootTiming = timing;

  await loadConfig();
  const levels = await loadLevels().catch(() => null);
  if (!levels) { toast('載入關卡失敗'); return enterCafe({ reason: null }); }
  const entry = decideEntry({ storage: localStorage, progress, levelCount: CAMPAIGN.length });
  if (entry.screen === 'level') await playCampaign(entry.levelId);
  else await enterCafe(entry);
  $('#cafe-banner').onclick = () => { $('#cafe-banner').hidden = true; };
}

// 除錯 / 自動化測試用（正式版可移除）
window.meowcha = { G, server, bg, STAGES, playCampaign, playStageTransition, onCupTap, undo, hint, restart, progress, enterCafe };
startApp();
