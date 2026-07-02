// Supabase Edge Function: send-reminders
// ---------------------------------------------------------------------------
// 每日提醒推播:掃全部專案,彙整「已逾期 / 7 日內到期 / 待處理」
// (契約義務、品質缺失、工安缺失、請款收款 — 與前端提醒中心同一套判斷),
// 有逾期或即將到期事項時,寄一封彙整 email 給該專案全部成員。
//
// 部署:supabase functions deploy send-reminders --no-verify-jwt
// 秘密:supabase secrets set RESEND_API_KEY=re_...  CRON_SECRET=<自訂長亂數>
// 排程:見 supabase/cron.sql(pg_cron 每日 00:00 UTC = 台北 08:00 呼叫本函式)
//
// 安全:--no-verify-jwt 之後任何人都打得到 URL,所以一律驗 x-cron-secret 標頭;
//       本函式用 service role 讀庫(繞過 RLS),金鑰只存在伺服器端。
// 測試:POST ?dry=1 → 只回 JSON 彙整結果、不寄信(沒設 RESEND_API_KEY 也能跑)。

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  computeObligationDueUTC, taipeiTodayUTC, diffDays, formatDate,
  type Anchors,
} from '../_shared/contractDue.ts'

type Level = 'overdue' | 'soon' | 'todo'
interface Alert { level: Level; tag: string; title: string; meta: string; extra?: string }

const SOON_DAYS = 7

// ---- 與 src/pages/web/Alerts.jsx 同步的彙整邏輯(伺服器版) ----
function collectAlerts(
  todayUTC: number,
  anchors: Anchors,
  obligations: any[], defects: any[], safetyRecords: any[], valuations: any[],
): Alert[] {
  const out: Alert[] = []

  for (const ob of obligations) {
    if (ob.status === '已提送' || ob.status === '已完成' || ob.status === '不適用') continue
    const due = computeObligationDueUTC(ob, anchors, todayUTC)
    if (due == null) continue
    const d = diffDays(due, todayUTC)
    if (d < 0) out.push({ level: 'overdue', tag: '契約', title: ob.title, meta: `逾期 ${-d} 天（到期 ${formatDate(due)}）`, extra: ob.penalty || undefined })
    else if (d <= SOON_DAYS) out.push({ level: 'soon', tag: '契約', title: ob.title, meta: `還有 ${d} 天（到期 ${formatDate(due)}）`, extra: ob.penalty || undefined })
  }

  for (const df of defects) {
    if (df.status === '已結案') continue
    const due = df.due_date ? computeObligationDueUTC({ trigger_event: 'fixed', fixed_date: df.due_date }, anchors, todayUTC) : null
    const d = due != null ? diffDays(due, todayUTC) : null
    if (d != null && d < 0) out.push({ level: 'overdue', tag: '缺失', title: df.title, meta: `改善逾期 ${-d} 天 · ${df.status}` })
    else if (d != null && d <= SOON_DAYS) out.push({ level: 'soon', tag: '缺失', title: df.title, meta: `${d} 天內應改善 · ${df.status}` })
    else out.push({ level: 'todo', tag: '缺失', title: df.title, meta: `未結案 · ${df.status}` })
  }

  for (const s of safetyRecords) {
    if (s.record_type !== '工安缺失' || s.status === '已完成') continue
    const due = s.due_date ? computeObligationDueUTC({ trigger_event: 'fixed', fixed_date: s.due_date }, anchors, todayUTC) : null
    const d = due != null ? diffDays(due, todayUTC) : null
    if (d != null && d < 0) out.push({ level: 'overdue', tag: '工安', title: s.title, meta: `改善逾期 ${-d} 天 · ${s.status}` })
    else if (d != null && d <= SOON_DAYS) out.push({ level: 'soon', tag: '工安', title: s.title, meta: `${d} 天內應改善 · ${s.status}` })
    else out.push({ level: 'todo', tag: '工安', title: s.title, meta: `未改善 · ${s.status}` })
  }

  for (const v of valuations) {
    if (v.status === '已核定' && !v.invoice_date) out.push({ level: 'todo', tag: '請款', title: `第 ${v.period_no} 期估驗待請款`, meta: '已核定，尚未請款' })
    else if (v.invoice_date && !v.paid_date) out.push({ level: 'todo', tag: '收款', title: `第 ${v.period_no} 期待收款`, meta: `已於 ${v.invoice_date} 請款` })
  }
  return out
}

