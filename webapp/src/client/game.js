// client/game.js — Canvas 渲染 + 輸入 + 倒液動畫（Spec v2 煉金工房版）。只負責「畫」同「接觸控」，規則全部喺 core/。
//
// 層序（Spec §3.2）：瓶身陰影 → 瓶身 sprite → 液體（multiply 混入 sprite 內壁）→ 配料圖案（該層色 −28% L）
//                    → cover（磨砂 sprite / 布）→ 蠟封（tint）→ 黃銅框（原色）→ 徽章
// 版面：core/layout.js safeLayout()（seed = levelId，R2 永不遮液體）；?jitter=0 強制純網格（Spec §9 步驟 6）。
// 遮蓋（使用者決定，蓋過 Spec）：
//   frosted  只畫可見格（頂格 + 露出過嘅格），隱藏格唔畫；新露出嘅格 160 ms 淡入
//   covered  布全遮 + 蠟封顯示頂格色 + 「N 單」徽章；鎖死；解鎖 → animateUnlock 布揭開動畫

import { PALETTE } from '../core/palette.js';
import { unitColor, unitPattern } from '../core/board.js';
import { COLORS, FROSTED_GLASS } from '../config/theme.js';
import { LAYOUT, CLOTH } from '../config/layout.js';
import { RENDER, patternUV } from '../config/render.js';
import { safeLayout, computeLayout } from '../core/layout.js';
import { renderAssets, preloadRenderAssets, geomFor, spriteKey, extentsAt, bandPolygon } from './render-assets.js';

const cubicInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const cubicOut = t => 1 - Math.pow(1 - t, 3);
const backOut = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const clamp01 = t => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;
const FONT = '"Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif';

/** unit key → 液體 hex（colour 可能係 unit key，亦兼容純 colorId） */
const hexOf = (u) => (PALETTE[unitColor(u)] || PALETTE[0]).hex;

/** hex → rgba(…, alpha) */
function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** HSL 明度偏移（配料墨 = 該層色 −28% L；下緣暗邊 −18% L），回傳 rgba 字串 */
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

