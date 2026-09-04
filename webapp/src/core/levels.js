// core/levels.js — Campaign 1–40 關卡表。段數 (segments) 係難度主旋鈕。
// 欄位：cups 杯數 · colors 色數 · empties 空杯 · segments 目標段數 · frosted 磨砂 · sealed 封膜 · takeaway 外帶 · orders 訂單 · optimalMin/Max 最優步區間 · title · covered 布遮 · palette 指定色組
//
// 夜市奶茶 brief（v1.0）：
//  - 第 1–12 關色數 / 顏色 ID / 機制照 A4 分配表（隱藏層 6、磨砂 9、外帶 10、限步 12；每 3 關換色組）
//  - 互斥規則下純靠顏色最多 6 色同關 → 13 關後色數封頂 6，難度靠段數（每色 3.0→3.9 段）、空杯、隱藏密度同收窄容器（13–32 關 9 隻、33 關起 8 隻）推
//  - 7 色以上要等 P3 圖案辨識系統
// 工單 #5 補充（A+B）：空杯 1–24 關 2 隻、25–32 關單數 1 雙數 2、33 關起 1 隻

import { BY_KEY, MAX_COLORS_BY_HUE } from './palette.js';

const L = (cups, colors, empties, segments, frosted, sealed, takeaway, orders, optimalMin, optimalMax, title, covered = 0, palette = null) =>
  ({ cups, colors, empties, segments, frosted, sealed, takeaway, orders, optimalMin, optimalMax, title, covered, palette });

const P = (keys) => keys.split('').map(k => BY_KEY[k]);

/** 13 關起每色段數 3.0 → 3.9 漸進（工單 #5 A），封頂 4 段 / 色 */
export function segmentsFor(id, colors) {
  const ratio = 3.0 + (id - 11) * (0.9 / 29);
  return Math.min(4 * colors, Math.round(colors * ratio));
}

/** 工單 #5 B：空杯漸進 */
export function emptiesFor(id) {
  if (id <= 24) return 2;
  if (id <= 32) return id % 2 ? 1 : 2;
  return 1;
}

/** 13 關後嘅行：色數固定 6，段數 / 空杯 / 最優區間由公式推 */
const R = (id, cups, frosted, sealed, takeaway, orders, title, covered = 0) => {
  const colors = MAX_COLORS_BY_HUE;
  const segments = segmentsFor(id, colors);
  return L(cups, colors, emptiesFor(id), segments, frosted, sealed, takeaway, orders, Math.max(3, segments - colors - 2), segments + 6, title, covered);
};

