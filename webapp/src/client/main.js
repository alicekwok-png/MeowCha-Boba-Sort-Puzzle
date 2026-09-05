// client/main.js — 畫面流程、進度、輸入處理（Spec v2 煉金工房主題）。
// 規則永遠交畀 core/，權威判定交畀 LocalServer，瓶陣渲染交畀 GameView，背景交畀 BackgroundManager（單張圖）。

import { CAMPAIGN, CHAPTERS, PRACTICE } from '../core/levels.js';
import { PALETTE } from '../core/palette.js';
import { unitColor, canInteract } from '../core/board.js';
import { canPour, isSolved, isDead, isComplete } from '../core/rules.js';
import { hash32 } from '../core/prng.js';
import { LocalServer } from './local-server.js';
import { GameView } from './game.js';
import { Sfx } from './audio.js';
import { BackgroundManager, stageForLevel } from './background.js';
import { BootFlow, decideEntry } from './boot.js';
import { ads, adsAllowedForLevel } from './ads.js';
import { hiddenRatio, UNLOCK_LEVEL } from '../core/difficulty.js';
import { ASSET_MAP, CLIENT_SPRITE } from '../config/assets.js';
import { AD_SLOTS, assertAdSlotLimit, CLIENT_ORDER } from '../config/render.js';
import { initI18n, t, has, setLocale, getLocale, getLocales, onLocaleChange, applyDom } from './i18n.js';

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/** 邏輯資產名 → 絕對 URL（全部經 ASSET_MAP，舊 assets/*.webp 唔再引用） */
const asset = (key) => new URL('../../' + ASSET_MAP[key], import.meta.url).href;

// Spec v2 §6：同屏最多 2 個廣告入口 — 啟動即驗，超過就直接炸
assertAdSlotLimit(AD_SLOTS);

const server = new LocalServer({ solverWorkerUrl: new URL('./solver.worker.js', import.meta.url) });
const sfx = new Sfx();
const bg = new BackgroundManager($('#bg-layers'), new URL('../../assets/v2/', import.meta.url).href);

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
/** 試劑名文字：預設關（色塊本身就係訊號）；用戶可喺「點樣玩」開，存 localStorage */
function orderTextOn() {
  try { const v = localStorage.getItem('mc_order_text'); if (v !== null) return v === '1'; } catch { /* ignore */ }
  return !!CONFIG.orderText;
}
/** 廣告解鎖委託槽數量（遠端參數 config.orderSlots.ad；第 1–10 關永遠 0 — 就算 config 寫錯都唔會破） */
function adSlotsFor(levelId) {
  if (!adsAllowedForLevel(levelId)) return 0;
  const r = (CONFIG.orderSlots?.ad || []).find(x => levelId >= x.from && levelId <= x.to);
  return r ? r.count : 0;
}
const hexScale = (hex, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
/** 訂單 / 格值 → 色板項（unit key = colorId | pattern<<4，要先取色位） */
const pal = (v) => PALETTE[unitColor(v)];
/** 試劑名（i18n liquids.*；PALETTE[].zh 只留畀工具 / 舊碼） */
const liquidName = (v) => t('liquids.' + pal(v).key);
/** 關卡標題：正式關用 extra.levels.lN（冇就用 levels.js 原文）；練習關用難度名 */
function levelTitle(level, practice = false) {
  if (practice) return G.practiceDiff ? t('extra.practice.' + G.practiceDiff) : (level.title || '');
  const k = 'extra.levels.l' + level.id;
  return has(k) ? t(k) : (level.title || '');
}
/** 章節標題：第 N 章 · 名（中文用漢字數字） */
function chapterHeading(i) {
  const zh = getLocale().startsWith('zh');
  const n = zh ? ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][i] || String(i + 1) : String(i + 1);
  return t('extra.chapters.heading', { n, name: t('extra.chapters.c' + (i + 1)) });
}

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
  $('#btn-continue').textContent = progress.stars[n] ? t('extra.title.replayLevel', { n }) : (n === 1 ? t('menu.start') : t('extra.title.continueLevel', { n }));
  $('#coins-title').textContent = progress.coins;
  $('#stars-title').textContent = totalStars();
  $('#coins-levels').textContent = progress.coins;
}

/** 星星：UI_star / UI_star_dim 圖（螢幕閱讀器用 sr-only 文字） */
function starsHtml(lit, total = 3, cls = '') {
  const imgs = Array.from({ length: total }, (_, i) =>
    `<img src="${asset(i < lit ? 'UI_star' : 'UI_star_dim')}" alt="" class="${i < lit ? 'on' : 'off'}${cls ? ' ' + cls : ''}">`).join('');
  return `${imgs}<span class="sr-only">${t('extra.hud.starsSr', { n: lit, total })}</span>`;
}

function renderLevelGrid() {
  const grid = $('#level-grid');
  grid.innerHTML = '';
  const unlockedTo = nextLevelId();
  for (const ch of CHAPTERS) {
    const h = document.createElement('div');
    h.className = 'chapter';
    h.textContent = chapterHeading(CHAPTERS.indexOf(ch));
    grid.appendChild(h);
    const g = document.createElement('div');
    g.className = 'chapter-grid';
    for (let id = ch.from; id <= ch.to; id++) {
      const b = document.createElement('button');
      const st = progress.stars[id] || 0;
      const locked = id > unlockedTo && !st;
      b.className = 'lv' + (locked ? ' locked' : '') + (id === unlockedTo ? ' current' : '');
      b.innerHTML = `${id}<span class="st">${st > 0 ? starsHtml(st) : ''}</span>`;   // 0 星唔畫三粒暗星（黃銅底上會誤讀成三星）
      b.title = levelTitle({ id, title: CAMPAIGN[id - 1].title });
      b.addEventListener('click', () => { sfx.click(); playCampaign(id); });
      g.appendChild(b);
    }
    grid.appendChild(g);
  }
}

