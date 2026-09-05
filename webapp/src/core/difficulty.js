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
 * 隱藏格比例（佔全部有色格）— 用戶 2026-09-06：舊曲線（L2–5 10%、L7 13%）太易，參考同類遊戲第 2 關已經約一半係 `?`。
 *  L1 0；L2 30%；L3 35%；L4–6 40%；L7–10 45%；L11 起 50% + 每關 0.5%，上限 65%
 *  另外 generator 硬檢查：L2 起至少一隻樽有 ≥ MIN_HIDDEN_DEPTH（2）個隱藏格（hiddenDepthOk）
 */
export function hiddenRatio(levelId) {
  if (!levelId || levelId < UNLOCK_LEVEL.hidden) return 0;
  if (levelId === 2) return 0.30;
  if (levelId === 3) return 0.35;
  if (levelId <= 6) return 0.40;
  if (levelId <= 10) return 0.45;
  return Math.min(0.65, 0.50 + (levelId - 11) * 0.005);
}

/** L2 起：至少一隻樽要有咁多個隱藏格（一隻樽 2–3 個 ?） */
export const MIN_HIDDEN_DEPTH = 2;

/** 機制最早登場關卡（實作指令 v4 + 工單 #5） */
export const UNLOCK_LEVEL = {
  hidden: 2,        // `?` 隱藏層樽 — v4 §5「L2 就出現」
  adBottle: 2,      // 廣告樽（一開波喺盤面）— v4 §4「第二關已經有兩隻」；廣告政策見 ads.js（冇強制廣告、冇零廣告關）
  undo: 5,          // Undo 按鈕
  orders: 1,        // 委託槽（Spec v3：L1 就有 1 個免費槽）
  adEmptyCup: 11,   // 道具列「+樽」
  moveLimit: 12,    // 步數上限
  hint: 14,         // 提示道具
  secondOrder: 3,   // 第二免費槽（Spec v3 §7：L3 兩個槽同時開）
  adOrderSlot: 11,  // 廣告委託槽（Spec v3 adSlots，每關最多 2）
  covered: 19,      // 布遮樽（鎖死 + 蠟封提示）
};   // 第三免費委託槽（原 L36）2026-09-05 取消：免費 2 + 廣告 2 到底，後期難度靠段數同隱藏密度推，唔可以喺最後五關鬆返

/** 該關最多幾多個固定訂單槽 */
export function maxOrders(levelId) {
  if (levelId < UNLOCK_LEVEL.orders) return 0;
  if (levelId < UNLOCK_LEVEL.secondOrder) return 1;
  return 2;
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
