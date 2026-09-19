import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { Card, Stat, Badge, Button, BallChip, Empty, Surface, PageHeader, PrerequisiteEmptyState, ErrorBanner, SkeletonList, Input, MobileReadOnlyNote, THEAD_CLS } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { CHIP_BASE, CHIP_ON, CHIP_OFF } from '../../components/PageTabs.jsx'
import { appConfirm, appPrompt } from '../../components/confirm.jsx'
import { buildBillableTree, buildCumMap, totalCumAmount } from '../../lib/boqCalc.js'
import { collectEvidence } from '../../lib/evidence.js'
import { buildValuationChecks, describeViolation } from '../../lib/valuationChecks.js'
import { valuationBall } from '../../lib/ballInCourt.js'
import { taipeiToday } from '../../lib/dates.js'
import { fmtAmount as fmt, fmtYi as yi } from '../../lib/format.js'
import ValuationRow from '../../components/valuation/ValuationRow.jsx' // memo 列:數千列標單的效能槓桿
import BacklogCard from '../../components/valuation/BacklogCard.jsx'
import ChecksCard from '../../components/valuation/ChecksCard.jsx'
import CertificateForm from '../../components/valuation/CertificateForm.jsx'
import AdjustmentsCard from '../../components/valuation/AdjustmentsCard.jsx'

// P4c:估驗頁只顯示 DB 的結果——數量、金額、上限、來源、缺件全部來自 P4b 的 RPC
// (get_valuation_state／list_billable_backlog),寫入只走 RPC(store/slices/billing.js)。
// 未經監造確認的申報量可以看(標「申報,未確認,不計價」),但不混入可請款金額;
// 送審／核定／請款由 DB 檢查點強制,這裡在送審前就把缺件列出來並給處理入口。
// P4d:撤銷／減量／補證／作廢也在這一頁——監造在來源展開列對「有效確認」撤銷或減量、簽發監造確認單、
// 對已核定期的歷史遷移來源「補證此期」(issue_supervisor_certificate 帶 p_covers_valuation_id);
// 機關在「估驗調整」卡作廢待處理扣回;廠商看得到補證狀態與扣回影響、知道下一步由誰處理。

const statusColor = { 草稿: 'slate', 監造審核: 'amber', 已核定: 'green', 已請款: 'green' }

// 撤銷確認後 DB 的收斂結果(revoke_inspection_confirmation 回傳 effects 的 event_type)→ 人話
const EFFECT_TEXT = {
  'valuation.allocation_reduced': '草稿期的分配已縮減',
  'valuation.recheck_flagged': '送審中的期別已標記需重算(退回後同步)',
  'valuation_adjustment.created': '已核定量轉成待處理扣回(由機關作廢或於草稿期同步時扣回)',
}

// 搜尋結果上限:真實 PCCES 標單有數千末端工項,一次渲染整包搜尋結果會卡住頁面(P1-3)
const SEARCH_LIMIT = 120

// VQ004(檢查點不成立)的 detail 是逐工項違反清單;VQ006(超上限)的 detail 帶上限數字。
// 錯誤橫幅顯示 DB 的訊息(繁中原樣)＋翻成人話的清單,使用者知道「為什麼」與「該做什麼」。
function describeVqError(error, keyOf, itemOf, fallback) {
  const base = friendlyError(error, fallback)
  if (!error?.code) return { msg: base, lines: [] }
  if (error.code === 'VQ004' && Array.isArray(error.detail)) {
    const lines = error.detail.map((v) => {
      const d = describeViolation(v)
      const key = d.work_item_id ? keyOf(d.work_item_id) : null
      const it = key != null ? itemOf(key) : null
      return `${d.label}${it ? `(${it.item_no} ${it.description})` : ''}:${d.hint}`
    })
    return { msg: `送出被資料庫檢查點擋下:${base}`, lines: [...new Set(lines)] }
  }
  if (error.code === 'VQ006' && error.detail && typeof error.detail === 'object') {
    const d = error.detail
    const n = (x) => fmt(x, { empty: '0' })
    const lines = [`前期累計 ${n(d.prev_cum)}・本期起算值 ${n(d.floor)}・本期最多可新增 ${n(d.limit ?? d.cap)}・可用確認量 ${n(d.cap)}・你填的 ${n(d.wanted)}`]
    if (d.basis === null) lines.push('總價／間接費工項缺計價依據,暫時隔離不計價(由監造設定計價依據)。')
    return { msg: base, lines }
  }
  return { msg: base, lines: [] }
}

