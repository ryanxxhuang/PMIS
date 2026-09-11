// Agent 唯讀查詢工具七支(B4 由 agentTools.ts 抽出)。
// ---------------------------------------------------------------------------
// 全部只讀不寫。所有業務查詢都走「呼叫者 JWT 建的 userClient」→ 自動套 RLS;
// 但每個查詢仍逐一 .eq('project_id', …) 綁定本案 —— 縱深防禦,不單靠 RLS。
// 這裡絕不接 service role client(見 agentTools.ts makeToolExec 的參數說明)。
//
// 欄位名以 supabase/migrations/20260711000000_baseline.sql 為準:
//   * work_items 沒有 item_code/name 欄 —— 實際是 item_no / ref_item_code / description。
//   * test_samples 沒有 work_item_id —— 試體無法直接對應工項(批5 evidence_links 前先降級)。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { BallSide } from './agentRole.ts'
import { computeObligationDueUTC, diffDays, formatDate, parseDateUTC, taipeiTodayUTC } from './contractDue.ts'
import { isUuid } from './uuid.ts'
import { likePattern, isDate, toolError, capList } from './agentToolCommon.ts'
import { collectOpenBallItems } from './ballInCourt.ts'

// ── 各工具實作 ───────────────────────────────────────────────────────────────

export async function searchBoq(db: SupabaseClient, projectId: string, input: Record<string, unknown>) {
  const keyword = input.keyword
  if (typeof keyword !== 'string' || !keyword.trim()) return { error: 'keyword 必須是非空字串' }
  let limit = 10
  if (input.limit !== undefined) {
    if (typeof input.limit !== 'number' || !Number.isFinite(input.limit)) return { error: 'limit 必須是數字' }
    limit = Math.min(20, Math.max(1, Math.floor(input.limit)))
  }
  const pat = likePattern(keyword)
  const { data, error } = await db
    .from('work_items')
    .select('id, item_no, ref_item_code, description, unit, quantity, unit_price, amount')
    .eq('project_id', projectId)
    .or(`item_no.ilike.${pat},ref_item_code.ilike.${pat},description.ilike.${pat}`)
    .order('sort_order', { ascending: true })
    .limit(limit)
  if (error) return toolError('searchBoq', error)
  if (!data?.length) return { note: '查無符合的工項,換個關鍵字試試' }
  return { items: data }
}

export async function listDailyLogs(db: SupabaseClient, projectId: string, input: Record<string, unknown>) {
  if (!isDate(input.from) || !isDate(input.to)) return { error: 'from/to 必須是 YYYY-MM-DD' }
  const fromMs = parseDateUTC(input.from)
  const toMs = parseDateUTC(input.to)
  if (fromMs == null || toMs == null || fromMs > toMs) return { error: '日期區間不合法(from 需 ≤ to)' }
  if (diffDays(toMs, fromMs) > 60) return { error: '區間超過 60 天,請縮小範圍分段查詢' }
  const workItemId = input.work_item_id
  if (workItemId !== undefined && !isUuid(workItemId)) return { error: 'work_item_id 必須是 UUID' }

  const { data, error } = await db
    .from('daily_logs')
    .select('id, log_date, weather, weather_am, weather_pm, work_summary, status, labor, daily_log_items(work_item_id, qty_today, note)')
    .eq('project_id', projectId)
    .gte('log_date', input.from)
    .lte('log_date', input.to)
    .order('log_date', { ascending: true })
  if (error) return toolError('listDailyLogs', error)

  let logs = (data ?? []) as Array<Record<string, unknown> & { daily_log_items?: Array<{ work_item_id: string }> }>
  if (workItemId) {
    logs = logs
      .map((l) => ({ ...l, daily_log_items: (l.daily_log_items ?? []).filter((i) => i.work_item_id === workItemId) }))
      .filter((l) => (l.daily_log_items ?? []).length > 0)
  }
  if (!logs.length) return { note: '此區間查無施工日誌(或該工項無填報數量)' }
  return { logs }
}

export async function getValuation(db: SupabaseClient, projectId: string, input: Record<string, unknown>) {
  let q = db
    .from('valuations')
    .select(
      'id, period_no, period_start, period_end, valuation_date, retention_pct, status, note, invoice_date, paid_date, paid_amount, valuation_items(work_item_id, cum_qty, cum_pct, amount_cum, amount_period, source, work_items(item_no, description, unit))',
    )
    .eq('project_id', projectId)
  if (input.period_no !== undefined) {
    if (typeof input.period_no !== 'number' || !Number.isInteger(input.period_no) || input.period_no < 1) {
      return { error: 'period_no 必須是正整數' }
    }
    q = q.eq('period_no', input.period_no)
  } else {
    q = q.order('period_no', { ascending: false }).limit(1)
  }
  const { data, error } = await q
  if (error) return toolError('getValuation', error)
  const row = (data ?? [])[0] as (Record<string, unknown> & { valuation_items?: unknown[] }) | undefined
  if (!row) return { note: input.period_no !== undefined ? '查無此期估驗' : '本案尚無估驗紀錄' }
  const capped = capList(row.valuation_items as unknown[])
  return { valuation: { ...row, valuation_items: capped.rows }, ...(capped.note ? { items_note: capped.note } : {}) }
}

