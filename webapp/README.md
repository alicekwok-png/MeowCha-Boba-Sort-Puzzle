# Mortar & Mew — Webapp

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
| `npm test` | 102 個測試：rules / encoding / solver / generator / server / 廣告 / 難度 / 版面 / 背景 / i18n |
| `npm run gen` | 離線批次生成 40 關 → `levels/campaign.json`（約 1 分鐘） |
| `node tools/gen.js --only 12` | 只生成第 12 關（除錯） |
| `python tools/build-assets-v2.py` | Spec v2 全部美術：`assets-raw/v2/` → `assets/v2/`（webp + 器皿幾何 `vessels.json` + `asset-check.json` 驗證 + 全套 icon） |
| `npm run stats` | 輸出 40 關數據表（容器 / 色數 / 空瓶 / 每色平均段數 / 隱藏% / 最優 / 3★ / 上限 / 瓶種） |
| `npm run gen:practice` | 練習池預生成（`tools/gen-practice.js`）：三桶各 30 個合格盤面 → `levels/practice_pool.json`（≈19 KB）；runtime 由池抽（0 ms、同一批唔重複），30 個用晒先 runtime 生成；`--salt` 換一批。`npm run verify` 會一併驗池 |
| `npm run scan` | 40 關難度掃描（`tools/difficulty-scan.js`）：亂撳★2 率 = 隨機玩家喺最優 × 1.5 步內過關嘅比例（目標 L4+ 全部 < 10%）、亂撳 ≤ 2★ 門檻率、貪心率、死局率；`--trials N` / `--only 4,5` / `--json`。模擬喺 `src/core/analysis.js` |
| `python tools/build-bg.py`、`build-assets.py`、`build-customers.py`、`extract-cup.py`、`build-icon.py` | 珍奶 / 夜市時期嘅腳本，已廢棄（build-bg 直接退出；其餘只留歷史參考） |
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
    palette.js           由 config/theme.js 派生嘅 10 色液體色板 + 互斥 / 圖案規則（純色最多 6 色同關）
    levels.js            Campaign 1–40 關 LevelConfig 表（含每關色組 palette / patterns）、練習模式 config
    layout.js            Spec v2 §4 瓶子排列（seed = levelId、抖動、分離、z-order）+ R2 驗證 + fallback
    difficulty.js        步數上限 / 隱藏密度 / 機制登場表
  src/config/
    theme.js             COLORS（黃銅 / 深木 / 燭光）、LIQUID_COLORS A–J（唔准改 hex）、互斥對、圖案
    layout.js            LAYOUT（v4 §3.3 垂直比例 10 / 14 / 62 / 14%、樽高 19%、抖動）、CAT（貓 transient）、CLOTH 布遮尺寸
    render.js            RENDER（multiply、配料 UV / wrap / inset、揭開時長、發光三件套）、AD_SLOTS、CLIENT_ORDER
    assets.js            ASSET_MAP（邏輯名 → assets/v2 路徑）、VESSEL_SPRITE、CLIENT_SPRITE
  src/client/
    local-server.js      §5 權威協定嘅瀏覽器內模擬：session、reveal、hint、complete、rhythmRisk
    solver.worker.js     Web Worker：提示求解、練習關生成（唔阻塞 UI）
    background.js        BackgroundManager：單張背景 + 可讀性遮罩（階段 / 視差 / 氛圍已取消，接口保留做 no-op）
    game.js              Canvas 渲染瓶陣（器皿 sprite + 內壁多邊形 multiply 液體、磨砂 / 布遮 / 裂瓶、配料、發光）、觸控、倒液 / 交貨 / 揭開動畫
    render-assets.js     v2 素材預載、vessels.json 幾何、內壁多邊形 / 逐行闊度工具
    main.js              畫面流程、委託人排、進度（localStorage）、貓 transient 彈出、廣告樽 / 委託槽 / +樽 三個廣告觸點、交貨飛槽 / 封存觸發
    audio.js             WebAudio 合成音效
  levels/campaign.json   預生成 40 關（board 編碼 + 最優步數 + 三星門檻）
  assets/v2/             Spec v2 美術（單張背景、器皿、布 / 蠟封、角色、UI、配料 tile、LIQ_base）+ vessels.json + asset-check.json
  tools/gen.js           離線批次生成關卡
  tools/build-assets-v2.py  由 assets-raw/v2 出全部美術 + 器皿幾何
  tests/                 測試套件
