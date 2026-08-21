// 資料存取層:DB 列 ↔ 前端形狀的轉換、各領域的載入函式、work_items 本地快取、
// 檔案/圖片的 base64 與文字抽取。純函式(不含 React state),store 各 slice 共用。
import { supabase } from '../lib/supabase.js'
// 所有列表載入一律走分頁,避免 PostgREST max_rows 靜默截斷(見 pagedQuery.js 開頭)
import { pageAll, pageAllIn } from '../lib/pagedQuery.js'
// pdf.js worker 自帶(B-12):?url 只打包資產網址,worker 檔進自家 dist——
// 機關內網/防火牆擋 CDN 時,契約 PDF 抽字不再直接壞掉。
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// DB projects 列 → 與 seed.project 同形狀（讓既有頁面不需改）
export function normalizeProject(row) {
  return {
    project_id: row.id, id: row.id,
    project_name: row.name, project_code: row.code,
    owner_name: row.owner_name, contractor_name: row.contractor_name,
    supervisor_name: row.supervisor_name, location: row.location,
    start_date: row.start_date, end_date: row.end_date, status: row.status,
    award_date: row.award_date, notice_date: row.notice_date, commencement_date: row.commencement_date,
    contract_total: row.contract_total ?? null, // 契約價金總額(手填);罰款試算優先於 BOQ 加總
    formal_mode: !!row.formal_mode,
    latitude: row.latitude ?? null, longitude: row.longitude ?? null, // 工地座標(CWA 天氣用)
    ai_plan: row.ai_plan || 'standard', // AI 方案(批 B:前端 aiEnabled 據此隱藏入口)
  }
}

