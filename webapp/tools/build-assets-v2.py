# tools/build-assets-v2.py — Spec v2 最終資產清單（§7）→ webapp/assets/v2/ + 器皿幾何 JSON。
#   python tools/build-assets-v2.py
# 來源：assets-raw/v2/（zip 解壓 + Downloads 散件已集中喺度）。
# 輸出：
#   assets/v2/*.webp          器皿 / 布 / 角色 / UI / 背景（縮到渲染所需尺寸，有 alpha）
#   assets/v2/*.png           PAT_tile_large_v2 / PAT_tile_small_v3 / LIQ_base_v1 / 蠟封（要精確取樣，唔壓）
#   assets/v2/vessels.json    每種器皿嘅液體區幾何（由 alpha + 明度自動量度）：
#     { frame:768, content:{top,bottom}, liquid:{top,bottom}, rows:[[y,l,r],...]（0–1，由頂至底每 4px 一行），
#       rim:{y,cx,rx,ry}, neck:{l,r}, base:{top} }
#   assets/icons/*             ICON_app_v1 → 全套 icon
#   assets/v2/asset-check.json 驗證結果（LIQ_base 中心 pixel 飽和度、PAT 四象限一致、器皿內容高度）

import os, json, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(os.path.dirname(ROOT), 'assets-raw', 'v2')
OUT = os.path.join(ROOT, 'assets', 'v2')
ICONS = os.path.join(ROOT, 'assets', 'icons')
os.makedirs(OUT, exist_ok=True); os.makedirs(ICONS, exist_ok=True)

def src(name):
    p = os.path.join(RAW, name)
    if not os.path.exists(p): raise FileNotFoundError(p)
    return p

def save_webp(im, name, size=None, q=85, lossless=False):
    if size: im = im.resize(size, Image.LANCZOS)
    p = os.path.join(OUT, name)
    im.save(p, 'WEBP', quality=q, method=6, lossless=lossless)
    return os.path.getsize(p)

def lum(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]

# ---------- 器皿幾何 ----------
VESSELS = {
    'flask':          'VES_flask_empty_v3.png',
    'flask_frosted':  'VES_flask_frosted_v3.png',
    'flask_cracked':  'VES_flask_cracked_v3.png',
    'retort':         'VES_retort_empty_v4.png',
    'retort_frosted': 'VES_retort_frosted_v3.png',
}

