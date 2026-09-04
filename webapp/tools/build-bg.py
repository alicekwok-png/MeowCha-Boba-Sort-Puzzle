# tools/build-bg.py — 由 style anchor 合成五個階段嘅遠景圖（背景規格 §2 / §4）。
#   python tools/build-bg.py
# 輸出：assets/bg/bg{N}_far.webp（1080 × 2800，上下各 200px 出血，q75，無 alpha）
#       assets/bg/manifest.json（每階段安全區平均 L*，供對比度自動測試用）
#
# 美術端預處理照規格做喺呢度：far 層高斯 10px、飽和 −30%、亮度 −10%。
# Y 600–1750（+200 出血 → 800–1950）保持單一平坦表面（工單 #4 起）。

import json, os, sys
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(os.path.dirname(ROOT), 'assets-raw')
OUT = os.path.join(ROOT, 'assets', 'bg')
os.makedirs(OUT, exist_ok=True)

W, H = 1080, 2800          # 含出血
BLEED = 200
SAFE_TOP, SAFE_BOT = 600 + BLEED, 1750 + BLEED   # 工單 #4：安全區上界 470 → 600

# 階段：來源圖、色調（乘法）、亮度倍率、場景描述
STAGES = [
    (1, 'boba-cat-style-anchor-04.png', (255, 248, 236), 1.00, '街邊木頭車（日光）'),
    (2, 'boba-cat-style-anchor-01.png', (150, 165, 200), 0.62, '樓梯底小店（雨夜）'),
    (3, 'boba-cat-style-anchor-02.png', (232, 240, 252), 1.08, '商場店面（冷光）'),
    (4, 'boba-cat-style-anchor-04.png', (215, 140, 90),  0.55, '夜市旗艦店（夜）'),
    (5, 'boba-cat-style-anchor-05.png', (250, 228, 245), 1.06, '雲頂總店（夢幻）'),
]

def lstar(rgb):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    y = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
    return 116 * (y ** (1 / 3) if y > 0.008856 else 7.787 * y + 16 / 116) - 16

def vgrad(w, h, top, bottom):
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return img

