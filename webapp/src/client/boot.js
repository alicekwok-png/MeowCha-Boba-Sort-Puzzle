// client/boot.js — 開場流程（開場規格）：Boot → 公司 Logo → Loading → 關卡。
// 核心原則：資源下載同 Logo 播放並行。純函數（決策 / 載入）同 DOM 流程分開，方便測試。

export const LOGO_FIRST_MS = 2000;
export const LOGO_REPEAT_MS = 1200;
export const LOADING_MIN_MS = 800;
export const ASSET_TIMEOUT_MS = 15000;
export const ASSET_RETRIES = 1;

export const TIPS = ['正在煮珍珠…', '正在搖勻…', '摩卡準備緊…', '今日客人快到喇…', '正在洗杯…'];

/** 批次 2 — 遊戲核心（阻塞 GameLoading）。bytes 係估算，用嚟加權進度。 */
export const CORE_ASSETS = [
  { url: 'levels/campaign.json', bytes: 20_000 },
  { url: 'assets/bg/bg1_far.webp', bytes: 44_000 },
  { url: 'assets/cup-body.webp', bytes: 27_000 },
  { url: 'assets/cup-geom.json', bytes: 400 },
  ...['idle', 'pouring', 'serve', 'stuck', 'almost', 'clear'].map(k => ({ url: `assets/mocha-${k}.webp`, bytes: 42_000 })),
  ...[1, 2, 3, 4].flatMap(c => ['wait', 'happy', 'angry'].map(m => ({ url: `assets/customer-${c}-${m}.webp`, bytes: 9_000 }))),
];

/** 批次 3 — 延後（進入關卡後閒時載） */
export const DEFERRED_ASSETS = [
  'assets/bg-04.jpg', 'assets/mocha-avatar.webp',
  'assets/cup-frosted.webp', 'assets/cup-sealed.webp', 'assets/cup-takeaway.webp',
];

// ---------------- 決策（純函數） ----------------

/** Logo 播幾耐：host=app → 0；睇過 → 1200；首次 → 2000。會寫 mc_seen_logo flag。 */
export function decideLogoDuration({ search = '', storage }) {
  const params = new URLSearchParams(search);
  const fromHostApp = params.get('host') === 'app';
  const seenLogo = storage.getItem('mc_seen_logo') === '1';
  const duration = fromHostApp ? 0 : (seenLogo ? LOGO_REPEAT_MS : LOGO_FIRST_MS);
  storage.setItem('mc_seen_logo', '1');
  return { duration, fromHostApp, seenLogo, uid: params.get('uid'), sig: params.get('sig') };
}

/**
 * 續玩：一律直接落上次關卡，唔問、唔彈窗。
 * 例外先落主畫面（Cafe）：剛跨階段 / 首次過第 10 關後回訪 / 有未領獎勵 / 賽事未讀（後兩者暫無）。
 */
export function decideEntry({ storage, progress, levelCount }) {
  const stars = progress.stars || {};
  if (storage.getItem('mc_pending_stage')) return { screen: 'cafe', reason: 'stage', stageId: Number(storage.getItem('mc_pending_stage')) };
  if (stars[10] && storage.getItem('mc_intro_cafe') !== '1') return { screen: 'cafe', reason: 'intro' };
  if (storage.getItem('mc_unclaimed_reward') === '1') return { screen: 'cafe', reason: 'reward' };
  if (storage.getItem('mc_unread_tournament') === '1') return { screen: 'cafe', reason: 'tournament' };
  const last = Number(progress.last || 0);
  if (last >= 1 && last <= levelCount && !stars[last]) return { screen: 'level', levelId: last };
  let id = 1;
  while (stars[id] && id < levelCount) id++;
  return { screen: 'level', levelId: id };
}

// ---------------- 並行載入（含 timeout / 重試 / 進度） ----------------

/**
 * 載入一批資源。回傳 Promise<void>；任一資源重試後仍失敗即 reject（唔會永遠 pending）。
 * onProgress(0..1) 以 bytes 加權。
 */
export function loadCore(assets, { onProgress = () => {}, timeoutMs = ASSET_TIMEOUT_MS, retries = ASSET_RETRIES, fetchImpl = globalThis.fetch, base = '' } = {}) {
  const total = assets.reduce((a, x) => a + x.bytes, 0);
  const done = new Map();
  const report = () => onProgress(Math.min(1, [...done.values()].reduce((a, b) => a + b, 0) / total));

  const fetchOne = async (asset, attempt) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(base + asset.url, { signal: ctrl.signal, cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const len = Number(res.headers.get('content-length')) || asset.bytes;
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        let got = 0;
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          got += value.length;
          done.set(asset.url, Math.min(asset.bytes, asset.bytes * (got / len)));
          report();
        }
      } else {
        await res.arrayBuffer();
      }
      done.set(asset.url, asset.bytes);
      report();
    } catch (e) {
      if (attempt < retries) return fetchOne(asset, attempt + 1);   // 自動重試 1 次
      throw new Error(`asset failed: ${asset.url} (${e.name === 'AbortError' ? 'timeout' : e.message})`);
    } finally {
      clearTimeout(timer);
    }
  };
  return Promise.all(assets.map(a => fetchOne(a, 0))).then(() => undefined);
}

