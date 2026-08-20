// P0-07.5 契約管制:一個「契約文件包」主流程取代舊的兩個上傳卡。
// 使用者只做一件事:選契約包 → 一次丟進整包文件 → 系統自動整理、分類、
// 找出履約要求。進度來自持久化的 document_processing_runs——離開頁面或重新
// 整理都不會遺失。核准的 deadline Requirement 由資料庫單向建立下方義務時程。
// 契約包、文件與處理進度只供本頁使用，保留有界的頁面查詢，不塞進全域 Store。
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { supabase } from '../../lib/supabase.js'
import { Card, Empty, PageHeader, Badge, Button, Select } from '../../components/ui.jsx'
import { computeObligationDue } from '../../lib/contractDue.js'
import { estimatePenalty } from '../../lib/penaltyCalc.js'
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
// W8-5:狀態不得只靠顏色。色點本身給等價文字(hover 看 title、報讀器讀 aria-label),
// 色盲與螢幕報讀使用者才拿得到「已逾期/7 日內」這種行動依據。
const DOT_LABEL = { done: '已完成', overdue: '已逾期', soon: '7 日內到期', scheduled: '排程中', nodate: '無期限' }
export default function Contract() {
  const {
    isSupabaseConfigured, currentProject, isPersistedProject,
    currentProjectMembership, currentUser,
    obligations, updateObligationStatus, updateProjectAnchors, can,
    importWorkItems, workItemsSource, reloadMembership, workItems, submittals,
  } = useStore()
  const contractTotal = workItems?.meta?.billable_total || 0 // 契約總價(發包工程費),逾期罰款試算基準
  // end_date 也是基準日之一(completion 觸發的義務用它算到期);它在建案表單填一次之後
  // 原本沒有任何 UI 能修改,留白就永遠是 nodate,所以一併納入這張卡(W8-6 ISSUE-1)。
  const [anchors, setAnchors] = useState({ award_date: '', notice_date: '', commencement_date: '', end_date: '' })
  const [parties, setParties] = useState([])
  const [packages, setPackages] = useState([])
  const [selectedPackageId, setSelectedPackageId] = useState(null)
  const [runs, setRuns] = useState([])            // processing runs of the selected package
  const [docsById, setDocsById] = useState(new Map())
  const [versionsById, setVersionsById] = useState(new Map())
  const [aiCount, setAiCount] = useState(null)    // AI 履約要求建議數(本契約包)
  const [uploading, setUploading] = useState(false)
  // 標單 XML 走的是另一條路(不建 processing run),自己記忙碌旗標與結果語氣:
  // 成功/略過/失敗原本同一種灰字,失敗會被當成沒事(W8-6 ISSUE-2)。
  const [boqBusy, setBoqBusy] = useState(false)
  const [boqMsg, setBoqMsg] = useState(null)   // { tone: 'ok' | 'skip' | 'error', text }
  const [msg, setMsg] = useState('')
  const [obligationMsg, setObligationMsg] = useState('')
  const [showTech, setShowTech] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [, forceTick] = useState(0)
  const tickRef = useRef(null)
  // W-01 佐證鏈:標為已提送時的送審佐證挑選(evidenceFor=義務 id;'' 表示不掛)
  const [evidenceFor, setEvidenceFor] = useState(null)
  const [evidencePick, setEvidencePick] = useState('')

  const pid = currentProject?.project_id
  const canUploadDocs = isPersistedProject && can.edit

  useEffect(() => {
    setAnchors({
      award_date: currentProject?.award_date || '',
      notice_date: currentProject?.notice_date || '',
      commencement_date: currentProject?.commencement_date || '',
      end_date: currentProject?.end_date || '',
    })
  }, [currentProject])

  // DB 成功才更新本地(B-04):非建立者被 RLS 靜默擋下時,原本 UI 直接顯示新日期,
  // 整頁義務時程都建立在沒存進 DB 的基準日上,重整才還原。
  const [anchorErr, setAnchorErr] = useState('')
  const setAnchor = async (key, val) => {
    setAnchorErr('')
    if (isPersistedProject) {
      const { error } = await updateProjectAnchors({ [key]: val || null })
      if (error) { setAnchorErr(`基準日未儲存:${error.message}`); return }
    }
    setAnchors((a) => ({ ...a, [key]: val })) // demo:只進本地,供時間軸展示
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

  // 身分快照只選「我代表哪個契約方」；能否上傳仍由 project_members/profile 產生的 can.edit 決定。
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

  // 自動補齊專案身分:受邀成員/舊專案缺 parties 或 membership 時,開頁即修——
  // 不再把使用者導去一個管不了這件事的頁面。冪等 RPC,失敗才顯示訊息。
  const identityFixTried = useRef(false)
  useEffect(() => {
    if (!isPersistedProject || !pid || !canUploadDocs) return
    if (packageOptions.length > 0 || identityFixTried.current) return
    identityFixTried.current = true
    ;(async () => {
      const { error } = await supabase.rpc('ensure_project_identity', { p: pid })
      if (error) { setMsg(`初始化專案身分失敗:${error.message}`); return }
      reloadMembership()
      await reloadPackages()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPersistedProject, pid, canUploadDocs, packageOptions.length])

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

  // ── 一個主要上傳流程:多檔 → 自動整理 → 履約要求 ───────────────────────
  const handleFiles = useCallback(async (fileList, targetPackage) => {
    let files = [...(fileList || [])].filter(Boolean)
    if (!files.length || !canUploadDocs) return
    setBoqMsg(null)   // 上一批的結果不得跨批殘留(否則這次只丟 PDF 也會看到上次的標單訊息)
    // 統一窗口:PCCES 標單 XML 直接路由到 BOQ 匯入,其餘進契約包管線
    const xmls = files.filter((f) => /\.xml$/i.test(f.name))
    files = files.filter((f) => !/\.xml$/i.test(f.name))
    // 同批多個 XML:第一份成功後,迴圈內的 workItemsSource 是過期閉包值,
    // 用本地旗標擋後續檔案——否則第二份會撞伺服器「已有標單」錯誤,蓋掉成功訊息
    let boqImported = workItemsSource === 'db'
    if (xmls.length) {
      setBoqBusy(true)
      try {
        for (const xf of xmls) {
          try {
            // 略過訊息接在既有訊息後面,語氣沿用前一則:第一份成功、其餘略過時整體仍是成功
            if (boqImported) { setBoqMsg((prev) => ({ tone: prev?.tone || 'skip', text: `${prev?.text ? prev.text + ' ' : ''}標單已匯入過,略過「${xf.name}」(如需重匯請至「標單工項」頁清空重匯)。` })); continue }
            const parsed = parsePccesXml(await xf.text())
            const { error, count } = await importWorkItems(parsed)
            if (!error) boqImported = true
            setBoqMsg(error
              ? { tone: 'error', text: `標單匯入失敗:${error.message}` }
              : { tone: 'ok', text: `標單已匯入 ${count} 項工項。` })
          } catch (e) { setBoqMsg({ tone: 'error', text: `標單 XML 解析失敗:${e.message || ''}` }) }
        }
      } finally { setBoqBusy(false) }
    }
    if (!files.length) return
    let pkg = targetPackage
    try {
      if (!pkg) {
        if (!packageOptions.length) { setMsg('專案身分初始化中,請稍候幾秒再試一次。'); return }
        pkg = await ensurePackage(packageOptions[0])
      }
      setUploading(true); setMsg('')
      setSelectedPackageId(pkg.id)
      await supabase.from('contract_packages').update({ status: 'processing' }).eq('id', pkg.id)
      const onRun = (run) => setRuns((rs) => {
        const i = rs.findIndex((r) => r.document_version_id === run.document_version_id)
        return i >= 0 ? rs.map((r, j) => (j === i ? run : r)) : [...rs, run]
      })
      const { runs: batchRuns, failures } = await uploadFilesToPackage({
        files, packageRow: pkg, projectId: pid, userId: currentUser?.user_id || null, onRun,
      })
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
  }, [canUploadDocs, packageOptions, ensurePackage, pid, currentUser,
    reloadRuns, importWorkItems, workItemsSource])

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

  // ── 義務時程顯示(approved deadline 的相容 runtime)────────────────────
  const items = useMemo(() => {
    // end_date 已在 anchors 內(卡片可編輯),不再另外從 currentProject 取——否則剛改完的
    // 竣工日要等專案清單重載才會反映到時程上
    return obligations.map((ob) => {
      const due = computeObligationDue(ob, anchors)
      const done = ob.status === '已提送' || ob.status === '已完成'
      let diff = null, state = 'nodate'
      if (done) state = 'done'
      else if (due) { diff = Math.round((due - today0()) / 86400000); state = diff < 0 ? 'overdue' : diff <= 7 ? 'soon' : 'scheduled' }
      return { ob, due, diff, done, state }
    })
  }, [obligations, anchors])
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
        <PageHeader title="專案文件" tagline="一次上傳,自動整理" subtitle="把整個專案的文件(契約、標單 XML、規範、圖說)一次丟進來——系統自動分類歸檔並抽出履約需求;人工核准的期限會進入義務時程" />
      </div>

      <Card title="基準日">
        <div className="flex flex-wrap gap-4">
          {[
            ['award_date', '決標日'],
            ['notice_date', '接獲開工通知日'],
            ['commencement_date', '開工日'],
            // 建案表單的「預計竣工日」寫的就是這一欄;完工類義務算不出到期日多半是它留白
            ['end_date', '竣工日(完工義務基準)'],
          ].map(([k, label]) => (
            <label key={k} className="block">
              <span className="block text-sm font-medium text-[var(--text)] mb-1">{label}</span>
              <input type="date" value={anchors[k]} onChange={(e) => setAnchor(k, e.target.value)}
                disabled={!can.edit}
                className="border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm max-sm:min-h-11" />
            </label>
          ))}
        </div>
        {anchorErr && <p className="text-xs text-[var(--red-text)] mt-2">{anchorErr}</p>}
        <p className="text-xs text-[var(--text-3)] mt-3">義務時程的到期日、倒數、逾期都依這些基準日即時計算。「開工日」請填實際開工日;建立專案時填的是預計值,在這裡更新才會影響義務時程。</p>
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
          <label className={`inline-flex items-center gap-1.5 text-sm font-medium rounded-lg px-4 py-2 pressable ${uploading || boqBusy || !canUploadDocs ? 'opacity-50' : 'cursor-pointer bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)] shadow-sm'}`}>
            <input type="file" multiple accept={ACCEPT_ATTR}
              disabled={uploading || boqBusy || !canUploadDocs}
              onChange={(e) => handleFiles(takeSelectedFiles(e.target), selectedPackage)}
              className="hidden" />
            <MSym name="cloud_upload" size={15} /> {boqBusy ? '解析標單中…' : uploading ? '整理中…' : '上傳契約文件'}
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
                  className={`text-left border rounded-xl px-3 py-2 min-w-[160px] pressable ${active ? 'border-[var(--primary)] bg-[var(--blue-tint)]' : 'border-[var(--border)] hover:bg-[var(--surface-2)]'}`}>
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
          className={`border-2 border-dashed rounded-xl px-4 py-4 transition-colors ${dragOver ? 'border-[var(--primary)] bg-[var(--blue-tint)]' : 'border-[var(--border)]'}`}
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
          {/* 警語一律吃 --amber-text token:硬編碼 text-amber-600 在深色模式不會跟著切換 */}
          {!isPersistedProject && <p className="text-xs text-[var(--amber-text)] mt-2">Demo 模式不支援,請登入並選擇真實專案。</p>}
          {isPersistedProject && !can.edit && <p className="text-xs text-[var(--text-3)] mt-2">需編輯權限(施工廠商或專案管理者)。</p>}
        </div>

        {/* 真實階段進度(持久化;離開頁面不會遺失) */}
        {(progress.active > 0 || uploading || boqBusy) && (
          <div className="mt-4 bg-[var(--surface-2)] rounded-xl px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[var(--text)]">
                正在整理{selectedPackage ? packageDisplayName(selectedPackage, { partiesById, myPartyId }).title : '契約文件'}
              </span>
              {elapsed && <span className="text-xs text-[var(--text-3)]">已進行 {elapsed}</span>}
            </div>
            <ul className="mt-2 space-y-1 text-xs text-[var(--text-2)]">
              {/* 只丟標單 XML 時完全沒有 processing run,計數列會是 0/0——那條路徑只報自己的進度 */}
              {boqBusy && <li>● 正在解析標單 XML…</li>}
              {progress.total > 0 && (
                <>
                  <li>{progress.uploaded >= progress.total ? '✓' : '●'} 已上傳 {progress.uploaded} / {progress.total}</li>
                  <li>{progress.textExtracted >= progress.total - progress.unsupported ? '✓' : '●'} 已完成文字讀取 {progress.textExtracted} / {progress.total - progress.unsupported}</li>
                  <li>{progress.classified >= progress.total ? '✓' : '●'} 已辨識文件類型 {progress.classified} / {progress.total}</li>
                  <li>{progress.active === 0 ? '✓' : '●'} 已分析履約要求 {progress.requirementsAnalyzed}</li>
                </>
              )}
            </ul>
            {/* 「可離開」只對持久化的 processing run 成立;標單匯入是本頁直接呼叫 RPC,離開會中斷 */}
            {progress.total > 0 && <p className="text-xs text-[var(--text-3)] mt-2">你可以離開此頁,處理結果會保留。</p>}
          </div>
        )}
        {msg && <p className="text-xs text-[var(--red-text)] mt-3">{msg}</p>}
        {/* 成功/略過/失敗要一眼分得出來:失敗用紅字,成功綠字並直接給下一步入口 */}
        {boqMsg && (
          <p className={`text-xs mt-2 ${boqMsg.tone === 'ok' ? 'text-[var(--green-text)]' : boqMsg.tone === 'error' ? 'text-[var(--red-text)]' : 'text-[var(--text-3)]'}`}>
            {boqMsg.text}
            {boqMsg.tone === 'ok' && <Link to="/boq" className="text-[var(--blue-text)] hover:underline ml-1">前往標單工項 →</Link>}
          </p>
        )}
        {/* workItemsSource:只匯了標單的新專案(runs=0、obligations=0)本來看不到後續指引 */}
        {!uploading && !boqBusy && (runs.length > 0 || obligations.length > 0 || workItemsSource === 'db') && (
          <div className="mt-4 rounded-lg border border-[var(--border-2)] bg-[var(--blue-tint)]/40 px-4 py-3">
            <div className="text-xs font-semibold text-[var(--text)] mb-1.5">接下來該做什麼</div>
            <ul className="text-xs text-[var(--text-2)] space-y-1">
              {obligations.length > 0 && (
                <li>📅 {obligations.length} 項時程義務已列在下方時間軸——到期會自動出現在<Link to="/alerts" className="text-[var(--blue-text)] hover:underline">提醒中心</Link>。</li>
              )}
              {/* W8-3A(D-014):人工核定只針對「要成為契約規則」的內容,不是初始化門檻。
                  ⚠️ 這一行在整理尚未跑完時也會顯示,所以措辭必須中性——不得斷言「AI 已整理完成」
                  (是否完成的唯一判定在 document_ingestion_runs,見 Requirements 的 requirementsIntro)。 */}
              <li>🔍 AI 整理完成後,只有要成為契約規則的內容才需人工核定 → <Link to="/requirements" className="text-[var(--blue-text)] hover:underline">前往契約重點</Link>(機關/監造辦理);未核定不影響開啟正式模式。</li>
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
            <Link to="/requirements" className="text-[var(--blue-text)] hover:underline ml-1">查看整理結果 →</Link>
          </p>
        )}

        {/* 待確認文件 */}
        {needsReviewRows.length > 0 && (
          <div className="mt-4">
            <div className="text-sm font-medium text-[var(--amber-text)] mb-1.5">待確認文件({needsReviewRows.length})</div>
            {needsReviewRows.map(({ run, doc }) => (
              <div key={run.id} className="flex items-center gap-2 text-xs border border-[var(--amber-text)]/40 bg-[var(--amber-tint)] rounded-lg px-3 py-1.5 mb-1.5">
                {/* 文件標題是人據以選分類的依據,被截斷時至少要能 hover 看全名 */}
                <span className="flex-1 truncate text-[var(--text)]" title={doc?.title || '文件'}>{doc?.title || '文件'}</span>
                {/* amber-tint 底上的 text-3 只有 3.4:1,次要文字改 text-2(≈6.6:1) */}
                <span className="text-[var(--text-2)]">AI 建議:{DOCUMENT_TYPE_LABELS[run.suggested_document_type] || '無法判斷'}</span>
                {can.edit && (
                  <div className="flex items-center gap-1.5">
                    <Select defaultValue={run.suggested_document_type || 'other'} className="text-xs w-40"
                      onChange={(e) => confirmClassification(run, e.target.value)}>
                      {CLASSIFIABLE_DOCUMENT_TYPES.map((t) => (
                        <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
                      ))}
                    </Select>
                    <button onClick={() => confirmClassification(run, run.suggested_document_type || 'other')}
                      className="text-[var(--blue-text)] hover:underline whitespace-nowrap inline-flex items-center max-sm:min-h-11 px-1">確認此分類</button>
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
                      <MSym name="description" size={12} className="text-[var(--text-3)] shrink-0" />
                      <span className="flex-1 truncate text-[var(--text)]" title={doc?.title || '文件'}>{doc?.title || '文件'}</span>
                      {version?.version_label && <span className="text-[var(--text-3)]">{version.version_label}</span>}
                      <Badge color={run.status === 'completed' ? 'green' : run.status === 'failed' ? 'red' : run.status === 'unsupported' ? 'slate' : run.status === 'partial' ? 'amber' : 'blue'}>
                        {run.status === 'processing' ? STAGE_LABELS[run.stage] || run.stage : RUN_STATUS_LABELS[run.status] || run.status}
                      </Badge>
                      {analyzed && <span className="text-[var(--green-text)]">{run.metadata?.requirement_extraction_message || '已分析'}</span>}
                      {run.status === 'unsupported' && <span className="text-[var(--text-2)]">{run.metadata?.limitation || '尚未支援內容分析'}</span>}
                      {/* 解析失敗原因是「要不要重試」的唯一依據,220px 一定切掉:
                          改兩行 line-clamp 併 title(同 RFI.jsx 的既有寫法),不再硬截斷 */}
                      {(run.status === 'partial' || run.status === 'failed') && run.error_message && (
                        <span className="text-[var(--amber-text)] line-clamp-2 whitespace-pre-line max-w-[220px]"
                          title={run.error_message}>{run.error_message}</span>
                      )}
                      {can.edit && run.metadata?.requirement_extraction === 'failed' && (
                        <button onClick={() => confirmClassification(run, doc?.document_type || run.suggested_document_type || 'other')}
                          className="text-[var(--blue-text)] hover:underline inline-flex items-center gap-0.5 max-sm:min-h-11 px-1">
                          <MSym name="refresh" size={11} /> 重試分析
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
            <button onClick={() => setShowTech((s) => !s)} aria-expanded={showTech}
              className="text-xs text-[var(--text-3)] hover:text-[var(--text-2)] inline-flex items-center gap-1 max-sm:min-h-11 px-1">
              <MSym name="chevron_right" size={12} className={`transition-transform duration-[var(--dur-fast)] ${showTech ? 'rotate-90' : ''}`} /> 技術資訊
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

      {/* ── 義務時程(approved deadline 相容 runtime)────────────────────── */}
      <Card title="義務時程">
        {/* 逾期/將到期/已完成三個計數走共用 Badge:五語意色票全站同一份定義,
            本頁不再自帶一套藥丸樣式(顏色與其他頁的紅/琥珀/綠會對不起來) */}
        <div className="flex flex-wrap gap-2">
          <Badge color="red">已逾期 {counts.overdue} 項</Badge>
          <Badge color="amber">7 日內到期 {counts.soon} 項</Badge>
          <Badge color="green">已完成 {counts.done} 項</Badge>
        </div>
        {groups.length === 0 && (
          <p className="text-xs text-[var(--text-3)] mt-3">尚無已核准的期限要求。上傳契約文件並前往「契約重點」；期限核准後會自動出現在這裡。</p>
        )}
        {obligationMsg && <p className="text-xs text-[var(--red-text)] mt-2">{obligationMsg}</p>}
      </Card>

      {groups.map((g) => (
        <div key={g.ph}>
          <div className="text-sm font-medium text-[var(--text-2)] mb-2">{g.ph}</div>
          <div className="space-y-2">
            {g.list.map((it) => (
              <div key={it.ob.id} className="flex gap-3">
                <span className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style={{ background: DOT[it.state] }}
                  role="img" title={DOT_LABEL[it.state]} aria-label={DOT_LABEL[it.state]} />
                <div className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-medium text-[var(--text)]">{it.ob.title}</span>
                    {can.edit && <button onClick={async () => {
                      if (it.done) {
                        // 退回待辦:一併解除佐證連結(W-01)
                        const { error } = await updateObligationStatus(it.ob.id, '待辦', { evidence_submittal_id: null })
                        if (error) setObligationMsg(`義務狀態未寫入:${error.message}`)
                      } else if (submittals.length) {
                        // 有送審文件可掛 → 展開佐證挑選(不強制,可略過)
                        setEvidenceFor(evidenceFor === it.ob.id ? null : it.ob.id); setEvidencePick('')
                      } else {
                        const { error } = await updateObligationStatus(it.ob.id, '已提送')
                        if (error) setObligationMsg(`義務狀態未寫入:${error.message}`)
                      }
                    }}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap shrink-0 inline-flex items-center max-sm:min-h-11 ${it.done ? 'bg-[var(--green-tint)] text-[var(--green-text)]' : 'border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2)]'}`}>
                      {it.done ? '已提送 ✓' : '標為已提送'}
                    </button>}
                  </div>
                  {/* W-01 佐證挑選:掛上對應的送審文件,義務完成不再只是空口 toggle */}
                  {evidenceFor === it.ob.id && !it.done && (
                    <div className="mt-2 p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex flex-wrap items-center gap-2">
                      <span className="text-xs text-[var(--text-2)] shrink-0">佐證送審文件</span>
                      <Select value={evidencePick} onChange={(e) => setEvidencePick(e.target.value)} className="text-xs flex-1 min-w-[200px]">
                        <option value="">（不掛佐證）</option>
                        {submittals.map((s) => (
                          <option key={s.id} value={s.id}>{s.submittal_no} {s.title}（{s.status}）</option>
                        ))}
                      </Select>
                      <Button size="sm" onClick={async () => {
                        const { error } = await updateObligationStatus(it.ob.id, '已提送',
                          evidencePick ? { evidence_submittal_id: evidencePick } : {})
                        if (error) { setObligationMsg(`義務狀態未寫入:${error.message}`); return }
                        setEvidenceFor(null)
                      }}>{evidencePick ? '掛佐證並標為已提送' : '直接標為已提送'}</Button>
                      <button onClick={() => setEvidenceFor(null)} className="text-xs text-[var(--text-3)] hover:underline inline-flex items-center max-sm:min-h-11 px-1">取消</button>
                    </div>
                  )}
                  {/* 佐證連結:已掛送審文件的義務,稽核可一路點到原始送審紀錄 */}
                  {it.ob.evidence_submittal_id && (() => {
                    const ev = submittals.find((s) => s.id === it.ob.evidence_submittal_id)
                    return (
                      <Link to="/submittals" className="mt-1.5 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[var(--blue-tint)] text-[var(--blue-text)] hover:underline">
                        <MSym name="description" size={11} />
                        佐證:{ev ? `${ev.submittal_no} ${ev.title}（${ev.status}）` : '送審文件（已不存在或無權檢視）'}
                      </Link>
                    )
                  })()}
                  <div className="text-xs text-[var(--text-3)] mt-1">
                    {ruleText(it.ob)}{it.due ? `　·　到期 ${iso(it.due)}` : ''}
                    {it.ob.responsible ? `　·　${it.ob.responsible}` : ''}
                  </div>
                  {!it.done && it.due && (
                    <div className={`text-xs font-medium mt-0.5 ${it.state === 'overdue' ? 'text-[var(--red-text)]' : it.state === 'soon' ? 'text-[var(--amber-text)]' : 'text-[var(--text-2)]'}`}>
                      {it.state === 'overdue' ? `已逾期 ${-it.diff} 天` : `還有 ${it.diff} 天`}
                    </div>
                  )}
                  {it.ob.penalty && (
                    <div className="text-xs text-[var(--amber-text)] bg-[var(--amber-tint)] rounded-md px-2 py-1 mt-2 inline-flex items-center gap-1"><MSym name="balance" size={12} /> {it.ob.penalty}</div>
                  )}
                  {/* 逾期罰款金額試算(確定性 regex 抽罰率;抽不出就不顯示——寧缺勿錯) */}
                  {it.state === 'overdue' && it.ob.penalty && (() => {
                    const est = estimatePenalty({ penaltyText: it.ob.penalty, overdueDays: -it.diff, contractTotal })
                    return est ? (
                      <div className="text-xs font-medium text-[var(--red-text)] bg-[var(--red-tint)] rounded-md px-2 py-1 mt-1.5 flex items-start gap-1.5">
                        <MSym name="balance" size={12} className="mt-0.5 shrink-0" />
                        <span>預估逾期違約金約 NT$ {est.amount.toLocaleString('en-US')}{est.capped ? '(已達上限)' : ''}
                          <span className="font-normal text-[var(--text-3)]"> · {est.basis} · 概算供參,實際依契約認定</span>
                        </span>
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--text-3)] bg-[var(--surface-2)] rounded-md px-2 py-1 mt-1.5 inline-flex items-center gap-1.5">
                        <MSym name="balance" size={12} className="shrink-0" />偵測到罰則,但金額格式需人工確認試算
                      </div>
                    )
                  })()}
                  {(it.ob.source_clause || it.ob.source_page) && (
                    <div className="text-[11px] text-[var(--text-3)] mt-2 flex items-center gap-1"><MSym name="description" size={11} /> 契約 {it.ob.source_clause} {it.ob.source_page}</div>
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
