// config/render.js — Spec v2 §1.3：液體 / 配料渲染常數。

export const RENDER = Object.freeze({
  // v4 §1.2：液體唔經玻璃（純色 100% 填，唔乘任何嘢），玻璃只加光（screen，只取 luma > 215 嘅像素）
  liquidBlend: 'source-over',
  glassHighlight: Object.freeze({ lumaThreshold: 215, lumaRange: 40, strength: 0.55 }),
  verticalHighlight: Object.freeze({ from: 0.16, to: 0.24, blur: 3, strength: 0.35 }),
  // `?` 隱藏層（用戶 2026-09-06）：實色**灰**層（唔係黑——黑同深色樽身撞埋睇唔清），同液層一樣係圓柱（弧邊），
  // 連續隱藏格合併成一條，每格畫一個淺色襯線 ?
  hiddenGlyph: Object.freeze({ fill: '#524D59', glyph: '#E8E4EC', sizeRatio: 0.55 }),
  sealedBottle: Object.freeze({ desaturate: 0.25, overlay: '#0A0806', overlayAlpha: 0.18 }),   // 已封樽
  // v4.1 §6 第 11 步：交貨動畫時序（ms）+ 木塞疊放
  cork: Object.freeze({ widthRatio: 0.61, topOffset: 0.035 }),
  deliverAnim: Object.freeze({ corkMs: 200, glowMs: 180, dustCount: [8, 12], flyMs: 440, flyScale: 0.45, flyRotDeg: 8, slotFlashMs: 140 }),
  sealAnim: Object.freeze({ corkMs: 200, desatMs: 280 }),   // 落塞同交貨一樣 200ms ease-out-back（140 太快，玩家睇唔到）
  // 液層圓柱模型（用戶 2026-09-06，直接參考同類遊戲）：每一層係一個實心圓柱 ——
  //   層頂 / 層底都係向下彎嘅正面弧（ry = 內壁闊 × ryRatio，中央最低、兩邊為 0），層與層之間嘅分界係弧線唔係平線；
  //   最頂層再畫一個完整橢圓做頂面（該層色向白色 mix lighten，實色、硬邊、唔要漸變）；最底層底邊平（樽底）。
  //   帶中央 pixel（nominal 層矩形正中）仍然喺圓柱體內 → 仍然 = 色板 hex（ry < 層高 / 2）。
  surfaceEllipse: Object.freeze({ ryRatio: 0.14, lighten: 0.32 }),
  // bottleMask.js v3 圓筒明暗：邊緣最暗比例、左上高光柱、玻璃只加光門檻
  cylinder: Object.freeze({ sideShadeMin: 0.72, specCenter: -0.48, specWidth: 0.14, specStrength: 0.40, lumaThreshold: 195, lumaRange: 60, hlStrength: 0.55 }),

  patternAtlasSize: 256,
  patternUVInset: 0.5 / 256,   // 防止雙線性取樣偷到隔壁象限

  // P3 要橫向延伸 → repeat；其餘 clamp
  patternWrap: Object.freeze({ P0: 'clamp', P1: 'clamp', P2: 'clamp', P3: 'repeat', P4: 'clamp' }),

  patternLargeMinPx: 48,       // 層高 ≥48px 用 PAT_tile_large，<48px 用 PAT_tile_small
  patternIconOnlyBelowPx: 32,  // 層高 <32px 唔顯示圖案，改為層中央顯示單一配料 icon
  patternLumShift: -0.28,      // 配料圖案 = 該層色 −28% 明度

  hiddenRevealMs: 160,         // `?` 隱藏層樽新露出嘅格逐格 fade in

  // 發光三件套（用戶 2026-09-05）：冇呢三樣，再鮮嘅色都係一塊平色
  glow: Object.freeze({
    rimAlpha: 0.40,            // 液體外緣 rim glow：該層色 @ 40%
    rimPx: 2,                  //   2px
    backAlpha: 0.12,           // 整瓶背後柔光：該色 @ 12%
    backBlurPx: 12,            //   blur 12px
  }),
  clothReveal: Object.freeze({ ropeMs: 60, slideMs: 160, dustMs: 400, dustCount: [6, 8], fadeMs: 160 }),
});

export const PATTERN_UV = Object.freeze({
  P1: { u0: 0.0, v0: 0.0, u1: 0.5, v1: 0.5 },  // 沉澱物（實心圓）
  P2: { u0: 0.5, v0: 0.0, u1: 1.0, v1: 0.5 },  // 結晶（實心方）
  P3: { u0: 0.0, v0: 0.5, u1: 0.5, v1: 1.0 },  // 分層試劑（橫紋）
  P4: { u0: 0.5, v0: 0.5, u1: 1.0, v1: 1.0 },  // 懸浮孢子（空心多邊形）
});

/** 取樣 UV（含 inset）：唔加 inset 會喺每層液體邊緣見到一條雜色線 */
export function patternUV(p) {
  const q = PATTERN_UV[p];
  if (!q) return null;
  const i = RENDER.patternUVInset;
  return { u0: q.u0 + i, v0: q.v0 + i, u1: q.u1 - i, v1: q.v1 - i };
}

export const AD_SLOTS = Object.freeze({
  addEmptyBottle: { enabled: true,  location: 'playfield' },
  unlockOrder:    { enabled: true,  location: 'topBar' },
  refillItem:     { enabled: false, location: 'itemModal' },
  extraMove:      { enabled: false, location: 'failModal' },
});

/** 同屏最多 2 個廣告入口 */
export function assertAdSlotLimit(slots = AD_SLOTS) {
  const n = Object.values(slots).filter(s => s.enabled && (s.location === 'playfield' || s.location === 'topBar')).length;
  if (n > 2) throw new Error(`Ad slots on screen: ${n}, max 2`);
  return n;
}

/** 委託人解鎖順序（紋章一次只出現喺「下一個可解鎖」嗰位） */
export const CLIENT_ORDER = ['raven', 'badger', 'owl', 'hare'];

/**
 * 委託人視覺可讀性（用戶 2026-09-05，唔動美術、引擎做）：原素材蝕刻風褐灰調本身低飽和，
 * 已解鎖要推高飽和 + 亮度先同灰態拉得開；locked / adLocked 同一套灰，adLocked 只係槽多個 UI_ad_crest。
 * CSS filter 字串，main.js 注入 CSS 變數 --client-active / --client-locked / --client-adlocked。
 */
export const CLIENT_FILTER = Object.freeze({
  active:   'saturate(1.55) brightness(1.25) contrast(1.05)',
  locked:   'saturate(0) brightness(0.45)',
  adLocked: 'saturate(0) brightness(0.45)',
});

/** 已解鎖委託人背光：角色後面徑向暖光暈（燭光由下打上，光心略低），令角色由深背景浮出嚟；locked 唔畫。
 *  渲染次序：背光 → 角色（套 filter）→ 訂單槽 → HUD 玻璃層 */
export const CLIENT_GLOW = Object.freeze({
  color:   '#FFA94D',
  opacity: 0.25,
  radius:  1.15,   // 相對角色寬度
  offsetY: 0.10,   // 光心低於角色中心（相對角色高度）
  blur:    18,     // px
});