```

### 畫面層序（Spec v2 §3.2）

背景 `BG_lab_full`（單張，object-position center 40%）→ 可讀性遮罩（`COLORS.bgTop` @ 0.28，只落喺瓶陣安全帶）→ 瓶底陰影 → 整瓶背後柔光 → 器皿 sprite → 液體（multiply）+ 配料 → 磨砂 / 布遮 → 蠟封（tint）→ 黃銅框 → UI。
五階段 / 視差 / 氛圍粒子已取消；`STAGES` 只剩一個階段，`stageTransitionAfter()` 永遠 `null`。

### 資訊分割（引擎規格）

`LocalServer` 入面嘅 session 持有真實盤面（含磨砂 / 布遮瓶隱藏格）；`main.js` 只攞到 `mask()` 之後嘅視圖，**每一步都經 `server.reveal`**（client 唔再本地 applyMove：倒入磨砂瓶時隱藏格可能同色、布遮解鎖後隱藏格要由 server 補返）。
磨砂杯倒出時 client 唔知真實倒出量（頂層下面可能同色），所以會先 `reveal()` 再播動畫。
過關時 server 由 `trueBoard` 重放全部走步驗證（`ILLEGAL_MOVE` / `NOT_SOLVED` / `TOO_FAST` / `MOVE_FLOOD`），
唔信 client 傳嘅任何盤面狀態。換成真 server 只需將 `LocalServer` 嘅方法改成 `fetch('/v1/level/...')`。

### 同規格唔同 / 要注意嘅地方

1. **外帶杯（cap 3）三格同色唔算「完成」**。規格嘅 `canPour` 會凍結任何純色滿杯，套用喺外帶杯上會令佢永遠郁唔到而成為死局。
2. **啟發函數收緊**：`h = Σ_color (段數 − 有冇底段)`，仍可採納（BFS 驗證 3000 局），令難關由幾分鐘變幾毫秒解到。
3. **色板**：引擎規格嘅 L\* 階梯 / 色盲檢查已由色相 + 明度互斥規則取代（`config/theme.js`）。
4. **背景安全帶**：引擎 / 背景規格要求淺色牆面；而家係深色實驗室（L\* ≈ 6），灰階對比測試（|L_cup − L_bg| ≥ 25）由高明度液體同深底之間嘅差距過關。
   測試入面杯身模型 = 70% 飲品（10 色由 hex 計嘅平均 L\*）+ 30% 半透明杯身。
5. 中景 / 氛圍層已隨 Spec v2 單張背景取消。

## 主題歷史

珍奶茶記（引擎規格 + 工單 #1–#5）→ 夜市奶茶 brief（高飽和 10 色 + 互斥規則、深底發光）→ **Spec v2 煉金實驗室**（現行）。
每次轉主題都係整套換：色板 hex 由 `config/theme.js` 一個地方管；互斥規則（色相距 < 40° 且明度差 < 25%；F × H 只准 ≤ 4 色）同 6 色上限由夜市 brief 起沿用至今；夜市 brief 嘅「隱藏層 ?」機制已刪（改用磨砂瓶）。

## 開場流程（開場規格）

```
撳 icon → Boot（讀 flag / ?host=app，即刻並行下載批次 2）
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
| 邏輯名 → 路徑 | `src/config/assets.js` 嘅 `ASSET_MAP`（`VES_flask_empty`、`CHR_cat_idle`、`UI_ad_crest` …）。client 全部經 `ASSET_MAP` 取路徑，**唔准再引用舊 `assets/*.webp`**（`cup-*`、`customer-*`、`mocha-*`、`bg/`、`bg-04.jpg` 已廢棄；只有 `company-logo` 仍然用喺開場畫面；舊 `meowcha-wordmark` 已由文字字標取代，等新 wordmark 圖） |
| 主題常數 | `src/config/theme.js`（`COLORS` 黃銅 / 深木 / 燭光、`LIQUID_COLORS` A–J 唔准改 hex）、`src/config/layout.js`（`LAYOUT` 抖動版面、`CLOTH`）、`src/config/render.js`（`RENDER` multiply / 配料 UV / 揭開時長、`AD_SLOTS`、`CLIENT_ORDER`） |

