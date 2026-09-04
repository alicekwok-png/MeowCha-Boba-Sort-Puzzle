// client/ads.js — 廣告轉接層。正式版接 SDK 時只需要實作 window.meowchaAds.showRewarded(unitId) → Promise<boolean>。
// 冇 SDK 時用模擬 rewarded video（3 秒倒數）；?adfail=1 可以測「攞唔到廣告」路徑。
// Spec v2 §6：同屏最多 2 個廣告入口（addEmptyBottle 玩區 / unlockOrder 委託人區），視覺一律用黃銅紋章 UI_ad_crest。

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 第 1–10 關零廣告 — 唔可以破嘅規則（遠端 config 都改唔到） */
export const ADS_FREE_MAX_LEVEL = 10;

/** 呢一關可唔可以出現任何廣告入口：練習 / 非數字關卡 id 一律唔得 */
export function adsAllowedForLevel(levelId) {
  return typeof levelId === 'number' && Number.isFinite(levelId) && levelId > ADS_FREE_MAX_LEVEL;
}

export const ads = {
  /** 每個觸點用獨立 ad unit ID（額外委託槽 / 額外空瓶分開），方便分析 */
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
