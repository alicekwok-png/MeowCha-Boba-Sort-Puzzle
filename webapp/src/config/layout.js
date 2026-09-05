// config/layout.js — Spec v2 §1.2：瓶子版面排列常數。
// 調參規則：jitterX/Y 由 0.05 開始向上調。超過 0.10 / 0.15 會由「有機」變「凌亂」。

export const LAYOUT = Object.freeze({
  // 垂直分配（相對螢幕高度）— 用戶 2026-09-06 第三版：HUD 5.5% / 委託人 13.5% / 訂單槽 4.5% / 盤面 69.5% / 道具列 7%
  // 道具列早期關只有一粒「重來」，10% 係浪費 → 縮到 7%（44px 掣 + 邊距啱啱夠），空間畀委託人，樽整體向下移。
  // 委託人實際高度受槽闊限制（4 個槽並排，角色圖正方形）：420 闊手機每槽 ≈ 99px，CSS 准角色圖闊到 118% 槽闊（略疊隔籬）。
  // 3 行 × 0.19 = 0.57，盤面 69.5% 仲有 0.125 分俾行距 + 上下邊距（360–430 闊手機驗過仍然 fallback 1、樽高 0.19）
  topBarTop:        0.00,
  topBarBottom:     0.055,  // HUD（金幣 / 關卡 + 步數 / 剩餘訂單 + 設定）
  clientsTop:       0.055,
  clientsBottom:    0.19,   // 委託人半身 13.5%
  orderSlotsTop:    0.19,
  orderSlotsBottom: 0.235,  // 訂單槽（托盤）4.5%
  playfieldTop:     0.235,
  playfieldBottom:  0.93,   // 盤面 69.5%
  toolbarTop:       0.93,
  toolbarBottom:    1.00,   // 道具列 ×4，7%
  // 樽尺寸（相對螢幕高度）
  bottleHeightRatio: 0.19,  // 原本約 0.13
  bottleAspect:      0.42,  // 寬 / 高

  // 欄數按樽數：≤6 → 3、≤9 → 4、10+ → 5（5 欄放唔落 0.19 樽高 / 1.15 間距就退回 4 欄，接受縮樽）— core/layout.js columnsFor / chooseColumns
  columnsByCount: [[6, 3], [9, 4], [Infinity, 5]],
  fallbackColumns: 4,
  rowOffsetRatio: 0.5,
  jitterX: 0.08,
  jitterY: 0.12,
  rotationMaxDeg: 0,       // 用戶 2026-09-06：樽一律打直，唔准靜態傾斜（倒液 / 交貨動畫嘅傾斜係功能性，唔受呢個影響）
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
