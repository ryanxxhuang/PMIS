// 廠商 Agent:自主檢查表草稿 draft_inspection(B4 由 agentTools.ts 抽出;P6b-2 改為產生現場文書草稿)。
// ---------------------------------------------------------------------------
// 與照片起稿同一條路(agentFieldDocDraft.ts):用 fieldDocDraft.buildSelfCheckDraft 湊內容、writeDraftDocument 寫入一份
// 自主檢查表文件的 AI 版本,agent_actions 的 target 是那份 field_documents。不寫 checklist_records——事實表只由
// 自主檢查表簽署 RPC 落庫(判定由 DB 依範本量化標準算);使用者在自主檢查表頁逐項確認、量測填值、簽署。
// 紅線:查驗實測值(kind:'num')不讓 AI 讀——本檔只驗「勾選項建議」,num 項的建議直接回錯誤;共用 builder 對 num
// 項永遠不帶值(DB 版本 guard 也拒絕 AI 版本帶入實測值)。pickChecklistTemplate／validateBoolSuggestions 是純函式,
// agentTools.test.ts 釘住。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { isUuid } from './uuid.ts'
import { toolDate, toolError } from './agentToolCommon.ts'
import { supabaseDraftRepo } from './fieldDocRepo.ts'
import { agentDraftSelfCheck } from './agentFieldDocDraft.ts'
import type { ChecklistTemplateRow, LeafWorkItem } from './fieldDocDraft.ts'
import { pickChecklistTemplate } from './fieldDocDraft.ts'

// 勾選項建議的嚴格驗證(本批最重要的判斷,絕不可放寬):
//   * 只接受「存在且 kind 為 bool」的項次;指到 num 項直接回 error(不是默默忽略,讓模型知道這條路不通)。
//   * 每筆必須是 { value: boolean, basis: string };模型在 agent-run 裡沒有視覺輸入,依據只能來自工具回傳的文字——
//     沒有依據的推論事後和猜測分不出來,缺依據直接拒絕。false 也如實保留(勾「無」同樣是判定輸入)。
//   * 通過的建議由 buildSelfCheckDraft 帶入為 filled／ai:agent,勾選項 confirm_required,人不逐項確認就不能簽署。
export function validateBoolSuggestions(
  items: { no: string; kind?: string | null }[],
  raw: unknown,
): { suggestions: Map<string, { value: boolean; basis: string }> } | { error: string } {
  const suggestions = new Map<string, { value: boolean; basis: string }>()
  if (raw === undefined || raw === null) return { suggestions }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'bool_suggestions 必須是物件(鍵=項次編號、值={ value: true/false, basis: 依據 })' }
  }
  const byNo = new Map(items.map((it) => [it.no, it]))
  for (const [no, v] of Object.entries(raw as Record<string, unknown>)) {
    const it = byNo.get(no)
    if (!it) return { error: `bool_suggestions 含未知項次「${no}」,請對照範本項次` }
    if (it.kind !== 'bool') {
      return { error: `項次「${no}」是數值實測項,不接受任何建議值 —— 實測值一律由使用者親自量測填寫` }
    }
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      return { error: `項次「${no}」的建議必須是 { value: true/false, basis: 依據 } 物件` }
    }
    const { value, basis } = v as { value?: unknown; basis?: unknown }
    if (typeof value !== 'boolean') return { error: `項次「${no}」的建議值 value 必須是 true/false` }
    if (typeof basis !== 'string' || basis.trim().length < 4) {
      return {
        error:
          `項次「${no}」缺少有效依據 —— bool 建議必須附依據(basis),` +
          '寫出你依據工具回傳的哪段內容(照片說明、查驗紀錄等)這樣建議;推論不出來就省略該項',
      }
    }
    suggestions.set(no, { value, basis: basis.trim() })
  }
  return { suggestions }
}

