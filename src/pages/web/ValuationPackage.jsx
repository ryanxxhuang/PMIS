import { useMemo, useEffect, useState } from 'react'
import { useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { Printer, Sparkles, Images } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { buildBillableTree, buildCumMap } from '../../lib/boqCalc.js'

const fmt = (n) => (n == null || isNaN(n) ? '' : Math.round(n).toLocaleString('en-US'))
const fmtQ = (n) => (n == null || isNaN(n) ? '' : Number(n).toLocaleString('en-US'))

// 估驗請款佐證包(可列印 / 另存 PDF)——本期估驗明細 + AI 本期施工說明 + 佐證照片(按工項)。
// 佐證照片吃 classify-site-photo 配好的工項標籤,估驗時自動歸位;不套 WebLayout,整頁即文件。
export default function ValuationPackage() {
  const { project, workItems, valuations, currentUser, siteLogs,
    adjustedItems: adjItems, revisedTotal,
    listPhotosByWorkItems, draftValuationSummary } = useStore()
  const [sp] = useSearchParams()
  const navigate = useNavigate()

  const periodId = sp.get('p')
  const selected = valuations.find((v) => v.id === periodId) || valuations[valuations.length - 1]
  const prev = selected ? valuations.find((v) => v.period_no === selected.period_no - 1) : null

  // 變更設計調整由 store 統一提供(財務單一真相層,B-02)
  const { childrenMap, roots } = useMemo(
    () => (workItems ? buildBillableTree(adjItems) : { childrenMap: new Map(), roots: [] }),
    [workItems, adjItems],
  )
  const cumThis = useMemo(() => buildCumMap(roots, childrenMap, selected?.items || {}), [roots, childrenMap, selected])
  const cumPrev = useMemo(() => buildCumMap(roots, childrenMap, prev?.items || {}), [roots, childrenMap, prev])
  // buildCumMap 回的是「金額」;本期「數量」必須取估驗 items 的累計數量相減,不可拿金額當數量(P0-01)。
  const periodQty = (key) => (Number(selected?.items?.[key]) || 0) - (Number(prev?.items?.[key]) || 0)
  const periodAmtOf = (key) => (cumThis.get(key) || 0) - (cumPrev.get(key) || 0) // 本期金額 = buildCumMap 金額差

  // 本期有完成的末端工項(本期量 > 0)
  const leaves = useMemo(() => {
    if (!workItems) return []
    return adjItems
      .filter((it) => it.is_billable && !it.is_rollup && !(childrenMap.get(it.item_key)?.length)
        && ((cumThis.get(it.item_key) || 0) - (cumPrev.get(it.item_key) || 0)) > 0)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  }, [workItems, adjItems, childrenMap, cumThis, cumPrev])

  const totalCum = roots.reduce((s, r) => s + (cumThis.get(r.item_key) || 0), 0)
  const totalPrev = roots.reduce((s, r) => s + (cumPrev.get(r.item_key) || 0), 0)
  const periodAmt = totalCum - totalPrev
  const billableTotal = revisedTotal
  const completion = billableTotal ? (totalCum / billableTotal) * 100 : 0
  const retPct = selected?.retention_pct ?? 5

  // 佐證照片(按工項)+ AI 本期施工說明
  const [photosByItem, setPhotosByItem] = useState({})
  const [photoCount, setPhotoCount] = useState(0)
  const [summary, setSummary] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [excluded, setExcluded] = useState(() => new Set()) // 使用者於列印前排除的誤配照片 id(P0-02 覆核 gate)
  const incl = (list) => (list || []).filter((p) => !excluded.has(p.id))
  const inclCount = Object.values(photosByItem).reduce((s, l) => s + incl(l).length, 0)
  const toggleExclude = (id) => setExcluded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const leafKeys = useMemo(() => leaves.map((l) => l.item_key).join(','), [leaves])

  useEffect(() => {
    let alive = true
    if (!selected || !leaves.length) { setLoaded(true); return }
    ;(async () => {
      const pics = await listPhotosByWorkItems(leaves.map((l) => l.item_key))
      if (!alive) return
      const grouped = {}
      for (const p of pics) { (grouped[p.work_item_key] ||= []).push(p) }
      setPhotosByItem(grouped); setPhotoCount(pics.length); setLoaded(true)
    })()
    return () => { alive = false }
  }, [selected?.id, leafKeys, listPhotosByWorkItems]) // eslint-disable-line react-hooks/exhaustive-deps

  const genSummary = async () => {
    if (!selected) return
    setAiBusy(true)
    const payload = {
      period_no: selected.period_no, period_amount: periodAmt, completion_pct: Number(completion.toFixed(1)),
      items: leaves.slice(0, 30).map((it) => ({
        name: it.description, unit: it.unit,
        period_qty: periodQty(it.item_key),           // 數量(非金額)
        period_amount: periodAmtOf(it.item_key),       // 金額另附,供 AI 引用不必自乘
      })),
      photo_captions: Object.values(photosByItem).flatMap((l) => incl(l)).map((p) => p.caption).filter(Boolean).slice(0, 12),
      log_summaries: siteLogs.map((l) => l.work_summary).filter(Boolean).slice(-12),
    }
    const { error, result } = await draftValuationSummary(payload)
    setAiBusy(false)
    if (!error && result?.summary) setSummary(result.summary)
  }

  // 佐證照片載入後自動產生一次 AI 說明(尚未產生時)
  useEffect(() => {
    if (loaded && selected && !summary && !aiBusy) genSummary()
  }, [loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentUser) return <Navigate to="/login" replace />
  if (!workItems || !selected) {
    return (
      <div className="p-10 text-center text-slate-400">
        無估驗資料。<button onClick={() => navigate('/valuation')} className="text-[var(--blue-text)] underline">返回估驗計價</button>
      </div>
    )
  }

  const Info = ({ label, children }) => (
    <div className="flex"><span className="text-slate-500 w-20 shrink-0">{label}</span><span className="font-medium text-slate-800">{children}</span></div>
  )

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      {/* 工具列(列印時隱藏)*/}
      <div className="print:hidden sticky top-0 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between z-10">
        <button onClick={() => navigate('/valuation')} className="text-sm text-slate-500 hover:text-slate-800">← 返回估驗計價</button>
        <div className="flex items-center gap-2">
          <button onClick={genSummary} disabled={aiBusy}
            className="text-sm text-[var(--blue-text)] border border-[var(--border)] rounded-lg px-3 py-2 hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50">
            <Sparkles size={15} aria-hidden />{aiBusy ? 'AI 產生中…' : '重新產生施工說明'}
          </button>
          <button onClick={() => window.print()} className="bg-[var(--primary)] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[var(--primary-hover)] inline-flex items-center gap-1.5">
            <Printer size={15} aria-hidden />列印 / 另存 PDF
          </button>
        </div>
      </div>

      {/* 文件本體 A4 */}
      <div className="max-w-[820px] mx-auto bg-white my-6 print:my-0 p-10 print:p-0 shadow-sm print:shadow-none text-[13px] text-slate-800">
        <div className="text-center mb-5">
          <h1 className="text-xl font-bold tracking-wide">估 驗 請 款 佐 證 包</h1>
          <div className="text-slate-500 mt-1">第 {selected.period_no} 期</div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-5 border-y border-slate-300 py-3">
          <Info label="工程名稱">{project.project_name}</Info>
          <Info label="契約編號">{project.project_code || '—'}</Info>
          <Info label="機　　關">{project.owner_name || '—'}</Info>
          <Info label="承包廠商">{project.contractor_name || '—'}</Info>
          <Info label="估驗日期">{selected.valuation_date}</Info>
          <Info label="本期估驗">NT$ {fmt(periodAmt)}（累計完成 {completion.toFixed(1)}%）</Info>
        </div>

        {/* AI 本期施工說明(可編輯,列印含內容)*/}
        <div className="mb-5">
          <div className="text-slate-600 font-medium mb-1 flex items-center gap-1.5">
            <Sparkles size={13} className="text-[var(--blue)] print:hidden" aria-hidden />本期施工說明
            <span className="text-[11px] text-slate-400 font-normal print:hidden">（AI 依本期工項與現場照片草擬，可直接修改）</span>
          </div>
          <textarea
            value={aiBusy && !summary ? 'AI 產生中…' : summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={4}
            className="w-full text-[13px] leading-relaxed text-slate-800 border border-slate-200 print:border-0 rounded p-2 print:p-0 resize-none focus:outline-none focus:border-[var(--blue)]"
          />
        </div>

        {/* 本期估驗明細(手機:表格自身橫捲,不讓整頁水平漂移——P1-08)*/}
        <div className="text-[11px] text-slate-500 mb-1">本期估驗明細（僅列本期有完成之工項）</div>
        <div className="overflow-x-auto -mx-1 mb-6 print:overflow-visible print:mx-0">
        <table className="w-full border-collapse text-[12px] min-w-[560px] print:min-w-0">
          <thead>
            <tr className="bg-slate-100">
              {['項次', '工項名稱', '單位', '本期完成數量', '單價', '本期金額', '佐證'].map((h) => (
                <th key={h} className="border border-slate-300 px-1.5 py-1 font-medium text-slate-600 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leaves.map((it) => {
              const qty = periodQty(it.item_key)          // 本期完成數量(原始數量差)
              const amt = periodAmtOf(it.item_key)         // 本期金額(金額差,已 = 數量 × 單價,不可再乘)
              const n = incl(photosByItem[it.item_key]).length
              return (
                <tr key={it.item_key}>
                  <td className="border border-slate-200 px-1.5 py-1 text-slate-500 whitespace-nowrap">{it.item_no}</td>
                  <td className="border border-slate-200 px-1.5 py-1">{it.description}</td>
                  <td className="border border-slate-200 px-1.5 py-1 text-center text-slate-500 whitespace-nowrap">{it.unit}</td>
                  <td className="border border-slate-200 px-1.5 py-1 text-right tabular-nums whitespace-nowrap">{fmtQ(qty)}</td>
                  <td className="border border-slate-200 px-1.5 py-1 text-right tabular-nums whitespace-nowrap">{fmt(it.unit_price)}</td>
                  <td className="border border-slate-200 px-1.5 py-1 text-right tabular-nums whitespace-nowrap">{fmt(amt)}</td>
                  <td className="border border-slate-200 px-1.5 py-1 text-center text-slate-500 whitespace-nowrap">{n ? `${n} 張` : '—'}</td>
                </tr>
              )
            })}
            <tr className="bg-slate-50 font-semibold">
              <td className="border border-slate-300 px-1.5 py-1 text-right" colSpan={5}>本期估驗合計</td>
              <td className="border border-slate-300 px-1.5 py-1 text-right tabular-nums">{fmt(periodAmt)}</td>
              <td className="border border-slate-300 px-1.5 py-1 text-center text-slate-500">{inclCount} 張</td>
            </tr>
          </tbody>
        </table>
        </div>

        {/* 佐證照片(按工項)*/}
        <div className="text-slate-600 font-medium mb-2 flex items-center gap-1.5">
          <Images size={14} className="text-[var(--blue)] print:hidden" aria-hidden />現場佐證照片（按工項）
        </div>
        <p className="text-[11px] text-slate-400 mb-2 print:hidden">照片由 AI 依工項自動歸位,可能誤配;<b className="text-slate-600">列印/送審前請逐張確認</b>,點 ✕ 可將誤配或非佐證照片排除本包。</p>
        {!loaded ? (
          <div className="text-slate-400 text-[12px] py-4">照片載入中…</div>
        ) : inclCount === 0 ? (
          <div className="text-slate-400 text-[12px] py-4 border border-dashed border-slate-200 rounded px-3 print:border-0">
            {photoCount === 0
              ? '本期工項尚無已配對的佐證照片。可到「施工日誌 → AI 批次辨識照片」上傳現場照,AI 會自動配到對應工項,估驗時即自動歸入本包。'
              : '本期佐證照片已全部排除。'}
          </div>
        ) : (
          <div className="space-y-4">
            {leaves.filter((it) => incl(photosByItem[it.item_key]).length).map((it) => (
              <div key={it.item_key} className="break-inside-avoid">
                <div className="text-[12px] font-medium text-slate-700 mb-1">
                  <span className="text-slate-400 mr-1.5">{it.item_no}</span>{it.description}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {incl(photosByItem[it.item_key]).map((p) => (
                    <figure key={p.id} className="relative border border-slate-200 rounded overflow-hidden break-inside-avoid group">
                      {p.url && <img src={p.url} alt={p.caption || ''} className="w-full h-28 object-cover" />}
                      <button onClick={() => toggleExclude(p.id)} title="排除此張(不列入本包)"
                        className="print:hidden absolute top-1 right-1 w-6 h-6 rounded-full bg-black/55 text-white text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                      <figcaption className="text-[10px] text-slate-500 px-1.5 py-1 leading-tight">
                        {p.caption || '—'}{p.taken_at ? ` · ${String(p.taken_at).slice(0, 10)}` : ''}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 簽核 */}
        <div className="grid grid-cols-3 gap-4 mt-10 text-center text-slate-500 break-inside-avoid">
          {['承包廠商', '監造單位', '主管機關'].map((r) => (
            <div key={r}>
              <div className="h-16 border-b border-slate-300" />
              <div className="mt-1.5 text-[12px]">{r}（簽章）</div>
            </div>
          ))}
        </div>
        <div className="text-[10px] text-slate-400 mt-3 print:hidden">
          保留款 {retPct}%。本包為佐證彙整，正式估驗金額以「估驗計價單」為準。
        </div>
      </div>
    </div>
  )
}
