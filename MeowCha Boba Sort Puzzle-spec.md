# 喵喵茶記 Boba Cat — 引擎技術規格

Move Validator · 關卡生成器 · IDA\* Solver · Server 權威驗證 · 防 Bot

版本 1.0 · TypeScript · Phaser 3 + Node

---

## 0. 架構原則

### 一份邏輯，兩處運行

```
packages/
  core/                  ← 純 TypeScript，零 Phaser、零 Node 依賴
    board.ts               狀態表示、編碼
    rules.ts               合法性判定、走步套用
    orders.ts              訂單、封膜、外帶邏輯
    solver.ts              IDA* 求解
    generator.ts           關卡生成
    prng.ts                確定性亂數
  client/                ← Phaser 3，只負責渲染同輸入
  server/                ← Node，只負責權威驗證同發獎
  tools/                 ← 離線批次生成關卡
```

**`core/` 唔可以 import 任何 Phaser 或 Node 專屬 API。** 呢個係整套防作弊嘅地基：server 用同一份 `rules.ts` 重放玩家嘅走步，client 唔可能造出 server 唔認嘅狀態。

### 資訊分割

| | Client 知道 | Server 知道 |
|---|---|---|
| 可見層顏色 | ✓ | ✓ |
| 磨砂杯隱藏層 | ✗ | ✓ |
| 完整解 | ✗ | ✓ |
| seed | 只有 publicSeed | publicSeed + hiddenSalt |

Client 永遠攞唔到隱藏層——呢個係 `?` 機制唯一嘅正確實作方式。

---

## 1. 狀態表示

```ts
// core/board.ts

export type ColorId = number;              // 0..14，15 保留作 EMPTY
export const EMPTY: ColorId = 15;

export type CupKind = 'normal' | 'frosted' | 'sealed' | 'takeaway';

export interface Cup {
  kind: CupKind;
  cap: number;              // normal/frosted/sealed = 4, takeaway = 3
  seg: ColorId[];           // 底 → 頂，長度 0..cap
  locked: boolean;          // sealed 專用，解封後轉 false
}

export interface OrderSlot {
  color: ColorId;
  filled: boolean;
}

export interface Board {
  cups: Cup[];
  colors: number;           // 本關色數
  orders: OrderSlot[];      // 0..3 個
  delivered: number;        // 已交付訂單數，用於封膜解鎖
  moveCount: number;
}
```

### 遮罩視圖（送去 client 嘅嘢）

```ts
export interface MaskedCup {
  kind: CupKind;
  cap: number;
  seg: (ColorId | null)[];  // null = 隱藏，client 渲染成 ?
  locked: boolean;
}
```

**遮罩規則**：`frosted` 杯只有最頂一格可見，其餘為 `null`。倒走頂格之後，server 於 reveal 回應中補返新嘅頂格顏色。

```ts
export function mask(board: Board): MaskedCup[] {
  return board.cups.map(c => {
    if (c.kind !== 'frosted') return { ...c, seg: [...c.seg] };
    return {
      ...c,
      seg: c.seg.map((v, i) => (i === c.seg.length - 1 ? v : null)),
    };
  });
}
```

### 緊湊編碼（傳輸 / 儲存用）

```ts
// 每格 4 bit。一隻杯 = 1 byte 標頭 + ceil(cap/2) byte
// 12 隻杯典型佔用 36 bytes，base64url 後 48 字元
export function encodeBoard(b: Board): string;
export function decodeBoard(s: string): Board;

// 走步：from 4 bit + to 4 bit = 1 byte
// 40 步 = 40 bytes
export function encodeMoves(m: Move[]): string;
```

---

## 2. 規則層 — Move Validator

