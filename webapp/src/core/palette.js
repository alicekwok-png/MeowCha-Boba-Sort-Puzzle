// core/palette.js — 14 種飲品顏色（工單 #5 色板 + 椰奶白 #E8D5A8 / 咖啡褐 #3E2E22 修正）。
// L* 用於色盲安全檢查（同關任兩色 L* 差 ≥ MIN_LSTAR_GAP）。
// 主梯 10 色由咖啡褐 20.4 均分到椰奶白 85.8（間距 7.26），所以 MIN_LSTAR_GAP 由 8 調到 7；
// 補位 4 色落喺梯級中間，只喺色數較少嘅關卡出現。
// 主梯：咖啡褐 · 葡萄紫 · 黑糖褐 · 紅豆紫 · 玫瑰紅 · 蝶豆藍 · 抹茶綠 · 荔枝粉 · 芒果黃 · 椰奶白
// 補位：伯爵灰 · 烏龍琥珀 · 芋泥紫 · 薄荷綠

export const PALETTE = [
  { id: 0,  zh: '椰奶白',   en: 'Coconut',       hex: '#E8D5A8', L: 85.79 },
  { id: 1,  zh: '芒果黃',   en: 'Mango',         hex: '#EBBB5E', L: 78.47 },
  { id: 2,  zh: '荔枝粉',   en: 'Lychee',        hex: '#E49AA9', L: 71.19 },
  { id: 3,  zh: '抹茶綠',   en: 'Matcha',        hex: '#8BA460', L: 64.07 },
  { id: 4,  zh: '烏龍琥珀', en: 'Oolong',        hex: '#A37641', L: 53.09 },
  { id: 5,  zh: '芋泥紫',   en: 'Taro',          hex: '#9E8AAF', L: 60.37 },
  { id: 6,  zh: '蝶豆藍',   en: 'Butterfly Pea', hex: '#7488B5', L: 56.74 },
  { id: 7,  zh: '玫瑰紅',   en: 'Rose',          hex: '#AC5E6E', L: 49.38 },
  { id: 8,  zh: '薄荷綠',   en: 'Mint',          hex: '#75B09E', L: 67.50 },
  { id: 9,  zh: '紅豆紫',   en: 'Red Bean',      hex: '#815676', L: 42.20 },
  { id: 10, zh: '黑糖褐',   en: 'Brown Sugar',   hex: '#6F4A33', L: 35.04 },
  { id: 11, zh: '葡萄紫',   en: 'Grape',         hex: '#4F3766', L: 27.72 },
  { id: 12, zh: '伯爵灰',   en: 'Earl Grey',     hex: '#766B60', L: 45.92 },
  { id: 13, zh: '咖啡褐',   en: 'Coffee',        hex: '#3E2E22', L: 20.41 },
];

export const LSTAR = PALETTE.map(p => p.L);

/** 高危組合（只可以係「主梯 × 補位」，否則 10 色關卡揀唔齊色）：抹茶×烏龍、薄荷×椰奶。
 *  紅豆紫×葡萄紫（L* 差 14.5）、黑糖褐×咖啡褐（L* 差 14.6）喺新色板已經分得開，唔再列為高危。 */
export const FORBIDDEN_PAIRS = [[3, 4], [8, 0]];

export const MIN_LSTAR_GAP = 7;
