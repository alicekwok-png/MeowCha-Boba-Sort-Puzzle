# tools/build-icon.py — App Icon 方向一「發光珍奶杯」（夜市奶茶 brief B2）程式繪製版 + 驗收 mock。
#   python tools/build-icon.py
# 輸出：
#   assets/icons/icon-1024.png（無 alpha、無圓角）、icon-512 / icon-192 / icon-512-maskable / apple-touch-icon / favicon-32 / favicon-64
#   ../design/icon/dir1-1024.png、dir1-48.png（48×48 驗收）、mock-dark.png / mock-light.png / mock-search.png（三種情境）
#   ../design/icon/alt-cat-1024.png（原本嘅摩卡頭像 icon，留返做 A/B）
# 規格（B1）：主體佔 70%、四邊 8% safe area、冇文字；三層色相距 117° / 122°，48px 下仍然三條色帶。
# 方向二（貓店長 + 杯）、方向三（夜市霓虹）要美術手繪，唔喺呢度出。

import os, math
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(os.path.dirname(ROOT), 'assets-raw')
ICONS = os.path.join(ROOT, 'assets', 'icons')
DESIGN = os.path.join(os.path.dirname(ROOT), 'design', 'icon')
os.makedirs(ICONS, exist_ok=True); os.makedirs(DESIGN, exist_ok=True)

S = 2                      # 超取樣倍率（2048 畫完縮 1024）
N = 1024 * S
NIGHT_TOP, NIGHT_BOT = (0x17, 0x10, 0x29), (0x2A, 0x1B, 0x47)
LANTERN = (0xFF, 0xB8, 0x4D)
MATCHA, TARO, CARAMEL = (0x5F, 0xF2, 0x9B), (0x9B, 0x6C, 0xFF), (0xFF, 0x8A, 0x3D)

def hsl_shift(rgb, dl):
    r, g, b = [c / 255 for c in rgb]
    mx, mn = max(r, g, b), min(r, g, b); l = (mx + mn) / 2
    if mx == mn: h = s = 0
    else:
        d = mx - mn; s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
        if mx == r: h = (g - b) / d + (6 if g < b else 0)
        elif mx == g: h = (b - r) / d + 2
        else: h = (r - g) / d + 4
        h /= 6
    l = max(0, min(1, l + dl))
    def h2(p, q, t):
        t %= 1
        if t < 1 / 6: return p + (q - p) * 6 * t
        if t < 1 / 2: return q
        if t < 2 / 3: return p + (q - p) * (2 / 3 - t) * 6
        return p
    if s == 0: R = G = B = l
    else:
        q = l * (1 + s) if l < 0.5 else l + s - l * s; p = 2 * l - q
        R, G, B = h2(p, q, h + 1 / 3), h2(p, q, h), h2(p, q, h - 1 / 3)
    return (round(R * 255), round(G * 255), round(B * 255))

def radial_bg():
    """背景：#2A1B47（中心）→ #171029（邊緣）徑向漸變"""
    img = Image.new('RGB', (N, N))
    px = img.load()
    cx, cy = N / 2, N * 0.48
    R = N * 0.72
    for y in range(N):
        for x in range(N):
            t = min(1, math.hypot(x - cx, y - cy) / R)
            t = t ** 1.3
            px[x, y] = tuple(round(NIGHT_BOT[i] + (NIGHT_TOP[i] - NIGHT_BOT[i]) * t) for i in range(3))
    return img

def glow(img, cx, cy, rx, ry, color, strength, blur):
    layer = Image.new('RGB', (N, N), (0, 0, 0))
    d = ImageDraw.Draw(layer)
    steps = 40
    for i in range(steps, 0, -1):
        f = i / steps
        a = (1 - f) ** 1.5 * strength
        d.ellipse([cx - rx * f, cy - ry * f, cx + rx * f, cy + ry * f], fill=tuple(round(c * a) for c in color))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    from PIL import ImageChops
    return ImageChops.add(img, layer)

