// 上傳批次的伺服器結果(P2c):批次狀態、逐張辨識狀態、候選文書(已就緒／待補／已排除;四類文書皆有頁面)、
// 已起稿的文件連結。上傳中與恢復(進頁重讀伺服器)都吃這一份,兩處長一樣。
// 不含任何寫入邏輯:排除候選、補日期、重試由呼叫端(IntakeUploader／IntakeList)接 store;「一次補齊」(P3e 共用補值)
// 是獨立元件 IntakeSharedInputs(欄位與效果由伺服器判定),補值後由 onSharedApplied 通知呼叫端更新版本號。
import { Link } from 'react-router-dom'
import { Badge, Button, Input, Field } from '../ui.jsx'
import { MSym } from '../icons.jsx'
import IntakeSharedInputs from './IntakeSharedInputs.jsx'
import {
  DOC_TYPE_LABEL, CANDIDATE_STATE_LABEL, CANDIDATE_STATE_TONE, INTAKE_STATUS_LABEL, docPageLink,
} from '../../lib/fieldDocs.js'

const PHOTO_STATUS_LABEL = { pending: '待辨識', done: '已辨識', failed: '辨識失敗', not_site: '非工地照', unreadable: '模糊不可辨', duplicate: '重複照片' }
const PHOTO_STATUS_TONE = { pending: 'slate', done: 'green', failed: 'red', not_site: 'amber', unreadable: 'amber', duplicate: 'slate' }

// 批次進度的一句話:伺服器計數(photo_count／recognized_count／failed_count)或前端統計(photoStats)
export function intakeCounts(intake) {
  const s = intake?.photoStats
  if (s?.total) return { total: s.total, done: (s.done || 0) + (s.not_site || 0) + (s.unreadable || 0) + (s.duplicate || 0), failed: s.failed || 0, pending: s.pending || 0 }
  return { total: intake?.photo_count || 0, done: intake?.recognized_count || 0, failed: intake?.failed_count || 0, pending: Math.max(0, (intake?.photo_count || 0) - (intake?.recognized_count || 0) - (intake?.failed_count || 0)) }
}

// 批次狀態一行:狀態章＋已保存／已辨識／失敗計數;上傳當下與恢復清單的折疊列都用這一份,收合也看得到狀態
export function IntakeStatusLine({ intake, stub = false }) {
  const counts = intakeCounts(intake)
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <Badge color={intake.status === 'ready' ? 'green' : intake.status === 'failed' ? 'red' : intake.status === 'partial' ? 'amber' : 'blue'}>
        {INTAKE_STATUS_LABEL[intake.status] || intake.status}
      </Badge>
      <span className="text-footnote text-[var(--text-2)] num">
        已保存 {counts.total} 張{counts.done ? `・已辨識 ${counts.done}` : ''}{counts.failed ? `・失敗 ${counts.failed}` : ''}{counts.pending ? `・待辨識 ${counts.pending}` : ''}
      </span>
      {stub && <Badge color="amber">本機 stub 模型輸出</Badge>}
    </span>
  )
}

