import { useMemo } from 'react'
import { useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { buildBillableTree, buildCumMap } from '../../lib/boqCalc.js'

const fmt = (n) => (n == null || isNaN(n) ? '' : Math.round(n).toLocaleString('en-US'))
const fmtQ = (n) => (n == null || isNaN(n) ? '' : Number(n).toLocaleString('en-US'))

// 工具列藥丸鈕:與其餘三支列印頁同一組 class(列印頁不 import ui.jsx,就地複寫)。
// 次要鈕留在 slate 色階:紙面永遠是亮色,套 --text-* 在深色模式會變淺字壓白底。
const TOOLBAR_BTN = 'inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium max-sm:min-h-11'
const TOOLBAR_PRIMARY = `${TOOLBAR_BTN} bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]`
const TOOLBAR_SECONDARY = `${TOOLBAR_BTN} bg-white border border-slate-300 text-slate-700 hover:bg-slate-50`

// 估驗計價單（可列印 / 另存 PDF）— 不套 WebLayout，整頁就是文件
export default function ValuationPrint() {
  const { project, workItems, valuations, currentUser, adjustedItems: adjItems, coNet, revisedTotal } = useStore()
  const [sp] = useSearchParams()
  const navigate = useNavigate()

  const periodId = sp.get('p')
  const selected = valuations.find((v) => v.id === periodId) || valuations[valuations.length - 1]
  const prev = selected ? valuations.find((v) => v.period_no === selected.period_no - 1) : null

  // 變更設計調整由 store 統一提供(財務單一真相層,B-02),與估驗頁同一份
  const { childrenMap, roots } = useMemo(
    () => (workItems ? buildBillableTree(adjItems) : { childrenMap: new Map(), roots: [] }),
    [workItems, adjItems],
  )
  const cumThis = useMemo(() => buildCumMap(roots, childrenMap, selected?.items || {}), [roots, childrenMap, selected])
  const cumPrev = useMemo(() => buildCumMap(roots, childrenMap, prev?.items || {}), [roots, childrenMap, prev])

  if (!currentUser) return <Navigate to="/login" replace />
  // 標單尚未載入(workItems 為 null)≠ 這期沒有估驗資料:兩者混成同一畫面時,
  // 深連結進來的載入瞬間會直接告訴使用者「無估驗資料」,誤導成資料不存在(C-11)
  if (!workItems) return <div className="p-10 text-center text-slate-600">載入中…</div>
  if (!selected) {
    return (
      <div className="p-10 text-center text-slate-600">
        無估驗資料。<button onClick={() => navigate('/valuation')} className="text-[var(--blue-text)] underline">返回估驗計價</button>
      </div>
    )
  }

  const billableTotal = revisedTotal
  const leaves = adjItems
    .filter((it) => it.is_billable && !it.is_rollup && !(childrenMap.get(it.item_key)?.length) && (cumThis.get(it.item_key) || 0) > 0)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))

  const totalCum = roots.reduce((s, r) => s + (cumThis.get(r.item_key) || 0), 0)
  const totalPrev = roots.reduce((s, r) => s + (cumPrev.get(r.item_key) || 0), 0)
  const periodAmt = totalCum - totalPrev
  const retPct = selected.retention_pct ?? 5
  const ret = retPct / 100
  const completion = billableTotal ? (totalCum / billableTotal) * 100 : 0

  const Info = ({ label, children }) => (
    <div className="flex"><span className="text-slate-500 w-20 shrink-0">{label}</span><span className="font-medium text-slate-800">{children}</span></div>
  )
  const Sum = ({ label, value, strong }) => (
    <div className="flex justify-between border-b border-slate-200 py-1">
      <span className="text-slate-600">{label}</span>
      <span className={`tabular-nums ${strong ? 'font-bold text-slate-900' : 'text-slate-800'}`}>{value}</span>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      {/* 工具列（列印時隱藏）*/}
      <div className="print:hidden sticky top-0 bg-white border-b border-slate-200 px-6 py-3 flex flex-wrap items-center justify-between gap-2">
        <button onClick={() => navigate('/valuation')} className={TOOLBAR_SECONDARY}>← 返回估驗計價</button>
        <button onClick={() => window.print()} className={TOOLBAR_PRIMARY}><MSym name="print" size={15} />列印 / 另存 PDF</button>
      </div>

      {/* 文件本體 A4 */}
      <div className="max-w-[820px] mx-auto bg-white my-6 print:my-0 p-10 print:p-0 shadow-sm print:shadow-none text-[13px] text-slate-800">
        <div className="text-center mb-5">
          <h1 className="text-xl font-bold tracking-wide">估 驗 計 價 單</h1>
          <div className="text-slate-500 mt-1">第 {selected.period_no} 期</div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-5 border-y border-slate-300 py-3">
          <Info label="工程名稱">{project.project_name}</Info>
          <Info label="契約編號">{project.project_code || '—'}</Info>
          <Info label="機　　關">{project.owner_name || '—'}</Info>
          <Info label="承包廠商">{project.contractor_name || '—'}</Info>
          <Info label="估驗日期">{selected.valuation_date}</Info>
          <Info label={coNet !== 0 ? '變更後契約金額' : '發包工程費'}>NT$ {fmt(billableTotal)}{coNet !== 0 && <span className="text-slate-500 font-normal">（原發包 {fmt(billableTotal - coNet)}）</span>}</Info>
        </div>

        {/* 金額彙總 */}
        <div className="grid grid-cols-2 gap-x-10 mb-5">
          <div>
            <Sum label="累計估驗金額" value={`${fmt(totalCum)}`} />
            <Sum label="累計完成度" value={`${completion.toFixed(2)}%`} />
            <Sum label={`累計保留款（${retPct}%）`} value={fmt(totalCum * ret)} />
          </div>
          <div>
            <Sum label="本期估驗金額" value={fmt(periodAmt)} strong />
            {/* 0 時不加負號前綴,避免印成「-0」(R4 P2-04) */}
            <Sum label={`本期保留款（${retPct}%）`} value={Math.round(periodAmt * ret) ? `-${fmt(periodAmt * ret)}` : fmt(0)} />
            <Sum label="本期實領金額" value={fmt(periodAmt * (1 - ret))} strong />
          </div>
        </div>

        {/* 明細 */}
        <div className="text-[11px] text-slate-500 mb-1">本期估驗明細（僅列累計有完成之工項）</div>
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-slate-100">
              {['項次', '工項名稱', '單位', '契約數量', '單價', '累計完成數量', '累計金額', '本期金額'].map((h) => (
                <th key={h} className="border border-slate-300 px-1.5 py-1 font-medium text-slate-600 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leaves.map((it) => {
              const cum = cumThis.get(it.item_key) || 0
              const per = cum - (cumPrev.get(it.item_key) || 0)
              return (
                <tr key={it.item_key}>
                  <td className="border border-slate-200 px-1.5 py-1 text-slate-500 whitespace-nowrap">{it.item_no}</td>
                  <td className="border border-slate-200 px-1.5 py-1">{it.description}</td>
                  <td className="border border-slate-200 px-1.5 py-1 text-center text-slate-500 whitespace-nowrap">{it.unit}</td>
                  <td className="border border-slate-200 px-1.5 py-1 text-right tabular-nums whitespace-nowrap">{fmtQ(it.quantity)}</td>
                  <td className="border border-slate-200 px-1.5 py-1 text-right tabular-nums whitespace-nowrap">{fmt(it.unit_price)}</td>
                  <td className="border border-slate-200 px-1.5 py-1 text-right tabular-nums whitespace-nowrap">{fmtQ(selected.items[it.item_key])}</td>
                  <td className="border border-slate-200 px-1.5 py-1 text-right tabular-nums whitespace-nowrap">{fmt(cum)}</td>
                  <td className="border border-slate-200 px-1.5 py-1 text-right tabular-nums whitespace-nowrap">{fmt(per)}</td>
                </tr>
              )
            })}
            <tr className="bg-slate-50 font-semibold">
              <td className="border border-slate-300 px-1.5 py-1 text-right" colSpan={6}>合計</td>
              <td className="border border-slate-300 px-1.5 py-1 text-right tabular-nums">{fmt(totalCum)}</td>
              <td className="border border-slate-300 px-1.5 py-1 text-right tabular-nums">{fmt(periodAmt)}</td>
            </tr>
          </tbody>
        </table>

        {/* 簽核 */}
        <div className="grid grid-cols-3 gap-4 mt-10 text-center text-slate-500">
          {['承包廠商', '監造單位', '主管機關'].map((r) => (
            <div key={r}>
              <div className="h-16 border-b border-slate-300" />
              <div className="mt-1.5 text-[12px]">{r}（簽章）</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
