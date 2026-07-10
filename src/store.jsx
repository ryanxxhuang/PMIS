// Store 組合根:把各領域 slice 組成單一 context,useStore() API 與拆分前完全相同。
//
// 結構(2026-07-09 拆分,原單檔 1,600 行):
//   src/store/db.js            — DB 載入/轉換/快取/檔案處理(純函式)
//   src/store/slices/auth.js   — 登入身分(Supabase session / demo 角色)
//   src/store/slices/projects.js — 專案清單/標單工項(BOQ 脊椎)/dbMode
//   src/store/slices/billing.js  — 估驗計價/請款收款/預定進度 S 曲線
//   src/store/slices/site.js     — 施工日誌/照片/AI 辨識/工安
//   src/store/slices/quality.js  — 查驗/缺失/自主檢查表/取樣試驗
//   src/store/slices/collab.js   — 送審/RFI/觀察事項/成員
//   src/store/slices/ledger.js   — 成本/變更設計/逐工項排程/契約義務
// 跨領域的部分留在這裡:demo 種子、DB 整批載入、登出清理、重匯標單、角色權限 can。
import { createContext, useContext, useCallback, useEffect, useMemo, useRef } from 'react'
import { project } from './data/seed.js'
import { buildDemoData } from './data/demoSeed.js'
import { supabase, isSupabaseConfigured } from './lib/supabase.js'
import { loadWorkItems } from './lib/boqCalc.js'
import {
  wiCacheDel, loadValuationsFromDB, loadScheduleFromDB, loadSiteLogsFromDB,
  loadQualityFromDB, loadObligationsFromDB, loadCostItemsFromDB, loadSafetyFromDB,
  loadItemSchedulesFromDB, loadChangeOrdersFromDB, loadQcFromDB, loadAcceptanceFromDB, loadItpFromDB,
} from './store/db.js'
import { derivePermissions, deriveDemoPermissions, navPartyKey } from './lib/projectPermissions.js'
import { useAuthSlice } from './store/slices/auth.js'
import { useProjectsSlice } from './store/slices/projects.js'
import { useBillingSlice } from './store/slices/billing.js'
import { useSiteSlice } from './store/slices/site.js'
import { useQualitySlice } from './store/slices/quality.js'
import { useCollabSlice } from './store/slices/collab.js'
import { useLedgerSlice } from './store/slices/ledger.js'

const StoreContext = createContext(null)

