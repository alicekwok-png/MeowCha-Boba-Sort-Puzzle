// config/layout.js — Spec v2 §1.2：瓶子版面排列常數。
// 調參規則：jitterX/Y 由 0.05 開始向上調。超過 0.10 / 0.15 會由「有機」變「凌亂」。

export const LAYOUT = Object.freeze({
  // 垂直分配（相對螢幕高度）— 用戶 2026-09-05：頂欄併入委託人行（金幣 / 關卡 / 設定放喺兩端），道具列 14% → 10%，盤面 62% → 72%
  // 目的：加真樽（難度）之後 3 行 × 0.19 = 0.57 仲有 0.15 分俾行距 + 上下邊距，唔使縮樽
  topBarTop:        0.00,
  topBarBottom:     0.00,   // 併入委託人行
  orderSlotsTop:    0.00,
  orderSlotsBottom: 0.18,   // 委託人 + 委託槽 + 金幣 / 關卡 / 設定同行
  playfieldTop:     0.18,
  playfieldBottom:  0.90,   // 盤面 72%
  toolbarTop:       0.90,
  toolbarBottom:    1.00,   // 道具列 ×4，10%
  // 樽尺寸（相對螢幕高度）
  bottleHeightRatio: 0.19,  // 原本約 0.13
  bottleAspect:      0.42,  // 寬 / 高

  // 欄數按樽數：≤6 → 3、≤9 → 4、10+ → 5（5 欄放唔落 0.19 樽高 / 1.15 間距就退回 4 欄，接受縮樽）— core/layout.js columnsFor / chooseColumns
  columnsByCount: [[6, 3], [9, 4], [Infinity, 5]],
  fallbackColumns: 4,
  rowOffsetRatio: 0.5,
  jitterX: 0.08,
  jitterY: 0.12,
  rotationMaxDeg: 3,
  minDistanceRatio: 1.15,
  maxOverlapRatio: 0.12,
  minTapTargetPt: 44,
  separationIterations: 8,
});

/** v4 §3.2：貓助手唔常駐，只喺交貨時由右下彈出 */
export const CAT = Object.freeze({
  mode: 'transient',
  anchor: 'bottomRight',
  showOnDeliver: true,
  showDurationMs: 1200,
  fadeOutMs: 300,
});

export const CLOTH = Object.freeze({
  fixedWidthRatio: 1.34,  // 相對最闊瓶型（flask）；布唔隨瓶型縮放
  topOffsetRatio: 0.07,   // 布頂高於瓶頂
  // backing rect 已取消 — VES_cloth_cover_v3 底邊 100% 連續，無需補底
});
