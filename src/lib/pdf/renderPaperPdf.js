// 繪圖指令 + 分頁計畫 → 真正的 PDF 位元組(pdf-lib)。
//
// 版面規則:
//   紙張本身的 padding 就是頁邊(施工日誌 12mm、佐證包 40px),整張紙等比縮到 A4 寬,
//   所以 A4、頁邊、欄寬一次到位,不必為每份文件各調一次。第二頁起同樣留這個頁邊,
//   跨頁的表格在頁首重印表頭,頁尾印「第 n 頁／共 m 頁」。
//
// 文字:同一列的字併成一個 run;量到的寬度若與內嵌字型的 advance 對得上就直接畫,
//   對不上(letter-spacing、字型後備、平台之間的捨入差異)則用 TJ 逐字給位移——
//   位置以畫面量到的為準,但仍是一段連續字串,複製貼上與全文檢索還原得回原文。
import { PDFDocument, PDFArray, PDFNumber, PDFOperator, PDFOperatorNames, rgb, setTextRenderingMode, TextRenderingMode, setLineWidth, setStrokingColor, setFillingColor, setFontAndSize, beginText, endText, setTextMatrix, pushGraphicsState, popGraphicsState, moveTo, lineTo, closePath, clip, endPath } from 'pdf-lib'
import { create as createFont } from 'fontkit'
import { planPages } from './paginate.js'
import { loadPdfFont, assertCharsCovered, PDF_FONT_PS_NAME } from './font.js'

const A4_W = 595.276 // 210mm
const A4_H = 841.89 // 297mm
const MIN_SIDE = 14 // ≈5mm
const MIN_TOP = 20
const MIN_BOTTOM = 34 // 留得下頁碼
const FOOTER_SIZE = 8
const DRIFT_TOLERANCE = 0.4 // px