export function StoreProvider({ children }) {
  // P0-05: legacy slice call sites still invoke log(), but the unused
  // in-memory array is retired. Authoritative events are database-triggered;
  // keeping this no-op avoids coupling unrelated slice cleanup to P0-05.
  const log = useCallback(() => {}, [])

  // ── 身分與專案(其他 slice 的共同上游)────────────────────────────────────
  const { currentUser, setCurrentUser, signUp, resendSignup, signIn, signOutBase } = useAuthSlice()
  const {
    projects, currentProject,
    projectMembershipsByProject, currentProjectMembership, projectLoading,
    workItems, setWorkItems, workItemsSource, setWorkItemsSource, wiMaps, dbMode, demoMode,
    switchProject, createProject, importWorkItems, updateProjectAnchors, deleteProject, clearOnLogout,
    loadPortfolio,
  } = useProjectsSlice({ currentUser, log })

  // 角色權限(P0-03 cutover):真實模式由「這個專案」的 membership
  // (party_type × project_role)推導,與伺服器端 permission functions 同矩陣;
  // is_project_admin 只保留技術管理(manageProjectIdentity/admin),不再
  // override 業務審核——技術管理 ≠ 契約權限。profiles.org_type 只剩 demo/
  // 註冊提示用途。無 membership 或 party 停用 → fail closed(唯讀)。
  // demo 模式沿用三個銷售劇本角色,映射為代表性專案身分走同一條推導。
  // (伺服器端為最終仲裁:RLS + transition guards,見 supabase/schema.sql P0-03 段)
  const can = useMemo(
    () => (demoMode
      ? deriveDemoPermissions(currentUser?.org_type || 'contractor')
      : derivePermissions(currentProjectMembership)),
    [demoMode, currentUser, currentProjectMembership],
  )
  // 這個專案我代表哪一方('contractor'|'supervisor'|'owner'|null):
  // 供角色化導覽與 ball-in-court 視角使用;切換專案時跟著 membership 變。
  const partyOrgKey = useMemo(
    () => (demoMode
      ? (currentUser?.org_type || 'contractor')
      : navPartyKey(currentProjectMembership)),
    [demoMode, currentUser, currentProjectMembership],
  )

  // 標註圖(圖面/照片 markup):demo 直接存 dataURL;真專案存 photos bucket
  // (路徑首段=project_id,沿用既有 Storage RLS)。
  const saveMarkup = useCallback(async (dataUrl, kind) => {
    if (!dataUrl) return null
    if (!dbMode) return dataUrl
    const blob = await (await fetch(dataUrl)).blob()
    const path = `${currentProject.project_id}/markups/${kind}-${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' })
    return error ? null : path
  }, [dbMode, currentProject])

  const resolveMarkup = useCallback(async (path) => {
    if (!path || path.startsWith('data:')) return path
    const { data } = await supabase.storage.from('photos').createSignedUrl(path, 3600)
    return data?.signedUrl || null
  }, [])

  // ── 各領域 slice ─────────────────────────────────────────────────────────
  const ctx = { dbMode, demoMode, currentProject, currentUser, wiMaps, log, saveMarkup }
  const {
    siteLogs, setSiteLogs, safetyRecords, setSafetyRecords,
    saveSiteLog, deleteSiteLog, listSitePhotos, uploadSitePhoto, deleteSitePhoto,
    readWhiteboard, describeDefect, draftMonthlyReview,
    createSafetyRecord, updateSafetyRecord, deleteSafetyRecord,
  } = useSiteSlice(ctx)
  const {
    valuations, setValuations, progressPlan, setProgressPlan,
    createValuation, updateValuationItem, setValuationStatus, updateValuationPayment,
    fillValuationFromSiteLogs, generateSchedule, updatePlannedPct, deleteValuation,
  } = useBillingSlice(ctx, siteLogs)
  const {
    inspections, setInspections, defects, setDefects,
    inspectionPoints, setInspectionPoints,
    createInspectionPoint, deleteInspectionPoint, requestInspectionForPoint,
    setChecklistTemplates, allChecklistTemplates,
    checklistRecords, setChecklistRecords, testSamples, setTestSamples,
    createInspection, recordInspectionResult, createDefect, updateDefectStatus,
    deleteInspection, deleteDefect,
    createChecklistRecord, deleteChecklistRecord,
    createTestSamples, generateSamplesFromLogs, updateTestSample, deleteTestSample,
  } = useQualitySlice(ctx, siteLogs)
  const {
    submittals, setSubmittals, rfis, setRfis, observations, setObservations,
    createSubmittal, decideSubmittal, resubmitSubmittal, deleteSubmittal,
    createRfi, answerRfi, closeRfi, deleteRfi,
    createObservation, updateObservation, escalateObservation, deleteObservation,
    listMembers, addMemberByEmail, removeMember,
  } = useCollabSlice(ctx, createDefect)
  const {
    costItems, setCostItems, changeOrders, setChangeOrders,
    itemSchedules, setItemSchedules, obligations, setObligations,
    acceptanceEvents, setAcceptanceEvents, recordAcceptanceEvent, clearAcceptanceEvent,
    createCostItem, updateCostItem, deleteCostItem,
    setItemSchedule, removeItemSchedule,
    createChangeOrder, updateChangeOrder, deleteChangeOrder,
    addChangeOrderItem, addChangeOrderItems, updateChangeOrderItem, deleteChangeOrderItem,
    parseContract, updateObligationStatus,
  } = useLedgerSlice(ctx)

  // ── 跨領域效果 ───────────────────────────────────────────────────────────
  // demo 模式：範例標單載入後，一次性預載完整示範資料（銷售展示 storyline）
  const demoLoadedRef = useRef(false)
  useEffect(() => {
    if (!demoMode || demoLoadedRef.current) return
    if (!workItems || workItemsSource !== 'sample' || !currentUser) return
    demoLoadedRef.current = true
    const d = buildDemoData(workItems, project)
    setValuations(d.valuations); setProgressPlan(d.progressPlan); setSiteLogs(d.siteLogs)
    setInspections(d.inspections); setDefects(d.defects); setObligations(d.obligations)
    setCostItems(d.costItems); setSafetyRecords(d.safetyRecords); setChangeOrders(d.changeOrders)
    setChecklistTemplates(d.checklistTemplates); setChecklistRecords(d.checklistRecords); setTestSamples(d.testSamples)
    setSubmittals(d.submittals); setRfis(d.rfis); setObservations(d.observations)
    setItemSchedules(d.itemSchedules); setAcceptanceEvents(d.acceptanceEvents || [])
    setInspectionPoints(d.inspectionPoints || [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode, workItems, workItemsSource, currentUser])

  // DB 模式：載入此專案的全部領域資料（依序,避免同時打爆連線）
  useEffect(() => {
    if (!dbMode) return
    let active = true
    ;(async () => {
      const vals = await loadValuationsFromDB(currentProject.project_id, wiMaps.idToKey)
      if (!active) return
      setValuations(vals)
      const plan = await loadScheduleFromDB(currentProject)
      if (!active) return
      setProgressPlan(plan)
      const logs = await loadSiteLogsFromDB(currentProject.project_id, wiMaps.idToKey)
      if (!active) return
      setSiteLogs(logs)
      const qual = await loadQualityFromDB(currentProject.project_id, wiMaps.byId)
      if (!active) return
      setInspections(qual.inspections); setDefects(qual.defects)
      const obs = await loadObligationsFromDB(currentProject.project_id)
      if (!active) return
      setObligations(obs)
      const costs = await loadCostItemsFromDB(currentProject.project_id)
      if (!active) return
      setCostItems(costs)
      const safety = await loadSafetyFromDB(currentProject.project_id)
      if (!active) return
      setSafetyRecords(safety)
      const sched = await loadItemSchedulesFromDB(currentProject.project_id, wiMaps.idToKey)
      if (!active) return
      setItemSchedules(sched)
      const cos = await loadChangeOrdersFromDB(currentProject.project_id)
      if (!active) return
      setChangeOrders(cos)
      const acc = await loadAcceptanceFromDB(currentProject.project_id)
      if (!active) return
      setAcceptanceEvents(acc)
      const itp = await loadItpFromDB(currentProject.project_id, wiMaps.byId, wiMaps.idToKey)
      if (!active) return
      setInspectionPoints(itp)
      const qc = await loadQcFromDB(currentProject.project_id)
      if (!active) return
      setChecklistTemplates(qc.templates); setChecklistRecords(qc.records); setTestSamples(qc.samples)
      const [{ data: subs }, { data: rfiRows }, { data: obsRows }] = await Promise.all([
        supabase.from('submittals').select('*').eq('project_id', currentProject.project_id).order('created_at', { ascending: false }),
        supabase.from('rfis').select('*').eq('project_id', currentProject.project_id).order('created_at', { ascending: false }),
        supabase.from('observations').select('*').eq('project_id', currentProject.project_id).order('created_at', { ascending: false }),
      ])
      if (!active) return
      setSubmittals(subs || []); setRfis(rfiRows || []); setObservations(obsRows || [])
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbMode, currentProject, wiMaps])

  // 登出：真實模式呼叫 Supabase signOut；prototype 模式只清 currentUser
  const logout = useCallback(async () => {
    demoLoadedRef.current = false // demo:換角色重新登入時重種完整 storyline(登出會清部分資料)
    await signOutBase()
    clearOnLogout()
    setSiteLogs([]); setInspections([]); setDefects([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signOutBase, clearOnLogout])

  // 重新匯入標單：清空本專案 work_items 與相依資料（估驗/進度/日誌/查驗/缺失）
  const resetProjectBoq = useCallback(async () => {
    if (!dbMode) return { error: { message: '需真專案' } }
    const pid = currentProject.project_id
    for (const t of ['defects', 'inspections', 'valuations', 'schedule_periods', 'daily_logs', 'work_items']) {
      await supabase.from(t).delete().eq('project_id', pid)
    }
    wiCacheDel(pid)
    setValuations([]); setProgressPlan(null); setSiteLogs([]); setInspections([]); setDefects([])
    const json = await loadWorkItems()
    setWorkItems({ items: json.items, meta: json.meta }); setWorkItemsSource('sample')
    return { error: null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbMode, currentProject])

  const value = {
    // state
    project: currentProject || project, currentUser, setCurrentUser,
    isSupabaseConfigured, signUp, signIn, logout,
    currentProject, projects, projectLoading, createProject, switchProject,
    projectMembershipsByProject, currentProjectMembership, partyOrgKey,
    workItems, workItemsSource, importWorkItems, dbMode, demoMode, can,
    siteLogs, saveSiteLog, fillValuationFromSiteLogs,
    listSitePhotos, uploadSitePhoto, deleteSitePhoto, readWhiteboard, draftMonthlyReview, describeDefect,
    obligations, parseContract, updateObligationStatus, updateProjectAnchors,
    acceptanceEvents, recordAcceptanceEvent, clearAcceptanceEvent, loadPortfolio,
    costItems, createCostItem, updateCostItem, deleteCostItem,
    safetyRecords, createSafetyRecord, updateSafetyRecord, deleteSafetyRecord,
    itemSchedules, setItemSchedule, removeItemSchedule,
    changeOrders, createChangeOrder, updateChangeOrder, deleteChangeOrder,
    addChangeOrderItem, addChangeOrderItems, updateChangeOrderItem, deleteChangeOrderItem,
    inspections, defects, createInspection, recordInspectionResult, createDefect, updateDefectStatus,
    inspectionPoints, createInspectionPoint, deleteInspectionPoint, requestInspectionForPoint,
    checklistTemplates: allChecklistTemplates, checklistRecords, createChecklistRecord, deleteChecklistRecord,
    testSamples, createTestSamples, generateSamplesFromLogs, updateTestSample, deleteTestSample,
    submittals, createSubmittal, decideSubmittal, resubmitSubmittal, deleteSubmittal,
    observations, createObservation, updateObservation, escalateObservation, deleteObservation,
    rfis, createRfi, answerRfi, closeRfi, deleteRfi,
    listMembers, addMemberByEmail, removeMember, resolveMarkup, resendSignup,
    deleteValuation, deleteSiteLog, deleteInspection, deleteDefect, resetProjectBoq, deleteProject,
    valuations, progressPlan,
    // actions
    createValuation, updateValuationItem, setValuationStatus, updateValuationPayment,
    generateSchedule, updatePlannedPct,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
