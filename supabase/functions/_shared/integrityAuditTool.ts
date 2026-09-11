// 監造/機關 Agent:跨文件勾稽 run_integrity_audit(B4 由 agentTools.ts 抽出)。
// ---------------------------------------------------------------------------
// findings 由確定性引擎 buildIntegrityFindings(integrityAudit.ts)產出,本工具
// 不過濾、不重排、不改寫 —— AI 只能引用,不參與判定。create_draft 時只寫
// agent_actions(audit_note),不碰任何業務表。
// fetchAllRows 是 PostgREST 1000 列上限的分頁抓齊工具,已匯出供其他 function 使用。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { AgentRole } from './agentPersona.ts'
import { buildIntegrityFindings, isConcretePourItem } from './integrityAudit.ts'
import type { IntegrityLeaf, PourDate, TestSample } from './integrityAudit.ts'
import { toolError } from './agentToolCommon.ts'

// ── 批4(任務A):run_integrity_audit 執行 ───────────────────────────────────
// 用 userClient(RLS + .eq(project_id) 縱深防禦)查齊 buildIntegrityFindings 的
// 六個輸入,「組法與 src/pages/web/RiskAudit.jsx 完全一致」(兩邊如改要同步):
//   * leaves:is_billable 且非 rollup 且無可計價子項的工項(parent_id→item_key
//     還原 parent_key,同 db.js dbToWorkItems;RiskAudit 的 childrenMap 亦只收
//     billable 非 rollup 項,已核准變更只改 quantity/amount 不改樹形)。
//   * loggedQty:全部施工日誌明細逐工項累加當日數量(item_key 為鍵;
//     同 loadSiteLogsFromDB 只收 item_key 與 qty_today 皆非 null 的列)。
//   * billedQty:「最新一期」估驗的各工項累計數量(cum_qty,item_key 為鍵)。
//   * inspStatusByItem:查驗依 created_at 新→舊,取每工項最近一次的狀態。
//   * pourDates:混凝土澆置工項(isConcretePourItem 判定的 leaf)當日數量 >0 的
//     日誌日期,依日期新→舊(同前端 siteLogs 的迭代順序)。
//   * testSamples:全部試體(sampled_date 新→舊,同 loadQcFromDB)。
// PostgREST 單次回應上限 1000 列(config max_rows),勾稽要全量 → 大表分頁抓齊
// (同 db.js fetchAllWorkItems 的做法;附穩定排序鍵避免跨頁重複/漏列)。

type PageResult<T> = { data: T[] | null; error: { message: string } | null }

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<{ rows: T[]; error?: string }> {
  const all: T[] = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1)
    if (error) return { rows: all, error: toolError('fetchAllRows', error).error }
    const batch = data ?? []
    all.push(...batch)
    if (batch.length < size) break
  }
  return { rows: all }
}

