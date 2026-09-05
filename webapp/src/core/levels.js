// core/levels.js — Campaign 1–40 關卡表。段數 (segments) 係難度主旋鈕。
// 欄位：cups 樽數（唔計廣告樽） · colors 元素數 · empties 空樽 · segments 目標段數 · hidden `?` 隱藏層樽（最少） · covered 布遮樽
//       · ad 廣告樽（額外、空、鎖死，一開波喺盤面） · orders 委託 · optimalMin/Max 最優步區間 · title · palette 指定色組 · patterns
//
// 實作指令 v4（2026-09-05）：全遊戲單一樽型 capacity 4（曲頸瓶 / 裂瓶已移除）；`?` 隱藏層同廣告樽 L2 起；
// 交貨後樽飛走釋放位置（唔留空樽），所以難度由 v4 第 11 步（重跑 solver）之後先再調。
// 節奏沿用：教學 L1–3（2 空樽）、L4 起 1 空樽、委託 L7、限步 L12、提示 L14、布遮 L19、委託槽 7 / 17 / 36。
// 色組 L1–12 照夜市 brief A4 分配表；13 關後色數封頂 6（互斥規則）。

import { BY_KEY, MAX_COLORS_BY_HUE } from './palette.js';

const L = (cups, colors, empties, segments, hidden, covered, ad, orders, optimalMin, optimalMax, title, palette = null) =>
  ({ cups, colors, empties, segments, hidden, covered, ad, orders, optimalMin, optimalMax, title, palette, patterns: new Array(colors).fill(0) });

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

/** 廣告樽數：v4「第二關已經有兩隻」；之後雙數關 2 隻、單數關 1 隻（L1 冇） */
export function adBottlesFor(id) {
  if (id < 2) return 0;
  return id % 2 === 0 ? 2 : 1;
}

/** 13 關後嘅行：色數固定 6，段數 / 空樽 / 廣告樽 / 最優區間由公式推 */
const R = (id, cups, hidden, covered, orders, title) => {
  const colors = MAX_COLORS_BY_HUE;
  const segments = segmentsFor(id, colors);
  return L(cups, colors, emptiesFor(id), segments, hidden, covered, adBottlesFor(id), orders, Math.max(3, segments - colors - 2), segments + 8, title);
};

export const CAMPAIGN = [
  // ---- 第一章：教學（L1–3 純倒，2 隻空樽；L2 起 `?` 隱藏層 + 廣告樽）----
  L(5, 2, 2, 5, 0, 0, 0, 0, 3, 11,  '第一瓶',  P('AG')),
  L(6, 3, 2, 7, 1, 0, 2, 0, 3, 13,  '第二單',  P('AGC')),     // v4：`?` 樽 + 2 隻廣告樽
  L(6, 3, 2, 8, 1, 0, 1, 0, 3, 14,  '換班',    P('IEB')),
  // ---- L4 起 1 隻空樽 ----
  L(6, 4, 1, 10, 1, 0, 2, 0, 4, 18, '熟手',    P('AGCI')),
  L(6, 4, 1, 11, 1, 0, 1, 0, 5, 19, '晚更',    P('BHEJ')),
  L(7, 4, 1, 12, 1, 0, 2, 0, 7, 20, '蓋住咗',  P('AGDI')),
  // ---- 第二章：委託（第 7 關委託槽；第 12 關限步）----
  L(7, 5, 1, 14, 1, 0, 1, 1, 9, 22, '排隊',    P('AGCIF')),
  L(7, 5, 1, 15, 1, 0, 2, 1, 10, 23, '打烊前',  P('BHEIJ')),
  L(7, 5, 1, 16, 1, 0, 1, 1, 12, 24, '磨砂瓶',  P('AGDFI')),
  L(8, 5, 1, 17, 1, 0, 2, 1, 13, 25, '曲頸瓶',  P('BHCIJ')),
  L(8, 6, 1, 18, 1, 0, 1, 1, 14, 26, '爆單',    P('AGCIFJ')),
  L(8, 6, 1, 19, 1, 0, 2, 1, 15, 27, '實驗室高峰', P('BHEIJC')),
  // ---- 第三章（第 14 關提示）----
  R(13, 9, 1, 0, 1, '開爐'),
  R(14, 9, 1, 0, 1, '導師提示'),
  R(15, 9, 1, 0, 1, '裂瓶'),
  // ---- 第四章：第 17 關第二委託槽；第 19 關布遮樽（要交兩單先開得）----
  R(16, 9, 1, 0, 1, '睇唔到嘅底'),
  R(17, 9, 1, 0, 2, '兩張委託'),
  R(18, 9, 1, 0, 2, '排長龍'),
  R(19, 9, 1, 1, 2, '布遮瓶'),
  R(20, 9, 1, 1, 2, '全家福'),
  // ---- 第五章：夜更 ----
  R(21, 9, 1, 0, 2, '夜更開始'),
  R(22, 9, 2, 0, 2, '兩隻磨砂'),
  R(23, 9, 1, 1, 2, '布遮曲頸'),
  R(24, 9, 1, 0, 2, '裂瓶再現'),
  R(25, 9, 1, 1, 2, '蠟封'),
  // ---- 第六章 ----
  R(26, 9, 1, 0, 2, '夜更深'),
  R(27, 9, 2, 0, 2, '雙磨砂'),
  R(28, 9, 1, 1, 2, '三種瓶'),
  R(29, 9, 1, 0, 2, '一隻空瓶'),
  R(30, 9, 2, 1, 2, '布遮雙磨砂'),
  // ---- 第七章：師傅級 ----
  R(31, 9, 1, 0, 2, '六色全開'),
  R(32, 9, 1, 0, 2, '六色磨砂'),
  R(33, 8, 1, 1, 2, '八隻瓶'),
  R(34, 8, 1, 0, 2, '曲頸夜更'),
  R(35, 8, 2, 1, 2, '師傅考牌'),
  // ---- 第八章：導師級 ----
  R(36, 8, 2, 0, 3, '導師訓話'),
  R(37, 8, 2, 1, 3, '布遮雙磨砂 II'),
  R(38, 9, 1, 1, 3, '全部瓶種'),
  R(39, 8, 2, 1, 3, '最後衝刺'),
  R(40, 9, 2, 1, 3, '實驗室之光'),
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

/** 練習模式：三個難度桶（色數上限 6；練習冇廣告樽） */
export const PRACTICE = {
  easy:   L(6, 4, 1, 11, 0, 0, 0, 1, 5, 19, '練習・輕鬆'),
  medium: L(8, 5, 1, 16, 1, 0, 0, 1, 9, 24, '練習・普通'),
  hard:   L(9, 6, 1, 22, 1, 1, 0, 2, 14, 30, '練習・困難'),
};
