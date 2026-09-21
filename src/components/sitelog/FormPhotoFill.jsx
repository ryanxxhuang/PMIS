// 表內上傳(2026-09-21):施工日誌／自主檢查表表單卡頂部的「上傳照片,AI 填表」。
// 與 /site 的 IntakeUploader 走同一條保存路(建批次 → 雜湊 → 上傳 → 呼叫起稿 Edge),差在三件事:
//   * 只填**這一份**文件:Edge draft-field-documents 帶 target_document_id,不推候選、不建其他文件、不寫版本,
//     只留一筆建議並在回應 target 帶回;由頁面(onFilled)合併進畫面上的表單——只補空白欄,人填的不覆蓋,存檔後才是版本。
//   * 不做跨批次查重:已上傳過的照片也要能引用來填這張表,所以一律上傳成這個新批次的照片列(同批同 sha 仍只傳一張);
//     Edge 對本案已辨識過的同內容照片沿用結果、不再呼叫模型。
//   * 文件還不存在(新日誌、新自檢表)時先由頁面既有的存檔流程建立(ensureDocument),已存在就直接上傳——
//     不強制存檔,編輯中的人工輸入不會丟。
// 失敗(上傳失敗、辨識失敗、閘門關閉、逾時):照片已保存的保留、表單內容不動,就地給「重新辨識」與「或直接在表上填寫」;
// 處理中只停用這顆鈕,表單照常可編。示範模式只顯示停用鈕與一句說明(不寫 Demo 照片到真案)。
import { useEffect, useReducer, useRef, useState } from 'react'
import { useStore } from '../../store.jsx'
import { Button, buttonClass } from '../ui.jsx'
import { MSym } from '../icons.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { mapWithConcurrency } from '../../lib/packageUpload.js'
import { uploadReducer, initialUploadState, uploadSummary, firstIndexBySha, sha256Hex, UPLOAD_STATUS } from '../../lib/fieldDocs.js'

const UPLOAD_CONCURRENCY = 2
export const FILL_BUTTON_LABEL = '上傳照片，AI 填表'

/**
 * @param {object} props
 * @param {string|null} props.docDate 文件日期(建批次 log_date;日期由表上決定,不由照片推)
 * @param {() => Promise<{documentId?: string, error?: unknown}>} props.ensureDocument 回目前文件 id;沒有文件就用頁面的存檔流程建立
 * @param {(r: {documentId: string, target: object, result: object}) => void} props.onFilled Edge 回來:documentId 是發起時的文件,頁面比對後才合併
 */
