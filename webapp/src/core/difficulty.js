// core/difficulty.js — 難度系統（工單 #5 方案 2）：步數上限、隱藏密度、機制登場表。
// 生成器（tools/gen.js → generator.js）同 client 都由呢度讀，唔會出現「寫咗但冇接上」。

/** 步數上限：≤10 關冇上限；之後按最優步加固定餘量 */
export function computeMoveLimit(levelId, optimal) {
  if (!levelId || levelId <= 10) return null;
  if (levelId <= 20) return optimal + 12;
  if (levelId <= 30) return optimal + 10;
  if (levelId <= 40) return optimal + 8;
  return optimal + 6;
}

/** 隱藏格比例（佔全部有色格）：≤10 關 0；之後每關 +0.8%，上限 65% */
export function hiddenRatio(levelId) {
  if (!levelId || levelId <= 10) return 0;
  return Math.min(0.65, 0.15 + (levelId - 10) * 0.008);
}

/** 機制最早登場關卡 */
export const UNLOCK_LEVEL = {
  orders: 7,        // 訂單槽
  undo: 5,          // Undo 按鈕
  frosted: 11,      // 磨砂杯
  hint: 14,         // 提示道具
  secondOrder: 17,  // 第二訂單槽
  sealed: 19,       // 封膜杯
  covered: 25,      // 布遮杯
  adEmptyCup: 11,   // 廣告空杯
  adOrderSlot: 17,  // 廣告訂單槽
  thirdOrder: 36,   // 第三訂單槽
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
  if (cfg.frosted > 0 && levelId < UNLOCK_LEVEL.frosted) v.push('frosted before 11');
  if (cfg.sealed > 0 && levelId < UNLOCK_LEVEL.sealed) v.push('sealed before 19');
  if ((cfg.covered || 0) > 0 && levelId < UNLOCK_LEVEL.covered) v.push('covered before 25');
  if (hiddenRatio(levelId) === 0 && cfg.frosted > 0) v.push('hidden cells at ratio 0');
  return v;
}
