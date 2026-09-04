// config/layout.js — Spec v2 §1.2：瓶子版面排列常數。
// 調參規則：jitterX/Y 由 0.05 開始向上調。超過 0.10 / 0.15 會由「有機」變「凌亂」。

export const LAYOUT = Object.freeze({
  columns: 4,
  rowOffsetRatio: 0.5,
  jitterX: 0.08,
  jitterY: 0.12,
  rotationMaxDeg: 3,
  minDistanceRatio: 1.15,
  maxOverlapRatio: 0.12,
  minTapTargetPt: 44,
  separationIterations: 8,
});

export const CLOTH = Object.freeze({
  fixedWidthRatio: 1.34,  // 相對最闊瓶型（flask）；布唔隨瓶型縮放
  topOffsetRatio: 0.07,   // 布頂高於瓶頂
  // backing rect 已取消 — VES_cloth_cover_v3 底邊 100% 連續，無需補底
});