// 抓某專案全部 work_items（PostgREST 單次上限，需分頁）
export async function fetchAllWorkItems(projectId) {
  return pageAll((from, to) => supabase.from('work_items').select('*')
    .eq('project_id', projectId).order('sort_order').order('id').range(from, to), '標單工項')
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
export async function wiCacheGet(projectId) {
  try {
    const db = await wiDB()
    return await new Promise((resolve) => {
      const req = db.transaction('work_items').objectStore('work_items').get(projectId)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => resolve(null)
    })
  } catch { return null }
}
export async function wiCachePut(projectId, rows) {
  try { const db = await wiDB(); db.transaction('work_items', 'readwrite').objectStore('work_items').put(rows, projectId) } catch { /* 快取失敗不影響功能 */ }
}
export async function wiCacheDel(projectId) {
  try { const db = await wiDB(); db.transaction('work_items', 'readwrite').objectStore('work_items').delete(projectId) } catch { /* noop */ }
}

// DB work_items 列 → 與 workItems.json 同形狀（parent_id→parent_key 還原、數值轉 Number）
export function dbToWorkItems(rows, project) {
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

// 從 DB 載入估驗（valuations + valuation_items），組回 { items: {item_key: 累計完成數量} } 形狀
export async function loadValuationsFromDB(projectId, idToKey) {
  const vals = await pageAll((from, to) => supabase.from('valuations')
    .select('*').eq('project_id', projectId).order('period_no').order('id').range(from, to), '估驗')
  if (!vals?.length) return []
  const vItems = await pageAllIn(vals.map((v) => v.id), (chunk, from, to) => supabase.from('valuation_items')
    .select('valuation_id, work_item_id, cum_qty').in('valuation_id', chunk).order('id').range(from, to), '估驗明細')
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
export async function loadScheduleFromDB(project) {
  const data = await pageAll((from, to) => supabase.from('schedule_periods')
    .select('*').eq('project_id', project.project_id).order('period_label').order('id').range(from, to), '預定進度')
  if (!data?.length) return null
  return {
    start: project.start_date, end: project.end_date,
    months: data.map((r) => ({ label: r.period_label, plannedPct: Number(r.planned_pct) })),
  }
}

// 從 DB 載入施工日誌（daily_logs + daily_log_items），組回 { items: {item_key: 當日數量} }
export async function loadSiteLogsFromDB(projectId, idToKey) {
  const logs = await pageAll((from, to) => supabase.from('daily_logs')
    .select('*').eq('project_id', projectId).order('log_date', { ascending: false }).order('id').range(from, to), '施工日誌')
  if (!logs?.length) return []
  const items = await pageAllIn(logs.map((l) => l.id), (chunk, from, to) => supabase.from('daily_log_items')
    .select('daily_log_id, work_item_id, qty_today').in('daily_log_id', chunk).order('id').range(from, to), '日誌明細')
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
export async function loadQcFromDB(projectId) {
  const tpls = await pageAll((from, to) => supabase.from('checklist_templates')
    .select('*').eq('project_id', projectId).order('created_at').order('id').range(from, to), '檢查表範本')
  const recs = await pageAll((from, to) => supabase.from('checklist_records')
    .select('*').eq('project_id', projectId).order('check_date', { ascending: false }).order('id').range(from, to), '自主檢查紀錄')
  const samples = await pageAll((from, to) => supabase.from('test_samples')
    .select('*').eq('project_id', projectId).order('sampled_date', { ascending: false }).order('id').range(from, to), '取樣試體')
  return { templates: tpls || [], records: recs || [], samples: samples || [] }
}

// 從 DB 載入缺失(統一引擎:domain=quality|safety)。缺失不依賴標單,
// 匯標單前 byId 可為空 Map(工項欄位留白)。
export async function loadDefectsFromDB(projectId, byId = new Map()) {
  const data = await pageAll((from, to) => supabase.from('defects')
    .select('*').eq('project_id', projectId).order('created_at', { ascending: false }).order('id').range(from, to), '缺失')
  return (data || []).map((r) => ({
    ...r,
    work_item_no: byId.get(r.work_item_id)?.item_no || '',
    work_item_desc: byId.get(r.work_item_id)?.description || '',
  }))
}

// 從 DB 載入查驗 + 缺失，並把 work_item 資訊去正規化方便顯示
// (查驗的 checklist_record_id〔S-2 檢附自主檢查表〕走 select('*'),不需點名)
export async function loadQualityFromDB(projectId, byId) {
  const wi = (id) => byId.get(id)
  const deco = (r) => ({ ...r, work_item_no: wi(r.work_item_id)?.item_no || '', work_item_desc: wi(r.work_item_id)?.description || '' })
  const insp = await pageAll((from, to) => supabase.from('inspections').select('*')
    .eq('project_id', projectId).order('created_at', { ascending: false }).order('id').range(from, to), '查驗')
  const defs = await loadDefectsFromDB(projectId, byId)
  return { inspections: (insp || []).map(deco), defects: defs }
}

// 從 DB 載入契約義務清單
export async function loadObligationsFromDB(projectId) {
  const data = await pageAll((from, to) => supabase.from('contract_obligations')
    .select('*').eq('project_id', projectId).neq('status', '不適用')
    .order('sort_order').order('id').range(from, to), '契約義務')
  return data || []
}

// 從 DB 載入成本項目（預算 vs 實際、分包）
export async function loadCostItemsFromDB(projectId) {
  const data = await pageAll((from, to) => supabase.from('cost_items')
    .select('*').eq('project_id', projectId).order('sort_order').order('created_at').order('id').range(from, to), '成本項目')
  return data || []
}

// 從 DB 載入變更設計 + 追加減工項明細（明細 nest 在各變更下）
export async function loadChangeOrdersFromDB(projectId) {
  const cos = await pageAll((from, to) => supabase.from('change_orders')
    .select('*').eq('project_id', projectId).order('sort_order').order('created_at').order('id').range(from, to), '變更設計')
  if (!cos?.length) return []
  const items = await pageAllIn(cos.map((c) => c.id), (chunk, from, to) => supabase.from('change_order_items')
    .select('*').in('change_order_id', chunk).order('sort_order').order('created_at').order('id').range(from, to), '變更明細')
  const byCo = new Map(cos.map((c) => [c.id, []]))
  for (const it of items || []) byCo.get(it.change_order_id)?.push(it)
  return cos.map((c) => ({ ...c, items: byCo.get(c.id) || [] }))
}

// 從 DB 載入工安紀錄（自主檢查 / 缺失 / 教育訓練 / 危害告知）
export async function loadSafetyFromDB(projectId) {
  const data = await pageAll((from, to) => supabase.from('safety_records').select('*').eq('project_id', projectId)
    .order('record_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(from, to), '工安紀錄')
  return data || []
}

// 從 DB 載入 ITP 檢驗停留點,去正規化工項資訊(顯示+日誌活動比對用)
export async function loadItpFromDB(projectId, byId, idToKey) {
  const data = await pageAll((from, to) => supabase.from('inspection_points')
    .select('*').eq('project_id', projectId).order('sort_order').order('created_at').order('id').range(from, to), '檢驗停留點')
  return (data || []).map((r) => ({
    ...r,
    work_item_key: r.work_item_id ? (idToKey.get(r.work_item_id) || null) : null,
    work_item_no: byId.get(r.work_item_id)?.item_no || '',
    work_item_desc: byId.get(r.work_item_id)?.description || '',
  }))
}

// 從 DB 載入協作三表(送審 / 工程疑義 / 觀察事項)。原本散在 store.jsx 內嵌查詢且未分頁,
// 收回來跟其他領域一致,才吃得到分頁與統一的錯誤標籤。
export async function loadSubmittalsFromDB(projectId) {
  return pageAll((from, to) => supabase.from('submittals')
    .select('*').eq('project_id', projectId).order('created_at', { ascending: false }).order('id').range(from, to), '送審')
}

export async function loadRfisFromDB(projectId) {
  return pageAll((from, to) => supabase.from('rfis')
    .select('*').eq('project_id', projectId).order('created_at', { ascending: false }).order('id').range(from, to), '工程疑義')
}

export async function loadObservationsFromDB(projectId) {
  return pageAll((from, to) => supabase.from('observations')
    .select('*').eq('project_id', projectId).order('created_at', { ascending: false }).order('id').range(from, to), '觀察事項')
}

// 從 DB 載入驗收/結算事件(一階段一筆,依建立時間排序)
export async function loadAcceptanceFromDB(projectId) {
  const data = await pageAll((from, to) => supabase.from('acceptance_events')
    .select('*').eq('project_id', projectId).order('created_at').order('id').range(from, to), '驗收事件')
  return data || []
}

// 從 DB 載入逐工項排程，回傳 { item_key: { planned_start, planned_finish } }
export async function loadItemSchedulesFromDB(projectId, idToKey) {
  const data = await pageAll((from, to) => supabase.from('item_schedules').select('*')
    .eq('project_id', projectId).order('id').range(from, to), '逐工項排程')
  const map = {}
  for (const r of data || []) {
    const key = idToKey.get(r.work_item_id)
    if (key) map[key] = { planned_start: r.planned_start, planned_finish: r.planned_finish }
  }
  return map
}

// 壓縮並轉 base64(去掉 data: 前綴)。長邊降到 1600px、JPEG 0.8 → 省 token、上傳更快。
export function imageToBase64(file, maxPx = 1600) {
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
export function fileToBase64(file) {
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
export async function extractContractText(file) {
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
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
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