export default function FormPhotoFill({ docDate = null, ensureDocument, onFilled }) {
  const { createIntake, uploadIntakePhoto, draftFromIntake, aiEnabled, isPersistedProject, demoMode, can } = useStore()
  const [state, dispatch] = useReducer(uploadReducer, undefined, initialUploadState)
  const [stage, setStage] = useState(null) // 上傳批次之前的階段:ensuring(建文件)／hashing(算雜湊)
  const [progress, setProgress] = useState(null) // Edge 每輪回應(辨識進度)
  const filesRef = useRef(new Map()) // key → File(只在本機;不進 reducer state)
  const targetRef = useRef(null) // 發起時的文件 id:回來時交給頁面比對是否還停在同一份
  // 回呼經 ref 取最新版:上傳＋辨識要好幾秒,結束時不能用按下當時那一輪 render 的舊 closure
  const onFilledRef = useRef(onFilled)
  useEffect(() => { onFilledRef.current = onFilled }, [onFilled])
  const busy = !!stage || state.phase === 'uploading' || state.phase === 'drafting'
  const summary = uploadSummary(state.items)
  const draftEnabled = aiEnabled('field_docs.draft')

  // 呼叫 Edge 直到 remaining=0;有 target 才算填表成功(沒有就是這份文件的草稿沒湊成,原因在 documents／error_summary)
  const runFill = async (intakeId, { rerecognizePhotoIds = null } = {}) => {
    dispatch({ type: 'drafting' })
    setProgress(null)
    const r = await draftFromIntake(intakeId, { targetDocumentId: targetRef.current, rerecognizePhotoIds, onProgress: setProgress })
    if (r.error) {
      dispatch({ type: 'error', error: `${friendlyError(r.error, 'AI 辨識暫時無法使用')}${r.error.code === 'run_conflict' ? '；稍後再按「重新辨識」' : ''}` })
      return
    }
    const target = r.result?.target
    if (!target) {
      const reason = r.result?.documents?.find((d) => d.action === 'error')?.reason || r.result?.intake?.error_summary || 'AI 辨識未完成，可重新辨識'
      dispatch({ type: 'error', error: reason })
      return
    }
    dispatch({ type: 'done' })
    onFilledRef.current?.({ documentId: targetRef.current, target, result: r.result })
  }

  // 上傳:同批同雜湊只傳第一張,其餘引用第一張的照片列(與 IntakeUploader 同一段)
  const uploadItems = async (intakeId, toUpload) => {
    const out = { persisted: 0, failed: 0 }
    const first = firstIndexBySha(toUpload)
    const primaries = toUpload.filter((it, i) => first.get(it.sha256) === i)
    const savedBySha = new Map()
    await mapWithConcurrency(primaries, UPLOAD_CONCURRENCY, async (it) => {
      dispatch({ type: 'uploading', key: it.key })
      const r = await uploadIntakePhoto(intakeId, filesRef.current.get(it.key), { sha256: it.sha256 })
      if (r.error) { dispatch({ type: 'failed', key: it.key, error: friendlyError(r.error, '上傳失敗') }); out.failed += 1; return }
      savedBySha.set(it.sha256, r.id)
      dispatch({ type: 'saved', key: it.key, photoId: r.id })
      out.persisted += 1
    })
    for (const it of toUpload) {
      if (primaries.includes(it)) continue
      const pid = savedBySha.get(it.sha256)
      if (pid) { dispatch({ type: 'duplicate', key: it.key, photoId: pid }); out.persisted += 1 } else { dispatch({ type: 'failed', key: it.key, error: '同內容的第一張未上傳成功,請重試' }); out.failed += 1 }
    }
    return out
  }

  // 雜湊只為同批去重;讀不到的檔標失敗(仍在本機)
  const hashItems = async (items) => {
    const out = []
    for (const it of items) {
      if (it.sha256) { out.push(it); continue }
      dispatch({ type: 'hashing', key: it.key })
      try {
        const sha = await sha256Hex(filesRef.current.get(it.key))
        dispatch({ type: 'hashed', key: it.key, sha256: sha })
        out.push({ ...it, sha256: sha })
      } catch {
        dispatch({ type: 'failed', key: it.key, error: '無法讀取檔案' })
      }
    }
    return out
  }

  const onPick = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    dispatch({ type: 'reset' })
    filesRef.current.clear()
    setProgress(null)
    const added = files.map((file) => {
      const key = crypto.randomUUID()
      filesRef.current.set(key, file)
      return { key, name: file.name, size: file.size, status: UPLOAD_STATUS.queued, sha256: null }
    })
    dispatch({ type: 'add_files', files: added })
    // 文件先要存在(Edge 只認文件 id):新文件由頁面的存檔流程建立並存一版目前內容;已存在就不動
    setStage('ensuring')
    const ensured = await ensureDocument()
    if (!ensured?.documentId) {
      setStage(null)
      dispatch({ type: 'error', error: ensured?.error ? friendlyError(ensured.error, '無法建立文件，照片未上傳') : '無法建立文件，照片未上傳' })
      return
    }
    targetRef.current = ensured.documentId
    setStage('hashing')
    const hashed = await hashItems(added)
    setStage(null)
    if (!hashed.length) { dispatch({ type: 'error', error: '沒有可上傳的照片' }); return }
    const r = await createIntake({ log_date: docDate || null })
    if (r.error) { dispatch({ type: 'error', error: friendlyError(r.error, '無法建立上傳批次') }); return }
    dispatch({ type: 'intake', intakeId: r.intake.id })
    const up = await uploadItems(r.intake.id, hashed)
    if (!up.persisted) { dispatch({ type: 'error', error: '沒有任何照片保存到伺服器；失敗的照片仍在本機，可重試' }); return }
    await runFill(r.intake.id)
  }

  // 重試未保存的照片(沿用同一批次),保存後接著辨識
  const retryFailed = async () => {
    const failed = state.items.filter((it) => it.status === UPLOAD_STATUS.failed)
    dispatch({ type: 'retry' })
    const hashed = await hashItems(failed.map((it) => ({ ...it, status: UPLOAD_STATUS.queued })))
    const up = hashed.length ? await uploadItems(state.intakeId, hashed) : { persisted: 0, failed: 0 }
    if (!up.persisted && !summary.persisted) { dispatch({ type: 'error', error: '沒有任何照片保存到伺服器；失敗的照片仍在本機，可重試' }); return }
    await runFill(state.intakeId)
  }
  // 明確要求重新辨識:這批已保存的照片全部重跑(不沿用同內容照片的既有結果)
  const rerecognize = () => runFill(state.intakeId, { rerecognizePhotoIds: state.items.filter((it) => it.photoId).map((it) => it.photoId) })

  if (!can.write) return null
  const off = demoMode || !isPersistedProject || !draftEnabled
  const offNote = demoMode || !isPersistedProject ? '示範模式無法上傳，需正式專案'
    : !draftEnabled ? 'AI 填表功能未啟用（請直接在表上填寫）' : null
  const stageText = stage === 'ensuring' ? '建立文件中…'
    : stage === 'hashing' || state.phase === 'uploading' ? `上傳 ${summary.persisted}／${summary.total}`
      : state.phase === 'drafting' ? `AI 辨識中…${progress?.intake?.photo_count ? `（已辨識 ${progress.intake.recognized_count || 0}／${progress.intake.photo_count}）` : ''}`
        : null

  return (
    <div className="flex items-center gap-2 flex-wrap min-w-0">
      {/* 相簿多選(不加 capture,否則手機會強開相機只能拍一張);label 吃 Button 同一套皮 */}
      <label className={`${buttonClass('primary', 'md')} ${off || busy ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`} title={offNote || undefined}>
        <input type="file" accept="image/*" multiple disabled={off || busy} onChange={onPick} className="hidden" data-testid="form-photo-fill" aria-label={FILL_BUTTON_LABEL} />
        {busy ? <MSym name="progress_activity" size={15} className="msym-spin" /> : <MSym name="auto_awesome" size={15} />}
        {busy ? '處理中…' : FILL_BUTTON_LABEL}
      </label>
      {offNote && <span className="text-footnote text-[var(--text-3)]">{offNote}</span>}
      {stageText && <span role="status" aria-live="polite" className="text-footnote text-[var(--blue-text)] num">{stageText}</span>}
      {state.phase === 'done' && <span role="status" className="text-footnote text-[var(--green-text)] num">照片已保存 {summary.persisted}／{summary.total}，辨識完成</span>}
      {state.phase === 'error' && (
        <div role="alert" className="flex items-center gap-2 flex-wrap text-footnote">
          <span className="text-[var(--red-text)]">{state.error}</span>
          {summary.failed > 0 && <Button variant="secondary" size="sm" onClick={retryFailed}>重試未保存的 {summary.failed} 張</Button>}
          {state.intakeId && summary.persisted > 0 && <Button variant="secondary" size="sm" onClick={rerecognize}>重新辨識</Button>}
          <span className="text-[var(--text-3)]">或直接在表上填寫</span>
        </div>
      )}
    </div>
  )
}
