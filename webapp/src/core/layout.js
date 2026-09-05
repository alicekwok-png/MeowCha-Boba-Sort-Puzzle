// core/layout.js — 瓶子版面排列（Spec v2 §4）。純函數，client 同測試共用。
//  R1 Seed = levelId，同關每次位置一致
//  R2 重疊只准遮瓶底 ≤12%，永不遮液體層（最高優先；分離迭代後仍有遮擋 → 縮 jitter / 縮瓶 / 退回純網格）
//  R3 Tap target ≥ 44pt（由 minDistanceRatio 保證圓心距 ≥ 1.15 × 瓶闊）
//  R4 Z-order 按 Y 由細到大

import { LAYOUT } from '../config/layout.js';
import { mulberry32 } from './prng.js';

/**
 * @typedef {{levelId:number, bottleCount:number, areaWidth:number, areaHeight:number, bottleWidth:number, bottleHeight:number}} LayoutInput
 * @typedef {{index:number, position:{x:number,y:number}, rotation:number, zIndex:number}} Placement
 */

/** 欄數按樽數（config LAYOUT.columnsByCount）：≤6 → 3、≤9 → 4、10+ → 5 */
export function columnsFor(bottleCount) {
  for (const [max, cols] of LAYOUT.columnsByCount) if (bottleCount <= max) return cols;
  return LAYOUT.fallbackColumns;
}

/** 呢個欄數下，樽要統一縮幾多先放得落（1 = 唔使縮）：行高 × 行數 ≤ 區域高；格闊 ≥ 樽闊 × minDistanceRatio（R3） */
export function fitScale(input, columns) {
  const rows = Math.max(1, Math.ceil(input.bottleCount / columns));
  const cellW = input.areaWidth / (columns + (rows > 1 ? LAYOUT.rowOffsetRatio : 0));
  return Math.min(1, input.areaHeight / (rows * input.bottleHeight), cellW / (input.bottleWidth * LAYOUT.minDistanceRatio));
}

/** Spec §4.2 參考實作（jitter 可覆蓋，供 fallback 同「先關 jitter 驗證」用） */
export function computeLayout(input, opts = {}) {
  const rng = mulberry32(input.levelId >>> 0);
  const columns = opts.columns ?? columnsFor(input.bottleCount);
  const rowOffsetRatio = LAYOUT.rowOffsetRatio;
  const jitterX = opts.jitterX ?? LAYOUT.jitterX;
  const jitterY = opts.jitterY ?? LAYOUT.jitterY;
  const rotationMaxDeg = opts.rotationMaxDeg ?? LAYOUT.rotationMaxDeg;
  const { minDistanceRatio, separationIterations } = LAYOUT;

  const n = input.bottleCount;
  const rows = Math.max(1, Math.ceil(n / columns));
  // 磚牆式：奇數行右移半格，所以格闊要預留半格（columns + 0.5 格鋪滿闊度），偏移行先唔會超出邊界
  const hasOffsetRow = rows > 1;
  const cellW = input.areaWidth / (columns + (hasOffsetRow ? rowOffsetRatio : 0));
  const cellH = input.areaHeight / rows;
  const minDist = input.bottleWidth * minDistanceRatio;

  const pts = Array.from({ length: n }, (_, i) => {
    const col = i % columns, row = Math.floor(i / columns);
    // 最後一行唔夠位就置中（Spec 冇講；純網格時避免左邊空一截）
    const inRow = row === rows - 1 ? n - row * columns : columns;
    const centering = ((columns - inRow) * cellW) / 2 + (hasOffsetRow && inRow < columns ? cellW * rowOffsetRatio / 2 : 0);
    const rowOffset = (row % 2 === 1 && inRow === columns) ? cellW * rowOffsetRatio : 0;
    return {
      i,
      x: centering + col * cellW + cellW / 2 + rowOffset + (rng() * 2 - 1) * cellW * jitterX,
      y: row * cellH + cellH / 2 + (rng() * 2 - 1) * cellH * jitterY,
      rotation: (rng() * 2 - 1) * rotationMaxDeg,
    };
  });

  const halfW = input.bottleWidth / 2, halfH = input.bottleHeight / 2;
  const clamp = () => {
    for (const p of pts) {
      p.x = Math.min(Math.max(p.x, halfW), input.areaWidth - halfW);
      p.y = Math.min(Math.max(p.y, halfH), input.areaHeight - halfH);
    }
  };
  // 分離迭代：每輪推開後即刻夾返入邊界（Spec 參考實作係最後先夾，但夾完會令邊緣瓶重新貼埋，R3 會失效）
  for (let iter = 0; iter < separationIterations; iter++) {
    let moved = false;
    for (let a = 0; a < pts.length; a++)
      for (let b = a + 1; b < pts.length; b++) {
        const dx = pts[b].x - pts[a].x, dy = pts[b].y - pts[a].y;
        const d = Math.hypot(dx, dy) || 0.001;
        if (d < minDist) {
          const push = (minDist - d) / 2, ux = dx / d, uy = dy / d;
          pts[a].x -= ux * push; pts[a].y -= uy * push;
          pts[b].x += ux * push; pts[b].y += uy * push;
          moved = true;
        }
      }
    clamp();
    if (!moved) break;
  }
  clamp();

  const sorted = [...pts].sort((a, b) => a.y - b.y || a.x - b.x);
  const z = new Map(sorted.map((p, idx) => [p.i, idx]));

  return pts.map(p => ({ index: p.i, position: { x: p.x, y: p.y }, rotation: p.rotation, zIndex: z.get(p.i) }));
}