def cup_geom():
    """3/4 視角珍奶杯：杯佔畫面 70%（安全區 8%）"""
    cx = N / 2
    top_y, bot_y = N * 0.20, N * 0.84
    top_w, bot_w = N * 0.50, N * 0.38
    ry_top, ry_bot = top_w * 0.17, bot_w * 0.15     # 橢圓透視
    return dict(cx=cx, top_y=top_y, bot_y=bot_y, top_w=top_w, bot_w=bot_w, ry_top=ry_top, ry_bot=ry_bot)

def width_at(g, y):
    t = (y - g['top_y']) / (g['bot_y'] - g['top_y'])
    return g['top_w'] + (g['bot_w'] - g['top_w']) * t

def ry_at(g, y):
    t = (y - g['top_y']) / (g['bot_y'] - g['top_y'])
    return g['ry_top'] + (g['ry_bot'] - g['ry_top']) * t

def body_mask(g, inset=0):
    m = Image.new('L', (N, N), 0)
    d = ImageDraw.Draw(m)
    cx = g['cx']
    tw, bw = g['top_w'] / 2 - inset, g['bot_w'] / 2 - inset
    d.polygon([(cx - tw, g['top_y']), (cx + tw, g['top_y']), (cx + bw, g['bot_y']), (cx - bw, g['bot_y'])], fill=255)
    d.ellipse([cx - tw, g['top_y'] - g['ry_top'] + inset, cx + tw, g['top_y'] + g['ry_top'] - inset], fill=255)
    d.ellipse([cx - bw, g['bot_y'] - g['ry_bot'] + inset, cx + bw, g['bot_y'] + g['ry_bot'] - inset], fill=255)
    return m

def liquid_layer(img, g, y0, y1, color, mask, below=None):
    """一層液體（y0 頂 → y1 底）+ 三件套：上緣高光線、下緣暗邊；液面橢圓較亮。below = 下面嗰層嘅色（畫佢嘅上緣高光弧）"""
    layer = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx = g['cx']
    w0, w1 = width_at(g, y0) / 2, width_at(g, y1) / 2
    # 側身漸變：左暗中亮右暗（分 24 條直帶）
    for i in range(24):
        f0, f1 = i / 24, (i + 1) / 24
        shade = -0.10 + 0.22 * math.sin(math.pi * (f0 + f1) / 2) ** 0.8
        col = hsl_shift(color, shade)
        d.polygon([(cx - w0 + 2 * w0 * f0, y0), (cx - w0 + 2 * w0 * f1, y0), (cx - w1 + 2 * w1 * f1, y1), (cx - w1 + 2 * w1 * f0, y1)], fill=col + (255,))
    # 下緣（底部橢圓前半）
    d.pieslice([cx - w1, y1 - ry_at(g, y1), cx + w1, y1 + ry_at(g, y1)], 0, 180, fill=hsl_shift(color, -0.05) + (255,))
    # 液面橢圓：+8% L
    d.ellipse([cx - w0, y0 - ry_at(g, y0), cx + w0, y0 + ry_at(g, y0)], fill=hsl_shift(color, 0.08) + (255,))
    # 上緣高光線：+20% L @80%，沿液面橢圓前緣
    lw = max(3, round(N * 0.004))
    d.ellipse([cx - w0, y0 - ry_at(g, y0), cx + w0, y0 + ry_at(g, y0)], outline=hsl_shift(color, 0.20) + (204,), width=lw)
    # 下緣暗邊：−18% L，只畫前半弧（後半喺液體後面）
    d.arc([cx - w1, y1 - ry_at(g, y1), cx + w1, y1 + ry_at(g, y1)], 0, 180, fill=hsl_shift(color, -0.18) + (255,), width=S * 2)
    # 下面嗰層嘅上緣高光弧（+20% L @80%）：緊貼暗邊下面，令每層都有自己嘅高光
    if below is not None:
        d.arc([cx - w1, y1 - ry_at(g, y1) + lw * 1.5, cx + w1, y1 + ry_at(g, y1) + lw * 1.5], 0, 180, fill=hsl_shift(below, 0.20) + (204,), width=lw)
    layer.putalpha(Image.composite(layer.getchannel('A'), Image.new('L', (N, N), 0), mask))
    img.paste(layer, (0, 0), layer)

