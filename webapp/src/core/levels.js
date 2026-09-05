// core/levels.js — Campaign 1–40 關卡表。段數 (segments) 係難度主旋鈕。
// 欄位：cups 樽數（唔計廣告樽） · colors 元素數 · empties 空樽 · segments 目標段數 · hidden `?` 隱藏層樽（最少） · covered 布遮樽
//       · ad 廣告樽（額外、空、鎖死，一開波喺盤面） · orders 委託 · optimalMin/Max 最優步區間 · title · palette 指定色組 · patterns
//
// 實作指令 v4（2026-09-05）：全遊戲單一樽型 capacity 4（曲頸瓶 / 裂瓶已移除）；`?` 隱藏層同廣告樽 L2 起。
// 難度（用戶 2026-09-05 拍板）：唯一有效槓桿係真樽數（加段數冇用——最優變長預算跟住變長）。
//   L1–3 教學 5–6 樽（唔郁）· L4–6 8 樽 · L7–12 9 樽 · L13–20 10 樽 · L21–32 11 樽 · L33–40 12 樽（含廣告樽）；空樽維持 1；螢幕上限 12 隻（連廣告樽）
//   目標：L4 起亂撳★2 率（隨機玩家喺最優 × 1.5 步內過關）全部 < 10% → randomTwoStarMax 0.10，generator 用 seed 篩選（npm run scan 驗）
// 節奏沿用：教學 L1–3（2 空樽）、限步 L12、提示 L14、布遮 L19、委託槽 1 / 3 / 36。
// 色組 L1–12 照夜市 brief A4 分配表；13 關後色數封頂 6（互斥規則）。

import { BY_KEY, MAX_COLORS_BY_HUE } from './palette.js';

const RANDOM_TWO_STAR_MAX = 0.10;   // L4 起亂撳★2 率上限

const L = (cups, colors, empties, segments, hidden, covered, ad, orders, optimalMin, optimalMax, title, palette = null, tutorialQueue = null, randomTwoStarMax = null) =>
  ({ cups, colors, empties, segments, hidden, covered, ad, orders, optimalMin, optimalMax, title, palette, patterns: new Array(colors).fill(0), tutorialQueue, randomTwoStarMax });

const P = (keys) => keys.split('').map(k => BY_KEY[k]);

/** 13 關起每色段數 3.0 → 3.9 漸進（工單 #5 A），封頂 4 段 / 色 */
export function segmentsFor(id, colors) {
  const ratio = 3.0 + (id - 11) * (0.9 / 29);
  return Math.min(4 * colors, Math.round(colors * ratio));
}

/** 空樽：教學 L1–3 兩隻；L4 起一隻 */
export function emptiesFor(id) {
  return id <= 3 ? 2 : 1;
}

/** 螢幕上限：真樽 + 廣告樽 ≤ 12（版面 3 行 × 4 欄保住樽高 0.19） */
export const MAX_BOTTLES_ON_SCREEN = 12;

/** 真樽數（唔計廣告樽）：L4–6 8 · L7–12 9 · L13–20 10 · L21+ 11 */
export function cupsFor(id) {
  if (id <= 6) return 8;
  if (id <= 12) return 9;
  if (id <= 20) return 10;
  return 11;
}

/** 廣告樽數：v4「第二關已經有兩隻」；之後雙數關 2 隻、單數關 1 隻（L1 冇）；受螢幕上限 12 隻夾住 */
export function adBottlesFor(id, cups = cupsFor(id)) {
  if (id < 2) return 0;
  return Math.min(id % 2 === 0 ? 2 : 1, MAX_BOTTLES_ON_SCREEN - cups);
}

/** 13 關後嘅行：色數固定 6，樽數 / 段數 / 空樽 / 廣告樽 / 最優區間由公式推 */
const R = (id, hidden, covered, orders, title) => {
  const colors = MAX_COLORS_BY_HUE;
  const cups = cupsFor(id);
  const segments = segmentsFor(id, colors);
  return L(cups, colors, emptiesFor(id), segments, hidden, covered, adBottlesFor(id, cups), orders, Math.max(3, segments - colors - 2), segments + 8, title, null, null, RANDOM_TWO_STAR_MAX);
};

export const CAMPAIGN = [
  // ---- 第一章：教學（L1–3 純倒，2 隻空樽；L2 起 `?` 隱藏層 + 廣告樽）----
  // Spec v3 §7 教學：L1 一個槽 = 最先完成到嘅色；L2 先封存再追上飛走；L3 兩個槽要揀先做邊隻
  L(5, 2, 2, 5, 0, 0, 0, 1, 3, 11,  '第一瓶',  P('AG'), 'firstDelivered'),
  L(6, 3, 2, 7, 1, 0, 2, 1, 3, 13,  '第二單',  P('AGC'), 'sealThenCatchUp'),   // v4：`?` 樽 + 2 隻廣告樽
  L(6, 3, 2, 8, 1, 0, 1, 2, 3, 14,  '換班',    P('IEB')),
  // ---- L4 起 1 隻空樽；8 真樽（亂撳★2 < 10%）----
  L(8, 4, 1, 10, 1, 0, 2, 2, 4, 18, '熟手',    P('AGCI'), null, RANDOM_TWO_STAR_MAX),
  L(8, 4, 1, 11, 1, 0, 1, 2, 5, 19, '晚更',    P('BHEJ'), null, RANDOM_TWO_STAR_MAX),
  L(8, 4, 1, 12, 1, 0, 2, 2, 7, 20, '蓋住咗',  P('AGDI'), null, RANDOM_TWO_STAR_MAX),
  // ---- 第二章（第 12 關限步）；9 真樽 ----
  L(9, 5, 1, 14, 1, 0, 1, 2, 9, 22, '排隊',    P('AGCIF'), null, RANDOM_TWO_STAR_MAX),
  L(9, 5, 1, 15, 1, 0, 2, 2, 10, 23, '打烊前',  P('BHEIJ'), null, RANDOM_TWO_STAR_MAX),
  L(9, 5, 1, 16, 1, 0, 1, 2, 12, 24, '問號瓶',  P('AGDFI'), null, RANDOM_TWO_STAR_MAX),
  L(9, 5, 1, 17, 1, 0, 2, 2, 13, 25, '曲頸瓶',  P('BHCIJ'), null, RANDOM_TWO_STAR_MAX),
  L(9, 6, 1, 18, 1, 0, 1, 2, 14, 26, '爆單',    P('AGCIFJ'), null, RANDOM_TWO_STAR_MAX),
  L(9, 6, 1, 19, 1, 0, 2, 2, 15, 27, '實驗室高峰', P('BHEIJC'), null, RANDOM_TWO_STAR_MAX),
  // ---- 第三章（第 14 關提示）；10 真樽 ----
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
  // ---- 第八章：導師級 ----
  R(36, 2, 0, 3, '導師訓話'),
  R(37, 2, 1, 3, '布遮雙問號 II'),
  R(38, 1, 1, 3, '全部瓶種'),
  R(39, 2, 1, 3, '最後衝刺'),
  R(40, 2, 1, 3, '實驗室之光'),
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
  easy:   L(8, 4, 1, 11, 0, 0, 0, 2, 5, 19, '練習・輕鬆', null, null, RANDOM_TWO_STAR_MAX),
  medium: L(10, 5, 1, 16, 1, 0, 0, 2, 9, 24, '練習・普通', null, null, RANDOM_TWO_STAR_MAX),
  hard:   L(11, 6, 1, 22, 1, 1, 0, 2, 14, 30, '練習・困難', null, null, RANDOM_TWO_STAR_MAX),
};
