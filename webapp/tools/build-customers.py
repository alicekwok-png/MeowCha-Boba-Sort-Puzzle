# tools/build-customers.py — 工單 #4 任務 2：四位食客 × 三表情嘅「原始半身圖」（唔要圓形裁切）。
#   python tools/build-customers.py
# 來源：assets-raw/ 白底 JPG（三個表情同一構圖：坐喺櫃檯線後面、只露上半身、正面）。
# 白底去背用較嚴嘅門檻（白毛食客邊緣），輸出 assets/customer-{N}-{mood}-body.webp（高 480px）。

import os, glob, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(os.path.dirname(ROOT), 'assets-raw')
A = os.path.join(ROOT, 'assets')

def raw(pattern):
    hits = glob.glob(os.path.join(RAW, pattern))
    if not hits: raise FileNotFoundError(pattern)
    return hits[0]

def keyout_white(im, tol=6):
    """純白底去背：只由邊界 flood fill 近白（≥ 249、低彩度）像素；白毛內部唔會被食（唔連邊界）。"""
    rgb = im.convert('RGB')
    a = np.asarray(rgb).astype(np.int16)
    H, W = a.shape[:2]
    cand = (a.min(2) >= 255 - tol) & ((a.max(2) - a.min(2)) <= 4)
    cm = Image.fromarray((cand * 255).astype(np.uint8), 'L').copy()
    for x in range(0, W, 16):
        for y in (0, H - 1):
            if cm.getpixel((x, y)) == 255: ImageDraw.floodfill(cm, (x, y), 128)
    for y in range(0, H, 16):
        for x in (0, W - 1):
            if cm.getpixel((x, y)) == 255: ImageDraw.floodfill(cm, (x, y), 128)
    bg = np.asarray(cm) == 128
    # 邊緣：由背景距離做 2px 柔邊
    alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(1.2))
    out = rgb.convert('RGBA'); out.putalpha(alpha)
    return out

def trim(im, pad=6):
    bb = im.getchannel('A').point(lambda v: 255 if v > 12 else 0).getbbox()
    return im.crop((max(0, bb[0] - pad), max(0, bb[1] - pad), min(im.width, bb[2] + pad), min(im.height, bb[3] + pad)))

# 1 貓（眼鏡圍巾） 2 兔 3 柴犬 4 熊（西裝）
SRC = {
    1: {'wait': '*neutral wait_552026838381203461.jpg', 'happy': '*delighted ex_552026760040030213.jpg', 'angry': '*impatient expr_552026722790432774.jpg'},
    2: {'wait': '*neutral wait_552026239371661318.jpg', 'happy': '*delighted ex_552027978212704262.jpg', 'angry': '*impatient expr_552026282375884800.jpg'},
    3: {'wait': '*neutral wait_552026183914610696.jpg', 'happy': '*delighted ex_552026135432663042.jpg', 'angry': '*impatient expr_552029929621028869.jpg'},
    4: {'wait': '*neutral wait_552020618060619779.jpg', 'happy': '*delighted ex_552020696531820552 (1).jpg', 'angry': '*impatient expr_552020736394534919.jpg'},
}
BODY_H = 480        # 「等待」表情嘅身體高度
CANVAS_H = 560      # 畫布高度（頂部留位畀心心 / 汗滴），底邊對齊櫃檯線
for cid, faces in SRC.items():
    ims = {mood: trim(keyout_white(Image.open(raw(pat)))) for mood, pat in faces.items()}
    scale = BODY_H / ims['wait'].height           # 同一角色三個表情用同一縮放
    scaled = {m: im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS) for m, im in ims.items()}
    cw = max(im.width for im in scaled.values())
    # 客人要一個一個企、唔可以疊：畫布只留中間 72%（頭 + 膊頭），兩側手 / 公事包裁走
    keep = int(cw * 0.72)
    for mood, im in scaled.items():
        full = Image.new('RGBA', (cw, CANVAS_H), (0, 0, 0, 0))
        full.alpha_composite(im, ((cw - im.width) // 2, max(0, CANVAS_H - im.height)))
        canvas = full.crop(((cw - keep) // 2, 0, (cw - keep) // 2 + keep, CANVAS_H))
        p = os.path.join(A, f'customer-{cid}-{mood}-body.webp')
        canvas.save(p, 'WEBP', quality=86, method=6)
        print(f'customer-{cid}-{mood}-body.webp {canvas.size} {os.path.getsize(p) // 1024} KB')

# 檢視表
files = sorted(glob.glob(os.path.join(A, 'customer-*-body.webp')))
S = 240
sheet = Image.new('RGB', (S * 6, S * 2 + 20), (70, 130, 80))
for i, f in enumerate(files):
    im = Image.open(f).convert('RGBA'); im.thumbnail((S, S))
    sheet.paste(im, ((i % 6) * S + (S - im.width) // 2, (i // 6) * (S + 10)), im)
sheet.save(os.path.join(os.environ.get('SCRATCH', ROOT), 'customers-body.png'))
