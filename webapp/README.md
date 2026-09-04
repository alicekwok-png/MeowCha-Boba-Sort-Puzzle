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
| `npm run stats` | 輸出 40 關數據表（容器 / 色數 / 空杯 / 每色平均段數 / 隱藏% / 最優 / 上限 / 杯種） |
| `python tools/build-icon.py` | App Icon 方向一「發光珍奶杯」程式繪製版 → `assets/icons/` 全套 + `../design/icon/` 驗收 mock（48px、深 / 淺列表、搜尋結果） |

## 架構

```
webapp/
  src/core/            ← 純 JS，零瀏覽器 / Node 依賴；client 同 server 共用
    board.js             狀態表示、mask()、encodeBoard / encodeMoves
    rules.js             canPour / applyMove / settleOrders / isSolved / isDead
    solver.js            IDA*（可採納 heuristic、正規化、剪枝）、countOptimalPaths、safeOpening
    generator.js         randomFill + 7 項質量檢查、starThresholds
    prng.js              mulberry32 確定性亂數
    palette.js           夜市 10 色液體色板 + 色相/明度互斥規則（純色最多 6 色同關）
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
3. **色板**：引擎規格嘅 L\* 階梯 / 色盲檢查已由夜市 brief 嘅色相 + 明度互斥規則取代（見下節）。
4. **背景安全帶**：引擎 / 背景規格要求淺色牆面；夜市 brief 之後改為深色（L\* ≈ 10–15），灰階對比測試（|L_cup − L_bg| ≥ 25）改由高明度液體同深底之間嘅差距過關。
   測試入面杯身模型 = 70% 飲品（10 色由 hex 計嘅平均 L\*）+ 30% 半透明杯身。
5. 中景（`bg-mid`）同氛圍切圖未有美術，中景留空、氛圍元素全部程式畫。
6. 第一階段遮罩用 0.50 而唔係規格嘅 0.45：對真實街車圖跑灰階對比測試差 0.2 未達 25，按 §3 驗收流程 +0.05。

## 夜市奶茶 brief（色板 / 背景 / 液體 / Icon）

`夜市奶茶_色板與Icon_Brief.md` v1.0 嘅落地方式，同之前規格有衝突嘅地方以 brief 為準：

- **色板**：`core/palette.js` 改為 10 隻高飽和液體色 A–J（檸檬黃 … 奶蓋白），互斥規則 `isExclusive`（色相距 < 40° 且明度差 < 25%），F 芋紫 × H 深藍 只准 ≤ 4 色關。
  推論：純靠顏色最多 **6 色同關** → `validateConfig` 拒絕 7 色以上；13 關後色數封頂 6，7 色以上要等 P3 圖案系統（珍珠 / 椰果 / 布丁）。
- **第 1–12 關**：色組、色數、機制照 brief A4 分配表（`levels.js` 每行 `palette`），隱藏層 6、磨砂 9、外帶 10、限步 12。13 關後沿用工單 #5（封膜 19、布遮 25、訂單槽 7 / 17 / 36），容器收窄至 9 隻（13–32）/ 8 隻（33+）維持難度。
- **隱藏層 `?`**：新機制（`Cup.hidden`）：普通杯底部 k 格為未知層，頂格永遠可見，倒走上面先露出，露出過 / 倒出過嘅格撤銷後唔會再遮。磨砂杯（頂格以外全部隱藏）同布遮杯（全部隱藏）沿用；三者都由 `hiddenCount()` 統一計入隱藏密度。盤面編碼杯標頭改為 `kind<<5 | hidden<<3 | locked<<2 | capFlag`。
- **背景**：五個階段全部夜間版（`build-bg.py build_night`）：夜空 `#171029→#2A1B47`、燈籠暖光暈 `#FFB84D`、深木檯面 `#3A2A1C`；驗收「背景飽和度 ≤ 30%」以 Lab 彩度 C* ≤ 30 判定（brief 自己嘅夜空色 C* 約 21–30）。第一階段用美術攤車圖壓暗做剪影。遮罩改深色 `#1F1638` @ 0.35。
- **UI**：面板 `#1F1638` @ 85% + 1px `#6B5CA5` 描邊，文字淺紫白；主按鈕用壓低飽和嘅燈籠色。舊 CSS token（`--cream`、`--brown` …）全部映射到夜市 token。
- **液體三件套 + 杯**（`game.js drawLayers / drawCupLight`）：每層上緣高光線（+20% L @80%）、左側 8–12% 高光柱（白 25% → 0%）、下緣暗邊（−18% L）；杯口 rim light 白 60%（只畫前唇弧）、右下暖光反射 `#FFB84D` 15%、杯底投影 `#0D0820` 45% blur 8。
- **Icon**：方向一程式繪製版做首發佔位（`tools/build-icon.py`），方向二 / 三要美術手繪；原摩卡頭像留喺 `design/icon/alt-cat-1024.png` 做 A/B。

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

