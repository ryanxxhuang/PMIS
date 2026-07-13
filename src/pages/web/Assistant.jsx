import { useMemo, useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Send, ShieldCheck, ArrowRight, Bot } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Empty, PageHeader, Button } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { parseLocalDate } from '../../lib/dates.js'
import { answerQuestion, SUGGESTED_QUESTIONS } from '../../lib/assistantQA.js'
import { buildAssistantFacts } from '../../lib/assistantFacts.js'
import { myOpenItems } from '../../lib/ballInCourt.js'

const TODAY = new Date()
// §9-8 去重:主動分析(insights)只在 Dashboard 出現,這裡專心做問答
const ROLE_HELLO = {
  contractor: '問我本案的進度、估驗請款、缺失查驗、品管取樣和契約義務——答案附出處。',
  supervisor: '問我本案的查驗、待審、缺失複查與進度——答案附出處。',
  owner: '問我本案的風險、變更、撥款與進度——答案附出處。',
}

export default function Assistant() {
  const store = useStore()
  const { project, currentUser, workItems, valuations, progressPlan, siteLogs, inspections, defects,
    testSamples, obligations, changeOrders, submittals, rfis, observations, safetyRecords, acceptanceEvents,
    demoMode, workItemsSource, currentProject, askAssistant } = store
  const org = currentUser?.org_type || 'contractor'
  const imported = workItemsSource === 'db' || demoMode

  // 進度與財務（與 Dashboard 同源計算）
  const { roots, childrenMap } = useMemo(
    () => (workItems ? buildBillableTree(workItems.items) : { roots: [], childrenMap: new Map() }),
    [workItems],
  )
  const billableTotal = workItems?.meta.billable_total || 0
  const latestVal = valuations[valuations.length - 1]
  const actualCum = useMemo(
    () => (latestVal ? totalCumAmount(roots, buildCumMap(roots, childrenMap, latestVal.items)) : 0),
    [roots, childrenMap, latestVal],
  )
  const actualPct = billableTotal ? (actualCum / billableTotal) * 100 : 0
  const plannedNow = useMemo(() => {
    if (!progressPlan) return null
    const months = progressPlan.months, N = months.length
    const start = parseLocalDate(progressPlan.start)
    const elapsed = (TODAY.getFullYear() - start.getFullYear()) * 12 + (TODAY.getMonth() - start.getMonth()) + (TODAY.getDate() - 1) / 30
    if (elapsed <= 0) return 0
    if (elapsed >= N - 1) return months[N - 1].plannedPct
    const lo = Math.floor(elapsed), f = elapsed - lo
    return months[lo].plannedPct + (months[lo + 1].plannedPct - months[lo].plannedPct) * f
  }, [progressPlan])

  const anchors = {
    award_date: project?.award_date, notice_date: project?.notice_date,
    commencement_date: project?.commencement_date, end_date: project?.end_date,
  }
  const myItems = useMemo(
    () => myOpenItems(org, { rfis, submittals, valuations, defects, inspections, observations, changeOrders }),
    [org, rfis, submittals, valuations, defects, inspections, observations, changeOrders],
  )

  const qaData = {
    project, progress: { actualPct, plannedPct: plannedNow },
    finance: { billableTotal, actualCum }, valuations, defects, inspections, siteLogs,
    obligations, changeOrders, testSamples, myItems, anchors,
  }
  // copilot 送給 edge fn 的結構化事實快照(所有模組恆在;確定性回退用 qaData)
  const facts = useMemo(() => buildAssistantFacts({
    ...qaData, org, submittals, rfis, safetyRecords, acceptanceEvents,
  }, TODAY), [qaData, org, submittals, rfis, safetyRecords, acceptanceEvents]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!imported) {
    return (
      <div className="space-y-5">
        <PageHeader title="AI 助理" tagline="Copilot" subtitle="先幫你看到該注意的，也能隨時問專案問題" />
        <Card><Empty>此專案尚未匯入標單，AI 助理還沒有資料可分析。請先到「標單工項」匯入 PCCES 預算書。</Empty></Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader title="AI 助理" tagline="Copilot"
        subtitle={ROLE_HELLO[org] || ROLE_HELLO.contractor}
        meta={[{ k: '模式', v: '唯讀' }]} />

      <div className="max-w-3xl">
        <ChatPanel data={qaData} facts={facts} askAssistant={askAssistant} />
      </div>

      <p className="text-[11px] text-[var(--text-3)] flex items-center gap-1.5">
        <ShieldCheck size={13} aria-hidden />
        AI 助理只讀本案資料、附上出處，<b className="text-[var(--text-2)] font-medium">不會替你送出或核定任何東西</b>。
        主動分析在 <Link to="/dashboard" className="text-[var(--blue-text)] hover:underline">專案 Dashboard</Link>、期限提醒在 <Link to="/alerts" className="text-[var(--blue-text)] hover:underline">提醒中心</Link>。
      </p>
    </div>
  )
}

function ChatPanel({ data, facts, askAssistant }) {
  const [msgs, setMsgs] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef(null)
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [msgs, busy])

  // 確定性回退(demo/未設 Supabase/AI 服務失敗):關鍵字比對答本案資料
  const fallbackAnswer = (text) => {
    const r = answerQuestion(text, data)
    return r
      ? { role: 'ai', text: r.answer, sources: r.sources || [], mode: 'basic' }
      : { role: 'ai', text: '這個問題我還答不上來——我目前讀得懂本案的進度、估驗請款、缺失查驗、品管取樣和契約義務。換個說法，或點下面的建議問題試試。', sources: [], mode: 'basic' }
  }

  const ask = async (question) => {
    const text = (question ?? q).trim()
    if (!text || busy) return
    setQ(''); setMsgs((m) => [...m, { role: 'user', text }]); setBusy(true)
    // AI 優先(edge fn Claude 開放式問答)→ 失敗/demo 回退確定性
    const res = await askAssistant(text, facts)
    let ai
    if (res?.answer) ai = { role: 'ai', text: res.answer, sources: res.sources || [], mode: 'ai' }
    else ai = fallbackAnswer(text) // res.fallback(demo) 或 res.error 都走這
    setBusy(false)
    setMsgs((m) => [...m, ai])
  }

  return (
    <Card title="問我專案的事" bodyClass="p-0"
      action={<span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-3)]"><Bot size={12} aria-hidden />附出處</span>}>
      <div ref={scrollRef} className="max-h-[360px] min-h-[180px] overflow-y-auto px-4 py-3 space-y-3">
        {msgs.length === 0 ? (
          <div className="text-sm text-[var(--text-3)] py-6 text-center">
            問問看本案的進度、估驗、缺失、契約……<br />答案都從本案資料來、附上出處連結。
          </div>
        ) : msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-line ${
              m.role === 'user' ? 'bg-[var(--primary)] text-white rounded-br-sm' : 'bg-[var(--surface-2)] text-[var(--text)] rounded-bl-sm'}`}>
              {m.text}
              {m.sources?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {m.sources.map((s, j) => (
                    <Link key={j} to={s.to} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border-2)] text-[var(--blue-text)] hover:bg-[var(--blue-tint)] inline-flex items-center gap-0.5">
                      {s.label} <ArrowRight size={10} aria-hidden />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-[var(--surface-2)] text-[var(--text-3)] rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm inline-flex items-center gap-1.5">
              <Bot size={13} className="animate-pulse" aria-hidden />思考中…
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border-2)] p-3 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_QUESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={busy}
              className="text-[11px] px-2 py-1 rounded-full border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition disabled:opacity-40">
              {s}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); ask() }} className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="輸入問題…" disabled={busy}
            className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue)]/20 disabled:opacity-60" />
          <Button type="submit" size="sm" disabled={!q.trim() || busy} aria-label="送出"><Send size={15} aria-hidden /></Button>
        </form>
      </div>
    </Card>
  )
}
