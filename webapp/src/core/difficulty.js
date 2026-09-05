// core/difficulty.js — 難度系統：步數上限、隱藏密度、機制登場表。
// 生成器（tools/gen.js → generator.js）同 client 都由呢度讀，唔會出現「寫咗但冇接上」。
// 實作指令 v4（2026-09-05）：單一樽型；`?` 隱藏層同廣告樽 L2 起；限步 12；13 關後沿用工單 #5（布遮 19、訂單槽 7 / 17 / 36）。

/** 步數上限：≤11 關冇上限（brief：第 12 關「夜市高峰」先首次限步）；之後按最優步加固定餘量 */
export function computeMoveLimit(levelId, optimal) {
  if (!levelId || levelId < UNLOCK_LEVEL.moveLimit) return null;
  if (levelId <= 20) return optimal + 12;
  if (levelId <= 30) return optimal + 10;
  if (levelId <= 40) return optimal + 8;
  return optimal + 6;
}

/**
 * 隱藏格比例（佔全部有色格）：
 *  L1 0；L2–5（v4 §5：`?` 隱藏層 L2 就出現）10%；6–10 12% → 15%；11 關起沿用工單 #5：15% + 每關 0.8%，上限 65%
 */
export function hiddenRatio(levelId) {
  if (!levelId || levelId < UNLOCK_LEVEL.hidden) return 0;
  if (levelId <= 5) return 0.10;
  if (levelId <= 10) return 0.12 + (levelId - 6) * 0.0075;
  return Math.min(0.65, 0.15 + (levelId - 10) * 0.008);
}

/** 機制最早登場關卡（實作指令 v4 + 工單 #5） */
export const UNLOCK_LEVEL = {
  hidden: 2,        // `?` 隱藏層樽 — v4 §5「L2 就出現」
  adBottle: 2,      // 廣告樽（一開波喺盤面）— v4 §4「第二關已經有兩隻」；⚠ 同「第 1–10 關零廣告」相撞，見 ads.js ADS_FREE_MAX_LEVEL
  undo: 5,          // Undo 按鈕
  orders: 1,        // 委託槽（Spec v3：L1 就有 1 個免費槽）
  adEmptyCup: 11,   // 道具列「+樽」
  moveLimit: 12,    // 步數上限
  hint: 14,         // 提示道具
  secondOrder: 3,   // 第二免費槽（Spec v3 §7：L3 兩個槽同時開）
  adOrderSlot: 11,  // 廣告委託槽（Spec v3 adSlots，每關最多 2）
  covered: 19,      // 布遮樽（鎖死 + 蠟封提示）
  thirdOrder: 36,   // 第三委託槽
};

/** 該關最多幾多個固定訂單槽 */
export function maxOrders(levelId) {
  if (levelId < UNLOCK_LEVEL.orders) return 0;
  if (levelId < UNLOCK_LEVEL.secondOrder) return 1;
  if (levelId < UNLOCK_LEVEL.thirdOrder) return 2;
  return 3;
}

/** 檢查一個關卡 config 有冇提早出現機制；回傳違規清單（空 = 合格） */
export function gatingViolations(levelId, cfg) {
  const v = [];
  if (cfg.orders > maxOrders(levelId)) v.push(`orders ${cfg.orders} > ${maxOrders(levelId)}`);
  if ((cfg.hidden || 0) > 0 && levelId < UNLOCK_LEVEL.hidden) v.push(`hidden before ${UNLOCK_LEVEL.hidden}`);
  if ((cfg.ad || 0) > 0 && levelId < UNLOCK_LEVEL.adBottle) v.push(`ad bottle before ${UNLOCK_LEVEL.adBottle}`);
  if ((cfg.covered || 0) > 0 && levelId < UNLOCK_LEVEL.covered) v.push(`covered before ${UNLOCK_LEVEL.covered}`);
  if ((cfg.takeaway || 0) > 0 || (cfg.cracked || 0) > 0) v.push('takeaway / cracked removed in v4');
  if (hiddenRatio(levelId) === 0 && (cfg.hidden || 0) > 0) v.push('hidden cells at ratio 0');
  return v;
}
