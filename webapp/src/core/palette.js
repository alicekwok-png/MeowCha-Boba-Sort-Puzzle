// core/palette.js — 15 種飲品顏色。L* 值用於色盲安全檢查（同關任兩色 L* 差 ≥ 8）。
// 工單 #5：全色板去飽和 40%（desaturate 0.40）後再喺 Lab 拉返原本 L* 階梯：明度差保留，飽和度收返。
// 主梯（10 色，L* 每 8.5 一級，任意組合都過到 ≥ 8 檢查）：
//   黑芝麻 18 · 黑糖 26.4 · 紅豆 35 · 藍莓 43.5 · 草莓 51.9 · 抹茶 60.5 · 芋頭 69.1 · 芒果 77.5 · 蜜桃 86 · 椰奶 94.6
// 補位（5 色，只會喺色數較少嘅關卡出現）：葡萄 22.1 · 烏龍 39.3 · 薄荷 56.5 · 奶茶 73.3 · 檸檬 90.3

export const PALETTE = [
  { id: 0,  zh: '椰奶',   en: 'Coconut',      hex: '#F3EFE7', L: 94.55 },
  { id: 1,  zh: '抹茶',   en: 'Matcha',       hex: '#7E9A68', L: 60.38 },
  { id: 2,  zh: '奶茶',   en: 'Milk Tea',     hex: '#C7B097', L: 73.17 },
  { id: 3,  zh: '草莓',   en: 'Strawberry',   hex: '#B86274', L: 52.05 },
  { id: 4,  zh: '烏龍',   en: 'Oolong',       hex: '#74573B', L: 39.32 },
  { id: 5,  zh: '芒果',   en: 'Mango',        hex: '#E1BA6E', L: 77.43 },
  { id: 6,  zh: '紅豆',   en: 'Red Bean',     hex: '#7A424B', L: 35.09 },
  { id: 7,  zh: '芋頭',   en: 'Taro',         hex: '#B3A2C5', L: 69.08 },
  { id: 8,  zh: '黑糖',   en: 'Brown Sugar',  hex: '#4D3B30', L: 26.5 },
  { id: 9,  zh: '檸檬',   en: 'Lemon',        hex: '#EEE59D', L: 90.16 },
  { id: 10, zh: '薄荷',   en: 'Mint',         hex: '#569381', L: 56.52 },
  { id: 11, zh: '藍莓',   en: 'Blueberry',    hex: '#556595', L: 43.37 },
  { id: 12, zh: '葡萄',   en: 'Grape',        hex: '#402D4F', L: 22.06 },
  { id: 13, zh: '蜜桃',   en: 'Peach',        hex: '#F0D1C8', L: 86.15 },
  { id: 14, zh: '黑芝麻', en: 'Black Sesame', hex: '#2D2C2C', L: 18.1 },
];

export const LSTAR = PALETTE.map(p => p.L);

/** 高危組合：抹茶×烏龍、薄荷×椰奶、紅豆×葡萄 */
export const FORBIDDEN_PAIRS = [[1, 4], [10, 0], [6, 12]];

export const MIN_LSTAR_GAP = 8;
