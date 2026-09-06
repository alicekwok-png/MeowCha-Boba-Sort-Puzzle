// core/levels.js — Campaign 1–40 關卡表。段數 (segments) 係難度主旋鈕。
// 欄位：cups 樽數（唔計廣告樽） · colors 元素數 · empties 空樽 · segments 目標段數 · hidden `?` 隱藏層樽（最少） · covered 布遮樽
//       · ad 廣告樽（額外、空、鎖死，一開波喺盤面） · orders 委託 · optimalMin/Max 最優步區間 · title · palette 指定色組 · patterns
//
// 實作指令 v4（2026-09-05）：全遊戲單一樽型 capacity 4（曲頸瓶 / 裂瓶已移除）；`?` 隱藏層同廣告樽 L2 起。
// 難度（用戶 2026-09-05 拍板）：唯一有效槓桿係真樽數（加段數冇用——最優變長預算跟住變長）。
//   真樽 = 色數 + 2 隻空樽（每隻色啱啱裝滿一樽）。空位多過 2 樽就永遠輸唔到 —— 實測空位 3 樽以上，
//   亂行 10 步之後無解率 0%；空位 2 樽先有 4–15%。螢幕上限 12 隻（連廣告樽）。
//   目標：L4 起亂撳★2 率（隨機玩家喺最優 × 1.5 步內過關）全部 < 10% → randomTwoStarMax 0.10，generator 用 seed 篩選（npm run scan 驗）
// 空樽：L1–12 兩隻、L13 起一隻（見 emptiesFor —— 唯一有效嘅難度桿）。節奏沿用：教學 L1–3（2 空樽）、限步 L12、提示 L14、布遮 L19、免費委託槽 L1 一個 / L3 起兩個到底（第三免費槽已取消，L36+ 免費 2 + 廣告 2）。
// 色組 L1–12 照夜市 brief A4 分配表；13 關後色數封頂 6（互斥規則）。

import { BY_KEY, MAX_COLORS_BY_HUE } from './palette.js';
import { UNLOCK_LEVEL } from './difficulty.js';

const UNLOCK_COVERED = UNLOCK_LEVEL.covered;

/**
 * L4 起：每關都要「輸得到」——貪心玩家行 8 步之後盤面無解嘅比例最少 5%（generator 逐個候選盤驗）。
 * 舊嘅「亂撳★2 率 < 10%」已停用：嗰個指標要靠好多空樽先達到，而空樽多正正就係「輸唔到」嘅原因。
 */
const MIN_FATAL_RATE = 0.05;
/** 4–5 色嘅早期關盤面細，本質上冇咁易入死胡同 → 門檻放低啲（L4–L10） */
const MIN_FATAL_EARLY = 0.03;
/** 由邊一關開始用倒推生成（段數推高之後，隨機填充撞唔到可解盤面） */
export const REVERSE_FROM = 5;

const L = (cups, colors, empties, segments, hidden, covered, ad, orders, optimalMin, optimalMax, title, palette = null, tutorialQueue = null, minFatalRate = null, bottlesPerColor = 1) =>
  ({ cups, colors, empties, segments, hidden, covered, ad, orders, optimalMin, optimalMax, title, palette, patterns: new Array(colors).fill(0), tutorialQueue, randomTwoStarMax: null, minFatalRate, bottlesPerColor });

const P = (keys) => keys.split('').map(k => BY_KEY[k]);

/**
 * 每色段數 3.0 → 3.9 漸進（工單 #5 A），封頂 = 該色格數（一色一樽 4、一色兩樽 8）。
 * L13 起（1 空樽 + 倒推生成）改為按總格數嘅比例：0.80 → 0.92。
 * 最優步數 ≈ 段數 − 樽數（每倒一步最多消一段），所以段數先係解法長度嘅旋鈕，打亂深度唔係。
 * 舊公式喺 1 空樽之下推唔高段數（推高就無解）；倒推法保證可解之後就推得上。
 */
export function segmentsFor(id, colors, bpc = 1) {
  const cells = 4 * bpc * colors;
  if (id >= REVERSE_FROM) {
    const ratio = Math.min(0.92, 0.80 + (id - REVERSE_FROM) * (0.12 / 35));
    return Math.round(cells * ratio);
  }
  const ratio = (3.0 + (id - 11) * (0.9 / 29)) * bpc;
  return Math.min(cells, Math.round(colors * ratio));
}

