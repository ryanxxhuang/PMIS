// 契約重點 · 履約時程——依 design_handoff_contract_highlights_timeline 改版。
// 單一目的:AI 讀完契約與規範後,把每一條義務排到時程上(開工第一天 → 完工 →
// 保固期滿),讓三方各自看到該看的執行情形。四塊版面:
//   1. 履約執行卡(每個可見責任方一張:準時率+五狀態統計,稽核數字)+關鍵工項與停留點摘要
//   2. 履約期程條(五段:開工前/開工後30日/施工/完工驗收/保固,點擊篩選)
//   3. 時間軸清單(左,主角):近期／全期切換、搜尋+狀態快篩+責任方/類型/待補設定下拉,全期依期程分組
//   4. 事項詳情(右,sticky):出處引述、執行紀錄、期次、關聯、動作列
// 本頁不做審核。 前一版的整套「AI 建議 → 人工審查 → 核定/駁回」、待核定/已生效/
// 已駁回三狀態、六個追溯下拉、就地手動新增表單全數移除(審核流程在其他頁面);
// 這裡只有:標記完成(單次／逐期)、掛佐證、回報 AI 擷取有誤、關鍵工項計畫起迄的少量維護。
// 權限規則只有一條表(VISIBLE,見 obligationTimeline.js):可見範圍看角色、
// 動作只看歸屬(item.who === viewerParty)。三個角色共用同一版面同一元件,
// 差異只有可見義務集合、執行卡張數(1/2/3)、責任方篩選是否出現。
// 寫入走 updateObligationStatus／transitionObligationPeriod(DB 成功才更新 UI,B-07——刻意不樂觀更新);
// 「擷取有誤」落到觀察事項(observations)由監造/機關複查,不憑空造新資料域。
// P5d(D-026 §4「必要關鍵工項日期承接到履約時程後,再退場逐工項排程頁」):同一條時間軸多了兩種事項——
// 關鍵工項(item_schedules 的計畫起迄＋最新估驗完成%,落後判定在 lib/keyWorkItems)
// 與停留點(inspection_points 由查驗推導的狀態,該叫驗的紅黃與 /itp 同一條規則);關鍵工項的計畫起迄
// 在事項詳情維護(廠商)。逐工項排程頁已於 P6b 移除,/schedule 舊連結導到這裡。資料不搬表、不加欄。
// 「清單＋詳情」殼(選取/深連結/鍵盤/抽屜/Modal/搜尋/快篩)與擷取審核頁共用:
// 行為在 lib/useListDetailPane.js、外殼在 components/listDetail.jsx。
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ContractFlow from '../../components/ContractFlow.jsx'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import {
  Card, Surface, Empty, PageHeader, Badge, Button, Select, Textarea, Dot, Segmented, Field, Input,
  PrerequisiteEmptyState, ErrorBanner, SkeletonList, Skeleton,
} from '../../components/ui.jsx'
import {
  ListDetailLayout, LIST_DETAIL_GRID, ModalShell, SearchField, StatusChip, MetaGrid, SourceQuote,
} from '../../components/listDetail.jsx'
import ObligationPeriods from '../../components/ObligationPeriods.jsx'
import { WorkItemPicker } from '../../components/DefectTracker.jsx'
import { appConfirm } from '../../components/confirm.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { appSnackbar } from '../../components/snackbar.jsx'
import { openDocumentVersionFile } from '../../lib/documentFileAccess.js'
import { supabase } from '../../lib/supabase.js'
import { locateQuotationInPage } from '../../../supabase/functions/_shared/sourceVerify.ts'
import { isValidStorageKey } from '../../lib/packageUpload.js'
import { RUN_POLL_MS } from '../../lib/packageRuns.js'
import { localISODate, parseLocalDate } from '../../lib/dates.js'
import { fmtDateTime } from '../../lib/format.js'
import { navLabel } from '../../lib/navConfig.js'
import { billableLeaves } from '../../lib/boqCalc.js'
import { detailLink } from '../../lib/ballInCourt.js'
import {
  requirementVerification, inPackage, runsInPackage, ingestionSummary,
} from '../../lib/requirementReview.js'
import { extractionCoverageWarnings } from '../../lib/extractRequirements.js'
import { useContractEnrichment } from '../../lib/useContractEnrichment.js'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import {
  PARTY_META, VISIBLE, ORG_TO_PARTY, PARTY_BLURB, OB_STATUS, STATUS_KEYS, PHASES, UNASSIGNED_PARTY, isVisibleTo,
  buildTimelineItem, matchesFilters, partyStat, phaseStat, phaseWindows,
  pickDefaultId, canActOn, anchorGaps, SETUP_KINDS, isRecent, byUrgency,
} from '../../lib/obligationTimeline.js'
import {
  buildKeyWorkItems, buildHoldPoints, keyWorkItemCounts, holdPointCounts,
  buildWorkItemEntry, buildHoldPointEntry, workItemEntryId, holdPointEntryId, WORK_ITEM_TYPE, HOLD_POINT_TYPE,
} from '../../lib/keyWorkItems.js'
import { completionDateOf } from '../../../supabase/functions/_shared/ballInCourtRules.ts'
import AnchorDates from '../../components/AnchorDates.jsx'
import AnchorVersions from '../../components/AnchorVersions.jsx'
import WarrantyBasis, { WarrantyTermEditor } from '../../components/WarrantyBasis.jsx'

// 期程段軌道/摘要語意色 → 全站 token(五色語意:紅=逾期、綠=完成、藍=當前、灰=其他)
const TRACK_BG = {
  empty: 'var(--surface-2)', danger: 'var(--danger)', ok: 'var(--green-bar)',
  accent: 'var(--primary)', muted: 'var(--border-2)',
}
const TONE_CLS = {
  danger: 'text-[var(--red-text)]', warn: 'text-[var(--amber-text)]', muted: 'text-[var(--text-2)]',
}
// 倒數字色:已逾期紅、即將到期黃、其他次要灰
const COUNTDOWN_CLS = {
  overdue: 'text-[var(--red-text)]', due: 'text-[var(--amber-text)]',
}
const REPORT_TYPES = ['條文誤判', '日期算錯', '責任方錯誤', '重複', '其他']
// range:近期(預設;逾期／7 日內／30 日內排程／待補設定／進行中／最近 7 日完成)或全期(依期程分組);
// setup:'' 不過濾、'any' 任一待補設定、其餘為 SETUP_KINDS 的缺口種類
const DEFAULT_FILTERS = { q: '', status: 'all', type: '', who: '', phase: 'all', setup: '', range: 'recent' }
const fmtDay = (v) => (v ? String(v).slice(0, 10) : '—')
const fmtTime = (v) => fmtDateTime(v, { empty: '' })
const phaseName = (key) => PHASES.find((p) => p.key === key)?.name || '—'
const relLink = 'flex items-center gap-2 px-2.5 py-2 max-md:min-h-11 border border-[var(--border-2)] rounded-lg text-xs text-[var(--text-2)] min-w-0 hover:bg-[var(--bg)]'

// 責任方 pill(README 2.4):自己的=藍框藍底、別人的=線框——顏色留給狀態,
// 責任方靠文字+icon 分辨(a11y:不可只靠顏色)。capsule 是責任方標籤的例外(規範 §4)。
function WhoPill({ who, self }) {
  return (
    <span className={`inline-flex items-center gap-[5px] h-[18px] px-[7px] rounded-full border text-micro font-medium whitespace-nowrap ${self
      ? 'border-[var(--primary)] bg-[var(--blue-tint)] text-[var(--blue-text)]'
      : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)]'}`}>
      <MSym name={PARTY_META[who]?.icon || 'engineering'} size={13} />{who}
    </span>
  )
}
// 事項種類／頻率的小標籤(關鍵工項、停留點、每月循環、H 停留點)
function TagChip({ children }) {
  return <span className="inline-flex items-center h-[18px] px-1.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] text-micro font-medium whitespace-nowrap">{children}</span>
}
// 待補設定的標示:三方都看得到、有處理入口;顏色＋文字並存
function SetupChip() {
  return <span className="inline-flex items-center gap-1 h-[18px] px-1.5 rounded bg-[var(--amber-tint)] text-[var(--amber-text)] text-micro font-medium whitespace-nowrap"><MSym name="settings" size={11} />待補設定</span>
}

// ── 契約原文(方向 C):選中義務時取出處那一頁的逐頁全文,把引述定位後高亮 ──
// 單頁專屬資料,直接查 Supabase 不進 store(CLAUDE.md §4)。document_pages 的 RLS
// 與 requirement_sources 同一級契約分級把關(can_read_document_version),讀它
// 不會繞過分級。同一頁常被多條義務引用(切換相鄰義務多半落在同一頁),以
// 「版本+頁碼」做元件內快取,離開頁面即丟。
// 不用查的情況一律 idle:demo(沒有 supabase)、無出處、無頁碼(DOCX 出處刻意
// 沒有頁碼,見 verifySuggestionSource)。查到空頁或查詢失敗都是 text=null——
// 對 UI 兩者同一條退路(退回引述),失敗不另起錯誤橫幅:高亮是加值,不是主資料。
function useSourcePageText(source, enabled) {
  const versionId = source?.document_version_id || null
  const pageNumber = source?.page_number ?? null
  const key = enabled && supabase && versionId && pageNumber != null ? `${versionId}:${pageNumber}` : ''
  const cache = useRef(new Map())
  const [state, setState] = useState({ key: '', text: null })
  useEffect(() => {
    if (!key) return undefined
    if (cache.current.has(key)) { setState({ key, text: cache.current.get(key) }); return undefined }
    let active = true
    ;(async () => {
      const { data, error } = await supabase.from('document_pages')
        .select('extracted_text')
        .eq('document_version_id', versionId).eq('page_number', pageNumber)
      const text = data?.[0]?.extracted_text || null
      // 失敗不進快取:下次選回來再試一次;「該頁沒有文字」是確定事實,可以記住
      if (!error) cache.current.set(key, text)
      if (active) setState({ key, text })
    })()
    return () => { active = false }
  }, [key, versionId, pageNumber])
  if (!key) return { status: 'idle', text: null }
  // key 換了但 effect 還沒落地:回 loading 而不是上一條義務的頁文字(不串頁)
  if (state.key !== key) return { status: 'loading', text: null }
  return { status: 'ready', text: state.text }
}

