import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Stat, Badge, Button, BallChip, Empty, Surface, PageHeader, PrerequisiteEmptyState, ErrorBanner, SkeletonList, Input, THEAD_CLS } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { CHIP_BASE, CHIP_ON, CHIP_OFF } from '../../components/PageTabs.jsx'
import { appConfirm, appPrompt } from '../../components/confirm.jsx'
import { buildBillableTree, buildCumMap } from '../../lib/boqCalc.js'
import { collectEvidence } from '../../lib/evidence.js'
import { summarizeValuationDiff } from '../../lib/valuationDiff.js'
import { valuationBall } from '../../lib/ballInCourt.js'
import { taipeiToday } from '../../lib/dates.js'
import { fmtAmount as fmt, fmtYi as yi } from '../../lib/format.js'
import ValuationRow from '../../components/valuation/ValuationRow.jsx' // memo 列:數千列標單的效能槓桿


const statusColor = { 草稿: 'slate', 監造審核: 'amber', 已核定: 'green' }

// 搜尋結果上限:真實 PCCES 標單有數千末端工項,一次渲染整包搜尋結果會卡住頁面(P1-3)
const SEARCH_LIMIT = 120

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

  // 列的 callback 一律釘住 identity(useCallback),否則 ValuationRow 的 memo 形同虛設。
  // toggle/toggleEv 只用 functional setState,沒有外部依賴。
  const toggle = useCallback((key) =>
    setExpanded((p) => {
      const n = new Set(p)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    }), [])

  const toggleEv = useCallback((key) =>
    setEvOpen((p) => {
      const n = new Set(p)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    }), [])

  // 輸入「累計完成數量」，夾在 0 ~ 契約數量;DB 失敗時 slice 會還原該格,這裡顯示原因。
  // onBlur 才寫入(P1-3):打字中不觸發 DB upsert 與全樹重算——大標單每鍵一次會卡死。
  // 本體依賴 selected(每改一格就換)——若直接 useCallback 在 selected 上,每次改數量所有列
  // 都拿到新 onQty 而整樹重畫;改走 ref:對外 identity 永遠不變,內部永遠讀最新的 selected。
  const onQtyRef = useRef(null)
  onQtyRef.current = async (it, val) => {
    const existing = selected?.items?.[it.item_key]
    if (val === '' && existing == null) return          // 沒填過又留空:不寫 0 列
    let n = parseFloat(val)
    if (isNaN(n)) n = 0
    const maxQ = it.quantity || 0
    n = Math.max(0, maxQ > 0 ? Math.min(maxQ, n) : n)
    if (existing != null && Number(existing) === n) return // 無變化不寫
    const { error } = await updateValuationItem(selected.id, it.item_key, n)
    if (error) setErrMsg(friendlyError(error, `數量未儲存（${it.item_no || it.item_key}）`))
  }
  const onQty = useCallback((it, val) => onQtyRef.current(it, val), [])

  // 早退也保留 PageHeader:工作面分頁列(PageTabs)長在 PageHeader 裡,早退不帶頁首
  // 等於整條分頁列消失;平板(768–1279)與收合側欄的 icon rail 又不列子頁,
  // 使用者會被關在載入/前置條件畫面裡,換不到同工作面的其他頁。
  // 主分支的 subtitle/action 依賴 data,早退分支只給標題與 tagline。
  const earlyHeader = <PageHeader title="估驗計價" tagline="Valuation" />
  // 載入中用骨架屏:Empty 自帶 inbox 圖示,擺在載入分支等於先跟使用者說「沒資料」
  if (!data) {
    return (
      <div className="space-y-5">
        {earlyHeader}
        <Card bodyClass="p-5" aria-busy="true"><SkeletonList rows={3} label="載入估驗資料中…" /></Card>
      </div>
    )
  }

  // 真專案但標單尚未匯入 DB → 估驗無法綁工項，先請匯入
  if (isSupabaseConfigured && currentProject && workItemsSource !== 'db') {
    return (
      <div className="space-y-5">
        {earlyHeader}
        <Card title="估驗計價">
          <PrerequisiteEmptyState
            need="估驗計價依標單工項的契約數量/單價逐項計價,此專案的標單尚未匯入。"
            unlocks="逐期估驗、請款收款、日誌累計帶入、請款佐證包"
            to={can.edit ? '/contract' : undefined} cta={can.edit ? '前往專案文件上傳標單' : undefined}
            who={!can.edit ? '待施工廠商匯入標單並提報估驗後即可檢視。' : undefined} />
        </Card>
      </div>
    )
  }

  const totalCum = roots.reduce((s, r) => s + (cumThis.get(r.item_key) || 0), 0)
  const totalPrev = roots.reduce((s, r) => s + (cumPrev.get(r.item_key) || 0), 0)
  const periodAmt = totalCum - totalPrev
  // 保留款比例:DB 欄位 not null default 5,?? 5 只為 demo/舊資料的缺值;三處顯示與計算同一個值
  const retPct = selected?.retention_pct ?? 5
  const ret = retPct / 100
  const completion = billableTotal ? (totalCum / billableTotal) * 100 : 0

  // 建立估驗期(新增一期/第 1 期共用):DB 成功才會拿到 v
  const onCreate = async () => {
    setErrMsg('')
    const { v, error } = await createValuation()
    if (error) setErrMsg(friendlyError(error, '建立估驗期未完成'))
    else setSelectedId(v.id)
  }

  const onStatus = async (status) => {
    setErrMsg('')
    const { error } = await setValuationStatus(selected.id, status)
    if (error) setErrMsg(friendlyError(error, '狀態更新未完成'))
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
    const stamp = taipeiToday() // 記入備註給人看的業務日期:台北日曆日,凌晨退回不落成前一天
    const note = `${selected.note ? `${selected.note}\n` : ''}${label}(${stamp})：${reason.trim()}`
    const { error } = await setValuationStatus(selected.id, '草稿', { note })
    if (error) setErrMsg(friendlyError(error, `${label}未完成`))
  }

  // 每列只收自己的純量與穩定 reference(memo 才會生效,理由見 ValuationRow.jsx 檔頭);
  // qtyInput 傳原值(可能 undefined):列內同時要「?? 0 算比例」與「?? '' 給輸入框」兩種預設
  const rowEl = (it, level) => (
    <ValuationRow key={it.item_key} it={it} level={level} hasKids={(childrenMap.get(it.item_key) || []).length > 0}
      isOpen={expanded.has(it.item_key)} evIsOpen={evOpen.has(it.item_key)}
      cum={cumThis.get(it.item_key) || 0} prevCum={cumPrev.get(it.item_key) || 0}
      qtyInput={selected?.items?.[it.item_key]} editable={editable} selectedId={selected?.id}
      getEvidence={getEvidence} onToggle={toggle} onToggleEv={toggleEv} onQty={onQty} />
  )
  const renderTree = (items, level = 0) =>
    items.flatMap((it) => {
      const kids = childrenMap.get(it.item_key) || []
      const row = rowEl(it, level)
      if (kids.length && expanded.has(it.item_key)) return [row, ...renderTree(kids, level + 1)]
      return [row]
    })

  return (
    <div className="space-y-5">
      <PageHeader title="估驗計價" tagline="Valuation"
        subtitle={`${coNet !== 0
          ? `變更後契約金額 ${yi(billableTotal)}（原發包 ${yi(billableTotal - coNet)}，核准追加減 ${coNet > 0 ? '+' : ''}${fmt(coNet)}）`
          : `發包工程費 ${yi(billableTotal)}`}（保留款 ${retPct}%）`}
        action={
          // 兩份輸出常被搞混(C-11):差異原本只寫在 title tooltip,手機根本讀不到。
          // 副文字常駐,講清楚哪一份是計價依據、哪一份只是佐證彙整。
          <div className="flex flex-wrap items-start gap-2">
            {selected && (
              <div className="flex flex-col gap-0.5 max-w-[10rem]">
                <Button variant="secondary" onClick={() => navigate(`/valuation/print?p=${selected.id}`)}><MSym name="print" size={15} />列印估驗單</Button>
                <span className="text-caption text-[var(--text-3)] leading-tight">正式計價金額文件</span>
              </div>
            )}
            {selected && (
              <div className="flex flex-col gap-0.5 max-w-[10rem]">
                <Button variant="secondary" onClick={() => navigate(`/valuation/package?p=${selected.id}`)} title="彙整本期估驗明細＋AI 施工說明＋佐證照片"><MSym name="auto_awesome" size={15} />組請款佐證包</Button>
                <span className="text-caption text-[var(--text-3)] leading-tight">佐證彙整，非正式計價單</span>
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
          {/* 期數頁籤:視圖切換走共用 CHIP 皮(與工作面分頁同語言)。
              狀態 Badge 必須留在 button 內——e2e 以 tabN.getByText('草稿') 斷言,搬出去會斷 */}
          <div className="flex items-center gap-2 flex-wrap">
            {valuations.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelectedId(v.id)}
                className={`${CHIP_BASE} gap-1.5 ${v.id === selected?.id ? CHIP_ON : CHIP_OFF}`}
              >
                第 {v.period_no} 期
                <Badge color={statusColor[v.status] || 'slate'}>{v.status}</Badge>
              </button>
            ))}
          </div>

          {/* 本期彙總 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <Stat label="本期估驗金額" value={fmt(periodAmt)} sub={`第 ${selected.period_no} 期`} color="text-[var(--blue-text)]" />
            <Stat label="累計估驗金額" value={fmt(totalCum)} sub={`占發包 ${completion.toFixed(1)}%`} />
            <Stat label="累計完成度" value={`${completion.toFixed(1)}%`} sub={`/ ${yi(billableTotal)}`} color="text-[var(--green-text)]" />
            <Stat label="本期保留款" value={fmt(periodAmt * ret)} sub={`${retPct}%`} color="text-[var(--text-2)]" />
            <Stat label="本期應付" value={fmt(periodAmt * (1 - ret))} sub="本期估驗 − 保留款" color="text-[var(--blue-text)]" />
          </div>

          {/* 本期決策列(W8-4B B2):先給「這期在誰手上、與日誌差在哪、我能按什麼」,
              再往下讀明細(W8-0 §7)。動作鈕從明細卡右上「搬」到這裡——絕非複製,
              e2e-real 對「核定估驗」等按鈕名是嚴格單一命中,全頁只准一顆。 */}
          <Surface className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 max-sm:flex-col max-sm:items-stretch">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-[var(--text)]">第 {selected.period_no} 期</span>
              <Badge color={statusColor[selected.status] || 'slate'}>{selected.status}</Badge>
              {/* BallChip 在「監造審核」的標籤與右側既有「待監造核定」Badge 同字,而
                  e2e-real 對該字是嚴格單一命中——非核定者視角只保留 Badge 那一處,
                  其餘狀態(含核定者視角)由 BallChip 標示責任方 */}
              {!(selected.status === '監造審核' && !can.approve) && <BallChip ball={valuationBall(selected)} />}
            </div>
            {/* 差異彙總走 Badge 五語意(顏色+文字並存);超計是可點展開的 Badge,tooltip 說明不變 */}
            <div className="flex items-center gap-2 text-xs flex-wrap">
              {diffSummary.over === 0 && diffSummary.noEvidence === 0 ? (
                <Badge color="green">與日誌相符</Badge>
              ) : (
                <>
                  {diffSummary.over > 0 && (
                    <button
                      onClick={() => setEvOpen((p) => new Set([...p, ...diffSummary.overKeys]))}
                      title="展開超計工項的佐證欄(估驗累計高於日誌累計逾 5%),逐項查核後再核定"
                      className="inline-flex items-center pressable max-md:min-h-11"
                    >
                      <Badge color="amber">超計 {diffSummary.over} 項</Badge>
                    </button>
                  )}
                  {diffSummary.noEvidence > 0 && (
                    <span className="inline-flex" title="有計價但查無任何日誌/查驗/檢查表/試體對應"><Badge color="slate">無佐證 {diffSummary.noEvidence} 項</Badge></span>
                  )}
                </>
              )}
            </div>
            {/* Button 已內建 max-md:min-h-11,這裡只留手機滿版 */}
            <div className="flex items-center gap-2 sm:ml-auto max-sm:flex-col max-sm:items-stretch">
              {selected.status === '草稿' && can.submit && <Button variant="secondary" className="max-sm:w-full" onClick={() => onStatus('監造審核')}>送監造審核</Button>}
              {selected.status === '監造審核' && (can.approve ? <>
                <Button variant="ghost" className="max-sm:w-full" onClick={() => onReject('退回')}>退回</Button>
                <Button variant="success" className="max-sm:w-full" onClick={() => onStatus('已核定')}>核定估驗</Button>
              </> : <Badge color="amber">待監造核定</Badge>)}
              {selected.status === '已核定' && can.approve &&
                <Button variant="ghost" className="max-sm:w-full" onClick={() => onReject('退回核定')}>退回核定</Button>}
              {/* 僅草稿可刪(送審/核定後為履約證據,DB 另有 valuations_delete_guard;R4 P2-01)。
                  真刪除走 danger 實心紅,不再用 className 蓋 ghost 色票 */}
              {can.edit && selected.status === '草稿' && <Button variant="danger" onClick={async () => { if (await appConfirm({ title: `刪除第 ${selected.period_no} 期估驗？`, danger: true, confirmLabel: '刪除' })) { setErrMsg(''); const { error } = await deleteValuation(selected.id); if (error) setErrMsg(friendlyError(error, '估驗刪除未完成')); else setSelectedId(null) } }} className="max-sm:w-full" aria-label="刪除估驗期"><MSym name="delete" size={15} /></Button>}
            </div>
          </Surface>

          <Card
            title={`第 ${selected.period_no} 期 估驗明細`}
            bodyClass="p-0"
            action={
              <div className="flex items-center gap-2">
                {/* !w-40:FIELD_BASE 是 w-full,卡頭行內搜尋框需要定寬(比照 Agent.jsx 的 !w-24) */}
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋工項…" className="!w-40" />
                {/* 這顆是確定性引擎(fillValuationFromSiteLogs 逐日加總,無任何模型呼叫),
                    原本卻掛「AI 估驗草擬」的名字與 Sparkles——既違反「數字由確定性引擎算」
                    的對外敘事,也讓使用者以為不開 AI 就填不了數量(C-9)。 */}
                {selected.status === '草稿' && can.edit && siteLogs.length > 0 && (
                  <Button onClick={async () => { setFilling(true); setErrMsg(''); const { count, error } = await fillValuationFromSiteLogs(selected.id); setFilling(false); if (error) { setErrMsg(friendlyError(error, '帶入未寫入')); return } setFillMsg(count ? `已依 ${siteLogs.length} 筆施工日誌帶入 ${count} 個工項累計，請覆核後送審。` : '施工日誌中查無可帶入的完成數量。') }} disabled={filling} title="依施工日誌逐日完成數量加總，帶入本期各工項累計完成數量（確定性計算，不經 AI）">
                    <MSym name="calculate" size={14} />{filling ? '帶入中…' : '帶入日誌累計'}
                  </Button>
                )}
              </div>
            }
          >
            {/* 卡體 p-0(表格出血到卡緣),表格前的訊息各自補 mx-5 邊距 */}
            {fillMsg && editable && (
              <div className="mx-5 mt-4 flex items-start gap-2.5 text-sm bg-[var(--blue-tint)] text-[var(--blue-text)] rounded-lg px-3.5 py-2.5">
                <MSym name="calculate" size={18} className="shrink-0 mt-px" />
                <span>{fillMsg}</span>
              </div>
            )}
            {!editable && <p className="text-xs text-[var(--amber-text)] mx-5 mt-3">本期狀態為「{selected.status}」，明細唯讀。</p>}
            {selected.note && (
              <p className="text-xs text-[var(--amber-text)] mx-5 mt-3 whitespace-pre-line">本期備註：{selected.note}</p>
            )}
            <div className="overflow-x-auto">
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
                  {/* 表頭字型層走共用 THEAD_CLS;p-0 卡的表格左右緣一律 pl-5/pr-5 與卡內距對齊 */}
                  <tr className="border-b border-[var(--border)]">
                    <th className={`${THEAD_CLS} text-left py-2 pl-5`}>項次 / 工項名稱</th>
                    <th className={`${THEAD_CLS} text-right px-2 whitespace-nowrap`}>單位</th>
                    <th className={`${THEAD_CLS} text-right px-2 whitespace-nowrap`}>契約數量</th>
                    <th className={`${THEAD_CLS} text-right px-2 whitespace-nowrap`}>單價</th>
                    <th className={`${THEAD_CLS} text-right px-2 whitespace-nowrap`}>累計完成數量</th>
                    <th className={`${THEAD_CLS} text-right px-2 whitespace-nowrap`}>累計金額</th>
                    <th className={`${THEAD_CLS} text-right px-2 whitespace-nowrap`}>本期金額</th>
                    <th className={`${THEAD_CLS} text-left px-2 pr-5 whitespace-nowrap`}>佐證</th>
                  </tr>
                </thead>
                <tbody>
                  {search ? leaves.map((it) => rowEl(it, 0)) : renderTree(roots)}
                  {search && matchCount > leaves.length && (
                    <tr><td colSpan={8} className="py-2 px-5 text-xs text-[var(--text-3)]">
                      符合 {matchCount} 筆,僅顯示前 {leaves.length} 筆——請輸入更精確的關鍵字或工項編號。
                    </td></tr>
                  )}
                </tbody>
                <tfoot>
                  {/* 合計沿用既有確定性彙總(totalCum/periodAmt 由 boqCalc 樹加總而來),不另行重算;
                      搜尋模式只過濾顯示列,合計仍是全期口徑 */}
                  <tr className="bg-[var(--surface-2)] font-medium border-t border-[var(--border)]">
                    <td className="py-2 pl-5 pr-2">合計</td>
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
