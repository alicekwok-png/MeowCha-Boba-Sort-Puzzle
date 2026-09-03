// client/game.js — Canvas 渲染 + 輸入 + 倒液動畫。只負責「畫」同「接觸控」，規則全部喺 core/。

import { PALETTE } from '../core/palette.js';

const HEX = PALETTE.map(p => p.hex);
const cubicInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const cubicOut = t => 1 - Math.pow(1 - t, 3);
const backOut = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const clamp01 = t => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * t;

function shade(hex, amt) {   // amt −1..1
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  r = f(r); g = f(g); b = f(b);
  return `rgb(${r},${g},${b})`;
}

export class GameView {
  constructor(canvas, { onCupTap } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onCupTap = onCupTap || (() => {});
    this.cups = [];
    this.selected = null;
    this.interactive = true;
    this.particles = [];
    this.floaters = [];
    this.streams = [];
    this.hintArrow = null;
    // 杯貼圖（美術透明 PNG）+ 杯內液體幾何；未載入時用程式畫嘅杯
    this.sprite = null; this.geom = null;
    const base = new URL('../../assets/', import.meta.url);
    const img = new Image();
    img.onload = () => { this.sprite = img; this.layout(); };
    img.src = new URL('cup-body.webp', base).href;
    fetch(new URL('cup-geom.json', base)).then(r => r.json()).then(g => { this.geom = g; this.layout(); }).catch(() => {});
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

  layout() {
    const n = this.cups.length;
    if (!n) return;
    const padX = 14, padTop = 30, padBottom = 12, gapX = 10, gapY = 40;
    let best = null;
    for (let rows = 1; rows <= 3; rows++) {
      const cols = Math.ceil(n / rows);
      if (rows > 1 && Math.ceil(n / (rows - 1)) === cols) continue;
      const wByW = (this.W - padX * 2 - gapX * (cols - 1)) / cols;
      const hByH = (this.H - padTop - padBottom - gapY * (rows - 1)) / rows;
      const cupW = Math.min(118, wByW, hByH / 1.55);
      if (!best || cupW > best.cupW) best = { rows, cols, cupW };
    }
    const { rows, cols, cupW } = best;
    const aspect = this.geom ? this.geom.aspect : 1 / 1.5;
    const w = Math.max(28, Math.min(cupW, (this.H - padTop - padBottom - gapY * (rows - 1)) / rows * aspect)), h = w / aspect;
    const rowH = h + gapY;
    const totalH = rows * rowH - gapY;
    const y0 = padTop + Math.max(0, (this.H - padTop - padBottom - totalH) / 2);
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      const inRow = Math.min(cols, n - idx);
      const rowW = inRow * w + (inRow - 1) * gapX;
      const x0 = (this.W - rowW) / 2;
      for (let c = 0; c < inRow; c++, idx++) {
        const cup = this.cups[idx];
        cup.w = w; cup.h = h;
        cup.hx = x0 + c * (w + gapX); cup.hy = y0 + r * rowH;
        if (!cup.anim) { cup.x = cup.hx; cup.y = cup.hy; }
      }
    }
    this.slotH = (h - 10) / 4;
  }

  setBoard(board) {
    const prev = this.cups;
    this.cups = board.cups.map((c, i) => {
      const old = prev[i] || {};
      return {
        kind: c.kind, cap: c.cap, locked: c.locked, seg: c.seg.slice(),
        x: old.x ?? 0, y: old.y ?? 0, hx: old.hx ?? 0, hy: old.hy ?? 0, w: old.w ?? 60, h: old.h ?? 90,
        lift: old.lift ?? 0, rot: 0, scale: 1, alpha: 1, anim: null,
        extraUnits: 0, extraColor: null, removedUnits: 0, glow: 0, layerAlpha: 1, lidOffset: 0, lidAlpha: 1,
      };
    });
    this.layout();
  }

  setInteractive(v) { this.interactive = v; }

  select(idx) { this.selected = idx; }

