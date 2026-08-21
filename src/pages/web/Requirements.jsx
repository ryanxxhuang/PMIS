// P0-07 履約需求審查頁:AI 建議 → 人工審查 → 核定/駁回 的契約決策邊界。
// 資料用「有界的」焦點查詢直接向 Supabase 取(不進全域 store);
// 生命週期決定一律走 review_requirement RPC(伺服器蓋審查人/時間戳),
// 前端絕不樂觀顯示核定結果。工作流 artifact 只列出既有連結(P0-07 不產生)。
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { supabase } from '../../lib/supabase.js'
import { pageAllInSafe } from '../../lib/pagedQuery.js'
import { Card, Empty, PageHeader, Badge, Button, Input, Textarea, Select, PrerequisiteEmptyState, ErrorBanner, Surface, SkeletonList } from '../../components/ui.jsx'
import { appConfirm } from '../../components/confirm.jsx'
import {
  REQUIREMENT_STATUS_LABELS, REQUIREMENT_TYPE_LABELS, RESPONSIBLE_LABELS, ORIGIN_LABELS,
  WORK_ITEM_LINK_STATE_LABELS, ARTIFACT_TYPE_LABELS, GENERATION_TYPE_LABELS,
  latestCompletedRunIds, inDefaultReviewScope, sortForReviewQueue, filterRequirements,
  sourceVerificationSummary, sourcePageLabel, sourceVerificationLabel, formatRequirementRule,
  HIGHLIGHT_LIMIT, buildRequirementHighlights, canQuickApproveDeadline,
} from '../../lib/requirementReview.js'

const LIST_LIMIT = 300

// W8-3A(D-014):「AI 整理完了沒」在全站只有一個判定依據——本案有沒有跑完過一次
// 履約要求擷取(`document_ingestion_runs.status = 'completed'`)。首頁初始化清單第 3 步
// 用它,這一頁也必須用它,否則會出現「首頁說整理完成 → 點進來卻叫你重新上傳」的死路。
// ⚠️ 有 Requirement 不等於 AI 跑完過(可能是人工建立或舊 run),絕不可反推成「整理完成」。
export function requirementsIntro(runs = [], rowCount = 0) {
  const ingestionDone = (runs || []).some((r) => r?.status === 'completed')
  if (rowCount > 0) {
    return {
      ingestionDone,
      mode: 'list',
      // 沒有 completed run 時只講審查規則,不宣稱 AI 整理完成
      note: ingestionDone
        ? 'AI 已完成整理，專案初始化的「AI 整理契約重點」即為完成；下方只有要成為契約規則的內容才需人工核定，未核定不影響開啟正式模式。'
        : '下方只有要成為契約規則的內容才需人工核定，未核定不影響開啟正式模式。',
      emptyText: null,
    }
  }
  // 整理完成但 0 筆:這是有效結果(AI 讀完了沒找到),不是失敗,也沒有事情要做——
  // 不能再給「前往上傳」的 CTA 把人送回原點。
  if (ingestionDone) {
    return {
      ingestionDone, mode: 'done-empty', note: null,
      emptyText: 'AI 已完成整理，本次沒有找到契約重點建議，不需處理，也不影響開啟正式模式。',
    }
  }
  return {
    ingestionDone, mode: 'not-started', note: null,
    emptyText: '尚未有完成的 AI 整理。到「專案文件」上傳契約/規範,或查看目前的處理狀態。',
  }
}
const STATUS_BADGE = {
  draft_ai: 'blue', needs_review: 'amber', approved: 'green', rejected: 'red', superseded: 'slate',
}
const EDITABLE_STATUSES = ['draft_ai', 'needs_review']
const fmtTime = (v) => (v ? new Date(v).toLocaleString('zh-TW', { hour12: false }) : '')