```ts
// core/rules.ts

export interface Move { from: number; to: number; }

export function topColor(cup: Cup): ColorId {
  return cup.seg.length ? cup.seg[cup.seg.length - 1] : EMPTY;
}

/** 頂部連續同色格數 */
export function topRun(cup: Cup): number {
  if (!cup.seg.length) return 0;
  const c = topColor(cup);
  let n = 0;
  for (let i = cup.seg.length - 1; i >= 0 && cup.seg[i] === c; i--) n++;
  return n;
}

export function isUniform(cup: Cup): boolean {
  return cup.seg.length > 0 && topRun(cup) === cup.seg.length;
}

export function canPour(b: Board, from: number, to: number): boolean {
  if (from === to) return false;
  if (from < 0 || to < 0 || from >= b.cups.length || to >= b.cups.length) return false;

  const F = b.cups[from], T = b.cups[to];

  if (F.locked || T.locked) return false;          // 封膜杯
  if (F.seg.length === 0) return false;            // 空杯冇嘢倒
  if (T.seg.length >= T.cap) return false;         // 目標滿

  // 已完成嘅純色滿杯唔准再動（防無意義操作，同時縮 solver 搜索空間）
  if (isUniform(F) && F.seg.length === F.cap) return false;

  if (T.seg.length === 0) return true;             // 倒入空杯永遠合法
  return topColor(T) === topColor(F);
}

export function pourAmount(b: Board, from: number, to: number): number {
  const F = b.cups[from], T = b.cups[to];
  return Math.min(topRun(F), T.cap - T.seg.length);
}
```

### 套用走步（含訂單結算）

```ts
export function applyMove(b: Board, m: Move): Board {
  if (!canPour(b, m.from, m.to)) throw new IllegalMoveError(m);

  const next = cloneBoard(b);
  const n = pourAmount(b, m.from, m.to);
  const color = topColor(next.cups[m.from]);

  next.cups[m.from].seg.splice(-n, n);
  for (let i = 0; i < n; i++) next.cups[m.to].seg.push(color);

  // frosted 杯倒空之後降級為 normal（冇嘢再需要隱藏）
  if (next.cups[m.from].kind === 'frosted' && next.cups[m.from].seg.length === 0) {
    next.cups[m.from].kind = 'normal';
  }

  next.moveCount++;
  settleOrders(next);
  return next;
}

/** 交付：純色滿杯 + 顏色被點單 → 清空該杯，訂單推進 */
function settleOrders(b: Board): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const cup of b.cups) {
      if (!isUniform(cup) || cup.seg.length !== cup.cap) continue;
      const slot = b.orders.find(o => !o.filled && o.color === cup.seg[0]);
      if (!slot) continue;

      slot.filled = true;
      cup.seg = [];                 // 交付後變返空杯 —— 玩家賺返嘅空間
      b.delivered++;
      changed = true;

      if (b.delivered % 2 === 0) unlockSealed(b);   // 每交付 2 單解封一隻
    }
  }
}

function unlockSealed(b: Board): void {
  const c = b.cups.find(x => x.kind === 'sealed' && x.locked);
  if (c) { c.locked = false; c.kind = 'normal'; }
}
```

**注意 `settleOrders` 用 while 迴圈**：一次倒液有可能同時令兩隻杯達成純色滿杯，兩單都要結算；而解封封膜杯之後亦可能觸發連鎖。

### 勝負判定

```ts
export function isSolved(b: Board): boolean {
  if (b.orders.some(o => !o.filled)) return false;
  return b.cups.every(c =>
    c.seg.length === 0 || (isUniform(c) && c.seg.length === c.cap)
  );
}

export function isDead(b: Board): boolean {
  return legalMoves(b).length === 0 && !isSolved(b);
}

export function legalMoves(b: Board): Move[] {
  const out: Move[] = [];
  for (let i = 0; i < b.cups.length; i++)
    for (let j = 0; j < b.cups.length; j++)
      if (canPour(b, i, j)) out.push({ from: i, to: j });
  return out;
}
```

**外帶杯（cap = 3）永遠裝唔滿一色**，所以 `isSolved` 要求佢最終為空。呢個令佢成為純工作空間，係設計意圖，唔係 bug。

---

## 3. IDA\* Solver

### 啟發函數（可採納）

```ts
/** 段數 − 色數。每步最多令總段數減 1，故此為下界 */
export function heuristic(b: Board): number {
  let segs = 0;
  for (const c of b.cups) {
    for (let i = 0; i < c.seg.length; i++)
      if (i === 0 || c.seg[i] !== c.seg[i - 1]) segs++;
  }
  return Math.max(0, segs - b.colors);
}
```

