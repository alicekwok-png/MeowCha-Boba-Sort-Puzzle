# [已廢棄 2026-09-05] 珍奶杯貼圖幾何已由 vessels.json（tools/build-assets-v2.py 自動量度）取代。
# tools/extract-cup.py — 由真透明 PNG 出遊戲杯貼圖 + 液體區域幾何。
#   python tools/extract-cup.py
# 來源：assets-raw/cup-transparent.png（美術已去背，膠身半透明）
# 輸出：assets/cup-body.webp（裁邊、512px 高）、assets/cup-geom.json（杯內液體四角 / 杯口位置，比例值）
#       $SCRATCH/cup-debug.png（幾何紅框 + 模擬液體）

import os, json, shutil, glob
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(os.path.dirname(ROOT), 'assets-raw')
A = os.path.join(ROOT, 'assets')
SCRATCH = os.environ.get('SCRATCH', ROOT)
SRC = os.path.join(RAW, 'cup-transparent.png')
if not os.path.exists(SRC):
    # 首次：美術存做 副本 (11).png，複製成穩定檔名
    cand = [f for f in glob.glob(os.path.join(RAW, 'One quiet cup*')) if '(11)' in f]
    if cand: shutil.copy(cand[0], SRC)
im = Image.open(SRC).convert('RGBA')
al = np.asarray(im.getchannel('A'))
bb = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
cup = im.crop(bb)
W, H = cup.size
a = np.asarray(cup.getchannel('A'))
print('bbox', bb, 'size', W, H, 'aspect', round(W / H, 4))

def solid_span(fy, thr=200):
    row = a[int(H * fy)]
    nz = np.nonzero(row > thr)[0]
    return (nz.min() / W, nz.max() / W) if len(nz) else (0, 1)

# 杯口：由頂部搵第一行有實色（杯沿）嘅 y；杯沿橢圓下緣 ≈ 頂部 + 杯闊 × 0.12
top_rows = np.nonzero((a > 200).any(1))[0]
rim_top = top_rows.min() / H
rim_h = 0.10 * W / H                      # 杯沿橢圓總高（比例）
rimY = rim_top + rim_h / 2
topY = rim_top + rim_h                    # 液體最高可到杯沿下緣
botY = 0.94                               # 杯底（珍珠層上面少少）
tl, tr = solid_span(topY + 0.02)
bl, br = solid_span(botY)
wall = 0.028
geom = {
    'aspect': round(W / H, 4),
    'inner': {'topY': round(topY, 4), 'botY': round(botY, 4),
              'topL': round(tl + wall, 4), 'topR': round(tr - wall, 4),
              'botL': round(bl + wall, 4), 'botR': round(br - wall, 4)},
    'rimY': round(rimY, 4), 'rimRx': round((tr - tl) / 2 + 0.02, 4), 'rimRy': round(rim_h / 2, 4),
}
print(json.dumps(geom))

out = cup.copy(); out.thumbnail((512, 512), Image.LANCZOS)
out.save(os.path.join(A, 'cup-body.webp'), 'WEBP', quality=88, method=6)
print('cup-body.webp', out.size, os.path.getsize(os.path.join(A, 'cup-body.webp')) // 1024, 'KB')
with open(os.path.join(A, 'cup-geom.json'), 'w', encoding='utf-8') as f:
    json.dump(geom, f, indent=1)

# ---- 除錯圖 ----
w, h = out.size
g = geom['inner']
dbg = Image.new('RGBA', (w * 3 + 40, h + 20), (70, 130, 80, 255))
dbg.alpha_composite(out, (10, 10))
d = ImageDraw.Draw(dbg)
d.polygon([(10 + g['topL'] * w, 10 + g['topY'] * h), (10 + g['topR'] * w, 10 + g['topY'] * h),
           (10 + g['botR'] * w, 10 + g['botY'] * h), (10 + g['botL'] * w, 10 + g['botY'] * h)], outline=(255, 0, 0, 255), width=3)
d.ellipse([10 + (0.5 - geom['rimRx']) * w, 10 + (geom['rimY'] - geom['rimRy']) * h, 10 + (0.5 + geom['rimRx']) * w, 10 + (geom['rimY'] + geom['rimRy']) * h], outline=(0, 0, 255, 255), width=2)
def sim(colors):
    s = Image.new('RGBA', (w, h), (0, 0, 0, 0)); sd = ImageDraw.Draw(s)
    span = (g['botY'] - g['topY']) * h; slot = span / 4
    def xat(y, side):
        t = (g['botY'] * h - y) / span
        return (g['botL'] + (g['topL'] - g['botL']) * t if side == 'L' else g['botR'] + (g['topR'] - g['botR']) * t) * w
    for i, col in enumerate(colors):
        y2 = g['botY'] * h - i * slot; y1 = y2 - slot
        sd.polygon([(xat(y1, 'L'), y1), (xat(y1, 'R'), y1), (xat(y2, 'R'), y2), (xat(y2, 'L'), y2)], fill=col)
    s.alpha_composite(out)
    return s
dbg.alpha_composite(sim([(230, 170, 43, 255), (72, 99, 177, 255), (215, 72, 103, 255)]), (20 + w, 10))
dbg.alpha_composite(sim([(47, 43, 44, 255), (47, 43, 44, 255), (47, 43, 44, 255), (47, 43, 44, 255)]), (30 + 2 * w, 10))
dbg.save(os.path.join(SCRATCH, 'cup-debug.png'))
print('debug written')
