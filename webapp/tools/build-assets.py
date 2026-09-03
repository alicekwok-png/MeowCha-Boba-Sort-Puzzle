# tools/build-assets.py — 由 assets-raw/ 生成全部遊戲素材（WebP）。
#   python tools/build-assets.py
# 包括：公司 logo、字標、摩卡六姿勢 + 待機三幀、四位食客 × 三表情頭像、杯種、背景（另見 build-bg.py）。
# 假格仔底 / 純白底會自動去背（取圖角顏色做 key，邊界 flood fill + 封閉區域補填）。

import os, glob, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(os.path.dirname(ROOT), 'assets-raw')
A = os.path.join(ROOT, 'assets')
os.makedirs(A, exist_ok=True)
FONT_B = 'C:/Windows/Fonts/msjhbd.ttc'
CREAM = (255, 247, 234)

def raw(pattern):
    hits = glob.glob(os.path.join(RAW, pattern))
    if not hits: raise FileNotFoundError(pattern)
    return hits[0]

# ---------------- 去背 ----------------
def keyout(im, tol=10):
    """假格仔底 / 純白底 → RGBA。背景色由四角取樣（最多兩種），低彩度先算背景。"""
    if im.mode == 'RGBA' and np.asarray(im.getchannel('A')).min() < 250:
        return im  # 已經有真透明
    rgb = im.convert('RGB')
    a = np.asarray(rgb).astype(np.int16)
    H, W = a.shape[:2]
    corners = np.concatenate([a[:32, :32].reshape(-1, 3), a[:32, -32:].reshape(-1, 3), a[-32:, :32].reshape(-1, 3), a[-32:, -32:].reshape(-1, 3)])
    q = (corners // 6) * 6
    vals, counts = np.unique(q, axis=0, return_counts=True)
    keys = vals[np.argsort(-counts)][:2] + 3
    chroma = a.max(2) - a.min(2)
    cand = np.zeros((H, W), bool)
    for k in keys:
        cand |= (np.abs(a - k).max(2) <= tol)
    cand &= chroma <= 14
    cm = Image.fromarray((cand * 255).astype(np.uint8), 'L').copy()
    for x in range(0, W, 24):
        for y in (0, H - 1):
            if cm.getpixel((x, y)) == 255: ImageDraw.floodfill(cm, (x, y), 128)
    for y in range(0, H, 24):
        for x in (0, W - 1):
            if cm.getpixel((x, y)) == 255: ImageDraw.floodfill(cm, (x, y), 128)
    rem = Image.fromarray(((np.asarray(cm) == 255) * 255).astype(np.uint8), 'L').copy()
    seeds = rem.filter(ImageFilter.MinFilter(15))
    sy, sx = np.nonzero(np.asarray(seeds) == 255)
    for y, x in zip(sy[::7], sx[::7]):
        if cm.getpixel((int(x), int(y))) == 255: ImageDraw.floodfill(cm, (int(x), int(y)), 128)
    bg = np.asarray(cm) == 128
    alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8), 'L').filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.0))
    out = rgb.convert('RGBA'); out.putalpha(alpha)
    return out

def trim(im, pad=4):
    bb = im.getchannel('A').point(lambda v: 255 if v > 10 else 0).getbbox()
    if not bb: return im
    return im.crop((max(0, bb[0] - pad), max(0, bb[1] - pad), min(im.width, bb[2] + pad), min(im.height, bb[3] + pad)))

def save(img, name, q=84):
    p = os.path.join(A, name)
    img.save(p, 'WEBP', quality=q, method=6)
    print(f'{name:30s} {img.size[0]:4d}x{img.size[1]:<4d} {os.path.getsize(p) // 1024:4d} KB')

def sprite(path, size, name):
    im = trim(keyout(Image.open(path)))
    im.thumbnail((size, size), Image.LANCZOS)
    save(im, name)
    return im

# ---------------- 公司 logo / 字標 ----------------
logo = trim(Image.open(raw('Logo去背.PNG')).convert('RGBA'))
logo.thumbnail((800, 800), Image.LANCZOS)
save(logo, 'company-logo.webp', q=90)

W, H = 900, 300
wm = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(wm)
f1, f2 = ImageFont.truetype(FONT_B, 150), ImageFont.truetype(FONT_B, 40)
tw = d.textlength('喵喵茶記', font=f1); x = (W - tw) / 2
d.text((x, 28), '喵喵茶記', font=f1, fill=(232, 199, 154))
d.text((x, 24), '喵喵茶記', font=f1, fill=(255, 255, 255))
d.text((x, 20), '喵喵茶記', font=f1, fill=(92, 58, 20))
tw2 = d.textlength('Boba Cat · 珍珠奶茶分類', font=f2)
d.text(((W - tw2) / 2, 215), 'Boba Cat · 珍珠奶茶分類', font=f2, fill=(210, 116, 63))
save(wm, 'meowcha-wordmark.webp')

