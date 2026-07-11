import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Scale, FileText, Sparkles } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Empty, PageHeader } from '../../components/ui.jsx'
import { appConfirm } from '../../components/confirm.jsx'
import { computeObligationDue } from '../../lib/contractDue.js'
import { deriveContractControls } from '../../lib/projectMode.js'

const PHASES = ['開工前', '施工中', '完工', '保固', '其他']
const TRIGGER_LABEL = {
  award: '決標', notice: '接獲開工通知', commencement: '開工',
  completion: '完工', monthly: '每月', fixed: '指定日期', other: '其他',
}
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// 把規則組成人看得懂的一句話
function ruleText(ob) {
  if (ob.recurring === 'monthly') return `每月 ${ob.recurring_day || ''} 日${ob.offset_dir === 'before' ? '前' : ''}`.trim()
  if (ob.trigger_event === 'fixed') return `指定 ${ob.fixed_date || '日期'}`
  const t = TRIGGER_LABEL[ob.trigger_event] || ob.trigger_event || ''
  if (ob.offset_days) return `${t}${ob.offset_dir === 'before' ? '前' : '後'} ${ob.offset_days} 日內`
  return t
}

const DOT = { done: 'var(--green-text)', overdue: 'var(--red-text)', soon: 'var(--amber-text)', scheduled: 'var(--blue)', nodate: 'var(--text-3)' }

