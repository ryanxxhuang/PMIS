import { useMemo, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Empty, PageHeader, Button, Badge, Dot } from '../../components/ui.jsx'
import { ListDetailLayout, SearchField, StatusChip, MetaGrid } from '../../components/listDetail.jsx'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { plannedPctNow } from '../../lib/progressPlan.js'
import { latestValuationAt } from '../../lib/progressAsOf.js'
import { auditProject } from '../../lib/riskAudit.js'
import { buildValuationChecks } from '../../lib/valuationChecks.js'

// 退場(D-026 §4,P1b):獨立的風險稽核工作區不再是主入口(hidden、僅機關可深連結)。估驗所需的
// 勾稽檢核已移入估驗計價頁逐期顯示(lib/valuationChecks.js 兩頁共用同一份組裝與引擎);契約/變更/
// 進度三個面向的檢核表項目暫留這裡唯讀查閱,承接到履約時程後隨頁面一起移除(P5d/P6b)。
// 這一頁本來就沒有任何業務寫入(只提醒、不處置);AI 稽核意見(audit.summary)已於 P6c 退場——
// 這裡不再呼叫任何 AI,發現原樣呈現給人(DB 開關 20260919130400,閘門對舊呼叫回 403)。
//
// 版面:改版前是「總覽色塊＋檢核表卡＋勾稽鏈卡」直排——同一種東西(稽核項目)被來源切成
// 兩張卡,判定依據被塞在一行 text-xs 裡。現在是一份清單(檢核表＋勾稽發現混排,嚴重度高的
// 在前)＋詳情欄:判定依據、對應工項、來源單據都貼在該項底下(規範 §0 疊合版、判準第 6 條
// 「這個數字來自哪裡?點得進去嗎?」)。判定全由確定性引擎(riskAudit.js/integrityAudit.js)
// 給,這一頁只排版與呈現。
//
// 色票走 Badge/Dot 的 color key,不再是 inline style 的 var() 字串:狀態顏色的單一真相
// 是 ui.jsx 的五語意色票。na=資料不足未評估,不算通過(riskAudit.js 最小證據原則)。
const ST = {
  risk: { icon: 'gpp_maybe', color: 'red', label: '風險' },
  warn: { icon: 'warning', color: 'amber', label: '注意' },
  na: { icon: 'help', color: 'slate', label: '未評估' },
  pass: { icon: 'check_circle', color: 'green', label: '通過' },
}
// 嚴重度快篩的順序=清單排序:機關開頁第一眼看到的是最該複查的那一項
const SEVERITIES = ['risk', 'warn', 'na', 'pass']
const RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]))
// 兩個來源:檢核表(riskAudit.js,五個面向各一項)與文件勾稽鏈(integrityAudit.js,逐工項對帳)
const SOURCE_LABEL = { check: '自動檢核', chain: '文件勾稽' }
// 來源單據:勾稽發現自帶 route;檢核表依面向對到該面向的工作面(判準第 6 條:金額、
// 期限、判定都要能追到來源)。這只是連結對照,不是判定邏輯。
const CHECK_ROUTE = { 估驗: '/valuation', 變更: '/change-orders', 品質: '/quality', 契約: '/deadlines', 進度: '/progress' }
const ROUTE_LABEL = { '/valuation': '估驗計價', '/change-orders': '變更設計', '/quality': '品質查驗', '/deadlines': '期限追蹤', '/progress': '進度管制' }
// 退場說明:進到這一頁的人多半循舊書籤或 Agent 提示連結而來,第一眼要知道「檢核已在估驗流程裡」。
const RETIRED_NOTE = '獨立風險稽核工作區已退場（產品收斂 D-026）：估驗勾稽檢核已在「估驗計價」逐期顯示，這裡只保留唯讀查閱；契約、變更與進度面向由履約時程承接後一併移除。'
const DEFAULT_FILTERS = { q: '', status: '' }

// 兩個引擎的 detail 都是「依據說明:對應項目、對應項目 等 N 項。」的形狀(整段文字,
// 沒有結構化工項欄位)。在第一個冒號切開,前半是判定依據、後半是對應工項/日期/缺失。
// 這是呈現層的切法,不動引擎;沒有冒號的(如「目前無待核定變更。」)整段當依據。
const splitDetail = (detail = '') => {
  const m = detail.match(/[:：]/)
  if (!m) return { basis: detail, items: '' }
  return { basis: detail.slice(0, m.index), items: detail.slice(m.index + 1).replace(/。$/, '') }
}