const PARAMS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const FORCE_GRID = PARAMS.get('jitter') === '0';
const LIFT_PX = 16;                 // 選中提起高度
const HOLD_TIMEOUT_MS = 2500;       // setBoard 後等唔到 animateUnlock → 自動補播揭開（防止卡住舊畫面）
const PENDING_TIMEOUT_MS = 1500;    // setBoard 後等唔到 animateDeliver → 直接放棄保留嘅液體
const PAT_NAMES = ['P0', 'P1', 'P2', 'P3', 'P4'];

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
    this._scratch = document.createElement('canvas');   // 配料墨 / 染色用
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
    this.resize();
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this.canvas.removeEventListener('pointerdown', this._onPointer);
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
  }

  /**
   * 瓶尺寸：先揀令 4 欄（+ 半格偏移）放得落、rows 行高度都夠嘅瓶闊，再交畀 safeLayout（seed = levelId）。
   * bottleHeight = 內容高度（frame 0.0299–0.9701），瓶闊 = 該關最闊器皿嘅 maxWidth（磨砂瓶比燒瓶闊）。
   */
  layout() {
    const n = this.cups.length;
    if (!n || this.W < 40 || this.H < 40) return;
    const padX = 6, padTop = 26, padBottom = 8;
    const areaWidth = Math.max(60, this.W - padX * 2), areaHeight = Math.max(60, this.H - padTop - padBottom);
    const flask = geomFor('normal');
    const contentSpan = flask.content.bottom - flask.content.top;
    let widthRatio = flask.maxWidth;
    for (const c of this.cups) widthRatio = Math.max(widthRatio, geomFor(c.kind).maxWidth);
    const aspect = contentSpan / widthRatio;                 // 內容高 / 最闊器皿闊
    const rows = Math.max(1, Math.ceil(n / LAYOUT.columns));
    const byW = (areaWidth / (LAYOUT.columns + (rows > 1 ? LAYOUT.rowOffsetRatio : 0))) * 0.86;
    const byH = ((areaHeight / rows) * 0.72) / aspect;   // 每行 72% 高度畀瓶，其餘留畀 jitter（R2 由 safeLayout 把關）
    let bottleWidth = Math.min(byW, byH, 230 / aspect);
    let bottleHeight = bottleWidth * aspect;
    const input = { levelId: this.levelId, bottleCount: n, areaWidth, areaHeight, bottleWidth, bottleHeight };
    let placed;
    try {
      if (FORCE_GRID) placed = { layout: computeLayout(input, { jitterX: 0, jitterY: 0, rotationMaxDeg: 0 }), bottleWidth, bottleHeight, fallback: 0 };
      else placed = safeLayout(input, (m) => console.warn(m));
    } catch (e) {
      console.warn('[layout] safeLayout 失敗，退回純網格', e);
      placed = { layout: computeLayout(input, { jitterX: 0, jitterY: 0, rotationMaxDeg: 0 }), bottleWidth, bottleHeight, fallback: 9 };
    }
    this.bottleWidth = placed.bottleWidth; this.bottleHeight = placed.bottleHeight;
    this.frameScale = placed.bottleHeight / contentSpan;   // 768 frame → px
    this.flaskWidth = flask.maxWidth * this.frameScale;
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
      const pa = A.anim === 'pour' ? 1 : 0, pb = B.anim === 'pour' ? 1 : 0;
      return (pa - pb) || ((A.z ?? a) - (B.z ?? b));
    });
  }

  /**
   * 接收遮罩盤面（隱藏格 = null）。保留舊杯嘅動畫 / 位置狀態；記低：
   *  - 磨砂瓶新露出嘅格（null → 值）→ 160 ms 淡入
   *  - 布遮瓶由 locked 變 normal → clothHold：繼續畫布，等 animateUnlock 播揭開
   *  - 滿瓶變空瓶（交貨）→ pendingSeg：繼續畫液體，等 animateDeliver 播消失
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
      };
      if (old) {
        // 磨砂瓶逐格露出
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
        // 滿 → 空（交貨）：先保留液體，等 animateDeliver
        const oldSeg = old.pendingSeg?.seg ?? old.seg;
        if (seg.length === 0 && oldSeg.length >= old.cap && oldSeg.every(v => v !== null && v === oldSeg[0]) && !old.anim) {
          cup.pendingSeg = { t0: old.pendingSeg?.t0 ?? now, seg: oldSeg.slice(), kind: old.kind };
        }
      } else {
        for (let k = 0; k < seg.length; k++) if (seg[k] === null) cup.fade[k] = undefined;
      }
      return cup;
    });
    this.layout();
  }

  setInteractive(v) { this.interactive = v; }

  select(idx) { this.selected = idx; }

  /** 點擊測試：由最前（zIndex 大）到最後，旋轉矩形（內容框 + 6px 鬆動；布遮瓶用布闊）。鎖住嘅布遮瓶都會回傳（由 main.js 決定 shake） */
  cupAt(px, py) {
    const order = [...this.drawOrder].reverse();
    for (const i of order) {
      const c = this.cups[i];
      const cx = c.x, cy = c.y - c.lift * LIFT_PX;
      const rot = c.rot0 + c.rotA;
      const dx = px - cx, dy = py - cy;
      const cos = Math.cos(-rot), sin = Math.sin(-rot);
      const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
      const cloth = this._showsCloth(c);
      const halfW = (cloth ? this._clothRect(c).w : c.w) / 2 + 6;
      const top = -c.h / 2 - (cloth ? c.h * CLOTH.topOffsetRatio : 0) - 10, bottom = c.h / 2 + 6;
      if (lx >= -halfW && lx <= halfW && ly >= top && ly <= bottom) return i;
    }
    return -1;
  }

  // ---------- 動畫工具 ----------
  _tween(dur, fn) {
    // 分頁隱藏時 requestAnimationFrame 會暫停；改用 setTimeout 推進，動畫唔會卡死
    const schedule = (cb) => (document.hidden ? setTimeout(() => cb(performance.now()), 40) : requestAnimationFrame(cb));
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

  /** 交貨：金光 + 液體升起消失 + 浮字 */
  async animateDeliver(idx, label = '✓ 交貨') {
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
    });
    c.seg = []; c.layerAlpha = 1; c.scale = 1; c.glow = 0; c.anim = null;
    if (c.kind === 'frosted') c.kind = 'normal';
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
    this.floaters.push({ x: top.x, y: top.y - 10, text: '揭開！', t0: performance.now(), dur: 1000, color: COLORS.brassLight });
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

    for (let i = 0; i < this.cups.length; i++) {
      const c = this.cups[i];
      const target = (this.selected === i && !c.anim) ? 1 : 0;
      c.lift += (target - c.lift) * Math.min(1, dt * 14);
      if (c.settle && now - c.settle.t0 > c.settle.dur) c.settle = null;
      // 唔係動畫中：滑向 home（換版面 / 加空瓶 / resize 時順滑移位）
      if (!c.anim) { const k = Math.min(1, dt * 12); c.x += (c.hx - c.x) * k; c.y += (c.hy - c.y) * k; if (Math.abs(c.hx - c.x) < 0.2) c.x = c.hx; if (Math.abs(c.hy - c.y) < 0.2) c.y = c.hy; }
      // 保留狀態等唔到動畫 → 自動補播 / 放棄
      if (c.clothHold && now - c.clothHold.t0 > HOLD_TIMEOUT_MS) this.animateUnlock(i);
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

  /** 布矩形（local px）：闊 = 1.34 × 燒瓶闊；頂高過瓶頂 7%；底貼瓶底 */
  _clothRect(c) {
    const w = CLOTH.fixedWidthRatio * (this.flaskWidth || c.w);
    const top = -c.h / 2 - c.h * CLOTH.topOffsetRatio;
    return { x: -w / 2, y: top, w, h: c.h / 2 - top };
  }

  drawCup(c, idx, now) {
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
      if (glow > 0) { ctx.shadowColor = rgba(COLORS.candleGlow, glow); ctx.shadowBlur = 18 + 8 * glow; ctx.shadowOffsetY = 0; }
    };
    const shadowOff = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; };
    this.drawGroundShadow(c);

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
      if (c.kind === 'cracked') this.drawBadge('只出', 0, c.h * 0.36, { text: COLORS.brassMain });
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
      if (!r) this.drawBadge(`${c.unlockIn || 1} 單`, 0, this._clothRect(c).y + this._clothRect(c).h * 0.55 + this._clothRect(c).w * 0.36 + 12);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * 發光三件套 ③：整瓶背後柔光 = 每層色 @ 12%，blur 12px。
   * 畫喺瓶身 sprite 之下：多邊形本身會被玻璃蓋住，只剩 shadowBlur 嘅光暈溢出瓶外——「藥劑喺暗房發光」。
   */
  drawBackGlow(c, alphaMul = 1) {
    const ctx = this.ctx;
    const { g, S, fx, fy } = this._frame(c);
    const seg = c.pendingSeg ? c.pendingSeg.seg : c.seg;
    if (!seg.length) return;
    const slot = (g.liquid.bottom - g.liquid.top) / c.cap;
    const yAt = (level) => g.liquid.bottom - level * slot;
    const dpr = window.devicePixelRatio || 1;
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
    }
    ctx.restore();
  }

  /** 瓶底投影：COLORS.shadow 50%，向下偏 6px，柔邊 ≈ blur 10 */
  drawGroundShadow(c) {
    const ctx = this.ctx;
    const cloth = this._showsCloth(c) && !c.reveal;
    const w = cloth ? this._clothRect(c).w : c.w;
    const cy = c.h / 2 + 6 - c.lift * 2, rx = w * 0.5, ry = Math.max(4, w * 0.13);
    const gr = ctx.createRadialGradient(0, cy, 0, 0, cy, rx);
    gr.addColorStop(0, rgba(COLORS.shadow, 0.5)); gr.addColorStop(0.55, rgba(COLORS.shadow, 0.35)); gr.addColorStop(1, rgba(COLORS.shadow, 0));
    ctx.save();
    ctx.translate(0, cy); ctx.scale(1, ry / rx); ctx.translate(0, -cy);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, cy, rx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /** 瓶身 sprite（未載入 → 程式畫佔位） */
  drawVessel(c) {
    const ctx = this.ctx;
    const { g, S, fx, fy } = this._frame(c);
    const kind = c.kind === 'covered' ? 'normal' : c.kind;
    const img = renderAssets.img[spriteKey(kind)];
    if (img) { ctx.drawImage(img, fx, fy, S, S); return; }
    // 佔位：內壁多邊形 + 頸 + 口
    const poly = bandPolygon(g, g.liquid.top, g.liquid.bottom);
    ctx.beginPath();
    poly.forEach(([u, v], i) => (i ? ctx.lineTo(fx + u * S, fy + v * S) : ctx.moveTo(fx + u * S, fy + v * S)));
    ctx.closePath();
    ctx.fillStyle = kind === 'frosted' ? FROSTED_GLASS : 'rgba(245,245,240,0.92)'; ctx.fill();
    ctx.strokeStyle = COLORS.brassDark; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.rect(fx + g.neck.l * S, fy + g.rim.y * S, (g.neck.r - g.neck.l) * S, (g.liquid.top - g.rim.y) * S);
    ctx.fillStyle = 'rgba(245,245,240,0.8)'; ctx.fill(); ctx.stroke();
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
   * 液體：第 i 格 = 內壁 liquid.bottom 向上第 i 個 slot。
   *  normal / cracked / takeaway：multiply 混入 sprite（玻璃近白 → 顏色保住，蝕刻線透出）
   *  frosted：只畫可見格，opaque（磨砂玻璃太灰，multiply 會變泥）；新露出格 160 ms 淡入
   */
  drawLiquid(c, now) {
    const ctx = this.ctx;
    const { g, S, fx, fy } = this._frame(c);
    const slot = (g.liquid.bottom - g.liquid.top) / c.cap;
    const yAt = (level) => g.liquid.bottom - level * slot;           // frame 單位
    const frosted = c.kind === 'frosted' || c.pendingSeg?.kind === 'frosted';
    const seg = c.pendingSeg ? c.pendingSeg.seg : c.seg;
    const n = seg.length;
    let settleScale = 1;
    if (c.settle) settleScale = 1 + 0.08 * (1 - backOut(clamp01((now - c.settle.t0) / c.settle.dur)));
    const baseAlpha = ctx.globalAlpha * c.layerAlpha;
    const lineW = Math.max(1, Math.min(2, c.w * 0.03));
    const liqBase = renderAssets.img.LIQ_base;

    const drawBand = (from, to, unit, alpha) => {
      if (to - from <= 0.001) return;
      const yTop = yAt(to), yBot = yAt(from);
      const hex = hexOf(unit);
      const y1 = fy + yTop * S, y2 = fy + yBot * S;
      const ext = extentsAt(g, (yTop + yBot) / 2);
      const bx0 = fx + ext.l * S, bx1 = fx + ext.r * S;
      ctx.save();
      ctx.globalAlpha = baseAlpha * alpha;
      this._bandPath(g, S, fx, fy, yTop, yBot);
      ctx.clip();
      if (frosted) {
        // 已經 clip 住內壁多邊形 → 全闊填色（用層中段闊度會喺圓肚彎位露出灰玻璃楔形）
        ctx.fillStyle = hex; ctx.globalAlpha = baseAlpha * alpha * 0.92;
        ctx.fillRect(fx, y1, S, y2 - y1);
        ctx.globalAlpha = baseAlpha * alpha;
      } else {
        ctx.globalCompositeOperation = RENDER.liquidBlend;
        ctx.fillStyle = hex;
        ctx.fillRect(fx, y1, S, y2 - y1);
        // 液體底圖（白色圓角帶，multiply → 只留淡淡厚度感）
        if (liqBase && y2 - y1 > 6) {
          const b = liqBase.bbox || { x: 0, y: 0, w: liqBase.naturalWidth, h: liqBase.naturalHeight };
          ctx.drawImage(liqBase, b.x, b.y, b.w, b.h, fx + (ext.l - 0.02) * S, y1 - (y2 - y1) * 0.08, (ext.r - ext.l + 0.04) * S, (y2 - y1) * 1.16);
        }
        // 下緣暗邊：模擬液體厚度
        ctx.fillStyle = shiftL(hex, -0.18, 1);
        ctx.fillRect(fx, y2 - Math.max(1, lineW * 0.7), S, Math.max(1, lineW * 0.7));
        ctx.globalCompositeOperation = 'source-over';
      }
      if (y2 - y1 > lineW * 2) {
        // 發光三件套 ①：液面高光線 = 該層色 +35% 明度，2px，layer 頂邊
        ctx.fillStyle = shiftL(hex, RENDER.glow.surfaceLineL, 0.95);
        ctx.fillRect(fx, y1, S, RENDER.glow.surfaceLinePx);
      }
      ctx.restore();
      // 發光三件套 ②：液體外緣 rim glow = 該層色 @ 40%，2px（沿內壁多邊形描邊，唔受 clip 限制 → 光暈微微溢出玻璃）
      ctx.save();
      ctx.globalAlpha = baseAlpha * alpha;
      this._bandPath(g, S, fx, fy, yTop, yBot);
      ctx.strokeStyle = rgba(hex, RENDER.glow.rimAlpha); ctx.lineWidth = RENDER.glow.rimPx; ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
      // 配料圖案（該層色 −28% L）
      const p = unitPattern(unit);
      if (p > 0) this.drawPattern(c, p, hex, bx0, y1, bx1 - bx0, y2 - y1, baseAlpha * alpha, g, S, fx, fy, yTop, yBot);
    };
    const drawHidden = (from, to) => {
      // 隱藏格（normal 杯有 null：理論上冇，保險起見畫「?」深格）
      const yTop = yAt(to), yBot = yAt(from);
      ctx.save();
      ctx.globalAlpha = baseAlpha;
      this._bandPath(g, S, fx, fy, yTop, yBot); ctx.clip();
      ctx.fillStyle = rgba(FROSTED_GLASS, 0.85); ctx.fillRect(fx, fy + yTop * S, S, (yBot - yTop) * S);
      ctx.fillStyle = COLORS.textPrimary; ctx.font = `bold ${Math.max(10, slot * S * 0.55)}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, fy + ((yTop + yBot) / 2) * S);
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
      if (u === null) { if (!frosted) drawHidden(level, top); }
      else {
        const t0 = c.fade[i];
        const alpha = t0 ? clamp01((now - t0) / RENDER.frostedRevealMs) : 1;
        drawBand(level, top, u, alpha);
      }
      level += units;
    }
    // 正在倒入嘅新層
    if (c.extraUnits > 0 && c.extraColor !== null) drawBand(level, level + c.extraUnits, c.extraColor, 1);
    const fill = level + (c.extraUnits || 0);
    // 左側垂直高光柱（只喺有液體時）
    if (fill > 0 && !frosted) {
      const yTop = yAt(Math.min(c.cap, fill)), yBot = g.liquid.bottom;
      ctx.save();
      ctx.globalAlpha = baseAlpha;
      this._bandPath(g, S, fx, fy, yTop, yBot); ctx.clip();
      const ext = extentsAt(g, (yTop + yBot) / 2);
      const x0 = fx + ext.l * S + c.w * 0.05, x1 = x0 + c.w * 0.10;
      const gr = ctx.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(x0, fy + yTop * S, x1 - x0, (yBot - yTop) * S);
      ctx.restore();
    }
  }

  /**
   * 配料圖案（決定 8）：層高 ≥48px 用 PAT_tile_large，<48px 用 PAT_tile_small；<32px 只畫層中央單一 icon。
   * 取樣象限 = patternUV(p)（含 inset）；圖案按層高等比縮放置中，P3 橫向 repeat 鋪滿，其餘 clamp（單一象限）。
   * tile 係灰階 L 遮罩（黑 = 墨）→ 已轉成 alpha 遮罩，source-in 染成該層色 −28% L。
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
    if (sc.width !== W || sc.height !== H) { sc.width = W; sc.height = H; }
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
    const hex = hintUnit === null || hintUnit === undefined ? '#9A8B6F' : hexOf(hintUnit);
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

  /** 瓶上小徽章（「N 單」/「只出」）：woodDark 90% 底、brassMain 邊、textPrimary 字 */
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
    const mx = (ax + bx) / 2, my = Math.min(ay, by) - 34;
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
