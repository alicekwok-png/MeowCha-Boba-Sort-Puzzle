// client/render-assets.js — Spec v2 渲染素材載入（器皿 sprite / 幾何 / 布 / 蠟封 / 液體底圖 / 配料 tile）。
// 全部由 config/assets.js 嘅 ASSET_MAP 取路徑；舊 assets/*.webp 一律唔引用。
// 載入失敗唔會 throw：對應 slot 係 null，game.js 會畫程式佔位。

import { ASSET_MAP, VESSEL_SPRITE } from '../config/assets.js';

const ROOT = new URL('../../', import.meta.url);

/** 邏輯名 → 絕對 URL（相對 webapp 根目錄，唔靠 document 位置） */
export const assetUrl = (key) => new URL(ASSET_MAP[key], ROOT).href;

/** kind → vessels.json 幾何 key */
export function geomKey(kind) {
  switch (kind) {
    case 'frosted': return 'flask_frosted';
    case 'cracked': return 'flask_cracked';
    case 'takeaway': return 'retort';
    default: return 'flask';   // normal / covered（布底下係 flask）
  }
}

/** kind → ASSET_MAP sprite key */
export function spriteKey(kind) {
  return VESSEL_SPRITE[kind] || VESSEL_SPRITE.normal;
}

// vessels.json 未到手前用嘅後備幾何（flask 數值，rows 只留三行，interp 會補）
export const FALLBACK_GEOM = Object.freeze({
  frame: 768,
  content: { top: 0.0299, bottom: 0.9701 },
  liquid: { top: 0.4466, bottom: 0.8411 },
  rows: [[0.4466, 0.3841, 0.6159], [0.6445, 0.2734, 0.7266], [0.8398, 0.3867, 0.6224]],
  rim: { y: 0.0378, cx: 0.4987, rx: 0.0716, ry: 0.0201 },
  neck: { l: 0.4349, r: 0.5638 },
  base: { top: 0.8411 },
  maxWidth: 0.4518,
});

export const renderAssets = {
  ready: false,
  promise: null,
  geom: null,            // vessels.json
  img: {},               // key → HTMLImageElement | HTMLCanvasElement | null
  patMask: {},           // large / small → canvas（白色墨、alpha = 墨量）
};

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { console.warn('[assets] 載入失敗：' + url); resolve(null); };
    img.src = url;
  });
}

/** 圖片 / canvas 嘅不透明範圍（alpha > 40） */
function alphaBBox(src) {
  try {
    const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d'); cx.drawImage(src, 0, 0);
    const d = cx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return x1 >= x0 ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : { x: 0, y: 0, w, h };
  } catch (e) {
    const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    return { x: 0, y: 0, w, h };
  }
}

/**
 * 布遮素材嘅背景係實黑（非透明）：runtime 用亮度 key 走黑底，保留布身同繩。
 * 布身最暗嘅摺痕都 > 90，所以 30–80 之間做柔邊已經夠。
 */
function keyOutBlack(img) {
  if (!img) return null;
  try {
    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const id = cx.getImageData(0, 0, w, h), d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const m = Math.max(d[i], d[i + 1], d[i + 2]);
      const a = Math.max(0, Math.min(1, (m - 30) / 50));
      d[i + 3] = Math.round(d[i + 3] * a);
    }
    cx.putImageData(id, 0, 0);
    cv.bbox = alphaBBox(cv);   // 布身實際範圍（俾 game.js 直接拉伸至目標矩形）
    return cv;
  } catch (e) {
    console.warn('[assets] 布遮 key 失敗（可能 cross-origin），直接用原圖', e);
    img.bbox = alphaBBox(img);
    return img;
  }
}

/** 灰階 L tile（黑 = 墨）→ 白色墨 + alpha 遮罩，之後用 source-in 染成該層色 −28% L */
function inkMask(img) {
  if (!img) return null;
  try {
    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const id = cx.getImageData(0, 0, w, h), d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = 255 - lum;
    }
    cx.putImageData(id, 0, 0);
    return cv;
  } catch (e) {
    console.warn('[assets] 配料 tile 轉遮罩失敗', e);
    return null;
  }
}

const IMAGE_KEYS = [
  'VES_flask_empty', 'VES_flask_frosted', 'VES_flask_cracked', 'VES_retort_empty', 'VES_retort_frosted',
  'VES_cloth_cover', 'VES_wax_seal', 'VES_wax_ring', 'LIQ_base', 'PAT_tile_large', 'PAT_tile_small',
];

/** 預載全部渲染素材（可重複呼叫，回傳同一個 Promise） */
export function preloadRenderAssets() {
  if (renderAssets.promise) return renderAssets.promise;
  renderAssets.promise = (async () => {
    const [imgs, geom] = await Promise.all([
      Promise.all(IMAGE_KEYS.map(k => loadImage(assetUrl(k)))),
      fetch(assetUrl('VES_geometry')).then(r => r.json()).catch((e) => { console.warn('[assets] vessels.json 載入失敗', e); return null; }),
    ]);
    IMAGE_KEYS.forEach((k, i) => { renderAssets.img[k] = imgs[i]; });
    renderAssets.img.VES_cloth_cover = keyOutBlack(renderAssets.img.VES_cloth_cover);
    if (renderAssets.img.LIQ_base) renderAssets.img.LIQ_base.bbox = alphaBBox(renderAssets.img.LIQ_base);   // 白帶只佔圖中央，四周透明
    renderAssets.patMask.large = inkMask(renderAssets.img.PAT_tile_large);
    renderAssets.patMask.small = inkMask(renderAssets.img.PAT_tile_small);
    if (geom && geom.flask) renderAssets.geom = geom;
    renderAssets.ready = true;
    return renderAssets;
  })();
  return renderAssets.promise;
}

/** 取某 kind 嘅幾何（未載入 → 後備 flask 幾何） */
export function geomFor(kind) {
  const g = renderAssets.geom;
  return (g && g[geomKey(kind)]) || FALLBACK_GEOM;
}

/** 幾何 rows 內插：y（0–1 frame）→ {l, r} 玻璃內壁 */
export function extentsAt(g, y) {
  const rows = g.rows;
  if (y <= rows[0][0]) return { l: rows[0][1], r: rows[0][2] };
  const last = rows[rows.length - 1];
  if (y >= last[0]) return { l: last[1], r: last[2] };
  let lo = 0, hi = rows.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rows[mid][0] <= y) lo = mid; else hi = mid; }
  const a = rows[lo], b = rows[hi], t = (y - a[0]) / ((b[0] - a[0]) || 1);
  return { l: a[1] + (b[1] - a[1]) * t, r: a[2] + (b[2] - a[2]) * t };
}

/**
 * 某段液體（yTop..yBot，frame 單位）嘅內壁多邊形：左邊落、右邊升。
 * 回傳 [[u,v],...]，包含中間所有 rows 令圓肚彎位順滑。
 */
export function bandPolygon(g, yTop, yBot) {
  const rows = g.rows, pts = [];
  const top = extentsAt(g, yTop), bot = extentsAt(g, yBot);
  pts.push([top.l, yTop]);
  for (const r of rows) if (r[0] > yTop && r[0] < yBot) pts.push([r[1], r[0]]);
  pts.push([bot.l, yBot], [bot.r, yBot]);
  for (let i = rows.length - 1; i >= 0; i--) { const r = rows[i]; if (r[0] > yTop && r[0] < yBot) pts.push([r[2], r[0]]); }
  pts.push([top.r, yTop]);
  return pts;
}