// 原文＋高亮:整頁逐頁文字放進固定高度的捲動框,引述那一段用 <mark> 標起來並
// 捲到框的中間。固定高度(不是 max-h)有兩個理由:詳情欄在桌機是 sticky,整頁契約
// 原文攤開會比視窗還高、sticky 就失效;骨架與正式框同高,載入完成不位移。
// 捲動只捲這個框、算 scrollTop,不用 scrollIntoView——那會連外層(視窗/抽屜)
// 一起捲,選一條義務整頁跳走。text 為空=載入中,框內放骨架。
// 字級走階梯的 text-body,行高放寬到 1.75(原文是閱讀用,不是掃描用);換行照
// 逐頁文字原樣(pre-wrap):PDF 的條號、項次靠換行分段,壓成一段反而難讀。
// 高亮底色用 --blue-tint(選取態語意;--text 在其上對比 14.77 / 深色 12.38);
// 不用 --amber-tint——上方核對橫幅的 attention 態就是 amber,同色會讀成警示。
function SourcePassage({ text, range, cite }) {
  const boxRef = useRef(null)
  const markRef = useRef(null)
  useEffect(() => {
    const box = boxRef.current
    const mark = markRef.current
    if (!box || !mark) return
    box.scrollTop = Math.max(0, mark.offsetTop - (box.clientHeight - mark.offsetHeight) / 2)
  }, [text, range])
  return (
    <figure className="m-0 bg-[var(--bg)] border border-[var(--border-2)] rounded-lg overflow-hidden">
      <figcaption className="num text-caption text-[var(--text-3)] leading-relaxed px-3 pt-[11px]">
        <cite className="not-italic">{cite}</cite>
      </figcaption>
      {/* role=region + tabIndex:可捲動區要能用鍵盤捲,generic div 不准掛 aria-label */}
      <div ref={boxRef} role="region" aria-label="契約原文" tabIndex={0}
        className="relative h-[320px] overflow-y-auto px-3 pt-[7px] pb-[11px] text-body leading-[1.75] text-[var(--text)] whitespace-pre-wrap break-words outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]">
        {text ? (<>
          {text.slice(0, range.start)}
          <mark ref={markRef} className="bg-[var(--blue-tint)] text-[var(--text)] rounded-sm px-0.5 -mx-0.5 box-decoration-clone">
            {text.slice(range.start, range.end)}
          </mark>
          {text.slice(range.end)}
        </>) : <SkeletonList rows={4} label="正在載入契約原文…" />}
      </div>
    </figure>
  )
}

