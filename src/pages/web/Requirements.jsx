// P0-07 履約需求審查頁:AI 建議 → 人工審查 → 核定/駁回 的契約決策邊界。
// 資料用「有界的」焦點查詢直接向 Supabase 取(不進全域 store);
// 生命週期決定一律走 review_requirement RPC(伺服器蓋審查人/時間戳),
// 前端絕不樂觀顯示核定結果。工作流 artifact 只列出既有連結(P0-07 不產生)。
import { useState, useEffect, useMemo, useCallback } from 'react'
import { ScrollText, CheckCircle2, XCircle, Ban, FileText, Link2, Pencil } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { supabase } from '../../lib/supabase.js'
import { Card, Empty, PageHeader, Badge, Button, Input, Textarea, Select } from '../../components/ui.jsx'
import { appConfirm } from '../../components/confirm.jsx'
import {
  REQUIREMENT_STATUS_LABELS, REQUIREMENT_TYPE_LABELS, RESPONSIBLE_LABELS, ORIGIN_LABELS,
  WORK_ITEM_LINK_STATE_LABELS, ARTIFACT_TYPE_LABELS, GENERATION_TYPE_LABELS,
  latestCompletedRunIds, inDefaultReviewScope, sortForReviewQueue, filterRequirements,
  sourceVerificationSummary, sourcePageLabel, sourceVerificationLabel, formatRequirementRule,
} from '../../lib/requirementReview.js'

const LIST_LIMIT = 300
const STATUS_BADGE = {
  draft_ai: 'blue', needs_review: 'amber', approved: 'green', rejected: 'red', superseded: 'slate',
}
const EDITABLE_STATUSES = ['draft_ai', 'needs_review']
const fmtTime = (v) => (v ? new Date(v).toLocaleString('zh-TW', { hour12: false }) : '')

