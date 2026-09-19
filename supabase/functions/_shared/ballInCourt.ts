// 「球在誰手上」伺服器端收集器(B4 由 agentTools.ts 抽出)。
// ---------------------------------------------------------------------------
// list_my_open_items(agentQueryTools,RLS userClient)與 send-reminders 每日
// 早報(service role)共用這一份;send-reminders 原本就跨 function import 它,
// 獨立成檔才名實相符。
// 判定規則不在這裡:P5a 起與前端 src/lib/ballInCourt.js 同 import
// ./ballInCourtRules.ts(單一實作),本檔只負責「查哪些表、綁定本案、加逾期天數」。
// 共用案例 tests/fixtures/ball-in-court.cases.json 由 ballInCourt.cases.test.ts 對本檔斷言。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { BallSide, SetupGap } from './ballInCourtRules.ts'
import {
  coreOpenItems, obligationEntries, obligationInWindow, periodTitle, completionDateOf, FIELD_DOC_OPEN_STATUSES, UNTITLED,
  legacyUncoveredByValuation,
} from './ballInCourtRules.ts'
export type { BallSide }
import { computeObligationDueUTC, diffDays, formatDate, parseDateUTC } from './contractDue.ts'
import { toolError } from './agentToolCommon.ts'

// ── 球在誰手上:本案全陣營未結項彙整 ──────────────────────────────────────────
// list_my_open_items(RLS userClient)與 send-reminders 每日早報(service role)
// 共用同一份收集邏輯 —— 這是「球在誰手上」判斷的伺服器端唯一收集器,別再抄一份。
// 每個查詢都逐一 .eq('project_id') 綁定本案:userClient 下是縱深防禦,
// service role 下(無 RLS)則是唯一的跨案隔離保證,絕不可拿掉。
// field_document_submissions 沒有 project_id 欄:只以「本案文件的 id 清單」查,
// 清單本身來自綁定本案的 field_documents 查詢,隔離由此遞延。
export interface OpenBallItem {
  side: BallSide | 'unassigned'
  kind: string
  id: string
  title: string
  status: string
  meta: string
  due_date: string | null
  overdue_days?: number
  // 循環義務的期別鍵(P5b):同一條義務的每個未結期次各一筆,id 仍是義務 id,title 已含期別。
  period_key?: string
  // 待補設定(責任方推不出三方／基準日沒填／循環規則不完整／回填待核對／循環停止條件判不出):不歸任何一方、
  // 三方都看得到;Agent 工具另列 setup_pending、早報另成一段,不觸發寄信。
  setup?: SetupGap
}

