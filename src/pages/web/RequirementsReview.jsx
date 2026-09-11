// 擷取審核——契約重點審核流程的新家(/requirements/review,深連結頁不進導覽)。
// 「契約重點 · 履約時程」改版(design_handoff_contract_highlights_timeline)明定
// 主頁不做審核:整套「AI 建議 → 人工審查 → 核定/駁回」與手動補登遷到這裡,
// 功能一條不少——待確認/已確認/不採用三態、檢索與快篩、出處引述、工項連結
// 審核、手動新增。入口=履約時程頁首「擷取審核」與深連結。兩塊版面:
//   1. 契約重點清單(左,主角):搜尋+狀態快篩+類型/階段/頻率下拉
//   2. 條文詳情(右,sticky):原文引述、出處頁碼、關聯項目、核定/駁回
// 期限追蹤摘要條已由履約時程頁承接,本頁不再渲染。
// 生命週期決定一律走 review_requirement RPC(伺服器蓋審查人/時間戳),
// 前端絕不樂觀顯示核定結果;權限判斷鏡像 DB(can_review_requirement/can_write)。
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { supabase } from '../../lib/supabase.js'
import { pageAllSafe, pageAllInSafe } from '../../lib/pagedQuery.js'
import {
  Card, Empty, PageHeader, Badge, Button, Input, Textarea, Select,
  PrerequisiteEmptyState, ErrorBanner, SkeletonList,
} from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../../components/confirm.jsx'
import { openDocumentVersionFile } from '../../lib/documentFileAccess.js'
import { isValidStorageKey } from '../../lib/packageUpload.js'
import { extractionCoverageWarnings } from '../../lib/extractRequirements.js'
import {
  REQUIREMENT_STATUS_LABELS, REQUIREMENT_TYPE_LABELS, RESPONSIBLE_LABELS, ORIGIN_LABELS,
  WORK_ITEM_LINK_STATE_LABELS, ARTIFACT_TYPE_LABELS, GENERATION_TYPE_LABELS,
  latestCompletedRunIds, inDefaultReviewScope, requirementFrequencyKey,
  sourceVerificationSummary, sourcePageLabel, formatRequirementRule, requirementVerification,
} from '../../lib/requirementReview.js'

const PAGE_SIZE = 50

// W8-3A(D-014):「AI 整理完了沒」在全站只有一個判定依據——本案有沒有跑完過一次
// 履約要求擷取(`document_ingestion_runs.status = 'completed'`)。首頁初始化清單第 3 步
// 用它,這一頁也必須用它,否則會出現「首頁說整理完成 → 點進來卻叫你重新上傳」的死路。
// ⚠️ 有 Requirement 不等於 AI 跑完過(可能是人工建立或舊 run),絕不可反推成「整理完成」。
export function requirementsIntro(runs = [], rowCount = 0) {
  const ingestionDone = (runs || []).some((r) => r?.status === 'completed')
  // 每個文件版本的最近一次完成整理各自檢查 coverage，不能讓另一份成功
  // 文件蓋掉缺漏警示，也不能把跑完批次當成沒有漏項的證明。
  const warnings = extractionCoverageWarnings(runs)
  const coverageWarning = warnings.length
    ? `注意：目前整理紀錄中有 ${warnings.length} 份文件需要檢查。${warnings.join(' ')}`
    : null
  if (rowCount > 0) {
    return {
      ingestionDone,
      mode: 'list',
      coverageWarning,
      // 沒有 completed run 時只講審查規則,不宣稱 AI 整理完成
      note: ingestionDone
        ? 'AI 已完成整理並自動歸檔;內容如有出入,以契約原文為準。人工補登的項目仍由監造/機關確認,未確認不影響開啟正式模式。'
        : '人工補登的項目由監造/機關確認,未確認不影響開啟正式模式;內容如有出入,以契約原文為準。',
      emptyText: null,
    }
  }
  // 整理完成但 0 筆:這是有效結果(AI 讀完了沒找到),不是失敗,也沒有事情要做——
  // 不能再給「前往上傳」的 CTA 把人送回原點。
  if (ingestionDone) {
    return {
      ingestionDone, mode: 'done-empty', note: null, coverageWarning,
      emptyText: coverageWarning
        ? '本次沒有找到契約重點建議，但文件尚未完整整理；請先查看缺漏範圍。'
        : 'AI 已完成整理，本次沒有找到契約重點建議，不需逐條確認，也不影響開啟正式模式；這不代表已證明文件沒有任何義務。',
    }
  }
  // W10:run 都停了而且有失敗紀錄時要說「失敗了」,不能偽裝成「還沒開始」——
  // 使用者才知道要去重試,而不是空等。還有 run 在跑就維持「處理中」語意。
  const anyActive = (runs || []).some((r) => ['pending', 'processing'].includes(r?.status))
  const latestFailed = (runs || []).find((r) => r?.status === 'failed') || null
  if (latestFailed && !anyActive) {
    return {
      ingestionDone, mode: 'failed', coverageWarning: null,
      note: null,
      emptyText: `最近一次 AI 整理失敗${latestFailed.error_message ? `:${friendlyError(latestFailed.error_message, '請重試')}` : ''}。到「專案文件」的文件清單可重試分析。`,
    }
  }
  return {
    ingestionDone, mode: 'not-started', note: null, coverageWarning: null,
    emptyText: '尚未有完成的 AI 整理。到「專案文件」上傳契約/規範,或查看目前的處理狀態。',
  }
}

// 五色語意(README Design Tokens):待確認=黃(正常待辦不是異常)、已確認=綠、
// 不採用=灰(含已取代——「不成立/已被取代,不計入義務」是同一格,色票、快篩
// 與計數三處必須同一套帳;取代細節在詳情的伺服器紀錄行)。選中=藍。
// D-017:契約本身已生效,「確認」的對象是 AI 轉錄無誤——不是使契約生效。
const STATUS_PILL = {
  pending: { label: '待確認', color: 'amber' },
  approved: { label: '已確認', color: 'green' },
  rejected: { label: '不採用', color: 'slate' },
}
// 快篩分桶:pending 收 draft_ai+needs_review;rejected 收 rejected+superseded
// (兩者都「不計入義務」,對檢索者是同一格)
const statusKey = (status) => (
  status === 'approved' ? 'approved'
    : ['rejected', 'superseded'].includes(status) ? 'rejected' : 'pending'
)
const EDITABLE_STATUSES = ['draft_ai', 'needs_review']
const fmtTime = (v) => (v ? new Date(v).toLocaleString('zh-TW', { hour12: false }) : '')

// 狀態快篩 chip(README:pill 形、選中=藍框藍底)——與 FilterChip 的
// toggle+close 語意不同,這裡是單選分段,就地用同一套 token 拼裝
const chipCls = (active) => `h-[30px] px-3.5 rounded-full border text-xs font-medium inline-flex items-center gap-1.5 pressable max-md:min-h-11 ${active
  ? 'border-[var(--primary)] bg-[var(--blue-tint)] text-[var(--blue-text)]'
  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--bg)]'}`

