// 列印頁工具列(螢幕上的 chrome,print:hidden)——八支列印路由共用:
// /site-log/print、/self-check/print、/inspection-form/print、/supervisor-log/print、
// /valuation/print、/valuation/package、/quality/checklist-print、/contract/print。
// 工具列是 chrome、紙是紙:工具列一律吃主題 token 跟 Apple style 走(深色模式=深色 chrome
// 壓白紙,Preview.app 就是這個關係);紙面固定白底黑字,單獨收在 index.css 的 .paper。
// 這裡取代的是五份一字不差的 W9 Google 藍藥丸常數(#0b57d0/#0842a0/#dadce0/#e8f0fe):
// 2026-09-11 全站已改 Apple style(D-021),列印頁卻還是已退場的藍藥丸,而且改色要改五次。
// 舊註解說「列印頁不 import ui.jsx」但沒有留下理由——實際相依鏈 ui.jsx → icons.jsx、
// PageTabs.jsx → store.jsx/navConfig.js,與列印頁本來就 import 的 store.jsx 是同一條鏈,
// 沒有環,所以直接吃 Button primitive,不再各頁自抄 class 字串。
// sticky:估驗兩支是全寬置頂 chrome-bar;另外三支是紙上方與 A4 同寬的一列——兩種版面照舊,
// 這一波只換色值來源,不順手統一版面。
//
// 廠商驗收 D:多一顆「下載 PDF」。在這之前只有 window.print(),那是開瀏覽器列印視窗、
// 要使用者自己選「另存 PDF」,不能算交付 PDF 檔(驗收報告 P1);所以列印鈕的字也從
// 「列印 / 存 PDF」改回「列印」——列印入口保留,但不再宣稱它是下載。主要動作變成下載,
// 列印退成 secondary(一個情境只有一顆 filled primary)。
// 下載走 src/lib/pdf/*:把畫面上這張紙(.paper)的排版結果抄成向量 PDF(中文內嵌字型、
// A4 多頁、長表重印表頭),不是截圖;整包相依以 dynamic import 拉,沒按就不進主 bundle。
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MSym } from './icons.jsx'
import { Button } from './ui.jsx'
import { friendlyError } from '../lib/errorMessage.js'

/**
 * @param {object} props
 * @param {{paperRef: object, fileName: string, title?: string, subject?: string}} [props.pdf]
 *   有給才會出現「下載 PDF」;paperRef 指到包住紙張的容器(內含唯一一個 .paper)。
 */
export default function PrintToolbar({ backTo, backLabel, printLabel = '列印', pdf = null, sticky = false, children }) {
  const navigate = useNavigate()
  // 置頂版走 scroll edge effect(規範 §4:chrome 與內容的分界不用常駐 1px 分隔線,
  // 內容捲到 chrome 底下才浮出 hairline+柔影),與 Layout 頂欄同一套 .chrome-edge。
  const [scrolled, setScrolled] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState('')
  useEffect(() => {
    if (!sticky) return
    const onScroll = () => setScrolled(window.scrollY > 0)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [sticky])

  const onDownload = useCallback(async () => {
    if (!pdf) return
    setPdfBusy(true)
    setPdfError('')
    try {
      const paper = pdf.paperRef?.current?.querySelector('.paper')
      if (!paper) throw new Error('文件尚未載入完成,請稍候再試')
      const { downloadPaperPdf } = await import('../lib/pdf/downloadPaperPdf.js')
      await downloadPaperPdf(paper, { fileName: pdf.fileName, title: pdf.title, subject: pdf.subject })
    } catch (err) {
      // 失敗一律講清楚並停在原地:寧可不下載,也不要給出空白或只有半份的 PDF。
      // 走 friendlyError:PDF 這條路自己丟的都是繁中訊息會原樣放行,
      // 底層(fetch/字型/影像解碼)的英文原始錯誤則收斂成通用訊息,不上畫面。
      setPdfError(friendlyError(err, '下載 PDF 失敗，請稍後再試。'))
    } finally {
      setPdfBusy(false)
    }
  }, [pdf])

  const shell = sticky
    ? 'print:hidden sticky top-0 z-10 chrome-bar chrome-edge px-6 py-3 flex flex-wrap items-center justify-between gap-2'
    : 'print:hidden max-w-[210mm] mx-auto mb-3 px-1 flex flex-wrap items-center justify-between gap-2'
  return (
    <>
      <div data-scrolled={sticky ? scrolled : undefined} className={shell}>
        <Button variant="secondary" onClick={() => navigate(backTo)}>← {backLabel}</Button>
        <div className="flex flex-wrap items-center gap-2">
          {children}
          <Button variant={pdf ? 'secondary' : 'primary'} onClick={() => window.print()}>
            <MSym name="print" size={15} />{printLabel}
          </Button>
          {pdf && (
            <Button onClick={onDownload} busy={pdfBusy}>
              {!pdfBusy && <MSym name="download" size={15} />}{pdfBusy ? '產生 PDF…' : '下載 PDF'}
            </Button>
          )}
        </div>
      </div>
      {pdfError && (
        <div role="alert"
          className={`print:hidden ${sticky ? 'px-6' : 'max-w-[210mm] mx-auto px-1'} mb-3 text-footnote text-[var(--red-text)]`}>
          {pdfError}
        </div>
      )}
    </>
  )
}