/**
 * Spec §4.3 R2 驗證：前面嘅瓶只可以遮住後面嘅瓶底（液體層以下），永不遮液體層。
 *  - liquidTopRatio：由瓶頂數落嚟、必須保持可見嘅比例（bottle_std 液體底喺 98.5% → 只准遮最底 1.5% 底座）。
 *    液面用平線計係準確嘅：渲染時頂面橢圓（圓筒明暗）係畫喺液帶*入面*（由帶頂向下 2×ry 漸變），
 *    液帶係 rows 多邊形 clip 嘅平頂矩形，冇任何液體 pixel 高過帶頂，所以唔會低估。
 *  - frontOverhangRatio：前面瓶頂以上仲有嘢會遮（已封樽木塞凸出瓶口 ≈ 7.5% 瓶高），以瓶高比例計；
 *    0 = 只計瓶身。
 */
export function validateNoLiquidOcclusion(layout, bottleWidth, bottleHeight, liquidTopRatio = 0.88, frontOverhangRatio = 0) {
  const liquidTopFromBottom = bottleHeight * liquidTopRatio;
  const violations = [];
  const byZ = [...layout].sort((a, b) => a.zIndex - b.zIndex);
  for (let i = 0; i < byZ.length; i++)
    for (let j = i + 1; j < byZ.length; j++) {
      const back = byZ[i], front = byZ[j];
      if (Math.abs(front.position.x - back.position.x) >= bottleWidth) continue;
      const frontTop = front.position.y - bottleHeight / 2 - bottleHeight * frontOverhangRatio;
      const backBottom = back.position.y + bottleHeight / 2;
      if (backBottom - frontTop > bottleHeight - liquidTopFromBottom) violations.push([back.index, front.index]);
    }
  return { ok: violations.length === 0, violations };
}

/** 全部瓶喺邊界內 */
export function allInBounds(layout, input) {
  const hw = input.bottleWidth / 2, hh = input.bottleHeight / 2;
  return layout.every(p => p.position.x >= hw - 1e-6 && p.position.x <= input.areaWidth - hw + 1e-6 && p.position.y >= hh - 1e-6 && p.position.y <= input.areaHeight - hh + 1e-6);
}

/** R3：最小圓心距 */
export function minCenterDistance(layout) {
  let min = Infinity;
  for (let a = 0; a < layout.length; a++)
    for (let b = a + 1; b < layout.length; b++)
      min = Math.min(min, Math.hypot(layout[a].position.x - layout[b].position.x, layout[a].position.y - layout[b].position.y));
  return min;
}

