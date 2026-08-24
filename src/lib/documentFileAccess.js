// 看上傳的檔案:私有 bucket(contract-documents)的開啟/下載共用層。
// 專案文件清單與契約重點「開啟原文」共用同一套——留痕、彈窗退回、檔名還原
// 三個坑各只修一次。
//
// - 讀取留痕先行且 fail-closed:合規要求「資料存取」可歸責(工程會一覽表),
//   留不了痕就不給檔;log_document_access RPC 的權限與 storage policy 同一套。
// - 下載走 blob + <a download> 還原 original_filename:storage server 對非 ASCII
//   檔名會回百分比編碼的 Content-Disposition(e2e 實測存成 %E5..txt)。
// - 預覽只給瀏覽器會渲染的格式;彈窗被攔截(機關電腦常見預設)退回下載。
import { supabase } from './supabase.js'
import { friendlyError } from './errorMessage.js'
import { isValidStorageKey, isInlineViewableMime } from './packageUpload.js'

const BUCKET = 'contract-documents'

async function logAccess(versionId, action) {
  const { error } = await supabase.rpc('log_document_access',
    { p_document_version: versionId, p_action: action })
  return error || null
}

export async function downloadDocumentVersionFile(version, { onError } = {}) {
  if (!isValidStorageKey(version?.storage_path)) return
  const auditError = await logAccess(version.id, 'download')
  if (auditError) { onError?.(friendlyError(auditError, '下載檔案失敗')); return }
  const { data: blob, error } = await supabase.storage.from(BUCKET)
    .download(version.storage_path)
  if (error || !blob) { onError?.(friendlyError(error, '下載檔案失敗')); return }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = version.original_filename || version.storage_path.split('/').pop() || '文件'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// page:PDF 才有意義——瀏覽器內建檢視器吃 #page=N 錨點直接跳到出處頁。
export async function openDocumentVersionFile(version, { page, onError } = {}) {
  if (!isValidStorageKey(version?.storage_path)) return
  // 瀏覽器不會渲染的格式(docx/xlsx…)開分頁只會存成醜檔名,直接改走下載
  if (!isInlineViewableMime(version.mime_type)) {
    return downloadDocumentVersionFile(version, { onError })
  }
  // Safari 會擋 await 之後才開的分頁:先同步開空白分頁,拿到簽名 URL 再導過去。
  // 彈窗被攔截就退回下載——附件下載不經彈窗,永遠可用
  const win = window.open('', '_blank')
  if (!win) return downloadDocumentVersionFile(version, { onError })
  win.opener = null
  const auditError = await logAccess(version.id, 'preview')
  if (auditError) {
    win.close()
    onError?.(friendlyError(auditError, '開啟檔案失敗'))
    return
  }
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(version.storage_path, 3600)
  if (error || !data?.signedUrl) {
    win.close()
    onError?.(friendlyError(error, '開啟檔案失敗'))
    return
  }
  const pageAnchor = page && /pdf/.test(version.mime_type || '') ? `#page=${page}` : ''
  win.location = data.signedUrl + pageAnchor
}
