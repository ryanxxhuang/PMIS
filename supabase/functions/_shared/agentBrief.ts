// 角色化每日早報(send-reminders)—— 內容組裝層
// ---------------------------------------------------------------------------
// 定位:每個角色配一個專屬 AI agent,每日早報是 agent 的主動接觸點。
// 信件主軸是「今天球在你手上的事」,不是全案流水帳。
// 硬要求:內容一律確定性產生,絕不呼叫 LLM ——
//   ① 每天 × 每人 × 每案的 LLM 成本不合理
//   ② 信寄出去無法收回,寧可樸素也不能寫錯
//   ③ 「球在誰手上」「到期日」的判斷邏輯既有、確定且測過(agentTools/contractDue)
// 本檔全部是純函式(不碰 DB、不碰網路),供 send-reminders 組信、也供單元測試。

import type { AgentRole } from './agentPersona.ts'
import { AGENT_NAME, SIDE_BY_AGENT_ROLE } from './agentRole.ts'
import type { OpenBallItem } from './agentTools.ts'
import { diffDays, formatDate, parseDateUTC } from './contractDue.ts'

export const SOON_DAYS = 7

// ── 試體齡期 → 早報項目(與 src/lib/qc.js sampleAlerts 同規則;確定性) ──────
// 試體試驗是廠商品管的責任 → side 一律 contractor,kind '試驗'(品管優先路由)。
export interface TestSampleRow {
  id?: string
  sample_no?: string | null
  test_item?: string | null
  status?: string | null
  d7_due?: string | null
  d28_due?: string | null
  d7_value?: number | null
  d28_values?: unknown
}

export function testSampleItems(samples: TestSampleRow[], todayUTC: number): OpenBallItem[] {
  const out: OpenBallItem[] = []
  for (const s of samples) {
    if (s.status === '合格' || s.status === '不合格') continue
    const checks = [
      { due: s.d7_due, filled: s.d7_value != null, label: '7天試驗' },
      { due: s.d28_due, filled: Array.isArray(s.d28_values) && s.d28_values.length > 0, label: '28天抗壓試驗' },
    ]
    for (const c of checks) {
      if (c.filled || !c.due) continue
      const due = parseDateUTC(c.due)
      if (due == null) continue
      const d = diffDays(due, todayUTC) // 正=還有 d 天,負=已逾期
      if (d > SOON_DAYS) continue
      out.push({
        side: 'contractor',
        kind: '試驗',
        id: s.id || '',
        title: `${s.sample_no || ''} ${s.test_item || ''} ${c.label}`.trim(),
        status: s.status || '待試驗',
        meta: '齡期到期未試驗',
        due_date: formatDate(due),
        ...(d < 0 ? { overdue_days: -d } : {}),
      })
    }
  }
  return out
}

// ── 收件者過濾:球在我陣營 + 同陣營內的偏好路由 ─────────────────────────────
// field / qc 同屬廠商陣營;為了讓信「跟我有關」,特定類別優先路由給對的角色:
//   試驗(試體齡期)→ 品管;工安缺失 → 現場。
// 但偏好角色在本專案「沒有任何成員」時,回落給同陣營全部成員 —— 寧可現場工程師
// 多收到一則試體提醒,也不能讓提醒沒人收到。
const PREFERRED_ROLE_BY_KIND: Record<string, AgentRole> = {
  試驗: 'qc',
  工安缺失: 'field',
}

export function itemsForRecipient(
  items: OpenBallItem[],
  role: AgentRole,
  rolesPresent: ReadonlySet<AgentRole>,
): OpenBallItem[] {
  const side = SIDE_BY_AGENT_ROLE[role]
  return items.filter((it) => {
    if (it.side !== side) return false
    const pref = PREFERRED_ROLE_BY_KIND[it.kind]
    if (pref && pref !== role && rolesPresent.has(pref)) return false
    return true
  })
}

// ── 分段:今天球在你手上(逾期+無期限未結)/ 7 日內到期 ─────────────────────
export interface BriefSections {
  overdue: OpenBallItem[] // 已逾期(排最前、標紅)
  pending: OpenBallItem[] // 球在你手上但無到期日 / 到期日在 7 日之外(不觸發寄信)
  dueSoon: OpenBallItem[] // 7 日內到期
}

export function splitBrief(items: OpenBallItem[], todayUTC: number, soonDays = SOON_DAYS): BriefSections {
  const overdue: OpenBallItem[] = []
  const dueSoon: OpenBallItem[] = []
  const pending: OpenBallItem[] = []
  for (const it of items) {
    const due = parseDateUTC(it.due_date)
    if (due != null && due < todayUTC) overdue.push(it)
    else if (due != null && diffDays(due, todayUTC) <= soonDays) dueSoon.push(it)
    else pending.push(it)
  }
  // 逾期最久的排最前(輸入已按到期日昇冪 → 這裡不再排序,維持穩定)
  return { overdue, pending, dueSoon }
}