// 詳情動作列(獨立元件供測試釘權限):確認/不採用只給契約審查者(監造/機關,
// 鏡像 can_review_requirement,刻意無專案管理者例外);其他人看得到內容但
// 不渲染假操作。
export function ReviewActions({ requirement, canReview, busy, onReview, onEdit, reviewerName }) {
  const st = requirement.status
  // 紀錄格式:`桃園市工務局 林淑芬 確認 · 時間`。審查人名由呼叫端從 profiles
  // 解析(reviewed_by 是伺服器蓋的);reviewed_by 為空的已確認=確定性分流的
  // 系統自動確認(引文+數字核對無誤),要明講不是人簽的
  const VERB = { approved: '確認', rejected: '不採用', superseded: '廢止取代' }
  const autoConfirmed = st === 'approved' && !requirement.reviewed_by && requirement.reviewed_at
  const record = requirement.reviewed_at
    ? (autoConfirmed
      ? `${requirementVerification(requirement).label} · ${fmtTime(requirement.reviewed_at)}(伺服器記錄)`
      : reviewerName
        ? `${reviewerName} ${VERB[st] || REQUIREMENT_STATUS_LABELS[st] || st} · ${fmtTime(requirement.reviewed_at)}(伺服器記錄)`
        : `${REQUIREMENT_STATUS_LABELS[st] || st}·${fmtTime(requirement.reviewed_at)}(伺服器記錄)`)
    : null
  if (EDITABLE_STATUSES.includes(st)) {
    if (!canReview) {
      return (
        <Badge color="slate">
          <MSym name="info" size={12} className="shrink-0" />轉錄確認由監造／機關辦理
        </Badge>
      )
    }
    return (<>
      <Button size="md" disabled={!!busy} onClick={() => onReview('approve', '確認無誤')}>
        <MSym name="check_circle" size={15} fill /> 確認無誤
      </Button>
      <Button variant="outline" size="md" disabled={!!busy} onClick={onEdit}>修正內容</Button>
      <button type="button" disabled={!!busy} onClick={() => onReview('reject', '不採用')}
        className="inline-flex items-center justify-center h-9 px-3.5 rounded-full text-sm font-medium text-[var(--red-text)] hover:bg-[var(--red-tint)] pressable max-md:min-h-11 disabled:opacity-40">
        不採用
      </button>
    </>)
  }
  return (<>
    <span className="flex-1 min-w-0 text-[11.5px] leading-relaxed text-[var(--text-3)] num">{record}</span>
    {st === 'approved' && canReview && (
      <Button variant="outline" size="sm" disabled={!!busy} onClick={() => onReview('supersede', '廢止取代')}>廢止取代</Button>
    )}
  </>)
}

// 關聯列外殼:README 8px 圓角框列(icon+文字)。hover 只給真的可點的列——
// 純資料列(工項對應/流程項目)套上連結外觀會騙人去點
const LINK_ROW_STATIC = 'flex items-center gap-2 px-2.5 py-2 max-md:min-h-11 border border-[var(--border-2)] rounded-lg text-xs text-[var(--text-2)] min-w-0'
const LINK_ROW = `${LINK_ROW_STATIC} hover:bg-[var(--bg)]`

// W10 手動新增契約重點:AI 漏抽或文件未涵蓋的義務,人工補登。走既有的
// requirement 流(origin='manual'、status='needs_review' → 人工核定 → deadline
// 型單向物化為契約義務)——義務表是 system-managed,這是唯一正確的補登路徑。
const MANUAL_BLANK = {
  title: '', description: '', requirement_type: 'deadline',
  responsible_party_type: '', lifecycle_phase: '施工中',
  dueMode: 'relative', trigger_event: 'commencement', offset_days: '', offset_dir: 'after',
  fixed_date: '', monthly_day: '',
  // 循環時點(頻率值域對齊 requirementExtraction.ts 的 FREQUENCY_TYPES)
  weekly_weekday: '1', freq_month: '', freq_day: '',
  acceptance_criteria: '', source_clause: '', source_page: '',
  contract_package_id: '',
}
const MANUAL_TRIGGERS = [
  ['award', '決標日'], ['notice', '接獲開工通知日'], ['commencement', '開工日'], ['completion', '竣工日'],
]
const MANUAL_WEEKDAYS = [
  ['1', '週一'], ['2', '週二'], ['3', '週三'], ['4', '週四'],
  ['5', '週五'], ['6', '週六'], ['7', '週日'],
]

