import { useState } from 'react'
import { Sparkles, Upload, Paperclip, FileSearch } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, Badge, BallChip, Empty, PageHeader, ErrorBanner } from '../../components/ui.jsx'
import { appConfirm, appPrompt } from '../../components/confirm.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { submittalBall } from '../../lib/ballInCourt.js'

const CATEGORIES = ['施工計畫', '品質計畫', '材料設備', '樣品', '配比', '其他']
const STATUS_COLOR = { 已提送: 'blue', 審核中: 'amber', 核准: 'green', 核備: 'green', 退回補正: 'red', 駁回: 'red' }
const CHECK_COLOR = { 已於送審敘明: 'green', 需補件: 'amber', 需監造核對文件: 'slate', 不適用: 'slate' }
const DECISION_COLOR = { 核准: 'green', 核備: 'green', 退回補正: 'red', 需補充後再核: 'amber' }
const input = 'w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm transition-colors placeholder:text-[var(--text-3)] focus:border-[var(--blue)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/20'
// AI 偶爾把換行輸出成 literal「\n」;顯示前正規化成分隔號(P2-03)
const fixNl = (s) => String(s || '').replace(/\\n|\n/g, '；').replace(/；+/g, '；').replace(/^；|；$/g, '')
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function Submittals() {
  const { project, submittals, createSubmittal, decideSubmittal, resubmitSubmittal, deleteSubmittal, reviewSubmittal,
    uploadSubmittalFile, readSubmittalDoc, isSupabaseConfigured, currentProject, can } = useStore()
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('') // 審定寫入失敗必須讓使用者看到(失敗=UI 不變)
  const [aiReview, setAiReview] = useState({}) // { [submittalId]: { result, opinion } } AI 審查助手結果
  const [reviewBusy, setReviewBusy] = useState(null) // 正在跑審查的 submittal id
  const [aiRead, setAiRead] = useState({})     // { [submittalId]: result } AI 讀文件審查結果
  const [readBusy, setReadBusy] = useState(null)
  const [uploadBusy, setUploadBusy] = useState(null)

  if (isSupabaseConfigured && !currentProject) {
    return <Card title="送審文件"><Empty>請先登入並選擇專案。</Empty></Card>
  }

  const submit = async () => {
    setBusy(true); await createSubmittal(form); setBusy(false); setForm(null)
  }
  const onDecide = async (s, status) => {
    const required = status === '退回補正' || status === '駁回'
    // AI 審查助手/讀文件審查已備妥意見 → 帶入為預設(監造仍可改);否則沿用原邏輯(退回/駁回不預填舊意見)
    const aiOpinion = aiReview[s.id]?.opinion || aiRead[s.id]?.summary_opinion
    const note = await appPrompt({
      title: `${status}：${s.submittal_no}`, body: s.title,
      label: required ? `${status}原因 / 審查意見（必填）` : '審查意見（可留空）',
      defaultValue: aiOpinion || (required ? '' : (s.review_note || '')), required, danger: required, confirmLabel: status,
    })
    if (note === null) return
    setErrMsg(''); setBusy(true)
    const { error } = await decideSubmittal(s.id, status, note || s.review_note)
    setBusy(false)
    if (error) setErrMsg(`${status}未寫入：${error.message}`)
    else { // 審定後收起助手面板
      setAiReview((m) => { const n = { ...m }; delete n[s.id]; return n })
      setAiRead((m) => { const n = { ...m }; delete n[s.id]; return n })
    }
  }

  // AI 送審審查助手:產生審查要點清單 + 意見草稿 + 建議判定
  const onReview = async (s) => {
    setReviewBusy(s.id); setErrMsg('')
    const { error, result } = await reviewSubmittal(s)
    setReviewBusy(null)
    if (error) { setErrMsg(`AI 審查助手失敗：${error.message || ''}`); return }
    setAiReview((m) => ({ ...m, [s.id]: { result, opinion: result.opinion || '' } }))
  }
  const closeReview = (id) => setAiReview((m) => { const n = { ...m }; delete n[id]; return n })

  // 廠商上傳送審主文件
  const onUpload = async (s, e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setUploadBusy(s.id); setErrMsg('')
    const { error } = await uploadSubmittalFile(s.id, file)
    setUploadBusy(null)
    if (error) setErrMsg(`文件上傳失敗：${error.message || ''}`)
  }
  // AI 讀文件審查:讀送審文件本體逐項比對契約需求
  const onRead = async (s) => {
    setReadBusy(s.id); setErrMsg('')
    const { error, result } = await readSubmittalDoc(s)
    setReadBusy(null)
    if (error) { setErrMsg(`AI 讀文件審查失敗：${error.message || ''}`); return }
    setAiRead((m) => ({ ...m, [s.id]: result }))
  }
  const closeRead = (id) => setAiRead((m) => { const n = { ...m }; delete n[id]; return n })

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

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />
      {/* AI 長任務狀態(P1-10):讀文件需下載→抽字→比對,設時間預期避免以為卡住 */}
      {(readBusy || reviewBusy) && (
        <div className="flex items-center gap-2 text-sm bg-[var(--blue-tint)] text-[var(--blue-text)] rounded-lg px-3 py-2">
          <Sparkles size={15} className="animate-pulse shrink-0" aria-hidden />
          {readBusy ? 'AI 正在下載並讀取送審文件、逐項比對契約規範…較長文件約需 20–30 秒,可離開此頁稍後回來查看。' : 'AI 審查中…'}
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
                    {/* 送審主文件本體:廠商上傳,監造可 AI 審讀 */}
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                      {s.attachment_path
                        ? <span className="text-xs inline-flex items-center gap-1 text-[var(--blue-text)]"><Paperclip size={12} aria-hidden />已附文件：{s.attachment_name || '文件'}</span>
                        : <span className="text-[11px] text-[var(--text-3)]">尚未上傳文件本體</span>}
                      {can.submit && (s.status === '已提送' || s.status === '審核中' || s.status === '退回補正') && (
                        <label className={`text-xs inline-flex items-center gap-1 rounded px-2 py-0.5 border border-[var(--border)] ${uploadBusy === s.id ? 'opacity-50' : 'cursor-pointer hover:bg-[var(--surface-2)] text-[var(--blue)]'}`}>
                          <input type="file" accept=".pdf,.doc,.docx,image/*" disabled={uploadBusy === s.id} onChange={(e) => onUpload(s, e)} className="hidden" />
                          <Upload size={12} aria-hidden />{uploadBusy === s.id ? '上傳中…' : (s.attachment_path ? '更換文件' : '上傳文件')}
                        </label>
                      )}
                    </div>
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
                        {/* 駁回=終局(不可再送);DB 一直支援,UI 補齊入口(R3 P2-02) */}
                        {s.status === '審核中' && <Button variant="danger" disabled={busy} onClick={() => onDecide(s, '駁回')}>駁回</Button>}
                      </div>
                    )}
                    {/* 監造:AI 審查助手——依契約規範/工項產生審查要點+意見草稿 */}
                    {can.approve && (s.status === '已提送' || s.status === '審核中') && !aiReview[s.id] && (
                      <Button variant="secondary" disabled={reviewBusy === s.id} onClick={() => onReview(s)}>
                        <Sparkles size={13} aria-hidden />{reviewBusy === s.id ? ' AI 審查中…' : ' AI 審查助手'}
                      </Button>
                    )}
                    {/* 監造:AI 讀文件審查——讀送審文件本體逐項比對契約需求(需已上傳文件) */}
                    {can.approve && s.attachment_path && (s.status === '已提送' || s.status === '審核中') && !aiRead[s.id] && (
                      <Button variant="secondary" disabled={readBusy === s.id} onClick={() => onRead(s)}>
                        <FileSearch size={13} aria-hidden />{readBusy === s.id ? ' AI 讀文件中…' : ' AI 讀文件審查'}
                      </Button>
                    )}
                    {/* 施工:退回補正後修正再送(補正說明必填=實質補正證據) */}
                    {can.submit && s.status === '退回補正' && <Button variant="secondary" disabled={busy} onClick={() => onResubmit(s)}>修正再送</Button>}
                    {can.approve && (s.status === '已提送' || s.status === '審核中') && <span className="text-[10px] text-[var(--text-3)]">待監造審定</span>}
                    {!can.approve && (s.status === '已提送' || s.status === '審核中') && <span className="text-[10px] text-[var(--text-3)]">待監造審定</span>}
                    {/* 僅「已提送且未經審查」可刪(R3 P0-01:一經受理即為履約證據,DB 另有 guard) */}
                    {can.submit && s.status === '已提送' && !(s.revision > 0) && (
                      <button onClick={async () => {
                        if (!(await appConfirm({ title: '刪除此送審？', danger: true, confirmLabel: '刪除' }))) return
                        setErrMsg('')
                        const { error } = await deleteSubmittal(s.id)
                        if (error) setErrMsg(`刪除失敗：${error.message}`)
                      }} className="text-[var(--text-3)] hover:text-[var(--red-text)] text-xs">刪除</button>
                    )}
                  </div>
                </div>
                {aiReview[s.id] && (() => {
                  const r = aiReview[s.id].result
                  return (
                    <div className="mt-3 border-t border-[var(--border-2)] pt-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="text-sm font-medium text-[var(--text)] inline-flex items-center gap-1.5 flex-wrap">
                          <Sparkles size={14} className="text-[var(--blue)]" aria-hidden />AI 審查助手
                          {r.suggested_decision && <Badge color={DECISION_COLOR[r.suggested_decision] || 'slate'}>建議：{r.suggested_decision}</Badge>}
                        </div>
                        <button onClick={() => closeReview(s.id)} className="text-xs text-[var(--text-3)] hover:text-[var(--red-text)] shrink-0">收起</button>
                      </div>
                      {r.caution && <div className="text-xs text-[var(--amber-text)] mb-2">⚠ {fixNl(r.caution)}</div>}
                      <div className="text-xs font-medium text-[var(--text-2)] mb-1">審查要點</div>
                      <ul className="space-y-1 mb-3">
                        {(r.checklist || []).map((c, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <Badge color={CHECK_COLOR[c.status] || 'slate'}>{c.status}</Badge>
                            <span className="min-w-0"><span className="text-[var(--text)]">{c.point}</span>
                              {c.basis && <span className="text-[var(--text-3)] text-xs"> · 依據：{c.basis}</span>}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="text-xs font-medium text-[var(--text-2)] mb-1">審查意見草稿（可修改，核准/核備/退回時自動帶入）</div>
                      <textarea rows={3} value={aiReview[s.id].opinion}
                        onChange={(e) => setAiReview((m) => ({ ...m, [s.id]: { ...m[s.id], opinion: e.target.value } }))}
                        className={input} />
                      <p className="text-[11px] text-[var(--text-3)] mt-1">依契約規範/工項自動草擬，僅供監造參考；文件本體仍須人工核對，最終判定由監造裁量。</p>
                    </div>
                  )
                })()}
                {aiRead[s.id] && (() => {
                  const d = aiRead[s.id]
                  const RS = { 符合: 'green', 部分符合: 'amber', 不符: 'red', 未涵蓋: 'slate', 需人工確認: 'blue', 不適用: 'slate' }
                  return (
                    <div className="mt-3 border-t border-[var(--border-2)] pt-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="text-sm font-medium text-[var(--text)] inline-flex items-center gap-1.5 flex-wrap">
                          <FileSearch size={14} className="text-[var(--blue)]" aria-hidden />AI 讀文件審查
                          {d.suggested_decision && <Badge color={DECISION_COLOR[d.suggested_decision] || 'slate'}>建議：{d.suggested_decision}</Badge>}
                          <span className="text-[10px] text-[var(--text-3)] font-normal">{d.mode === 'text' ? '已讀文件文字' : '視覺讀取'}</span>
                        </div>
                        <button onClick={() => closeRead(s.id)} className="text-xs text-[var(--text-3)] hover:text-[var(--red-text)] shrink-0">收起</button>
                      </div>
                      {d.doc_summary && <div className="text-xs text-[var(--text-2)] mb-2">文件摘要：{d.doc_summary}</div>}
                      {d.caution && <div className="text-xs text-[var(--amber-text)] mb-2">⚠ {fixNl(d.caution)}</div>}
                      <div className="text-xs font-medium text-[var(--text-2)] mb-1">逐項比對契約需求</div>
                      <ul className="space-y-1 mb-3">
                        {(d.findings || []).map((f, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <Badge color={RS[f.status] || 'slate'}>{f.status}</Badge>
                            <span className="min-w-0"><span className="text-[var(--text)]">{f.requirement}</span>
                              {f.note && <span className="text-[var(--text-3)] text-xs"> · {f.note}</span>}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="text-xs font-medium text-[var(--text-2)] mb-1">審查意見草稿（可修改，核准/核備/退回時自動帶入）</div>
                      <textarea rows={3} value={d.summary_opinion || ''}
                        onChange={(e) => setAiRead((m) => ({ ...m, [s.id]: { ...m[s.id], summary_opinion: e.target.value } }))}
                        className={input} />
                      <p className="text-[11px] text-[var(--text-3)] mt-1">AI 讀送審文件本體逐項比對契約需求；「需人工確認/未涵蓋」項仍須監造核對，最終判定由監造裁量。</p>
                    </div>
                  )
                })()}
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="text-xs text-[var(--text-3)]">送審採 ball-in-court：施工提送 → 監造受理審核 → 核准/核備/退回補正；退回補正後施工修正再送（版次 +1）。廠商可上傳送審文件本體（PDF/圖），監造以「AI 讀文件審查」逐項比對契約需求並草擬意見。</p>
    </div>
  )
}
