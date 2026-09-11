// W11 專案文件(文件管理員):整案文件的唯一上傳/歸檔窗口。
// 依 design_handoff_project_documents 版面重建:整頁只有兩張卡——
//   1.「契約文件」= 上傳入口(拖放區)+ 上傳過程的完整回饋(總進度、逐檔、成功、失敗、重試)
//      → 回饋面板在 components/UploadPanel.jsx,帳目在 lib/packageUpload.js summarizeUploadBatch
//   2.「專案文件」= 已入庫文件清單(文件/分類/版本/AI 處理/上傳)→ components/DocumentTable.jsx
// 上傳後 AI 自動分類、自動歸檔分流:標單 XML → 標單工項、契約/規範 → 契約重點。
// 基準日、契約總價與期限追蹤在獨立的「期限追蹤」頁(/deadlines)——本頁只管文件,
// 只有第一次建檔與文件更新時才會用到。
// 進度來自持久化的 document_processing_runs(離開頁面不遺失;讀取/中斷復原/改分類
// 狀態機在 lib/packageRuns.js);逐檔百分比由 STAGE_ORDER 映射(真實階段,不是假進度)。
// 這支只剩:載入與範圍守衛(切案/切包時舊回應不覆蓋新畫面)、上傳分流、三個動 DB
// 的事件處理器(確認分類/重試、刪除、開檔)與版面組裝。
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ContractFlow from '../../components/ContractFlow.jsx'
import UploadPanel from '../../components/UploadPanel.jsx'
import DocumentTable from '../../components/DocumentTable.jsx'
import { pageAllSafe } from '../../lib/pagedQuery.js'
import { MSym } from '../../components/icons.jsx'
import { useStore } from '../../store.jsx'
import { supabase } from '../../lib/supabase.js'
import { friendlyError } from '../../lib/errorMessage.js'
import { Card, Empty, PageHeader, Select, buttonClass, ErrorBanner } from '../../components/ui.jsx'
import { appConfirm } from '../../components/confirm.jsx'
// 契約包切換屬「視圖分段」:與工作面分頁/Admin tabs 共用同一套 chips 皮
import { CHIP_BASE, CHIP_ON, CHIP_OFF } from '../../components/PageTabs.jsx'
import { parsePccesXml } from '../../lib/parsePcces.js'
import {
  PACKAGE_STATUS_LABELS, availablePackageOptions,
  packageDisplayName, defaultPackageTitle,
} from '../../lib/contractPackages.js'
import { ACCEPT_ATTR } from '../../lib/packageFileSupport.js'
import {
  uploadFilesToPackage, summarizePackageProgress, summarizeUploadBatch, packageStatusFromRuns,
  formatElapsed, takeSelectedFiles, isTerminalRun,
} from '../../lib/packageUpload.js'
import { loadPackageRuns, healStaleRuns, reclassifyProcessingRun, RUN_POLL_MS } from '../../lib/packageRuns.js'
import { openDocumentVersionFile, downloadDocumentVersionFile } from '../../lib/documentFileAccess.js'

// 統一窗口:PCCES 標單 XML 直接路由到 BOQ 匯入,其餘進契約包管線
const isPccesXml = (file) => /\.xml$/i.test(file.name)

// 「已處理 mm:ss」的重繪節拍。與 RUN_POLL_MS 是兩件事:那個打網路,這個只重算
// 本機時間差,所以可以快得多;秒數顯示到秒,再快也看不出差別。
const ELAPSED_TICK_MS = 1000