export default function RequirementsReview() {
  const {
    currentProject, isPersistedProject, currentUser, workItems, reloadObligations, can, obligations,
  } = useStore()
  // 鏡像 DB 的 can_review_requirement(機關/監造;刻意無專案管理者例外——技術管理≠契約審核權)
  const canReview = ['owner', 'supervisor'].includes(currentUser?.org_type)
  // 鏡像 DB 的 can_write(requirements insert 政策):廠商/監造/管理者可補登,機關唯讀
  const canAddManual = isPersistedProject && (can.edit || currentUser?.org_type === 'supervisor')

  const [rows, setRows] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [runs, setRuns] = useState([])
  const [sourcesByReq, setSourcesByReq] = useState(new Map())
  const [versionsById, setVersionsById] = useState(new Map())
  const [reviewersById, setReviewersById] = useState(new Map())
  const [packages, setPackages] = useState([])   // 可讀契約包(RLS 過濾;手動補登歸包用)
  const [filters, setFilters] = useState({ q: '', status: 'all', type: '', phase: '', freq: '' })
  const [shownLimit, setShownLimit] = useState(PAGE_SIZE)
  const [selectedId, setSelectedId] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)  // <lg 抽屜/全螢幕詳情
  const [links, setLinks] = useState([])          // requirement_work_items of selected
  const [artifactLinks, setArtifactLinks] = useState([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [editing, setEditing] = useState(null)    // draft copy while editing content
  const [manualItemNo, setManualItemNo] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualDraft, setManualDraft] = useState(MANUAL_BLANK)
  const [manualBusy, setManualBusy] = useState(false)
  const [manualMsg, setManualMsg] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const searchRef = useRef(null)
  const packageId = searchParams.get('package') || ''

  const pid = currentProject?.project_id
  const projectRef = useRef(pid)
  projectRef.current = pid
  const loadGeneration = useRef(0)
  const detailGeneration = useRef(0)
  const runsById = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs])
  const currentRunIds = useMemo(() => latestCompletedRunIds(runs), [runs])
  const packageRuns = useMemo(() => runs.filter((r) => !packageId || versionsById.get(r.document_version_id)?.documents?.contract_package_id === packageId), [runs, versionsById, packageId])
  const packageRows = useMemo(() => rows.filter((r) => !packageId || r.contract_package_id === packageId
    || versionsById.get(runsById.get(r.ingestion_run_id)?.document_version_id)?.documents?.contract_package_id === packageId), [rows, runsById, versionsById, packageId])
  const intro = useMemo(() => requirementsIntro(packageRuns.map((run) => ({
    ...run, document_title: versionsById.get(run.document_version_id)?.documents?.title,
  })), packageRows.length), [packageRuns, packageRows.length, versionsById])

  const reload = useCallback(async () => {
    if (!isPersistedProject || !pid) return
    const generation = ++loadGeneration.current
    const current = () => projectRef.current === pid && loadGeneration.current === generation
    setLoaded(false)
    setLoadError('')
    try {
      const [runResult, requirementResult, packageResult] = await Promise.all([
        pageAllSafe((from, to) => supabase.from('document_ingestion_runs')
          // error_message/metadata:失敗揭露與涵蓋率警示(requirementsIntro)要用
          .select('id, document_version_id, status, started_at, completed_at, model_name, prompt_version, error_message, metadata')
          .eq('project_id', pid).order('started_at', { ascending: false }).order('id').range(from, to)),
        pageAllSafe((from, to) => supabase.from('requirements').select('*')
          .eq('project_id', pid).order('created_at', { ascending: false }).order('id').range(from, to)),
        supabase.from('contract_packages').select('id, title, package_type')
          .eq('project_id', pid).order('created_at'),
      ])
      if (runResult.error) throw runResult.error
      if (requirementResult.error) throw requirementResult.error
      const runRows = runResult.data || []
      const reqRows = requirementResult.data || []
      const ids = reqRows.map((r) => r.id)
      // 一則需求可有多筆出處:300 則需求的出處合計會破單次上限,要分批 + 分頁
      const sourceResult = ids.length
        ? await pageAllInSafe(ids, (chunk, from, to) => supabase.from('requirement_sources')
          .select('*').in('requirement_id', chunk).order('id').range(from, to))
        : { data: [], error: null }
      if (sourceResult.error) throw sourceResult.error
      const sourceRows = sourceResult.data || []
      const byReq = new Map()
      for (const s of sourceRows) {
        if (!byReq.has(s.requirement_id)) byReq.set(s.requirement_id, [])
        byReq.get(s.requirement_id).push(s)
      }
      const versionIds = [...new Set([
        ...sourceRows.map((s) => s.document_version_id),
        ...runRows.map((r) => r.document_version_id),
      ].filter(Boolean))]
      let versions = []
      if (versionIds.length) {
        // storage 欄位:詳情的「開啟原文」直接開原始檔並跳到出處頁(documentFileAccess)
        const versionResult = await pageAllInSafe(versionIds, (chunk, from, to) => supabase.from('document_versions')
          .select('id, version_label, storage_path, original_filename, mime_type, documents(title, document_type, contract_package_id)')
          .in('id', chunk).order('id').range(from, to))
        if (versionResult.error) throw versionResult.error
        versions = versionResult.data || []
      }
      // 審查人名(README 核定紀錄要可歸責到人):profiles 只授權明確欄位,
      // 且 RLS 限同案成員——讀不到就退回「狀態+時間」,不擋頁面
      const reviewerIds = [...new Set(reqRows.map((r) => r.reviewed_by).filter(Boolean))]
      let reviewers = []
      if (reviewerIds.length) {
        const reviewerResult = await pageAllInSafe(reviewerIds, (chunk, from, to) => supabase.from('profiles')
          .select('id, full_name, company').in('id', chunk).order('id').range(from, to))
        if (!reviewerResult.error) reviewers = reviewerResult.data || []
      }
      if (!current()) return
      setRuns(runRows)
      setRows(reqRows)
      setSourcesByReq(byReq)
      setVersionsById(new Map(versions.map((v) => [v.id, v])))
      setReviewersById(new Map(reviewers.map((p) => [p.id, p])))
      setPackages(packageResult.data || [])
    } catch (error) {
      if (current()) setLoadError(friendlyError(error, '契約重點載入失敗'))
    } finally {
      if (current()) setLoaded(true)
    }
  }, [isPersistedProject, pid])

  useEffect(() => {
    setRows([]); setRuns([]); setPackages([]); setSourcesByReq(new Map()); setVersionsById(new Map())
    detailGeneration.current++
    reload()
  }, [reload])

  const loadDetail = useCallback(async (requirementId) => {
    if (!isPersistedProject) return
    const generation = ++detailGeneration.current
    const [{ data: linkRows }, { data: artifactRows }] = await Promise.all([
      supabase.from('requirement_work_items').select('*')
        .eq('requirement_id', requirementId).order('created_at'),
      supabase.from('requirement_artifact_links').select('*')
        .eq('requirement_id', requirementId).order('created_at'),
    ])
    if (generation !== detailGeneration.current) return
    setLinks(linkRows || [])
    setArtifactLinks(artifactRows || [])
  }, [isPersistedProject])

  const select = useCallback((id, { openPane = false } = {}) => {
    setSelectedId(id); setEditing(null); setMsg(''); setManualItemNo('')
    // 抽屜/全螢幕只屬於 <lg:桌機點列不留 detailOpen 殘值,縮窗才不會突然彈出遮罩
    if (openPane && window.matchMedia('(max-width: 1023.98px)').matches) setDetailOpen(true)
    // URL 帶單條連結(?highlight=)可分享;replace 不炸掉瀏覽歷史
    setSearchParams((p) => { const n = new URLSearchParams(p); n.set('highlight', id); return n }, { replace: true })
    loadDetail(id)
  }, [loadDetail, setSearchParams])

  // 檢索範圍:待審 AI 建議只收最新成功擷取(舊 run 的未審建議已過時);
  // 已審決內容(已生效/已駁回/已廢止)是人做成的契約決定,不受最新 run 限制
  // ——重新分析同一份文件不得讓已核定的契約重點從清單消失(W8-3B 舊行為)。
  const scoped = useMemo(
    () => packageRows.filter((r) => (EDITABLE_STATUSES.includes(r.status)
      ? inDefaultReviewScope(r, currentRunIds)
      : true)),
    [packageRows, currentRunIds],
  )
  const counts = useMemo(() => {
    const c = { all: scoped.length, attention: 0, pending: 0, approved: 0, rejected: 0 }
    for (const r of scoped) {
      c[statusKey(r.status)]++
      if (requirementVerification(r).attention) c.attention++
    }
    return c
  }, [scoped])
  const typeOptions = useMemo(
    () => [...new Set(scoped.map((r) => r.requirement_type).filter(Boolean))],
    [scoped],
  )
  const phaseOptions = useMemo(
    () => [...new Set(scoped.map((r) => r.lifecycle_phase).filter(Boolean))],
    [scoped],
  )
  const freqOptions = useMemo(
    () => [...new Set(scoped.map((r) => requirementFrequencyKey(r)))],
    [scoped],
  )
  // 搜尋範圍(README):標題、說明、條款編號、頁碼、原文引述、類型、階段、責任方
  const searchTextByReq = useMemo(() => {
    const map = new Map()
    for (const r of scoped) {
      const sources = sourcesByReq.get(r.id) || []
      map.set(r.id, [
        r.title, r.description,
        REQUIREMENT_TYPE_LABELS[r.requirement_type] || r.requirement_type,
        r.lifecycle_phase, RESPONSIBLE_LABELS[r.responsible_party_type],
        formatRequirementRule(r),
        ...sources.flatMap((s) => [
          s.clause, s.section, s.page_label,
          s.page_number != null ? `第 ${s.page_number} 頁 ${s.page_number}` : '',
          s.source_text,
        ]),
      ].filter(Boolean).join(' ').toLowerCase())
    }
    return map
  }, [scoped, sourcesByReq])

  const visible = useMemo(() => {
    let list = scoped
    if (filters.status === 'attention') list = list.filter((r) => requirementVerification(r).attention)
    else if (filters.status !== 'all') list = list.filter((r) => statusKey(r.status) === filters.status)
    if (filters.type) list = list.filter((r) => r.requirement_type === filters.type)
    if (filters.phase) list = list.filter((r) => r.lifecycle_phase === filters.phase)
    if (filters.freq) list = list.filter((r) => requirementFrequencyKey(r) === filters.freq)
    const q = filters.q.trim().toLowerCase()
    if (q) list = list.filter((r) => (searchTextByReq.get(r.id) || '').includes(q))
    // 檢索頁走「文件序」(擷取順序≈條文順序),不是審查佇列序:狀態不同不代表
    // 條文位置不同,打散順序會讓對照原文的人迷路。待辦入口由預設選取承擔。
    return [...list].sort((a, b) => (new Date(a.created_at) - new Date(b.created_at))
      || String(a.id).localeCompare(String(b.id)))
  }, [scoped, filters, searchTextByReq])
  const shownRows = visible.slice(0, shownLimit)

  // 標題列右側:共 N 條 · 來源 X 份文件 · 最近整理 date(有完成的 run 才有後兩段)
  const listMeta = useMemo(() => {
    const completed = runs.filter((r) => r.status === 'completed')
    const docCount = new Set(completed
      .map((r) => versionsById.get(r.document_version_id)?.documents?.title)
      .filter(Boolean)).size
    const latest = completed.map((r) => r.completed_at).filter(Boolean).sort().pop()
    return [`共 ${scoped.length} 條`, docCount ? `來源 ${docCount} 份文件` : null,
      latest ? `最近整理 ${latest.slice(0, 10)}` : null].filter(Boolean).join(' · ')
  }, [runs, versionsById, scoped.length])

  const selected = packageRows.find((r) => r.id === selectedId) || null
  const selectedSources = useMemo(
    () => (selected ? sourcesByReq.get(selected.id) || [] : []),
    [selected, sourcesByReq],
  )
  // 已確認 → D-012/D-020 物化的義務(關聯列連到期限追蹤;全型別皆物化)
  const selectedObligation = useMemo(
    () => (selected ? obligations.find((o) => o.requirement_id === selected.id) || null : null),
    [selected, obligations],
  )
  const wiById = useMemo(() => {
    const map = new Map()
    for (const it of workItems?.items || []) if (it.id) map.set(it.id, it)
    return map
  }, [workItems])

  // 切換專案(不經 route 卸載)時整組重置:殘留他案的 selectedId/?highlight
  // 會讓右欄空白、URL 指向別案的 requirement
  const initialPicked = useRef(false)
  const selectionScope = `${pid}/${packageId}`
  const seenPid = useRef(selectionScope)
  useEffect(() => {
    if (seenPid.current === selectionScope) return
    seenPid.current = selectionScope
    initialPicked.current = false
    setSelectedId(null); setEditing(null); setLinks([]); setArtifactLinks([])
    setDetailOpen(false); setMsg('')
    setFilters({ q: '', status: 'all', type: '', phase: '', freq: '' }); setShownLimit(PAGE_SIZE)
    setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('highlight'); return n }, { replace: true })
  }, [selectionScope, setSearchParams])

  // 初次載入:深連結(?highlight=)優先,否則預設選第一條待確認(直接進入待辦)
  useEffect(() => {
    if (!loaded || initialPicked.current || !packageRows.length) return
    initialPicked.current = true
    const param = searchParams.get('highlight')
    const deepLinked = param ? packageRows.find((r) => r.id === param) : null
    const target = deepLinked
      || visible.find((r) => EDITABLE_STATUSES.includes(r.status)) || visible[0] || packageRows[0]
    if (!target) return
    select(target.id)
    if (deepLinked) {
      // 深連結列可能落在載入上限之後:先把分頁撐到含該列,捲動才有東西可捲
      const idx = visible.findIndex((r) => r.id === target.id)
      if (idx >= PAGE_SIZE) setShownLimit(Math.ceil((idx + 1) / PAGE_SIZE) * PAGE_SIZE)
      setTimeout(() => document.getElementById(`hl-${target.id}`)?.scrollIntoView({ block: 'center' }), 60)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, packageRows, selectionScope])

  // 「開啟原文」:出處的文件版本 + 頁碼 → 簽名 URL 開原始檔(PDF 跳頁)
  const openableSource = useMemo(() => {
    for (const s of selectedSources) {
      const version = s.document_version_id ? versionsById.get(s.document_version_id) : null
      if (version && isValidStorageKey(version.storage_path)) return { source: s, version }
    }
    return null
  }, [selectedSources, versionsById])
  const openOriginal = useCallback(() => {
    if (!openableSource) return
    openDocumentVersionFile(openableSource.version, {
      page: openableSource.source.page_number, onError: setMsg,
    })
  }, [openableSource])

  // 鍵盤:↑/↓ 移動選取、Enter 開啟原文、/ 聚焦搜尋。只有真正的輸入控件
  // (input/textarea/select)整組跳過——點過清單列或快篩 chip 後焦點留在
  // button 上,快捷鍵必須照常運作;Enter 讓 button/link 走原生 click,不搶
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      const inField = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)
      // 任何 modal 層(手動新增/確認對話框/抽屜)開著就整組停用——
      // 「/」搶焦點到遮罩後的搜尋框、Enter 在確認框後面開原文都是誤觸
      const modalUp = manualOpen || editing
        || document.querySelector('[aria-modal="true"]') != null
      if (e.key === '/' && !inField && !modalUp) { e.preventDefault(); searchRef.current?.focus(); return }
      if (inField || modalUp || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Enter' && t && /^(BUTTON|A)$/.test(t.tagName)) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!shownRows.length) return
        const idx = shownRows.findIndex((r) => r.id === selectedId)
        const next = e.key === 'ArrowDown'
          ? shownRows[Math.min(idx + 1, shownRows.length - 1)]
          : shownRows[Math.max(idx - 1, 0)]
        if (next && next.id !== selectedId) {
          select(next.id)
          document.getElementById(`hl-${next.id}`)?.scrollIntoView({ block: 'nearest' })
        }
      } else if (e.key === 'Enter') {
        openOriginal()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shownRows, selectedId, select, openOriginal, manualOpen, editing])

  // 抽屜/全螢幕詳情(<lg)與手動新增 Modal:Esc 關閉+開啟時把焦點帶進面板
  // (aria-modal 沒有焦點管理=報讀器仍停在遮罩後的清單,W8-5 F2 同一課)
  const drawerRef = useRef(null)
  const manualRef = useRef(null)
  useEffect(() => {
    if (!detailOpen) return
    drawerRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') setDetailOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detailOpen])
  useEffect(() => {
    if (!manualOpen) return
    manualRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') setManualOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [manualOpen])

  // 生命週期決定:唯一路徑是 review_requirement RPC;成功後以伺服器回傳列刷新。
  const review = async (decision, confirmText, requirementId = selectedId, body = '確認的是 AI 轉錄與契約原文一致;契約效力以原文為準,紀錄由伺服器寫入。') => {
    if (!(await appConfirm({ title: confirmText, body, confirmLabel: confirmText }))) return
    setBusy(decision)
    const { data, error } = await supabase.rpc('review_requirement', {
      p_requirement_id: requirementId, p_decision: decision,
    })
    setBusy('')
    if (error) { setMsg(friendlyError(error, '審查未完成')); return }
    setRows((rs) => rs.map((r) => (r.id === data.id ? data : r)))
    if (decision === 'approve' && data.requirement_type === 'deadline') await reloadObligations()
    setMsg('')
  }

  const saveEdit = async () => {
    setBusy('edit')
    const patch = {
      title: editing.title, description: editing.description || null,
      requirement_type: editing.requirement_type,
      responsible_party_type: editing.responsible_party_type || null,
      lifecycle_phase: editing.lifecycle_phase || null,
      acceptance_criteria: editing.acceptance_criteria || null,
      evidence_requirement: editing.evidence_requirement || null,
    }
    const { data, error } = await supabase.from('requirements')
      .update(patch).eq('id', selectedId).select().single()
    setBusy('')
    if (error) { setMsg(friendlyError(error, '儲存未完成')); return }
    setRows((rs) => rs.map((r) => (r.id === data.id ? data : r)))
    setEditing(null); setMsg('')
  }

  const decideLink = async (workItemId, review_status) => {
    const { data, error } = await supabase.from('requirement_work_items')
      .update({ review_status })
      .eq('requirement_id', selectedId).eq('work_item_id', workItemId)
      .select().single()
    if (error) { setMsg(friendlyError(error, '工項連結更新失敗')); return }
    setLinks((ls) => ls.map((l) => (l.work_item_id === workItemId ? data : l)))
  }

  // 手動補登:insert 走 RLS(can_write);status 固定 needs_review(guard trigger
  // 禁止直接以已審狀態建立),核定仍走 review_requirement RPC——與 AI 建議同一條審查路。
  const submitManual = async () => {
    const d = manualDraft
    if (!d.title.trim()) { setManualMsg('請填標題'); return }
    let trigger_type = null
    let trigger_config = {}
    let frequency_type = null
    let frequency_config = {}
    if (d.dueMode === 'relative') {
      trigger_type = d.trigger_event
      const days = Number(d.offset_days)
      if (!(Number.isInteger(days) && days > 0)) { setManualMsg('期限天數需為正整數'); return }
      trigger_config = { offset_days: days, offset_dir: d.offset_dir }
    } else if (d.dueMode === 'fixed') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fixed_date)) { setManualMsg('請選擇指定日期'); return }
      trigger_type = 'fixed'
      trigger_config = { fixed_date: d.fixed_date }
    } else if (d.dueMode === 'monthly') {
      const day = Number(d.monthly_day)
      if (!(Number.isInteger(day) && day >= 1 && day <= 31)) { setManualMsg('每月幾號需為 1~31'); return }
      trigger_type = 'monthly'
      frequency_type = 'monthly'
      frequency_config = { day }
    } else if (d.dueMode === 'daily') {
      frequency_type = 'daily'
    } else if (d.dueMode === 'weekly') {
      const weekday = Number(d.weekly_weekday)
      if (!(Number.isInteger(weekday) && weekday >= 1 && weekday <= 7)) { setManualMsg('請選擇每週星期幾'); return }
      frequency_type = 'weekly'
      frequency_config = { weekday }
    } else if (d.dueMode === 'quarterly' || d.dueMode === 'yearly') {
      // 頻率 config 值域對齊抽取引擎:quarterly 的 month=季內第幾個月(1~3)、
      // yearly 的 month=幾月(1~12);day 都是幾日(1~31)
      const month = Number(d.freq_month)
      const day = Number(d.freq_day)
      const monthMax = d.dueMode === 'quarterly' ? 3 : 12
      if (!(Number.isInteger(month) && month >= 1 && month <= monthMax)) {
        setManualMsg(d.dueMode === 'quarterly' ? '每季第幾個月需為 1~3' : '每年幾月需為 1~12')
        return
      }
      if (!(Number.isInteger(day) && day >= 1 && day <= 31)) { setManualMsg('幾日需為 1~31'); return }
      frequency_type = d.dueMode
      frequency_config = { month, day }
    } else if (d.requirement_type === 'deadline') {
      // 期限型沒有時點就物化不出到期日,擋在前端(伺服器不會擋,但那是一筆廢資料)
      setManualMsg('期限型契約重點需要一個時點(相對基準日/指定日期/循環)')
      return
    }
    setManualBusy(true)
    const { data, error } = await supabase.from('requirements').insert({
      project_id: pid,
      title: d.title.trim(),
      description: d.description.trim() || null,
      requirement_type: d.requirement_type,
      responsible_party_type: d.responsible_party_type || null,
      lifecycle_phase: d.lifecycle_phase || null,
      acceptance_criteria: d.acceptance_criteria.trim() || null,
      // 分級可見性歸包:預設施工契約(契約脊椎);RLS guard 擋無權/跨案的包
      contract_package_id: d.contract_package_id
        || packages.find((cp) => cp.package_type === 'construction')?.id
        || packages[0]?.id || null,
      trigger_type, trigger_config, frequency_type, frequency_config,
      status: 'needs_review',
    }).select().single()
    if (error) { setManualBusy(false); setManualMsg(friendlyError(error, '契約重點新增未完成')); return }
    // 出處(選填):人工補登也保留條款/頁碼引註——對照報告與詳情的出處區吃同一份資料。
    // 主檔已建立、引註寫入失敗(瞬斷/5xx)不可靜默吞掉:使用者填的出處會無聲消失
    let sourceError = null
    if (d.source_clause.trim() || d.source_page.trim()) {
      const { data: srcRow, error: srcErr } = await supabase.from('requirement_sources').insert({
        requirement_id: data.id, source_kind: 'manual', source_verified: false,
        clause: d.source_clause.trim() || null, page_label: d.source_page.trim() || null,
      }).select().single()
      if (srcRow) setSourcesByReq((m) => new Map(m).set(data.id, [srcRow]))
      else sourceError = srcErr
    }
    setManualBusy(false)
    setManualMsg('')
    setManualDraft(MANUAL_BLANK)
    setManualOpen(false)
    setRows((rs) => [data, ...rs])
    select(data.id, { openPane: true })
    if (sourceError) {
      setMsg(`契約重點已新增,但出處未寫入:${friendlyError(sourceError, '請用「修正內容」補上')}`)
    }
  }

  const addManualLink = async () => {
    const item = (workItems?.items || []).find(
      (it) => it.is_leaf && !it.is_rollup && it.item_no === manualItemNo.trim(),
    )
    if (!item?.id) { setMsg(`找不到工項編號「${manualItemNo}」(需為標單末端工項)`); return }
    const { data, error } = await supabase.from('requirement_work_items')
      .insert({
        requirement_id: selectedId, work_item_id: item.id,
        match_type: 'manual', review_status: 'approved',
      }).select().single()
    if (error) { setMsg(friendlyError(error, '新增工項連結失敗')); return }
    setLinks((ls) => [...ls, data]); setManualItemNo(''); setMsg('')
  }

  // ── 頁首動作:手動新增(對照報告已退場) ─────────────────────────────────
  const headerAction = (
    <div className="flex flex-wrap items-center gap-2">
      <Link to={packageId ? `/requirements?package=${encodeURIComponent(packageId)}` : '/requirements'} className="inline-flex items-center gap-1 text-[12.5px] text-[var(--blue-text)] hover:underline max-md:min-h-11 px-1">
        <MSym name="arrow_back" size={16} /> 返回履約時程
      </Link>
      {canAddManual && (
        <Button variant="secondary" size="md" onClick={() => { setManualOpen(true); setManualMsg('') }}>
          <MSym name="add" size={16} /> 手動新增
        </Button>
      )}
    </div>
  )

  const SUBTITLE = '確認 AI 轉錄與契約原文一致;確認後的項目會排入履約時程。內容如有出入,一律以契約原文為準。'

  // ── 詳情內容(桌機 aside 與 <lg 抽屜共用同一份 JSX)────────────────────
  const detailBody = selected && (() => {
    const pill = STATUS_PILL[statusKey(selected.status)]
    const meta = [
      ['責任方', RESPONSIBLE_LABELS[selected.responsible_party_type] || '未定'],
      ['階段', selected.lifecycle_phase || '—'],
      ['時點', formatRequirementRule(selected) || '—'],
      ['允收標準', selected.acceptance_criteria || '—'],
      ['應留存', selected.evidence_requirement || '—'],
    ]
    const run = selected.origin === 'ai' && selected.ingestion_run_id
      ? runsById.get(selected.ingestion_run_id) : null
    const dueState = selectedObligation ? (() => {
      const done = selectedObligation.status === '已提送' || selectedObligation.status === '已完成'
      return done ? '已提送' : '追蹤中'
    })() : null
    return (<>
      {/* 1. 標題列:狀態色票+類型+開啟原文 */}
      <div className="px-4 py-[13px] border-b border-[var(--border)] flex items-center gap-2.5">
        <Badge color={pill.color}>{pill.label}</Badge>
        <span className="text-[11.5px] text-[var(--text-3)]">{REQUIREMENT_TYPE_LABELS[selected.requirement_type] || selected.requirement_type}</span>
        <span className="text-[11.5px] text-[var(--text-3)]">{ORIGIN_LABELS[selected.origin] || selected.origin}</span>
        {openableSource && (
          <button type="button" onClick={openOriginal} title="在原文件中開啟"
            className="ml-auto text-[11.5px] text-[var(--blue-text)] hover:underline inline-flex items-center max-md:min-h-11 px-1">
            開啟原文
          </button>
        )}
      </div>

      <ErrorBanner msg={msg} className="mx-4 mt-3" />

      {/* 自動歸檔與核對結果分開；通過現有核對也不宣稱已證明沒有漏項。 */}
      <p className={`mx-4 mt-3 text-xs leading-relaxed rounded-md px-3 py-2 ${requirementVerification(selected).attention
        ? 'text-[var(--amber-text)] bg-[var(--amber-tint)]' : 'text-[var(--text-2)] bg-[var(--surface-2)]'}`}>
        {requirementVerification(selected).label}。{requirementVerification(selected).note}
      </p>

      {/* 2. 本文:標題/說明/key-value(編輯模式原地換成表單) */}
      {editing ? (
        <div className="p-4 space-y-2">
          <Input value={editing.title} onChange={(e) => setEditing((d) => ({ ...d, title: e.target.value }))} placeholder="需求標題" />
          <Textarea value={editing.description || ''} onChange={(e) => setEditing((d) => ({ ...d, description: e.target.value }))} placeholder="需求描述" rows={2} />
          <div className="flex flex-wrap gap-2">
            <Select value={editing.requirement_type} onChange={(e) => setEditing((d) => ({ ...d, requirement_type: e.target.value }))}>
              {Object.entries(REQUIREMENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={editing.responsible_party_type || ''} onChange={(e) => setEditing((d) => ({ ...d, responsible_party_type: e.target.value }))}>
              <option value="">負責方未定</option>
              {Object.entries(RESPONSIBLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Input value={editing.lifecycle_phase || ''} onChange={(e) => setEditing((d) => ({ ...d, lifecycle_phase: e.target.value }))} placeholder="階段(開工前/施工中/完工/保固)" className="w-full min-w-0" />
          </div>
          <Input value={editing.acceptance_criteria || ''} onChange={(e) => setEditing((d) => ({ ...d, acceptance_criteria: e.target.value }))} placeholder="允收標準" />
          <Input value={editing.evidence_requirement || ''} onChange={(e) => setEditing((d) => ({ ...d, evidence_requirement: e.target.value }))} placeholder="應留存佐證" />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy === 'edit'} onClick={saveEdit}>儲存修正</Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>取消</Button>
          </div>
        </div>
      ) : (
        <div className="p-4">
          <div className="text-[15px] font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{selected.title}</div>
          {selected.description && <p className="mt-2 text-[12.5px] leading-[1.8] text-[var(--text-2)]">{selected.description}</p>}
          <div className="mt-3.5 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-[7px] text-xs leading-relaxed">
            {meta.map(([k, v]) => (
              <div key={k} className="contents">
                <span className="text-[var(--text-3)]">{k}</span>
                <span className="num text-[var(--text)]">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. 原文出處:引述框(blockquote/cite 語意)+核對狀態色票 */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2 mb-2">
          <MSym name="description" size={15} className="text-[var(--text-3)]" />
          <span className="text-[12.5px] font-medium text-[var(--text)]">原文出處</span>
          {selectedSources.length > 0 && (
            <Badge color={sourceVerificationSummary(selectedSources) === 'verified' ? 'green' : 'amber'}>
              {sourceVerificationSummary(selectedSources) === 'verified' ? '來源已核對' : '來源待核對'}
            </Badge>
          )}
        </div>
        {selectedSources.length === 0 ? (
          <p className="text-xs text-[var(--text-3)]">無引註。{selected.origin === 'manual' ? '人工新增的內容可於「修正內容」補充。' : ''}</p>
        ) : selectedSources.map((s) => {
          const version = s.document_version_id ? versionsById.get(s.document_version_id) : null
          return (
            <figure key={s.id} className="m-0 mb-2 bg-[var(--bg)] border border-[var(--border-2)] rounded-lg px-3 py-[11px]">
              {/* 核對狀態只在小標列的彙總色票講一次;逐筆引述只留出處行,
                  同一狀態兩種文案(已核對/待人工確認)並排會讓人以為是兩件事 */}
              <figcaption className="num text-[11px] text-[var(--text-3)] leading-relaxed">
                <cite className="not-italic">
                  {[version ? `${version.documents?.title}（${version.version_label}）` : null,
                    s.clause ? `條款 ${s.clause}` : null,
                    s.section ? `章節 ${s.section}` : null,
                    s.page_label || sourcePageLabel(s)].filter(Boolean).join(' · ')}
                </cite>
              </figcaption>
              {s.source_text && (
                <blockquote className="m-0 mt-[7px] text-xs leading-[1.85] text-[var(--text)]">「{s.source_text}」</blockquote>
              )}
            </figure>
          )
        })}
        {run && (
          <p className="text-[11px] text-[var(--text-3)] leading-relaxed mt-1">
            AI 擷取:模型 {run.model_name || '?'}·prompt {run.prompt_version || '?'}·完成 {fmtTime(run.completed_at) || run.status || '?'}。模型出處僅供追溯;契約效力以契約原文為準。
          </p>
        )}
      </div>

      {/* 4. 關聯:期限追蹤/標單工項/流程項目 */}
      <div className="px-4 pb-4">
        <div className="text-[12.5px] font-medium text-[var(--text)] mb-2">關聯</div>
        <div className="flex flex-col gap-1.5">
          {selectedObligation && (
            <Link to="/deadlines" className={LINK_ROW}>
              <MSym name="schedule" size={15} className="text-[var(--text-3)] shrink-0" />
              <span className="flex-1 min-w-0 truncate num">期限追蹤 · {dueState}{selectedObligation.fixed_date ? ` · ${selectedObligation.fixed_date}` : ''}</span>
              <MSym name="chevron_right" size={16} className="text-[var(--text-3)] shrink-0" />
            </Link>
          )}
          {links.map((l) => {
            const item = wiById.get(l.work_item_id)
            return (
              <div key={l.work_item_id} className={LINK_ROW_STATIC}>
                <MSym name="list_alt" size={15} className="text-[var(--text-3)] shrink-0" />
                <span className="flex-1 min-w-0 truncate">標單工項 {item?.item_no || '—'} {item?.description || ''}</span>
                {/* 信賴度上色(handoff 門檻 ≥0.89 ok/≤0.72 warn):覆核者一眼挑出 AI 沒把握的配對 */}
                {l.confidence != null && (
                  <span className={`num shrink-0 ${l.confidence >= 0.89 ? 'text-[var(--green-text)]' : l.confidence <= 0.72 ? 'text-[var(--amber-text)]' : 'text-[var(--text-3)]'}`}>AI {Math.round(l.confidence * 100)}%</span>
                )}
                {/* 五色語意:已駁回=灰(已不成立),README 明列「已駁回用紅」是誤用 */}
                <Badge color={l.review_status === 'approved' ? 'green' : l.review_status === 'rejected' ? 'slate' : 'blue'}>
                  {WORK_ITEM_LINK_STATE_LABELS[l.review_status] || l.review_status}
                </Badge>
                {canReview && l.review_status === 'suggested' && (<>
                  <Button size="sm" variant="success" onClick={() => decideLink(l.work_item_id, 'approved')}>核可</Button>
                  <Button size="sm" variant="danger" onClick={() => decideLink(l.work_item_id, 'rejected')}>駁回</Button>
                </>)}
              </div>
            )
          })}
          {artifactLinks.map((l) => (
            <div key={l.id} className={LINK_ROW_STATIC}>
              <MSym name="link" size={15} className="text-[var(--text-3)] shrink-0" />
              <Badge color="slate">{ARTIFACT_TYPE_LABELS[l.artifact_type] || l.artifact_type}</Badge>
              <span className="flex-1 min-w-0 truncate text-[var(--text-3)]">{l.artifact_id}</span>
              <span className="text-[var(--text-3)] shrink-0">{GENERATION_TYPE_LABELS[l.generation_type] || l.generation_type}</span>
            </div>
          ))}
          {!selectedObligation && !links.length && !artifactLinks.length && (
            <p className="text-xs text-[var(--text-3)]">
              {selected.status !== 'approved' ? '未確認內容不會建立或連結任何活躍流程。' : '尚未連結流程項目;本頁不會自動建立送審、查驗或試驗流程。'}
            </p>
          )}
          {canReview && (
            <div className="flex items-center gap-2 mt-1">
              <Input value={manualItemNo} onChange={(e) => setManualItemNo(e.target.value)}
                placeholder="工項編號(如 壹.一.6.3.28)手動連結" className="flex-1 min-w-0 !text-xs" />
              <Button variant="ghost" size="sm" disabled={!manualItemNo.trim()} onClick={addManualLink}>連結</Button>
            </div>
          )}
        </div>
      </div>

      {/* 5. 動作列:依狀態與權限切換(核定紀錄由伺服器蓋,不樂觀顯示) */}
      {!editing && (
        <div className="px-4 py-3 border-t border-[var(--border)] flex flex-wrap items-center gap-2">
          <ReviewActions requirement={selected} canReview={canReview} busy={busy}
            reviewerName={(() => {
              const p = selected.reviewed_by ? reviewersById.get(selected.reviewed_by) : null
              return p ? [p.company, p.full_name].filter(Boolean).join(' ') || null : null
            })()}
            onReview={(decision, label) => review(decision, label)}
            onEdit={() => setEditing({ ...selected })} />
        </div>
      )}
    </>)
  })()

  // ── 清單列(桌機 3 欄 grid、<768 直排堆疊)────────────────────────────────
  const listRows = (
    <div role="list" aria-label="契約重點清單">
      {shownRows.length === 0 ? (
        <div className="px-4 py-11 text-center text-[12.5px] leading-[1.8] text-[var(--text-3)]">
          {filters.q.trim()
            ? (<>找不到符合「{filters.q.trim()}」的條文。<br />試試條款編號(例 5.3)、頁碼或關鍵字(例 保固、罰則)。</>)
            : '目前篩選條件下沒有條文。'}
        </div>
      ) : shownRows.map((r) => {
        const pill = STATUS_PILL[statusKey(r.status)]
        const firstSource = (sourcesByReq.get(r.id) || [])[0]
        const metaParts = [
          firstSource?.clause ? `條款 ${firstSource.clause}` : null,
          firstSource ? (firstSource.page_label || sourcePageLabel(firstSource)) : null,
          REQUIREMENT_TYPE_LABELS[r.requirement_type] || r.requirement_type,
          RESPONSIBLE_LABELS[r.responsible_party_type] || null,
          r.lifecycle_phase || null,
        ].filter(Boolean)
        const active = r.id === selectedId
        return (
          <button key={r.id} type="button" role="listitem" id={`hl-${r.id}`}
            aria-current={active || undefined}
            onClick={() => select(r.id, { openPane: true })}
            className={`w-full text-left grid grid-cols-[76px_minmax(0,1fr)_150px] max-md:grid-cols-1 gap-3.5 max-md:gap-1 items-start px-[18px] py-3 pl-[15px] border-b border-[var(--border-2)] border-l-[3px] cursor-pointer ${active
              ? 'bg-[var(--blue-tint)] border-l-[var(--primary)]'
              : 'border-l-transparent hover:bg-[var(--bg)]'}`}>
            <span><Badge color={pill.color}>{pill.label}</Badge></span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{r.title}</span>
              <span className="block mt-[3px] text-[11.5px] leading-relaxed text-[var(--text-3)] num">{metaParts.join(' · ')}</span>
            </span>
            <span className="text-right max-md:text-left text-[11.5px] leading-relaxed text-[var(--text-3)] num">{formatRequirementRule(r) || ''}</span>
          </button>
        )
      })}
    </div>
  )

  // ── 手動新增 Modal(README:送出後為待核定、來源標記人工新增)─────────────
  const manualModal = manualOpen && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="手動新增契約重點">
      <div className="absolute inset-0 bg-[rgba(32,33,36,.4)]" onClick={() => setManualOpen(false)} />
      <div ref={manualRef} tabIndex={-1}
        className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto bg-[var(--surface)] border border-[var(--border-card)] rounded-2xl [box-shadow:var(--shadow-card)] p-5 outline-none">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-[15px] font-medium text-[var(--text)]">手動新增契約重點</h2>
          <button onClick={() => setManualOpen(false)} aria-label="關閉"
            className="w-8 h-8 max-md:w-11 max-md:h-11 rounded-full flex items-center justify-center text-[var(--text-3)] hover:bg-[var(--surface-2)]">
            <MSym name="close" size={18} />
          </button>
        </div>
        <p className="text-xs text-[var(--text-3)] mb-3">AI 漏抽或文件未涵蓋的契約重點可在此補登;送出後為「待確認」、來源標記人工新增,確認後自動排入履約時程。</p>
        <div className="space-y-2">
          <Input value={manualDraft.title} onChange={(e) => setManualDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="標題(例:開工前 14 日內提送施工計畫)" />
          <Textarea rows={2} value={manualDraft.description}
            onChange={(e) => setManualDraft((d) => ({ ...d, description: e.target.value }))}
            placeholder="補充描述(可留白)" />
          <div className="flex flex-wrap gap-2">
            <Select value={manualDraft.requirement_type} className="flex-1 min-w-[8rem]"
              onChange={(e) => setManualDraft((d) => ({ ...d, requirement_type: e.target.value }))}>
              {Object.entries(REQUIREMENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={manualDraft.lifecycle_phase} className="flex-1 min-w-[8rem]"
              onChange={(e) => setManualDraft((d) => ({ ...d, lifecycle_phase: e.target.value }))}>
              {['開工前', '施工中', '完工', '保固'].map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
            <Select value={manualDraft.responsible_party_type} className="flex-1 min-w-[8rem]"
              onChange={(e) => setManualDraft((d) => ({ ...d, responsible_party_type: e.target.value }))}>
              <option value="">負責方未定</option>
              {Object.entries(RESPONSIBLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={manualDraft.dueMode} className="w-auto"
              onChange={(e) => setManualDraft((d) => ({ ...d, dueMode: e.target.value }))}>
              <option value="relative">相對基準日</option>
              <option value="fixed">指定日期</option>
              <option value="daily">每日</option>
              <option value="weekly">每週固定日</option>
              <option value="monthly">每月固定日</option>
              <option value="quarterly">每季固定日</option>
              <option value="yearly">每年固定日</option>
              <option value="none">無明確時點</option>
            </Select>
            {manualDraft.dueMode === 'relative' && (<>
              <Select value={manualDraft.trigger_event} className="w-auto"
                onChange={(e) => setManualDraft((d) => ({ ...d, trigger_event: e.target.value }))}>
                {MANUAL_TRIGGERS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Select value={manualDraft.offset_dir} className="w-auto"
                onChange={(e) => setManualDraft((d) => ({ ...d, offset_dir: e.target.value }))}>
                <option value="after">後</option>
                <option value="before">前</option>
              </Select>
              <Input type="number" min="1" className="w-24" value={manualDraft.offset_days}
                onChange={(e) => setManualDraft((d) => ({ ...d, offset_days: e.target.value }))} placeholder="天數" />
              <span className="text-xs text-[var(--text-3)]">日內</span>
            </>)}
            {manualDraft.dueMode === 'fixed' && (
              <Input type="date" className="w-44" value={manualDraft.fixed_date}
                onChange={(e) => setManualDraft((d) => ({ ...d, fixed_date: e.target.value }))} />
            )}
            {manualDraft.dueMode === 'monthly' && (<>
              <span className="text-xs text-[var(--text-2)]">每月</span>
              <Input type="number" min="1" max="31" className="w-24" value={manualDraft.monthly_day}
                onChange={(e) => setManualDraft((d) => ({ ...d, monthly_day: e.target.value }))} placeholder="幾號" />
              <span className="text-xs text-[var(--text-3)]">號</span>
            </>)}
            {manualDraft.dueMode === 'weekly' && (<>
              <span className="text-xs text-[var(--text-2)]">每</span>
              <Select value={manualDraft.weekly_weekday} className="w-auto"
                onChange={(e) => setManualDraft((d) => ({ ...d, weekly_weekday: e.target.value }))}>
                {MANUAL_WEEKDAYS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </>)}
            {manualDraft.dueMode === 'quarterly' && (<>
              <span className="text-xs text-[var(--text-2)]">每季第</span>
              <Select value={manualDraft.freq_month} className="w-auto"
                onChange={(e) => setManualDraft((d) => ({ ...d, freq_month: e.target.value }))}>
                <option value="">—</option>
                {['1', '2', '3'].map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
              <span className="text-xs text-[var(--text-2)]">個月</span>
              <Input type="number" min="1" max="31" className="w-24" value={manualDraft.freq_day}
                onChange={(e) => setManualDraft((d) => ({ ...d, freq_day: e.target.value }))} placeholder="幾日" />
              <span className="text-xs text-[var(--text-3)]">日</span>
            </>)}
            {manualDraft.dueMode === 'yearly' && (<>
              <span className="text-xs text-[var(--text-2)]">每年</span>
              <Input type="number" min="1" max="12" className="w-24" value={manualDraft.freq_month}
                onChange={(e) => setManualDraft((d) => ({ ...d, freq_month: e.target.value }))} placeholder="幾月" />
              <span className="text-xs text-[var(--text-2)]">月</span>
              <Input type="number" min="1" max="31" className="w-24" value={manualDraft.freq_day}
                onChange={(e) => setManualDraft((d) => ({ ...d, freq_day: e.target.value }))} placeholder="幾日" />
              <span className="text-xs text-[var(--text-3)]">日</span>
            </>)}
          </div>
          {packages.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-2)] shrink-0">所屬契約</span>
              <Select value={manualDraft.contract_package_id || packages.find((cp) => cp.package_type === 'construction')?.id || packages[0]?.id || ''}
                className="flex-1"
                onChange={(e) => setManualDraft((d) => ({ ...d, contract_package_id: e.target.value }))}>
                {packages.map((cp) => <option key={cp.id} value={cp.id}>{cp.title}</option>)}
              </Select>
            </div>
          )}
          <Input value={manualDraft.acceptance_criteria}
            onChange={(e) => setManualDraft((d) => ({ ...d, acceptance_criteria: e.target.value }))}
            placeholder="允收標準(可留白)" />
          <div className="flex flex-wrap gap-2">
            <Input value={manualDraft.source_clause} className="flex-1 min-w-[8rem]"
              onChange={(e) => setManualDraft((d) => ({ ...d, source_clause: e.target.value }))}
              placeholder="出處條款(例 5.3,可留白)" />
            <Input value={manualDraft.source_page} className="flex-1 min-w-[8rem]"
              onChange={(e) => setManualDraft((d) => ({ ...d, source_page: e.target.value }))}
              placeholder="出處頁碼(例 第 12 頁,可留白)" />
          </div>
          <ErrorBanner msg={manualMsg} />
          <div className="flex gap-2 pt-1">
            <Button size="sm" disabled={manualBusy} onClick={submitManual}>新增(待確認)</Button>
            <Button variant="ghost" size="sm" onClick={() => { setManualOpen(false); setManualMsg('') }}>取消</Button>
          </div>
        </div>
      </div>
    </div>
  )

  // ── 版面分支 ────────────────────────────────────────────────────────────
  if (!isPersistedProject) {
    // demo:摘要條吃 seed 義務照常展示(銷售簡報動線);AI 整理需真實專案
    return (
      <div className="space-y-6">
        <PageHeader title="擷取審核" tagline="AI 轉錄確認" subtitle={SUBTITLE} action={headerAction} />
          <Card title="契約重點清單"><Empty>需真實專案。於「專案文件」上傳契約或規範後,AI 整理結果會顯示在這裡。</Empty></Card>
      </div>
    )
  }

  if (!loaded) {
    return (
      <div className="space-y-6">
        <PageHeader title="擷取審核" tagline="AI 轉錄確認" subtitle={SUBTITLE} action={headerAction} />
          <div className="grid gap-6 items-start lg:grid-cols-[minmax(0,1fr)_392px]">
          <Card><SkeletonList rows={8} label="正在載入契約重點…" /></Card>
          <Card className="hidden lg:block"><SkeletonList rows={4} label="" /></Card>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <PageHeader title="擷取審核" tagline="AI 轉錄確認" subtitle={SUBTITLE} action={headerAction} />
        <ErrorBanner msg={loadError} />
        <Button className="w-full sm:w-auto" onClick={reload}><MSym name="refresh" size={14} /> 重新載入</Button>
      </div>
    )
  }

  // 0 筆:分「AI 還沒跑完/失敗」與「跑完但沒找到」——後者不是缺前置條件,
  // 給上傳 CTA 只會把人繞回原點(W8-3A)。
  if (!rows.length) {
    return (
      <div className="space-y-6">
        <PageHeader title="擷取審核" tagline="AI 轉錄確認" subtitle={SUBTITLE} action={headerAction} />
          <Card title="契約重點清單">
          {intro.mode === 'done-empty'
            ? <Empty>{intro.emptyText}</Empty>
            : (
              <PrerequisiteEmptyState
                need={intro.emptyText}
                unlocks="契約重點確認、送審/RFI 的 AI 依規範比對"
                to="/contract" cta="前往專案文件" />
            )}
          {intro.coverageWarning && (
            <p className="mt-2 text-xs text-[var(--amber-text)] bg-[var(--amber-tint)] rounded-md px-3 py-2">{intro.coverageWarning}</p>
          )}
        </Card>
        {manualModal}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="擷取審核" tagline="AI 轉錄確認" subtitle={SUBTITLE} action={headerAction} />


      <div className="grid gap-6 items-start lg:grid-cols-[minmax(0,1fr)_392px]">
        {/* ── 左欄:契約重點清單 ── */}
        <Card title="契約重點清單" bodyClass="p-0"
          action={<span className="num text-[11px] text-[var(--text-3)]">{listMeta}</span>}>
          {/* 揭露條(涵蓋率/審查規則):資料與畫面要說同一件事,不因改版消失 */}
          {intro.coverageWarning && (
            <p className="px-[18px] py-2 text-xs text-[var(--amber-text)] bg-[var(--amber-tint)] border-b border-[var(--border-2)]">{intro.coverageWarning}</p>
          )}
          {intro.note && (
            <p className="px-[18px] py-2 text-[11.5px] text-[var(--text-3)] border-b border-[var(--border-2)]">{intro.note}</p>
          )}
          <div className="px-[18px] py-3 text-xs leading-relaxed bg-[var(--surface-2)] border-b border-[var(--border-2)]">
            <p>目前載入範圍有 {counts.attention} 項需留意。AI 內容維持自動歸檔，無須逐條按確認；可先查看有核對疑慮、缺少核對結果或尚待人工確認的項目。</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => {
              setFilters({ q: '', status: 'attention', type: '', phase: '', freq: '' })
              setShownLimit(PAGE_SIZE)
              setSelectedId(null); setDetailOpen(false)
            }}>只看需留意項目</Button>
          </div>
          {/* 檢索區:搜尋+狀態快篩+類型/階段(AND、即時生效) */}
          <div className="px-[18px] py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
            <label className="flex items-center gap-2.5 h-10 px-3.5 border border-[var(--border)] rounded-full bg-[var(--surface)] focus-within:border-[var(--primary)] transition-colors">
              <MSym name="search" size={20} className="text-[var(--text-3)] shrink-0" />
              <input ref={searchRef} type="search" value={filters.q}
                onChange={(e) => { setFilters((f) => ({ ...f, q: e.target.value })); setShownLimit(PAGE_SIZE) }}
                placeholder="搜尋條文、關鍵字、條款編號或頁碼…" aria-label="搜尋契約重點"
                className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[13px] text-[var(--text)] placeholder:text-[var(--text-3)]" />
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {[['all', '全部', counts.all], ['attention', '需留意', counts.attention], ['pending', '待確認', counts.pending],
                ['approved', '已確認', counts.approved], ['rejected', '不採用', counts.rejected]].map(([k, label, n]) => (
                <button key={k} type="button" aria-pressed={filters.status === k}
                  onClick={() => {
                    setFilters((f) => ({ ...f, status: k })); setShownLimit(PAGE_SIZE)
                    if (k === 'attention') { setSelectedId(null); setDetailOpen(false) }
                  }}
                  className={chipCls(filters.status === k)}>
                  {label}<span className="num opacity-70">{n}</span>
                </button>
              ))}
              <span className="w-px h-5 bg-[var(--border-2)] mx-0.5 max-md:hidden" aria-hidden="true" />
              <Select value={filters.type} aria-label="類型"
                onChange={(e) => { setFilters((f) => ({ ...f, type: e.target.value })); setShownLimit(PAGE_SIZE) }}
                className="!w-auto max-md:!w-full !h-[30px] !py-0 !text-xs !rounded-lg">
                <option value="">全部類型</option>
                {typeOptions.map((t) => <option key={t} value={t}>{REQUIREMENT_TYPE_LABELS[t] || t}</option>)}
              </Select>
              <Select value={filters.phase} aria-label="階段"
                onChange={(e) => { setFilters((f) => ({ ...f, phase: e.target.value })); setShownLimit(PAGE_SIZE) }}
                className="!w-auto max-md:!w-full !h-[30px] !py-0 !text-xs !rounded-lg">
                <option value="">全部階段</option>
                {phaseOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
              <Select value={filters.freq} aria-label="頻率"
                onChange={(e) => { setFilters((f) => ({ ...f, freq: e.target.value })); setShownLimit(PAGE_SIZE) }}
                className="!w-auto max-md:!w-full !h-[30px] !py-0 !text-xs !rounded-lg">
                <option value="">全部頻率</option>
                {freqOptions.map((fq) => <option key={fq} value={fq}>{fq}</option>)}
              </Select>
            </div>
          </div>

          {listRows}

          <div className="px-[18px] py-3 flex items-center justify-between gap-4">
            <span className="num text-[11.5px] text-[var(--text-3)]">顯示 {shownRows.length} / {visible.length} 條</span>
            {visible.length > shownLimit && (
              <button type="button" onClick={() => setShownLimit((n) => n + PAGE_SIZE)}
                className="text-[11.5px] text-[var(--blue-text)] hover:underline max-md:min-h-11 px-1">載入更多</button>
            )}
          </div>
        </Card>

        {/* ── 右欄:條文詳情(桌機 sticky;≥1024 常駐) ── */}
        <Card className="hidden lg:block lg:sticky lg:top-6" bodyClass="p-0" aria-live="polite">
          {detailBody || <Empty>點左側清單查看條文詳情。</Empty>}
        </Card>
      </div>

      {/* <lg:詳情抽屜(768-1023 右滑入)/全螢幕(<768,左上返回) */}
      {detailOpen && selected && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="條文詳情">
          <div className="absolute inset-0 bg-[rgba(32,33,36,.4)]" onClick={() => setDetailOpen(false)} />
          <div ref={drawerRef} tabIndex={-1}
            className="absolute right-0 top-0 h-full w-[min(420px,92vw)] max-md:w-full bg-[var(--surface)] overflow-y-auto [box-shadow:-2px_0_16px_rgba(32,33,36,.16)] outline-none" aria-live="polite">
            <div className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border-2)] px-3 py-2 flex items-center gap-2">
              <button type="button" onClick={() => setDetailOpen(false)}
                className="inline-flex items-center gap-1 text-sm text-[var(--blue-text)] hover:underline min-h-11 px-1">
                <MSym name="arrow_back" size={18} /> 返回清單
              </button>
            </div>
            {detailBody}
          </div>
        </div>
      )}

      {manualModal}
    </div>
  )
}
