// 「下載 PDF」的進入點:量紙 → 產 PDF → 存檔。整包(pdf-lib + fontkit + 中文字型)
// 都由 PrintToolbar 以 dynamic import 拉進來,沒按下載就不會進主要 bundle。
//
// 印的是什麼,由畫面決定:列印頁本來就只渲染「簽署列指向的那一版」(usePrintedVersion),
// 沒有簽署列才渲染最新存檔版並整張標「草稿・未簽署」。PDF 從同一棵 DOM 抄,所以
// 「正式文件取不可變的已簽版本、草稿有未簽署標示」是沿用既有規則,不是這裡另做一套判斷。
import { snapshotPaper } from './paperSnapshot.js'
import { renderPaperPdf } from './renderPaperPdf.js'
import { loadPdfFont, PDF_FONT_FAMILY } from './font.js'

// Windows／macOS 都不能用的字元;全形括號、中文一律保留。
// 控制字元另外用字碼判斷(正規表示式寫控制字元會被 no-control-regex 擋下)。
const ILLEGAL = /[\\/:*?"<>|]/g
const stripControl = (s) => [...s].filter((ch) => ch.codePointAt(0) >= 0x20).join('')

export function safeFileName(name, fallback = '工程文件') {
  const cleaned = stripControl(String(name || '')).replace(ILLEGAL, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')
  const base = cleaned || fallback
  return `${base.slice(0, 120)}.pdf`
}

function triggerDownload(bytes, fileName) {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 立刻 revoke 在部分瀏覽器會讓下載中斷,給一段緩衝
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * @param {HTMLElement} paperEl 要輸出的 .paper 元素
 * @param {{fileName:string, title?:string, subject?:string}} opts
 */
export async function downloadPaperPdf(paperEl, opts) {
  if (!paperEl) throw new Error('找不到可輸出的文件內容,未產生 PDF')
  // 先把內嵌字型抓下來並註冊給瀏覽器:量測與輸出必須是同一支字,位置才對得起來
  await loadPdfFont()
  if (document.fonts?.ready) await document.fonts.ready

  const snapshot = snapshotPaper(paperEl, { fontFamily: `"${PDF_FONT_FAMILY}"` })
  if (!snapshot.ops.some((op) => op.t === 'text')) throw new Error('文件內容是空的,未下載 PDF')

  const result = await renderPaperPdf(snapshot, { title: opts?.title, subject: opts?.subject })
  if (!result.bytes || result.bytes.byteLength < 1000) throw new Error('產生的 PDF 不完整,未下載')

  triggerDownload(result.bytes, safeFileName(opts?.fileName, opts?.title))
  return { pageCount: result.pageCount, forcedCuts: result.forcedCuts, size: result.bytes.byteLength }
}