export async function runIntegrityAudit(
  db: SupabaseClient,
  projectId: string,
  service: SupabaseClient | null,
  userId: string | undefined,
  role: AgentRole | null,
  input: Record<string, unknown>,
) {
  if (input.create_draft !== undefined && typeof input.create_draft !== 'boolean') {
    return { error: 'create_draft 必須是布林值' }
  }

  // 1) 標單全量(分頁)→ leaves
  type WiRow = {
    id: string; item_key: string | null; parent_id: string | null
    item_no: string | null; description: string | null; unit: string | null
    quantity: number | null; is_billable: boolean | null; is_rollup: boolean | null
  }
  const wi = await fetchAllRows<WiRow>((f, t) =>
    db.from('work_items')
      .select('id, item_key, parent_id, item_no, description, unit, quantity, is_billable, is_rollup')
      .eq('project_id', projectId)
      .order('sort_order')
      .range(f, t))
  if (wi.error) return { error: wi.error }
  if (!wi.rows.length) return { note: '本案尚未匯入標單工項,無法進行勾稽。請先到「標單工項」匯入。' }

  const idToKey = new Map<string, string | null>(wi.rows.map((r) => [r.id, r.item_key]))
  const billables = wi.rows.filter((r) => r.is_billable && !r.is_rollup)
  // 「有可計價子項」= 某 billable 非 rollup 項的 parent_key 等於自己的 item_key
  const parentKeys = new Set<string>()
  for (const r of billables) {
    if (!r.parent_id) continue
    const pk = idToKey.get(r.parent_id)
    if (pk != null) parentKeys.add(pk)
  }
  const leaves: IntegrityLeaf[] = billables
    .filter((r) => !(r.item_key != null && parentKeys.has(r.item_key)))
    .map((r) => ({
      item_key: r.item_key, item_no: r.item_no, description: r.description,
      unit: r.unit, quantity: r.quantity == null ? null : Number(r.quantity),
    }))

  // 2) 施工日誌 + 明細(分頁)→ loggedQty、pourDates
  const logs = await fetchAllRows<{ id: string; log_date: string | null }>((f, t) =>
    db.from('daily_logs')
      .select('id, log_date')
      .eq('project_id', projectId)
      .order('log_date', { ascending: false })
      .range(f, t))
  if (logs.error) return { error: logs.error }
  const logItems = await fetchAllRows<{ daily_log_id: string; work_item_id: string; qty_today: number | null }>((f, t) =>
    db.from('daily_log_items')
      .select('daily_log_id, work_item_id, qty_today, daily_logs!inner(project_id)')
      .eq('daily_logs.project_id', projectId) // 明細表無 project_id → inner join 綁定本案(縱深防禦)
      .order('daily_log_id')
      .order('work_item_id')
      .range(f, t))
  if (logItems.error) return { error: logItems.error }

  const loggedQty = new Map<string, number>()
  const itemsByLog = new Map<string, { key: string; qty: number }[]>()
  for (const it of logItems.rows) {
    const key = idToKey.get(it.work_item_id)
    if (key == null || it.qty_today == null) continue // 同 loadSiteLogsFromDB 的過濾
    const q = Number(it.qty_today) || 0
    loggedQty.set(key, (loggedQty.get(key) || 0) + q)
    const arr = itemsByLog.get(it.daily_log_id) ?? []
    arr.push({ key, qty: q })
    itemsByLog.set(it.daily_log_id, arr)
  }

  // 3) 最新一期估驗 → billedQty
  const { data: latestVal, error: valErr } = await db.from('valuations')
    .select('id, period_no')
    .eq('project_id', projectId)
    .order('period_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (valErr) return toolError('runIntegrityAudit', valErr)
  const billedQty = new Map<string, number>()
  if (latestVal) {
    const vItems = await fetchAllRows<{ work_item_id: string; cum_qty: number | null }>((f, t) =>
      db.from('valuation_items')
        .select('work_item_id, cum_qty, valuations!inner(project_id)')
        .eq('valuation_id', latestVal.id)
        .eq('valuations.project_id', projectId) // 明細表無 project_id → inner join 綁定本案
        .order('work_item_id')
        .range(f, t))
    if (vItems.error) return { error: vItems.error }
    for (const v of vItems.rows) {
      const key = idToKey.get(v.work_item_id)
      if (key == null || v.cum_qty == null) continue // 同 loadValuationsFromDB 的過濾
      billedQty.set(key, Number(v.cum_qty) || 0)
    }
  }

  // 4) 查驗:created_at 新→舊,每工項取最近一次狀態
  const insp = await fetchAllRows<{ id: string; work_item_id: string | null; status: string }>((f, t) =>
    db.from('inspections')
      .select('id, work_item_id, status, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(f, t))
  if (insp.error) return { error: insp.error }
  const inspStatusByItem = new Map<string, string>()
  for (const ins of insp.rows) {
    const key = ins.work_item_id ? idToKey.get(ins.work_item_id) : null
    if (key && !inspStatusByItem.has(key)) inspStatusByItem.set(key, ins.status)
  }

  // 5) 混凝土澆置日:混凝土澆置工項(isConcretePourItem)當日數量 >0 的日誌日期(新→舊)
  const concreteKeys = new Set(leaves.filter((it) => isConcretePourItem(it.description)).map((it) => it.item_key))
  const pourSet = new Set<string>()
  for (const lg of logs.rows) {
    if (!lg.log_date) continue
    if ((itemsByLog.get(lg.id) ?? []).some((e) => concreteKeys.has(e.key) && e.qty > 0)) pourSet.add(lg.log_date)
  }
  const pourDates: PourDate[] = [...pourSet].map((date) => ({ date }))

  // 6) 試體全量(sampled_date 新→舊)
  const samples = await fetchAllRows<TestSample & { id: string }>((f, t) =>
    db.from('test_samples')
      .select('id, sampled_date, status, sample_no')
      .eq('project_id', projectId)
      .order('sampled_date', { ascending: false })
      .order('id')
      .range(f, t))
  if (samples.error) return { error: samples.error }

  // ── 確定性引擎跑勾稽;findings 原樣回傳 —— 不過濾、不重排、不改寫 ──────────
  const { findings, summary } = buildIntegrityFindings({
    leaves, loggedQty, billedQty, inspStatusByItem, pourDates, testSamples: samples.rows,
  })

  if (!findings.length) {
    return {
      ok: true, findings: [], summary,
      note: '本案目前各工項的估驗、日誌、查驗、試體對得起來,沒有發現異常。',
    }
  }

  // create_draft === true → 另寫一筆 audit_note 草稿進收件匣(service role 只做這件事)
  let draftInfo: Record<string, unknown> = {}
  if (input.create_draft === true) {
    if (!service || !userId || !role) return { error: '伺服器未設定,暫時無法建立草稿' }
    const { data: action, error: insErr } = await service
      .from('agent_actions')
      .insert({
        project_id: projectId,
        actor_user: userId,
        agent_role: role, // 呼叫者角色:supervisor(監造對量)/ owner(機關防弊)拿同一份發現
        kind: 'audit_note',
        target_table: 'valuations',
        summary: `勾稽發現 ${findings.length} 項(risk ${summary.risk} 項)`,
        rationale: findings.map((f) => f.title).join('\n'),
        evidence: { findings },
      })
      .select('id')
      .single()
    if (insErr) return toolError('runIntegrityAudit', insErr)
    draftInfo = {
      agent_action_id: action.id,
      draft_note: '稽核發現已寫成草稿放進使用者的草稿收件匣,由使用者本人決定如何處理。',
    }
  }

  return { ok: true, findings, summary, ...draftInfo }
}
