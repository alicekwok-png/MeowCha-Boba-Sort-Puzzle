# 喵喵茶記 Boba Cat — Webapp

依照兩份規格實作嘅可玩 webapp：

- `MeowCha Boba Sort Puzzle-spec.md`（引擎技術規格 v1.0）：Move Validator · 關卡生成器 · IDA\* Solver · 權威驗證（本地模擬）· 節奏風險評分
- `meowcha-background-spec.md`（背景實作規格 v1.0）：五層結構 · 安全區 · 程式遮罩 · 五個階段 · 氛圍層 · 階段過渡

## 開始

需要 Node.js 18+（開發時用 v24）。

```bash
cd webapp
npm start          # http://localhost:8080
```

Windows 可以直接雙擊 `start.cmd`。

> 因為用 ES modules 同 `fetch()` 讀關卡檔，**唔可以直接雙擊 index.html 用 file:// 開**，要經 http 伺服器。

## 指令

| 指令 | 作用 |
|---|---|
| `npm start` | 零依賴靜態伺服器（`server.js`） |
| `npm test` | 34 個測試：rules / encoding / solver / generator / server / background（灰階對比） |
| `npm run gen` | 離線批次生成 40 關 → `levels/campaign.json`（約 1 分鐘） |
| `node tools/gen.js --only 12` | 只生成第 12 關（除錯） |
| `python tools/build-bg.py` | 生成五個階段遠景圖 → `assets/bg/`（需要 Pillow）。有 `assets/bg/src/stage{N}.jpg\|png` 就用美術交付嘅整張直向圖（自動偵測平坦帶、切三段對位到 0–470 / 470–1750 / 1750–2400），冇就由 style anchor 合成 |
| `node tools/dev/contrast.mjs` | 逐階段計算要幾多遮罩透明度先過到對比測試 |

## 架構

```
webapp/
  src/core/            ← 純 JS，零瀏覽器 / Node 依賴；client 同 server 共用
    board.js             狀態表示、mask()、encodeBoard / encodeMoves
    rules.js             canPour / applyMove / settleOrders / isSolved / isDead
    solver.js            IDA*（可採納 heuristic、正規化、剪枝）、countOptimalPaths、safeOpening
    generator.js         randomFill + 7 項質量檢查、starThresholds
    prng.js              mulberry32 確定性亂數
    palette.js           15 種飲品顏色 + L* 值 + 高危組合
    levels.js            Campaign 1–40 關 LevelConfig 表、練習模式 config
  src/client/
    local-server.js      §5 權威協定嘅瀏覽器內模擬：session、reveal、hint、complete、rhythmRisk
    solver.worker.js     Web Worker：提示求解、練習關生成（唔阻塞 UI）
    background.js        BackgroundManager：五層結構、程式遮罩、階段表、氛圍層、過渡、微視差、FPS 救生索
    game.js              Canvas 渲染杯陣、觸控、倒液 / 交付 / 解封動畫
    main.js              畫面流程、客人排、進度（localStorage）、Mocha 對白、階段過渡時刻
    audio.js             WebAudio 合成音效
  levels/campaign.json   預生成 40 關（board 編碼 + 最優步數 + 三星門檻）
  assets/bg/             bg{1..5}_far.webp（1080 × 2800，含出血）+ manifest.json（安全區 L*）
  tools/gen.js           離線批次生成關卡
  tools/build-bg.py      合成背景遠景圖
  tests/                 測試套件
```

### 背景五層（z-index）

| z | 層 | 實作 |
|---|---|---|
| 0 | `bg-far` | `<img>` cover 式縮放；非 9:20 螢幕會按尺寸對位，保證出血以外嘅頂部場景留低 |
| 10 | `bg-mid` | 預留（未有中景切圖） |
| 20 | `bg-ambient` | `<canvas>` 程式畫：飄葉 / 光斑 / 雨絲 / 招牌閃 / 人流 / 燈籠 / bokeh / 珍珠 |
| 30 | `readability-mask` | CSS linear-gradient，Y 370→470 漸入、1750→1850 漸出；`bg.setMaskAlpha()` 可執行期調 |
| 40 | `board` | 杯陣 canvas，只佔安全區（Y 20%–73%） |
| 50 | `characters` | 摩卡 + 對話泡（Y 73%–88%）、客人排（Y 10%–20%） |
| 60 | `ui` | 頂欄、按鈕區 |

**FPS 救生索**：氛圍層 < 45 fps 持續 3 秒自動隱藏。
**階段過渡**：跨階段關（40 / 120 / 250 / 450）過關後撳「繼續」→ 遠景 0.15× / 中景 0.5× 橫移 3 秒 → 摩卡跳入講對白 → 階段字卡。
Campaign 暫時得 40 關，所以只有第 40 關之後會見到「落雨喇，我哋搬入舖頭！」；用 `?stage=N` 可以強制預覽任何階段嘅背景。

### 資訊分割（引擎規格）

`LocalServer` 入面嘅 session 持有真實盤面（含磨砂杯隱藏層）；`main.js` 只攞到 `mask()` 之後嘅視圖。
磨砂杯倒出時 client 唔知真實倒出量（頂層下面可能同色），所以會先 `reveal()` 再播動畫。
過關時 server 由 `trueBoard` 重放全部走步驗證（`ILLEGAL_MOVE` / `NOT_SOLVED` / `TOO_FAST` / `MOVE_FLOOD`），
唔信 client 傳嘅任何盤面狀態。換成真 server 只需將 `LocalServer` 嘅方法改成 `fetch('/v1/level/...')`。

