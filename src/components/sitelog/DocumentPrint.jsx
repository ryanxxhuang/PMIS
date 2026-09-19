// 現場文書列印共用(施工日誌／監造日誌／自主檢查表;P3d 從三張紙本各一份抽出):
//   DocumentPrintStamp — 頁首戳記:文件短碼、版本、內容雜湊前 12 碼(DB 算的 content_hash,前端不重算)、簽署者與
//     伺服器簽署時間(台北時間)、簽署方式、文件狀態。沒有簽署列=整張標「草稿・未簽署」(draftNote 補充)。沒有文件的
//     既有紀錄(舊流程寫入的 daily_logs 列,未簽署歷史)沒有版本與雜湊,如實寫出,不假裝有。
//   PrintedVersionBody — usePrintedVersion 的載入／讀取失敗／尚無版本三種狀態,三頁同一套文案;有版本才渲染紙本。
// 用色只走 index.css 的 .paper／paper-*(紙面固定白底黑字);「草稿・未簽署」沿用既有紅字標示。
import { SkeletonList } from '../ui.jsx'
import { formatHash, DOC_STATUS_LABEL, SIGN_METHOD_LABEL } from '../../lib/fieldDocs.js'
import { taipeiDateTime } from '../../lib/dates.js'

export function DocumentPrintStamp({ doc = null, version = null, signature = null, draftNote = '非正式紀錄', className = '' }) {
  const hasVersion = !!doc && !!version
  const signed = hasVersion && !!signature
  return (
    <div role="group" aria-label="文件版本與簽署" className={`border paper-rule-strong px-2 py-1.5 text-footnote flex flex-wrap gap-x-4 gap-y-0.5 ${signed ? '' : 'paper-fill'} ${className}`}>
      {hasVersion ? (
        <>
          <span>文件 {String(doc.id).slice(0, 8)}</span>
          <span>版本 {version.version_no}</span>
          <span>內容雜湊 {formatHash(version.content_hash)}</span>
        </>
      ) : <span>既有紀錄（舊流程寫入，無文件版本與內容雜湊）</span>}
      {signed
        ? <span>簽署 {signature.signer_name_snapshot || '—'}・{taipeiDateTime(signature.signed_at)}・{SIGN_METHOD_LABEL[signature.method] || '平台帳號'}</span>
        : <span className="font-bold text-[var(--red-text)]">草稿・未簽署（{draftNote}）</span>}
      {doc && <span>文件狀態 {DOC_STATUS_LABEL[doc.status] || doc.status}</span>}
    </div>
  )
}

const Notice = ({ children }) => <p className="max-w-[210mm] mx-auto p-10 text-center text-[var(--text-2)]">{children}</p>

export function PrintedVersionBody({ printed, children }) {
  if (printed.loading) return <div className="max-w-[210mm] mx-auto" aria-busy="true"><SkeletonList rows={4} label="載入簽署版本…" /></div>
  if (printed.failed) return <Notice>無法讀取{printed.signature ? `已簽署的版本 ${printed.signature.version_no}` : '此文件'}，請重新整理後再試；不會以其他版本代印。</Notice>
  if (!printed.version) return <Notice>此文件尚無已保存的版本，沒有可列印的內容。</Notice>
  return children
}
