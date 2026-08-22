// W11 專案文件(文件管理員):整案文件的唯一上傳/歸檔窗口。
// 依 design_handoff_project_documents 版面重建:整頁只有兩張卡——
//   1.「契約文件」= 上傳入口(拖放區)+ 上傳過程的完整回饋(總進度、逐檔、成功、失敗、重試)
//   2.「專案文件」= 已入庫文件清單(文件/分類/版本/AI 處理/上傳)
// 上傳後 AI 自動分類、自動歸檔分流:標單 XML → 標單工項、契約/規範 → 契約重點。
// 基準日、契約總價與期限追蹤已搬到「審查與協作 › 契約重點」——本頁只管文件,
// 只有第一次建檔與文件更新時才會用到。
// 進度來自持久化的 document_processing_runs(離開頁面不遺失);逐檔百分比由
// STAGE_ORDER 映射(真實階段,不是假進度)。
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { supabase } from '../../lib/supabase.js'
import { friendlyError } from '../../lib/errorMessage.js'
import {
  Card, Empty, PageHeader, Badge, Select, buttonClass, SortableTh, TablePager,
  ErrorBanner, THEAD_CLS,
} from '../../components/ui.jsx'
// 契約包切換屬「視圖分段」:與工作面分頁/Admin tabs 共用同一套 chips 皮
import { CHIP_BASE, CHIP_ON, CHIP_OFF } from '../../components/PageTabs.jsx'
import { useTableSort, usePagination } from '../../lib/useTable.js'
import { parsePccesXml } from '../../lib/parsePcces.js'
import {
  PACKAGE_STATUS_LABELS, availablePackageOptions,
  packageDisplayName, defaultPackageTitle,
} from '../../lib/contractPackages.js'
import { ACCEPT_ATTR } from '../../lib/packageFileSupport.js'
import {
  DOCUMENT_TYPE_LABELS, CLASSIFIABLE_DOCUMENT_TYPES, EXTRACTABLE_DOCUMENT_TYPES,
  presentationGroup,
} from '../../lib/documentClassifier.js'
import {
  uploadFilesToPackage, summarizePackageProgress, packageStatusFromRuns,
  formatElapsed, staleProcessingPatch, takeSelectedFiles, STAGE_ORDER, STAGE_LABELS,
} from '../../lib/packageUpload.js'
import { runRequirementExtraction, extractionSuccessMessage } from '../../lib/extractRequirements.js'

// 文件清單表格欄樣式:表頭字型層吃 ui.jsx 的 THEAD_CLS(全站單一真相)
const DOC_TH = `text-left ${THEAD_CLS} py-2.5 px-3 whitespace-nowrap`
const DOC_THR = `text-right ${THEAD_CLS} py-2.5 px-3 whitespace-nowrap`
const DOC_TD = 'py-2.5 px-3 text-[13px] align-top'

const TERMINAL_STATUSES = ['completed', 'partial', 'failed', 'unsupported']
const isTerminal = (r) => TERMINAL_STATUSES.includes(r.status)
// 逐檔進度 %:持久化 run 的真實階段 → 0/20/40/60/80/100(不是假進度)
const runPct = (r) => {
  if (r.status === 'completed') return 100
  const order = STAGE_ORDER[r.stage] ?? 0
  return Math.min(100, Math.round((order / 5) * 100))
}
// 處理中細節列:抽取階段有批次進度就顯示「第 N/M 批」(W13 大文件分段續跑)
const stageDetail = (r) => (
  r.stage === 'extracting_requirements' && r.metadata?.extraction_progress
    ? `正在分析契約重點(第 ${r.metadata.extraction_progress} 批)`
    : (STAGE_LABELS[r.stage] || r.stage)
)

// AI 處理欄的固定四狀態(mockup):已完成/處理中/待處理/無需處理。
// 色票只寫狀態,數字與原因寫在下方細節行。
function aiProcessingState(run) {
  if (!isTerminal(run)) {
    return { kind: 'processing', label: '處理中', color: 'blue', detail: stageDetail(run) }
  }
  if (run.status === 'unsupported') {
    return { kind: 'na', label: '無需處理', color: 'slate', detail: run.metadata?.limitation || '尚未支援內容分析' }
  }
  if (run.classification_status === 'needs_review') {
    return { kind: 'attention', label: '待處理', color: 'red', detail: `AI 建議分類:${DOCUMENT_TYPE_LABELS[run.suggested_document_type] || '無法判斷'},請人工確認` }
  }
  if (run.status === 'failed' || run.status === 'partial') {
    return { kind: 'attention', label: '待處理', color: 'red', detail: friendlyError(run.error_message, '處理未完成') }
  }
  return { kind: 'done', label: '已完成', color: 'green', detail: run.metadata?.requirement_extraction_message || '已分類歸檔' }
}