def vessel_geom(path):
    a = np.asarray(Image.open(path).convert('RGBA')).astype(np.int32)
    H, W = a.shape[:2]
    alpha = a[..., 3]
    L = lum(a[..., :3].astype(np.float64))
    ys = np.where(alpha.max(1) > 20)[0]
    top, bottom = int(ys.min()), int(ys.max())
    # 玻璃 = 不透明 + 非黃銅（黃銅 = 暖色：R − B > 45；磨砂玻璃係灰綠，R − B < 0）
    brass = (a[..., 0] - a[..., 2] > 45) & (a[..., 0] > 90)
    glass = (alpha > 200) & ~brass
    rows = []
    for y in range(H):
        xs = np.where(glass[y])[0]
        if len(xs) < 8: rows.append(None); continue
        # 取最長連續段（避免玻璃外嘅高光 / 蝕刻線）
        segs, s = [], xs[0]
        for i in range(1, len(xs)):
            if xs[i] != xs[i - 1] + 1: segs.append((s, xs[i - 1])); s = xs[i]
        segs.append((s, xs[-1]))
        l, r = max(segs, key=lambda t: t[1] - t[0])
        rows.append((int(l), int(r)))
    widths = np.array([(r - l) if row else 0 for row in rows for (l, r) in [row or (0, 0)]])
    maxw = widths.max()
    # 液體底：最闊處以下、玻璃仍然存在嘅最低一行（底座上面）
    bulb_rows = np.where(widths > maxw * 0.5)[0]
    liquid_bottom = int(bulb_rows.max())
    # 液體頂：肩位——由底向上，闊度首次跌到 < 55% 最闊
    liquid_top = int(bulb_rows.min())
    # 頸：瓶口同肩位中間嗰行嘅 alpha 範圍（含黃銅線圈）
    ny = (top + liquid_top) // 2
    nx_ = np.where(alpha[ny] > 100)[0]
    neck = (int(nx_.min()), int(nx_.max())) if len(nx_) else rows[liquid_top]
    # 瓶口：最頂有內容（含黃銅口）嘅第 6 行嘅 alpha 範圍
    rim_y = min(top + 6, H - 1)
    rx_ = np.where(alpha[rim_y] > 100)[0]
    rl, rr = (int(rx_.min()), int(rx_.max())) if len(rx_) else rows[liquid_top]
    base_top = liquid_bottom + 1
    sample = []
    for y in range(liquid_top, liquid_bottom + 1, 4):
        row = rows[y]
        if not row:
            # 內插
            up = next((rows[k] for k in range(y, liquid_top - 1, -1) if rows[k]), None)
            dn = next((rows[k] for k in range(y, liquid_bottom + 1) if rows[k]), None)
            row = up or dn
        sample.append([round(y / H, 4), round(row[0] / W, 4), round((row[1] + 1) / W, 4)])
    if sample[-1][0] < liquid_bottom / H:
        row = rows[liquid_bottom]
        sample.append([round(liquid_bottom / H, 4), round(row[0] / W, 4), round((row[1] + 1) / W, 4)])
    # debug overlay：液體區畫綠、瓶口畫紅、頸畫藍
    dbg = Image.open(path).convert('RGBA')
    from PIL import ImageDraw
    d = ImageDraw.Draw(dbg, 'RGBA')
    for y in range(liquid_top, liquid_bottom + 1, 2):
        if rows[y]: d.line([(rows[y][0], y), (rows[y][1], y)], fill=(0, 255, 0, 90))
    d.ellipse([rl, rim_y - (rr - rl) * 0.28, rr, rim_y + (rr - rl) * 0.28], outline=(255, 0, 0, 255), width=3)
    d.rectangle([neck[0], top, neck[1], liquid_top], outline=(0, 120, 255, 255), width=2)
    os.makedirs(os.path.join(RAW, 'debug'), exist_ok=True)
    dbg.save(os.path.join(RAW, 'debug', 'geom_' + os.path.basename(path)))
    return {
        'frame': W,
        'content': {'top': round(top / H, 4), 'bottom': round((bottom + 1) / H, 4)},
        'liquid': {'top': round(liquid_top / H, 4), 'bottom': round((liquid_bottom + 1) / H, 4)},
        'rows': sample,
        'rim': {'y': round(rim_y / H, 4), 'cx': round((rl + rr) / 2 / W, 4), 'rx': round((rr - rl) / 2 / W, 4), 'ry': round((rr - rl) / 2 * 0.28 / H, 4)},
        'neck': {'l': round(neck[0] / W, 4), 'r': round((neck[1] + 1) / W, 4)},
        'base': {'top': round(base_top / H, 4)},
        'maxWidth': round(maxw / W, 4),
    }

report = {'vessels': {}, 'checks': {}}
geoms = {}
for key, fname in VESSELS.items():
    im = Image.open(src(fname)).convert('RGBA')
    g = vessel_geom(src(fname))
    geoms[key] = g
    size = save_webp(im, f'{key}.webp', (512, 512), q=88)
    report['vessels'][key] = {'bytes': size, 'contentHeightPx': round((g['content']['bottom'] - g['content']['top']) * 768), 'liquidRows': len(g['rows'])}
    print(f'{key:16s} {size // 1024:4d} KB  content {g["content"]}  liquid {g["liquid"]}  rim {g["rim"]}  neck {g["neck"]}')
