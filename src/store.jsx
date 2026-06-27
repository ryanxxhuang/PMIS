import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react'
import {
  project,
  users,
  aiExtractedRequirements,
  aiGeneratedITP,
  seedSubmittals,
  seedRFIs,
  concreteInspectionForm,
} from './data/seed.js'
import { supabase, isSupabaseConfigured } from './lib/supabase.js'
import { loadWorkItems } from './lib/boqCalc.js'

const StoreContext = createContext(null)

// 由 org_type + role 組出顯示用的角色標籤（對應三級品管）
const ORG_LABEL = { contractor: '施工廠商', supervisor: '監造', owner: '機關' }
function orgLabel(org_type, role) {
  return [ORG_LABEL[org_type] || '施工廠商', role].filter(Boolean).join(' / ')
}

// DB projects 列 → 與 seed.project 同形狀（讓既有頁面不需改）
function normalizeProject(row) {
  return {
    project_id: row.id, id: row.id,
    project_name: row.name, project_code: row.code,
    owner_name: row.owner_name, contractor_name: row.contractor_name,
    supervisor_name: row.supervisor_name, location: row.location,
    start_date: row.start_date, end_date: row.end_date, status: row.status,
  }
}

// 抓某專案全部 work_items（PostgREST 單次上限，需分頁）
async function fetchAllWorkItems(projectId) {
  const all = []; const size = 1000; let from = 0
  for (;;) {
    const { data, error } = await supabase.from('work_items').select('*')
      .eq('project_id', projectId).order('sort_order').range(from, from + size - 1)
    if (error) throw error
    all.push(...data)
    if (data.length < size) break
    from += size
  }
  return all
}

// DB work_items 列 → 與 workItems.json 同形狀（parent_id→parent_key 還原、數值轉 Number）
function dbToWorkItems(rows, project) {
  const idToKey = new Map(rows.map((r) => [r.id, r.item_key]))
  const n = (v) => (v == null ? null : Number(v))
  const items = rows.map((r) => ({
    id: r.id, // work_item uuid（估驗/進度寫回 DB 時要用）
    item_key: r.item_key, parent_key: r.parent_id ? idToKey.get(r.parent_id) : null,
    item_no: r.item_no, ref_item_code: r.ref_item_code, item_kind: r.item_kind,
    description: r.description, unit: r.unit,
    quantity: n(r.quantity), unit_price: n(r.unit_price), amount: n(r.amount),
    section: r.section, depth: r.depth, sort_order: r.sort_order,
    is_leaf: r.is_leaf, is_rollup: r.is_rollup,
    is_price_adjustable: r.is_price_adjustable, is_billable: r.is_billable, weight: n(r.weight),
  }))
  const billable_total = items
    .filter((it) => it.is_billable && it.is_leaf && !it.is_rollup)
    .reduce((s, it) => s + (it.amount || 0), 0)
  return {
    items,
    meta: {
      project_name: project.project_name, owner_name: project.owner_name,
      contract_no: project.project_code, billable_total,
      item_count: items.length,
      leaf_count: items.filter((it) => it.is_leaf && !it.is_rollup).length,
    },
  }
}

// localStorage 持久化（demo 重整不丟進度；可用「重置 demo」清除）
// 從 DB 載入估驗（valuations + valuation_items），組回 { items: {item_key: 累計完成數量} } 形狀
async function loadValuationsFromDB(projectId, idToKey) {
  const { data: vals } = await supabase.from('valuations')
    .select('*').eq('project_id', projectId).order('period_no')
  if (!vals?.length) return []
  const { data: vItems } = await supabase.from('valuation_items')
    .select('valuation_id, work_item_id, cum_qty').in('valuation_id', vals.map((v) => v.id))
  const byVal = new Map(vals.map((v) => [v.id, {}]))
  for (const vi of vItems || []) {
    const key = idToKey.get(vi.work_item_id)
    if (key != null && vi.cum_qty != null) byVal.get(vi.valuation_id)[key] = Number(vi.cum_qty)
  }
  return vals.map((v) => ({
    id: v.id, period_no: v.period_no, valuation_date: v.valuation_date,
    retention_pct: Number(v.retention_pct), status: v.status, items: byVal.get(v.id) || {},
  }))
}

// 從 DB 載入預定進度（schedule_periods）→ progressPlan 形狀
async function loadScheduleFromDB(project) {
  const { data } = await supabase.from('schedule_periods')
    .select('*').eq('project_id', project.project_id).order('period_label')
  if (!data?.length) return null
  return {
    start: project.start_date, end: project.end_date,
    months: data.map((r) => ({ label: r.period_label, plannedPct: Number(r.planned_pct) })),
  }
}

// 從 DB 載入施工日誌（daily_logs + daily_log_items），組回 { items: {item_key: 當日數量} }
async function loadSiteLogsFromDB(projectId, idToKey) {
  const { data: logs } = await supabase.from('daily_logs')
    .select('*').eq('project_id', projectId).order('log_date', { ascending: false })
  if (!logs?.length) return []
  const { data: items } = await supabase.from('daily_log_items')
    .select('daily_log_id, work_item_id, qty_today').in('daily_log_id', logs.map((l) => l.id))
  const byLog = new Map(logs.map((l) => [l.id, {}]))
  for (const it of items || []) {
    const key = idToKey.get(it.work_item_id)
    if (key != null && it.qty_today != null) byLog.get(it.daily_log_id)[key] = Number(it.qty_today)
  }
  return logs.map((l) => ({
    id: l.id, log_date: l.log_date, weather: l.weather,
    work_summary: l.work_summary, status: l.status, items: byLog.get(l.id) || {},
  }))
}

