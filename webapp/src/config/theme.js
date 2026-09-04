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
// 2026-09-05 用戶覆核版：色相不變（互斥表照舊），飽和度由 ~55% 推返上 ~90%——「藥劑喺暗房發光」靠高飽和 + 發光三件套（render.js GLOW）。
export const LIQUID_COLORS = Object.freeze({
  A: { id: 'A', name: 'sulphur',     zh: '硫黃',   hex: '#FFD93D', hue: 48,  lum: 62 },
  B: { id: 'B', name: 'amber',       zh: '琥珀',   hex: '#FF9E3D', hue: 29,  lum: 62 },
  C: { id: 'C', name: 'rose',        zh: '薔薇',   hex: '#FF5C9E', hue: 334, lum: 68 },
  D: { id: 'D', name: 'cinnabar',    zh: '硃砂',   hex: '#FF3B4E', hue: 355, lum: 61 },
  E: { id: 'E', name: 'gentian',     zh: '龍膽',   hex: '#C44FFF', hue: 284, lum: 65 },
  F: { id: 'F', name: 'amethyst',    zh: '紫晶',   hex: '#8A6BFF', hue: 252, lum: 71 },
  G: { id: 'G', name: 'pale_blue',   zh: '淡藍',   hex: '#3FD0FF', hue: 196, lum: 62 },
  H: { id: 'H', name: 'ultramarine', zh: '群青',   hex: '#3D6BFF', hue: 225, lum: 62 },
  I: { id: 'I', name: 'verdigris',   zh: '銅綠',   hex: '#3FF29B', hue: 154, lum: 60 },
  J: { id: 'J', name: 'opal',        zh: '蛋白石', hex: '#FFF3D6', hue: 44,  lum: 92 },
});

export const EXCLUSIVE_PAIRS = [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H'], ['B', 'D']];
export const CAUTION_PAIRS = [['F', 'H']];          // 只准 ≤4 色關卡

export const PATTERNS = ['P0', 'P1', 'P2', 'P3', 'P4'];
export const PATTERN_EXCLUSIVE = [['P2', 'P3']];    // 只准 ≤5 元素關卡
export const MAX_PATTERNS_PER_LEVEL = 3;            // 含 P0（驗收測試：冇關卡超過 3 種圖案）

// 磨砂玻璃色 — 已驗證同 10 隻液體色全部無衝突，唔准改
export const FROSTED_GLASS = '#9AA59B';