# ---------- v4 §2.2：深色標準樽 VES_bottle_std（美術未交付 → 由燒瓶剪影程式生成；樽身中央明度必須 < 80/255）----------
def build_dark_bottle(src_path, out_name):
    a = np.asarray(Image.open(src_path).convert('RGBA')).astype(np.float64)
    H, W = a.shape[:2]
    alpha = a[..., 3]
    brass = (a[..., 0] - a[..., 2] > 45) & (a[..., 0] > 90)
    glass = (alpha > 200) & ~brass
    # 玻璃區 → 深藍黑（參考 #041C2C），保留黃銅口 / 底座
    base = np.array([8.0, 26.0, 40.0])
    out = a.copy()
    out[glass, :3] = base
    # 邊緣反光：距離玻璃邊 0–7px 漸亮（用 alpha 侵蝕近似）
    from PIL import ImageFilter as _IF
    gm = Image.fromarray((glass * 255).astype(np.uint8), 'L')
    inner = gm
    edge = np.zeros((H, W))
    for i, w in ((1, 0.55), (2, 0.42), (3, 0.30), (4, 0.20), (5, 0.12), (6, 0.06)):
        inner = inner.filter(_IF.MinFilter(3))
        ring = (np.asarray(gm) > 0) & (np.asarray(inner) == 0) if i == 1 else ring
        band = (np.asarray(gm) > 0) & (np.asarray(inner) == 0)
        edge = np.maximum(edge, band * w)
    # 左側柔和反光柱（瓶寬 16–24%）+ 右側細反光
    xs = np.arange(W)[None, :].repeat(H, 0)
    rows_l = np.full((H,), -1.0); rows_r = np.full((H,), -1.0)
    for y in range(H):
        xg = np.where(glass[y])[0]
        if len(xg): rows_l[y] = xg.min(); rows_r[y] = xg.max()
    fx = (xs - rows_l[:, None]) / np.maximum(1, (rows_r - rows_l)[:, None])
    col = np.clip(1 - np.abs(fx - 0.20) / 0.06, 0, 1) * 0.35 * glass
    col2 = np.clip(1 - np.abs(fx - 0.86) / 0.03, 0, 1) * 0.18 * glass
    hl = np.clip(edge * glass + col + col2, 0, 1)
    hl = np.asarray(Image.fromarray((hl * 255).astype(np.uint8), 'L').filter(_IF.GaussianBlur(1.2))).astype(np.float64) / 255
    for ch in range(3): out[..., ch] = np.where(glass, out[..., ch] + (255 - out[..., ch]) * hl, out[..., ch])
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA')
    # 驗收：樽身中央（液體區中點）明度 < 80
    g = geoms['flask']
    cy = int((g['liquid']['top'] + g['liquid']['bottom']) / 2 * H); cx = int(W * 0.5)
    c = np.asarray(img)[cy, cx, :3].astype(np.float64)
    L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    size = save_webp(img, out_name, (512, 512), q=88)
    print(f'bottle_std ← {os.path.basename(src_path)}: {size // 1024} KB  centre rgb={c.astype(int).tolist()} luma={L:.0f} (<80 {"OK" if L < 80 else "FAIL"})')
    report['checks']['bottleStdCentreLuma'] = round(float(L), 1)
    return L

src_std = os.path.join(RAW, 'VES_bottle_std.png')
if os.path.exists(src_std):
    im = Image.open(src_std).convert('RGBA'); save_webp(im, 'bottle_std.webp', (512, 512), q=88)
    geoms['bottle_std'] = vessel_geom(src_std)
    print('bottle_std ← 美術交付 VES_bottle_std.png')
else:
    build_dark_bottle(src('VES_flask_empty_v3.png'), 'bottle_std.webp')
    geoms['bottle_std'] = dict(geoms['flask'])     # 同一剪影 → 同一幾何
