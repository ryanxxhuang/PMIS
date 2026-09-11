// 監造 Agent:送審審查意見草稿 draft_submittal_review(B4 由 agentTools.ts 抽出)。
// ---------------------------------------------------------------------------
// 包既有 review-submittal edge function(反幻覺紀律在該函式,不重寫)。
// 只寫 agent_actions,絕不碰 submittals 任何欄位 —— 審定(核准/退回)是監造的
// 法定裁量,狀態轉移由 DB trigger 把關;suggested_decision 一律以「建議」呈現。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { isUuid } from './uuid.ts'
import { isOwnMessage } from './publicError.ts'
import { toolError } from './agentToolCommon.ts'

// ── draft_submittal_review 實作(只給 supervisor) ───────────────────────────

// 待審狀態:與 submittalBall 的「待監造審定」判定一致(球在監造手上的兩態)
const PENDING_SUBMITTAL_STATUSES = ['已提送', '審核中']

export async function draftSubmittalReview(
  db: SupabaseClient,
  projectId: string,
  service: SupabaseClient | null,
  userId: string | undefined,
  input: Record<string, unknown>,
) {
  if (input.submittal_id !== undefined && !isUuid(input.submittal_id)) {
    return { error: 'submittal_id 必須是 UUID' }
  }
  if (!service || !userId) return { error: '伺服器未設定,暫時無法建立草稿' }

  // 1) 讀送審件(userClient RLS + .eq(project_id) 縱深防禦)。
  //    找不到/不是待審狀態 → 誠實 note,不是失敗 —— agent 要能據實轉述。
  const SUB_SELECT = 'id, submittal_no, title, category, revision, status, attachment_note, work_item_id'
  type SubRow = {
    id: string; submittal_no: string | null; title: string; category: string | null
    revision: number | null; status: string; attachment_note: string | null; work_item_id: string | null
  }
  let submittal: SubRow
  if (input.submittal_id) {
    const { data, error } = await db
      .from('submittals')
      .select(SUB_SELECT)
      .eq('project_id', projectId)
      .eq('id', input.submittal_id)
      .maybeSingle()
    if (error) return toolError('draftSubmittalReview', error)
    if (!data) return { note: '找不到這筆送審(或不屬於本案/無權限)' }
    const row = data as SubRow
    if (!PENDING_SUBMITTAL_STATUSES.includes(row.status)) {
      return {
        note:
          `送審 ${[row.submittal_no, row.title].filter(Boolean).join(' ')} 目前狀態是「${row.status}」,` +
          '不是待審件(已提送/審核中),毋須擬審查意見。',
      }
    }
    submittal = row
  } else {
    // 省略 submittal_id → 挑最早提送的一件待審(submitted_date 舊→新,無日期排最後;
    // 同日以 created_at 決,平手決策確定性)
    const { data, error } = await db
      .from('submittals')
      .select('id, submittal_no, title, category, revision, status, attachment_note, work_item_id, submitted_date, created_at')
      .eq('project_id', projectId)
      .in('status', PENDING_SUBMITTAL_STATUSES)
      .order('submitted_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(1)
    if (error) return toolError('draftSubmittalReview', error)
    const row = (data ?? [])[0] as SubRow | undefined
    if (!row) return { note: '本案目前沒有待審(已提送/審核中)的送審件。' }
    submittal = row
  }

  // 2) 相關履約需求 —— 撈法與前端 collab.js reviewSubmittal 完全一致(改要同步):
  //    approved + needs_review、七類 requirement_type、上限 60;有對應工項時把
  //    requirement_work_items 連結到該工項的需求排前面,最終取 25 筆。
  //    需求查詢失敗與前端同樣優雅降級為空清單(edge fn 會回通用要點並標「通用」)。
  const { data: reqs } = await db
    .from('requirements')
    .select('id,title,requirement_type,acceptance_criteria,evidence_requirement,status')
    .eq('project_id', projectId)
    .in('status', ['approved', 'needs_review'])
    .in('requirement_type', ['submittal', 'test', 'evidence', 'checklist', 'inspection', 'report', 'other'])
    .limit(60)
  type ReqRow = {
    id: string; title: string; requirement_type: string | null
    acceptance_criteria: string | null; evidence_requirement: string | null; status: string
  }
  let relevant = (reqs ?? []) as ReqRow[]
  if (submittal.work_item_id && relevant.length) {
    const { data: links } = await db
      .from('requirement_work_items')
      .select('requirement_id')
      .eq('work_item_id', submittal.work_item_id)
    const linkedIds = new Set((links ?? []).map((l) => l.requirement_id))
    const linked = relevant.filter((r) => linkedIds.has(r.id))
    relevant = (linked.length ? [...linked, ...relevant.filter((r) => !linkedIds.has(r.id))] : relevant).slice(0, 25)
  } else relevant = relevant.slice(0, 25)

  // 對應工項(選填;RLS + .eq(project_id) 縱深防禦)—— 形狀同前端的 workItem
  let workItem: { no: string; desc: string; unit: string } | null = null
  if (submittal.work_item_id) {
    const { data: wi } = await db
      .from('work_items')
      .select('item_no, description, unit')
      .eq('project_id', projectId)
      .eq('id', submittal.work_item_id)
      .maybeSingle()
    if (wi) workItem = { no: wi.item_no || '', desc: wi.description || '', unit: wi.unit || '' }
  }

  // 3) 呼叫既有 review-submittal edge function(反幻覺紀律在該函式,不重寫)。
  //    userClient 建立時已掛呼叫者 Authorization → invoke 原樣帶過去(同 fetch-weather)。
  let review: {
    checklist: { point?: string; basis?: string; status?: string }[]
    opinion: string
    suggested_decision: string
    caution: string
  }
  try {
    const { data, error } = await db.functions.invoke('review-submittal', {
      body: {
        submittal: {
          title: submittal.title,
          category: submittal.category,
          attachment_note: submittal.attachment_note,
          revision: submittal.revision,
        },
        work_item: workItem,
        requirements: relevant.map((r) => ({
          title: r.title,
          type: r.requirement_type,
          acceptance_criteria: r.acceptance_criteria,
          evidence_requirement: r.evidence_requirement,
          authoritative: r.status === 'approved',
        })),
      },
    })
    // invoke 層(FunctionsHttpError / 網路)原文只進 log;review-submittal 回的
    // data.error 已是遮罩短語——非中文代表部署空窗的舊版回應,照遮
    if (error) {
      console.error('[agentTools.draftSubmittalReview] review-submittal invoke 失敗:', String(error.message || error))
      return { error: 'AI 審查暫時無法使用，請稍後再試' }
    }
    if (data?.error) return { error: `AI 審查暫時無法使用，${isOwnMessage(data.error) ? data.error : '請稍後再試'}` }
    if (!data || !Array.isArray(data.checklist) || typeof data.opinion !== 'string' || typeof data.suggested_decision !== 'string') {
      return { error: 'AI 審查回傳格式不符,請稍後再試' }
    }
    review = data
  } catch (e) {
    console.error('[agentTools.draftSubmittalReview] review-submittal 例外:', String((e as Error)?.message || e))
    return { error: 'AI 審查暫時無法使用，請稍後再試' }
  }

  const checklist = review.checklist
  const needSupplement = checklist.filter((c) => c?.status === '需補件').length
  const needVerify = checklist.filter((c) => c?.status === '需監造核對文件').length
  const label = [submittal.submittal_no, submittal.title].filter(Boolean).join(' ')
  const caution = typeof review.caution === 'string' ? review.caution.trim() : ''
  // rationale:優先 caution;無則以審查要點的依據摘要交代(依據只可能是傳入需求標題或「通用」)
  const bases = [...new Set(checklist.map((c) => (typeof c?.basis === 'string' ? c.basis.trim() : '')).filter(Boolean))]
  const rationale = caution
    || (bases.length ? `審查要點依據:${bases.join('、')}` : `依 ${relevant.length} 項本案履約需求與通用審查要點擬定`)

  // 4) 唯一的寫入:agent_actions(service role)。絕不碰 submittals 任何欄位 ——
  //    真正的審定由監造本人在送審頁面走既有 decideSubmittal(DB trigger 把關)。
  const { data: action, error: insErr } = await service
    .from('agent_actions')
    .insert({
      project_id: projectId,
      actor_user: userId,
      agent_role: 'supervisor', // 本工具只分發給 supervisor
      kind: 'draft_submittal_review',
      target_table: 'submittals',
      target_id: submittal.id,
      summary: `送審 ${label} 已依 ${relevant.length} 項契約重點擬好審查意見(建議:${review.suggested_decision})`,
      rationale,
      evidence: {
        payload: {
          submittal_id: submittal.id,
          submittal_no: submittal.submittal_no,
          submittal_title: submittal.title,
          checklist,
          opinion: review.opinion,
          suggested_decision: review.suggested_decision,
          caution,
        },
      },
    })
    .select('id')
    .single()
  if (insErr) return toolError('draftSubmittalReview', insErr)

  // 5) 回給模型的是「草稿已放入收件匣」的事實 —— 建議判定只是建議,審定權在監造本人
  return {
    ok: true,
    agent_action_id: action.id,
    件號: submittal.submittal_no || '(無編號)',
    送審名稱: submittal.title,
    審查要點數: checklist.length,
    需補件項數: needSupplement,
    需監造核對文件項數: needVerify,
    建議判定: review.suggested_decision,
    參酌履約需求數: relevant.length,
    note:
      '審查意見草稿已放進使用者的草稿收件匣;建議判定只是建議,' +
      '審定(核准/核備/退回補正/駁回)仍需監造本人在送審頁面操作 ——' +
      '絕不可宣稱已審定、已核准或已退回,也不可替他做決定。',
  }
}