# ---------------- 摩卡 ----------------
MOCHA = {
    'idle':    '*參考呢個風格*552028500705546243.jpg',
    'pouring': '*cat barista_552030451677663240.jpg',
    'serve':   '*cat barista_552030480685424643.jpg',
    'stuck':   '*cat barista_552030512297902080.jpg',
    'clear':   '*cat barista_552030561329315848.jpg',
    'almost':  '*cat barista_552037205870243845.jpg',
}
mocha = {}
for k, pat in MOCHA.items():
    mocha[k] = sprite(raw(pat), 512, f'mocha-{k}.webp')

# 頭像（圓形）
im = mocha['idle']; w, h = im.size
r = int(w * 0.36); cx, cy = w // 2, int(h * 0.27)
crop = Image.new('RGBA', (2 * r, 2 * r), CREAM + (255,)); crop.alpha_composite(im.crop((cx - r, cy - r, cx + r, cy + r)))
mask = Image.new('L', crop.size, 0); ImageDraw.Draw(mask).ellipse((0, 0, crop.width - 1, crop.height - 1), fill=255)
crop.putalpha(mask); crop = crop.resize((256, 256), Image.LANCZOS)
save(crop, 'mocha-avatar.webp')

# 待機三幀（400px，呼吸 + 微傾）
base = mocha['idle'].copy(); base.thumbnail((400, 400), Image.LANCZOS)
bw, bh = base.size
def frame(sx, sy, rot):
    im = base.resize((round(bw * sx), round(bh * sy)), Image.LANCZOS).rotate(rot, resample=Image.BICUBIC)
    out = Image.new('RGBA', (bw + 16, bh + 8), (0, 0, 0, 0))
    out.alpha_composite(im, (round((out.width - im.width) / 2), out.height - im.height))
    return out
save(frame(1.00, 1.00, 0), 'mocha-idle-01.webp')
save(frame(1.02, 0.975, 0), 'mocha-idle-02.webp')
save(frame(1.01, 0.99, 1.5), 'mocha-idle-03.webp')

# ---------------- 四位食客 × 三表情 ----------------
# 1 貓（眼鏡圍巾） 2 兔 3 柴犬 4 熊（西裝）
CUSTOMERS = {
    1: {'wait': 'One quiet cup. Every morning. 副本 (12).png', 'happy': '*delighted ex_552026760040030213.jpg', 'angry': '*impatient expr_552026722790432774.jpg'},
    2: {'wait': 'One quiet cup. Every morning. 副本 (14).png', 'happy': '*delighted ex_552027978212704262.jpg', 'angry': '*impatient expr_552026282375884800.jpg'},
    3: {'wait': 'dog.png',                                    'happy': '*delighted ex_552026135432663042.jpg', 'angry': '*impatient expr_552029929621028869.jpg'},
    # 熊嘅透明等待圖原檔已被覆蓋成杯（副本 (11).png），customer-4-wait.webp 沿用已生成版本
    4: {'wait': 'bear-wait.png', 'happy': '*delighted ex_552020696531820552 (1).jpg', 'angry': '*impatient expr_552020736394534919.jpg'},
}
def avatar(im):
    """頭部圓形頭像：以去背後 bbox 定位（頭喺上方），奶白底圓，256px。"""
    im = trim(keyout(im))
    w, h = im.size
    side = int(w * 0.82)
    cx, cy = w // 2, int(h * 0.40)
    box = (cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2)
    disc = Image.new('RGBA', (side, side), CREAM + (255,))
    disc.alpha_composite(im.crop(box))
    mask = Image.new('L', (side, side), 0); ImageDraw.Draw(mask).ellipse((0, 0, side - 1, side - 1), fill=255)
    disc.putalpha(mask.filter(ImageFilter.GaussianBlur(0.8)))
    return disc.resize((256, 256), Image.LANCZOS)
for cid, faces in CUSTOMERS.items():
    for mood, pat in faces.items():
        try:
            src = raw(pat)
        except FileNotFoundError:
            print(f'customer-{cid}-{mood}: source {pat} missing, keeping existing webp')
            continue
        save(avatar(Image.open(src)), f'customer-{cid}-{mood}.webp')

# ---------------- 杯種（教學畫面用） ----------------
# 新嘅白磨砂杯（白底白杯）同透明有蓋杯（膠身透出格仔）去唔到背，教學畫面沿用舊素材
sprite(raw('legacy/cup-frosted.png'), 320, 'cup-frosted.webp')                 # 磨砂杯（舊素材，已去背）
sprite(raw('legacy/cup-full.png'), 320, 'cup-full.webp')                       # 普通杯（舊素材，已去背）
sprite(raw('*transparent_552031458084114438.jpg'), 320, 'cup-takeaway.webp')   # 杯套外帶杯（新）
sprite(raw('legacy/cup-sealed.png'), 320, 'cup-sealed.webp')                   # 封膜杯（舊素材，已去背）

# 舊 PNG 清走（全部已有 WebP 版本）
for p in glob.glob(os.path.join(A, '*.png')):
    os.remove(p)
print('done')