// ---- email HTML(純 inline style,郵件客戶端相容) ----
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function renderEmail(projectName: string, alerts: Alert[], appUrl: string): string {
  const groups: { key: Level; label: string; color: string }[] = [
    { key: 'overdue', label: '已逾期', color: '#c5221f' },
    { key: 'soon', label: `即將到期（${SOON_DAYS} 日內）`, color: '#e37400' },
    { key: 'todo', label: '待處理', color: '#1a73e8' },
  ]
  const section = (g: typeof groups[0]) => {
    const items = alerts.filter((a) => a.level === g.key)
    if (!items.length) return ''
    const rows = items.map((a) =>
      `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;color:${g.color};font-size:12px">${esc(a.tag)}</td>` +
      `<td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:14px">${esc(a.title)}` +
      `<div style="color:#666;font-size:12px">${esc(a.meta)}</div>` +
      (a.extra ? `<div style="color:#e37400;font-size:12px">⚖ ${esc(a.extra)}</div>` : '') +
      `</td></tr>`).join('')
    return `<h3 style="margin:18px 0 6px;color:${g.color};font-size:15px">${g.label}（${items.length}）</h3>` +
      `<table style="border-collapse:collapse;width:100%">${rows}</table>`
  }
  return `<div style="font-family:system-ui,-apple-system,'Microsoft JhengHei',sans-serif;max-width:560px;margin:0 auto;color:#202124">` +
    `<h2 style="font-size:17px;margin:0 0 4px">PMIS 每日提醒 — ${esc(projectName)}</h2>` +
    `<p style="color:#666;font-size:13px;margin:0">彙整契約到期、缺失改善、請款收款的待辦與逾期</p>` +
    groups.map(section).join('') +
    `<p style="margin-top:20px"><a href="${appUrl}" style="color:#1a73e8;font-size:13px">→ 開啟 PMIS 提醒中心</a></p></div>`
}

// ---- 主流程 ----
Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1'

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // service role:繞過 RLS,只在伺服器端
  )
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('REMINDER_FROM') || 'PMIS 提醒 <onboarding@resend.dev>'
  const appUrl = (Deno.env.get('APP_URL') || 'https://ryanxxhuang.github.io/PMIS/') + '#/alerts'
  const todayUTC = taipeiTodayUTC()

  const { data: projects, error: pErr } = await supabase.from('projects')
    .select('id, name, end_date, award_date, notice_date, commencement_date')
  if (pErr) return new Response(JSON.stringify({ error: pErr.message }), { status: 500 })

  const emailCache = new Map<string, string | null>()
  const results: any[] = []

  for (const p of projects || []) {
    const [obligations, defects, safety, valuations] = await Promise.all([
      supabase.from('contract_obligations').select('*').eq('project_id', p.id),
      supabase.from('defects').select('title, status, due_date').eq('project_id', p.id),
      supabase.from('safety_records').select('title, status, due_date, record_type').eq('project_id', p.id),
      supabase.from('valuations').select('period_no, status, invoice_date, paid_date').eq('project_id', p.id),
    ]).then((rs) => rs.map((r) => r.data || []))

    const alerts = collectAlerts(todayUTC, p, obligations, defects, safety, valuations)
    const overdue = alerts.filter((a) => a.level === 'overdue').length
    const soon = alerts.filter((a) => a.level === 'soon').length

    // 只有逾期或即將到期才寄信;純「待處理」不天天打擾(打開 app 就看得到)
    const shouldSend = overdue + soon > 0
    let sent = 0
    let recipients: string[] = []

    if (shouldSend) {
      const { data: members } = await supabase.from('project_members').select('user_id').eq('project_id', p.id)
      for (const m of members || []) {
        if (!emailCache.has(m.user_id)) {
          const { data } = await supabase.auth.admin.getUserById(m.user_id)
          emailCache.set(m.user_id, data?.user?.email || null)
        }
        const e = emailCache.get(m.user_id)
        if (e) recipients.push(e)
      }
      recipients = [...new Set(recipients)]

      if (!dry && recipients.length && resendKey) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from, to: recipients,
            subject: `【PMIS】${p.name}：逾期 ${overdue} 件、${SOON_DAYS} 日內到期 ${soon} 件`,
            html: renderEmail(p.name, alerts, appUrl),
          }),
        })
        if (res.ok) sent = recipients.length
        else console.error(`Resend failed for project ${p.id}:`, res.status, await res.text())
      }
    }

    results.push({
      project: p.name, overdue, soon,
      todo: alerts.filter((a) => a.level === 'todo').length,
      should_send: shouldSend, recipients, emails_sent: sent,
      ...(dry ? { alerts } : {}),
    })
  }

  return new Response(JSON.stringify({ dry, date: formatDate(todayUTC), projects: results }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
})
