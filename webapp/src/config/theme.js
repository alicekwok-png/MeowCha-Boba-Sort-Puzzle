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
export const LIQUID_COLORS = Object.freeze({
  A: { id: 'A', name: 'sulphur',     zh: '硫黃',   hex: '#E5C158', hue: 45,  lum: 62 },
  B: { id: 'B', name: 'amber',       zh: '琥珀',   hex: '#D98A4E', hue: 26,  lum: 61 },
  C: { id: 'C', name: 'rose',        zh: '薔薇',   hex: '#D4739B', hue: 335, lum: 63 },
  D: { id: 'D', name: 'cinnabar',    zh: '硃砂',   hex: '#C25260', hue: 352, lum: 57 },
  E: { id: 'E', name: 'gentian',     zh: '龍膽',   hex: '#B36FC4', hue: 288, lum: 61 },
  F: { id: 'F', name: 'amethyst',    zh: '紫晶',   hex: '#8E7BD4', hue: 253, lum: 65 },
  G: { id: 'G', name: 'pale_blue',   zh: '淡藍',   hex: '#6FB8D4', hue: 197, lum: 65 },
  H: { id: 'H', name: 'ultramarine', zh: '群青',   hex: '#5A76C4', hue: 224, lum: 59 },
  I: { id: 'I', name: 'verdigris',   zh: '銅綠',   hex: '#7CC49A', hue: 145, lum: 66 },
  J: { id: 'J', name: 'opal',        zh: '蛋白石', hex: '#F0E6D2', hue: 40,  lum: 91 },
});

export const EXCLUSIVE_PAIRS = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H'], ['B', 'D']];
export const CAUTION_PAIRS = [['F', 'H']];          // 只准 ≤4 色關卡

export const PATTERNS = ['P0', 'P1', 'P2', 'P3', 'P4'];
export const PATTERN_EXCLUSIVE = [['P2', 'P3']];    // 只准 ≤5 元素關卡
export const MAX_PATTERNS_PER_LEVEL = 3;            // 含 P0（驗收測試：冇關卡超過 3 種圖案）

// 磨砂玻璃色 — 已驗證同 10 隻液體色全部無衝突，唔准改
export const FROSTED_GLASS = '#9AA59B';