with open(os.path.join(OUT, 'vessels.json'), 'w', encoding='utf-8') as f:
    json.dump(geoms, f, ensure_ascii=False, separators=(',', ':'))

# ---------- 遮蓋 ----------
cloth = Image.open(src('VES_cloth_cover_v3.png')).convert('RGBA')
# 交付嘅布係不透明黑底（唔係透明）：近黑 key 走（max(rgb) < 40 → 透明；40–90 漸變），布本身係米白，唔會誤傷
ca = np.asarray(cloth).astype(np.int32).copy()
mx = ca[..., :3].max(2)
ramp = np.clip((mx - 40) / 50, 0, 1)
ca[..., 3] = np.round(ca[..., 3] * ramp).astype(np.int32)
cloth = Image.fromarray(ca.astype(np.uint8), 'RGBA')
a = np.asarray(cloth); ys, xs = np.where(a[..., 3] > 20)
cloth_bbox = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
report['checks']['clothBboxPx'] = cloth_bbox
report['checks']['clothBottomRowContinuous'] = bool((a[cloth_bbox[3] - 2, cloth_bbox[0]:cloth_bbox[2], 3] > 200).mean() > 0.98)
report['checks']['clothTransparentFrac'] = round(float((a[..., 3] < 20).mean()), 3)
save_webp(cloth, 'cloth_cover.webp', (512, 512), q=88)
for n, fn in (('wax_seal', 'VES_wax_seal_v2.png'), ('wax_ring', 'VES_wax_ring_v2.png')):
    Image.open(src(fn)).convert('RGBA').save(os.path.join(OUT, n + '.png'))
seal = np.asarray(Image.open(src('VES_wax_seal_v2.png')).convert('RGBA')).astype(np.float64)
c = seal[128, 128, :3]; report['checks']['waxSealCenterSaturation'] = round(float((c.max() - c.min()) / max(1, c.max())), 3)

# ---------- 液體 / 配料 ----------
liq = Image.open(src('LIQ_base_v1.png')).convert('RGBA'); liq.save(os.path.join(OUT, 'liq_base.png'))
la = np.asarray(liq).astype(np.float64); cpx = la[128, 256, :3]
sat = float((cpx.max() - cpx.min()) / max(1, cpx.max()))
report['checks']['liqBaseCenterSaturation'] = round(sat, 4)
if sat >= 0.02: print('WARNING: LIQ_base centre pixel saturation >= 0.02', file=sys.stderr)
for n, fn in (('pat_large', 'PAT_tile_large_v2.png'), ('pat_small', 'PAT_tile_small_v3.png')):
    im = Image.open(src(fn)).convert('RGB')
    if im.size != (256, 256): im = im.resize((256, 256), Image.LANCZOS)
    # 統一成 L 通道遮罩：黑 = 圖案，白 = 空
    im.convert('L').save(os.path.join(OUT, n + '.png'))
# 四象限一致性：大細圖每象限「黑」比例
def quad_ink(path):
    g = np.asarray(Image.open(path).convert('L')) < 128
    return [round(float(g[y:y + 128, x:x + 128].mean()), 3) for (x, y) in ((0, 0), (128, 0), (0, 128), (128, 128))]
report['checks']['patLargeQuadInk'] = quad_ink(os.path.join(OUT, 'pat_large.png'))
report['checks']['patSmallQuadInk'] = quad_ink(os.path.join(OUT, 'pat_small.png'))

# ---------- 背景（單張）----------
bg = Image.open(src('BG_lab_full_v2.png')).convert('RGB')
report['checks']['bgSize'] = list(bg.size)
# 瓶區安全帶（y 25%–73%，同 client/background.js 嘅 SAFE_TOP / SAFE_BOTTOM 一致）平均 L* 同平均 RGB，
# 供 tests/background.test.js 灰階對比測試（液體色板平均 L* − 背景帶 L* ≥ 25）
def lstar_mean(rgb):
    c = rgb.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    y = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    return float((116 * np.where(y > 0.008856, np.cbrt(y), 7.787 * y + 16 / 116) - 16).mean())
