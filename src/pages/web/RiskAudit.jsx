import { useMemo, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Empty, PageHeader, Button, Badge, Dot, ErrorBanner } from '../../components/ui.jsx'
import { ListDetailLayout, SearchField, StatusChip, MetaGrid } from '../../components/listDetail.jsx'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import { friendlyError } from '../../lib/errorMessage.js'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { plannedPctNow } from '../../lib/progressPlan.js'
import { auditProject } from '../../lib/riskAudit.js'
import { buildIntegrityFindings, isConcretePourItem } from '../../lib/integrityAudit.js'

// 版面:改版前是「總覽色塊＋檢核表卡＋勾稽鏈卡＋AI 意見卡」四張直排——同一種東西
// (稽核項目)被來源切成兩張卡,判定依據被塞在一行 text-xs 裡,AI 意見又是整案一段、
// 對不回是哪一項發現。現在是一份清單(檢核表＋勾稽發現混排,嚴重度高的在前)＋詳情欄:
// 判定依據、對應工項、來源單據與 AI 稽核意見都貼在該項底下(規範 §0 疊合版、判準第 6 條
// 「這個數字來自哪裡?點得進去嗎?」)。判定仍全由確定性引擎(riskAudit.js/integrityAudit.js)
// 給,這一頁只排版與呈現;AI 只對「文件勾稽鏈」發現寫文字(edge fn audit-summary 的
// system prompt 就是這樣寫的),不參與判定,也不對檢核表項目開口。
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
    siteLogs, inspections, testSamples, auditSummary, demoMode, workItemsSource,
    adjustedItems, revisedTotal, aiEnabled, currentProject } = useStore()
  const imported = workItemsSource === 'db' || demoMode
  const navigate = useNavigate()
  const TODAY = new Date() // 每次 render 取(B-11):長開分頁的「今天」不可凍結在開頁那天
  const [aiById, setAiById] = useState({}) // { [rowId]: { opinion, recommendations } } 逐項 AI 稽核意見
  const [aiBusy, setAiBusy] = useState(null) // 產生中的 rowId
  const [errMsg, setErrMsg] = useState('')
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const searchRef = useRef(null)
  const aiOn = aiEnabled('audit.summary')

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
      const cum = totalCumAmount(roots, buildCumMap(roots, childrenMap, v.items))
      const thisAmt = cum - prev; prev = cum
      return { period_no: v.period_no, thisAmt }
    })
  }, [workItems, valuations, roots, childrenMap])

  const actualPct = useMemo(() => {
    const latest = valuations[valuations.length - 1]
    if (!latest || !billableTotal) return 0
    return (totalCumAmount(roots, buildCumMap(roots, childrenMap, latest.items)) / billableTotal) * 100
  }, [valuations, roots, childrenMap, billableTotal])
  const plannedNow = plannedPctNow(progressPlan, TODAY)

  const anchors = { award_date: project?.award_date, notice_date: project?.notice_date, commencement_date: project?.commencement_date, end_date: project?.end_date }
  const { checks, summary } = useMemo(() => auditProject({
    periodAmounts, changeOrders, defects, obligations, anchors, billableTotal,
    progress: { actualPct, plannedPct: plannedNow },
  }, TODAY), [periodAmounts, changeOrders, defects, obligations, billableTotal, actualPct, plannedNow]) // eslint-disable-line react-hooks/exhaustive-deps

  // 文件勾稽鏈:逐工項跨文件對帳(全確定性)。以 item_key 為鍵串接估驗/日誌;查驗以 id→key。
  // leaves 也要吃 adjustedItems(B-02 殘留破口):「接近完成未申請查驗」以 b/q≥0.8 判定,
  // q 用原契約量的話,核准追加後會拿舊分母算出假發現——機關防弊頁自己產假發現最傷公信力。
  // 變更只動 quantity/amount,id/item_key/樹形不變,idToKey 與混凝土鍵集合不受影響。
  const integrity = useMemo(() => {
    if (!workItems) return { findings: [], summary: { risk: 0, warn: 0 } }
    const idToKey = new Map(adjustedItems.filter((it) => it.id).map((it) => [it.id, it.item_key]))
    // 刻意不換成 boqCalc.billableLeaves:那支的父子對照建在「全部 items」上,
    // 這裡吃的是 buildBillableTree 的 childrenMap(只含可計價非合計列)。
    // 子項全是合計列的分項在兩把尺下結果不同,要併必須先定案哪一個是規則。
    const leaves = adjustedItems.filter((it) => it.is_billable && !it.is_rollup && !(childrenMap.get(it.item_key)?.length))
    const loggedQty = new Map()
    for (const lg of siteLogs) for (const [k, q] of Object.entries(lg.items || {})) loggedQty.set(k, (loggedQty.get(k) || 0) + (Number(q) || 0))
    const latest = [...valuations].sort((a, b) => a.period_no - b.period_no).slice(-1)[0]
    const billedQty = new Map(Object.entries(latest?.items || {}).map(([k, v]) => [k, Number(v) || 0]))
    const inspStatusByItem = new Map() // inspections 已依 created_at desc → 第一個=最近
    for (const ins of inspections) { const key = idToKey.get(ins.work_item_id); if (key && !inspStatusByItem.has(key)) inspStatusByItem.set(key, ins.status) }
    const concreteKeys = new Set(leaves.filter((it) => isConcretePourItem(it.description)).map((it) => it.item_key))
    const pourSet = new Set()
    for (const lg of siteLogs) if (lg.log_date && Object.entries(lg.items || {}).some(([k, q]) => concreteKeys.has(k) && (Number(q) || 0) > 0)) pourSet.add(lg.log_date)
    return buildIntegrityFindings({ leaves, loggedQty, billedQty, inspStatusByItem, pourDates: [...pourSet].map((date) => ({ date })), testSamples })
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
    onSelect: () => setErrMsg(''),
    onReset: () => { setFilters(DEFAULT_FILTERS); setAiById({}) },
  })
  // 篩選後選中項被篩掉:右欄內容保留(與 /safety 同),清單中只是沒有高亮列
  const selected = rows.find((r) => r.id === selectedId) || null
  useListKeyboardNav({ ordered, selectedId, select, idPrefix: 'aud-', searchRef })

  // AI 稽核意見:只對「這一項」勾稽發現寫文字;統計數字照該項給(風險 1/注意 1),
  // 已勾稽工項數沿用整案,讓 AI 知道母體大小。判定不經 AI(integrityAudit.js 已定)。
  const genAudit = async (r) => {
    setAiBusy(r.id); setErrMsg('')
    const { error, result } = await auditSummary({
      project_name: project?.project_name,
      findings: [r],
      summary: { risk: r.status === 'risk' ? 1 : 0, warn: r.status === 'warn' ? 1 : 0, checked: integrity.summary.checked },
    })
    setAiBusy(null)
    if (error) { setErrMsg(friendlyError(error, 'AI 稽核意見產生失敗')); return }
    if (result) setAiById((m) => ({ ...m, [r.id]: result }))
  }

  // 早退也保留 PageHeader:頁首與工作面分頁不該因為「還沒匯入標單」整組消失
  if (!imported) {
    return (
      <div className="space-y-5">
        <PageHeader title="風險稽核" tagline="AI 防弊" subtitle="系統化檢核估驗、變更、品質、契約與進度的異常樣態" />
        <Card bodyClass="p-0"><Empty>此專案尚未匯入標單，無法稽核。請先到「專案文件」一次上傳標單 XML。</Empty></Card>
      </div>
    )
  }

  // 整案結論一句話(改版前總覽色塊的內容):風險/注意各幾項,或未發現異常(含未評估件數)
  const totRisk = counts.risk, totWarn = counts.warn
  const verdict = totRisk ? `${totRisk} 項風險 · ${totWarn} 項注意`
    : totWarn ? `${totWarn} 項需注意`
    : summary.na ? `未發現異常（${summary.na} 項資料不足未評估）` : '本案未發現明顯異常'

  // ── 詳情欄:狀態列 / 標題與 meta / 判定依據 / 對應工項 / AI 意見 / 動作列。
  // region 以標題命名:報讀器走地標時直接聽到「估驗超前施工日誌:3 項工項 詳情」,
  // e2e 也用同一個名字確認詳情欄正在顯示哪一項。
  let detailBody = null
  if (selected) {
    const r = selected
    const s = ST[r.status]
    const { basis, items } = splitDetail(r.detail)
    const ai = aiById[r.id]
    // AI 只對勾稽發現開口(edge fn 的 system prompt 就是「文件勾稽鏈稽核」);通過/未評估
    // 沒有可寫的異常,不給按鈕
    const aiEligible = r.source === 'chain' && (r.status === 'risk' || r.status === 'warn')
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

        {/* AI 稽核意見:--ai 紫色身分(規範 §1 三條不可退讓「AI 草稿須可辨識」),
            內容只根據上面那項確定性發現撰寫,不臆造未列出的問題 */}
        {ai && (
          <div className="px-4 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <MSym name="auto_awesome" size={15} className="text-[var(--ai)]" />
              <span className="text-footnote font-medium text-[var(--ai-text)]">AI 稽核意見</span>
              <Badge color="purple">草稿</Badge>
            </div>
            <div className="bg-[var(--ai-tint)] rounded-lg px-3 py-2 space-y-2">
              <p className="text-body leading-relaxed text-[var(--text)] whitespace-pre-line break-words">{ai.opinion}</p>
              {ai.recommendations?.length > 0 && (
                <div>
                  <div className="text-caption font-medium text-[var(--ai-text)] mb-1">建議事項</div>
                  <ul className="list-decimal list-inside space-y-1 text-body text-[var(--text-2)]">
                    {ai.recommendations.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
              )}
            </div>
            <p className="text-caption text-[var(--text-3)] mt-1">AI 只根據系統確定性發現撰寫,判定不經 AI;供人工撰寫稽核意見參考,非正式文件。</p>
          </div>
        )}

        {/* 動作列:前往來源單據 / 產生 AI 稽核意見。都是次級鈕,這個情境沒有主動作
            (稽核只提醒、不做任何處置)。AI 功能關閉時藏按鈕、留簡短說明(真正的閘門在伺服器端) */}
        <div className="px-4 py-3 border-t border-[var(--border-2)] flex items-center gap-2 flex-wrap">
          {r.route && (
            <Button variant="secondary" onClick={() => navigate(r.route)}>
              前往{ROUTE_LABEL[r.route] || '查核'}<MSym name="arrow_forward" size={14} />
            </Button>
          )}
          {aiEligible && aiOn && (
            <Button variant="secondary" disabled={aiBusy === r.id} onClick={() => genAudit(r)}>
              <MSym name="auto_awesome" size={13} className="text-[var(--ai)]" />{aiBusy === r.id ? ' AI 產生中…' : ai ? ' 重新產生 AI 稽核意見' : ' 產生 AI 稽核意見'}
            </Button>
          )}
          {aiEligible && !aiOn && <span className="text-footnote text-[var(--text-2)]">AI 稽核意見未啟用</span>}
        </div>
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
      <PageHeader title="風險稽核" tagline="AI 防弊"
        subtitle="系統化檢核本案的估驗、變更、品質、契約與進度，標出值得複查的異常" />

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

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
        稽核結果為<b className="text-[var(--text-2)] font-medium">「值得複查的異常提示」，非違規認定</b>；供機關監督參考，實際處置請依契約與相關法令。多案時可於 <Link to="/dashboard" className="text-[var(--blue-text)] hover:underline">總覽</Link> 比較各案風險。
      </p>
    </div>
  )
}
