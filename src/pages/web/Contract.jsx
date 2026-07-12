// P0-07.5 契約管制:一個「契約文件包」主流程取代舊的兩個上傳卡。
// 使用者只做一件事:選契約包 → 一次丟進整包文件 → 系統自動整理、分類、
// 找出履約要求。進度來自持久化的 document_processing_runs——離開頁面或重新
// 整理都不會遺失。義務時程(legacy contract_obligations)仍在下方運作,
// 由「同一批已儲存的契約文字」重建,不再要求第二次上傳。
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Scale, FileText, UploadCloud, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { useStore } from '../../store.jsx'
import { supabase } from '../../lib/supabase.js'
import { Card, Empty, PageHeader, Badge, Button, Select } from '../../components/ui.jsx'
import { appConfirm } from '../../components/confirm.jsx'
import { computeObligationDue } from '../../lib/contractDue.js'
import { parsePccesXml } from '../../lib/parsePcces.js'
import {
  PACKAGE_TYPE_LABELS, PACKAGE_STATUS_LABELS, availablePackageOptions,
  packageDisplayName, defaultPackageTitle,
} from '../../lib/contractPackages.js'
import { ACCEPT_ATTR } from '../../lib/packageFileSupport.js'
import {
  DOCUMENT_TYPE_LABELS, CLASSIFIABLE_DOCUMENT_TYPES, EXTRACTABLE_DOCUMENT_TYPES,
  PRESENTATION_GROUPS, presentationGroup,
} from '../../lib/documentClassifier.js'
import {
  uploadFilesToPackage, summarizePackageProgress, packageStatusFromRuns,
  formatElapsed, staleProcessingPatch, takeSelectedFiles, STAGE_LABELS, RUN_STATUS_LABELS,
} from '../../lib/packageUpload.js'

const PHASES = ['開工前', '施工中', '完工', '保固', '其他']
const TRIGGER_LABEL = {
  award: '決標', notice: '接獲開工通知', commencement: '開工',
  completion: '完工', monthly: '每月', fixed: '指定日期', other: '其他',
}
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function ruleText(ob) {
  if (ob.recurring === 'monthly') return `每月 ${ob.recurring_day || ''} 日${ob.offset_dir === 'before' ? '前' : ''}`.trim()
  if (ob.trigger_event === 'fixed') return `指定 ${ob.fixed_date || '日期'}`
  const t = TRIGGER_LABEL[ob.trigger_event] || ob.trigger_event || ''
  if (ob.offset_days) return `${t}${ob.offset_dir === 'before' ? '前' : '後'} ${ob.offset_days} 日內`
  return t
}

const DOT = { done: 'var(--green-text)', overdue: 'var(--red-text)', soon: 'var(--amber-text)', scheduled: 'var(--blue)', nodate: 'var(--text-3)' }
const LEGACY_TEXT_BUDGET = 150_000