// ---------- Modal / Toast ----------
function modal(html, { dismiss = false, name = null } = {}) {
  const m = $('#modal');
  G.modalName = name;   // 語言切換時要重繪嘅 modal（help / settings）
  $('#modal-card').innerHTML = html;
  m.classList.remove('hidden');
  m.onclick = dismiss ? (e) => { if (e.target === m) closeModal(); } : null;
}
function closeModal() { $('#modal').classList.add('hidden'); G.modalName = null; }
let toastTimer = null;
function toast(text, ms = 1600) {
  const t = $('#toast');
  t.textContent = text; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---------- 導師（煉金貓）----------
// 對白全部係 i18n key（strings.json catLines / tutorial + extra.tutor），顯示時先 t()
const LINES = {
  idle: ['tutorial.pour', 'tutorial.sameOnly', 'extra.tutor.idleEmpty', 'catLines.idle1', 'extra.tutor.idleOrder'],
  serve: ['extra.tutor.serve1', 'extra.tutor.serve2', 'extra.tutor.serve3', 'catLines.good'],
  almost: ['extra.tutor.almost1', 'extra.tutor.almost2'],
  stuck: ['catLines.stuck', 'extra.tutor.stuck2'],
  clear: ['extra.tutor.clear1', 'extra.tutor.clear2'],
  hint: ['extra.tutor.hint1', 'extra.tutor.hint2'],
  frosted: ['tutorial.frosted'],
  covered: ['extra.tutor.covered'],
  cracked: ['tutorial.cracked'],
  unlock: ['extra.tutor.unlock'],
  pour: ['catLines.pouring'],
  addCup: ['extra.tutor.addCup'],
};
/** 某組對白：指定 index 或隨機一句（已翻譯） */
const line = (mood, i = null) => t(LINES[mood][i === null ? Math.floor(Math.random() * LINES[mood].length) : i]);
/** 導師貓三態：idle（待機）· happy（交貨 / 好事）· cheer（過關，跳起姿勢 + 彈跳） */
const CAT_SRC = { idle: 'CHR_cat_idle', happy: 'CHR_cat_happy', cheer: 'CHR_cat_cheer' };
function cat(state, text) {
  const img = $('#mocha-img');
  const key = CAT_SRC[state] || CAT_SRC.idle;
  const src = asset(key);
  if (img.src !== src) img.src = src;
  if (text !== undefined) $('#mocha-bubble').textContent = text;
  img.classList.remove('hop', 'cheer');
  if (state === 'happy') { void img.offsetWidth; img.classList.add('hop'); }
  else if (state === 'cheer') { void img.offsetWidth; img.classList.add('cheer'); }
}
/** 舊呼叫名（idle / pouring / serve / stuck / almost / clear）映射到三態 + 對白組 */
const MOOD = { idle: 'idle', pouring: 'idle', stuck: 'idle', almost: 'idle', serve: 'happy', clear: 'cheer' };
function mocha(mood, text) {
  const txt = text !== undefined ? text : LINES[mood] ? line(mood) : undefined;
  cat(MOOD[mood] || 'idle', txt);
}

// ---------- 委託人區（Spec v2 §6）----------
const SLOT_COUNT = 4;   // 四位委託人固定顯示：slot i = CLIENT_ORDER[i]（raven → badger → owl → hare）

/**
 * 每個槽位：有委託 = 全彩（filled 就淡化 + ✓）；未解鎖 = 灰態（去飽和 + 亮度 −55%）冇按鈕；
 * 黃銅紋章只出現喺「下一個可解鎖」嗰位，而且只限該關容許廣告（第 1–10 關永遠冇）。
 */
function renderClients(popColor = null, enterIndex = -1) {
  const el = $('#customers');
  const orders = G.board.orders;
  el.innerHTML = '';
  const lockedAds = Math.max(0, G.adTotal - G.adUnlocked);
  const adsOk = !G.practice && adsAllowedForLevel(G.level && G.level.id);
  for (let i = 0; i < SLOT_COUNT; i++) {
    const o = orders[i];
    const slot = document.createElement('div');
    const who = CLIENT_ORDER[i];
    const body = `<img class="body" src="${asset(CLIENT_SPRITE[who])}" alt="${t('extra.hud.client')} · ${t('clients.' + who)}">`;
    if (o) {
      const p = pal(o.color);
      slot.className = 'slot' + (o.filled ? ' done' : '') + (popColor !== null && popColor === o.color ? ' pop' : '') + (enterIndex === i ? ' enter' : '');
      // 色塊托盤：顏色 = 板面液體同一個 hex；文字預設唔顯示（L* > 55 用深啡，否則白）
      const textColor = p.L > 55 ? '#3A2410' : '#FFFFFF';
      const name = liquidName(o.color);
      slot.innerHTML = `${body}
        <div class="tray" style="--c:${p.hex};--cd:${hexScale(p.hex, 0.82)};--ci:${hexScale(p.hex, 0.9)};--ct:${textColor}" title="${name}" aria-label="${name}">${orderTextOn() && !o.filled ? `<span class="name">${name}</span>` : ''}</div>`;
    } else {
      const nextUnlockable = adsOk && lockedAds > 0 && i === orders.length && G.session && server.canAddOrder(G.session.sessionId, G.moves);
      slot.className = 'slot grey';
      slot.innerHTML = `${body}<div class="tray blank" aria-hidden="true"></div>`;
      if (nextUnlockable) {
        const b = document.createElement('button');
        b.className = 'crest-btn'; b.type = 'button';
        b.setAttribute('aria-label', t('extra.hud.crestAria'));
        b.innerHTML = `<img src="${asset('UI_ad_crest')}" alt=""><span>${t('extra.hud.crest')}</span>`;
        b.onclick = () => unlockOrderSlot();
        slot.appendChild(b);
      }
    }
    el.appendChild(slot);
  }
  if (!orders.length && !(adsOk && lockedAds)) {
    const s = document.createElement('span'); s.className = 'customers-note'; s.textContent = t('extra.hud.noOrders');
    el.appendChild(s);
  }
}

/** 廣告解鎖委託槽（AD_SLOTS.unlockOrder）：睇 rewarded video → server 由未完成顏色揀一隻加單 → 委託人入場 */
async function unlockOrderSlot() {
  if (G.busy || G.adUnlocked >= G.adTotal || !adsAllowedForLevel(G.level && G.level.id)) return;
  G.busy = true;
  sfx.click();
  modal(`<img class="crest" src="${asset('UI_ad_crest')}" alt=""><h3>${t('extra.ads.playing')}</h3><div class="spinner"></div><p id="ad-count" style="font-size:13px">${t('extra.ads.afterOrder')}</p>`);
  const ok = await ads.showRewarded(CONFIG.adUnits.extraOrderSlot, { ui: { tick: (n) => { const c = $('#ad-count'); if (c) c.textContent = t('extra.ads.secondsLeft', { n }); } } });
  closeModal();
  if (!ok) { G.busy = false; toast(t('extra.toast.adUnavailable')); return; }   // 廣告失敗：唔扣任何嘢
  let r;
  try { r = server.addOrder(G.session.sessionId, G.moves); } catch (e) { r = { ok: false, reason: e.message }; }
  if (!r.ok) { G.busy = false; toast(t('extra.toast.noOrderColor')); return; }
  G.adUnlocked++;
  applyBoard(r.maskedBoard);
  sfx.deliver();
  mocha('serve', t('extra.ads.newClient', { liquid: liquidName(r.color) }));
  renderClients(null, G.board.orders.length - 1);   // 入場動畫：由頂部滑落 + 托盤淡入
  await sleep(600);
  G.busy = false;
  updatePace();
}

/** 廣告加空燒瓶（AD_SLOTS.addEmptyBottle，第 11 關起）：每關一次；成功就 server append 一隻空瓶 */
async function addEmptyCup() {
  if (G.busy || G.cupAdded || !canOfferEmptyCup()) return;
  G.busy = true;
  sfx.click();
  modal(`<img class="crest" src="${asset('UI_ad_crest')}" alt=""><h3>${t('extra.ads.playing')}</h3><div class="spinner"></div><p id="ad-count" style="font-size:13px">${t('extra.ads.afterVial')}</p>`);
  const ok = await ads.showRewarded(CONFIG.adUnits.extraEmptyCup, { ui: { tick: (n) => { const c = $('#ad-count'); if (c) c.textContent = t('extra.ads.secondsLeft', { n }); } } });
  closeModal();
  if (!ok) { G.busy = false; toast(t('extra.toast.adUnavailable')); return; }
  let r;
  try { r = server.addEmptyCup(G.session.sessionId, G.moves); } catch (e) { r = { ok: false, reason: e.message }; }
  if (!r.ok) { G.busy = false; toast(t('extra.toast.noMoreVials')); return; }
  G.cupAdded = true;
  G.selected = null; G.view.select(null); G.view.clearHint();
  applyBoard(r.maskedBoard);
  sfx.unlock();
  mocha('serve', line('addCup', 0));
  await sleep(400);
  G.busy = false;
  updatePace();
}
/** 玩區紋章出現條件：非練習、≥ 第 11 關、該關容許廣告、未用過、而且冇任何可用空瓶 */
function canOfferEmptyCup() {
  if (!G.level || G.practice || G.cupAdded) return false;
  if (!adsAllowedForLevel(G.level.id) || G.level.id < UNLOCK_LEVEL.adEmptyCup) return false;
  const empties = G.board.cups.filter(c => c.seg.length === 0 && canInteract(c) && c.kind !== 'cracked').length;
  return empties <= 0;
}
function updateAddCupButton() {
  const b = $('#btn-add-cup');
  if (b) b.hidden = !canOfferEmptyCup();
}

// ---------- 遊戲狀態 ----------
const G = {
  view: null, level: null, session: null, board: null, moves: [], ts: [], history: [],
  selected: null, busy: false, solved: false, startedAt: 0, practice: false, hints: 0, bgReady: false,
  adTotal: 0, adUnlocked: 0,   // 廣告委託槽：當關有效，重來 / 過關重置
  cupAdded: false,             // 廣告空瓶：每關只一次
  practiceDiff: null,          // 練習難度（easy / medium / hard）→ 副標題用 extra.practice.*
  modalName: null,             // 而家開住嘅 modal（help / settings）：語言切換時重繪
};

/**
 * 遮罩盤面 → 標註 → 交畀 GameView。
 * cup.unlockIn：第 k 隻仲鎖住嘅布遮瓶（按 index 順序）會喺第 k 次解鎖時揭開；解鎖發生喺 delivered 去到下一個偶數時。
 */
function annotateBoard(board) {
  const d = board.delivered || 0;
  let k = 0;
  for (const c of board.cups) c.unlockIn = (c.kind === 'covered' && c.locked) ? (2 * Math.floor(d / 2) + 2 * (++k) - d) : 0;
  return board;
}
function applyBoard(board) {
  G.board = annotateBoard(board);
  G.view.setBoard(G.board);
  updateAddCupButton();
}

function updatePace() {
  const n = G.moves.length, th = G.session.starThresholds, limit = G.session.moveLimit;
  const lit = n <= th.three ? 3 : n <= th.two ? 2 : 1;
  $('#pace-stars').innerHTML = starsHtml(lit);
  const pace = $('#pace');
  pace.classList.remove('warn', 'danger');
  if (limit === null || limit === undefined) {
    $('#pace-moves').textContent = t('hud.moves', { n });
  } else {
    // 步數上限（工單 #5）：剩 5 步變琥珀，剩 2 步變紅 + 脈動；Undo 會扣返（n = G.moves.length）
    const left = limit - n;
    $('#pace-moves').textContent = t('hud.movesOf', { n, max: limit });
    if (left <= 2) pace.classList.add('danger'); else if (left <= 5) pace.classList.add('warn');
  }
  pace.title = limit ? t('extra.hud.paceTitleLimit', { n, max: limit, three: th.three, opt: G.session.optimalMoves }) : t('extra.hud.paceTitle', { n, three: th.three, opt: G.session.optimalMoves });
  $('#btn-undo').disabled = G.moves.length === 0 || G.busy;
}

/** 步數用晒（未過關）：只可以撤銷或重來 */
function showOutOfMoves() {
  modal(`
    <img class="mascot" src="${asset('CHR_cat_idle')}" alt="">
    <h3>${t('extra.modals.outOfMoves')}</h3>
    <p>${t('extra.modals.outOfMovesBody', { n: G.session.moveLimit })}</p>
    <div class="row">
      ${$('#btn-undo').hidden ? '' : `<button class="btn" id="m-undo">↶ ${t('actions.undo')}</button>`}
      <button class="btn primary" id="m-restart">↻ ${t('actions.restart')}</button>
    </div>
  `);
  if ($('#m-undo')) $('#m-undo').onclick = () => { closeModal(); undo(); };
  $('#m-restart').onclick = () => { closeModal(); restart(); };
}

/** 可以揀嚟倒出：可操作（布遮瓶未解鎖唔得）、有嘢、未完成 */
function canBeSource(cup) {
  return canInteract(cup) && cup.seg.length > 0 && !isComplete(cup);
}
/** 練習關 id 係字串（p:seed）→ 版面種子用 hash；正式關直接用關卡號 */
const layoutSeedFor = (level) => (typeof level.id === 'number' ? level.id : hash32(String(level.id)));

async function startLevel(levelData, { practice = false, diff = null } = {}) {
  G.level = levelData; G.practice = practice; G.practiceDiff = practice ? (diff || G.practiceDiff) : null;
  const st = server.start(levelData);
  G.session = st;
  G.moves = []; G.ts = []; G.history = []; G.selected = null; G.busy = false; G.solved = false; G.hints = 0;
  G.adTotal = practice ? 0 : adSlotsFor(levelData.id); G.adUnlocked = 0; G.cupAdded = false;
  G.startedAt = performance.now();
  if (!practice) { progress.last = levelData.id; saveProgress(); }   // 續玩：下次直接落返呢關
  // 機制登場表：Undo 第 5 關起、提示第 14 關起先顯示（練習模式全部開）
  $('#btn-undo').hidden = !practice && levelData.id < UNLOCK_LEVEL.undo;
  $('#btn-hint').hidden = !practice && levelData.id < UNLOCK_LEVEL.hint;
  if (!G.view) G.view = new GameView($('#board'), { onCupTap });
  if (typeof G.view.setLevelId === 'function') G.view.setLevelId(layoutSeedFor(levelData));   // 版面（safeLayout）以關卡號做種子，同關每次一樣
  applyBoard(st.maskedBoard);
  G.view.select(null);
  G.view.clearHint();
  renderLevelHeader();

  // 單張背景（Spec v2 §7）：只 set 一次，冇階段過渡
  if (!G.bgReady) { bg.setStage(stageForLevel(typeof levelData.id === 'number' ? levelData.id : 1)); G.bgReady = true; }

  show('screen-game');
  updatePace();
  renderClients();
  const frosted = G.board.cups.some(c => c.kind === 'frosted');
  const covered = G.board.cups.some(c => c.kind === 'covered' && c.locked);
  const cracked = G.board.cups.some(c => c.kind === 'cracked');
  const tip = covered && Math.random() < 0.6 ? line('covered', 0) : frosted && Math.random() < 0.6 ? line('frosted', 0) : cracked && Math.random() < 0.5 ? line('cracked', 0) : undefined;
  mocha('idle', tip);
}

async function playCampaign(id) {
  const levels = await loadLevels();
  const l = levels.get(id);
  if (!l) { toast(t('extra.toast.levelMissing')); return; }
  await startLevel(l);
}

// ---------- 走步 ----------
/** 唔可以揀 / 唔可以倒入嘅瓶：震一震 + 講原因 */
function rejectTap(idx, cup) {
  G.view.shake(idx); sfx.shake();
  if (cup.kind === 'covered' && cup.locked) toast(t('extra.toast.clothLocked', { n: cup.unlockIn || 1 }));
}

async function onCupTap(idx) {
  if (G.busy) return;
  const cup = G.board.cups[idx];
  if (!cup) return;

  if (G.selected === null) {
    if (canBeSource(cup)) { G.selected = idx; G.view.select(idx); sfx.select(); }
    else rejectTap(idx, cup);
    return;
  }
  if (G.selected === idx) { G.selected = null; G.view.select(null); sfx.deselect(); return; }

  const m = { from: G.selected, to: idx };
  if (G.session.moveLimit !== null && G.moves.length >= G.session.moveLimit) { showOutOfMoves(); return; }
  if (!canPour(G.board, m.from, m.to)) {
    // 裂瓶做目標：一律震 + 提示（就算佢本身可以做來源），否則玩家以為係自己撳錯
    if (cup.kind === 'cracked') { rejectTap(idx, cup); toast(t('extra.toast.crackedOnly')); return; }
    if (canBeSource(cup)) { G.selected = idx; G.view.select(idx); sfx.select(); }
    else rejectTap(idx, cup);
    return;
  }

  // ---- 樂觀執行 ----
  G.busy = true; G.selected = null; G.view.select(null); G.view.clearHint();
  $('#btn-undo').disabled = true; $('#btn-hint').disabled = true; $('#btn-add-cup').hidden = true;
  const src = G.board.cups[m.from];
  const unitKey = src.seg[src.seg.length - 1];
  const prevBoard = G.board;
  const nextMoves = [...G.moves, m];
  let n, next, events = [];

  // 每一步都經 server（LocalServer 係同步嘅，回應被倒液動畫遮蓋）：client 手上只有遮罩盤面，
  // 本地 applyMove 會出錯——倒入磨砂瓶時隱藏格可能同色（真實倒出量 / 完成判定唔同）、布遮瓶解鎖後隱藏格仍係 null。
  // Review 揪出嘅兩個 blocker 都係呢個原因，所以唔再樂觀計算。
  try {
    const r = server.reveal(G.session.sessionId, nextMoves);
    n = r.poured; next = r.maskedBoard; events = r.events;
  } catch (err) {
    // server 唔認呢步（盤面分岔）：重新同步遮罩盤面、震一震，唔好卡死
    console.warn('[move] server rejected', err);
    try { applyBoard(server.reveal(G.session.sessionId, G.moves).maskedBoard); } catch { /* ignore */ }
    G.view.shake(idx); sfx.shake();
    G.busy = false; $('#btn-undo').disabled = G.moves.length === 0; $('#btn-hint').disabled = false; updateAddCupButton();
    return;
  }

  G.moves = nextMoves; G.ts.push(Math.round(performance.now() - G.startedAt)); G.history.push(prevBoard);
  mocha('pouring', line('pour', 0));
  sfx.pour(n);
  bg.onPour();                                   // 單張背景下係 no-op，保留接口
  await G.view.animatePour(m.from, m.to, n, unitKey);

  applyBoard(next);
  updatePace();

  // 結算事件動畫
  let served = false;
  for (const ev of events) {
    if (ev.type === 'deliver') {
      served = true; sfx.deliver();
      renderClients(ev.color);
      mocha('serve');
      await G.view.animateDeliver(ev.cup, `✓ ${liquidName(ev.color)} ${t('clients.deliver')}`);
    } else if (ev.type === 'unlock') {
      // 布遮瓶解鎖：繩鬆 → 布滑上 → 塵粒 → 顏色同圖案一齊淡入（動畫由 GameView 負責）
      sfx.unlock(); mocha('serve', line('unlock', 0));
      await G.view.animateUnlock(ev.cup);
      renderClients();
    }
  }
  G.view.setBoard(G.board);
  G.busy = false;
  $('#btn-hint').disabled = false;
  updatePace();
  updateAddCupButton();
  if (!served) renderClients();

  if (isSolved(G.board)) { await onSolved(); return; }
  if (isDead(G.board)) { mocha('stuck'); sfx.stuck(); await sleep(350); showStuck(); return; }
  if (G.session.moveLimit !== null && G.moves.length >= G.session.moveLimit) { mocha('stuck', t('extra.tutor.outOfMoves')); sfx.stuck(); await sleep(350); showOutOfMoves(); return; }
  if (!served) {
    const left = G.board.orders.filter(o => !o.filled).length;
    const segsLeft = G.board.cups.reduce((a, c) => a + c.seg.filter((v, i) => i === 0 || v !== c.seg[i - 1]).length, 0);
    if (segsLeft - G.board.colors <= 2 || (G.board.orders.length && left === 1 && Math.random() < 0.5)) mocha('almost');
    else mocha('idle', Math.random() < 0.25 ? undefined : $('#mocha-bubble').textContent === line('pour', 0) ? line('idle', 0) : $('#mocha-bubble').textContent);
  }
}

async function undo() {
  if (G.busy || !G.moves.length || $('#btn-undo').hidden) return;
  G.moves.pop(); G.ts.pop();
  G.history.pop();
  const r = server.reveal(G.session.sessionId, G.moves);   // 由 server 取回同步後嘅遮罩盤面（已露出嘅格保留）
  G.selected = null; G.view.select(null); G.view.clearHint();
  applyBoard(r.maskedBoard);
  sfx.undo();
  updatePace(); renderClients();
  mocha('idle', t('extra.tutor.undo'));
}

async function hint() {
  if (G.busy || $('#btn-hint').hidden) return;
  G.busy = true; $('#btn-hint').disabled = true;
  mocha('idle', t('extra.tutor.thinking'));
  try {
    const r = await server.hint(G.session.sessionId, G.moves);
    if (!r.move) { mocha('stuck', t('extra.tutor.noHint')); }
    else {
      G.hints++;
      G.selected = null; G.view.select(null);
      G.view.showHint(r.move.from, r.move.to);
      sfx.hint();
      mocha('idle', `${line('hint')} ${t('extra.tutor.hintLeft', { n: r.remaining })}`);
    }
  } catch (e) {
    toast(t('extra.toast.hintUnavailable'));
    console.error(e);
  }
  G.busy = false; $('#btn-hint').disabled = false; updatePace();
}

function restart() {
  if (G.busy && !G.solved) return;   // 過關後 onSolved 會鎖住 busy，「再玩」要照樣可以重開
  sfx.click();
  startLevel(G.level, { practice: G.practice });
}

// ---------- 完成 / 卡關 ----------
async function onSolved() {
  G.busy = true; G.solved = true;
  $('#btn-add-cup').hidden = true;
  mocha('clear');
  sfx.win();
  G.view.animateWin();
  const res = server.complete(G.session.sessionId, {
    moves: G.moves, clientElapsedMs: Math.round(performance.now() - G.startedAt), moveTimestamps: G.ts,
  });
  await sleep(700);
  if (!res.verified) {
    modal(`<img class="mascot" src="${asset('CHR_cat_idle')}" alt=""><h3>${t('extra.modals.verifyFailed')}</h3><p>${res.reason}</p>
      <div class="row"><button class="btn" id="m-retry">${t('extra.modals.retry')}</button></div>`);
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
  modal(`
    <img class="mascot cheer" src="${asset('CHR_cat_cheer')}" alt="">
    <h3>${G.practice ? t('extra.practice.complete') : t('extra.modals.levelComplete', { n: G.level.id })}</h3>
    <div class="stars">${starsHtml(res.stars)}</div>
    <p class="verdict" style="font-size:13px;margin:0">${t('results.stars' + Math.max(1, Math.min(3, res.stars)))}</p>
    <div class="result">
      <div><span class="lbl">${t('extra.modals.lblMoves')}</span><b>${res.moves}</b></div>
      <div><span class="lbl">${t('extra.modals.lblBest')}</span><b>${res.optimal}</b></div>
      <div><span class="lbl">${t('extra.modals.lblThree')}</span><b>≤ ${G.session.starThresholds.three}</b></div>
      <div><span class="lbl">${t('hud.coins')}</span><b>+${coins}</b></div>
    </div>
    ${res.stars < 3 ? `<p style="font-size:13px">${res.moves > G.session.starThresholds.two ? t('extra.modals.wonAnyway') : t('extra.modals.closeCall')}</p>` : `<p style="font-size:13px">${t('extra.modals.perfect')}</p>`}
    <div class="row">
      <button class="btn" id="m-replay">${t('extra.modals.replay')}</button>
      ${G.practice ? `<button class="btn primary" id="m-practice">${t('extra.practice.again')}</button>`
        : isLast ? '' : `<button class="btn primary" id="m-next">${t('actions.next')} ›</button>`}
    </div>
    <div class="row"><button class="btn ghost" id="m-menu">${t('extra.hud.backToLab')}</button></div>
  `);
  $('#m-replay').onclick = () => { closeModal(); restart(); };
  $('#m-menu').onclick = () => { closeModal(); refreshTitle(); show('screen-title'); };
  if ($('#m-next')) $('#m-next').onclick = () => { closeModal(); playCampaign(G.level.id + 1); };
  if ($('#m-practice')) $('#m-practice').onclick = () => { closeModal(); pickPractice(); };
}

function showStuck() {
  modal(`
    <img class="mascot" src="${asset('CHR_cat_idle')}" alt="">
    <h3>${t('results.noMoves')}</h3>
    <p>${t('extra.modals.stuckBody')}</p>
    <div class="row">
      ${$('#btn-undo').hidden ? '' : `<button class="btn" id="m-undo">↶ ${t('actions.undo')}</button>`}
      <button class="btn primary" id="m-restart">↻ ${t('actions.restart')}</button>
    </div>
  `);
  if ($('#m-undo')) $('#m-undo').onclick = () => { closeModal(); undo(); };
  $('#m-restart').onclick = () => { closeModal(); restart(); };
}

// ---------- 練習模式 ----------
function pickPractice() {
  modal(`
    <h3>${t('menu.practice')}</h3>
    <p style="font-size:13px">${t('extra.practice.desc')}</p>
    <div class="diff">
      <button class="btn" data-d="easy">${t('extra.practice.easy')}<small>${t('extra.practice.easySub')}</small></button>
      <button class="btn" data-d="medium">${t('extra.practice.medium')}<small>${t('extra.practice.mediumSub')}</small></button>
      <button class="btn primary" data-d="hard">${t('extra.practice.hard')}<small>${t('extra.practice.hardSub')}</small></button>
    </div>
    <div class="row"><button class="btn ghost" id="m-close">${t('actions.cancel')}</button></div>
  `, { dismiss: true, name: 'practice' });
  $('#m-close').onclick = closeModal;
  document.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
    const cfg = PRACTICE[b.dataset.d];
    sfx.click();
    modal(`<img class="mascot" src="${asset('CHR_cat_idle')}" alt=""><h3>${t('extra.practice.generating')}</h3><div class="spinner"></div><p style="font-size:13px">${t('extra.practice.generatingSub')}</p>`);
    try {
      const seed = `v1:p:${b.dataset.d}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
      const pseudo = { easy: 8, medium: 15, hard: 25 }[b.dataset.d];   // 練習難度對應假關卡號：隱藏密度照公式
      // 先用 4 秒預算；唔夠時間就放寬 config（冇裂瓶 / 布遮、最優區間放寬）再試 4 秒，最後先放棄
      let lvl = await server.generatePractice({ ...cfg, hiddenRatio: hiddenRatio(pseudo) }, seed, { budgetMs: 4000 });
      if (!lvl) {
        const relaxed = { ...cfg, cracked: 0, covered: 0, orders: Math.min(cfg.orders, 1), optimalMax: cfg.optimalMax + 8, hiddenRatio: hiddenRatio(pseudo) };
        lvl = await server.generatePractice(relaxed, seed + ':r', { budgetMs: 4000 });
      }
      closeModal();
      if (!lvl) { toast(t('extra.practice.genFailed')); return; }
      await startLevel(lvl, { practice: true, diff: b.dataset.d });
    } catch (e) {
      closeModal(); toast(t('extra.practice.genError', { msg: e.message })); console.error(e);
    }
  });
}

// ---------- 說明（只講規則；設定項已搬去設定 modal）----------
function showHelp() {
  const pic = (imgs) => `<div class="pic">${imgs.map(([k, cls]) => `<img src="${asset(k)}" alt="" class="${cls || ''}">`).join('')}</div>`;
  const cup = (imgs, name, desc) => `<div class="cuptype">${pic(imgs)}<div><b>${name}</b><span>${desc}</span></div></div>`;
  modal(`
    <h3>${t('menu.howToPlay')}</h3>
    <div class="help">
      <h4>${t('extra.help.basics')}</h4>
      <ul>
        <li>${t('tutorial.pour')}</li>
        <li>${t('extra.help.b2')}</li>
        <li>${t('extra.help.b3')}</li>
        <li>${t('extra.help.b4')}</li>
      </ul>
      <h4>${t('extra.help.clients')}</h4>
      <ul><li>${t('extra.help.c1')}</li></ul>
      <h4>${t('extra.help.vessels')}</h4>
      <div class="cuptypes">
        ${cup([['VES_flask_empty']], t('vessels.flask'), t('extra.help.flaskDesc'))}
        ${cup([['VES_flask_frosted']], t('vessels.frosted'), t('extra.help.frostedDesc'))}
        ${cup([['VES_flask_empty'], ['VES_cloth_cover', 'cloth'], ['VES_wax_seal', 'wax'], ['VES_wax_ring', 'wax']], t('vessels.cloth'), t('extra.help.clothDesc'))}
        ${cup([['VES_retort_empty']], t('vessels.retort'), t('extra.help.retortDesc'))}
        ${cup([['VES_flask_cracked']], t('vessels.cracked'), t('extra.help.crackedDesc'))}
      </div>
      <h4>${t('extra.help.tools')}</h4>
      <ul><li>${t('extra.help.t1')}</li></ul>
    </div>
    <div class="row"><button class="btn primary" id="m-ok">${t('extra.modals.ok')}</button></div>
  `, { dismiss: true, name: 'help' });
  $('#m-ok').onclick = closeModal;
}

// ---------- 設定（語言 / 音效 / 無障礙 / 重置進度 / 製作名單）----------
function showSettings() {
  const cur = getLocale();
  const langBtns = getLocales().map(l => `<button class="btn${l === cur ? ' primary' : ''}" data-lang="${l}" type="button">${t('languageNames.' + l)}</button>`).join('');
  modal(`
    <h3>${t('menu.settings')}</h3>
    <div class="help settings">
      <h4>${t('settings.language')}</h4>
      <div class="row lang" style="margin-top:6px">${langBtns}</div>
      <h4>${t('settings.sound')}</h4>
      <div class="row" style="margin-top:6px"><button class="btn" id="s-sound" type="button">${sfx.muted ? '🔇 ' + t('extra.settings.off') : '🔊 ' + t('extra.settings.on')}</button></div>
      <h4>${t('extra.settings.accessibility')}</h4>
      <label style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700"><input type="checkbox" id="opt-order-text" ${orderTextOn() ? 'checked' : ''}> ${t('extra.settings.orderText')}</label>
      <h4>${t('settings.resetProgress')}</h4>
      <div class="row" style="margin-top:6px"><button class="btn" id="s-reset" type="button">${t('settings.resetProgress')}</button></div>
      <h4>${t('settings.credits')}</h4>
      <p style="font-size:13px;margin:0">${t('extra.settings.creditsLine')}</p>
    </div>
    <div class="row"><button class="btn primary" id="m-ok">${t('actions.back')}</button></div>
  `, { dismiss: true, name: 'settings' });
  $('#m-ok').onclick = closeModal;
  document.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { sfx.click(); setLocale(b.dataset.lang); });   // onLocaleChange → refreshTexts 會重繪呢個 modal
  $('#s-sound').onclick = () => { sfx.setMuted(!sfx.muted); syncMute(); if (!sfx.muted) sfx.click(); showSettings(); };
  $('#opt-order-text').onchange = (e) => {
    try { localStorage.setItem('mc_order_text', e.target.checked ? '1' : '0'); } catch { /* ignore */ }
    if (G.board) renderClients();
  };
  $('#s-reset').onclick = () => {
    sfx.click();
    modal(`
      <img class="mascot" src="${asset('CHR_cat_idle')}" alt="">
      <h3>${t('settings.resetProgress')}</h3>
      <p>${t('extra.modals.resetConfirm')}</p>
      <div class="row">
        <button class="btn" id="r-cancel">${t('actions.cancel')}</button>
        <button class="btn primary" id="r-ok">${t('actions.confirm')}</button>
      </div>
    `, { name: 'reset' });
    $('#r-cancel').onclick = () => showSettings();
    $('#r-ok').onclick = () => {
      try { localStorage.removeItem(PKEY); } catch { /* ignore */ }
      progress.stars = {}; progress.coins = 0; delete progress.last;
      closeModal();
      refreshTitle();
      show('screen-title');
      toast(t('extra.settings.resetDone'));
    };
  };
}

/** 頂欄關卡名（第 N 關 / 練習 + 副標題）；語言切換時亦會重跑 */
function renderLevelHeader() {
  if (!G.level) return;
  $('#game-level-no').textContent = G.practice ? t('extra.hud.practice') : t('hud.level', { n: G.level.id });
  $('#game-level-title').textContent = levelTitle(G.level, G.practice);
}

/** 語言切換：靜態 DOM 由 setLocale → applyDom 填；呢度重繪所有動態文字 */
function refreshTexts() {
  refreshTitle();
  if (G.bannerReason && !$('#cafe-banner').hidden) $('#cafe-banner').textContent = t('extra.banner.' + G.bannerReason);
  if ($('#screen-levels').classList.contains('active')) renderLevelGrid();
  if (G.level && G.session) {
    renderLevelHeader();
    updatePace();
    renderClients();
    if (!G.busy) mocha('idle', line('idle', 0));   // 對白：換返預設第一句（舊句係另一種語言）
  }
  syncMute();
  if (G.modalName === 'help') showHelp();
  else if (G.modalName === 'settings') showSettings();
  else if (G.modalName === 'practice') pickPractice();
}

function syncMute() { const b = $('#btn-mute'); if (b) b.textContent = sfx.muted ? '🔇' : '🔊'; }

// ---------- 綁定 ----------
function bind() {
  $('#btn-continue').onclick = () => { sfx.click(); playCampaign(nextLevelId()); };
  $('#btn-levels').onclick = () => { sfx.click(); renderLevelGrid(); refreshTitle(); show('screen-levels'); };
  $('#btn-practice').onclick = () => { sfx.click(); pickPractice(); };
  $('#btn-help').onclick = () => { sfx.click(); showHelp(); };
  $('#btn-settings-title').onclick = () => { sfx.click(); showSettings(); };
  $('#btn-settings-game').onclick = () => { if (G.busy) return; sfx.click(); showSettings(); };
  $('#btn-levels-back').onclick = () => { sfx.click(); refreshTitle(); show('screen-title'); };
  // 關卡角落（UI_sys_shop）→ 返回工房（主畫面）
  $('#btn-game-back').onclick = () => {
    if (G.busy) return;
    sfx.click(); refreshTitle();
    show('screen-title');
  };
  $('#btn-undo').onclick = undo;
  $('#btn-hint').onclick = hint;
  $('#btn-restart').onclick = restart;
  $('#btn-add-cup').onclick = addEmptyCup;
  $('#btn-mute').onclick = () => { sfx.setMuted(!sfx.muted); syncMute(); if (!sfx.muted) sfx.click(); };
  syncMute();
  // HTML 入面嘅頂欄 placeholder（第 1 關 / 0 步）換成當前語言，避免任何畫面殘留中文
  $('#game-level-no').textContent = t('hud.level', { n: 1 }); $('#pace-moves').textContent = t('hud.moves', { n: 0 });
  onLocaleChange(refreshTexts);
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
  G.bannerReason = ['intro', 'reward', 'tournament'].includes(entry.reason) ? entry.reason : null;
  if (entry.reason === 'intro') {
    banner.textContent = t('extra.banner.intro');
    try { localStorage.setItem('mc_intro_cafe', '1'); } catch { /* ignore */ }
  } else if (entry.reason === 'reward') {
    banner.textContent = t('extra.banner.reward');
  } else if (entry.reason === 'tournament') {
    banner.textContent = t('extra.banner.tournament');
  } else {
    banner.hidden = true;
    // 舊版遺留嘅階段旗標（階段過渡已取消）：清走就算
    if (entry.reason === 'stage') { try { localStorage.removeItem('mc_pending_stage'); } catch { /* ignore */ } }
  }
  refreshTitle();
  show('screen-title');
}

async function startApp() {
  await initI18n();   // 字串表要喺任何畫面文字（包括 boot loading tips）之前就緒；initI18n 會即刻 applyDom 填靜態 DOM
  bind();
  const boot = new BootFlow({
    logoScreen: $('#screen-logo'), loadingScreen: $('#screen-loading'),
    liquidColors: PALETTE.map(p => p.hex), base: new URL('../../', import.meta.url).href,
  });
  // 瓶陣貼圖 / 幾何（vessels.json）由 GameView 自己預載，同 boot 批次並行
  const viewReady = (typeof GameView.preload === 'function' ? GameView.preload() : Promise.resolve()).catch(e => { console.warn('[GameView.preload]', e); });
  const timing = await boot.run();
  if (!timing) return;                      // 重試畫面已接手（重試成功會再入嚟）
  console.info('[boot]', `logo ${Math.round(timing.logoDone)} ms · total ${Math.round(timing.total)} ms`, timing.fromHostApp ? '(host=app)' : '');
  window.meowcha.bootTiming = timing;

  await loadConfig();
  await viewReady;
  const levels = await loadLevels().catch(() => null);
  if (!levels) { toast(t('extra.toast.levelsLoadFailed')); return enterCafe({ reason: null }); }
  const entry = decideEntry({ storage: localStorage, progress, levelCount: CAMPAIGN.length });
  if (entry.screen === 'level') await playCampaign(entry.levelId);
  else await enterCafe(entry);
  $('#cafe-banner').onclick = () => { $('#cafe-banner').hidden = true; };
}

// 除錯 / 自動化測試用（正式版可移除）
window.meowcha = { G, server, bg, CONFIG, playCampaign, onCupTap, undo, hint, restart, progress, enterCafe, unlockOrderSlot, addEmptyCup, setLocale, getLocale, t, showSettings, showHelp };
startApp();
