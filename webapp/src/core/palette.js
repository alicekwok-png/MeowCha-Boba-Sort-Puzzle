// core/palette.js — 15 種飲品顏色。L* 值用於色盲安全檢查（同關任兩色 L* 差 ≥ 8）。
// 主梯（10 色，L* 每 8.5 一級，任意組合都過到 ≥ 8 檢查）：
//   黑芝麻 18 · 黑糖 26.4 · 紅豆 35 · 藍莓 43.5 · 草莓 51.9 · 抹茶 60.5 · 芋頭 69.1 · 芒果 77.5 · 蜜桃 86 · 椰奶 94.6
// 補位（5 色，只會喺色數較少嘅關卡出現）：葡萄 22.1 · 烏龍 39.3 · 薄荷 56.5 · 奶茶 73.3 · 檸檬 90.3

export const PALETTE = [
  { id: 0,  zh: '椰奶',   en: 'Coconut',      hex: '#F5EFE2', L: 94.58 },
  { id: 1,  zh: '抹茶',   en: 'Matcha',       hex: '#6F9F4B', L: 60.50 },
  { id: 2,  zh: '奶茶',   en: 'Milk Tea',     hex: '#D4AD84', L: 73.25 },
  { id: 3,  zh: '草莓',   en: 'Strawberry',   hex: '#D74867', L: 51.91 },
  { id: 4,  zh: '烏龍',   en: 'Oolong',       hex: '#815223', L: 39.28 },
  { id: 5,  zh: '芒果',   en: 'Mango',        hex: '#F5B436', L: 77.47 },
  { id: 6,  zh: '紅豆',   en: 'Red Bean',     hex: '#8F3242', L: 35.03 },
  { id: 7,  zh: '芋頭',   en: 'Taro',         hex: '#BB9CDB', L: 69.08 },
  { id: 8,  zh: '黑糖',   en: 'Brown Sugar',  hex: '#573725', L: 26.43 },
  { id: 9,  zh: '檸檬',   en: 'Lemon',        hex: '#F4E66D', L: 90.29 },
  { id: 10, zh: '薄荷',   en: 'Mint',         hex: '#2C987B', L: 56.51 },
  { id: 11, zh: '藍莓',   en: 'Blueberry',    hex: '#4863B1', L: 43.47 },
  { id: 12, zh: '葡萄',   en: 'Grape',        hex: '#47265F', L: 22.13 },
  { id: 13, zh: '蜜桃',   en: 'Peach',        hex: '#FFCCBC', L: 86.04 },
  { id: 14, zh: '黑芝麻', en: 'Black Sesame', hex: '#2F2B2C', L: 17.98 },
];

export const LSTAR = PALETTE.map(p => p.L);

/** 高危組合：抹茶×烏龍、薄荷×椰奶、紅豆×葡萄 */
export const FORBIDDEN_PAIRS = [[1, 4], [10, 0], [6, 12]];

export const MIN_LSTAR_GAP = 8;