export default function Contract() {
  const {
    isSupabaseConfigured, currentProject, isPersistedProject,
    currentProjectMembership, currentUser,
    obligations, parseContractFromText, updateObligationStatus, updateProjectAnchors, can,
    importWorkItems, workItemsSource,
  } = useStore()
  const [anchors, setAnchors] = useState({ award_date: '', notice_date: '', commencement_date: '' })
  const [parties, setParties] = useState([])
  const [packages, setPackages] = useState([])
  const [selectedPackageId, setSelectedPackageId] = useState(null)
  const [runs, setRuns] = useState([])            // processing runs of the selected package
  const [docsById, setDocsById] = useState(new Map())
  const [versionsById, setVersionsById] = useState(new Map())
  const [aiCount, setAiCount] = useState(null)    // AI 履約要求建議數(本契約包)
  const [uploading, setUploading] = useState(false)
  const [boqMsg, setBoqMsg] = useState('')
  const [msg, setMsg] = useState('')
  const [legacyMsg, setLegacyMsg] = useState('')
  const [showTech, setShowTech] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [, forceTick] = useState(0)
  const tickRef = useRef(null)

  const pid = currentProject?.project_id
  const canUploadDocs = isPersistedProject && can.edit

  useEffect(() => {
    setAnchors({
      award_date: currentProject?.award_date || '',
      notice_date: currentProject?.notice_date || '',
      commencement_date: currentProject?.commencement_date || '',
    })
  }, [currentProject])

  const setAnchor = (key, val) => {
    setAnchors((a) => ({ ...a, [key]: val }))
    updateProjectAnchors({ [key]: val || null })
  }

  // ── 契約包與處理狀態載入(持久化,重新整理不遺失)────────────────────────
  const reloadPackages = useCallback(async () => {
    if (!isPersistedProject || !pid) return
    const [{ data: partyRows }, { data: packageRows }] = await Promise.all([
      supabase.from('project_parties').select('id, party_type, display_name').eq('project_id', pid),
      supabase.from('contract_packages').select('*').eq('project_id', pid).order('created_at'),
    ])
    setParties(partyRows || [])
    setPackages(packageRows || [])
    setSelectedPackageId((prev) => prev && (packageRows || []).some((p) => p.id === prev)
      ? prev
      : (packageRows?.[0]?.id || null))
  }, [isPersistedProject, pid])
  useEffect(() => { reloadPackages() }, [reloadPackages])

  const selectedPackage = packages.find((p) => p.id === selectedPackageId) || null

  const reloadRuns = useCallback(async (packageId) => {
    if (!isPersistedProject || !packageId) { setRuns([]); return }
    const { data: persistedRows } = await supabase.from('document_processing_runs')
      .select('*').eq('contract_package_id', packageId).order('started_at')
    const runRows = [...(persistedRows || [])]
    for (let i = 0; i < runRows.length; i++) {
      const patch = staleProcessingPatch(runRows[i])
      if (!patch) continue
      const { data: recovered } = await supabase.from('document_processing_runs')
        .update(patch).eq('id', runRows[i].id).select().single()
      if (recovered) runRows[i] = recovered
    }
    setRuns(runRows)
    const { data: docRows } = await supabase.from('documents')
      .select('id, title, document_type').eq('contract_package_id', packageId)
    setDocsById(new Map((docRows || []).map((d) => [d.id, d])))
    const docIds = (docRows || []).map((d) => d.id)
    if (docIds.length) {
      const { data: versionRows } = await supabase.from('document_versions')
        .select('id, document_id, version_label').in('document_id', docIds)
      setVersionsById(new Map((versionRows || []).map((v) => [v.id, v])))
      const { data: ingRuns } = await supabase.from('document_ingestion_runs')
        .select('id').in('document_version_id', (versionRows || []).map((v) => v.id))
      if (ingRuns?.length) {
        const { count } = await supabase.from('requirements')
          .select('id', { count: 'exact', head: true })
          .in('ingestion_run_id', ingRuns.map((r) => r.id))
        setAiCount(count ?? null)
      } else setAiCount(0)
    } else { setVersionsById(new Map()); setAiCount(0) }
  }, [isPersistedProject])
  useEffect(() => { reloadRuns(selectedPackageId) }, [reloadRuns, selectedPackageId])

  const progress = useMemo(() => summarizePackageProgress(runs), [runs])
  useEffect(() => {
    if (!selectedPackageId || progress.active === 0) return
    const id = setInterval(() => reloadRuns(selectedPackageId), 5000)
    return () => clearInterval(id)
  }, [selectedPackageId, progress.active, reloadRuns])
  useEffect(() => {
    if (progress.active > 0 && !tickRef.current) {
      tickRef.current = setInterval(() => forceTick((n) => n + 1), 1000)
    }
    if (progress.active === 0 && tickRef.current) {
      clearInterval(tickRef.current); tickRef.current = null
    }
    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null } }
  }, [progress.active])
  const elapsed = useMemo(() => {
    const active = runs.filter((r) => !['completed', 'partial', 'failed', 'unsupported'].includes(r.status))
    if (!active.length) return null
    const earliest = Math.min(...active.map((r) => new Date(r.started_at).getTime()))
    return formatElapsed(Date.now() - earliest)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, progress.active, Date.now()])

  const packageOptions = useMemo(
    () => availablePackageOptions({ membership: currentProjectMembership, parties }),
    [currentProjectMembership, parties],
  )
  const partiesById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties])
  const myPartyId = currentProjectMembership?.project_party_id || null

  // 尚未建立的可用契約包:顯示為可選並於首次上傳時建立
  const creatableOptions = packageOptions.filter((o) => !packages.some(
    (p) => p.package_type === o.package_type
      && p.counterparty_project_party_id === o.counterparty_project_party_id,
  ))

  const ensurePackage = useCallback(async (option) => {
    const existing = packages.find((p) => p.package_type === option.package_type
      && p.counterparty_project_party_id === option.counterparty_project_party_id)
    if (existing) return existing
    const agencyParty = parties.find((p) => p.party_type === 'agency') || null
    const { data, error } = await supabase.from('contract_packages').insert({
      project_id: pid,
      package_type: option.package_type,
      counterparty_project_party_id: option.counterparty_project_party_id,
      owner_project_party_id: agencyParty?.id || null,
      title: defaultPackageTitle(option),
      created_by: currentUser?.user_id || null,
    }).select().single()
    if (error) throw new Error(`建立契約包失敗:${error.message}`)
    setPackages((ps) => [...ps, data])
    return data
  }, [packages, parties, pid, currentUser])

  // ── 一個主要上傳流程:多檔 → 自動整理 → 履約要求 → 義務時程 ─────────────
  const handleFiles = useCallback(async (fileList, targetPackage) => {
    let files = [...(fileList || [])].filter(Boolean)
    if (!files.length || !canUploadDocs) return
    // 統一窗口:PCCES 標單 XML 直接路由到 BOQ 匯入,其餘進契約包管線
    const xmls = files.filter((f) => /\.xml$/i.test(f.name))
    files = files.filter((f) => !/\.xml$/i.test(f.name))
    for (const xf of xmls) {
      try {
        if (workItemsSource === 'db') { setBoqMsg('標單已匯入過,略過 XML(如需重匯請至「標單工項」頁清空重匯)。'); continue }
        const parsed = parsePccesXml(await xf.text())
        const { error, count } = await importWorkItems(parsed)
        setBoqMsg(error ? `標單匯入失敗:${error.message}` : `標單已匯入 ${count} 項工項(見「標單工項」頁)。`)
      } catch (e) { setBoqMsg(`標單 XML 解析失敗:${e.message || ''}`) }
    }
    if (!files.length) return
    let pkg = targetPackage
    try {
      if (!pkg) {
        if (!packageOptions.length) { setMsg('此專案尚未設定契約相對人(施工廠商/監造單位),請先於專案成員維護。'); return }
        pkg = await ensurePackage(packageOptions[0])
      }
      setUploading(true); setMsg(''); setLegacyMsg('')
      setSelectedPackageId(pkg.id)
      await supabase.from('contract_packages').update({ status: 'processing' }).eq('id', pkg.id)
      const onRun = (run) => setRuns((rs) => {
        const i = rs.findIndex((r) => r.document_version_id === run.document_version_id)
        return i >= 0 ? rs.map((r, j) => (j === i ? run : r)) : [...rs, run]
      })
      const { runs: batchRuns, failures, contractTexts } = await uploadFilesToPackage({
        files, packageRow: pkg, projectId: pid, userId: currentUser?.user_id || null, onRun,
      })
      // 義務時程(legacy):同一批契約文字直接重建,不需第二次上傳。
      if (pkg.package_type === 'construction' && can.edit && contractTexts.length) {
        if (!obligations.length) {
          const { error, count } = await parseContractFromText(
            contractTexts.join('\n\n').slice(0, LEGACY_TEXT_BUDGET))
          setLegacyMsg(error
            ? `義務時程解析未完成:${error.message || ''}`
            : `已同步產生 ${count} 項義務時程(見下方)。`)
        } else {
          setLegacyMsg('義務時程已存在,未自動覆蓋;可在下方「義務時程」以最新契約文件重新產生。')
        }
      }
      const { data: freshRuns } = await supabase.from('document_processing_runs')
        .select('*').eq('contract_package_id', pkg.id).order('started_at')
      const nextStatus = packageStatusFromRuns(freshRuns || batchRuns)
      await supabase.from('contract_packages').update({ status: nextStatus }).eq('id', pkg.id)
      setPackages((ps) => ps.map((p) => (p.id === pkg.id ? { ...p, status: nextStatus } : p)))
      if (failures.length) setMsg(`部分檔案未能開始處理:${failures[0]}`)
      await reloadRuns(pkg.id)
    } catch (e) {
      setMsg(e?.message || '上傳失敗')
    } finally {
      setUploading(false)
    }
  }, [canUploadDocs, packageOptions, ensurePackage, pid, currentUser, can.edit,
    obligations.length, parseContractFromText, reloadRuns, importWorkItems, workItemsSource])

  // 待確認文件:修正分類 → 視需要重新路由 AI 分析
  const confirmClassification = useCallback(async (run, newType) => {
    const version = versionsById.get(run.document_version_id)
    const docId = version?.document_id
    if (docId) {
      const { error } = await supabase.from('documents')
        .update({ document_type: newType }).eq('id', docId)
      if (error) { setMsg(`分類更新失敗:${error.message}`); return }
      setDocsById((m) => new Map(m).set(docId, { ...m.get(docId), document_type: newType }))
    }
    const patch = { classification_status: 'confirmed' }
    const canExtract = EXTRACTABLE_DOCUMENT_TYPES.includes(newType)
      && run.parser_type && run.parser_type !== 'none'
    let updated = null
    if (canExtract) {
      await supabase.from('document_processing_runs')
        .update({ ...patch, status: 'processing', stage: 'extracting_requirements' })
        .eq('id', run.id)
      const { data, error } = await supabase.functions.invoke('extract-requirements', {
        body: { document_version_id: run.document_version_id, project_id: pid },
      })
      const failed = error || data?.error
      const { data: final } = await supabase.from('document_processing_runs').update({
        ...patch,
        status: failed ? 'partial' : 'completed',
        stage: failed ? 'failed' : 'completed',
        completed_at: new Date().toISOString(),
        error_message: failed ? (data?.error || error?.message || 'AI 分析失敗') : null,
        metadata: {
          ...(run.metadata || {}),
          requirement_extraction: failed ? 'failed' : 'completed',
          requirement_extraction_message: failed
            ? (data?.error || error?.message) : `找到 ${data?.extracted_requirement_count ?? 0} 項履約要求建議`,
          routed_document_type: newType,
        },
      }).eq('id', run.id).select().single()
      updated = final
    } else {
      const { data: final } = await supabase.from('document_processing_runs')
        .update(patch).eq('id', run.id).select().single()
      updated = final
    }
    if (updated) setRuns((rs) => rs.map((r) => (r.id === updated.id ? updated : r)))
    await reloadRuns(run.contract_package_id)
  }, [versionsById, pid, reloadRuns])

  // ── 義務時程(legacy runtime,原樣保留)────────────────────────────────
  const regenerateDeadlines = useCallback(async () => {
    if (!selectedPackage || selectedPackage.package_type !== 'construction') return
    if (obligations.length && !(await appConfirm({
      title: '重新產生義務時程?', body: '將以本契約包中「契約」類文件的已儲存文字重新解析,並取代目前清單。',
      confirmLabel: '重新產生',
    }))) return
    setLegacyMsg('正在由已儲存的契約文字重新產生義務時程…')
    const contractDocIds = [...docsById.values()]
      .filter((d) => d.document_type === 'contract').map((d) => d.id)
    const versionIds = [...versionsById.values()]
      .filter((v) => contractDocIds.includes(v.document_id)).map((v) => v.id)
    if (!versionIds.length) { setLegacyMsg('本契約包尚無「契約」類文件,無法產生義務時程。'); return }
    const { data: pageRows } = await supabase.from('document_pages')
      .select('document_version_id, page_number, extracted_text')
      .in('document_version_id', versionIds).order('page_number')
    const text = (pageRows || []).map((p) => p.extracted_text).join('\n').slice(0, LEGACY_TEXT_BUDGET)
    const { error, count } = await parseContractFromText(text)
    setLegacyMsg(error ? `義務時程解析失敗:${error.message || ''}` : `已重新產生 ${count} 項義務時程。`)
  }, [selectedPackage, obligations.length, docsById, versionsById, parseContractFromText])

  // ── 義務時程顯示(原樣)────────────────────────────────────────────────
  const items = useMemo(() => {
    const a = { ...anchors, end_date: currentProject?.end_date }
    return obligations.map((ob) => {
      const due = computeObligationDue(ob, a)
      const done = ob.status === '已提送' || ob.status === '已完成'
      let diff = null, state = 'nodate'
      if (done) state = 'done'
      else if (due) { diff = Math.round((due - today0()) / 86400000); state = diff < 0 ? 'overdue' : diff <= 7 ? 'soon' : 'scheduled' }
      return { ob, due, diff, done, state }
    })
  }, [obligations, anchors, currentProject])
  const counts = useMemo(() => {
    let overdue = 0, soon = 0, done = 0
    for (const it of items) { if (it.state === 'overdue') overdue++; else if (it.state === 'soon') soon++; if (it.done) done++ }
    return { overdue, soon, done }
  }, [items])
  const groups = useMemo(() => PHASES.map((ph) => ({
    ph, list: items.filter((it) => (PHASES.includes(it.ob.category) ? it.ob.category : '其他') === ph)
      .sort((x, y) => (x.due?.getTime() || Infinity) - (y.due?.getTime() || Infinity)),
  })).filter((g) => g.list.length), [items])

  // 檔案列表(依分類分組)與待確認清單
  const fileRows = useMemo(() => runs.map((run) => {
    const version = versionsById.get(run.document_version_id)
    const doc = version ? docsById.get(version.document_id) : null
    return { run, version, doc }
  }), [runs, versionsById, docsById])
  const needsReviewRows = fileRows.filter((r) => r.run.classification_status === 'needs_review')
  const groupedFiles = useMemo(() => {
    const byGroup = new Map(PRESENTATION_GROUPS.map((g) => [g, []]))
    for (const row of fileRows) {
      const type = row.doc?.document_type || row.run.suggested_document_type || 'other'
      const group = presentationGroup(type, row.run.metadata?.classification_reason)
      byGroup.get(group)?.push(row)
    }
    return [...byGroup.entries()].filter(([, list]) => list.length)
  }, [fileRows])

  if (isSupabaseConfigured && !currentProject) {
    return <Card title="契約管制"><Empty>請先登入並建立/選擇專案,才能整理契約文件。</Empty></Card>
  }

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <PageHeader title="專案文件" tagline="一次上傳,自動整理" subtitle="把整個專案的文件(契約、標單 XML、規範、圖說)一次丟進來——系統自動分類歸檔、抽出時程義務與履約需求,然後告訴你什麼時間該做什麼" />
      </div>

      <Card title="基準日">
        <div className="flex flex-wrap gap-4">
          {[['award_date', '決標日'], ['notice_date', '接獲開工通知日'], ['commencement_date', '開工日']].map(([k, label]) => (
            <label key={k} className="block">
              <span className="block text-sm font-medium text-[var(--text)] mb-1">{label}</span>
              <input type="date" value={anchors[k]} onChange={(e) => setAnchor(k, e.target.value)}
                disabled={!can.edit}
                className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm" />
            </label>
          ))}
        </div>
        <p className="text-xs text-[var(--text-3)] mt-3">義務時程的到期日、倒數、逾期都依這些基準日即時計算。</p>
      </Card>

      {/* ── 契約文件包:唯一的主要上傳流程 ──────────────────────────────── */}
      <Card title="契約文件" action={
        <div className="flex items-center gap-2">
          {(packages.length > 1 || creatableOptions.length > 0) && (
            <Select value={selectedPackageId || ''} className="text-xs w-48"
              onChange={async (e) => {
                const value = e.target.value
                if (value.startsWith('new:')) {
                  const option = creatableOptions[Number(value.slice(4))]
                  if (option) {
                    try { const pkg = await ensurePackage(option); setSelectedPackageId(pkg.id) }
                    catch (err) { setMsg(err.message) }
                  }
                } else setSelectedPackageId(value)
              }}>
              {packages.map((p) => {
                const name = packageDisplayName(p, { partiesById, myPartyId })
                return <option key={p.id} value={p.id}>{name.title}</option>
              })}
              {creatableOptions.map((o, i) => (
                <option key={o.package_type + o.counterparty_project_party_id} value={`new:${i}`}>
                  ＋ {o.label}
                </option>
              ))}
            </Select>
          )}
          <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 transition ${uploading || !canUploadDocs ? 'opacity-50' : 'cursor-pointer bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] shadow-sm'}`}>
            <input type="file" multiple accept={ACCEPT_ATTR}
              disabled={uploading || !canUploadDocs}
              onChange={(e) => handleFiles(takeSelectedFiles(e.target), selectedPackage)}
              className="hidden" />
            <UploadCloud size={15} aria-hidden /> {uploading ? '整理中…' : '上傳契約文件'}
          </label>
        </div>
      }>
        {/* 契約包總覽(依角色只列可見契約包) */}
        {packages.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {packages.map((p) => {
              const name = packageDisplayName(p, { partiesById, myPartyId })
              const active = p.id === selectedPackageId
              return (
                <button key={p.id} onClick={() => setSelectedPackageId(p.id)}
                  className={`text-left border rounded-xl px-3 py-2 min-w-[160px] transition ${active ? 'border-[var(--primary)] bg-[var(--blue-tint)]' : 'border-[var(--border)] hover:bg-[var(--surface-2)]'}`}>
                  <div className="text-sm font-medium text-[var(--text)]">{name.title}</div>
                  {name.subtitle && <div className="text-xs text-[var(--text-3)]">{name.subtitle}</div>}
                  <div className="text-xs text-[var(--text-3)] mt-0.5">{PACKAGE_STATUS_LABELS[p.status] || p.status}</div>
                </button>
              )
            })}
          </div>
        )}

        {/* 拖放區 + 摘要 */}
        <div
          onDragOver={(e) => { e.preventDefault(); if (canUploadDocs) setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (canUploadDocs) handleFiles(e.dataTransfer?.files, selectedPackage) }}
          className={`border-2 border-dashed rounded-xl px-4 py-4 transition ${dragOver ? 'border-[var(--primary)] bg-[var(--blue-tint)]' : 'border-[var(--border)]'}`}
        >
          {progress.total === 0 ? (
            <p className="text-sm text-[var(--text-2)]">
              把整包契約文件直接拖進來,或點右上「上傳契約文件」。可一次選擇多個檔案
              (PDF / Word / TXT / Excel / 圖片…),系統會自動分類、整理並找出履約要求。
            </p>
          ) : (
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--text)]">
              <span className="font-medium">已收到 {progress.total} 份文件</span>
              <span>{progress.classified} 已分類</span>
              <span>{progress.requirementsAnalyzed} 已分析履約要求</span>
              {progress.needsClassification > 0 && <span className="text-[var(--amber-text)]">{progress.needsClassification} 待確認</span>}
              {progress.unsupported > 0 && <span className="text-[var(--text-3)]">{progress.unsupported} 尚未支援分析</span>}
              {progress.failed > 0 && <span className="text-[var(--red-text)]">{progress.failed} 失敗</span>}
            </div>
          )}
          {!isPersistedProject && <p className="text-xs text-amber-600 mt-2">Demo 模式不支援,請登入並選擇真實專案。</p>}
          {isPersistedProject && !can.edit && <p className="text-xs text-[var(--text-3)] mt-2">需文件管理權限(廠商專案經理/機關專案經理/監造主任/文件管理員)。</p>}
        </div>

        {/* 真實階段進度(持久化;離開頁面不會遺失) */}
        {(progress.active > 0 || uploading) && (
          <div className="mt-4 bg-[var(--surface-2)] rounded-xl px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[var(--text)]">
                正在整理{selectedPackage ? packageDisplayName(selectedPackage, { partiesById, myPartyId }).title : '契約文件'}
              </span>
              {elapsed && <span className="text-xs text-[var(--text-3)]">已進行 {elapsed}</span>}
            </div>
            <ul className="mt-2 space-y-1 text-xs text-[var(--text-2)]">
              <li>{progress.uploaded >= progress.total ? '✓' : '●'} 已上傳 {progress.uploaded} / {progress.total}</li>
              <li>{progress.textExtracted >= progress.total - progress.unsupported ? '✓' : '●'} 已完成文字讀取 {progress.textExtracted} / {progress.total - progress.unsupported}</li>
              <li>{progress.classified >= progress.total ? '✓' : '●'} 已辨識文件類型 {progress.classified} / {progress.total}</li>
              <li>{progress.active === 0 ? '✓' : '●'} 已分析履約要求 {progress.requirementsAnalyzed}</li>
            </ul>
            <p className="text-xs text-[var(--text-3)] mt-2">你可以離開此頁,處理結果會保留。</p>
          </div>
        )}
        {msg && <p className="text-xs text-rose-600 mt-3">{msg}</p>}
        {legacyMsg && <p className="text-xs text-[var(--text-2)] mt-2">{legacyMsg}</p>}
        {boqMsg && <p className="text-xs text-[var(--text-2)] mt-2">{boqMsg}</p>}
        {!uploading && (runs.length > 0 || obligations.length > 0) && (
          <div className="mt-4 rounded-lg border border-[var(--border-2)] bg-[var(--blue-tint)]/40 px-4 py-3">
            <div className="text-xs font-semibold text-[var(--text)] mb-1.5">接下來該做什麼</div>
            <ul className="text-xs text-[var(--text-2)] space-y-1">
              {obligations.length > 0 && (
                <li>📅 {obligations.length} 項時程義務已列在下方時間軸——到期會自動出現在<Link to="/alerts" className="text-[var(--blue-text)] hover:underline">提醒中心</Link>。</li>
              )}
              <li>🔍 AI 擷取的履約需求要人工確認才生效 → <Link to="/requirements" className="text-[var(--blue-text)] hover:underline">前往履約需求審查</Link>(機關/監造辦理)。</li>
              {workItemsSource === 'db'
                ? <li>📋 標單已就緒 → <Link to="/boq" className="text-[var(--blue-text)] hover:underline">標單工項</Link>;估驗、進度、日誌都掛在它上面。</li>
                : <li>📋 還沒看到標單:把 PCCES 預算書 XML 也丟進上面同一個框即可自動匯入。</li>}
            </ul>
          </div>
        )}

        {/* AI 履約要求摘要 → 審查收件匣 */}
        {aiCount != null && aiCount > 0 && (
          <p className="text-sm text-[var(--text)] mt-4">
            AI 從本契約找到 <span className="font-semibold">{aiCount}</span> 項履約要求建議。
            <Link to="/requirements" className="text-[var(--blue-text)] hover:underline ml-1">前往審查 →</Link>
          </p>
        )}

        {/* 待確認文件 */}
        {needsReviewRows.length > 0 && (
          <div className="mt-4">
            <div className="text-sm font-medium text-[var(--amber-text)] mb-1.5">待確認文件({needsReviewRows.length})</div>
            {needsReviewRows.map(({ run, doc }) => (
              <div key={run.id} className="flex items-center gap-2 text-xs border border-[var(--amber-text)]/40 bg-[var(--amber-tint)] rounded-lg px-3 py-1.5 mb-1.5">
                <span className="flex-1 truncate text-[var(--text)]">{doc?.title || '文件'}</span>
                <span className="text-[var(--text-3)]">AI 建議:{DOCUMENT_TYPE_LABELS[run.suggested_document_type] || '無法判斷'}</span>
                {can.edit && (
                  <div className="flex items-center gap-1.5">
                    <Select defaultValue={run.suggested_document_type || 'other'} className="text-xs w-40"
                      onChange={(e) => confirmClassification(run, e.target.value)}>
                      {CLASSIFIABLE_DOCUMENT_TYPES.map((t) => (
                        <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
                      ))}
                    </Select>
                    <button onClick={() => confirmClassification(run, run.suggested_document_type || 'other')}
                      className="text-[var(--blue-text)] hover:underline whitespace-nowrap">確認此分類</button>
                  </div>
                )}
              </div>
            ))}
            <p className="text-[11px] text-[var(--text-3)]">選擇正確類型即完成確認;契約/規範/品質計畫類文件會接著自動分析履約要求。</p>
          </div>
        )}

        {/* 文件分類清單 */}
        {groupedFiles.length > 0 && (
          <div className="mt-4">
            {groupedFiles.map(([group, list]) => (
              <div key={group} className="mb-3">
                <div className="text-sm font-medium text-[var(--text-2)] mb-1">{group}({list.length})</div>
                {list.map(({ run, doc, version }) => {
                  const analyzed = run.metadata?.requirement_extraction === 'completed'
                  return (
                    <div key={run.id} className="flex items-center gap-2 text-xs border border-[var(--border)] rounded-lg px-3 py-1.5 mb-1">
                      <FileText size={12} className="text-[var(--text-3)] shrink-0" aria-hidden />
                      <span className="flex-1 truncate text-[var(--text)]">{doc?.title || '文件'}</span>
                      {version?.version_label && <span className="text-[var(--text-3)]">{version.version_label}</span>}
                      <Badge color={run.status === 'completed' ? 'green' : run.status === 'failed' ? 'red' : run.status === 'unsupported' ? 'slate' : run.status === 'partial' ? 'amber' : 'blue'}>
                        {run.status === 'processing' ? STAGE_LABELS[run.stage] || run.stage : RUN_STATUS_LABELS[run.status] || run.status}
                      </Badge>
                      {analyzed && <span className="text-[var(--green-text)]">{run.metadata?.requirement_extraction_message || '已分析'}</span>}
                      {run.status === 'unsupported' && <span className="text-[var(--text-3)]">{run.metadata?.limitation || '尚未支援內容分析'}</span>}
                      {(run.status === 'partial' || run.status === 'failed') && run.error_message && (
                        <span className="text-[var(--amber-text)] truncate max-w-[220px]">{run.error_message}</span>
                      )}
                      {can.edit && run.metadata?.requirement_extraction === 'failed' && (
                        <button onClick={() => confirmClassification(run, doc?.document_type || run.suggested_document_type || 'other')}
                          className="text-[var(--blue-text)] hover:underline inline-flex items-center gap-0.5">
                          <RefreshCw size={11} aria-hidden /> 重試分析
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {/* 技術資訊(內部詞彙只放這裡) */}
        {runs.length > 0 && (
          <div className="mt-3">
            <button onClick={() => setShowTech((s) => !s)} className="text-xs text-[var(--text-3)] hover:text-[var(--text-2)] inline-flex items-center gap-1">
              {showTech ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />} 技術資訊
            </button>
            {showTech && (
              <div className="mt-2 text-[11px] text-[var(--text-3)] space-y-0.5">
                {runs.map((r) => (
                  <div key={r.id}>
                    {versionsById.get(r.document_version_id) ? docsById.get(versionsById.get(r.document_version_id).document_id)?.title : r.document_version_id}
                    ·status {r.status}·stage {r.stage}·parser {r.parser_type || '-'}
                    ·信心 {r.classification_confidence != null ? Math.round(r.classification_confidence * 100) + '%' : '-'}
                    {r.error_message ? `·${r.error_message}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── 義務時程(legacy 相容 runtime)──────────────────────────────── */}
      <Card title="義務時程" action={
        can.edit && selectedPackage?.package_type === 'construction' && (
          <Button variant="outline" size="sm" onClick={regenerateDeadlines}>以契約文件重新產生</Button>
        )
      }>
        <div className="flex flex-wrap gap-2">
          <Pill color="red" n={counts.overdue} label="已逾期" />
          <Pill color="amber" n={counts.soon} label="7 日內到期" />
          <Pill color="green" n={counts.done} label="已完成" />
        </div>
        {groups.length === 0 && (
          <p className="text-xs text-[var(--text-3)] mt-3">尚無資料。上傳契約文件後,系統會自動由契約類文件產生時程義務與罰則清單。</p>
        )}
      </Card>

      {groups.map((g) => (
        <div key={g.ph}>
          <div className="text-sm font-medium text-[var(--text-2)] mb-2">{g.ph}</div>
          <div className="space-y-2">
            {g.list.map((it) => (
              <div key={it.ob.id} className="flex gap-3">
                <span className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style={{ background: DOT[it.state] }} />
                <div className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-medium text-[var(--text)]">{it.ob.title}</span>
                    {can.edit && <button onClick={() => updateObligationStatus(it.ob.id, it.done ? '待辦' : '已提送')}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap shrink-0 ${it.done ? 'bg-[var(--green-tint)] text-[var(--green-text)]' : 'border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)]'}`}>
                      {it.done ? '已提送 ✓' : '標為已提送'}
                    </button>}
                  </div>
                  <div className="text-xs text-[var(--text-3)] mt-1">
                    {ruleText(it.ob)}{it.due ? `　·　到期 ${iso(it.due)}` : ''}
                    {it.ob.responsible ? `　·　${it.ob.responsible}` : ''}
                  </div>
                  {!it.done && it.due && (
                    <div className={`text-xs font-medium mt-0.5 ${it.state === 'overdue' ? 'text-rose-600' : it.state === 'soon' ? 'text-amber-600' : 'text-[var(--text-2)]'}`}>
                      {it.state === 'overdue' ? `已逾期 ${-it.diff} 天` : `還有 ${it.diff} 天`}
                    </div>
                  )}
                  {it.ob.penalty && (
                    <div className="text-xs text-[var(--amber-text)] bg-[var(--amber-tint)] rounded-md px-2 py-1 mt-2 inline-flex items-center gap-1"><Scale size={12} aria-hidden /> {it.ob.penalty}</div>
                  )}
                  {(it.ob.source_clause || it.ob.source_page) && (
                    <div className="text-[11px] text-[var(--text-3)] mt-2 flex items-center gap-1"><FileText size={11} aria-hidden /> 契約 {it.ob.source_clause} {it.ob.source_page}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Pill({ color, n, label }) {
  const c = { red: 'bg-[var(--red-tint)] text-[var(--red-text)]', amber: 'bg-[var(--amber-tint)] text-[var(--amber-text)]', green: 'bg-[var(--green-tint)] text-[var(--green-text)]' }[color]
  return <span className={`text-xs px-3 py-1 rounded-full font-medium ${c}`}>{label} {n} 項</span>
}
