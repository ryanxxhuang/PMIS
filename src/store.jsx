import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { project, users } from './data/seed.js'
import { buildDemoData } from './data/demoSeed.js'
import { supabase, isSupabaseConfigured } from './lib/supabase.js'
import { loadWorkItems } from './lib/boqCalc.js'
import { parseLocalDate } from './lib/dates.js'
import { judgeChecklist, judgeConcrete, sampleDues, pendingSamplesFromLogs } from './lib/qc.js'
import { TEMPLATE_03310 } from './data/checklist03310.js'

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
    award_date: row.award_date, notice_date: row.notice_date, commencement_date: row.commencement_date,
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

// work_items 本地快取（IndexedDB）—— egress 最大宗就是重抓整份標單（數 MB/次）。
// 標單匯入後即不變，用「筆數比對」驗證快取有效（重匯/清除必然改變筆數）。
function wiDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('pmis-cache', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('work_items')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function wiCacheGet(projectId) {
  try {
    const db = await wiDB()
    return await new Promise((resolve) => {
      const req = db.transaction('work_items').objectStore('work_items').get(projectId)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => resolve(null)
    })
  } catch { return null }
}
async function wiCachePut(projectId, rows) {
  try { const db = await wiDB(); db.transaction('work_items', 'readwrite').objectStore('work_items').put(rows, projectId) } catch { /* 快取失敗不影響功能 */ }
}
async function wiCacheDel(projectId) {
  try { const db = await wiDB(); db.transaction('work_items', 'readwrite').objectStore('work_items').delete(projectId) } catch { /* noop */ }
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
    invoice_date: v.invoice_date, paid_date: v.paid_date, paid_amount: v.paid_amount == null ? null : Number(v.paid_amount),
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
    weather_am: l.weather_am, weather_pm: l.weather_pm,
    labor: l.labor || [], equipment: l.equipment || [], materials: l.materials || [], extras: l.extras || {},
    work_summary: l.work_summary, status: l.status, items: byLog.get(l.id) || {},
  }))
}

// 從 DB 載入品管:檢查表範本/紀錄 + 取樣試體
async function loadQcFromDB(projectId) {
  const { data: tpls } = await supabase.from('checklist_templates')
    .select('*').eq('project_id', projectId).order('created_at')
  const { data: recs } = await supabase.from('checklist_records')
    .select('*').eq('project_id', projectId).order('check_date', { ascending: false })
  const { data: samples } = await supabase.from('test_samples')
    .select('*').eq('project_id', projectId).order('sampled_date', { ascending: false })
  return { templates: tpls || [], records: recs || [], samples: samples || [] }
}

// 從 DB 載入查驗 + 缺失，並把 work_item 資訊去正規化方便顯示
async function loadQualityFromDB(projectId, byId) {
  const wi = (id) => byId.get(id)
  const deco = (r) => ({ ...r, work_item_no: wi(r.work_item_id)?.item_no || '', work_item_desc: wi(r.work_item_id)?.description || '' })
  const { data: insp } = await supabase.from('inspections').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
  const { data: defs } = await supabase.from('defects').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
  return { inspections: (insp || []).map(deco), defects: (defs || []).map(deco) }
}

// 從 DB 載入契約義務清單
async function loadObligationsFromDB(projectId) {
  const { data } = await supabase.from('contract_obligations')
    .select('*').eq('project_id', projectId).order('sort_order')
  return data || []
}

// 從 DB 載入成本項目（預算 vs 實際、分包）
async function loadCostItemsFromDB(projectId) {
  const { data } = await supabase.from('cost_items')
    .select('*').eq('project_id', projectId).order('sort_order').order('created_at')
  return data || []
}

// 從 DB 載入變更設計 + 追加減工項明細（明細 nest 在各變更下）
async function loadChangeOrdersFromDB(projectId) {
  const { data: cos } = await supabase.from('change_orders')
    .select('*').eq('project_id', projectId).order('sort_order').order('created_at')
  if (!cos?.length) return []
  const { data: items } = await supabase.from('change_order_items')
    .select('*').in('change_order_id', cos.map((c) => c.id)).order('sort_order').order('created_at')
  const byCo = new Map(cos.map((c) => [c.id, []]))
  for (const it of items || []) byCo.get(it.change_order_id)?.push(it)
  return cos.map((c) => ({ ...c, items: byCo.get(c.id) || [] }))
}

// 從 DB 載入工安紀錄（自主檢查 / 缺失 / 教育訓練 / 危害告知）
async function loadSafetyFromDB(projectId) {
  const { data } = await supabase.from('safety_records')
    .select('*').eq('project_id', projectId).order('record_date', { ascending: false }).order('created_at', { ascending: false })
  return data || []
}

// 從 DB 載入逐工項排程，回傳 { item_key: { planned_start, planned_finish } }
async function loadItemSchedulesFromDB(projectId, idToKey) {
  const { data } = await supabase.from('item_schedules').select('*').eq('project_id', projectId)
  const map = {}
  for (const r of data || []) {
    const key = idToKey.get(r.work_item_id)
    if (key) map[key] = { planned_start: r.planned_start, planned_finish: r.planned_finish }
  }
  return map
}

// 壓縮並轉 base64(去掉 data: 前綴)。長邊降到 1600px、JPEG 0.8 → 省 token、上傳更快。
function imageToBase64(file, maxPx = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(img.src)
      resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1])
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

// 讀檔轉 base64(去 data: 前綴),不壓縮 — 給掃描/圖片契約用(退回視覺)。
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

// 瀏覽器端抽契約文字:Word(.docx)用 mammoth、數位 PDF 用 pdf.js。
// 抽得到文字就送純文字給 AI(比用「看圖」準很多);抽不到(掃描/圖片)回空字串走視覺。
// 套件動態載入,不進主 bundle。
async function extractContractText(file) {
  const name = (file.name || '').toLowerCase()
  const type = file.type || ''
  const buf = await file.arrayBuffer()
  if (name.endsWith('.docx') || type.includes('officedocument.wordprocessing') || type.includes('msword')) {
    const m = await import('mammoth/mammoth.browser')
    const extract = m.extractRawText || m.default?.extractRawText
    const { value } = await extract({ arrayBuffer: buf })
    return value || ''
  }
  if (name.endsWith('.pdf') || type.includes('pdf')) {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
    const parts = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const tc = await page.getTextContent()
      parts.push(tc.items.map((it) => it.str).join(' '))
    }
    return parts.join('\n')
  }
  return ''
}

const now = () => new Date().toLocaleString('zh-TW', { hour12: false })

