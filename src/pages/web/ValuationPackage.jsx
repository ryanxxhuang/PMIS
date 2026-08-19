import { useMemo, useEffect, useState } from 'react'
import { useSearchParams, useNavigate, Navigate } from 'react-router-dom'
import { Printer, Sparkles, Images, FileText } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { buildBillableTree, buildCumMap } from '../../lib/boqCalc.js'
import { collectEvidence, photoEvidenceLine } from '../../lib/evidence.js'

const fmt = (n) => (n == null || isNaN(n) ? '' : Math.round(n).toLocaleString('en-US'))
const fmtQ = (n) => (n == null || isNaN(n) ? '' : Number(n).toLocaleString('en-US'))

// 估驗請款佐證包(可列印 / 另存 PDF)——本期估驗明細 + AI 本期施工說明 + 佐證照片(按工項)。
// 佐證照片吃 classify-site-photo 配好的工項標籤,估驗時自動歸位;不套 WebLayout,整頁即文件。
// 配色刻意不吃主題 token(與 SiteLogPrint 同):整份是固定白紙,套 --text-*／--amber-text
// 在深色模式會變成淺字壓白底、列印也會失真。W8-5 只把過淡的 slate-400(白底 2.6:1)
// 調深到符合 AA,警語另用 amber-700(白底 5.7:1),不改成 token。
export default function ValuationPackage() {
  const { project, workItems, valuations, currentUser, siteLogs,
    adjustedItems: adjItems, revisedTotal,
    listPhotosByWorkItems, draftValuationSummary, aiEnabled } = useStore()
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

  // 附件:施工日誌——本期估驗工項的貢獻日誌(佐證推導層 collectEvidence 確定性 join,
  // 不存關聯表;日誌改了附件自動跟著對)。列可查證的清單,不逐份印公定格式。
  const [attachLogs, setAttachLogs] = useState(true) // 列印前開關,預設夾附
  const LOG_CAP = 60
  const logAttachment = useMemo(() => {
    if (!leaves.length || !siteLogs?.length) return { rows: [], total: 0 }
    const logByDate = new Map(siteLogs.map((l) => [l.log_date, l]))
    const byDate = new Map() // log_date → 該日貢獻的本期工項與數量
    for (const it of leaves) {
      const { logs } = collectEvidence(it.item_key, { siteLogs, workItem: it })
      for (const l of logs) {
        if (!byDate.has(l.log_date)) byDate.set(l.log_date, [])
        byDate.get(l.log_date).push({ item_no: it.item_no, description: it.description, unit: it.unit, qty: l.qty })
      }
    }
    const rows = [...byDate.entries()]
      .sort((a, b) => (b[0] || '').localeCompare(a[0] || '')) // 日期新→舊
      .map(([date, items]) => {
        const src = logByDate.get(date)
        return {
          date,
          weather: [src?.weather_am, src?.weather_pm].filter(Boolean).join(' / ') || src?.weather || '—',
          summary: src?.work_summary || '',
          items,
        }
      })
    return { rows: rows.slice(0, LOG_CAP), total: rows.length }
  }, [leaves, siteLogs])

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

  // 佐證照片載入後自動產生一次 AI 說明(尚未產生時)。
  // 批 B UX:功能關閉時不自動產生(避免載入頁面就吃 403),說明欄保留人工填寫。
  useEffect(() => {
    if (loaded && selected && !summary && !aiBusy && aiEnabled('valuation.summary')) genSummary()
  }, [loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentUser) return <Navigate to="/login" replace />
  if (!workItems || !selected) {
    return (
      <div className="p-10 text-center text-slate-600">
        無估驗資料。<button onClick={() => navigate('/valuation')} className="text-[var(--blue-text)] underline inline-flex items-center max-sm:min-h-11 px-1">返回估驗計價</button>
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
        <button onClick={() => navigate('/valuation')} className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center max-sm:min-h-11 px-1">← 返回估驗計價</button>
        <div className="flex items-center gap-2">
          {/* 批 B UX:估驗施工說明草稿功能關閉時藏按鈕、留簡短說明(說明欄仍可人工填) */}
          {aiEnabled('valuation.summary') ? (
            <button onClick={genSummary} disabled={aiBusy}
              className="text-sm text-[var(--blue-text)] border border-[var(--border)] rounded-lg px-3 py-2 hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50 max-sm:min-h-11">
              <Sparkles size={15} aria-hidden />{aiBusy ? 'AI 產生中…' : '重新產生施工說明'}
            </button>
          ) : (
            <span className="text-xs text-slate-600">AI 施工說明未啟用，請直接編輯下方說明欄</span>
          )}
          <button onClick={() => window.print()} className="bg-[var(--primary)] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[var(--primary-hover)] inline-flex items-center gap-1.5 max-sm:min-h-11">
            <Printer size={15} aria-hidden />列印 / 另存 PDF
          </button>
        </div>
      </div>

      {/* 文件本體 A4 */}
      <div className="max-w-[820px] mx-auto bg-white my-6 print:my-0 p-10 print:p-0 shadow-sm print:shadow-none text-[13px] text-slate-800">
        <div className="text-center mb-5">
          <h1 className="text-xl font-bold tracking-wide">估 驗 請 款 佐 證 包</h1>
          <div className="text-slate-500 mt-1">第 {selected.period_no} 期</div>
          {/* 本文件的定性必須跟著紙本走:原本這句藏在頁尾 11px 且 print:hidden,
              列印出去就完全不見,機關很可能拿佐證包當計價依據。提到頁首常駐、列印同印。 */}
          <div className="mt-2 inline-block text-[12px] text-amber-700 border border-amber-300 rounded px-3 py-1.5">
            本包為佐證彙整，正式估驗金額以「估驗計價單」為準。
          </div>
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
            <span className="text-xs text-slate-500 font-normal print:hidden">（AI 依本期工項與現場照片草擬，可直接修改）</span>
          </div>
          <textarea
            value={aiBusy && !summary ? 'AI 產生中…' : summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={4}
            className="w-full text-[13px] leading-relaxed text-slate-800 border border-slate-200 print:border-0 rounded p-2 print:p-0 resize-none focus:outline-none focus:border-[var(--blue)]"
          />
        </div>

        {/* 本期估驗明細(手機:表格自身橫捲,不讓整頁水平漂移——P1-08)*/}
        <div className="text-xs text-slate-600 mb-1">本期估驗明細（僅列本期有完成之工項）</div>
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
            {/* 本期沒有新增完成量時,原本 tbody 只剩一列合計 0,看起來像「資料掉了」。
                明講是「本期無新增」而非無資料,並指向累計數字該去哪裡看(C-11)。 */}
            {leaves.length === 0 && (
              <tr>
                <td className="border border-slate-200 px-1.5 py-3 text-center text-slate-600" colSpan={7}>
                  第 {selected.period_no} 期尚無本期新增完成數量；累計完成請見估驗計價單。
                </td>
              </tr>
            )}
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
        {/* 這是第二條紅線的人審提醒(AI 可能誤配),原本卻是全頁最小最淡的字:
            11px/slate-400 在白紙上只有 2.6:1。升到 12px + amber-700 的警示語意 */}
        <p className="text-xs text-amber-700 mb-2 print:hidden">照片由 AI 依工項自動歸位,可能誤配;<b className="text-amber-800">列印/送審前請逐張確認</b>,點 ✕ 可將誤配或非佐證照片排除本包。</p>
        {!loaded ? (
          <div className="text-slate-500 text-[12px] py-4">照片載入中…</div>
        ) : inclCount === 0 ? (
          <div className="text-slate-600 text-[12px] py-4 border border-dashed border-slate-200 rounded px-3 print:border-0">
            {photoCount === 0
              ? '本期工項尚無已配對的佐證照片。可到「施工日誌 → AI 批次辨識照片」上傳現場照,AI 會自動配到對應工項,估驗時即自動歸入本包。'
              : '本期佐證照片已全部排除。'}
          </div>
        ) : (
          <div className="space-y-4">
            {leaves.filter((it) => incl(photosByItem[it.item_key]).length).map((it) => (
              <div key={it.item_key} className="break-inside-avoid">
                <div className="text-[12px] font-medium text-slate-700 mb-1">
                  <span className="text-slate-500 mr-1.5">{it.item_no}</span>{it.description}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {incl(photosByItem[it.item_key]).map((p) => {
                    // 施作區域(AI 從查驗黑板抄下的 photos.location)併進說明行:同一工項不同
                    // 樓層/區域的照片,光看說明分不出來,機關逐張核對時會卡在這裡。
                    // 舊照片沒有這欄(null)就退回只顯示說明,呈現完全不變。
                    const line = photoEvidenceLine(p)
                    return (
                      <figure key={p.id} className="relative border border-slate-200 rounded overflow-hidden break-inside-avoid group">
                        {/* 佐證照片本身就是送審內容,無 caption 時仍要說得出「這是哪個工項的照片」 */}
                        {p.url && <img src={p.url} alt={line || `${it.item_no} ${it.description} 佐證照片`} className="w-full h-28 object-cover" />}
                        {/* 手機沒有 hover:原本 opacity-0 讓這顆鈕在手機上看不見也點不到,
                            但上方文案正教使用者「點 ✕ 可排除」。手機常駐顯示並放大到 36px
                            (縮圖僅 h-28,44px 會蓋掉照片主體,列為已知例外);鍵盤 focus 亦顯形 */}
                        <button onClick={() => toggleExclude(p.id)} title="排除此張(不列入本包)"
                          aria-label={`排除照片 ${line || it.item_no} 不列入本包`}
                          className="print:hidden absolute top-1 right-1 w-6 h-6 max-sm:w-9 max-sm:h-9 rounded-full bg-black/55 text-white text-xs leading-none opacity-0 max-sm:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity">✕</button>
                        <figcaption className="text-[10px] text-slate-500 px-1.5 py-1 leading-tight">
                          {line || '—'}{p.taken_at ? ` · ${String(p.taken_at).slice(0, 10)}` : ''}
                        </figcaption>
                      </figure>
                    )
                  })}
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
        {/* 附件:施工日誌(旗艦承諾:紙本輸出自動夾附平時的施工日誌)*/}
        <label className="print:hidden flex items-center gap-2 mt-8 text-[12px] text-slate-600 select-none cursor-pointer max-sm:min-h-11">
          {/* 原生 checkbox 預設約 13px,是全頁最小的觸控目標 */}
          <input type="checkbox" className="w-5 h-5" checked={attachLogs} onChange={(e) => setAttachLogs(e.target.checked)} />
          夾附施工日誌（列印時自動附上本期估驗工項的貢獻日誌清單）
        </label>
        {attachLogs && (logAttachment.rows.length === 0 ? (
          <div className="print:hidden text-xs text-slate-600 mt-1">本期估驗工項尚無對應的施工日誌，列印時不會產生附件。</div>
        ) : (
          <div className="mt-4 print:break-before-page">
            <div className="text-slate-600 font-medium mb-1 flex items-center gap-1.5">
              <FileText size={14} className="text-[var(--blue)] print:hidden" aria-hidden />附件：施工日誌
            </div>
            <div className="text-xs text-slate-600 mb-1">
              本期估驗工項之貢獻施工日誌（由日誌數量自動勾稽，
              {logAttachment.total > LOG_CAP ? `共 ${logAttachment.total} 筆，列出最近 ${LOG_CAP} 筆` : `共 ${logAttachment.total} 筆`}
              ；完整日誌以「施工日誌」頁列印版為準）
            </div>
            <div className="overflow-x-auto -mx-1 print:overflow-visible print:mx-0">
            <table className="w-full border-collapse text-[11px] min-w-[560px] print:min-w-0">
              <thead>
                <tr className="bg-slate-100">
                  {['日期', '天氣', '本期相關工項與當日數量', '工作摘要'].map((h) => (
                    <th key={h} className="border border-slate-300 px-1.5 py-1 font-medium text-slate-600 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logAttachment.rows.map((r) => (
                  <tr key={r.date} className="break-inside-avoid align-top">
                    <td className="border border-slate-200 px-1.5 py-1 tabular-nums whitespace-nowrap text-slate-600">{r.date}</td>
                    <td className="border border-slate-200 px-1.5 py-1 whitespace-nowrap text-slate-500">{r.weather}</td>
                    <td className="border border-slate-200 px-1.5 py-1">
                      {r.items.map((it) => (
                        <div key={it.item_no} className="leading-snug">
                          <span className="text-slate-500 mr-1">{it.item_no}</span>{it.description}
                          <span className="tabular-nums text-slate-600 ml-1">{fmtQ(it.qty)} {it.unit}</span>
                        </div>
                      ))}
                    </td>
                    <td className="border border-slate-200 px-1.5 py-1 text-slate-600">{r.summary || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        ))}

        {/* 釐清句已提到頁首常駐,這裡只留保留款比例 */}
        <div className="text-[11px] text-slate-500 mt-3 print:hidden">
          保留款 {retPct}%。
        </div>
      </div>
    </div>
  )
}