export default function Contract() {
  const {
    isSupabaseConfigured, currentProject, isPersistedProject,
    currentProjectMembership, currentUser, can, isPlatformAdmin,
    importWorkItems, workItemsSource, reloadMembership,
  } = useStore()
  const [parties, setParties] = useState([])
  const [packages, setPackages] = useState([])
  const [selectedPackageId, setSelectedPackageId] = useState(null)
  const [runs, setRuns] = useState([])            // processing runs of the selected package
  const [docsById, setDocsById] = useState(new Map())
  const [versionsById, setVersionsById] = useState(new Map())
  const [aiCount, setAiCount] = useState(null)    // AI 契約重點建議數(本契約包)
  const [uploading, setUploading] = useState(false)
  // 標單 XML 走另一條路(不建 processing run),自己記忙碌旗標與結果語氣
  const [boqBusy, setBoqBusy] = useState(false)
  const [boqMsg, setBoqMsg] = useState(null)   // { tone: 'ok' | 'skip' | 'error', text }
  const [msg, setMsg] = useState('')
  const [dragOver, setDragOver] = useState(false)
  // 上傳回饋面板:只列「本批上傳的檔案+仍在處理中的檔案」;關閉(close/略過)
  // 回到 idle 拖放區,歷史結果一律看下方文件清單。以 document_version_id 記批,
  // run 列會被 reload 換新物件,version id 才是穩定身分。
  const [batchVersionIds, setBatchVersionIds] = useState(() => new Set())
  // 本批選了幾個檔:總數在「選檔當下」定錨。列是開工才建的(並發=2),
  // 沒有錨的話面板總數會 2→4→6 遞增、進度母數跟著漂(使用者實測指正)。
  // ref 是真相(closure 不吃 stale state),state 只為觸發 render。
  const batchTotalRef = useRef(0)
  const [batchTotal, setBatchTotal] = useState(0)
  // 防連點:分析已在進行的 run id——W13 殭屍事故的直接肇因就是重試連點,
  // 兩個請求 17ms 內同穿併發防呆、之後的 409 又把活解析蓋成失敗。
  // ref 是真正的鎖(同步 check-and-set,await 之前生效);state 只給按鈕
  // disabled 用——React state 守衛在重新 render 前讀到的是舊 Set,擋不住連點
  const busyRunsRef = useRef(new Set())
  const [busyRunIds, setBusyRunIds] = useState(() => new Set())
  // W14 事後治理:哪一列正開著「改分類」的下拉(一次只開一列)
  const [reclassifyId, setReclassifyId] = useState(null)
  const [panelDismissed, setPanelDismissed] = useState(false)
  const [, forceTick] = useState(0)
  const tickRef = useRef(null)

  const pid = currentProject?.project_id
  // 前端閘鏡像伺服器端 can_write(成員且非機關;admin 例外走 can.edit)——
  // 監造上傳契約正是事務所場景的主流程(W10)
  const canWriteContract = can.edit || currentUser?.org_type === 'supervisor'
  const canUploadDocs = isPersistedProject && canWriteContract

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

  // 回到頁面時把「仍在處理中」的 run 釘進本批:終結後仍留在面板裡,
  // 結束摘要才出得來(否則列一條條消失,永遠看不到摘要)
  useEffect(() => {
    setBatchVersionIds((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const r of runs) {
        if (!isTerminal(r) && !next.has(r.document_version_id)) { next.add(r.document_version_id); changed = true }
      }
      return changed ? next : prev
    })
  }, [runs])

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
    const active = runs.filter((r) => !isTerminal(r))
    if (!active.length) return null
    const earliest = Math.min(...active.map((r) => new Date(r.started_at).getTime()))
    return formatElapsed(Date.now() - earliest)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, progress.active, Date.now()])

  // 身分快照只選「我代表哪個契約方」;能否上傳仍由 can_write 鏡像決定
  const packageOptions = useMemo(
    () => availablePackageOptions({ membership: currentProjectMembership, parties }),
    [currentProjectMembership, parties],
  )
  const partiesById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties])
  const myPartyId = currentProjectMembership?.project_party_id || null

  // 「＋新契約包」只給真的能上傳的人:機關按了必被 RLS 擋,不渲染假入口
  const creatableOptions = !canUploadDocs ? [] : packageOptions.filter((o) => !packages.some(
    (p) => p.package_type === o.package_type
      && p.counterparty_project_party_id === o.counterparty_project_party_id,
  ))

  // 自動補齊專案身分:受邀成員/舊專案缺 parties 或 membership 時,開頁即修
  const identityFixTried = useRef(false)
  useEffect(() => {
    if (!isPersistedProject || !pid || !canUploadDocs) return
    if (packageOptions.length > 0 || identityFixTried.current) return
    identityFixTried.current = true
    ;(async () => {
      const { error } = await supabase.rpc('ensure_project_identity', { p: pid })
      if (error) { setMsg(friendlyError(error, '初始化專案身分失敗')); return }
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
    if (error) throw new Error(friendlyError(error, '建立契約包失敗'))
    setPackages((ps) => [...ps, data])
    return data
  }, [packages, parties, pid, currentUser])

  // ── 唯一上傳流程:多檔 → 自動分類 → 自動歸檔分流 ─────────────────────────
  const handleFiles = useCallback(async (fileList, targetPackage) => {
    let files = [...(fileList || [])].filter(Boolean)
    if (!files.length || !canUploadDocs) return
    setBoqMsg(null)   // 上一批的結果不得跨批殘留
    setPanelDismissed(false)
    // 統一窗口:PCCES 標單 XML 直接路由到 BOQ 匯入,其餘進契約包管線
    const xmls = files.filter((f) => /\.xml$/i.test(f.name))
    files = files.filter((f) => !/\.xml$/i.test(f.name))
    // 同批多個 XML:第一份成功後,迴圈內的 workItemsSource 是過期閉包值,
    // 用本地旗標擋後續檔案
    let boqImported = workItemsSource === 'db'
    if (xmls.length) {
      setBoqBusy(true)
      try {
        for (const xf of xmls) {
          try {
            if (boqImported) { setBoqMsg((prev) => ({ tone: prev?.tone || 'skip', text: `${prev?.text ? prev.text + ' ' : ''}標單已匯入過,略過「${xf.name}」(如需重匯請至「標單工項」頁清空重匯)。` })); continue }
            const parsed = parsePccesXml(await xf.text())
            const { error, count } = await importWorkItems(parsed)
            if (!error) boqImported = true
            setBoqMsg(error
              ? { tone: 'error', text: friendlyError(error, '標單匯入失敗') }
              : { tone: 'ok', text: `標單已匯入 ${count} 項工項。` })
          } catch (e) { setBoqMsg({ tone: 'error', text: friendlyError(e, '標單 XML 解析失敗') }) }
        }
      } finally { setBoqBusy(false) }
    }
    if (!files.length) return
    // 面板總數定錨:同一個未關閉的面板連續加批就累加,關閉時歸零(dismissPanel)
    batchTotalRef.current += files.length
    setBatchTotal(batchTotalRef.current)
    let pkg = targetPackage
    try {
      if (!pkg) {
        if (!packageOptions.length) {
          // 訊息要誠實,三種情況分開講:
          // * 超級帳號(平台管理員)刻意不屬於任何契約方(使用者定義),
          //   契約文件要以專案角色帳號上傳——不是等幾秒就會好的事;
          // * 一般帳號掛在「other(未分類)」是資料問題,伺服器端
          //   ensure_project_identity 已含重掛修復,重新整理會再跑一次;
          // * 其餘才是真的初始化 race。
          setMsg(isPlatformAdmin && currentProjectMembership?.party_type === 'other'
            ? '超級帳號不屬於任何契約方,無法代表某一方上傳契約文件;請改用專案角色帳號(廠商/監造)上傳。'
            : currentProjectMembership?.party_type === 'other'
              ? '你的專案身分尚未分類,系統已嘗試自動修復——請重新整理頁面後再試;仍不行請聯絡平台管理員。'
              : '專案身分初始化中,請稍候幾秒再試一次。')
          return
        }
        pkg = await ensurePackage(packageOptions[0])
      }
      setUploading(true); setMsg('')
      setSelectedPackageId(pkg.id)
      await supabase.from('contract_packages').update({ status: 'processing' }).eq('id', pkg.id)
      const onRun = (run) => {
        setBatchVersionIds((ids) => new Set(ids).add(run.document_version_id))
        setRuns((rs) => {
          const i = rs.findIndex((r) => r.document_version_id === run.document_version_id)
          return i >= 0 ? rs.map((r, j) => (j === i ? run : r)) : [...rs, run]
        })
      }
      const { runs: batchRuns, failures } = await uploadFilesToPackage({
        files, packageRow: pkg, projectId: pid, userId: currentUser?.user_id || null, onRun,
      })
      const { data: freshRuns } = await supabase.from('document_processing_runs')
        .select('*').eq('contract_package_id', pkg.id).order('started_at')
      const nextStatus = packageStatusFromRuns(freshRuns || batchRuns)
      await supabase.from('contract_packages').update({ status: nextStatus }).eq('id', pkg.id)
      setPackages((ps) => ps.map((p) => (p.id === pkg.id ? { ...p, status: nextStatus } : p)))
      // 全部列出來(最多三件+總數):超限檔 throw 後不會留任何列,
      // 只報第一件會讓其餘失敗檔無聲消失(W14 審查)
      if (failures.length) {
        setMsg(`部分檔案未能開始處理:${failures.slice(0, 3).join(';')}${failures.length > 3 ? ` …共 ${failures.length} 件` : ''}`)
      }
      await reloadRuns(pkg.id)
    } catch (e) {
      setMsg(friendlyError(e, '上傳失敗'))
    } finally {
      setUploading(false)
    }
  }, [canUploadDocs, packageOptions, ensurePackage, pid, currentUser, currentProjectMembership,
    isPlatformAdmin, reloadRuns, importWorkItems, workItemsSource])

  // 修正/確認分類 → 視需要重新路由 AI 分析(也是「重試」的 handler)
  const confirmClassification = useCallback(async (run, newType) => {
    // 同步 check-and-set:旗標必須在第一個 await 之前掛上,否則兩下連點
    // 都讀到「沒在忙」同穿(W13 審查確認);釋放只由掛旗者在 finally 做
    if (busyRunsRef.current.has(run.id)) return
    busyRunsRef.current.add(run.id)
    setBusyRunIds(new Set(busyRunsRef.current))
    try {
      const version = versionsById.get(run.document_version_id)
      const docId = version?.document_id
      if (docId) {
        const { error } = await supabase.from('documents')
          .update({ document_type: newType }).eq('id', docId)
        if (error) { setMsg(friendlyError(error, '分類更新失敗')); return }
        setDocsById((m) => new Map(m).set(docId, { ...m.get(docId), document_type: newType }))
      }
      const patch = { classification_status: 'confirmed' }
      // 抽取前提:文件真的有逐頁文字。上傳失敗/掃描檔的 run 沒有 document_pages,
      // 打抽取必吃 422 還會把真正的失敗原因(檔案太大/掃描檔)蓋成錯誤診斷
      // (W14 審查);page_count>0=本批已落頁,requirement_extraction 有值=
      // 舊資料曾成功路由過(legacy 列 metadata 可能缺 page_count)。
      const hasPages = Number(run.metadata?.page_count || 0) > 0
        || run.metadata?.requirement_extraction != null
      const canExtract = EXTRACTABLE_DOCUMENT_TYPES.includes(newType)
        && run.parser_type && run.parser_type !== 'none' && hasPages
      let updated = null
      if (canExtract) {
        // started_at 一併重設:staleProcessingPatch 以它起算 20 分鐘過期,
        // 不重設的話「上傳很久之後才確認分類/重試」會被輪詢立刻誤判成中斷
        const restart = {
          ...patch, status: 'processing', stage: 'extracting_requirements',
          started_at: new Date().toISOString(), completed_at: null, error_message: null,
        }
        await supabase.from('document_processing_runs').update(restart).eq('id', run.id)
        setRuns((rs) => rs.map((r) => (r.id === run.id ? { ...r, ...restart } : r)))
        // W13:大文件伺服器端分段續跑,共用接力層負責 in_progress 接續;
        // 每段進度更新畫面並 best-effort 落庫(重新整理也看得到第 N/M 批)
        const result = await runRequirementExtraction({
          documentVersionId: run.document_version_id,
          projectId: pid,
          onProgress: (p) => {
            const progressMeta = {
              ...(run.metadata || {}),
              extraction_progress: `${p.batches_completed}/${p.batches_total}`,
              // 進度心跳:staleProcessingPatch 用它判定「還活著」,長文件多段
              // 續跑的總時長可以正當超過 20 分鐘
              extraction_progress_at: new Date().toISOString(),
            }
            setRuns((rs) => rs.map((r) => (r.id === run.id
              ? { ...r, metadata: { ...(r.metadata || {}), ...progressMeta } }
              : r)))
            supabase.from('document_processing_runs')
              .update({ metadata: progressMeta })
              .eq('id', run.id)
              .then(() => {}, () => {})
          },
        })
        if (!result.ok && result.inProgress) {
          // 已有別的解析在跑(409 run_conflict):不可蓋寫成失敗——W13 殭屍
          // 事故裡,連點的 409 一路把活著的解析蓋成失敗。顯示原話,交持有者收尾。
          // friendlyError 不會動伺服器的繁中原話,只擋 body 讀不到時的 generic 英文。
          setMsg(friendlyError(result.message, '此文件已有解析在進行中，請稍候'))
          await reloadRuns(run.contract_package_id)
          return
        }
        const failed = !result.ok
        const data = result.ok ? result.data : null
        const { data: final } = await supabase.from('document_processing_runs').update({
          ...patch,
          status: failed ? 'partial' : 'completed',
          stage: failed ? 'failed' : 'completed',
          completed_at: new Date().toISOString(),
          error_message: failed ? (result.message || 'AI 分析失敗') : null,
          metadata: {
            ...(run.metadata || {}),
            requirement_extraction: failed ? 'failed' : 'completed',
            // W10 揭露截斷:coverage_incomplete 時「找到 N 項」必須連著講清楚沒讀到哪裡
            requirement_extraction_message: failed
              ? result.message
              : extractionSuccessMessage(data),
            routed_document_type: newType,
          },
        }).eq('id', run.id).select().single()
        updated = final
      } else {
        // 改成非抽取類型時,舊的「找到 N 項契約重點」訊息不能留著騙人——
        // 資料(建議仍在審查佇列)與畫面要說同一件事(W14 審查)
        const staleExtraction = run.metadata?.requirement_extraction === 'completed'
        const { data: final } = await supabase.from('document_processing_runs')
          .update({
            ...patch,
            ...(staleExtraction ? {
              metadata: {
                ...(run.metadata || {}),
                requirement_extraction: 'skipped',
                requirement_extraction_message: '已改為非抽取類型;先前抽取的建議仍保留於審查佇列',
                routed_document_type: newType,
              },
            } : {}),
          }).eq('id', run.id).select().single()
        updated = final
      }
      if (updated) setRuns((rs) => rs.map((r) => (r.id === updated.id ? updated : r)))
      await reloadRuns(run.contract_package_id)
    } finally {
      busyRunsRef.current.delete(run.id)
      setBusyRunIds(new Set(busyRunsRef.current))
    }
  }, [versionsById, pid, reloadRuns])

  // W14 刪除文件:單一守門路徑 delete_document RPC(權限/佐證鏈護欄在伺服器端;
  // 已核定契約重點引用的文件會被 FK 擋下並回看得懂的訊息)。RPC 回傳 storage
  // 路徑,前端負責移除原始檔(storage 物件必須走 Storage API 刪)。
  const deleteDocument = useCallback(async (run, doc) => {
    if (!doc?.id || busyRunsRef.current.has(run.id)) return
    const title = doc.title || '這份文件'
    if (!window.confirm(`確定要刪除「${title}」?原始檔、所有版本與尚未核定的 AI 契約重點建議會一併移除;已核定契約重點引用的文件會被系統擋下。`)) return
    // 同步佔位:RPC+storage 清理要跑一兩秒,連點第二下會在第一刀 commit 後
    // 吃到「找不到文件」的誤導錯誤(W14 審查)
    busyRunsRef.current.add(run.id)
    setBusyRunIds(new Set(busyRunsRef.current))
    try {
      const { data: paths, error } = await supabase.rpc('delete_document', { p_document: doc.id })
      if (error) { setMsg(friendlyError(error, '文件刪除未完成')); return }
      if (paths?.length) {
        // 原始檔清理失敗不擋流程(讀不到的孤兒檔只佔空間),但要誠實留話
        const { error: storageError } = await supabase.storage.from('contract-documents').remove(paths)
        if (storageError) setMsg(`文件已刪除;原始檔清理未完成:${friendlyError(storageError, '請稍後重試')}`)
      }
      setBatchVersionIds((s) => { const n = new Set(s); n.delete(run.document_version_id); return n })
      await reloadRuns(run.contract_package_id)
    } finally {
      busyRunsRef.current.delete(run.id)
      setBusyRunIds(new Set(busyRunsRef.current))
    }
  }, [reloadRuns])

  // ── 上傳回饋面板(mockup 狀態 B/C/D)────────────────────────────────────
  // 面板列 = 本批上傳的 run + 任何仍在處理中的 run(回到頁面也看得到進行中)
  const panelRuns = useMemo(() => runs.filter(
    (r) => batchVersionIds.has(r.document_version_id) || !isTerminal(r),
  ), [runs, batchVersionIds])
  const panelBusy = uploading || boqBusy || panelRuns.some((r) => !isTerminal(r))
  const panelVisible = !panelDismissed && (panelBusy || panelRuns.length > 0)
  const panelFailed = panelRuns.filter((r) => r.status === 'failed' || r.status === 'partial')
  // 分類待確認 ≠ 完成:completed 但 needs_review 的檔案抽取被跳過,
  // 面板若報綠色「已抽取」就是說謊(審查 W11 發現)
  const panelNeeds = panelRuns.filter((r) => r.status === 'completed' && r.classification_status === 'needs_review')
  const panelOk = panelRuns.filter((r) =>
    (r.status === 'completed' && r.classification_status !== 'needs_review') || r.status === 'unsupported')
  // 「重試」只對 AI 分析失敗有效;上傳失敗/掃描檔重打 edge fn 必敗又蓋掉
  // 原始錯誤,正確復原是重新上傳同檔(checksum 相同會自動接續)
  const panelExtractionFailed = panelFailed.filter((r) => r.metadata?.requirement_extraction === 'failed')
  // 進度母數用「選檔總數」不用「已建列數」:列是開工才建的,母數會長大、
  // 進度會倒退;還沒開工的檔案以 0% 計入才是真實進度
  const panelTotal = Math.max(panelRuns.length, batchTotal)
  const overallPct = panelTotal
    ? Math.round(panelRuns.reduce((sum, r) => sum + runPct(r), 0) / panelTotal)
    : 0
  const panelState = panelBusy ? 'busy' : (panelFailed.length ? 'err' : panelNeeds.length ? 'warn' : 'ok')
  const PANEL_HEAD = {
    busy: {
      icon: 'cloud_upload', fill: false, cls: 'text-[var(--blue-text)]',
      // 標頭統一報「正在準備上傳」(使用者裁示);XML 匯入的細節由面板內
      // boqBusy 那一列顯示,不佔標頭
      title: panelTotal ? `正在整理 ${panelTotal} 個檔案` : '正在準備上傳…',
      // W13 起上傳與 AI 分析的接力由「這個瀏覽器分頁」驅動:可以切到系統其他
      // 功能頁做事(處理會繼續,回來看進度),但關閉/重新整理分頁會中斷
      // (已完成的部分保留,重試會接續)
      sub: panelTotal
        ? `已完成 ${panelOk.length + panelNeeds.length} / ${panelTotal}${elapsed ? ` · 已進行 ${elapsed}` : ''} · 可切到其他頁做事;請勿關閉或重新整理此分頁`
        : '此步驟請勿離開頁面',
      right: panelTotal ? `${overallPct}%` : '', bar: 'bg-[var(--blue)]',
    },
    ok: {
      icon: 'check_circle', fill: true, cls: 'text-[var(--green-text)]',
      title: `${panelOk.length} 個檔案處理完成`,
      sub: 'AI 已完成分類歸檔與契約重點抽取。',
      right: '完成', bar: 'bg-[var(--green-text)]',
    },
    warn: {
      icon: 'error', fill: true, cls: 'text-[var(--amber-text)]',
      title: `${panelOk.length + panelNeeds.length} 個檔案處理完成,${panelNeeds.length} 個分類待確認`,
      sub: 'AI 對部分文件的分類沒把握;請在下方清單確認分類,確認後會自動接續分析。',
      right: `${panelNeeds.length} 待確認`, bar: 'bg-[var(--amber-text)]',
    },
    err: {
      icon: 'error', fill: true, cls: 'text-[var(--red-text)]',
      title: `${panelRuns.length - panelFailed.length} 個檔案處理完成,${panelFailed.length} 個待處理`,
      sub: '待處理的檔案不影響已完成的部分。',
      right: `${panelRuns.length - panelFailed.length}/${panelRuns.length}`, bar: 'bg-[var(--red-text)]',
    },
  }[panelState]
  const dismissPanel = () => {
    setPanelDismissed(true)
    setBatchVersionIds(new Set())
    batchTotalRef.current = 0
    setBatchTotal(0)
  }
  const retryRun = (run) => {
    const version = versionsById.get(run.document_version_id)
    const doc = version ? docsById.get(version.document_id) : null
    return confirmClassification(run, doc?.document_type || run.suggested_document_type || 'other')
  }

  // ── 文件清單(卡 2)─────────────────────────────────────────────────────
  const docTableRows = useMemo(() => runs.map((run) => {
    const version = versionsById.get(run.document_version_id)
    const doc = version ? docsById.get(version.document_id) : null
    return {
      run,
      doc,
      version,
      title: doc?.title || '文件',
      group: presentationGroup(doc?.document_type || run.suggested_document_type || 'other',
        run.metadata?.classification_reason),
      uploaded: run.started_at || '',
    }
  }), [runs, versionsById, docsById])
  const { sort: docSort, toggleSort: toggleDocSort, sorted: sortedDocRows, sortKey: docSortKey } = useTableSort(docTableRows)
  // resetKey 只給排序:這張表在 AI 分析期間每 5 秒重載一次 runs,
  // 若讓重載本身重設頁碼,使用者翻到第 2 頁就會一直被彈回第 1 頁
  const { pageRows: docPageRows, pager: docPager } = usePagination(sortedDocRows, 25, docSortKey)
  const [showTech, setShowTech] = useState(false)

  if (isSupabaseConfigured && !currentProject) {
    return (
      <div className="space-y-5">
        <PageHeader title="專案文件" tagline="一次上傳,自動整理" subtitle="把整包契約文件丟進來,AI 自動分類歸檔:標單進「標單工項」、契約重點送「審查與協作」;要看結果就到對應功能頁" />
        <Card><Empty>請先登入並建立/選擇專案,才能整理契約文件。</Empty></Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader title="專案文件" tagline="一次上傳,自動整理" subtitle="把整包契約文件丟進來,AI 自動分類歸檔:標單進「標單工項」、契約重點送「審查與協作」;要看結果就到對應功能頁" />

      {/* ── 卡 1:契約文件(上傳入口+上傳回饋)──────────────────────────── */}
      <Card title="契約文件" action={
        <div className="flex items-center gap-2">
          {(packages.length > 1 || creatableOptions.length > 0) && (
            <Select value={selectedPackageId || ''} className="w-48" disabled={uploading}
              onChange={async (e) => {
                const value = e.target.value
                if (value.startsWith('new:')) {
                  const option = creatableOptions[Number(value.slice(4))]
                  if (option) {
                    try { const pkg = await ensurePackage(option); setSelectedPackageId(pkg.id) }
                    catch (err) { setMsg(friendlyError(err, '建立契約包失敗')) }
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
          <label className={`${buttonClass('primary', 'md')} ${uploading || boqBusy || !canUploadDocs ? 'opacity-50' : 'cursor-pointer'}`}>
            <input type="file" multiple accept={ACCEPT_ATTR}
              disabled={uploading || boqBusy || !canUploadDocs}
              onChange={(e) => handleFiles(takeSelectedFiles(e.target), selectedPackage)}
              className="hidden" />
            <MSym name="cloud_upload" size={15} /> 上傳契約文件
          </label>
        </div>
      }>
        {/* 契約包切換(多包才顯示):單選 chips + 選取包詳情列 */}
        {packages.length > 1 && (
          <div className="mb-4">
            <div className="flex flex-wrap gap-2">
              {packages.map((p) => {
                const name = packageDisplayName(p, { partiesById, myPartyId })
                const active = p.id === selectedPackageId
                return (
                  <button key={p.id} onClick={() => setSelectedPackageId(p.id)} aria-pressed={active}
                    disabled={uploading}
                    className={`${CHIP_BASE} ${active ? CHIP_ON : CHIP_OFF} ${uploading ? 'opacity-50' : ''}`}>
                    {name.title}
                  </button>
                )
              })}
            </div>
            {selectedPackage && (() => {
              const name = packageDisplayName(selectedPackage, { partiesById, myPartyId })
              return (
                <div className="text-xs text-[var(--text-3)] mt-1.5">
                  {name.subtitle ? `${name.subtitle}·` : ''}{PACKAGE_STATUS_LABELS[selectedPackage.status] || selectedPackage.status}
                </div>
              )
            })()}
          </div>
        )}

        {!panelVisible ? (
          /* 狀態 A:idle 拖放區 */
          <div
            onDragOver={(e) => { e.preventDefault(); if (canUploadDocs) setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (canUploadDocs) handleFiles(e.dataTransfer?.files, selectedPackage) }}
            className={`border border-dashed rounded-xl px-5 py-5 flex items-start gap-3.5 transition-colors ${dragOver ? 'border-[var(--primary)] bg-[var(--blue-tint)]' : 'border-[var(--border-3,var(--border))] bg-[var(--surface-2)]'}`}
          >
            <MSym name="cloud_upload" size={26} className="text-[var(--text-3)] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm text-[var(--text)] leading-relaxed">
                把整包契約文件直接拖進來,或點右上「上傳契約文件」。可一次選擇多個檔案
                (PDF / Word / TXT / Excel / 圖片…),系統會自動分類、歸檔並找出契約重點。
              </p>
              <p className="text-xs text-[var(--text-3)] mt-1.5">
                標單請丟 PCCES XML(自動匯入標單工項);契約/規範/品質計畫會自動抽取契約重點送審查。
              </p>
              {!isPersistedProject && <p className="text-xs text-[var(--amber-text)] mt-1.5">Demo 模式不支援,請登入並選擇真實專案。</p>}
              {isPersistedProject && !canWriteContract && <p className="text-xs text-[var(--text-3)] mt-1.5">需編輯權限(施工廠商、監造或專案管理者)。</p>}
            </div>
          </div>
        ) : (
          /* 狀態 B:上傳中/上傳結束的進度面板(逐檔列+總進度) */
          <div className="border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-3.5 py-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <MSym name={PANEL_HEAD.icon} size={20} fill={PANEL_HEAD.fill} className={`shrink-0 ${PANEL_HEAD.cls}`} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--text)]">{PANEL_HEAD.title}</div>
                  <div className="text-xs text-[var(--text-3)] mt-0.5" aria-live="polite">{PANEL_HEAD.sub}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={`text-[12.5px] font-medium num ${PANEL_HEAD.cls}`}>{PANEL_HEAD.right}</span>
                {/* 關閉鈕永遠可按:中斷遺留的 processing run 會讓 busy 掛到
                    20 分鐘 stale 門檻,不能鎖住整個拖放區(審查 W11 發現) */}
                <button onClick={dismissPanel} aria-label="關閉上傳結果"
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-3)] hover:bg-[var(--surface-2)]">
                  <MSym name="close" size={18} />
                </button>
              </div>
            </div>
            {/* 總進度條(各檔真實階段的平均;結束時一律 100%) */}
            <div className="h-1 bg-[var(--border-2)]" role="progressbar" aria-valuenow={panelBusy ? overallPct : 100} aria-valuemin={0} aria-valuemax={100}>
              <div className={`h-1 transition-[width] duration-300 ${PANEL_HEAD.bar}`}
                style={{ width: `${panelBusy ? overallPct : 100}%` }} />
            </div>
            {/* 逐檔列 */}
            {boqBusy && (
              <div className="flex items-center gap-3 px-3.5 py-2.5 border-t border-[var(--border-2)] text-xs text-[var(--text-2)]">
                <MSym name="progress_activity" size={19} className="msym-spin text-[var(--blue-text)] shrink-0" />
                正在解析標單 XML…(此步驟請勿離開頁面)
              </div>
            )}
            {panelRuns.map((r) => {
              const version = versionsById.get(r.document_version_id)
              const doc = version ? docsById.get(version.document_id) : null
              const name = doc?.title || r.metadata?.filename_kind || '文件'
              const busy = !isTerminal(r)
              const failed = r.status === 'failed' || r.status === 'partial'
              const needsReview = !busy && !failed && r.classification_status === 'needs_review'
              // 只有 AI 分析失敗才可原地重試;上傳失敗/掃描檔要重新上傳同檔
              const retryable = failed && r.metadata?.requirement_extraction === 'failed'
              const failMeta = failed
                ? `${friendlyError(r.error_message, '處理未完成')}${!retryable && !(r.error_message || '').includes('重新上傳') ? ';請重新上傳同一份檔案(內容相同會自動接續)' : ''}`
                : null
              return (
                <div key={r.id} className="grid grid-cols-[22px_1fr_128px] items-center gap-3 px-3.5 py-2.5 border-t border-[var(--border-2)]">
                  <MSym
                    name={busy ? 'draft' : failed || needsReview ? 'error' : 'check_circle'}
                    size={19} fill={!busy}
                    className={busy ? 'text-[var(--blue-text)]' : failed ? 'text-[var(--red-text)]' : needsReview ? 'text-[var(--amber-text)]' : 'text-[var(--green-text)]'} />
                  <div className="min-w-0">
                    <div className="text-[12.5px] text-[var(--text)] truncate" title={name}>{name}</div>
                    <div className={`text-[11px] mt-0.5 ${failed ? 'text-[var(--red-text)]' : needsReview ? 'text-[var(--amber-text)]' : 'text-[var(--text-3)]'}`}>
                      {busy ? stageDetail(r)
                        : failed ? failMeta
                          : needsReview ? `AI 建議分類:${DOCUMENT_TYPE_LABELS[r.suggested_document_type] || '無法判斷'};請到下方清單確認,確認後自動接續分析`
                            : (r.metadata?.requirement_extraction_message || RUN_META_OK(r))}
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    {busy ? (<>
                      <div className="w-[66px] h-1 rounded-full bg-[var(--border-2)] overflow-hidden">
                        <div className="h-1 rounded-full bg-[var(--blue)] transition-[width] duration-300" style={{ width: `${runPct(r)}%` }} />
                      </div>
                      <span className="text-[11.5px] text-[var(--text-3)] num min-w-[34px] text-right">{runPct(r)}%</span>
                    </>) : failed ? (
                      retryable && canWriteContract ? (
                        <button onClick={() => retryRun(r)} disabled={busyRunIds.has(r.id)}
                          className={buttonClass('outline', 'sm')}>重試</button>
                      ) : <span className="text-[11.5px] font-medium text-[var(--red-text)]">待處理</span>
                    ) : needsReview ? (
                      <span className="text-[11.5px] font-medium text-[var(--amber-text)]">待確認</span>
                    ) : (
                      <span className="text-[11.5px] font-medium text-[var(--green-text)]">已完成</span>
                    )}
                  </div>
                </div>
              )
            })}
            {/* 狀態 C/D:結束摘要 */}
            {!panelBusy && panelState === 'ok' && (
              <div className="m-3.5 rounded-xl bg-[var(--green-tint)] px-3.5 py-3 flex items-start gap-2.5">
                <MSym name="check_circle" size={19} fill className="text-[var(--green-text)] shrink-0 mt-0.5" />
                <div className="text-[12.5px] text-[var(--green-text)] leading-relaxed">
                  {panelOk.length} 個檔案處理完成,已自動分類歸檔。
                  {aiCount != null && aiCount > 0 && ` AI 從本契約累計找到 ${aiCount} 項契約重點建議(含先前批次)。`}
                  <br />
                  <Link to="/requirements" className="font-medium hover:underline inline-flex items-center gap-0.5">前往契約重點核定 <MSym name="arrow_forward" size={12} /></Link>
                  {workItemsSource === 'db' && (<>
                    {' '}·{' '}
                    <Link to="/boq" className="font-medium hover:underline inline-flex items-center gap-0.5">查看標單工項 <MSym name="arrow_forward" size={12} /></Link>
                  </>)}
                </div>
              </div>
            )}
            {!panelBusy && panelState === 'err' && (
              <div className="m-3.5 rounded-xl bg-[var(--red-tint)] px-3.5 py-3">
                <div className="flex items-start gap-2.5">
                  <MSym name="error" size={19} fill className="text-[var(--red-text)] shrink-0 mt-0.5" />
                  <div className="text-[12.5px] text-[var(--red-text)] leading-relaxed">
                    {panelFailed.length} 個檔案待處理:{panelFailed[0] && (docsById.get(versionsById.get(panelFailed[0].document_version_id)?.document_id)?.title || '文件')}
                    {panelFailed[0]?.error_message ? `——${friendlyError(panelFailed[0].error_message, '處理未完成')}` : ''}
                    {/* 與標頭同一套帳:處理完成=非失敗(含分類待確認),兩處數字不得打架 */}
                    。其餘 {panelRuns.length - panelFailed.length} 個檔案處理完成,不需重傳。
                  </div>
                </div>
                {panelFailed.length > panelExtractionFailed.length && (
                  <div className="text-[11.5px] text-[var(--red-text)] mt-1.5 pl-[29.5px]">
                    上傳失敗或無法讀取的檔案:內容相同重新上傳會自動接續;超過大小上限的請壓縮或拆分後再上傳。
                  </div>
                )}
                <div className="flex gap-2 mt-2.5 pl-[29.5px]">
                  {canWriteContract && panelExtractionFailed.length > 0 && (
                    <button className={buttonClass('primary', 'sm')}
                      disabled={panelExtractionFailed.every((r) => busyRunIds.has(r.id))}
                      onClick={() => panelExtractionFailed.forEach((r) => retryRun(r))}>重試 AI 分析失敗的檔案</button>
                  )}
                  <button className={buttonClass('outline', 'sm')} onClick={dismissPanel}>略過並繼續</button>
                </div>
              </div>
            )}
          </div>
        )}
        <ErrorBanner msg={msg} className="mt-3" />
        {/* 標單匯入結果:單一出口,面板開著也看得到(成功/略過/失敗都不可被面板吞掉) */}
        {boqMsg && (boqMsg.tone === 'error'
          ? <ErrorBanner msg={boqMsg.text} className="mt-2" />
          : (
            <p className="text-xs mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[var(--text-2)]">
              <MSym name={boqMsg.tone === 'ok' ? 'check_circle' : 'info'} size={14}
                className={`shrink-0 ${boqMsg.tone === 'ok' ? 'text-[var(--green-text)]' : 'text-[var(--text-3)]'}`} />
              {boqMsg.text}
              {boqMsg.tone === 'ok' && <Link to="/boq" className="text-[var(--blue-text)] hover:underline inline-flex items-center gap-0.5">前往標單工項 <MSym name="arrow_forward" size={12} /></Link>}
            </p>
          ))}
      </Card>

      {/* ── 卡 2:專案文件(已入庫清單)────────────────────────────────────── */}
      <Card title="專案文件" action={
        <span className="text-[11px] text-[var(--text-3)] num">{docTableRows.length} 件</span>
      }>
        {docTableRows.length === 0 ? (
          <Empty>這個專案還沒有文件。上傳後會自動分類歸檔,並在這裡列出處理狀態。</Empty>
        ) : (<>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <SortableTh className={DOC_TH} label="文件" field="title" sort={docSort} onSort={toggleDocSort} />
                  <th className={DOC_TH}>分類</th>
                  <th className={DOC_TH}>版本</th>
                  <th className={DOC_TH}>AI 處理</th>
                  <SortableTh className={DOC_THR} align="right" label="上傳" field="uploaded" sort={docSort} onSort={toggleDocSort} />
                </tr>
              </thead>
              <tbody>
                {docPageRows.map(({ run, doc, version, title, group, uploaded }) => {
                  const state = aiProcessingState(run)
                  const needsClassify = state.kind === 'attention' && run.classification_status === 'needs_review'
                  // 只有 AI 分析失敗才可原地重試;上傳失敗/掃描檔要重新上傳同檔
                  const retryable = state.kind === 'attention' && !needsClassify
                    && run.metadata?.requirement_extraction === 'failed'
                  const reuploadHint = state.kind === 'attention' && !needsClassify && !retryable
                    && !(state.detail || '').includes('重新上傳')
                  return (
                    <tr key={run.id} className="border-b border-[var(--border-2)] last:border-0 hover:bg-[var(--surface-2)]">
                      <td className={`${DOC_TD} max-w-[300px]`}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <MSym name="description" size={12} className="text-[var(--text-3)] shrink-0" />
                          <span className="truncate text-[var(--text)]" title={title}>{title}</span>
                        </div>
                      </td>
                      <td className={`${DOC_TD} whitespace-nowrap text-[var(--text-2)]`}>{group}</td>
                      <td className={`${DOC_TD} whitespace-nowrap num text-[var(--text-2)]`}>{version?.version_label || '—'}</td>
                      <td className={DOC_TD}>
                        <Badge color={state.color}>{state.label}</Badge>
                        <div className="text-[11px] text-[var(--text-3)] mt-1 max-w-[300px]">
                          <span className="line-clamp-2 whitespace-pre-line" title={state.detail}>{state.detail}</span>
                          {/* 待處理的兩種人工動作:確認分類/重試分析 */}
                          {needsClassify && canWriteContract && (
                            <span className="flex items-center gap-1.5 mt-1">
                              <Select defaultValue={run.suggested_document_type || 'other'} className="w-36"
                                onChange={(e) => confirmClassification(run, e.target.value)}>
                                {CLASSIFIABLE_DOCUMENT_TYPES.map((t) => (
                                  <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
                                ))}
                              </Select>
                              <button onClick={() => confirmClassification(run, run.suggested_document_type || 'other')}
                                className="text-[var(--blue-text)] hover:underline whitespace-nowrap inline-flex items-center max-md:min-h-11 px-1">確認此分類</button>
                            </span>
                          )}
                          {retryable && canWriteContract && (
                            <button onClick={() => retryRun(run)} disabled={busyRunIds.has(run.id)}
                              className="text-[var(--blue-text)] hover:underline inline-flex items-center gap-0.5 max-md:min-h-11 px-1 mt-0.5 disabled:opacity-50 disabled:no-underline">
                              <MSym name="refresh" size={11} /> 重試分析
                            </button>
                          )}
                          {reuploadHint && (
                            <span className="block mt-0.5">請重新上傳同一份檔案(內容相同會自動接續處理)</span>
                          )}
                          {/* W14 事後治理:終態文件可改分類/刪除(權限=文件管理)。
                              改分類只給「曾分類過」的列——上傳失敗的列連頁都沒有,
                              分類不是它的問題;刪除則全終態可用,含分類待確認列
                              (待確認的垃圾檔正是最想刪的)。 */}
                          {canWriteContract && state.kind !== 'processing' && (
                            reclassifyId === run.id ? (
                              <span className="flex items-center gap-1.5 mt-1">
                                <Select defaultValue={doc?.document_type || run.suggested_document_type || 'other'} className="w-36"
                                  onChange={(e) => {
                                    const nextType = e.target.value
                                    setReclassifyId(null)
                                    // 改成可抽取類型會重跑一次 AI 抽取(新的一批待核建議),
                                    // 先講清楚再動手;已核定項目不受影響
                                    if (EXTRACTABLE_DOCUMENT_TYPES.includes(nextType)
                                      && !window.confirm(`改為「${DOCUMENT_TYPE_LABELS[nextType]}」會重新執行 AI 抽取,產生一批新的待核建議(已核定項目不受影響)。繼續?`)) return
                                    confirmClassification(run, nextType)
                                  }}>
                                  {CLASSIFIABLE_DOCUMENT_TYPES.map((t) => (
                                    <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
                                  ))}
                                </Select>
                                <button onClick={() => setReclassifyId(null)}
                                  className="text-[var(--text-3)] hover:underline px-1 max-md:min-h-11">取消</button>
                              </span>
                            ) : (
                              <span className="flex items-center gap-2 mt-0.5">
                                {!needsClassify && run.suggested_document_type != null && (
                                  <button onClick={() => setReclassifyId(run.id)} disabled={busyRunIds.has(run.id)}
                                    className="text-[var(--blue-text)] hover:underline inline-flex items-center gap-0.5 max-md:min-h-11 px-1 disabled:opacity-50">
                                    <MSym name="edit" size={11} /> 改分類
                                  </button>
                                )}
                                <button onClick={() => deleteDocument(run, doc)} disabled={busyRunIds.has(run.id)}
                                  className="text-[var(--red-text)] hover:underline inline-flex items-center gap-0.5 max-md:min-h-11 px-1 disabled:opacity-50">
                                  <MSym name="delete" size={11} /> 刪除
                                </button>
                              </span>
                            )
                          )}
                        </div>
                      </td>
                      <td className={`${DOC_TD} text-right num whitespace-nowrap text-[var(--text-2)]`}>
                        {uploaded ? String(uploaded).slice(0, 10) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <TablePager {...docPager} className="!px-0" />
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--border-2)]">
            <p className="text-[11.5px] text-[var(--text-3)]">上傳後自動分類歸檔:標單匯入「標單工項」、契約/規範抽取「契約重點」並記錄擷取來源頁碼。</p>
            <button onClick={() => setShowTech((s) => !s)} aria-expanded={showTech}
              className="text-[11.5px] text-[var(--blue-text)] hover:underline inline-flex items-center gap-1 shrink-0 max-md:min-h-11 px-1">
              <MSym name="chevron_right" size={12} className={`transition-transform duration-[var(--dur-fast)] ${showTech ? 'rotate-90' : ''}`} /> 技術資訊
            </button>
          </div>
          {showTech && (
            <div className="mt-2 text-[11px] text-[var(--text-3)] space-y-0.5">
              {runs.map((r) => (
                <div key={r.id}>
                  {versionsById.get(r.document_version_id) ? docsById.get(versionsById.get(r.document_version_id).document_id)?.title : r.document_version_id}
                  ·status {r.status}·stage {r.stage}·parser {r.parser_type || '-'}
                  ·信心 {r.classification_confidence != null ? Math.round(r.classification_confidence * 100) + '%' : '-'}
                  {r.error_message ? `·${friendlyError(r.error_message, '處理未完成')}` : ''}
                </div>
              ))}
            </div>
          )}
        </>)}
      </Card>
    </div>
  )
}

// 成功列的 meta fallback(unsupported 也算落地:檔案已保存只是不分析)
function RUN_META_OK(r) {
  return r.status === 'unsupported'
    ? (r.metadata?.limitation || '已保存;此格式尚未支援內容分析')
    : '已分類歸檔'
}
