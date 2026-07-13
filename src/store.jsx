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
import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { project } from './data/seed.js'
import { buildDemoData } from './data/demoSeed.js'
import { supabase, isSupabaseConfigured } from './lib/supabase.js'
import {
  wiCacheDel, loadValuationsFromDB, loadScheduleFromDB, loadSiteLogsFromDB,
  loadQualityFromDB, loadDefectsFromDB, loadObligationsFromDB, loadCostItemsFromDB, loadSafetyFromDB,
  loadItemSchedulesFromDB, loadChangeOrdersFromDB, loadQcFromDB, loadAcceptanceFromDB, loadItpFromDB,
} from './store/db.js'
import { useAuthSlice } from './store/slices/auth.js'
import { useProjectsSlice } from './store/slices/projects.js'
import { useBillingSlice } from './store/slices/billing.js'
import { useSiteSlice } from './store/slices/site.js'
import { useQualitySlice } from './store/slices/quality.js'
import { useCollabSlice } from './store/slices/collab.js'
import { useLedgerSlice } from './store/slices/ledger.js'

const StoreContext = createContext(null)

export function StoreProvider({ children }) {
  // P0-05:記憶體假 audit 已除役——權威事件由 DB trigger 寫入 audit_events(不可竄改),
  // /activity 頁讀取。slice 呼叫點保留 log() 形狀,維持最小侵入。
  const log = useCallback(() => {}, [])

  // ── 身分與專案(其他 slice 的共同上游)────────────────────────────────────
  const { currentUser, authReady, setCurrentUser, signUp, resendSignup, signIn, signOutBase } = useAuthSlice()
  const {
    projects, currentProjectId, currentProject, myMemberRoles, projectLoading,
    workItems, workItemsSource, workItemsError, retryWorkItems, wiMaps, dbMode, demoMode, isPersistedProject, currentProjectMembership, reloadMembership,
    switchProject, createProject, importWorkItems, updateProjectAnchors, enableFormalMode, deleteProject, clearOnLogout,
    loadPortfolio,
  } = useProjectsSlice({ currentUser, log })

  // 角色權限（UI 層 v1，對應三級品管）：
  //   施工＝填報/提送，監造＝查驗判定/審核，機關＝監督核定（變更設計核准、撥款）。
  // 核心規則：施工不能核准或結案自己的東西；機關對日常填報唯讀，但保留契約級核定權。
  // 例外：專案 admin（建立者）的跨角色完整權限（override）——單人/小團隊試用
  // 不會被自己的 org_type 卡死；「正式模式」開啟後 override 關閉,人人依 org 行事,
  // admin 只保留專案管理（成員/設定/刪除）。demo 模式刻意不套用 admin 例外。
  // (伺服器端同規則:admin_override()+guard trigger,見 migrations formal_mode 段)
  const can = useMemo(() => {
    const org = currentUser?.org_type || 'contractor'
    const isAdmin = !demoMode && myMemberRoles[currentProjectId] === 'admin'
    const override = isAdmin && !currentProject?.formal_mode // 跨角色簽核例外,正式模式=關
    return {
      edit: override || org === 'contractor',      // 日誌/成本/請款/檢查表等日常填報
      submit: override || org === 'contractor',    // 提送（估驗送監造審核、查驗申請）
      approve: override || org === 'supervisor',   // 監造：核定估驗、查驗判定、缺失複查結案、送審審定
      ratify: override || org === 'owner' || org === 'supervisor', // 契約級核定：變更設計核准/駁回（機關為主，監造得初審）
      oversee: org === 'owner',                    // 機關監督視角（首頁行動中心＝核定/撥款）
      readonly: !override && org === 'owner',
      override,                                    // 看得到全部側欄工具/路由（角色化導覽的例外）
      admin: isAdmin,                              // 專案管理：成員/設定/刪除（不受正式模式影響）
    }
  }, [currentUser, demoMode, myMemberRoles, currentProjectId, currentProject])

  // 標註圖(圖面/照片 markup):demo 直接存 dataURL;真專案存 photos bucket
  // (路徑首段=project_id,沿用既有 Storage RLS)。Storage 不依賴標單 →
  // isPersistedProject,匯標單前的 RFI/觀察標註才不會把整張 dataURL 塞進 DB 欄位。
  const saveMarkup = useCallback(async (dataUrl, kind) => {
    if (!dataUrl) return null
    if (!isPersistedProject) return dataUrl
    const blob = await (await fetch(dataUrl)).blob()
    const path = `${currentProject.project_id}/markups/${kind}-${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' })
    return error ? null : path
  }, [isPersistedProject, currentProject])

  const resolveMarkup = useCallback(async (path) => {
    if (!path || path.startsWith('data:')) return path
    const { data } = await supabase.storage.from('photos').createSignedUrl(path, 3600)
    return data?.signedUrl || null
  }, [])

  // ── 各領域 slice ─────────────────────────────────────────────────────────
  const ctx = { dbMode, demoMode, isPersistedProject, currentProject, currentUser, wiMaps, log, saveMarkup }
  const {
    siteLogs, setSiteLogs, safetyRecords, setSafetyRecords,
    saveSiteLog, deleteSiteLog, listSitePhotos, uploadSitePhoto, deleteSitePhoto, listPhotosByWorkItems,
    readWhiteboard, describeDefect, analyzeSafetyPhoto, classifySitePhoto, draftMonthlyReview, draftValuationSummary, askAssistant, fetchWeather,
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
    parseContract, parseContractFromText, updateObligationStatus, ingestRequirementDocument,
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

  // DB 模式：載入掛在標單工項上的領域資料（依序,避免同時打爆連線）
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
      const costs = await loadCostItemsFromDB(currentProject.project_id)
      if (!active) return
      setCostItems(costs)
      const sched = await loadItemSchedulesFromDB(currentProject.project_id, wiMaps.idToKey)
      if (!active) return
      setItemSchedules(sched)
      const cos = await loadChangeOrdersFromDB(currentProject.project_id)
      if (!active) return
      setChangeOrders(cos)
      const itp = await loadItpFromDB(currentProject.project_id, wiMaps.byId, wiMaps.idToKey)
      if (!active) return
      setInspectionPoints(itp)
      const qc = await loadQcFromDB(currentProject.project_id)
      if (!active) return
      setChecklistTemplates(qc.templates); setChecklistRecords(qc.records); setTestSamples(qc.samples)
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbMode, currentProject, wiMaps])

  // 不依賴標單的領域(驗收/契約義務/工安/缺失/送審/RFI/觀察):真專案選定即從 DB 載入,
  // 不等標單匯入(沒 BOQ 的專案也要能讀寫,否則寫入只進記憶體、重新整理就消失——
  // 假成功)。寫入端見各 slice 的 isPersistedProject 同名判斷。
  useEffect(() => {
    if (!isPersistedProject) return
    const pid = currentProject.project_id
    let active = true
    ;(async () => {
      const acc = await loadAcceptanceFromDB(pid)
      if (!active) return
      setAcceptanceEvents(acc)
      const obs = await loadObligationsFromDB(pid)
      if (!active) return
      setObligations(obs)
      const safety = await loadSafetyFromDB(pid)
      if (!active) return
      setSafetyRecords(safety)
      // 缺失(統一引擎)不依賴標單:匯標單前也要載(dbMode 載入會再帶工項資訊覆蓋)
      if (!dbMode) {
        const defs = await loadDefectsFromDB(pid)
        if (!active) return
        setDefects(defs)
      }
      const [{ data: subs }, { data: rfiRows }, { data: obsRows }] = await Promise.all([
        supabase.from('submittals').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
        supabase.from('rfis').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
        supabase.from('observations').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
      ])
      if (!active) return
      setSubmittals(subs || []); setRfis(rfiRows || []); setObservations(obsRows || [])
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPersistedProject, currentProject?.project_id])

  // 登出：真實模式呼叫 Supabase signOut；prototype 模式只清 currentUser
  const logout = useCallback(async () => {
    demoLoadedRef.current = false // demo:換角色重新登入時重種完整 storyline(登出會清部分資料)
    await signOutBase()
    clearOnLogout()
    setSiteLogs([]); setInspections([]); setDefects([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signOutBase, clearOnLogout])

  // 重新匯入標單：清空本專案 work_items 與相依資料（估驗/進度/日誌/查驗）。
  // 缺失不清:統一引擎後缺失是履約證據(已結案 guard 也擋刪除)且不依賴標單,
  // 只會因 work_items 刪除被解除工項連結(FK set null)。
  const resetProjectBoq = useCallback(async () => {
    if (!dbMode) return { error: { message: '需真專案' } }
    const pid = currentProject.project_id
    for (const t of ['inspections', 'valuations', 'schedule_periods', 'daily_logs', 'work_items']) {
      await supabase.from(t).delete().eq('project_id', pid)
    }
    wiCacheDel(pid)
    setValuations([]); setProgressPlan(null); setSiteLogs([]); setInspections([])
    setDefects(await loadDefectsFromDB(pid)) // 重載:工項連結已解除
    retryWorkItems() // 重跑載入 → 真專案 0 筆會進 'empty'（顯示匯入 onboarding），不載範例
    return { error: null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbMode, currentProject])

  const value = {
    // state
    project: currentProject || project, currentUser, authReady, setCurrentUser,
    isSupabaseConfigured, signUp, signIn, logout,
    currentProject, projects, projectLoading, createProject, switchProject,
    workItems, workItemsSource, workItemsError, retryWorkItems, importWorkItems, dbMode, demoMode, isPersistedProject, can,
    siteLogs, saveSiteLog, fillValuationFromSiteLogs,
    listSitePhotos, uploadSitePhoto, deleteSitePhoto, listPhotosByWorkItems, readWhiteboard, draftMonthlyReview, draftValuationSummary, describeDefect, analyzeSafetyPhoto, classifySitePhoto, askAssistant, fetchWeather,
    obligations, parseContract, parseContractFromText, updateObligationStatus, ingestRequirementDocument, updateProjectAnchors, enableFormalMode, currentProjectMembership, reloadMembership,
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
