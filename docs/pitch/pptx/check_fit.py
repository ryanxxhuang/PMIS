"""版面檢查:抓出跑到頁外、壓到頁尾、或表格會被 PowerPoint 撐高而爆出下緣的情形。

沒有 LibreOffice 可以逐頁算圖,所以改用兩層確定性檢查:
  1) 幾何:每個 shape 的 x/y/cx/cy 是否在版面內、有沒有壓到頁尾(6.88")
  2) 表格:pptxgenjs 寫進 XML 的 <a:tr h> 只是它的估值,PowerPoint 會依實際換行把列撐高。
     這裡用中日韓等寬(1 em)、拉丁 0.53 em 自行估算每格需要幾行,取較大者當該列高度,
     推算表格真正的下緣。
"""
import sys
import zipfile
from defusedxml import minidom

EMU = 914400.0
SLIDE_W, SLIDE_H = 13.333, 7.5
FOOTER_Y = 6.88          # 頁尾文字的上緣
PAD = 0.02

path = sys.argv[1]
z = zipfile.ZipFile(path)
slides = sorted((n for n in z.namelist()
                 if n.startswith("ppt/slides/slide") and n.endswith(".xml")),
                key=lambda n: int("".join(c for c in n if c.isdigit())))

def width_pt(s, size):
    return sum((1.0 if ord(c) > 0x2E80 else 0.53) for c in s) * size

problems = []

for n in slides:
    num = int("".join(c for c in n.split("/")[-1] if c.isdigit()))
    doc = minidom.parseString(z.read(n))
    boxes = []          # (x, y, w, h) 供表格重疊檢查

    # ── 1) 一般 shape 幾何 ──────────────────────────────────────────────
    for sp in doc.getElementsByTagName("p:spPr") + doc.getElementsByTagName("p:grpSpPr"):
        offs = sp.getElementsByTagName("a:off")
        exts = sp.getElementsByTagName("a:ext")
        if not offs or not exts:
            continue
        x = int(offs[0].getAttribute("x")) / EMU
        y = int(offs[0].getAttribute("y")) / EMU
        cx = int(exts[0].getAttribute("cx")) / EMU
        cy = int(exts[0].getAttribute("cy")) / EMU
        boxes.append((x, y, cx, cy))
        if x < -PAD or y < -PAD or x + cx > SLIDE_W + PAD or y + cy > SLIDE_H + PAD:
            problems.append(f"P{num:02d} 形狀超出版面: x={x:.2f} y={y:.2f} w={cx:.2f} h={cy:.2f}")
        # 頁尾那兩個文字框自己就在 6.94,略過
        if y + cy > FOOTER_Y + PAD and y < FOOTER_Y:
            problems.append(f"P{num:02d} 形狀壓到頁尾: 下緣 {y + cy:.2f}\" > {FOOTER_Y}\"")

    # ── 2) 表格實際高度 ────────────────────────────────────────────────
    for gf in doc.getElementsByTagName("p:graphicFrame"):
        off = gf.getElementsByTagName("a:off")[0]
        ty = int(off.getAttribute("y")) / EMU
        tbl = gf.getElementsByTagName("a:tbl")[0]
        cols = [int(c.getAttribute("w")) / EMU
                for c in tbl.getElementsByTagName("a:gridCol")]
        total = 0.0
        for tr in tbl.getElementsByTagName("a:tr"):
            declared = int(tr.getAttribute("h")) / EMU
            need = 0.0
            for i, tc in enumerate(tr.getElementsByTagName("a:tc")):
                if i >= len(cols):
                    break
                txt = "".join(t.firstChild.nodeValue or ""
                              for t in tc.getElementsByTagName("a:t") if t.firstChild)
                sizes = [int(r.getAttribute("sz")) / 100
                         for r in tc.getElementsByTagName("a:rPr") if r.getAttribute("sz")]
                size = max(sizes) if sizes else 10.5
                # 真實內距要從 a:tcPr 讀,否則調 pad 之後估值不會跟著動
                tcpr = tc.getElementsByTagName("a:tcPr")
                mt = mb = 45720          # PowerPoint 預設 0.05"
                ml = mr = 91440
                if tcpr:
                    g = tcpr[0].getAttribute
                    mt = int(g("marT") or mt); mb = int(g("marB") or mb)
                    ml = int(g("marL") or ml); mr = int(g("marR") or mr)
                usable = (cols[i] - (ml + mr) / EMU) * 72
                lines = max(1, -(-width_pt(txt, size) // usable))
                need = max(need, (lines * size * 1.32) / 72 + (mt + mb) / EMU)
            total += max(declared, need)
        tx = int(off.getAttribute("x")) / EMU
        tw = sum(cols)
        bottom = ty + total
        # 表格是自動長高的,最容易撞到下面手動擺的說明文字/卡片
        for (bx, by, bw, bh) in boxes:
            if by > 6.9:                       # 頁尾不算
                continue
            if bx < tx + tw and bx + bw > tx and by < bottom and by + bh > ty:
                problems.append(
                    f"P{num:02d} 表格(y {ty:.2f}–{bottom:.2f}) 與另一元素(y {by:.2f}–{by+bh:.2f}) 重疊")
        flag = "  ⚠️" if bottom > FOOTER_Y else ""
        print(f"P{num:02d} 表格 y={ty:.2f} 估高={total:.2f} 下緣={bottom:.2f}\"{flag}")
        if bottom > FOOTER_Y:
            problems.append(f"P{num:02d} 表格下緣 {bottom:.2f}\" 會壓到頁尾 ({FOOTER_Y}\")")

print()
if problems:
    print("❌ 需要修:")
    for p in problems:
        print("  " + p)
    sys.exit(1)
print("✅ 幾何與表格高度都在版面內")