## 素材流程（Spec v2 煉金工房）

所有原始素材放喺專案根目錄嘅 `assets-raw/`（v2 素材喺 `assets-raw/v2/`）。

| 素材 | 做法 |
|---|---|
| 全部 v2 美術（單張背景、5 種器皿、液體底 / 配料 tile、布遮 + 蠟封 + 黃銅框、導師貓 ×3、委託人 ×4、博士剪影、UI ×17） | 跑 `python tools/build-assets-v2.py`（需要 Pillow + numpy）→ `webapp/assets/v2/`，同時量度器皿液體幾何寫入 `assets/v2/vessels.json`（每種瓶：content / liquid 上下界、逐行玻璃內壁 l/r、rim、neck、base，全部係 768 frame 嘅 0–1 比例） |
| 邏輯名 → 路徑 | `src/config/assets.js` 嘅 `ASSET_MAP`（`VES_flask_empty`、`CHR_cat_idle`、`UI_ad_crest` …）。client 全部經 `ASSET_MAP` 取路徑，**唔准再引用舊 `assets/*.webp`**（`cup-*`、`customer-*`、`mocha-*`、`bg/`、`bg-04.jpg` 已廢棄；只有 `company-logo` / `meowcha-wordmark` 仍然用喺開場畫面） |
| 主題常數 | `src/config/theme.js`（`COLORS` 黃銅 / 深木 / 燭光、`LIQUID_COLORS` A–J 唔准改 hex、`FROSTED_GLASS`）、`src/config/layout.js`（`LAYOUT` 抖動版面、`CLOTH`）、`src/config/render.js`（`RENDER` multiply / 配料 UV / 揭開時長、`AD_SLOTS`、`CLIENT_ORDER`） |

### 用戶決定（覆蓋 Spec v2 嘅地方）

1. **遮蓋**：`none` 全部可見；`frosted` 磨砂瓶只見頂格，倒走一格露一格（逐格 160 ms 淡入）；`cloth` 布遮瓶（kind `covered`）全部隱藏、蠟封顯示頂層色、**鎖死**，每交 2 單解開一隻（server event `{type:'unlock', cup}` → 繩鬆 60 ms → 布滑上 160 ms → 塵粒 400 ms → 顏色同圖案一齊淡入 160 ms）。Spec 嘅「清空先揭開」同「盲磨砂」作廢。
2. **器皿**：燒瓶 = normal（4 格）、曲頸瓶 = takeaway（3 格，永遠裝唔滿一色）、裂瓶 = cracked（只出不入，第 15 關起）、布遮瓶 = covered（布蓋喺燒瓶上）。冇獨立「封膜杯」。
3. **文案**：客人→委託人、出單→交貨、訂單→委託、杯→瓶；飲品變試劑（硫黃 / 琥珀 / 薔薇 / 硃砂 / 龍膽 / 紫晶 / 淡藍 / 群青 / 銅綠 / 蛋白石）；吉祥物係「導師」（煉金貓 idle / happy / cheer）。遊戲名暫時仍然係喵喵茶記。
4. **廣告**：第 1–10 關零廣告（`ads.js adsAllowedForLevel` 硬鎖）；同屏最多 2 個入口（`assertAdSlotLimit` 啟動即驗）：委託人區 `unlockOrder`（紋章只出喺下一個可解鎖嘅委託人 raven → badger → owl → hare，其餘灰態）、玩區 `addEmptyBottle`（第 11 關起、冇空瓶時右下角出紋章，每關一次，`LocalServer.addEmptyCup` 記 `extraCups` 同步重放）。視覺一律 `UI_ad_crest`。
5. **背景**：單張 `BG_lab_full`，冇視差 / 階段過渡 / 氛圍粒子（`BackgroundManager` 保留做 no-op 接口）。
6. **液體**：喺器皿 sprite 入面用 `multiply` 畫，clip 到 `vessels.json` 嘅玻璃內壁多邊形；配料由 `PAT_tile_large / small` 四象限取樣（P3 橫向 repeat），墨色 = 該層色 −28% 明度。
7. **版面**：`src/core/layout.js safeLayout()` 以關卡號做種子（練習關用 seed hash），R2 永不遮液體；`?jitter=0` 強制純網格除錯。

## 玩法

- 㩒瓶揀起，再㩒另一隻瓶倒過去；只可倒落空瓶或頂層同色；裂瓶只出不入。
- 委託人：每位委託人手上寫住想要邊種試劑。裝滿一瓶即交貨，瓶清空。每交 2 單揭開一隻布遮瓶。
- 三星 = 最優 + 3（每隻磨砂 / 布遮瓶再 +2）；兩星 = 三星 + 5。頂欄三粒星會跟住步數變。
- 鍵盤：`1–9` 揀瓶、`U`/`Z` 撤銷、`H` 提示、`R` 重來、`Esc` 取消選擇。