### 同規格唔同 / 要注意嘅地方

1. **外帶杯（cap 3）三格同色唔算「完成」**。規格嘅 `canPour` 會凍結任何純色滿杯，套用喺外帶杯上會令佢永遠郁唔到而成為死局。
2. **啟發函數收緊**：`h = Σ_color (段數 − 有冇底段)`，仍可採納（BFS 驗證 3000 局），令難關由幾分鐘變幾毫秒解到。
3. **色板 L\* 階梯**：主梯 10 色每 8.5 一級。原本嘅 L\* 值有兩對相差 7.8 / 7.9，會令 9 色以上嘅關卡永遠過唔到色盲檢查。
4. **背景安全帶必須淺色**：灰階對比測試證明，如果安全帶用場景平均啡色（L\* 60），遮罩要推到 0.8 先過到 ≥ 25；
   牆面改成淺奶白（L\* ≈ 95）就可以維持規格嘅 0.40–0.72。呢個係交畀美術嘅硬要求之一。
   測試入面杯身模型 = 70% 飲品（15 色平均明度）+ 30% 半透明杯身。
5. 中景（`bg-mid`）同氛圍切圖未有美術，中景留空、氛圍元素全部程式畫。
6. 第一階段遮罩用 0.50 而唔係規格嘅 0.45：對真實街車圖跑灰階對比測試差 0.2 未達 25，按 §3 驗收流程 +0.05。

## 開場流程（開場規格）

```
撳 MeowCha → Boot（讀 flag / ?host=app，即刻並行下載批次 2）
          → 公司 Logo（純白，首次 2.0s，之後 1.2s，host=app 跳過；撳邊度都可跳過）
          → Loading（奶白：字標 + 摩卡三幀 loop + 隨機色注液進度條 + 文案輪播，最少 0.8s）
          → 直接落上次關卡（唔問、唔彈窗）
```

- 實作喺 [src/client/boot.js](src/client/boot.js)：`decideLogoDuration` / `decideEntry` / `loadCore` 係純函數（有測試），`BootFlow` 負責 DOM。
- 批次 1（logo、字標、摩卡三幀 ≈ 145 KB）用 `<link rel="preload">` 喺 HTML 層載；批次 2（關卡檔、第一階段背景、摩卡六姿勢、食客 12 個頭像 ≈ 420 KB）阻塞 Loading；批次 3（主畫面背景、教學杯圖）入關後閒時載。
- 每個資源 15 秒 timeout、自動重試 1 次，之後顯示「載入唔到，撳一下重試」（撳一下由頭嚟過，logo 會縮短）。
- 續玩例外先落主畫面：剛跨階段（`mc_pending_stage`）、首次過第 10 關後回訪（`mc_intro_cafe`）、未領獎勵 / 賽事未讀（旗標已預留）。
- 關卡左上角 🏪 返回店舖（主畫面）。開場時間會印喺 console：`[boot] logo … ms · total … ms`。
- 首次進入本機實測約 3.4 秒（logo 2.2s + loading 1.2s）；批次 2 由本機伺服器載入只需 11 ms。

## 素材流程

所有原始素材放喺專案根目錄嘅 `assets-raw/`（Hailuo 出圖檔名好長，用時間排序搵最新）。

| 素材 | 做法 |
|---|---|
| 階段背景（整張直向圖） | 複製到 `webapp/assets/bg/src/stage{N}.jpg`，跑 `python tools/build-bg.py`。腳本自動偵測平坦帶；切位唔啱可以加 `stage{N}.json`：`{"scene_end": 0.46, "counter_start": 0.77}` |
| 其他全部（logo、字標、摩卡六姿勢 + 待機三幀、四位食客 × 三表情、杯種） | 跑 `python tools/build-assets.py`（需要 Pillow + numpy）。腳本按檔名喺 `assets-raw/` 搵圖，自動去背（假格仔底 / 純白底）、裁圓形頭像、轉 WebP 到 `webapp/assets/` |

食客：1 貓（眼鏡圍巾）· 2 兔 · 3 柴犬 · 4 熊（西裝），表情 `wait`（等待）/ `happy`（出單）/ `angry`（步數超三星門檻仍未出單）。
新嘅白磨砂杯同透明有蓋杯去唔到背（白底白杯 / 膠身透出格仔），教學畫面沿用舊素材（`assets-raw/legacy/`）。
`assets-raw/` 唔喺 git 入面（72 MB），生成出嚟嘅 `webapp/assets/` 先會 commit。

## 玩法

- 㩒杯揀起，再㩒另一隻杯倒過去；只可倒落空杯或頂層同色。
- 客人排：每位客人手上寫住想飲乜。裝滿一杯即出單，杯清空。每交 2 單解封一隻封膜杯。
- 三星 = 最優 + 3（每隻磨砂杯再 +2）；兩星 = 三星 + 5。頂欄三粒星會跟住步數變。
- 鍵盤：`1–9` 揀杯、`U`/`Z` 撤銷、`H` 提示、`R` 重來、`Esc` 取消選擇。