// opts.obligationSoonDays:契約義務除「已逾期」外,額外納入 N 天內到期者
// (list_my_open_items 維持原行為只收逾期 → 預設 0;早報要列「7 日內到期」→ 7)。
export async function collectOpenBallItems(
  db: SupabaseClient,
  projectId: string,
  today: number,
  opts: { obligationSoonDays?: number } = {},
): Promise<{ items: OpenBallItem[] } | { error: string }> {
  const soonDays = opts.obligationSoonDays ?? 0
  const todayIso = formatDate(today)
  const items: OpenBallItem[] = []

  const [defects, submittals, rfis, valuations, inspections, changeOrders, observations, fieldDocs, proj, obligations, acceptance, adjustments, legacySources, warranty] = await Promise.all([
    db.from('defects').select('id, title, severity, status, due_date, domain').eq('project_id', projectId).neq('status', '已結案'),
    db.from('submittals').select('id, submittal_no, title, status, due_date').eq('project_id', projectId).in('status', ['已提送', '審核中', '退回補正']),
    db.from('rfis').select('id, rfi_no, title, status, due_date').eq('project_id', projectId).in('status', ['待回覆', '已回覆']),
    db.from('valuations').select('id, period_no, status, invoice_date, paid_date').eq('project_id', projectId),
    db.from('inspections').select('id, title, status').eq('project_id', projectId).eq('status', '待查驗'),
    db.from('change_orders').select('id, co_no, title, status').eq('project_id', projectId).in('status', ['提出', '審核中']),
    db.from('observations').select('id, title, status, assigned_to').eq('project_id', projectId).eq('status', '待處理'),
    db.from('field_documents').select('id, doc_type, doc_date, status, owner_org, current_version_no').eq('project_id', projectId).in('status', FIELD_DOC_OPEN_STATUSES),
    db.from('projects').select('award_date, notice_date, commencement_date, end_date').eq('id', projectId).maybeSingle(),
    // 未結的定義在共用規則(isObligationStreamOpen／isObligationOpen);這裡只排除已廢止的不適用列,
    // 與前端載入同口徑。循環義務的期次(obligation_periods,P5b)以 embed 一起帶回:期次 RLS 沿用義務。
    // P5c:category 判保固類、due_date_snapshot 讓已完成單次義務讀完成當下的到期日、期次帶版號
    db.from('contract_obligations').select('id, title, category, responsible, status, trigger_event, offset_days, offset_dir, fixed_date, recurring, recurring_day, recurring_weekday, recurring_month, source_clause, due_date_snapshot, anchor_version_no, periods:obligation_periods(id, period_key, period_start, period_end, due_date, status, review_note, anchor_version_no)').eq('project_id', projectId).neq('status', '不適用'),
    // 竣工登錄(P5c 循環停止條件):竣工確認優先、否則報竣;共用規則 completionDateOf 取最後登錄的一筆
    db.from('acceptance_events').select('stage_key, event_date, created_at').eq('project_id', projectId).in('stage_key', ['report', 'confirm']),
    // P4d:待處理的估驗調整(扣回)→ 球在機關;已核定期尚未補證的歷史遷移來源 → 球在監造補證(共用規則 valuationBall)
    db.from('valuation_adjustments').select('id, work_item_id, qty_delta, status, origin_valuation_id, reason').eq('project_id', projectId).eq('status', 'pending'),
    db.from('valuation_item_sources').select('valuation_id, work_item_id, kind').eq('project_id', projectId).eq('kind', 'legacy'),
    // P5e 保固事實(正式驗收合格日＋契約保固期間 → 保固期滿日,DB 單一規則;成員或 service 可讀):
    // 保固類循環義務的停止條件由共用規則依它判缺哪一項
    db.rpc('get_project_warranty', { p_project: projectId }),
  ])
  const firstError = [defects, submittals, rfis, valuations, inspections, changeOrders, observations, fieldDocs, obligations, acceptance, adjustments, legacySources, warranty].find((r) => r.error)
  if (firstError?.error) return toolError('collectOpenBallItems', firstError.error)

  const docIds = (fieldDocs.data ?? []).map((d) => d.id)
  let submissions: Record<string, unknown>[] = []
  if (docIds.length) {
    const subs = await db.from('field_document_submissions')
      .select('document_id, version_no, action, actor_org, to_org').in('document_id', docIds)
    if (subs.error) return toolError('collectOpenBallItems', subs.error)
    submissions = subs.data ?? []
  }

  const legacyCounts = legacyUncoveredByValuation(legacySources.data ?? [])
  for (const it of coreOpenItems({
    rfis: rfis.data ?? [], submittals: submittals.data ?? [],
    valuations: (valuations.data ?? []).map((v) => ({ ...v, legacy_uncovered: legacyCounts[String(v.id)] ?? 0 })),
    defects: defects.data ?? [],
    inspections: inspections.data ?? [], observations: observations.data ?? [], changeOrders: changeOrders.data ?? [],
    fieldDocuments: fieldDocs.data ?? [], fieldDocumentSubmissions: submissions,
    valuationAdjustments: adjustments.data ?? [],
  })) {
    const dueMs = parseDateUTC(it.due)
    const overdue = dueMs != null && dueMs < today ? diffDays(today, dueMs) : undefined
    items.push({
      side: it.who, kind: it.tag, id: it.id ?? '', title: it.title, status: it.status, meta: it.meta, due_date: it.due,
      ...(overdue ? { overdue_days: overdue } : {}),
      ...(it.setup ? { setup: it.setup } : {}), // 責任推不出三方(觀察指派非三方):待補設定
    })
  }

  // 契約義務:單次義務到期日由 contractDue 依基準日確定性推算(不是 AI 算);循環義務每個未結期次
  // 一筆(共用規則 obligationEntries,期次由 DB 物化)。責任方／基準日／循環規則／待核對缺口由
  // 共用規則判定——責任不明不歸任何一方(不再預設廠商),列為待補設定。
  // anchors 另帶實際竣工日(acceptance_events 推得)與保固事實(P5e),供共用規則判循環停止條件
  const anchors = { ...(proj?.data ?? {}), completion_date: completionDateOf(acceptance.data ?? []), warranty: warranty.data ?? null }
  const computeDueIso = (ob: Record<string, unknown>) => {
    const dueMs = computeObligationDueUTC(ob, anchors)
    return dueMs == null ? null : formatDate(dueMs)
  }
  for (const ob of obligations.data ?? []) {
    const clause = ob.source_clause ? `（依 ${ob.source_clause}）` : ''
    for (const { ball, dueIso, period } of obligationEntries(ob, { anchors, computeDueIso, todayIso })) {
      if (ball.who === 'done') continue
      const dueMs = parseDateUTC(dueIso)
      const base = {
        kind: '契約重點', id: ob.id, title: periodTitle(ob.title || UNTITLED, period), status: String(ob.status ?? ''), due_date: dueIso,
        ...(period ? { period_key: String(period.period_key) } : {}),
      }
      if (ball.setup) {
        items.push({ side: ball.who, ...base, meta: `${ball.label}${clause}`, setup: ball.setup })
        continue
      }
      if (dueMs == null || !obligationInWindow(dueIso, todayIso, soonDays)) continue
      items.push({
        side: ball.who, ...base, meta: `${ball.label}${clause}`,
        ...(dueMs < today ? { overdue_days: diffDays(today, dueMs) } : {}),
      })
    }
  }

  // 到期日近的排前面;沒有到期日的排最後(stable sort → 同日維持插入順序)
  items.sort((a, b) => {
    const am = parseDateUTC(a.due_date)
    const bm = parseDateUTC(b.due_date)
    if (am == null && bm == null) return 0
    if (am == null) return 1
    if (bm == null) return -1
    return am - bm
  })
  return { items }
}