**可採納性證明（一句）**：倒入空杯令總段數不變；倒到同色頂上令總段數減 1；部分倒出時來源仍保留該色段，總段數不增反減至多 1。目標態總段數 = 色數。故 `segs − colors` 永不高估。

### 正規化（去重，關鍵優化）

```ts
/** 空杯之間、內容相同嘅杯之間可互換，正規化後搜索空間縮 10–100 倍 */
export function canonical(b: Board): string {
  const keys = b.cups.map(c =>
    `${c.kind === 'sealed' && c.locked ? 'L' : 'N'}${c.cap}:${c.seg.join(',')}`
  );
  keys.sort();
  return keys.join('|') + '#' + b.orders.map(o => (o.filled ? 1 : 0)).join('');
}
```

### 主體

```ts
// core/solver.ts
const FOUND = -1, INF = Number.MAX_SAFE_INTEGER;

export function solve(start: Board, maxDepth = 40): Move[] | null {
  let bound = heuristic(start);
  const path: Move[] = [];
  const onPath = new Set<string>([canonical(start)]);

  while (bound <= maxDepth) {
    const t = search(start, 0, bound, path, onPath);
    if (t === FOUND) return [...path];
    if (t === INF) return null;
    bound = t;
  }
  return null;
}

function search(b: Board, g: number, bound: number, path: Move[], onPath: Set<string>): number {
  const f = g + heuristic(b);
  if (f > bound) return f;
  if (isSolved(b)) return FOUND;

  let min = INF;
  for (const m of orderedMoves(b, path)) {
    const nb = applyMove(b, m);
    const key = canonical(nb);
    if (onPath.has(key)) continue;

    onPath.add(key); path.push(m);
    const t = search(nb, g + 1, bound, path, onPath);
    if (t === FOUND) return FOUND;
    if (t < min) min = t;
    path.pop(); onPath.delete(key);
  }
  return min;
}
```

### 走步排序與剪枝（速度關鍵）

```ts
function orderedMoves(b: Board, path: Move[]): Move[] {
  const last = path[path.length - 1];
  return legalMoves(b)
    .filter(m => {
      // 剪枝 1：唔准即刻撤銷上一步
      if (last && m.from === last.to && m.to === last.from) return false;
      // 剪枝 2：純色未滿杯 → 空杯，純粹搬位，永不最優
      const F = b.cups[m.from], T = b.cups[m.to];
      if (isUniform(F) && T.seg.length === 0) return false;
      // 剪枝 3：多個等價空杯只保留第一個
      if (T.seg.length === 0) {
        const firstEmpty = b.cups.findIndex(c => c.seg.length === 0 && c.cap === T.cap && !c.locked);
        if (firstEmpty !== m.to) return false;
      }
      return true;
    })
    .sort((a, bm) => score(b, bm) - score(b, a));
}

function score(b: Board, m: Move): number {
  const F = b.cups[m.from], T = b.cups[m.to];
  let s = 0;
  const n = pourAmount(b, m.from, m.to);
  if (T.seg.length + n === T.cap && (T.seg.length === 0 || topColor(T) === topColor(F))) s += 100; // 完成一杯
  if (topRun(F) === F.seg.length) s += 30;      // 倒空來源
  if (T.seg.length > 0) s += 20;                // 合併優於佔用空杯
  if (b.orders.some(o => !o.filled && o.color === topColor(F))) s += 40; // 推進訂單
  return s;
}
```

**實測預期**：11 杯 / 9 色 / 24 段嘅關卡，正規化 + 剪枝後 IDA\* 於 Node 上約 5–60 ms 求解。離線批次生成 5 萬關約需 1–2 CPU 小時。

### 隱藏層嘅處理

Solver **永遠喺完整資訊上運行**（server 知道真值）。但玩家係喺不完全資訊下玩。因此：

| 用途 | 做法 |
|---|---|
| 可解性驗證 | 用完整盤面 solve，必須有解 |
| 最優步數 | 完整盤面 solve 結果 |
| **三星步數** | 無 `?` 關卡：最優 + 3。**有 `?` 關卡：最優 + 3 + (`?` 杯數 × 2)** |
| 提示道具 | 用當前真實盤面即時 solve，回傳第一步 |

