// core/palette.js — 夜市奶茶色板（Brief v1.0 A2）：10 隻高飽和液體色。
// 畫面入面唯一高飽和嘅嘢只可以係液體，背景全部壓喺 30% 飽和以下（見 styles.css / background.js）。
// 同關互斥規則（A3）：色相距 < 40° 且明度差 < 25% → 唔可以同關出現。
// 推論：純靠顏色最多 6 色同關；7 色以上要靠圖案（P3），所以 13 關後色數封頂 6。

export const PALETTE = [
  { id: 0, key: 'A', zh: '檸檬黃',   en: 'Lemon',       hex: '#FFD93D', H: 48,  L: 62 },
  { id: 1, key: 'B', zh: '焦糖橙',   en: 'Caramel',     hex: '#FF8A3D', H: 24,  L: 62 },
  { id: 2, key: 'C', zh: '草莓粉',   en: 'Strawberry',  hex: '#FF5FA2', H: 335, L: 69 },
  { id: 3, key: 'D', zh: '火龍果紅', en: 'Dragonfruit', hex: '#FF4757', H: 355, L: 64 },
  { id: 4, key: 'E', zh: '葡萄紫紅', en: 'Grape',       hex: '#D94FE8', H: 293, L: 61 },
  { id: 5, key: 'F', zh: '芋圓紫',   en: 'Taro',        hex: '#9B6CFF', H: 262, L: 71 },
  { id: 6, key: 'G', zh: '海鹽藍',   en: 'Sea Salt',    hex: '#4FC9FF', H: 197, L: 65 },
  { id: 7, key: 'H', zh: '深海藍',   en: 'Deep Sea',    hex: '#3D6BFF', H: 225, L: 62 },
  { id: 8, key: 'I', zh: '抹茶綠',   en: 'Matcha',      hex: '#5FF29B', H: 145, L: 66 },
  { id: 9, key: 'J', zh: '奶蓋白',   en: 'Milk Foam',   hex: '#FFF6E3', H: 39,  L: 94 },
];

export const BY_KEY = Object.fromEntries(PALETTE.map(p => [p.key, p.id]));
export const HUE = PALETTE.map(p => p.H);
export const LIGHT = PALETTE.map(p => p.L);

/** 色相距（0–180°） */
export function hueDist(a, b) {
  const d = Math.abs(HUE[a] - HUE[b]) % 360;
  return d > 180 ? 360 - d : d;
}

/** ⚠ 慎用組合（brief A3 例外）：只喺 ≤ 4 色關卡先可以同關（F 芋紫 × H 深藍，37° / 9%） */
export const CAUTION_PAIRS = [[BY_KEY.F, BY_KEY.H]];
export const CAUTION_MAX_COLORS = 4;
const isCaution = (a, b) => CAUTION_PAIRS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));

/** A3 硬規則：色相距 < 40° 且 明度差 < 25% → 互斥（慎用組合另計） */
export function isExclusive(a, b) {
  return a !== b && !isCaution(a, b) && hueDist(a, b) < 40 && Math.abs(LIGHT[a] - LIGHT[b]) < 25;
}

/** 純靠顏色嘅同關色數上限 */
export const MAX_COLORS_BY_HUE = 6;

/** 一組顏色係咪可以同關出現 */
export function colorsCompatible(ids) {
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (isExclusive(ids[i], ids[j])) return false;
      if (isCaution(ids[i], ids[j]) && ids.length > CAUTION_MAX_COLORS) return false;
    }
  }
  return true;
}

// 舊介面（LSTAR / FORBIDDEN_PAIRS / MIN_LSTAR_GAP）已由 isExclusive 取代；保留 L 欄作 UI 文字對比用。
export const LSTAR = LIGHT;