bga = np.asarray(bg)
band = bga[int(bga.shape[0] * 0.25):int(bga.shape[0] * 0.73)]
report['checks']['bgBandL'] = round(lstar_mean(band), 2)
report['checks']['bgBandRgb'] = [int(round(v)) for v in band.reshape(-1, 3).mean(0)]
report['checks']['bgFullL'] = round(lstar_mean(bga), 2)
save_webp(bg, 'bg_lab_full.webp', None, q=82)
save_webp(bg, 'bg_lab_full_small.webp', (585, 1266), q=80)   # 標題 / loading 畫面用

# ---------- 角色 ----------
CHARS = {
    'cat_idle': 'CHR_cat_idle_v2.png', 'cat_happy': 'CHR_cat_happy_v2.png', 'cat_cheer': 'CHR_cat_cheer_v2.png',
    'client_owl': 'CHR_client_owl_v1.png', 'client_raven': 'CHR_client_raven_v1.png',
    'client_badger': 'CHR_client_badger_v1.png', 'client_hare': 'CHR_client_hare_v1.png',
}
for key, fn in CHARS.items():
    im = Image.open(src(fn)).convert('RGBA')
    a = np.asarray(im); ys = np.where(a[..., 3].max(1) > 20)[0]
    report['checks'][key + 'FeetY'] = int(ys.max())   # 腳底線對齊檢查
    save_webp(im, key + '.webp', (512, 512), q=86)
doc = Image.open(src('CHR_doctor_silhouette_v1.png')).convert('RGBA')
save_webp(doc, 'doctor_silhouette.webp', (384, 640), q=86)

# ---------- UI ----------
UI = ['UI_ad_crest_v1', 'UI_btn_primary_v1', 'UI_btn_secondary_v1', 'UI_btn_danger_v1', 'UI_btn_disabled_v1',
      'UI_panel_dialog_v1', 'UI_panel_info_v1', 'UI_item_undo_v1', 'UI_item_hint_v1', 'UI_item_addflask_v1', 'UI_item_swap_v1',
      'UI_sys_back_v1', 'UI_sys_settings_v1', 'UI_sys_shop_v1', 'UI_sys_daily_v1', 'UI_sys_codex_v1',
      'UI_coin_v1', 'UI_star_v1', 'UI_star_dim_v1', 'UI_progressbar_v1']
for n in UI:
    im = Image.open(src(n + '.png')).convert('RGBA')
    key = n.replace('UI_', 'ui_').rsplit('_v', 1)[0]
    if key == 'ui_ad_crest':
        # 紋章交付係白底 RGB：去白底
        a = np.asarray(im).copy()
        white = (a[..., :3].min(2) > 235)
        a[..., 3] = np.where(white, 0, a[..., 3])
        im = Image.fromarray(a.astype(np.uint8), 'RGBA')
    w, h = im.size
    if max(w, h) > 512:
        s = 512 / max(w, h); im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
    save_webp(im, key + '.webp', None, q=86)