有隱藏資訊嘅關卡，玩家必然要花額外步數探索。三星門檻唔加補償就係懲罰運氣，會直接引爆「呢個遊戲屈我」嘅負評——呢個係品類最大嘅信任裂縫。

---

## 4. 關卡生成器

### 為何用「隨機生成 + 驗證」而唔用「逆向生成」

逆向生成（由已解狀態倒推）保證可解，但**控制唔到段數**，而段數係我哋難度曲線嘅主旋鈕。所以採用：隨機分配 → 段數命中 → IDA\* 驗證 → 質量檢查。拒收率高（約 85–92%）但因為係離線批次，無所謂。

### 確定性 PRNG

```ts
// core/prng.ts
export function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

### Seed 格式

```
v1:<kind>:<levelId>:<configHash>:<seedHex>

kind        c = campaign（全球同一盤面，可比排名）
            t = tournament（賽事，同場次同盤面）
            p = practice（每人不同）
levelId     關卡編號或賽事場次號
configHash  LevelConfig 之 SHA-256 前 8 位，config 一改即失效
seedHex     8 位 hex

campaign     seed = sha256(SERVER_SALT + 'c' + levelId).slice(0,8)
tournament   seed = sha256(SERVER_SALT + 't' + tid + ':' + round).slice(0,8)
```

**`SERVER_SALT` 永不下發到 client。** Client 只收 `publicSeed`（用於重播動畫同記錄），真實盤面由 server 生成後遮罩下發。

### 生成流程

```ts
export interface LevelConfig {
  cups: number; colors: number; empties: number;
  segments: number;              // 目標總段數 ±1
  frosted: number; sealed: number; takeaway: number;
  orders: number;
  optimalMin: number; optimalMax: number;
}

export function generateLevel(cfg: LevelConfig, seed: number): Board | null {
  const rng = mulberry32(seed);

  for (let attempt = 0; attempt < 400; attempt++) {
    const b = randomFill(cfg, rng);

    // 檢查 1：段數命中
    const segs = countSegments(b);
    if (Math.abs(segs - cfg.segments) > 1) continue;

    // 檢查 2：可解，且步數落喺目標區間
    const sol = solve(b, cfg.optimalMax + 2);
    if (!sol) continue;
    if (sol.length < cfg.optimalMin || sol.length > cfg.optimalMax) continue;

    // 檢查 3：最優解不唯一（≥2 條），否則玩家感覺係試錯唔係解謎
    if (countOptimalPaths(b, sol.length, 2) < 2) continue;

    // 檢查 4：起手安全區 —— 前 K 步唔可以有必敗分支
    const K = cfg.cups <= 8 ? 3 : 2;
    if (!safeOpening(b, K, sol.length + 4)) continue;

    // 檢查 5：色盲安全
    if (!colorSafe(b)) continue;

    // 檢查 6：訂單可達性
    if (!ordersReachable(b)) continue;

    // 檢查 7：磨砂杯內容有意義
    if (!frostedMeaningful(b)) continue;

    return b;
  }
  return null;   // 呢個 config 太緊，需放寬
}
```

### 各項質量檢查

```ts
/** 檢查 4：由起始狀態出發，任何深度 ≤ K 嘅走法都唔可以進入死局 */
function safeOpening(b: Board, K: number, depthCap: number): boolean {
  const dfs = (s: Board, d: number): boolean => {
    if (isDead(s)) return false;
    if (d === 0) return solve(s, depthCap) !== null;
    for (const m of legalMoves(s)) if (!dfs(applyMove(s, m), d - 1)) return false;
    return true;
  };
  return dfs(b, K);
}

