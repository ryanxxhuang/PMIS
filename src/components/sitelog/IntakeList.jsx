// 上傳批次的恢復清單(P2c;設計 §3.3):進「現場紀錄」時列出我建立、尚未捨棄的批次,狀態全部
// 從伺服器讀(photo_intakes＋photos 計數),離頁／重新登入／換裝置都從這裡接續:續跑辨識、重試、
// 補日期、捨棄。批次的候選與已起稿文件由 IntakeResult 呈現,和上傳當下同一份。
import { useState } from 'react'
import { useStore } from '../../store.jsx'
import { Button, Empty } from '../ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { taipeiDateTime } from '../../lib/dates.js'
import { appConfirm } from '../confirm.jsx'
import { intakeNextAction, toggleCandidateExcluded } from '../../lib/fieldDocs.js'
import IntakeResult, { IntakeStatusLine } from './IntakeResult.jsx'

const ACTION_LABEL = {
  draft: '開始辨識', continue: '繼續辨識', retry: '重試辨識', fix_date: null, running: null, exhausted: null, empty: null, done: null,
}

export default function IntakeList({ focusId = null }) {
  const { intakes, fieldDocuments, draftFromIntake, updateIntakeDate, setIntakeCandidates, discardIntake, reloadFieldDocs, fieldDocsLoading, can } = useStore()
  const [busyId, setBusyId] = useState(null)
  const [msg, setMsg] = useState({}) // intakeId → { text, tone }
  const [open, setOpen] = useState(() => (focusId ? { [focusId]: true } : {}))
  const [dateDraft, setDateDraft] = useState({})
  const setMessage = (id, text, tone = 'error') => setMsg((m) => ({ ...m, [id]: text ? { text, tone } : null }))

  const run = async (intake) => {
    setBusyId(intake.id); setMessage(intake.id, '')
    const r = await draftFromIntake(intake.id)
    setBusyId(null)
    if (r.error) { setMessage(intake.id, `${friendlyError(r.error, '起稿服務暫時無法使用')}${r.error.code === 'run_conflict' ? '(請稍後重新整理)' : ''}`); return }
    setMessage(intake.id, r.result?.intake?.status === 'ready' ? '辨識完成' : '已處理一輪,見下方結果', 'success')
  }
  const fixDate = async (intake, date) => {
    setBusyId(intake.id)
    const r = await updateIntakeDate(intake.id, date)
    if (r.error) { setBusyId(null); setMessage(intake.id, friendlyError(r.error, '日期未更新')); return }
    setBusyId(null)
    await run(intake)
  }
  const toggleExclude = async (intake, index, excluded) => {
    const r = await setIntakeCandidates(intake.id, toggleCandidateExcluded(intake.candidates || [], index, excluded))
    if (r.error) setMessage(intake.id, friendlyError(r.error, '候選未更新'))
  }
  const discard = async (intake) => {
    if (!(await appConfirm({ title: '捨棄這批上傳？', body: '已保存的照片仍留在伺服器（照片是證據，不會刪除），只是這批不再辨識或起稿。', danger: true, confirmLabel: '捨棄' }))) return
    const r = await discardIntake(intake.id)
    if (r.error) setMessage(intake.id, friendlyError(r.error, '批次未捨棄'))
  }

  if (!intakes.length) {
    return <Empty icon="photo_library">目前沒有處理中的上傳批次。拍照或選照片後，批次與辨識進度會保存在伺服器，離頁後在這裡接續。</Empty>
  }
  return (
    <ul aria-label="上傳批次清單" className="divide-y divide-[var(--border-2)]">
      {intakes.map((intake) => {
        const next = intakeNextAction(intake)
        const docs = (fieldDocuments?.documents || []).filter((d) => d.intake_id === intake.id)
        const isOpen = !!open[intake.id]
        const m = msg[intake.id]
        return (
          <li key={intake.id} id={`intake-${intake.id}`} className="px-4 py-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={() => setOpen((o) => ({ ...o, [intake.id]: !isOpen }))} aria-expanded={isOpen}
                className="text-body font-medium text-[var(--text)] min-h-11 md:min-h-0 text-left">
                {intake.log_date ? `${intake.log_date} 的照片` : '未指定日期的照片'}
                <span className="text-caption text-[var(--text-3)] ml-2 num">{taipeiDateTime(intake.created_at)} 上傳</span>
              </button>
              <IntakeStatusLine intake={intake} />
              <span className="ml-auto flex items-center gap-1.5 flex-wrap">
                {next === 'running' && <span className="text-caption text-[var(--blue-text)]">處理中…</span>}
                {next === 'exhausted' && <span className="text-caption text-[var(--red-text)]">已重試 5 次，請重新上傳成新批次</span>}
                {next === 'empty' && <span className="text-caption text-[var(--text-3)]">沒有已保存的照片</span>}
                {can.write && ACTION_LABEL[next] && (
                  <Button variant="secondary" size="sm" busy={busyId === intake.id} onClick={() => run(intake)}>{ACTION_LABEL[next]}</Button>
                )}
                {(next === 'running') && <Button variant="ghost" size="sm" busy={fieldDocsLoading} onClick={reloadFieldDocs}>重新整理</Button>}
                {can.write && next !== 'running' && <Button variant="ghost" size="sm" onClick={() => discard(intake)}>捨棄</Button>}
              </span>
            </div>
            {m && <p role="status" className={`text-footnote ${m.tone === 'success' ? 'text-[var(--green-text)]' : 'text-[var(--red-text)]'}`}>{m.text}</p>}
            {isOpen && (
              <IntakeResult intake={intake} documents={docs} editable={can.write} hideStatus
                onToggleExclude={(i, ex) => toggleExclude(intake, i, ex)}
                onFixDate={(d) => fixDate(intake, d)} fixDateBusy={busyId === intake.id}
                dateDraft={dateDraft[intake.id] ?? ''} setDateDraft={(v) => setDateDraft((d) => ({ ...d, [intake.id]: v }))} />
            )}
          </li>
        )
      })}
    </ul>
  )
}