export async function getRequirements(db: SupabaseClient, projectId: string, input: Record<string, unknown>) {
  const topic = input.topic
  if (topic !== undefined && (typeof topic !== 'string' || topic.length > 100)) {
    return { error: 'topic 必須是 100 字內的字串' }
  }
  let limit = 15
  if (input.limit !== undefined) {
    if (typeof input.limit !== 'number' || !Number.isFinite(input.limit)) return { error: 'limit 必須是數字' }
    limit = Math.min(30, Math.max(1, Math.floor(input.limit)))
  }
  const pat = topic ? likePattern(topic) : null

  // 到期日確定性推算需要專案基準日(決標/開工通知/開工/竣工)——由程式算,不是 AI 算
  const { data: proj } = await db
    .from('projects')
    .select('award_date, notice_date, commencement_date, end_date')
    .eq('id', projectId)
    .maybeSingle()
  const today = taipeiTodayUTC()

  let obQ = db
    .from('contract_obligations')
    .select('id, title, category, trigger_event, offset_days, offset_dir, fixed_date, recurring, recurring_day, recurring_weekday, recurring_month, responsible, penalty, source_clause, source_page, status, note')
    .eq('project_id', projectId)
    .neq('status', '不適用')
    .order('sort_order', { ascending: true })
    .limit(limit)
  if (pat) obQ = obQ.or(`title.ilike.${pat},penalty.ilike.${pat},note.ilike.${pat}`)
  const { data: obligations, error: obError } = await obQ
  if (obError) return toolError('getRequirements', obError)

  const obligationRows = (obligations ?? []).map((ob) => {
    const due = proj ? computeObligationDueUTC(ob, proj, today) : null
    return {
      ...ob,
      due_date: due != null ? formatDate(due) : null,
      days_left: due != null ? diffDays(due, today) : null, // 負數=已逾期(程式推算,非 AI 計算)
    }
  })

  // 已核定履約需求(requirements):只取 approved —— 未審核的 AI 草稿不可當契約事實引用
  let reqRows: unknown[] | { note: string } = []
  let reqQ = db
    .from('requirements')
    .select('id, title, description, requirement_type, acceptance_criteria, evidence_requirement, status')
    .eq('project_id', projectId)
    .eq('status', 'approved')
    .limit(limit)
  if (pat) reqQ = reqQ.or(`title.ilike.${pat},description.ilike.${pat}`)
  const { data: reqs, error: reqError } = await reqQ
  if (reqError) reqRows = { note: '本案無此資料' } // 表不存在或無權限時優雅降級,不讓整支工具失敗
  else reqRows = reqs ?? []

  if (!obligationRows.length && (Array.isArray(reqRows) ? !reqRows.length : true)) {
    return { note: topic ? '查無符合主題的契約重點' : '本案尚未匯入契約重點' }
  }
  return { contract_obligations: obligationRows, approved_requirements: reqRows }
}

export async function listMyOpenItems(db: SupabaseClient, projectId: string, _input: Record<string, unknown>) {
  // 「我方」= 呼叫者的組織別(伺服器端 RPC,不信任 client 傳值)
  const { data: orgType } = await db.rpc('my_org_type')
  const side: BallSide =
    orgType === 'supervisor' ? 'supervisor' : orgType === 'owner' ? 'owner' : 'contractor'
  const today = taipeiTodayUTC()
  const sideLabel = side === 'contractor' ? '廠商' : side === 'supervisor' ? '監造' : '機關'

  const collected = await collectOpenBallItems(db, projectId, today)
  if ('error' in collected) return { error: collected.error }
  const items = collected.items
    .filter((i) => i.side === side)
    .map(({ side: _side, ...rest }) => rest) // 工具輸出維持原形(不含 side 欄)
  if (!items.length) return { note: '目前沒有球在我方的待辦', side: sideLabel }
  return { side: sideLabel, items: items.slice(0, 30) }
}

