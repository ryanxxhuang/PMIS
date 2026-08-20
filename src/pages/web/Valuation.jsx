import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Stat, Badge, Button, BallChip, Empty, PageHeader, PrerequisiteEmptyState, ErrorBanner } from '../../components/ui.jsx'
import { appConfirm, appPrompt } from '../../components/confirm.jsx'
import { buildBillableTree, buildCumMap } from '../../lib/boqCalc.js'
import { collectEvidence, OVER_TOL } from '../../lib/evidence.js'
import { valuationBall } from '../../lib/ballInCourt.js'

const fmt = (n) => (n == null || isNaN(n) ? '0' : Math.round(n).toLocaleString('en-US'))
const yi = (n) => (n / 1e8).toFixed(2) + ' 億'

const statusColor = { 草稿: 'slate', 監造審核: 'amber', 已核定: 'green' }

// 決策列差異彙總(W8-4B B2):純計數,不動任何金額——金額仍由 boqCalc 確定性引擎算。
// 超計與明細列的 overBilled 是同一條式子(OVER_TOL 同源),兩處判定不可分裂;
// 只計 cum>0 的項——沒計價的工項本來就不存在「超計/無佐證」問題,也省掉整樹掃描。
// 回傳 keys 讓決策列能把該些列的佐證欄一鍵展開(沿用 evOpen,不另做篩選機制)。
export function summarizeValuationDiff(leaves, cumMap, evidenceOf) {
  const overKeys = []
  const noEvidenceKeys = []
  for (const it of leaves || []) {
    const cum = Number(cumMap?.[it.item_key] ?? 0)
    if (!(cum > 0)) continue
    const ev = evidenceOf(it)
    const evCount = ev.counts.logs + ev.counts.inspections + ev.counts.checklists + ev.counts.samples
    if (evCount === 0) noEvidenceKeys.push(it.item_key)
    // 注意:無任何日誌(loggedTotal=0)而有計價者也算超計——與明細列警示一致,
    // 這正是送審前最該被看到的一種差異
    if (cum > ev.loggedTotal * OVER_TOL) overKeys.push(it.item_key)
  }
  return { over: overKeys.length, noEvidence: noEvidenceKeys.length, overKeys, noEvidenceKeys }
}

