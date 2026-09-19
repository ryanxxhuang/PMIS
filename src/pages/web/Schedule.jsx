// 逐工項排程(D-026 §4 退場,P5d):只剩唯讀歷史查閱與 CSV 匯出。
// 關鍵工項的計畫起迄、落後判定與維護(加入／起迄／移除)自 P5d 起在履約時程(契約重點)的同一條時間軸,
// 落後判定與這裡讀同一份 lib/keyWorkItems.js;資料仍是 item_schedules(不搬表、不刪列)。
// 本頁 hidden(navConfig),舊書籤與深連結依原 roles(廠商)仍可直達;沒有任何寫入控制項——
// 退場頁不得重新啟用寫入(入口與退場設計 §5),頁面移除寫入 UI,store 的寫入函式只由履約時程呼叫。
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { MSym } from '../../components/icons.jsx'
import { Card, Stat, Empty, Badge, PageHeader, MobileReadOnlyNote, THEAD_CLS, buttonClass } from '../../components/ui.jsx'
import { exportCsv, stamp } from '../../lib/exportCsv.js'
import { navLabel } from '../../lib/navConfig.js'
import { buildKeyWorkItems, keyWorkItemCounts } from '../../lib/keyWorkItems.js'

export default function Schedule() {
  const { workItems, adjustedItems = [], dbMode, demoMode, valuations = [], itemSchedules = {} } = useStore()

  // 關鍵工項列(計畫起迄＋最新估驗完成%＋狀態):與履約時程同一份推導
  const rows = useMemo(() => (workItems ? buildKeyWorkItems({ itemSchedules, adjustedItems, valuations }) : []), [workItems, itemSchedules, adjustedItems, valuations])

  // 手機摘要只列「還要處理的」:落後 + 進行中(已完成/未開始不進手機清單,見下方註解)。
  // 排序沿用 rows(計畫起日),落後排在進行中之前才是「先看最急的」。
  const active = useMemo(
    () => rows.filter((r) => r.state.key === 'late' || r.state.key === 'doing')
      .sort((a, b) => (a.state.key === b.state.key ? 0 : a.state.key === 'late' ? -1 : 1)),
    [rows],
  )
  const counts = useMemo(() => keyWorkItemCounts(rows), [rows])
  const timelineLabel = navLabel('/requirements')

  // 退場說明放在最上面:進到這一頁的人多半是循舊書籤或深連結來的,第一眼就要知道
  // 「這裡不能再改」與「去哪裡改」。不用 ErrorBanner(這不是錯誤)。
  const note = (
    <p role="note" className="rounded-lg px-3 py-2 text-footnote bg-[var(--amber-tint)] text-[var(--amber-text)]">
      逐工項排程已退出新作業（產品收斂 D-026）。關鍵工項的計畫起迄與落後追蹤改在
      「<Link to="/requirements" className="underline">{timelineLabel}</Link>」的履約時程維護；本頁只作歷史查閱與 CSV 匯出。
    </p>
  )

  // 早退也保留 PageHeader:工作面分頁列(PageTabs)長在 PageHeader 裡,早退不帶頁首
  // 等於整條分頁列消失;平板(768–1279)與收合側欄的 icon rail 又不列子頁,
  // 使用者會被關在空狀態畫面裡,換不到同工作面的其他頁。
  if (!dbMode && !demoMode) {
    return (
      <div className="space-y-5">
        <PageHeader title="逐工項排程" tagline="歷史查閱" subtitle="關鍵工項計畫起迄的歷史查閱；維護改在履約時程" />
        {note}
        <Card title="逐工項排程"><Empty>此頁需真實專案（已匯入標單）。請先到「專案文件」一次上傳標單 XML。</Empty></Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader title="逐工項排程" tagline="歷史查閱" subtitle="關鍵工項計畫起迄的歷史查閱；維護改在履約時程" />

      {note}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="已排程工項" value={counts.total} sub="項" color="text-[var(--text)]" />
        <Stat label="落後" value={counts.late} sub="項" color={counts.late > 0 ? 'text-[var(--red-text)]' : 'text-[var(--green-text)]'} />
        <Stat label="進行中" value={counts.doing} sub="項" color="text-[var(--blue-text)]" />
        <Stat label="已完成" value={counts.done} sub="項" color="text-[var(--green-text)]" />
      </div>

      <Card title={`排程清單（${rows.length}）`} bodyClass="p-0" action={rows.length > 0 && (
        <button onClick={() => exportCsv(`逐工項排程_${stamp()}`, rows, [
          { label: '項次', get: (r) => r.it.item_no || '' }, { label: '工項', get: (r) => r.it.description || r.key },
          { label: '單位', get: (r) => r.it.unit || '' }, { label: '計畫起', get: (r) => r.sch.planned_start || '' },
          { label: '計畫迄', get: (r) => r.sch.planned_finish || '' }, { label: '完成%', get: (r) => r.pct.toFixed(1) },
          { label: '狀態', get: (r) => r.state.label },
        ])} className="inline-flex items-center gap-1 text-sm font-medium text-[var(--blue-text)] hover:underline max-md:min-h-11"><MSym name="download" size={16} />CSV</button>
      )}>
        {rows.length === 0 ? (
          <Empty>尚未設定任何關鍵工項。到「{timelineLabel}」的履約時程加入關鍵工項並設定計畫起迄。</Empty>
        ) : (
          <>
          {/* 720px 六欄表在 390 要橫捲近兩個螢幕寬,手機改渲染唯讀摘要(規範 §9.6) */}
          <div className="overflow-x-auto max-md:hidden">
            <table className="w-full text-sm min-w-[720px]" aria-label="逐工項排程">
              <thead>
                {/* 表頭字型層走共用 THEAD_CLS(對齊/內距各表自決) */}
                <tr className="border-b border-[var(--border)]">
                  <th className={`${THEAD_CLS} text-left py-2 pl-5`}>工項</th>
                  <th className={`${THEAD_CLS} text-left px-2`}>計畫起</th>
                  <th className={`${THEAD_CLS} text-left px-2`}>計畫迄</th>
                  <th className={`${THEAD_CLS} text-right px-2`}>完成%</th>
                  <th className={`${THEAD_CLS} text-left px-2`}>狀態</th>
                  <th className={`${THEAD_CLS} text-right px-2 pr-5`}>維護</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-[var(--border-2)] hover:bg-[var(--surface-2)]">
                    <td className="py-2 pl-5 min-w-[200px]"><span className="text-[var(--text-3)] text-xs mr-2 tabular-nums">{r.it.item_no}</span>{r.it.description || r.key}</td>
                    <td className="px-2 tabular-nums">{r.sch.planned_start || '未定'}</td>
                    <td className="px-2 tabular-nums">{r.sch.planned_finish || '未定'}</td>
                    <td className="px-2 text-right tabular-nums">{r.pct.toFixed(1)}%</td>
                    <td className="px-2"><Badge color={r.state.tone}>{r.state.label}</Badge></td>
                    <td className="px-2 pr-5 text-right">
                      {/* 維護改在履約時程該項關鍵工項的詳情(?item= 直達) */}
                      <Link to={`/requirements?item=${encodeURIComponent(r.key)}`} className={buttonClass('ghost', 'sm')}>到履約時程</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 手機:只列「落後 / 進行中」。整體進度(已排程/落後/進行中/已完成)在上方 Stat 卡,
              這裡不重複;未開始與已完成的工項在工地現場不需要逐項確認,列出來只是把
              真正要處理的那幾項推到畫面外(§1 判準二)。完成% 與狀態沿用 rows 已算好的值。 */}
          <div className="md:hidden">
            <MobileReadOnlyNote of="落後與進行中工項" className="px-5 py-3 border-b border-[var(--border-2)]" />
            {active.length === 0 ? (
              <p className="px-5 py-3 text-body text-[var(--text-3)]">目前沒有落後或進行中的工項（其餘為未開始或已完成，見上方統計）。</p>
            ) : (
              <ul role="list" className="divide-y divide-[var(--border-2)]">
                {active.map((r) => (
                  <li key={r.key} className="px-5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-body font-medium min-w-0 truncate">{r.it.description || r.key}</span>
                      <span className="text-body font-medium tabular-nums shrink-0">{r.pct.toFixed(1)}%</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <Badge color={r.state.tone}>{r.state.label}</Badge>
                      <span className="text-footnote text-[var(--text-3)] tabular-nums">
                        計畫 {r.sch.planned_start || '未定'} ～ {r.sch.planned_finish || '未定'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          </>
        )}
      </Card>

      <p className="text-xs text-[var(--text-3)]">
        完成% = 最新一期估驗的累計完成數量 ÷ 契約數量。今天超過計畫迄且未完成 → 落後；今天在計畫起迄之間 → 進行中。與履約時程的關鍵工項同一條規則。
      </p>
    </div>
  )
}
