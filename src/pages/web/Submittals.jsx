import { useState } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Badge, BallChip, Empty, PageHeader } from '../../components/ui.jsx'
import { appConfirm, appPrompt } from '../../components/confirm.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { submittalBall } from '../../lib/ballInCourt.js'

const CATEGORIES = ['施工計畫', '品質計畫', '材料設備', '樣品', '配比', '其他']
const STATUS_COLOR = { 已提送: 'blue', 審核中: 'amber', 核准: 'green', 核備: 'green', 退回補正: 'red', 駁回: 'red' }
const input = 'w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm transition-colors placeholder:text-[var(--text-3)] focus:border-[var(--blue)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/20'
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function Submittals() {
  const { project, submittals, createSubmittal, decideSubmittal, resubmitSubmittal, deleteSubmittal,
    isSupabaseConfigured, currentProject, can } = useStore()
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('') // 審定寫入失敗必須讓使用者看到(失敗=UI 不變)

  if (isSupabaseConfigured && !currentProject) {
    return <Card title="送審文件"><Empty>請先登入並選擇專案。</Empty></Card>
  }

  const submit = async () => {
    setBusy(true); await createSubmittal(form); setBusy(false); setForm(null)
  }
  const onDecide = async (s, status) => {
    const required = status === '退回補正' || status === '駁回'
    const note = await appPrompt({
      title: `${status}：${s.submittal_no}`, body: s.title,
      label: required ? `${status}原因 / 審查意見（必填）` : '審查意見（可留空）',
      // 退回/駁回不預填舊意見:必須寫「本次」的原因,不能沿用受理時的一般意見(P1-01)
      defaultValue: required ? '' : (s.review_note || ''), required, danger: required, confirmLabel: status,
    })
    if (note === null) return
    setErrMsg(''); setBusy(true)
    const { error } = await decideSubmittal(s.id, status, note || s.review_note)
    setBusy(false)
    if (error) setErrMsg(`${status}未寫入：${error.message}`)
  }
  // 修正再送:補正說明必填(P0-01 持久化 + P1-08 實質補正證據)
  const onResubmit = async (s) => {
    const note = await appPrompt({
      title: `修正再送：${s.submittal_no}`, body: s.review_note ? `退回原因：${s.review_note}` : s.title,
      label: '補正說明（必填，將併入附件說明留存）', required: true, confirmLabel: `再送（Rev.${(s.revision || 0) + 1}）`,
    })
    if (note === null) return
    setErrMsg(''); setBusy(true)
    const { error } = await resubmitSubmittal(s.id, note)
    setBusy(false)
    if (error) setErrMsg(`再送未寫入：${error.message}`)
  }

  const pending = submittals.filter((s) => s.status === '已提送' || s.status === '審核中').length

  const exportRows = () => exportCsv(`送審文件_${stamp()}`, submittals, [
    { key: 'submittal_no', label: '編號' }, { key: 'title', label: '名稱' }, { key: 'category', label: '類別' },
    { key: 'revision', label: '版次' }, { key: 'status', label: '狀態' },
    { key: 'submitted_date', label: '提送日' }, { key: 'due_date', label: '審回期限' },
    { key: 'decided_date', label: '審定日' }, { key: 'review_note', label: '審查意見' },
  ])

  return (
    <div className="space-y-5">
      <PageHeader title="送審文件" tagline="Submittal" subtitle="施工計畫 / 品質計畫 / 材料設備 / 樣品送審 → 監造審核核備"
        action={
          <div className="flex items-center gap-2">
            {submittals.length > 0 && <button onClick={exportRows} className="text-sm font-medium text-[var(--blue)] hover:underline">⬇ CSV</button>}
            {can.submit && <Button variant="secondary" onClick={() => setForm(form ? null : { title: '', category: '施工計畫', submitted_date: todayIso(), due_date: '', attachment_note: '' })}>{form ? '取消' : '＋ 提送送審'}</Button>}
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
            <Field label="送審名稱"><input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如 4F 以上結構體施工計畫" /></Field>
            <Field label="類別"><select className={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="提送日"><input type="date" className={input} value={form.submitted_date} onChange={(e) => setForm({ ...form, submitted_date: e.target.value })} /></Field>
            <Field label="監造應審回期限"><input type="date" className={input} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
            <div className="md:col-span-2"><Field label="附件說明"><input className={input} value={form.attachment_note} onChange={(e) => setForm({ ...form, attachment_note: e.target.value })} placeholder="如 含出廠證明、CNS 試驗報告（文件另以公文/雲端連結提送）" /></Field></div>
          </div>
          <div className="mt-3"><Button onClick={submit} disabled={busy || !form.title}>{busy ? '提送中…' : '提送'}</Button></div>
        </Card>
      )}

      <Card title={`送審清單（待審 ${pending}）`}>
        {submittals.length === 0 ? <Empty>尚無送審文件。施工廠商提送計畫/材料，監造審核核備。</Empty> : (
          <div className="space-y-2">
            {submittals.map((s) => (
              <div key={s.id} className="border border-[var(--border-2)] rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-[var(--text)]">
                      <span className="text-[var(--text-3)] text-xs mr-2 tabular-nums">{s.submittal_no}</span>{s.title}
                      {s.revision > 0 && <span className="text-[var(--text-3)] text-xs ml-1">Rev.{s.revision}</span>}
                      <BallChip ball={submittalBall(s)} />
                    </div>
                    <div className="text-xs text-[var(--text-3)] mt-0.5">
                      {s.category} · 提送 {s.submitted_date || '—'}{s.due_date ? ` · 應審回 ${s.due_date}` : ''}{s.decided_date ? ` · 審定 ${s.decided_date}` : ''}
                    </div>
                    {s.attachment_note && <div className="text-xs text-[var(--text-2)] mt-0.5">附件：{s.attachment_note}</div>}
                    {s.review_note && <div className="text-xs text-[var(--amber-text)] mt-0.5">審查意見：{s.review_note}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {/* 監造:審定動作——先受理才可核准/核備(P1-08:不可跳過受理) */}
                    {can.approve && (s.status === '已提送' || s.status === '審核中') && (
                      <div className="flex flex-wrap gap-1.5 justify-end">
                        {s.status === '已提送' && <Button variant="secondary" disabled={busy} onClick={() => onDecide(s, '審核中')}>受理審核</Button>}
                        {s.status === '審核中' && <>
                          <Button variant="success" disabled={busy} onClick={() => onDecide(s, '核准')}>核准</Button>
                          <Button variant="secondary" disabled={busy} onClick={() => onDecide(s, '核備')}>核備</Button>
                        </>}
                        <Button variant="danger" disabled={busy} onClick={() => onDecide(s, '退回補正')}>退回補正</Button>
                      </div>
                    )}
                    {/* 施工:退回補正後修正再送(補正說明必填=實質補正證據) */}
                    {can.submit && s.status === '退回補正' && <Button variant="secondary" disabled={busy} onClick={() => onResubmit(s)}>修正再送</Button>}
                    {can.approve && (s.status === '已提送' || s.status === '審核中') && <span className="text-[10px] text-[var(--text-3)]">待監造審定</span>}
                    {!can.approve && (s.status === '已提送' || s.status === '審核中') && <span className="text-[10px] text-[var(--text-3)]">待監造審定</span>}
                    {can.submit && <button onClick={async () => { if (await appConfirm({ title: '刪除此送審？', danger: true, confirmLabel: '刪除' })) deleteSubmittal(s.id) }} className="text-[var(--text-3)] hover:text-rose-500 text-xs">刪除</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="text-xs text-[var(--text-3)]">送審採 ball-in-court：施工提送 → 監造受理審核 → 核准/核備/退回補正；退回補正後施工修正再送（版次 +1）。v1 文件本體另以公文或雲端連結提送，此處追蹤流程與審查意見。</p>
    </div>
  )
}
