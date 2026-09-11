#!/usr/bin/env python3
"""把產品標誌（assets/brand/pmis-mark.svg）算成去背 PNG，給簡報用。

為什麼不在 pptxgenjs 裡用線段畫：三角形的底邊是水平線（高度 0），
PowerPoint／LibreOffice 對零高度線段的處理不一致，會整條不見。
直接算成 PNG 最穩，而且幾何完全照 SVG 的 48 單位座標，不會走鐘。

用法：python3 brand_mark.py <輸出目錄>
產出：mark.png（全彩）、mark-mono.png（單色藍）
"""
import sys
import os
from PIL import Image, ImageDraw

SS = 8            # 超取樣倍率（先畫大再縮，邊緣才平滑）
SIZE = 256        # 輸出邊長
BLUE, RED, YELLOW, LINE = '#1a73e8', '#ea4335', '#fbbc04', '#dadce0'
P = {'top': (24, 12.4), 'br': (34.4, 30.4), 'bl': (13.6, 30.4)}


def render(path: str, dots=(BLUE, RED, YELLOW), line=LINE) -> None:
    n = SIZE * SS
    u = n / 48.0
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pts = [(P['top'][0] * u, P['top'][1] * u), (P['br'][0] * u, P['br'][1] * u),
           (P['bl'][0] * u, P['bl'][1] * u)]
    # stroke-linejoin="round"：用 polygon 外框 + 端點圓點模擬圓角接合
    d.line(pts + [pts[0]], fill=line, width=int(3 * u), joint='curve')
    r = 5.2 * u
    for (px, py), col in zip(pts, dots):
        d.ellipse([px - r, py - r, px + r, py + r], fill=col)
    im.resize((SIZE, SIZE), Image.LANCZOS).save(path)
    print('✓ ' + path)


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    render(os.path.join(out, 'mark.png'))
    render(os.path.join(out, 'mark-mono.png'), dots=(BLUE, BLUE, BLUE), line='#c5d9f7')
