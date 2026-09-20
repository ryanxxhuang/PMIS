#!/usr/bin/env bash
# 產生 src/assets/fonts/NotoSansTC-Regular-pmis.ttf(PDF 下載用的中文內嵌字型)。
#
# 為什麼要另外 vendor 一份字型,不直接用畫面上的 @fontsource-variable/noto-sans-tc:
#   PDF 內嵌字型必須是「可子集化的 sfnt」。fontsource 出的是 WOFF2 切片,fontkit 讀得到輪廓,
#   但 createSubset() 的 glyf 會編成空的(實測:子集後 path 長度 0),PDF 開起來整頁空白。
#   WOFF2 的 glyf 是 transform 過的,子集器拿原始位元組重組會壞;OTF/CFF 走 pdf-lib 的
#   CFF 子集化則會被 poppler 判「Embedded font file may be invalid」。所以這裡固定用
#   **靜態實例化過的 TrueType(glyf)**。
#
# 這支腳本只在「要換字型／補字」時手動跑一次,產物進版控(見同目錄 README)。
# 需求:python3 + fonttools(pip install 'fonttools[woff]')、curl、網路。
set -euo pipefail

SRC_URL="https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf"
OFL_URL="https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/OFL.txt"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/src/assets/fonts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "→ 下載 Noto Sans TC 可變字型與 OFL 授權"
curl -sSLf -o "$WORK/src.ttf" "$SRC_URL"
curl -sSLf -o "$OUT_DIR/OFL.txt" "$OFL_URL"

# 1) 實例化到 wght=400。可變字型的預設實例是 Thin(100),不實例化會印出髮絲字。
echo "→ 實例化 wght=400"
python3 -m fontTools.varLib.instancer "$WORK/src.ttf" wght=400 -o "$WORK/reg.ttf" >/dev/null

# 2) 子集到「產品實際可能出現的字」:ASCII、常用標點、全形、注音、CJK 統一表意文字全區。
#    刻意不縮到 Big5 常用字——人名／地名的罕用字印成豆腐格對送審文件是硬傷。
#    丟掉 GSUB/GPOS:PDF 這一側不做 shaping/kerning,畫面量測端也關掉(font-kerning: none),
#    兩邊都用純 advance width,位置才對得起來。
echo "→ 子集化"
python3 -m fontTools.subset "$WORK/reg.ttf" \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2000-206F,U+2070-209F,U+20A0-20BF,U+2100-214F,U+2150-218F,U+2190-21FF,U+2200-22FF,U+2460-24FF,U+2500-257F,U+25A0-25FF,U+2600-26FF,U+2700-27BF,U+2E80-2EFF,U+3000-303F,U+3040-30FF,U+3100-312F,U+31C0-31EF,U+3200-33FF,U+3400-4DBF,U+4E00-9FFF,U+F900-FAFF,U+FE10-FE1F,U+FE30-FE4F,U+FF00-FFEF" \
  --layout-features='' --no-hinting --notdef-outline --recalc-bounds \
  --drop-tables+=DSIG,LTSH,VDMX,hdmx,kern,GSUB,GPOS,GDEF,BASE,MATH,STAT,gasp,vhea,vmtx \
  --output-file="$WORK/sub.ttf" >/dev/null

# 3) 改名:這是實例化＋子集化過的衍生版本,名稱要誠實(OFL 的保留字是 'Source',不是 Noto)。
echo "→ 改寫 name 表"
python3 - "$WORK/sub.ttf" "$OUT_DIR/NotoSansTC-Regular-pmis.ttf" <<'PY'
import sys
from fontTools.ttLib import TTFont
src, dst = sys.argv[1], sys.argv[2]
f = TTFont(src)
name = f['name']
FAMILY, PS = 'Noto Sans TC PMIS Subset', 'NotoSansTC-PMISSubset-Regular'
for rec in list(name.names):
    if rec.nameID == 1: rec.string = FAMILY
    elif rec.nameID == 2: rec.string = 'Regular'
    elif rec.nameID == 4: rec.string = FAMILY + ' Regular'
    elif rec.nameID == 6: rec.string = PS
    elif rec.nameID == 16: name.names.remove(rec)
    elif rec.nameID == 17: name.names.remove(rec)
f.save(dst)
print('numGlyphs', f['maxp'].numGlyphs, 'cmap', len(f.getBestCmap()))
PY

ls -l "$OUT_DIR"
