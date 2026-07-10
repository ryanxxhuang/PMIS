import { useMemo, useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Send, ShieldCheck, AlertTriangle, Clock, ArrowRight, Bot } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Empty, PageHeader, Button } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { parseLocalDate } from '../../lib/dates.js'
import { buildInsights, insightsForRole } from '../../lib/aiInsights.js'
import { answerQuestion, SUGGESTED_QUESTIONS } from '../../lib/assistantQA.js'
import { myOpenItems } from '../../lib/ballInCourt.js'

const TODAY = new Date()
const SEV = {
  risk: { color: 'var(--red-text)', bg: 'var(--red-tint)', icon: AlertTriangle, label: '需注意' },
  watch: { color: 'var(--amber-text)', bg: 'var(--amber-tint)', icon: Clock, label: '留意' },
  ok: { color: 'var(--green-text)', bg: 'var(--green-tint)', icon: ShieldCheck, label: '正常' },
}
const ROLE_HELLO = {
  contractor: '我幫你盯著進度、品管、契約到期和現金流，該補的、快逾期的先挑出來。',
  supervisor: '我幫你盯著該查未查、待審與缺失複查，有異常先標給你看。',
  owner: '我幫你盯著全案風險、變更與撥款，有異常樣態先提醒你。',
  viewer: '目前是唯讀專案視角；我會整理共用風險資訊，不會指派契約行動。',
}

export default function Assistant() {
  const store = useStore()
  const { project, partyOrgKey, workItems, valuations, progressPlan, siteLogs, inspections, defects,
    testSamples, obligations, changeOrders, submittals, rfis, observations, demoMode, workItemsSource, currentProject } = store
  // P0-03:助理視角依「這個專案」我代表的一方(切換專案時跟著變);未解析→唯讀視角
  const org = partyOrgKey || 'viewer'
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

  const insights = useMemo(() => insightsForRole(buildInsights({
    progress: { actualPct, plannedPct: plannedNow }, siteLogs, defects, testSamples,
    obligations, valuations, changeOrders, anchors,
  }, TODAY), org), [actualPct, plannedNow, siteLogs, defects, testSamples, obligations, valuations, changeOrders, org]) // eslint-disable-line react-hooks/exhaustive-deps

  const qaData = {
    project, progress: { actualPct, plannedPct: plannedNow },
    finance: { billableTotal, actualCum }, valuations, defects, inspections, siteLogs,
    obligations, changeOrders, testSamples, myItems, anchors,
  }

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
        subtitle={ROLE_HELLO[org] || ROLE_HELLO.viewer}
        meta={[{ k: '模式', v: '唯讀' }]} />

      <div className="grid lg:grid-cols-[1.15fr_1fr] gap-5 items-start">
        {/* 主動觀察 */}
        <InsightsPanel insights={insights} />
        {/* 問答 */}
        <ChatPanel data={qaData} />
      </div>

      <p className="text-[11px] text-[var(--text-3)] flex items-center gap-1.5">
        <ShieldCheck size={13} aria-hidden />
        AI 助理只讀本案資料、附上出處，<b className="text-[var(--text-2)] font-medium">不會替你送出或核定任何東西</b>——它幫你先看到、你來決定。
      </p>
    </div>
  )
}

function InsightsPanel({ insights }) {
  return (
    <Card title={`AI 幫你看到的（${insights.length}）`} bodyClass={insights.length ? 'p-0' : 'p-6'}
      action={<span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-3)]"><Sparkles size={12} aria-hidden />主動分析</span>}>
      {insights.length === 0 ? (
        <Empty>目前沒有偵測到需要注意的事——都在軌道上。</Empty>
      ) : (
        <ul className="divide-y divide-[var(--border-2)]">
          {insights.map((it) => {
            const s = SEV[it.sev] || SEV.watch
            const Icon = s.icon
            return (
              <li key={it.id}>
                <Link to={it.to} className="group flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-2)] transition">
                  <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 mt-0.5" style={{ background: s.bg, color: s.color }}>
                    <Icon size={16} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--text)]">{it.title}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: s.bg, color: s.color }}>{it.tag}</span>
                    </span>
                    <span className="block text-xs text-[var(--text-3)] mt-0.5 leading-relaxed">{it.detail}</span>
                  </span>
                  <ArrowRight size={15} className="text-[var(--text-3)] group-hover:text-[var(--text-2)] shrink-0 mt-1" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function ChatPanel({ data }) {
  const [msgs, setMsgs] = useState([])
  const [q, setQ] = useState('')
  const scrollRef = useRef(null)
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [msgs])

  const ask = (question) => {
    const text = (question ?? q).trim()
    if (!text) return
    setQ('')
    const r = answerQuestion(text, data)
    const ai = r
      ? { role: 'ai', text: r.answer, sources: r.sources || [] }
      : { role: 'ai', text: '這個問題我還答不上來——我目前讀得懂本案的進度、估驗請款、缺失查驗、品管取樣和契約義務。換個說法，或點下面的建議問題試試。', sources: [] }
    setMsgs((m) => [...m, { role: 'user', text }, ai])
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
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
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
      </div>

      <div className="border-t border-[var(--border-2)] p-3 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_QUESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)}
              className="text-[11px] px-2 py-1 rounded-full border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition">
              {s}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); ask() }} className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="輸入問題…"
            className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue)]/20" />
          <Button type="submit" size="sm" disabled={!q.trim()} aria-label="送出"><Send size={15} aria-hidden /></Button>
        </form>
      </div>
    </Card>
  )
}
