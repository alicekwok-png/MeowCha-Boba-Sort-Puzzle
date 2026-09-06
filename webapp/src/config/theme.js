// config/theme.js — Spec v2 §1.1：所有主題常數集中喺呢度。液體 hex 唔准改，關卡設計依賴呢啲值。

export const COLORS = Object.freeze({
  bgTop:         '#12100D',
  bgBottom:      '#1B2420',
  woodDark:      '#2A1F16',
  brassLight:    '#D4A85C',
  brassMain:     '#B8873F',
  brassDark:     '#6B4E24',
  candleGlow:    '#FFA94D',
  textPrimary:   '#E8DCC4',
  textSecondary: '#9A8B6F',
  shadow:        '#0A0806',
});

// 液體色板 — 唔准改 hex，關卡設計依賴呢啲值。id 順序 A–J 對應 colorId 0–9（關卡表 / 盤面編碼都用數字 id）。
// 用戶 2026-09-06 新色板：10 隻互相相容（舊色板最大相容組合得 6 隻，卡死咗盤面色數）。
//   深色層 A–F：HSL L 42–50（六隻靠色相分）
//   淺色層 G–J：HSL L 77–88（四隻靠明度分，色盲玩家反而更易讀）
//   兩層之間最細明度邊際 27 點（規則要求 ≥25）；全部 pair 都通過「色相差 ≥40° 或 明度差 ≥25」。
export const LIQUID_COLORS = Object.freeze({
  A: { id: 'A', hex: '#E8BD13', name: 'sulphur',    zh: '硫黃',   hue: 48,  sat: 85, lum: 49 },
  B: { id: 'B', hex: '#DC252C', name: 'cinnabar',   zh: '硃砂',   hue: 358, sat: 72, lum: 50 },
  C: { id: 'C', hex: '#8E2FD1', name: 'gentian',    zh: '龍膽',   hue: 275, sat: 64, lum: 50 },
  D: { id: 'D', hex: '#2242CD', name: 'ultramarine', zh: '群青',  hue: 229, sat: 72, lum: 47 },
  E: { id: 'E', hex: '#1FBFD4', name: 'cyan',       zh: '青碧',   hue: 187, sat: 74, lum: 48 },
  F: { id: 'F', hex: '#4CB81E', name: 'verdigris',  zh: '銅綠',   hue: 102, sat: 72, lum: 42 },
  G: { id: 'G', hex: '#F79ACB', name: 'blush',      zh: '緋櫻',   hue: 328, sat: 85, lum: 79 },
  H: { id: 'H', hex: '#9FE8C4', name: 'mint',       zh: '薄荷',   hue: 150, sat: 61, lum: 77 },
  I: { id: 'I', hex: '#B9A8F0', name: 'lavender',   zh: '薰衣',   hue: 254, sat: 71, lum: 80 },
  J: { id: 'J', hex: '#EFE6D2', name: 'opal',       zh: '蛋白石', hue: 41,  sat: 48, lum: 88 },
});

// 新色板 10 隻全部互相相容 → 冇硬互斥對，亦冇「慎用」對
export const EXCLUSIVE_PAIRS = [];
export const CAUTION_PAIRS = [];

export const PATTERNS = ['P0', 'P1', 'P2', 'P3', 'P4'];
export const PATTERN_EXCLUSIVE = [['P2', 'P3']];    // 只准 ≤5 元素關卡
export const MAX_PATTERNS_PER_LEVEL = 3;            // 含 P0（驗收測試：冇關卡超過 3 種圖案）
