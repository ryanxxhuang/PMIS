#!/usr/bin/env python3
"""補上 <a:ea>／<a:cs>（中日韓與複雜文字字型）。

pptxgenjs 只寫 <a:latin>。PowerPoint 碰到中文時會改去查佈景主題的 minorFont/ea，
那一格是空的 → Windows 上會落到新細明體。這支逐一在 <a:latin .../> 後面補上
<a:ea typeface="微軟正黑體"/> 與 <a:cs typeface="微軟正黑體"/>。

用法：python3 fix_ea_fallback.py <in.pptx> <out.pptx>

※ 這是 repo 內 docs/pitch/pptx/fix_ea.py 的等價備援版本，行為相同；
   若能取用原檔，優先跑原檔以維持單一真相。
"""
import re
import shutil
import sys
import zipfile

EA = 'Noto Sans TC'
LATIN = re.compile(r'<a:latin\b[^>]*/>')
EA_TAG = re.compile(r'<a:ea typeface="[^"]*"')
CS_TAG = re.compile(r'<a:cs typeface="[^"]*"')
EA_EMPTY = re.compile(r'<a:ea\s*/>')
CS_EMPTY = re.compile(r'<a:cs\s*/>')


def patch_xml(xml: str) -> str:
    # ① 已經有 <a:ea>／<a:cs> 的（新版 pptxgenjs 會寫,但填的是 Arial）：換成產品字型
    xml = EA_TAG.sub('<a:ea typeface="%s"' % EA, xml)
    xml = CS_TAG.sub('<a:cs typeface="%s"' % EA, xml)
    # ② 佈景主題裡空的 <a:ea/>／<a:cs/>（PowerPoint 查不到就落到新細明體的元凶）
    xml = EA_EMPTY.sub('<a:ea typeface="%s"/>' % EA, xml)
    xml = CS_EMPTY.sub('<a:cs typeface="%s"/>' % EA, xml)
    # ③ 只有 <a:latin>、後面沒有 ea 的（舊版 pptxgenjs）：補上
    out = []
    pos = 0
    for m in LATIN.finditer(xml):
        out.append(xml[pos:m.end()])
        if '<a:ea' not in xml[m.end():m.end() + 60]:
            out.append('<a:ea typeface="%s"/><a:cs typeface="%s"/>' % (EA, EA))
        pos = m.end()
    out.append(xml[pos:])
    return ''.join(out)


def main(src: str, dst: str) -> None:
    shutil.copyfile(src, dst + '.tmp')
    patched = 0
    with zipfile.ZipFile(dst + '.tmp') as zin, \
            zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.startswith(('ppt/slides/slide', 'ppt/slideMasters/',
                                         'ppt/slideLayouts/', 'ppt/notesSlides/',
                                         'ppt/theme/')) \
                    and item.filename.endswith('.xml'):
                text = data.decode('utf-8')
                new = patch_xml(text)
                if new != text:
                    patched += 1
                data = new.encode('utf-8')
            zout.writestr(item, data)
    import os
    os.remove(dst + '.tmp')
    print('✓ %s　補了 %d 個 XML 的 <a:ea>／<a:cs>' % (dst, patched))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('用法：python3 fix_ea_fallback.py <in.pptx> <out.pptx>')
    main(sys.argv[1], sys.argv[2])
