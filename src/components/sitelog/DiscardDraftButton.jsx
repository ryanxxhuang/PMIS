// 捨棄現場文書草稿(P3f;四類文書頁的 DocumentLifecycle 與 /site 現場文書清單共用):
// 確認對話框＋原因必填(appPrompt required)→ store.discardFieldDocument → 伺服器 discard_field_document。
// 規則全在 DB(責任方、從未簽署／提送、原因必填、冪等;PD006／PD008／PD010 由伺服器擋),這裡只依
// lib/fieldDocs.canDiscardFieldDocument 決定要不要顯示入口,失敗時如實顯示伺服器訊息。
// 捨棄不刪任何東西:版本與照片保留、稽核留原因;捨棄後同一日期／同一目標可重新起稿(重新上傳或在文件頁重新填寫)。
import { useState } from 'react'
import { useStore } from '../../store.jsx'
import { Button } from '../ui.jsx'
import { appPrompt } from '../confirm.jsx'
import { canDiscardFieldDocument, DOC_TYPE_LABEL, fieldDocErrorGuidance } from '../../lib/fieldDocs.js'
import { friendlyError } from '../../lib/errorMessage.js'

export default function DiscardDraftButton({
  doc, viewerOrg, everSigned = false, canAct = false, dirty = false, onDiscarded, variant = 'outline', size = 'sm', label = '捨棄草稿', className = '',
}) {
  const { discardFieldDocument } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  if (!canAct || !canDiscardFieldDocument(doc, viewerOrg, { everSigned })) return null
  const docLabel = `${doc.doc_date} ${DOC_TYPE_LABEL[doc.doc_type] || '文件'}`

  const discard = async () => {
    const reason = await appPrompt({
      title: `捨棄 ${docLabel}草稿？`,
      body: `捨棄後這份草稿不再出現在清單與待辦，也不能再編輯或簽署；已存的 ${doc.current_version_no} 個版本與照片都會保留，原因會留在稽核紀錄。之後可重新上傳照片起稿，或在文件頁重新填寫。${dirty ? '\n\n畫面上尚未存檔的修改也會一併放棄。' : ''}`,
      label: '捨棄原因（必填）',
      placeholder: '例如：照片日期判錯，要重新上傳',
      required: true,
      danger: true,
      confirmLabel: '捨棄草稿',
    })
    if (reason === null) return
    setBusy(true); setError(null)
    const r = await discardFieldDocument({ documentId: doc.id, versionNo: doc.current_version_no, reason })
    setBusy(false)
    if (r.error) {
      const g = fieldDocErrorGuidance(r.error)
      setError(g.kind === 'unknown' ? friendlyError(r.error, '草稿未捨棄') : g.message)
      return
    }
    onDiscarded?.(r.result, doc)
  }

  return (
    <span className={`inline-flex items-center gap-2 flex-wrap ${className}`}>
      <Button variant={variant} size={size} busy={busy} onClick={discard} aria-label={`捨棄草稿：${docLabel}`}>{label}</Button>
      {error && <span role="alert" className="text-footnote text-[var(--red-text)]">{error}</span>}
    </span>
  )
}
