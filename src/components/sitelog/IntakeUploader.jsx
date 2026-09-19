// 拍照／上傳(P2c;設計 §3.1 第 1–2 步、§3.3):選檔即建上傳批次(photo_intakes)、逐張算雜湊、
// 上傳 Storage、寫 photos 列(intake_id＋content_sha256);每張只有 photos 列寫成功才是「已保存」,
// 其餘一律標「仍在本機」(重新整理就沒有,要重選)。上傳完自動呼叫起稿 Edge(remaining>0 續跑),
// 結果(逐張狀態、候選文書、文件連結)由 IntakeResult 呈現。
// 冪等:同批同雜湊只傳一張;本案已有同內容照片(跨批次)直接引用不重傳;失敗可重試且沿用同一
// 批次(不重複建批);Edge 端重跑不重複建件、不覆蓋人工版本(P2b)。
// 這裡不做離線同步:離頁後的批次由 /site 的「上傳批次」從伺服器恢復(IntakeList)。
import { useReducer, useRef, useState } from 'react'
import { useStore } from '../../store.jsx'
import { Button, Badge, Field, Input, buttonClass } from '../ui.jsx'
import { MSym } from '../icons.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { mapWithConcurrency } from '../../lib/packageUpload.js'
import {
  uploadReducer, initialUploadState, uploadSummary, firstIndexBySha, sha256Hex, UPLOAD_STATUS, toggleCandidateExcluded,
} from '../../lib/fieldDocs.js'
import IntakeResult from './IntakeResult.jsx'

const UPLOAD_CONCURRENCY = 2
const ITEM_STATUS_LABEL = {
  queued: '仍在本機・排隊中', hashing: '仍在本機・計算雜湊', uploading: '仍在本機・傳送中',
  saved: '已保存到伺服器', duplicate: '本案已有相同照片,未重複上傳', failed: '仍在本機・上傳失敗',
}
const ITEM_STATUS_TONE = { queued: 'slate', hashing: 'slate', uploading: 'blue', saved: 'green', duplicate: 'slate', failed: 'red' }