# ---------- App Icon ----------
# 用戶 2026-09-05 換咗 icon（assets-raw/v2/ICON_app_v2.png：貓煉金師舉起發光燒瓶，交付係 1254² RGB + 黑色圓角底）。
# App Store 規格要 1024² 無 alpha 無圓角：裁走黑邊，角位用最近嘅畫面像素向外補（唔會有黑角 / 硬邊）。
def square_icon(path):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int32)
    H, W = a.shape[:2]
    inside = a.max(2) >= 14                                   # 非黑 = 畫面
    ys, xs = np.where(inside)
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    a = a[y0:y1, x0:x1]; inside = inside[y0:y1, x0:x1]
    # 只當「由四角 flood 到嘅黑」係外面（畫面入面嘅深色唔會被填）
    from collections import deque
    Hc, Wc = inside.shape
    outside = np.zeros_like(inside)
    q = deque([(0, 0), (0, Wc - 1), (Hc - 1, 0), (Hc - 1, Wc - 1)])
    for sy, sx in list(q): outside[sy, sx] = not inside[sy, sx]
    q = deque([(sy, sx) for sy, sx in q if outside[sy, sx]])
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < Hc and 0 <= nx < Wc and not outside[ny, nx] and not inside[ny, nx]:
                outside[ny, nx] = True; q.append((ny, nx))
    # 向外補色：逐圈將已知像素複製去相鄰未知像素（角位半徑約 20%，最多幾百圈）
    known = ~outside
    img = a.copy()
    for _ in range(max(Hc, Wc)):
        if known.all(): break
        grown = known.copy()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            src_k = np.roll(known, (dy, dx), axis=(0, 1))
            src_v = np.roll(img, (dy, dx), axis=(0, 1))
            fill = src_k & ~grown
            img[fill] = src_v[fill]; grown |= fill
        known = grown
    out = Image.fromarray(img.astype(np.uint8), 'RGB').resize((1024, 1024), Image.LANCZOS)
    # 角位補色再輕微模糊，避免拉絲
    corner = Image.new('L', (1024, 1024), 0)
    from PIL import ImageDraw as _ID, ImageFilter as _IF
    d = _ID.Draw(corner); d.rectangle([0, 0, 1023, 1023], fill=255); d.rounded_rectangle([0, 0, 1023, 1023], radius=round(1024 * 0.22), fill=0)
    corner = corner.filter(_IF.GaussianBlur(6))
    blurred = out.filter(_IF.GaussianBlur(10))
    return Image.composite(blurred, out, corner)

# v3（2026-09-05 revised）：已經係滿版正方形、冇圓角底 → 直接縮到 1024；v2 先要補角
icon_src = next(src(n) for n in ('ICON_app_v3.png', 'ICON_app_v2.png', 'ICON_app_v1.png') if os.path.exists(os.path.join(RAW, n)))
icon = square_icon(icon_src) if icon_src.endswith('v2.png') else Image.open(icon_src).convert('RGB').resize((1024, 1024), Image.LANCZOS)
icon.save(os.path.join(ICONS, 'icon-1024.png'))
icon.resize((512, 512), Image.LANCZOS).save(os.path.join(ICONS, 'icon-512.png'))
# 細尺寸：張圖隻貓只佔左下、右邊大片深底，縮細就得返一嚿深色 → 主畫面 icon 用貼身裁切（貓面 + 燒瓶），favicon 直接裁貓面
W1 = icon.width
crop_mid = icon.crop((int(W1 * 0.07), 0, int(W1 * 0.98), int(W1 * 0.91)))      # 貓面 + 燒瓶
side = min(crop_mid.size); crop_mid = crop_mid.crop((0, 0, side, side))
face = icon.crop((int(W1 * 0.14), int(W1 * 0.24), int(W1 * 0.58), int(W1 * 0.68)))   # 貓面
for size, name, srcim in ((192, 'icon-192.png', crop_mid), (180, 'apple-touch-icon.png', crop_mid), (64, 'favicon-64.png', face), (32, 'favicon-32.png', face)):
    srcim.resize((size, size), Image.LANCZOS).save(os.path.join(ICONS, name))
m = Image.new('RGB', (512, 512), (0x12, 0x10, 0x0D)); m.paste(icon.resize((410, 410), Image.LANCZOS), (51, 51)); m.save(os.path.join(ICONS, 'icon-512-maskable.png'))
report['checks']['iconSource'] = os.path.basename(icon_src)

with open(os.path.join(OUT, 'asset-check.json'), 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=1)
print(json.dumps(report['checks'], ensure_ascii=False, indent=1))
print('wrote', OUT)
