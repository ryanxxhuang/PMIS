import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Printer, Zap } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Badge, Empty, PageHeader } from '../../components/ui.jsx'
import { appConfirm, appPrompt } from '../../components/confirm.jsx'
import { judgeChecklist, judgeItem, diffChecklistResults } from '../../lib/qc.js'
import DefectTracker, { WorkItemPicker } from '../../components/DefectTracker.jsx'
import MarkupEditor, { MarkupThumb } from '../../components/MarkupEditor.jsx'

const inspColor = { 待查驗: 'amber', 合格: 'green', 不合格: 'red' }
const input = 'w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm transition-colors placeholder:text-[var(--text-3)] focus:border-[var(--blue)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/20'

export default function Quality() {
  const { project, workItems, inspections, createInspection, recordInspectionResult, deleteInspection,
    checklistTemplates, checklistRecords, createChecklistRecord, deleteChecklistRecord,
    testSamples, createTestSamples, generateSamplesFromLogs, updateTestSample, deleteTestSample,
    observations, createObservation, updateObservation, escalateObservation, deleteObservation,
    isSupabaseConfigured, currentProject, workItemsSource, can, resolveMarkup } = useStore()
  const [inspForm, setInspForm] = useState(null) // null=收起；物件=展開
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('') // 判定寫入失敗必須讓使用者看到(失敗=UI 不變)

  const leaves = useMemo(() => {
    if (!workItems) return []
    const childMap = new Map()
    for (const it of workItems.items) { const k = it.parent_key || '__root__'; if (!childMap.has(k)) childMap.set(k, []); childMap.get(k).push(it) }
    return workItems.items.filter((it) => it.is_billable && !it.is_rollup && !(childMap.get(it.item_key)?.length))
  }, [workItems])

  if (!workItems) return <Empty>載入中…</Empty>
  if (isSupabaseConfigured && currentProject && workItemsSource !== 'db') {
    return <Card title="品質查驗"><Empty>此專案的標單尚未匯入資料庫。請先到「標單工項」匯入標單。</Empty></Card>
  }

  const submitInsp = async () => {
    setBusy(true); await createInspection(inspForm); setBusy(false); setInspForm(null)
  }
  const onResult = async (insp, pass) => {
    let note = ''
    if (!pass) {
      note = await appPrompt({
        title: `判定不合格：${insp.title}`, label: '不合格原因 / 缺失說明（必填）',
        required: true, danger: true, confirmLabel: '判定不合格並開立缺失',
      })
      if (note === null) return
    }
    setErrMsg(''); setBusy(true)
    const { error } = await recordInspectionResult(insp, pass, note)
    setBusy(false)
    if (error) setErrMsg(`查驗判定未寫入：${error.message}`)
  }
  const openInsp = inspections.filter((i) => i.status === '待查驗').length

  return (
    <div className="space-y-5">
      <div>
        <PageHeader title="品質查驗" tagline="三級品管" subtitle="查驗申請 → 監造查驗 → 不合格開缺失 → 改善複查結案" />
      </div>

      {errMsg && (
        <div className="flex items-start justify-between gap-2 text-sm bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2">
          <span>{errMsg}</span>
          <button onClick={() => setErrMsg('')} className="shrink-0 text-rose-400 hover:text-rose-700" aria-label="關閉錯誤訊息">✕</button>
        </div>
      )}

      {/* 查驗 */}
      <Card title={`查驗（待查驗 ${openInsp}）`} action={can.submit && <Button variant="secondary" onClick={() => setInspForm(inspForm ? null : { title: '', location: '', inspection_type: '施工查驗', requested_date: '', work_item_key: '', work_item_label: '' })}>{inspForm ? '取消' : '＋ 查驗申請'}</Button>}>
        {inspForm && (
          <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 space-y-3">
            <WorkItemPicker leaves={leaves} value={inspForm.work_item_key} label={inspForm.work_item_label} onPick={(k, l) => setInspForm((f) => ({ ...f, work_item_key: k || '', work_item_label: l }))} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="查驗項目"><input className={input} value={inspForm.title} onChange={(e) => setInspForm((f) => ({ ...f, title: e.target.value }))} placeholder="如 混凝土澆置前查驗" /></Field>
              <Field label="位置"><input className={input} value={inspForm.location} onChange={(e) => setInspForm((f) => ({ ...f, location: e.target.value }))} placeholder="如 A 區 1F" /></Field>
              <Field label="類型"><select className={input} value={inspForm.inspection_type} onChange={(e) => setInspForm((f) => ({ ...f, inspection_type: e.target.value }))}><option>施工查驗</option><option>材料查驗</option><option>隱蔽查驗</option></select></Field>
              <Field label="申請查驗日"><input type="date" className={input} value={inspForm.requested_date} onChange={(e) => setInspForm((f) => ({ ...f, requested_date: e.target.value }))} /></Field>
            </div>
            <Button onClick={submitInsp} disabled={busy || !inspForm.title}>送出查驗申請</Button>
          </div>
        )}
        {inspections.length === 0 ? <Empty>尚無查驗紀錄</Empty> : (
          <div className="space-y-2">
            {inspections.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 border-b border-[var(--border-2)] pb-2 text-sm">
                <div className="min-w-0">
                  <div className="text-[var(--text)]">{i.title} <Badge color={inspColor[i.status] || 'slate'}>{i.status}</Badge></div>
                  <div className="text-xs text-[var(--text-3)] truncate">{i.work_item_no && `${i.work_item_no} `}{i.location} · {i.inspection_type} · {i.requested_date || ''}{i.result_note ? ` · ${i.result_note}` : ''}</div>
                </div>
                <div className="flex gap-2 shrink-0 items-center">
                  {i.status === '待查驗' && (can.approve ? <>
                    <Button variant="success" onClick={() => onResult(i, true)} disabled={busy}>合格</Button>
                    <Button variant="danger" onClick={() => onResult(i, false)} disabled={busy}>不合格</Button>
                  </> : <span className="text-xs text-[var(--text-3)]">待監造查驗</span>)}
                  {/* 已判定查驗=品質證據,不提供刪除(DB 另有 guard) */}
                  {can.edit && i.status === '待查驗' && <button onClick={async () => { if (await appConfirm({ title: '刪除此查驗紀錄？', danger: true, confirmLabel: '刪除' })) { setErrMsg(''); const { error } = await deleteInspection(i.id); if (error) setErrMsg(`刪除失敗：${error.message}`) } }} className="text-[var(--text-3)] hover:text-rose-500" aria-label={`刪除查驗 ${i.title}`}>✕</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 缺失:統一缺失引擎(與工安缺失同狀態機),此處只列品質 domain */}
      <DefectTracker domain="quality" leaves={leaves} />

      {/* 觀察事項:比缺失輕的現場提醒,可升級成正式缺失 */}
      <ObservationsSection observations={observations} canWrite={can.edit || can.approve}
        onCreate={createObservation} onUpdate={updateObservation} onEscalate={escalateObservation}
        onDelete={deleteObservation} resolveMarkup={resolveMarkup} />

      {/* 自主檢查表:量化標準 → 實測值 → 自動判定 */}
      <ChecklistSection templates={checklistTemplates} records={checklistRecords} canEdit={can.edit}
        onCreate={createChecklistRecord} onDelete={deleteChecklistRecord} />

      {/* 取樣試驗:試體齡期追蹤 + fc′ 自動判定 */}
      <SamplesSection samples={testSamples} onGenerate={generateSamplesFromLogs} canEdit={can.edit}
        onCreate={createTestSamples} onUpdate={updateTestSample} onDelete={deleteTestSample} />

      <p className="text-xs text-[var(--text-3)]">三級品管：廠商提查驗申請 → 監造現場查驗（合格/不合格）→ 不合格自動開缺失 → 廠商改善 → 監造複查結案。自主檢查依範本量化標準自動判定、試體依 fc′ 自動判定，不合格皆自動開缺失；試驗到期自動進提醒中心。</p>
    </div>
  )
}

// 判定章:○ 合格 / ✕ 不合格 / — 未檢
function PassMark({ pass }) {
  if (pass === true) return <span className="text-[var(--green-text)] font-semibold">○</span>
  if (pass === false) return <span className="text-[var(--red-text)] font-semibold">✕</span>
  return <span className="text-[var(--text-3)]">—</span>
}

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// 修訂差異的值顯示:✓/✗(bool)、數值、—(未檢)
const fmtVal = (v) => (v === true ? '✓' : v === false ? '✗' : v ?? '—')

// ── 自主檢查表:選範本 → 填實測值 → 依量化標準自動判定 → 不合格自動開缺失。
// 存檔後為證據不可就地修改:更正一律建立修訂版次 Rev.N(必附原因),重新判定
// 並連動缺失(同鏈不重複開);僅未判定的紀錄可刪除。
function ChecklistSection({ templates, records, onCreate, onDelete, canEdit }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [revising, setRevising] = useState(null) // 修訂模式:被修訂的紀錄(現行版)
  const [reason, setReason] = useState('')
  const [tplId, setTplId] = useState(templates[0]?.id)
  const [date, setDate] = useState(todayIso())
  const [location, setLocation] = useState('')
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [historyOf, setHistoryOf] = useState(null) // 展開歷次版本的鏈根 id

  const template = revising
    ? templates.find((t) => t.id === revising.template_id)
    : (templates.find((t) => t.id === tplId) || templates[0])
  const live = useMemo(() => (template ? judgeChecklist(template, values) : null), [template, values])

  // 修訂鏈:依 root_id 分組,rev 最大者為現行版,其餘為歷次版本
  const chains = useMemo(() => {
    const byRoot = new Map()
    for (const r of records) {
      const root = r.root_id || r.id
      if (!byRoot.has(root)) byRoot.set(root, [])
      byRoot.get(root).push(r)
    }
    return [...byRoot.values()]
      .map((revs) => {
        revs.sort((a, b) => (b.rev || 0) - (a.rev || 0))
        return { current: revs[0], history: revs.slice(1) }
      })
      .sort((a, b) => (b.current.check_date || '').localeCompare(a.current.check_date || ''))
  }, [records])

  const setVal = (no, v) => setValues((p) => ({ ...p, [no]: v }))
  const closeForm = () => { setOpen(false); setRevising(null); setValues({}); setReason('') }
  const startRevise = (r) => {
    setMsg(''); setRevising(r); setOpen(true); setReason('')
    setDate(r.check_date || todayIso()); setLocation(r.location || '')
    setValues(Object.fromEntries(
      Object.entries(r.results || {}).filter(([, v]) => v?.value != null).map(([no, v]) => [no, v.value])))
  }
  const save = async () => {
    setSaving(true); setMsg('')
    const res = await onCreate({
      template, check_date: date, location, values,
      revises: revising || undefined, revision_reason: revising ? reason.trim() : undefined,
    })
    setSaving(false)
    if (res.error) { setMsg(res.error.message || '存檔失敗'); return }
    const revTag = res.rev ? `Rev.${res.rev}：` : ''
    if (res.defectAction === 'created') setMsg(`已存檔 ${revTag}判定不合格，系統已自動開立缺失。`)
    else if (res.defectAction === 'linked') setMsg(`已存檔 ${revTag}判定不合格；此檢查表已有未結案缺失，未重複開立。`)
    else if (res.defectError) setMsg(`已存檔 ${revTag}判定不合格，但缺失開立失敗：${res.defectError.message}`)
    else if (res.overall === '合格' && res.openDefectRemains) setMsg(`已存檔 ${revTag}更正後判定合格。原自動開立的缺失仍在追蹤中，請至缺失區確認後續處理。`)
    else setMsg(`已存檔 ${revTag}判定${res.overall || '未完成'} ✓`)
    closeForm()
  }
  const del = async (r) => {
    if (!(await appConfirm({ title: '刪除此檢查紀錄？', body: '僅未判定的紀錄可刪除；已判定的證據請以「修訂」更正。', danger: true, confirmLabel: '刪除' }))) return
    const res = await onDelete(r.id)
    if (res?.error) setMsg(res.error.message)
  }

  let lastGroup = null
  return (
    <Card title={`自主檢查表（${chains.length}）`} action={
      canEdit && <Button variant="secondary" onClick={() => { if (open) closeForm(); else setOpen(true); setMsg('') }}>{open ? '取消' : '＋ 新增檢查'}</Button>
    }>
      {msg && <p className={`text-sm mb-3 ${msg.includes('不合格') || msg.includes('拒絕') || msg.includes('不可') ? 'text-[var(--accent-text)]' : 'text-emerald-600'}`}>{msg}</p>}

      {open && template && (
        <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 space-y-3">
          {revising && (
            <p className="text-sm font-medium text-[var(--text)]">
              修訂 Rev.{(revising.rev || 0) + 1} — 原版{revising.rev ? ` Rev.${revising.rev}` : ''}（{revising.check_date} 判定{revising.overall || '未判定'}）不會被覆寫，將以新版次留存差異。
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="檢查表範本">
              {revising ? (
                <span className="text-sm px-2.5 py-1.5 inline-block">{template.title}</span>
              ) : (
                <select value={tplId} onChange={(e) => { setTplId(e.target.value); setValues({}) }}
                  className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)]">
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              )}
            </Field>
            <Field label="檢查日期"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)]" /></Field>
            <Field label="檢查位置"><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="如 4F 版牆" className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)] w-36" /></Field>
            {revising && (
              <Field label="更正原因（必填）">
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如 坍度登載錯誤，依取樣紀錄更正"
                  className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)] w-72" />
              </Field>
            )}
          </div>
          <p className="text-[11px] text-[var(--text-3)]">依據：{template.source}。填實測值即時判定；未填的項目視為未檢，不列入判定。</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                  <th className="text-left font-medium py-1.5 w-14">項次</th>
                  <th className="text-left font-medium">檢查項目</th>
                  <th className="text-left font-medium px-2">檢查標準</th>
                  <th className="text-right font-medium px-2 w-36">實測值</th>
                  <th className="text-center font-medium w-12">判定</th>
                </tr>
              </thead>
              <tbody>
                {template.items.map((it) => {
                  const groupRow = it.group !== lastGroup
                  lastGroup = it.group
                  return [
                    groupRow && (
                      <tr key={`g-${it.group}`}><td colSpan={5} className="pt-2 pb-1 text-[11px] font-semibold tracking-[0.08em] text-[var(--text-3)]">{it.group}</td></tr>
                    ),
                    <tr key={it.no} className="border-b border-[var(--border-2)]">
                      <td className="py-1.5 text-xs text-[var(--text-3)] tabular-nums">{it.no}</td>
                      <td className="py-1.5 pr-2">{it.item}</td>
                      <td className="py-1.5 px-2 text-xs text-[var(--text-2)]">{it.standard}</td>
                      <td className="py-1.5 px-2 text-right">
                        {it.kind === 'bool' ? (
                          <input type="checkbox" checked={values[it.no] === true}
                            onChange={(e) => setVal(it.no, e.target.checked)} />
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <input type="number" step="any" value={values[it.no] ?? ''}
                              onChange={(e) => setVal(it.no, e.target.value === '' ? '' : Number(e.target.value))}
                              className="w-24 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-sm tabular-nums bg-[var(--surface)]" />
                            <span className="text-[10px] text-[var(--text-3)] w-10">{it.unit || ''}</span>
                          </span>
                        )}
                      </td>
                      <td className="text-center"><PassMark pass={judgeItem(it, values[it.no])} /></td>
                    </tr>,
                  ]
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving || (revising && !reason.trim())}>{saving ? '存檔中…' : revising ? `存檔為 Rev.${(revising.rev || 0) + 1} 並重新判定` : '存檔並判定'}</Button>
            {revising && !reason.trim() && <span className="text-xs text-[var(--text-3)]">請先填寫更正原因</span>}
            {live?.overall && (
              <Badge color={live.overall === '合格' ? 'green' : 'red'}>目前判定：{live.overall}{live.failed.length ? `（${live.failed.length} 項不合格）` : ''}</Badge>
            )}
          </div>
        </div>
      )}

      {chains.length === 0 ? <Empty>尚無自主檢查紀錄。選範本填實測值，系統依量化標準自動判定。</Empty> : (
        <div className="space-y-1.5">
          {chains.map(({ current: r, history }) => {
            const tpl = templates.find((t) => t.id === r.template_id)
            const rootId = r.root_id || r.id
            const prev = history.find((h) => h.id === r.supersedes_id)
            const diffs = (r.rev || 0) > 0 && tpl && prev ? diffChecklistResults(tpl, prev.results, r.results) : []
            return (
              <div key={rootId} className="border-b border-[var(--border-2)] pb-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="tabular-nums text-[var(--text-3)] text-xs mr-2">{r.check_date}</span>
                    <span className="text-[var(--text)]">{tpl?.title || '（範本已刪除）'}</span>
                    {(r.rev || 0) > 0 && <Badge color="blue">Rev.{r.rev}</Badge>}
                    {r.location && <span className="text-xs text-[var(--text-3)] ml-2">{r.location}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge color={r.overall === '合格' ? 'green' : r.overall === '不合格' ? 'red' : 'slate'}>{r.overall || '未判定'}</Badge>
                    <button onClick={() => navigate(`/quality/checklist-print?id=${r.id}`)} title="列印自主檢查表"
                      className="text-[var(--blue)] hover:underline text-xs inline-flex items-center gap-1"><Printer size={13} aria-hidden />列印</button>
                    {canEdit && tpl && (
                      <button onClick={() => startRevise(r)} title="以修訂版次更正（不覆寫舊證據）"
                        className="text-[var(--blue)] hover:underline text-xs">修訂</button>
                    )}
                    {history.length > 0 && (
                      <button onClick={() => setHistoryOf(historyOf === rootId ? null : rootId)}
                        className="text-[var(--text-3)] hover:underline text-xs">歷次 {history.length}</button>
                    )}
                    {canEdit && !r.overall && (
                      <button onClick={() => del(r)} aria-label="刪除未判定的檢查紀錄" className="text-[var(--text-3)] hover:text-rose-500">✕</button>
                    )}
                  </div>
                </div>
                {(r.rev || 0) > 0 && r.revision_reason && (
                  <div className="text-[11px] text-[var(--text-3)] mt-0.5">
                    更正原因：{r.revision_reason}
                    {diffs.length > 0 && <span className="ml-2">異動：{diffs.map((d) => `${d.no} ${fmtVal(d.from)}→${fmtVal(d.to)}`).join('、')}</span>}
                  </div>
                )}
                {historyOf === rootId && history.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 text-xs text-[var(--text-3)] mt-1 pl-4">
                    <span>Rev.{h.rev || 0}</span>
                    <span className="tabular-nums">{h.check_date}</span>
                    <Badge color="slate">{h.overall || '未判定'}</Badge>
                    <span>已由新版取代</span>
                    {(h.rev || 0) > 0 && h.revision_reason && <span className="truncate">（{h.revision_reason}）</span>}
                    <button onClick={() => navigate(`/quality/checklist-print?id=${h.id}`)}
                      className="text-[var(--blue)] hover:underline shrink-0">列印</button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
      <p className="text-[11px] text-[var(--text-3)] mt-2">檢查表存檔後即為品質證據，不可就地修改：更正一律以「修訂」建立 Rev.N 留存差異與原因，並重新自動判定；改判不合格會自動開立缺失（同一張表已有未結案缺失時不重複開）。僅未判定的紀錄可刪除。</p>
    </Card>
  )
}

// ── 取樣試驗:澆置日誌 → 試體組 → 7/28 天齡期 → 抗壓值自動判定 ──
function SamplesSection({ samples, onGenerate, onCreate, onUpdate, onDelete, canEdit }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [manual, setManual] = useState({ sampled_date: todayIso(), fc: 420, location: '' })
  const [addOpen, setAddOpen] = useState(false)
  const today = todayIso()

  const gen = async () => {
    setBusy(true); setMsg('')
    const { error, count } = await onGenerate()
    setBusy(false)
    setMsg(error ? (error.message || '帶入失敗') : count ? `已由施工日誌帶入 ${count} 組取樣。` : '施工日誌沒有尚未建檔的澆置紀錄。')
  }
  const addManual = async () => {
    if (!manual.sampled_date) return
    setBusy(true)
    await onCreate([manual])
    setBusy(false); setAddOpen(false)
  }
  const dueCell = (due, filled) => {
    if (!due) return null
    const overdue = !filled && due < today
    return <span className={`tabular-nums text-xs ${overdue ? 'text-[var(--accent-text)] font-semibold' : 'text-[var(--text-3)]'}`}>{due}{overdue ? ' 逾期' : ''}</span>
  }

  return (
    <Card title={`取樣試驗（${samples.length}）`} action={
      canEdit && <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={gen} disabled={busy}><Zap size={14} aria-hidden />從施工日誌帶入</Button>
        <Button variant="secondary" onClick={() => setAddOpen((o) => !o)}>{addOpen ? '取消' : '＋ 手動新增'}</Button>
      </div>
    }>
      {msg && <p className="text-sm mb-3 text-[var(--text-2)]">{msg}</p>}
      {addOpen && (
        <div className="bg-[var(--surface-2)] rounded-lg p-3 mb-4 flex flex-wrap items-end gap-3">
          <Field label="取樣(澆置)日"><input type="date" value={manual.sampled_date} onChange={(e) => setManual({ ...manual, sampled_date: e.target.value })} className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)]" /></Field>
          <Field label="fc′ (kgf/cm²)"><input type="number" value={manual.fc} onChange={(e) => setManual({ ...manual, fc: Number(e.target.value) || null })} className="w-28 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)] text-right tabular-nums" /></Field>
          <Field label="位置"><input value={manual.location} onChange={(e) => setManual({ ...manual, location: e.target.value })} className="w-36 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm bg-[var(--surface)]" /></Field>
          <Button onClick={addManual} disabled={busy}>建立試體組</Button>
        </div>
      )}

      {samples.length === 0 ? (
        <Empty>尚無試體。按「從施工日誌帶入」，凡日誌材料含混凝土的澆置日會自動建檔並排 7 / 28 天試驗到期日。</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                <th className="text-left font-medium py-1.5">試體編號</th>
                <th className="text-left font-medium px-2">取樣日</th>
                <th className="text-right font-medium px-2">fc′</th>
                <th className="text-right font-medium px-2">7天(參考)</th>
                <th className="text-right font-medium px-2">28天各試體 kgf/cm²</th>
                <th className="text-center font-medium px-2">判定</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {samples.map((s) => (
                <tr key={s.id} className="border-b border-[var(--border-2)]">
                  <td className="py-1.5 tabular-nums text-xs">{s.sample_no}<div className="text-[10px] text-[var(--text-3)]">{s.location}</div></td>
                  <td className="px-2 tabular-nums text-xs text-[var(--text-2)]">{s.sampled_date}</td>
                  <td className="px-2 text-right tabular-nums">{s.fc || '—'}</td>
                  <td className="px-2 text-right">
                    <input type="number" step="any" defaultValue={s.d7_value ?? ''} placeholder="值"
                      aria-label={`${s.sample_no} 7天參考值`}
                      onBlur={async (e) => { const n = parseFloat(e.target.value); if (!isNaN(n) && n !== s.d7_value) { const { error } = await onUpdate(s.id, { d7_value: n }); if (error) setMsg(`未寫入：${error.message}`) } }}
                      className="w-16 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-xs tabular-nums" />
                    <div>{dueCell(s.d7_due, s.d7_value != null)}</div>
                  </td>
                  <td className="px-2 text-right">
                    <input defaultValue={(s.d28_values || []).join(', ')} placeholder="如 445, 432, 428"
                      aria-label={`${s.sample_no} 28天各試體值`}
                      onBlur={async (e) => {
                        const arr = e.target.value.split(/[,、\s]+/).map(Number).filter((n) => !isNaN(n) && n > 0)
                        if (JSON.stringify(arr) !== JSON.stringify(s.d28_values || [])) {
                          const { error } = await onUpdate(s.id, { d28_values: arr.length ? arr : null })
                          if (error) setMsg(`試驗值未寫入：${error.message}`)
                        }
                      }}
                      className="w-36 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-xs tabular-nums" />
                    <div>{dueCell(s.d28_due, (s.d28_values || []).length > 0)}</div>
                  </td>
                  <td className="px-2 text-center">
                    <Badge color={s.status === '合格' ? 'green' : s.status === '不合格' ? 'red' : 'slate'}>{s.status}</Badge>
                  </td>
                  {/* 已判定試體=品質證據,不提供刪除(DB 另有 guard) */}
                  <td className="text-right pl-2">{s.status === '待試驗' && (
                    <button onClick={async () => { if (await appConfirm({ title: `刪除試體 ${s.sample_no}？`, danger: true, confirmLabel: '刪除' })) { const { error } = await onDelete(s.id); if (error) setMsg(`刪除失敗：${error.message}`) } }} className="text-[var(--text-3)] hover:text-rose-500" aria-label={`刪除試體 ${s.sample_no}`}>✕</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-[var(--text-3)] mt-2">28 天判定標準（03310）：任一試體 ≥ 0.85 fc′ 且平均 ≥ fc′；不合格自動開立缺失。到期未試驗會出現在提醒中心。</p>
    </Card>
  )
}

// ── 觀察事項:輕量現場提醒（比缺失輕）→ 標記已處理 或 升級為缺失 ──
const OBS_STATUS_COLOR = { 待處理: 'amber', 已處理: 'green', 轉缺失: 'slate' }
function ObservationsSection({ observations, canWrite, onCreate, onUpdate, onEscalate, onDelete, resolveMarkup }) {
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [markupOpen, setMarkupOpen] = useState(false)

  const submit = async () => {
    setBusy(true); await onCreate(form); setBusy(false); setForm(null)
  }
  const open = observations.filter((o) => o.status === '待處理').length

  return (
    <Card title={`觀察事項（待處理 ${open}）`} action={
      canWrite && <Button variant="secondary" onClick={() => setForm(form ? null : { title: '', description: '', location: '', assigned_to: 'contractor' })}>{form ? '取消' : '＋ 新增觀察'}</Button>
    }>
      {form && (
        <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="觀察主旨"><input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如 4F 東側樓梯開口未設護欄" /></Field>
            <Field label="位置"><input className={input} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="如 4F 東側" /></Field>
          </div>
          <Field label="說明"><textarea rows={2} className={input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="現場觀察到、提醒改善的事項（尚未到開立缺失的程度）" /></Field>
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={submit} disabled={busy || !form.title}>新增觀察</Button>
            <Button variant="secondary" onClick={() => setMarkupOpen(true)}>🖍 圖面/照片標註{form.markup_data ? '（已附）' : ''}</Button>
            {form.markup_data && <MarkupThumb src={form.markup_data} />}
          </div>
          {markupOpen && <MarkupEditor title="把觀察位置匡起來" initialImage={form.markup_data}
            onSave={(d) => { setForm((f) => ({ ...f, markup_data: d })); setMarkupOpen(false) }} onClose={() => setMarkupOpen(false)} />}
        </div>
      )}

      {observations.length === 0 ? <Empty>尚無觀察事項。現場看到「不對但還沒到缺失」的狀況先記為觀察，處理掉或必要時一鍵升級為缺失。</Empty> : (
        <div className="space-y-2">
          {observations.map((o) => (
            <div key={o.id} className="flex items-start justify-between gap-3 border-b border-[var(--border-2)] pb-2">
              <div className="min-w-0">
                <div className="text-sm text-[var(--text)]">{o.title} <Badge color={OBS_STATUS_COLOR[o.status] || 'slate'}>{o.status}</Badge></div>
                <div className="text-xs text-[var(--text-3)] truncate">{o.location}{o.description ? ` · ${o.description}` : ''}</div>
                {o.markup_path && <div className="mt-1"><MarkupThumb src={o.markup_path} resolve={resolveMarkup} /></div>}
              </div>
              {canWrite && o.status !== '轉缺失' && (
                <div className="flex items-center gap-2 shrink-0">
                  {o.status === '待處理' && <>
                    <Button variant="secondary" onClick={() => onUpdate(o.id, { status: '已處理' })}>標記已處理</Button>
                    <Button variant="outline" onClick={async () => { if (await appConfirm({ title: '升級為正式缺失？', body: '將自動開立缺失單追蹤改善。', confirmLabel: '升級' })) onEscalate(o) }}>升級為缺失</Button>
                  </>}
                  <button onClick={async () => { if (await appConfirm({ title: '刪除此觀察？', danger: true, confirmLabel: '刪除' })) onDelete(o.id) }} className="text-[var(--text-3)] hover:text-rose-500 text-xs">✕</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-[var(--text-3)] mt-2">觀察事項是比缺失輕的提醒（現場口頭提醒的數位化）：可標記已處理，或在必要時一鍵升級為正式缺失單（進入改善→複查→結案流程）。</p>
    </Card>
  )
}
