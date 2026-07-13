import { useState } from 'react'
import { useStore } from '../../store.jsx'
import MarkupEditor, { MarkupThumb } from '../../components/MarkupEditor.jsx'
import { Card, Button, Field, Badge, BallChip, Empty, PageHeader } from '../../components/ui.jsx'
import { appConfirm, appPrompt } from '../../components/confirm.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { rfiBall } from '../../lib/ballInCourt.js'

const STATUS_COLOR = { 待回覆: 'amber', 已回覆: 'blue', 已結案: 'green' }
const input = 'w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm transition-colors placeholder:text-[var(--text-3)] focus:border-[var(--blue)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/20'
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function RFI() {
  const { project, rfis, createRfi, answerRfi, closeRfi, deleteRfi, resolveMarkup,
    isSupabaseConfigured, currentProject, can } = useStore()
  const [markupOpen, setMarkupOpen] = useState(false)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('') // 回覆/結案寫入失敗必須讓使用者看到(失敗=UI 不變)

  if (isSupabaseConfigured && !currentProject) {
    return <Card title="工程疑義"><Empty>請先登入並選擇專案。</Empty></Card>
  }

  const submit = async () => {
    setBusy(true); await createRfi(form); setBusy(false); setForm(null)
  }
  const onAnswer = async (r) => {
    const ans = await appPrompt({
      title: `回覆：${r.rfi_no}`, body: r.question || r.title,
      label: '回覆內容（必填）', defaultValue: r.answer || '', required: true, confirmLabel: '送出回覆',
    })
    if (ans === null) return
    setErrMsg(''); setBusy(true)
    const { error } = await answerRfi(r.id, ans.trim())
    setBusy(false)
    if (error) setErrMsg(`回覆未寫入：${error.message}`)
  }
  const onClose = async (r) => {
    setErrMsg(''); setBusy(true)
    const { error } = await closeRfi(r.id)
    setBusy(false)
    if (error) setErrMsg(`結案未寫入：${error.message}`)
  }

  const open = rfis.filter((r) => r.status === '待回覆').length

  const exportRows = () => exportCsv(`工程疑義_${stamp()}`, rfis, [
    { key: 'rfi_no', label: '編號' }, { key: 'title', label: '主旨' }, { key: 'status', label: '狀態' },
    { key: 'question', label: '疑義內容' }, { key: 'answer', label: '回覆' },
    { key: 'asked_date', label: '提出日' }, { key: 'due_date', label: '期限' }, { key: 'answered_date', label: '回覆日' },
  ])

  return (
    <div className="space-y-5">
      <PageHeader title="工程疑義" tagline="RFI" subtitle="施工提出疑義 → 監造回覆 → 結案；可標註工期 / 費用影響"
        action={
          <div className="flex items-center gap-2">
            {rfis.length > 0 && <button onClick={exportRows} className="text-sm font-medium text-[var(--blue)] hover:underline">⬇ CSV</button>}
            {can.submit && <Button variant="secondary" onClick={() => setForm(form ? null : { title: '', question: '', asked_date: todayIso(), due_date: '', cost_impact: false, schedule_impact: false })}>{form ? '取消' : '＋ 提出疑義'}</Button>}
          </div>
        } />

      {errMsg && (
        <div className="flex items-start justify-between gap-2 text-sm bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2">
          <span>{errMsg}</span>
          <button onClick={() => setErrMsg('')} className="shrink-0 text-rose-400 hover:text-rose-700" aria-label="關閉錯誤訊息">✕</button>
        </div>
      )}

      {form && (
        <Card>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2"><Field label="主旨"><input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如 3F 樑柱接頭鋼筋與機電套管衝突" /></Field></div>
            <div className="md:col-span-2"><Field label="疑義內容"><textarea rows={3} className={input} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="描述現場狀況、涉及圖說編號、請釋疑的事項…" /></Field></div>
            <Field label="提出日"><input type="date" className={input} value={form.asked_date} onChange={(e) => setForm({ ...form, asked_date: e.target.value })} /></Field>
            <Field label="希望回覆期限"><input type="date" className={input} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.schedule_impact} onChange={(e) => setForm({ ...form, schedule_impact: e.target.checked })} />涉及工期影響</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.cost_impact} onChange={(e) => setForm({ ...form, cost_impact: e.target.checked })} />涉及費用影響</label>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={submit} disabled={busy || !form.title}>{busy ? '提出中…' : '提出疑義'}</Button>
            <Button variant="secondary" onClick={() => setMarkupOpen(true)}>🖍 圖面標註{form.markup_data ? '（已附）' : ''}</Button>
            {form.markup_data && <MarkupThumb src={form.markup_data} />}
          </div>
          {markupOpen && <MarkupEditor title="把圖面有疑義的位置匡起來" initialImage={form.markup_data}
            onSave={(d) => { setForm({ ...form, markup_data: d }); setMarkupOpen(false) }} onClose={() => setMarkupOpen(false)} />}
        </Card>
      )}

      <Card title={`疑義清單（待回覆 ${open}）`}>
        {rfis.length === 0 ? <Empty>尚無工程疑義。施工遇圖說不明或現場衝突可提出，監造回覆後結案。</Empty> : (
          <div className="space-y-2">
            {rfis.map((r) => (
              <div key={r.id} className="border border-[var(--border-2)] rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-[var(--text)]">
                      <span className="text-[var(--text-3)] text-xs mr-2 tabular-nums">{r.rfi_no}</span>{r.title}
                      <BallChip ball={rfiBall(r)} />
                      {r.schedule_impact && <Badge color="amber">工期</Badge>}
                      {r.cost_impact && <Badge color="red">費用</Badge>}
                    </div>
                    <div className="text-xs text-[var(--text-3)] mt-0.5">提出 {r.asked_date || '—'}{r.due_date ? ` · 期限 ${r.due_date}` : ''}{r.answered_date ? ` · 回覆 ${r.answered_date}` : ''}</div>
                    {r.question && <div className="text-xs text-[var(--text-2)] mt-1">問：{r.question}</div>}
                    {r.answer && <div className="text-xs text-[var(--blue-text)] mt-1">答：{r.answer}</div>}
                    {r.markup_path && <div className="mt-1.5"><MarkupThumb src={r.markup_path} resolve={resolveMarkup} /></div>}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {r.status === '待回覆' && (can.approve
                      ? <Button variant="secondary" disabled={busy} onClick={() => onAnswer(r)}>回覆</Button>
                      : <span className="text-[10px] text-[var(--text-3)]">待監造回覆</span>)}
                    {r.status === '已回覆' && (
                      can.submit ? <Button variant="success" disabled={busy} onClick={() => onClose(r)}>確認結案</Button>
                        : can.approve ? <Button variant="secondary" disabled={busy} onClick={() => onAnswer(r)}>補充回覆</Button> : null
                    )}
                    {/* 僅「待回覆」可刪(已回覆=履約證據,DB 另有 guard) */}
                    {can.submit && r.status === '待回覆' && (
                      <button onClick={async () => {
                        if (!(await appConfirm({ title: '刪除此疑義？', danger: true, confirmLabel: '刪除' }))) return
                        setErrMsg('')
                        const { error } = await deleteRfi(r.id)
                        if (error) setErrMsg(`刪除失敗：${error.message}`)
                      }} className="text-[var(--text-3)] hover:text-rose-500 text-xs">刪除</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="text-xs text-[var(--text-3)]">工程疑義（RFI）：施工遇圖說不明、現場衝突或需設計釋疑時正式提出，監造/設計回覆後由施工確認結案；標註工期/費用影響者，後續可作為變更設計或展延的依據。</p>
    </div>
  )
}