// fixedDate:施工日誌頁帶當日日期(批次 log_date);總覽頁不帶,由照片自行判日(告示板 > 拍攝時間)。
export default function IntakeUploader({ fixedDate = null, onDrafted, compact = false }) {
  const {
    createIntake, findExistingPhotosBySha, uploadIntakePhoto, draftFromIntake, setIntakeCandidates, updateIntakeDate,
    aiEnabled, isPersistedProject, demoMode, can, currentUser,
  } = useStore()
  const [state, dispatch] = useReducer(uploadReducer, undefined, initialUploadState)
  const [result, setResult] = useState(null) // Edge 最後一輪回應 { intake, photos, documents, notes }
  const [notice, setNotice] = useState(null) // 非錯誤的說明(例如全部都是既有照片)
  const [dateDraft, setDateDraft] = useState(fixedDate || '')
  const [fixDateBusy, setFixDateBusy] = useState(false)
  const filesRef = useRef(new Map()) // key → File(只在本機;不進 reducer state)
  const busy = state.phase === 'uploading' || state.phase === 'drafting'
  const summary = uploadSummary(state.items)
  const org = currentUser?.org_type || 'contractor'
  const draftEnabled = aiEnabled('field_docs.draft')

  const runDraft = async (intakeId) => {
    dispatch({ type: 'drafting' })
    const r = await draftFromIntake(intakeId, { onProgress: (body) => setResult(body) })
    if (r.error) {
      // 409 run_conflict:別的請求正在處理這批,結果會出現在「上傳批次」;其他錯誤如實顯示
      dispatch({ type: 'error', error: `${friendlyError(r.error, '起稿服務暫時無法使用')}${r.error.code === 'run_conflict' ? ';稍後到「上傳批次」查看結果' : ''}` })
      if (r.intake) setResult((prev) => ({ ...(prev || {}), intake: r.intake, photos: r.photos || prev?.photos || null }))
      return
    }
    setResult(r.result)
    dispatch({ type: 'done' })
    onDrafted?.(r.result)
  }

  // 第一段:雜湊 → 跨批次查重。回傳真的要上傳的張數與計數(不讀 reducer state,避免 closure 過期)。
  // 先查重再建批次:全部都是本案既有照片時不建空批次、不打起稿(空批次只會被 Edge 標 failed)。
  const hashAndDedupe = async (items) => {
    const out = { persisted: 0, failed: 0 }
    const shaOf = new Map()
    for (const it of items) {
      if (it.sha256) { shaOf.set(it.key, it.sha256); continue }
      dispatch({ type: 'hashing', key: it.key })
      try {
        const sha = await sha256Hex(filesRef.current.get(it.key))
        shaOf.set(it.key, sha)
        dispatch({ type: 'hashed', key: it.key, sha256: sha })
      } catch {
        dispatch({ type: 'failed', key: it.key, error: '無法讀取檔案' })
        out.failed += 1
      }
    }
    const hashed = items.filter((it) => shaOf.has(it.key)).map((it) => ({ ...it, sha256: shaOf.get(it.key) }))
    const existing = await findExistingPhotosBySha(hashed.map((it) => it.sha256))
    const toUpload = []
    for (const it of hashed) {
      const hit = existing.get(it.sha256)
      if (hit) { dispatch({ type: 'duplicate', key: it.key, photoId: hit.id }); out.persisted += 1 } else toUpload.push(it)
    }
    return { toUpload, out }
  }

  // 第二段:上傳;同批同雜湊只傳第一張,其餘引用第一張的結果
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

  const afterUpload = async (intakeId, outcome, priorPersisted = 0) => {
    if (outcome.persisted + priorPersisted > 0) {
      if (draftEnabled) await runDraft(intakeId)
      else dispatch({ type: 'done' })
    } else {
      dispatch({ type: 'error', error: '沒有任何照片保存到伺服器；失敗的照片仍在本機，可重試' })
    }
  }

  const ensureIntake = async () => {
    if (state.intakeId) return state.intakeId
    const r = await createIntake({ log_date: fixedDate || dateDraft || null })
    if (r.error) { dispatch({ type: 'error', error: friendlyError(r.error, '無法建立上傳批次') }); return null }
    return r.intake.id
  }

  const onPick = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setNotice(null)
    const added = files.map((file) => {
      const key = crypto.randomUUID()
      filesRef.current.set(key, file)
      return { key, name: file.name, size: file.size, status: UPLOAD_STATUS.queued, sha256: null }
    })
    dispatch({ type: 'add_files', files: added })
    const { toUpload, out } = await hashAndDedupe(added)
    if (!toUpload.length && !state.intakeId) {
      // 全部都是本案既有照片(或讀不到檔):不建批次、不起稿;既有照片的辨識與文件早已存在
      dispatch({ type: out.persisted ? 'done' : 'error', error: out.persisted ? null : '沒有可上傳的照片' })
      if (out.persisted) setNotice('這些照片本案已保存過（可能在別的批次），未重複上傳；既有文件內容未變。')
      return
    }
    const intakeId = await ensureIntake()
    if (!intakeId) return
    dispatch({ type: 'intake', intakeId })
    const up = toUpload.length ? await uploadItems(intakeId, toUpload) : { persisted: 0, failed: 0 }
    await afterUpload(intakeId, { persisted: out.persisted + up.persisted, failed: out.failed + up.failed }, summary.persisted)
  }

  const retryFailed = async () => {
    const failed = state.items.filter((it) => it.status === UPLOAD_STATUS.failed)
    dispatch({ type: 'retry' })
    const { toUpload, out } = await hashAndDedupe(failed.map((it) => ({ ...it, status: UPLOAD_STATUS.queued })))
    const up = toUpload.length ? await uploadItems(state.intakeId, toUpload) : { persisted: 0, failed: 0 }
    await afterUpload(state.intakeId, { persisted: out.persisted + up.persisted, failed: out.failed + up.failed }, summary.persisted)
  }

  const toggleExclude = async (index, excluded) => {
    const cands = toggleCandidateExcluded(result?.intake?.candidates || [], index, excluded)
    const r = await setIntakeCandidates(state.intakeId, cands)
    if (r.error) { dispatch({ type: 'error', error: friendlyError(r.error, '候選未更新') }); return }
    setResult((prev) => ({ ...prev, intake: { ...prev.intake, candidates: cands } }))
  }

  const fixDate = async (date) => {
    setFixDateBusy(true)
    const r = await updateIntakeDate(state.intakeId, date)
    setFixDateBusy(false)
    if (r.error) { dispatch({ type: 'error', error: friendlyError(r.error, '日期未更新') }); return }
    await runDraft(state.intakeId)
  }

  if (demoMode || !isPersistedProject) {
    return <p className="text-footnote text-[var(--text-3)]">示範模式無法上傳照片（需正式專案）。正式專案在此拍照或選擇照片後，系統會保存照片、辨識並自動擬好施工日誌與自主檢查表草稿。</p>
  }
  if (!can.write) {
    return <p className="text-footnote text-[var(--text-3)]">照片由施工廠商或監造在其合法作業中上傳；機關可查閱已保存的照片與文書。</p>
  }

  const stub = Array.isArray(result?.notes) && result.notes.some((n) => String(n).includes('stub'))
  return (
    <div className="space-y-3">
      {!compact && !fixedDate && (
        <p className="text-footnote text-[var(--text-2)]">
          選好照片就會保存到伺服器並開始辨識；{org === 'contractor' ? '系統會依日期自動擬好施工日誌草稿，並為每個配到工項的照片擬自主檢查表草稿（依本案檢查表範本；實測值一律由你親自量測填寫），列出待補欄位。' : '系統會依日期自動擬好監造日誌草稿（示範範本），到場人員需親自填寫確認；監造查驗表單起稿尚未支援，不會假裝完成。'}
          日期以告示板為準，沒有告示板時可在下方指定。
        </p>
      )}
      <div className="flex items-end gap-2 flex-wrap">
        {/* 相機:單張直拍;相簿:多選(不加 capture,否則手機會強開相機只能拍一張) */}
        <label className={`${buttonClass('primary', 'md')} ${busy ? 'opacity-50' : 'cursor-pointer'}`}>
          <input type="file" accept="image/*" capture="environment" disabled={busy} onChange={onPick} className="hidden" data-testid="intake-camera" aria-label="拍照上傳" />
          <MSym name="photo_camera" size={15} /> 拍照
        </label>
        <label className={`${buttonClass('secondary', 'md')} ${busy ? 'opacity-50' : 'cursor-pointer'}`}>
          <input type="file" accept="image/*" multiple disabled={busy} onChange={onPick} className="hidden" data-testid="intake-files" aria-label="選擇照片上傳" />
          <MSym name="photo_library" size={15} /> 選擇照片
        </label>
        {!fixedDate && !state.intakeId && (
          <Field label="指定日期(選填)"><Input type="date" value={dateDraft} onChange={(e) => setDateDraft(e.target.value)} className="!w-44" /></Field>
        )}
      </div>

      {state.items.length > 0 && (
        <div className="rounded-lg border border-[var(--border-2)] p-3 space-y-2">
          <div role="status" aria-live="polite" className="flex items-center gap-2 flex-wrap text-footnote">
            <Badge color={summary.local ? 'amber' : 'green'} className="num">已保存到伺服器 {summary.persisted}／{summary.total}</Badge>
            {summary.local > 0 && <Badge color="amber" className="num">仍在本機 {summary.local}</Badge>}
            {state.phase === 'drafting' && <span className="text-[var(--blue-text)]">AI 辨識與起稿中…</span>}
            {state.phase === 'done' && !result && <span className="text-[var(--text-2)]">照片已保存；AI 起稿未啟用，請手動填寫日誌。</span>}
          </div>
          <ul aria-label="本批照片" className="space-y-1">
            {state.items.map((it) => (
              <li key={it.key} className="flex items-center gap-2 text-caption">
                <span className="truncate min-w-0 flex-1 text-[var(--text-2)]" title={it.name}>{it.name}</span>
                <Badge color={ITEM_STATUS_TONE[it.status]}>{ITEM_STATUS_LABEL[it.status]}</Badge>
                {it.error && <span className="text-[var(--red-text)]">{it.error}</span>}
              </li>
            ))}
          </ul>
          {state.error && <p role="alert" className="text-footnote text-[var(--red-text)]">{state.error}</p>}
          {notice && <p role="status" className="text-footnote text-[var(--text-2)]">{notice}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            {summary.failed > 0 && !busy && <Button variant="secondary" onClick={retryFailed}>重試未保存的 {summary.failed} 張</Button>}
            {state.phase === 'error' && summary.persisted > 0 && draftEnabled && !busy && (
              <Button variant="secondary" onClick={() => runDraft(state.intakeId)}>重新辨識起稿</Button>
            )}
            {(state.phase === 'done' || state.phase === 'error') && !busy && (
              <Button variant="ghost" size="sm" onClick={() => { dispatch({ type: 'reset' }); setResult(null); setNotice(null); filesRef.current.clear() }}>再傳一批</Button>
            )}
          </div>
          {result?.intake && (
            <IntakeResult intake={result.intake} photos={result.photos} documents={result.documents} notes={result.notes} stub={stub}
              editable onToggleExclude={toggleExclude} onFixDate={fixDate} fixDateBusy={fixDateBusy} dateDraft={dateDraft} setDateDraft={setDateDraft} />
          )}
        </div>
      )}
    </div>
  )
}