/** 檢查 5：同關任兩色 L* 差 ≥ 8，且避開高危組合 */
const FORBIDDEN_PAIRS = [[1, 4], [10, 0], [6, 12]];  // 抹茶×烏龍、薄荷×椰奶、紅豆×葡萄
function colorSafe(b: Board): boolean {
  const used = [...new Set(b.cups.flatMap(c => c.seg))];
  for (const [x, y] of FORBIDDEN_PAIRS)
    if (used.includes(x) && used.includes(y)) return false;
  for (let i = 0; i < used.length; i++)
    for (let j = i + 1; j < used.length; j++)
      if (Math.abs(LSTAR[used[i]] - LSTAR[used[j]]) < 8) return false;
  return true;
}

/** 檢查 6：被點單嘅顏色必須有部分喺初始就可見，唔可以完全藏喺 ? 入面 */
function ordersReachable(b: Board): boolean {
  const visible = new Set<ColorId>();
  for (const c of b.cups) {
    if (c.kind === 'frosted') { if (c.seg.length) visible.add(topColor(c)); }
    else c.seg.forEach(v => visible.add(v));
  }
  return b.orders.every(o => visible.has(o.color));
}

/** 檢查 7：磨砂杯唔可以有 3 格以上連續同色（揭示變成無意義） */
function frostedMeaningful(b: Board): boolean {
  return b.cups.filter(c => c.kind === 'frosted').every(c => {
    let run = 1;
    for (let i = 1; i < c.seg.length; i++) {
      run = c.seg[i] === c.seg[i - 1] ? run + 1 : 1;
      if (run >= 3) return false;
    }
    return true;
  });
}
```

### 離線批次工具

```bash
# tools/gen.ts
node tools/gen.js --config levels/campaign.json --out levels/campaign.db
node tools/gen.js --pool --difficulty 1..12 --count 50000 --out levels/tournament.db
```

- **Campaign 1–40 關**：用第 40 節嘅關卡表逐關生成，每關存 board + 最優步數 + 三星門檻
- **賽事池**：預生成 5 萬關，按 `segments − colors` 分 12 個難度桶
- 生成失敗嘅 config 要 log 出嚟人手放寬，唔可以靜靜跳過

---

## 5. Server 權威協定

### 端點

```
POST /v1/level/start
  req  { levelId | tournamentId, clientVersion }
  res  { sessionId, maskedBoard, orders, publicSeed, optimalMoves, starThresholds }
       // 唔回傳隱藏層、唔回傳解

POST /v1/level/reveal
  req  { sessionId, move: {from, to}, clientTs }
  res  { ok, revealed: [{cupIdx, seg: ColorId[]}], settled: {...} }
       // 只喺該步令磨砂杯露出新一格時先需要呼叫

POST /v1/level/complete
  req  { sessionId, moves: base64, clientElapsedMs, moveTimestamps: number[] }
  res  { verified, stars, coinsAwarded, tournamentScore }
```

### Session 狀態（Redis）

```ts
interface Session {
  id: string;              // 隨機 128-bit，不含任何可推導資訊
  userId: string;
  levelId: string;
  trueBoard: string;       // 完整編碼盤面（含隱藏層）
  optimalMoves: number;
  startedAt: number;       // server 時鐘
  revealCalls: number;
  fingerprint: string;
  ip: string;
  ttl: 30 * 60;
}
```

### 完成驗證（核心）

```ts
async function completeLevel(req) {
  const s = await redis.get(`sess:${req.sessionId}`);
  if (!s) return reject('SESSION_NOT_FOUND');
  if (s.userId !== req.auth.userId) return reject('SESSION_MISMATCH');

  // 1. 由 server 存嘅真實盤面重放全部走步
  let b = decodeBoard(s.trueBoard);
  const moves = decodeMoves(req.moves);
  if (moves.length > s.optimalMoves + 60) return reject('MOVE_FLOOD');

  for (const m of moves) {
    if (!canPour(b, m.from, m.to)) return reject('ILLEGAL_MOVE');
    b = applyMove(b, m);
  }
  if (!isSolved(b)) return reject('NOT_SOLVED');

  // 2. 時間下界
  const elapsed = Date.now() - s.startedAt;
  if (elapsed < moves.length * MIN_MS_PER_MOVE) return reject('TOO_FAST');

  // 3. 節奏分析
  const risk = rhythmRisk(req.moveTimestamps);

  // 4. 發獎（賽事分數需通過風險檢查）
  const stars = computeStars(moves.length, s.optimalMoves, b);
  return grant(s, stars, risk);
}

