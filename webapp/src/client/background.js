// client/background.js — 背景管理器（背景規格 §1 / §3 / §5）。
// 層次：bg-far(0) → bg-mid(10) → bg-ambient(20) → readability-mask(30) → board(40) → characters(50) → ui(60)
// 遮罩一定係程式畫（CSS gradient），透明度可以執行期調。氛圍層可一鍵關閉（FPS 救生索）。

export const SAFE_TOP = 0.25;       // 600 / 2400（工單 #4：客人區放大，安全區上界由 470 移到 600）
export const SAFE_BOTTOM = 0.729;   // 1750 / 2400
export const FADE = 0.042;          // 100 / 2400

/** @typedef {{id:number, name:string, levelFrom:number, levelTo:number, maskColor:string, maskAlpha:number, ambient:{key:string,count:number,drift:string}[], line:string}} StageConfig */

export const STAGES = [
  // 夜市奶茶 brief A1：夜空 #171029→#2A1B47、燈籠暖光暈、深木檯面；遮罩改用 UI 面板色 #1F1638 壓平安全區（深底令液體「發光」）
  { id: 1, name: '夜市攤車', levelFrom: 1, levelTo: 40, maskColor: '#1F1638', maskAlpha: 0.35, theme: 'night',
    ambient: [{ key: 'warmbokeh', count: 4, drift: 'slow-float' }],
    line: '夜市開檔喇！今晚要好好招呼客人～' },
  { id: 2, name: '樓梯底小店', levelFrom: 41, levelTo: 120, maskColor: '#141C30', maskAlpha: 0.35, theme: 'night',
    ambient: [{ key: 'rain', count: 1, drift: 'tile-scroll' }, { key: 'signflicker', count: 1, drift: 'flicker' }],
    line: '落雨喇，我哋搬入舖頭！' },
  { id: 3, name: '商場店面', levelFrom: 121, levelTo: 250, maskColor: '#1A2036', maskAlpha: 0.35, theme: 'night',
    ambient: [{ key: 'crowd', count: 1, drift: 'tile-scroll-slow' }],
    line: '我哋開到入商場喇！' },
  { id: 4, name: '夜市旗艦店', levelFrom: 251, levelTo: 450, maskColor: '#221238', maskAlpha: 0.35, theme: 'night',
    ambient: [{ key: 'lantern', count: 3, drift: 'sway' }, { key: 'bokeh', count: 5, drift: 'slow-float' }],
    line: '夜市旗艦店開張！' },
  { id: 5, name: '雲頂總店', levelFrom: 451, levelTo: 9999, maskColor: '#261A44', maskAlpha: 0.35, theme: 'night',
    ambient: [{ key: 'pearl', count: 6, drift: 'slow-float' }],
    line: '⋯⋯我哋開到上天上面？' },
];

export function stageForLevel(levelId) {
  return STAGES.find(s => levelId >= s.levelFrom && levelId <= s.levelTo) || STAGES[0];
}

/** 完成某關之後，下一關是否跨階段 → 回傳新階段，否則 null */
export function stageTransitionAfter(levelId) {
  const cur = stageForLevel(levelId);
  return levelId === cur.levelTo ? (STAGES.find(s => s.id === cur.id + 1) || null) : null;
}

const rand = (a, b) => a + Math.random() * (b - a);
const hexToRgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