export function HighlightRows({ groups, kind, canReview, verificationByReq, onSelect, onQuickApprove }) {
  if (!groups.length) {
    return <Empty>{kind === 'approved' ? '尚無已生效的契約重點。' : '目前沒有需要特別留意的未核定內容。'}</Empty>
  }
  return (
    <div className="divide-y divide-[var(--border)]">
      {groups.map((group) => {
        const r = group.requirement
        const verification = verificationByReq.get(r.id) || 'none'
        const quickApprove = kind === 'suggestion'
          && canQuickApproveDeadline(r, verification, canReview)
        return (
          <div key={group.key} className="px-4 sm:px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge color={kind === 'approved' ? 'green' : 'amber'}>
                {kind === 'approved' ? '已生效' : '整理結果'}
              </Badge>
              <span className="text-xs text-[var(--text-3)]">{REQUIREMENT_TYPE_LABELS[r.requirement_type] || r.requirement_type}</span>
              {r.responsible_party_type && <span className="text-xs text-[var(--text-3)]">責任：{RESPONSIBLE_LABELS[r.responsible_party_type]}</span>}
              {/* 核對狀態走五語意 Badge,不用裸文字色表狀態(UI/UX 統一修正) */}
              {verification === 'verified' && <Badge color="green">來源已核對</Badge>}
              {verification === 'unverified' && <Badge color="amber">來源待核對</Badge>}
              {group.requirements.length > 1 && <span className="text-xs text-[var(--text-3)]">同內容 {group.requirements.length} 筆擷取</span>}
            </div>
            <div className="mt-1.5 text-sm font-semibold text-[var(--text)]">{r.title}</div>
            {r.description && <p className="mt-1 text-sm leading-relaxed text-[var(--text-2)] line-clamp-2">{r.description}</p>}
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-3)]">
              {r.lifecycle_phase && <span>階段：{r.lifecycle_phase}</span>}
              {formatRequirementRule(r) && <span>時點：{formatRequirementRule(r)}</span>}
              {r.evidence_requirement && <span>應留存佐證：{r.evidence_requirement}</span>}
            </div>
            {/* 手機直排全寬、桌機並排;桌機再加 flex-wrap,窄視窗時按鈕換行而不是擠出卡片。
                F1:手機動作鈕補 44px 觸控高度(max-md:min-h-11),桌機維持 sm 尺寸——
                只在本頁就地補,不動共用 Button(全站控件統一留 W8-5)。 */}
            <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
              {kind === 'approved' && r.requirement_type === 'deadline' && (
                <Link to="/contract" className="w-full sm:w-auto">
                  <Button size="sm" variant="secondary" className="w-full sm:w-auto max-md:min-h-11">前往期限追蹤 <MSym name="arrow_forward" size={12} /></Button>
                </Link>
              )}
              {/* F3 改法:手機要可辨識為按鈕就用 outline 變體,不再以 className 就地幫 ghost
                  補邊框造出第四種鈕皮(斷點也曾誤用 max-sm,與手機層 max-md 不一致)。
                  實心主動作每組仍只有一個(快速核定鈕)。 */}
              <Button size="sm" variant="outline"
                className="w-full sm:w-auto max-md:min-h-11"
                onClick={() => onSelect(group)}>
                {kind === 'suggestion' && r.requirement_type === 'deadline' && canReview && !quickApprove
                  ? '查看並確認期限' : '查看內容與來源'}
              </Button>
              {quickApprove && (
                <Button size="sm" variant="success" className="w-full sm:w-auto max-md:min-h-11" onClick={() => onQuickApprove(group)}>
                  <MSym name="check_circle" size={13} /> 核定並加入期限追蹤
                </Button>
              )}
              {/* F4:無核定權的提示要與按鈕有視覺區隔——改共用 Badge(slate),不再自寫 pill 殼 */}
              {kind === 'suggestion' && !canReview && (
                <Badge color="slate" className="w-full sm:w-auto justify-center sm:self-center">
                  <MSym name="info" size={12} className="shrink-0" />契約核定由監造／機關辦理
                </Badge>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function Requirements() {
  const { currentProject, isPersistedProject, currentUser, workItems, reloadObligations } = useStore()
  // 鏡像 DB 的 can_review_requirement(機關/監造;刻意無專案管理者例外——技術管理≠契約審核權)
  const canReview = ['owner', 'supervisor'].includes(currentUser?.org_type)
  const [rows, setRows] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [runs, setRuns] = useState([])
  const [sourcesByReq, setSourcesByReq] = useState(new Map())
  const [versionsById, setVersionsById] = useState(new Map())
  const [filters, setFilters] = useState({ scope: 'current' })
  const [selectedId, setSelectedId] = useState(null)
  const [links, setLinks] = useState([])          // requirement_work_items of selected
  const [artifactLinks, setArtifactLinks] = useState([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [editing, setEditing] = useState(null)    // draft copy while editing content
  const [manualItemNo, setManualItemNo] = useState('')
  const [showTrace, setShowTrace] = useState(false)

  const pid = currentProject?.project_id
  const runsById = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs])
  const currentRunIds = useMemo(() => latestCompletedRunIds(runs), [runs])
  // 空狀態與頁首說明的唯一判定(見 requirementsIntro):必須在早退之前算,才不會違反 hooks 順序
  const intro = useMemo(() => requirementsIntro(runs, rows.length), [runs, rows.length])

  const reload = useCallback(async () => {
    if (!isPersistedProject || !pid) return
    setLoaded(false)
    setLoadError('')
    try {
      const [runResult, requirementResult] = await Promise.all([
        supabase.from('document_ingestion_runs')
          .select('id, document_version_id, status, started_at, completed_at, model_name, prompt_version')
          .eq('project_id', pid).order('started_at', { ascending: false }).limit(100),
        supabase.from('requirements').select('*')
          .eq('project_id', pid).order('created_at', { ascending: false }).limit(LIST_LIMIT),
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
        const versionResult = await pageAllInSafe(versionIds, (chunk, from, to) => supabase.from('document_versions')
          .select('id, version_label, documents(title, document_type)').in('id', chunk).order('id').range(from, to))
        if (versionResult.error) throw versionResult.error
        versions = versionResult.data || []
      }
      setRuns(runRows)
      setRows(reqRows)
      setSourcesByReq(byReq)
      setVersionsById(new Map(versions.map((v) => [v.id, v])))
    } catch (error) {
      setLoadError(`契約重點載入失敗：${error?.message || '請稍後再試'}`)
    } finally {
      setLoaded(true)
    }
  }, [isPersistedProject, pid])

  useEffect(() => { reload() }, [reload])

  const loadDetail = useCallback(async (requirementId) => {
    if (!isPersistedProject) return
    const [{ data: linkRows }, { data: artifactRows }] = await Promise.all([
      supabase.from('requirement_work_items').select('*')
        .eq('requirement_id', requirementId).order('created_at'),
      supabase.from('requirement_artifact_links').select('*')
        .eq('requirement_id', requirementId).order('created_at'),
    ])
    setLinks(linkRows || [])
    setArtifactLinks(artifactRows || [])
  }, [isPersistedProject])

  const select = (id) => {
    setSelectedId(id); setEditing(null); setMsg(''); setManualItemNo('')
    loadDetail(id)
  }

  const verificationByReq = useMemo(() => {
    const map = new Map()
    for (const r of rows) map.set(r.id, sourceVerificationSummary(sourcesByReq.get(r.id)))
    return map
  }, [rows, sourcesByReq])

  const visible = useMemo(() => {
    let list = rows
    if (filters.scope === 'current') list = list.filter((r) => inDefaultReviewScope(r, currentRunIds))
    list = filterRequirements(list, filters, verificationByReq)
    return sortForReviewQueue(list)
  }, [rows, filters, currentRunIds, verificationByReq])

  const highlights = useMemo(
    () => buildRequirementHighlights(rows, currentRunIds, verificationByReq),
    [rows, currentRunIds, verificationByReq],
  )
  const shownApproved = highlights.approved.slice(0, HIGHLIGHT_LIMIT)

  const selected = rows.find((r) => r.id === selectedId) || null
  const selectedHighlight = useMemo(() => (
    [...highlights.approved, ...highlights.suggestions]
      .find((group) => group.requirement.id === selectedId) || null
  ), [highlights, selectedId])
  const selectedSources = useMemo(() => {
    if (!selected) return []
    const selectedRows = selectedHighlight?.requirements || [selected]
    return selectedRows.flatMap((r) => sourcesByReq.get(r.id) || [])
  }, [selected, selectedHighlight, sourcesByReq])
  const wiById = useMemo(() => {
    const map = new Map()
    for (const it of workItems?.items || []) if (it.id) map.set(it.id, it)
    return map
  }, [workItems])

  // 生命週期決定:唯一路徑是 review_requirement RPC;成功後以伺服器回傳列刷新。
  const review = async (decision, confirmText, requirementId = selectedId, body = '此為契約層級決定,將由伺服器記錄審查人與時間。') => {
    if (!(await appConfirm({ title: confirmText, body, confirmLabel: confirmText }))) return
    setBusy(decision)
    const { data, error } = await supabase.rpc('review_requirement', {
      p_requirement_id: requirementId, p_decision: decision,
    })
    setBusy('')
    if (error) { setMsg(`審查失敗:${error.message || ''}`); return }
    setRows((rs) => rs.map((r) => (r.id === data.id ? data : r)))
    if (decision === 'approve' && data.requirement_type === 'deadline') await reloadObligations()
    setMsg('')
  }

  const selectHighlight = (group) => select(group.requirement.id)
  const quickApproveDeadline = (group) => {
    const requirementId = group.requirement.id
    select(requirementId)
    return review(
      'approve',
      '核定並加入期限追蹤',
      requirementId,
      '這會把本項核定為契約規則，並在同一筆伺服器交易中加入期限追蹤。',
    )
  }
  const openApprovedTrace = () => {
    setFilters({ scope: 'all', status: 'approved' })
    setShowTrace(true)
  }
  const toggleTrace = () => {
    if (showTrace) {
      // 追溯區可選到 rejected／superseded／舊 run；收合時必須連詳情一起關閉，
      // 否則歷史審查資料會殘留在一般契約重點畫面，破壞 W8-3B 的分層。
      setSelectedId(null)
      setEditing(null)
      setLinks([])
      setArtifactLinks([])
      setMsg('')
    }
    setShowTrace((open) => !open)
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
    if (error) { setMsg(`儲存失敗:${error.message || ''}`); return }
    setRows((rs) => rs.map((r) => (r.id === data.id ? data : r)))
    setEditing(null); setMsg('')
  }

  const decideLink = async (workItemId, review_status) => {
    const { data, error } = await supabase.from('requirement_work_items')
      .update({ review_status })
      .eq('requirement_id', selectedId).eq('work_item_id', workItemId)
      .select().single()
    if (error) { setMsg(`工項連結更新失敗:${error.message || ''}`); return }
    setLinks((ls) => ls.map((l) => (l.work_item_id === workItemId ? data : l)))
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
    if (error) { setMsg(`新增工項連結失敗:${error.message || ''}`); return }
    setLinks((ls) => [...ls, data]); setManualItemNo(''); setMsg('')
  }

  if (!isPersistedProject) {
    return (
      <div className="space-y-5">
        <PageHeader title="契約重點" tagline="先看重點，需要時再追溯" subtitle="已生效的契約規則與 AI 整理結果都保留來源，未核定建議不是待辦。" />
        <Card title="契約重點"><Empty>需真實專案。於「專案文件」上傳契約或規範後，AI 整理結果會顯示在這裡。</Empty></Card>
      </div>
    )
  }

  if (!loaded) {
    return (
      <div className="space-y-5">
        <PageHeader title="契約重點" tagline="先看重點，需要時再追溯" subtitle="已生效的契約規則與 AI 整理結果都保留來源，未核定建議不是待辦。" />
        {/* 載入態走骨架屏,不再借用 Empty(Empty 是空狀態元件;文案由 sr-only 保留給報讀器) */}
        <Card><SkeletonList label="正在載入契約重點…" /></Card>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-5">
        <PageHeader title="契約重點" tagline="先看重點，需要時再追溯" subtitle="已生效的契約規則與 AI 整理結果都保留來源，未核定建議不是待辦。" />
        <ErrorBanner msg={loadError} />
        <Button className="w-full sm:w-auto" onClick={reload}><MSym name="refresh" size={14} /> 重新載入</Button>
      </div>
    )
  }

  // 0 需求時不先堆一排 filter 與空審查區(P2-07)。W8-3A:分「AI 還沒跑完」與
  // 「跑完但沒找到」兩種——後者不是缺前置條件,給上傳 CTA 只會把人繞回原點。
  if (loaded && !rows.length) {
    return (
      <div className="space-y-5">
        <PageHeader title="契約重點" tagline="先看重點，需要時再追溯" subtitle="已生效的契約規則與 AI 整理結果都保留來源，未核定建議不是待辦。" />
        <Card title="契約重點">
          {intro.mode === 'done-empty'
            ? <Empty>{intro.emptyText}</Empty>
            : (
              <PrerequisiteEmptyState
                need={intro.emptyText}
                unlocks="需求審查核定、送審/RFI 的 AI 依規範比對、契約義務時程"
                to="/contract" cta="前往專案文件" />
            )}
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader title="契約重點" tagline="先看重點，需要時再追溯" subtitle="已生效的契約規則與 AI 整理結果都保留來源，未核定建議不是待辦。" />

      <Card title="已生效的契約重點" bodyClass="p-0" action={highlights.approved.length > HIGHLIGHT_LIMIT && (
        <Button variant="ghost" size="sm" onClick={openApprovedTrace}>查看全部已生效內容</Button>
      )}>
        {/* W8-3A(D-014):與首頁初始化清單第 3 步同一語意——AI 整理完成即算完成,
            這裡的待審數量不是初始化門檻,不必為了開啟正式模式把它清空。
            說明收進第一張卡:根層裸文字會吃掉 space-y-5 整格間距。 */}
        <p className="px-4 sm:px-5 py-3 text-xs text-[var(--text-3)] border-b border-[var(--border)]">{intro.note}</p>
        <HighlightRows groups={shownApproved} kind="approved" canReview={canReview}
          verificationByReq={verificationByReq} onSelect={selectHighlight} onQuickApprove={quickApproveDeadline} />
      </Card>

      <Card title="值得留意的整理結果" bodyClass="p-0">
        <HighlightRows groups={highlights.suggestions.slice(0, HIGHLIGHT_LIMIT)} kind="suggestion"
          canReview={canReview} verificationByReq={verificationByReq}
          onSelect={selectHighlight} onQuickApprove={quickApproveDeadline} />
        <div className="border-t border-[var(--border)] px-4 sm:px-5 py-3 text-xs text-[var(--text-3)]">
          其餘擷取結果已保留在追溯區，不必逐筆清空。
        </div>
      </Card>

      <Card title="查看全部擷取結果" bodyClass="p-0" action={(
        <Button variant="ghost" size="sm" onClick={toggleTrace}>
          {showTrace ? '收合追溯資料' : '展開追溯資料'}
        </Button>
      )}>
        {!showTrace ? (
          <p className="px-4 sm:px-5 py-4 text-sm text-[var(--text-2)]">這裡保留原始 AI 擷取、歷史 run 與專業審查資料，不是必須清空的待辦清單。</p>
        ) : (<>
          {/* 六個篩選吃 Select/FIELD_BASE 預設(字級 text-sm、手機 44px 內建),不逐處覆寫;
              低基數維度不改 FilterChip——四維單選展開成 chips 會爆量,屬多維表單式篩選例外 */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 p-4 border-b border-[var(--border)] bg-[var(--surface-2)]">
            <Select value={filters.scope} onChange={(e) => setFilters((f) => ({ ...f, scope: e.target.value, ingestion_run_id: '' }))}>
              <option value="current">目前範圍（最新成功擷取＋人工）</option>
              <option value="all">全部（含歷史 run）</option>
            </Select>
            <Select value={filters.status || ''} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="">全部狀態</option>
              {Object.entries(REQUIREMENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={filters.requirement_type || ''} onChange={(e) => setFilters((f) => ({ ...f, requirement_type: e.target.value }))}>
              <option value="">全部類型</option>
              {Object.entries(REQUIREMENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={filters.responsible_party_type || ''} onChange={(e) => setFilters((f) => ({ ...f, responsible_party_type: e.target.value }))}>
              <option value="">全部負責方</option>
              {Object.entries(RESPONSIBLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={filters.verification || ''} onChange={(e) => setFilters((f) => ({ ...f, verification: e.target.value }))}>
              <option value="">引註不限</option>
              <option value="verified">來源已核對</option>
              <option value="unverified">來源待核對</option>
              <option value="none">無引註</option>
            </Select>
            <Select value={filters.ingestion_run_id || ''} onChange={(e) => setFilters((f) => ({ ...f, ingestion_run_id: e.target.value, ...(e.target.value ? { scope: 'all' } : {}) }))}>
              <option value="">全部擷取 run</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {fmtTime(r.started_at)}·{versionsById.get(r.document_version_id)?.documents?.title || '文件'}·{r.status}
                </option>
              ))}
            </Select>
          </div>
          {visible.length === 0 ? (
            <div className="p-5"><Empty>目前篩選範圍內沒有擷取結果。</Empty></div>
          ) : (
            <div className="divide-y divide-[var(--border)] max-h-[420px] overflow-y-auto">
              {visible.map((r) => (
                <button key={r.id} onClick={() => select(r.id)}
                  /* 選取態改 blue-tint(對齊 CHIP_ON/FilterChip active):hover 與選中共用
                     同一個 surface-2 會讓「目前選了哪筆」看不出來 */
                  className={`w-full text-left px-4 py-2.5 hover:bg-[var(--surface-2)] ${r.id === selectedId ? 'bg-[var(--blue-tint)]' : ''}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge color={STATUS_BADGE[r.status] || 'slate'}>{REQUIREMENT_STATUS_LABELS[r.status] || r.status}</Badge>
                    <span className="text-xs text-[var(--text-3)]">{REQUIREMENT_TYPE_LABELS[r.requirement_type] || r.requirement_type}</span>
                    {r.responsible_party_type && <span className="text-xs text-[var(--text-3)]">{RESPONSIBLE_LABELS[r.responsible_party_type]}</span>}
                    <span className="text-xs text-[var(--text-3)]">{ORIGIN_LABELS[r.origin] || r.origin}</span>
                    {verificationByReq.get(r.id) === 'verified' && <Badge color="green">來源已核對</Badge>}
                    {verificationByReq.get(r.id) === 'unverified' && <Badge color="amber">來源待核對</Badge>}
                  </div>
                  {/* 追溯清單靠標題辨識是哪一條,375px 用 truncate 會把整句切掉;改成最多兩行 */}
                  <div className="text-sm font-medium text-[var(--text)] mt-0.5 line-clamp-2">{r.title}</div>
                </button>
              ))}
            </div>
          )}
        </>)}
      </Card>

      {selected && (
        <Card title="契約內容與來源" action={canReview && (
          <div className="flex flex-wrap justify-start sm:justify-end gap-2">
            {EDITABLE_STATUSES.includes(selected.status) && !editing && (
              <Button variant="ghost" size="sm" onClick={() => setEditing({ ...selected })}><MSym name="edit" size={14} /> 修正內容</Button>
            )}
            {EDITABLE_STATUSES.includes(selected.status) && (<>
              <Button variant="success" size="sm" disabled={!!busy} onClick={() => review('approve', '核定為契約規則')}><MSym name="check_circle" size={14} /> 核定為契約規則</Button>
              <Button variant="danger" size="sm" disabled={!!busy} onClick={() => review('reject', '駁回')}><MSym name="cancel" size={14} /> 駁回</Button>
            </>)}
            {selected.status === 'approved' && (
              <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => review('supersede', '廢止取代')}><MSym name="block" size={14} /> 廢止取代</Button>
            )}
          </div>
        )}>
          {/* 寫入/審查失敗走全站 ErrorBanner,不用裸紅字 */}
          <ErrorBanner msg={msg} className="mb-3" />

          {editing ? (
            <div className="space-y-2 mb-4">
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
                <Input value={editing.lifecycle_phase || ''} onChange={(e) => setEditing((d) => ({ ...d, lifecycle_phase: e.target.value }))} placeholder="階段(開工前/施工中/完工/保固)" className="w-full sm:w-56 min-w-0" />
              </div>
              <Input value={editing.acceptance_criteria || ''} onChange={(e) => setEditing((d) => ({ ...d, acceptance_criteria: e.target.value }))} placeholder="允收標準" />
              <Input value={editing.evidence_requirement || ''} onChange={(e) => setEditing((d) => ({ ...d, evidence_requirement: e.target.value }))} placeholder="應留存佐證" />
              <div className="flex gap-2">
                <Button size="sm" disabled={busy === 'edit'} onClick={saveEdit}>儲存修正</Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>取消</Button>
              </div>
            </div>
          ) : (
            <div className="mb-4">
              <div className="font-medium text-[var(--text)]">{selected.title}</div>
              {selected.description && <p className="text-sm text-[var(--text-2)] mt-1">{selected.description}</p>}
              <div className="text-xs text-[var(--text-3)] mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <span>類型:{REQUIREMENT_TYPE_LABELS[selected.requirement_type] || selected.requirement_type}</span>
                <span>負責方:{RESPONSIBLE_LABELS[selected.responsible_party_type] || '未定'}</span>
                {selected.lifecycle_phase && <span>階段:{selected.lifecycle_phase}</span>}
                {formatRequirementRule(selected) && <span>時點:{formatRequirementRule(selected)}</span>}
                {selected.acceptance_criteria && <span>允收:{selected.acceptance_criteria}</span>}
                {selected.evidence_requirement && <span>佐證:{selected.evidence_requirement}</span>}
                <span>來源:{ORIGIN_LABELS[selected.origin] || selected.origin}</span>
              </div>
              {selected.reviewed_at && (
                <p className="text-xs text-[var(--text-3)] mt-2">審查:{REQUIREMENT_STATUS_LABELS[selected.status]}·{fmtTime(selected.reviewed_at)}(伺服器記錄)</p>
              )}
            </div>
          )}

          {selected.origin === 'ai' && selected.ingestion_run_id && (() => {
            const run = runsById.get(selected.ingestion_run_id)
            const version = run ? versionsById.get(run.document_version_id) : null
            return (
              // 溯源說明改吃共用 Surface 殼(自寫 surface-2 圓角底退場)
              <Surface className="text-xs text-[var(--text-3)] px-3 py-2 mb-4">
                AI 擷取來源:{version?.documents?.title || '文件'}（{version?.version_label || '?'}）
                ·模型 {run?.model_name || '?'}·prompt {run?.prompt_version || '?'}
                ·完成 {fmtTime(run?.completed_at) || run?.status || '?'}
                。模型出處僅供追溯,不代表契約效力;效力以人工核定為準。
              </Surface>
            )
          })()}

          <div className="mb-4">
            <div className="text-sm font-medium text-[var(--text)] mb-1.5 flex items-center gap-1"><MSym name="description" size={14} /> 出處引註</div>
            {selectedSources.length === 0 ? (
              <p className="text-xs text-[var(--text-3)]">無引註。</p>
            ) : selectedSources.map((s) => {
              const version = s.document_version_id ? versionsById.get(s.document_version_id) : null
              return (
                // 引註卡殼走中性 Surface,核對狀態改掛 Badge——不再把 *-text token 疊透明度當邊框色
                <Surface key={s.id} className="px-3 py-2 mb-2 text-xs">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--text-2)]">
                    <Badge color={s.source_verified ? 'green' : 'amber'}>{sourceVerificationLabel(s)}</Badge>
                    {version && <span>{version.documents?.title}（{version.version_label}）</span>}
                    <span>{sourcePageLabel(s)}</span>
                    {s.section && <span>章節 {s.section}</span>}
                    {s.clause && <span>條款 {s.clause}</span>}
                  </div>
                  {s.source_text && <p className="mt-1 text-[var(--text)]">「{s.source_text}」</p>}
                </Surface>
              )
            })}
          </div>

          <div className="mb-4">
            <div className="text-sm font-medium text-[var(--text)] mb-1.5">BOQ 工項對應</div>
            {links.length === 0 && <p className="text-xs text-[var(--text-3)]">尚無工項對應。</p>}
            {links.map((l) => {
              const item = wiById.get(l.work_item_id)
              return (
                <div key={l.work_item_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs border border-[var(--border)] rounded-lg px-3 py-1.5 mb-1.5">
                  <span className="font-medium text-[var(--text)] shrink-0">{item?.item_no || '—'}</span>
                  <span className="flex-1 min-w-[8rem] truncate text-[var(--text-2)]">{item?.description || l.work_item_id}</span>
                  {/* 信賴度上色(handoff 門檻 ≥0.89 ok／≤0.72 warn):覆核的人要能一眼挑出「AI 沒把握、非人工判斷不可」的配對,
                      中間帶維持弱色不搶眼。數字照舊,顏色只是加速掃描,不取代旁邊的核可/駁回決定。 */}
                  {l.confidence != null && (
                    <span className={l.confidence >= 0.89 ? 'text-[var(--green-text)]' : l.confidence <= 0.72 ? 'text-[var(--amber-text)]' : 'text-[var(--text-3)]'}>AI {Math.round(l.confidence * 100)}%</span>
                  )}
                  <Badge color={l.review_status === 'approved' ? 'green' : l.review_status === 'rejected' ? 'red' : 'blue'}>
                    {WORK_ITEM_LINK_STATE_LABELS[l.review_status] || l.review_status}
                  </Badge>
                  {/* 綠/紅底線文字鈕不在按鈕三級語言內:核可/駁回改共用 Button(success/danger),
                      觸控高度由元件內建的 max-md:min-h-11 保證 */}
                  {canReview && l.review_status === 'suggested' && (<>
                    <Button size="sm" variant="success" onClick={() => decideLink(l.work_item_id, 'approved')}>核可</Button>
                    <Button size="sm" variant="danger" onClick={() => decideLink(l.work_item_id, 'rejected')}>駁回</Button>
                  </>)}
                </div>
              )
            })}
            {canReview && (
              // 手機直排讓輸入與新增按鈕保有可讀寬度與觸控目標,桌機才並排
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-2">
                <Input value={manualItemNo} onChange={(e) => setManualItemNo(e.target.value)} placeholder="輸入工項編號(如 壹.一.6.3.28)手動連結" className="w-full sm:w-72 min-w-0" />
                <Button variant="ghost" size="sm" className="w-full sm:w-auto" disabled={!manualItemNo.trim()} onClick={addManualLink}>新增連結</Button>
              </div>
            )}
          </div>

          <div>
            <div className="text-sm font-medium text-[var(--text)] mb-1.5 flex items-center gap-1"><MSym name="link" size={14} /> 已連結流程項目</div>
            {selected.status !== 'approved' && artifactLinks.length === 0 ? (
              <p className="text-xs text-[var(--text-3)]">未核定內容不會建立或連結任何活躍流程。</p>
            ) : artifactLinks.length === 0 ? (
              <p className="text-xs text-[var(--text-3)]">尚未連結流程項目；本頁不會自動建立送審、查驗或試驗流程。</p>
            ) : artifactLinks.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs border border-[var(--border)] rounded-lg px-3 py-1.5 mb-1.5">
                <Badge color="slate">{ARTIFACT_TYPE_LABELS[l.artifact_type] || l.artifact_type}</Badge>
                <span className="flex-1 min-w-[8rem] truncate text-[var(--text-3)]">{l.artifact_id}</span>
                <span className="text-[var(--text-3)] shrink-0">{GENERATION_TYPE_LABELS[l.generation_type] || l.generation_type}</span>
                <span className="text-[var(--text-3)] shrink-0">{fmtTime(l.created_at)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

    </div>
  )
}