// 從 DB 載入查驗 + 缺失，並把 work_item 資訊去正規化方便顯示
async function loadQualityFromDB(projectId, byId) {
  const wi = (id) => byId.get(id)
  const deco = (r) => ({ ...r, work_item_no: wi(r.work_item_id)?.item_no || '', work_item_desc: wi(r.work_item_id)?.description || '' })
  const { data: insp } = await supabase.from('inspections').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
  const { data: defs } = await supabase.from('defects').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
  return { inspections: (insp || []).map(deco), defects: (defs || []).map(deco) }
}

const STORAGE_KEY = 'siteflow-demo-v1'
function loadPersisted() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

// Demo 流程的 11 個步驟（對應 PRD section 21）
export const DEMO_STEPS = [
  '上傳契約',
  'AI 解析契約要求',
  '審核 AI 解析結果',
  'AI 建立表單',
  '施工廠商填自主檢查',
  '提出查驗申請',
  '監造現場查驗',
  '查驗不合格 → 開立缺失',
  '施工廠商改善',
  '監造複查結案',
  '產出報表',
]

const now = () => new Date().toLocaleString('zh-TW', { hour12: false })

export function StoreProvider({ children }) {
  const persisted = loadPersisted()
  const [currentUser, setCurrentUser] = useState(persisted.currentUser ?? null)
  const [completedSteps, setCompletedSteps] = useState(persisted.completedSteps ?? []) // 已完成的 demo 步驟 index
  const [documents, setDocuments] = useState(persisted.documents ?? [])
  // idle | processing | done — 重整時若卡在 processing 則依是否已有解析結果回復
  const [aiStatus, setAiStatus] = useState(
    persisted.aiStatus === 'processing'
      ? (persisted.requirements?.length ? 'done' : 'idle')
      : (persisted.aiStatus ?? 'idle')
  )
  const [requirements, setRequirements] = useState(persisted.requirements ?? [])
  const [itp, setItp] = useState(persisted.itp ?? [])
  const [forms, setForms] = useState(persisted.forms ?? [])
  const [selfInspection, setSelfInspection] = useState(persisted.selfInspection ?? null)
  const [inspectionRequest, setInspectionRequest] = useState(persisted.inspectionRequest ?? null)
  const [supervisorResult, setSupervisorResult] = useState(persisted.supervisorResult ?? null)
  const [defect, setDefect] = useState(persisted.defect ?? null)
  const [photos, setPhotos] = useState(persisted.photos ?? [])
  const [reports, setReports] = useState(persisted.reports ?? [])
  const [audit, setAudit] = useState(persisted.audit ?? [])
  const [dailyLogs, setDailyLogs] = useState(persisted.dailyLogs ?? [])
  const [submittals, setSubmittals] = useState(persisted.submittals ?? seedSubmittals)
  const [rfis, setRfis] = useState(persisted.rfis ?? seedRFIs)
  // 估驗計價：每期一個物件，items 為 { [work_item_key]: 累計完成% }
  const [valuations, setValuations] = useState(persisted.valuations ?? [])
  // 預定進度 S 曲線：{ start, end, months: [{ label, plannedPct }] }
  const [progressPlan, setProgressPlan] = useState(persisted.progressPlan ?? null)
  // 真實後端：使用者的所有專案 + 目前選的那個 + 標單工項（DB 或範例 JSON）
  const [projects, setProjects] = useState([])
  const [currentProjectId, setCurrentProjectId] = useState(null)
  const [projectLoading, setProjectLoading] = useState(isSupabaseConfigured)
  const currentProject = useMemo(
    () => projects.find((p) => p.project_id === currentProjectId) || null,
    [projects, currentProjectId],
  )
  const [workItems, setWorkItems] = useState(null)            // { items, meta }
  const [workItemsSource, setWorkItemsSource] = useState('sample') // 'db' | 'sample'
  // 施工日誌（真 DB；每筆 items 為 { work_item_key: 當日完成數量 }）
  const [siteLogs, setSiteLogs] = useState([])
  // 品質：查驗 + 缺失（真 DB）
  const [inspections, setInspections] = useState([])
  const [defects, setDefects] = useState([])

  const log = useCallback((action, record, extra = {}) => {
    setAudit((a) => [
      {
        event_id: `E${a.length + 1}`,
        user: extra.user || '系統',
        role: extra.role || '-',
        action,
        related_record: record,
        timestamp: now(),
        device_type: extra.device || 'Web',
      },
      ...a,
    ])
  }, [])

  const completeStep = useCallback((idx) => {
    setCompletedSteps((s) => (s.includes(idx) ? s : [...s, idx]))
  }, [])

  // ── 真實 Auth（Supabase）────────────────────────────────────────────
  // 設定了 Supabase 才啟用；否則維持 prototype 假登入（不會壞）。
  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    const loadProfile = async (session) => {
      if (!session?.user) { if (active) setCurrentUser(null); return }
      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', session.user.id).single()
      if (!active) return
      setCurrentUser({
        user_id: session.user.id,
        email: session.user.email,
        name: profile?.full_name || session.user.email,
        company: profile?.company || '',
        role: profile?.role || '',
        org_type: profile?.org_type || 'contractor',
        label: orgLabel(profile?.org_type, profile?.role),
        real: true,
      })
    }
    supabase.auth.getSession().then(({ data }) => loadProfile(data.session))
    // 注意：不可在 onAuthStateChange callback 內直接 await Supabase 查詢，
    // 否則會與 auth lock 互鎖卡死所有後續查詢 → 用 setTimeout 推出 callback 再查。
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setTimeout(() => loadProfile(session), 0)
    })
    return () => { active = false; sub.subscription.unsubscribe() }
  }, [])

  const signUp = useCallback(async ({ email, password, full_name, company, org_type, role }) => {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name, company, org_type, role } },
    })
    // Confirm email 開啟時：建立成功但不給 session（需先點信中連結）→ needsConfirmation
    const needsConfirmation = !error && !data?.session
    return { error, needsConfirmation }
  }, [])

  const signIn = useCallback(async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }, [])

  // 登出：真實模式呼叫 Supabase signOut；prototype 模式只清 currentUser
  const logout = useCallback(async () => {
    if (isSupabaseConfigured) { try { await supabase.auth.signOut() } catch { /* noop */ } }
    setCurrentUser(null)
    setProjects([]); setCurrentProjectId(null); setSiteLogs([]); setInspections([]); setDefects([])
  }, [])

  // 切換目前專案（記住選擇，重整後沿用）
  const switchProject = useCallback((id) => {
    setCurrentProjectId(id)
    try { localStorage.setItem('pmis-current-project', id) } catch { /* noop */ }
  }, [])

  // 登入後載入此使用者的「所有」專案；選上次用的或第一個
  useEffect(() => {
    if (!isSupabaseConfigured) { setProjectLoading(false); return }
    if (!currentUser?.real) { setProjects([]); setCurrentProjectId(null); setProjectLoading(false); return }
    let active = true
    setProjectLoading(true)
    supabase.from('projects').select('*').order('created_at').then(({ data }) => {
      if (!active) return
      const list = (data || []).map(normalizeProject)
      setProjects(list)
      const saved = (() => { try { return localStorage.getItem('pmis-current-project') } catch { return null } })()
      const pick = list.find((p) => p.project_id === saved) || list[0] || null
      setCurrentProjectId(pick?.project_id || null)
      setProjectLoading(false)
    })
    return () => { active = false }
  }, [currentUser])

  // 載入標單工項：有真專案且 DB 有資料 → 讀 DB；否則 fallback 範例 JSON
  useEffect(() => {
    let active = true
    ;(async () => {
      setWorkItems(null)
      if (isSupabaseConfigured && currentProject) {
        try {
          const rows = await fetchAllWorkItems(currentProject.project_id)
          if (!active) return
          if (rows.length) { setWorkItems(dbToWorkItems(rows, currentProject)); setWorkItemsSource('db'); return }
        } catch { /* 落到範例 */ }
      }
      const json = await loadWorkItems()
      if (!active) return
      setWorkItems({ items: json.items, meta: json.meta })
      setWorkItemsSource('sample')
    })()
    return () => { active = false }
  }, [currentProject])

  // 工項查表（item_key↔work_item uuid）+ 是否走真 DB（估驗/進度才寫回 DB）
  const wiMaps = useMemo(() => {
    const byKey = new Map(), idToKey = new Map(), byId = new Map()
    if (workItems) for (const it of workItems.items) {
      byKey.set(it.item_key, it)
      if (it.id) { idToKey.set(it.id, it.item_key); byId.set(it.id, it) }
    }
    return { byKey, idToKey, byId }
  }, [workItems])
  const dbMode = isSupabaseConfigured && !!currentProject && workItemsSource === 'db'

  // DB 模式：載入此專案的估驗與預定進度（取代 localStorage 的值）
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
    })()
    return () => { active = false }
  }, [dbMode, currentProject, wiMaps])

  // 透過 SECURITY DEFINER RPC 建立專案（繞過 projects insert RLS、自動加建立者為成員）
  const createProject = useCallback(async (input) => {
    const { data, error } = await supabase.rpc('create_project', {
      p_name: input.project_name, p_code: input.project_code, p_owner: input.owner_name,
      p_contractor: input.contractor_name, p_supervisor: input.supervisor_name,
      p_location: input.location, p_start: input.start_date || null, p_end: input.end_date || null,
    })
    if (!error && data) {
      const np = normalizeProject(data)
      setProjects((prev) => [...prev, np])
      setCurrentProjectId(np.project_id)
      try { localStorage.setItem('pmis-current-project', np.project_id) } catch { /* noop */ }
    }
    return { error }
  }, [])

  // 匯入標單工項到此專案的 work_items（client 端產 uuid 維持父子關係，分批寫入）。
  // parsed = 上傳 XML 解析結果 { items }；未帶則用內建範例（國際原住民標單）。
  const importWorkItems = useCallback(async (parsed) => {
    if (!currentProject) return { error: { message: '尚無專案' } }
    const data = parsed || await loadWorkItems()
    const idMap = new Map()
    for (const it of data.items) idMap.set(it.item_key, crypto.randomUUID())
    const rows = data.items.map((it) => ({
      id: idMap.get(it.item_key), project_id: currentProject.project_id,
      parent_id: it.parent_key ? idMap.get(it.parent_key) : null,
      item_key: it.item_key, item_no: it.item_no, ref_item_code: it.ref_item_code,
      item_kind: it.item_kind, description: it.description, unit: it.unit,
      quantity: it.quantity, unit_price: it.unit_price, amount: it.amount,
      section: it.section, depth: it.depth, sort_order: it.sort_order,
      is_leaf: it.is_leaf, is_rollup: it.is_rollup,
      is_price_adjustable: it.is_price_adjustable, is_billable: it.is_billable,
      weight: it.weight, remark: it.remark,
    })).sort((a, b) => a.sort_order - b.sort_order) // 父先於子，避免 FK 違反
    const size = 500
    for (let i = 0; i < rows.length; i += size) {
      const { error } = await supabase.from('work_items').insert(rows.slice(i, i + size))
      if (error) return { error }
    }
    const fresh = await fetchAllWorkItems(currentProject.project_id)
    setWorkItems(dbToWorkItems(fresh, currentProject))
    setWorkItemsSource('db')
    log('匯入標單工項', `${rows.length} 項`, { user: currentUser?.name || '系統', role: '施工品管' })
    return { error: null, count: rows.length }
  }, [currentProject, currentUser, log])

  // 1. 上傳契約
  const uploadContract = useCallback((docName, docType) => {
    const doc = {
      document_id: `D${Date.now()}`,
      document_name: docName,
      document_type: docType,
      version: 'v1',
      uploaded_by: '林志明',
      uploaded_at: now(),
      ai_processed: false,
      status: '已上傳',
    }
    setDocuments((d) => [...d, doc])
    log('文件上傳', docName, { user: '林志明', role: '施工廠商' })
    completeStep(0)
  }, [log, completeStep])

  // 2. AI 解析（非同步）
  const runAIExtraction = useCallback(() => {
    setAiStatus('processing')
    log('啟動 AI 解析', '工程契約文件', { user: '林志明', role: '施工廠商' })
    setTimeout(() => {
      setRequirements(aiExtractedRequirements.map((r) => ({ ...r })))
      setAiStatus('done')
      setDocuments((d) => d.map((doc) => ({ ...doc, ai_processed: true, status: 'AI 已解析' })))
      log('AI 解析結果產生', `${aiExtractedRequirements.length} 項契約要求`, { user: 'AI', role: 'AI' })
      completeStep(1)
    }, 2200)
  }, [log, completeStep])

  // 3. 審核 AI 解析結果
  const setRequirementStatus = useCallback((id, status) => {
    setRequirements((rs) => rs.map((r) => (r.requirement_id === id ? { ...r, status } : r)))
    const labelMap = { Approved: 'AI 解析結果核准', Rejected: 'AI 解析結果拒絕' }
    log(labelMap[status] || '更新要求狀態', id, { user: '陳怡君', role: '施工品管' })
    if (status === 'Approved') completeStep(2)
  }, [log, completeStep])

  // M2. AI 從已核准契約要求展開檢驗停留點計畫（ITP / 查驗點計畫）
  const generateITP = useCallback(() => {
    const approvedIds = requirements.filter((r) => r.status === 'Approved').map((r) => r.requirement_id)
    const points = aiGeneratedITP
      .filter((p) => approvedIds.includes(p.requirement_id))
      .map((p) => ({ ...p, status: 'Planned' }))
    setItp(points)
    const holds = points.filter((p) => p.point_type === 'H').length
    log('AI 產生檢驗停留點計畫', `${points.length} 個查驗點（含 ${holds} 個 H 停留點）`, { user: 'AI', role: 'AI' })
    return points
  }, [requirements, log])

  // 4. AI 建立表單
  const createFormFromRequirement = useCallback((requirement) => {
    const form = { ...concreteInspectionForm, fromRequirement: requirement.requirement_id, status: '草稿' }
    setForms((f) => (f.find((x) => x.form_template_id === form.form_template_id) ? f : [...f, form]))
    log('表單建立', form.form_name, { user: 'AI', role: 'AI' })
    completeStep(3)
    return form
  }, [log, completeStep])

  const publishForm = useCallback((formId) => {
    setForms((f) => f.map((x) => (x.form_template_id === formId ? { ...x, status: '已發布' } : x)))
    log('表單發布', formId, { user: '陳怡君', role: '施工品管' })
  }, [log])

  // 5. 施工廠商填自主檢查
  const submitSelfInspection = useCallback((data) => {
    const submission = {
      submission_id: 'S1',
      form_name: '混凝土澆置前自主檢查表',
      submitted_by: '陳怡君',
      submitted_at: now(),
      status: '已送出',
      data,
    }
    setSelfInspection(submission)
    if (data.photo) {
      setPhotos((p) => [...p, { photo_id: 'PH1', caption: '混凝土澆置前現場', photo_type: '自主檢查', taken_by: '陳怡君', taken_at: now(), work_item: '混凝土工程' }])
    }
    log('表單送出', '混凝土澆置前自主檢查表', { user: '陳怡君', role: '施工品管', device: 'Mobile' })
    completeStep(4)
    return submission
  }, [log, completeStep])

  // 6. 提出查驗申請
  const submitInspectionRequest = useCallback(() => {
    const req = {
      inspection_id: 'IR1',
      title: '混凝土澆置前查驗',
      work_item: '混凝土工程',
      location: 'A 區 1F',
      requested_time: '2026-06-18 09:00',
      status: 'Submitted',
      self_check: '混凝土澆置前自主檢查表',
      requested_by: '陳怡君',
      created_at: now(),
    }
    setInspectionRequest(req)
    log('查驗申請送出', req.title, { user: '陳怡君', role: '施工品管', device: 'Mobile' })
    completeStep(5)
    return req
  }, [log, completeStep])

  // 7 & 8. 監造查驗（不合格 → 自動開立缺失）
  const submitSupervisorInspection = useCallback((result) => {
    setSupervisorResult(result)
    setInspectionRequest((r) => (r ? { ...r, status: result.pass ? 'Approved' : 'Rejected' } : r))
    log('查驗結果更新', `混凝土澆置前查驗 — ${result.pass ? '合格' : '不合格'}`, { user: '王建國', role: '監造', device: 'Mobile' })
    completeStep(6)
    if (!result.pass) {
      const d = {
        defect_id: 'DF1',
        title: '鋼筋保護層不足',
        defect_type: '品質缺失',
        work_item: '混凝土工程',
        location: 'A 區 1F',
        description: '澆置前查驗發現底層鋼筋保護層不足 1.5cm，未達規範 4cm 要求。',
        source_section: '施工規範 p.42 第 3 章 3.2.1',
        created_by: '王建國',
        created_at: now(),
        assigned_to: '大華營造',
        due_date: '2026-06-20',
        status: 'Open',
        defect_photos: ['缺失照片：保護層量測'],
        improvement_note: '',
        improvement_photos: [],
      }
      setDefect(d)
      log('缺失建立', d.title, { user: '王建國', role: '監造', device: 'Mobile' })
      completeStep(7)
    }
    return result
  }, [log, completeStep])

  // 9. 施工廠商改善
  const submitDefectImprovement = useCallback((note) => {
    setDefect((d) => (d ? { ...d, improvement_note: note, improvement_photos: ['改善照片：保護層墊塊已加設'], status: 'Submitted for Review' } : d))
    setPhotos((p) => [...p, { photo_id: 'PH2', caption: '保護層墊塊已加設', photo_type: '改善完成', taken_by: '林志明', taken_at: now(), work_item: '混凝土工程' }])
    log('缺失改善回覆', '鋼筋保護層不足', { user: '林志明', role: '施工現場', device: 'Mobile' })
    completeStep(8)
  }, [log, completeStep])

  // 10. 監造複查結案
  const closeDefect = useCallback((pass) => {
    setDefect((d) => (d ? { ...d, status: pass ? 'Closed' : 'Rejected', closed_at: pass ? now() : undefined } : d))
    log(pass ? '缺失結案' : '缺失退回改善', '鋼筋保護層不足', { user: '王建國', role: '監造', device: 'Mobile' })
    if (pass) completeStep(9)
  }, [log, completeStep])

  // M1. 施工日誌 / 監造日報（One Record, Many Outputs：自動帶入當日照片 / 查驗 / 缺失）
  const submitDailyLog = useCallback((logType, data) => {
    const isSup = logType === 'supervisor'
    const entry = {
      daily_log_id: `DL${Date.now()}`,
      log_type: logType,
      log_date: data.log_date || '2026-06-17',
      weather: data.weather || '晴',
      work_areas: data.work_areas || [],
      work_items: data.work_items || [],
      manpower: data.manpower || [],
      equipment: data.equipment || [],
      materials: data.materials || [],
      work_summary: data.work_summary || '',
      today_inspections: data.today_inspections || [],
      today_defects: data.today_defects || [],
      today_photos: data.today_photos || [],
      safety_notes: data.safety_notes || '',
      tomorrow_plan: data.tomorrow_plan || '',
      // 監造日報專屬
      ref_contractor_log_id: data.ref_contractor_log_id,
      sampling_notes: data.sampling_notes,
      supervisor_opinion: data.supervisor_opinion,
      status: '已送出',
      submitted_by: data.submitted_by || (isSup ? '王建國' : '林志明'),
      submitted_at: now(),
      version: 'v1',
    }
    setDailyLogs((ls) => [entry, ...ls])
    log(
      isSup ? '監造日報送出' : '施工日誌送出',
      `${entry.log_date} ${isSup ? '監造日報' : '施工日誌'}`,
      { user: entry.submitted_by, role: isSup ? '監造' : '施工現場', device: 'Mobile' }
    )
    return entry
  }, [log])

  // M3. 送審 Submittals（Procore ball-in-court 工作流）
  // 施工廠商提出送審 → 球在監造
  const createSubmittal = useCallback((data) => {
    const s = {
      submittal_id: `SUB-${Date.now()}`,
      submittal_no: `SUB-2026-${String(submittals.length + 1).padStart(3, '0')}`,
      title: data.title,
      type: data.type,
      work_item: data.work_item,
      spec_section: data.spec_section || '',
      linked_requirement_id: data.linked_requirement_id,
      revision: 0,
      submitted_by: data.submitted_by || '陳怡君',
      submitted_at: now(),
      due_date: data.due_date || '',
      reviewer: '宏觀工程顧問',
      attachments: data.attachments || [],
      status: '審核中',
      ball_in_court: '監造',
      review_comments: [
        { by: data.submitted_by || '陳怡君', role: '施工品管', at: now(), decision: '提出送審', note: data.note || '' },
      ],
    }
    setSubmittals((prev) => [s, ...prev])
    log('送審提出', `${s.submittal_no} ${s.title}`, { user: s.submitted_by, role: '施工品管' })
    return s
  }, [submittals.length, log])

  // 監造審查 → 核准 / 核准(具註記) / 退回修正(球回施工) / 駁回
  const reviewSubmittal = useCallback((id, decision, note) => {
    setSubmittals((prev) => prev.map((s) => (s.submittal_id === id ? {
      ...s,
      status: decision,
      ball_in_court: decision === '退回修正' ? '施工廠商' : '—',
      reviewer: '王建國',
      review_comments: [...s.review_comments, { by: '王建國', role: '監造', at: now(), decision, note: note || '' }],
    } : s)))
    log(`送審審查 — ${decision}`, id, { user: '王建國', role: '監造' })
  }, [log])

  // 施工廠商依退回意見修正後重新送審 → 版次 +1、球回監造
  const resubmitSubmittal = useCallback((id, note) => {
    setSubmittals((prev) => prev.map((s) => (s.submittal_id === id ? {
      ...s,
      revision: s.revision + 1,
      status: '審核中',
      ball_in_court: '監造',
      review_comments: [...s.review_comments, { by: '陳怡君', role: '施工品管', at: now(), decision: '重新送審', note: note || '' }],
    } : s)))
    log('送審重新送出', id, { user: '陳怡君', role: '施工品管' })
  }, [log])

  // M4. RFI 工程疑義（ball-in-court；可標工期 / 費用影響，與 AI Spec Q&A 區分）
  // 施工提出疑義 → 球在監造
  const createRFI = useCallback((data) => {
    const r = {
      rfi_id: `RFI-${Date.now()}`,
      rfi_no: `RFI-2026-${String(rfis.length + 1).padStart(3, '0')}`,
      subject: data.subject,
      question: data.question,
      work_item: data.work_item,
      linked_spec_section: data.linked_spec_section || '',
      asked_by: data.asked_by || '林志明',
      asked_at: now(),
      assigned_to: '宏觀工程顧問（監造）',
      priority: data.priority || '中',
      cost_impact: !!data.cost_impact,
      cost_note: data.cost_note || '',
      schedule_impact: !!data.schedule_impact,
      schedule_note: data.schedule_note || '',
      due_date: data.due_date || '',
      attachments: data.attachments || [],
      status: '待回覆',
      ball_in_court: '監造',
      answer: '',
      answered_by: '',
      answered_at: '',
    }
    setRfis((prev) => [r, ...prev])
    log('RFI 提出', `${r.rfi_no} ${r.subject}`, { user: r.asked_by, role: '施工廠商' })
    return r
  }, [rfis.length, log])

  // 監造回覆 → 球回施工（待確認結案）
  const answerRFI = useCallback((id, answer) => {
    setRfis((prev) => prev.map((r) => (r.rfi_id === id ? {
      ...r, status: '已回覆', ball_in_court: '施工廠商',
      answer, answered_by: '王建國', answered_at: now(),
    } : r)))
    log('RFI 回覆', id, { user: '王建國', role: '監造' })
  }, [log])

  // 施工確認回覆無誤 → 結案
  const closeRFI = useCallback((id) => {
    setRfis((prev) => prev.map((r) => (r.rfi_id === id ? { ...r, status: '已結案', ball_in_court: '—' } : r)))
    log('RFI 結案', id, { user: '林志明', role: '施工廠商' })
  }, [log])

  // 11. 產出報表
  const generateReports = useCallback(() => {
    const types = ['施工日報', '監造查驗紀錄', '缺失改善追蹤表', '照片紀錄表']
    const rs = types.map((t, i) => ({
      report_id: `RPT${i + 1}`,
      report_type: t,
      date_range: '2026-06-17 ~ 2026-06-20',
      generated_by: '系統',
      generated_at: now(),
      status: '已產出',
    }))
    setReports(rs)
    log('報表產出', types.join('、'), { user: '系統', role: '系統' })
    completeStep(10)
    return rs
  }, [log, completeStep])

  // P2. 估驗計價（掛在 work_items 標單脊椎上）
  // 新增一期：期數 +1，並把前一期的累計完成% 帶過來當起點（累計往前滾）
  const createValuation = useCallback((retentionPct = 5) => {
    const periodNo = valuations.length ? Math.max(...valuations.map((v) => v.period_no)) + 1 : 1
    const prev = valuations.find((v) => v.period_no === periodNo - 1)
    const id = dbMode ? crypto.randomUUID() : `VAL-${Date.now()}`
    const v = {
      id, period_no: periodNo,
      valuation_date: new Date().toLocaleDateString('zh-TW'),
      retention_pct: retentionPct, status: '草稿',
      items: prev ? { ...prev.items } : {},
    }
    setValuations((vs) => [...vs, v])
    log('建立估驗期', `第 ${periodNo} 期估驗`, { user: '陳怡君', role: '施工品管' })
    if (dbMode) (async () => {
      await supabase.from('valuations').insert({
        id, project_id: currentProject.project_id, period_no: periodNo,
        valuation_date: new Date().toISOString().slice(0, 10),
        retention_pct: retentionPct, status: '草稿', created_by: currentUser?.user_id,
      })
      // 把前期累計完成數量帶過來寫入 valuation_items
      const rows = Object.entries(v.items).map(([key, qty]) => {
        const wi = wiMaps.byKey.get(key)
        if (!wi) return null
        const q = wi.quantity || 0
        return { valuation_id: id, work_item_id: wi.id, cum_qty: qty,
          cum_pct: q > 0 ? (qty / q) * 100 : null,
          amount_cum: q > 0 ? (wi.amount || 0) * qty / q : 0, source: 'manual' }
      }).filter(Boolean)
      if (rows.length) await supabase.from('valuation_items').insert(rows)
    })()
    return v
  }, [valuations, dbMode, currentProject, currentUser, wiMaps, log])

  // 更新某期某工項的「累計完成數量」
  const updateValuationItem = useCallback((periodId, itemKey, cumQty) => {
    setValuations((vs) => vs.map((v) => (v.id === periodId
      ? { ...v, items: { ...v.items, [itemKey]: cumQty } }
      : v)))
    if (dbMode) {
      const wi = wiMaps.byKey.get(itemKey)
      if (wi) {
        const q = wi.quantity || 0
        supabase.from('valuation_items').upsert(
          { valuation_id: periodId, work_item_id: wi.id, cum_qty: cumQty,
            cum_pct: q > 0 ? (cumQty / q) * 100 : null,
            amount_cum: q > 0 ? (wi.amount || 0) * cumQty / q : 0, source: 'manual' },
          { onConflict: 'valuation_id,work_item_id' },
        ).then(() => {})
      }
    }
  }, [dbMode, wiMaps])

  const setValuationStatus = useCallback((periodId, status) => {
    setValuations((vs) => vs.map((v) => (v.id === periodId ? { ...v, status } : v)))
    log('估驗狀態更新', status, { user: status === '已核定' ? '王建國' : '陳怡君', role: status === '已核定' ? '監造' : '施工品管' })
    if (dbMode) supabase.from('valuations').update({ status }).eq('id', periodId).then(() => {})
  }, [dbMode, log])

  // P3. 預定進度 S 曲線。依開工/竣工切出月份桶，預設用 smoothstep 產生標準 S 曲線。
  const generateSchedule = useCallback((start, end) => {
    const s = new Date(start), e = new Date(end)
    const buckets = []
    let cur = new Date(s.getFullYear(), s.getMonth(), 1)
    const last = new Date(e.getFullYear(), e.getMonth(), 1)
    while (cur <= last) { buckets.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1) }
    const N = buckets.length || 1
    const smoothstep = (t) => t * t * (3 - 2 * t) // 0→1 的 S 形累計
    const months = buckets.map((d, i) => ({
      label: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      plannedPct: +(smoothstep((i + 1) / N) * 100).toFixed(1),
    }))
    const plan = { start, end, months }
    setProgressPlan(plan)
    log('產生預定進度', `${start} ~ ${end}，共 ${N} 個月`, { user: '陳怡君', role: '施工品管' })
    if (dbMode) (async () => {
      await supabase.from('schedule_periods').delete().eq('project_id', currentProject.project_id)
      const rows = months.map((m) => ({ project_id: currentProject.project_id, period_label: m.label, planned_pct: m.plannedPct }))
      if (rows.length) await supabase.from('schedule_periods').insert(rows)
    })()
    return plan
  }, [dbMode, currentProject, log])

  const updatePlannedPct = useCallback((i, pct) => {
    setProgressPlan((p) => (p ? { ...p, months: p.months.map((m, idx) => (idx === i ? { ...m, plannedPct: pct } : m)) } : p))
    if (dbMode && progressPlan?.months[i]) {
      supabase.from('schedule_periods').upsert(
        { project_id: currentProject.project_id, period_label: progressPlan.months[i].label, planned_pct: pct },
        { onConflict: 'project_id,period_label' },
      ).then(() => {})
    }
  }, [dbMode, currentProject, progressPlan])

  // P4. 施工日誌：存某日各工項當日完成數量（一天一筆，沿用 project_id+log_date 唯一）
  const saveSiteLog = useCallback(async ({ log_date, weather, work_summary, items }) => {
    if (!dbMode) return { error: { message: '需真專案' } }
    const { data: up, error: e1 } = await supabase.from('daily_logs').upsert(
      { project_id: currentProject.project_id, log_date, weather: weather || null, work_summary: work_summary || null, status: '已送出', created_by: currentUser?.user_id },
      { onConflict: 'project_id,log_date' },
    ).select().single()
    if (e1) return { error: e1 }
    await supabase.from('daily_log_items').delete().eq('daily_log_id', up.id)
    const rows = Object.entries(items || {}).map(([key, q]) => {
      const wi = wiMaps.byKey.get(key)
      return (wi && q) ? { daily_log_id: up.id, work_item_id: wi.id, qty_today: q } : null
    }).filter(Boolean)
    if (rows.length) {
      const { error: e2 } = await supabase.from('daily_log_items').insert(rows)
      if (e2) return { error: e2 }
    }
    setSiteLogs(await loadSiteLogsFromDB(currentProject.project_id, wiMaps.idToKey))
    log('施工日誌送出', `${log_date}（${rows.length} 工項）`, { user: currentUser?.name || '系統', role: '施工現場' })
    return { error: null }
  }, [dbMode, currentProject, currentUser, wiMaps, log])

  // 把施工日誌各日數量加總，帶入某估驗期的「累計完成數量」（標 source=daily_log）
  const fillValuationFromSiteLogs = useCallback(async (periodId) => {
    if (!dbMode) return { error: { message: '需真專案' } }
    const accum = {}
    for (const lg of siteLogs)
      for (const [key, q] of Object.entries(lg.items || {}))
        accum[key] = (accum[key] || 0) + (Number(q) || 0)
    for (const key of Object.keys(accum)) {
      const wi = wiMaps.byKey.get(key)
      if (wi?.quantity) accum[key] = Math.min(accum[key], wi.quantity)
    }
    setValuations((vs) => vs.map((v) => (v.id === periodId ? { ...v, items: { ...v.items, ...accum } } : v)))
    const rows = Object.entries(accum).map(([key, qty]) => {
      const wi = wiMaps.byKey.get(key)
      if (!wi) return null
      const q = wi.quantity || 0
      return { valuation_id: periodId, work_item_id: wi.id, cum_qty: qty,
        cum_pct: q > 0 ? (qty / q) * 100 : null,
        amount_cum: q > 0 ? (wi.amount || 0) * qty / q : 0, source: 'daily_log' }
    }).filter(Boolean)
    if (rows.length) await supabase.from('valuation_items').upsert(rows, { onConflict: 'valuation_id,work_item_id' })
    log('估驗帶入施工日誌數量', `${rows.length} 工項`, { user: currentUser?.name || '系統', role: '施工品管' })
    return { error: null, count: rows.length }
  }, [dbMode, siteLogs, wiMaps, currentUser, log])

  // P5. 品質查驗 / 缺失（三級品管流）
  const reloadQuality = useCallback(async () => {
    const qual = await loadQualityFromDB(currentProject.project_id, wiMaps.byId)
    setInspections(qual.inspections); setDefects(qual.defects)
  }, [currentProject, wiMaps])

  const createInspection = useCallback(async (input) => {
    if (!dbMode) return { error: { message: '需真專案' } }
    const wi = input.work_item_key ? wiMaps.byKey.get(input.work_item_key) : null
    const { error } = await supabase.from('inspections').insert({
      project_id: currentProject.project_id, work_item_id: wi?.id || null,
      title: input.title, location: input.location || null,
      inspection_type: input.inspection_type || '施工查驗',
      requested_date: input.requested_date || null,
      requested_by: currentUser?.user_id, status: '待查驗',
    })
    if (error) return { error }
    await reloadQuality()
    log('查驗申請', input.title, { user: currentUser?.name, role: '施工品管' })
    return { error: null }
  }, [dbMode, currentProject, currentUser, wiMaps, reloadQuality, log])

  // 監造查驗：合格 / 不合格（不合格可一併開缺失）
  const recordInspectionResult = useCallback(async (insp, pass, note) => {
    if (!dbMode) return { error: { message: '需真專案' } }
    const { error } = await supabase.from('inspections').update({
      status: pass ? '合格' : '不合格', result_note: note || null,
      inspected_by: currentUser?.user_id, inspected_at: new Date().toISOString(),
    }).eq('id', insp.id)
    if (error) return { error }
    if (!pass) {
      await supabase.from('defects').insert({
        project_id: currentProject.project_id, inspection_id: insp.id, work_item_id: insp.work_item_id || null,
        title: `查驗不合格：${insp.title}`, description: note || null, location: insp.location || null,
        status: '開立', created_by: currentUser?.user_id,
      })
    }
    await reloadQuality()
    log('監造查驗', `${insp.title} — ${pass ? '合格' : '不合格'}`, { user: currentUser?.name, role: '監造' })
    return { error: null }
  }, [dbMode, currentProject, currentUser, reloadQuality, log])

  const createDefect = useCallback(async (input) => {
    if (!dbMode) return { error: { message: '需真專案' } }
    const wi = input.work_item_key ? wiMaps.byKey.get(input.work_item_key) : null
    const { error } = await supabase.from('defects').insert({
      project_id: currentProject.project_id, work_item_id: wi?.id || null,
      title: input.title, description: input.description || null,
      severity: input.severity || '一般', location: input.location || null,
      due_date: input.due_date || null, status: '開立', created_by: currentUser?.user_id,
    })
    if (error) return { error }
    await reloadQuality()
    log('開立缺失', input.title, { user: currentUser?.name, role: '監造' })
    return { error: null }
  }, [dbMode, currentProject, currentUser, wiMaps, reloadQuality, log])

  // 缺失狀態推進：開立 → 改善中 → 待複查 → 已結案
  const updateDefectStatus = useCallback(async (defectId, status, extra = {}) => {
    if (!dbMode) return { error: { message: '需真專案' } }
    const patch = { status }
    if (extra.improvement_note !== undefined) patch.improvement_note = extra.improvement_note
    if (status === '已結案') patch.closed_at = new Date().toISOString()
    const { error } = await supabase.from('defects').update(patch).eq('id', defectId)
    if (error) return { error }
    await reloadQuality()
    log('缺失更新', status, { user: currentUser?.name, role: '品管' })
    return { error: null }
  }, [dbMode, currentUser, reloadQuality, log])

  // ── 刪除 / 管理 ────────────────────────────────────────────────────
  const deleteValuation = useCallback(async (periodId) => {
    if (dbMode) await supabase.from('valuations').delete().eq('id', periodId)
    setValuations((vs) => vs.filter((v) => v.id !== periodId))
  }, [dbMode])

  const deleteSiteLog = useCallback(async (logId) => {
    if (dbMode) await supabase.from('daily_logs').delete().eq('id', logId)
    setSiteLogs((ls) => ls.filter((l) => l.id !== logId))
  }, [dbMode])

  const deleteInspection = useCallback(async (id) => {
    if (dbMode) { await supabase.from('inspections').delete().eq('id', id); await reloadQuality() }
  }, [dbMode, reloadQuality])

  const deleteDefect = useCallback(async (id) => {
    if (dbMode) { await supabase.from('defects').delete().eq('id', id); await reloadQuality() }
  }, [dbMode, reloadQuality])

  // 重新匯入標單：清空本專案 work_items 與相依資料（估驗/進度/日誌/查驗/缺失）
  const resetProjectBoq = useCallback(async () => {
    if (!dbMode) return { error: { message: '需真專案' } }
    const pid = currentProject.project_id
    for (const t of ['defects', 'inspections', 'valuations', 'schedule_periods', 'daily_logs', 'work_items']) {
      await supabase.from(t).delete().eq('project_id', pid)
    }
    setValuations([]); setProgressPlan(null); setSiteLogs([]); setInspections([]); setDefects([])
    const json = await loadWorkItems()
    setWorkItems({ items: json.items, meta: json.meta }); setWorkItemsSource('sample')
    return { error: null }
  }, [dbMode, currentProject])

  // 刪除專案（RPC，security definer 連同所有相依資料一併刪）
  const deleteProject = useCallback(async (id) => {
    const { error } = await supabase.rpc('delete_project', { p_id: id })
    if (error) return { error }
    setProjects((prev) => {
      const next = prev.filter((p) => p.project_id !== id)
      if (currentProjectId === id) {
        const pick = next[0]?.project_id || null
        setCurrentProjectId(pick)
        try { pick ? localStorage.setItem('pmis-current-project', pick) : localStorage.removeItem('pmis-current-project') } catch { /* noop */ }
      }
      return next
    })
    return { error: null }
  }, [currentProjectId])

  // 每次狀態變動寫回 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        currentUser, completedSteps, documents, aiStatus, requirements, itp, forms,
        selfInspection, inspectionRequest, supervisorResult, defect, photos, reports, audit, dailyLogs, submittals, rfis, valuations, progressPlan,
      }))
    } catch { /* 忽略 quota / 隱私模式錯誤 */ }
  }, [currentUser, completedSteps, documents, aiStatus, requirements, itp, forms,
      selfInspection, inspectionRequest, supervisorResult, defect, photos, reports, audit, dailyLogs, submittals, rfis, valuations, progressPlan])

  // 重置 demo：清空所有進度與儲存
  const resetDemo = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* noop */ }
    setCurrentUser(null)
    setCompletedSteps([])
    setDocuments([])
    setAiStatus('idle')
    setRequirements([])
    setItp([])
    setForms([])
    setSelfInspection(null)
    setInspectionRequest(null)
    setSupervisorResult(null)
    setDefect(null)
    setPhotos([])
    setReports([])
    setAudit([])
    setDailyLogs([])
    setSubmittals(seedSubmittals)
    setRfis(seedRFIs)
    setValuations([])
    setProgressPlan(null)
  }, [])

  const value = {
    // state
    project: currentProject || project, users, currentUser, setCurrentUser,
    isSupabaseConfigured, signUp, signIn, logout,
    currentProject, projects, projectLoading, createProject, switchProject,
    workItems, workItemsSource, importWorkItems, dbMode,
    siteLogs, saveSiteLog, fillValuationFromSiteLogs,
    inspections, defects, createInspection, recordInspectionResult, createDefect, updateDefectStatus,
    deleteValuation, deleteSiteLog, deleteInspection, deleteDefect, resetProjectBoq, deleteProject,
    completedSteps,
    documents, aiStatus, requirements, itp, forms,
    selfInspection, inspectionRequest, supervisorResult, defect, photos, reports, audit, dailyLogs, submittals, rfis, valuations, progressPlan,
    // actions
    uploadContract, runAIExtraction, setRequirementStatus, generateITP,
    createFormFromRequirement, publishForm,
    submitSelfInspection, submitInspectionRequest, submitSupervisorInspection,
    submitDefectImprovement, closeDefect, submitDailyLog,
    createSubmittal, reviewSubmittal, resubmitSubmittal,
    createRFI, answerRFI, closeRFI, generateReports, resetDemo,
    createValuation, updateValuationItem, setValuationStatus,
    generateSchedule, updatePlannedPct,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
