// config/layout.js — Spec v2 §1.2：瓶子版面排列常數。
// 調參規則：jitterX/Y 由 0.05 開始向上調。超過 0.10 / 0.15 會由「有機」變「凌亂」。

export const LAYOUT = Object.freeze({
  // 實作指令 v4 §3.3：垂直分配（相對螢幕高度）
  topBarTop:        0.00,
  topBarBottom:     0.10,   // 金幣 / 關卡 / 設定
  orderSlotsTop:    0.10,
  orderSlotsBottom: 0.24,   // 委託槽 ×4 + 委託人
  playfieldTop:     0.24,
  playfieldBottom:  0.86,   // 盤面 62%
  toolbarTop:       0.86,
  toolbarBottom:    1.00,   // 道具列 ×4
  // 樽尺寸（相對螢幕高度）
  bottleHeightRatio: 0.19,  // 原本約 0.13
  bottleAspect:      0.42,  // 寬 / 高

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