### 用戶決定（覆蓋 Spec v2 嘅地方）

1. **遮蓋**：`none` 全部可見；`hidden` `?` 隱藏層樽只見頂格，倒走一格露一格（逐格 160 ms 淡入）；`cloth` 布遮瓶（kind `covered`）全部隱藏、蠟封顯示頂層色、**鎖死**，每交 2 單解開一隻（server event `{type:'unlock', cup}` → 繩鬆 60 ms → 布滑上 160 ms → 塵粒 400 ms → 顏色同圖案一齊淡入 160 ms）。Spec 嘅「清空先揭開」同「盲磨砂」作廢。
2. **器皿**：燒瓶 = normal（4 格）、曲頸瓶 = takeaway（3 格，永遠裝唔滿一色）、裂瓶 = cracked（只出不入，第 15 關起）、布遮瓶 = covered（布蓋喺燒瓶上）。冇獨立「封膜杯」。
3. **文案**：客人→委託人、出單→交貨、訂單→委託、杯→瓶；飲品變試劑（硫黃 / 琥珀 / 薔薇 / 硃砂 / 龍膽 / 紫晶 / 淡藍 / 群青 / 銅綠 / 蛋白石）；吉祥物係「導師」（煉金貓 idle / happy / cheer）。遊戲名 2026-09-05 起改為 **Mortar & Mew**（存檔 key `meowcha.*` 唔改，保住進度）。
4. **廣告**：三個觸點，視覺一律 `UI_ad_crest`：
   - **廣告樽**（實作指令 v4 §4，kind `ad`）：由 **L2** 起關卡資料本身就有（L2 有 2 隻），一開波就鎖喺盤面，唔入唔出；撳一下 → 廣告 → `LocalServer.unlockAdCup` 記 `adUnlocks` 同步重放 → 變 normal 空樽（`GameView.animateAdUnlock`）。**廣告政策：冇強制廣告，想睇先睇；冇「頭幾關零廣告」呢條**（2026-09-05 拍板，跟 v4）— `adsAllowedForLevel` 只擋練習關同 L1，兩個「入口」各自跟 `UNLOCK_LEVEL.adOrderSlot` / `adEmptyCup`；每關唔解鎖廣告樽都必須可解（`verify-levels` 驗）。
   - 委託人區 `unlockOrder`（第 11 關起；紋章只出喺下一個可解鎖嘅委託人 raven → badger → owl → hare，其餘灰態）。
   - 道具列 `addEmptyBottle`「+樽」（第 11 關起、盤面冇 kind normal 空樽、**而且冇廣告樽剩低**先出，每關一次，`LocalServer.addEmptyCup` 記 `extraCups` 同步重放）。
   同屏 ≤ 2 個入口（`assertAdSlotLimit` 啟動即驗）；「+樽」等廣告樽撳晒先出，係為咗唔會同時有 3 個廣告觸點。
5. **背景**：單張 `BG_lab_full`，冇視差 / 階段過渡 / 氛圍粒子（`BackgroundManager` 保留做 no-op 接口）。
6. **液體**：喺器皿 sprite 入面用 `multiply` 畫，clip 到 `vessels.json` 嘅玻璃內壁多邊形；配料由 `PAT_tile_large / small` 四象限取樣（P3 橫向 repeat），墨色 = 該層色 −28% 明度。
7. **版面**（實作指令 v4 §3）：CSS grid 三行 **25% 頂區（HUD 5.5% + 委託人 15% + 訂單槽 4.5%）· 68% 盤面 · 7% 道具列（撤銷 / 提示 / +樽 / 重來）**（用戶 2026-09-06：委託人區含 20px 頭頂空隙，唔貼 HUD；角色圖尺寸由 `sizeClients()` 量 px，准闊到 118% 槽闊）；貓助手唔再佔行，只喺交貨（`CAT.showDurationMs` 1.2 s）同教學句（≈2.5 s）由盤面右下滑入再淡出（`#cat-pop`，pointer-events none）。`src/core/layout.js safeLayout()` 以關卡號做種子（練習關用 seed hash），R2 永不遮液體；`?jitter=0` 強制純網格除錯。
8. **單一樽型 + 訂單隊列**（v4 §2 / §5 / §7）：全部樽 `VES_bottle_std` 深色、capacity 4（retort / cracked 已唔再生成；磨砂 kind 2026-09-05 已刪走，唔留相容）。`hidden` = `?` 隱藏層樽（頂層可見，下面畫 `?`，倒走頂層 160 ms 逐格揭露，L2 起；第一次見會彈教學句 `extra.tutor.hidden`）。交貨 = 樽加塞 → `animateFlyToSlot` 飛向該委託人托盤（✓ 等飛到先出）→ kind `gone` 釋放位置；完成樽冇委託 = `animateSeal` 加塞去飽和留喺盤面（main.js `newlySealed` 比對前後盤面觸發），之後同色委託出現會由 server 自動交貨。

