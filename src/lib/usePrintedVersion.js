// 現場文書列印頁共用(施工日誌／監造日誌／自主檢查表;P3d 從三頁各一份抽成這一支):載入文件脈絡,
// 印「簽署列指向的版本」(lib/fieldDocs.printSignature)——與畫面上可能已開新版的更正草稿無關;沒有簽署列=印最新存檔版本,
// 由呼叫端整張標「草稿・未簽署」。只讀既有的 field_documents／field_document_versions／field_document_signatures
// (store getFieldDocument／getFieldDocumentVersion),不另開 RPC;雜湊是 DB 算的 content_hash 原值。
//   failed:文件讀不到(無權／網路),或有簽署列卻讀不到該版本——絕不退回印最新版本冒充簽署版本。
//   version=null 且未 failed:文件尚無任何已保存版本(呼叫端顯示「沒有可列印的內容」,不無限載入)。
// templateType 給了才向伺服器取範本標記(fn_field_document_template;施工日誌是公定格式,不取)。
// waiting:文件清單仍在載入(fieldDocsLoading)而 doc 還找不到時為 true,回 loading,不先閃「沒有內容」。
import { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { printSignature } from './fieldDocs.js'

const IDLE = { loading: false, failed: false, doc: null, version: null, signature: null, template: null }

export default function usePrintedVersion(doc, { templateType = null, waiting = false } = {}) {
  const { getFieldDocument, getFieldDocumentVersion, getFieldDocumentTemplate } = useStore()
  // 結果綁定到「哪一份文件的哪個版本／狀態」;鍵不符(剛切文件、文件前進)一律回 loading,不閃舊內容或「沒有內容」
  const key = doc?.id ? `${doc.id}|${doc.current_version_no ?? ''}|${doc.status ?? ''}|${templateType ?? ''}` : null
  const [state, setState] = useState({ ...IDLE, key: null })

  useEffect(() => {
    if (!key) return
    let active = true
    ;(async () => {
      const [detail, tpl] = await Promise.all([
        getFieldDocument(doc.id),
        templateType ? getFieldDocumentTemplate(templateType) : Promise.resolve(null),
      ])
      const signature = printSignature(detail?.signatures)
      const version = !signature ? detail?.version || null
        : detail?.version?.version_no === signature.version_no ? detail.version
          : await getFieldDocumentVersion(doc.id, signature.version_no)
      if (!active) return
      setState({
        key, loading: false, failed: !detail || (!!signature && !version),
        doc: detail?.doc || doc, version, signature, template: tpl?.template ?? null,
      })
    })()
    return () => { active = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!key) return { ...IDLE, loading: !!waiting }
  if (state.key !== key) return { ...IDLE, loading: true }
  return state
}