// 「沒有屬於這個角色的事就不寄」:與舊版一致,只有逾期或 7 日內到期才值得打擾;
// 無期限的未結項與待覆核草稿只「搭便車」出現在信裡,不單獨觸發寄信。
export function shouldSendBrief(s: BriefSections): boolean {
  return s.overdue.length + s.dueSoon.length > 0
}

// ── 信件渲染(純 inline style,郵件客戶端相容) ─────────────────────────────
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function briefDateLabel(todayUTC: number): string {
  const [, m, d] = formatDate(todayUTC).split('-')
  return `${Number(m)}/${Number(d)}`
}

export function briefSubject(role: AgentRole, projectName: string, s: BriefSections): string {
  return `【PMIS】${AGENT_NAME[role]} · ${projectName}:逾期 ${s.overdue.length} 件、${SOON_DAYS} 日內到期 ${s.dueSoon.length} 件`
}

function row(color: string, tag: string, title: string, meta: string): string {
  return (
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;color:${color};font-size:12px">${esc(tag)}</td>` +
    `<td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:14px">${esc(title)}` +
    `<div style="color:#666;font-size:12px">${esc(meta)}</div></td></tr>`
  )
}

export function renderBriefEmail(args: {
  role: AgentRole
  projectName: string
  todayUTC: number
  sections: BriefSections
  pendingDrafts: number
  agentUrl: string
}): string {
  const { role, projectName, todayUTC, sections, pendingDrafts, agentUrl } = args
  const RED = '#c5221f'
  const ORANGE = '#e37400'
  const BLUE = '#1a73e8'

  // 第一段:今天球在你手上(逾期紅字排最前,其後是無期限的未結項)
  const courtRows = [
    ...sections.overdue.map((it) =>
      row(RED, it.kind, it.title, `已逾期 ${it.overdue_days ?? -diffDays(parseDateUTC(it.due_date)!, todayUTC)} 天（到期 ${it.due_date}） · ${it.meta}`)),
    ...sections.pending.map((it) =>
      row(BLUE, it.kind, it.title, it.due_date ? `${it.meta} · 到期 ${it.due_date}` : it.meta)),
  ]
  const courtCount = sections.overdue.length + sections.pending.length
  const court = courtRows.length
    ? `<h3 style="margin:18px 0 6px;color:${sections.overdue.length ? RED : BLUE};font-size:15px">今天球在你手上（${courtCount}）</h3>` +
      `<table style="border-collapse:collapse;width:100%">${courtRows.join('')}</table>`
    : ''

  // 第二段:7 日內到期
  const soonRows = sections.dueSoon.map((it) => {
    const left = diffDays(parseDateUTC(it.due_date)!, todayUTC)
    return row(ORANGE, it.kind, it.title, `${left === 0 ? '今天到期' : `還有 ${left} 天`}（到期 ${it.due_date}） · ${it.meta}`)
  })
  const soon = soonRows.length
    ? `<h3 style="margin:18px 0 6px;color:${ORANGE};font-size:15px">${SOON_DAYS} 日內到期（${soonRows.length}）</h3>` +
      `<table style="border-collapse:collapse;width:100%">${soonRows.join('')}</table>`
    : ''

  // 第三段(有才出現):AI 草稿收件匣
  const drafts = pendingDrafts > 0
    ? `<p style="margin:18px 0 0;font-size:14px">你的 AI 草稿收件匣有 <a href="${agentUrl}" style="color:${BLUE}">${pendingDrafts} 筆待覆核</a>。</p>`
    : ''

  return (
    `<div style="font-family:system-ui,-apple-system,'Microsoft JhengHei',sans-serif;max-width:560px;margin:0 auto;color:#202124">` +
    `<h2 style="font-size:17px;margin:0 0 4px">${esc(AGENT_NAME[role])} · ${esc(projectName)} · ${briefDateLabel(todayUTC)}</h2>` +
    `<p style="color:#666;font-size:13px;margin:0">你的 agent 早報 — 只列跟你有關的事</p>` +
    court + soon + drafts +
    `<p style="margin:24px 0 0"><a href="${agentUrl}" style="display:inline-block;background:${BLUE};color:#fff;text-decoration:none;font-size:14px;padding:9px 18px;border-radius:6px">打開你的 Agent</a></p>` +
    `</div>`
  )
}
