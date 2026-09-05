// client/game.js — Canvas 渲染 + 輸入 + 倒液動畫（實作指令 v4：深色單一樽型 + 純色液體）。只負責「畫」同「接觸控」，規則全部喺 core/。
//
// 層序：瓶底投影 → 整瓶背後柔光 → 深色樽身 sprite → 液體（純色 source-over，唔乘玻璃）→ 玻璃高光（screen，只取 luma > 215）
//       → 左側高光柱（screen）→ 配料圖案 → 液面高光線（頂帶 3px）→ `?` 隱藏格字 → 木塞（已封）→ 廣告紋章 → 布 → 蠟封 → 黃銅框 → 徽章
// 版面：core/layout.js safeLayout()（seed = levelId，R2 永不遮液體）；樽高 = LAYOUT.bottleHeightRatio × 螢幕高，
//       全部樽同一尺寸；放唔落先統一縮細（console.warn）。?jitter=0 強制純網格。
// 種類（core/board.js KINDS）：
//   normal   全部可見；純色滿樽而冇訂單 → 「已封」：木塞 + 去飽和 25% + 疊 #0A0806 @ 18%
//   hidden   只顯示頂格，下面每格畫 `?`（襯線體，#9A8B6F），新露出嘅格 160 ms 淡入
//   covered  布全遮 + 蠟封顯示頂格色 + 「N 單」徽章；鎖死；解鎖 → animateUnlock 布揭開動畫
//   ad       深色樽 + 中央 UI_ad_crest + 燭光；撳一下（main.js 播廣告）→ animateAdUnlock → 變 normal 空樽
//   gone     已交貨飛走：唔畫、唔 hit-test，但版面位置保留
// 硬規則（v4 §1.2 / §7）：液體帶中央 pixel 必須完全等於色板 hex —— 高光柱只落喺樽闊 16–24%、液面線只落頂帶頂 3px。

import { t } from './i18n.js';
import { PALETTE } from '../core/palette.js';
import { unitColor, unitPattern } from '../core/board.js';
import { COLORS } from '../config/theme.js';
import { LAYOUT, CLOTH } from '../config/layout.js';
import { RENDER, patternUV } from '../config/render.js';
import { safeLayout, computeLayout, chooseColumns, columnsFor } from '../core/layout.js';
import { renderAssets, preloadRenderAssets, geomFor, spriteKey, extentsAt, bandPolygon } from './render-assets.js';

const cubicInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };   // 落塞：衝過位少少再回彈
const cubicOut = t => 1 - Math.pow(1 - t, 3);
const backOut = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const clamp01 = t => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;
const FONT = '"Noto Serif TC", "Source Han Serif TC", "Noto Serif CJK TC", "Songti TC", "PMingLiU", Georgia, "Times New Roman", serif';   // 同 styles.css --font 一致：襯線

/** unit key → 液體 hex（colour 可能係 unit key，亦兼容純 colorId） */
const hexOf = (u) => (PALETTE[unitColor(u)] || PALETTE[0]).hex;

/** hex → [r, g, b] */
function rgbOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** hex → rgba(…, alpha) */
function rgba(hex, alpha) {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}


/** 已封樽液色（v4 §2.2）：去飽和 desaturate × k，再疊 overlay @ overlayAlpha × k（k = 動畫進度 0–1）→ [r, g, b] */
function sealedRgb(hex, k) {
  const S = RENDER.sealedBottle;
  const [r0, g0, b0] = rgbOf(hex);
  const [orr, og, ob] = rgbOf(S.overlay);
  const grey = 0.299 * r0 + 0.587 * g0 + 0.114 * b0;
  const d = S.desaturate * k, o = S.overlayAlpha * k;
  const mix = (v, ov) => { const s = v + (grey - v) * d; return Math.round(s + (ov - s) * o); };
  return [mix(r0, orr), mix(g0, og), mix(b0, ob)];
}

/** HSL 明度偏移（配料墨 = 該層色 −28% L），回傳 rgba 字串 */
function shiftL(hex, dL, alpha = 1) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, sat = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const L = clamp01(l + dL);
  const hue2rgb = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  let R, G, B;
  if (sat === 0) R = G = B = L;
  else { const q = L < 0.5 ? L * (1 + sat) : L + sat - L * sat, pp = 2 * L - q; R = hue2rgb(pp, q, h + 1 / 3); G = hue2rgb(pp, q, h); B = hue2rgb(pp, q, h - 1 / 3); }
  return `rgba(${Math.round(R * 255)},${Math.round(G * 255)},${Math.round(B * 255)},${alpha})`;
}

/** 純色滿樽（全部格可見、同一 unit）→ 可以封存 */
function isSealedSeg(seg, cap) {
  if (seg.length !== cap || cap <= 0) return false;
  const u = seg[0];
  if (u === null || u === undefined) return false;
  for (let i = 1; i < seg.length; i++) if (seg[i] !== u) return false;
  return true;
}

const PARAMS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const FORCE_GRID = PARAMS.get('jitter') === '0';
const LIFT_PX = 16;                 // 選中提起高度
const HOLD_TIMEOUT_MS = 2500;       // setBoard 後等唔到 animateUnlock / animateAdUnlock → 自動補播（防止卡住舊畫面）
const PENDING_TIMEOUT_MS = 2500;    // setBoard 後等唔到 animateDeliver / animateFlyToSlot → 直接放棄保留嘅液體
const SEAL_TIMEOUT_MS = 1500;       // setBoard 後等唔到 animateSeal → 自動加塞
const PAT_NAMES = ['P0', 'P1', 'P2', 'P3', 'P4'];
const CORK_BODY = '#8A6538', CORK_DARK = '#5A4020', CORK_LIGHT = '#B48C5A';   // 木塞：黃銅棕
const SEAL_DONE = Object.freeze({ cork: 1, desat: 1 });

export class GameView {
  /** 預載全部渲染素材（main 可以喺 boot 時先 call） */
  static preload() { return preloadRenderAssets(); }