// draft_inspection 執行:查詢一律走 userClient(RLS);寫(文件、AI 版本、agent_actions)只用 service client。
export async function draftInspection(
  db: SupabaseClient,
  projectId: string,
  service: SupabaseClient | null,
  userId: string | undefined,
  input: Record<string, unknown>,
) {
  const d = toolDate(input.check_date, 'check_date')
  if ('error' in d) return d
  if (input.work_item_id !== undefined && !isUuid(input.work_item_id)) return { error: 'work_item_id 必須是 UUID' }
  if (input.template_id !== undefined && !isUuid(input.template_id)) return { error: 'template_id 必須是 UUID' }
  if (!service || !userId) return { error: '伺服器未設定,暫時無法建立草稿' }
  const repo = supabaseDraftRepo(db, service, projectId)

  // 本案自主檢查表範本(kind=self_check;監造查驗表單的範本不給廠商自檢用);created_at 升冪 → 挑選與平手確定性
  const tplRes = await repo.listChecklistTemplates()
  if ('error' in tplRes) return { error: tplRes.error }
  const templates = tplRes.filter((t) => !t.kind || t.kind === 'self_check')
  if (!templates.length) {
    // 誠實回報,不是失敗 —— agent 要能把這句話轉述給使用者
    return { note: '本案尚未建立自主檢查表範本,請先到自主檢查表頁建立範本。' }
  }

  // 工項(選填;RLS + .eq(project_id) 縱深防禦)
  let workItem: LeafWorkItem | null = null
  if (input.work_item_id) {
    const { data: wi, error: wiErr } = await db
      .from('work_items')
      .select('id, item_key, item_no, description, unit, sort_order')
      .eq('project_id', projectId)
      .eq('id', input.work_item_id)
      .maybeSingle()
    if (wiErr) return toolError('draftInspection', wiErr)
    if (!wi) return { error: '找不到此工項(或不屬於本案),可先用 search_boq 查正確的 work_item_id' }
    workItem = wi as LeafWorkItem
  }

  // 挑範本:指定就用;否則確定性關鍵字相符;挑不出來就誠實列清單請指定
  let template: ChecklistTemplateRow
  let templateReason: string
  if (input.template_id) {
    const found = templates.find((t) => t.id === input.template_id)
    if (!found) return { error: '找不到此自主檢查表範本(或不屬於本案)' }
    template = found
    templateReason = '你指定的範本'
  } else {
    const picked = pickChecklistTemplate(templates, workItem?.description ?? null, { workItemId: workItem?.id ?? null })
    if (!picked) {
      return {
        note: '無法判斷該用哪張檢查表範本,請指定 template_id 後重試。',
        templates: templates.map((t) => ({ id: t.id, title: t.title })),
      }
    }
    template = picked.template
    templateReason = picked.reason
  }
  const items = Array.isArray(template.items) ? template.items : []
  if (!items.length) return { error: `範本「${template.title}」沒有任何檢查項目,無法擬稿` }
  const v = validateBoolSuggestions(items, input.bool_suggestions)
  if ('error' in v) return v

  const out = await agentDraftSelfCheck({ repo, userId, date: d.date, template, templateReason, workItem, boolSuggestions: v.suggestions })
  if ('error' in out || 'note' in out) return out
  const { written, photoCount } = out
  const numPending = items.filter((it) => it.kind === 'num').length
  const noteByAction: Record<string, string> = {
    created: '已建立自主檢查表文件草稿(AI 版本),也放進使用者的草稿收件匣;檢查表尚未成立——數值實測項須使用者親自量測填寫、AI 建議的勾選須逐項確認,簽署後系統才依量化標準判定。',
    version_added: '已在這份自主檢查表文件草稿新增一個 AI 版本;檢查表尚未成立,須使用者親自量測填寫、逐項確認並簽署。',
    unchanged: '這份自主檢查表草稿的內容與目前版本相同,未新增版本;請使用者到自主檢查表頁審核。',
    suggested: '這份自主檢查表已有使用者編修過的版本,新內容只作為建議放在自主檢查表頁,由使用者決定是否套用。',
  }
  // 回給模型的是「文件草稿已建立」的事實 —— 不可宣稱檢查表已建立、已合格或已判定
  return {
    ok: true,
    agent_action_id: written.agent_action_id,
    document_id: written.document_id,
    version_no: written.version_no,
    template_title: template.title,
    check_date: d.date,
    待填實測項: numPending,
    AI建議勾選項: v.suggestions.size,
    照片數: photoCount,
    ...(templateReason !== '你指定的範本' ? { 範本挑選依據: `${templateReason}(不對可改指定 template_id 重擬)` } : {}),
    note: noteByAction[written.action],
  }
}
