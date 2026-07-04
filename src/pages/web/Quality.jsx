import { useState, useMemo } from 'react'
import { Camera } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Badge, Empty, PageHeader } from '../../components/ui.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'

const inspColor = { 待查驗: 'amber', 合格: 'green', 不合格: 'red' }
const defColor = { 開立: 'red', 改善中: 'amber', 待複查: 'blue', 已結案: 'green' }
const input = 'w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:border-[var(--blue)] focus:outline-none'

// 小工項挑選器（搜尋 → 選一個）
function WorkItemPicker({ leaves, value, label, onPick }) {
  const [q, setQ] = useState('')
  const results = q.trim() ? leaves.filter((it) => it.description.includes(q.trim()) || (it.item_no || '').includes(q.trim())).slice(0, 12) : []
  if (value) {
    return (
      <div className="flex items-center gap-2 text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface-2)]">
        <span className="truncate flex-1">{label}</span>
        <button onClick={() => onPick(null, '')} className="text-[var(--text-3)] hover:text-rose-500 text-xs">✕</button>
      </div>
    )
  }
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋並選擇工項（可不填）…" className={input} />
      {results.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg max-h-56 overflow-auto">
          {results.map((it) => (
            <button key={it.item_key} onClick={() => { onPick(it.item_key, `${it.item_no} ${it.description}`); setQ('') }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-2)] truncate">
              <span className="text-[var(--text-3)] text-xs mr-2">{it.item_no}</span>{it.description}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Quality() {
  const { project, workItems, inspections, defects, createInspection, recordInspectionResult,
    createDefect, updateDefectStatus, deleteInspection, deleteDefect, describeDefect,
    isSupabaseConfigured, currentProject, workItemsSource } = useStore()
  const [inspForm, setInspForm] = useState(null) // null=收起；物件=展開
  const [defForm, setDefForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState('')

  // 拍缺失照片 → AI 描述 → 填表單
  const onDefectPhoto = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setAiBusy(true); setAiMsg('AI 辨識中…')
    const { error, result } = await describeDefect(file)
    setAiBusy(false)
    if (error) { setAiMsg(`辨識失敗:${error.message || ''}`); return }
    setDefForm((f) => ({
      ...f,
      title: result.title || f.title,
      description: [result.description, result.suggestion && `建議:${result.suggestion}`].filter(Boolean).join(' '),
      severity: result.severity || f.severity,
      location: f.location || result.location || '',
    }))
    setAiMsg(result.title ? 'AI 已填入，請確認後開立。' : 'AI 未辨識出明顯缺失，請人工填寫。')
  }

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
  const submitDef = async () => {
    setBusy(true); await createDefect(defForm); setBusy(false); setDefForm(null)
  }
  const onResult = async (insp, pass) => {
    const note = pass ? '' : (window.prompt('不合格原因 / 缺失說明：') ?? '')
    if (!pass && note === null) return
    setBusy(true); await recordInspectionResult(insp, pass, note); setBusy(false)
  }
  const advanceDefect = async (d) => {
    if (d.status === '開立') return updateDefectStatus(d.id, '改善中')
    if (d.status === '改善中') {
      const note = window.prompt('改善說明：', d.improvement_note || '')
      if (note === null) return
      return updateDefectStatus(d.id, '待複查', { improvement_note: note })
    }
    if (d.status === '待複查') return updateDefectStatus(d.id, '已結案')
  }
  const nextLabel = { 開立: '開始改善', 改善中: '提送複查', 待複查: '複查結案' }

  const openInsp = inspections.filter((i) => i.status === '待查驗').length
  const openDef = defects.filter((d) => d.status !== '已結案').length

  return (
    <div className="space-y-5">
      <div>
        <PageHeader title="品質查驗" tagline="三級品管" subtitle="查驗申請 → 監造查驗 → 不合格開缺失 → 改善複查結案" />
      </div>

      {/* 查驗 */}
      <Card title={`查驗（待查驗 ${openInsp}）`} action={<Button onClick={() => setInspForm(inspForm ? null : { title: '', location: '', inspection_type: '施工查驗', requested_date: '', work_item_key: '', work_item_label: '' })}>{inspForm ? '取消' : '＋ 查驗申請'}</Button>}>
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
                  {i.status === '待查驗' && <>
                    <Button variant="success" onClick={() => onResult(i, true)} disabled={busy}>合格</Button>
                    <Button variant="danger" onClick={() => onResult(i, false)} disabled={busy}>不合格</Button>
                  </>}
                  <button onClick={() => { if (window.confirm('刪除此查驗紀錄？')) deleteInspection(i.id) }} className="text-[var(--text-3)] hover:text-rose-500">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 缺失 */}
      <Card title={`缺失追蹤（未結案 ${openDef}）`} action={<div className="flex items-center gap-3">
        {defects.length > 0 && <button onClick={() => exportCsv(`缺失清單_${stamp()}`, defects, [
          { key: 'title', label: '缺失標題' }, { key: 'work_item_no', label: '工項' }, { key: 'location', label: '位置' },
          { key: 'severity', label: '嚴重度' }, { key: 'status', label: '狀態' }, { key: 'due_date', label: '改善期限' },
          { key: 'improvement_note', label: '改善說明' },
        ])} className="text-sm font-medium text-[var(--blue)] hover:underline">⬇ CSV</button>}
        <Button onClick={() => setDefForm(defForm ? null : { title: '', description: '', severity: '一般', location: '', due_date: '', work_item_key: '', work_item_label: '' })}>{defForm ? '取消' : '＋ 開立缺失'}</Button>
      </div>}>
        {defForm && (
          <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 transition ${aiBusy ? 'opacity-50' : 'cursor-pointer bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] shadow-sm'}`}>
                <input type="file" accept="image/*" capture="environment" disabled={aiBusy} onChange={onDefectPhoto} className="hidden" />
                <Camera size={15} aria-hidden /> {aiBusy ? 'AI 辨識中…' : '拍缺失照片 AI 填表'}
              </label>
              <span className={`text-xs ${aiMsg.startsWith('辨識失敗') ? 'text-rose-600' : 'text-[var(--text-2)]'}`}>{aiMsg || '拍缺失現場，AI 自動填標題/說明/嚴重度。'}</span>
            </div>
            <WorkItemPicker leaves={leaves} value={defForm.work_item_key} label={defForm.work_item_label} onPick={(k, l) => setDefForm((f) => ({ ...f, work_item_key: k || '', work_item_label: l }))} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="缺失標題"><input className={input} value={defForm.title} onChange={(e) => setDefForm((f) => ({ ...f, title: e.target.value }))} placeholder="如 鋼筋保護層不足" /></Field>
              <Field label="位置"><input className={input} value={defForm.location} onChange={(e) => setDefForm((f) => ({ ...f, location: e.target.value }))} /></Field>
              <Field label="嚴重度"><select className={input} value={defForm.severity} onChange={(e) => setDefForm((f) => ({ ...f, severity: e.target.value }))}><option>輕微</option><option>一般</option><option>嚴重</option></select></Field>
              <Field label="改善期限"><input type="date" className={input} value={defForm.due_date} onChange={(e) => setDefForm((f) => ({ ...f, due_date: e.target.value }))} /></Field>
            </div>
            <Field label="說明"><textarea className={input} rows={2} value={defForm.description} onChange={(e) => setDefForm((f) => ({ ...f, description: e.target.value }))} /></Field>
            <Button onClick={submitDef} disabled={busy || !defForm.title}>開立缺失</Button>
          </div>
        )}
        {defects.length === 0 ? <Empty>尚無缺失</Empty> : (
          <div className="space-y-2">
            {defects.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 border-b border-[var(--border-2)] pb-2 text-sm">
                <div className="min-w-0">
                  <div className="text-[var(--text)]">{d.title} <Badge color={defColor[d.status] || 'slate'}>{d.status}</Badge> {d.severity === '嚴重' && <Badge color="red">嚴重</Badge>}</div>
                  <div className="text-xs text-[var(--text-3)] truncate">{d.work_item_no && `${d.work_item_no} `}{d.location}{d.due_date ? ` · 期限 ${d.due_date}` : ''}{d.improvement_note ? ` · 改善：${d.improvement_note}` : ''}</div>
                </div>
                <div className="flex gap-2 shrink-0 items-center">
                  {d.status !== '已結案' && <>
                    {d.status === '待複查' && <Button variant="ghost" onClick={() => updateDefectStatus(d.id, '改善中')} disabled={busy}>退回</Button>}
                    <Button variant={d.status === '待複查' ? 'success' : 'secondary'} onClick={() => advanceDefect(d)} disabled={busy}>{nextLabel[d.status]}</Button>
                  </>}
                  <button onClick={() => { if (window.confirm('刪除此缺失？')) deleteDefect(d.id) }} className="text-[var(--text-3)] hover:text-rose-500">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="text-xs text-[var(--text-3)]">三級品管：廠商提查驗申請 → 監造現場查驗（合格/不合格）→ 不合格自動開缺失 → 廠商改善 → 監造複查結案。查驗/缺失可掛回標單工項。</p>
    </div>
  )
}