export default function IntakeResult({
  intake, photos = null, documents = [], notes = [], stub = false, hideStatus = false,
  editable = false, onToggleExclude, onFixDate, fixDateBusy = false, dateDraft, setDateDraft, onSharedApplied,
}) {
  if (!intake) return null
  const candidates = Array.isArray(intake.candidates) ? intake.candidates : []
  // documents 兩種來源同一形狀化:Edge 回應 {document_id, version_no} 與 store 的 field_documents {id, current_version_no}
  const docs = (documents || []).map((d) => ({ ...d, id: d.id || d.document_id, versionNo: d.current_version_no ?? d.version_no ?? 0 })).filter((d) => d.id)
  const docByKey = new Map(docs.map((d) => [`${d.doc_type}:${d.doc_date}`, d]))
  const blocked = candidates.some((c) => c.state === 'blocked')
  return (
    <div className="space-y-3 text-body">
      {!hideStatus && (
        <div className="flex items-center gap-2 flex-wrap">
          <IntakeStatusLine intake={intake} stub={stub} />
          {intake.log_date && <span className="text-footnote text-[var(--text-3)]">批次日期 {intake.log_date}</span>}
        </div>
      )}
      {intake.error_summary && <p role="status" className="text-footnote text-[var(--red-text)]">{intake.error_summary}</p>}
      {notes.length > 0 && (
        <ul className="text-footnote text-[var(--text-2)] list-disc pl-5 space-y-0.5">
          {notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}

      {photos && photos.length > 0 && (
        <ul aria-label="逐張辨識狀態" className="flex flex-wrap gap-1.5">
          {photos.map((p) => (
            <li key={p.id} className="inline-flex items-center gap-1">
              <Badge color={PHOTO_STATUS_TONE[p.ai_status] || 'slate'}>{PHOTO_STATUS_LABEL[p.ai_status] || p.ai_status || '待辨識'}</Badge>
              {p.error && <span className="text-caption text-[var(--red-text)]">{p.error}</span>}
            </li>
          ))}
        </ul>
      )}

      {/* 候選文書:已就緒／已起稿(連到文件)、待補(補日期／工項)、已排除;使用者可排除不適用候選(四類文書皆有頁面可直達) */}
      {candidates.length > 0 && (
        <div>
          <div className="text-footnote font-medium text-[var(--text-2)] mb-1">候選文書</div>
          <ul aria-label="候選文書清單" className="divide-y divide-[var(--border-2)] border border-[var(--border-2)] rounded-lg">
            {candidates.map((c, i) => {
              const doc = (c.document_id && docs.find((d) => d.id === c.document_id)) || docByKey.get(`${c.doc_type}:${c.doc_date}`) || null
              const state = c.excluded ? 'excluded' : c.state
              return (
                <li key={`${c.doc_type}:${c.target_key ?? i}`} className="flex items-start gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-[var(--text)]">{DOC_TYPE_LABEL[c.doc_type] || c.doc_type}{c.doc_date ? ` ${c.doc_date}` : ''}</span>
                      <Badge color={CANDIDATE_STATE_TONE[state] || 'slate'}>{CANDIDATE_STATE_LABEL[state] || state}</Badge>
                    </div>
                    <div className="text-caption text-[var(--text-3)] mt-0.5">{c.reason}</div>
                    {doc && docPageLink({ doc_type: c.doc_type, id: doc.id }) && (
                      <Link to={docPageLink({ doc_type: c.doc_type, id: doc.id })} className="inline-flex items-center gap-1 mt-1 text-footnote font-medium text-[var(--blue-text)] hover:underline min-h-11 md:min-h-0">
                        開啟文件(版本 {doc.versionNo}) <MSym name="arrow_forward" size={12} />
                      </Link>
                    )}
                  </div>
                  {editable && onToggleExclude && c.state !== 'drafted' && c.state !== 'locked' && (
                    <Button variant="ghost" size="sm" onClick={() => onToggleExclude(i, !c.excluded)}>{c.excluded ? '取消排除' : '排除'}</Button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* 一次補齊:本批文件共用的位置／數量／天氣填一次(P3e;只有上傳方可補,欄位由伺服器列出) */}
      {editable && intake.id && (
        <IntakeSharedInputs intakeId={intake.id} onApplied={onSharedApplied}
          refreshKey={`${intake.status}|${candidates.map((c) => `${c.document_id || ''}:${c.state || ''}`).join(',')}`} />
      )}

      {/* 無法判定日期的照片:補批次日期後重試(設計 §3.1 第 6 步 blocked_by log_date) */}
      {editable && blocked && onFixDate && (
        <div className="flex items-end gap-2 flex-wrap p-3 rounded-lg bg-[var(--amber-tint)]">
          <Field label="指定這批照片的日期"><Input type="date" value={dateDraft || ''} onChange={(e) => setDateDraft?.(e.target.value)} className="!w-44" /></Field>
          <Button variant="secondary" busy={fixDateBusy} disabled={!dateDraft} onClick={() => onFixDate(dateDraft)}>補日期並重試</Button>
        </div>
      )}
    </div>
  )
}