/**
 * 空樽數 —— 全遊戲唯一真正有效嘅難度控制桿（用戶 2026-09-06「玩到 30 幾關都唔使用腦」）。
 * 實測（同一個 10 色 × 2 樽、80 格盤面，只改空樽數，貪心玩家行 20 步後無解率）：
 *   2 空樽（自由 8 格）→ 0–15%   ← 字面意義輸唔到，就係「唔使用腦」嘅成因
 *   1 空樽（自由 4 格）→ 78–98%  ← 行錯一步真係玩唔到
 * 中間冇檔位：自由格以「一隻樽 4 格」為單位跳。試過「21 隻裝樽 + 1 空樽」（半滿樽做緩衝）
 * 都係 0–8%，因為半滿樽好快倒空變返空樽，等於 2 空樽。
 * 加樽 / 加色 / 加段數全部冇用（實測 24 隻樽反而 0%：樽越多逃生路越闊）。
 *
 * 所以：L1–12 兩隻空樽學規則，L13 起一隻。第二隻空樽變成廣告樽 —— 玩家撞板先睇廣告攞返，
 * 啱曬用戶 2026-09-06「要玩到冇得閒先可以睇廣告空樽」。難度同商業模式同一個機制。
 */
export const EMPTY_BOTTLES = 2;
/**
 * 由邊一關開始收到 1 空樽。設成 41 = 全 40 關都係 2 隻（用戶 2026-09-06 拍板）。
 * 原因：參考遊戲 L42/L43 嘅截圖顯示佢哋空位仲多過我哋（底行兩隻全空樽 + 大量只裝 3 格嘅樽），
 * 佢哋嘅難度唔係嚟自空位緊，係嚟自「睇唔到」（隱藏 65–75%）、盤面大（24 樽 / 10 色）
 * 同鎖住樽（×3 布樽 2–3 隻）。1 空樽做到嘅係另一種難：致命錯步 78–98%，
 * 即係「行兩步就死、要重來」，唔係「要諗要記」。想試嗰種手感就改細呢個數（引擎全部已經支援）。
 */
export const TIGHT_EMPTY_FROM = 41;
export function emptiesFor(id) { return id >= TIGHT_EMPTY_FROM ? 1 : EMPTY_BOTTLES; }

/**
 * 螢幕上限：真樽 + 廣告樽 ≤ 12（3 行 × 4 欄，樽高保住 0.19）。
 * 版面本身撐到 21 隻（6 欄，樽高 0.142），但關卡表縮返細盤面之後用唔著 —— 見 bottlesPerColorFor。
 */
export const MAX_BOTTLES_ON_SCREEN = 24;

/**
 * 每關色數（用戶 2026-09-06 新色板：10 隻互相相容，唔再卡死喺 6）。
 * 盤面色數 = 螢幕樽數嘅主旋鈕：樽 = 色 + 2，再加 1 隻廣告樽先啱 12 隻上限，所以封頂 9 色。
 */
export const MAX_COLORS_PER_LEVEL = 10;
export function colorsFor(id) {
  if (id <= 1) return 2;
  if (id <= 3) return 3;
  if (id <= 4) return 4;
  // 用戶 2026-09-06「唔好去到咁後先加強」：色數由 L5 開始每兩關 +1，L15 就去到 10 色
  // （舊表 L15 得 7 色，10 色要等到 L38）。盤面 = 色數 + 2 空樽 + 廣告樽。
  if (id <= 14) return Math.min(MAX_COLORS_PER_LEVEL, 5 + Math.floor((id - 5) / 2));
  if (id <= 19) return MAX_COLORS_PER_LEVEL;
  // L20 起一色兩樽：色數重新行上去，盤面由 14 隻樽推到 24 隻
  if (id <= 23) return 7;
  if (id <= 27) return 8;
  if (id <= 32) return 9;
  return MAX_COLORS_PER_LEVEL;
}

/**
 * 每隻色佔幾多樽。引擎（generator / solver / 版面 / 走步編碼）完整支援 2 以上，
 * 但關卡表 2026-09-06 拍板全部用 1 —— 試過 L27+ 一色兩樽（盤面 15 → 21 隻樽，對齊參考遊戲規模），
 * 實測致命錯步率跌到 0–11%（細盤面係 20–57%）：樽越多，同色可以倒去嘅目標越多、逃生路越闊，
 * 「行錯一步就玩唔到」就守唔住。用戶揀咗保留呢個手感，縮返細盤面。
 * 想再試大盤面：改呢個函數就得，其餘全部已經 work（tests/core.test.js 有一色兩樽 / 三樽嘅 heuristic 測試）。
 */