export async function findEvidence(db: SupabaseClient, projectId: string, input: Record<string, unknown>) {
  if (!isUuid(input.work_item_id)) return { error: 'work_item_id 必須是 UUID' }
  const wi = input.work_item_id
  const from = input.from
  const to = input.to
  if (from !== undefined && !isDate(from)) return { error: 'from 必須是 YYYY-MM-DD' }
  if (to !== undefined && !isDate(to)) return { error: 'to 必須是 YYYY-MM-DD' }

  // 施工日誌(有數量的):經 daily_logs inner join 綁定本案 —— 縱深防禦
  let logQ = db
    .from('daily_log_items')
    .select('qty_today, note, daily_logs!inner(id, project_id, log_date, status)')
    .eq('work_item_id', wi)
    .eq('daily_logs.project_id', projectId)
    .gt('qty_today', 0)
  if (from) logQ = logQ.gte('daily_logs.log_date', from)
  if (to) logQ = logQ.lte('daily_logs.log_date', to)

  let inspQ = db
    .from('inspections')
    .select('id, title, inspection_type, status, requested_date, inspected_at, result_note')
    .eq('project_id', projectId)
    .eq('work_item_id', wi)
  if (from) inspQ = inspQ.gte('requested_date', from)
  if (to) inspQ = inspQ.lte('requested_date', to)

  let chkQ = db
    .from('checklist_records')
    .select('id, check_date, location, overall, rev')
    .eq('project_id', projectId)
    .eq('work_item_id', wi)
  if (from) chkQ = chkQ.gte('check_date', from)
  if (to) chkQ = chkQ.lte('check_date', to)

  let photoQ = db
    .from('photos')
    .select('id, storage_path, caption, taken_at, daily_log_id')
    .eq('project_id', projectId)
    .eq('work_item_id', wi)
  if (from) photoQ = photoQ.gte('taken_at', `${from}T00:00:00+08:00`)
  if (to) photoQ = photoQ.lte('taken_at', `${to}T23:59:59+08:00`)

  const [logs, inspections, checklists, photos] = await Promise.all([logQ, inspQ, chkQ, photoQ])
  const firstError = [logs, inspections, checklists, photos].find((r) => r.error)
  if (firstError?.error) return toolError('findEvidence', firstError.error)

  const logCap = capList(logs.data)
  const photoCap = capList(photos.data)
  return {
    daily_log_quantities: logCap.rows,
    inspections: inspections.data ?? [],
    checklist_records: checklists.data ?? [],
    photos: photoCap.rows,
    // 試體(test_samples)目前沒有工項關聯欄位,無法對應到指定工項 —— 批5 的
    // evidence_links 上線前先誠實降級,不做 location 文字模糊猜測。
    test_samples: { note: '本案試體紀錄未與工項直接關聯,無法依工項調閱' },
    ...(logCap.note ? { daily_log_note: logCap.note } : {}),
    ...(photoCap.note ? { photos_note: photoCap.note } : {}),
  }
}

// 白名單:table 名 → select 字串(含合理的明細 embed)。絕不動態拼接任意表名。
export const RECORD_SELECTS = {
  daily_logs: '*, daily_log_items(work_item_id, qty_today, note)',
  inspections: '*',
  defects: '*',
  submittals: '*',
  rfis: '*',
  change_orders: '*, change_order_items(item_no, description, unit, qty_delta, unit_price, amount_delta, note)',
  valuations: '*, valuation_items(work_item_id, cum_qty, cum_pct, amount_cum, amount_period, source)',
  safety_records: '*',
} as const

export async function getRecord(db: SupabaseClient, projectId: string, input: Record<string, unknown>) {
  const table = input.table
  // 用 hasOwnProperty 而非 `in`:`in` 會命中原型鏈('toString' 等)而讓非白名單字串過關
  if (typeof table !== 'string' || !Object.prototype.hasOwnProperty.call(RECORD_SELECTS, table)) {
    return { error: `table 必須是白名單之一:${Object.keys(RECORD_SELECTS).join('、')}` }
  }
  if (!isUuid(input.id)) return { error: 'id 必須是 UUID' }
  const { data, error } = await db
    .from(table)
    .select(RECORD_SELECTS[table as keyof typeof RECORD_SELECTS])
    .eq('id', input.id)
    .eq('project_id', projectId)
    .maybeSingle()
    // 動態白名單 select 無法由 PostgREST 的字串型別解析器推導。
    .returns<Record<string, unknown> & { valuation_items?: unknown[] }>()
  if (error) return toolError('getRecord', error)
  if (!data) return { note: '找不到這筆紀錄(或不屬於本案/無權限)' }
  const row = data
  if (Array.isArray(row.valuation_items)) {
    const capped = capList(row.valuation_items)
    row.valuation_items = capped.rows
    if (capped.note) (row as Record<string, unknown>).valuation_items_note = capped.note
  }
  return { record: row }
}
