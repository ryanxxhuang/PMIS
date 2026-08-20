import { useMemo, useState } from 'react'
import { useStore } from '../../store.jsx'
import { Card, Stat, Empty, PageHeader, ErrorBanner, SkeletonList } from '../../components/ui.jsx'
import { appConfirm } from '../../components/confirm.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { isPayable, paymentStatus, summarizePayments } from '../../lib/payments.js'

// Math.round(-0.4)=-0:正規化,避免顯示「-0」(R3 P2-01)
const money = (n) => (n == null || isNaN(n) ? '—' : (Math.round(n) === 0 ? 0 : Math.round(n)).toLocaleString('en-US'))
// paymentStatus 只回語意色名,色票對應留在頁面(lib 不綁 Tailwind class)
const TONE_BADGE = {
  green: 'bg-[var(--green-tint)] text-[var(--green-text)]',
  amber: 'bg-[var(--amber-tint)] text-[var(--amber-text)]',
  blue: 'bg-[var(--blue-tint)] text-[var(--blue-text)]',
  slate: 'bg-[var(--slate-tint)] text-[var(--slate-text)]',
}
// 手機時間線只留月日:窄螢幕一行要塞下期別、金額與狀態,完整日期在桌面表格
const shortDate = (iso) => (iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}` : '')
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function Payments() {
  const { project, workItems: data, valuations, updateValuationPayment, isSupabaseConfigured, currentProject, workItemsSource,
    adjustedItems } = useStore()
  const [errMsg, setErrMsg] = useState('')
  // 請款/收款欄位寫入失敗必須讓使用者看到(DB-first,失敗=UI 不變)
  const onPay = async (id, patch) => {
    setErrMsg('')
    const { error } = await updateValuationPayment(id, patch)
    if (error) setErrMsg(`未寫入：${error.message}`)
  }

  // 用「已核准變更套回後」的工項計價(B-02):否則核准追加減後與估驗頁金額分裂
  const tree = useMemo(() => (data ? buildBillableTree(adjustedItems) : { roots: [], childrenMap: new Map() }), [data, adjustedItems])

  // 逐期:累計估驗金額 → 本期估驗 = 本期累計 − 前期累計;本期保留款、本期應領
  const rows = useMemo(() => {
    if (!data) return []
    let prev = 0
    return [...valuations].sort((a, b) => a.period_no - b.period_no).map((v) => {
      const cum = totalCumAmount(tree.roots, buildCumMap(tree.roots, tree.childrenMap, v.items))
      const thisAmt = cum - prev; prev = cum
      const retention = thisAmt * (v.retention_pct || 0) / 100
      return { v, cum, thisAmt, retention, net: thisAmt - retention }
    })
  }, [data, valuations, tree])

  // 統計卡只彙總已核定期別(ISSUE-13):逐期表把未核定的期別鎖住不讓登錄金流,
  // 卡片卻把它們算進累計應領,兩邊口徑不一致會讓人以為系統少收或多算了錢。
  const sum = useMemo(() => summarizePayments(rows), [rows])
  // 未核定期數提示只在有草稿/監造審核期時出現,避免正常情況多一行雜訊
  const draftNote = sum.draftCount > 0 ? `另有未核定 ${sum.draftCount} 期未計入` : null

  // 載入中用骨架屏:Empty 自帶 inbox 圖示,擺在載入分支等於先跟使用者說「沒資料」
  if (!data) return <Card bodyClass="p-5" aria-busy="true"><SkeletonList rows={3} label="載入請款資料中…" /></Card>
  if (isSupabaseConfigured && currentProject && workItemsSource !== 'db') {
    return <Card title="請款收款"><Empty>此專案的標單尚未匯入資料庫,且需有估驗資料才能彙整請款。請先到「專案文件」一次上傳標單 XML。</Empty></Card>
  }

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <PageHeader title="請款收款" tagline="現金流" subtitle="每期估驗 → 本期應領、保留款、收款追蹤" />
      </div>

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 四張卡一律只計已核定期別;未核定期數寫在第一張卡的小字,說明差額從哪來 */}
        <Stat label="已核定累計應領(扣保留款)" value={money(sum.net)} sub={draftNote ? `NT$・${draftNote}` : 'NT$'} color="text-[var(--text)]" />
        {/* 已收=有登錄實收金額才算,只填收款日不計入(與列狀態「實收未登錄」同一口徑) */}
        <Stat label="累計已收(依實收登錄)" value={money(sum.received)} sub="NT$" color="text-[var(--blue-text)]" />
        {/* 負未收=實收超過累計應領,屬資料異常而非正常 KPI(P1-07) */}
        <Stat label="未收款" value={money(sum.unreceived)} sub={sum.unreceived < 0 ? '實收超過應領,請查核' : 'NT$'}
          color={sum.unreceived < 0 ? 'text-[var(--red-text)]' : sum.unreceived > 0 ? 'text-[var(--amber-text)]' : 'text-[var(--green-text)]'} />
        <Stat label="累計保留款(待退)" value={money(sum.retention)} sub="完工後請領" color="text-[var(--text)]" />
      </div>

      <Card title="逐期請款 / 收款" action={rows.length > 0 && (
        <button onClick={() => exportCsv(`請款收款_${stamp()}`, rows, [
          { label: '期', get: (r) => `第${r.v.period_no}期` }, { label: '估驗日', get: (r) => r.v.valuation_date || '' },
          { label: '累計估驗', get: (r) => Math.round(r.cum) }, { label: '本期估驗', get: (r) => Math.round(r.thisAmt) },
          { label: '本期保留款', get: (r) => Math.round(r.retention) }, { label: '本期應領', get: (r) => Math.round(r.net) },
          { label: '請款日', get: (r) => r.v.invoice_date || '' }, { label: '收款日', get: (r) => r.v.paid_date || '' },
          { label: '實收', get: (r) => r.v.paid_amount ?? '' }, { label: '狀態', get: (r) => paymentStatus(r.v).label },
        ])} className="text-sm font-medium text-[var(--blue)] hover:underline">⬇ 匯出 CSV</button>
      )}>
        {rows.length === 0 ? (
          <Empty>尚無估驗期。請先到「估驗計價」建立估驗,這裡才會列出每期請款。</Empty>
        ) : (
          <>
          <div className="overflow-x-auto -mx-4 -my-4 max-sm:hidden">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                  <th className="text-left font-medium py-2 pl-4">期</th>
                  <th className="text-left font-medium px-2">估驗日</th>
                  <th className="text-right font-medium px-2">累計估驗</th>
                  <th className="text-right font-medium px-2">本期估驗</th>
                  <th className="text-right font-medium px-2">本期保留款</th>
                  <th className="text-right font-medium px-2">本期應領</th>
                  <th className="text-left font-medium px-2">請款日</th>
                  <th className="text-left font-medium px-2">收款日</th>
                  <th className="text-right font-medium px-2">實收</th>
                  <th className="text-left font-medium px-2 pr-4">狀態</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ v, cum, thisAmt, retention, net }) => {
                  // 金流閘門:未核定的期別鎖定請款/收款(DB trigger 同規則強制)
                  const approved = isPayable(v.status)
                  const lockTip = approved ? undefined : '估驗尚未核定,不可登錄請款/收款'
                  // 流程順序(R4 P1-02,DB trigger 同規則):收款日需先有請款日、實收需先有收款日
                  const canPaidDate = approved && !!v.invoice_date
                  const canPaidAmount = approved && !!v.paid_date
                  const st = paymentStatus(v)
                  return (
                    <tr key={v.id} className="border-b border-[var(--border-2)] hover:bg-[var(--surface-2)]">
                      <td className="py-1.5 pl-4 tabular-nums">第 {v.period_no} 期</td>
                      <td className="px-2 text-[var(--text-3)] tabular-nums whitespace-nowrap">{v.valuation_date || '—'}</td>
                      <td className="px-2 text-right tabular-nums">{money(cum)}</td>
                      <td className="px-2 text-right tabular-nums">{money(thisAmt)}</td>
                      <td className="px-2 text-right tabular-nums text-[var(--text-2)]">{money(retention)}</td>
                      <td className="px-2 text-right tabular-nums font-medium">{money(net)}</td>
                      <td className="px-2">
                        {/* onBlur 才寫入:避免打字打到一半就把半成品(或空值)存進 DB */}
                        <input type="date" key={`inv-${v.id}-${v.invoice_date || ''}`} defaultValue={v.invoice_date || ''}
                          disabled={!approved} title={lockTip} aria-label={`第 ${v.period_no} 期請款日`} max={todayIso()}
                          onBlur={(e) => { const d = e.target.value || null; if (d === (v.invoice_date || null)) return; if (d && d > todayIso()) { setErrMsg(`請款日不可晚於今日（輸入了 ${d}）`); return } onPay(v.id, { invoice_date: d }) }}
                          className="border border-[var(--border)] rounded px-1.5 py-0.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed" />
                      </td>
                      <td className="px-2">
                        <input type="date" key={`paid-${v.id}-${v.paid_date || ''}`} defaultValue={v.paid_date || ''}
                          disabled={!canPaidDate} title={approved ? (canPaidDate ? undefined : '請先填請款日') : lockTip}
                          aria-label={`第 ${v.period_no} 期收款日`} max={todayIso()} min={v.invoice_date || undefined}
                          onBlur={(e) => { const d = e.target.value || null; if (d === (v.paid_date || null)) return; if (d && d > todayIso()) { setErrMsg(`收款日不可晚於今日（輸入了 ${d}）`); return } if (d && v.invoice_date && d < v.invoice_date) { setErrMsg(`收款日不可早於請款日 ${v.invoice_date}`); return } onPay(v.id, { paid_date: d }) }}
                          className="border border-[var(--border)] rounded px-1.5 py-0.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed" />
                      </td>
                      <td className="px-2 text-right">
                        {/* 平板(≥640px)也會用觸控填這欄:inputMode 讓數字鍵盤直接出來。
                            placeholder 不放本期應領金額(ISSUE-13):灰字數字看起來像已登錄,
                            承辦會以為填過了;應領金額改掛 title,滑鼠移上去才查得到。 */}
                        <input type="number" min="0" step="any" inputMode="decimal" key={`amt-${v.id}-${v.paid_amount ?? ''}`} defaultValue={v.paid_amount ?? ''}
                          placeholder="輸入實收金額" disabled={!canPaidAmount}
                          title={approved ? (canPaidAmount ? `本期應領 ${money(net)}` : '請先填收款日') : lockTip} aria-label={`第 ${v.period_no} 期實收金額`}
                          onBlur={async (e) => {
                            // 早退路徑一律把輸入框拉回 store 現值(ISSUE-13):否則打錯字或取消二次確認後,
                            // 未寫入 DB 的數字仍留在畫面上,下一位看到的是假的已登錄金額。
                            const el = e.target
                            const reset = () => { el.value = v.paid_amount ?? '' }
                            const n = parseFloat(el.value); const val = isNaN(n) ? null : n
                            if (val === (v.paid_amount ?? null)) { reset(); return }
                            // 超過本期應領=可疑輸入,二次確認(R3 P1-04:曾接受 15 位數實收,未收款變巨額負值)
                            if (val != null && val > Math.round(net) && !(await appConfirm({
                              title: `實收 ${money(val)} 超過本期應領 ${money(net)}`,
                              body: '確定登錄這個金額?(溢收/合併撥付請於備註說明)', danger: true, confirmLabel: '確認登錄',
                            }))) { reset(); return }
                            onPay(v.id, { paid_amount: val })
                          }}
                          className="w-28 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-xs tabular-nums disabled:opacity-40 disabled:cursor-not-allowed" />
                      </td>
                      <td className="px-2 pr-4">
                        <span className="inline-flex items-center gap-1.5">
                          {approved
                            ? <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${TONE_BADGE[st.tone]}`}
                                title={st.key === 'paid_unrecorded' ? '已登錄收款日但缺實收金額,累計已收不會計入,請補登' : undefined}>{st.label}</span>
                            : <span className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap bg-[var(--amber-tint)] text-[var(--amber-text)]" title={lockTip}>{v.status}·未核定</span>}
                          {/* 一鍵清空三欄(單一寫入):退回核定前的正規動線(R3 P1-01) */}
                          {approved && (v.invoice_date || v.paid_date || v.paid_amount != null) && (
                            <button onClick={async () => {
                              if (!(await appConfirm({ title: `清空第 ${v.period_no} 期請款/收款資料？`, body: '退回核定前需先清空金流欄位;清空後可重新登錄。', danger: true, confirmLabel: '清空' }))) return
                              onPay(v.id, { invoice_date: null, paid_date: null, paid_amount: null })
                            }} className="text-[11px] text-[var(--text-3)] hover:text-[var(--red-text)] underline whitespace-nowrap" aria-label={`清空第 ${v.period_no} 期金流`}>清空</button>
                          )}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* 手機:唯讀期別時間線。桌面表格 min-w 820px 在手機只能橫向捲,實際讀不了;
              金流登錄仍只留在桌面(W8-0 §7),所以這裡刻意不放任何輸入或寫入路徑。 */}
          <div className="sm:hidden -mx-4 -my-4">
            <ul className="divide-y divide-[var(--border-2)]">
              {rows.map(({ v, net }) => {
                // 與表格同一條核定閘門:未核定期別在桌面是鎖定欄位,在手機只說明狀態
                const approved = isPayable(v.status)
                // 實收超過本期應領=資料異常(非正常 KPI),與 Stat「未收款」轉紅同一條判斷
                const over = (v.paid_amount || 0) > Math.round(net)
                // 收款日有、實收沒登錄:與桌面列狀態同一口徑,用琥珀提醒回桌面補登
                const unrecorded = approved && v.paid_date && v.paid_amount == null
                return (
                  <li key={v.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">第 {v.period_no} 期</span>
                      <span className="text-sm font-medium tabular-nums">NT$ {money(net)}</span>
                    </div>
                    {/* 這行的字串刻意避開「已收款」「已請款」「待請款」等桌面徽章用字:
                        手機清單雖被 sm:hidden 藏起來仍在 DOM 裡,同字串會讓 e2e 的文字定位一次命中兩個節點 */}
                    <p className={`mt-0.5 text-xs ${over ? 'text-[var(--red-text)]' : unrecorded ? 'text-[var(--amber-text)]' : 'text-[var(--text-3)]'}`}>
                      {!approved
                        ? `狀態：${v.status}（未核定）`
                        : v.paid_date
                          ? v.paid_amount != null
                            ? `收款完成（${shortDate(v.paid_date)}，實收 NT$ ${money(v.paid_amount)}）${over ? '，超過本期應領,請查核' : ''}`
                            : `收款登錄未完成（${shortDate(v.paid_date)} 入帳,實收金額待補登）`
                          : v.invoice_date
                            ? `請款中（${shortDate(v.invoice_date)} 請款,等待撥款）`
                            : '尚未請款'}
                    </p>
                  </li>
                )
              })}
            </ul>
            <div className="px-4 py-3 border-t border-[var(--border-2)] text-xs text-[var(--text-3)]">
              完整登錄請款日、收款日與實收金額，請使用桌面版。
            </div>
          </div>
          </>
        )}
      </Card>

      {/* 說明文字壓到三句(ISSUE-12):鎖定規則、順序限制已由欄位 disabled 與提示講過,不再重述 */}
      <p className="text-xs text-[var(--text-3)]">
        本期估驗 = 本期累計估驗 − 前期累計;本期應領 = 本期估驗 − 本期保留款,保留款累計於完工後請領。
        「請款日」由廠商送出請款時登錄,「收款日/實收」於撥款入帳後依入帳憑證登錄(廠商記帳或機關承辦皆可)。
        上方統計卡只計已核定期別,且「累計已收」以實收金額為準——只填收款日不算入帳。
      </p>
    </div>
  )
}