export function bottlesPerColorFor(id) {
  return id >= 20 ? 2 : 1;   // 用戶 2026-09-06：盤面規模提前，L20 就去到 16 隻樽（舊表 L27）
}

/**
 * 布遮樽數（交夠 2 單一次過全開）—— 參考遊戲 L42 有 3 隻粉紅布樽、L43 有 1 隻。
 * 佢哋係難度三大來源之一：鎖住嗰啲樽開頭用唔到，等於前段周轉空間再細一截，但唔會死局。
 * L19（登場）–26 一隻、L27–33 兩隻、L34+ 三隻。
 */
export function coveredFor(id) {
  if (id < UNLOCK_COVERED) return 0;
  if (id >= 25) return 3;
  if (id >= 19) return 2;
  return 1;
}

/** 真樽數（唔計廣告樽）= 色數 × 每色樽數 + 空樽（L1–12 兩隻、L13 起一隻） */
export function cupsFor(id, colors = colorsFor(id), bpc = bottlesPerColorFor(id)) {
  return colors * bpc + emptiesFor(id);
}

/** 廣告樽數：v4「第二關已經有兩隻」；之後雙數關 2 隻、單數關 1 隻（L1 冇）；受螢幕上限 12 隻夾住 */
export function adBottlesFor(id, cups = cupsFor(id)) {
  if (id < 2) return 0;
  return Math.min(id % 2 === 0 ? 2 : 1, MAX_BOTTLES_ON_SCREEN - cups);
}

/** 13 關後嘅行：色數固定 6，樽數 / 段數 / 空樽 / 廣告樽 / 最優區間由公式推 */
const R = (id, hidden, _covered, orders, title) => {
  const covered = coveredFor(id);
  const colors = colorsFor(id);
  const bpc = bottlesPerColorFor(id);
  const cups = cupsFor(id, colors, bpc);
  const segments = segmentsFor(id, colors, bpc);
  const tight = id >= REVERSE_FROM;
  // 致命錯步只做底線（一定要輸得到），唔再做主指標 —— 2 空樽之下佢天然係 0–15%，
  // 而參考遊戲亦都係咁：佢哋嘅難度唔喺呢度。大盤面（cups > 12）篩一次要幾十秒 solver，唔篩。
  const fatal = cups > 12 ? null : (id <= 10 ? MIN_FATAL_EARLY : MIN_FATAL_RATE);
  const maxFatal = null;
  // 1 空樽嘅盤面周轉空間細，同一個段數嘅最優步數長好多 → 上限放闊
  const slack = tight ? 20 : 8;
  const cfg = L(cups, colors, emptiesFor(id), segments, hidden, covered, adBottlesFor(id, cups), orders,
    Math.max(3, segments - colors * bpc - 2), segments + slack + (bpc - 1) * 10, title, null, null, fatal, bpc);
  // 倒推生成：段數推到格數嘅 80–92%（解法長度嘅旋鈕）之後，隨機填充撞唔到可解盤面（實測兩萬次全滅）；
  // 倒推法嘅可解性係構造出嚟 —— 同一批關由「生成失敗」變成 39 秒生成完 40 關。
  if (tight) { cfg.reverse = true; cfg.maxFatalRate = maxFatal; }
  return cfg;
};