export default function Contract() {
  const {
    isSupabaseConfigured, currentProject, isPersistedProject,
    currentProjectMembership, currentUser, can, isPlatformAdmin,
    importWorkItems, workItemsSource, reloadMembership, reloadObligations,
  } = useStore()
  const [searchParams] = useSearchParams()
  const [packagesLoading, setPackagesLoading] = useState(true)
  const [packagesError, setPackagesError] = useState('')
  const [runsLoading, setRunsLoading] = useState(false)
  const [runsError, setRunsError] = useState('')
  const [loadedPackageId, setLoadedPackageId] = useState(null)
  const fileInputRef = useRef(null)
  const uploadLock = useRef(false)
  const [parties, setParties] = useState([])
  const [packages, setPackages] = useState([])
  const [selectedPackageId, setSelectedPackageId] = useState(searchParams.get('package'))
  const [storedRuns, setRuns] = useState([])            // processing runs of the selected package
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
  const [panelDismissed, setPanelDismissed] = useState(false)
  const [, forceTick] = useState(0)
  const tickRef = useRef(null)

  const pid = currentProject?.project_id
  const scopeRef = useRef(null)
  scopeRef.current = { pid, packageId: selectedPackageId }
  const runs = loadedPackageId === selectedPackageId ? storedRuns : []
  const runRequest = useRef(0)
  const packageRequest = useRef(0)
  // 前端閘鏡像伺服器端 can_write(規則的單一來源在 store.jsx 的 can.write)
  const canUploadDocs = isPersistedProject && can.write

  // 鎖與解鎖成對:同步 check-and-set,釋放只由掛旗者在 finally 做
  const lockRun = (runId) => {
    if (busyRunsRef.current.has(runId)) return false
    busyRunsRef.current.add(runId)
    setBusyRunIds(new Set(busyRunsRef.current))
    return true
  }
  const unlockRun = (runId) => {
    busyRunsRef.current.delete(runId)
    setBusyRunIds(new Set(busyRunsRef.current))
  }
  // 就地換列:run 狀態機的重啟/進度回呼只給部分欄位,metadata 要與畫面上的列合併
  const patchRun = useCallback((runId, fields) => setRuns((rs) => rs.map((r) => (r.id !== runId ? r : {
    ...r, ...fields,
    ...(fields.metadata ? { metadata: { ...(r.metadata || {}), ...fields.metadata } } : {}),
  }))), [])

  // ── 契約包與處理狀態載入(持久化,重新整理不遺失)────────────────────────
  const reloadPackages = useCallback(async () => {
    const request = ++packageRequest.current
    if (!isPersistedProject || !pid) { setPackagesLoading(false); return }
    setPackagesLoading(true); setPackagesError('')
    try {
      const [partyResult, packageResult] = await Promise.all([
        pageAllSafe((from, to) => supabase.from('project_parties').select('id, party_type, display_name')
          .eq('project_id', pid).order('id').range(from, to)),
        pageAllSafe((from, to) => supabase.from('contract_packages').select('*')
          .eq('project_id', pid).order('created_at').order('id').range(from, to)),
      ])
      if (partyResult.error) throw partyResult.error
      if (packageResult.error) throw packageResult.error
      if (request !== packageRequest.current || scopeRef.current.pid !== pid) return
      setParties(partyResult.data)
      setPackages(packageResult.data)
      setSelectedPackageId((prev) => packageResult.data.some((p) => p.id === prev)
        ? prev : (packageResult.data[0]?.id || null))
    } catch (error) {
      if (request === packageRequest.current && scopeRef.current.pid === pid) {
        setPackagesError(friendlyError(error, '契約清單載入失敗'))
      }
    } finally {
      if (request === packageRequest.current && scopeRef.current.pid === pid) setPackagesLoading(false)
    }
  }, [isPersistedProject, pid])
  useEffect(() => {
    setPackages([]); setParties([]); setSelectedPackageId(searchParams.get('package'))
    setRuns([]); setLoadedPackageId(null); setAiCount(null); setBatchVersionIds(new Set())
    setUploading(false); setMsg(''); identityFixTried.current = false
    reloadPackages()
    // URL 的契約選取另由下方 effect 處理；專案切換先清掉舊案結果。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadPackages])
  useEffect(() => {
    const wanted = searchParams.get('package')
    if (wanted && packages.some((p) => p.id === wanted)) setSelectedPackageId(wanted)
  }, [searchParams, packages])

  const selectedPackage = packages.find((p) => p.id === selectedPackageId) || null

  // 讀與寫分開(lib/packageRuns.js):loadPackageRuns 純讀;中斷復原的寫入只有
  // 能管理文件的人才做(讀者=機關唯讀不寫處理狀態),而且每筆寫入前再確認範圍沒變。
  const reloadRuns = useCallback(async (packageId) => {
    if (scopeRef.current.pid !== pid || scopeRef.current.packageId !== packageId) return
    const request = ++runRequest.current
    const current = () => request === runRequest.current && scopeRef.current.pid === pid
      && scopeRef.current.packageId === packageId
    if (!isPersistedProject || !packageId) { setRuns([]); setRunsLoading(false); return }
    setRunsLoading(true); setRunsError('')
    try {
      const { runs: loaded, docs, versions, aiCount: approved } = await loadPackageRuns(packageId)
      if (!current()) return
      const runRows = canUploadDocs ? await healStaleRuns(loaded, { shouldContinue: current }) : loaded
      if (!current()) return
      setRuns(runRows); setLoadedPackageId(packageId)
      setDocsById(new Map(docs.map((d) => [d.id, d])))
      setVersionsById(new Map(versions.map((v) => [v.id, v])))
      setAiCount(approved)
    } catch (error) {
      if (current()) setRunsError(friendlyError(error, '文件處理狀態載入失敗'))
    } finally {
      if (current()) setRunsLoading(false)
    }
  }, [isPersistedProject, pid, canUploadDocs])
  useEffect(() => { reloadRuns(selectedPackageId) }, [reloadRuns, selectedPackageId])

  // 回到頁面時把「仍在處理中」的 run 釘進本批:終結後仍留在面板裡,
  // 結束摘要才出得來(否則列一條條消失,永遠看不到摘要)
  useEffect(() => {
    setBatchVersionIds((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const r of runs) {
        if (!isTerminalRun(r) && !next.has(r.document_version_id)) { next.add(r.document_version_id); changed = true }
      }
      return changed ? next : prev
    })
  }, [runs])

  const progress = useMemo(() => summarizePackageProgress(runs), [runs])
  useEffect(() => {
    if (!selectedPackageId || progress.active === 0) return
    const id = setInterval(() => reloadRuns(selectedPackageId), RUN_POLL_MS)
    return () => clearInterval(id)
  }, [selectedPackageId, progress.active, reloadRuns])
  useEffect(() => {
    if (progress.active > 0 && !tickRef.current) {
      tickRef.current = setInterval(() => forceTick((n) => n + 1), ELAPSED_TICK_MS)
    }
    if (progress.active === 0 && tickRef.current) {
      clearInterval(tickRef.current); tickRef.current = null
    }
    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null } }
  }, [progress.active])
  const elapsed = useMemo(() => {
    const active = runs.filter((r) => !isTerminalRun(r))
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
    if (!isPersistedProject || !pid || !canUploadDocs || packagesLoading || packagesError) return
    if (packageOptions.length > 0 || identityFixTried.current) return
    identityFixTried.current = true
    ;(async () => {
      const { error } = await supabase.rpc('ensure_project_identity', { p: pid })
      if (error) { setMsg(friendlyError(error, '初始化專案身分失敗')); return }
      reloadMembership()
      await reloadPackages()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPersistedProject, pid, canUploadDocs, packageOptions.length, packagesLoading, packagesError])

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

  // ── 上傳分流(統一窗口)──────────────────────────────────────────────────
  // 標單 XML:不建 processing run,直接匯入標單工項。同批多個 XML:第一份成功後,
  // 迴圈內的 workItemsSource 是過期閉包值,用本地旗標擋後續檔案
  const importBoqFiles = useCallback(async (xmls) => {
    let boqImported = workItemsSource === 'db'
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
  }, [importWorkItems, workItemsSource])

  // 契約包管線:多檔 → 自動分類 → 自動歸檔分流(lib/packageUpload.js)
  const uploadToPackage = useCallback(async (files, targetPackage) => {
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
        if (scopeRef.current.pid !== pid || scopeRef.current.packageId !== pkg.id) return
        setLoadedPackageId(pkg.id)
        setBatchVersionIds((ids) => new Set(ids).add(run.document_version_id))
        setRuns((rs) => {
          const i = rs.findIndex((r) => r.document_version_id === run.document_version_id)
          return i >= 0 ? rs.map((r, j) => (j === i ? run : r)) : [...rs, run]
        })
      }
      const { runs: batchRuns, failures } = await uploadFilesToPackage({
        files, packageRow: pkg, projectId: pid, userId: currentUser?.user_id || null, onRun,
      })
      const { data: freshRuns, error: freshError } = await pageAllSafe((from, to) => supabase.from('document_processing_runs')
        .select('*').eq('contract_package_id', pkg.id).order('started_at').order('id').range(from, to))
      if (freshError) throw freshError
      const nextStatus = packageStatusFromRuns(freshRuns || batchRuns)
      await supabase.from('contract_packages').update({ status: nextStatus }).eq('id', pkg.id)
      if (scopeRef.current.pid !== pid) return
      setPackages((ps) => ps.map((p) => (p.id === pkg.id ? { ...p, status: nextStatus } : p)))
      // 全部列出來(最多三件+總數):超限檔 throw 後不會留任何列,
      // 只報第一件會讓其餘失敗檔無聲消失(W14 審查)
      if (failures.length) {
        setMsg(`部分檔案未能開始處理:${failures.slice(0, 3).join(';')}${failures.length > 3 ? ` …共 ${failures.length} 件` : ''}`)
      }
      await reloadRuns(pkg.id)
      if (scopeRef.current.pid === pid) await reloadObligations()
    } catch (e) {
      if (scopeRef.current.pid === pid) setMsg(friendlyError(e, '上傳失敗'))
    } finally {
      if (scopeRef.current.pid === pid) setUploading(false)
    }
  }, [packageOptions, ensurePackage, pid, currentUser, currentProjectMembership, isPlatformAdmin, reloadRuns, reloadObligations])

  // 唯一上傳入口(拖放與選檔都進這裡):分流 XML 與契約文件,批次期間上鎖防重入
  const handleFiles = useCallback(async (fileList, targetPackage) => {
    const files = [...(fileList || [])].filter(Boolean)
    if (!files.length || !canUploadDocs || uploadLock.current || packagesLoading || packagesError) return
    uploadLock.current = true
    try {
      setBoqMsg(null)   // 上一批的結果不得跨批殘留
      setPanelDismissed(false)
      const xmls = files.filter(isPccesXml)
      const documents = files.filter((f) => !isPccesXml(f))
      if (xmls.length) await importBoqFiles(xmls)
      if (documents.length) await uploadToPackage(documents, targetPackage)
    } finally { uploadLock.current = false }
  }, [canUploadDocs, packagesLoading, packagesError, importBoqFiles, uploadToPackage])

  // ── 動 DB 的三個事件處理器 ───────────────────────────────────────────────
  // 修正/確認分類 → 視需要重新路由 AI 分析(也是「重試」的 handler);狀態機在
  // lib/packageRuns.js,這裡只管鎖、畫面寫回與收尾重載
  const confirmClassification = useCallback(async (run, newType) => {
    if (!lockRun(run.id)) return
    try {
      const docId = versionsById.get(run.document_version_id)?.document_id
      const result = await reclassifyProcessingRun({
        run, newType, documentId: docId, projectId: pid,
        onRunPatch: (fields) => patchRun(run.id, fields),
        onDocumentTyped: (id, type) => setDocsById((m) => new Map(m).set(id, { ...m.get(id), document_type: type })),
      })
      if (!result.ok) {
        setMsg(result.message)
        if (result.inProgress) await reloadRuns(run.contract_package_id)
        return
      }
      if (result.run) setRuns((rs) => rs.map((r) => (r.id === result.run.id ? result.run : r)))
      await reloadRuns(run.contract_package_id)
      if (scopeRef.current.pid === pid) await reloadObligations()
    } finally {
      unlockRun(run.id)
    }
  }, [versionsById, pid, patchRun, reloadRuns, reloadObligations])

  // W14 刪除文件:單一守門路徑 delete_document RPC(權限/佐證鏈護欄在伺服器端;
  // 已核定契約重點引用的文件會被 FK 擋下並回看得懂的訊息)。RPC 回傳 storage
  // 路徑,前端負責移除原始檔(storage 物件必須走 Storage API 刪)。
  const deleteDocument = useCallback(async (run, doc) => {
    if (!doc?.id || busyRunsRef.current.has(run.id)) return
    const title = doc.title || '這份文件'
    if (!(await appConfirm({
      title: `確定要刪除「${title}」?`,
      body: '原始檔、所有版本與尚未確認的 AI 契約重點建議會一併移除;已確認契約重點引用的文件會被系統擋下。',
      danger: true, confirmLabel: '刪除',
    }))) return
    // 同步佔位:RPC+storage 清理要跑一兩秒,連點第二下會在第一刀 commit 後
    // 吃到「找不到文件」的誤導錯誤(W14 審查)
    if (!lockRun(run.id)) return
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
      if (scopeRef.current.pid === pid) await reloadObligations()
    } finally {
      unlockRun(run.id)
    }
  }, [reloadRuns])

  // ── 看上傳的檔案:共用層負責留痕/彈窗退回/檔名還原(documentFileAccess)──
  const downloadVersionFile = useCallback(
    (version) => downloadDocumentVersionFile(version, { onError: setMsg }), [])
  const openVersionFile = useCallback(
    (version) => openDocumentVersionFile(version, { onError: setMsg }), [])

  // ── 上傳回饋面板的帳(lib)與開關 ─────────────────────────────────────────
  const batch = useMemo(
    () => summarizeUploadBatch(runs, { batchVersionIds, batchTotal }),
    [runs, batchVersionIds, batchTotal],
  )
  const panelBusy = uploading || boqBusy || batch.active
  const panelVisible = !panelDismissed && (panelBusy || batch.rows.length > 0)
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

  if (isSupabaseConfigured && !currentProject) {
    return (
      <div className="space-y-5">
        <PageHeader title="專案文件" tagline="一次上傳,自動整理" subtitle="上傳契約與附件，AI 自動整理責任、期限與應辦事項，再依登入角色查看契約重點。" />
        <Card><Empty>請先登入並建立/選擇專案,才能整理契約文件。</Empty></Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader title="專案文件" tagline="一次上傳,自動整理" subtitle="上傳契約與附件，AI 自動整理責任、期限與應辦事項，再依登入角色查看契約重點。" />

      <ContractFlow active="documents" role={currentUser?.org_type} packageId={selectedPackageId} />
      <ErrorBanner msg={packagesError} onRetry={reloadPackages} />
      {/* ── 卡 1:契約文件(上傳入口+上傳回饋)──────────────────────────── */}
      <Card title="契約文件" className="[&>div:first-child]:flex-wrap" action={
        <div className="flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto">
          {(packages.length > 1 || creatableOptions.length > 0) && (
            <Select value={selectedPackageId || ''} aria-label="選擇契約" className="w-full sm:w-48" disabled={uploading || packagesLoading}
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
          {canUploadDocs && <>
            <input ref={fileInputRef} type="file" multiple accept={ACCEPT_ATTR} aria-label="選擇契約文件"
              disabled={uploading || boqBusy || packagesLoading || !!packagesError}
              onChange={(e) => handleFiles(takeSelectedFiles(e.target), selectedPackage)} className="hidden" />
            <button type="button" className={buttonClass('primary', 'md')}
              disabled={uploading || boqBusy || packagesLoading || !!packagesError}
              onClick={() => fileInputRef.current?.click()}>
              <MSym name="cloud_upload" size={15} /> 上傳契約文件
            </button>
          </>}

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
            className={`border border-dashed rounded-xl px-5 py-5 flex items-start gap-3.5 transition-colors ${dragOver ? 'border-[var(--primary)] bg-[var(--blue-tint)]' : 'border-[var(--border)] bg-[var(--surface-2)]'}`}
          >
            <MSym name="cloud_upload" size={26} className="text-[var(--text-3)] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm text-[var(--text)] leading-relaxed">
                {canUploadDocs ? '拖入契約與附件，或點「上傳契約文件」一次選擇多個檔案。' : '在這裡查看契約文件、AI 處理狀態與原始檔案。'}
              </p>
              <p className="text-xs text-[var(--text-3)] mt-1.5">
                可自動分析：文字型 PDF、DOCX、TXT。圖片、掃描頁、Excel 與舊版 Word 目前無法自動讀取內容；可保留原檔。PCCES XML 另匯入標單工項。
              </p>
              {!isPersistedProject && <p className="text-xs text-[var(--amber-text)] mt-1.5">Demo 模式不支援,請登入並選擇真實專案。</p>}
              {isPersistedProject && !can.write && <p className="text-xs text-[var(--text-3)] mt-1.5">目前為檢視模式；請由施工廠商、監造或具文件管理權限的成員上傳。</p>}
            </div>
          </div>
        ) : (
          /* 狀態 B/C/D:上傳中/上傳結束的進度面板(逐檔列+總進度+結束摘要) */
          <UploadPanel batch={batch} busy={panelBusy} boqBusy={boqBusy} elapsed={elapsed}
            docsById={docsById} versionsById={versionsById}
            canWriteContract={can.write} busyRunIds={busyRunIds}
            onRetry={retryRun} onDismiss={dismissPanel}
            aiCount={aiCount} packageId={selectedPackageId} boqImported={workItemsSource === 'db'} />
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

      {selectedPackage && !runsLoading && !runsError && loadedPackageId === selectedPackageId && (
        <Card title="下一步：查看整理結果">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm leading-relaxed text-[var(--text-2)]">
              <p>{progress.active > 0 ? 'AI 正在整理，已產出的重點可先查看。' : `目前可查看 ${aiCount ?? 0} 項已歸檔契約重點`}</p>
              <p className="mt-1 text-xs text-[var(--text-3)]">按責任方、期限與類型閱讀；需要確認內容時直接對照來源原文。</p>
              {(progress.incomplete > 0 || progress.partial > 0 || progress.failed > 0 || progress.needsClassification > 0) && (
                <p className="mt-2 text-xs text-[var(--amber-text)]">有文件尚未完整整理，請一併查看下方的處理原因。已產出的重點仍可先閱讀。</p>
              )}
            </div>
            <Link to={`/requirements?package=${encodeURIComponent(selectedPackageId)}`} className={buttonClass('primary', 'md')}>
              查看這份契約重點 <MSym name="arrow_forward" size={16} />
            </Link>
          </div>
        </Card>
      )}
      {/* ── 卡 2:專案文件(已入庫清單)────────────────────────────────────── */}
      <DocumentTable runs={runs} versionsById={versionsById} docsById={docsById}
        loading={packagesLoading || (runsLoading && loadedPackageId !== selectedPackageId)}
        error={runsError} blocked={!!packagesError} onRetryLoad={() => reloadRuns(selectedPackageId)}
        canWriteContract={can.write} busyRunIds={busyRunIds}
        onClassify={confirmClassification} onRetry={retryRun} onDelete={deleteDocument}
        onOpen={openVersionFile} onDownload={downloadVersionFile} />
    </div>
  )
}