export default function Valuation() {
  const { project, workItems: data, valuations, createValuation, updateValuationItem, setValuationStatus,
    isSupabaseConfigured, currentProject, workItemsSource, siteLogs, fillValuationFromSiteLogs, dbMode, deleteValuation,
    inspections, checklistRecords, checklistTemplates, testSamples,
    adjustedItems, coNet, revisedTotal, can } = useStore()
  const [filling, setFilling] = useState(false)
  const [fillMsg, setFillMsg] = useState('') // 日誌帶入的結果訊息(確定性加總,非 AI 草稿)
  const [errMsg, setErrMsg] = useState('') // DB 寫入失敗的訊息(不偽裝成功)
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(() => new Set())
  const [evOpen, setEvOpen] = useState(() => new Set()) // 佐證欄展開的工項
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (data) setExpanded(new Set(data.items.filter((it) => it.depth === 1).map((it) => it.item_key)))
  }, [data])

  // 只取「發包工程費、非合計列」建樹（合計列會重複母項金額）。
  // 變更設計調整與變更後契約金額由 store 統一提供(財務單一真相層,B-02)。
  const { childrenMap, roots } = useMemo(
    () => (data ? buildBillableTree(adjustedItems) : { childrenMap: new Map(), roots: [] }),
    [data, adjustedItems],
  )
  const billableTotal = revisedTotal

  const selected = valuations.find((v) => v.id === selectedId) || valuations[valuations.length - 1]
  const prev = selected ? valuations.find((v) => v.period_no === selected.period_no - 1) : null
  const editable = selected?.status === '草稿' && can.edit

  const cumThis = useMemo(() => buildCumMap(roots, childrenMap, selected?.items || {}), [roots, childrenMap, selected?.items])
  const cumPrev = useMemo(() => buildCumMap(roots, childrenMap, prev?.items || {}), [roots, childrenMap, prev?.items])

  // 搜尋攤平末端工項:結果設上限——真實 PCCES 標單有數千末端工項,
  // 一次渲染整包搜尋結果會卡住頁面(P1-3);超過上限提示縮小關鍵字。
  const SEARCH_LIMIT = 120
  const { leaves, matchCount } = useMemo(() => {
    const q = search.trim()
    if (!q) return { leaves: [], matchCount: 0 }
    const out = []; let count = 0
    for (const list of childrenMap.values())
      for (const it of list)
        if (!(childrenMap.get(it.item_key)?.length) && (it.description.includes(q) || (it.item_no || '').includes(q))) {
          count++
          if (out.length < SEARCH_LIMIT) out.push(it)
        }
    return { leaves: out, matchCount: count }
  }, [search, childrenMap])

  // 佐證推導(批5):純計算但末端工項可能上千——不預先算全部,只對「實際渲染到畫面
  // 的列」惰性計算並快取;資料變動時 useMemo 重建快取。推導規則在 lib/evidence.js。
  const getEvidence = useMemo(() => {
    // 檢查表紀錄只有 template_id,顯示用標題由範本去正規化補上
    const tmap = new Map((checklistTemplates || []).map((t) => [t.id, t.title]))
    const records = (checklistRecords || []).map((r) => ({ ...r, title: tmap.get(r.template_id) || r.title || '自主檢查表' }))
    const idToKey = new Map((data?.items || []).filter((it) => it.id).map((it) => [it.id, it.item_key]))
    const deps = { siteLogs, inspections, checklistRecords: records, testSamples, wiMaps: { idToKey } }
    const cache = new Map()
    return (it) => {
      let ev = cache.get(it.item_key)
      if (!ev) { ev = collectEvidence(it.item_key, { ...deps, workItem: it }); cache.set(it.item_key, ev) }
      return ev
    }
  }, [data, siteLogs, inspections, checklistRecords, checklistTemplates, testSamples])

  // 決策列差異彙總:從 selected.items 的 key 出發(只有被填過的工項才在裡面),
  // 不掃整棵樹——真實 PCCES 標單有數千葉項,決策列不該多付整樹成本。
  const keyToItem = useMemo(() => new Map((data?.items || []).map((it) => [it.item_key, it])), [data])
  const diffSummary = useMemo(() => {
    const items = selected?.items || {}
    // 防呆:只留樹上真正的葉項(母項/不在計價樹上的 key 不應被計數)
    const billedLeaves = Object.keys(items)
      .map((k) => keyToItem.get(k))
      .filter((it) => it && !(childrenMap.get(it.item_key)?.length))
    return summarizeValuationDiff(billedLeaves, items, getEvidence)
  }, [selected?.items, keyToItem, childrenMap, getEvidence])

  if (!data) return <Empty>載入估驗資料中…</Empty>

  // 真專案但標單尚未匯入 DB → 估驗無法綁工項，先請匯入
  if (isSupabaseConfigured && currentProject && workItemsSource !== 'db') {
    return (
      <Card title="估驗計價">
        <PrerequisiteEmptyState
          need="估驗計價依標單工項的契約數量/單價逐項計價,此專案的標單尚未匯入。"
          unlocks="逐期估驗、請款收款、日誌累計帶入、請款佐證包"
          to={can.edit ? '/contract' : undefined} cta={can.edit ? '前往專案文件上傳標單' : undefined}
          who={!can.edit ? '待施工廠商匯入標單並提報估驗後即可檢視。' : undefined} />
      </Card>
    )
  }

  const totalCum = roots.reduce((s, r) => s + (cumThis.get(r.item_key) || 0), 0)
  const totalPrev = roots.reduce((s, r) => s + (cumPrev.get(r.item_key) || 0), 0)
  const periodAmt = totalCum - totalPrev
  const ret = (selected?.retention_pct ?? 5) / 100
  const completion = billableTotal ? (totalCum / billableTotal) * 100 : 0

  const toggle = (key) =>
    setExpanded((p) => {
      const n = new Set(p)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })

  const toggleEv = (key) =>
    setEvOpen((p) => {
      const n = new Set(p)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })

  // 輸入「累計完成數量」，夾在 0 ~ 契約數量;DB 失敗時 slice 會還原該格,這裡顯示原因。
  // onBlur 才寫入(P1-3):打字中不觸發 DB upsert 與全樹重算——大標單每鍵一次會卡死。
  const onQty = async (it, val) => {
    const existing = selected?.items?.[it.item_key]
    if (val === '' && existing == null) return          // 沒填過又留空:不寫 0 列
    let n = parseFloat(val)
    if (isNaN(n)) n = 0
    const maxQ = it.quantity || 0
    n = Math.max(0, maxQ > 0 ? Math.min(maxQ, n) : n)
    if (existing != null && Number(existing) === n) return // 無變化不寫
    const { error } = await updateValuationItem(selected.id, it.item_key, n)
    if (error) setErrMsg(`數量未儲存（${it.item_no || it.item_key}）：${error.message}`)
  }

  // 建立估驗期(新增一期/第 1 期共用):DB 成功才會拿到 v
  const onCreate = async () => {
    setErrMsg('')
    const { v, error } = await createValuation()
    if (error) setErrMsg(`建立估驗期失敗：${error.message}`)
    else setSelectedId(v.id)
  }

  const onStatus = async (status) => {
    setErrMsg('')
    const { error } = await setValuationStatus(selected.id, status)
    if (error) setErrMsg(`狀態更新失敗：${error.message}`)
  }
  // 退回(監造審核→草稿)與退回核定(已核定→草稿):原因必填,記入本期備註(P1-01/02)。
  // 已核定期若已登錄請款/收款,DB 會擋下並指引先清空——錯誤原樣顯示。
  const onReject = async (label) => {
    const reason = await appPrompt({
      title: `${label}：第 ${selected.period_no} 期`, label: `${label}原因（必填，記入本期備註）`,
      required: true, danger: true, confirmLabel: label,
    })
    if (reason === null) return
    setErrMsg('')
    const stamp = new Date().toISOString().slice(0, 10)
    const note = `${selected.note ? `${selected.note}\n` : ''}${label}(${stamp})：${reason.trim()}`
    const { error } = await setValuationStatus(selected.id, '草稿', { note })
    if (error) setErrMsg(`${label}失敗：${error.message}`)
  }

  // 佐證欄摘要:0 的類別不顯示;全 0 顯示灰字「無」
  const evSummary = (c) => {
    const parts = []
    if (c.logs) parts.push(`${c.logs} 日誌`)
    if (c.inspections) parts.push(`${c.inspections} 查驗`)
    if (c.checklists) parts.push(`${c.checklists} 檢查表`)
    if (c.samples) parts.push(`${c.samples} 試體`)
    return parts.join(' · ')
  }
  const evStatusCls = (s) => (s === '合格' ? 'text-[var(--green-text)]' : s === '不合格' ? 'text-[var(--red-text)]' : 'text-[var(--text-3)]')
  const EV_LOG_LIMIT = 30

  // 佐證展開細節:沿用樹狀列展開的語彙(該列下方插一列),不開 modal
  const renderEvidenceRow = (it, ev, level) => (
    <tr key={`${it.item_key}::ev`} className="border-b border-[var(--border-2)] bg-[var(--surface-2)]/60">
      {/* 縮排同明細列改佔位 span(+20 對齊展開鈕後的文字起點),colSpan 結構不動 */}
      <td colSpan={8} className="py-2.5 pl-3 pr-3">
        <div className="flex">
          <span style={{ width: level * 18 + 20 }} className="shrink-0" aria-hidden="true" />
          <div className="space-y-2 text-xs min-w-0">
          {ev.logs.length > 0 && (
            <div>
              <div className="font-medium text-[var(--text-2)] mb-0.5">
                施工日誌 <span className="text-[var(--text-3)] font-normal">{ev.logs.length} 筆</span>
                <Link to="/site-log" className="ml-2 text-[var(--blue-text)] hover:underline font-normal">前往日誌 →</Link>
              </div>
              <ul className="space-y-0.5">
                {ev.logs.slice(0, EV_LOG_LIMIT).map((l) => (
                  <li key={l.log_date} className="text-[var(--text-3)]">
                    <span className="tabular-nums text-[var(--text-2)]">{l.log_date}</span>
                    <span className="mx-1.5 tabular-nums">{l.qty.toLocaleString('en-US')} {it.unit}</span>
                    {l.note && <span className="text-[var(--text-3)]">— {l.note}</span>}
                  </li>
                ))}
                {ev.logs.length > EV_LOG_LIMIT && (
                  <li className="text-[var(--text-3)]">共 {ev.logs.length} 筆,僅列最近 {EV_LOG_LIMIT} 筆</li>
                )}
              </ul>
            </div>
          )}
          {ev.inspections.length > 0 && (
            <div>
              <div className="font-medium text-[var(--text-2)] mb-0.5">
                查驗 <span className="text-[var(--text-3)] font-normal">{ev.inspections.length} 筆</span>
                <Link to="/quality" className="ml-2 text-[var(--blue-text)] hover:underline font-normal">前往品質查驗 →</Link>
              </div>
              <ul className="space-y-0.5">
                {ev.inspections.map((i) => (
                  <li key={i.id} className="text-[var(--text-3)]">
                    {i.title}
                    <span className={`ml-1.5 ${evStatusCls(i.status)}`}>{i.status}</span>
                    {i.inspected_at && <span className="ml-1.5 tabular-nums">{String(i.inspected_at).slice(0, 10)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ev.checklists.length > 0 && (
            <div>
              <div className="font-medium text-[var(--text-2)] mb-0.5">
                自主檢查表 <span className="text-[var(--text-3)] font-normal">{ev.checklists.length} 筆</span>
                <Link to="/quality" className="ml-2 text-[var(--blue-text)] hover:underline font-normal">前往自主檢查 →</Link>
              </div>
              <ul className="space-y-0.5">
                {ev.checklists.map((r) => (
                  <li key={r.id} className="text-[var(--text-3)]">
                    {r.title}
                    <span className="ml-1.5 tabular-nums">{r.check_date}</span>
                    <span className={`ml-1.5 ${evStatusCls(r.overall)}`}>{r.overall || '未判定'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ev.samples.length > 0 && (
            <div>
              <div className="font-medium text-[var(--text-2)] mb-0.5">
                取樣試體 <span className="text-[var(--text-3)] font-normal">{ev.samples.length} 組(以澆置日對應)</span>
                <Link to="/quality" className="ml-2 text-[var(--blue-text)] hover:underline font-normal">前往取樣試驗 →</Link>
              </div>
              <ul className="space-y-0.5">
                {ev.samples.map((s) => (
                  <li key={s.id} className="text-[var(--text-3)]">
                    <span className="text-[var(--text-2)]">{s.sample_no}</span>
                    <span className="ml-1.5 tabular-nums">取樣 {s.sampled_date}</span>
                    <span className={`ml-1.5 ${evStatusCls(s.status)}`}>{s.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ev.counts.logs + ev.counts.inspections + ev.counts.checklists + ev.counts.samples === 0 && (
            <div className="text-[var(--text-3)]">此工項尚無任何現場紀錄佐證(施工日誌/查驗/檢查表/試體均查無對應)。</div>
          )}
          </div>
        </div>
      </td>
    </tr>
  )

  const renderRow = (it, level) => {
    const kids = childrenMap.get(it.item_key) || []
    const hasKids = kids.length > 0
    const isOpen = expanded.has(it.item_key)
    const cum = cumThis.get(it.item_key) || 0
    const per = cum - (cumPrev.get(it.item_key) || 0)
    const cumQty = selected?.items?.[it.item_key] ?? 0
    // 佐證只對渲染到的葉項計算(getEvidence 內部有快取)
    const ev = hasKids ? null : getEvidence(it)
    // 差異警示:估驗累計 > 日誌累計 ×1.05(與稽核頁 OVER_TOL 同一容忍值)——
    // 把送審後才會被勾稽出的「超前計價」提前呈現在填報當下
    const overBilled = ev && Number(cumQty) > 0 && Number(cumQty) > ev.loggedTotal * OVER_TOL
    // 完成百分比：父項用金額比、葉項用數量比
    const pct = hasKids
      ? (it.amount ? (cum / it.amount) * 100 : 0)
      : (it.quantity ? (cumQty / it.quantity) * 100 : 0)
    const row = (
      <tr key={it.item_key} className={`border-b border-[var(--border-2)] hover:bg-[var(--surface-2)] ${hasKids ? 'bg-[var(--bg)] font-medium' : ''}`}>
        {/* table-fixed 下改用「固定寬佔位 span」縮排:padding 縮排會吃掉欄寬,
            深層工項一縮排整欄就被推歪;佔位法讓縮排永不推移其他欄位 */}
        <td className="py-1.5 pl-3 pr-2">
          <span className="flex items-center gap-1 min-w-0">
            <span style={{ width: level * 18 }} className="shrink-0" aria-hidden="true" />
            {hasKids ? (
              // 圖示 aria-hidden,可及名稱與展開狀態仍由 aria-label/aria-expanded 承擔
              <button onClick={() => toggle(it.item_key)} aria-expanded={isOpen} aria-label={`${isOpen ? '收合' : '展開'} ${it.item_no}`}
                className="w-4 shrink-0 inline-flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text)]">
                <MSym name={isOpen ? 'expand_more' : 'chevron_right'} size={16} />
              </button>
            ) : <span className="w-4 shrink-0 inline-block" />}
            <span className="text-[var(--text-3)] text-xs tabular-nums shrink-0">{it.item_no}</span>
            {/* 長工項名 ellipsis 截斷不換行(列高一致),完整名稱靠 title 提示 */}
            <span className={`truncate ${it.depth <= 2 ? 'text-[var(--text)]' : ''}`} title={it.description}>{it.description}</span>
          </span>
        </td>
        <td className="text-right text-[var(--text-3)] text-xs px-2 whitespace-nowrap">{hasKids ? '' : it.unit}</td>
        <td className="text-right text-[var(--text-2)] px-2 tabular-nums whitespace-nowrap">{hasKids ? '' : fmt(it.quantity)}</td>
        <td className="text-right text-[var(--text-2)] px-2 tabular-nums whitespace-nowrap">{hasKids ? '' : fmt(it.unit_price)}</td>
        <td className="text-right px-2 whitespace-nowrap">
          {hasKids ? (
            <span className="text-[var(--text-3)] tabular-nums">{pct.toFixed(1)}%</span>
          ) : editable ? (
            <span className="inline-flex items-center gap-1 justify-end">
              <input
                type="number" min="0" max={it.quantity || undefined} step="any"
                key={`${selected.id}:${it.item_key}:${cumQty}`}
                defaultValue={selected?.items?.[it.item_key] ?? ''}
                onBlur={(e) => onQty(it, e.target.value)}
                placeholder="0"
                className="w-20 text-right border border-[var(--border)] rounded px-1.5 py-0.5 text-sm tabular-nums focus:border-[var(--blue)] focus:outline-none"
              />
              <span className="text-[10px] text-[var(--text-3)] w-9 text-right tabular-nums">{pct.toFixed(0)}%</span>
            </span>
          ) : (
            <span className="text-[var(--text-2)] tabular-nums">{fmt(cumQty)} <span className="text-[10px] text-[var(--text-3)]">({pct.toFixed(0)}%)</span></span>
          )}
        </td>
        <td className="text-right text-[var(--text)] px-2 tabular-nums whitespace-nowrap">{fmt(cum)}</td>
        <td className={`text-right px-2 tabular-nums whitespace-nowrap ${per > 0 ? 'text-[var(--blue-text)] font-medium' : 'text-[var(--text-3)]'}`}>{fmt(per)}</td>
        {/* 佐證欄非數字欄:固定欄寬(colgroup 200px)下拿掉 nowrap 讓摘要與警示可換行,
            否則「疑超計」長字串會溢出儲存格蓋到相鄰欄 */}
        <td className="text-left px-2 pr-3 text-xs">
          {!hasKids && ev && (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {ev.counts.logs + ev.counts.inspections + ev.counts.checklists + ev.counts.samples === 0 ? (
                <span className="text-[var(--text-3)]">無</span>
              ) : (
                <button
                  onClick={() => toggleEv(it.item_key)}
                  aria-expanded={evOpen.has(it.item_key)}
                  title="展開佐證細節(日誌/查驗/檢查表/試體)"
                  className="inline-flex items-center gap-0.5 text-[var(--blue-text)] hover:underline"
                >
                  <MSym name={evOpen.has(it.item_key) ? 'expand_more' : 'chevron_right'} size={14} />{evSummary(ev.counts)}
                </button>
              )}
              {overBilled && (
                // 警示原本只有琥珀色+title,手機沒有 hover 就完全讀不到語意;
                // 補圖示與「疑超計」字樣,顏色只是輔助(W8-0 §8-6)
                <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--amber-text)]" title="累計估驗數量高於施工日誌累計完成量逾 5%,可能超計,建議查核佐證後再計價">
                  <MSym name="warning" size={11} />疑超計 估驗 {fmt(cumQty)} &gt; 日誌 {fmt(ev.loggedTotal)}
                </span>
              )}
            </span>
          )}
        </td>
      </tr>
    )
    if (!hasKids && evOpen.has(it.item_key)) return [row, renderEvidenceRow(it, ev, level)]
    return row
  }

  const renderTree = (items, level = 0) =>
    items.flatMap((it) => {
      const kids = childrenMap.get(it.item_key) || []
      const row = renderRow(it, level)
      if (kids.length && expanded.has(it.item_key)) return [row, ...renderTree(kids, level + 1)]
      return [row]
    })

  return (
    <div className="space-y-5">
      <PageHeader title="估驗計價" tagline="Valuation"
        subtitle={`${coNet !== 0
          ? `變更後契約金額 ${yi(billableTotal)}（原發包 ${yi(billableTotal - coNet)}，核准追加減 ${coNet > 0 ? '+' : ''}${fmt(coNet)}）`
          : `發包工程費 ${yi(billableTotal)}`}（保留款 ${selected?.retention_pct ?? 5}%）`}
        action={
          // 兩份輸出常被搞混(C-11):差異原本只寫在 title tooltip,手機根本讀不到。
          // 副文字常駐,講清楚哪一份是計價依據、哪一份只是佐證彙整。
          <div className="flex flex-wrap items-start gap-2">
            {selected && (
              <div className="flex flex-col gap-0.5 max-w-[10rem]">
                <Button variant="secondary" onClick={() => navigate(`/valuation/print?p=${selected.id}`)}><MSym name="print" size={15} />列印估驗單</Button>
                <span className="text-[11px] text-[var(--text-3)] leading-tight">正式計價金額文件</span>
              </div>
            )}
            {selected && (
              <div className="flex flex-col gap-0.5 max-w-[10rem]">
                <Button variant="secondary" onClick={() => navigate(`/valuation/package?p=${selected.id}`)} title="彙整本期估驗明細＋AI 施工說明＋佐證照片"><MSym name="auto_awesome" size={15} />組請款佐證包</Button>
                <span className="text-[11px] text-[var(--text-3)] leading-tight">佐證彙整，非正式計價單</span>
              </div>
            )}
            {can.edit && <Button variant="secondary" onClick={onCreate}>＋ 新增估驗期</Button>}
          </div>
        } />

      <ErrorBanner msg={errMsg} onClose={() => setErrMsg('')} />

      {valuations.length === 0 ? (
        <Card>
          <Empty>
            尚無估驗期。每月對已完成工項提報估驗，系統依標單單價自動計算本期/累計金額與保留款。
            {can.edit && <div className="mt-4"><Button onClick={onCreate}>建立第 1 期估驗</Button></div>}
          </Empty>
        </Card>
      ) : (
        <>
          {/* 期數頁籤 */}
          <div className="flex items-center gap-2 flex-wrap">
            {valuations.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelectedId(v.id)}
                className={`px-3 py-1.5 rounded-lg text-sm border pressable ${
                  v.id === selected?.id ? 'bg-[var(--blue-tint)] text-[var(--blue-text)] border-[var(--blue)] font-medium' : 'bg-[var(--surface)] text-[var(--text-2)] border-[var(--border)] hover:bg-[var(--surface-2)]'
                }`}
              >
                第 {v.period_no} 期
                <Badge color={statusColor[v.status] || 'slate'}>{v.status}</Badge>
              </button>
            ))}
          </div>

          {/* 本期彙總 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Stat label="本期估驗金額" value={fmt(periodAmt)} sub={`第 ${selected.period_no} 期`} color="text-[var(--blue-text)]" />
            <Stat label="累計估驗金額" value={fmt(totalCum)} sub={`占發包 ${completion.toFixed(1)}%`} />
            <Stat label="累計完成度" value={`${completion.toFixed(1)}%`} sub={`/ ${yi(billableTotal)}`} color="text-[var(--green-text)]" />
            <Stat label="本期保留款" value={fmt(periodAmt * ret)} sub={`${selected.retention_pct}%`} color="text-[var(--text-2)]" />
            <Stat label="本期應付" value={fmt(periodAmt * (1 - ret))} sub="本期估驗 − 保留款" color="text-[var(--blue-text)]" />
          </div>

          {/* 本期決策列(W8-4B B2):先給「這期在誰手上、與日誌差在哪、我能按什麼」,
              再往下讀明細(W8-0 §7)。動作鈕從明細卡右上「搬」到這裡——絕非複製,
              e2e-real 對「核定估驗」等按鈕名是嚴格單一命中,全頁只准一顆。 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[var(--border-2)] bg-[var(--surface-2)]/60 px-4 py-2.5 max-sm:flex-col max-sm:items-stretch">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-[var(--text)]">第 {selected.period_no} 期</span>
              <Badge color={statusColor[selected.status] || 'slate'}>{selected.status}</Badge>
              {/* BallChip 在「監造審核」的標籤與右側既有「待監造核定」Badge 同字,而
                  e2e-real 對該字是嚴格單一命中——非核定者視角只保留 Badge 那一處,
                  其餘狀態(含核定者視角)由 BallChip 標示責任方 */}
              {!(selected.status === '監造審核' && !can.approve) && <BallChip ball={valuationBall(selected)} />}
            </div>
            <div className="flex items-center gap-2 text-xs flex-wrap">
              {diffSummary.over === 0 && diffSummary.noEvidence === 0 ? (
                <span className="text-[var(--green-text)]">與日誌相符</span>
              ) : (
                <>
                  {diffSummary.over > 0 && (
                    <button
                      onClick={() => setEvOpen((p) => new Set([...p, ...diffSummary.overKeys]))}
                      title="展開超計工項的佐證欄(估驗累計高於日誌累計逾 5%),逐項查核後再核定"
                      className="text-[var(--amber-text)] hover:underline"
                    >
                      超計 {diffSummary.over} 項
                    </button>
                  )}
                  {diffSummary.noEvidence > 0 && (
                    <span className="text-[var(--text-3)]" title="有計價但查無任何日誌/查驗/檢查表/試體對應">無佐證 {diffSummary.noEvidence} 項</span>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2 sm:ml-auto max-sm:flex-col max-sm:items-stretch">
              {selected.status === '草稿' && can.submit && <Button variant="secondary" className="max-sm:w-full max-sm:min-h-11" onClick={() => onStatus('監造審核')}>送監造審核</Button>}
              {selected.status === '監造審核' && (can.approve ? <>
                <Button variant="ghost" className="max-sm:w-full max-sm:min-h-11" onClick={() => onReject('退回')}>退回</Button>
                <Button variant="success" className="max-sm:w-full max-sm:min-h-11" onClick={() => onStatus('已核定')}>核定估驗</Button>
              </> : <Badge color="amber">待監造核定</Badge>)}
              {selected.status === '已核定' && can.approve &&
                <Button variant="ghost" className="max-sm:w-full max-sm:min-h-11" onClick={() => onReject('退回核定')}>退回核定</Button>}
              {/* 僅草稿可刪(送審/核定後為履約證據,DB 另有 valuations_delete_guard;R4 P2-01) */}
              {can.edit && selected.status === '草稿' && <Button variant="ghost" onClick={async () => { if (await appConfirm({ title: `刪除第 ${selected.period_no} 期估驗？`, danger: true, confirmLabel: '刪除' })) { setErrMsg(''); const { error } = await deleteValuation(selected.id); if (error) setErrMsg(`刪除失敗：${error.message}`); else setSelectedId(null) } }} className="text-[var(--red-text)] hover:text-[var(--red-text)] max-sm:w-full max-sm:min-h-11" aria-label="刪除估驗期"><MSym name="delete" size={15} /></Button>}
            </div>
          </div>

          <Card
            title={`第 ${selected.period_no} 期 估驗明細`}
            action={
              <div className="flex items-center gap-2">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋工項…" className="text-sm border border-[var(--border)] rounded-lg px-2.5 py-1 w-40 focus:border-[var(--blue)] focus:outline-none" />
                {/* 這顆是確定性引擎(fillValuationFromSiteLogs 逐日加總,無任何模型呼叫),
                    原本卻掛「AI 估驗草擬」的名字與 Sparkles——既違反「數字由確定性引擎算」
                    的對外敘事,也讓使用者以為不開 AI 就填不了數量(C-9)。 */}
                {selected.status === '草稿' && can.edit && siteLogs.length > 0 && (
                  <Button onClick={async () => { setFilling(true); setErrMsg(''); const { count, error } = await fillValuationFromSiteLogs(selected.id); setFilling(false); if (error) { setErrMsg(`帶入未寫入：${error.message}`); return } setFillMsg(count ? `已依 ${siteLogs.length} 筆施工日誌帶入 ${count} 個工項累計，請覆核後送審。` : '施工日誌中查無可帶入的完成數量。') }} disabled={filling} title="依施工日誌逐日完成數量加總，帶入本期各工項累計完成數量（確定性計算，不經 AI）">
                    <MSym name="calculate" size={14} />{filling ? '帶入中…' : '帶入日誌累計'}
                  </Button>
                )}
              </div>
            }
          >
            {fillMsg && editable && (
              <div className="mb-3 flex items-start gap-2 text-xs bg-[var(--blue-tint)] text-[var(--blue-text)] rounded-lg px-3 py-2">
                <MSym name="calculate" size={14} className="shrink-0 mt-0.5" />
                <span>{fillMsg}</span>
              </div>
            )}
            {!editable && <p className="text-xs text-[var(--amber-text)] mb-2">本期狀態為「{selected.status}」，明細唯讀。</p>}
            {selected.note && (
              <p className="text-xs text-[var(--amber-text)] mb-2 whitespace-pre-line">本期備註：{selected.note}</p>
            )}
            <div className="overflow-x-auto -mx-4 -my-4">
              {/* table-fixed + colgroup:欄寬固定,縮排/長名稱不再逐列推擠;
                  min-w 保住名稱欄可讀寬度,窄螢幕交給外層 overflow-x-auto 捲動 */}
              <table className="w-full min-w-[1040px] table-fixed text-sm">
                <colgroup>
                  <col />{/* 項次 / 工項名稱:吃剩餘寬度 */}
                  <col style={{ width: 64 }} />
                  <col style={{ width: 104 }} />
                  <col style={{ width: 96 }} />
                  <col style={{ width: 140 }} />{/* 累計完成數量:草稿期含輸入框+完成%,窄於 140 會擠爆 */}
                  <col style={{ width: 118 }} />
                  <col style={{ width: 118 }} />
                  <col style={{ width: 200 }} />{/* 佐證:摘要文字欄,配可換行 */}
                </colgroup>
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)] border-b border-[var(--border)]">
                    <th className="text-left font-medium py-2 pl-3">項次 / 工項名稱</th>
                    <th className="text-right font-medium px-2 whitespace-nowrap">單位</th>
                    <th className="text-right font-medium px-2 whitespace-nowrap">契約數量</th>
                    <th className="text-right font-medium px-2 whitespace-nowrap">單價</th>
                    <th className="text-right font-medium px-2 whitespace-nowrap">累計完成數量</th>
                    <th className="text-right font-medium px-2 whitespace-nowrap">累計金額</th>
                    <th className="text-right font-medium px-2 whitespace-nowrap">本期金額</th>
                    <th className="text-left font-medium px-2 pr-3 whitespace-nowrap">佐證</th>
                  </tr>
                </thead>
                <tbody>
                  {search ? leaves.map((it) => renderRow(it, 0)) : renderTree(roots)}
                  {search && matchCount > leaves.length && (
                    <tr><td colSpan={8} className="py-2 px-3 text-xs text-[var(--text-3)]">
                      符合 {matchCount} 筆,僅顯示前 {leaves.length} 筆——請輸入更精確的關鍵字或工項編號。
                    </td></tr>
                  )}
                </tbody>
                <tfoot>
                  {/* 合計沿用既有確定性彙總(totalCum/periodAmt 由 boqCalc 樹加總而來),不另行重算;
                      搜尋模式只過濾顯示列,合計仍是全期口徑 */}
                  <tr className="bg-[var(--surface-2)] font-medium border-t border-[var(--border)]">
                    <td className="py-2 pl-3 pr-2">合計</td>
                    <td />
                    <td />
                    <td />
                    <td />
                    <td className="text-right px-2 tabular-nums whitespace-nowrap">{fmt(totalCum)}</td>
                    <td className="text-right px-2 tabular-nums whitespace-nowrap">{fmt(periodAmt)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <p className="text-xs text-[var(--text-3)]">
            在末端工項填「累計完成數量」（夾在 0～契約數量），累計金額 = 契約金額 × 完成數量÷契約數量，右側顯示完成%。
            本期金額 = 本期累計 − 前期累計，父項金額自動加總。保留款依契約比例逐期扣留，竣工驗收後返還。
            完成數量可按「帶入日誌累計」由施工日誌的當日數量逐日加總自動帶入（確定性計算，非 AI 推估），帶入後仍須逐項覆核再送審。
            「佐證」欄自動彙整該工項對應的施工日誌/查驗/自主檢查/試體紀錄；估驗累計高於日誌累計逾 5% 會就地提示，讓超計在送審前就被發現。
          </p>
        </>
      )}
    </div>
  )
}
