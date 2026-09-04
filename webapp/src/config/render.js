// config/render.js — Spec v2 §1.3：液體 / 配料渲染常數。

export const RENDER = Object.freeze({
  // 瓶身 sprite 係淺色蝕刻線稿，正常 alpha 疊會蓋住液體
  liquidBlend: 'multiply',

  patternAtlasSize: 256,
  patternUVInset: 0.5 / 256,   // 防止雙線性取樣偷到隔壁象限

  // P3 要橫向延伸 → repeat；其餘 clamp
  patternWrap: Object.freeze({ P0: 'clamp', P1: 'clamp', P2: 'clamp', P3: 'repeat', P4: 'clamp' }),

  patternLargeMinPx: 48,       // 層高 ≥48px 用 PAT_tile_large，<48px 用 PAT_tile_small
  patternIconOnlyBelowPx: 32,  // 層高 <32px 唔顯示圖案，改為層中央顯示單一配料 icon
  patternLumShift: -0.28,      // 配料圖案 = 該層色 −28% 明度

  frostedRevealMs: 160,        // 磨砂瓶逐格 fade in
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
