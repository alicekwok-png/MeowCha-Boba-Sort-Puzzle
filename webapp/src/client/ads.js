// client/ads.js — 廣告轉接層。正式版接 SDK 時只需要實作 window.meowchaAds.showRewarded(unitId) → Promise<boolean>。
// 冇 SDK 時用模擬 rewarded video（3 秒倒數）；?adfail=1 可以測「攞唔到廣告」路徑。

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const ads = {
  /** 每個觸點用獨立 ad unit ID（額外訂單槽 / 額外空杯分開），方便分析 */
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
