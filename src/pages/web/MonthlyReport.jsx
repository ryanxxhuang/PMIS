import { useState, useMemo } from 'react'
import { Printer, Sparkles } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { Card, Empty, Button, PageHeader } from '../../components/ui.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { parseLocalDate } from '../../lib/dates.js'
import { rainDayCount } from '../../lib/weatherMetrics.js'
import { validateDraft } from '../../lib/factsValidator.js'

const money = (n) => (n == null || isNaN(n) ? '0' : Math.round(n).toLocaleString('en-US'))
const qtyFmt = (n) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }))
const thisMonthStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const inMonth = (d, m) => (d || '').slice(0, 7) === m
// 某月最後一天（用來算「截至月底」的累計）
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0) }
const prevMonth = (m) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export default function MonthlyReport() {
  const { project, workItems, dbMode, demoMode, valuations, progressPlan, siteLogs,
    inspections, defects, safetyRecords, changeOrders, draftMonthlyReview } = useStore()
  const [month, setMonth] = useState(thisMonthStr())
  const [review, setReview] = useState('')   // 工程檢討（列印用，不儲存）
  const [nextPlan, setNextPlan] = useState('') // 下月工作計畫
  const [aiBusy, setAiBusy] = useState(false)
  const [aiErr, setAiErr] = useState('')

  const billable = workItems?.meta.billable_total || 0

  const tree = useMemo(() => (workItems ? buildBillableTree(workItems.items) : { roots: [], childrenMap: new Map() }), [workItems])

  // 截至某 cutoff 日的累計估驗金額（取 valuation_date 在 cutoff（含）以前、期數最大的一期）
  const cumAt = (cutoff) => {
    const eligible = valuations.filter((v) => !v.valuation_date || parseLocalDate(v.valuation_date) <= cutoff)
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
    // 本月 / 截至月底累計完成數量（彙整自施工日誌明細）
    const byKey = new Map((workItems?.items || []).map((it) => [it.item_key, it]))
    const sumQty = (ls) => {
      const m = new Map()
      for (const l of ls) for (const [k, q] of Object.entries(l.items || {})) m.set(k, (m.get(k) || 0) + (Number(q) || 0))
      return m
    }
    const qtyM = sumQty(logs)
    const qtyCum = sumQty(siteLogs.filter((l) => l.log_date && parseLocalDate(l.log_date) <= mEnd))
    const itemRows = [...qtyM.entries()].map(([k, q]) => {
      const it = byKey.get(k) || {}
      return { key: k, item_no: it.item_no || '', description: it.description || k, unit: it.unit || '',
        contractQty: it.quantity || 0, qty: q, cum: qtyCum.get(k) || 0, value: (it.unit_price || 0) * q }
    }).sort((a, b) => b.value - a.value)
    const rainDays = rainDayCount(logs) // 與監造報表/AI 助理同源(任一時段含雨=雨天)
    const inspM = inspections.filter((i) => inMonth(i.requested_date || i.created_at, month))
    // 品質段只算 domain=quality;工安缺失在「七、工安管理」段(safDefM),不重複計
    const qDefects = defects.filter((d) => (d.domain || 'quality') === 'quality')
    const defOpened = qDefects.filter((d) => inMonth(d.created_at, month))
    const defClosed = qDefects.filter((d) => d.closed_at && inMonth(d.closed_at, month))
    const defOpen = qDefects.filter((d) => d.status !== '已結案').length
    const safM = safetyRecords.filter((s) => inMonth(s.record_date, month))
    // 工安缺失=統一缺失引擎(domain='safety'),以發現日(無則建立日)歸月
    const safDefM = defects.filter((d) => d.domain === 'safety' && inMonth(d.record_date || d.created_at, month))
    const coM = changeOrders.filter((c) => inMonth(c.co_date, month))
    const approvedNet = changeOrders.filter((c) => c.status === '核准')
      .reduce((s, c) => s + c.items.reduce((t, it) => t + (Number(it.amount_delta) || 0), 0), 0)
    return {
      cumThis, thisMonthVal: cumThis - cumPrev, actualPct, plannedPct,
      logs, itemRows, rainDays, inspM, defOpened, defClosed, defOpen, safM, safDefM, coM, approvedNet,
      paidCum: valuations.reduce((s, v) => s + (v.paid_amount || 0), 0),
      invoicedCount: valuations.filter((v) => v.invoice_date).length,
    }
  }, [month, valuations, progressPlan, siteLogs, inspections, defects, safetyRecords, changeOrders, tree, billable, workItems])

  if (!dbMode && !demoMode) {
    return <Card title="施工月報"><Empty>此功能需真實專案（已匯入標單）。請先建立專案並匯入標單。</Empty></Card>
  }

  const cnt = (arr, pred) => arr.filter(pred).length
  const diff = data.plannedPct != null ? data.actualPct - data.plannedPct : null

  return (
    <div className="space-y-5">
      {/* 工具列（列印時隱藏）*/}
      <div className="print:hidden">
        <PageHeader title="施工月報" tagline="自動彙編" subtitle="選月份 → 自動彙整進度 / 估驗 / 品質 / 工安 / 變更 → 列印或存 PDF"
          action={
            <div className="flex items-end gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-[var(--text-2)] mb-1">報告月份</span>
                <input type="month" value={month} aria-label="月報月份" onChange={(e) => setMonth(e.target.value)}
                  className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
              </label>
              <Button onClick={() => window.print()}><Printer size={15} aria-hidden />列印 / 存 PDF</Button>
            </div>
          } />
      </div>

      {/* 月報本體（列印範圍）*/}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border-2)] shadow-[0_1px_2px_rgba(22,32,43,.03),0_1px_10px_-2px_rgba(22,32,43,.05)] p-6 md:p-8 print:border-0 print:shadow-none print:p-0 space-y-6 text-[var(--text)]">
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

        {/* 本月完成工項數量（彙整自施工日誌明細）*/}
        <Section title="四、本月完成主要工項數量">
          {data.itemRows.length === 0 ? (
            <p className="text-sm text-[var(--text-3)]">本月施工日誌無工項數量紀錄。</p>
          ) : (
            <>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-y border-[var(--border)] text-xs text-[var(--text-2)]">
                    <th className="text-left py-1.5 pr-2 font-medium whitespace-nowrap">項次</th>
                    <th className="text-left py-1.5 pr-2 font-medium">工項名稱</th>
                    <th className="text-center py-1.5 px-2 font-medium whitespace-nowrap">單位</th>
                    <th className="text-right py-1.5 px-2 font-medium whitespace-nowrap">契約數量</th>
                    <th className="text-right py-1.5 px-2 font-medium whitespace-nowrap">本月完成</th>
                    <th className="text-right py-1.5 px-2 font-medium whitespace-nowrap">累計完成</th>
                    <th className="text-right py-1.5 pl-2 font-medium whitespace-nowrap">累計完成率</th>
                  </tr>
                </thead>
                <tbody>
                  {data.itemRows.slice(0, 15).map((r) => (
                    <tr key={r.key} className="border-b border-[var(--border)]">
                      <td className="py-1.5 pr-2 text-[var(--text-3)] text-xs tabular-nums whitespace-nowrap">{r.item_no}</td>
                      <td className="py-1.5 pr-2">{r.description}</td>
                      <td className="py-1.5 px-2 text-center text-[var(--text-3)]">{r.unit}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{qtyFmt(r.contractQty)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums font-medium">{qtyFmt(r.qty)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{qtyFmt(r.cum)}</td>
                      <td className="py-1.5 pl-2 text-right tabular-nums">{r.contractQty ? `${Math.min(100, (r.cum / r.contractQty) * 100).toFixed(1)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.itemRows.length > 15 && (
                <p className="text-xs text-[var(--text-3)] mt-2">依本月完成金額列前 15 項，其餘 {data.itemRows.length - 15} 項略（詳估驗計價明細）。</p>
              )}
            </>
          )}
        </Section>

        {/* 施工紀要 */}
        <Section title="五、本月施工紀要">
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1.5 text-sm mb-3">
            <Info k="施工天數" v={`${data.logs.length} 天`} />
            <Info k="雨天" v={`${data.rainDays} 天`} />
          </dl>
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
        <Section title="六、品質管理">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1.5 text-sm">
            <Info k="本月查驗次數" v={`${data.inspM.length} 次`} />
            <Info k="合格 / 不合格" v={`${cnt(data.inspM, (i) => i.status === '合格')} / ${cnt(data.inspM, (i) => i.status === '不合格')}`} />
            <Info k="本月開立缺失" v={`${data.defOpened.length} 件`} />
            <Info k="本月結案 / 未結案" v={`${data.defClosed.length} / ${data.defOpen} 件`} />
          </dl>
        </Section>

        {/* 工安 */}
        <Section title="七、工安管理">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1.5 text-sm">
            <Info k="自主檢查" v={`${cnt(data.safM, (s) => s.record_type === '自主檢查')} 次`} />
            <Info k="工安缺失" v={`${data.safDefM.length} 件`} />
            <Info k="教育訓練" v={`${cnt(data.safM, (s) => s.record_type === '教育訓練')} 場`} />
            <Info k="危害告知" v={`${cnt(data.safM, (s) => s.record_type === '危害告知')} 次`} />
          </dl>
        </Section>

        {/* 變更設計 */}
        {(data.coM.length > 0 || data.approvedNet !== 0) && (
          <Section title="八、變更設計">
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1.5 text-sm">
              <Info k="本月新增變更" v={`${data.coM.length} 件`} />
              <Info k="累計核准淨增減" v={`NT$ ${money(data.approvedNet)}`} />
            </dl>
          </Section>
        )}

        {/* 檢討與下月計畫（可填，列印用）*/}
        <Section title="九、檢討與下月工作計畫">
          <div className="print:hidden mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-flex items-center gap-1">
            ⚠ 此兩欄為<b>列印前暫填</b>，離開或重整不會保存；請於列印/存 PDF 前填妥。
          </div>
          <div className="print:hidden mb-2 flex items-center gap-2">
            <button onClick={async () => {
              setAiBusy(true); setAiErr('')
              // facts=程式算好的數據;AI 只改寫、不算數(P1-1)
              const payload = {
                month, project_name: project.project_name,
                stats: {
                  thisMonthVal: data.thisMonthVal, cumThis: data.cumThis,
                  actualPct: data.actualPct, plannedPct: data.plannedPct, diff,
                  workDays: data.logs.length, rainDays: data.rainDays,
                  inspections: data.inspM.length, failed: cnt(data.inspM, (i) => i.status === '不合格'),
                  defectsOpened: data.defOpened.length, defectsClosed: data.defClosed.length, defectsOpen: data.defOpen,
                  changeOrders: data.coM.length, approvedNet: data.approvedNet,
                  logSummaries: data.logs.filter((l) => l.work_summary).map((l) => l.work_summary).slice(-10),
                  // 工項級數字(含頁面顯示的累計完成率)也是 facts——否則 AI 引用
                  // 表格裡的 0.1% 會被 validator 誤殺(第二輪 P1-06)
                  items: data.itemRows.slice(0, 15).map((r) => ({
                    item_no: r.item_no, description: r.description, unit: r.unit,
                    qty: r.qty, cum: r.cum, contractQty: r.contractQty, value: r.value,
                    cumPct: r.contractQty ? +Math.min(100, (r.cum / r.contractQty) * 100).toFixed(1) : null,
                  })),
                },
              }
              const { error, result } = await draftMonthlyReview(payload)
              setAiBusy(false)
              if (error) { setAiErr(error.message || 'AI 草稿失敗'); return }
              // 確定性驗證:草稿中的數字必須全部出自 facts,否則整份擋下不帶入
              const check = validateDraft(`${result.review || ''}\n${result.next_plan || ''}`, payload)
              if (!check.ok) {
                setAiErr(`AI 草稿含依據以外的數字（${check.violations.slice(0, 5).join('、')}），已擋下未帶入——請重試或手動撰寫。`)
                return
              }
              setReview(result.review || ''); setNextPlan(result.next_plan || '')
            }} disabled={aiBusy}
              className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-3 py-1.5 border border-[var(--border)] transition ${aiBusy ? 'opacity-50' : 'hover:bg-[var(--surface-2)] text-[var(--blue)]'}`}>
              <Sparkles size={15} aria-hidden />{aiBusy ? 'AI 撰寫中…' : 'AI 產生草稿'}
            </button>
            <span className="text-[11px] text-[var(--text-3)]">依本月數據自動起草，可再編修</span>
            {aiErr && <span className="text-xs text-rose-600">{aiErr}</span>}
          </div>
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