def draw_icon():
    img = radial_bg()
    g = cup_geom()
    cx = g['cx']
    # 杯後光暈：暖光 + 三層液體色各自向外發光（「發光珍奶杯」）
    img = glow(img, cx, N * 0.52, N * 0.52, N * 0.56, LANTERN, 0.36, N * 0.02)
    img = glow(img, cx, N * 0.33, N * 0.44, N * 0.24, MATCHA, 0.45, N * 0.03)
    img = glow(img, cx, N * 0.55, N * 0.42, N * 0.22, TARO, 0.48, N * 0.03)
    img = glow(img, cx, N * 0.76, N * 0.40, N * 0.20, CARAMEL, 0.45, N * 0.03)
    # 杯底投影 #0D0820 45% blur
    sh = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([cx - g['bot_w'] * 0.62, g['bot_y'] - N * 0.02, cx + g['bot_w'] * 0.62, g['bot_y'] + N * 0.045], fill=(13, 8, 32, 150))
    sh = sh.filter(ImageFilter.GaussianBlur(N * 0.012))
    img = img.convert('RGBA'); img.alpha_composite(sh)

    mask = body_mask(g)
    inner = body_mask(g, inset=N * 0.006)
    # 玻璃杯身底色（極淡白）
    glass = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(glass).bitmap((0, 0), mask, fill=(255, 255, 255, 26))
    img.alpha_composite(glass)

    # 三層液體：底 焦糖橙 / 中 芋圓紫 / 頂 抹茶綠（由底畫起）
    ly0 = g['top_y'] + (g['bot_y'] - g['top_y']) * 0.12       # 液面（留少少杯口）
    ly1 = g['bot_y']
    h = ly1 - ly0
    bands = [(ly0 + h * 0.66, ly1, CARAMEL, None), (ly0 + h * 0.33, ly0 + h * 0.66, TARO, CARAMEL), (ly0, ly0 + h * 0.33, MATCHA, TARO)]
    for y0, y1, col, below in bands:
        liquid_layer(img, g, y0, y1, col, inner, below)

    # 珍珠：底部一排（深啡 + 高光）
    pd = ImageDraw.Draw(img)
    pr = N * 0.026
    py = g['bot_y'] - N * 0.035
    bw = g['bot_w'] / 2
    for i, fx in enumerate((-0.68, -0.36, -0.02, 0.32, 0.66)):
        px = cx + bw * fx * 0.92
        yy = py - (pr * 0.55 if i % 2 else 0)
        pd.ellipse([px - pr, yy - pr, px + pr, yy + pr], fill=(58, 30, 22, 235), outline=(30, 14, 12, 255), width=S)
        pd.ellipse([px - pr * 0.45, yy - pr * 0.55, px - pr * 0.05, yy - pr * 0.15], fill=(120, 80, 60, 200))

    # 左側垂直高光柱（8–12% 杯闊，白 25% → 0%）
    col = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    cd = ImageDraw.Draw(col)
    steps = 30
    for i in range(steps):
        f = i / steps
        a = round(64 * (1 - f))
        x0 = cx - g['top_w'] / 2 + g['top_w'] * (0.10 + 0.11 * f)
        x1 = cx - g['top_w'] / 2 + g['top_w'] * (0.10 + 0.11 * (f + 1 / steps))
        b0 = cx - g['bot_w'] / 2 + g['bot_w'] * (0.10 + 0.11 * f)
        b1 = cx - g['bot_w'] / 2 + g['bot_w'] * (0.10 + 0.11 * (f + 1 / steps))
        cd.polygon([(x0, g['top_y'] + g['ry_top']), (x1, g['top_y'] + g['ry_top']), (b1, g['bot_y']), (b0, g['bot_y'])], fill=(255, 255, 255, a))
    col.putalpha(Image.composite(col.getchannel('A'), Image.new('L', (N, N), 0), inner))
    img.alpha_composite(col)
    # 右下暖光反射 #FFB84D 15%
    warm = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    wd = ImageDraw.Draw(warm)
    for i in range(30, 0, -1):
        f = i / 30
        wd.ellipse([cx + g['bot_w'] * 0.1 - g['bot_w'] * 0.9 * f, g['bot_y'] - g['bot_w'] * 0.9 * f, cx + g['bot_w'] * 0.1 + g['bot_w'] * 0.9 * f, g['bot_y'] + g['bot_w'] * 0.9 * f], fill=LANTERN + (round(38 * (1 - f)),))
    warm.putalpha(Image.composite(warm.getchannel('A'), Image.new('L', (N, N), 0), inner))
    img.alpha_composite(warm)

    # 杯口 rim light：白 60%；杯身邊線淡白
    rd = ImageDraw.Draw(img)
    tw = g['top_w'] / 2
    rd.ellipse([cx - tw, g['top_y'] - g['ry_top'], cx + tw, g['top_y'] + g['ry_top']], outline=(255, 255, 255, 153), width=round(N * 0.006))
    rd.ellipse([cx - tw * 0.94, g['top_y'] - g['ry_top'] * 0.75, cx + tw * 0.94, g['top_y'] + g['ry_top'] * 0.75], outline=(255, 255, 255, 60), width=round(N * 0.003))
    bwh = g['bot_w'] / 2
    rd.line([(cx - tw, g['top_y']), (cx - bwh, g['bot_y'])], fill=(255, 255, 255, 110), width=round(N * 0.004))
    rd.line([(cx + tw, g['top_y']), (cx + bwh, g['bot_y'])], fill=(255, 255, 255, 70), width=round(N * 0.004))
    rd.arc([cx - bwh, g['bot_y'] - g['ry_bot'], cx + bwh, g['bot_y'] + g['ry_bot']], 0, 180, fill=(255, 255, 255, 90), width=round(N * 0.004))

    # 飲管：斜 15°，由杯口右側插入
    straw = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    sd = ImageDraw.Draw(straw)
    sw, sl = N * 0.045, N * 0.22
    sd.rounded_rectangle([cx - sw / 2, 0, cx + sw / 2, sl], radius=sw / 2, fill=(255, 214, 120, 255))
    sd.rectangle([cx - sw / 2, 0, cx - sw / 2 + sw * 0.3, sl], fill=(255, 235, 180, 255))
    sd.rectangle([cx + sw / 2 - sw * 0.25, 0, cx + sw / 2, sl], fill=(214, 160, 70, 255))
    straw = straw.rotate(-15, resample=Image.BICUBIC, center=(cx, sl))
    # 放置：飲管底落喺液面下面少少（被杯口遮住部分靠 mask 做「插入」感）
    dx, dy = round(N * 0.15), round(g['top_y'] - sl + N * 0.10)   # 飲管頂 ≈ 8% 位置，喺 safe area 內
    straw_pos = Image.new('RGBA', (N, N), (0, 0, 0, 0)); straw_pos.paste(straw, (dx, dy), straw)
    # 杯內部分：淡返（隔住液體 / 玻璃）
    inside = Image.composite(straw_pos, Image.new('RGBA', (N, N), (0, 0, 0, 0)), inner)
    outside = Image.composite(Image.new('RGBA', (N, N), (0, 0, 0, 0)), straw_pos, inner)
    inside.putalpha(inside.getchannel('A').point(lambda v: v * 0.35))
    img.alpha_composite(inside); img.alpha_composite(outside)

    out = img.convert('RGB').resize((1024, 1024), Image.LANCZOS)
    return out