/** 批次 3：閒時預載，唔阻塞 */
export function loadDeferred(urls, base = '') {
  const go = () => { for (const u of urls) { const i = new Image(); i.src = base + u; } };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 1500);
}

// ---------------- DOM 流程 ----------------

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class BootFlow {
  /**
   * @param {object} o
   * @param {HTMLElement} o.logoScreen     #screen-logo
   * @param {HTMLElement} o.loadingScreen  #screen-loading
   * @param {string[]} o.liquidColors      進度條隨機顏色
   * @param {string} o.base                資源根路徑
   */
  constructor(o) {
    Object.assign(this, o);
    this.progress = 0;
    this.timing = {};
  }

  async run() {
    const t0 = performance.now();
    const storage = localStorage;
    const { duration, fromHostApp } = decideLogoDuration({ search: location.search, storage });
    this.timing.logoPlanned = duration; this.timing.fromHostApp = fromHostApp;

    // 關鍵：立即開始批次 2，唔等 logo
    const corePromise = loadCore(CORE_ASSETS, { base: this.base, onProgress: p => { this.progress = p; } });
    corePromise.catch(() => {});   // 由 loading 畫面處理

    if (duration > 0) await this.showLogo(duration);
    this.timing.logoDone = performance.now() - t0;

    const ok = await this.showLoading(corePromise);
    this.timing.total = performance.now() - t0;
    if (!ok) return null;    // 已顯示重試畫面
    loadDeferred(DEFERRED_ASSETS, this.base);
    return this.timing;
  }

  /** 純白底 + logo；撳邊度都可以跳過；done flag 防雙重觸發；白色淡出 */
  showLogo(duration) {
    const s = this.logoScreen;
    const img = s.querySelector('img');
    s.classList.add('active');
    img.classList.remove('in', 'out');
    return new Promise(resolve => {
      let done = false;
      const finish = async () => {
        if (done) return;
        done = true;
        s.classList.add('fade');
        await sleep(200);
        s.classList.remove('active', 'fade');
        resolve();
      };
      s.onpointerdown = finish;
      setTimeout(() => img.classList.add('in'), 200);                       // 淡入 400ms
      setTimeout(() => { if (!done) img.classList.add('out'); }, Math.max(0, duration - 400)); // 淡出 300ms
      setTimeout(finish, duration);
    });
  }

  /** 奶白底：字標 + 摩卡三幀 loop + 注液進度條 + 文案輪播；最少 0.8s；失敗顯示重試 */
  async showLoading(corePromise) {
    const s = this.loadingScreen;
    const shown = performance.now();
    const mocha = s.querySelector('#boot-mocha');
    const fill = s.querySelector('#boot-fill');
    const tip = s.querySelector('#boot-tip');
    const retry = s.querySelector('#boot-retry');
    retry.hidden = true;
    fill.style.background = this.liquidColors[Math.floor(Math.random() * this.liquidColors.length)];
    fill.style.width = '0%';
    tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    s.classList.add('active');
    requestAnimationFrame(() => s.classList.add('in'));

    // 摩卡待機 loop：1-2-3-2，4 fps
    const frames = ['01', '02', '03', '02'];
    let fi = 0;
    const anim = setInterval(() => { fi = (fi + 1) % frames.length; mocha.src = `${this.base}assets/mocha-idle-${frames[fi]}.webp`; }, 250);
    // 進度條
    const bar = setInterval(() => { fill.style.width = `${Math.max(8, this.progress * 100).toFixed(1)}%`; }, 50);
    // 文案輪播 1.4s
    const tips = setInterval(() => {
      tip.classList.add('hide');
      setTimeout(() => { tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)]; tip.classList.remove('hide'); }, 200);
    }, 1400);

    let ok = true;
    try { await corePromise; } catch (e) { ok = false; this.timing.error = e.message; console.warn(e); }

    if (!ok) {
      clearInterval(bar); clearInterval(tips);
      tip.textContent = '';
      retry.hidden = false;
      // 撳一下由頭嚟過（logo flag 已寫 → 會跳過 / 縮短 logo）
      await new Promise(r => { s.onpointerdown = r; });
      clearInterval(anim);
      s.onpointerdown = null; s.classList.remove('active', 'in');
      this.progress = 0;
      return this.run().then(t => !!t);
    }

    const wait = Math.max(0, LOADING_MIN_MS - (performance.now() - shown));
    await sleep(wait);
    this.progress = 1; fill.style.width = '100%';
    await sleep(120);
    clearInterval(anim); clearInterval(bar); clearInterval(tips);
    s.classList.add('fade');
    await sleep(200);
    s.classList.remove('active', 'in', 'fade');
    return true;
  }
}