  constructor(canvas, { onCupTap } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onCupTap = onCupTap || (() => {});
    this.cups = [];
    this.selected = null;
    this.interactive = true;
    this.levelId = 1;
    this.particles = [];
    this.floaters = [];
    this.streams = [];
    this.hintArrow = null;
    this.drawOrder = [];
    this._sealCache = new Map();    // `${colorId}:${size}` → tinted 蠟封 canvas
    this._scratch = document.createElement('canvas');   // 配料墨用
    this.W = 1; this.H = 1;
    preloadRenderAssets().then(() => { this._sealCache.clear(); this.layout(); });
    this.frame = this.frame.bind(this);
    this._raf = requestAnimationFrame(this.frame);
    this._onPointer = (e) => {
      if (!this.interactive) return;
      const r = canvas.getBoundingClientRect();
      const idx = this.cupAt(e.clientX - r.left, e.clientY - r.top);
      if (idx >= 0) this.onCupTap(idx);
    };
    canvas.addEventListener('pointerdown', this._onPointer);
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas);
    this._onResize = () => this.resize();   // 樽尺寸跟螢幕高（window.innerHeight）：畫布尺寸冇變但螢幕變咗都要重排
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this.canvas.removeEventListener('pointerdown', this._onPointer);
    window.removeEventListener('resize', this._onResize);
    this._ro.disconnect();
  }

  // ---------- 佈局 ----------
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout();
  }

  /** main.js 喺 setBoard 之前 call；同關 seed 一致（R1）。換關會清走所有等待中嘅揭開 / 交貨保留狀態 */
  setLevelId(id) {
    this.levelId = Number(id) || 1;
    this.cups = []; this.drawOrder = []; this.streams = []; this.hintArrow = null;
    this.particles = []; this.floaters = [];   // 上一關嘅過關彩紙 / 浮字唔好帶入新關
  }

  /**
   * 樽尺寸（v4 §3.3）：高 = bottleHeightRatio × 螢幕高（window.innerHeight，唔係畫布高），闊 = bottleAspect × 高，
   * 全部樽同一尺寸。放唔落畫布（rows × 高 > 區域高，或者一行 4 格 + 半格擺唔落）→ 統一縮細 + console.warn。
   * 再交畀 safeLayout（seed = levelId；R2 遮液體 → jitter 縮 / 樽 ×0.92 / 純網格）。
   */
  layout() {
    const n = this.cups.length;
    this._glowCache = null;                      // 瓶尺寸可能改變 → 背後柔光快取作廢
    this.layoutValid = false;
    if (!n || this.W < 40 || this.H < 40) return;
    this.layoutValid = true;
    const padX = 6, padTop = 26, padBottom = 8;
    const areaWidth = Math.max(60, this.W - padX * 2), areaHeight = Math.max(60, this.H - padTop - padBottom);
    const g = geomFor('normal');
    const contentSpan = g.content.bottom - g.content.top;
    const screenH = window.innerHeight || this.H;
    const bottleHeight = LAYOUT.bottleHeightRatio * screenH;
    const bottleWidth = bottleHeight * LAYOUT.bottleAspect;
    const input = { levelId: this.levelId, bottleCount: n, areaWidth, areaHeight, bottleWidth, bottleHeight };
    // R2 容差由器皿幾何推：允許重疊 = 底座（液體底 → 內容底）高度；bottle_std 液體去到 98.5%，幾乎唔准疊
    const liquidTopRatio = Math.min(0.995, Math.max(0.5, 1 - (g.content.bottom - g.liquid.bottom) / contentSpan));
    // 前面瓶頂以上：已封樽木塞凸出瓶口（drawCork：塞高 × 0.55 − topOffset），以瓶高比例計，一齊入 R2 驗證
    const corkImg = renderAssets.img.VES_cork;
    const corkAspect = corkImg ? corkImg.naturalHeight / corkImg.naturalWidth : 1;
    const corkH = g.maxWidth * RENDER.cork.widthRatio * corkAspect;     // 相對瓶高（contentSpan = 1）
    const frontOverhangRatio = Math.max(0, corkH * 0.55 - RENDER.cork.topOffset);
    let placed;
    try {
      // 欄數：≤6 → 3、≤9 → 4、10+ → 5（5 欄保唔住樽高就退回 4 欄）；統一縮樽 + R2 fallback 都喺 core/layout.js
      placed = FORCE_GRID
        ? safeLayout(input, null, { liquidTopRatio, frontOverhangRatio, force: { jitterX: 0, jitterY: 0, rotationMaxDeg: 0 } })
        : chooseColumns(input, (m) => console.warn(m), { liquidTopRatio, frontOverhangRatio });
      if (placed.fit < 0.999) console.warn(`[layout] ${n} 隻樽（${placed.columns} 欄）放唔落畫布 ${Math.round(areaWidth)}×${Math.round(areaHeight)} → 統一縮至 ${placed.fit.toFixed(2)}`);
      if (placed.bottleHeight < bottleHeight * 0.999) console.warn(`[layout] 樽高 ${(placed.bottleHeight / screenH).toFixed(3)} × 螢幕（目標 ${LAYOUT.bottleHeightRatio}），${placed.columns} 欄，fallback ${placed.fallback}`);
    } catch (e) {
      console.warn('[layout] safeLayout 失敗，退回純網格', e);
      placed = { layout: computeLayout(input, { jitterX: 0, jitterY: 0, rotationMaxDeg: 0 }), bottleWidth, bottleHeight, fallback: 9, columns: columnsFor(n), fit: 1 };
    }
    this.bottleWidth = placed.bottleWidth; this.bottleHeight = placed.bottleHeight;
    this.frameScale = placed.bottleHeight / contentSpan;   // 768 frame → px
    this.flaskWidth = g.maxWidth * this.frameScale;        // 樽身實際闊（布固定尺寸用）
    this._sealCache.clear();
    for (const p of placed.layout) {
      const cup = this.cups[p.index];
      if (!cup) continue;
      cup.w = placed.bottleWidth; cup.h = placed.bottleHeight;
      cup.hx = padX + p.position.x; cup.hy = padTop + p.position.y;
      cup.rot0 = p.rotation * DEG; cup.z = p.zIndex;
      if (!cup.placed) { cup.x = cup.hx; cup.y = cup.hy; cup.placed = true; }
    }
    this._sortDrawOrder();
  }

  _sortDrawOrder() {
    this.drawOrder = this.cups.map((_, i) => i).sort((a, b) => {
      const A = this.cups[a], B = this.cups[b];
      const pa = (A.anim === 'pour' || A.anim === 'fly') ? 1 : 0, pb = (B.anim === 'pour' || B.anim === 'fly') ? 1 : 0;
      return (pa - pb) || ((A.z ?? a) - (B.z ?? b));
    });
  }

  /**
   * 接收遮罩盤面（隱藏格 = null）。保留舊杯嘅動畫 / 位置狀態；記低：
   *  - `?` 樽新露出嘅格（null → 值）→ 160 ms 淡入
   *  - 布遮瓶由 locked 變 normal → clothHold：繼續畫布，等 animateUnlock
   *  - 廣告樽變 normal → adHold：繼續畫紋章，等 animateAdUnlock
   *  - 滿樽變 gone / 空（交貨）→ pendingSeg：繼續畫液體（連木塞），等 animateFlyToSlot / animateDeliver
   *  - 純色滿樽（冇訂單）→ sealPending：等 animateSeal 加塞；已封嘅保留
   */
  setBoard(board) {
    const prev = this.cups;
    const now = performance.now();
    let lockedIdx = 0;
    this.cups = board.cups.map((c, i) => {
      const old = prev[i] || null;
      // 布遮瓶：第 k 隻鎖住嘅瓶喺交付第 2(k+1) 單時揭開 → 仲要交幾多單（main.js 有畀 unlockIn 就用佢）
      const isLocked = c.kind === 'covered' && c.locked;
      const unlockIn = c.unlockIn ?? (isLocked ? Math.max(1, 2 * (++lockedIdx) - (board.delivered || 0)) : 0);
      const seg = c.seg.slice();
      const cup = {
        kind: c.kind, cap: c.cap, locked: !!c.locked, seg, unlockIn: Math.max(1, unlockIn || 1),
        x: old?.x ?? 0, y: old?.y ?? 0, hx: old?.hx ?? 0, hy: old?.hy ?? 0, w: old?.w ?? 60, h: old?.h ?? 120,
        rot0: old?.rot0 ?? 0, rotA: old?.rotA ?? 0, z: old?.z ?? i, placed: old?.placed ?? false,
        lift: old?.lift ?? 0, scale: 1, alpha: 1, glow: 0, anim: null,
        extraUnits: 0, extraColor: null, removedUnits: 0, layerAlpha: 1, settle: null,
        fade: old?.fade ? old.fade.slice() : [],
        reveal: old?.reveal && old.reveal.fade < 1 ? old.reveal : null, clothHold: null, pendingSeg: null,
        adHold: null, adReveal: old?.adReveal ?? null, seal: null, sealPending: null,
      };
      if (old) {
        // `?` 樽逐格露出
        for (let k = 0; k < seg.length; k++) {
          if (seg[k] !== null && old.seg[k] === null) cup.fade[k] = now;
          else if (seg[k] === null) cup.fade[k] = undefined;
        }
        // 布遮 → 解鎖：先保留布，等 animateUnlock
        const wasCloth = (old.kind === 'covered' && old.locked) || old.clothHold;
        if (wasCloth && !isLocked && !old.reveal) {
          const hintUnit = old.clothHold?.hint ?? old.seg[old.seg.length - 1] ?? seg[seg.length - 1] ?? null;
          cup.clothHold = { t0: old.clothHold?.t0 ?? now, hint: hintUnit };
        }
        // 廣告樽 → 解鎖：先保留紋章，等 animateAdUnlock
        const wasAd = old.kind === 'ad' || old.adHold;
        if (wasAd && c.kind !== 'ad' && !old.adReveal) cup.adHold = { t0: old.adHold?.t0 ?? now };
        // 滿 → gone / 空（交貨）：先保留液體（同木塞），等 animateFlyToSlot / animateDeliver
        const oldSeg = old.pendingSeg?.seg ?? old.seg;
        const topUnit = [...oldSeg].reverse().find(v => v !== null) ?? null;
        const emptied = seg.length === 0 || c.kind === 'gone';
        if (emptied && oldSeg.length >= old.cap && topUnit !== null && oldSeg.every(v => v === null || v === topUnit) && !old.anim) {
          // `?` 樽倒滿交貨時 client 嘅 seg 可能仲有 null（隱藏格）：server 已判定純色滿瓶，用頂色補齊畀交貨動畫
          cup.pendingSeg = { t0: old.pendingSeg?.t0 ?? now, seg: oldSeg.map(v => v === null ? topUnit : v), kind: old.kind === 'gone' ? old.pendingSeg?.kind ?? 'normal' : old.kind };
          cup.seal = old.seal;
        }
      } else {
        for (let k = 0; k < seg.length; k++) if (seg[k] === null) cup.fade[k] = undefined;
      }
      // 已封樽（v4 §7：完成樽冇訂單 → 加塞 + 去飽和 + 留喺盤面）
      const sealable = c.kind !== 'covered' && c.kind !== 'ad' && c.kind !== 'gone' && !c.locked && isSealedSeg(seg, c.cap);
      if (sealable) {
        if (old?.seal) cup.seal = old.seal;
        else if (old) cup.sealPending = old.sealPending ?? { t0: now };
        else cup.seal = SEAL_DONE;
      }
      return cup;
    });
    this.layout();
  }

  setInteractive(v) { this.interactive = v; }

  select(idx) { this.selected = idx; }

  /** 點擊測試：由最前（zIndex 大）到最後，旋轉矩形（內容框 + 6px 鬆動）。鎖住嘅布遮瓶 / 廣告樽都會回傳（由 main.js 決定 shake / 播廣告）；gone 唔會 */
  cupAt(px, py) {
    const order = [...this.drawOrder].reverse();
    for (const i of order) {
      const c = this.cups[i];
      if (c.kind === 'gone' || c.anim === 'fly') continue;
      const cx = c.x, cy = c.y - c.lift * LIFT_PX;
      const rot = c.rot0 + c.rotA;
      const dx = px - cx, dy = py - cy;
      const cos = Math.cos(-rot), sin = Math.sin(-rot);
      const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
      const cloth = this._showsCloth(c);
      const halfW = c.w / 2 + 6;   // 布比瓶闊係裝飾，點擊範圍照用瓶闊，免搶鄰瓶嘅點擊
      const top = -c.h / 2 - (cloth ? c.h * CLOTH.topOffsetRatio : 0) - 10, bottom = c.h / 2 + 6;
      if (lx >= -halfW && lx <= halfW && ly >= top && ly <= bottom) return i;
    }
    return -1;
  }

  // ---------- 動畫工具 ----------
  _tween(dur, fn) {
    // rAF 同 setTimeout 兩邊都排，邊個先到用邊個：分頁隱藏 / rAF 被節流（背景 pane、省電模式）都唔會卡死
    const schedule = (cb) => {
      let done = false;
      const fire = () => { if (done) return; done = true; cancelAnimationFrame(raf); clearTimeout(tm); cb(performance.now()); };
      const raf = document.hidden ? 0 : requestAnimationFrame(fire);
      const tm = setTimeout(fire, document.hidden ? 40 : 120);
    };
    return new Promise(res => {
      const t0 = performance.now();
      const step = (now) => {
        const t = clamp01((now - t0) / dur);
        fn(t);
        if (t < 1) schedule(step); else res();
      };
      schedule(step);
    });
  }

  shake(idx) {
    const c = this.cups[idx];
    if (!c || c.anim) return;
    c.anim = 'shake';
    this._tween(260, t => { c.x = c.hx + Math.sin(t * Math.PI * 5) * 6 * (1 - t); })
      .then(() => { c.x = c.hx; c.anim = null; });
  }

  showHint(from, to) {
    this.hintArrow = { from, to, t0: performance.now(), dur: 2400 };
  }

  clearHint() { this.hintArrow = null; }

  /** 瓶內 local 座標（以瓶中心為原點、未旋轉）→ 世界座標 */
  _toWorld(c, lx, ly) {
    const rot = c.rot0 + c.rotA, cos = Math.cos(rot), sin = Math.sin(rot);
    return { x: c.x + lx * cos - ly * sin, y: c.y - c.lift * LIFT_PX + lx * sin + ly * cos };
  }

  /** frame 幾何：frame 原點（local px）同比例 */
  _frame(c) {
    const g = geomFor(c.kind === 'covered' ? 'normal' : c.kind);
    const S = c.h / (g.content.bottom - g.content.top);
    return { g, S, fx: -S / 2, fy: -c.h / 2 - g.content.top * S };
  }

  /** 液面（local）：第 level 格頂嘅 y */
  _surfaceY(c, level) {
    const { g, S, fy } = this._frame(c);
    const slot = (g.liquid.bottom - g.liquid.top) / c.cap;
    return fy + (g.liquid.bottom - level * slot) * S;
  }

  /** 倒液：來源移到目標上方傾斜 → 液柱 + 液面升 → 回位。呼叫前 view 仍係舊盤面。colour = unit key */
  async animatePour(from, to, n, color) {
    const S = this.cups[from], T = this.cups[to];
    S.anim = 'pour';
    this._sortDrawOrder();
    const side = S.hx <= T.hx ? -1 : 1;                      // 由左邊倒 → 順時針傾
    const ang = -side * 35 * DEG;
    // 傾斜後瓶口去到目標瓶口斜上方
    const px = T.hx + side * (Math.sin(35 * DEG) * S.h / 2 + S.w * 0.12);
    const py = T.hy - T.h / 2 - 10 + Math.cos(35 * DEG) * S.h / 2 - S.h * 0.08;
    const sx = S.x, sy = S.y;
    S.lift = 0;

    // A. 移動 + 傾斜（Cubic.easeInOut，180 ms）
    await this._tween(180, t => {
      const e = cubicInOut(t);
      S.x = lerp(sx, px, e); S.y = lerp(sy, py, e); S.rotA = ang * e;
    });

    // B. 液柱 + 液面上升
    const pourDur = 170 + 50 * (n - 1);
    T.extraColor = color;
    const stream = { from, to, color, width: 4 + n * 1.6, alpha: 1, side };
    this.streams.push(stream);
    let splashed = false;
    await this._tween(pourDur, t => {
      const e = cubicOut(t);
      T.extraUnits = n * e;
      S.removedUnits = n * e;
      if (!splashed && t > 0.18) { splashed = true; this._splash(T, hexOf(color), 6 + n * 2); }
      if (t > 0.6) stream.alpha = 1 - (t - 0.6) / 0.4;
    });
    this.streams = this.streams.filter(s => s !== stream);

    // C. 液面落定：overshoot 8% 回彈（Back.easeOut，120 ms）+ 來源回位
    S.seg.splice(S.seg.length - n, n);
    S.removedUnits = 0;
    T.seg.push(...Array(n).fill(color));
    T.extraUnits = 0; T.extraColor = null;
    T.settle = { t0: performance.now(), dur: 120, units: n };
    await this._tween(180, t => {
      const e = cubicInOut(t);
      S.x = lerp(px, S.hx, e); S.y = lerp(py, S.hy, e); S.rotA = ang * (1 - e);
    });
    S.x = S.hx; S.y = S.hy; S.rotA = 0; S.anim = null;
    this._sortDrawOrder();
  }

  _splash(T, hex, count) {
    const level = T.seg.length + T.extraUnits;
    const p = this._toWorld(T, 0, this._surfaceY(T, level));
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: p.x + (Math.random() - 0.5) * T.w * 0.5, y: p.y,
        vx: (Math.random() - 0.5) * 140, vy: -60 - Math.random() * 120,
        life: 0, dur: 200 + Math.random() * 80, r: 1.5 + Math.random() * 2, color: hex,
      });
    }
  }

  /** 交貨（舊式，仍可用）：金光 + 液體升起消失 + 浮字。之後該樽當 gone 畫（唔畫） */
  async animateDeliver(idx, label = '✓ ' + t('clients.deliver')) {
    const c = this.cups[idx];
    if (!c) return;
    c.anim = 'deliver';
    if (c.pendingSeg) { c.seg = c.pendingSeg.seg.slice(); c.pendingSeg = null; }
    const top = this._toWorld(c, 0, -c.h / 2);
    for (let i = 0; i < 14; i++) {
      this.particles.push({
        x: c.x + (Math.random() - 0.5) * c.w, y: c.y + c.h * (Math.random() * 0.7 - 0.3),
        vx: (Math.random() - 0.5) * 80, vy: -90 - Math.random() * 90,
        life: 0, dur: 420 + Math.random() * 200, r: 2 + Math.random() * 2, color: COLORS.brassLight, star: true,
      });
    }
    this.floaters.push({ x: top.x, y: top.y - 6, text: label, t0: performance.now(), dur: 900, color: COLORS.brassMain });
    await this._tween(380, t => {
      c.glow = 1 - t;
      c.scale = 1 + Math.sin(t * Math.PI) * 0.1;
      c.layerAlpha = 1 - cubicInOut(t);
      c.alpha = 1 - cubicInOut(t) * 0.999;
    });
    c.seg = []; c.layerAlpha = 1; c.scale = 1; c.glow = 0; c.alpha = 1; c.anim = null; c.seal = null;
    c.kind = 'gone';
  }

  /**
   * 封存（v4 §7）：木塞由上方跌入、輕微回彈 220 ms → 液體去飽和 200 ms。
   * 完成樽有訂單時 main.js 亦可以先 call 呢個再 animateFlyToSlot（飛走時連木塞）。
   */
  async animateSeal(idx) {
    const c = this.cups[idx];
    if (!c) return;
    c.sealPending = null;
    if (c.pendingSeg) c.pendingSeg.t0 = performance.now();   // 封存期間唔好放棄保留嘅液體
    if (c.seal && c.seal.cork >= 1 && c.seal.desat >= 1) return;
    const seal = { cork: 0, desat: 0 };
    c.seal = seal;
    // Spec v3 §5.2：0–140ms 落塞 + 彈動；140–420ms 去飽和 25% + 疊 #0A0806 @ 18%
    await this._tween(RENDER.sealAnim.corkMs, t => { seal.cork = t; c.scale = 1 + 0.06 * Math.sin(Math.PI * t); });
    c.scale = 1;
    await this._tween(RENDER.sealAnim.desatMs, t => { seal.desat = t; });
    if (c.seal === seal) c.seal = SEAL_DONE;
  }

  /**
   * 飛向訂單槽（v4 §7）：targetRect = {x,y,w,h}（畫布 local px，main.js 傳訂單槽位置；冇畀 → 向上飛出畫布）。
   * 樽提起 → 縮到 0.5 → 沿弧線 420 ms 飛到矩形中心，最後 30% 淡出；之後該樽係 gone（唔畫，位置保留）。
   */
  async animateFlyToSlot(idx, targetRect) {
    const c = this.cups[idx];
    if (!c) return;
    c.anim = 'fly';
    this._sortDrawOrder();
    if (c.pendingSeg) { c.seg = c.pendingSeg.seg.slice(); c.pendingSeg = null; }
    c.sealPending = null;
    // 未加塞（交貨即飛）：木塞喺提起階段跌入（v4 §7「加塞 + 飛向訂單槽」），唔另外等 220 ms
    const seal = c.seal && c.seal.cork >= 1 ? c.seal : { cork: 0, desat: c.seal ? c.seal.desat : 0 };
    c.seal = seal;
    const sx = c.x, sy = c.y - c.lift * LIFT_PX;
    c.lift = 0;
    const r = targetRect && Number.isFinite(targetRect.x) && Number.isFinite(targetRect.y) ? targetRect : null;
    const tx = r ? r.x + (r.w || 0) / 2 : sx;
    const ty = r ? r.y + (r.h || 0) / 2 : -c.h;
    const rot = c.rot0;
    const DA = RENDER.deliverAnim;
    const hex = hexOf(c.seg[c.seg.length - 1] ?? 0);
    // 第 1 段 0–140ms：木塞由上方落下插入樽口，樽身彈動 scale 1.0 → 1.06 → 1.0
    if (seal.cork < 1) await this._tween(DA.corkMs, t => { seal.cork = t; c.scale = 1 + 0.06 * Math.sin(Math.PI * t); });
    c.scale = 1;
    // 第 2 段 140–320ms：樽身外緣發光（該色 +40%）、8–12 粒星塵向外散開
    c.glowHex = shiftL(hex, 0.40, 1);
    const dust = DA.dustCount[0] + Math.floor(Math.random() * (DA.dustCount[1] - DA.dustCount[0] + 1));
    for (let i = 0; i < dust; i++) {
      const a = Math.random() * Math.PI * 2, sp = 90 + Math.random() * 120;
      this.particles.push({ x: sx + Math.cos(a) * c.w * 0.35, y: sy + Math.sin(a) * c.h * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0, dur: 320 + Math.random() * 160, r: 1.5 + Math.random() * 2.2, color: '#FFF1C8' });
    }
    await this._tween(DA.glowMs, t => { c.glow = 0.9 * Math.sin(Math.PI * t) + 0.3; });
    // 第 3 段 320–760ms：沿貝茲曲線飛向訂單槽，縮至 45%，旋轉 ±8°
    const ctrlX = (sx + tx) / 2 + (tx > sx ? -1 : 1) * Math.abs(tx - sx) * 0.15, ctrlY = Math.min(sy, ty) - Math.max(40, Math.abs(ty - sy) * 0.35);
    const rotDir = tx > sx ? 1 : -1;
    await this._tween(DA.flyMs, t => {
      const e = cubicInOut(t), u = 1 - e;
      c.x = u * u * sx + 2 * u * e * ctrlX + e * e * tx;
      c.y = u * u * sy + 2 * u * e * ctrlY + e * e * ty;
      c.scale = 1 - (1 - DA.flyScale) * e;
      c.rotA = -rot * e + rotDir * DA.flyRotDeg * DEG * Math.sin(Math.PI * t);
      c.alpha = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
      c.glow = Math.max(0, 0.6 - t);
    });
    c.glowHex = null;
    c.seg = []; c.seal = null; c.pendingSeg = null;
    c.x = c.hx; c.y = c.hy; c.scale = 1; c.alpha = 1; c.rotA = 0; c.glow = 0; c.anim = null;
    c.kind = 'gone';
    this._sortDrawOrder();
  }

  /**
   * 廣告樽解鎖（v4 §4）：紋章放大 + 淡出 260 ms，燭光脈衝一下；之後係 normal 空樽（盤面已經係 normal，setBoard 用 adHold 保留住紋章）。
   */
  async animateAdUnlock(idx) {
    const c = this.cups[idx];
    if (!c) return;
    c.adHold = null;
    if (c.kind === 'ad') c.kind = 'normal';
    const reveal = { t: 0 };
    c.adReveal = reveal;
    const top = this._toWorld(c, 0, -c.h / 2);
    this.floaters.push({ x: top.x, y: top.y - 10, text: t('extra.badges.adUnlocked'), t0: performance.now(), dur: 1000, color: COLORS.brassLight });
    for (let i = 0; i < 8; i++) {
      this.particles.push({
        x: c.x + (Math.random() - 0.5) * c.w * 0.6, y: c.y + c.h * 0.05,
        vx: (Math.random() - 0.5) * 90, vy: -50 - Math.random() * 80,
        life: 0, dur: 360 + Math.random() * 160, r: 1.5 + Math.random() * 2, color: COLORS.candleGlow, star: true,
      });
    }
    await this._tween(260, t => { reveal.t = t; c.glow = Math.sin(Math.PI * t) * 0.9; });
    if (c.adReveal === reveal) c.adReveal = null;
    c.glow = 0;
  }

  /**
   * 布揭開（使用者決定 1）：繩鬆脫 60 ms → 布向上滑出 160 ms ease-out → 6–8 粒塵飄散 400 ms，
   * 顏色同圖案一齊 160 ms 淡入（塵開始時即淡入）。呼叫時盤面已經係 normal（setBoard 用 clothHold 保留住布）。
   */
  async animateUnlock(idx) {
    const c = this.cups[idx];
    if (!c) return;
    const R = RENDER.clothReveal;
    const hint = c.clothHold?.hint ?? c.seg[c.seg.length - 1] ?? null;
    c.clothHold = null; c.locked = false; if (c.kind === 'covered') c.kind = 'normal';
    c.reveal = { hint, rope: 0, slide: 0, fade: 0 };
    const top = this._toWorld(c, 0, -c.h / 2);
    this.floaters.push({ x: top.x, y: top.y - 10, text: t('extra.badges.revealed'), t0: performance.now(), dur: 1000, color: COLORS.brassLight });
    await this._tween(R.ropeMs, t => { c.reveal.rope = t; });
    await this._tween(R.slideMs, t => { c.reveal.slide = cubicOut(t); });
    // 塵粒：由布底散開向上飄
    const cloth = this._clothRect(c);
    const count = R.dustCount[0] + Math.floor(Math.random() * (R.dustCount[1] - R.dustCount[0] + 1));
    for (let i = 0; i < count; i++) {
      const p = this._toWorld(c, (Math.random() - 0.5) * cloth.w * 0.8, cloth.y + cloth.h * (0.3 + Math.random() * 0.6));
      this.particles.push({
        x: p.x, y: p.y, vx: (Math.random() - 0.5) * 50, vy: -20 - Math.random() * 40,
        life: 0, dur: R.dustMs * (0.7 + Math.random() * 0.3), r: 2 + Math.random() * 2.5, color: '#D8CBB0', dust: true, gravity: -25,
      });
    }
    await Promise.all([
      this._tween(R.fadeMs, t => { c.reveal.fade = t; }),
      this._tween(R.dustMs, () => {}),
    ]);
    c.reveal = null; c.glow = 0;
  }

  async animateWin() {
    const colors = [COLORS.brassLight, PALETTE[0].hex, PALETTE[9].hex, COLORS.candleGlow, PALETTE[6].hex];
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 26; i++) {
        this.particles.push({
          x: Math.random() * this.W, y: this.H + 10,
          vx: (Math.random() - 0.5) * 160, vy: -260 - Math.random() * 260,
          life: 0, dur: 1100 + Math.random() * 500, r: 3 + Math.random() * 3,
          color: colors[i % 5], star: i % 3 === 0, gravity: 220,
        });
      }
      await new Promise(r => setTimeout(r, 180));
    }
  }

  // ---------- 主循環 ----------
  frame(now) {
    this._raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - (this._last || now)) / 1000);
    this._last = now;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    if (this.cups.length && !this.layoutValid) { if (this.W >= 40 && this.H >= 40) this.layout(); else return; }   // 畫布仲係 0×0（display:none）：唔好喺原點畫一堆瓶

    for (let i = 0; i < this.cups.length; i++) {
      const c = this.cups[i];
      const target = (this.selected === i && !c.anim) ? 1 : 0;
      c.lift += (target - c.lift) * Math.min(1, dt * 14);
      if (c.settle && now - c.settle.t0 > c.settle.dur) c.settle = null;
      // 唔係動畫中：滑向 home（換版面 / 加空瓶 / resize 時順滑移位）
      if (!c.anim) { const k = Math.min(1, dt * 12); c.x += (c.hx - c.x) * k; c.y += (c.hy - c.y) * k; if (Math.abs(c.hx - c.x) < 0.2) c.x = c.hx; if (Math.abs(c.hy - c.y) < 0.2) c.y = c.hy; }
      // 保留狀態等唔到動畫 → 自動補播 / 放棄
      if (c.clothHold && now - c.clothHold.t0 > HOLD_TIMEOUT_MS) this.animateUnlock(i);
      if (c.adHold && now - c.adHold.t0 > HOLD_TIMEOUT_MS) this.animateAdUnlock(i);
      if (c.sealPending && now - c.sealPending.t0 > SEAL_TIMEOUT_MS) this.animateSeal(i);
      if (c.pendingSeg && now - c.pendingSeg.t0 > PENDING_TIMEOUT_MS) c.pendingSeg = null;
    }

    if (this.drawOrder.length !== this.cups.length) this._sortDrawOrder();
    for (const i of this.drawOrder) this.drawCup(this.cups[i], i, now);
    this.drawStreams();
    this.drawHint(now);

    // 粒子
    this.particles = this.particles.filter(p => (p.life += dt * 1000) < p.dur);
    for (const p of this.particles) {
      p.vy += (p.gravity ?? 520) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const a = 1 - p.life / p.dur;
      ctx.globalAlpha = p.dust ? a * 0.7 : a;
      ctx.fillStyle = p.color;
      if (p.star) this._star(p.x, p.y, p.r * 1.6);
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.dust ? p.r * (1 + (1 - a) * 0.8) : p.r, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;

    // 浮字
    this.floaters = this.floaters.filter(f => now - f.t0 < f.dur);
    for (const f of this.floaters) {
      const t = (now - f.t0) / f.dur;
      ctx.globalAlpha = 1 - t * t;
      ctx.font = `bold 15px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.strokeStyle = rgba(COLORS.woodDark, 0.9); ctx.lineWidth = 4; ctx.lineJoin = 'round';
      ctx.strokeText(f.text, f.x, f.y - t * 34);
      ctx.fillStyle = f.color === COLORS.brassMain ? COLORS.brassLight : f.color;
      ctx.fillText(f.text, f.x, f.y - t * 34);
    }
    ctx.globalAlpha = 1;
  }

  _star(x, y, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
  }

  // ---------- 畫瓶 ----------
  /** 而家係咪要畫布（鎖住 / 等揭開 / 揭開中） */
  _showsCloth(c) { return (c.kind === 'covered' && c.locked) || !!c.clothHold || !!c.reveal; }

  /** 而家係咪要畫廣告紋章（廣告樽 / 等解鎖動畫 / 解鎖中） */
  _showsCrest(c) { return c.kind === 'ad' || !!c.adHold || !!c.adReveal; }

  /** 布矩形（local px）：闊 = 1.34 × 樽身闊；頂高過瓶頂 7%；底貼瓶底 */
  _clothRect(c) {
    const w = CLOTH.fixedWidthRatio * (this.flaskWidth || c.w);
    const top = -c.h / 2 - c.h * CLOTH.topOffsetRatio;
    return { x: -w / 2, y: top, w, h: c.h / 2 - top };
  }

  drawCup(c, idx, now) {
    const flying = c.anim === 'fly';
    if (c.kind === 'gone' && !c.pendingSeg && !flying && c.anim !== 'deliver') return;   // 已飛走：唔畫（版面位置保留）
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(c.x, c.y - c.lift * LIFT_PX);
    ctx.rotate(c.rot0 + c.rotA);
    ctx.scale(c.scale, c.scale);
    ctx.globalAlpha = c.alpha;

    const selected = this.selected === idx;
    // 瓶身陰影：平時畫瓶底軟橢圓（平，唔使每幀 blur 成張 sprite）；選中 / 交貨先用燭光 shadowBlur
    const glow = c.glow > 0 ? c.glow : (selected ? 0.75 : 0);
    const shadowOn = () => {
      if (glow > 0) { ctx.shadowColor = c.glowHex ? c.glowHex.replace(/rgba\(([^)]+),[^,]+\)$/, (m, p) => `rgba(${p},${glow})`) : rgba(COLORS.candleGlow, glow); ctx.shadowBlur = (18 + 8 * glow) * (window.devicePixelRatio || 1); ctx.shadowOffsetY = 0; }
    };
    const shadowOff = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; };
    if (!flying) this.drawGroundShadow(c);

    const cloth = this._showsCloth(c);
    const revealing = !!c.reveal;
    if (!cloth || revealing) {
      // 瓶身 + 液體（揭開中：液體 / 圖案跟 reveal.fade 一齊淡入）
      const liquidAlpha = revealing ? c.reveal.fade : 1;
      if (liquidAlpha > 0) this.drawBackGlow(c, liquidAlpha);   // 發光三件套 ③：整瓶背後柔光（畫喺瓶身之下）
      shadowOn();
      this.drawVessel(c);
      shadowOff();
      if (liquidAlpha > 0) {
        ctx.save(); ctx.globalAlpha *= liquidAlpha;
        this.drawLiquid(c, now);
        ctx.restore();
      }
      if (c.seal) this.drawCork(c);
      if (this._showsCrest(c)) this.drawAdCrest(c, now);
    }
    if (cloth) {
      ctx.save();
      const r = c.reveal;
      if (r) {
        // 繩鬆脫：布輕微晃；滑出：向上移 + 尾段淡出
        const wob = r.rope > 0 && r.slide === 0 ? Math.sin(r.rope * Math.PI * 3) * 2 : 0;
        ctx.translate(wob, -r.slide * (this._clothRect(c).h + 24));
        ctx.globalAlpha *= 1 - clamp01((r.slide - 0.6) / 0.4);
      }
      shadowOn();
      this.drawCloth(c);
      shadowOff();
      const hint = r ? r.hint : (c.clothHold ? c.clothHold.hint : (c.seg[c.seg.length - 1] ?? null));
      this.drawSeal(c, hint, r ? 1 - r.rope * 0.6 : 1);
      if (!r) this.drawBadge(((c.unlockIn || 1) === 1 ? t('extra.badges.order1') : t('hud.orders', { n: c.unlockIn })), 0, this._clothRect(c).y + this._clothRect(c).h * 0.55 + this._clothRect(c).w * 0.36 + 12);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * 發光三件套 ③：整瓶背後柔光 = 每層色 @ 12%，blur 12px。
   * 畫喺瓶身 sprite 之下：多邊形本身會被深色樽身蓋住，只剩 shadowBlur 嘅光暈溢出瓶外——「藥劑喺暗房發光」。
   */
  drawBackGlow(c, alphaMul = 1) {
    const ctx = this.ctx;
    const seg0 = c.pendingSeg ? c.pendingSeg.seg : c.seg;
    if (!seg0.length) return;
    const animating = c.removedUnits > 0 || c.extraUnits > 0 || !!c.settle;
    if (!animating) {
      // 靜止瓶：72 個 shadowBlur 填色 / 幀太貴（≈30% 幀時間），用 offscreen 快取，每幀只係一次 drawImage
      const cached = this._glowSprite(c, seg0);
      if (cached) {
        ctx.save();
        ctx.globalAlpha *= c.layerAlpha * alphaMul;
        ctx.drawImage(cached.canvas, cached.x, cached.y, cached.w, cached.h);
        ctx.restore();
        return;
      }
    }
    this._drawBackGlowLive(ctx, c, seg0, alphaMul);
  }

  /** 靜止瓶嘅背後柔光快取：以 local 座標 (0,0)=瓶中心 畫入 offscreen，LRU ≤ 24，layout / resize 時清空 */
  _glowSprite(c, seg) {
    const dpr = window.devicePixelRatio || 1;
    const S = this._frame(c).S;
    const key = `${c.kind}|${c.cap}|${seg.join(',')}|${Math.round(S * dpr)}`;
    const cache = this._glowCache || (this._glowCache = new Map());
    let e = cache.get(key);
    if (e) { cache.delete(key); cache.set(key, e); return e; }
    const pad = RENDER.glow.backBlurPx * 2 * 2 + 8;   // 兩層 blur（最闊 ×2）
    const w = c.w + pad * 2, h = c.h + pad * 2;
    const cv = document.createElement('canvas');
    cv.width = Math.max(2, Math.ceil(w * dpr)); cv.height = Math.max(2, Math.ceil(h * dpr));
    const octx = cv.getContext('2d');
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.translate(w / 2, h / 2);   // 同 drawCup 一樣以瓶中心為原點
    this._drawBackGlowLive(octx, c, seg, 1);
    e = { canvas: cv, x: -w / 2, y: -h / 2, w, h };
    cache.set(key, e);
    if (cache.size > 24) cache.delete(cache.keys().next().value);
    return e;
  }

  _drawBackGlowLive(ctx, c, seg, alphaMul = 1) {
    const { g, S, fx, fy } = this._frame(c);
    const slot = (g.liquid.bottom - g.liquid.top) / c.cap;
    const yAt = (level) => g.liquid.bottom - level * slot;
    const dpr = window.devicePixelRatio || 1;
    const savedCtx = this.ctx; this.ctx = ctx;   // _bandPath 用 this.ctx
    ctx.save();
    ctx.globalAlpha *= c.layerAlpha * alphaMul;
    let level = 0;
    for (let i = 0; i < seg.length; i++) {
      const u = seg[i];
      let units = 1;
      if (c.removedUnits > 0 && i >= seg.length - Math.ceil(c.removedUnits)) units = Math.max(0, Math.min(1, (seg.length - c.removedUnits) - i));
      if (units <= 0) { continue; }
      if (u !== null) {
        const hex = hexOf(u);
        this._bandPath(g, S, fx, fy, yAt(level + units), yAt(level));
        ctx.fillStyle = rgba(hex, RENDER.glow.backAlpha);
        ctx.shadowColor = rgba(hex, 0.55); ctx.shadowBlur = RENDER.glow.backBlurPx * dpr; ctx.shadowOffsetY = 0;
        ctx.fill();
        // 第二層：更闊更淡嘅暈（blur ×2），令光落到背景牆
        ctx.shadowBlur = RENDER.glow.backBlurPx * 2 * dpr; ctx.shadowColor = rgba(hex, 0.3);
        ctx.fill();
      }
      level += units;
    }
    if (c.extraUnits > 0 && c.extraColor !== null) {
      const hex = hexOf(c.extraColor);
      this._bandPath(g, S, fx, fy, yAt(level + c.extraUnits), yAt(level));
      ctx.fillStyle = rgba(hex, RENDER.glow.backAlpha);
      ctx.shadowColor = rgba(hex, 0.55); ctx.shadowBlur = RENDER.glow.backBlurPx * dpr;
      ctx.fill();
      ctx.shadowBlur = RENDER.glow.backBlurPx * 2 * dpr; ctx.shadowColor = rgba(hex, 0.3);
      ctx.fill();
    }
    ctx.restore();
    this.ctx = savedCtx;
  }

  /** 瓶底投影：COLORS.shadow 50%，向下偏 6px，柔邊 ≈ blur 10 */
  drawGroundShadow(c) {
    const ctx = this.ctx;
    const cloth = this._showsCloth(c) && !c.reveal;
    const w = cloth ? this._clothRect(c).w : (this.flaskWidth || c.w);
    const cy = c.h / 2 + 6 - c.lift * 2, rx = w * 0.5, ry = Math.max(4, w * 0.13);
    const gr = ctx.createRadialGradient(0, cy, 0, 0, cy, rx);
    gr.addColorStop(0, rgba(COLORS.shadow, 0.5)); gr.addColorStop(0.55, rgba(COLORS.shadow, 0.35)); gr.addColorStop(1, rgba(COLORS.shadow, 0));
    ctx.save();
    ctx.translate(0, cy); ctx.scale(1, ry / rx); ctx.translate(0, -cy);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, cy, rx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /** 瓶身 sprite（深色標準樽；未載入 → 程式畫深色佔位） */
  drawVessel(c) {
    const ctx = this.ctx;
    const { g, S, fx, fy } = this._frame(c);
    const kind = c.kind === 'covered' ? 'normal' : c.kind;
    const img = renderAssets.img[spriteKey(kind)];
    if (img) { ctx.drawImage(img, fx, fy, S, S); return; }
    // 佔位：內壁多邊形 + 頸 + 口（深色，同 VES_bottle_std 明度一致）
    const poly = bandPolygon(g, g.liquid.top, g.liquid.bottom);
    ctx.beginPath();
    poly.forEach(([u, v], i) => (i ? ctx.lineTo(fx + u * S, fy + v * S) : ctx.moveTo(fx + u * S, fy + v * S)));
    ctx.closePath();
    ctx.fillStyle = '#041C2C'; ctx.fill();
    ctx.strokeStyle = COLORS.brassDark; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.rect(fx + g.neck.l * S, fy + g.rim.y * S, (g.neck.r - g.neck.l) * S, (g.liquid.top - g.rim.y) * S);
    ctx.fillStyle = '#0A2436'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(fx + g.rim.cx * S, fy + g.rim.y * S, g.rim.rx * S, g.rim.ry * S, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.brassMain; ctx.fill();
  }

  /** 內壁多邊形 path（frame 單位 → local px） */
  _bandPath(g, S, fx, fy, yTop, yBot) {
    const ctx = this.ctx;
    const poly = bandPolygon(g, yTop, yBot);
    ctx.beginPath();
    for (let i = 0; i < poly.length; i++) { const [u, v] = poly[i]; if (i) ctx.lineTo(fx + u * S, fy + v * S); else ctx.moveTo(fx + u * S, fy + v * S); }
    ctx.closePath();
  }

  /**
   * 液層圓柱路徑（frame 單位 → canvas）：上邊 / 下邊各自可以係正面弧（向下彎 ryTop / ryBot，中央最低、兩邊為 0），兩側沿內壁 rows。
   * 上下都用同一方向嘅弧 → 層與層之間分界係弧線，成塊液體係「圓柱側面」（唔係菱形）。
   */
  _layerPath(g, S, fx, fy, yTop, yBot, ryTop, ryBot) {
    const ctx = this.ctx;
    const N = 14;
    const top = extentsAt(g, yTop), bot = extentsAt(g, yBot);
    const P = (u, v) => [fx + u * S, fy + v * S];
    ctx.beginPath();
    // 上邊：左 → 右，沿弧
    for (let k = 0; k <= N; k++) {
      const t = k / N, nx = 2 * t - 1;
      const [x, y] = P(top.l + (top.r - top.l) * t, yTop + ryTop * Math.sqrt(Math.max(0, 1 - nx * nx)));
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    // 右邊：向下沿 rows
    for (const r of g.rows) if (r[0] > yTop && r[0] < yBot) { const [x, y] = P(r[2], r[0]); ctx.lineTo(x, y); }
    // 下邊：右 → 左，沿弧
    for (let k = N; k >= 0; k--) {
      const t = k / N, nx = 2 * t - 1;
      const [x, y] = P(bot.l + (bot.r - bot.l) * t, yBot + ryBot * Math.sqrt(Math.max(0, 1 - nx * nx)));
      ctx.lineTo(x, y);
    }
    // 左邊：向上沿 rows
    for (let i = g.rows.length - 1; i >= 0; i--) { const r = g.rows[i]; if (r[0] > yTop && r[0] < yBot) { const [x, y] = P(r[1], r[0]); ctx.lineTo(x, y); } }
    ctx.closePath();
  }

  /**
   * 液體（v4 §1.2）：第 i 格 = 內壁 liquid.bottom 向上第 i 個 slot。每帶：
   *  ① rim glow 描邊（帶外，該色 @ 40%）
   *  ② 純色填滿（source-over，alpha 1，唔乘任何嘢）
   *  ③ 玻璃高光圖（sprite luma > 215 部分，白，screen @ 0.55）
   *  ④ 左側高光柱（內壁闊 16–24%，3px 柔邊，白 @ 0.35，screen）
   *  ⑤ 配料圖案（該層色 −28% L）
   * 頂帶另加 ⑥ 液面高光線（頂 3px，該色 ×1.5）。`?` 隱藏格：唔填色，只畫 ? 字。已封：每帶色先去飽和 + 疊暗。
   */
  drawLiquid(c, now) {
    const ctx = this.ctx;
    const { g, S, fx, fy } = this._frame(c);
    const slot = (g.liquid.bottom - g.liquid.top) / c.cap;
    const yAt = (level) => g.liquid.bottom - level * slot;           // frame 單位
    const seg = c.pendingSeg ? c.pendingSeg.seg : c.seg;
    const n = seg.length;
    let settleScale = 1;
    if (c.settle) settleScale = 1 + 0.08 * (1 - backOut(clamp01((now - c.settle.t0) / c.settle.dur)));
    const baseAlpha = ctx.globalAlpha * c.layerAlpha;
    const sealK = c.seal ? c.seal.desat : 0;
    const highlight = renderAssets.highlight[spriteKey(c.kind === 'covered' ? 'normal' : c.kind)];
    const GH = RENDER.glassHighlight, VH = RENDER.verticalHighlight, SE = RENDER.surfaceEllipse;
    // 圓柱模型：正面弧 ry = 內壁闊 × ryRatio（frame 單位）；最底層底邊平（樽底）
    const innerW = (() => { const e = extentsAt(g, (g.liquid.top + g.liquid.bottom) / 2); return e.r - e.l; })();
    const ryF = innerW * SE.ryRatio;

    const drawBand = (from, to, unit, alpha, isTop) => {
      if (to - from <= 0.001) return;
      const yTop = yAt(to), yBot = yAt(from);
      const hex = hexOf(unit);
      const rgb = sealK > 0 ? sealedRgb(hex, sealK) : rgbOf(hex);
      const fill = sealK > 0 ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : hex;   // 未封：直接用色板 hex 字串（硬規則：帶中央 pixel === hex）
      const y1 = fy + yTop * S, y2 = fy + yBot * S;
      const ext = extentsAt(g, (yTop + yBot) / 2);
      const bx0 = fx + ext.l * S, bx1 = fx + ext.r * S;
      const ryTop = Math.min(ryF, (yBot - yTop) / 2);           // 薄層（倒緊）弧唔可以高過半層
      const ryBot = from <= 0.001 ? 0 : ryTop;                    // 最底層：底邊平
      const ryPx = ryTop * S;
      // ① rim glow：先畫描邊，再填色，內半邊會被液體蓋住、外半邊留喺玻璃上
      ctx.save();
      ctx.globalAlpha = baseAlpha * alpha;
      this._layerPath(g, S, fx, fy, yTop, yBot, ryTop, ryBot);
      ctx.strokeStyle = rgba(hex, RENDER.glow.rimAlpha); ctx.lineWidth = RENDER.glow.rimPx * 2; ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = baseAlpha * alpha;
      this._layerPath(g, S, fx, fy, yTop, yBot, ryTop, ryBot);
      ctx.clip();
      // ② 純色：已經 clip 住圓柱側面 → 全闊填色（連底弧凸出嘅 ryPx）
      ctx.globalCompositeOperation = RENDER.liquidBlend;
      ctx.fillStyle = fill;
      ctx.fillRect(fx, y1, S, y2 - y1 + ryPx);
      // ②b 圓筒明暗（bottleMask.js v3）：邊緣暗到 sideShadeMin（中軸 1.0 → 帶中央 pixel 仍然 = hex）；
      //     水面帶（RENDER.surfaceBand）每一層都畫：實色、硬邊、下邊沿橢圓弧（見下面 ②c）
      {
        const CY = RENDER.cylinder;
        const w = bx1 - bx0, cx = (bx0 + bx1) / 2;
        const gr = ctx.createLinearGradient(bx0, 0, bx1, 0);
        const edge = Math.round((1 - CY.sideShadeMin) * 255);
        // multiply 用灰階：邊緣 gray(255−edge) → 中央 white；用 sin 分佈近似圓筒（t2 = sqrt(1−nx²)）
        for (let k = 0; k <= 8; k++) {
          const nx = k / 8 * 2 - 1, t2 = Math.sqrt(Math.max(0, 1 - nx * nx));
          const v = Math.round(255 - edge * (1 - t2));
          gr.addColorStop(k / 8, `rgb(${v},${v},${v})`);
        }
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = gr; ctx.fillRect(bx0, y1, w, y2 - y1 + ryPx);
      }
      // ③ 玻璃高光（只有 sprite 最亮部分，深色樽身中央 alpha = 0 → 帶中央 pixel 唔會郁）
      if (highlight) {
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = baseAlpha * alpha * GH.strength;
        ctx.drawImage(highlight, fx, fy, S, S);
      }
      // ④ 左側高光柱：由內壁左緣起 16%–24% 闊，柔邊 ≈ blur px
      {
        const w = bx1 - bx0, soft = VH.blur;
        const x0 = bx0 + w * VH.from, x1 = bx0 + w * VH.to;
        const gr = ctx.createLinearGradient(x0 - soft, 0, x1 + soft, 0);
        const e = soft / (x1 - x0 + soft * 2);
        gr.addColorStop(0, 'rgba(255,255,255,0)');
        gr.addColorStop(e, `rgba(255,255,255,${VH.strength})`);
        gr.addColorStop(1 - e, `rgba(255,255,255,${VH.strength})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = baseAlpha * alpha;
        ctx.fillStyle = gr; ctx.fillRect(x0 - soft, y1, x1 - x0 + soft * 2, y2 - y1 + ryPx);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
      // ⑤ 配料圖案（該層色 −28% L）
      const p = unitPattern(unit);
      if (p > 0) this.drawPattern(c, p, hex, bx0, y1, bx1 - bx0, y2 - y1, baseAlpha * alpha, g, S, fx, fy, yTop, yBot);
      // ⑥ 頂面：最頂層畫完整橢圓（該層色向白 mix lighten，實色硬邊），clip 喺玻璃內壁；上半突出層頂 ry，下半蓋住圓柱頂
      if (isTop && ryTop > 0.0005) {
        const lit = rgb.map(v => Math.round(v + (255 - v) * SE.lighten));
        ctx.save();
        ctx.globalAlpha = baseAlpha * alpha;
        this._bandPath(g, S, fx, fy, Math.max(g.content.top, yTop - ryTop), yTop + ryTop); ctx.clip();
        ctx.fillStyle = `rgb(${lit[0]},${lit[1]},${lit[2]})`;
        ctx.beginPath();
        ctx.ellipse((bx0 + bx1) / 2, y1, (bx1 - bx0) / 2, ryPx, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };
    const drawHidden = (from, to) => {
      // `?` 隱藏格：實色黑層（圓柱，上下弧邊同液層一致，最底層底邊平），中央畫淺色襯線 ?，大小 ≈ 55% slot 高
      const HG = RENDER.hiddenGlyph;
      const yTop = yAt(to), yBot = yAt(from);
      const ext = extentsAt(g, (yTop + yBot) / 2);
      const ryTop = Math.min(ryF, (yBot - yTop) / 2), ryBot = from <= 0.001 ? 0 : ryTop;
      ctx.save();
      ctx.globalAlpha = baseAlpha;
      this._layerPath(g, S, fx, fy, yTop, yBot, ryTop, ryBot); ctx.clip();
      ctx.fillStyle = HG.fill;
      ctx.fillRect(fx, fy + yTop * S, S, (yBot - yTop + ryTop) * S);
      ctx.fillStyle = HG.glyph;
      ctx.font = `bold ${Math.max(10, slot * S * HG.sizeRatio)}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', fx + ((ext.l + ext.r) / 2) * S, fy + ((yTop + yBot) / 2 + ryTop / 2) * S);
      ctx.restore();
    };

    // 已有層（來源正在倒出：頂層縮短）
    let level = 0;
    for (let i = 0; i < n; i++) {
      const u = seg[i];
      let units = 1;
      if (c.removedUnits > 0 && i >= n - Math.ceil(c.removedUnits)) units = Math.max(0, Math.min(1, (n - c.removedUnits) - i));
      if (units <= 0) continue;
      const top = i === n - 1 && !c.extraUnits ? level + units * settleScale : level + units;
      if (u === null) drawHidden(level, top);
      else {
        const t0 = c.fade[i];
        const alpha = t0 ? clamp01((now - t0) / RENDER.hiddenRevealMs) : 1;
        drawBand(level, top, u, alpha, i === n - 1 && !c.extraUnits);
      }
      level += units;
    }
    // 正在倒入嘅新層
    if (c.extraUnits > 0 && c.extraColor !== null) drawBand(level, level + c.extraUnits, c.extraColor, 1, true);
  }

  /**
   * 配料圖案（決定 8）：層高 ≥48px 用 PAT_tile_large，<48px 用 PAT_tile_small；<32px 只畫層中央單一 icon。
   * 取樣象限 = patternUV(p)（含 inset）；圖案按層高等比縮放置中，P3 橫向 repeat 鋪滿，其餘 clamp（單一象限）。
   * tile 係灰階 L 遮罩（黑 = 墨）→ 已轉成 alpha 遮罩，source-in 染成該層色 −28% L。畫喺純色之上。
   */
  drawPattern(c, p, hex, bx, by, bw, bh, alpha, g, S, fx, fy, yTop, yBot) {
    const ctx = this.ctx;
    const uv = patternUV(PAT_NAMES[p]);
    if (!uv || bh < 4) return;
    const mask = bh >= RENDER.patternLargeMinPx ? renderAssets.patMask.large : renderAssets.patMask.small;
    if (!mask) return;
    const atlas = RENDER.patternAtlasSize;
    const sx = uv.u0 * atlas, sy = uv.v0 * atlas, sw = (uv.u1 - uv.u0) * atlas, sh = (uv.v1 - uv.v0) * atlas;
    const sc = this._scratch, dpr = window.devicePixelRatio || 1;
    const W = Math.max(2, Math.ceil(bw * dpr)), H = Math.max(2, Math.ceil(bh * dpr));
    if (sc.width < W || sc.height < H) { sc.width = Math.max(sc.width, W, 256); sc.height = Math.max(sc.height, H, 256); }   // 只放大，唔每層重新配置
    const sctx = sc.getContext('2d');
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, W, H);
    const iconOnly = bh < RENDER.patternIconOnlyBelowPx;
    if (iconOnly) {
      // 單一 icon：取象限中央 45% 區域，縮到層高 80%
      const side = H * 0.8, cx = sx + sw / 2, cy = sy + sh / 2, half = sw * 0.225;
      sctx.drawImage(mask, cx - half, cy - half, half * 2, half * 2, (W - side) / 2, (H - side) / 2, side, side);
    } else {
      const inset = H * 0.08, side = H - inset * 2;
      if (RENDER.patternWrap[PAT_NAMES[p]] === 'repeat') {
        const count = Math.ceil(W / side) + 1, start = (W - count * side) / 2;
        for (let i = 0; i < count; i++) sctx.drawImage(mask, sx, sy, sw, sh, start + i * side, inset, side, side);
      } else {
        sctx.drawImage(mask, sx, sy, sw, sh, (W - side) / 2, inset, side, side);
      }
    }
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = shiftL(hex, RENDER.patternLumShift, 1);
    sctx.fillRect(0, 0, W, H);
    sctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.globalAlpha = alpha * 0.9;
    this._bandPath(g, S, fx, fy, yTop, yBot); ctx.clip();
    ctx.drawImage(sc, 0, 0, W, H, bx, by, W / dpr, H / dpr);
    ctx.restore();
  }

  /**
   * 木塞（已封樽，v4 §2.2）：程式畫黃銅棕圓角矩形，塞喺瓶口。seal.cork 0→1 = 由上方跌入 + 輕微回彈。
   */
  drawCork(c) {
    const ctx = this.ctx;
    const { g, S, fx, fy } = this._frame(c);
    const p = c.seal.cork;
    // 跌落（200ms ease-out-back）：由上方落到位，衝過少少（塞深一格）再回彈到樽口
    const fall = easeOutBack(clamp01(p));
    const drop = -(1 - fall) * c.h * 0.22;
    const cork = renderAssets.img.VES_cork;
    if (cork) {
      // v4.1 / Spec v3 §5.1：VES_cork，widthRatio 0.61（相對樽寬）、topOffset 0.035（相對樽高）
      const bw = g.maxWidth * S;
      const w = bw * RENDER.cork.widthRatio, h = w * (cork.naturalHeight / cork.naturalWidth);
      const cx = fx + g.rim.cx * S, top = fy + g.content.top * S + c.h * RENDER.cork.topOffset - h * 0.55 + drop;
      ctx.save();
      ctx.shadowColor = rgba(COLORS.shadow, 0.5); ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
      ctx.drawImage(cork, cx - w / 2, top, w, h);
      ctx.restore();
      return;
    }
    const neckW = (g.neck.r - g.neck.l) * S;
    const w = neckW * 0.88, h = S * 0.085;
    const cx = fx + g.rim.cx * S, top = fy + (g.rim.y - 0.036) * S + drop;
    const rr = Math.max(2, w * 0.18);
    ctx.save();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    // 身：垂直漸層（上亮下暗）
    const gr = ctx.createLinearGradient(0, top, 0, top + h);
    gr.addColorStop(0, CORK_LIGHT); gr.addColorStop(0.35, CORK_BODY); gr.addColorStop(1, CORK_DARK);
    ctx.beginPath(); ctx.roundRect(cx - w / 2, top, w, h, rr);
    ctx.fillStyle = gr; ctx.fill();
    ctx.strokeStyle = rgba(COLORS.shadow, 0.7); ctx.lineWidth = Math.max(1, S * 0.004); ctx.stroke();
    // 頂面：淺色橢圓
    ctx.beginPath(); ctx.ellipse(cx, top + h * 0.16, w * 0.42, h * 0.14, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgba(CORK_LIGHT, 0.9); ctx.fill();
    // 木紋：兩條淡直線
    ctx.strokeStyle = rgba(CORK_DARK, 0.45); ctx.lineWidth = Math.max(0.8, S * 0.003);
    for (const k of [-0.22, 0.18]) { ctx.beginPath(); ctx.moveTo(cx + w * k, top + h * 0.3); ctx.lineTo(cx + w * k * 0.9, top + h * 0.92); ctx.stroke(); }
    ctx.restore();
  }

  /**
   * 廣告紋章（v4 §4）：UI_ad_crest 置中喺樽高 55% 處，闊 ≈ 60% 樽闊，後面一團燭光（輕微呼吸）。
   * adReveal.t 0→1：放大 + 淡出（解鎖動畫）。
   */
  drawAdCrest(c, now) {
    const ctx = this.ctx;
    const img = renderAssets.img.UI_ad_crest;
    const t = c.adReveal ? c.adReveal.t : 0;
    const cy = -c.h / 2 + c.h * 0.55;
    const side = c.w * 0.6 * (1 + 0.6 * t);
    const breathe = 1 + 0.12 * Math.sin(now / 320);
    ctx.save();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.globalAlpha *= (1 - t);
    // 燭光：徑向漸層（解鎖時脈衝放大）
    const gr = ctx.createRadialGradient(0, cy, 0, 0, cy, side * 0.95 * breathe * (1 + t));
    gr.addColorStop(0, rgba(COLORS.candleGlow, 0.42 + 0.3 * Math.sin(Math.PI * t)));
    gr.addColorStop(0.55, rgba(COLORS.candleGlow, 0.16));
    gr.addColorStop(1, rgba(COLORS.candleGlow, 0));
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(0, cy, side * 0.95 * breathe * (1 + t), 0, Math.PI * 2); ctx.fill();
    if (img) ctx.drawImage(img, -side / 2, cy - side / 2, side, side);
    else {
      ctx.beginPath(); ctx.roundRect(-side / 2, cy - side / 2, side, side, side * 0.12);
      ctx.fillStyle = COLORS.brassMain; ctx.fill(); ctx.strokeStyle = COLORS.brassDark; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-side * 0.16, cy - side * 0.22); ctx.lineTo(side * 0.24, cy); ctx.lineTo(-side * 0.16, cy + side * 0.22); ctx.closePath();
      ctx.fillStyle = COLORS.woodDark; ctx.fill();
    }
    ctx.restore();
  }

  /** 布遮：固定尺寸拉伸至 _clothRect（素材已 runtime key 走黑底）；未載入 → 程式畫布 */
  drawCloth(c) {
    const ctx = this.ctx;
    const r = this._clothRect(c);
    const img = renderAssets.img.VES_cloth_cover;
    if (img) {
      const b = img.bbox || { x: 0, y: 0, w: img.width, h: img.height };
      ctx.drawImage(img, b.x, b.y, b.w, b.h, r.x, r.y, r.w, r.h);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(r.x + r.w * 0.3, r.y); ctx.lineTo(r.x + r.w * 0.7, r.y);
    ctx.lineTo(r.x + r.w, r.y + r.h); ctx.lineTo(r.x, r.y + r.h); ctx.closePath();
    ctx.fillStyle = '#E6DCC4'; ctx.fill();
    ctx.strokeStyle = COLORS.brassDark; ctx.lineWidth = 1.5; ctx.stroke();
  }

  /** 蠟封（tint = 提示色）→ 黃銅框（永不 tint），置中喺布 55% 高度 */
  drawSeal(c, hintUnit, alpha = 1) {
    const ctx = this.ctx;
    const r = this._clothRect(c);
    const side = r.w * 0.72;
    const cx = 0, cy = r.y + r.h * 0.55;
    const seal = renderAssets.img.VES_wax_seal, ring = renderAssets.img.VES_wax_ring;
    const hex = hintUnit === null || hintUnit === undefined ? COLORS.textSecondary : hexOf(hintUnit);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    if (seal) ctx.drawImage(this._tintedSeal(seal, hex, side), cx - side / 2, cy - side / 2, side, side);
    else { ctx.beginPath(); ctx.arc(cx, cy, side * 0.36, 0, Math.PI * 2); ctx.fillStyle = hex; ctx.fill(); }
    if (ring) ctx.drawImage(ring, cx - side / 2, cy - side / 2, side, side);
    else { ctx.beginPath(); ctx.arc(cx, cy, side * 0.42, 0, Math.PI * 2); ctx.strokeStyle = COLORS.brassMain; ctx.lineWidth = 3; ctx.stroke(); }
    ctx.restore();
  }

  /** 蠟餅染色（快取）：source-atop 上色保住形狀，再 multiply 原圖攞返陰影 */
  _tintedSeal(seal, hex, side) {
    const px = Math.max(16, Math.round(side * (window.devicePixelRatio || 1)));
    const key = hex + ':' + px;
    let cv = this._sealCache.get(key);
    if (cv) return cv;
    cv = document.createElement('canvas'); cv.width = px; cv.height = px;
    const x = cv.getContext('2d');
    x.drawImage(seal, 0, 0, px, px);
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = rgba(hex, 0.82); x.fillRect(0, 0, px, px);
    x.globalCompositeOperation = 'multiply';
    x.globalAlpha = 0.65; x.drawImage(seal, 0, 0, px, px);
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    this._sealCache.set(key, cv);
    return cv;
  }

  /** 瓶上小徽章（「N 單」）：woodDark 90% 底、brassMain 邊、textPrimary 字 */
  drawBadge(label, cx, cy, opt = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.font = `bold ${Math.max(10, Math.min(14, this.bottleWidth ? this.bottleWidth * 0.2 : 12))}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width + 12, th = 20;
    ctx.beginPath(); ctx.roundRect(cx - tw / 2, cy - th / 2, tw, th, th / 2);
    ctx.fillStyle = rgba(COLORS.woodDark, 0.9); ctx.fill();
    ctx.strokeStyle = COLORS.brassMain; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = opt.text || COLORS.textPrimary; ctx.fillText(label, cx, cy + 1);
    ctx.restore();
  }

  // ---------- 液柱 ----------
  drawStreams() {
    const ctx = this.ctx;
    for (const s of this.streams) {
      const S = this.cups[s.from], T = this.cups[s.to];
      if (!S || !T) continue;
      // 壺嘴：來源瓶口靠目標嗰一邊（經旋轉）
      const { g, S: fs, fx, fy } = this._frame(S);
      const lipU = g.rim.cx + (s.side < 0 ? g.rim.rx : -g.rim.rx);
      const lip = this._toWorld(S, fx + lipU * fs, fy + g.rim.y * fs);
      const level = T.seg.length + T.extraUnits;
      const tgt = this._toWorld(T, 0, this._surfaceY(T, level));
      const hex = hexOf(s.color);
      ctx.save();
      ctx.globalAlpha = s.alpha;
      ctx.lineCap = 'round';
      const curve = () => { ctx.beginPath(); ctx.moveTo(lip.x, lip.y); ctx.quadraticCurveTo(lip.x + (tgt.x - lip.x) * 0.15, lip.y + (tgt.y - lip.y) * 0.55, tgt.x, tgt.y); };
      curve(); ctx.strokeStyle = hex; ctx.lineWidth = s.width; ctx.stroke();
      curve(); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = s.width * 0.35; ctx.stroke();
      ctx.restore();
    }
  }

  drawHint(now) {
    const hnt = this.hintArrow;
    if (!hnt) return;
    const t = (now - hnt.t0) / hnt.dur;
    if (t >= 1) { this.hintArrow = null; return; }
    const A = this.cups[hnt.from], B = this.cups[hnt.to];
    if (!A || !B) return;
    const ctx = this.ctx;
    const pulse = 0.55 + 0.45 * Math.sin(now / 140);
    ctx.save();
    ctx.globalAlpha = Math.min(1, (1 - t) * 3) * pulse;
    for (const c of [A, B]) {
      ctx.save();
      ctx.translate(c.hx, c.hy); ctx.rotate(c.rot0);
      ctx.beginPath(); ctx.roundRect(-c.w / 2 - 6, -c.h / 2 - 8, c.w + 12, c.h + 14, 12);
      ctx.strokeStyle = COLORS.brassLight; ctx.lineWidth = 3; ctx.setLineDash([6, 5]); ctx.stroke();
      ctx.restore();
    }
    ctx.setLineDash([]);
    const ax = A.hx, ay = A.hy - A.h / 2 - 12, bx = B.hx, by = B.hy - B.h / 2 - 12;
    const mx = (ax + bx) / 2, my = Math.max(8, Math.min(ay, by) - 34);   // 頂行嘅瓶：弧線唔好穿出畫布
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by);
    ctx.strokeStyle = COLORS.brassLight; ctx.lineWidth = 3.5; ctx.stroke();
    const ang = Math.atan2(by - my, bx - mx);
    ctx.beginPath(); ctx.moveTo(bx, by);
    ctx.lineTo(bx - 12 * Math.cos(ang - 0.5), by - 12 * Math.sin(ang - 0.5));
    ctx.lineTo(bx - 12 * Math.cos(ang + 0.5), by - 12 * Math.sin(ang + 0.5));
    ctx.closePath(); ctx.fillStyle = COLORS.brassLight; ctx.fill();
    ctx.restore();
  }
}
