# 只留指定的一頁,做成單頁 pptx —— QuickLook 只畫第一頁,靠這支就能逐頁目視檢查
import sys, zipfile, shutil, re
src, out, keep = sys.argv[1], sys.argv[2], int(sys.argv[3])
zin = zipfile.ZipFile(src); names = zin.namelist()
pres = zin.read('ppt/presentation.xml').decode()
ids = re.findall(r'<p:sldId [^>]*/>', pres)
assert 1 <= keep <= len(ids), f'只有 {len(ids)} 頁'
newlst = ids[keep-1]
pres2 = re.sub(r'(<p:sldIdLst>).*?(</p:sldIdLst>)', lambda m: m.group(1)+newlst+m.group(2), pres, flags=re.S)
zo = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
for n in names:
    zo.writestr(n, pres2.encode() if n == 'ppt/presentation.xml' else zin.read(n))
zo.close(); print(f'{out}: 只留第 {keep} 頁')