export default function Requirements() {
  const {
    currentProject, project, isPersistedProject, currentUser, obligations,
    updateObligationStatus, transitionObligationPeriod, submittals, createObservation, can, changeProjectAnchors, reloadObligations,
    anchorVersions, acceptanceEvents, projectWarranty,
    // P5d 關鍵工項與停留點:資料仍是 item_schedules／inspection_points,這裡只讀與少量維護
    workItems, adjustedItems = [], valuations = [], itemSchedules = {}, setItemSchedule, removeItemSchedule,
    inspectionPoints = [], inspections = [], siteLogs = [], dbMode, demoMode,
  } = useStore()
  // 登入身分決定檢視方(README:產品端不渲染身分切換器,demo 換角色重登即可)
  const viewerParty = ORG_TO_PARTY[currentUser?.org_type] || '廠商'
  // 「擷取有誤」落觀察事項,其 insert 政策仍是 can_write(機關唯讀)——鏡像它,
  // 不渲染會被 RLS 擋下的假按鈕(規則的單一來源在 store.jsx 的 can.write)。
  // 義務的標記完成/掛佐證自 migration 20260825120000 起改為「只看歸屬」
  // (機關也能標自己的),不再吃 can_write。
  const canReport = can.write
  // 關鍵工項的計畫起迄是廠商內部規劃(item_schedules 的 policy 是 can_write;監造也寫得進,但那不是他的規劃):
  // 前端只給廠商(或非正式模式的專案管理者)維護;標單未匯入(dbMode 假、非 demo)時 store 不會寫 DB,不給假成功。
  const canMaintainKeyItems = can.edit && !!workItems && (dbMode || demoMode)

  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [evidencePick, setEvidencePick] = useState('')
  // 逐期標記時的佐證挑選(P5d):{ id: 期次 id, evidence: 送審文件 id };換選取即收
  const [periodPick, setPeriodPick] = useState(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportDraft, setReportDraft] = useState({ type: REPORT_TYPES[0], note: '' })
  const [reportBusy, setReportBusy] = useState(false)
  const [reportMsg, setReportMsg] = useState('')
  const [anchorOpen, setAnchorOpen] = useState(false)  // 履約期程卡的基準日編輯列
  const [anchorErr, setAnchorErr] = useState('')
  const [keyItemErr, setKeyItemErr] = useState('')   // 關鍵工項寫入失敗必須讓使用者看到(失敗=UI 不變)
  const [searchParams, setSearchParams] = useSearchParams()
  const searchRef = useRef(null)
  const anchorCardRef = useRef(null)
  const packageId = searchParams.get('package') || ''

  const pid = currentProject?.project_id

  // ── 出處/紀錄 enrich(真專案):義務掛的 requirement + 引述出處 + 文件版本 +
  // ingestion runs(頁底「AI 最近整理」與空狀態分流)。demo 不打 DB,直接可用。
  const requirementIds = useMemo(() => obligations.map((o) => o.requirement_id), [obligations])
  const {
    reqById, sourcesByReq, versionsById, runs, runsById, packages,
    loaded: enrichLoaded, error: enrichError, reload: reloadEnrich,
  } = useContractEnrichment({ pid, enabled: isPersistedProject, requirementIds })
  const coverageWarnings = useMemo(
    () => extractionCoverageWarnings(runsInPackage(runs, packageId, { versionsById })),
    [runs, versionsById, packageId],
  )

  // 從文件頁進來先重讀自動物化結果；分析仍在進行時刷新已完成的部分。
  useEffect(() => { if (isPersistedProject) reloadObligations?.() }, [isPersistedProject, pid, reloadObligations])
  const analyzing = runs.some((r) => ['pending', 'processing'].includes(r.status))
  useEffect(() => {
    if (!analyzing) return
    const timer = setInterval(() => { reloadEnrich(); reloadObligations?.() }, RUN_POLL_MS)
    return () => clearInterval(timer)
  }, [analyzing, reloadEnrich, reloadObligations])

  // /requirements?item=<work_item_key>(退場的 /schedule 的替代深連結,入口與退場設計 §5;/schedule?item= 也導到這裡):
  // 換成殼的單條連結 ?obligation=wi:<key>,殼的初次選取就會落在那一項關鍵工項
  useEffect(() => {
    const key = searchParams.get('item')
    if (!key) return
    setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('item'); n.set('obligation', workItemEntryId(key)); return n }, { replace: true })
  }, [searchParams, setSearchParams])

  // ── 檢視模型:義務列 + enrich → 狀態/期程/倒數/出處(純函式,見 obligationTimeline)
  // 基準日吃 store 的 project(demo 落回種子專案;與今日工作同一份錨點,數字才對得上);
  // 另帶實際竣工日(驗收事件推得,P5c 循環停止條件)、保固事實(P5e,DB 算好的合格日／保固期間／期滿日)
  // 與目前基準日版本號(依據標示)
  const latestVersionNo = anchorVersions?.length ? anchorVersions[anchorVersions.length - 1].version_no : null
  const anchors = useMemo(() => ({
    award_date: project?.award_date, notice_date: project?.notice_date,
    commencement_date: project?.commencement_date, end_date: project?.end_date,
    completion_date: completionDateOf(acceptanceEvents), warranty: projectWarranty, version_no: latestVersionNo,
  }), [project, acceptanceEvents, projectWarranty, latestVersionNo])
  // 下一次改基準日要記的依據(P5c):類別／函文或變更案號／生效日
  const [anchorBasis, setAnchorBasis] = useState({ change_kind: 'edit', source_ref: '', effective_from: '' })
  const [anchorMsg, setAnchorMsg] = useState('')
  const items = useMemo(() => obligations.map((ob) => buildTimelineItem(ob, {
    requirement: ob.requirement_id ? reqById.get(ob.requirement_id) : null,
    sources: ob.requirement_id ? sourcesByReq.get(ob.requirement_id) : null,
    versionsById,
    anchors,
  })), [obligations, reqById, sourcesByReq, versionsById, anchors])

  // 關鍵工項與停留點(P5d):與 /itp 同一份推導;每一筆變成時程上的一個事項
  const keyRows = useMemo(() => buildKeyWorkItems({ itemSchedules, adjustedItems, valuations }), [itemSchedules, adjustedItems, valuations])
  const holdRows = useMemo(() => buildHoldPoints({ inspectionPoints, inspections, siteLogs, itemSchedules }), [inspectionPoints, inspections, siteLogs, itemSchedules])
  const extraEntries = useMemo(() => [
    ...keyRows.map((r) => buildWorkItemEntry(r, { anchors })),
    ...holdRows.map((r) => buildHoldPointEntry(r, { anchors })),
  ], [keyRows, holdRows, anchors])
  const keyCounts = useMemo(() => keyWorkItemCounts(keyRows), [keyRows])
  const holdCounts = useMemo(() => holdPointCounts(holdRows), [holdRows])
  // 可加入的工項:發包末端且尚未排程(與退場前的排程頁同一條件)
  const leaves = useMemo(() => (workItems ? billableLeaves(adjustedItems).filter((it) => !itemSchedules[it.item_key]) : []), [workItems, adjustedItems, itemSchedules])

  // 可見義務=角色可見集合(前端 shim;目標是後端依身分回傳已過濾集合,見 lib 註記)
  // × 契約範圍(packageOf:列自己的歸包,沒有才由 run → 文件版本回推)。依賴就是它
  // 真正讀的三張 Map——改版前這裡靠 runsById 恰好與 enrich 同一次 setState 換
  // identity 才沒壞,現在寫對。
  // 待補設定(責任方推不出三方)對三方都可見:沒人看得到就沒人會去補
  const obligationPool = useMemo(
    () => items.filter((it) => isVisibleTo(it, viewerParty)
      && inPackage(it.ob.requirement_id ? reqById.get(it.ob.requirement_id) : null, packageId, { versionsById, runsById })),
    [items, viewerParty, packageId, reqById, versionsById, runsById],
  )
  // 關鍵工項與停留點是整案的(不屬於任一契約範圍),三方都看得到;指定契約範圍時只列該契約的義務
  const pool = useMemo(() => (packageId ? obligationPool : [...obligationPool, ...extraEntries]), [obligationPool, extraEntries, packageId])
  // 近期視圖沒有東西(全部義務都沒有到期日、也沒有缺口——例如尚未設基準日的新案)就退回全期:
  // 開頁看到一張空清單、卻在上面的執行卡看到「N 條義務」,只會讓人以為資料壞了
  const recentPool = useMemo(() => pool.filter((it) => isRecent(it)), [pool])
  const range = filters.range === 'recent' && recentPool.length === 0 ? 'all' : filters.range
  const filtered = useMemo(() => pool.filter((it) => matchesFilters(it, { ...filters, range })), [pool, filters, range])
  const byDue = (a, b) => ((a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity))
    || ((a.ob?.sort_order ?? 0) - (b.ob?.sort_order ?? 0))
  // 全期:依期程分組、組內到期日近→遠;近期:一份清單、先急後緩(byUrgency)
  const grouped = useMemo(
    () => (range === 'recent' ? [] : PHASES.map((ph) => ({ ...ph, items: [...filtered.filter((it) => it.phase === ph.key)].sort(byDue) }))
      .filter((g) => g.items.length)),
    [filtered, range],
  )
  const ordered = useMemo(
    () => (range === 'recent' ? [...filtered].sort(byUrgency) : grouped.flatMap((g) => g.items)),
    [filtered, grouped, range],
  )

  // 保固期滿(P5e):正式驗收合格日＋契約保固期間,兩項都有依據才由 DB 算出(get_project_warranty);
  // 推不出就不顯示日期(不再拿保固段義務的最遠到期日推估)
  const warrantyEnd = useMemo(() => parseLocalDate(projectWarranty?.expiry), [projectWarranty])
  // 保固期間可引用的條文:本頁看得到的已確認契約重點(契約分級 RLS),保固相關的排前面;DB guard 仍會再驗一次
  const warrantyCandidates = useMemo(() => {
    const rows = [...reqById.values()].filter((r) => r.status === 'approved')
    const warrantyish = (r) => r.lifecycle_phase === '保固' || /保固/.test(`${r.title || ''}${r.description || ''}`)
    return rows
      .sort((a, b) => Number(warrantyish(b)) - Number(warrantyish(a)) || String(a.title).localeCompare(String(b.title), 'zh-Hant'))
      .map((r) => {
        const clause = (sourcesByReq.get(r.id) || [])[0]?.clause || ''
        return { id: r.id, label: `${clause ? `${clause} ` : ''}${r.title}` }
      })
  }, [reqById, sourcesByReq])
  const warrantySource = useMemo(() => {
    const r = projectWarranty?.source_requirement_id ? reqById.get(projectWarranty.source_requirement_id) : null
    return r ? { title: r.title, clause: (sourcesByReq.get(r.id) || [])[0]?.clause || '' } : null
  }, [projectWarranty, reqById, sourcesByReq])
  const phaseWin = useMemo(() => phaseWindows(anchors, warrantyEnd), [anchors, warrantyEnd])

  // 快篩件數走目前的範圍(近期／全期):chip 上的數字是「這個範圍有幾件」,否則近期視圖點「已完成 12」只看到 1 件
  const rangePool = range === 'recent' ? recentPool : pool
  const counts = useMemo(() => {
    const c = { overdue: 0, due: 0, scheduled: 0, done: 0, na: 0 }
    for (const it of rangePool) c[it.status]++
    return c
  }, [rangePool])
  // 待補設定件數(全範圍;待補設定本來就算近期)
  const setupCounts = useMemo(() => {
    const c = { any: 0 }
    for (const k of SETUP_KINDS) c[k.key] = 0
    for (const it of pool) {
      if (!it.setup?.length) continue
      c.any++
      for (const g of it.setup) c[g.kind]++
    }
    return c
  }, [pool])
  // 履約執行卡只算契約義務(它是「N 條義務」的稽核數字;關鍵工項與停留點另有摘要)
  const partyCards = useMemo(
    () => VISIBLE[viewerParty].map((name) => ({ name, stat: partyStat(obligationPool.filter((it) => it.who === name)) })),
    [obligationPool, viewerParty],
  )
  const typeOptions = useMemo(() => [...new Set(pool.map((it) => it.type).filter(Boolean))], [pool])
  // 責任方篩選選項:三方可見範圍,有待補設定的義務才多一個「待補設定」
  const whoOptions = useMemo(
    () => (pool.some((it) => it.who === UNASSIGNED_PARTY) ? [...VISIBLE[viewerParty], UNASSIGNED_PARTY] : VISIBLE[viewerParty]),
    [pool, viewerParty],
  )
  const multiParty = whoOptions.length > 1
  const anyFilter = filters.status !== 'all' || filters.phase !== 'all' || filters.type || filters.who || filters.setup || filters.q.trim()

  const milestoneMeta = useMemo(() => {
    const m = phaseWin.milestones
    return [
      m.start ? `開工 ${localISODate(m.start)}` : null,
      m.completion ? `完工 ${localISODate(m.completion)}` : null,
      m.warrantyEnd ? `保固期滿 ${localISODate(m.warrantyEnd)}` : null,
      `可見 ${pool.length} 項`,
    ].filter(Boolean).join(' · ')
  }, [phaseWin, pool.length])

  // 基準日缺口與就地設定:開工類義務推不出到期日的主因就是開工日沒設,而設定
  // 入口原本只在隱藏的期限追蹤頁——把設定放在後果看得到的地方(履約期程卡)。
  // 寫入 DB-first(同 B-04):P5c 起經 RPC 留版(類別／依據／生效日),DB 同交易重算沒動過的期次與
  // 未完成單次義務的到期日並記差異;store 成功後重載義務與版本,anchors/items 隨之重算,使用者當場看到
  // 「未觸發」翻成有日期、並知道第 N 版影響了哪些事項。demo 不出現(種子案基準日齊全)。
  const gaps = useMemo(() => anchorGaps(obligationPool, anchors), [obligationPool, anchors])
  // 基準日與契約保固期間(P5e)同一支 RPC、同一套版本:DB 留版並只重算沒動過的待辦期,回報影響幾個事項
  const saveAnchors = async (patch, fallback) => {
    setAnchorErr(''); setAnchorMsg('')
    const { error, version } = await changeProjectAnchors(patch, {
      change_kind: anchorBasis.change_kind, source_ref: anchorBasis.source_ref.trim() || null, effective_from: anchorBasis.effective_from || null,
    })
    if (error) { setAnchorErr(friendlyError(error, fallback)); return { error } }
    if (!version) { setAnchorMsg('值沒有變更，未留新版本。'); return { error: null } }
    const effects = Array.isArray(version.effects) ? version.effects : []
    const changed = effects.filter((e) => e.kind !== 'kept').length
    const kept = effects.filter((e) => e.kind === 'kept').length
    setAnchorMsg(`已留第 ${version.version_no} 版：${changed} 個事項改期／增減${kept ? `，${kept} 個已完成事項保留原依據` : ''}。`)
    return { error: null }
  }
  const setAnchor = (key, val) => saveAnchors({ [key]: val || null }, '基準日未儲存')
  const saveWarrantyTerm = (patch) => saveAnchors(patch, '保固期間未儲存')
  // 待補設定的「設定基準日」入口:打開履約期程卡的編輯列並捲到它(處理入口離後果最近)
  const openAnchorEditor = () => {
    setAnchorOpen(true)
    anchorCardRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }
  // 保固類缺「契約保固期間」的入口(P5e):同一張卡,再把焦點放到保固期間欄(編輯列打開後才掛上,等它渲染)
  const [focusWarranty, setFocusWarranty] = useState(false)
  const openWarrantyEditor = () => { openAnchorEditor(); setFocusWarranty(true) }
  useEffect(() => {
    if (!focusWarranty || !anchorOpen) return
    document.getElementById('warranty-term-value')?.focus()
    setFocusWarranty(false)
  }, [focusWarranty, anchorOpen])

  // ── 選取/深連結(?obligation=)/切案重置/初次自動選取:共用殼 hook。
  // 預設選第一條已逾期 → 第一條即將到期 → 清單第一條(README 3);只在契約義務裡挑——
  // 關鍵工項與停留點是承接進來的輔助事項,不搶開頁的第一眼。
  const { selectedId, detailOpen, select, closeDetail } = useListDetailPane({
    param: 'obligation', idPrefix: 'ob-',
    scope: `${pid}/${viewerParty}/${packageId}`,
    // ?item= 還沒換成 ?obligation= 前不算就緒:殼的初次選取只做一次,先讀到舊網址就會落在預設而不是那一項
    ready: pool.length > 0 && !searchParams.get('item'), rows: pool,
    pickDefault: () => {
      const obs = ordered.filter((it) => it.entryKind === 'obligation')
      return pickDefaultId(obs.length ? obs : (obligationPool.length ? obligationPool : ordered))
    },
    onSelect: () => { setMsg(''); setEvidenceOpen(false); setPeriodPick(null); setKeyItemErr('') },
    onReset: () => { setMsg(''); setEvidenceOpen(false); setPeriodPick(null); setKeyItemErr(''); setFilters(DEFAULT_FILTERS) },
  })
  // 篩選後選中項被篩掉:保留右欄內容不清空(README 3),清單中無高亮列
  const selected = pool.find((it) => it.id === selectedId) || null

  // 「開啟原文」:出處的文件版本+頁碼 → 簽名 URL 開原始檔(PDF 跳頁)
  const openable = useMemo(() => {
    if (!selected?.ob?.requirement_id) return null
    for (const s of sourcesByReq.get(selected.ob.requirement_id) || []) {
      const version = s.document_version_id ? versionsById.get(s.document_version_id) : null
      if (version && isValidStorageKey(version.storage_path)) return { source: s, version }
    }
    return null
  }, [selected, sourcesByReq, versionsById])
  const openOriginal = useCallback(() => {
    if (!openable) return
    openDocumentVersionFile(openable.version, { page: openable.source.page_number, onError: setMsg })
  }, [openable])

  // 契約原文＋高亮(方向 C):出處那一頁的全文 + 引述在其中的精確位置。
  // 定位器與 source_verified 用同一套正規化規則(sourceVerify.ts,刻意同檔);
  // 定不到(標點寬容才驗過、對照守門觸發、引述太短)回 null → 退回引述並明說。
  const passage = useSourcePageText(selected?.source, isPersistedProject)
  const passageRange = useMemo(
    () => (passage.text && selected?.quote
      ? locateQuotationInPage({ quotation: selected.quote, pageText: passage.text })
      : null),
    [passage.text, selected?.quote],
  )

  // 鍵盤:↑/↓ 移動選取、Enter 開啟原文、/ 聚焦搜尋(共用殼 hook;回報 Modal 開著就停用)
  useListKeyboardNav({ ordered, selectedId, select, idPrefix: 'ob-', onEnter: openOriginal, modalUp: reportOpen, searchRef })

  // ── 動作:標記完成/取消完成/掛佐證(DB 成功才更新 UI,失敗顯示 inline 錯誤)
  const markDone = async () => {
    setBusy('done')
    const { error } = await updateObligationStatus(selected.id, '已完成')
    setBusy('')
    if (error) { setMsg(friendlyError(error, '未能標記完成')); return }
    setMsg(''); appSnackbar('已標記完成')
  }
  const undoDone = async () => {
    setBusy('undo')
    const { error } = await updateObligationStatus(selected.id, '待辦')
    setBusy('')
    if (error) { setMsg(friendlyError(error, '未能取消完成')); return }
    setMsg('')
  }
  const attachEvidence = async () => {
    if (!evidencePick) return
    setBusy('evidence')
    // 掛佐證不自動標記完成(README 3):status 原樣回寫,只掛 evidence_submittal_id
    const { error } = await updateObligationStatus(selected.id, selected.ob.status, { evidence_submittal_id: evidencePick })
    setBusy('')
    if (error) { setMsg(friendlyError(error, '佐證未掛上')); return }
    setMsg(''); setEvidenceOpen(false); setEvidencePick(''); appSnackbar('已掛上佐證文件')
  }
  // 循環義務逐期標記(P5b RPC transition_obligation_period;P5d 就地):完成本期不動下期、退回待辦解除佐證
  // (伺服器規則,前端不另抄)。佐證只能隨完成一起掛——RPC 對「待辦」一律清空證據。
  const writePeriod = async (p, status, extra = {}) => {
    setBusy(`period:${p.id}`); setMsg('')
    const { error } = await transitionObligationPeriod(selected.id, p.id, status, extra)
    setBusy('')
    if (error) { setMsg(friendlyError(error, '期次未寫入')); return false }
    setPeriodPick(null)
    appSnackbar(status === '待辦' ? `已將 ${p.key} 期退回待辦` : `已標記 ${p.key} 期完成`)
    return true
  }
  const startPeriodMark = (p) => {
    if (submittals.length) setPeriodPick({ id: p.id, evidence: '' })
    else writePeriod(p, '已完成')
  }
  // 關鍵工項的少量維護(P5d 承接自 /schedule):加入、計畫起迄、移除。store 的 setItemSchedule 以 ref 累積＋
  // debounce 合併同一工項的起訖成單次寫入(R4 P1-01),這裡只送變動的單欄。
  const setKeyItem = async (key, patch) => {
    setKeyItemErr('')
    const { error } = await setItemSchedule(key, patch)
    if (error) setKeyItemErr(friendlyError(error, '計畫起迄未寫入'))
  }
  const addKeyItem = async (key) => {
    if (!key) return
    await setKeyItem(key, { planned_start: null, planned_finish: null })
    select(workItemEntryId(key), { openPane: true })
  }
  const dropKeyItem = async (row) => {
    const ok = await appConfirm({ title: `移除關鍵工項「${row.it.description || row.key}」？`, body: '只移除計畫起迄,不影響標單與估驗。之後可再加入。', confirmLabel: '移除', danger: true })
    if (!ok) return
    await removeItemSchedule(row.key)
    appSnackbar('已移除關鍵工項')
  }
  // 「擷取有誤」任何可寫角色都能回報:落成觀察事項(監造/機關複查),
  // 不動義務本身——README 的 report-issue 端點落地前的最小誠實路徑
  const submitReport = async () => {
    setReportBusy(true)
    const { error } = await createObservation({
      title: `AI 擷取有誤:${selected.title}`,
      description: [`錯誤類型:${reportDraft.type}`,
        reportDraft.note.trim() ? `說明:${reportDraft.note.trim()}` : null,
        selected.clause ? `出處:${selected.clause}${selected.page ? ` · ${selected.page}` : ''}` : null,
      ].filter(Boolean).join('\n'),
      assigned_to: 'supervisor',
    })
    setReportBusy(false)
    if (error) { setReportMsg(friendlyError(error, '回報未送出')); return }
    setReportOpen(false); setReportMsg(''); setReportDraft({ type: REPORT_TYPES[0], note: '' })
    appSnackbar('已回報擷取有誤,將由專案團隊複查')
  }

  // ── 頁底 meta 與空狀態分流(有 completed run 才講「AI 最近整理」)──────────
  const { docCount, latest: latestRun } = ingestionSummary(runs, versionsById)
  const footerMeta = [
    `顯示 ${filtered.length} / ${rangePool.length} 項`,
    docCount ? `來源 ${docCount} 份文件` : null,
    latestRun ? `AI 最近整理 ${latestRun.slice(0, 10)}` : null,
  ].filter(Boolean).join(' · ')

  // 待補設定的處理入口(P5d):與今日工作同一份 setupLink,但基準日／停止條件在本頁就能補(履約期程卡),
  // 就不跳頁——處理入口離後果最近(判準第 4 條);demo 沒有基準日編輯列,退回期限追蹤的基準日卡
  const setupAction = (g, ob) => {
    const inPage = isPersistedProject && (g.kind === 'anchor' || (g.kind === 'stop' && ob.category !== '保固'))
    if (inPage) {
      return (<>
        <button type="button" onClick={openAnchorEditor} className="inline-flex min-h-11 items-center text-[var(--blue-text)] hover:underline mr-2">設定基準日</button>
        {g.kind === 'stop' && <Link to="/acceptance" className="inline-flex min-h-11 items-center text-[var(--blue-text)] hover:underline">到驗收登錄竣工</Link>}
      </>)
    }
    // 保固類(P5e):缺正式驗收合格日到驗收頁;缺契約保固期間在本頁履約期程卡登錄(demo 沒有編輯列,只說去哪裡)
    if (g.kind === 'stop' && ob.category === '保固') {
      const need = g.need || []
      return (<>
        {need.includes('acceptance') && <Link to="/acceptance?stage=final" className="inline-flex min-h-11 items-center text-[var(--blue-text)] hover:underline mr-2">到驗收登錄正式驗收合格</Link>}
        {need.includes('term') && (isPersistedProject
          ? <button type="button" onClick={openWarrantyEditor} className="inline-flex min-h-11 items-center text-[var(--blue-text)] hover:underline">登錄契約保固期間</button>
          : <span className="text-[var(--text-3)]">在履約期程卡登錄契約保固期間(需真專案)。</span>)}
      </>)
    }
    if (g.kind === 'review') return <span className="text-[var(--text-3)]">到下方「期次」核對該期是否已履行後標記,標記即解除。</span>
    const label = g.kind === 'responsible' || g.kind === 'rule' ? '到擷取審核廢止取代後補登' : '到期限追蹤處理'
    return <Link to={g.to} className="inline-flex min-h-11 items-center text-[var(--blue-text)] hover:underline">{label}</Link>
  }

  // ── 詳情內容(桌機 aside 與 <lg 抽屜共用同一份 JSX)────────────────────
  // 契約義務:出處引述、執行紀錄、期次(逐期標記)、關聯、動作列
  const obligationDetail = () => {
    const st = OB_STATUS[selected.status]
    const isMine = selected.who === viewerParty
    // 歸屬即可操作(伺服器同一條 RLS 規則);can.override 鏡像 admin_override()
    const actable = canActOn(selected, viewerParty) || can.override
    const meta = [
      ['責任方', selected.who],
      ['階段', phaseName(selected.phase)],
      ['到期日', selected.dateLabel === '—' ? (selected.recurrenceGap ? selected.recurrenceGap.label : '依條件觸發') : `${selected.dateLabel}（${selected.countdown}）`],
      // P5c:到期日依哪一版基準日(期次:產生時的版本;單次:完成時留版或現行基準日)
      ...(selected.dueBasis ? [['依據', selected.dueBasis]] : []),
      ['頻率', selected.kind || '單次'],
      // 循環義務(P5b):本期=最早未結的一期;逐期狀態在下方「期次」
      ...(selected.recurring ? [['本期', selected.currentPeriod ? `${selected.currentPeriod} 期` : '—']] : []),
      ['允收標準', selected.criteria || '—'],
      ['應留存', selected.evidenceReq || '—'],
      ...(selected.penalty ? [['罰則', selected.penalty]] : []),
    ]
    const req = selected.ob.requirement_id ? reqById.get(selected.ob.requirement_id) : null
    const verification = requirementVerification(req)
    const evidenceSub = selected.ob.evidence_submittal_id
      ? submittals.find((s) => s.id === selected.ob.evidence_submittal_id) : null
    // 執行紀錄:由現有事實組裝(AI 擷取/確認、佐證、完成標記)。義務完成沒有
    // 時間戳欄位——「時間未記錄」如實顯示,不臆造時間(後端補 completed_at 後改讀欄位)
    const logEntries = []
    if (req?.created_at) {
      logEntries.push({
        when: fmtDay(req.created_at),
        what: req.origin === 'manual' ? '人工補登此義務' : 'AI 自契約擷取此義務',
        s: 'scheduled',
      })
    }
    if (req?.reviewed_at) {
      logEntries.push({
        when: fmtDay(req.reviewed_at),
        what: verification.label,
        s: 'done',
      })
    }
    if (evidenceSub) {
      logEntries.push({ when: fmtDay(evidenceSub.submitted_date || evidenceSub.created_at), what: `掛佐證:${evidenceSub.title}`, s: 'scheduled' })
    }
    if (selected.status === 'done') {
      // completed_at 由 DB trigger 蓋(demo 由 slice 鏡像);缺值=migration 前的舊資料
      const at = selected.ob.completed_at
      logEntries.push({
        when: at ? fmtTime(at) : '—',
        what: `${selected.ob.status === '已提送' ? '已標為提送' : '已標記完成'}${at ? '' : '（時間未記錄）'}`,
        s: 'done',
      })
    }
    // 循環義務:每期的完成也是執行紀錄(最新在前;periods 本來就依到期日降冪)
    for (const p of selected.periods) {
      if (p.status !== 'done') continue
      logEntries.push({ when: p.completedAt ? fmtTime(p.completedAt) : '—', what: `${p.key} 期${p.rawStatus}${p.onTime === false ? '（遲交）' : ''}`, s: 'done' })
    }
    const activeStatus = ['overdue', 'due', 'scheduled'].includes(selected.status)
    // 逐期動作(P5d):只看歸屬;不適用的期沒有動作;佐證只能隨完成一起掛(RPC 對待辦一律清空證據)
    const periodActions = actable ? (p) => {
      if (p.status === 'na') return null
      const open = p.status !== 'done'
      const picking = periodPick?.id === p.id
      const evidence = p.evidenceSubmittalId ? submittals.find((s) => s.id === p.evidenceSubmittalId) : null
      const key = `period:${p.id}`
      return (
        <span className="w-full flex items-center gap-2 flex-wrap pt-1">
          {open && !picking && (
            <Button size="sm" busy={busy === key} onClick={() => startPeriodMark(p)}><MSym name="task_alt" size={15} fill /> 標記 {p.key} 期完成</Button>
          )}
          {open && picking && (<>
            <Select value={periodPick.evidence} onChange={(e) => setPeriodPick((d) => ({ ...d, evidence: e.target.value }))}
              aria-label={`${p.key} 期佐證送審文件`} className="flex-1 min-w-[180px] !text-xs">
              <option value="">（不掛佐證）</option>
              {submittals.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </Select>
            <Button size="sm" busy={busy === key} onClick={() => writePeriod(p, '已完成', periodPick.evidence ? { evidence_submittal_id: periodPick.evidence } : {})}>
              {periodPick.evidence ? '掛佐證並標記完成' : '直接標記完成'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPeriodPick(null)}>取消</Button>
          </>)}
          {!open && (
            <Button size="sm" variant="outline" busy={busy === key} onClick={() => writePeriod(p, '待辦')}><MSym name="undo" size={15} /> 退回 {p.key} 期待辦</Button>
          )}
          {p.evidenceSubmittalId && (
            <Link to={detailLink('/submittals', 'submittal', p.evidenceSubmittalId)} className="inline-flex items-center gap-1 max-md:min-h-11 text-caption text-[var(--blue-text)] hover:underline">
              <MSym name="upload_file" size={13} />佐證 · {evidence ? evidence.title : '送審文件（已不存在或無權檢視）'}
            </Link>
          )}
        </span>
      )
    } : undefined
    return (<>
      {/* 1. 標題列:狀態色票 + 責任方 pill + 開啟原文 */}
      <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
        <Badge color={st.badge}>{st.label}</Badge>
        <WhoPill who={selected.who} self={isMine} />
        {openable && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={openOriginal} title="在原文件中開啟">
            開啟原文
          </Button>
        )}
      </div>

      <ErrorBanner msg={msg} onClose={() => setMsg('')} className="mx-4 mt-3" />

      {/* 待補設定(P5d):缺什麼、去哪裡補——與今日工作／Agent／早報同一份判定 */}
      {selected.setup.length > 0 && (
        <div role="status" className="mx-4 mt-3 rounded-md px-3 py-2 text-xs leading-relaxed text-[var(--amber-text)] bg-[var(--amber-tint)]">
          <p className="font-medium">待補設定（{selected.setup.length}）</p>
          <ul className="mt-1 space-y-1">
            {selected.setup.map((g) => (
              <li key={g.kind} className="flex items-center gap-x-2 flex-wrap">
                <span>{g.label}</span>
                <span className="text-[var(--text-2)]">{setupAction(g, selected.ob)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={`mx-4 mt-3 rounded-md px-3 py-2 text-xs leading-relaxed ${verification.attention
        ? 'text-[var(--amber-text)] bg-[var(--amber-tint)]' : 'text-[var(--text-2)] bg-[var(--surface-2)]'}`}>
        <p className="font-medium">{verification.label}</p>
        <p>{verification.note}</p>
        {verification.attention && req?.id && (
          <Link to={`/requirements/review?highlight=${req.id}${packageId ? `&package=${encodeURIComponent(packageId)}` : ''}`} className="inline-flex min-h-11 items-center text-[var(--blue-text)] hover:underline">
            查看這項與原文
          </Link>
        )}
      </div>

      {/* 2. 本文:標題/說明/key-value */}
      <div className="p-4">
        <div className="text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{selected.title}</div>
        {selected.desc && <p className="mt-2 text-footnote leading-[1.8] text-[var(--text-2)]">{selected.desc}</p>}
        <MetaGrid rows={meta} className="mt-3.5" />
      </div>

      {/* 3. 執行紀錄:讓監造/機關看得到「實際發生了什麼」,不只狀態標籤 */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2 mb-2">
          <MSym name="history" size={15} className="text-[var(--text-3)]" />
          <span className="text-footnote font-medium text-[var(--text)]">執行紀錄</span>
        </div>
        {logEntries.length === 0 ? (
          <p className="text-xs text-[var(--text-3)]">尚無執行紀錄。</p>
        ) : logEntries.map((e, i) => (
          <div key={i} className="grid grid-cols-[14px_minmax(0,1fr)] gap-2.5 items-start">
            <span className="relative flex justify-center self-stretch min-h-[26px]">
              <span className="w-[2px] bg-[var(--border-2)]" aria-hidden />
              <Dot color={OB_STATUS[e.s].badge} className="absolute top-[5px]" />
            </span>
            <span className="pb-[9px] flex flex-col gap-px">
              <span className="num text-caption text-[var(--text-3)] leading-normal">{e.when}</span>
              <span className="text-xs leading-relaxed text-[var(--text)]">{e.what}</span>
            </span>
          </div>
        ))}
      </div>

      {/* 4. AI 擷取依據:出處引述(blockquote/cite 語意)+ 來源核對色票 + 到期日推算 */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2 mb-2">
          <MSym name="description" size={15} className="text-[var(--text-3)]" />
          <span className="text-footnote font-medium text-[var(--text)]">AI 擷取依據</span>
          {selected.verified != null && (
            <Badge color={selected.verified ? 'green' : 'amber'}>{selected.verified ? '來源已核對' : '來源待核對'}</Badge>
          )}
        </div>
        {/* 退路鏈(每一段都有對應 UI):① 無出處/無頁碼 → 引述照舊(idle);
            ② 該頁沒有逐頁文字或查不到 → 引述;③ 有頁文字但定不到位置 → 引述+明說;
            ④ 定位成功 → 整頁原文+高亮。載入中先擺同高的骨架框,落地不位移。 */}
        {selected.quote ? (() => {
          const cite = [selected.doc, selected.clause ? `契約條款 ${selected.clause}` : null, selected.page].filter(Boolean).join(' · ')
          if (passage.status === 'loading') return <SourcePassage text={null} range={null} cite={cite} />
          if (passage.status === 'ready' && passage.text && passageRange) {
            return <SourcePassage text={passage.text} range={passageRange} cite={cite} />
          }
          return (<>
            <SourceQuote quote={selected.quote} cite={cite} />
            {passage.status === 'ready' && passage.text && !passageRange && (
              <p className="mt-1.5 text-caption text-[var(--text-3)] leading-relaxed">
                原文比對不到精確位置,僅顯示 AI 引述;可按「開啟原文」到該頁核對。
              </p>
            )}
          </>)
        })() : (selected.clause || selected.page) ? (
          <p className="num text-caption text-[var(--text-3)] leading-relaxed">
            出處 {[selected.clause, selected.page].filter(Boolean).join(' · ')}(原文請至專案文件查閱)
          </p>
        ) : (
          <p className="text-xs text-[var(--text-3)]">無引註。</p>
        )}
        {selected.calc && (
          <div className="mt-2 flex items-start gap-[7px] text-caption text-[var(--text-3)] leading-relaxed">
            <MSym name="function" size={15} className="flex-none mt-px" />
            <span className="num">到期日推算:{selected.calc}{selected.dateLabel !== '—' ? ` · 本期 ${selected.dateLabel}` : ''}</span>
          </div>
        )}
      </div>

      {/* 5. 關聯:佐證直達那一份送審(規範 §9.7)、期限追蹤(罰款試算)、罰則 */}
      <div className="px-4 pb-4">
        <div className="text-footnote font-medium text-[var(--text)] mb-2">關聯</div>
        <div className="flex flex-col gap-1.5">
          {evidenceSub && (
            <Link to={detailLink('/submittals', 'submittal', evidenceSub.id)} className={relLink}>
              <MSym name="upload_file" size={15} className="text-[var(--text-3)] shrink-0" />
              <span className="flex-1 min-w-0 truncate">佐證 · {evidenceSub.title}</span>
              <MSym name="chevron_right" size={16} className="text-[var(--text-3)] shrink-0" />
            </Link>
          )}
          <Link to={detailLink('/deadlines', 'obligation', selected.id)} className={relLink}>
            <MSym name="schedule" size={15} className="text-[var(--text-3)] shrink-0" />
            <span className="flex-1 min-w-0 truncate">期限追蹤 · 罰款試算與逐項提送</span>
            <MSym name="chevron_right" size={16} className="text-[var(--text-3)] shrink-0" />
          </Link>
          {selected.penalty && (
            <div className="flex items-center gap-2 px-2.5 py-2 border border-[var(--border-2)] rounded-lg text-xs text-[var(--text-2)] min-w-0">
              <MSym name="balance" size={15} className="text-[var(--text-3)] shrink-0" />
              <span className="flex-1 min-w-0 truncate">罰則 · {selected.penalty}</span>
            </div>
          )}
        </div>
      </div>

      {/* 5b. 循環義務的期次(P5b 逐期追蹤、P5d 就地標記):完成本期不清下期、舊逾期保留;逐期準時率同一條定義 */}
      {selected.recurring && (
        <div className="px-4 pb-4">
          <ObligationPeriods ob={selected.ob} periods={selected.periods} gap={selected.recurrenceGap}
            currentId={selected.currentPeriodId} renderActions={periodActions} showRate
            anchorAction={isPersistedProject && selected.ob.category !== '保固' ? (
              <button type="button" onClick={openAnchorEditor} className="inline-flex min-h-11 items-center text-[var(--blue-text)] hover:underline">設定基準日</button>
            ) : null}
            warrantyAction={isPersistedProject ? (
              <>請<button type="button" onClick={openWarrantyEditor} className="inline-flex min-h-11 items-center text-[var(--blue-text)] hover:underline mx-0.5">在履約期程卡登錄契約保固期間</button>（引用契約條文）。</>
            ) : null} />
        </div>
      )}

      {/* 6. 動作列:只看歸屬(isMine)與狀態;無權限不渲染假按鈕。循環義務逐期標記在上方「期次」 */}
      <div className="px-4 py-3 border-t border-[var(--border)] flex items-center gap-2 flex-wrap">
        {selected.recurring && actable && (
          <span className="flex-1 min-w-[180px] text-caption text-[var(--text-3)] leading-relaxed">循環義務逐期標記:在上方「期次」對該期標記完成或退回。</span>
        )}
        {!selected.recurring && actable && activeStatus && (<>
          <Button size="md" busy={busy === 'done'} onClick={markDone}>
            <MSym name="task_alt" size={17} fill /> 標記完成
          </Button>
          <Button variant="outline" size="md" disabled={!!busy}
            onClick={() => { setEvidenceOpen((o) => !o); setEvidencePick('') }}>
            <MSym name="upload_file" size={17} /> 掛佐證
          </Button>
        </>)}
        {!selected.recurring && actable && selected.status === 'done' && (
          <Button variant="outline" size="md" busy={busy === 'undo'} onClick={undoDone}>
            <MSym name="undo" size={17} /> 取消完成
          </Button>
        )}
        {!selected.recurring && actable && selected.status === 'na' && (
          <span className="flex-1 min-w-[180px] text-caption text-[var(--text-3)] leading-relaxed">
            {selected.penalty ? '罰則條款,非待辦事項;條件成立時自動轉為待處理。' : '相關基準日尚未設定,推不出到期日,暫非待辦事項。'}
          </span>
        )}
        {!isMine && !actable && selected.who === UNASSIGNED_PARTY && (
          // 責任方推不出三方:三方都不能標記(DB 同一條規則);已確認內容不可改,到擷取審核廢止取代後補登
          <span className="flex-1 min-w-[180px] text-caption text-[var(--text-3)] leading-relaxed">
            責任方尚未設定,三方都無法標記。請到
            <Link to={`/requirements/review?highlight=${encodeURIComponent(selected.id)}`} className="text-[var(--blue-text)] hover:underline mx-0.5">擷取審核</Link>
            廢止取代後補登責任方。
          </span>
        )}
        {!isMine && !actable && selected.who !== UNASSIGNED_PARTY && (
          <span className="flex-1 min-w-[180px] text-caption text-[var(--text-3)] leading-relaxed">
            由{selected.who}負責執行,本頁為唯讀檢視。
          </span>
        )}
        {canReport && (
          <Button variant="ghost" size="md" className="ml-auto" onClick={() => { setReportOpen(true); setReportMsg('') }}>
            擷取有誤
          </Button>
        )}
      </div>
      {evidenceOpen && actable && !selected.recurring && (
        <div className="px-4 pb-4 flex items-center gap-2 flex-wrap">
          {submittals.length ? (<>
            <Select value={evidencePick} onChange={(e) => setEvidencePick(e.target.value)}
              aria-label="選擇佐證送審文件" className="flex-1 min-w-[200px] !text-xs">
              <option value="">選擇送審文件作為佐證…</option>
              {submittals.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </Select>
            <Button size="sm" disabled={!evidencePick || busy === 'evidence'} onClick={attachEvidence}>掛上佐證</Button>
            <span className="w-full text-caption text-[var(--text-3)]">掛佐證不會自動標記完成。</span>
          </>) : (
            <span className="text-xs text-[var(--text-3)]">尚無送審文件可掛;至「送審文件」建立後再回來掛佐證。</span>
          )}
        </div>
      )}
    </>)
  }

  // 關鍵工項(P5d):計畫起迄與完成%;廠商在這裡維護(承接自已移除的逐工項排程頁),其他角色唯讀
  const workItemDetail = () => {
    const r = selected.row
    const linked = holdRows.filter((h) => h.point.work_item_key === r.key)
    const meta = [
      ['責任方', '廠商（內部規劃）'],
      ['階段', phaseName(selected.phase)],
      ['單位', r.it.unit || '—'],
      ['契約數量', r.it.quantity != null ? String(r.it.quantity) : '—'],
      ['累計完成', `${r.cumQty}（最新一期估驗）`],
      ['完成%', `${r.pct.toFixed(1)}%`],
      ['計畫起', selected.planned.start || '未定'],
      ['計畫迄', selected.planned.finish || '未定'],
    ]
    return (<>
      <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
        <Badge color={selected.tone}>{selected.statusLabel}</Badge>
        <WhoPill who="廠商" self={viewerParty === '廠商'} />
        <TagChip>{WORK_ITEM_TYPE}</TagChip>
      </div>
      <div className="p-4">
        <div className="text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{selected.title}</div>
        <MetaGrid rows={meta} className="mt-3.5" />
        <p className="mt-3 text-caption text-[var(--text-3)] leading-relaxed">完成% = 最新一期估驗的累計完成數量 ÷ 契約數量;今天超過計畫迄且未完成 → 落後,今天在計畫起迄之間 → 進行中。</p>
      </div>
      {canMaintainKeyItems && (
        <div className="px-4 pb-4">
          <div className="text-footnote font-medium text-[var(--text)] mb-2">計畫起迄</div>
          <div className="grid grid-cols-2 max-md:grid-cols-1 gap-2">
            {/* 只送變動的單欄;合併(起+訖)由 setItemSchedule 以 ref 累積+debounce 處理(R4 P1-01) */}
            <Field label="計畫開始日">
              <Input type="date" value={selected.planned.start} onChange={(e) => setKeyItem(r.key, { planned_start: e.target.value || null })} />
            </Field>
            <Field label="計畫完成日">
              <Input type="date" value={selected.planned.finish} onChange={(e) => setKeyItem(r.key, { planned_finish: e.target.value || null })} />
            </Field>
          </div>
          <ErrorBanner msg={keyItemErr} onClose={() => setKeyItemErr('')} className="mt-2" />
        </div>
      )}
      <div className="px-4 pb-4">
        <div className="text-footnote font-medium text-[var(--text)] mb-2">關聯</div>
        <div className="flex flex-col gap-1.5">
          {linked.map((h) => (
            <button key={h.point.id} type="button" onClick={() => select(holdPointEntryId(h.point.id))} className={`${relLink} text-left w-full`}>
              <MSym name="flag" size={15} className="text-[var(--text-3)] shrink-0" />
              <span className="flex-1 min-w-0 truncate">{h.typeLabel} · {h.point.title}</span>
              <Badge color={h.state.tone}>{h.state.label}</Badge>
            </button>
          ))}
          <Link to="/valuation" className={relLink}>
            <MSym name="payments" size={15} className="text-[var(--text-3)] shrink-0" />
            <span className="flex-1 min-w-0 truncate">估驗計價 · 累計完成數量的來源</span>
            <MSym name="chevron_right" size={16} className="text-[var(--text-3)] shrink-0" />
          </Link>
        </div>
      </div>
      <div className="px-4 py-3 border-t border-[var(--border)] flex items-center gap-2 flex-wrap">
        {canMaintainKeyItems ? (
          <Button variant="ghost" size="md" onClick={() => dropKeyItem(r)}><MSym name="close" size={17} /> 移除關鍵工項</Button>
        ) : (
          <span className="text-caption text-[var(--text-3)] leading-relaxed">廠商的內部規劃,本頁為唯讀檢視。</span>
        )}
      </div>
    </>)
  }

  // 停留點(P5d):狀態由查驗推導(與 /itp 同一條規則);立即處理入口導到停留點／品質查驗的那一筆
  const holdPointDetail = () => {
    const r = selected.row
    const p = r.point
    const meta = [
      ['類型', r.typeLabel],
      ['責任方', selected.who || '—'],
      ['階段', phaseName(selected.phase)],
      ['允收標準', p.acceptance_criteria || '—'],
      ['頻率', p.frequency || '—'],
      ['出處', p.source_clause || '—'],
      ['工項', p.work_item_key ? `${p.work_item_no || ''} ${p.work_item_desc || ''}`.trim() || p.work_item_key : '—'],
      ['計畫起迄', r.schedule ? `${r.schedule.planned_start || '未定'} ～ ${r.schedule.planned_finish || '未定'}` : '工項未列關鍵工項'],
      ['施作', r.active ? '已有施工日誌數量' : '尚無施工日誌數量'],
      ['查驗', r.inspection ? `${r.inspection.title}（${r.inspection.status}）` : '尚未申請'],
    ]
    const org = currentUser?.org_type
    const toPoint = detailLink('/itp', 'point', p.id)
    return (<>
      <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2 flex-wrap">
        <Badge color={selected.tone}>{selected.statusLabel}</Badge>
        {selected.who && <WhoPill who={selected.who} self={selected.who === viewerParty} />}
        <TagChip>{HOLD_POINT_TYPE}</TagChip>
      </div>
      <div className="p-4">
        <div className="text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{p.title}</div>
        <MetaGrid rows={meta} className="mt-3.5" />
        {r.hot && (
          <p className="mt-3 text-footnote leading-relaxed text-[var(--red-text)] bg-[var(--red-tint)] rounded-lg px-3 py-2">
            {p.point_type === 'H' ? '該工項已在施作——停留點未經監造查驗不得續作。' : '該工項施作中,應通知監造到場見證。'}
          </p>
        )}
      </div>
      <div className="px-4 pb-4">
        <div className="text-footnote font-medium text-[var(--text)] mb-2">關聯</div>
        <div className="flex flex-col gap-1.5">
          {r.schedule && (
            <button type="button" onClick={() => select(workItemEntryId(p.work_item_key))} className={`${relLink} text-left w-full`}>
              <MSym name="construction" size={15} className="text-[var(--text-3)] shrink-0" />
              <span className="flex-1 min-w-0 truncate">關鍵工項 · {p.work_item_no} {p.work_item_desc}</span>
              <MSym name="chevron_right" size={16} className="text-[var(--text-3)] shrink-0" />
            </button>
          )}
          {r.inspection && (
            <Link to={detailLink('/quality', 'inspection', r.inspection.id)} className={relLink}>
              <MSym name="checklist" size={15} className="text-[var(--text-3)] shrink-0" />
              <span className="flex-1 min-w-0 truncate">查驗 · {r.inspection.title}（{r.inspection.status}）</span>
              <MSym name="chevron_right" size={16} className="text-[var(--text-3)] shrink-0" />
            </Link>
          )}
        </div>
      </div>
      <div className="px-4 py-3 border-t border-[var(--border)] flex items-center gap-2 flex-wrap">
        {org === 'contractor' && (r.st.key === 'pending' || r.st.key === 'failed') && (
          <Link to={toPoint} className="inline-flex rounded-lg"><Button size="md" tabIndex={-1}><MSym name="flag" size={17} /> 到停留點申請查驗</Button></Link>
        )}
        {org === 'supervisor' && r.st.key === 'requested' && r.inspection && (
          <Link to={detailLink('/quality', 'inspection', r.inspection.id)} className="inline-flex rounded-lg"><Button size="md" tabIndex={-1}><MSym name="checklist" size={17} /> 到品質查驗判定</Button></Link>
        )}
        <Link to={toPoint} className="inline-flex items-center gap-1 max-md:min-h-11 text-footnote text-[var(--blue-text)] hover:underline ml-auto">
          {navLabel('/itp')}<MSym name="chevron_right" size={15} />
        </Link>
      </div>
    </>)
  }

  const detailBody = selected && (selected.entryKind === 'work_item' ? workItemDetail() : selected.entryKind === 'hold_point' ? holdPointDetail() : obligationDetail())

  // ── 回報擷取有誤 Modal ───────────────────────────────────────────────────
  const reportModal = selected?.entryKind === 'obligation' && (
    <ModalShell open={reportOpen} onClose={() => setReportOpen(false)} title="回報 AI 擷取有誤">
      <p className="text-xs text-[var(--text-3)] mb-3 leading-relaxed">
        「{selected.title}」——送出後由監造/機關複查;契約效力一律以原文為準。
      </p>
      <div className="space-y-2">
        <Select value={reportDraft.type} aria-label="錯誤類型"
          onChange={(e) => setReportDraft((d) => ({ ...d, type: e.target.value }))}>
          {REPORT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Textarea rows={3} value={reportDraft.note} placeholder="說明哪裡擷取錯了(可留白)"
          onChange={(e) => setReportDraft((d) => ({ ...d, note: e.target.value }))} />
        <ErrorBanner msg={reportMsg} />
        <div className="flex gap-2 pt-1">
          <Button size="sm" busy={reportBusy} onClick={submitReport}>送出回報</Button>
          <Button variant="ghost" size="sm" onClick={() => setReportOpen(false)}>取消</Button>
        </div>
      </div>
    </ModalShell>
  )

  // ── 版面區塊 ─────────────────────────────────────────────────────────────
  // 頁首入口:AI 建議的核定/駁回與手動補登在獨立的擷取審核頁(本頁不做審核)。
  // Link 包 Button:內層退出 tab 序避免 Tab 停兩次(同 PrerequisiteEmptyState 作法);
  // Link 的圓角跟 md 按鈕走 rounded-lg,焦點框才不會比按鈕圓。
  const header = (
    <div className="space-y-3">
    <PageHeader title="契約重點" tagline="履約時程" subtitle={PARTY_BLURB[viewerParty]} keepSubtitle
      action={(
        <Link to={packageId ? `/requirements/review?package=${encodeURIComponent(packageId)}` : '/requirements/review'} className="inline-flex rounded-lg">
          <Button variant="secondary" size="md" tabIndex={-1}>
            <MSym name="rate_review" size={16} /> 擷取審核
          </Button>
        </Link>
      )} />
    <ContractFlow active="highlights" role={currentUser?.org_type} packageId={packageId} />
    {isPersistedProject && (packages.length > 0 || packageId) && (
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2 min-w-0">契約範圍
          <Select aria-label="契約範圍" value={packageId} className="max-w-[240px]"
            onChange={(e) => setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('obligation');
              if (e.target.value) n.set('package', e.target.value); else n.delete('package'); return n })}>
            <option value="">全部可見契約</option>
            {packageId && !packages.some((p) => p.id === packageId) && <option value={packageId}>指定契約（未取得）</option>}
            {packages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </Select>
        </label>
        <span className="text-[var(--text-3)]">目前範圍共 {obligationPool.length} 項履約事項{packageId ? '（指定契約時不列關鍵工項與停留點）' : ''}</span>
      </div>
    )}
    {analyzing && <p role="status" className="text-xs text-[var(--blue-text)]">AI 仍在整理，已完成的結果會自動更新。請保留啟動上傳的瀏覽器分頁。</p>}
    {coverageWarnings.length > 0 && (
      <div role="status" className="rounded-md px-4 py-3 text-xs leading-relaxed text-[var(--amber-text)] bg-[var(--amber-tint)]">
        <p className="font-medium">目前整理紀錄中有 {coverageWarnings.length} 份文件需要檢查完整性</p>
        <ul className="list-disc pl-4 mt-1 space-y-1">
          {coverageWarnings.map((warning, i) => <li key={i}>{warning}</li>)}
        </ul>
        <Link to="/contract" className="inline-flex min-h-11 items-center text-[var(--blue-text)] hover:underline">查看專案文件</Link>
      </div>
    )}
    </div>
  )

  // 履約執行卡:每個可見責任方一張(README 2.2)。統計母體=該方全部可見義務
  const execCards = (
    <div className="flex items-stretch gap-3 flex-wrap">
      {partyCards.map(({ name, stat }) => {
        const rateCls = stat.rate == null ? 'text-[var(--text-2)]'
          : stat.rate === 100 ? 'text-[var(--green-text)]'
            : stat.rate >= 80 ? 'text-[var(--text)]' : 'text-[var(--red-text)]'
        const seg = (v, c) => (v ? (
          <span key={c} style={{ width: `${(v / stat.total) * 100}%`, background: c }} />
        ) : null)
        const rows = [
          ['逾期', stat.n.overdue, 'overdue'], ['即將到期', stat.n.due, 'due'],
          ['排程中', stat.n.scheduled, 'scheduled'], ['已完成', stat.n.done, 'done'],
          ...(stat.n.na ? [[OB_STATUS.na.label, stat.n.na, 'na']] : []),
        ]
        return (
          <Surface key={name} className="stat-card flex-1 min-w-[260px] max-xl:min-w-[calc(50%-6px)] max-md:min-w-full px-4 py-3.5 border-l-[3px]"
            style={{ borderLeftColor: PARTY_META[name].mark }}>
            <div className="flex items-center gap-2 mb-[11px]">
              <MSym name={PARTY_META[name].icon} size={18} className="text-[var(--text-2)]" />
              <span className="text-body font-medium text-[var(--text)]">{name}</span>
              {name === viewerParty && (
                <span className="inline-flex items-center h-[18px] px-[7px] rounded-full bg-[var(--blue-tint)] text-[var(--blue-text)] text-micro font-medium">自己</span>
              )}
              <span className="num ml-auto text-caption text-[var(--text-2)]">{stat.total} 條義務</span>
            </div>
            <div className="flex items-baseline gap-[9px] mb-[11px]">
              <span className={`num stat-value font-normal leading-none ${rateCls}`}>{stat.rate == null ? '—' : `${stat.rate}%`}</span>
              <span className="text-caption text-[var(--text-2)] leading-snug">
                {/* 循環義務逐期計入(periodsSettled):到期的每一期各算一項 */}
                {stat.rate == null ? '尚無到期項目' : `到期 ${stat.settled} 項準時完成 ${stat.onTime} 項${stat.periodsSettled ? `（含循環 ${stat.periodsSettled} 期）` : ''}`}
              </span>
            </div>
            <div className="flex h-1.5 rounded-full overflow-hidden bg-[var(--border-2)] mb-2.5" aria-hidden>
              {seg(stat.n.done, 'var(--success)')}
              {seg(stat.n.overdue, 'var(--danger)')}
              {seg(stat.n.due, 'var(--accent)')}
            </div>
            <div className="flex items-center gap-3.5 flex-wrap">
              {rows.map(([label, v, k]) => (
                <span key={k} className="inline-flex items-center gap-1.5 text-caption text-[var(--text-2)]">
                  <Dot color={OB_STATUS[k].badge} />{label}
                  <span className="num font-medium text-[var(--text)]">{v}</span>
                </span>
              ))}
            </div>
          </Surface>
        )
      })}
    </div>
  )

  // 關鍵工項與停留點摘要(P5d,承接自已移除的逐工項排程頁統計列):件數＋廠商加入關鍵工項的入口(桌機;
  // 計畫起迄是辦公室作業,規範 §9.6 的決策沿用)。沒有標單也沒有停留點時不渲染——沒有可講的數字。
  const showKeyCard = (!!workItems && (dbMode || demoMode)) || holdRows.length > 0
  const keyCard = showKeyCard && (
    <Card title="關鍵工項與停留點" bodyClass="px-5 py-3.5"
      action={<span className="text-caption text-[var(--text-3)] max-md:hidden">與契約義務同一條時程;點清單中的事項查看與維護</span>}>
      <div className="flex items-center gap-x-3.5 gap-y-1.5 flex-wrap text-caption text-[var(--text-2)]">
        <span>關鍵工項 <span className="num font-medium text-[var(--text)]">{keyCounts.total}</span> 項</span>
        <span className="inline-flex items-center gap-1.5"><Dot color="red" />落後 <span className="num font-medium text-[var(--text)]">{keyCounts.late}</span></span>
        <span className="inline-flex items-center gap-1.5"><Dot color="blue" />進行中 <span className="num font-medium text-[var(--text)]">{keyCounts.doing}</span></span>
        <span className="inline-flex items-center gap-1.5"><Dot color="green" />已完成 <span className="num font-medium text-[var(--text)]">{keyCounts.done}</span></span>
        <span className="w-px h-4 bg-[var(--border-2)] max-md:hidden" aria-hidden="true" />
        <span>停留點 <span className="num font-medium text-[var(--text)]">{holdCounts.total}</span> 個</span>
        <span className="inline-flex items-center gap-1.5"><Dot color="red" />施作中未叫驗 <span className="num font-medium text-[var(--text)]">{holdCounts.hot}</span></span>
        <span className="inline-flex items-center gap-1.5"><Dot color="blue" />待監造查驗 <span className="num font-medium text-[var(--text)]">{holdCounts.requested}</span></span>
      </div>
      {canMaintainKeyItems && (
        <div className="mt-3 max-md:hidden">
          <WorkItemPicker leaves={leaves} value="" label="" placeholder="搜尋工項加入關鍵工項…" inputProps={{ 'aria-label': '加入關鍵工項' }}
            onPick={(key) => addKeyItem(key)} />
          <p className="mt-1.5 text-caption text-[var(--text-3)]">建議只列關鍵／大宗工項;加入後在事項詳情設定計畫起迄,今天超過計畫迄且未完成即列為落後。</p>
        </div>
      )}
      {!keyCounts.total && !canMaintainKeyItems && holdRows.length === 0 && (
        <p className="mt-2 text-caption text-[var(--text-3)]">尚未設定關鍵工項。</p>
      )}
    </Card>
  )

  // 履約期程條(README 2.3):五段等寬、點擊切換篩選(再點取消);統計母體=可見集合。
  // 點期程=看整段,切到全期視圖(近期視圖本來就不分段)。外層 div 只給「設定基準日」入口捲到這張卡用。
  const phaseBar = (
    <div ref={anchorCardRef} className="scroll-mt-[calc(var(--top-bar-h)_+_16px)]">
    <Card bodyClass="px-[18px] pt-[15px] pb-[17px]">
      <div className="flex items-baseline justify-between gap-4 mb-[13px] flex-wrap">
        <span className="text-body font-medium text-[var(--text)]">履約期程</span>
        <span className="inline-flex items-baseline gap-3">
          <span className="num text-caption text-[var(--text-2)]">{milestoneMeta}</span>
          {isPersistedProject && (
            <button type="button" onClick={() => setAnchorOpen((v) => !v)} aria-expanded={anchorOpen}
              className="inline-flex items-center gap-1 text-caption text-[var(--blue-text)] hover:underline pressable">
              <MSym name="edit_calendar" size={14} />設定基準日
            </button>
          )}
        </span>
      </div>
      {/* 缺口提示:幾條義務在等哪個基準日——數字來自 anchorGaps,設完就消失 */}
      {isPersistedProject && !anchorOpen && gaps.total > 0 && (
        <button type="button" onClick={() => setAnchorOpen(true)}
          className="w-full mb-3 flex items-center gap-2.5 rounded-[10px] bg-[var(--amber-tint)] px-3.5 py-2.5 text-left pressable">
          <MSym name="event_busy" size={16} className="text-[var(--amber-text)] shrink-0" />
          <span className="min-w-0 flex-1 text-footnote leading-snug text-[var(--amber-text)]">
            {gaps.gaps.map((g) => `${g.count} 條義務等待${g.label}`).join('、')}——設定後自動排入時程並開始倒數
          </span>
          <span className="text-footnote font-medium text-[var(--amber-text)] shrink-0">設定</span>
        </button>
      )}
      {/* 保固期滿日與依據(P5e):正式驗收合格日＋契約保固期間,兩項各自的來源與缺口入口 */}
      {(isPersistedProject || projectWarranty) && (
        <div className="mb-3">
          <WarrantyBasis warranty={projectWarranty} source={warrantySource}
            onEditTerm={isPersistedProject && can.admin ? openWarrantyEditor : null} />
        </div>
      )}
      {isPersistedProject && anchorOpen && (
        <div className="mb-3 rounded-[10px] border border-[var(--border-card)] bg-[var(--bg)] px-3.5 pt-3 pb-3.5">
          <div className="flex flex-wrap gap-4">
            {/* 可編輯＝專案管理者(鏡像 update_project_anchors 的 is_project_admin();非管理者送出一定被拒,不給假可編輯) */}
            <AnchorDates anchors={anchors} onSet={setAnchor} disabled={!can.admin} basis={anchorBasis} onBasis={setAnchorBasis} />
            <WarrantyTermEditor warranty={projectWarranty} candidates={warrantyCandidates} disabled={!can.admin}
              onSave={saveWarrantyTerm} inputId="warranty-term-value" />
          </div>
          <ErrorBanner msg={anchorErr} className="mt-2" />
          {anchorMsg && <p role="status" className="mt-2 text-footnote text-[var(--green-text)]">{anchorMsg}</p>}
          {/* P5c:目前依據哪一版、哪份文件;變更後受影響事項;版本紀錄可展開 */}
          <div className="mt-3 pt-3 border-t border-[var(--border-2)]">
            <AnchorVersions versions={anchorVersions} />
          </div>
          <p className="text-xs text-[var(--text-3)] mt-2">
            未完成的到期日、倒數與逾期依現行基準日即時計算;已完成的期次與義務保留完成當時的依據。每次變更都留一版——展延、停復工、核准變更工期請選類別並填依據函文。「開工日」請填實際開工日(非預定日),填了系統就會照它發提醒。
          </p>
        </div>
      )}
      <div className="flex items-stretch gap-0.5 max-xl:overflow-x-auto max-xl:pb-1">
        {PHASES.map((ph) => {
          const s = phaseStat(pool, ph.key, phaseWin.nowPhase)
          const active = filters.phase === ph.key
          return (
            <button key={ph.key} type="button" aria-pressed={active}
              onClick={() => setFilters((f) => ({ ...f, range: 'all', phase: f.phase === ph.key ? 'all' : ph.key }))}
              className={`flex-1 min-w-0 max-xl:min-w-[160px] flex flex-col gap-[7px] px-[11px] pt-[9px] pb-2.5 border rounded-[10px] text-left pressable ${active
                ? 'border-[var(--primary)] bg-[var(--blue-tint)]'
                : 'border-[var(--border-card)] bg-[var(--surface)] hover:bg-[var(--bg)]'}`}>
              <span className="flex items-center gap-[7px] min-h-[17px]">
                <span className="text-footnote font-medium text-[var(--text)] whitespace-nowrap">{ph.name}</span>
                {ph.key === phaseWin.nowPhase && (
                  <span className="num inline-flex items-center h-[17px] px-1.5 rounded-full bg-[var(--primary)] text-[var(--primary-fg)] text-micro font-medium">今天</span>
                )}
              </span>
              <span className="num text-micro text-[var(--text-2)] leading-snug">{phaseWin.ranges[ph.key]}</span>
              <span className="h-1.5 rounded-full" style={{ background: TRACK_BG[s.track] }} aria-hidden />
              <span className={`num text-micro leading-snug ${TONE_CLS[s.tone]}`}>{s.note}</span>
            </button>
          )
        })}
      </div>
    </Card>
    </div>
  )

  // 檢索區:近期／全期 + 搜尋 + 五狀態快篩 + 責任方(可見多方才有)/類型/待補設定下拉,條件 AND
  const filterBar = (
    <div className="px-[18px] py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Segmented aria-label="時程範圍" size="sm" value={range}
          onChange={(v) => setFilters((f) => ({ ...f, range: v, phase: v === 'recent' ? 'all' : f.phase }))}
          options={[{ value: 'recent', label: '近期', count: recentPool.length }, { value: 'all', label: '全期', count: pool.length }]} />
        <span className="text-caption text-[var(--text-3)]">
          {range === 'recent' ? '逾期、7 日內、30 日內排程、待補設定與進行中;最近 7 日完成的仍列出' : '全部事項,依期程分段'}
        </span>
      </div>
      <SearchField ref={searchRef} value={filters.q}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        placeholder="搜尋條文、關鍵字、條款編號、工項或頁碼…" aria-label="搜尋履約事項" />
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_KEYS.map((k) => (
          <StatusChip key={k} active={filters.status === k} count={counts[k]}
            onClick={() => setFilters((f) => ({ ...f, status: f.status === k ? 'all' : k }))}>
            <Dot color={OB_STATUS[k].badge} />{OB_STATUS[k].label}
          </StatusChip>
        ))}
        <span className="w-px h-5 bg-[var(--border-2)] mx-0.5 max-md:hidden" aria-hidden="true" />
        {multiParty && (
          <Select value={filters.who} aria-label="責任方"
            onChange={(e) => setFilters((f) => ({ ...f, who: e.target.value }))}
            className="!w-auto max-md:!w-full !h-[30px] !py-0 !text-xs !rounded-lg">
            <option value="">全部責任方</option>
            {whoOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        )}
        <Select value={filters.type} aria-label="類型"
          onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
          className="!w-auto max-md:!w-full !h-[30px] !py-0 !text-xs !rounded-lg">
          <option value="">全部類型</option>
          {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        {/* 待補設定(P5d):四類缺口＋回填待核對各自可篩;件數 0 也列,讓人知道「沒有這種缺口」 */}
        <Select value={filters.setup} aria-label="待補設定"
          onChange={(e) => setFilters((f) => ({ ...f, setup: e.target.value }))}
          className="!w-auto max-md:!w-full !h-[30px] !py-0 !text-xs !rounded-lg">
          <option value="">待補設定：全部事項</option>
          <option value="any">任一待補設定（{setupCounts.any}）</option>
          {SETUP_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}（{setupCounts[k.key]}）</option>)}
        </Select>
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={() => setFilters((f) => ({ ...DEFAULT_FILTERS, range: f.range }))}>清除篩選</Button>
        )}
      </div>
    </div>
  )

  // 時間軸列:日期/軸線/內容/狀態(<768 直排、軸線隱藏);契約義務、關鍵工項、停留點同一種列
  const renderRow = (it, { showPhase }) => {
    const active = it.id === selectedId
    const metaLine = it.entryKind === 'work_item'
      ? [showPhase ? phaseName(it.phase) : null, it.row.it.unit ? `單位 ${it.row.it.unit}` : null, `完成 ${it.pct.toFixed(1)}%`, `計畫 ${it.planned.start || '未定'} ～ ${it.planned.finish || '未定'}`]
      : it.entryKind === 'hold_point'
        ? [showPhase ? phaseName(it.phase) : null, it.row.point.work_item_key ? `工項 ${it.row.point.work_item_no || ''} ${it.row.point.work_item_desc || ''}`.trim() : null, it.row.point.frequency || null]
        : [showPhase ? phaseName(it.phase) : null, it.clause ? `契約條款 ${it.clause}` : null, it.page || null, it.type, it.recurring && it.currentPeriod ? `本期 ${it.currentPeriod}` : null]
    return (
      <button key={it.id} type="button" role="listitem" id={`ob-${it.id}`}
        aria-current={active || undefined}
        onClick={() => select(it.id, { openPane: true })}
        className={`w-full text-left grid grid-cols-[104px_26px_minmax(0,1fr)_96px] max-md:grid-cols-1 gap-3 max-md:gap-1 items-stretch border-b border-[var(--border-2)] cursor-pointer max-md:px-[18px] max-md:py-3 ${active
          ? 'bg-[var(--blue-tint)]' : 'hover:bg-[var(--bg)]'}`}>
        <span className="py-3 pl-[18px] max-md:p-0 max-md:order-2 flex flex-col max-md:flex-row gap-[3px] max-md:gap-2 max-md:items-center">
          <span className="num text-xs font-medium text-[var(--text)]">{it.dateLabel}</span>
          <span className={`num text-micro leading-normal ${COUNTDOWN_CLS[it.status] || 'text-[var(--text-2)]'}`}>{it.countdown}</span>
        </span>
        <span className="relative flex justify-center max-md:hidden" aria-hidden>
          <i className="w-[2px] bg-[var(--border-2)]" />
          <b className="absolute top-3.5 w-[11px] h-[11px] rounded-full bg-[var(--surface)] border-[2.5px] border-solid box-border"
            style={{ borderColor: OB_STATUS[it.status].dot }} />
        </span>
        <span className="py-3 max-md:p-0 max-md:order-1 min-w-0 flex flex-col gap-1">
          <span className="flex items-center gap-[7px] flex-wrap">
            {it.who && <WhoPill who={it.who} self={it.who === viewerParty} />}
            {it.entryKind !== 'obligation' && <TagChip>{it.type}</TagChip>}
            {it.kind && <TagChip>{it.kind}</TagChip>}
            {it.setup.length > 0 && <SetupChip />}
          </span>
          <span className="text-body font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{it.title}</span>
          <span className="num text-caption leading-relaxed text-[var(--text-2)]">{metaLine.filter(Boolean).join(' · ')}</span>
        </span>
        <span className="py-3 pr-[18px] max-md:p-0 max-md:order-3 flex justify-end max-md:justify-start items-start">
          <Badge color={it.tone || OB_STATUS[it.status].badge}>{it.statusLabel || OB_STATUS[it.status].label}</Badge>
        </span>
      </button>
    )
  }
  const listRows = (
    <div role="list" aria-label="履約義務時間軸">
      {ordered.length === 0 ? (
        <div className="px-[18px] py-12 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
          {range === 'recent' && !anyFilter
            ? <>近期沒有要處理的事項。<br />切到「全期」查看全部履約事項與期程。</>
            : <>沒有符合條件的事項。<br />試試條款編號(例 5.3)、頁碼,或關鍵字(例 保固、罰則、送審){range === 'recent' ? ';或切到「全期」' : ''}。</>}
        </div>
      ) : range === 'recent' ? ordered.map((it) => renderRow(it, { showPhase: true })) : grouped.map((g) => {
        const s = phaseStat(pool, g.key, phaseWin.nowPhase)
        return (
          <div key={g.key}>
            {/* flex-wrap:三段 nowrap 文字(期程名/日期區間/件數註記)在手機階梯(caption 13、
                footnote 15)下加起來 >341px,是 375 全路由掃描唯一紅的一處。註記段 ml-auto:
                掉到第二行時靠右,與桌機「註記在右端」的閱讀位置一致;桌機第一行的剩餘空間
                全被 flex-1 髮絲線吃掉,ml-auto 拿到 0,版面不變。 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-[18px] pt-[13px] pb-[11px] bg-[var(--bg)] border-b border-[var(--border-2)]">
              <span className="text-footnote font-medium text-[var(--text)] whitespace-nowrap">{g.name}</span>
              <span className="num text-caption text-[var(--text-2)] whitespace-nowrap">{phaseWin.ranges[g.key]}</span>
              <span className="flex-1 h-px bg-[var(--border-2)]" aria-hidden />
              <span className={`num text-caption whitespace-nowrap ml-auto ${TONE_CLS[s.tone]}`}>{s.note}</span>
            </div>
            {g.items.map((it) => renderRow(it, { showPhase: false }))}
          </div>
        )
      })}
    </div>
  )

  // ── 版面分支(每個分支都含 PageHeader:早退不得吃掉工作面分頁列)──────────
  const skeleton = (
    <div className="space-y-6">
      {header}
      <div className="flex gap-3">
        <Surface className="flex-1 p-4"><SkeletonList rows={2} label="正在載入履約時程…" /></Surface>
        <Surface className="flex-1 p-4 max-md:hidden"><SkeletonList rows={2} label="" /></Surface>
      </div>
      <Card><Skeleton className="h-16" /></Card>
      <div className={LIST_DETAIL_GRID}>
        <Card><SkeletonList rows={8} label="" /></Card>
        <Card className="hidden lg:block"><SkeletonList rows={4} label="" /></Card>
      </div>
    </div>
  )
  if (isPersistedProject && !enrichLoaded && !obligations.length) return skeleton

  // 真專案 0 筆義務:分「還沒擷取」「AI 跑完但沒有義務」「最近一次失敗」——
  // 跑完的 0 筆是有效結果,不能把人繞回上傳原點。關鍵工項與停留點若已有,仍列在下方時程
  if (isPersistedProject && enrichLoaded && !obligations.length && !extraEntries.length) {
    const ingestionDone = runs.some((r) => r.status === 'completed')
    const anyRunning = runs.some((r) => ['pending', 'processing'].includes(r.status))
    const latestFailed = runs.find((r) => r.status === 'failed')
    return (
      <div className="space-y-6">
        {header}
        <ErrorBanner msg={enrichError} onRetry={reloadEnrich} />
        <Card title="履約時程">
          {anyRunning ? (
            <Empty>AI 正在整理契約，完成的內容會自動出現在這裡。</Empty>
          ) : ingestionDone ? (
            <Empty>目前沒有可見的履約義務。AI 整理內容會自動歸檔；可到專案文件查看完整性與處理狀態，無需逐條確認。</Empty>
          ) : latestFailed && !anyRunning ? (
            <Empty icon="error">
              最近一次 AI 整理失敗{latestFailed.error_message ? `:${friendlyError(latestFailed.error_message, '請重試')}` : ''}。
              到「<Link to="/contract" className="text-[var(--blue-text)] hover:underline">專案文件</Link>」的文件清單可重試分析。
            </Empty>
          ) : (
            <PrerequisiteEmptyState
              need="這個專案還沒有擷取結果。"
              unlocks="AI 把契約義務逐條排上時程,三方各自追蹤執行情形"
              to="/contract" cta="前往專案文件上傳契約" />
          )}
        </Card>
        {keyCard}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}

      <ErrorBanner msg={enrichError} onRetry={reloadEnrich} />

      {execCards}
      {keyCard}
      {phaseBar}

      <ListDetailLayout
        detail={detailBody}
        detailLabel="事項詳情"
        detailEmpty={<Empty>點左側清單查看事項詳情。</Empty>}
        drawerOpen={detailOpen && !!selected}
        onDrawerClose={closeDetail}>
        {/* ── 左欄:時間軸清單(右欄與抽屜由殼統一,見 components/listDetail.jsx) ── */}
        <Card bodyClass="p-0">
          {filterBar}
          {listRows}
          <div className="px-[18px] py-3 flex items-center justify-between gap-4 flex-wrap">
            <span className="num text-caption text-[var(--text-3)]">{footerMeta}</span>
            {isPersistedProject && (
              <Link to="/contract" className="text-caption text-[var(--blue-text)] hover:underline max-md:min-h-11 inline-flex items-center">查看文件與整理狀態</Link>
            )}
          </div>
        </Card>
      </ListDetailLayout>

      {reportModal}
    </div>
  )
}