const MIN_MS_PER_MOVE = 180;   // 含倒液動畫最短時長
```

**關鍵**：server 唔信 client 傳嘅任何盤面狀態，只信 `sessionId` 對應嘅 `trueBoard` 加上走步序列。Client 傳過嚟嘅只係「我點咗邊兩隻杯」。

### 節奏風險評分

```ts
function rhythmRisk(ts: number[]): number {
  if (ts.length < 8) return 0;
  const gaps = ts.slice(1).map((t, i) => t - ts[i]);
  const mean = gaps.reduce((a, b) => a + b) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
  const cv = sd / mean;

  let risk = 0;
  if (cv < 0.15) risk += 50;                      // 機械式等間隔
  if (cv < 0.08) risk += 30;
  if (mean < 250) risk += 25;                     // 快過人手極限
  if (new Set(gaps.map(g => Math.round(g / 10))).size < gaps.length * 0.3) risk += 20;
  if (ts[0] < 400) risk += 15;                    // 開局零思考時間

  return Math.min(100, risk);
}
```

**人類玩家嘅 CV 通常 > 0.35**（會停頓思考、會猶豫）。Bot 用固定 delay 嘅 CV 接近 0；就算加隨機抖動，要模擬「難步之前長停頓」嘅相關結構好難。

**唔好即時封號。** 風險分累積喺帳號上，只喺提取 token 時作為門檻。即時封號會俾 bot 作者快速迭代出繞過方法。

### 分層信任

| 動作 | 驗證強度 |
|---|---|
| Campaign 過關拿金幣 | 輕：只驗合法性，唔計節奏 |
| 賽事提交分數 | 全：重放 + 時間 + 節奏 + 指紋 |
| Token 提取 | 全 + 帳號歷史風險分 + Turnstile + KYC |

Campaign 唔值錢，唔好為咗防 bot 令普通玩家慢。

---

## 6. Web 防 Bot（冇裝置驗證嘅補償）

Native app 有 Play Integrity 同 App Attest；**web 冇對等物**。補償堆疊：

| 層 | 工具 | 擋到咩 |
|---|---|---|
| 入場 | Cloudflare Turnstile | 大規模無頭瀏覽器 |
| 指紋 | FingerprintJS Pro 或自建 canvas + audio + WebGL 指紋 | 同機多開 |
| 網絡 | IPQS / IP2Proxy 標記 VPN、資料中心 IP | 代理農場 |
| **邏輯** | **server 重放驗證** | **一切偽造盤面** |
| 節奏 | rhythmRisk | 腳本化操作 |
| 速率 | 每指紋 / 每 /24 網段 / 每帳號日上限 | 量產 |
| 結算 | off-chain 記帳，週結批次上鏈 | 保留追回權 |

**最強嗰層係邏輯層。** Sort puzzle 有一個 bot 難以繞過嘅特性：**要攞獎勵就必須真係解得開題**。一個 bot 要跑 solver、要模擬人類節奏、要過指紋——單位成本會高過每次幾厘美元嘅廣告收益。呢個係你相對「點擊賺錢」類產品嘅結構優勢，要保住。

**唔可以做嘅事**：唔好喺 client 做任何「反作弊檢查」然後信佢嘅結果。所有判斷喺 server。Client 端嘅檢查只可以用嚟改善 UX（例如即時提示非法走步）。

---

## 7. Phaser 客戶端接口

```ts
// client/GameScene.ts —— Phaser 只做渲染同輸入
import { canPour, pourAmount, applyMove, isSolved } from '@boba/core/rules';

class GameScene extends Phaser.Scene {
  private board: MaskedBoard;       // 遮罩視圖
  private pending: Move[] = [];     // 未上報嘅走步

