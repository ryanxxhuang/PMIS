import { useState, useMemo } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Empty, Button } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'

const money = (n) => (n == null || isNaN(n) ? '0' : Math.round(n).toLocaleString('en-US'))
const thisMonthStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const inMonth = (d, m) => (d || '').slice(0, 7) === m
// 某月最後一天（用來算「截至月底」的累計）
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0) }
const prevMonth = (m) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export default function MonthlyReport() {
  const { project, workItems, dbMode, valuations, progressPlan, siteLogs,
    inspections, defects, safetyRecords, changeOrders } = useStore()
  const [month, setMonth] = useState(thisMonthStr())
  const [review, setReview] = useState('')   // 工程檢討（列印用，不儲存）
  const [nextPlan, setNextPlan] = useState('') // 下月工作計畫

  const billable = workItems?.meta.billable_total || 0

  const tree = useMemo(() => (workItems ? buildBillableTree(workItems.items) : { roots: [], childrenMap: new Map() }), [workItems])

  // 截至某 cutoff 日的累計估驗金額（取 valuation_date 在 cutoff（含）以前、期數最大的一期）
  const cumAt = (cutoff) => {
    const eligible = valuations.filter((v) => !v.valuation_date || new Date(v.valuation_date) <= cutoff)
    if (!eligible.length) return 0
    const latest = eligible.reduce((a, b) => (b.period_no > a.period_no ? b : a))
    return totalCumAmount(tree.roots, buildCumMap(tree.roots, tree.childrenMap, latest.items))
  }

  const data = useMemo(() => {
    const mEnd = monthEnd(month), pEnd = monthEnd(prevMonth(month))
    const cumThis = cumAt(mEnd), cumPrev = cumAt(pEnd)
    const actualPct = billable ? (cumThis / billable) * 100 : 0
    // 累計預定 %：progressPlan.months 的 plannedPct 為累計；取 <= 本月的最後一筆
    let plannedPct = null
    if (progressPlan?.months?.length) {
      const upto = progressPlan.months.filter((x) => x.label <= month)
      plannedPct = (upto.length ? upto[upto.length - 1] : progressPlan.months[0]).plannedPct
    }
    const logs = siteLogs.filter((l) => inMonth(l.log_date, month)).sort((a, b) => a.log_date.localeCompare(b.log_date))
    const inspM = inspections.filter((i) => inMonth(i.requested_date || i.created_at, month))
    const defOpened = defects.filter((d) => inMonth(d.created_at, month))
    const defClosed = defects.filter((d) => d.closed_at && inMonth(d.closed_at, month))
    const defOpen = defects.filter((d) => d.status !== '已結案').length
    const safM = safetyRecords.filter((s) => inMonth(s.record_date, month))
    const coM = changeOrders.filter((c) => inMonth(c.co_date, month))
    const approvedNet = changeOrders.filter((c) => c.status === '核准')
      .reduce((s, c) => s + c.items.reduce((t, it) => t + (Number(it.amount_delta) || 0), 0), 0)
    return {
      cumThis, thisMonthVal: cumThis - cumPrev, actualPct, plannedPct,
      logs, inspM, defOpened, defClosed, defOpen, safM, coM, approvedNet,
      paidCum: valuations.reduce((s, v) => s + (v.paid_amount || 0), 0),
      invoicedCount: valuations.filter((v) => v.invoice_date).length,
    }
  }, [month, valuations, progressPlan, siteLogs, inspections, defects, safetyRecords, changeOrders, tree, billable])

  if (!dbMode) {
    return <Card title="施工月報"><Empty>此功能需真實專案（已匯入標單）。請先建立專案並匯入標單。</Empty></Card>
  }

  const cnt = (arr, pred) => arr.filter(pred).length
  const diff = data.plannedPct != null ? data.actualPct - data.plannedPct : null

  return (
    <div className="space-y-5">
      {/* 工具列（列印時隱藏）*/}
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-[var(--text)]">施工月報 <span className="text-[var(--text-3)] font-normal text-base">自動彙編</span></h1>
          <p className="text-xs text-[var(--text-3)] mt-0.5">選月份 → 自動彙整進度 / 估驗 / 品質 / 工安 / 變更 → 列印或存 PDF</p>
        </div>
        <label className="block">
          <span className="block text-xs font-medium text-[var(--text-2)] mb-1">報告月份</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
        </label>
        <Button onClick={() => window.print()}>🖨 列印 / 存 PDF</Button>
      </div>

      {/* 月報本體（列印範圍）*/}
      <div className="bg-[var(--surface)] rounded-xl g-elevation-1 p-6 md:p-8 print:shadow-none print:p-0 space-y-6 text-[var(--text)]">
        <div className="text-center border-b border-[var(--border)] pb-4">
          <h2 className="text-lg font-bold">施工進度月報</h2>
          <p className="text-sm mt-1">{project.project_name}</p>
          <p className="text-xs text-[var(--text-3)] mt-1">報告月份：{month.replace('-', ' 年 ')} 月</p>
        </div>

        {/* 基本資料 */}
        <Section title="一、工程概要">
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1.5 text-sm">
            <Info k="機關" v={project.owner_name} />
            <Info k="承包廠商" v={project.contractor_name} />
            <Info k="監造單位" v={project.supervisor_name} />
            <Info k="開工日" v={project.start_date} />
            <Info k="竣工日" v={project.end_date} />
            <Info k="原契約金額" v={`NT$ ${money(billable)}`} />
            {data.approvedNet !== 0 && <Info k="變更後契約金額" v={`NT$ ${money(billable + data.approvedNet)}`} />}
          </dl>
        </Section>

        {/* 進度 */}
        <Section title="二、施工進度">
          <div className="grid grid-cols-3 gap-4 text-center">
            <Metric label="累計預定進度" value={data.plannedPct == null ? '—' : `${data.plannedPct.toFixed(1)}%`} />
            <Metric label="累計實際進度" value={`${data.actualPct.toFixed(1)}%`} />
            <Metric label="超前 / 落後"
              value={diff == null ? '—' : `${diff >= 0 ? '超前 ' : '落後 '}${Math.abs(diff).toFixed(1)}%`}
              color={diff == null ? '' : diff >= 0 ? 'text-emerald-600' : 'text-rose-600'} />
          </div>
          <p className="text-xs text-[var(--text-3)] mt-3">實際進度依累計估驗金額 ÷ 契約金額計算。</p>
        </Section>

        {/* 估驗請款 */}
        <Section title="三、估驗與請款">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1.5 text-sm">
            <Info k="累計估驗金額" v={`NT$ ${money(data.cumThis)}`} />
            <Info k="本月估驗金額" v={`NT$ ${money(data.thisMonthVal)}`} />
            <Info k="累計已收款" v={`NT$ ${money(data.paidCum)}`} />
            <Info k="已請款期數" v={`${data.invoicedCount} 期`} />
          </dl>
        </Section>

        {/* 本月施工重點 */}
        <Section title="四、本月施工重點">
          {data.logs.length === 0 ? (
            <p className="text-sm text-[var(--text-3)]">本月無施工日誌紀錄。</p>
          ) : (
            <ul className="text-sm space-y-1">
              {data.logs.filter((l) => l.work_summary).map((l) => (
                <li key={l.id} className="flex gap-2"><span className="text-[var(--text-3)] tabular-nums shrink-0">{l.log_date}</span><span>{l.work_summary}</span></li>
              ))}
              {data.logs.every((l) => !l.work_summary) && <li className="text-[var(--text-3)]">本月共 {data.logs.length} 筆日誌（無文字摘要）。</li>}
            </ul>
          )}
        </Section>

        {/* 品質 */}
        <Section title="五、品質管理">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1.5 text-sm">
            <Info k="本月查驗次數" v={`${data.inspM.length} 次`} />
            <Info k="合格 / 不合格" v={`${cnt(data.inspM, (i) => i.status === '合格')} / ${cnt(data.inspM, (i) => i.status === '不合格')}`} />
            <Info k="本月開立缺失" v={`${data.defOpened.length} 件`} />
            <Info k="本月結案 / 未結案" v={`${data.defClosed.length} / ${data.defOpen} 件`} />
          </dl>
        </Section>

        {/* 工安 */}
        <Section title="六、工安管理">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1.5 text-sm">
            <Info k="自主檢查" v={`${cnt(data.safM, (s) => s.record_type === '自主檢查')} 次`} />
            <Info k="工安缺失" v={`${cnt(data.safM, (s) => s.record_type === '工安缺失')} 件`} />
            <Info k="教育訓練" v={`${cnt(data.safM, (s) => s.record_type === '教育訓練')} 場`} />
            <Info k="危害告知" v={`${cnt(data.safM, (s) => s.record_type === '危害告知')} 次`} />
          </dl>
        </Section>

        {/* 變更設計 */}
        {(data.coM.length > 0 || data.approvedNet !== 0) && (
          <Section title="七、變更設計">
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1.5 text-sm">
              <Info k="本月新增變更" v={`${data.coM.length} 件`} />
              <Info k="累計核准淨增減" v={`NT$ ${money(data.approvedNet)}`} />
            </dl>
          </Section>
        )}

        {/* 檢討與下月計畫（可填，列印用）*/}
        <Section title="八、檢討與下月工作計畫">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-medium mb-1">本月檢討</div>
              <textarea value={review} onChange={(e) => setReview(e.target.value)} rows={4}
                placeholder="（填寫本月遭遇問題與因應…）"
                className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm print:border-none print:px-0" />
            </div>
            <div>
              <div className="text-sm font-medium mb-1">下月工作計畫</div>
              <textarea value={nextPlan} onChange={(e) => setNextPlan(e.target.value)} rows={4}
                placeholder="（填寫下月預定施作項目…）"
                className="w-full border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm print:border-none print:px-0" />
            </div>
          </div>
        </Section>

        <div className="grid grid-cols-3 gap-6 pt-8 text-center text-sm">
          {['承包廠商', '監造單位', '主辦機關'].map((r) => (
            <div key={r}><div className="border-t border-[var(--text-3)] pt-1.5 mt-10">{r}</div></div>
          ))}
        </div>
      </div>

      <p className="text-xs text-[var(--text-3)] print:hidden">
        本月報自動彙整自進度、估驗、施工日誌、品質查驗、工安與變更設計。檢討/下月計畫可臨時填寫後列印（不會儲存）。列印時側欄與工具列自動隱藏。
      </p>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section>
      <h3 className="text-sm font-bold text-[var(--text)] border-l-4 border-[var(--blue)] pl-2 mb-3">{title}</h3>
      {children}
    </section>
  )
}
function Info({ k, v }) {
  return <div className="flex gap-2"><dt className="text-[var(--text-3)] shrink-0">{k}：</dt><dd className="font-medium">{v || '—'}</dd></div>
}
function Metric({ label, value, color = '' }) {
  return (
    <div className="border border-[var(--border)] rounded-lg py-3">
      <div className="text-xs text-[var(--text-3)]">{label}</div>
      <div className={`text-xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  )
}