export default function RiskAudit() {
  const { project, workItems, valuations, progressPlan, changeOrders, defects, obligations,
    siteLogs, inspections, testSamples, demoMode, workItemsSource,
    adjustedItems, revisedTotal, currentProject } = useStore()
  const imported = workItemsSource === 'db' || demoMode
  const navigate = useNavigate()
  const TODAY = new Date() // 每次 render 取(B-11):長開分頁的「今天」不可凍結在開頁那天
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const searchRef = useRef(null)

  // 財務單一真相層(B-02):稽核分母與估驗/進度頁一致(含已核准變更)
  const { roots, childrenMap } = useMemo(
    () => (workItems ? buildBillableTree(adjustedItems) : { roots: [], childrenMap: new Map() }),
    [workItems, adjustedItems],
  )
  const billableTotal = workItems ? revisedTotal : 0

  // 逐期「本期估驗」= 累計差
  const periodAmounts = useMemo(() => {
    if (!workItems) return []
    let prev = 0
    return [...valuations].sort((a, b) => a.period_no - b.period_no).map((v) => {
      const cum = totalCumAmount(roots, buildCumMap(roots, childrenMap, v))
      const thisAmt = cum - prev; prev = cum
      return { period_no: v.period_no, thisAmt }
    })
  }, [workItems, valuations, roots, childrenMap])

  const latestVal = latestValuationAt(valuations, TODAY) // 截至今天、狀態不論(D-024)
  const actualPct = useMemo(() => {
    if (!latestVal || !billableTotal) return 0
    return (totalCumAmount(roots, buildCumMap(roots, childrenMap, latestVal)) / billableTotal) * 100
  }, [latestVal, roots, childrenMap, billableTotal])
  const plannedNow = plannedPctNow(progressPlan, TODAY)

  const anchors = { award_date: project?.award_date, notice_date: project?.notice_date, commencement_date: project?.commencement_date, end_date: project?.end_date }
  const { checks, summary } = useMemo(() => auditProject({
    periodAmounts, changeOrders, defects, obligations, anchors, billableTotal,
    progress: { actualPct, plannedPct: plannedNow },
  }, TODAY), [periodAmounts, changeOrders, defects, obligations, billableTotal, actualPct, plannedNow]) // eslint-disable-line react-hooks/exhaustive-deps

  // 文件勾稽鏈:逐工項跨文件對帳(全確定性),檢核最新一期。組裝與估驗頁共用
  // lib/valuationChecks.js(D-026 P1b:估驗所需檢核已移入估驗流程,估驗頁逐期顯示同一份發現)。
  const integrity = useMemo(() => {
    if (!workItems) return { findings: [], summary: { risk: 0, warn: 0, checked: 0 } }
    const latest = [...valuations].sort((a, b) => a.period_no - b.period_no).slice(-1)[0]
    return buildValuationChecks({ adjustedItems, childrenMap, siteLogs, billedItems: latest?.items, inspections, testSamples })
  }, [workItems, adjustedItems, childrenMap, siteLogs, valuations, inspections, testSamples])

  // 一份清單:檢核表(每個面向恰一項,id 以面向命名)＋勾稽發現(每種對帳至多一項,
  // id 以標題冒號前的固定字串命名)。兩者 id 在資料變動下都穩定,深連結 ?finding= 才有意義。
  // 嚴重度高的在前(風險→注意→未評估→通過),同級維持引擎順序。
  const rows = useMemo(() => [
    ...checks.map((c) => ({ ...c, id: `check-${c.category}`, source: 'check', route: CHECK_ROUTE[c.category] })),
    ...integrity.findings.map((f) => ({ ...f, id: `chain-${f.title.split(/[:：]/)[0]}`, source: 'chain' })),
  ].sort((a, b) => RANK[a.status] - RANK[b.status]), [checks, integrity])

  // 件數走全體(不受搜尋影響):chip 上的數字是「本案有幾項是這個嚴重度」,0 也保留——
  // 「0 項風險」本身就是機關要的資訊
  const counts = useMemo(
    () => Object.fromEntries(SEVERITIES.map((s) => [s, rows.filter((r) => r.status === s).length])),
    [rows],
  )
  // 目前畫面上的清單:嚴重度 AND 關鍵字(標題/依據/面向)
  const ordered = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return rows
      .filter((r) => !filters.status || r.status === filters.status)
      .filter((r) => !q || [r.title, r.detail, r.category].some((v) => (v || '').toLowerCase().includes(q)))
  }, [rows, filters])
  const anyFilter = filters.q.trim() !== '' || filters.status !== ''

  // 選取/深連結(?finding=)/切案重置/初次自動選取:共用殼 hook。預設選排序後第一項
  // (=最嚴重的那一項),開頁就看到最該複查的事。
  const pid = currentProject?.project_id
  const { selectedId, detailOpen, select, closeDetail } = useListDetailPane({
    param: 'finding', idPrefix: 'aud-',
    scope: `${pid}`,
    ready: imported && rows.length > 0, rows,
    pickDefault: () => ordered[0]?.id,
    onReset: () => setFilters(DEFAULT_FILTERS),
  })
  // 篩選後選中項被篩掉:右欄內容保留(與 /safety 同),清單中只是沒有高亮列
  const selected = rows.find((r) => r.id === selectedId) || null
  useListKeyboardNav({ ordered, selectedId, select, idPrefix: 'aud-', searchRef })

  // 早退也保留 PageHeader:頁首與工作面分頁不該因為「還沒匯入標單」整組消失
  if (!imported) {
    return (
      <div className="space-y-5">
        <PageHeader title="風險稽核" tagline="唯讀查閱" subtitle="系統化檢核估驗、變更、品質、契約與進度的異常樣態" />
        <p role="note" className="rounded-lg px-3 py-2 text-footnote bg-[var(--amber-tint)] text-[var(--amber-text)]">{RETIRED_NOTE}</p>
        <Card bodyClass="p-0"><Empty>此專案尚未匯入標單，無法稽核。請先到「專案文件」一次上傳標單 XML。</Empty></Card>
      </div>
    )
  }

  // 整案結論一句話(改版前總覽色塊的內容):風險/注意各幾項,或未發現異常(含未評估件數)
  const totRisk = counts.risk, totWarn = counts.warn
  const verdict = totRisk ? `${totRisk} 項風險 · ${totWarn} 項注意`
    : totWarn ? `${totWarn} 項需注意`
    : summary.na ? `未發現異常（${summary.na} 項資料不足未評估）` : '本案未發現明顯異常'

  // ── 詳情欄:狀態列 / 標題與 meta / 判定依據 / 對應工項 / 動作列。
  // region 以標題命名:報讀器走地標時直接聽到「估驗超前施工日誌:3 項工項 詳情」,
  // e2e 也用同一個名字確認詳情欄正在顯示哪一項。
  let detailBody = null
  if (selected) {
    const r = selected
    const s = ST[r.status]
    const { basis, items } = splitDetail(r.detail)
    detailBody = (
      <section aria-label={`${r.title} 詳情`}>
        {/* 狀態列:嚴重度＋面向＋來源;顏色＋文字並存 */}
        <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
          <Badge color={s.color}><MSym name={s.icon} size={13} />{s.label}</Badge>
          <Badge color="slate">{r.category}</Badge>
          <Badge color="blue">{SOURCE_LABEL[r.source]}</Badge>
        </div>

        <div className="p-4">
          <div className="text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{r.title}</div>
          {/* 空值一律顯示 —:四格固定,眼睛掃同一位置就知道有沒有填 */}
          <MetaGrid className="mt-3.5" rows={[
            ['判定', s.label],
            ['面向', r.category || '—'],
            ['來源', SOURCE_LABEL[r.source]],
            ['單據', r.route ? ROUTE_LABEL[r.route] || r.route : '—'],
          ]} />
        </div>

        {/* 判定依據:引擎給的說明,完整顯示不再 text-xs 一行——這段就是機關要複查的理由 */}
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <MSym name="fact_check" size={15} className="text-[var(--text-3)]" />
            <span className="text-footnote font-medium text-[var(--text)]">判定依據</span>
          </div>
          <p className="text-body leading-[1.8] text-[var(--text)] break-words">{basis || '—'}</p>
        </div>

        {/* 對應工項/日期/缺失:冒號後那段;沒有就不渲染(不放空區塊) */}
        {items && (
          <div className="px-4 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <MSym name="list_alt" size={15} className="text-[var(--text-3)]" />
              <span className="text-footnote font-medium text-[var(--text)]">對應工項／項目</span>
            </div>
            <p className="text-body leading-[1.8] text-[var(--text)] break-words bg-[var(--surface-2)] rounded-lg px-3 py-2">{items}</p>
          </div>
        )}

        {/* 動作列:只有「前往來源單據」,次級鈕——這個情境沒有主動作(稽核只提醒、不做任何處置)。
            沒有 route 的項目(如檢核表未對到工作面)就沒有動作列,不放空區塊 */}
        {r.route && (
          <div className="px-4 py-3 border-t border-[var(--border-2)] flex items-center gap-2 flex-wrap">
            <Button variant="secondary" onClick={() => navigate(r.route)}>
              前往{ROUTE_LABEL[r.route] || '查核'}<MSym name="arrow_forward" size={14} />
            </Button>
          </div>
        )}
      </section>
    )
  }

  // ── 左欄卡頭下方:搜尋 + 四段嚴重度快篩(件數走全體),兩條件 AND
  const filterBar = (
    <div className="px-5 py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
      <SearchField ref={searchRef} value={filters.q}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        placeholder="搜尋項目、依據或面向…" aria-label="搜尋稽核項目" />
      <div className="flex items-center gap-2 flex-wrap">
        {SEVERITIES.map((sv) => (
          <StatusChip key={sv} active={filters.status === sv} count={counts[sv]}
            onClick={() => setFilters((f) => ({ ...f, status: f.status === sv ? '' : sv }))}>
            <Dot color={ST[sv].color} />{ST[sv].label}
          </StatusChip>
        ))}
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>清除篩選</Button>
        )}
      </div>
    </div>
  )

  // ── 清單列:只負責選取(動作全在詳情欄),兩行=嚴重度＋標題＋面向 / 來源＋依據摘要。
  // role=listitem + aria-current 與 /safety 同一套選取語意。
  const listRows = (
    <div role="list" aria-label="稽核項目" className="divide-y divide-[var(--border-2)]">
      {ordered.length === 0 ? (
        <div className="px-5 py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
          沒有符合條件的稽核項目。<br />換一個嚴重度,或試試項目、依據關鍵字。
        </div>
      ) : ordered.map((r) => {
        const s = ST[r.status]
        const active = r.id === selectedId
        return (
          <button key={r.id} type="button" role="listitem" id={`aud-${r.id}`}
            aria-current={active || undefined}
            onClick={() => select(r.id, { openPane: true })}
            className={`w-full text-left px-5 py-3 max-md:min-h-11 cursor-pointer ${active
              ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--surface-2)]'}`}>
            <span className="flex items-center gap-2 flex-wrap">
              <Badge color={s.color}><MSym name={s.icon} size={13} />{s.label}</Badge>
              <span className="text-body text-[var(--text)] min-w-0 [text-wrap:pretty]">{r.title}</span>
              <Badge color="slate">{r.category}</Badge>
            </span>
            <span className="block mt-0.5 text-caption text-[var(--text-3)] truncate">
              {SOURCE_LABEL[r.source]} · {r.detail}
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="space-y-5">
      <PageHeader title="風險稽核" tagline="唯讀查閱"
        subtitle="系統化檢核本案的估驗、變更、品質、契約與進度，標出值得複查的異常" />

      <p role="note" className="rounded-lg px-3 py-2 text-footnote bg-[var(--amber-tint)] text-[var(--amber-text)]">
        {RETIRED_NOTE} <Link to="/valuation" className="underline font-medium">前往估驗計價</Link>
      </p>

      <ListDetailLayout
        detail={detailBody}
        detailLabel="稽核項目詳情"
        detailEmpty={<Empty>點左側清單查看判定依據、對應工項與來源單據。</Empty>}
        drawerOpen={detailOpen && !!selected}
        onDrawerClose={closeDetail}>
        {/* ── 左欄:一份清單(右欄與抽屜由殼統一,見 components/listDetail.jsx)。
            整案結論一句放卡頭右側:改版前的總覽色塊只剩這句有人會讀,件數都在快篩 chip 上 */}
        <Card title={`稽核項目（${rows.length}）`} bodyClass="p-0"
          action={<span className="text-footnote text-[var(--text-2)] num text-right">{verdict} · 已勾稽 {integrity.summary.checked || 0} 項計價工項</span>}>
          {filterBar}
          {listRows}
        </Card>
      </ListDetailLayout>

      <p className="text-caption text-[var(--text-3)] leading-relaxed">
        <MSym name="verified_user" size={13} className="inline align-text-bottom mr-1" />
        稽核結果為<b className="text-[var(--text-2)] font-medium">「值得複查的異常提示」，非違規認定</b>；供機關監督參考，實際處置請依契約與相關法令。
      </p>
    </div>
  )
}
