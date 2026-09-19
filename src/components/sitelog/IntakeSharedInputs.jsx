// 批次結果的「一次補齊」(P3e;設計 field-documents-lifecycle §2.4):同一批照片產生的文件共用的現場事實
// (某日某工項的施作位置、當日完成數量、天氣)在這裡填一次,伺服器替本批仍在草稿／待補的同方文件各建一個人工版本。
// 哪些欄可共用、每份文件會怎樣(將寫入／已套用／已個別填寫不覆蓋／已簽署不受影響)全由伺服器
// list_intake_shared_inputs 判定,這裡只呈現;寫入走 set_intake_shared_input(版本、雜湊、待補重算都是存版 RPC 的規則)。
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Badge, Button, Input } from '../ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import {
  DOC_TYPE_LABEL, SHARED_EFFECT_TONE, docPageLink, groupSharedFields, sharedApplySummary, sharedEffectLabel,
  sharedFieldTitle, sharedInputValue, sharedPendingDocs,
} from '../../lib/fieldDocs.js'

const shown = (v) => (v == null ? '' : String(v))

// refreshKey:批次狀態／候選文件變了(起稿續跑新增文件、重新整理)就重讀清單
export default function IntakeSharedInputs({ intakeId, refreshKey = '', onApplied }) {
  const { listIntakeSharedInputs, setIntakeSharedInput } = useStore()
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [drafts, setDrafts] = useState({}) // key → 輸入中的字串
  const [busyKey, setBusyKey] = useState(null)
  const [msg, setMsg] = useState({}) // key → { text, tone }

  const load = useCallback(async () => {
    const r = await listIntakeSharedInputs(intakeId)
    if (r.error) { setLoadError(friendlyError(r.error, '共用欄位讀取失敗')); return }
    setLoadError(null)
    setData(r.data)
  }, [intakeId, listIntakeSharedInputs])
  useEffect(() => { if (intakeId) load() }, [intakeId, refreshKey, load])

  if (loadError) return <p role="status" className="text-footnote text-[var(--red-text)]">{loadError}</p>
  if (!data?.can_edit || !Array.isArray(data.fields) || !data.fields.length) return null

  const apply = async (field) => {
    const raw = drafts[field.key] ?? shown(field.value)
    setBusyKey(field.key)
    setMsg((m) => ({ ...m, [field.key]: null }))
    const r = await setIntakeSharedInput(intakeId, field.key, sharedInputValue(field, raw))
    setBusyKey(null)
    if (r.error) { setMsg((m) => ({ ...m, [field.key]: { text: friendlyError(r.error, '未套用'), tone: 'error' } })); return }
    setMsg((m) => ({ ...m, [field.key]: { text: sharedApplySummary(r.result), tone: 'success' } }))
    setDrafts((d) => { const next = { ...d }; delete next[field.key]; return next })
    onApplied?.(r.result)
    await load()
  }

  return (
    <div role="group" aria-label="一次補齊" className="rounded-lg border border-[var(--border-2)] p-3 space-y-3">
      <div>
        <div className="text-footnote font-medium text-[var(--text)]">一次補齊</div>
        <p className="text-caption text-[var(--text-3)] mt-0.5">
          同一個現場事實填一次，會寫入這批照片產生、仍在草稿或待補的每份文件（各自新增一個人工版本，標「共用補值・已確認」）。
          已簽署或已提送的文件不會被改動；你在文件頁親自填過的值也不會被覆蓋。
        </p>
      </div>
      {groupSharedFields(data.fields).map((g) => (
        <div key={g.date} className="space-y-2">
          <div className="text-caption font-medium text-[var(--text-2)] num">{g.date}</div>
          <ul role="list" className="space-y-3">
            {g.fields.map((f) => {
              const title = sharedFieldTitle(f)
              const draft = drafts[f.key] ?? shown(f.value)
              const pending = sharedPendingDocs(f).length
              const sameAsSaved = f.value != null && draft.trim() === shown(f.value)
              const nothingToDo = sameAsSaved && pending === 0
              const m = msg[f.key]
              return (
                <li key={f.key} className="space-y-1.5">
                  <div className="flex items-end gap-2 flex-wrap">
                    <label className="min-w-0 flex-1 basis-56">
                      <span className="block text-body font-medium text-[var(--text)] mb-1">{title}</span>
                      <span className="flex items-center gap-2">
                        <Input
                          type={f.value_kind === 'number' ? 'number' : 'text'}
                          inputMode={f.value_kind === 'number' ? 'decimal' : undefined}
                          step={f.value_kind === 'number' ? 'any' : undefined}
                          value={draft}
                          onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
                        />
                        {f.value_kind === 'number' && f.work_item?.unit && <span className="text-footnote text-[var(--text-2)] shrink-0">{f.work_item.unit}</span>}
                      </span>
                    </label>
                    <Button variant="secondary" busy={busyKey === f.key} disabled={!draft.trim() || nothingToDo || (!!busyKey && busyKey !== f.key)}
                      onClick={() => apply(f)}>
                      {sameAsSaved && pending > 0 ? `套用到其餘 ${pending} 份` : '套用'}
                    </Button>
                  </div>
                  <ul aria-label={`${title} 影響的文件`} className="flex flex-wrap gap-1.5">
                    {f.documents.map((d) => {
                      const link = docPageLink({ doc_type: d.doc_type, id: d.document_id })
                      const text = `${DOC_TYPE_LABEL[d.doc_type] || d.doc_type}・${sharedEffectLabel(d, f)}`
                      return (
                        <li key={d.document_id}>
                          {link
                            ? <Link to={link} className="inline-flex min-h-11 md:min-h-0 items-center"><Badge color={SHARED_EFFECT_TONE[d.effect] || 'slate'}>{text}</Badge></Link>
                            : <Badge color={SHARED_EFFECT_TONE[d.effect] || 'slate'}>{text}</Badge>}
                        </li>
                      )
                    })}
                  </ul>
                  {m && <p role="status" className={`text-footnote ${m.tone === 'success' ? 'text-[var(--green-text)]' : 'text-[var(--red-text)]'}`}>{m.text}</p>}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