export const CAMPAIGN = [
  // ---- 第一章：開店（brief A4 第 1–6 關：純倒 → 第 6 關隱藏層）----
  L(5, 2, 2, 5, 0, 0, 0, 0, 3, 11,  '第一杯',  0, P('AG')),      // 教學：黃 vs 藍
  L(6, 3, 2, 7, 0, 0, 0, 0, 3, 13,  '落單啦',  0, P('AGC')),
  L(6, 3, 2, 8, 0, 0, 0, 0, 3, 14,  '換班',    0, P('IEB')),     // 換色組
  L(7, 4, 2, 10, 0, 0, 0, 0, 4, 16, '熟手',    0, P('AGCI')),    // 首次 4 色
  L(7, 4, 2, 11, 0, 0, 0, 0, 5, 17, '晚市',    0, P('BHEJ')),    // 首次奶蓋白：白唔係空杯
  L(7, 4, 2, 11, 0, 0, 0, 0, 5, 17, '蓋住咗',  0, P('AGDI')),    // 首次隱藏層 ?
  // ---- 第二章：熟客（第 7 關訂單槽；第 9 關磨砂杯；第 10 關外帶袋；第 12 關限步）----
  L(8, 5, 2, 13, 0, 0, 0, 1, 6, 19, '排隊',    0, P('AGCIF')),   // 首次 5 色
  L(8, 5, 2, 14, 0, 0, 0, 1, 7, 20, '打烊前',  0, P('BHEIJ')),   // 白 + 深藍：明度辨識
  L(8, 5, 2, 14, 1, 0, 0, 1, 7, 20, '磨砂杯',  0, P('AGDFI')),   // 首次磨砂杯
  L(9, 5, 2, 15, 1, 0, 1, 1, 8, 21, '外帶袋',  0, P('BHCIJ')),   // 磨砂 + 隱藏 + 外帶
  L(9, 6, 2, 17, 1, 0, 0, 1, 9, 23, '爆單',    0, P('AGCIFJ')),  // 首次 6 色（色板上限）
  L(9, 6, 2, 18, 1, 0, 0, 1, 10, 24, '夜市高峰', 0, P('BHEIJC')), // 小 boss：磨砂 + 隱藏 + 限步
  // ---- 第三章：外帶（第 14 關提示）----
  R(13, 9, 1, 0, 1, 1, '夜市開檔'),
  R(14, 9, 1, 0, 0, 1, '摩卡提示'),
  R(15, 9, 1, 0, 1, 1, '午後慢活'),
  // ---- 第四章：第 17 關第二訂單槽；第 19 關封膜杯（要交兩單先開得）----
  R(16, 9, 1, 0, 0, 1, '睇唔到嘅底'),
  R(17, 9, 1, 0, 0, 2, '兩張單'),
  R(18, 9, 1, 0, 1, 2, '排長龍'),
  R(19, 9, 1, 1, 0, 2, '封膜杯'),
  R(20, 9, 1, 1, 1, 2, '全家福'),
  // ---- 第五章：晚市（難度上升）----
  R(21, 9, 1, 0, 1, 2, '晚市開始'),
  R(22, 9, 2, 0, 0, 2, '兩隻磨砂'),
  R(23, 9, 1, 1, 1, 2, '封膜外帶'),
  R(24, 9, 1, 0, 0, 2, '霓虹晚市'),
  R(25, 9, 1, 0, 0, 2, '布遮杯', 1),
  // ---- 第六章：夜更（第 25 關布遮杯登場）----
  R(26, 9, 1, 0, 1, 2, '夜更開始'),
  R(27, 9, 2, 0, 0, 2, '雙磨砂'),
  R(28, 9, 1, 1, 1, 2, '三種杯'),
  R(29, 9, 1, 0, 0, 2, '一隻空杯'),
  R(30, 9, 2, 0, 0, 2, '布遮雙磨砂', 1),
  // ---- 第七章：師傅級 ----
  R(31, 9, 1, 0, 0, 2, '六色全開'),
  R(32, 9, 1, 0, 0, 2, '六色磨砂'),
  R(33, 8, 1, 1, 0, 2, '八隻杯'),
  R(34, 8, 1, 0, 1, 2, '外帶夜更'),
  R(35, 8, 2, 0, 0, 2, '師傅考牌', 1),
  // ---- 第八章：店長級 ----
  R(36, 8, 2, 0, 1, 3, '店長訓話'),
  R(37, 8, 2, 1, 0, 3, '封膜雙磨砂 II'),
  R(38, 8, 1, 1, 1, 3, '全部杯種'),
  R(39, 8, 2, 0, 1, 3, '最後衝刺', 1),
  R(40, 8, 2, 0, 1, 3, '喵喵茶記之光', 1),
];

export const CHAPTERS = [
  { from: 1, to: 6,  name: '開店' },
  { from: 7, to: 12, name: '熟客' },
  { from: 13, to: 15, name: '外帶' },
  { from: 16, to: 20, name: '兩張單' },
  { from: 21, to: 25, name: '晚市' },
  { from: 26, to: 30, name: '夜更' },
  { from: 31, to: 35, name: '師傅級' },
  { from: 36, to: 40, name: '店長級' },
];

/** 練習模式：三個難度桶（色數上限 6） */
export const PRACTICE = {
  easy:   L(7, 4, 2, 11, 0, 0, 0, 1, 5, 17, '練習・輕鬆'),
  medium: L(9, 5, 2, 16, 1, 0, 1, 1, 9, 22, '練習・普通'),
  hard:   L(10, 6, 1, 22, 1, 1, 1, 2, 14, 28, '練習・困難'),
};
