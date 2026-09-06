// config/layout.js — Spec v2 §1.2：瓶子版面排列常數。
// 調參規則：jitterX/Y 由 0.05 開始向上調。超過 0.10 / 0.15 會由「有機」變「凌亂」。

export const LAYOUT = Object.freeze({
  // 垂直分配（相對螢幕高度）— 用戶 2026-09-06 第四版：HUD 5.5% / 委託人 15% / 訂單槽 4.5% / 盤面 68% / 道具列 7%
  // 委託人區由 13.5% 加到 15%，多出嘅 1.5% 全部做頭頂空隙（sizeClients GAP 20px）——角色唔會細咗，但唔再貼住 HUD。
  // 委託人實際高度受槽闊限制（4 個槽並排，角色圖正方形）：393 闊手機每槽 ≈ 95px，CSS 准角色圖闊到 118% 槽闊（略疊隔籬）。
  // 3 行 × 0.19 = 0.57，盤面 68% 仲有 0.11 分俾行距 + 上下邊距（360–430 闊手機驗過 12 隻樽仍然 fallback 1、樽高 0.19）
  topBarTop:        0.00,
  topBarBottom:     0.055,  // HUD（金幣 / 關卡 + 步數 / 剩餘訂單 + 設定）
  clientsTop:       0.055,
  clientsBottom:    0.205,  // 委託人半身 15%（含頭頂空隙）
  orderSlotsTop:    0.205,
  orderSlotsBottom: 0.25,   // 訂單槽（托盤）4.5%
  playfieldTop:     0.25,
  playfieldBottom:  0.93,   // 盤面 68%
  toolbarTop:       0.93,
  toolbarBottom:    1.00,   // 道具列 ×4，7%
  // 樽尺寸（相對螢幕高度）
  bottleHeightRatio: 0.19,  // 原本約 0.13
  bottleAspect:      0.42,  // 寬 / 高

  // 欄數按樽數：≤6 → 3、≤9 → 4、≤13 → 5、14+ → 6（用戶 2026-09-06 一色兩樽 → 盤面去到 20 隻樽）。
  // 揀唔到就退返細一級（core/layout.js columnsFor / chooseColumns），樽高由 fitScale 統一縮。
  columnsByCount: [[6, 3], [9, 4], [13, 5], [Infinity, 6]],
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

/** v4 §3.2：貓助手唔常駐。用戶 2026-09-06：交貨都唔好彈（每單彈一次太煩、阻住盤面）→ showOnDeliver false，
 *  貓只留喺標題畫面同過關 modal。想加返就改返 true，catPop 機制原封不動。 */
export const CAT = Object.freeze({
  mode: 'transient',
  anchor: 'bottomRight',
  showOnDeliver: false,
  showDurationMs: 1200,
  fadeOutMs: 300,
});

export const CLOTH = Object.freeze({
  fixedWidthRatio: 1.34,  // 相對最闊瓶型（flask）；布唔隨瓶型縮放
  topOffsetRatio: 0.07,   // 布頂高於瓶頂
  // backing rect 已取消 — VES_cloth_cover_v3 底邊 100% 連續，無需補底
});
