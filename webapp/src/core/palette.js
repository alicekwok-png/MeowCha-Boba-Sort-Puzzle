// core/palette.js — 液體色板（由 config/theme.js 嘅 LIQUID_COLORS 派生，hex 唔准改）。
// 用戶 2026-09-06 新色板：10 隻互相相容，冇硬互斥對。通用規則（色相差 <40° 且明度差 <25 → 互斥）保留，
// 因為佢係色板本身嘅驗收條件；tests/layout.test.js 會驗實際 hex 全部通過。
// 圖案系統（P0–P4）**唔會**因為色數增加而取消：淺色層四隻靠明度分，但深色層六隻仍然靠色相，
// 色盲模式一樣要靠圖案做第二辨識維度。

import { LIQUID_COLORS, EXCLUSIVE_PAIRS, CAUTION_PAIRS as CAUTION_KEYS, PATTERNS, PATTERN_EXCLUSIVE, MAX_PATTERNS_PER_LEVEL } from '../config/theme.js';
import { unitColor, unitPattern } from './board.js';

export const PALETTE = Object.keys(LIQUID_COLORS).map((key, id) => {
  const c = LIQUID_COLORS[key];
  return { id, key, zh: c.zh, en: c.name, hex: c.hex, H: c.hue, L: c.lum };
});

export const BY_KEY = Object.fromEntries(PALETTE.map(p => [p.key, p.id]));
export const HUE = PALETTE.map(p => p.H);
export const LIGHT = PALETTE.map(p => p.L);
export const LSTAR = LIGHT;   // 舊介面名（UI 文字對比用）
export { PATTERNS };

/** 色相距（0–180°） */
export function hueDist(a, b) {
  const d = Math.abs(HUE[a] - HUE[b]) % 360;
  return d > 180 ? 360 - d : d;
}

/** ⚠ 慎用組合：只喺 ≤ 4 色關卡先可以同關（F 紫晶 × H 群青） */
export const CAUTION_PAIRS = CAUTION_KEYS.map(([x, y]) => [BY_KEY[x], BY_KEY[y]]);
export const CAUTION_MAX_COLORS = 4;
const EXCLUSIVE = EXCLUSIVE_PAIRS.map(([x, y]) => [BY_KEY[x], BY_KEY[y]]);
const pairIn = (list, a, b) => list.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
const isCaution = (a, b) => pairIn(CAUTION_PAIRS, a, b);

/** 硬規則：Spec v2 EXCLUSIVE_PAIRS（同「色相距 < 40° 且明度差 < 25%」一致；慎用組合另計） */
export function isExclusive(a, b) {
  if (a === b || isCaution(a, b)) return false;
  return pairIn(EXCLUSIVE, a, b) || (hueDist(a, b) < 40 && Math.abs(LIGHT[a] - LIGHT[b]) < 25);
}

/** 純靠顏色嘅同關色數上限（新色板 10 隻全部互相相容） */
export const MAX_COLORS_BY_HUE = 10;

/** 一組顏色 id 係咪可以同關出現 */
export function colorsCompatible(ids) {
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (isExclusive(ids[i], ids[j])) return false;
      if (isCaution(ids[i], ids[j]) && ids.length > CAUTION_MAX_COLORS) return false;
    }
  }
  return true;
}

/** 圖案規則（Spec v2）：每關 ≤ 3 種圖案（含 P0）；P2 × P3 只准 ≤ 5 元素關卡 */
export const PATTERN_EXCLUSIVE_IDS = PATTERN_EXCLUSIVE.map(([x, y]) => [PATTERNS.indexOf(x), PATTERNS.indexOf(y)]);
export function patternsCompatible(patternIds, elementCount) {
  const uniq = [...new Set(patternIds)];
  if (uniq.length > MAX_PATTERNS_PER_LEVEL) return false;
  for (const [x, y] of PATTERN_EXCLUSIVE_IDS) if (uniq.includes(x) && uniq.includes(y) && elementCount > 5) return false;
  return true;
}

/** 一組 unit key（color | pattern<<4）係咪可以同關：色組互斥 + 圖案規則 */
export function unitsCompatible(units) {
  const colors = [...new Set(units.map(unitColor))];
  const patterns = units.map(unitPattern);
  return colorsCompatible(colors) && patternsCompatible(patterns, units.length);
}