def circle_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m

def rounded(img, radius):
    out = img.convert('RGBA'); out.putalpha(circle_mask(img.width, radius)); return out

def font(size):
    for p in ('C:/Windows/Fonts/msjhbd.ttc', 'C:/Windows/Fonts/msjh.ttc', 'C:/Windows/Fonts/arialbd.ttf'):
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def mock_list(icon, dark, path):
    """App 列表情境：五個 app 一行，三行，我哋嘅 icon 喺中間（背景深 / 淺）"""
    W, H = 1080, 720
    bg = (18, 18, 20) if dark else (242, 242, 247)
    fg = (240, 240, 245) if dark else (30, 30, 34)
    img = Image.new('RGB', (W, H), bg)
    d = ImageDraw.Draw(img)
    f = font(26)
    others = [(96, 96, 104), (70, 120, 200), (200, 80, 80), (80, 160, 110), (210, 170, 60), (140, 90, 190), (60, 60, 68)]
    k = 0
    for row in range(3):
        for col in range(5):
            x, y = 60 + col * 200, 60 + row * 230
            if row == 1 and col == 2:
                img.paste(rounded(icon.resize((120, 120), Image.LANCZOS), 27), (x, y), rounded(icon.resize((120, 120), Image.LANCZOS), 27))
                d.text((x + 60, y + 134), '喵喵茶記', fill=fg, font=f, anchor='mt')
            else:
                d.rounded_rectangle([x, y, x + 120, y + 120], radius=27, fill=others[k % len(others)]); k += 1
                d.text((x + 60, y + 134), 'App', fill=fg, font=f, anchor='mt')
    img.save(path)

