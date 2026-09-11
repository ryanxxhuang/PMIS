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
// 「清單＋詳情」殼(選取/深連結/鍵盤/抽屜/Modal/搜尋/快篩)與履約時程頁共用:
// 行為在 lib/useListDetailPane.js、外殼在 components/listDetail.jsx;
// 資料載入在 lib/useContractEnrichment.js(全案 requirements + 出處 + 審查人)。
import { useState, useMemo, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { supabase } from '../../lib/supabase.js'
import {
  Card, Empty, PageHeader, Badge, Button, Input, Textarea, Select,
  PrerequisiteEmptyState, ErrorBanner, SkeletonList,
} from '../../components/ui.jsx'
import {
  ListDetailLayout, LIST_DETAIL_GRID, SearchField, StatusChip, MetaGrid, SourceQuote,
} from '../../components/listDetail.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import { appConfirm } from '../../components/confirm.jsx'
import { openDocumentVersionFile } from '../../lib/documentFileAccess.js'
import { isValidStorageKey } from '../../lib/packageUpload.js'
import { fmtDateTime } from '../../lib/format.js'
import { useContractEnrichment } from '../../lib/useContractEnrichment.js'
import { requirementsIntro } from '../../lib/requirementsIntro.js'
import ReviewActions from '../../components/requirements/ReviewActions.jsx'
import ManualRequirementModal from '../../components/requirements/ManualRequirementModal.jsx'
import { MANUAL_BLANK, manualRequirementTiming } from '../../lib/manualRequirement.js'
import { useListDetailPane, useListKeyboardNav } from '../../lib/useListDetailPane.js'
import {
  REQUIREMENT_TYPE_LABELS, RESPONSIBLE_LABELS, ORIGIN_LABELS,
  WORK_ITEM_LINK_STATE_LABELS, ARTIFACT_TYPE_LABELS, GENERATION_TYPE_LABELS,
  latestCompletedRunIds, inDefaultReviewScope, requirementFrequencyKey,
  sourceVerificationSummary, sourcePageLabel, formatRequirementRule, requirementVerification,
  inPackage, runsInPackage, ingestionSummary,
} from '../../lib/requirementReview.js'

const PAGE_SIZE = 50
const DEFAULT_FILTERS = { q: '', status: 'all', type: '', phase: '', freq: '' }

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
const fmtTime = (v) => fmtDateTime(v, { empty: '' })

// 關聯列外殼:README 8px 圓角框列(icon+文字)。hover 只給真的可點的列——
// 純資料列(工項對應/流程項目)套上連結外觀會騙人去點
const LINK_ROW_STATIC = 'flex items-center gap-2 px-2.5 py-2 max-md:min-h-11 border border-[var(--border-2)] rounded-lg text-xs text-[var(--text-2)] min-w-0'
const LINK_ROW = `${LINK_ROW_STATIC} hover:bg-[var(--bg)]`

// 人工補登從 needs_review 經 RPC 確認,所有類型均由伺服器單向物化履約事項。

export default function RequirementsReview() {
  const {
    currentProject, isPersistedProject, workItems, reloadObligations, can, obligations,
  } = useStore()
  // 兩條都鏡像 DB 的同名 helper;規則的單一來源在 store.jsx 的 can
  const canReview = can.reviewRequirement          // can_review_requirement()
  const canAddManual = isPersistedProject && can.write  // can_write():requirements insert 政策

  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [shownLimit, setShownLimit] = useState(PAGE_SIZE)
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
  const [searchParams] = useSearchParams()
  const searchRef = useRef(null)
  const packageId = searchParams.get('package') || ''

  const pid = currentProject?.project_id
  const detailGeneration = useRef(0)

  // 全案 requirements + 出處 + 文件版本 + ingestion runs + 契約包(可讀,RLS 過濾;
  // 手動補登歸包用)+ 審查人 profiles。切案清空、同案重載保留舊列。
  const {
    rows, sourcesByReq, versionsById, runs, runsById, packages, reviewersById,
    loaded, error: loadError, reload, patch,
  } = useContractEnrichment({ pid, enabled: isPersistedProject, requirementIds: 'all', reviewers: true })
  const currentRunIds = useMemo(() => latestCompletedRunIds(runs), [runs])
  const packageRuns = useMemo(() => runsInPackage(runs, packageId, { versionsById }), [runs, versionsById, packageId])
  const packageRows = useMemo(
    () => rows.filter((r) => inPackage(r, packageId, { versionsById, runsById })),
    [rows, runsById, versionsById, packageId],
  )
  const intro = useMemo(() => requirementsIntro(packageRuns, packageRows.length), [packageRuns, packageRows.length])

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
    const { docCount, latest } = ingestionSummary(runs, versionsById)
    return [`共 ${scoped.length} 條`, docCount ? `來源 ${docCount} 份文件` : null,
      latest ? `最近整理 ${latest.slice(0, 10)}` : null].filter(Boolean).join(' · ')
  }, [runs, versionsById, scoped.length])

  // ── 選取/深連結(?highlight=)/切案重置/初次自動選取:共用殼 hook。
  // 預設選第一條待確認(直接進入待辦)→ 清單第一條 → 範圍內第一條。
  const { selectedId, setSelectedId, detailOpen, setDetailOpen, select, closeDetail } = useListDetailPane({
    param: 'highlight', idPrefix: 'hl-',
    scope: `${pid}/${packageId}`,
    ready: loaded && packageRows.length > 0, rows: packageRows,
    pickDefault: () => (visible.find((r) => EDITABLE_STATUSES.includes(r.status)) || visible[0] || packageRows[0])?.id,
    onSelect: (id) => { setEditing(null); setMsg(''); setManualItemNo(''); loadDetail(id) },
    onReset: () => {
      // 在途的詳情查詢作廢:切案後回來的 links 不能掛到新案的選取上
      detailGeneration.current++
      setEditing(null); setLinks([]); setArtifactLinks([]); setMsg('')
      setFilters(DEFAULT_FILTERS); setShownLimit(PAGE_SIZE)
    },
    onDeepLink: (row) => {
      // 深連結列可能落在載入上限之後:先把分頁撐到含該列,捲動才有東西可捲
      const idx = visible.findIndex((r) => r.id === row.id)
      if (idx >= PAGE_SIZE) setShownLimit(Math.ceil((idx + 1) / PAGE_SIZE) * PAGE_SIZE)
    },
  })

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

  // 鍵盤:↑/↓ 移動選取、Enter 開啟原文、/ 聚焦搜尋(共用殼 hook;手動新增/編輯中停用)
  useListKeyboardNav({
    ordered: shownRows, selectedId, select, idPrefix: 'hl-', onEnter: openOriginal,
    modalUp: manualOpen || !!editing, searchRef,
  })

  // 生命週期決定:唯一路徑是 review_requirement RPC;成功後以伺服器回傳列刷新。
  const review = async (decision, confirmText, requirementId = selectedId, body = '確認的是 AI 轉錄與契約原文一致;契約效力以原文為準,紀錄由伺服器寫入。') => {
    if (!(await appConfirm({ title: confirmText, body, confirmLabel: confirmText }))) return
    setBusy(decision)
    const { data, error } = await supabase.rpc('review_requirement', {
      p_requirement_id: requirementId, p_decision: decision,
    })
    setBusy('')
    if (error) { setMsg(friendlyError(error, '審查未完成')); return }
    patch((d) => ({ rows: d.rows.map((r) => (r.id === data.id ? data : r)) }))
    // D-020:所有類型都會更新履約 runtime;取代也會取消尚待辦的義務。
    if (decision === 'approve' || decision === 'supersede') await reloadObligations()
    setMsg('')
  }

  const saveEdit = async () => {
    setBusy('edit')
    const patchRow = {
      title: editing.title, description: editing.description || null,
      requirement_type: editing.requirement_type,
      responsible_party_type: editing.responsible_party_type || null,
      lifecycle_phase: editing.lifecycle_phase || null,
      acceptance_criteria: editing.acceptance_criteria || null,
      evidence_requirement: editing.evidence_requirement || null,
    }
    const { data, error } = await supabase.from('requirements')
      .update(patchRow).eq('id', selectedId).select().single()
    setBusy('')
    if (error) { setMsg(friendlyError(error, '儲存未完成')); return }
    patch((d) => ({ rows: d.rows.map((r) => (r.id === data.id ? data : r)) }))
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
    const timing = manualRequirementTiming(d)
    if (timing.error) { setManualMsg(timing.error); return }
    const { trigger_type, trigger_config, frequency_type, frequency_config } = timing
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
    let sourceRow = null
    if (d.source_clause.trim() || d.source_page.trim()) {
      const { data: srcRow, error: srcErr } = await supabase.from('requirement_sources').insert({
        requirement_id: data.id, source_kind: 'manual', source_verified: false,
        clause: d.source_clause.trim() || null, page_label: d.source_page.trim() || null,
      }).select().single()
      if (srcRow) sourceRow = srcRow
      else sourceError = srcErr
    }
    setManualBusy(false)
    setManualMsg('')
    setManualDraft(MANUAL_BLANK)
    setManualOpen(false)
    patch((prev) => ({
      rows: [data, ...prev.rows],
      sourcesByReq: sourceRow ? new Map(prev.sourcesByReq).set(data.id, [sourceRow]) : prev.sourcesByReq,
    }))
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
      <Link to={packageId ? `/requirements?package=${encodeURIComponent(packageId)}` : '/requirements'} className="inline-flex items-center gap-1 text-footnote text-[var(--blue-text)] hover:underline max-md:min-h-11 px-1">
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
        <span className="text-caption text-[var(--text-3)]">{REQUIREMENT_TYPE_LABELS[selected.requirement_type] || selected.requirement_type}</span>
        <span className="text-caption text-[var(--text-3)]">{ORIGIN_LABELS[selected.origin] || selected.origin}</span>
        {openableSource && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={openOriginal} title="在原文件中開啟">
            開啟原文
          </Button>
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
          <div className="text-callout font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{selected.title}</div>
          {selected.description && <p className="mt-2 text-footnote leading-[1.8] text-[var(--text-2)]">{selected.description}</p>}
          <MetaGrid rows={meta} className="mt-3.5" />
        </div>
      )}

      {/* 3. 原文出處:引述框(blockquote/cite 語意)+核對狀態色票 */}
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2 mb-2">
          <MSym name="description" size={15} className="text-[var(--text-3)]" />
          <span className="text-footnote font-medium text-[var(--text)]">原文出處</span>
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
            <SourceQuote key={s.id} className="mb-2" quote={s.source_text}
              cite={[version ? `${version.documents?.title}（${version.version_label}）` : null,
                s.clause ? `條款 ${s.clause}` : null,
                s.section ? `章節 ${s.section}` : null,
                s.page_label || sourcePageLabel(s)].filter(Boolean).join(' · ')} />
          )
        })}
        {run && (
          <p className="text-caption text-[var(--text-3)] leading-relaxed mt-1">
            AI 擷取:模型 {run.model_name || '?'}·prompt {run.prompt_version || '?'}·完成 {fmtTime(run.completed_at) || run.status || '?'}。模型出處僅供追溯;契約效力以契約原文為準。
          </p>
        )}
      </div>

      {/* 4. 關聯:期限追蹤/標單工項/流程項目 */}
      <div className="px-4 pb-4">
        <div className="text-footnote font-medium text-[var(--text)] mb-2">關聯</div>
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
        <div className="px-4 py-11 text-center text-footnote leading-[1.8] text-[var(--text-3)]">
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
              <span className="block text-body font-medium leading-normal text-[var(--text)] [text-wrap:pretty]">{r.title}</span>
              <span className="block mt-[3px] text-caption leading-relaxed text-[var(--text-3)] num">{metaParts.join(' · ')}</span>
            </span>
            <span className="text-right max-md:text-left text-caption leading-relaxed text-[var(--text-3)] num">{formatRequirementRule(r) || ''}</span>
          </button>
        )
      })}
    </div>
  )

  // ── 手動新增 Modal(README:送出後為待核定、來源標記人工新增)─────────────
  const manualModal = <ManualRequirementModal
    manualOpen={manualOpen} onClose={() => setManualOpen(false)}
    manualDraft={manualDraft} setManualDraft={setManualDraft} packages={packages}
    manualMsg={manualMsg} manualBusy={manualBusy} submitManual={submitManual}
    onClearMessage={() => setManualMsg('')} />

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
          <div className={LIST_DETAIL_GRID}>
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


      <ListDetailLayout
        detail={detailBody}
        detailLabel="條文詳情"
        detailEmpty={<Empty>點左側清單查看條文詳情。</Empty>}
        drawerOpen={detailOpen && !!selected}
        onDrawerClose={closeDetail}>
        {/* ── 左欄:契約重點清單(右欄與抽屜由殼統一) ── */}
        <Card title="契約重點清單" bodyClass="p-0"
          action={<span className="num text-caption text-[var(--text-3)]">{listMeta}</span>}>
          {/* 揭露條(涵蓋率/審查規則):資料與畫面要說同一件事,不因改版消失 */}
          {intro.coverageWarning && (
            <p className="px-[18px] py-2 text-xs text-[var(--amber-text)] bg-[var(--amber-tint)] border-b border-[var(--border-2)]">{intro.coverageWarning}</p>
          )}
          {intro.note && (
            <p className="px-[18px] py-2 text-caption text-[var(--text-3)] border-b border-[var(--border-2)]">{intro.note}</p>
          )}
          <div className="px-[18px] py-3 text-xs leading-relaxed bg-[var(--surface-2)] border-b border-[var(--border-2)]">
            <p>目前載入範圍有 {counts.attention} 項需留意。AI 內容維持自動歸檔，無須逐條按確認；可先查看有核對疑慮、缺少核對結果或尚待人工確認的項目。</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => {
              setFilters({ ...DEFAULT_FILTERS, status: 'attention' })
              setShownLimit(PAGE_SIZE)
              setSelectedId(null); setDetailOpen(false)
            }}>只看需留意項目</Button>
          </div>
          {/* 檢索區:搜尋+狀態快篩+類型/階段(AND、即時生效) */}
          <div className="px-[18px] py-3.5 border-b border-[var(--border-2)] flex flex-col gap-3">
            <SearchField ref={searchRef} value={filters.q}
              onChange={(e) => { setFilters((f) => ({ ...f, q: e.target.value })); setShownLimit(PAGE_SIZE) }}
              placeholder="搜尋條文、關鍵字、條款編號或頁碼…" aria-label="搜尋契約重點" />
            <div className="flex items-center gap-2 flex-wrap">
              {[['all', '全部', counts.all], ['attention', '需留意', counts.attention], ['pending', '待確認', counts.pending],
                ['approved', '已確認', counts.approved], ['rejected', '不採用', counts.rejected]].map(([k, label, n]) => (
                <StatusChip key={k} active={filters.status === k} count={n}
                  onClick={() => {
                    setFilters((f) => ({ ...f, status: k })); setShownLimit(PAGE_SIZE)
                    if (k === 'attention') { setSelectedId(null); setDetailOpen(false) }
                  }}>
                  {label}
                </StatusChip>
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
            <span className="num text-caption text-[var(--text-3)]">顯示 {shownRows.length} / {visible.length} 條</span>
            {visible.length > shownLimit && (
              <Button variant="ghost" size="sm" onClick={() => setShownLimit((n) => n + PAGE_SIZE)}>載入更多</Button>
            )}
          </div>
        </Card>
      </ListDetailLayout>

      {manualModal}
    </div>
  )
}
