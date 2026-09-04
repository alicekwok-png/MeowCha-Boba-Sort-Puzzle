// core/difficulty.js — 難度系統：步數上限、隱藏密度、機制登場表。
// 生成器（tools/gen.js → generator.js）同 client 都由呢度讀，唔會出現「寫咗但冇接上」。
// 第 1–12 關以「夜市奶茶 brief A4 分配表」為準（磨砂 6（原隱藏層改用磨砂瓶）、外帶 10、限步 12）；
// 13 關後沿用工單 #5 方案 2（布遮 19（原封膜杯合併入布遮瓶）、裂瓶 15、訂單槽 7 / 17 / 36）。

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
 *  ≤5 關 0；6–10 關（brief 隱藏層教學段）12% → 15%；11 關起沿用工單 #5：15% + 每關 0.8%，上限 65%
 */
export function hiddenRatio(levelId) {
  if (!levelId || levelId < UNLOCK_LEVEL.frosted) return 0;
  if (levelId <= 10) return 0.12 + (levelId - 6) * 0.0075;
  return Math.min(0.65, 0.15 + (levelId - 10) * 0.008);
}

/** 機制最早登場關卡 */
export const UNLOCK_LEVEL = {
  undo: 5,          // Undo 按鈕
  frosted: 6,       // 磨砂瓶（brief L6「蓋住咗」隱藏格改用磨砂瓶）
  orders: 7,        // 委託槽
  takeaway: 6,      // 曲頸瓶（3 格）— 用戶：L6 起混編容量
  adEmptyCup: 11,   // 廣告加空瓶
  moveLimit: 12,    // 步數上限 — brief L12
  hint: 14,         // 提示道具
  cracked: 15,      // 裂瓶（只出不入）— Spec v2 更正 2
  secondOrder: 17,  // 第二委託槽
  adOrderSlot: 17,  // 廣告委託槽
  covered: 19,      // 布遮瓶（鎖死 + 蠟封提示；原封膜杯合併）
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
  if (cfg.frosted > 0 && levelId < UNLOCK_LEVEL.frosted) v.push(`frosted before ${UNLOCK_LEVEL.frosted}`);
  if (cfg.takeaway > 0 && levelId < UNLOCK_LEVEL.takeaway) v.push(`takeaway before ${UNLOCK_LEVEL.takeaway}`);
  if ((cfg.cracked || 0) > 0 && levelId < UNLOCK_LEVEL.cracked) v.push(`cracked before ${UNLOCK_LEVEL.cracked}`);
  if ((cfg.covered || 0) > 0 && levelId < UNLOCK_LEVEL.covered) v.push(`covered before ${UNLOCK_LEVEL.covered}`);
  if (hiddenRatio(levelId) === 0 && cfg.frosted > 0) v.push('hidden cells at ratio 0');
  return v;
}