def tint_image(img, tint, bright):
    img = ImageEnhance.Brightness(img).enhance(0.90 * bright)   # 美術端預處理：亮度 −10%（乘階段亮度）
    r, g, b = img.split()
    r = r.point(lambda v: v * tint[0] // 255); g = g.point(lambda v: v * tint[1] // 255); b = b.point(lambda v: v * tint[2] // 255)
    return Image.merge('RGB', (r, g, b))

def build(stage, src, tint, bright, desc):
    art = Image.open(os.path.join(RAW, src)).convert('RGB')
    art = art.resize((W, W), Image.LANCZOS)                       # 1920² → 1080²
    art = tint_image(art, tint, bright)                           # 色調 / 亮度只落喺場景同檯面
    canvas = Image.new('RGB', (W, H))

    # 頂區（0 – 670，含出血 = 設計 Y 0–470）：場景圖；安全帶由 670 起必須平坦
    top_h = SAFE_TOP
    canvas.paste(art.crop((0, 0, W, top_h)), (0, 0))

    # 安全區牆面：淺色平面（L* ≈ 90，帶少少階段色調）。
    # 呢個係美術端嘅硬要求：杯陣帶要平坦、乾淨、夠淺，遮罩先可以令杯陣讀得清（灰階對比 ≥ 25）。
    cream = (253, 249, 242)
    wall_top = tuple(round(cream[i] * 0.94 + tint[i] * 0.06) for i in range(3))
    wall_bot = tuple(round(c * 0.985) for c in wall_top)
    lower = art.crop((0, 700, W, 1080)).resize((1, 1), Image.BOX).getpixel((0, 0))
    counter_top = tuple(round(c * 0.80) for c in lower)
    counter_bot = tuple(round(c * 0.60) for c in lower)

    # 安全區 + 摩卡區：平坦牆面（唔可以有任何物件）
    wall = vgrad(W, 2300 - top_h, wall_top, wall_bot)
    canvas.paste(wall, (0, top_h))
    # 檯面（2300 – 2800）
    counter = vgrad(W, H - 2300, counter_top, counter_bot)
    canvas.paste(counter, (0, 2300))
    d = ImageDraw.Draw(canvas)
    d.line([(0, 2300), (W, 2300)], fill=tuple(round(c * 0.5) for c in lower), width=6)

    # 場景圖同牆面之間 160px 柔和過渡
    fade_h = 120
    for y in range(fade_h):
        t = y / fade_h
        row_art = art.crop((0, top_h - fade_h + y, W, top_h - fade_h + y + 1))
        row_wall = Image.new('RGB', (W, 1), wall_top)
        blended = Image.blend(row_art, row_wall, t)
        canvas.paste(blended, (0, top_h - fade_h + y))

    # 美術端預處理：高斯 10px、飽和 −30%（亮度 −10% 已喺 tint_image 套喺場景 / 檯面）
    canvas = canvas.filter(ImageFilter.GaussianBlur(10))
    canvas = ImageEnhance.Color(canvas).enhance(0.70)

    out = os.path.join(OUT, f'bg{stage}_far.webp')
    canvas.save(out, 'WEBP', quality=75, method=6)
    size = os.path.getsize(out)
    safe = canvas.crop((0, SAFE_TOP, W, SAFE_BOT)).resize((1, 1), Image.BOX).getpixel((0, 0))
    L = lstar(safe)
    print(f'stage {stage} {desc}: {size // 1024} KB  safeZone rgb={safe} L*={L:.1f}')
    if size > 200 * 1024:
        print('  WARNING: over 200 KB budget', file=sys.stderr)
    return {'id': stage, 'file': f'bg{stage}_far.webp', 'bytes': size, 'safeZoneRgb': list(safe), 'safeZoneL': round(L, 2), 'desc': desc}

def detect_flat_band(img):
    """搵出圖中最長一段「平坦」橫帶（每行水平變化細）。回傳 (start, end) 佔高度比例。"""
    # 「平坦」= 光亮（mean > 180）、水平變化細（sd < 26，容許柔和樹影）、上下變化細（dy < 12）
    small = img.convert('L').resize((32, 256), Image.BOX)
    px = small.load()
    flat = []
    for y in range(256):
        row = [px[x, y] for x in range(32)]
        mean = sum(row) / 32
        std = (sum((v - mean) ** 2 for v in row) / 32) ** 0.5
        prev = [px[x, y - 1] for x in range(32)] if y else row
        dy = sum(abs(a - b) for a, b in zip(row, prev)) / 32
        flat.append(mean > 180 and std < 26 and dy < 12)
    best, cur = (0, 0), None
    for y, f in enumerate(flat + [False]):
        if f and cur is None: cur = y
        if not f and cur is not None:
            if y - cur > best[1] - best[0]: best = (cur, y)
            cur = None
    return best[0] / 256, best[1] / 256

def build_full(stage, path, desc):
    """美術交付嘅整張直向背景：自動切成 場景 / 平坦帶 / 檯面 三段，對位到 0–670 / 670–1950 / 1950–2800。"""
    art = Image.open(path).convert('RGB')
    s = W / art.width
    art = art.resize((W, round(art.height * s)), Image.LANCZOS)
    a, b = detect_flat_band(art)
    Hs = art.height
    # 可用 sidecar 手動覆蓋：assets/bg/src/stage{N}.json  {"scene_end": 0.47, "counter_start": 0.77}
    side = os.path.splitext(path)[0] + '.json'
    if os.path.exists(side):
        with open(side, encoding='utf-8') as f:
            o = json.load(f)
        a, b = o.get('scene_end', a), o.get('counter_start', b)
    scene_end, counter_start = round(a * Hs), round(b * Hs)
    if counter_start - scene_end < Hs * 0.15:      # 偵測唔到就用預設比例
        a, b = 0.40, 0.74
        scene_end, counter_start = round(Hs * a), round(Hs * b)
    canvas = Image.new('RGB', (W, H))
    # 場景：底邊對齊 670。比 670+出血 高嘅話，先直向微縮（≤ 12%），仍然唔夠就裁頂
    scene = art.crop((0, 0, W, scene_end))
    limit = SAFE_TOP + BLEED
    if scene.height < SAFE_TOP:
        scene = scene.resize((W, SAFE_TOP), Image.LANCZOS)
    elif scene.height > limit and scene.height <= limit * 1.12:
        scene = scene.resize((W, limit), Image.LANCZOS)
    canvas.paste(scene, (0, SAFE_TOP - scene.height))
    # 平坦帶：直向拉伸填滿安全區（平面拉伸睇唔出）
    flat = art.crop((0, scene_end, W, counter_start)).resize((W, SAFE_BOT - SAFE_TOP), Image.LANCZOS)
    canvas.paste(flat, (0, SAFE_TOP))
    # 檯面：由 1950 起原大小放，餘下（多數喺出血區）用最底幾行嘅平均色填
    counter = art.crop((0, counter_start, W, Hs))
    canvas.paste(counter, (0, SAFE_BOT))
    y = SAFE_BOT + counter.height
    if y < H:
        base = art.crop((0, Hs - 24, W, Hs)).resize((1, 1), Image.BOX).getpixel((0, 0))
        canvas.paste(vgrad(W, H - y, base, tuple(round(c * 0.9) for c in base)), (0, y))
    # 整張圖含中景物件（車、木箱、盆栽），用 mid 層參數：高斯 3px、飽和 −15%
    canvas = canvas.filter(ImageFilter.GaussianBlur(3))
    canvas = ImageEnhance.Color(canvas).enhance(0.85)

    out = os.path.join(OUT, f'bg{stage}_far.webp')
    canvas.save(out, 'WEBP', quality=75, method=6)
    size = os.path.getsize(out)
    safe = canvas.crop((0, SAFE_TOP, W, SAFE_BOT)).resize((1, 1), Image.BOX).getpixel((0, 0))
    L = lstar(safe)
    print(f'stage {stage} {desc} [full art {os.path.basename(path)} flat {a:.2f}-{b:.2f}]: {size // 1024} KB  safeZone rgb={safe} L*={L:.1f}')
    if size > 200 * 1024:
        print('  WARNING: over 200 KB budget', file=sys.stderr)
    return {'id': stage, 'file': f'bg{stage}_far.webp', 'bytes': size, 'safeZoneRgb': list(safe), 'safeZoneL': round(L, 2), 'desc': desc, 'source': os.path.basename(path)}

def find_full_art(stage):
    """美術交付嘅整張圖放喺 assets/bg/src/stage{N}.jpg|png，有就優先用。"""
    for ext in ('png', 'jpg', 'jpeg', 'webp'):
        p = os.path.join(OUT, 'src', f'stage{stage}.{ext}')
        if os.path.exists(p): return p
    return None

manifest = []
for s in STAGES:
    full = find_full_art(s[0])
    manifest.append(build_full(s[0], full, s[4]) if full else build(*s))
with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
    json.dump({'width': W, 'height': H, 'bleed': BLEED, 'stages': manifest}, f, ensure_ascii=False, indent=1)
print('wrote manifest.json')