export const CAMPAIGN = [
  // ---- 第一章：教學（L1–3 純倒，2 隻空樽；L2 起 `?` 隱藏層 + 廣告樽）----
  // Spec v3 §7 教學：L1 一個槽 = 最先完成到嘅色；L2 先封存再追上飛走；L3 兩個槽要揀先做邊隻
  L(4, 2, 2, 5, 0, 0, 0, 1, 3, 11,  '第一瓶',  P('AG'), 'firstDelivered'),
  L(5, 3, 2, 7, 1, 0, 2, 1, 3, 13,  '第二單',  P('AGC'), 'sealThenCatchUp'),   // v4：`?` 樽 + 2 隻廣告樽
  L(5, 3, 2, 8, 1, 0, 1, 2, 3, 14,  '換班',    P('IEB')),
  // ---- 4 色（最後一關寫死嘅盤面）----
  L(6, 4, 2, 13, 1, 0, 2, 2, 5, 20, '熟手', P('AGCI'), null, MIN_FATAL_EARLY),
  // ---- L5 起全部行公式（用戶 2026-09-06）：色數每兩關 +1、隱藏密度每關 +3%、
  //      段數 = 格數 × 0.80→0.92、倒推生成。舊表呢一段係 4–6 色 / 隱藏 40–50%，太鬆。----
  R(5, 1, 0, 2, '晚更'),
  R(6, 1, 0, 2, '蓋住咗'),
  R(7, 1, 0, 2, '排隊'),
  R(8, 1, 0, 2, '打烊前'),
  R(9, 1, 0, 2, '問號瓶'),
  R(10, 1, 0, 2, '曲頸瓶'),
  R(11, 1, 0, 2, '爆單'),
  R(12, 1, 0, 2, '實驗室高峰'),
  // ---- 第三章起：色數行到 10 色封頂，L20 起一色兩樽推盤面 ----
  R(13, 1, 0, 2, '開爐'),
  R(14, 1, 0, 2, '導師提示'),
  R(15, 1, 0, 2, '裂瓶'),
  // ---- 第四章：第 19 關布遮樽（要交兩單先開得）----
  R(16, 1, 0, 2, '睇唔到嘅底'),
  R(17, 1, 0, 2, '兩張委託'),
  R(18, 1, 0, 2, '排長龍'),
  R(19, 1, 1, 2, '布遮瓶'),
  R(20, 1, 1, 2, '全家福'),
  // ---- 第五章：夜更；11 真樽 ----
  R(21, 1, 0, 2, '夜更開始'),
  R(22, 2, 0, 2, '兩隻問號'),
  R(23, 1, 1, 2, '布遮曲頸'),
  R(24, 1, 0, 2, '裂瓶再現'),
  R(25, 1, 1, 2, '蠟封'),
  // ---- 第六章 ----
  R(26, 1, 0, 2, '夜更深'),
  R(27, 2, 0, 2, '雙問號'),
  R(28, 1, 1, 2, '三種瓶'),
  R(29, 1, 0, 2, '一隻空瓶'),
  R(30, 2, 1, 2, '布遮雙問號'),
  // ---- 第七章：師傅級 ----
  R(31, 1, 0, 2, '六色全開'),
  R(32, 1, 0, 2, '六色問號'),
  // ---- 12 樽（含廣告樽）----
  R(33, 1, 1, 2, '八隻瓶'),
  R(34, 1, 0, 2, '曲頸夜更'),
  R(35, 2, 1, 2, '師傅考牌'),
  // ---- 第八章：導師級（免費槽維持 2，唔鬆）----
  R(36, 2, 0, 2, '導師訓話'),
  R(37, 2, 1, 2, '布遮雙問號 II'),
  R(38, 1, 1, 2, '全部瓶種'),
  R(39, 2, 1, 2, '最後衝刺'),
  R(40, 2, 1, 2, '實驗室之光'),
];

export const CHAPTERS = [
  { from: 1, to: 3,  name: '教學' },
  { from: 4, to: 12, name: '學徒' },
  { from: 13, to: 15, name: '開爐' },
  { from: 16, to: 20, name: '兩張委託' },
  { from: 21, to: 25, name: '夜更' },
  { from: 26, to: 30, name: '深夜' },
  { from: 31, to: 35, name: '師傅級' },
  { from: 36, to: 40, name: '導師級' },
];

/** 練習模式：三個難度桶（色數上限 6；練習冇廣告樽）— 樽數同亂撳篩選同正式關同步（用戶 2026-09-05：練習唔可以比正關易）
 *  輕鬆 ≈ L4–6（8 樽）· 普通 ≈ L13–20（10 樽）· 困難 ≈ L21+（11 樽）；main.js 生成超時嘅放寬版只拎走布遮 / 第二槽，篩選保留 */
export const PRACTICE = {
  easy:   L(6, 4, 2, 13, 0, 0, 0, 2, 5, 20, '練習・輕鬆', null, null, MIN_FATAL_RATE),
  medium: L(7, 5, 2, 16, 1, 0, 0, 2, 9, 24, '練習・普通', null, null, MIN_FATAL_RATE),
  hard:   L(8, 6, 2, 22, 1, 1, 0, 2, 14, 30, '練習・困難', null, null, MIN_FATAL_RATE),
};
