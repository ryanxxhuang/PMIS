// 「球在誰手上」伺服器端唯一實作(B4 由 agentTools.ts 抽出)。
// ---------------------------------------------------------------------------
// list_my_open_items(agentQueryTools,RLS userClient)與 send-reminders 每日
// 早報(service role)共用這一份;send-reminders 原本就跨 function import 它,
// 獨立成檔才名實相符。判定規則與 src/lib/ballInCourt.js 一致,改動要兩邊同步。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { BallSide } from './agentRole.ts'
export type { BallSide }
import { computeObligationDueUTC, diffDays, formatDate, parseDateUTC } from './contractDue.ts'
import { toolError } from './agentToolCommon.ts'

// ── 球在誰手上(與 src/lib/ballInCourt.js 一致;改動要兩邊同步) ──────────────
type Ball = { who: 'contractor' | 'supervisor' | 'owner' | 'done'; label: string }

function rfiBall(r: { status?: string }): Ball {
  if (r.status === '待回覆') return { who: 'supervisor', label: '待監造/設計回覆' }
  if (r.status === '已回覆') return { who: 'contractor', label: '待廠商確認結案' }
  return { who: 'done', label: '已結案' }
}
function submittalBall(s: { status?: string }): Ball {
  if (s.status === '已提送' || s.status === '審核中') return { who: 'supervisor', label: '待監造審定' }
  if (s.status === '退回補正') return { who: 'contractor', label: '待廠商補正' }
  return { who: 'done', label: s.status || '' }
}
function valuationBall(v: { status?: string; invoice_date?: string | null; paid_date?: string | null }): Ball {
  if (v.status === '草稿') return { who: 'contractor', label: '待廠商送審' }
  if (v.status === '監造審核') return { who: 'supervisor', label: '待監造核定' }
  if (!v.invoice_date) return { who: 'contractor', label: '待廠商請款' }
  if (!v.paid_date) return { who: 'owner', label: '待機關撥款' }
  return { who: 'done', label: '已撥款' }
}
function defectBall(d: { status?: string }): Ball {
  if (d.status === '已結案') return { who: 'done', label: '已結案' }
  if (d.status === '待複查') return { who: 'supervisor', label: '待監造複查' }
  if (d.status === '改善中') return { who: 'contractor', label: '廠商改善中' }
  return { who: 'contractor', label: '待廠商改善' }
}

// ── 球在誰手上:本案全陣營未結項彙整 ──────────────────────────────────────────
// list_my_open_items(RLS userClient)與 send-reminders 每日早報(service role)
// 共用同一份收集邏輯 —— 這是「球在誰手上」判斷的伺服器端唯一實作,別再抄一份。
// 每個查詢都逐一 .eq('project_id') 綁定本案:userClient 下是縱深防禦,
// service role 下(無 RLS)則是唯一的跨案隔離保證,絕不可拿掉。
export interface OpenBallItem {
  side: BallSide
  kind: string
  id: string
  title: string
  status: string
  meta: string
  due_date: string | null
  overdue_days?: number
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
  const items: OpenBallItem[] = []
  const push = (ball: Ball, kind: string, id: string, title: string, status: string, dueDate: string | null) => {
    if (ball.who === 'done') return
    const dueMs = parseDateUTC(dueDate)
    const overdue = dueMs != null && dueMs < today ? diffDays(today, dueMs) : undefined
    items.push({ side: ball.who, kind, id, title: title || '(未命名)', status, meta: ball.label, due_date: dueDate, ...(overdue ? { overdue_days: overdue } : {}) })
  }

  const [defects, submittals, rfis, valuations, proj, obligations] = await Promise.all([
    db.from('defects').select('id, title, severity, status, due_date, domain').eq('project_id', projectId).neq('status', '已結案'),
    db.from('submittals').select('id, submittal_no, title, status, due_date').eq('project_id', projectId).in('status', ['已提送', '審核中', '退回補正']),
    db.from('rfis').select('id, rfi_no, title, status, due_date').eq('project_id', projectId).in('status', ['待回覆', '已回覆']),
    db.from('valuations').select('id, period_no, status, invoice_date, paid_date').eq('project_id', projectId),
    db.from('projects').select('award_date, notice_date, commencement_date, end_date').eq('id', projectId).maybeSingle(),
    db.from('contract_obligations').select('id, title, responsible, trigger_event, offset_days, offset_dir, fixed_date, recurring, recurring_day, recurring_weekday, recurring_month, source_clause').eq('project_id', projectId).eq('status', '待辦'),
  ])
  const firstError = [defects, submittals, rfis, valuations, obligations].find((r) => r.error)
  if (firstError?.error) return toolError('collectOpenBallItems', firstError.error)

  for (const d of defects.data ?? []) {
    push(defectBall(d), d.domain === 'safety' ? '工安缺失' : '缺失', d.id, d.title, d.status, d.due_date)
  }
  for (const s of submittals.data ?? []) {
    push(submittalBall(s), '送審', s.id, `${s.submittal_no ? s.submittal_no + ' ' : ''}${s.title || ''}`.trim(), s.status, s.due_date)
  }
  for (const r of rfis.data ?? []) {
    push(rfiBall(r), '疑義', r.id, `${r.rfi_no ? r.rfi_no + ' ' : ''}${r.title || ''}`.trim(), r.status, r.due_date)
  }
  for (const v of valuations.data ?? []) {
    push(valuationBall(v), '估驗', v.id, `第 ${v.period_no} 期估驗`, v.status, null)
  }
  // 契約義務:到期日由 contractDue 依基準日確定性推算(不是 AI 算);
  // responsible 未填的義務預設歸廠商(與資料慣例一致)。
  const SIDE_BY_RESP: Record<string, BallSide> = { 廠商: 'contractor', 監造: 'supervisor', 機關: 'owner' }
  for (const ob of obligations.data ?? []) {
    const side = SIDE_BY_RESP[ob.responsible || '廠商'] ?? 'contractor'
    const due = proj?.data ? computeObligationDueUTC(ob, proj.data, today) : null
    if (due == null) continue
    const overdue = due < today
    if (!overdue && (soonDays <= 0 || diffDays(due, today) > soonDays)) continue
    items.push({
      side,
      kind: '契約重點',
      id: ob.id,
      title: ob.title,
      status: '待辦',
      meta: overdue
        ? `已逾期${ob.source_clause ? '(依 ' + ob.source_clause + ')' : ''}`
        : `待辦${ob.source_clause ? '(依 ' + ob.source_clause + ')' : ''}`,
      due_date: formatDate(due),
      ...(overdue ? { overdue_days: diffDays(today, due) } : {}),
    })
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
