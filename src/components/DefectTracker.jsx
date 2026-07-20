// 統一缺失引擎的共用 UI(QA §9-4):品質/工安缺失同一張卡、同一套狀態機
// 開立 → 改善中 → 待複查 → 已結案。改善鏈=廠商;複查結案/退回/撤銷結案=監造
// (伺服器 defects_guard 強制,前端 can 只是 UX)。已結案僅能附原因撤銷,不可刪除。
import { useState } from 'react'
import { Camera } from 'lucide-react'
import { useStore } from '../store.jsx'
import { Card, Button, Field, Badge, BallChip, Empty, ErrorBanner } from './ui.jsx'
import { appConfirm, appPrompt } from './confirm.jsx'
import { exportCsv, stamp } from '../lib/exportCsv.js'
import { defectBall } from '../lib/ballInCourt.js'
import MarkupEditor, { MarkupThumb } from './MarkupEditor.jsx'

const input = 'w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm transition-colors placeholder:text-[var(--text-3)] focus:border-[var(--blue)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/20'
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// 小工項挑選器（搜尋 → 選一個;品質缺失/查驗共用）
export function WorkItemPicker({ leaves, value, label, onPick }) {
  const [q, setQ] = useState('')
  const results = q.trim() ? leaves.filter((it) => it.description.includes(q.trim()) || (it.item_no || '').includes(q.trim())).slice(0, 12) : []
  if (value) {
    return (
      <div className="flex items-center gap-2 text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface-2)]">
        <span className="truncate flex-1">{label}</span>
        <button onClick={() => onPick(null, '')} className="text-[var(--text-3)] hover:text-[var(--red-text)] text-xs">✕</button>
      </div>
    )
  }
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋並選擇工項（可不填）…" className={input} />
      {results.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg max-h-56 overflow-auto enter-menu">
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

const NEXT_LABEL = { 開立: '開始改善', 改善中: '提送複查', 待複查: '複查結案' }

export default function DefectTracker({ domain = 'quality', leaves = [] }) {
  const { defects, createDefect, updateDefectStatus, deleteDefect, describeDefect, analyzeSafetyPhoto, resolveMarkup, can } = useStore()
  const isSafety = domain === 'safety'
  const list = defects.filter((d) => (d.domain || 'quality') === domain)
  const openCount = list.filter((d) => d.status !== '已結案').length
  const title = isSafety ? '工安缺失追蹤' : '缺失追蹤'

  const [form, setForm] = useState(null)
  const [markupOpen, setMarkupOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState('')
  const [errMsg, setErrMsg] = useState('') // 寫入失敗必須讓使用者看到(失敗=UI 不變)

  const emptyForm = () => ({
    title: '', description: '', severity: '一般', location: '', due_date: '',
    work_item_key: '', work_item_label: '', ...(isSafety ? { record_date: todayIso() } : {}),
  })

  // 拍缺失照片 → AI 填表。品質缺失=describe-defect(描述缺失);
  // 工安缺失=analyze-safety-photo(職安衛法規判讀:危害類別+違反法規依據+建議)。
  const onPhoto = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setAiBusy(true); setAiMsg(isSafety ? 'AI 判讀職安衛中…' : 'AI 辨識中…')
    const { error, result } = await (isSafety ? analyzeSafetyPhoto(file) : describeDefect(file))
    setAiBusy(false)
    if (error) { setAiMsg(`${isSafety ? '判讀' : '辨識'}失敗:${error.message || ''}`); return }
    if (isSafety) {
      // 危害類別 + 現況 + 違反法規依據 + 改善建議,組成 grounded 的工安缺失說明
      const desc = [
        result.description,
        result.violated_regulation && `依據:${result.violated_regulation}`,
        result.suggestion && `建議:${result.suggestion}`,
      ].filter(Boolean).join(' ')
      setForm((f) => ({
        ...f,
        title: result.title || f.title,
        description: desc || f.description,
        severity: result.severity || f.severity,
        location: f.location || result.location || '',
      }))
      setAiMsg(result.has_violation && result.title
        ? `AI 判讀:【${result.hazard_type}】${result.violated_regulation || ''}｜已填入，請確認後開立(法條條號請現場核對)。`
        : 'AI 未判讀出明顯職安衛危害;如仍要開立請人工填寫。')
      return
    }
    setForm((f) => ({
      ...f,
      title: result.title || f.title,
      description: [result.description, result.suggestion && `建議:${result.suggestion}`].filter(Boolean).join(' '),
      severity: result.severity || f.severity,
      location: f.location || result.location || '',
    }))
    setAiMsg(result.title ? 'AI 已填入，請確認後開立。' : 'AI 未辨識出明顯缺失，請人工填寫。')
  }

  const submit = async () => {
    setErrMsg(''); setBusy(true)
    const { error } = await createDefect({ ...form, domain })
    setBusy(false)
    if (error) { setErrMsg(`缺失未開立：${error.message}`); return }
    setForm(null)
  }

  const advance = async (d) => {
    let res
    if (d.status === '開立') res = await updateDefectStatus(d.id, '改善中')
    else if (d.status === '改善中') {
      const note = await appPrompt({
        title: `提送複查：${d.title}`, label: '改善說明（必填）',
        defaultValue: d.improvement_note || '', required: true, confirmLabel: '提送複查',
      })
      if (note === null) return
      res = await updateDefectStatus(d.id, '待複查', { improvement_note: note })
    }
    else if (d.status === '待複查') res = await updateDefectStatus(d.id, '已結案')
    if (res?.error) setErrMsg(`缺失狀態未更新：${res.error.message}`)
  }

  // 撤銷結案=監造附原因(伺服器留 defect_audits 稽核;已結案不可直接刪改)
  const reopen = async (d) => {
    const reason = await appPrompt({
      title: `撤銷結案：${d.title}`, label: '更正原因（必填，留存稽核）',
      required: true, danger: true, confirmLabel: '撤銷結案',
    })
    if (reason === null) return
    const res = await updateDefectStatus(d.id, '改善中', { correction_reason: reason })
    if (res?.error) setErrMsg(`撤銷結案失敗：${res.error.message}`)
  }

  const remove = async (d) => {
    if (!await appConfirm({ title: `刪除此${isSafety ? '工安' : ''}缺失？`, danger: true, confirmLabel: '刪除' })) return
    setErrMsg('')
    const { error } = await deleteDefect(d.id)
    if (error) setErrMsg(`刪除被拒絕：${error.message}`)
  }

  const csvCols = [
    { key: 'title', label: '缺失標題' },
    ...(isSafety ? [{ key: 'record_date', label: '發現日' }] : [{ key: 'work_item_no', label: '工項' }]),
    { key: 'location', label: '位置' }, { key: 'severity', label: '嚴重度' }, { key: 'status', label: '狀態' },
    { key: 'due_date', label: '改善期限' }, { key: 'improvement_note', label: '改善說明' },
  ]

  return (
    <Card title={`${title}（未結案 ${openCount}）`} action={<div className="flex items-center gap-3">
      {list.length > 0 && <button onClick={() => exportCsv(`${isSafety ? '工安缺失' : '缺失'}清單_${stamp()}`, list, csvCols)}
        className="text-sm font-medium text-[var(--blue)] hover:underline">⬇ CSV</button>}
      {(can.edit || can.approve) && (
        <Button variant="secondary" onClick={() => { setForm(form ? null : emptyForm()); setAiMsg('') }}>{form ? '取消' : '＋ 開立缺失'}</Button>
      )}
    </div>}>
      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} className="mb-3" />

      {form && (
        <div className="bg-[var(--surface-2)] rounded-lg p-4 mb-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 pressable ${aiBusy ? 'opacity-50' : 'cursor-pointer bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] shadow-sm'}`}>
              <input type="file" accept="image/*" capture="environment" disabled={aiBusy} onChange={onPhoto} className="hidden" />
              <Camera size={15} aria-hidden /> {aiBusy ? (isSafety ? 'AI 判讀中…' : 'AI 辨識中…') : (isSafety ? '拍工安照片 AI 判讀' : '拍缺失照片 AI 填表')}
            </label>
            <span className={`text-xs ${/失敗/.test(aiMsg) ? 'text-[var(--red-text)]' : 'text-[var(--text-2)]'}`}>{aiMsg || (isSafety ? '拍現場照片，AI 依職安衛法規判讀危害類別、違反依據並填表(條號請現場核對)。' : '拍缺失現場，AI 自動填標題/說明/嚴重度。')}</span>
          </div>
          {!isSafety && leaves.length > 0 && (
            <WorkItemPicker leaves={leaves} value={form.work_item_key} label={form.work_item_label}
              onPick={(k, l) => setForm((f) => ({ ...f, work_item_key: k || '', work_item_label: l }))} />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="缺失標題"><input className={input} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder={isSafety ? '如 施工架未掛安全網' : '如 鋼筋保護層不足'} /></Field>
            <Field label="位置"><input className={input} value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} /></Field>
            <Field label="嚴重度"><select className={input} value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}><option>輕微</option><option>一般</option><option>嚴重</option></select></Field>
            <Field label="改善期限"><input type="date" className={input} value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} /></Field>
            {isSafety && <Field label="發現日期"><input type="date" className={input} value={form.record_date} onChange={(e) => setForm((f) => ({ ...f, record_date: e.target.value }))} /></Field>}
          </div>
          <Field label="說明"><textarea className={input} rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></Field>
          <div className="flex items-center gap-3">
            <Button onClick={submit} disabled={busy || !form.title}>開立缺失</Button>
            <Button variant="secondary" onClick={() => setMarkupOpen(true)}>🖍 圖面/照片標註{form.markup_data ? '（已附）' : ''}</Button>
            {form.markup_data && <MarkupThumb src={form.markup_data} />}
          </div>
          {markupOpen && <MarkupEditor title="把缺失位置匡起來" initialImage={form.markup_data}
            onSave={(d) => { setForm((f) => ({ ...f, markup_data: d })); setMarkupOpen(false) }} onClose={() => setMarkupOpen(false)} />}
        </div>
      )}

      {list.length === 0 ? <Empty>尚無{isSafety ? '工安' : ''}缺失</Empty> : (
        <div className="space-y-2">
          {list.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 border-b border-[var(--border-2)] pb-2 text-sm">
              <div className="min-w-0">
                <div className="text-[var(--text)]">{d.title} <BallChip ball={defectBall(d)} /> {d.severity === '嚴重' && <Badge color="red">嚴重</Badge>} {d.correction_reason && <Badge color="amber">已更正</Badge>}</div>
                <div className="text-xs text-[var(--text-3)] truncate">
                  {[isSafety ? d.record_date : d.work_item_no, d.location, d.due_date ? `期限 ${d.due_date}` : '', d.improvement_note ? `改善：${d.improvement_note}` : ''].filter(Boolean).join(' · ')}
                </div>
                {d.markup_path && <div className="mt-1"><MarkupThumb src={d.markup_path} resolve={resolveMarkup} /></div>}
              </div>
              <div className="flex gap-2 shrink-0 items-center">
                {d.status !== '已結案' ? (
                  // 改善鏈:施工做「開始改善/提送複查」;複查結案/退回只有監造能按
                  d.status === '待複查' ? (can.approve ? <>
                    <Button variant="ghost" onClick={() => updateDefectStatus(d.id, '改善中')} disabled={busy}>退回</Button>
                    <Button variant="success" onClick={() => advance(d)} disabled={busy}>複查結案</Button>
                  </> : <span className="text-xs text-[var(--text-3)]">待監造複查</span>)
                  : (can.edit ? <Button variant="secondary" onClick={() => advance(d)} disabled={busy}>{NEXT_LABEL[d.status]}</Button>
                    : <span className="text-xs text-[var(--text-3)]">待廠商改善</span>)
                ) : (
                  can.approve && <button onClick={() => reopen(d)} className="text-xs text-[var(--blue-text)] hover:underline">撤銷結案</button>
                )}
                {can.edit && d.status !== '已結案' && (
                  <button onClick={() => remove(d)} className="text-[var(--text-3)] hover:text-[var(--red-text)]" aria-label="刪除缺失">✕</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-[var(--text-3)] mt-2">
        {isSafety
          ? '工安缺失與品質缺失共用同一套改善狀態機：開立 → 廠商改善 → 提送複查 → 監造複查結案。已結案不可刪除，撤銷結案須附原因並留存稽核。'
          : '缺失改善鏈：開立 → 廠商改善 → 提送複查 → 監造複查結案。已結案不可刪除，撤銷結案須附原因並留存稽核。'}
      </p>
    </Card>
  )
}