def mock_search(icon, path):
    """搜尋結果情境：淺色列表，一行結果 = 64px icon + 標題 + 副標"""
    W, H = 1080, 420
    img = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for i in range(3):
        y = 40 + i * 120
        if i == 1:
            ic = rounded(icon.resize((96, 96), Image.LANCZOS), 22); img.paste(ic, (40, y), ic)
            d.text((160, y + 16), '喵喵茶記 Boba Cat', fill=(20, 20, 24), font=font(30))
            d.text((160, y + 58), '珍珠奶茶分類解謎', fill=(120, 120, 128), font=font(24))
        else:
            d.rounded_rectangle([40, y, 136, y + 96], radius=22, fill=(200, 200, 206))
            d.rectangle([160, y + 22, 560, y + 46], fill=(220, 220, 224))
            d.rectangle([160, y + 62, 420, y + 82], fill=(235, 235, 238))
        d.line([(40, y + 112), (W - 40, y + 112)], fill=(235, 235, 238), width=2)
    img.save(path)

if __name__ == '__main__':
    icon = draw_icon()
    icon.save(os.path.join(DESIGN, 'dir1-1024.png'))
    icon.save(os.path.join(ICONS, 'icon-1024.png'))
    # 48×48 驗收圖（放大 8× 方便睇）
    small = icon.resize((48, 48), Image.LANCZOS)
    small.save(os.path.join(DESIGN, 'dir1-48.png'))
    small.resize((384, 384), Image.NEAREST).save(os.path.join(DESIGN, 'dir1-48-zoom.png'))
    # 三種情境 mock
    mock_list(icon, True, os.path.join(DESIGN, 'mock-dark.png'))
    mock_list(icon, False, os.path.join(DESIGN, 'mock-light.png'))
    mock_search(icon, os.path.join(DESIGN, 'mock-search.png'))
    # 原本嘅摩卡頭像 icon 留返做 A/B
    old = os.path.join(RAW, 'app-icon.png')
    if os.path.exists(old):
        Image.open(old).convert('RGB').resize((1024, 1024), Image.LANCZOS).save(os.path.join(DESIGN, 'alt-cat-1024.png'))
    # Webapp icon 全套
    for size, name in ((512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png'), (64, 'favicon-64.png'), (32, 'favicon-32.png')):
        icon.resize((size, size), Image.LANCZOS).save(os.path.join(ICONS, name))
    # maskable：主體縮到 80%（safe zone 圓形），四邊補夜空色
    m = Image.new('RGB', (512, 512), NIGHT_TOP)
    inner = icon.resize((410, 410), Image.LANCZOS)
    m.paste(inner, (51, 51))
    m.save(os.path.join(ICONS, 'icon-512-maskable.png'))
    print('wrote icon set →', ICONS)
    print('wrote design mocks →', DESIGN)