  async onCupTap(idx: number) {
    if (this.selected === null) { this.select(idx); return; }
    const m = { from: this.selected, to: idx };

    // 樂觀執行：用同一份 core 邏輯本地推進，動畫即刻出
    if (!canPour(this.board, m.from, m.to)) { this.shake(idx); return; }
    const n = pourAmount(this.board, m.from, m.to);
    await this.playPour(m, n);                      // 約 400 ms

    this.board = applyMove(this.board, m);
    this.pending.push(m);

    // 若該步令磨砂杯露出新一格 → 呼叫 server 取真值
    // 網絡往返被倒液動畫遮蓋，玩家感覺唔到延遲
    if (this.needsReveal(m)) {
      const r = await api.reveal(this.sessionId, m);
      this.applyReveal(r);
    }

    if (isSolved(this.board)) await this.submitComplete();
  }
}
```

**倒液動畫時長就係你嘅網絡預算。** 400 ms 足夠覆蓋東南亞到新加坡節點嘅往返；若 reveal 超時，退回顯示 loading 而唔係本地猜色。

### 倒液動畫參數（同上一份文件對齊）

| 元件 | 參數 |
|---|---|
| 來源杯傾斜 | rotate −35°，`Cubic.easeInOut`，180 ms |
| 液柱 | 程式繪 quadratic curve，寬度隨傾角變化，`fillStyle` = 液體 hex |
| 濺水 | particle emitter，6–10 粒，重力向下，生命 200 ms |
| 液面落定 | tween 到位後 overshoot 8% 回彈，`Back.easeOut`，120 ms |
| 總時長 | 約 400 ms（連續同色多格倒出時 ×1.3） |

---

## 8. 測試套件（必須全綠先可上線）

```ts
describe('rules', () => {
  it('拒絕倒入已滿杯');
  it('拒絕不同色相疊');
  it('拒絕操作封膜杯');
  it('部分倒出時來源保留餘量');
  it('倒空 frosted 杯後降級為 normal');
  it('外帶杯 cap 為 3 且永不可純色滿');
  it('一步同時完成兩單訂單時兩單皆結算');
  it('交付 2 單後自動解封一隻封膜杯');
  it('解封觸發嘅連鎖結算正確');
});

describe('solver', () => {
  it('heuristic 從不高估：隨機 10000 局，h ≤ 實際最優步');
  it('已解狀態回傳空解');
  it('死局回傳 null');
  it('剪枝後解嘅長度同無剪枝版本一致');   // 剪枝正確性回歸
});

describe('generator', () => {
  it('生成 1000 關全部可解');
  it('段數落喺目標 ±1');
  it('全部通過色盲檢查');
  it('相同 seed 產生完全相同盤面（client/server 一致性）');
});

describe('server', () => {
  it('偽造盤面被拒');
  it('非法走步序列被拒');
  it('未解狀態提交被拒');
  it('步數 < MIN_MS 被標記 TOO_FAST');
  it('等間隔走步 rhythmRisk > 70');
  it('真人錄製嘅 50 局 rhythmRisk < 30');   // 假陽性回歸，最重要
});
```

**最後嗰條測試最重要。** 防 bot 誤傷真人玩家嘅代價，遠高過漏放幾隻 bot。上線前要錄至少 50 局真人對局做基準，之後每次調參數都要重跑。

---

## 9. 開發順序建議

| 順序 | 模組 | 為何呢個次序 |
|---|---|---|
| 1 | `core/board.ts` + `rules.ts` + 單元測試 | 一切嘅地基，錯咗全部要重寫 |
| 2 | `core/solver.ts` + heuristic 可採納性測試 | 冇 solver 就生成唔到關卡 |
| 3 | `core/generator.ts` + 離線工具 | 出頭 40 關，可以開始試玩 |
| 4 | Phaser 渲染 + 倒液手感 | **呢步唔可以壓縮**，手感決定 D1 |
| 5 | Server session + 重放驗證 | 賽事之前必須完成 |
| 6 | 節奏分析 + 指紋 + 速率限制 | 開獎池之前必須完成 |
| 7 | Off-chain 記帳 + 週結上鏈 | 最後，且要等 D7 數據達標 |

**第 1–3 步可以喺一個純 Node 專案入面完成，完全唔掂 Phaser。** 建議先寫一個 CLI 版本喺 terminal 用文字玩，驗證規則正確之後先做渲染——咁樣 debug 快十倍。