export default function Contract() {
  const { project, isSupabaseConfigured, currentProject, isPersistedProject, obligations, parseContract, updateObligationStatus, updateProjectAnchors, ingestRequirementDocument, can } = useStore()
  const [anchors, setAnchors] = useState({ award_date: '', notice_date: '', commencement_date: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ingestBusy, setIngestBusy] = useState(false)
  const [ingestMsg, setIngestMsg] = useState('')
  const { legacyParserEnabled, requirementIngestionEnabled } = deriveContractControls({ isPersistedProject, can })

  useEffect(() => {
    setAnchors({
      award_date: currentProject?.award_date || '',
      notice_date: currentProject?.notice_date || '',
      commencement_date: currentProject?.commencement_date || '',
    })
  }, [currentProject])

  const setAnchor = (key, val) => {
    setAnchors((a) => ({ ...a, [key]: val }))
    updateProjectAnchors({ [key]: val || null })
  }

  const onUpload = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    if (obligations.length && !(await appConfirm({ title: '重新解析契約？', body: '重新解析會「取代」目前的義務清單。', confirmLabel: '重新解析' }))) return
    setBusy(true); setMsg('AI 解析契約中…(大檔可能要數十秒)')
    const { error, count } = await parseContract(file)
    setBusy(false)
    setMsg(error ? `解析失敗:${error.message || ''}` : `已解析並帶入 ${count} 項義務。`)
  }

  // P0-06:AI 履約需求擷取(可追溯 ingestion pipeline)。與上方 legacy 時程義務
  // 解析平行存在;產物只是 draft/待審查建議,審查介面屬 P0-07。
  const onIngest = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setIngestBusy(true)
    setIngestMsg('AI 擷取履約需求中…(建立文件版本、逐頁保存、引註驗證,大檔可能要數十秒)')
    const { error, run } = await ingestRequirementDocument(file)
    setIngestBusy(false)
    if (error) { setIngestMsg(`擷取失敗:${error.message || ''}`); return }
    setIngestMsg(
      `已產生 ${run?.extracted_requirement_count ?? 0} 項 AI 履約需求建議`
      + `(引註已驗證 ${run?.verified_source_count ?? 0} 項、待補審 ${run?.needs_review_count ?? 0} 項),待人工審查。`,
    )
  }

  const items = useMemo(() => {
    const a = { ...anchors, end_date: currentProject?.end_date }
    return obligations.map((ob) => {
      const due = computeObligationDue(ob, a)
      const done = ob.status === '已提送' || ob.status === '已完成'
      let diff = null, state = 'nodate'
      if (done) state = 'done'
      else if (due) { diff = Math.round((due - today0()) / 86400000); state = diff < 0 ? 'overdue' : diff <= 7 ? 'soon' : 'scheduled' }
      return { ob, due, diff, done, state }
    })
  }, [obligations, anchors, currentProject])

  const counts = useMemo(() => {
    let overdue = 0, soon = 0, done = 0
    for (const it of items) { if (it.state === 'overdue') overdue++; else if (it.state === 'soon') soon++; if (it.done) done++ }
    return { overdue, soon, done }
  }, [items])

  const groups = useMemo(() => PHASES.map((ph) => ({
    ph, list: items.filter((it) => (PHASES.includes(it.ob.category) ? it.ob.category : '其他') === ph)
      .sort((x, y) => (x.due?.getTime() || Infinity) - (y.due?.getTime() || Infinity)),
  })).filter((g) => g.list.length), [items])

  if (isSupabaseConfigured && !currentProject) {
    return <Card title="契約管制"><Empty>請先登入並建立/選擇專案,才能解析契約時程。</Empty></Card>
  }

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <PageHeader title="契約管制" tagline="時程義務與罰則" subtitle="設定基準日 → 上傳契約 AI 解析 → 各項到期日與罰則自動彙整" />
      </div>

      <Card title="基準日">
        <div className="flex flex-wrap gap-4">
          {[['award_date', '決標日'], ['notice_date', '接獲開工通知日'], ['commencement_date', '開工日']].map(([k, label]) => (
            <label key={k} className="block">
              <span className="block text-sm font-medium text-[var(--text)] mb-1">{label}</span>
              <input type="date" value={anchors[k]} onChange={(e) => setAnchor(k, e.target.value)}
                disabled={!can.manageProjectIdentity}
                className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
            </label>
          ))}
        </div>
        <p className="text-xs text-[var(--text-3)] mt-3">下面各項到期日、倒數、逾期都是依這些基準日即時計算。</p>
      </Card>

      <Card title="契約解析" action={
        <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 transition ${busy || !legacyParserEnabled ? 'opacity-50' : 'cursor-pointer bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] shadow-sm'}`}>
          <input type="file" accept="application/pdf,image/*" disabled={busy || !legacyParserEnabled} onChange={onUpload} className="hidden" />
          {busy ? '解析中…' : '上傳契約解析'}
        </label>
      }>
        {!isPersistedProject && <p className="text-xs text-amber-600 mb-2">Demo 模式不支援契約解析，請登入並選擇真實專案。</p>}
        {isPersistedProject && !can.manageObligations && <p className="text-xs text-[var(--text-3)] mb-2">目前身分沒有契約義務管理權限。</p>}
        <div className="flex flex-wrap gap-2">
          <Pill color="red" n={counts.overdue} label="已逾期" />
          <Pill color="amber" n={counts.soon} label="7 日內到期" />
          <Pill color="green" n={counts.done} label="已完成" />
        </div>
        {msg && <p className={`text-xs mt-3 ${msg.startsWith('解析失敗') ? 'text-rose-600' : 'text-[var(--text-2)]'}`}>{msg}</p>}
        <p className="text-xs text-[var(--text-3)] mt-2">支援 PDF / 掃描 PDF / 圖片。Word、Excel 請先匯出成 PDF。重新解析會取代現有清單。</p>
      </Card>

      <Card title="AI 履約需求擷取(建議草稿)" action={
        <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 transition ${ingestBusy || !requirementIngestionEnabled ? 'opacity-50' : 'cursor-pointer bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] shadow-sm'}`}>
          <input type="file" accept="application/pdf,.docx" disabled={ingestBusy || !requirementIngestionEnabled} onChange={onIngest} className="hidden" />
          <Sparkles size={14} aria-hidden /> {ingestBusy ? '擷取中…' : 'AI 解析履約需求'}
        </label>
      }>
        <p className="text-xs text-[var(--text-2)]">
          上傳契約/規範 → 建立正式文件版本並逐頁保存 → AI 擷取「履約需求建議」並逐項驗證引註出處。
          產出僅為待審查草稿(不會自動生效、不影響上方時程義務清單);審查介面於後續版本提供。
        </p>
        {!isPersistedProject && <p className="text-xs text-amber-600 mt-2">Demo 模式不支援，請登入並選擇真實專案。</p>}
        {isPersistedProject && !can.manageDocuments && <p className="text-xs text-[var(--text-3)] mt-2">需文件管理權限(廠商專案經理/機關專案經理/監造主任/文件管理員)。</p>}
        <p className="text-xs text-[var(--text-3)] mt-2">支援數位 PDF 與 Word(.docx)。掃描檔暫不支援(無 OCR);Word 文件無可靠頁碼,引註以章節/條款標明。</p>
        {ingestMsg && (
          <p className={`text-xs mt-3 ${ingestMsg.startsWith('擷取失敗') ? 'text-rose-600' : 'text-[var(--text-2)]'}`}>
            {ingestMsg}
            {ingestMsg.startsWith('已產生') && <>　<Link to="/requirements" className="text-[var(--blue-text)] hover:underline">查看履約需求 →</Link></>}
          </p>
        )}
      </Card>

      {groups.length === 0 ? (
        <Card title="義務時程"><Empty>尚無資料。設定基準日後,上傳契約讓 AI 解析,這裡會列出所有時程義務與罰則。</Empty></Card>
      ) : groups.map((g) => (
        <div key={g.ph}>
          <div className="text-sm font-medium text-[var(--text-2)] mb-2">{g.ph}</div>
          <div className="space-y-2">
            {g.list.map((it) => (
              <div key={it.ob.id} className="flex gap-3">
                <span className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style={{ background: DOT[it.state] }} />
                <div className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-medium text-[var(--text)]">{it.ob.title}</span>
                    {can.manageObligations && <button onClick={() => updateObligationStatus(it.ob.id, it.done ? '待辦' : '已提送')}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap shrink-0 ${it.done ? 'bg-[var(--green-tint)] text-[var(--green-text)]' : 'border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)]'}`}>
                      {it.done ? '已提送 ✓' : '標為已提送'}
                    </button>}
                  </div>
                  <div className="text-xs text-[var(--text-3)] mt-1">
                    {ruleText(it.ob)}{it.due ? `　·　到期 ${iso(it.due)}` : ''}
                    {it.ob.responsible ? `　·　${it.ob.responsible}` : ''}
                  </div>
                  {!it.done && it.due && (
                    <div className={`text-xs font-medium mt-0.5 ${it.state === 'overdue' ? 'text-rose-600' : it.state === 'soon' ? 'text-amber-600' : 'text-[var(--text-2)]'}`}>
                      {it.state === 'overdue' ? `已逾期 ${-it.diff} 天` : `還有 ${it.diff} 天`}
                    </div>
                  )}
                  {it.ob.penalty && (
                    <div className="text-xs text-[var(--amber-text)] bg-[var(--amber-tint)] rounded-md px-2 py-1 mt-2 inline-flex items-center gap-1"><Scale size={12} aria-hidden /> {it.ob.penalty}</div>
                  )}
                  {(it.ob.source_clause || it.ob.source_page) && (
                    <div className="text-[11px] text-[var(--text-3)] mt-2 flex items-center gap-1"><FileText size={11} aria-hidden /> 契約 {it.ob.source_clause} {it.ob.source_page}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Pill({ color, n, label }) {
  const c = { red: 'bg-[var(--red-tint)] text-[var(--red-text)]', amber: 'bg-[var(--amber-tint)] text-[var(--amber-text)]', green: 'bg-[var(--green-tint)] text-[var(--green-text)]' }[color]
  return <span className={`text-xs px-3 py-1 rounded-full font-medium ${c}`}>{label} {n} 項</span>
}
