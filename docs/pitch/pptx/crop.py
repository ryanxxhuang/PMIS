"""把 shots.js 產出的整頁截圖裁成簡報要用的內容區。

為什麼要裁：整頁截圖含左側欄與頁首，貼進 16:9 的半版空間後，真正要看的內容
（待辦清單、義務時程、草稿收件匣…）只剩下巴掌大。裁掉重複的框架之後，同樣
寬度可以放大約 1.35 倍，投影機上才讀得到欄位名稱。

側欄那一張（sv-rail）反過來只留側欄——它在簡報上的用途是「工作面就是做事順序」，
內容區反而是雜訊。

用法（在 repo 根目錄）：
    node docs/pitch/pptx/shots.js     # 先重截，UI 一直在動
    python3 docs/pitch/pptx/crop.py
輸出：docs/pitch/shots-crop/*.png（build-2026.cjs 讀這裡，不讀原圖）

⚠️ 座標是對 1440x900 @2x（= 2880x1800）算的。改 shots.js 的 viewport 或
deviceScaleFactor 之後，下面每一組數字都要重算。
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'shots')
OUT = os.path.join(HERE, '..', 'shots-crop')

# 2880x1800 下：側欄右緣 x≈511、頁首下緣 y≈125
CROPS = {
    # 目標檔名: (來源檔名, left, top, right, bottom)
    'sv-dashboard':  ('sv-dashboard',  500, 120, 2880, 1560),
    'sv-contract':   ('sv-contract',   540, 250, 2860, 1720),
    'sv-agent':      ('sv-agent',      540, 120, 2880, 1560),
    'sv-agent-panel':('sv-agent',     2060, 300, 2880, 1780),
    'sv-quality':    ('sv-quality',    500, 120, 2880, 1400),
    'sv-valuation':  ('sv-valuation',  500, 120, 2880, 1400),
    'sv-itp':        ('sv-itp',        500, 120, 2880, 1400),
    'sv-submittals': ('sv-submittals', 500, 120, 2880, 1400),
    'ct-sitelog':    ('ct-sitelog',    500, 120, 2880, 1400),
    'ow-portfolio':  ('ow-portfolio',  500, 120, 2880, 1400),
    'ow-audit':      ('ow-audit',      500, 120, 2880, 1400),
    'sv-nav':        ('sv-nav',          0,   0, 2880, 1800),
    # 只留側欄（含展開的子頁）——簡報上用來講「六個工作面」
    'sv-rail':       ('sv-nav',          0,   0,  515, 1800),
}

os.makedirs(OUT, exist_ok=True)
for dst, (src, l, t, r, b) in CROPS.items():
    p = os.path.join(SRC, src + '.png')
    if not os.path.exists(p):
        print(f'✗ 缺 {src}.png —— 先跑 shots.js')
        continue
    im = Image.open(p).crop((l, t, r, b))
    im.save(os.path.join(OUT, dst + '.png'))
    print(f'✓ {dst:16s} {im.size[0]}x{im.size[1]}  aspect={im.size[0] / im.size[1]:.4f}')

print('\n⚠️ aspect 有變的話，build-2026.cjs 裡 shot() 的 dim 表要同步改，否則圖會被拉長。')
