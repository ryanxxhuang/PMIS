"""補上東亞字型(ea)與複雜文字字型(cs)。

pptxgenjs 的 fontFace 只寫 <a:latin>,PowerPoint 遇到中日韓字元會改查佈景主題的
minorFont/ea——那格是空的,就落到系統預設(Windows 上常是新細明體,難看)。
所以逐一在 <a:latin> 後面插入 ea/cs,並把佈景主題的 ea 也設好。

字型選擇:Latin 走 Arial(數字、法規條號),中日韓走 Microsoft JhengHei(微軟正黑體)
——Windows Office 標配;Mac 若沒有會自動替換成 PingFang/黑體,不影響版面(中日韓等寬)。
"""
import re
import shutil
import sys
import zipfile

EA = "Microsoft JhengHei"
src, dst = sys.argv[1], sys.argv[2]

zin = zipfile.ZipFile(src)
names = zin.namelist()
out = {}

latin_re = re.compile(r'<a:latin typeface="([^"]*)"([^/>]*)/>')

for name in names:
    data = zin.read(name)
    if name.endswith(".xml") and ("/slides/" in name or "/theme/" in name
                                  or "/slideLayouts/" in name or "/slideMasters/" in name
                                  or "/notesSlides/" in name):
        txt = data.decode("utf-8")

        # 1) 每個 <a:latin> 後面補 ea/cs。
        #    佈景主題例外:a:majorFont/a:minorFont 的 schema 是 latin→ea→cs→font*,
        #    那裡本來就有 ea/cs,再插一組會變成 latin,ea,cs,ea,cs 而違反 XSD。
        if "/theme/" not in name:
            def add(m):
                return m.group(0) + f'<a:ea typeface="{EA}"/><a:cs typeface="{EA}"/>'
            txt = latin_re.sub(add, txt)
            txt = re.sub(r'(<a:ea typeface="[^"]*"/>)\s*<a:ea typeface="[^"]*"/>', r"\1", txt)
            txt = re.sub(r'(<a:cs typeface="[^"]*"/>)\s*<a:cs typeface="[^"]*"/>', r"\1", txt)

        # 2) 佈景主題本身的空 ea 也要填,否則未指定字型的元素還是會落回預設
        txt = txt.replace('<a:ea typeface=""/>', f'<a:ea typeface="{EA}"/>')
        data = txt.encode("utf-8")
    out[name] = data

zout = zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED)
for name in names:
    zout.writestr(name, out[name])
zout.close()
zin.close()

n = sum(1 for k, v in out.items() if b"<a:ea" in v)
print(f"完成:{dst}（{n} 個 part 已設定東亞字型 {EA}）")