// fontkit 2.0.4 的 subset 介面是 encode(),pdf-lib 1.17 呼叫的是 encodeStream()。
// 這層薄轉接只補這個差,不改任何子集化行為。
// (pdf-lib 自帶的 @pdf-lib/fontkit 會把 glyf 編壞——實測 B/D/P/X 等字整個印不出來,
//  所以改用上游 fontkit;restructure 另在 package.json overrides 釘 3.0.1,見該檔。)
function fontkitAdapter() {
  return {
    create(bytes, postscriptName) {
      const font = createFont(bytes, postscriptName)
      return new Proxy(font, {
        get(target, key) {
          if (key === 'createSubset') {
            return () => {
              const subset = target.createSubset()
              return {
                includeGlyph: (g) => subset.includeGlyph(g),
                encodeStream: () => {
                  const encoded = subset.encode()
                  const listeners = {}
                  const emitter = {
                    on(evt, cb) { (listeners[evt] ||= []).push(cb); return emitter },
                  }
                  queueMicrotask(() => {
                    listeners.data?.forEach((cb) => cb(encoded))
                    listeners.end?.forEach((cb) => cb())
                  })
                  return emitter
                },
              }
            }
          }
          const value = target[key]
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
  }
}

// TJ 的引數是一個陣列:字串與位移量交錯
function tjArray(context, items) {
  const array = PDFArray.withContext(context)
  for (const item of items) array.push(item)
  return array
}

function toColor(c, fallback) {
  if (!c || c.a < 0.05) return fallback
  return rgb(c.r, c.g, c.b)
}

// 照片載不回來就整份停掉:估驗佐證包少一張照片等於少一份證據,
// 給出「看起來完整、其實缺照片」的 PDF 比不給更糟。
// 訊息只帶照片說明,不帶簽名網址,也不把原始錯誤拼進中文(會搭便車外洩)。
async function embedImages(pdfDoc, images) {
  const bySrc = new Map()
  let seq = 0
  for (const op of images) {
    seq += 1
    if (!op.src || bySrc.has(op.src)) continue
    const label = op.alt ? op.alt.slice(0, 40) : `第 ${seq} 張`
    let bytes
    try {
      const res = await fetch(op.src)
      if (!res.ok) throw new Error('not ok')
      bytes = new Uint8Array(await res.arrayBuffer())
    } catch {
      throw new Error(`附件照片載入失敗（${label}），未下載 PDF，以免送出缺照片的文件。請確認連線後重試。`)
    }
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    if (!isJpg && !isPng) throw new Error(`附件照片格式不支援（${label}，僅支援 JPEG／PNG），未下載 PDF。`)
    bySrc.set(op.src, isJpg ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes))
  }
  return bySrc
}

// object-fit: cover 要裁切,PDF 沒有「填滿並裁切」,所以先設裁切路徑再把圖畫到格子外
function coverBox(op) {
  const { w, h, natural } = op
  if (op.fit !== 'cover' || !natural.w || !natural.h) return { x: op.x, y: op.y, w, h }
  const s = Math.max(w / natural.w, h / natural.h)
  const dw = natural.w * s
  const dh = natural.h * s
  return { x: op.x + (w - dw) / 2, y: op.y + (h - dh) / 2, w: dw, h: dh }
}

/**
 * @param {object} snapshot snapshotPaper() 的輸出
 * @param {object} meta { title, subject }
 * @returns {Promise<{bytes:Uint8Array, pageCount:number, forcedCuts:number}>}
 */
export async function renderPaperPdf(snapshot, meta = {}) {
  const { contentWidth, contentHeight, padding, ops, atoms, tables, images, usedChars } = snapshot
  const rootWidth = contentWidth + padding.left + padding.right

  let scale = A4_W / rootWidth
  let marginL = padding.left * scale
  let marginR = padding.right * scale
  if (Math.min(marginL, marginR) < MIN_SIDE) {
    scale = (A4_W - 2 * MIN_SIDE) / contentWidth
    marginL = MIN_SIDE
    marginR = MIN_SIDE
  }
  const marginT = Math.max(padding.top * scale, MIN_TOP)
  const marginB = Math.max(padding.bottom * scale, MIN_BOTTOM)
  const contentTopPt = A4_H - marginT
  const contentBottomPt = marginB
  const pageHeightPx = (contentTopPt - contentBottomPt) / scale

  const { pages, forcedCuts } = planPages(contentHeight, atoms, tables, pageHeightPx)

  const pdfDoc = await PDFDocument.create()
  pdfDoc.registerFontkit(fontkitAdapter())
  const fontBytes = await loadPdfFont()
  const font = await pdfDoc.embedFont(fontBytes, { subset: true, customName: PDF_FONT_PS_NAME })
  assertCharsCovered(font, usedChars)

  const imageBySrc = await embedImages(pdfDoc, images)

  pdfDoc.setTitle(meta.title || '工程文件')
  pdfDoc.setProducer('PMIS')
  pdfDoc.setCreator('PMIS')
  pdfDoc.setCreationDate(new Date())
  if (meta.subject) pdfDoc.setSubject(meta.subject)

  const black = rgb(0.11, 0.11, 0.12)
  const muted = rgb(0.34, 0.34, 0.35)

  const drawText = (page, op, y) => {
    const color = toColor(op.color, black)
    const bold = op.weight >= 600
    if (bold) {
      page.pushOperators(
        pushGraphicsState(),
        setTextRenderingMode(TextRenderingMode.FillAndOutline),
        setLineWidth(op.size * 0.035),
        setStrokingColor(color),
      )
    }
    const chars = [...op.text]
    const measured = op.right - op.x
    let natural = 0
    try { natural = font.widthOfTextAtSize(op.text, op.size) } catch { natural = measured }

    // ① 量到的寬度和內嵌字型的 advance 完全對得上:一次畫完,最省。
    if (Math.abs(measured - natural) <= DRIFT_TOLERANCE && chars.length === op.xs.length) {
      page.drawText(op.text, { x: marginL + op.x * scale, y, size: op.size * scale, font, color })
      if (bold) page.pushOperators(popGraphicsState())
      return
    }

    // ② 對不上就用 TJ:一個文字物件、一段連續字串,字與字之間放位移量。
    //    全站字級階梯本來就帶 letter-spacing、標題還有 tracking-widest,瀏覽器在不同平台
    //    對這些偏移的捨入也不同(CI 的 Linux 與本機 macOS 實測就不一樣),所以位置一律以
    //    畫面量到的為準、逐字給位移;但**不能拆成一個字一個 Tj**——那樣複製貼上與全文檢索
    //    會變成「公 共 工 程」。TJ 同時滿足「位置精確」與「仍是一段文字」。
    page.setFont(font)
    const [, fontKey] = page.getFont()
    const items = []
    for (let i = 0; i < chars.length; i++) {
      items.push(font.encodeText(chars[i]))
      const next = op.xs[i + 1]
      if (next == null) break
      const advance = font.widthOfTextAtSize(chars[i], op.size) || 0
      const gap = next - op.xs[i]
      // TJ 的數字是「往左移」,所以要往右多走就給負值;單位是 1/1000 em
      const adjust = ((advance - gap) * 1000) / op.size
      if (Math.abs(adjust) > 0.5) items.push(PDFNumber.of(Math.round(adjust * 100) / 100))
    }
    page.pushOperators(
      pushGraphicsState(),
      setFillingColor(color),
      setFontAndSize(fontKey, op.size * scale),
      beginText(),
      setTextMatrix(1, 0, 0, 1, marginL + op.x * scale, y),
      PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [tjArray(pdfDoc.context, items)]),
      endText(),
      popGraphicsState(),
    )
    if (bold) page.pushOperators(popGraphicsState())
  }

  const drawOps = (page, list, band, yOf) => {
    for (const op of list) {
      if (op.t === 'rect') {
        const top = Math.max(op.y, band.top)
        const bottom = Math.min(op.y + op.h, band.bottom)
        if (bottom - top <= 0.2) continue
        page.drawRectangle({
          x: marginL + op.x * scale, y: yOf(bottom),
          width: op.w * scale, height: (bottom - top) * scale,
          color: toColor(op.color, rgb(1, 1, 1)), borderWidth: 0,
        })
      } else if (op.t === 'line') {
        const horizontal = Math.abs(op.y1 - op.y2) < 0.2
        const color = toColor(op.color, muted)
        if (horizontal) {
          if (op.y1 < band.top - 0.6 || op.y1 > band.bottom + 0.6) continue
          page.drawLine({
            start: { x: marginL + op.x1 * scale, y: yOf(op.y1) },
            end: { x: marginL + op.x2 * scale, y: yOf(op.y1) },
            thickness: Math.max(op.width * scale, 0.3), color,
            dashArray: op.dashed ? [2, 2] : undefined,
          })
        } else {
          const top = Math.max(Math.min(op.y1, op.y2), band.top)
          const bottom = Math.min(Math.max(op.y1, op.y2), band.bottom)
          if (bottom - top <= 0.2) continue
          page.drawLine({
            start: { x: marginL + op.x1 * scale, y: yOf(top) },
            end: { x: marginL + op.x1 * scale, y: yOf(bottom) },
            thickness: Math.max(op.width * scale, 0.3), color,
            dashArray: op.dashed ? [2, 2] : undefined,
          })
        }
      } else if (op.t === 'image') {
        if (op.y < band.top - 0.6 || op.y + op.h > band.bottom + 0.6) continue
        const img = imageBySrc.get(op.src)
        if (!img) continue
        const box = coverBox(op)
        const cx = marginL + op.x * scale
        const cy = yOf(op.y + op.h)
        const cw = op.w * scale
        const ch = op.h * scale
        page.pushOperators(
          pushGraphicsState(),
          moveTo(cx, cy), lineTo(cx + cw, cy), lineTo(cx + cw, cy + ch), lineTo(cx, cy + ch), closePath(), clip(), endPath(),
        )
        page.drawImage(img, {
          x: marginL + box.x * scale, y: yOf(box.y + box.h),
          width: box.w * scale, height: box.h * scale,
        })
        page.pushOperators(popGraphicsState())
      } else if (op.t === 'text') {
        // 用「整行的中線」決定這行屬於哪一頁:文字方塊(ascent+descent=1.448em)常比
        // line-box 高,第一行會凸到內容框上緣之外,用邊界判定會被整行丟掉(標題消失)。
        const mid = (op.top + op.bottom) / 2
        if (mid < band.top || mid > band.bottom) continue
        drawText(page, op, yOf(op.baseline))
      }
    }
  }

  const headerIds = new Set(tables.map((t) => t.id))
  for (let i = 0; i < pages.length; i++) {
    const plan = pages[i]
    const page = pdfDoc.addPage([A4_W, A4_H])

    // ① 跨頁表格的表頭(重印在本頁最上面)
    let offset = 0
    for (const table of plan.headers) {
      const hOffset = offset
      const headOps = ops.filter((op) => op.theadId === table.id)
      const band = { top: table.headTop - 0.6, bottom: table.headBottom + 0.6 }
      drawOps(page, headOps, band, (px) => contentTopPt - (hOffset + (px - table.headTop)) * scale)
      offset += table.headBottom - table.headTop
    }

    // ② 本頁內容
    const bodyTop = contentTopPt - plan.headerHeight * scale
    // 第一頁往上、最後一頁往下不設界:行高造成的溢出(標題的字框高過 line-box)不該被裁掉
    const band = {
      top: i === 0 ? -1e6 : plan.top,
      bottom: i === pages.length - 1 ? 1e6 : plan.bottom,
    }
    const body = plan.headers.length
      ? ops.filter((op) => !(op.theadId && headerIds.has(op.theadId) && plan.headers.some((t) => t.id === op.theadId)))
      : ops
    drawOps(page, body, band, (px) => bodyTop - (px - plan.top) * scale)

    // ③ 頁尾頁碼:多頁文件送到機關一定要看得出份數是否齊全
    const label = `第 ${i + 1} 頁／共 ${pages.length} 頁`
    const w = font.widthOfTextAtSize(label, FOOTER_SIZE)
    page.drawText(label, { x: (A4_W - w) / 2, y: Math.max(12, marginB - 16), size: FOOTER_SIZE, font, color: muted })
  }

  const bytes = await pdfDoc.save({ useObjectStreams: false })
  return { bytes, pageCount: pages.length, forcedCuts }
}
