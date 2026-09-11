import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Stat, Badge, Surface, Button, PageHeader, SkeletonList, ErrorBanner, FilterChip, MobileReadOnlyNote, TreeToggle, THEAD_CLS } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../../components/confirm.jsx'
import { parsePccesXml } from '../../lib/parsePcces.js'
import { fmtAmount, fmtYi as yi } from '../../lib/format.js'

// 分項(母項)列結構上就沒有數量與單價,那是「本來沒有」不是「資料缺漏」,
// 整棵樹畫滿破折號反而讀不出哪裡真的缺值 → 這一頁明示留白。
const fmt = (n) => fmtAmount(n, { empty: '' })

// 標單工項（BOQ）— 工項樹來自 store：有真專案讀 Supabase work_items，否則範例 JSON。
export default function BOQ() {
  const { workItems: data, workItemsSource, workItemsError, retryWorkItems, importWorkItems, isSupabaseConfigured, currentProject, resetProjectBoq, dbMode, can } = useStore()
  const [expanded, setExpanded] = useState(() => new Set())
  const [onlyBillable, setOnlyBillable] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importErr, setImportErr] = useState('')
  const [resetErr, setResetErr] = useState('')   // 清空重匯被證據 guard 擋下時顯示原因
  const [parsed, setParsed] = useState(null)   // 上傳 XML 解析結果 { meta, items }
  const fileRef = useRef(null)

  useEffect(() => {
    if (data) setExpanded(new Set(data.items.filter((it) => it.depth === 1).map((it) => it.item_key)))
  }, [data])

  const onPickFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportErr(''); setParsed(null)
    try {
      const result = parsePccesXml(await file.text())
      setParsed(result)
    } catch (err) {
      setImportErr(friendlyError(err, '標單解析失敗'))
    }
    if (fileRef.current) fileRef.current.value = '' // 允許重選同檔
  }

  const runImport = async (parsedData) => {
    setImporting(true); setImportErr('')
    const { error } = await importWorkItems(parsedData)
    setImporting(false)
    if (error) setImportErr(friendlyError(error, '標單匯入失敗'))
    else setParsed(null)
  }
  // 真專案且標單為空（不再以範例冒充）→ 顯示匯入 onboarding
  const canImport = isSupabaseConfigured && currentProject && workItemsSource === 'empty'

  const childrenMap = useMemo(() => {
    const map = new Map()
    if (data) {
      for (const it of data.items) {
        const k = it.parent_key || '__root__'
        if (!map.has(k)) map.set(k, [])
        map.get(k).push(it)
      }
    }
    return map
  }, [data])

  // 手機章節摘要用的「這一章底下共幾項」。只數項數——金額一律取 it.amount(匯入時就算好的
  // 複價),UI 不重算任何金額(§1 三條不可退讓)。跟著「只看發包工程費」一起變,
  // 否則篩選後章節列的項數會與桌機表格對不上。
  const descendantCount = useMemo(() => {
    const counts = new Map()
    const walk = (it) => {
      const kids = (childrenMap.get(it.item_key) || []).filter((k) => !onlyBillable || k.is_billable)
      let n = kids.length
      for (const k of kids) n += walk(k)
      counts.set(it.item_key, n)
      return n
    }
    for (const r of (childrenMap.get('__root__') || [])) walk(r)
    return counts
  }, [childrenMap, onlyBillable])

  // 早退也保留 PageHeader:工作面分頁列(PageTabs)長在 PageHeader 裡,早退不帶頁首
  // 等於整條分頁列消失;平板(768–1279)與收合側欄的 icon rail 又不列子頁,
  // 使用者會被關在錯誤/載入畫面裡,換不到同工作面的其他頁。
  // meta/action 依賴 data,早退分支只給標題與 tagline。
  const header = <PageHeader title="標單工項" tagline="BOQ / WBS" />
  if (workItemsSource === 'error') {
    // 查詢失敗走 ErrorBanner(內建重試),不畫成空狀態——Empty 保留給真的 0 筆
    return (
      <div className="space-y-5">
        {header}
        <Card title="標單工項">
          <ErrorBanner msg={`標單工項讀取失敗：${friendlyError(workItemsError, '請稍後再試')}`} onRetry={retryWorkItems} />
        </Card>
      </div>
    )
  }
  // 載入中用骨架屏:Empty 自帶 inbox 圖示,擺在載入分支等於先跟使用者說「沒資料」
  if (!data) {
    return (
      <div className="space-y-5">
        {header}
        <Card bodyClass="p-5" aria-busy="true"><SkeletonList rows={3} label="載入標單工項中…" /></Card>
      </div>
    )
  }

  const { meta } = data
  const roots = (childrenMap.get('__root__') || []).filter((it) => !onlyBillable || it.is_billable)

  const toggle = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const renderRows = (items, level = 0) =>
    items.flatMap((it) => {
      const kids = (childrenMap.get(it.item_key) || []).filter((k) => !onlyBillable || k.is_billable)
      const hasKids = kids.length > 0
      const isOpen = expanded.has(it.item_key)
      const row = (
        <tr
          key={it.item_key}
          className={`border-b border-[var(--border-2)] hover:bg-[var(--surface-2)] ${
            hasKids ? 'bg-[var(--bg)] font-medium' : ''
          } ${!it.is_billable ? 'text-[var(--text-3)]' : ''}`}
        >
          {/* table-fixed 下改用「固定寬佔位 span」縮排:padding 縮排會吃掉欄寬,
              深層工項一縮排整欄就被推歪;佔位法讓縮排永不推移其他欄位 */}
          <td className="py-1.5 pl-5 pr-2">
            <span className="flex items-center gap-1 min-w-0">
              <span style={{ width: level * 18 }} className="shrink-0" aria-hidden="true" />
              {hasKids ? (
                // 形狀(16px 溝槽 / 手機 44 命中區 / 圖示)收斂在 TreeToggle,這裡只給語意
                <TreeToggle open={isOpen} label={`${isOpen ? '收合' : '展開'} ${it.item_no}`} onClick={() => toggle(it.item_key)} />
              ) : (
                <span className="w-4 shrink-0 inline-block" />
              )}
              <span className="text-[var(--text-3)] text-xs tabular-nums shrink-0">{it.item_no}</span>
              {/* 長工項名 ellipsis 截斷不換行(列高一致),完整名稱靠 title 提示 */}
              <span className={`truncate ${it.depth <= 2 ? 'text-[var(--text)]' : ''}`} title={it.description}>{it.description}</span>
              {/* 列內標記與頁尾說明同語言(Badge 五語意+purple),不再用裸色小字 */}
              {it.is_price_adjustable && <Badge color="purple" className="shrink-0">物調</Badge>}
              {it.item_kind === 'subtotal' && <Badge color="slate" className="shrink-0">合計</Badge>}
            </span>
          </td>
          <td className="text-right text-[var(--text-3)] text-xs px-2 whitespace-nowrap">{it.unit}</td>
          <td className="text-right text-[var(--text-2)] px-2 tabular-nums whitespace-nowrap">{fmt(it.quantity)}</td>
          <td className="text-right text-[var(--text-2)] px-2 tabular-nums whitespace-nowrap">{fmt(it.unit_price)}</td>
          <td className="text-right text-[var(--text)] px-2 pr-5 tabular-nums whitespace-nowrap">{fmt(it.amount)}</td>
        </tr>
      )
      if (hasKids && isOpen) return [row, ...renderRows(kids, level + 1)]
      return [row]
    })

  return (
    <div className="space-y-5">
      <PageHeader title="標單工項" tagline="BOQ / WBS"
        subtitle={`${meta.project_name}　·　${meta.owner_name}`}
        meta={meta.contract_no ? [{ k: '契約編號', v: meta.contract_no }] : []}
        action={dbMode && workItemsSource === 'db' && (can.edit || can.admin) && (
          // 清空重匯是破壞性寫入(連帶清掉估驗/進度/日誌/查驗/缺失):手機不渲染(§9.6)
          <Button variant="ghost" className="max-md:hidden" onClick={async () => {
            if (await appConfirm({ title: '重新匯入標單？', body: '會清空此專案的標單工項，以及相依的估驗、進度、施工日誌、查驗、缺失。', danger: true, confirmLabel: '清空重匯' })) {
              const { error } = await resetProjectBoq()
              setResetErr(error ? friendlyError(error, '清空失敗,資料未變動') : '')
            }
          }}><MSym name="refresh" size={15} />重新匯入標單</Button>
        )} />

      {/* 錯誤呈現全站單一形態(ErrorBanner);訊息字串是 chain4 e2e 合約,逐字保留 */}
      <ErrorBanner msg={resetErr ? `清空未執行,所有資料維持原狀：${resetErr}` : ''} onClose={() => setResetErr('')} />

      {canImport && (
        // 提醒橫幅與 ErrorBanner 同形(tint 底、無邊框)——語意文字色+/25 當邊框在深色模式不可預期
        <div className="bg-[var(--amber-tint)] rounded-lg px-4 py-3 space-y-2">
          <div className="text-sm text-[var(--amber-text)]">
            此專案<b>尚未匯入標單</b>。到「<Link to="/contract" className="font-medium underline">專案文件</Link>」把標單 XML 和契約等文件<b>一次上傳</b>,系統會自動匯入並整理。
          </div>
          <input ref={fileRef} type="file" accept=".xml,text/xml,application/xml" onChange={onPickFile} className="hidden" />
          {!parsed ? (
            <div className="flex items-center gap-3 flex-wrap">
              {/* Link 包 Button 是巢狀互動元素:內層退出 tab 序,focus outline 落在 Link 形狀上(比照 PrerequisiteEmptyState) */}
              <Link to="/contract" className="inline-flex rounded-full"><Button tabIndex={-1}>前往專案文件上傳</Button></Link>
              {/* 正式專案不提供「範例標單」:避免把示範用 3,262 工項灌進真實案(P1-11)。範例僅在 demo 站呈現。 */}
            </div>
          ) : (
            // 解析結果改白底 Surface:琥珀疊琥珀分不出層次,卡殼也不再自寫
            <Surface className="flex items-center gap-3 flex-wrap px-3 py-2">
              <div className="text-sm text-[var(--text)]">
                解析成功：<b>{parsed.meta.project_name || '（未命名）'}</b>&#x3000;·
                {fmt(parsed.meta.item_count)} 項工項，發包工程費 <b className="text-[var(--blue-text)]">{yi(parsed.meta.billable_total)}</b>
              </div>
              <Button onClick={() => runImport(parsed)} disabled={importing}>{importing ? '匯入中…' : `匯入 ${fmt(parsed.meta.item_count)} 工項`}</Button>
              <Button variant="ghost" size="sm" onClick={() => setParsed(null)}>取消</Button>
            </Surface>
          )}
          <ErrorBanner msg={importErr} onClose={() => setImportErr('')} />
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="發包工程費" value={yi(meta.billable_total)} sub={`NT$ ${fmt(meta.billable_total)}`} color="text-[var(--blue-text)]" />
        <Stat label="工項總數" value={fmt(meta.item_count)} sub="含分項與合計列" />
        <Stat label="末端計價工項" value={fmt(meta.leaf_count)} sub="估驗 / 數量管制單元" />
        <Stat label="資料來源"
          value={workItemsSource === 'db' ? 'Supabase' : workItemsSource === 'empty' ? '尚未匯入' : 'PCCES'}
          sub={workItemsSource === 'db' ? '已存入資料庫' : workItemsSource === 'empty' ? '請上傳標單 XML' : '範例（PCCES 匯入）'}
          color={workItemsSource === 'db' ? 'text-[var(--green-text)]' : 'text-[var(--text)]'} />
      </div>

      <Card
        title="工項階層"
        bodyClass="p-0"
        action={
          // 表格篩選走 FilterChip(aria-pressed 切換),不再用裸 checkbox——手機命中區由 chip 自帶 44px
          <FilterChip label="只看發包工程費" active={onlyBillable} onToggle={() => setOnlyBillable((v) => !v)} />
        }
      >
        {/* 斷點跟手機層對齊(BottomNav 是 md:hidden):640px 五欄樹在 390 要橫捲 1.6 個螢幕寬,
            而且標單樹的價值在「逐項對數字」——那是桌機的事。手機改列章節摘要(§9.6) */}
        <div className="overflow-x-auto max-md:hidden">
          {/* table-fixed + colgroup:欄寬固定,縮排/長名稱不再逐列推擠;
              min-w 保住名稱欄可讀寬度,窄螢幕交給外層 overflow-x-auto 捲動 */}
          <table className="w-full min-w-[640px] table-fixed text-sm">
            <colgroup>
              <col />{/* 項次 / 工項名稱:吃剩餘寬度 */}
              <col style={{ width: 64 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 104 }} />
              <col style={{ width: 118 }} />
            </colgroup>
            <thead>
              {/* 表頭字型層走共用 THEAD_CLS;p-0 卡的表格左右緣一律 pl-5/pr-5 與卡內距對齊 */}
              <tr className="border-b border-[var(--border)]">
                <th className={`${THEAD_CLS} text-left py-2 pl-5`}>項次 / 工項名稱</th>
                <th className={`${THEAD_CLS} text-right px-2`}>單位</th>
                <th className={`${THEAD_CLS} text-right px-2`}>數量</th>
                <th className={`${THEAD_CLS} text-right px-2`}>單價</th>
                <th className={`${THEAD_CLS} text-right px-2 pr-5`}>複價</th>
              </tr>
            </thead>
            <tbody>{renderRows(roots)}</tbody>
            <tfoot>
              {/* 合計取 meta.billable_total(發包工程費,匯入時已算好)——表格含參、肆非發包列,
                  逐列加總會與發包口徑混淆,所以標明口徑、不在前端重算 */}
              <tr className="bg-[var(--surface-2)] font-medium border-t border-[var(--border)]">
                <td className="py-2 pl-5 pr-2">合計（發包工程費）</td>
                <td />
                <td />
                <td />
                <td className="text-right px-2 pr-5 tabular-nums whitespace-nowrap">{fmt(meta.billable_total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* 手機:只到第一層(章)。標單合計=發包工程費已在上方 Stat 卡,這裡不重複;
            每章的複價直接取 it.amount,項數取 descendantCount,都不是在這裡算出來的。
            「非發包」沿用桌機表格的灰字語意,改成文字標記(顏色不可單獨承載語意,§2)。 */}
        <div className="md:hidden">
          <MobileReadOnlyNote of="各章金額與項數" className="px-5 py-3 border-b border-[var(--border-2)]" />
          <ul role="list" className="divide-y divide-[var(--border-2)]">
            {roots.map((it) => (
              <li key={it.item_key} className="px-5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-body font-medium min-w-0 truncate">
                    <span className="text-[var(--text-3)] tabular-nums mr-2">{it.item_no}</span>{it.description}
                  </span>
                  <span className="text-body font-medium tabular-nums shrink-0">{fmt(it.amount)}</span>
                </div>
                <p className="mt-0.5 text-footnote text-[var(--text-3)] tabular-nums">
                  {descendantCount.get(it.item_key) || 0} 項{it.is_billable ? '' : '・非發包'}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <p className="text-xs text-[var(--text-3)]">
        <Badge color="purple">物調</Badge> = 物價調整項（variablePrice）。發包工程費（壹、貳）為廠商估驗計價基礎；參、肆為非發包（間接成本 / 機關收入），灰色顯示。
      </p>
    </div>
  )
}