export class BackgroundManager {
  /**
   * @param {HTMLElement} root  含 .bg-far ×2、.bg-mid、canvas.bg-ambient、.bg-mask
   * @param {string} assetBase  例如 'assets/bg/'
   */
  constructor(root, assetBase) {
    this.root = root;
    this.base = assetBase;
    this.far = root.querySelector('#bg-far');
    this.farNext = root.querySelector('#bg-far-next');
    this.mid = root.querySelector('#bg-mid');
    this.ambientCanvas = root.querySelector('#bg-ambient');
    this.maskEl = root.querySelector('#bg-mask');
    this.ctx = this.ambientCanvas.getContext('2d');
    this.stage = null;
    this.particles = [];
    this.ambientEnabled = true;
    this.alphaOverride = null;          // remote config 可覆蓋
    this._loaded = new Set();
    this._lowFpsSince = 0;
    this._last = 0;
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.ambientCanvas);
    this._resize();
  }

  farUrl(stage) { return `${this.base}bg${stage.id}_far.webp`; }

  /** 預載（階段 2–5 喺接近該階段前 5 關開始） */
  preload(stage) {
    if (!stage || this._loaded.has(stage.id)) return;
    const img = new Image();
    img.src = this.farUrl(stage);
    img.decode?.().catch(() => {});
    this._loaded.add(stage.id);
  }

  preloadAround(levelId) {
    for (const s of STAGES) if (s.levelFrom - levelId > 0 && s.levelFrom - levelId <= 5) this.preload(s);
  }

  setStage(stage) {
    this.stage = stage;
    this.far.src = this.farUrl(stage);
    this.far.style.transition = 'none';
    this.far.style.transform = 'translateX(0)';
    this.farNext.hidden = true;
    this._loaded.add(stage.id);
    this.drawMask(stage);
    this.spawnAmbient(stage);
  }

  /** 遮罩：上下各 FADE 過渡，中間實色。程式畫，唔係圖片。 */
  drawMask(stage = this.stage) {
    const [r, g, b] = hexToRgb(stage.maskColor);
    const A = this.alphaOverride ?? stage.maskAlpha;
    const c = (a) => `rgba(${r},${g},${b},${a.toFixed(3)})`;
    const p = (v) => (v * 100).toFixed(2) + '%';
    this.maskEl.style.background =
      `linear-gradient(to bottom, ${c(0)} ${p(SAFE_TOP - FADE)}, ${c(A)} ${p(SAFE_TOP)}, ${c(A)} ${p(SAFE_BOTTOM)}, ${c(0)} ${p(SAFE_BOTTOM + FADE)})`;
  }

  setMaskAlpha(a) { this.alphaOverride = a; this.drawMask(); }

  /** 階段切換：橫向平移 3 秒，遠景 0.15× / 中景 0.5×（視差） */
  transitionTo(next) {
    return new Promise(res => {
      this.preload(next);
      const nf = this.farNext;
      nf.src = this.farUrl(next);
      nf.hidden = false;
      nf.style.transition = 'none';
      nf.style.transform = 'translateX(115%)';
      this.far.style.transition = 'none';
      // 下一 frame 先啟動 transition
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const ease = 'cubic-bezier(0.65, 0, 0.35, 1)';
        this.far.style.transition = `transform 3s ${ease}`;
        nf.style.transition = `transform 3s ${ease}`;
        this.far.style.transform = 'translateX(-15%)';
        nf.style.transform = 'translateX(0)';
        this.mid.style.transition = `transform 3s ${ease}`;
        this.mid.style.transform = 'translateX(-50%)';
        setTimeout(() => {
          // 交換：next 變成 current
          const old = this.far; this.far = nf; this.farNext = old;
          old.hidden = true;
          old.style.transition = 'none'; old.style.transform = 'translateX(115%)';
          this.mid.style.transition = 'none'; this.mid.style.transform = 'translateX(0)';
          this.stage = next;
          this.drawMask(next);
          this.spawnAmbient(next);
          res();
        }, 3050);
      }));
    });
  }

  /** 倒液微視差：遠景橫移 3px 再彈返 */
  onPour() {
    const el = this.far;
    el.style.transition = 'transform 200ms ease-in-out';
    el.style.transform = 'translateX(3px)';
    setTimeout(() => { el.style.transform = 'translateX(0)'; }, 200);
  }

  setAmbientEnabled(v) {
    this.ambientEnabled = v;
    this.ambientCanvas.style.visibility = v ? 'visible' : 'hidden';
  }

  // ---------- 氛圍層 ----------
  _resize() {
    const r = this.ambientCanvas.getBoundingClientRect();
    this.W = Math.max(1, Math.round(r.width)); this.H = Math.max(1, Math.round(r.height));
    this.ambientCanvas.width = this.W; this.ambientCanvas.height = this.H;   // 1× 就夠（柔和元素）
    this._fitFar();
    if (this.stage) this.spawnAmbient(this.stage);
  }

  /**
   * cover 式縮放（寧可裁走上下出血，唔可以有黑邊）。
   * 出圖 1080 × 2800，上下各 200px 出血：9:20 螢幕啱啱裁走出血；更闊嘅螢幕會多裁，
   * 呢度將裁切對位到「出血以外嘅頂部場景一定留低」，而唔係 CSS 預設嘅置中。
   */
  _fitFar() {
    const IW = 1080, IH = 2800, BLEED = 200;
    const s = Math.max(this.W / IW, this.H / IH);
    const imgH = IH * s;
    const excess = imgH - this.H;
    const p = excess > 0 ? Math.min(1, Math.max(0, (BLEED * s) / excess)) : 0.5;
    const pos = `center ${(p * 100).toFixed(2)}%`;
    this.far.style.objectPosition = pos;
    this.farNext.style.objectPosition = pos;
  }

  spawnAmbient(stage) {
    const W = this.W, H = this.H;
    this.particles = [];
    for (const spec of stage.ambient) {
      for (let i = 0; i < spec.count; i++) {
        const p = { key: spec.key, drift: spec.drift, x: rand(0, W), y: rand(0, H), t: rand(0, 1000), seed: Math.random(), alpha: 0.5 };
        switch (spec.key) {
          case 'leaf': p.size = rand(9, 14); p.y = rand(-H * 0.2, H * 0.6); p.vx = rand(8, 16); p.vy = rand(12, 22); break;
          case 'sunspot': p.size = rand(50, 110); p.y = rand(0, H * 0.35); p.alpha = 0.32; break;
          case 'rain': p.drops = Array.from({ length: 70 }, () => ({ x: rand(0, W), y: rand(0, H), l: rand(10, 22), v: rand(420, 620) })); break;
          case 'signflicker': p.x = W * 0.78; p.y = H * 0.07; p.size = 26; break;
          case 'crowd': p.blobs = Array.from({ length: 7 }, (_, k) => ({ x: (k / 7) * W * 1.4, y: H * rand(0.09, 0.13), w: rand(30, 50), h: rand(70, 110) })); p.v = rand(6, 10); break;
          case 'lantern': p.x = W * (0.15 + 0.35 * i); p.y = H * 0.06; p.size = rand(18, 26); break;
          case 'bokeh': p.size = rand(18, 46); p.y = rand(0, H * 0.4); p.alpha = 0.28; break;
          case 'warmbokeh': p.size = rand(30, 70); p.y = rand(0, H * 0.33); p.alpha = 0.10; break;   // 燈籠暖光 #FFB84D，極淡
          case 'pearl': p.size = rand(10, 20); p.alpha = 0.45; break;
        }
        this.particles.push(p);
      }
    }
  }

  _loop(now) {
    this._raf = requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (now - (this._last || now)) / 1000);
    this._last = now;
    // FPS 救生索：< 45 fps 持續 3 秒 → 關氛圍層
    if (this.ambientEnabled && dt > 1 / 45) {
      if (!this._lowFpsSince) this._lowFpsSince = now;
      else if (now - this._lowFpsSince > 3000) this.setAmbientEnabled(false);
    } else this._lowFpsSince = 0;
    if (!this.ambientEnabled || !this.stage) return;

    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);
    for (const p of this.particles) {
      p.t += dt;
      ctx.save();
      switch (p.key) {
        case 'leaf': {
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.y > H * 0.75 || p.x > W + 20) { p.x = rand(-20, W * 0.6); p.y = -20; }
          ctx.translate(p.x, p.y); ctx.rotate(Math.sin(p.t * 2 + p.seed * 6) * 0.8);
          ctx.globalAlpha = 0.45; ctx.fillStyle = '#9AAE5A';
          ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'sunspot': case 'bokeh': case 'warmbokeh': {
          const y = p.y + Math.sin(p.t * 0.5 + p.seed * 6) * 40, x = p.x + Math.cos(p.t * 0.35 + p.seed * 6) * 25;
          const g = ctx.createRadialGradient(x, y, 0, x, y, p.size);
          const rgb = p.key === 'warmbokeh' ? '255,184,77' : '255,250,235';
          g.addColorStop(0, `rgba(${rgb},${p.alpha})`); g.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, p.size, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'rain': {
          ctx.strokeStyle = 'rgba(210,225,255,0.35)'; ctx.lineWidth = 1.2;
          ctx.beginPath();
          for (const d of p.drops) {
            d.y += d.v * dt; d.x -= d.v * 0.12 * dt;
            if (d.y > H) { d.y = -d.l; d.x = rand(0, W * 1.1); }
            ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.12, d.y + d.l);
          }
          ctx.stroke();
          break;
        }
        case 'signflicker': {
          const a = 0.28 + 0.22 * (0.5 + 0.5 * Math.sin(p.t * 4.1) * Math.sin(p.t * 1.3));
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3);
          g.addColorStop(0, `rgba(255,120,150,${a})`); g.addColorStop(1, 'rgba(255,120,150,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'crowd': {
          ctx.fillStyle = 'rgba(60,45,35,0.10)';
          for (const b of p.blobs) {
            b.x -= p.v * dt; if (b.x < -60) b.x = W + 60;
            ctx.beginPath(); ctx.ellipse(b.x, b.y + b.h * 0.5, b.w * 0.5, b.h * 0.5, 0, 0, Math.PI * 2); ctx.fill();
          }
          break;
        }
        case 'lantern': {
          const ang = Math.sin(p.t * 1.1 + p.seed * 6) * 0.07;
          ctx.translate(p.x, p.y); ctx.rotate(ang);
          const g = ctx.createRadialGradient(0, p.size * 1.6, 0, 0, p.size * 1.6, p.size * 3);
          g.addColorStop(0, 'rgba(255,170,80,0.35)'); g.addColorStop(1, 'rgba(255,170,80,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, p.size * 1.6, p.size * 3, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(90,50,20,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, p.size * 0.8); ctx.stroke();
          ctx.fillStyle = 'rgba(230,90,60,0.75)'; ctx.beginPath(); ctx.ellipse(0, p.size * 1.6, p.size * 0.75, p.size, 0, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'pearl': {
          const y = p.y + Math.sin(p.t * 0.6 + p.seed * 6) * 50, x = p.x + Math.cos(p.t * 0.4 + p.seed * 6) * 25;
          ctx.globalAlpha = p.alpha;
          ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(x, y, p.size, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(x - p.size * 0.3, y - p.size * 0.3, p.size * 0.25, 0, Math.PI * 2); ctx.fill();
          break;
        }
      }
      ctx.restore();
    }
  }

  destroy() { cancelAnimationFrame(this._raf); this._ro.disconnect(); }
}
