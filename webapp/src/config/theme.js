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

// 液體色板 — 唔准改 hex，關卡設計依賴呢啲值。id 順序 A–J 對應 colorId 0–9（舊關卡表 / 盤面編碼都用數字 id）。
// 實作指令 v4 §1.1（2026-09-05）：高飽和 + 中明度（S 62–85%、L 42–54%），唔要糖果色；J 蛋白石係唯一高明度色，靠明度差區分。
export const LIQUID_COLORS = Object.freeze({
  A: { id: 'A', hex: '#E8BD13', name: 'sulphur',     zh: '硫黃',   hue: 48,  sat: 85, lum: 49 },
  B: { id: 'B', hex: '#E07A18', name: 'amber',       zh: '琥珀',   hue: 29,  sat: 80, lum: 48 },
  C: { id: 'C', hex: '#D6337A', name: 'rose',        zh: '薔薇',   hue: 334, sat: 62, lum: 52 },
  D: { id: 'D', hex: '#DC252C', name: 'cinnabar',    zh: '硃砂',   hue: 358, sat: 72, lum: 50 },
  E: { id: 'E', hex: '#8E2FD1', name: 'gentian',     zh: '龍膽',   hue: 278, sat: 64, lum: 50 },
  F: { id: 'F', hex: '#4A3FD4', name: 'amethyst',    zh: '紫晶',   hue: 244, sat: 65, lum: 54 },
  G: { id: 'G', hex: '#2C9FD6', name: 'pale_blue',   zh: '淡藍',   hue: 201, sat: 67, lum: 50 },
  H: { id: 'H', hex: '#2242CD', name: 'ultramarine', zh: '群青',   hue: 229, sat: 72, lum: 47 },
  I: { id: 'I', hex: '#4CB81E', name: 'verdigris',   zh: '銅綠',   hue: 102, sat: 72, lum: 42 },
  J: { id: 'J', hex: '#E8DCC0', name: 'opal',        zh: '蛋白石', hue: 42,  sat: 47, lum: 83 },
});

export const EXCLUSIVE_PAIRS = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H'], ['B', 'D']];
export const CAUTION_PAIRS = [['F', 'H']];          // 只准 ≤4 色關卡

export const PATTERNS = ['P0', 'P1', 'P2', 'P3', 'P4'];
export const PATTERN_EXCLUSIVE = [['P2', 'P3']];    // 只准 ≤5 元素關卡
export const MAX_PATTERNS_PER_LEVEL = 3;            // 含 P0（驗收測試：冇關卡超過 3 種圖案）

// 磨砂玻璃色 — 已驗證同 10 隻液體色全部無衝突，唔准改
export const FROSTED_GLASS = '#9AA59B';