  cupAt(px, py) {
    for (let i = 0; i < this.cups.length; i++) {
      const c = this.cups[i];
      if (px >= c.hx - 6 && px <= c.hx + c.w + 6 && py >= c.hy - 30 && py <= c.hy + c.h + 8) return i;
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

  /** 倒液：來源移到目標上方傾斜 → 液柱 + 液面升 → 回位。呼叫前 view 仍係舊盤面。 */
  async animatePour(from, to, n, color) {
    const S = this.cups[from], T = this.cups[to];
    S.anim = 'pour';
    const side = S.hx + S.w / 2 <= T.hx + T.w / 2 ? -1 : 1;           // 由左邊倒 → 順時針傾
    const px = T.hx + T.w / 2 + side * (S.w * 0.62) - S.w / 2;
    const py = T.hy - S.h * 0.78;
    const sx = S.x, sy = S.y - S.lift * 16;
    S.lift = 0;
    const ang = -side * 35 * Math.PI / 180;

    // A. 移動 + 傾斜（Cubic.easeInOut，180 ms）
    await this._tween(180, t => {
      const e = cubicInOut(t);
      S.x = lerp(sx, px, e); S.y = lerp(sy, py, e); S.rot = ang * e;
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
      if (!splashed && t > 0.18) { splashed = true; this._splash(T, color, 6 + n * 2); }
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
      S.x = lerp(px, S.hx, e); S.y = lerp(py, S.hy, e); S.rot = ang * (1 - e);
    });
    S.x = S.hx; S.y = S.hy; S.rot = 0; S.anim = null;
  }

  _splash(T, color, count) {
    const cx = T.x + T.w / 2;
    const level = T.seg.length + T.extraUnits;
    const L = this._liquid(T);
    const cy = T.y + L.bottom - level * L.slotH;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: cx + (Math.random() - 0.5) * T.w * 0.5, y: cy,
        vx: (Math.random() - 0.5) * 140, vy: -60 - Math.random() * 120,
        life: 0, dur: 200 + Math.random() * 80, r: 1.5 + Math.random() * 2, color,
      });
    }
  }

  /** 交付：金光 + 液體升起消失 + 浮字 */
  async animateDeliver(idx, label = '✓ 出單') {
    const c = this.cups[idx];
    c.anim = 'deliver';
    const cx = c.hx + c.w / 2;
    for (let i = 0; i < 14; i++) {
      this.particles.push({
        x: cx + (Math.random() - 0.5) * c.w, y: c.hy + c.h * (0.2 + Math.random() * 0.7),
        vx: (Math.random() - 0.5) * 80, vy: -90 - Math.random() * 90,
        life: 0, dur: 420 + Math.random() * 200, r: 2 + Math.random() * 2, color: '#F6C453', star: true,
      });
    }
    this.floaters.push({ x: cx, y: c.hy - 6, text: label, t0: performance.now(), dur: 900, color: '#B5651D' });
    await this._tween(380, t => {
      c.glow = 1 - t;
      c.scale = 1 + Math.sin(t * Math.PI) * 0.1;
      c.layerAlpha = 1 - cubicInOut(t);
    });
    c.seg = []; c.layerAlpha = 1; c.scale = 1; c.glow = 0; c.anim = null;
    if (c.kind === 'frosted') c.kind = 'normal';
  }

  /** 解封：封膜飛走 */
  async animateUnlock(idx) {
    const c = this.cups[idx];
    this.floaters.push({ x: c.hx + c.w / 2, y: c.hy - 10, text: '🔓 解封！', t0: performance.now(), dur: 1000, color: '#7A4E1E' });
    await this._tween(420, t => { c.lidOffset = -60 * cubicOut(t); c.lidAlpha = 1 - t; c.glow = 1 - t; });
    c.locked = false; c.kind = 'normal'; c.lidOffset = 0; c.lidAlpha = 1; c.glow = 0;
  }

  async animateWin() {
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 26; i++) {
        this.particles.push({
          x: Math.random() * this.W, y: this.H + 10,
          vx: (Math.random() - 0.5) * 160, vy: -260 - Math.random() * 260,
          life: 0, dur: 1100 + Math.random() * 500, r: 3 + Math.random() * 3,
          color: ['#F6C453', '#E88D5A', '#F2A6B8', '#8DD3B4', '#B9A0E0'][i % 5], star: i % 3 === 0, gravity: 220,
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

    // 選中提起
    for (let i = 0; i < this.cups.length; i++) {
      const c = this.cups[i];
      const target = (this.selected === i && !c.anim) ? 1 : 0;
      c.lift += (target - c.lift) * Math.min(1, dt * 14);
      if (c.settle && now - c.settle.t0 > c.settle.dur) c.settle = null;
    }

    const order = this.cups.map((_, i) => i).sort((a, b) => (this.cups[a].anim === 'pour') - (this.cups[b].anim === 'pour'));
    for (const i of order) this.drawCup(this.cups[i], i, now);
    this.drawStreams();
    this.drawHint(now);

    // 粒子
    this.particles = this.particles.filter(p => (p.life += dt * 1000) < p.dur);
    for (const p of this.particles) {
      p.vy += (p.gravity ?? 520) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const a = 1 - p.life / p.dur;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.star) { this._star(p.x, p.y, p.r * 1.6); } else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;

    // 浮字
    this.floaters = this.floaters.filter(f => now - f.t0 < f.dur);
    for (const f of this.floaters) {
      const t = (now - f.t0) / f.dur;
      ctx.globalAlpha = 1 - t * t;
      ctx.font = 'bold 15px "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
      ctx.strokeText(f.text, f.x, f.y - t * 34);
      ctx.fillStyle = f.color;
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

  // ---------- 畫杯 ----------
  drawCup(c, idx, now) {
    const ctx = this.ctx;
    const w = c.w, h = c.h;
    const x = c.x, y = c.y - c.lift * 16;
    ctx.save();
    ctx.translate(x + w / 2, y + h);            // 以杯底中心為原點（旋轉軸）
    ctx.rotate(c.rot);
    ctx.scale(c.scale, c.scale);
    ctx.translate(-w / 2, -h);
    ctx.globalAlpha = c.alpha;

    if (c.glow > 0) {
      ctx.shadowColor = `rgba(246,196,83,${c.glow})`; ctx.shadowBlur = 24 * c.glow;
    } else if (this.selected === idx) {
      ctx.shadowColor = 'rgba(232,141,90,0.55)'; ctx.shadowBlur = 16;
    } else {
      ctx.shadowColor = 'rgba(80,50,20,0.18)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    }

    if (this._useSprite(c)) {
      // 美術杯貼圖：杯身實色，液體用 multiply 畫喺杯內（反光留光、珍珠留深）
      ctx.drawImage(this.sprite, 0, 0, w, h);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      if (c.seg.length === 0 && !(c.extraUnits > 0)) this.coverPearls(c, w, h);   // 空杯唔應該見到珍珠
      this.drawLayers(c, w, h, now);
      if (c.locked) {
        const g = this.geom;
        ctx.save(); ctx.translate(0, c.lidOffset || 0); ctx.globalAlpha *= (c.lidAlpha ?? 1);
        this.drawFilmLid(w, g.rimY * h, g.rimRx * w, g.rimRy * h * 1.15);
        ctx.restore();
      }
      ctx.restore();
      return;
    }

    if (c.kind === 'takeaway') this.drawBag(c, w, h);
    else this.drawPlasticBody(c, w, h);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

    this.drawLayers(c, w, h, now);
    if (c.kind === 'takeaway') this.drawBagFront(c, w, h);
    else this.drawPlasticFront(c, w, h);
    ctx.restore();
  }

  /** 普通杯 / 封膜杯（cap 4、非磨砂）用貼圖；磨砂、外帶維持程式畫 */
  _useSprite(c) {
    return !!(this.sprite && this.geom) && c.cap === 4 && c.kind !== 'frosted' && c.kind !== 'takeaway';
  }

  /** 液體區域幾何：bottom（液面 y=0 基準）、slotH、左右邊界函數 */
  _liquid(c) {
    const w = c.w, h = c.h;
    if (this._useSprite(c)) {
      const g = this.geom.inner;
      const top = g.topY * h, bottom = g.botY * h, span = bottom - top;
      const lerpX = (y, a, b) => (a + (b - a) * ((bottom - y) / span)) * w;   // y 由底向上
      return { bottom, slotH: span / c.cap, xl: y => lerpX(y, g.botL, g.topL), xr: y => lerpX(y, g.botR, g.topR), sprite: true };
    }
    const bottom = h - 5, slotH = (h - 10) / 4;
    const isBag = c.kind === 'takeaway', inset = isBag ? 7 : 0;
    return { bottom, slotH, xl: y => (isBag ? inset : this._xAt(w, h, y)), xr: y => (isBag ? w - inset : w - this._xAt(w, h, y)), sprite: false };
  }

  /**
   * 空杯遮走貼圖底部內置嘅珍珠：用貼圖上面一段乾淨膠身拉長蓋住珍珠帶（裁喺杯內多邊形）。
   * 有液體時珍珠透過 multiply 露出，似真係沉喺杯底。
   */
  coverPearls(c, w, h) {
    const ctx = this.ctx, L = this._liquid(c), g = this.geom.inner;
    const iw = this.sprite.naturalWidth, ih = this.sprite.naturalHeight;
    const y1 = 0.80 * h, y2 = Math.min(h, (g.botY + 0.03) * h);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(L.xl(y1), y1); ctx.lineTo(L.xr(y1), y1); ctx.lineTo(L.xr(y2) + 1, y2); ctx.lineTo(L.xl(y2) - 1, y2); ctx.closePath();
    ctx.clip();
    ctx.drawImage(this.sprite, 0, 0.66 * ih, iw, 0.12 * ih, 0, y1, w, y2 - y1);
    ctx.restore();
  }

  /** 封膜：平面膠膜 + 鎖 */
  drawFilmLid(w, cy, rx, ry) {
    const ctx = this.ctx;
    ctx.beginPath(); ctx.ellipse(w / 2, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#F3D9B1'; ctx.fill();
    ctx.strokeStyle = 'rgba(140,95,50,0.7)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(w / 2, cy, rx * 0.86, ry * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
    const lx = w / 2, ly = cy - 13;
    ctx.fillStyle = '#8A5A2B';
    ctx.beginPath(); ctx.roundRect(lx - 7, ly, 14, 10, 2); ctx.fill();
    ctx.strokeStyle = '#8A5A2B'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(lx, ly, 4.5, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#F6E7CF'; ctx.beginPath(); ctx.arc(lx, ly + 5, 1.6, 0, Math.PI * 2); ctx.fill();
  }

  // 杯身梯形：頂闊 w，底闊 0.84w
  _bodyPath(w, h, inset = 0) {
    const ctx = this.ctx;
    const bw = w * 0.84;
    const l = (w - bw) / 2;
    const r = 7;
    ctx.beginPath();
    ctx.moveTo(inset, inset);
    ctx.lineTo(w - inset, inset);
    ctx.lineTo(w - l - inset, h - r - inset);
    ctx.quadraticCurveTo(w - l - inset, h - inset, w - l - r - inset, h - inset);
    ctx.lineTo(l + r + inset, h - inset);
    ctx.quadraticCurveTo(l + inset, h - inset, l + inset, h - r - inset);
    ctx.closePath();
  }

  _xAt(w, h, yy) {   // 該高度嘅左邊界 x（0 = 頂）
    const bw = w * 0.84;
    return ((w - bw) / 2) * (yy / h);
  }

  drawPlasticBody(c, w, h) {
    const ctx = this.ctx;
    this._bodyPath(w, h);
    if (c.kind === 'frosted') {
      ctx.fillStyle = '#FBF5EA';
    } else {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.5, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(255,255,255,0.5)');
      ctx.fillStyle = g;
    }
    ctx.fill();
  }

  drawPlasticFront(c, w, h) {
    const ctx = this.ctx;
    // 杯身外框
    this._bodyPath(w, h);
    ctx.strokeStyle = c.kind === 'frosted' ? 'rgba(160,120,80,0.55)' : 'rgba(120,85,50,0.5)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // 反光
    ctx.beginPath();
    ctx.moveTo(w * 0.16, h * 0.12); ctx.lineTo(w * 0.16 + w * 0.05, h * 0.12);
    ctx.lineTo(w * 0.16 + w * 0.03 + w * 0.05, h * 0.75); ctx.lineTo(w * 0.16 + w * 0.03, h * 0.75);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();

    if (c.kind === 'frosted') {
      // 磨砂杯：貼紙 + 肉球
      ctx.fillStyle = 'rgba(200,150,100,0.35)';
      const px = w / 2, py = h * 0.5, r = w * 0.07;
      ctx.beginPath(); ctx.ellipse(px, py + r * 0.9, r * 1.35, r * 1.05, 0, 0, Math.PI * 2); ctx.fill();
      for (const [dx, dy] of [[-1.4, -0.6], [-0.5, -1.4], [0.5, -1.4], [1.4, -0.6]]) {
        ctx.beginPath(); ctx.arc(px + dx * r, py + dy * r, r * 0.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // 頂：圓頂蓋 / 封膜
    ctx.save();
    ctx.translate(0, c.lidOffset || 0);
    ctx.globalAlpha *= (c.lidAlpha ?? 1);
    if (c.locked) {
      this.drawFilmLid(w, 0, w / 2 + 3, 6);
    } else {
      // 開口杯：只有一個薄杯沿（背景規格 §8：拿走杯頂圓拱，令杯陣區更平靜）
      ctx.beginPath(); ctx.ellipse(w / 2, 0, w / 2 + 2, 4.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = c.kind === 'frosted' ? 'rgba(255,253,248,0.95)' : 'rgba(255,255,255,0.55)'; ctx.fill();
      ctx.strokeStyle = c.kind === 'frosted' ? 'rgba(160,120,80,0.55)' : 'rgba(120,85,50,0.55)'; ctx.lineWidth = 1.6; ctx.stroke();
    }
    ctx.restore();
  }

  drawBag(c, w, h) {
    const ctx = this.ctx;
    ctx.beginPath(); ctx.roundRect(0, 0, w, h, [4, 4, 8, 8]);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#D9B27E'); g.addColorStop(0.5, '#E8C79A'); g.addColorStop(1, '#D3A971');
    ctx.fillStyle = g; ctx.fill();
  }

  drawBagFront(c, w, h) {
    const ctx = this.ctx;
    ctx.beginPath(); ctx.roundRect(0, 0, w, h, [4, 4, 8, 8]);
    ctx.strokeStyle = 'rgba(110,70,30,0.7)'; ctx.lineWidth = 1.6; ctx.stroke();
    // 手挽
    ctx.beginPath(); ctx.roundRect(w * 0.3, h * 0.045, w * 0.4, h * 0.05, 4);
    ctx.fillStyle = 'rgba(110,70,30,0.55)'; ctx.fill();
    // 窗口框
    const top = h - 5 - 3 * this.slotH - 2;
    ctx.beginPath(); ctx.roundRect(5, top, w - 10, 3 * this.slotH + 4, 4);
    ctx.strokeStyle = 'rgba(110,70,30,0.6)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
    // 「外帶」字樣
    ctx.fillStyle = 'rgba(110,70,30,0.7)';
    ctx.font = `bold ${Math.max(9, w * 0.16)}px "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('外帶', w / 2, top - 5);
  }

  drawLayers(c, w, h, now) {
    const ctx = this.ctx;
    const L = this._liquid(c);
    const sh = L.slotH, bottom = L.bottom;
    const isBag = c.kind === 'takeaway';
    const inset = isBag ? 7 : 0;
    ctx.save();
    if (L.sprite) {
      const top = bottom - (c.cap + 0.08) * sh;   // 留 8% 位畀滿杯落定時嘅回彈
      ctx.beginPath();
      ctx.moveTo(L.xl(top), top); ctx.lineTo(L.xr(top), top); ctx.lineTo(L.xr(bottom), bottom); ctx.lineTo(L.xl(bottom), bottom); ctx.closePath();
      ctx.clip();
      ctx.globalCompositeOperation = 'multiply';   // 液體 × 膠杯：反光留光、珍珠留深
    } else if (isBag) { ctx.beginPath(); ctx.roundRect(inset, bottom - 3 * sh - 1, w - inset * 2, 3 * sh + 1, 3); ctx.clip(); }
    else { this._bodyPath(w, h, 1.2); ctx.clip(); }
    ctx.globalAlpha *= c.layerAlpha;

    const n = c.seg.length;
    // settle overshoot
    let settleScale = 1;
    if (c.settle) {
      const t = clamp01((now - c.settle.t0) / c.settle.dur);
      settleScale = 1 + 0.08 * (1 - backOut(t));
    }
    const drawBand = (from, to, color, hidden) => {
      const y1 = bottom - to * sh, y2 = bottom - from * sh;
      ctx.beginPath();
      ctx.moveTo(L.xl(y1), y1); ctx.lineTo(L.xr(y1), y1); ctx.lineTo(L.xr(y2), y2); ctx.lineTo(L.xl(y2), y2); ctx.closePath();
      if (hidden) {
        ctx.fillStyle = '#E9E1D4'; ctx.fill();
        ctx.strokeStyle = 'rgba(160,130,100,0.35)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#A88A6B';
        ctx.font = `bold ${Math.max(11, sh * 0.62)}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', w / 2, (y1 + y2) / 2 + 1);
        ctx.textBaseline = 'alphabetic';
      } else if (L.sprite) {
        ctx.fillStyle = color; ctx.fill();
      } else {
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, shade(color, -0.12)); g.addColorStop(0.45, shade(color, 0.08)); g.addColorStop(1, shade(color, -0.15));
        ctx.fillStyle = g; ctx.fill();
      }
    };

    // 已有層（來源正在倒出：頂層縮短）
    let level = 0;
    for (let i = 0; i < n; i++) {
      const col = c.seg[i];
      let units = 1;
      if (c.removedUnits > 0 && i >= n - Math.ceil(c.removedUnits)) {
        units = Math.max(0, Math.min(1, (n - c.removedUnits) - i));
      }
      if (units <= 0) continue;
      const top = i === n - 1 && !c.extraUnits ? level + units * settleScale : level + units;
      drawBand(level, top, col === null ? null : HEX[col], col === null);
      level += units;
    }
    // 正在倒入嘅新層
    if (c.extraUnits > 0 && c.extraColor !== null) drawBand(level, level + c.extraUnits, HEX[c.extraColor], false);

    if (L.sprite) { ctx.restore(); return; }   // 貼圖杯：珍珠 / 反光 / 封膜白紗都喺貼圖或封膜蓋度
    // 珍珠（底層）
    if (n > 0 && c.seg[0] !== null) {
      ctx.fillStyle = 'rgba(40,25,15,0.35)';
      const py = bottom - sh * 0.32;
      const cnt = 4;
      for (let i = 0; i < cnt; i++) {
        const px = w * (0.28 + 0.44 * (i / (cnt - 1))) + (i % 2 ? -1 : 1);
        ctx.beginPath(); ctx.arc(px, py + (i % 2) * 2, Math.max(1.8, sh * 0.13), 0, Math.PI * 2); ctx.fill();
      }
    }
    // 液面反光
    if (level > 0) {
      const y = bottom - level * sh;
      ctx.beginPath(); ctx.moveTo(w * 0.22, y + 2); ctx.lineTo(w * 0.78, y + 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // 封膜杯：加層白紗
    if (c.locked) { ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(0, 0, w, h); }
    ctx.restore();
  }

  // ---------- 液柱 ----------
  drawStreams() {
    const ctx = this.ctx;
    for (const s of this.streams) {
      const S = this.cups[s.from], T = this.cups[s.to];
      // 壺嘴：來源杯頂邊靠目標嗰一角（經旋轉）
      const cornerX = s.side < 0 ? S.w : 0;
      const ox = S.x + S.w / 2, oy = S.y + S.h;
      const lx = cornerX - S.w / 2, ly = -S.h;
      const cos = Math.cos(S.rot), sin = Math.sin(S.rot);
      const spx = ox + lx * cos - ly * sin, spy = oy + lx * sin + ly * cos;
      const level = T.seg.length + T.extraUnits;
      const LT = this._liquid(T);
      const tx = T.x + T.w / 2, ty = T.y + LT.bottom - level * LT.slotH;
      ctx.save();
      ctx.globalAlpha = s.alpha;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(spx, spy);
      ctx.quadraticCurveTo(spx + (tx - spx) * 0.15, spy + (ty - spy) * 0.55, tx, ty);
      ctx.strokeStyle = HEX[s.color]; ctx.lineWidth = s.width; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(spx, spy);
      ctx.quadraticCurveTo(spx + (tx - spx) * 0.15, spy + (ty - spy) * 0.55, tx, ty);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = s.width * 0.35; ctx.stroke();
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
      ctx.beginPath(); ctx.roundRect(c.hx - 5, c.hy - 26, c.w + 10, c.h + 32, 12);
      ctx.strokeStyle = '#E88D5A'; ctx.lineWidth = 3; ctx.setLineDash([6, 5]); ctx.stroke();
    }
    ctx.setLineDash([]);
    const ax = A.hx + A.w / 2, ay = A.hy - 30, bx = B.hx + B.w / 2, by = B.hy - 30;
    const mx = (ax + bx) / 2, my = Math.min(ay, by) - 34;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by);
    ctx.strokeStyle = '#E88D5A'; ctx.lineWidth = 3.5; ctx.stroke();
    const ang = Math.atan2(by - my, bx - mx);
    ctx.beginPath(); ctx.moveTo(bx, by);
    ctx.lineTo(bx - 12 * Math.cos(ang - 0.5), by - 12 * Math.sin(ang - 0.5));
    ctx.lineTo(bx - 12 * Math.cos(ang + 0.5), by - 12 * Math.sin(ang + 0.5));
    ctx.closePath(); ctx.fillStyle = '#E88D5A'; ctx.fill();
    ctx.restore();
  }
}