## 關卡節奏（2026-09-05）

- 道具列：+樽 / 重來 / 設定。2026-09-06 用戶拎走「提示」「撤銷」同貓嘅所有提示對白，設定由頂欄搬落道具列，頂欄「尚有 N 單」亦拎走（頂欄右邊留空 div 做平衡）。`LocalServer.hint` API、i18n 對白字串保留但冇 UI 叫；貓亦唔再喺交貨時彈出（`CAT.showOnDeliver` false，機制保留），只留喺標題畫面同過關 modal；過關彩帶（`animateWin`）同日拎走。
- L1 教學（純倒、2 隻空瓶）；L2 起 `?` 隱藏層樽 + 廣告樽（L2 有 2 隻）；L1 就有 1 個委託槽、L3 第二個；L4 起只有 1 隻空瓶；L11 道具列「+樽」+ 廣告委託槽；L12 步數上限；L19 布遮瓶；L21 起廣告委託槽 2 個（免費 2 + 廣告 2 = 4 位委託人全開，到底）。第三免費委託槽（原 L36）已取消。曲頸瓶 / 裂瓶已喺 v4 移除。
- **真樽 = 色數 + 2 隻空樽**（`levels.js cupsFor` / `EMPTY_BOTTLES`）。2026-09-06 實測：空位 3 樽以上，貪心玩家亂行 10 步之後盤面無解率係 **0%** —— 即係字面意義上輸唔到，玩家講「唔使用腦」就係呢個原因；空位收到 2 樽先有 4–52%。
- 目標指標由「亂撳★2 率」換成 **致命錯步率**（貪心玩家行 10 步後盤面已經無解嘅比例）：L4–L10 ≥ 3%、L11+ ≥ 5%，generator 逐個候選盤兩段驗（80 局粗篩 + 250 局確認，門檻 ×1.3 留 margin），`npm run scan` 覆核。舊嘅亂撳★2 率仍然報，但唔再做通過條件 —— 要壓低佢就要加好多空樽，而嗰樣正正令關卡輸唔到。
- 盤面冇得解**唔會**自動彈窗（用戶 2026-09-06）：玩家應該自己識開廣告樽 / 開委託槽救返，真係一步都行唔到（`isDead`）先彈 `showStuck`。`LocalServer.solvable` 保留做工具 / 測試用，UI 唔叫。
- 色組 L1–12 照夜市 brief A4 分配表（每 3 關換組）；13 關後 6 色封頂，難度靠樽數、每色段數 3.0→3.9、隱藏密度推。
- 改遮蓋規則 / 樽數後要重生成（`npm run gen`）再 `npm run verify` + `npm run scan`。

## 玩法

- 㩒瓶揀起，再㩒另一隻瓶倒過去；只可倒落空瓶或頂層同色。廣告樽撳一下睇廣告就變空樽（唔解鎖都過到關）。
- 委託人：每位委託人托盤顯示想要邊種試劑。裝滿一瓶即交貨：加塞、飛上托盤、盤面騰位。冇人要嘅純色滿樽會封存留喺盤面。每交 2 單揭開一隻布遮瓶。
- 三星 = 最優 + 3（每隻磨砂 / 布遮瓶再 +2）；兩星 = 三星 + 5。頂欄三粒星會跟住步數變。
- 鍵盤：`1–9` 揀瓶、`U`/`Z` 撤銷、`H` 提示、`R` 重來、`Esc` 取消選擇。
