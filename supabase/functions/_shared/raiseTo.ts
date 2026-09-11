// 全角色 Agent:交接 raise_to(B4 由 agentTools.ts 抽出)。
// ---------------------------------------------------------------------------
// 唯一「寫給別人」的工具,仍只寫 agent_actions:一筆落在對方名下(handoff,對方
// 的私人待辦)、一筆落在發起人名下(handoff_sent,紅線三的發起方留痕)。
// 收件人只依三方 org_type 找(list_project_members RPC),project_role 不參與分流。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { AGENT_ROLES } from './agentPersona.ts'
import type { AgentRole } from './agentPersona.ts'
import { isUuid } from './uuid.ts'
import { toolError } from './agentToolCommon.ts'
import { RECORD_SELECTS } from './agentQueryTools.ts'

// ── 批4(任務B):raise_to 實作 ──────────────────────────────────────────────

const ROLE_LABEL: Record<AgentRole, string> = { contractor: '廠商', supervisor: '監造', owner: '機關' }

// raise_to 可關聯的單據表白名單:get_record 白名單 + 品管兩張(檢查表/試體)
const HANDOFF_TABLES = new Set([...Object.keys(RECORD_SELECTS), 'checklist_records', 'test_samples'])

export async function raiseTo(
  db: SupabaseClient,
  projectId: string,
  service: SupabaseClient | null,
  userId: string | undefined,
  callerRole: AgentRole | null,
  input: Record<string, unknown>,
) {
  const toRole = input.to_role
  if (typeof toRole !== 'string' || !(AGENT_ROLES as readonly string[]).includes(toRole)) {
    return { error: `to_role 必須是 ${AGENT_ROLES.join('/')} 之一` }
  }
  const subject = input.subject
  if (typeof subject !== 'string' || !subject.trim()) return { error: 'subject 必須是非空字串' }
  if (subject.length > 200) return { error: 'subject 請在 200 字內,細節放 note' }
  const note = input.note
  if (note !== undefined && (typeof note !== 'string' || note.length > 2000)) {
    return { error: 'note 必須是 2000 字內的字串' }
  }
  const targetTable = input.target_table
  const targetId = input.target_id
  if ((targetTable === undefined) !== (targetId === undefined)) {
    return { error: 'target_table 與 target_id 必須成對提供' }
  }
  if (targetTable !== undefined) {
    if (typeof targetTable !== 'string' || !HANDOFF_TABLES.has(targetTable)) {
      return { error: `target_table 必須是白名單之一:${[...HANDOFF_TABLES].join('、')}` }
    }
    if (!isUuid(targetId)) return { error: 'target_id 必須是 UUID' }
  }
  if (!service || !userId || !callerRole) return { error: '伺服器未設定,暫時無法建立草稿' }

  const to = toRole as AgentRole
  const label = ROLE_LABEL[to]

  // 找對方：list_project_members 已依本案成員資格限縮，org_type 是唯一三方角色
  // 來源；project_role／職稱不參與交接分流。同方多人時依 RPC 的加入順序取第一位。
  const { data: memberRows, error: mErr } = await db
    .rpc('list_project_members', { p_project: projectId })
  if (mErr) return toolError('raiseTo', mErr)
  const members = (memberRows ?? []) as { user_id: string; org_type: string; full_name: string | null }[]
  const recipient = members.find((m) => m.org_type === to && m.user_id !== userId)
  if (!recipient) {
    return { error: `本案沒有其他「${label}」成員,無法交接。請先將對方加入專案。` }
  }

  const callerName = members.find((m) => m.user_id === userId)?.full_name || '同案成員'
  const recipientName = recipient.full_name || `${label}成員`

  const noteText = typeof note === 'string' && note.trim() ? note.trim() : null
  const rationale = [noteText, `由 ${callerName}(${ROLE_LABEL[callerRole]})的 agent 轉來`]
    .filter(Boolean)
    .join('\n')

  // 第一筆:agent_actions 落在「對方」名下(actor_user = 對方)—— 對方的私人待辦。
  // 該表 SELECT policy 是本人 → 這筆只有對方看得到。
  const { data: action, error: insErr } = await service
    .from('agent_actions')
    .insert({
      project_id: projectId,
      actor_user: recipient.user_id,
      agent_role: to,
      kind: 'handoff',
      target_table: targetTable ?? null,
      target_id: targetId ?? null,
      summary: subject.trim(),
      rationale,
      evidence: { from_user: userId, from_role: callerRole, to_role: to, note: noteText },
    })
    .select('id')
    .single()
  if (insErr) return toolError('raiseTo', insErr)

  // 第二筆(B4 / 紅線三):同一件交接在「發起人」名下再留一筆 handoff_sent。
  // 沒有這筆,A 的 agent 以 A 的名義送出了什麼、A 自己完全查不到(policy 只給
  // actor_user 本人看),被 prompt 誘導亂發交接時發起人無從察覺。不改 RLS(那是
  // 安全邊界),改成兩筆各落各的名下;status 沿用預設 pending → 出現在發起人自己
  // 的收件匣,按「知道了」即完成覆核(resolved_by / resolved_at 留痕)。
  // evidence.handoff_action_id 指向對方那筆,兩筆可對應。
  // 補登失敗不弄掛主要動作:對方那筆已落地,原文只進 log,回傳如實標註。
  const { data: sent, error: sentErr } = await service
    .from('agent_actions')
    .insert({
      project_id: projectId,
      actor_user: userId,
      agent_role: callerRole,
      kind: 'handoff_sent',
      target_table: targetTable ?? null,
      target_id: targetId ?? null,
      summary: `已交接給 ${recipientName}(${label}):${subject.trim()}`,
      rationale: [noteText, `你的 agent 已把這件事送到 ${recipientName}(${label})的草稿收件匣;對方確認前不算受理。`]
        .filter(Boolean)
        .join('\n'),
      evidence: {
        handoff_action_id: action.id,
        from_user: userId, from_role: callerRole, to_user: recipient.user_id, to_role: to, note: noteText,
      },
    })
    .select('id')
    .single()
  const sentRecord = sentErr
    ? { 發起人留痕: `未寫入(${toolError('raiseTo.sent', sentErr).error}),交接本身已送達對方` }
    : { sent_action_id: sent.id }

  return {
    ok: true,
    agent_action_id: action.id,
    ...sentRecord,
    交接對象: `${recipientName}(${label})`,
    note:
      `交接草稿已送出給 ${recipientName}(${label}),會出現在「對方」的草稿收件匣,由對方本人決定是否接手。` +
      '使用者自己的收件匣只會多一筆「已交接給對方」的留痕供核對,不是待辦 —— 請據實告訴使用者「已送給對方」。',
  }
}