export default function Requirements() {
  const { currentProject, isPersistedProject, currentUser, workItems } = useStore()
  // 鏡像 DB 的 can_review_requirement(機關/監造;刻意無專案管理者例外——技術管理≠契約審核權)
  const canReview = ['owner', 'supervisor'].includes(currentUser?.org_type)
  const [rows, setRows] = useState([])
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

  const pid = currentProject?.project_id
  const runsById = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs])
  const currentRunIds = useMemo(() => latestCompletedRunIds(runs), [runs])

  const reload = useCallback(async () => {
    if (!isPersistedProject || !pid) return
    const [{ data: runRows }, { data: reqRows }] = await Promise.all([
      supabase.from('document_ingestion_runs')
        .select('id, document_version_id, status, started_at, completed_at, model_name, prompt_version')
        .eq('project_id', pid).order('started_at', { ascending: false }).limit(100),
      supabase.from('requirements').select('*')
        .eq('project_id', pid).order('created_at', { ascending: false }).limit(LIST_LIMIT),
    ])
    setRuns(runRows || [])
    setRows(reqRows || [])
    const ids = (reqRows || []).map((r) => r.id)
    const { data: sourceRows } = ids.length
      ? await supabase.from('requirement_sources').select('*').in('requirement_id', ids)
      : { data: [] }
    const byReq = new Map()
    for (const s of sourceRows || []) {
      if (!byReq.has(s.requirement_id)) byReq.set(s.requirement_id, [])
      byReq.get(s.requirement_id).push(s)
    }
    setSourcesByReq(byReq)
    const versionIds = [...new Set([
      ...(sourceRows || []).map((s) => s.document_version_id),
      ...(runRows || []).map((r) => r.document_version_id),
    ].filter(Boolean))]
    if (versionIds.length) {
      const { data: versions } = await supabase.from('document_versions')
        .select('id, version_label, documents(title, document_type)').in('id', versionIds)
      setVersionsById(new Map((versions || []).map((v) => [v.id, v])))
    } else {
      setVersionsById(new Map())
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

  const selected = rows.find((r) => r.id === selectedId) || null
  const wiById = useMemo(() => {
    const map = new Map()
    for (const it of workItems?.items || []) if (it.id) map.set(it.id, it)
    return map
  }, [workItems])

  // 生命週期決定:唯一路徑是 review_requirement RPC;成功後以伺服器回傳列刷新。
  const review = async (decision, confirmText) => {
    if (!(await appConfirm({ title: confirmText, body: '此為契約層級決定,將由伺服器記錄審查人與時間。', confirmLabel: confirmText }))) return
    setBusy(decision)
    const { data, error } = await supabase.rpc('review_requirement', {
      p_requirement_id: selectedId, p_decision: decision,
    })
    setBusy('')
    if (error) { setMsg(`審查失敗:${error.message || ''}`); return }
    setRows((rs) => rs.map((r) => (r.id === data.id ? data : r)))
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
        <PageHeader title="履約需求" tagline="AI 建議 → 人工審查" subtitle="AI 擷取的履約需求建議在此逐項審查;核定後才成為專案的契約性規則" />
        <Card title="履約需求審查"><Empty>需真實專案。於「專案文件」頁一次上傳專案文件後,建議會出現在這裡待審查。</Empty></Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader title="履約需求" tagline="AI 建議 → 人工審查" subtitle="逐項檢視需求內容、出處引註與工項對應;核定後才成為專案的契約性規則" />

      <Card title="待審查清單" bodyClass="p-0" action={
        <div className="flex flex-wrap gap-2 items-center text-xs">
          <Select value={filters.scope} onChange={(e) => setFilters((f) => ({ ...f, scope: e.target.value, ingestion_run_id: '' }))} className="text-xs">
            <option value="current">目前範圍(最新成功擷取+人工)</option>
            <option value="all">全部(含歷史 run)</option>
          </Select>
          <Select value={filters.status || ''} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="text-xs">
            <option value="">全部狀態</option>
            {Object.entries(REQUIREMENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={filters.requirement_type || ''} onChange={(e) => setFilters((f) => ({ ...f, requirement_type: e.target.value }))} className="text-xs">
            <option value="">全部類型</option>
            {Object.entries(REQUIREMENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={filters.responsible_party_type || ''} onChange={(e) => setFilters((f) => ({ ...f, responsible_party_type: e.target.value }))} className="text-xs">
            <option value="">全部負責方</option>
            {Object.entries(RESPONSIBLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={filters.verification || ''} onChange={(e) => setFilters((f) => ({ ...f, verification: e.target.value }))} className="text-xs">
            <option value="">引註不限</option>
            <option value="verified">來源已核對</option>
            <option value="unverified">來源待人工確認</option>
            <option value="none">無引註</option>
          </Select>
          <Select value={filters.ingestion_run_id || ''} onChange={(e) => setFilters((f) => ({ ...f, ingestion_run_id: e.target.value, ...(e.target.value ? { scope: 'all' } : {}) }))} className="text-xs">
            <option value="">全部擷取 run</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {fmtTime(r.started_at)}·{versionsById.get(r.document_version_id)?.documents?.title || '文件'}·{r.status}
              </option>
            ))}
          </Select>
        </div>
      }>
        {visible.length === 0 ? (
          <div className="p-5"><Empty>目前範圍內沒有履約需求。於「契約管制」頁執行 AI 履約需求擷取,或調整上方篩選。</Empty></div>
        ) : (
          <div className="divide-y divide-[var(--border)] max-h-[420px] overflow-y-auto">
            {visible.map((r) => (
              <button key={r.id} onClick={() => select(r.id)}
                className={`w-full text-left px-4 py-2.5 hover:bg-[var(--surface-2)] ${r.id === selectedId ? 'bg-[var(--surface-2)]' : ''}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge color={STATUS_BADGE[r.status] || 'slate'}>{REQUIREMENT_STATUS_LABELS[r.status] || r.status}</Badge>
                  <span className="text-xs text-[var(--text-3)]">{REQUIREMENT_TYPE_LABELS[r.requirement_type] || r.requirement_type}</span>
                  {r.responsible_party_type && <span className="text-xs text-[var(--text-3)]">{RESPONSIBLE_LABELS[r.responsible_party_type]}</span>}
                  <span className="text-xs text-[var(--text-3)]">{ORIGIN_LABELS[r.origin] || r.origin}</span>
                  {verificationByReq.get(r.id) === 'verified' && <span className="text-xs text-[var(--green-text)]">來源已核對</span>}
                  {verificationByReq.get(r.id) === 'unverified' && <span className="text-xs text-[var(--amber-text)]">來源待人工確認</span>}
                </div>
                <div className="text-sm font-medium text-[var(--text)] mt-0.5 truncate">{r.title}</div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {selected && (
        <Card title="需求審查" action={canReview && (
          <div className="flex gap-2">
            {EDITABLE_STATUSES.includes(selected.status) && !editing && (
              <Button variant="ghost" size="sm" onClick={() => setEditing({ ...selected })}><Pencil size={14} aria-hidden /> 修正內容</Button>
            )}
            {EDITABLE_STATUSES.includes(selected.status) && (<>
              <Button variant="success" size="sm" disabled={!!busy} onClick={() => review('approve', '核定')}><CheckCircle2 size={14} aria-hidden /> 核定</Button>
              <Button variant="danger" size="sm" disabled={!!busy} onClick={() => review('reject', '駁回')}><XCircle size={14} aria-hidden /> 駁回</Button>
            </>)}
            {selected.status === 'approved' && (
              <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => review('supersede', '廢止取代')}><Ban size={14} aria-hidden /> 廢止取代</Button>
            )}
          </div>
        )}>
          {msg && <p className="text-xs text-rose-600 mb-3">{msg}</p>}

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
                <Input value={editing.lifecycle_phase || ''} onChange={(e) => setEditing((d) => ({ ...d, lifecycle_phase: e.target.value }))} placeholder="階段(開工前/施工中/完工/保固)" className="w-56" />
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
                {selected.confidence != null && <span>AI 信心:{Math.round(selected.confidence * 100)}%</span>}
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
              <div className="text-xs text-[var(--text-3)] bg-[var(--surface-2)] rounded-lg px-3 py-2 mb-4">
                AI 擷取來源:{version?.documents?.title || '文件'}（{version?.version_label || '?'}）
                ·模型 {run?.model_name || '?'}·prompt {run?.prompt_version || '?'}
                ·完成 {fmtTime(run?.completed_at) || run?.status || '?'}
                。模型出處僅供追溯,不代表契約效力;效力以人工核定為準。
              </div>
            )
          })()}

          <div className="mb-4">
            <div className="text-sm font-medium text-[var(--text)] mb-1.5 flex items-center gap-1"><FileText size={14} aria-hidden /> 出處引註</div>
            {(sourcesByReq.get(selected.id) || []).length === 0 ? (
              <p className="text-xs text-[var(--text-3)]">無引註。</p>
            ) : (sourcesByReq.get(selected.id) || []).map((s) => {
              const version = s.document_version_id ? versionsById.get(s.document_version_id) : null
              return (
                <div key={s.id} className={`border rounded-lg px-3 py-2 mb-2 text-xs ${s.source_verified ? 'border-[var(--green-text)]/40 bg-[var(--green-tint)]' : 'border-[var(--amber-text)]/40 bg-[var(--amber-tint)]'}`}>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[var(--text-2)]">
                    <span className={`font-medium ${s.source_verified ? 'text-[var(--green-text)]' : 'text-[var(--amber-text)]'}`}>{sourceVerificationLabel(s)}</span>
                    {version && <span>{version.documents?.title}（{version.version_label}）</span>}
                    <span>{sourcePageLabel(s)}</span>
                    {s.section && <span>章節 {s.section}</span>}
                    {s.clause && <span>條款 {s.clause}</span>}
                  </div>
                  {s.source_text && <p className="mt-1 text-[var(--text)]">「{s.source_text}」</p>}
                </div>
              )
            })}
          </div>

          <div className="mb-4">
            <div className="text-sm font-medium text-[var(--text)] mb-1.5">BOQ 工項對應</div>
            {links.length === 0 && <p className="text-xs text-[var(--text-3)]">尚無工項對應。</p>}
            {links.map((l) => {
              const item = wiById.get(l.work_item_id)
              return (
                <div key={l.work_item_id} className="flex items-center gap-2 text-xs border border-[var(--border)] rounded-lg px-3 py-1.5 mb-1.5">
                  <span className="font-medium text-[var(--text)]">{item?.item_no || '—'}</span>
                  <span className="flex-1 truncate text-[var(--text-2)]">{item?.description || l.work_item_id}</span>
                  {l.confidence != null && <span className="text-[var(--text-3)]">AI {Math.round(l.confidence * 100)}%</span>}
                  <Badge color={l.review_status === 'approved' ? 'green' : l.review_status === 'rejected' ? 'red' : 'blue'}>
                    {WORK_ITEM_LINK_STATE_LABELS[l.review_status] || l.review_status}
                  </Badge>
                  {canReview && l.review_status === 'suggested' && (<>
                    <button onClick={() => decideLink(l.work_item_id, 'approved')} className="text-[var(--green-text)] hover:underline">核可</button>
                    <button onClick={() => decideLink(l.work_item_id, 'rejected')} className="text-[var(--red-text)] hover:underline">駁回</button>
                  </>)}
                </div>
              )
            })}
            {canReview && (
              <div className="flex gap-2 mt-2">
                <Input value={manualItemNo} onChange={(e) => setManualItemNo(e.target.value)} placeholder="輸入工項編號(如 壹.一.6.3.28)手動連結" className="w-72 text-xs" />
                <Button variant="ghost" size="sm" disabled={!manualItemNo.trim()} onClick={addManualLink}>新增連結</Button>
              </div>
            )}
          </div>

          <div>
            <div className="text-sm font-medium text-[var(--text)] mb-1.5 flex items-center gap-1"><Link2 size={14} aria-hidden /> 已連結流程項目</div>
            {selected.status !== 'approved' && artifactLinks.length === 0 ? (
              <p className="text-xs text-[var(--text-3)]">需求核定後,才能建立對應的流程項目連結(檢驗停留點/檢查表/送審等)。</p>
            ) : artifactLinks.length === 0 ? (
              <p className="text-xs text-[var(--text-3)]">尚未建立流程項目。</p>
            ) : artifactLinks.map((l) => (
              <div key={l.id} className="flex items-center gap-2 text-xs border border-[var(--border)] rounded-lg px-3 py-1.5 mb-1.5">
                <Badge color="slate">{ARTIFACT_TYPE_LABELS[l.artifact_type] || l.artifact_type}</Badge>
                <span className="flex-1 truncate text-[var(--text-3)]">{l.artifact_id}</span>
                <span className="text-[var(--text-3)]">{GENERATION_TYPE_LABELS[l.generation_type] || l.generation_type}</span>
                <span className="text-[var(--text-3)]">{fmtTime(l.created_at)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!selected && (
        <Card title="需求審查"><Empty><span className="inline-flex items-center gap-1"><ScrollText size={14} aria-hidden /> 從上方清單選擇一項履約需求開始審查。</span></Empty></Card>
      )}
    </div>
  )
}