export function StoreProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [audit, setAudit] = useState([]) // 記憶體操作紀錄（log() 寫入，供日後審計）
  // 估驗計價：每期一個物件，items 為 { [work_item_key]: 累計完成數量 }
  const [valuations, setValuations] = useState([])
  // 預定進度 S 曲線：{ start, end, months: [{ label, plannedPct }] }
  const [progressPlan, setProgressPlan] = useState(null)
  // 真實後端：使用者的所有專案 + 目前選的那個 + 標單工項（DB 或範例 JSON）
  const [projects, setProjects] = useState([])
  const [currentProjectId, setCurrentProjectId] = useState(null)
  const [myMemberRoles, setMyMemberRoles] = useState({}) // { project_id: 'admin' | … }
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
  // 契約義務清單（真 DB；AI 解析契約後填入）
  const [obligations, setObligations] = useState([])
  // 成本項目（真 DB；預算 vs 實際、分包）
  const [costItems, setCostItems] = useState([])
  // 工安紀錄（真 DB）
  const [safetyRecords, setSafetyRecords] = useState([])
  // 變更設計 / 追加減帳（真 DB；每筆含 items 明細）
  const [changeOrders, setChangeOrders] = useState([])
  // 逐工項排程（真 DB；{ item_key: { planned_start, planned_finish } }）
  const [itemSchedules, setItemSchedules] = useState({})
  // 品管:自主檢查表範本/紀錄、取樣試驗試體
  const [checklistTemplates, setChecklistTemplates] = useState([])
  const [checklistRecords, setChecklistRecords] = useState([])
  const [testSamples, setTestSamples] = useState([])
  // 監造協作:送審與工程疑義
  const [submittals, setSubmittals] = useState([])
  const [rfis, setRfis] = useState([])

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

  // ── 真實 Auth（Supabase）────────────────────────────────────────────
  // 設定了 Supabase 才啟用；否則維持 prototype 假登入（不會壞）。
  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    let lastUserId = null // 同一使用者的重複 auth 事件（TOKEN_REFRESHED、切回分頁）直接略過，
                          // 否則 setCurrentUser(新物件) 會連鎖觸發專案+整份標單重新下載（egress 元凶）
    const loadProfile = async (session) => {
      if (!session?.user) { lastUserId = null; if (active) setCurrentUser(null); return }
      if (session.user.id === lastUserId) return
      lastUserId = session.user.id
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
    demoLoadedRef.current = false // demo:換角色重新登入時重種完整 storyline(登出會清部分資料)
    setCurrentUser(null)
    setProjects([]); setCurrentProjectId(null); setSiteLogs([]); setInspections([]); setDefects([])
  }, [])

  // 切換目前專案（記住選擇，重整後沿用）
  const switchProject = useCallback((id) => {
    setCurrentProjectId(id)
    try { localStorage.setItem('pmis-current-project', id) } catch { /* noop */ }
  }, [])

  // 登入後載入此使用者的「所有」專案；選上次用的或第一個。
  // 同時取自己的成員角色(project_members.role)——admin(建立者)擁有完整權限。
  useEffect(() => {
    if (!isSupabaseConfigured) { setProjectLoading(false); return }
    if (!currentUser?.real) { setProjects([]); setCurrentProjectId(null); setMyMemberRoles({}); setProjectLoading(false); return }
    let active = true
    setProjectLoading(true)
    Promise.all([
      supabase.from('projects').select('*').order('created_at'),
      supabase.from('project_members').select('project_id, role').eq('user_id', currentUser.user_id),
    ]).then(([{ data }, { data: memberships }]) => {
      if (!active) return
      const list = (data || []).map(normalizeProject)
      setProjects(list)
      setMyMemberRoles(Object.fromEntries((memberships || []).map((m) => [m.project_id, m.role])))
      const saved = (() => { try { return localStorage.getItem('pmis-current-project') } catch { return null } })()
      const pick = list.find((p) => p.project_id === saved) || list[0] || null
      setCurrentProjectId(pick?.project_id || null)
      setProjectLoading(false)
    })
    return () => { active = false }
  }, [currentUser])

  // 載入標單工項：有真專案且 DB 有資料 → 讀 DB；否則 fallback 範例 JSON。
  // 先打「筆數」head 查詢（幾乎零流量）驗證本地快取，命中就不重新下載整份標單；
  // 依賴用 project_id（字串）而非物件參考，避免專案清單重載時無謂重抓。
  useEffect(() => {
    let active = true
    ;(async () => {
      setWorkItems(null)
      if (isSupabaseConfigured && currentProject) {
        const pid = currentProject.project_id
        try {
          const { count, error } = await supabase.from('work_items')
            .select('id', { count: 'exact', head: true }).eq('project_id', pid)
          if (error) throw error
          if (count) {
            const cached = await wiCacheGet(pid)
            let rows = cached && cached.length === count ? cached : null
            if (!rows) { rows = await fetchAllWorkItems(pid); wiCachePut(pid, rows) }
            if (!active) return
            setWorkItems(dbToWorkItems(rows, currentProject)); setWorkItemsSource('db'); return
          }
        } catch { /* 落到範例 */ }
      }
      const json = await loadWorkItems()
      if (!active) return
      setWorkItems({ items: json.items, meta: json.meta })
      setWorkItemsSource('sample')
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.project_id])

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
  // demo 模式：未設 Supabase → 全站用 demoSeed storyline，寫入只進記憶體
  const demoMode = !isSupabaseConfigured

  // 角色權限（UI 層 v1）：施工＝填報/提送，監造＝判定/結案，機關＝唯讀。
  // 核心規則：施工不能核准或結案自己的東西。
  // 例外：專案 admin（建立者）擁有完整權限——單人/小團隊試用不會被自己的
  // org_type 卡死；demo 模式刻意不套用 admin 例外，保留兩種角色的展示劇本。
  const can = useMemo(() => {
    const org = currentUser?.org_type || 'contractor'
    const isAdmin = !demoMode && myMemberRoles[currentProjectId] === 'admin'
    return {
      edit: isAdmin || org === 'contractor',     // 日誌/成本/請款/檢查表等日常填報
      submit: isAdmin || org === 'contractor',   // 提送（估驗送監造審核、查驗申請）
      approve: isAdmin || org === 'supervisor',  // 核定估驗、查驗判定、缺失複查結案、變更核准
      readonly: !isAdmin && org === 'owner',
    }
  }, [currentUser, demoMode, myMemberRoles, currentProjectId])

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
    setSubmittals(d.submittals); setRfis(d.rfis)
    setItemSchedules(d.itemSchedules)
  }, [demoMode, workItems, workItemsSource, currentUser])

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
      const qc = await loadQcFromDB(currentProject.project_id)
      if (!active) return
      setChecklistTemplates(qc.templates); setChecklistRecords(qc.records); setTestSamples(qc.samples)
      const [{ data: subs }, { data: rfiRows }] = await Promise.all([
        supabase.from('submittals').select('*').eq('project_id', currentProject.project_id).order('created_at', { ascending: false }),
        supabase.from('rfis').select('*').eq('project_id', currentProject.project_id).order('created_at', { ascending: false }),
      ])
      if (!active) return
      setSubmittals(subs || []); setRfis(rfiRows || [])
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
    wiCachePut(currentProject.project_id, fresh)
    setWorkItems(dbToWorkItems(fresh, currentProject))
    setWorkItemsSource('db')
    log('匯入標單工項', `${rows.length} 項`, { user: currentUser?.name || '系統', role: '施工品管' })
    return { error: null, count: rows.length }
  }, [currentProject, currentUser, log])

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

  // 請款/收款:更新某期的請款日 / 收款日 / 實收金額（demo 模式只更新本機）
  const updateValuationPayment = useCallback(async (id, patch) => {
    setValuations((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)))
    if (!dbMode) return { error: null }
    const { error } = await supabase.from('valuations').update(patch).eq('id', id)
    return { error }
  }, [dbMode])

  // P3. 預定進度 S 曲線。依開工/竣工切出月份桶，預設用 smoothstep 產生標準 S 曲線。
  const generateSchedule = useCallback((start, end) => {
    const s = parseLocalDate(start), e = parseLocalDate(end)
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
  // 公定格式欄位:weather_am/pm、labor/equipment/materials(陣列)、extras(四~八節)
  const saveSiteLog = useCallback(async ({ log_date, weather, weather_am, weather_pm, labor, equipment, materials, extras, work_summary, items }) => {
    const official = {
      weather_am: weather_am || null, weather_pm: weather_pm || null,
      labor: labor?.length ? labor : null, equipment: equipment?.length ? equipment : null,
      materials: materials?.length ? materials : null,
      extras: extras && Object.keys(extras).length ? extras : null,
    }
    if (!dbMode) {
      // demo：本機 upsert（同日覆蓋），維持日期新→舊排序
      setSiteLogs((ls) => [
        { id: `LOG-${Date.now()}`, log_date, weather: weather || null, ...official, work_summary: work_summary || null, status: '已送出', items: items || {} },
        ...ls.filter((l) => l.log_date !== log_date),
      ].sort((a, b) => b.log_date.localeCompare(a.log_date)))
      return { error: null }
    }
    const { data: up, error: e1 } = await supabase.from('daily_logs').upsert(
      { project_id: currentProject.project_id, log_date, weather: weather || null, ...official, work_summary: work_summary || null, status: '已送出', created_by: currentUser?.user_id },
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
    const accum = {}
    for (const lg of siteLogs)
      for (const [key, q] of Object.entries(lg.items || {}))
        accum[key] = (accum[key] || 0) + (Number(q) || 0)
    for (const key of Object.keys(accum)) {
      const wi = wiMaps.byKey.get(key)
      if (wi?.quantity) accum[key] = Math.min(accum[key], wi.quantity)
    }
    setValuations((vs) => vs.map((v) => (v.id === periodId ? { ...v, items: { ...v.items, ...accum } } : v)))
    if (!dbMode) return { error: null, count: Object.keys(accum).length }
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

  // P4b. 施工日誌照片：檔案進 Storage（photos bucket）、metadata 進 photos 表。
  // 路徑慣例 <project_id>/<daily_log_id>/<photo_id>.<ext>（第一段=project_id，對應 Storage RLS）。
  const listSitePhotos = useCallback(async (dailyLogId) => {
    if (!dbMode || !dailyLogId) return []
    const { data } = await supabase.from('photos')
      .select('*').eq('daily_log_id', dailyLogId).order('created_at')
    if (!data?.length) return []
    // 私有 bucket → 批次產生簽名 URL 供 <img> 顯示
    const { data: signed } = await supabase.storage.from('photos')
      .createSignedUrls(data.map((p) => p.storage_path), 3600)
    const urlByPath = new Map((signed || []).map((s) => [s.path, s.signedUrl]))
    return data.map((p) => ({ ...p, url: urlByPath.get(p.storage_path) || null }))
  }, [dbMode])

  const uploadSitePhoto = useCallback(async (dailyLogId, file, meta = {}) => {
    if (!dbMode || !dailyLogId) return { error: { message: '需先存檔日誌' } }
    const pid = currentProject.project_id
    const id = crypto.randomUUID()
    const ext = (file.name?.split('.').pop() || file.type?.split('/')[1] || 'jpg').toLowerCase()
    const path = `${pid}/${dailyLogId}/${id}.${ext}`
    const { error: upErr } = await supabase.storage.from('photos')
      .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
    if (upErr) return { error: upErr }
    const wi = meta.work_item_key ? wiMaps.byKey.get(meta.work_item_key) : null
    const { error: insErr } = await supabase.from('photos').insert({
      id, project_id: pid, daily_log_id: dailyLogId, work_item_id: wi?.id || null,
      storage_path: path, caption: meta.caption || null,
      taken_at: meta.taken_at || new Date().toISOString(), uploaded_by: currentUser?.user_id,
    })
    if (insErr) { await supabase.storage.from('photos').remove([path]); return { error: insErr } } // 回滾孤兒檔
    log('施工日誌照片上傳', meta.caption || file.name || '照片', { user: currentUser?.name || '系統', role: '施工現場' })
    return { error: null, id }
  }, [dbMode, currentProject, currentUser, wiMaps, log])

  const deleteSitePhoto = useCallback(async (photo) => {
    if (!dbMode) return { error: { message: '需真專案' } }
    await supabase.storage.from('photos').remove([photo.storage_path])
    await supabase.from('photos').delete().eq('id', photo.id)
    return { error: null }
  }, [dbMode])

  // AI 現場辨識:工程告示板/現場照片 → read-whiteboard Edge Function（Claude 視覺）→ 結構化日誌欄位。
  // 金鑰在雲端函式,前端只送壓好的 base64;工項對應(item_key)由前端用標單模糊比對。
  const readWhiteboard = useCallback(async (file) => {
    if (!isSupabaseConfigured) return { error: { message: '需登入（Supabase 未設定）' } }
    let image_base64
    try { image_base64 = await imageToBase64(file) } catch { return { error: { message: '讀取照片失敗' } } }
    const { data, error } = await supabase.functions.invoke('read-whiteboard', {
      body: { image_base64, mime_type: 'image/jpeg' },
    })
    if (error) return { error }
    if (data?.error) return { error: { message: data.error } }
    return { error: null, result: data }
  }, [])

  // AI 缺失描述:缺失照片 → describe-defect Edge Function → 缺失表單欄位。
  const describeDefect = useCallback(async (file) => {
    if (!isSupabaseConfigured) return { error: { message: '需登入（demo 模式不支援 AI 辨識）' } }
    let image_base64
    try { image_base64 = await imageToBase64(file) } catch { return { error: { message: '讀取照片失敗' } } }
    const { data, error } = await supabase.functions.invoke('describe-defect', {
      body: { image_base64, mime_type: 'image/jpeg' },
    })
    if (error) return { error }
    if (data?.error) return { error: { message: data.error } }
    return { error: null, result: data }
  }, [])

  // AI 月報草稿:彙整數據 → draft-monthly-review Edge Function → 檢討/下月計畫。
  // demo 模式在本地用數據套模板生成(銷售 demo 不依賴後端)。
  const draftMonthlyReview = useCallback(async (payload) => {
    if (demoMode) {
      const s = payload.stats || {}
      const behind = s.diff != null && s.diff < 0
      const review =
        `本月完成估驗金額 NT$ ${Math.round(s.thisMonthVal || 0).toLocaleString()}，累計實際進度 ${(s.actualPct || 0).toFixed(1)}%` +
        (s.plannedPct != null ? `，較預定進度${behind ? '落後' : '超前'} ${Math.abs(s.diff).toFixed(1)}%。` : '。') +
        `本月施工 ${s.workDays || 0} 天（雨天 ${s.rainDays || 0} 天），查驗 ${s.inspections || 0} 次` +
        (s.failed ? `（不合格 ${s.failed} 件，均已開立缺失追蹤改善）` : '（均合格）') +
        `。` + (behind ? '落後主因為雨天影響戶外作業，已調整人力於室內工項並研擬趕工計畫。' : '整體進度受控，持續依計畫推進。')
      const next_plan =
        `預定持續辦理${(s.logSummaries || []).slice(-1)[0] || '主體結構工程'}之後續作業，` +
        `並依進度計畫安排後續工項進場；持續落實三級品管自主檢查與工安巡檢，如有變更設計核定將即時納入估驗。`
      return { error: null, result: { review, next_plan } }
    }
    if (!isSupabaseConfigured) return { error: { message: '需登入（Supabase 未設定）' } }
    const { data, error } = await supabase.functions.invoke('draft-monthly-review', { body: payload })
    if (error) return { error }
    if (data?.error) return { error: { message: data.error } }
    return { error: null, result: data }
  }, [demoMode])

  // 契約義務:重載 / 設基準日 / 解析契約 / 改狀態 ──────────────────────────
  const reloadObligations = useCallback(async () => {
    if (!dbMode) return
    setObligations(await loadObligationsFromDB(currentProject.project_id))
  }, [dbMode, currentProject])

  // 基準日(決標/接獲通知/開工)→ 寫回 projects 欄位 + 本地
  const updateProjectAnchors = useCallback(async (patch) => {
    if (!dbMode) return { error: { message: '需真專案' } }
    const pid = currentProject.project_id
    setProjects((ps) => ps.map((p) => (p.project_id === pid ? { ...p, ...patch } : p)))
    const { error } = await supabase.from('projects').update(patch).eq('id', pid)
    return { error }
  }, [dbMode, currentProject])

  // 上傳契約 → parse-contract（OpenAI 解析）→ 取代本專案的義務清單
  const parseContract = useCallback(async (file) => {
    if (!dbMode) return { error: { message: '需真專案' } }
    let body
    try {
      const text = await extractContractText(file)
      body = (text && text.trim().length > 200)
        ? { text, filename: file.name }                                   // 數位 Word/PDF → 送純文字(準)
        : { file_base64: await fileToBase64(file), mime_type: file.type, filename: file.name } // 掃描/圖片 → 視覺
    } catch { return { error: { message: '讀取檔案失敗' } } }
    const { data, error } = await supabase.functions.invoke('parse-contract', { body })
    if (error) return { error }
    if (data?.error) return { error: { message: data.error } }
    const obs = data.obligations || []
    const pid = currentProject.project_id
    await supabase.from('contract_obligations').delete().eq('project_id', pid) // 重新解析=取代
    if (obs.length) {
      const rows = obs.map((o, i) => ({
        project_id: pid, title: o.title, category: o.category || null,
        trigger_event: o.trigger_event || null,
        offset_days: Number.isFinite(o.offset_days) ? o.offset_days : null,
        offset_dir: o.offset_dir || 'after', fixed_date: o.fixed_date || null,
        recurring: o.recurring || null, recurring_day: o.recurring_day || null,
        responsible: o.responsible || null, penalty: o.penalty || null,
        source_clause: o.source_clause || null, source_page: o.source_page || null,
        status: '待辦', sort_order: i,
      }))
      const { error: insErr } = await supabase.from('contract_obligations').insert(rows)
      if (insErr) return { error: insErr }
    }
    await reloadObligations()
    log('AI 解析契約義務', `${obs.length} 項`, { user: currentUser?.name || '系統', role: '施工品管' })
    return { error: null, count: obs.length }
  }, [dbMode, currentProject, currentUser, reloadObligations, log])

  const updateObligationStatus = useCallback(async (id, status) => {
    setObligations((os) => os.map((o) => (o.id === id ? { ...o, status } : o)))
    if (dbMode) await supabase.from('contract_obligations').update({ status }).eq('id', id)
    return { error: null }
  }, [dbMode])

  // P3. 成本管理：新增 / 更新 / 刪除成本項目（預算 vs 實際、分包；demo 只進記憶體）
  const createCostItem = useCallback(async (input) => {
    const row = {
      category: input.category || '其他', title: input.title,
      vendor: input.vendor || null,
      budget_amount: Number(input.budget_amount) || 0,
      actual_amount: Number(input.actual_amount) || 0,
      status: input.status || '進行中', note: input.note || null,
      sort_order: costItems.length,
    }
    if (!dbMode) {
      setCostItems((cs) => [...cs, { ...row, id: `COST-${Date.now()}` }])
      return { error: null }
    }
    const { data, error } = await supabase.from('cost_items')
      .insert({ ...row, project_id: currentProject.project_id }).select().single()
    if (error) return { error }
    setCostItems((cs) => [...cs, data])
    log('新增成本項目', `${row.category}·${row.title}`, { user: currentUser?.name || '系統', role: '工程' })
    return { error: null }
  }, [dbMode, currentProject, costItems, currentUser, log])

  const updateCostItem = useCallback(async (id, patch) => {
    setCostItems((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    if (!dbMode) return { error: null }
    const { error } = await supabase.from('cost_items').update(patch).eq('id', id)
    return { error }
  }, [dbMode])

  const deleteCostItem = useCallback(async (id) => {
    setCostItems((cs) => cs.filter((c) => c.id !== id))
    if (dbMode) await supabase.from('cost_items').delete().eq('id', id)
    return { error: null }
  }, [dbMode])

  // P6. 工安：新增 / 更新 / 刪除工安紀錄（demo 只進記憶體）
  const createSafetyRecord = useCallback(async (input) => {
    const row = {
      record_type: input.record_type || '工安缺失', title: input.title,
      location: input.location || null, record_date: input.record_date || null,
      severity: input.severity || '一般',
      status: input.record_type === '教育訓練' || input.record_type === '危害告知' ? '已完成' : (input.status || '待改善'),
      due_date: input.due_date || null, note: input.note || null,
    }
    if (!dbMode) {
      setSafetyRecords((rs) => [{ ...row, id: `SAF-${Date.now()}` }, ...rs])
      return { error: null }
    }
    const { data, error } = await supabase.from('safety_records')
      .insert({ ...row, project_id: currentProject.project_id, created_by: currentUser?.user_id }).select().single()
    if (error) return { error }
    setSafetyRecords((rs) => [data, ...rs])
    log('新增工安紀錄', `${row.record_type}·${row.title}`, { user: currentUser?.name || '系統', role: '工安' })
    return { error: null }
  }, [dbMode, currentProject, currentUser, log])

  const updateSafetyRecord = useCallback(async (id, patch) => {
    setSafetyRecords((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    if (!dbMode) return { error: null }
    const { error } = await supabase.from('safety_records').update(patch).eq('id', id)
    return { error }
  }, [dbMode])

  const deleteSafetyRecord = useCallback(async (id) => {
    setSafetyRecords((rs) => rs.filter((r) => r.id !== id))
    if (dbMode) await supabase.from('safety_records').delete().eq('id', id)
    return { error: null }
  }, [dbMode])

  // P4. 逐工項排程：設定某工項的計畫起迄（upsert by work_item_id；demo 只進記憶體）
  const setItemSchedule = useCallback(async (itemKey, patch) => {
    if (!dbMode) {
      setItemSchedules((m) => ({ ...m, [itemKey]: { ...(m[itemKey] || {}), ...patch } }))
      return { error: null }
    }
    const wi = wiMaps.byKey.get(itemKey)
    if (!wi?.id) return { error: { message: '找不到工項' } }
    setItemSchedules((m) => ({ ...m, [itemKey]: { ...(m[itemKey] || {}), ...patch } }))
    const cur = itemSchedules[itemKey] || {}
    const { error } = await supabase.from('item_schedules').upsert({
      project_id: currentProject.project_id, work_item_id: wi.id,
      planned_start: patch.planned_start !== undefined ? (patch.planned_start || null) : (cur.planned_start || null),
      planned_finish: patch.planned_finish !== undefined ? (patch.planned_finish || null) : (cur.planned_finish || null),
    }, { onConflict: 'work_item_id' })
    return { error }
  }, [dbMode, currentProject, wiMaps, itemSchedules])

  const removeItemSchedule = useCallback(async (itemKey) => {
    setItemSchedules((m) => { const n = { ...m }; delete n[itemKey]; return n })
    if (!dbMode) return { error: null }
    const wi = wiMaps.byKey.get(itemKey)
    if (wi?.id) await supabase.from('item_schedules').delete().eq('work_item_id', wi.id)
    return { error: null }
  }, [dbMode, wiMaps])

  // 變更設計：表頭 CRUD（demo 只進記憶體）------------------------------------
  const createChangeOrder = useCallback(async (input) => {
    const row = {
      co_no: input.co_no || null, title: input.title,
      co_date: input.co_date || null, status: input.status || '提出',
      reason: input.reason || null, sort_order: changeOrders.length,
    }
    if (!dbMode) {
      setChangeOrders((cs) => [...cs, { ...row, id: `CO-${Date.now()}`, items: [] }])
      return { error: null }
    }
    const { data, error } = await supabase.from('change_orders')
      .insert({ ...row, project_id: currentProject.project_id, created_by: currentUser?.user_id }).select().single()
    if (error) return { error }
    setChangeOrders((cs) => [...cs, { ...data, items: [] }])
    log('新增變更設計', `${row.co_no || ''} ${row.title}`, { user: currentUser?.name || '系統', role: '工程' })
    return { error: null }
  }, [dbMode, currentProject, changeOrders, currentUser, log])

  const updateChangeOrder = useCallback(async (id, patch) => {
    setChangeOrders((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    if (!dbMode) return { error: null }
    const { error } = await supabase.from('change_orders').update(patch).eq('id', id)
    return { error }
  }, [dbMode])

  const deleteChangeOrder = useCallback(async (id) => {
    setChangeOrders((cs) => cs.filter((c) => c.id !== id))
    if (dbMode) await supabase.from('change_orders').delete().eq('id', id) // 明細 cascade
    return { error: null }
  }, [dbMode])

  // 變更設計：追加減工項明細 CRUD --------------------------------------------
  const addChangeOrderItem = useCallback(async (coId, input) => {
    const wi = input.work_item_key ? wiMaps.byKey.get(input.work_item_key) : null
    const qty = Number(input.qty_delta) || 0
    const price = Number(input.unit_price) || 0
    const row = {
      item_no: input.item_no || wi?.item_no || null,
      description: input.description || wi?.description || '',
      unit: input.unit || wi?.unit || null,
      qty_delta: qty, unit_price: price, amount_delta: qty * price,
      note: input.note || null,
    }
    if (!dbMode) {
      setChangeOrders((cs) => cs.map((c) => (c.id === coId ? { ...c, items: [...c.items, { ...row, id: `COI-${Date.now()}` }] } : c)))
      return { error: null }
    }
    const { data, error } = await supabase.from('change_order_items')
      .insert({ ...row, change_order_id: coId, project_id: currentProject.project_id, work_item_id: wi?.id || null }).select().single()
    if (error) return { error }
    setChangeOrders((cs) => cs.map((c) => (c.id === coId ? { ...c, items: [...c.items, data] } : c)))
    return { error: null }
  }, [dbMode, currentProject, wiMaps])

  // 批次新增明細（變更預算書 diff 套用用）：demo 一次進記憶體、DB 單次 insert 多列
  const addChangeOrderItems = useCallback(async (coId, inputs) => {
    const rows = inputs.map((input) => {
      const wi = input.work_item_key ? wiMaps.byKey.get(input.work_item_key) : null
      const qty = Number(input.qty_delta) || 0
      const price = Number(input.unit_price) || 0
      return {
        item_no: input.item_no || wi?.item_no || null,
        description: input.description || wi?.description || '',
        unit: input.unit || wi?.unit || null,
        qty_delta: qty, unit_price: price, amount_delta: qty * price,
        note: input.note || null,
        _work_item_id: wi?.id || null,
      }
    })
    if (!dbMode) {
      const stamp = Date.now()
      const local = rows.map(({ _work_item_id, ...r }, i) => ({ ...r, id: `COI-${stamp}-${i}` }))
      setChangeOrders((cs) => cs.map((c) => (c.id === coId ? { ...c, items: [...c.items, ...local] } : c)))
      return { error: null }
    }
    const { data, error } = await supabase.from('change_order_items')
      .insert(rows.map(({ _work_item_id, ...r }) => ({
        ...r, change_order_id: coId, project_id: currentProject.project_id, work_item_id: _work_item_id,
      }))).select()
    if (error) return { error }
    setChangeOrders((cs) => cs.map((c) => (c.id === coId ? { ...c, items: [...c.items, ...data] } : c)))
    return { error: null }
  }, [dbMode, currentProject, wiMaps])

  const updateChangeOrderItem = useCallback(async (coId, id, patch) => {
    // qty_delta / unit_price 變動時同步重算 amount_delta
    const recompute = (it) => {
      const merged = { ...it, ...patch }
      if ('qty_delta' in patch || 'unit_price' in patch) {
        merged.amount_delta = (Number(merged.qty_delta) || 0) * (Number(merged.unit_price) || 0)
      }
      return merged
    }
    let saved = null
    setChangeOrders((cs) => cs.map((c) => (c.id === coId
      ? { ...c, items: c.items.map((it) => (it.id === id ? (saved = recompute(it)) : it)) }
      : c)))
    if (!dbMode) return { error: null }
    const dbPatch = { ...patch }
    if (saved && ('qty_delta' in patch || 'unit_price' in patch)) dbPatch.amount_delta = saved.amount_delta
    const { error } = await supabase.from('change_order_items').update(dbPatch).eq('id', id)
    return { error }
  }, [dbMode])

  const deleteChangeOrderItem = useCallback(async (coId, id) => {
    setChangeOrders((cs) => cs.map((c) => (c.id === coId ? { ...c, items: c.items.filter((it) => it.id !== id) } : c)))
    if (dbMode) await supabase.from('change_order_items').delete().eq('id', id)
    return { error: null }
  }, [dbMode])

  // P5. 品質查驗 / 缺失（三級品管流）
  const reloadQuality = useCallback(async () => {
    const qual = await loadQualityFromDB(currentProject.project_id, wiMaps.byId)
    setInspections(qual.inspections); setDefects(qual.defects)
  }, [currentProject, wiMaps])

  const createInspection = useCallback(async (input) => {
    const wi = input.work_item_key ? wiMaps.byKey.get(input.work_item_key) : null
    if (!dbMode) {
      setInspections((is) => [{
        id: `INSP-${Date.now()}`, title: input.title, location: input.location || null,
        inspection_type: input.inspection_type || '施工查驗',
        requested_date: input.requested_date || null, status: '待查驗', result_note: null,
        work_item_no: wi?.item_no || '', work_item_desc: wi?.description || '',
      }, ...is])
      return { error: null }
    }
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
    if (!dbMode) {
      setInspections((is) => is.map((i) => (i.id === insp.id ? { ...i, status: pass ? '合格' : '不合格', result_note: note || null } : i)))
      if (!pass) {
        setDefects((ds) => [{
          id: `DEF-${Date.now()}`, title: `查驗不合格：${insp.title}`, description: note || null,
          severity: '一般', location: insp.location || null, due_date: null, status: '開立', improvement_note: null,
          work_item_no: insp.work_item_no || '', work_item_desc: insp.work_item_desc || '',
        }, ...ds])
      }
      return { error: null }
    }
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
    const wi = input.work_item_key ? wiMaps.byKey.get(input.work_item_key) : null
    const markup_path = await saveMarkup(input.markup_data, 'defect')
    if (!dbMode) {
      setDefects((ds) => [{
        id: `DEF-${Date.now()}`, title: input.title, description: input.description || null,
        severity: input.severity || '一般', location: input.location || null,
        due_date: input.due_date || null, status: '開立', improvement_note: null, markup_path,
        work_item_no: wi?.item_no || '', work_item_desc: wi?.description || '',
      }, ...ds])
      return { error: null }
    }
    const { error } = await supabase.from('defects').insert({
      project_id: currentProject.project_id, work_item_id: wi?.id || null,
      title: input.title, description: input.description || null,
      severity: input.severity || '一般', location: input.location || null,
      due_date: input.due_date || null, status: '開立', created_by: currentUser?.user_id, markup_path,
    })
    if (error) return { error }
    await reloadQuality()
    log('開立缺失', input.title, { user: currentUser?.name, role: '監造' })
    return { error: null }
  }, [dbMode, currentProject, currentUser, wiMaps, saveMarkup, reloadQuality, log])

  // ── 品管自動化:自主檢查表(量化標準自動判定) + 取樣試驗(齡期追蹤) ─────────
  // 可用範本 = 專案範本 ∪ 內建 03310(尚無同源範本時顯示;首次使用才落 DB)
  const allChecklistTemplates = useMemo(() => {
    if (checklistTemplates.some((t) => t.source === TEMPLATE_03310.source)) return checklistTemplates
    return [{ id: TEMPLATE_03310.key, ...TEMPLATE_03310, builtin: true }, ...checklistTemplates]
  }, [checklistTemplates])

  const createChecklistRecord = useCallback(async ({ template, check_date, location, values, note }) => {
    const { results, overall, failed } = judgeChecklist(template, values)
    const openDefect = async () => {
      if (overall !== '不合格') return
      await createDefect({
        title: `自主檢查不合格：${template.title}`,
        description: `不合格項目：${failed.map((f) => `${f.no} ${f.item}（標準 ${f.standard}）`).join('、')}`,
        severity: '一般', location,
      })
    }
    if (!dbMode) {
      setChecklistRecords((rs) => [{
        id: `CLR-${Date.now()}`, template_id: template.id, check_date, location: location || null,
        results, overall, note: note || null,
      }, ...rs])
      await openDefect()
      return { error: null, overall }
    }
    let templateId = template.id
    if (template.builtin) {
      const { data: t, error: te } = await supabase.from('checklist_templates').insert({
        project_id: currentProject.project_id, title: template.title, source: template.source,
        items: template.items, created_by: currentUser?.user_id,
      }).select().single()
      if (te) return { error: te }
      setChecklistTemplates((ts) => [...ts, t])
      templateId = t.id
    }
    const { data: rec, error } = await supabase.from('checklist_records').insert({
      project_id: currentProject.project_id, template_id: templateId, check_date,
      location: location || null, results, overall, note: note || null, created_by: currentUser?.user_id,
    }).select().single()
    if (error) return { error }
    setChecklistRecords((rs) => [rec, ...rs])
    await openDefect()
    log('自主檢查', `${template.title} ${check_date} → ${overall || '未判定'}`, { user: currentUser?.name, role: '施工品管' })
    return { error: null, overall }
  }, [dbMode, currentProject, currentUser, createDefect, log])

  const deleteChecklistRecord = useCallback(async (id) => {
    setChecklistRecords((rs) => rs.filter((r) => r.id !== id))
    if (dbMode) await supabase.from('checklist_records').delete().eq('id', id)
  }, [dbMode])

  // 建立試體組(手動或由日誌帶入);自動算 7/28 天到期日
  const createTestSamples = useCallback(async (rows) => {
    const prepared = rows.map((r) => ({
      sample_no: r.sample_no || `TS-${(r.sampled_date || '').replaceAll('-', '')}`,
      test_item: r.test_item || '混凝土抗壓', fc: r.fc ?? null,
      sampled_date: r.sampled_date, location: r.location || null, cylinders: r.cylinders ?? 6,
      ...sampleDues(r.sampled_date), d7_value: null, d28_values: null, status: '待試驗', note: r.note || null,
    }))
    if (!dbMode) {
      const stamp = Date.now()
      setTestSamples((ss) => [...prepared.map((p, i) => ({ ...p, id: `TS-${stamp}-${i}` })), ...ss]
        .sort((a, b) => b.sampled_date.localeCompare(a.sampled_date)))
      return { error: null, count: prepared.length }
    }
    const { data, error } = await supabase.from('test_samples')
      .insert(prepared.map((p) => ({ ...p, project_id: currentProject.project_id, created_by: currentUser?.user_id })))
      .select()
    if (error) return { error }
    setTestSamples((ss) => [...data, ...ss].sort((a, b) => b.sampled_date.localeCompare(a.sampled_date)))
    log('建立取樣試體', `${data.length} 組`, { user: currentUser?.name, role: '施工品管' })
    return { error: null, count: data.length }
  }, [dbMode, currentProject, currentUser, log])

  // 掃施工日誌(材料含混凝土) → 補建缺漏的取樣組
  const generateSamplesFromLogs = useCallback(async () => {
    const pending = pendingSamplesFromLogs(siteLogs, testSamples)
    if (!pending.length) return { error: null, count: 0 }
    return createTestSamples(pending)
  }, [siteLogs, testSamples, createTestSamples])

  // 更新試體(填 7 天參考值 / 28 天各試體值);28 天值依 fc′ 自動判定,不合格自動開缺失
  const updateTestSample = useCallback(async (id, patch) => {
    let judged = null
    setTestSamples((ss) => ss.map((s) => {
      if (s.id !== id) return s
      const merged = { ...s, ...patch }
      if ('d28_values' in patch || 'fc' in patch) {
        const r = judgeConcrete(merged.fc, merged.d28_values)
        merged.status = r.status || '待試驗'
        judged = { merged, r }
      }
      return merged
    }))
    if (judged?.r.status === '不合格') {
      const { merged, r } = judged
      await createDefect({
        title: `試體抗壓不合格：${merged.sample_no}`,
        description: `28天抗壓 平均 ${Math.round(r.avg)} / 最低 ${Math.round(r.min)} kgf/cm²，未達 fc′ ${merged.fc}（標準：任一 ≥0.85fc′ 且平均 ≥fc′）`,
        severity: '嚴重', location: merged.location || '',
      })
    }
    if (!dbMode) return { error: null }
    const dbPatch = { ...patch }
    if (judged) dbPatch.status = judged.merged.status
    const { error } = await supabase.from('test_samples').update(dbPatch).eq('id', id)
    return { error }
  }, [dbMode, createDefect])

  const deleteTestSample = useCallback(async (id) => {
    setTestSamples((ss) => ss.filter((s) => s.id !== id))
    if (dbMode) await supabase.from('test_samples').delete().eq('id', id)
  }, [dbMode])

  // ── 監造協作:送審(Submittal)/工程疑義(RFI)/成員管理 ─────────────────────
  const createSubmittal = useCallback(async (input) => {
    const row = {
      submittal_no: input.submittal_no || `SUB-${String(submittals.length + 1).padStart(3, '0')}`,
      title: input.title, category: input.category || '施工計畫',
      revision: 0, status: '已提送',
      submitted_date: input.submitted_date || null, due_date: input.due_date || null,
      decided_date: null, review_note: null, attachment_note: input.attachment_note || null,
    }
    if (!dbMode) {
      setSubmittals((ss) => [{ ...row, id: `SUB-${Date.now()}` }, ...ss])
      return { error: null }
    }
    const { data, error } = await supabase.from('submittals')
      .insert({ ...row, project_id: currentProject.project_id, created_by: currentUser?.user_id }).select().single()
    if (error) return { error }
    setSubmittals((ss) => [data, ...ss])
    log('提送送審', `${row.submittal_no} ${row.title}`, { user: currentUser?.name, role: '施工' })
    return { error: null }
  }, [dbMode, currentProject, currentUser, submittals, log])

  // 監造審定:審核中|核准|核備|退回補正|駁回
  const decideSubmittal = useCallback(async (id, status, review_note) => {
    const patch = { status, review_note: review_note || null }
    if (status !== '審核中') patch.decided_date = new Date().toISOString().slice(0, 10)
    setSubmittals((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)))
    if (!dbMode) return { error: null }
    const { error } = await supabase.from('submittals').update(patch).eq('id', id)
    if (!error) log('送審審定', `${status}`, { user: currentUser?.name, role: '監造' })
    return { error }
  }, [dbMode, currentUser, log])

  // 施工修正再送:退回補正 → 已提送(revision +1)
  const resubmitSubmittal = useCallback(async (id) => {
    let patch = null
    setSubmittals((ss) => ss.map((s) => {
      if (s.id !== id) return s
      patch = { status: '已提送', revision: (s.revision || 0) + 1, decided_date: null,
        submitted_date: new Date().toISOString().slice(0, 10) }
      return { ...s, ...patch }
    }))
    if (!dbMode || !patch) return { error: null }
    const { error } = await supabase.from('submittals').update(patch).eq('id', id)
    return { error }
  }, [dbMode])

  const deleteSubmittal = useCallback(async (id) => {
    setSubmittals((ss) => ss.filter((s) => s.id !== id))
    if (dbMode) await supabase.from('submittals').delete().eq('id', id)
  }, [dbMode])

  const createRfi = useCallback(async (input) => {
    const markup_path = await saveMarkup(input.markup_data, 'rfi')
    const row = {
      markup_path,
      rfi_no: input.rfi_no || `RFI-${String(rfis.length + 1).padStart(3, '0')}`,
      title: input.title, question: input.question || null,
      answer: null, status: '待回覆',
      asked_date: input.asked_date || new Date().toISOString().slice(0, 10),
      due_date: input.due_date || null, answered_date: null,
      cost_impact: !!input.cost_impact, schedule_impact: !!input.schedule_impact,
    }
    if (!dbMode) {
      setRfis((rs) => [{ ...row, id: `RFI-${Date.now()}` }, ...rs])
      return { error: null }
    }
    const { data, error } = await supabase.from('rfis')
      .insert({ ...row, project_id: currentProject.project_id, created_by: currentUser?.user_id }).select().single()
    if (error) return { error }
    setRfis((rs) => [data, ...rs])
    log('提出工程疑義', `${row.rfi_no} ${row.title}`, { user: currentUser?.name, role: '施工' })
    return { error: null }
  }, [dbMode, currentProject, currentUser, rfis, saveMarkup, log])

  const answerRfi = useCallback(async (id, answer) => {
    const patch = { answer, status: '已回覆', answered_date: new Date().toISOString().slice(0, 10) }
    setRfis((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    if (!dbMode) return { error: null }
    const { error } = await supabase.from('rfis').update(patch).eq('id', id)
    if (!error) log('回覆工程疑義', answer.slice(0, 30), { user: currentUser?.name, role: '監造' })
    return { error }
  }, [dbMode, currentUser, log])

  const closeRfi = useCallback(async (id) => {
    setRfis((rs) => rs.map((r) => (r.id === id ? { ...r, status: '已結案' } : r)))
    if (dbMode) await supabase.from('rfis').update({ status: '已結案' }).eq('id', id)
  }, [dbMode])

  const deleteRfi = useCallback(async (id) => {
    setRfis((rs) => rs.filter((r) => r.id !== id))
    if (dbMode) await supabase.from('rfis').delete().eq('id', id)
  }, [dbMode])

  // 成員管理(RPC:email 對照 auth.users 必須在伺服器端做)
  const listMembers = useCallback(async () => {
    if (!dbMode) {
      return users.map((u) => ({ user_id: u.user_id, full_name: u.name, company: u.company, org_type: u.org_type, member_role: u.user_id === 'U1' ? 'admin' : 'member' }))
    }
    const { data } = await supabase.rpc('list_project_members', { p_project: currentProject.project_id })
    return data || []
  }, [dbMode, currentProject])

  const addMemberByEmail = useCallback(async (email, role = 'member') => {
    if (!dbMode) return { error: { message: 'demo 模式不支援邀請成員' } }
    const { data, error } = await supabase.rpc('add_member_by_email', {
      p_project: currentProject.project_id, p_email: email, p_role: role,
    })
    if (error) return { error }
    if (data === 'not_found') return { error: { message: '找不到這個 email 的帳號，請對方先註冊。' } }
    log('加入成員', email, { user: currentUser?.name, role: '專案' })
    return { error: null }
  }, [dbMode, currentProject, currentUser, log])

  const removeMember = useCallback(async (userId) => {
    if (!dbMode) return { error: { message: 'demo 模式不支援移除成員' } }
    const { error } = await supabase.rpc('remove_member', { p_project: currentProject.project_id, p_user: userId })
    return { error }
  }, [dbMode, currentProject])

  // 缺失狀態推進：開立 → 改善中 → 待複查 → 已結案
  const updateDefectStatus = useCallback(async (defectId, status, extra = {}) => {
    const patch = { status }
    if (extra.improvement_note !== undefined) patch.improvement_note = extra.improvement_note
    if (status === '已結案') patch.closed_at = new Date().toISOString()
    if (!dbMode) {
      setDefects((ds) => ds.map((d) => (d.id === defectId ? { ...d, ...patch } : d)))
      return { error: null }
    }
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
    else setInspections((is) => is.filter((i) => i.id !== id))
  }, [dbMode, reloadQuality])

  const deleteDefect = useCallback(async (id) => {
    if (dbMode) { await supabase.from('defects').delete().eq('id', id); await reloadQuality() }
    else setDefects((ds) => ds.filter((d) => d.id !== id))
  }, [dbMode, reloadQuality])

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
  }, [dbMode, currentProject])

  // 刪除專案（RPC，security definer 連同所有相依資料一併刪）
  const deleteProject = useCallback(async (id) => {
    const { error } = await supabase.rpc('delete_project', { p_id: id })
    if (error) return { error }
    wiCacheDel(id)
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

  const value = {
    // state
    project: currentProject || project, currentUser, setCurrentUser,
    isSupabaseConfigured, signUp, signIn, logout,
    currentProject, projects, projectLoading, createProject, switchProject,
    workItems, workItemsSource, importWorkItems, dbMode, demoMode, can,
    siteLogs, saveSiteLog, fillValuationFromSiteLogs,
    listSitePhotos, uploadSitePhoto, deleteSitePhoto, readWhiteboard, draftMonthlyReview, describeDefect,
    obligations, parseContract, updateObligationStatus, updateProjectAnchors,
    costItems, createCostItem, updateCostItem, deleteCostItem,
    safetyRecords, createSafetyRecord, updateSafetyRecord, deleteSafetyRecord,
    itemSchedules, setItemSchedule, removeItemSchedule,
    changeOrders, createChangeOrder, updateChangeOrder, deleteChangeOrder,
    addChangeOrderItem, addChangeOrderItems, updateChangeOrderItem, deleteChangeOrderItem,
    inspections, defects, createInspection, recordInspectionResult, createDefect, updateDefectStatus,
    checklistTemplates: allChecklistTemplates, checklistRecords, createChecklistRecord, deleteChecklistRecord,
    testSamples, createTestSamples, generateSamplesFromLogs, updateTestSample, deleteTestSample,
    submittals, createSubmittal, decideSubmittal, resubmitSubmittal, deleteSubmittal,
    rfis, createRfi, answerRfi, closeRfi, deleteRfi,
    listMembers, addMemberByEmail, removeMember, resolveMarkup,
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
