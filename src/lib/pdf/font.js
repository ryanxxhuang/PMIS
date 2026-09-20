// PDF 下載用的中文字型:一次抓、兩邊用。
//
// 同一份位元組要做兩件事:
//   ① 用 FontFace 註冊給瀏覽器,離畫面量測時強制用它排版;
//   ② 交給 pdf-lib 子集化後內嵌進 PDF。
// 兩邊同一支字型,量到的位置才等於印出來的位置。所以只下載一次,快取在模組層。
//
// 為什麼不是畫面在用的 @fontsource-variable/noto-sans-tc:
//   那是 105 片 WOFF2 切片,fontkit 讀得到輪廓但子集化會編出空的 glyf(實測 path 長度 0),
//   PDF 開起來整頁空白;而且可變字型的預設實例是 Thin(100),不實例化會印出髮絲字。
//   這裡用的是 scripts/vendor-pdf-font.sh 產的「實例化到 400 + 子集到實用字集」的靜態 TrueType。
//   體積 5.4 MB,只有按下「下載 PDF」才抓,/assets/* 是 immutable 快取且邊緣會壓縮(見 public/_headers)。
import fontUrl from '../../assets/fonts/NotoSansTC-Regular-pmis.ttf?url'

export const PDF_FONT_FAMILY = 'PMIS PDF Han'
export const PDF_FONT_PS_NAME = 'NotoSansTC-PMISSubset'

let cached = null

export async function loadPdfFont() {
  if (cached) return cached
  cached = (async () => {
    const res = await fetch(fontUrl)
    if (!res.ok) throw new Error(`中文字型載入失敗(HTTP ${res.status}),未產生 PDF`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength < 100_000) throw new Error('中文字型檔不完整,未產生 PDF')
    // 同一份 buffer 也給瀏覽器排版用;FontFace 會自己複製,不影響 bytes
    const face = new FontFace(PDF_FONT_FAMILY, bytes.buffer.slice(0))
    await face.load()
    document.fonts.add(face)
    return bytes
  })().catch((err) => { cached = null; throw err })
  return cached
}

// 內嵌字型沒有的字會印成 .notdef(空白或豆腐格)。與其讓使用者拿到缺字的送審文件,
// 不如擋下來講清楚缺哪幾個字。
export function assertCharsCovered(pdfFont, usedChars) {
  const covered = new Set(pdfFont.getCharacterSet())
  const missing = []
  for (const ch of usedChars) {
    const cp = ch.codePointAt(0)
    if (cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d) continue
    if (!covered.has(cp)) missing.push(ch)
  }
  if (missing.length) {
    const uniq = [...new Set(missing)]
    // 一併報出字碼:回報時才分得出是「真的沒有這個字」還是「來源用了長得一樣的相容字」
    const list = uniq.slice(0, 12).map((ch) => `${ch}(U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`).join('、')
    throw new Error(`內嵌字型缺少 ${uniq.length} 個字：${list}。為避免印出缺字的文件已停止下載，請回報此訊息。`)
  }
}
