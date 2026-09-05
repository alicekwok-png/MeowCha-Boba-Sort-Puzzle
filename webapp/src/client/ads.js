// client/ads.js — 廣告轉接層。正式版接 SDK 時只需要實作 window.meowchaAds.showRewarded(unitId) → Promise<boolean>。
// 冇 SDK 時用模擬 rewarded video（3 秒倒數）；?adfail=1 可以測「攞唔到廣告」路徑。
// Spec v2 §6：同屏最多 2 個廣告入口（addEmptyBottle 玩區 / unlockOrder 委託人區），視覺一律用黃銅紋章 UI_ad_crest。

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 第 1–10 關零廣告「入口」— 唔可以破嘅規則（遠端 config 都改唔到）。
 * 只管兩個入口：委託人區 unlockOrder（紋章）同道具列 addEmptyBottle（+樽）。
 *
 * ⚠ 廣告樽（kind `ad`，實作指令 v4 §4）**唔受呢條限制**：v4 明文「參考遊戲第二關已經有兩隻廣告樽，由關卡開始就擺喺版面」，
 *   所以由 L2 起關卡資料本身就有 ad 樽（UNLOCK_LEVEL.adBottle = 2），撳一下先播廣告。
 *   佢係「關卡內容」而唔係「入口」，同屏 ≤ 2 個入口嘅計法（assertAdSlotLimit）亦唔計佢；但 +樽 要等盤面冇廣告樽剩低先出，免得同時有 3 個廣告觸點。
 *   硬規則：每關唔解鎖任何廣告樽都必須可解（tools/verify-levels.js 驗）。
 */
export const ADS_FREE_MAX_LEVEL = 10;

/** 呢一關可唔可以出現廣告「入口」（unlockOrder / addEmptyBottle）：練習 / 非數字關卡 id 一律唔得 */
export function adsAllowedForLevel(levelId) {
  return typeof levelId === 'number' && Number.isFinite(levelId) && levelId > ADS_FREE_MAX_LEVEL;
}

/**
 * 廣告樽可唔可以撳（v4 §4）：只要盤面有 ad 樽就可以，唔睇 ADS_FREE_MAX_LEVEL。
 * 練習關（cfg.ad = 0）同 L1 本身唔會生成 ad 樽，所以呢度唔使再擋；留一個函數係為咗日後接真 SDK 時可以加「SDK 未就緒」判斷。
 */
export function adBottleTappable(cup) {
  return !!cup && cup.kind === 'ad';
}

export const ads = {
  /** 每個觸點用獨立 ad unit ID（額外委託槽 / 額外空瓶 / 廣告樽解鎖分開），方便分析 */
  async showRewarded(unitId, { simulateMs = 3000, ui = null } = {}) {
    if (globalThis.meowchaAds && typeof globalThis.meowchaAds.showRewarded === 'function') {
      try { return !!(await globalThis.meowchaAds.showRewarded(unitId)); } catch { return false; }
    }
    if (new URLSearchParams(location.search).get('adfail') === '1') { await sleep(400); return false; }
    // 模擬：顯示倒數 UI（由 caller 提供 render / close）
    const secs = Math.round(simulateMs / 1000);
    for (let i = secs; i > 0; i--) {
      if (ui) ui.tick(i, unitId);
      await sleep(simulateMs / secs);
    }
    return true;
  },
};