export default function Valuation() {
  const { workItems: data, valuations, valuationAdjustments, createValuation, updateValuationItem, setValuationStatus, setValuationPeriodEnd,
    syncValuation, fetchValuationState, fetchBillableBacklog, fetchConfirmations, setPricingBasis, listMembers,
    revokeConfirmation, issueCertificate, voidAdjustment, currentUser,
    isSupabaseConfigured, currentProject, workItemsSource, siteLogs, deleteValuation, dbMode,
    inspections, checklistRecords, checklistTemplates, testSamples,
    adjustedItems, coNet, revisedTotal, can } = useStore()
  const [errMsg, setErrMsg] = useState('') // DB 寫入失敗的訊息(不偽裝成功)
  const [errLines, setErrLines] = useState([]) // VQ004／VQ006 的逐項人話
  const [notice, setNotice] = useState('') // 同步結果等非錯誤訊息
  const [syncing, setSyncing] = useState(false)
  const [inputEpoch, setInputEpoch] = useState(0) // DB 拒絕數量後 bump,輸入框回到 DB 的值
  const [vstate, setVstate] = useState(null) // get_valuation_state(選中期別)
  const [stateLoading, setStateLoading] = useState(false)
  const [backlog, setBacklog] = useState({ rows: [], loading: false })
  const [confirmations, setConfirmations] = useState([])
  const [members, setMembers] = useState([])
  const [certTarget, setCertTarget] = useState(null) // P4d:監造確認單表單(簽發／減量／補證)的對象
  const [certBusy, setCertBusy] = useState(false)
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(() => new Set())
  const [evOpen, setEvOpen] = useState(() => new Set()) // 現場紀錄欄展開的工項
  const [srcOpen, setSrcOpen] = useState(() => new Set()) // 來源欄展開的工項
  const [params, setParams] = useSearchParams()
  const { state: navState } = useLocation()
  const selectedId = params.get('period')
  const choosePeriod = (id) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (id) next.set('period', id)
      else next.delete('period')
      return next
    }, { replace: true, state: navState })
  }
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
  const keyToItem = useMemo(() => new Map((data?.items || []).map((it) => [it.item_key, it])), [data])
  const idToKey = useMemo(() => new Map((data?.items || []).filter((it) => it.id).map((it) => [it.id, it.item_key])), [data])
  const keyOf = useCallback((uuid) => idToKey.get(uuid) ?? null, [idToKey])
  const itemOf = useCallback((key) => keyToItem.get(key), [keyToItem])

  const selected = selectedId ? valuations.find((v) => v.id === selectedId) : valuations[valuations.length - 1]
  const prev = selected ? valuations.find((v) => v.period_no === selected.period_no - 1) : null
  const editable = selected?.status === '草稿' && can.edit
  const draft = useMemo(() => [...valuations].filter((v) => v.status === '草稿').sort((a, b) => a.period_no - b.period_no)[0] || null, [valuations])
  const projectId = currentProject?.project_id

  // ── DB 唯讀狀態:期別狀態／可估驗清單／確認紀錄／成員名字。valuations 一變(任何寫入成功後 store 重載)就重取 ──
  useEffect(() => {
    if (!dbMode || !selected?.id) { setVstate(null); return }
    let active = true
    setStateLoading(true)
    fetchValuationState(selected.id).then(({ state, error }) => {
      if (!active) return
      setStateLoading(false)
      if (error) { setVstate(null); setErrMsg(friendlyError(error, '本期狀態載入失敗')); return }
      setVstate(state)
    })
    return () => { active = false }
  }, [dbMode, selected?.id, valuations, fetchValuationState])
  useEffect(() => {
    if (!dbMode || !projectId) { setBacklog({ rows: [], loading: false }); return }
    let active = true
    setBacklog((b) => ({ ...b, loading: true }))
    fetchBillableBacklog().then(({ rows, error }) => {
      if (!active) return
      setBacklog({ rows, loading: false })
      if (error) setErrMsg(friendlyError(error, '可估驗清單載入失敗'))
    })
    return () => { active = false }
  }, [dbMode, projectId, valuations, fetchBillableBacklog])
  useEffect(() => {
    if (!dbMode || !projectId) { setConfirmations([]); return }
    let active = true
    fetchConfirmations().then(({ rows }) => { if (active) setConfirmations(rows) })
    return () => { active = false }
  }, [dbMode, projectId, valuations, fetchConfirmations])
  useEffect(() => {
    if (!dbMode || !projectId) { setMembers([]); return }
    let active = true
    listMembers().then(({ rows }) => { if (active) setMembers(rows || []) })
    return () => { active = false }
  }, [dbMode, projectId, listMembers])

  const confirmationsById = useMemo(() => new Map(confirmations.map((c) => [c.id, c])), [confirmations])
  // 本工項的 active 確認(item_key → 陣列;撤銷／減量的對象)。同一 reference 直到 confirmations 變動,列的 memo 才有效
  const activeByKey = useMemo(() => {
    const m = new Map()
    for (const c of confirmations) {
      if (c.status !== 'active') continue
      const k = keyOf(c.work_item_id); if (k == null) continue
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(c)
    }
    return m
  }, [confirmations, keyOf])
  const EMPTY_CONFS = useMemo(() => [], [])
  const periodNoOf = useCallback((id) => (id ? (valuations.find((v) => v.id === id)?.period_no ?? null) : null), [valuations])
  // 撤銷／簽發／補證是監造的動作(DB 以 my_org_type 強制;can.approve 只是 UX);作廢是機關的動作
  const canManage = dbMode && can.approve
  const canVoid = dbMode && currentUser?.org_type === 'owner'
  const inspectionsById = useMemo(() => new Map((inspections || []).filter((i) => i.id).map((i) => [i.id, i])), [inspections])
  const memberName = useMemo(() => {
    const m = new Map(members.map((r) => [r.user_id, r.full_name || r.company || r.user_id]))
    return (uid) => (uid ? (m.get(uid) || `成員 ${String(uid).slice(0, 8)}`) : '—')
  }, [members])
  // 逐工項 DB 狀態(item_key → cq_item_state ＋ sources)
  const stateByKey = useMemo(() => {
    const m = new Map()
    for (const it of vstate?.items || []) { const k = keyOf(it.work_item_id); if (k != null) m.set(k, it) }
    return m
  }, [vstate, keyOf])

  // 缺件與檢核(單一口徑 lib/valuationChecks.js):DB 缺件＋勾稽發現＋逐工項標示
  const checks = useMemo(() => {
    if (!data || !selected) return { findings: [], itemFlags: new Map(), summary: { block: 0, risk: 0, warn: 0, checked: 0, overKeys: [], noLogKeys: [], unbackedKeys: [] } }
    return buildValuationChecks({ adjustedItems, childrenMap, siteLogs, billedItems: selected.items, inspections, testSamples, state: vstate, idToKey })
  }, [data, selected, adjustedItems, childrenMap, siteLogs, inspections, testSamples, vstate, idToKey])

  // 可請款投影:核定前的期別(草稿／監造審核),有缺件的工項本期增量屬「申報,未確認,不計價」——
  // 該工項回到前期累計(DB 的值),不混入本期可請款金額;已核定／已請款期別是歷史帳,不動。
  const excludeUnbacked = !!selected && (selected.status === '草稿' || selected.status === '監造審核')
  const billable = useMemo(() => {
    if (!selected) return null
    const keys = checks.summary.unbackedKeys
    if (!excludeUnbacked || keys.length === 0) return selected
    const items = { ...selected.items }, amounts = { ...selected.amounts }
    for (const k of keys) {
      if (prev && Object.prototype.hasOwnProperty.call(prev.items, k)) { items[k] = prev.items[k]; amounts[k] = prev.amounts?.[k] }
      else { delete items[k]; delete amounts[k] }
    }
    return { ...selected, items, amounts }
  }, [selected, prev, excludeUnbacked, checks.summary.unbackedKeys])

  const cumThis = useMemo(() => buildCumMap(roots, childrenMap, billable), [roots, childrenMap, billable])
  const cumPrev = useMemo(() => buildCumMap(roots, childrenMap, prev), [roots, childrenMap, prev])

  // 手機期別摘要用的逐期金額(規範 §9.6:標單樹不進手機,改列每期金額與狀態)。
  // 走 boqCalc 的 buildCumMap/totalCumAmount——與 /payments 的逐期表同一組函式、
  // 同一條「本期 = 本期累計 − 前期累計」的定義;UI 不重算金額(§1 三條不可退讓)。
  // 桌機不渲染這份清單,但 hook 必須無條件呼叫(2026-08-12 hooks 順序事故的同型地雷)。
  const periodRows = useMemo(() => {
    let prevCum = 0
    return [...valuations].sort((a, b) => a.period_no - b.period_no).map((v) => {
      const cum = totalCumAmount(roots, buildCumMap(roots, childrenMap, v))
      const amt = cum - prevCum; prevCum = cum
      return { v, cum, amt }
    })
  }, [valuations, roots, childrenMap])

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

  // 現場紀錄推導(批5):純計算但末端工項可能上千——不預先算全部,只對「實際渲染到畫面
  // 的列」惰性計算並快取;資料變動時 useMemo 重建快取。推導規則在 lib/evidence.js。
  const getEvidence = useMemo(() => {
    // 檢查表紀錄只有 template_id,顯示用標題由範本去正規化補上
    const tmap = new Map((checklistTemplates || []).map((t) => [t.id, t.title]))
    const records = (checklistRecords || []).map((r) => ({ ...r, title: tmap.get(r.template_id) || r.title || '自主檢查表' }))
    const deps = { siteLogs, inspections, checklistRecords: records, testSamples, wiMaps: { idToKey } }
    const cache = new Map()
    return (it) => {
      let ev = cache.get(it.item_key)
      if (!ev) { ev = collectEvidence(it.item_key, { ...deps, workItem: it }); cache.set(it.item_key, ev) }
      return ev
    }
  }, [siteLogs, inspections, checklistRecords, checklistTemplates, testSamples, idToKey])

  // 列的 callback 一律釘住 identity(useCallback),否則 ValuationRow 的 memo 形同虛設。
  const toggle = useCallback((key) => setExpanded((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n }), [])
  const toggleEv = useCallback((key) => setEvOpen((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n }), [])
  const toggleSrc = useCallback((key) => setSrcOpen((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n }), [])
  const expandKeys = useCallback((keys) => {
    setSrcOpen((p) => new Set([...p, ...keys]))
    setEvOpen((p) => new Set([...p, ...keys]))
    // 祖先全部展開,列才看得到
    setExpanded((p) => {
      const n = new Set(p)
      for (const k of keys) { let it = keyToItem.get(k); while (it?.parent_key) { n.add(it.parent_key); it = keyToItem.get(it.parent_key) } }
      return n
    })
  }, [keyToItem])

  const showError = useCallback((error, fallback) => {
    const { msg, lines } = describeVqError(error, keyOf, itemOf, fallback)
    setErrMsg(msg); setErrLines(lines)
  }, [keyOf, itemOf])
  const clearError = () => { setErrMsg(''); setErrLines([]) }

  // 輸入「累計完成數量」:onBlur 才寫入(P1-3)。上限不在前端算——目標累計量交給 set_valuation_item_cum,
  // 超出可計價上限回 VQ006(帶前期／上限／可用量),輸入框回到 DB 的值。
  // 本體依賴 selected——走 ref:對外 identity 永遠不變,內部永遠讀最新的 selected。
  const onQtyRef = useRef(null)
  onQtyRef.current = async (it, val) => {
    const existing = selected?.items?.[it.item_key]
    if (val === '' && existing == null) return          // 沒填過又留空:不寫 0 列
    let n = parseFloat(val)
    if (isNaN(n) || n < 0) n = 0
    if (existing != null && Number(existing) === n) return // 無變化不寫
    clearError()
    const { error } = await updateValuationItem(selected.id, it.item_key, n)
    if (error) { showError(error, `數量未儲存（${it.item_no || it.item_key}）`); setInputEpoch((e) => e + 1) }
  }
  const onQty = useCallback((it, val) => onQtyRef.current(it, val), [])
  const onSetBasis = useCallback(async (it, basis) => {
    clearError()
    const { error } = await setPricingBasis(it.item_key, basis)
    if (error) showError(error, `計價依據未設定（${it.item_no || it.item_key}）`)
    else setNotice(`已設定 ${it.item_no} 的計價依據;同步確認量後即可計價。`)
  }, [setPricingBasis, showError])

  // ── P4d:撤銷／減量／簽發／補證／作廢。全部由 DB 決定結果,這裡只收意圖、顯示後果 ──
  const onRevoke = useCallback(async (it, c) => {
    const reason = await appPrompt({
      title: `撤銷確認：${it.item_no} ${it.description}`, label: `批次 ${c.location_label || c.batch_key}、累計 ${fmt(c.qty_cum, { empty: '0' })} ${c.unit}。撤銷原因（必填，記入稽核）`,
      required: true, danger: true, confirmLabel: '撤銷確認',
    })
    if (reason === null) return
    clearError(); setNotice('')
    const { result, error } = await revokeConfirmation(c.id, reason)
    if (error) { showError(error, '撤銷未完成'); return }
    const effects = [...new Set((result?.effects || []).map((e) => EFFECT_TEXT[e.event_type]).filter(Boolean))]
    setNotice(`已撤銷 ${it.item_no} 批次 ${c.location_label || c.batch_key} 的確認${effects.length ? `:${effects.join(';')}` : ';沒有期別受影響'}。`)
  }, [revokeConfirmation, showError])
  const onReduce = useCallback((it, c) => {
    clearError(); setNotice('')
    setCertTarget({ it, mode: 'reduce', batchKey: c.batch_key, locationLabel: c.location_label, stageKey: c.stage_key, qtyCum: c.qty_cum, currentCum: c.qty_cum, requestId: crypto.randomUUID() })
  }, [])
  const onIssue = useCallback((it) => {
    clearError(); setNotice('')
    setCertTarget({ it, mode: 'issue', requestId: crypto.randomUUID() })
  }, [])
  // 表單以 ref 讀最新的 selected:onCover 的 identity 不隨期別變(列的 memo)
  const selectedRef = useRef(null)
  selectedRef.current = selected
  const onCover = useCallback((it, legacyQty) => {
    const v = selectedRef.current
    if (!v) return
    clearError(); setNotice('')
    setCertTarget({ it, mode: 'cover', covers: { id: v.id, period_no: v.period_no, status: v.status, legacyQty }, qtyCum: legacyQty, requestId: crypto.randomUUID() })
  }, [])
  const onCertSubmit = async (form) => {
    if (!certTarget) return
    clearError(); setCertBusy(true)
    const { result, error } = await issueCertificate({ ...form, clientRequestId: certTarget.requestId })
    setCertBusy(false)
    if (error) { showError(error, '監造確認單未簽發'); return }
    const it = certTarget.it
    const covers = certTarget.mode === 'cover' ? certTarget.covers : null
    setCertTarget(null)
    if (result?.applied === false) { setNotice(`同一張確認單已處理過(冪等),未重複入帳。`); return }
    setNotice(`已簽發 ${it.item_no} 批次 ${result?.batch_key || form.batchKey} 的監造確認單:累計 ${fmt(result?.qty_cum ?? form.qtyCum, { empty: '0' })} ${it.unit || ''}、增量 ${fmt(result?.qty_delta, { empty: '0' })}${covers ? `;第 ${covers.period_no} 期此工項的歷史遷移量已改以本確認單為計價依據` : ';已同步到適用的草稿期'}。`)
  }
  const onVoid = useCallback(async (a, w) => {
    const reason = await appPrompt({
      title: `作廢扣回：${w.label}`, label: `扣回 ${fmt(a.qty_delta, { empty: '0' })} ${w.unit}。作廢＝機關接受該量已計價,不再擋核定、也不會產生新的可用量。作廢原因（必填，記入稽核）`,
      required: true, danger: true, confirmLabel: '作廢(接受已計價)',
    })
    if (reason === null) return
    clearError(); setNotice('')
    const { error } = await voidAdjustment(a.id, reason)
    if (error) { showError(error, '作廢未完成'); return }
    setNotice(`已作廢 ${w.label} 的扣回 ${fmt(a.qty_delta, { empty: '0' })} ${w.unit}:該量視為已計價,下一期核定不再被它擋下。`)
  }, [voidAdjustment, showError])

  // 早退也保留 PageHeader:工作面分頁列(PageTabs)長在 PageHeader 裡,早退不帶頁首
  // 等於整條分頁列消失;平板(768–1279)與收合側欄的 icon rail 又不列子頁,
  // 使用者會被關在載入/前置條件畫面裡,換不到同工作面的其他頁。
  const earlyHeader = <PageHeader title="估驗計價" tagline="Valuation" />
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
            unlocks="逐期估驗、監造確認量同步、請款收款、請款佐證包"
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
  const unbackedCount = excludeUnbacked ? checks.summary.unbackedKeys.length : 0

  // 建立估驗期:計價截止日必填(Q7);DB 建期後自動同步可估驗的確認量
  const onCreate = async () => {
    const nextNo = valuations.length ? Math.max(...valuations.map((v) => v.period_no)) + 1 : 1
    const periodEnd = await appPrompt({
      title: `建立第 ${nextNo} 期估驗`, label: '計價截止日(本期計價截至哪一天;送審必填,只計入截止日前的監造確認量)',
      inputType: 'date', defaultValue: taipeiToday(), required: true, confirmLabel: '建立估驗期',
    })
    if (periodEnd === null) return
    clearError(); setNotice('')
    const { v, error } = await createValuation({ periodEnd })
    if (error) showError(error, '建立估驗期未完成')
    else choosePeriod(v.id)
  }
  const onEditPeriodEnd = async () => {
    const d = await appPrompt({
      title: `第 ${selected.period_no} 期計價截止日`, label: '本期計價截至哪一天(只計入截止日前的監造確認量)',
      inputType: 'date', defaultValue: selected.period_end || taipeiToday(), required: true, confirmLabel: '儲存',
    })
    if (d === null) return
    clearError()
    const { error } = await setValuationPeriodEnd(selected.id, d)
    if (error) showError(error, '計價截止日未更新')
  }
  const onSync = async () => {
    const periodId = selected?.id
    if (!periodId) return
    clearError(); setNotice(''); setSyncing(true)
    const { result, error } = await syncValuation(periodId)
    setSyncing(false)
    if (error) { showError(error, '同步未完成'); return }
    const n = Array.isArray(result?.items) ? result.items.filter((i) => Number(i.added) > 0).length : 0
    setNotice(`已依監造確認量同步:${n} 個工項有新增量${result?.adjustments_applied ? `,併入 ${result.adjustments_applied} 筆扣回` : ''};未經確認的申報量已被取代。`)
  }

  const onStatus = async (status) => {
    clearError(); setNotice('')
    const { error } = await setValuationStatus(selected.id, status)
    if (error) showError(error, '狀態更新未完成')
  }
  // 退回(監造審核→草稿)與退回核定(已核定→草稿):原因必填,記入本期備註(P1-01/02)。
  // 已核定期若已登錄請款/收款,DB 會擋下並指引先清空——錯誤原樣顯示。
  const onReject = async (label) => {
    const reason = await appPrompt({
      title: `${label}：第 ${selected.period_no} 期`, label: `${label}原因（必填，記入本期備註）`,
      required: true, danger: true, confirmLabel: label,
    })
    if (reason === null) return
    clearError()
    const stamp = taipeiToday() // 記入備註給人看的業務日期:台北日曆日,凌晨退回不落成前一天
    const note = `${selected.note ? `${selected.note}\n` : ''}${label}(${stamp})：${reason.trim()}`
    const { error } = await setValuationStatus(selected.id, '草稿', { note })
    if (error) showError(error, `${label}未完成`)
  }

  // 每列只收自己的純量與穩定 reference(memo 才會生效,理由見 ValuationRow.jsx 檔頭)
  const rowEl = (it, level) => (
    <ValuationRow key={it.item_key} it={it} level={level} hasKids={(childrenMap.get(it.item_key) || []).length > 0}
      isOpen={expanded.has(it.item_key)} evIsOpen={evOpen.has(it.item_key)} srcIsOpen={srcOpen.has(it.item_key)}
      cum={cumThis.get(it.item_key) || 0} prevCum={cumPrev.get(it.item_key) || 0}
      qtyInput={selected?.items?.[it.item_key]} editable={editable} selectedId={selected?.id} inputEpoch={inputEpoch}
      state={stateByKey.get(it.item_key)} flags={checks.itemFlags.get(it.item_key)} basisEditable={dbMode && can.approve}
      confirmationsById={confirmationsById} inspectionsById={inspectionsById} nameOf={memberName}
      activeConfirmations={activeByKey.get(it.item_key) || EMPTY_CONFS} periodStatus={selected?.status} canManage={canManage}
      onRevoke={onRevoke} onReduce={onReduce} onIssue={onIssue} onCover={onCover}
      getEvidence={getEvidence} onToggle={toggle} onToggleEv={toggleEv} onToggleSrc={toggleSrc} onQty={onQty} onSetBasis={onSetBasis} />
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
      <PageHeader title="估驗計價" tagline="Valuation" keepSubtitle
        subtitle={`${coNet !== 0
          ? `變更後契約金額 ${yi(billableTotal)}（原發包 ${yi(billableTotal - coNet)}，核准追加減 ${coNet > 0 ? '+' : ''}${fmt(coNet)}）`
          : `發包工程費 ${yi(billableTotal)}`}（保留款 ${retPct}%）`}
        action={
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
            {/* 新增估驗期是寫入:手機不渲染(§9.6,五個表格頁的寫入一律留在桌機) */}
            {can.edit && <Button variant="secondary" className="max-md:hidden" onClick={onCreate}>＋ 新增估驗期</Button>}
          </div>
        } />

      <ErrorBanner msg={errMsg} onClose={clearError} />
      {errLines.length > 0 && errMsg && (
        <ul className="-mt-3 ml-1 space-y-0.5 text-footnote text-[var(--red-text)] list-disc pl-5" aria-label="被擋下的原因">
          {errLines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
      {notice && (
        <div className="flex items-start gap-2.5 text-sm bg-[var(--blue-tint)] text-[var(--blue-text)] rounded-lg px-3.5 py-2.5" role="status">
          <MSym name="check_circle" size={18} className="shrink-0 mt-px" />
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice('')} className="shrink-0 p-2 -m-1 opacity-60 hover:opacity-100" aria-label="關閉訊息">✕</button>
        </div>
      )}

      {/* 可估驗清單:未開期先累積;有草稿期時廠商可同步 */}
      <BacklogCard rows={backlog.rows} loading={backlog.loading} demo={!dbMode} draft={draft}
        keyOf={keyOf} onLocate={(key) => { if (draft && selected?.id !== draft.id) choosePeriod(draft.id); expandKeys([key]) }} />

      {valuations.length === 0 ? (
        <Card>
          <Empty>
            尚無估驗期。每期對截止日前經監造確認的完成量提報估驗，系統依標單單價由資料庫計算本期/累計金額與保留款。
            {/* 同上:建立估驗期是寫入,手機不渲染(§9.6) */}
            {can.edit && <div className="mt-4 max-md:hidden"><Button onClick={onCreate}>建立第 1 期估驗</Button></div>}
          </Empty>
        </Card>
      ) : !selected ? (
        <Card><Empty title="找不到指定的估驗期">該期別可能已移除，請重新選擇。<div className="mt-3"><Button variant="outline" onClick={() => choosePeriod(null)}>查看現有估驗期</Button></div></Empty></Card>
      ) : (
        <>
          {/* 期數頁籤:視圖切換走共用 CHIP 皮(與工作面分頁同語言)。
              狀態 Badge 必須留在 button 內——e2e 以 tabN.getByText('草稿') 斷言,搬出去會斷 */}
          <div className="flex items-center gap-2 flex-wrap">
            {valuations.map((v) => (
              <button
                key={v.id}
                onClick={() => choosePeriod(v.id)}
                className={`${CHIP_BASE} gap-1.5 ${v.id === selected?.id ? CHIP_ON : CHIP_OFF}`}
              >
                第 {v.period_no} 期
                <Badge color={statusColor[v.status] || 'slate'}>{v.status}</Badge>
              </button>
            ))}
          </div>

          {/* 本期彙總:全部由 DB 的逐工項金額加總;核定前的期別排除未確認申報量 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <Stat label={excludeUnbacked ? '本期可請款金額' : '本期估驗金額'} value={fmt(periodAmt)}
              sub={unbackedCount ? `另 ${unbackedCount} 項申報未確認,不計價` : `第 ${selected.period_no} 期`} color="text-[var(--blue-text)]" />
            <Stat label="累計估驗金額" value={fmt(totalCum)} sub={`占發包 ${completion.toFixed(1)}%`} />
            <Stat label="累計完成度" value={`${completion.toFixed(1)}%`} sub={`/ ${yi(billableTotal)}`} color="text-[var(--green-text)]" />
            <Stat label="本期保留款" value={fmt(periodAmt * ret)} sub={`${retPct}%`} color="text-[var(--text-2)]" />
            <Stat label="本期應付" value={fmt(periodAmt * (1 - ret))} sub="本期估驗 − 保留款" color="text-[var(--blue-text)]" />
          </div>

          {/* 本期決策列(W8-4B B2):先給「這期在誰手上、截止日、缺件與差異、我能按什麼」,
              再往下讀明細(W8-0 §7)。e2e-real 對「核定估驗」等按鈕名是嚴格單一命中,全頁只准一顆。 */}
          <Surface className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 max-sm:flex-col max-sm:items-stretch">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-[var(--text)]">第 {selected.period_no} 期</span>
              <Badge color={statusColor[selected.status] || 'slate'}>{selected.status}</Badge>
              {/* BallChip 在「監造審核」的標籤與右側既有「待監造核定」Badge 同字,而
                  e2e-real 對該字是嚴格單一命中——非核定者視角只保留 Badge 那一處 */}
              {!(selected.status === '監造審核' && !can.approve) && <BallChip ball={valuationBall(selected)} />}
              {/* 計價截止日(Q7):草稿可改;非草稿只顯示 */}
              {editable ? (
                <button onClick={onEditPeriodEnd} className="inline-flex items-center gap-1 text-xs text-[var(--blue-text)] hover:underline pressable max-md:min-h-11" title="本期計價截至哪一天(送審必填;只計入截止日前的監造確認量)">
                  <MSym name="event" size={13} />計價截止日 {selected.period_end || '未填'}
                </button>
              ) : (
                <span className="text-xs text-[var(--text-2)]">計價截止日 {selected.period_end || '未填'}</span>
              )}
            </div>
            {/* 缺件與差異的計數走 Badge 五語意;點缺件／超前可展開對應列 */}
            <div className="flex items-center gap-2 text-xs flex-wrap">
              {checks.summary.block > 0 && (
                <button onClick={() => expandKeys(checks.findings.filter((f) => f.status === 'block').flatMap((f) => f.keys || []))}
                  title="資料庫檢查點會擋下送審／核定／請款的項目,見下方「缺件與檢核」" className="inline-flex items-center pressable max-md:min-h-11">
                  <Badge color="red">缺件 {checks.summary.block} 項</Badge>
                </button>
              )}
              {checks.summary.overKeys.length > 0 && (
                <button onClick={() => expandKeys(checks.summary.overKeys)} title="估驗累計高於日誌申報累計逾 5%;申報未確認不計價,逐項查核後再核定" className="inline-flex items-center pressable max-md:min-h-11">
                  <Badge color="amber">超前日誌申報 {checks.summary.overKeys.length} 項</Badge>
                </button>
              )}
              {checks.summary.noLogKeys.length > 0 && (
                <span className="inline-flex" title="有計價但施工日誌無申報量"><Badge color="slate">無日誌申報 {checks.summary.noLogKeys.length} 項</Badge></span>
              )}
              {checks.summary.block === 0 && checks.summary.overKeys.length === 0 && checks.summary.noLogKeys.length === 0 && (
                <Badge color="green">{vstate ? '無缺件,與日誌相符' : '與日誌相符'}</Badge>
              )}
            </div>
            {/* 動作鈕都是寫入,手機不渲染(§9.6);「待監造核定」是狀態不是動作,手機仍看得到 */}
            <div className="flex items-center gap-2 sm:ml-auto max-sm:flex-col max-sm:items-stretch">
              {editable && dbMode && <Button variant="secondary" className="max-sm:w-full max-md:hidden" busy={syncing} onClick={() => onSync()} title="以監造確認量為準重算本期(冪等)"><MSym name="refresh" size={14} />同步確認量</Button>}
              {selected.status === '草稿' && can.submit && <Button variant="secondary" className="max-sm:w-full max-md:hidden" onClick={() => onStatus('監造審核')}>送監造審核</Button>}
              {selected.status === '監造審核' && (can.approve ? <>
                <Button variant="ghost" className="max-sm:w-full max-md:hidden" onClick={() => onReject('退回')}>退回</Button>
                <Button variant="success" className="max-sm:w-full max-md:hidden" onClick={() => onStatus('已核定')}>核定估驗</Button>
              </> : <Badge color="amber">待監造核定</Badge>)}
              {selected.status === '已核定' && can.approve &&
                <Button variant="ghost" className="max-sm:w-full max-md:hidden" onClick={() => onReject('退回核定')}>退回核定</Button>}
              {/* 僅草稿可刪(送審/核定後為履約證據,DB 另有 valuations_delete_guard;R4 P2-01) */}
              {can.edit && selected.status === '草稿' && <Button variant="danger" onClick={async () => { if (await appConfirm({ title: `刪除第 ${selected.period_no} 期估驗？`, danger: true, confirmLabel: '刪除' })) { clearError(); const { error } = await deleteValuation(selected.id); if (error) showError(error, '估驗刪除未完成'); else choosePeriod(null) } }} className="max-sm:w-full max-md:hidden" aria-label="刪除估驗期"><MSym name="delete" size={15} /></Button>}
            </div>
          </Surface>

          {/* 缺件與檢核:DB 檢查點的缺件(送審前可見、給處理入口)＋跨文件勾稽發現 */}
          <ChecksCard checks={checks} demo={!dbMode} stateLoading={stateLoading} hasState={!!vstate}
            editable={editable && dbMode} canApprove={can.approve}
            onExpandKeys={expandKeys} onEditPeriodEnd={editable ? onEditPeriodEnd : null} navigate={navigate} />

          {/* 估驗調整(P4d):全案的扣回,三方同一張卡;機關作廢、廠商同步扣回。沒有調整不渲染 */}
          {dbMode && (
            <AdjustmentsCard adjustments={valuationAdjustments} periodNoOf={periodNoOf} keyOf={keyOf} itemOf={itemOf} canVoid={canVoid} onVoid={onVoid} />
          )}

          {/* 監造確認單表單(P4d):簽發／減量／補證;就地面板,submit 走 issue_supervisor_certificate */}
          {certTarget && (
            <CertificateForm key={certTarget.requestId} target={certTarget} busy={certBusy} onSubmit={onCertSubmit} onCancel={() => setCertTarget(null)} />
          )}

          <Card
            title={`第 ${selected.period_no} 期 估驗明細`}
            bodyClass="p-0"
            action={
              // 搜尋框篩的是下面那張在手機被隱藏的標單樹(篩一張看不到的表等於空轉),只在桌機渲染(§9.6)
              <div className="flex items-center gap-2 max-md:hidden">
                {/* !w-40:FIELD_BASE 是 w-full,卡頭行內搜尋框需要定寬(比照 Agent.jsx 的 !w-24) */}
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋工項…" className="!w-40" />
              </div>
            }
          >
            {/* 卡體 p-0(表格出血到卡緣),表格前的訊息各自補 mx-5 邊距 */}
            {!editable && <p className="text-xs text-[var(--amber-text)] mx-5 mt-3">本期狀態為「{selected.status}」，明細唯讀。</p>}
            {selected.recheck_required && (
              <p className="text-xs text-[var(--red-text)] mx-5 mt-3">監造撤銷／減量確認後本期需重算：{selected.recheck_note || '退回後按「同步確認量」。'}</p>
            )}
            {selected.note && (
              <p className="text-xs text-[var(--amber-text)] mx-5 mt-3 whitespace-pre-line">本期備註：{selected.note}</p>
            )}
            {/* 斷點跟手機層對齊(BottomNav 是 md:hidden):1040px 八欄標單樹在 390 只看得到
                37%、要橫捲 2.7 個螢幕寬,寫 max-sm 會讓 640–767 拿到手機摘要卻是桌機表格 */}
            <div className="overflow-x-auto max-md:hidden">
              {/* table-fixed + colgroup:欄寬固定,縮排/長名稱不再逐列推擠;
                  min-w 保住名稱欄可讀寬度,窄螢幕交給外層 overflow-x-auto 捲動 */}
              <table className="w-full min-w-[1100px] table-fixed text-sm">
                <colgroup>
                  <col />{/* 項次 / 工項名稱:吃剩餘寬度 */}
                  <col style={{ width: 64 }} />
                  <col style={{ width: 104 }} />
                  <col style={{ width: 96 }} />
                  <col style={{ width: 150 }} />{/* 累計完成數量:草稿期含輸入框+完成%+可再增,窄於 150 會擠爆 */}
                  <col style={{ width: 118 }} />
                  <col style={{ width: 118 }} />
                  <col style={{ width: 260 }} />{/* 依據／來源／現場紀錄:摘要文字欄,配可換行 */}
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
                    <th className={`${THEAD_CLS} text-left px-2 pr-5 whitespace-nowrap`}>依據 / 來源 / 現場紀錄</th>
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
                    <td className="py-2 pl-5 pr-2">合計{unbackedCount ? <span className="ml-2 text-xs font-normal text-[var(--amber-text)]">(不含 {unbackedCount} 項未確認申報)</span> : null}</td>
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

            {/* 手機:唯讀期別摘要(規範 §9.6,照 /payments 的前例)。標單樹不進手機是決策
                不是妥協——390 螢幕讀不了八欄樹,填數量更不可能。金額全部來自 periodRows(boqCalc 逐期加總),UI 不重算。 */}
            <div className="md:hidden">
              <MobileReadOnlyNote of="各期估驗金額與狀態" className="px-5 py-3 border-b border-[var(--border-2)]" />
              <ul role="list" className="divide-y divide-[var(--border-2)]">
                {periodRows.map(({ v, cum, amt }) => (
                  <li key={v.id} className="px-5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-body font-medium">第 {v.period_no} 期</span>
                      <span className="text-body font-medium tabular-nums">NT$ {fmt(amt)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <Badge color={statusColor[v.status] || 'slate'}>{v.status}</Badge>
                      <span className="text-footnote text-[var(--text-3)] tabular-nums">累計 NT$ {fmt(cum)}</span>
                      <span className="text-footnote text-[var(--text-3)]">截止 {v.period_end || '未填'}</span>
                      {v.id === selected.id && unbackedCount > 0 && <span className="text-footnote text-[var(--amber-text)]">{unbackedCount} 項申報未確認</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <p className="text-xs text-[var(--text-3)]">
            在末端工項填「累計完成數量」；本期可新增量不得超過截止日前經監造確認、扣除已計價與其他期占用後的量，上限與金額由資料庫計算（逐工項四捨五入到元），超出會被拒絕並顯示前期累計、上限與可用量。
            本期金額 = 本期累計 − 前期累計，父項金額自動加總。保留款依契約比例逐期扣留，竣工驗收後返還。
            「依據 / 來源」欄標示數量的依據（監造確認、歷史遷移需補證、申報未確認不計價）並可展開來源（批次、位置、確認量、查驗與文件版本、確認人與時間）；施工日誌的申報量只作差異比對，不是計價依據。
            監造在來源展開列對「有效確認」撤銷或減量、簽發監造確認單，對已核定期的歷史遷移量「補證此期」；撤銷或減量後，草稿期自動縮減、送審中期別標記需重算、已核定量轉成扣回，由機關在「估驗調整」卡作廢（接受已計價）或於草稿期同步時扣回，舊帳不被靜默覆寫。
            「缺件與檢核」列出資料庫送審／核定／請款檢查點會擋下的項目（送審前即可處理）與跨文件勾稽發現，判定不經 AI。
          </p>
        </>
      )}
    </div>
  )
}
