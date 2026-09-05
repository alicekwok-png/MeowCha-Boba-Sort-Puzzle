// client/background.js — 背景管理器（Spec v2 §7：BG_lab_full 單張、不透明）。
// 舊 far / mid / near 三層視差、五階段橫移過渡、氛圍粒子、FPS 救生索全部已廢棄（Spec v2 §7 / 用戶決定 6）。
// 保留嘅只有：單張背景圖（object-fit cover、object-position center 40%——窗喺畫面中段、檯面留喺底）
// 同一層好淡嘅程式畫可讀性遮罩（COLORS.bgTop @ 0.28，只覆蓋瓶區安全帶，令瓶區底色略為壓平）。
// 層次（Spec §3.2）：背景 → 瓶身陰影 → 液體 → …；遮罩屬於「背景」一部份，畫喺 #bg-mask（z 30），瓶陣 (z 40) 之下。
//
// 對外 API 保持同舊版一樣（main.js 唔使改）：STAGES / stageForLevel / stageTransitionAfter /
// SAFE_TOP / SAFE_BOTTOM / FADE / BackgroundManager（setStage / preload / preloadAround / transitionTo /
// onPour / setAmbientEnabled / setMaskAlpha / drawMask / destroy）。

import { ASSET_MAP, versioned } from '../config/assets.js';
import { COLORS } from '../config/theme.js';

export const SAFE_TOP = 0.25;       // 600 / 2400（工單 #4：委託人區放大，安全區上界由 470 移到 600）
export const SAFE_BOTTOM = 0.729;   // 1750 / 2400
export const FADE = 0.042;          // 100 / 2400

/** 可讀性遮罩：COLORS.bgTop（#12100D）@ 0.28，只落喺 SAFE_TOP..SAFE_BOTTOM 瓶區安全帶 */
export const MASK_COLOR = COLORS.bgTop;
export const MASK_ALPHA = 0.28;

/** 背景圖 object-position（cover 裁切對位）：窗喺畫面中段，檯面留喺底 */
export const BG_OBJECT_POSITION = 'center 40%';

/** @typedef {{id:number, name:string, levelFrom:number, levelTo:number, maskColor:string, maskAlpha:number, ambient:[], line:string}} StageConfig */

/** 只有一個階段：實驗室。maskColor / maskAlpha / ambient 係無害預設，俾舊呼叫方讀。 */
export const STAGES = [
  { id: 1, name: '實驗室', levelFrom: 1, levelTo: 9999, maskColor: MASK_COLOR, maskAlpha: MASK_ALPHA, theme: 'lab', ambient: [],
    line: '實驗室開爐喇！今日要好好完成委託～' },
];

export function stageForLevel(_levelId) {
  return STAGES[0];
}

/** 已無跨階段過渡（單一實驗室），永遠回傳 null */
export function stageTransitionAfter(_levelId) {
  return null;
}

const hexToRgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** 背景圖 URL（相對本模組：src/client/ → webapp 根 → ASSET_MAP 路徑） */
export function backgroundUrl() {
  return new URL('../../' + versioned(ASSET_MAP.BG_lab_full), import.meta.url).href;
}

export class BackgroundManager {
  /**
   * @param {HTMLElement} root  含 #bg-far（單張背景 img）、#bg-mask（遮罩）；#bg-far-next / #bg-mid / #bg-ambient 已廢棄，有就收埋
   * @param {string} [_assetBase]  舊簽名參數，已唔用（路徑由 ASSET_MAP 決定）；保留以免 main.js 要改
   */
  constructor(root, _assetBase) {
    this.root = root;
    this.far = root?.querySelector?.('#bg-far') ?? null;
    this.maskEl = root?.querySelector?.('#bg-mask') ?? null;
    this.stage = null;
    this.ambientEnabled = false;        // 氛圍層已取消，旗標保留俾舊呼叫方讀
    this.alphaOverride = null;          // remote config 可覆蓋
    this._preloaded = false;
    // 廢棄層：收埋，唔再參與渲染
    for (const id of ['#bg-far-next', '#bg-mid', '#bg-ambient']) {
      const el = root?.querySelector?.(id);
      if (el) el.hidden = true;
    }
    if (this.far) {
      this.far.style.objectFit = 'cover';
      this.far.style.objectPosition = BG_OBJECT_POSITION;
      this.far.style.transition = 'none';
      this.far.style.transform = 'none';
    }
  }

  farUrl(_stage) { return backgroundUrl(); }

  /** 預載單張背景（decode 一次就夠） */
  preload(_stage) {
    if (this._preloaded || typeof Image === 'undefined') return;
    this._preloaded = true;
    const img = new Image();
    img.src = backgroundUrl();
    img.decode?.().catch(() => {});
  }

  preloadAround(_levelId) { this.preload(); }

  setStage(stage = STAGES[0]) {
    this.stage = stage;
    if (this.far) {
      const url = backgroundUrl();
      if (this.far.src !== url) this.far.src = url;
      this.far.hidden = false;
      this.far.style.objectFit = 'cover';
      this.far.style.objectPosition = BG_OBJECT_POSITION;
    }
    this.drawMask(stage);
  }

  /** 遮罩：上下各 FADE 過渡，中間實色。程式畫（CSS gradient），唔係圖片。 */
  drawMask(stage = this.stage) {
    if (!this.maskEl) return;
    const [r, g, b] = hexToRgb(stage?.maskColor ?? MASK_COLOR);
    const A = this.alphaOverride ?? stage?.maskAlpha ?? MASK_ALPHA;
    const c = (a) => `rgba(${r},${g},${b},${a.toFixed(3)})`;
    const p = (v) => (v * 100).toFixed(2) + '%';
    this.maskEl.style.background =
      `linear-gradient(to bottom, ${c(0)} ${p(SAFE_TOP - FADE)}, ${c(A)} ${p(SAFE_TOP)}, ${c(A)} ${p(SAFE_BOTTOM)}, ${c(0)} ${p(SAFE_BOTTOM + FADE)})`;
  }

  setMaskAlpha(a) { this.alphaOverride = a; this.drawMask(); }

  /** 階段過渡已取消：即時 resolve（傳入階段就直接套用） */
  transitionTo(next) {
    if (next) this.setStage(next);
    return Promise.resolve();
  }

  /** 倒液微視差已取消 */
  onPour() {}

  /** 氛圍層已取消 */
  setAmbientEnabled(_v) {}

  destroy() {}
}