/**
 * 安全版面（Spec §4.3 fallback 順序）：
 *  1. 正常 jitter → 2. jitterY × 0.7 → 3. 瓶尺寸 × 0.92 → 4. 純網格（jitter 0、rotation 0）+ warn
 * 永遠唔會放行有 violation 嘅版面（純網格由構造保證：同列瓶垂直間距 = cellH ≥ bottleHeight 時無遮擋；
 * 若連純網格都遮擋，代表區域太細，會再縮瓶直到通過）。
 * 回傳 { layout, bottleWidth, bottleHeight, fallback: 0..3+ }
 */
export function safeLayout(input, warn = null, opts = {}) {
  // liquidTopRatio：液體頂佔瓶高比例（由器皿幾何推：允許重疊 = 底座高度）。bottle_std 液體去到 98.5% → 幾乎唔准重疊
  const ltr = opts.liquidTopRatio ?? 0.88;
  const overhang = opts.frontOverhangRatio ?? 0;   // 木塞凸出瓶口嘅高度（瓶高比例）
  const columns = opts.columns ?? columnsFor(input.bottleCount);
  // 先統一縮到放得落（行數 × 樽高、R3 格闊）；再做 R2 fallback 鏈
  const fit = fitScale(input, columns);
  let bw = input.bottleWidth * fit, bh = input.bottleHeight * fit;
  const attempts = [
    { jitterY: LAYOUT.jitterY },
    { jitterY: LAYOUT.jitterY * 0.7 },
    { jitterY: LAYOUT.jitterY * 0.7, scale: 0.92 },
  ];
  for (let k = 0; k < attempts.length; k++) {
    const a = attempts[k];
    const w = bw * (a.scale || 1), h = bh * (a.scale || 1);
    const layout = computeLayout({ ...input, bottleWidth: w, bottleHeight: h }, { columns, jitterY: a.jitterY, ...(opts.force || {}) });
    if (validateNoLiquidOcclusion(layout, w, h, ltr, overhang).ok) return { layout, bottleWidth: w, bottleHeight: h, fallback: k, columns, fit };
  }
  // 純網格：逐步縮瓶直到冇遮擋
  let scale = 0.92, k = 3;
  for (let tries = 0; tries < 12; tries++, k++) {
    const w = bw * scale, h = bh * scale;
    const layout = computeLayout({ ...input, bottleWidth: w, bottleHeight: h }, { columns, jitterX: 0, jitterY: 0, rotationMaxDeg: 0 });
    if (validateNoLiquidOcclusion(layout, w, h, ltr, overhang).ok) {
      if (warn) warn(`BottleLayout: level ${input.levelId} fell back to plain grid (scale ${scale.toFixed(2)})`);
      return { layout, bottleWidth: w, bottleHeight: h, fallback: k, columns, fit };
    }
    scale *= 0.92;
  }
  throw new Error('BottleLayout: cannot satisfy R2 even with plain grid');
}

/**
 * 揀欄數：先用 columnsFor（10+ → 5 欄）；如果 5 欄保唔住樽高（要縮 — 格闊跌穿 1.15 × 樽闊，或者 R2 fallback 要縮），
 * 就同 4 欄比：邊個樽高大用邊個；打和用 4 欄（用戶 2026-09-05：跌穿 1.15 就維持 4 欄，接受 0.175）。
 * 回傳 safeLayout 結果（含 columns / fit）。
 */
export function chooseColumns(input, warn = null, opts = {}) {
  const base = columnsFor(input.bottleCount);
  const candidates = base > LAYOUT.fallbackColumns ? [base, LAYOUT.fallbackColumns] : [base];
  let best = null;
  for (const columns of candidates) {
    const r = safeLayout(input, null, { ...opts, columns });
    if (!best || r.bottleHeight > best.bottleHeight + 1e-6) best = r;
    else if (Math.abs(r.bottleHeight - best.bottleHeight) <= 1e-6 && columns < best.columns) best = r;
  }
  if (warn && best.fallback >= 3) warn(`BottleLayout: level ${input.levelId} fell back to plain grid (${best.columns} cols)`);
  return best;
}
