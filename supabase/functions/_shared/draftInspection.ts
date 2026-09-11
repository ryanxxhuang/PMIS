// 廠商 Agent:自主檢查表草稿 draft_inspection(B4 由 agentTools.ts 抽出)。
// ---------------------------------------------------------------------------
// 只寫 agent_actions —— 絕不寫 checklist_records;真正的檢查表由使用者在收件匣
// 接受後、前端走 createChecklistRecord 建立。
// 紅線:查驗實測值(kind:'num')不讓 AI 讀,本檔不存在任何對 num 項賦值的路徑;
// buildInspectionDraft / pickChecklistTemplate 是純函式,agentTools.test.ts 釘住。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { formatDate, parseDateUTC, taipeiTodayUTC } from './contractDue.ts'
import { isUuid } from './uuid.ts'
import { isDate, toolError } from './agentToolCommon.ts'

// ── 批4(任務B):draft_inspection 實作 ──────────────────────────────────────

// checklist_templates.items 的實際形狀(baseline migration):
// [{no,group,item,kind:'num'|'bool',min,max,unit,standard,source}]
export type ChecklistTemplateItem = {
  no: string
  group?: string | null
  item: string
  kind: 'num' | 'bool'
  min?: number | null
  max?: number | null
  unit?: string | null
  standard?: string | null
  source?: string | null
}

// 範本挑選(確定性關鍵字相符,非 AI):以工項描述的相鄰雙字組對範本標題計分,
// 取最高分;同分取排序較前者(呼叫端已依 created_at 升冪,平手決策確定性)。
// 僅一張範本時直接用;沒有描述或全部 0 分 → 回 null(誠實請使用者指定,不亂挑)。
export function pickChecklistTemplate<T extends { title: string }>(
  templates: T[],
  workItemDesc: string | null | undefined,
): { template: T; reason: string } | null {
  if (!templates.length) return null
  if (templates.length === 1) return { template: templates[0], reason: '本案僅有這一張範本' }
  const desc = (workItemDesc || '').replace(/\s+/g, '')
  if (!desc) return null
  const grams = new Set<string>()
  const chars = [...desc]
  if (chars.length === 1) grams.add(desc)
  for (let i = 0; i + 1 < chars.length; i++) grams.add(chars[i] + chars[i + 1])
  let best: T | null = null
  let bestScore = 0
  for (const t of templates) {
    let score = 0
    for (const g of grams) if (t.title.includes(g)) score += 1
    if (score > bestScore) { best = t; bestScore = score }
  }
  if (!best) return null
  return { template: best, reason: `依工項「${workItemDesc}」與範本標題的相符度挑選,若不對請指定範本` }
}

export type InspectionDraftInput = {
  template: { id: string; title: string; source?: string | null; items: ChecklistTemplateItem[] }
  templateReason: string // 挑中這張範本的依據(原樣寫進 rationale,讓收件的人能質疑)
  checkDate: string
  workItem?: { id: string; item_no?: string | null; description?: string | null } | null
  locationHint?: string | null // 當日該工項照片的 caption 線索;取不到就 null
  photoIds?: string[]
  boolSuggestions?: unknown // 模型對 bool 項的建議(嚴格驗證,見下)
}

// 實測值的紅線(本批最重要的判斷,絕不可放寬):
//   * kind:'num' → 一律 { value: null, needs_input: true },由人親自量測填寫。
//     本函式(與整個檔案)不存在任何對 num 項賦值的路徑 —— boolSuggestions 指到
//     num 項直接回 error(不是默默忽略,讓模型知道這條路不通)。
//   * kind:'bool' → 模型有把握才經 boolSuggestions 給建議,每項必須附 basis(依據);
//     模型在這條流程沒有視覺輸入,依據只能來自工具回傳的文字 —— 沒依據的建議
//     直接拒絕,不是默默收下。每項標 ai_suggested: true + ai_basis(前端據以顯示
//     「AI 建議」與依據小字,不得自動送出);false 也如實輸出(勾「無」同樣是
//     判定輸入,不可因 falsy 被吞);沒給的一律留空標 needs_input。
//   * 不呼叫 judgeChecklist:值沒填完,判定沒有意義 —— overall 留 null,由使用者
//     填完實測值後走前端既有 createChecklistRecord(內部 judgeChecklist)自動判定。
// payload 形狀對齊前端收件匣的接受路徑(results 以項次 no 為鍵、template_id 必要、
// value 為 null 的項不會進存檔 values —— 未檢 ≠ 合格)。
export function buildInspectionDraft(input: InspectionDraftInput):
  | { payload: Record<string, unknown>; summary: string; rationale: string; numPending: number; boolSuggested: number }
  | { error: string } {
  const { template, templateReason, checkDate, workItem, locationHint, boolSuggestions } = input
  const items = template.items || []
  if (!items.length) return { error: `範本「${template.title}」沒有任何檢查項目,無法擬稿` }

  // bool_suggestions 嚴格驗證:只接受「存在且 kind 為 bool」的項次,且每筆
  // 必須是 { value: boolean, basis: string } —— 缺依據的建議一律拒絕
  const suggestions = new Map<string, { value: boolean; basis: string }>()
  if (boolSuggestions !== undefined && boolSuggestions !== null) {
    if (typeof boolSuggestions !== 'object' || Array.isArray(boolSuggestions)) {
      return { error: 'bool_suggestions 必須是物件(鍵=項次編號、值={ value: true/false, basis: 依據 })' }
    }
    const byNo = new Map(items.map((it) => [it.no, it]))
    for (const [no, raw] of Object.entries(boolSuggestions as Record<string, unknown>)) {
      const it = byNo.get(no)
      if (!it) return { error: `bool_suggestions 含未知項次「${no}」,請對照範本項次` }
      if (it.kind !== 'bool') {
        return { error: `項次「${no}」是數值實測項,不接受任何建議值 —— 實測值一律由使用者親自量測填寫` }
      }
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { error: `項次「${no}」的建議必須是 { value: true/false, basis: 依據 } 物件` }
      }
      const { value, basis } = raw as { value?: unknown; basis?: unknown }
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
  }

  // results 以項次 no 為鍵;value/needs_input/ai_suggested 是前端契約,
  // kind/group/item/unit/standard 是收件匣卡片的展示欄位(轉存檔時只取 value)。
  const results: Record<string, unknown> = {}
  let numPending = 0
  let boolSuggested = 0
  let boolPending = 0
  for (const it of items) {
    const base = { kind: it.kind, group: it.group ?? null, item: it.item, unit: it.unit ?? null, standard: it.standard ?? null }
    if (it.kind === 'bool' && suggestions.has(it.no)) {
      const s = suggestions.get(it.no)!
      // ai_basis:這筆建議憑什麼 —— 沒有記錄依據的推論,事後和猜測分不出來
      results[it.no] = { ...base, value: s.value, ai_suggested: true, ai_basis: s.basis }
      boolSuggested += 1
    } else {
      // num 項只會走到這個分支 —— value 永遠 null,檔案內沒有其他賦值路徑
      results[it.no] = { ...base, value: null, needs_input: true }
      if (it.kind === 'bool') boolPending += 1
      else numPending += 1
    }
  }

  const payload = {
    template_id: template.id, // 前端接受時據以查回完整 template,再走 createChecklistRecord
    template_title: template.title,
    template_source: template.source ?? null,
    check_date: checkDate,
    location: locationHint || null,
    // 注意:前端 createChecklistRecord 目前不寫 work_item_id(checklist_records
    // 有此欄但存檔入參沒有)—— 這裡仍帶上供收件匣展示與日後補齊。
    work_item_id: workItem?.id ?? null,
    work_item_no: workItem?.item_no ?? null,
    work_item_desc: workItem?.description ?? null,
    results,
    overall: null, // 不判定:值沒填完判定沒有意義;填完後由系統依量化標準自動判定
    note: null,
    photo_ids: input.photoIds ?? [],
    field_sources: {
      template: templateReason,
      location: locationHint ? 'photo_caption' : null,
      num_values: 'needs_input', // 實測值沒有來源 —— 一律由人填
      bool_values: boolSuggested ? 'ai_suggested_partial' : 'needs_input',
    },
  }

  const [, m, d] = checkDate.split('-')
  const summary =
    `已擬好「${template.title}」自主檢查表草稿` +
    `(${Number(m)}/${Number(d)},實測值 ${numPending} 項待你填)`

  // rationale:逐欄位交代依據 —— 讓收件的人知道哪些可信、哪些必須自己填
  const rationaleParts = [
    `範本:${templateReason}。`,
    `實測值(數值項 ${numPending} 項):一律留空待你親自量測填寫 —— 系統與 AI 都不猜實測值;` +
      '你填完後由系統依量化標準自動判定合格與否,AI 不參與判定。',
    boolSuggested
      ? `勾選項:${boolSuggested} 項為 AI 依當日照片與對話線索的建議(已逐項標示「AI 建議」),送出前請逐項確認` +
        (boolPending ? `;另 ${boolPending} 項留空待你勾選。` : '。')
      : boolPending
        ? `勾選項:${boolPending} 項全部留空待你勾選,AI 未給任何建議。`
        : '',
    locationHint ? `部位:取自當日照片說明「${locationHint}」,請確認是否正確。` : '部位:未能從當日照片取得線索,留空待填。',
    workItem ? `工項:${[workItem.item_no, workItem.description].filter(Boolean).join(' ')}。` : '',
  ].filter(Boolean)

  return { payload, summary, rationale: rationaleParts.join('\n'), numPending, boolSuggested }
}

// draft_inspection 執行:查詢一律走 userClient(RLS);service 只用來寫 agent_actions。
export async function draftInspection(
  db: SupabaseClient,
  projectId: string,
  service: SupabaseClient | null,
  userId: string | undefined,
  input: Record<string, unknown>,
) {
  // check_date 驗證:格式 + 回轉一致(同 draft_daily_log)
  let checkDate: string
  if (input.check_date !== undefined) {
    if (!isDate(input.check_date)) return { error: 'check_date 必須是 YYYY-MM-DD' }
    const ms = parseDateUTC(input.check_date)
    if (ms == null || formatDate(ms) !== input.check_date) return { error: 'check_date 不是有效日期' }
    checkDate = input.check_date
  } else {
    checkDate = formatDate(taipeiTodayUTC())
  }
  if (input.work_item_id !== undefined && !isUuid(input.work_item_id)) return { error: 'work_item_id 必須是 UUID' }
  if (input.template_id !== undefined && !isUuid(input.template_id)) return { error: 'template_id 必須是 UUID' }
  if (!service || !userId) return { error: '伺服器未設定,暫時無法建立草稿' }

  // 本案範本(created_at 升冪 → 挑選與平手決策確定性)
  type TemplateRow = { id: string; title: string; source: string | null; items: unknown }
  const { data: tplData, error: tErr } = await db
    .from('checklist_templates')
    .select('id, title, source, items')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (tErr) return toolError('draftInspection', tErr)
  const templates = (tplData ?? []) as TemplateRow[]
  if (!templates.length) {
    // 誠實回報,不是失敗 —— agent 要能把這句話轉述給使用者
    return { note: '本案尚未建立自主檢查表範本,請先到品質管理建立範本。' }
  }

  // 工項(選填;RLS + .eq(project_id) 縱深防禦)
  let workItem: { id: string; item_no: string | null; description: string | null } | null = null
  if (input.work_item_id) {
    const { data: wi, error: wiErr } = await db
      .from('work_items')
      .select('id, item_no, description')
      .eq('project_id', projectId)
      .eq('id', input.work_item_id)
      .maybeSingle()
    if (wiErr) return toolError('draftInspection', wiErr)
    if (!wi) return { error: '找不到此工項(或不屬於本案),可先用 search_boq 查正確的 work_item_id' }
    workItem = wi
  }

  // 挑範本:指定就用;否則確定性關鍵字相符;挑不出來就誠實列清單請指定
  let template: TemplateRow
  let templateReason: string
  if (input.template_id) {
    const found = templates.find((t) => t.id === input.template_id)
    if (!found) return { error: '找不到此檢查表範本(或不屬於本案)' }
    template = found
    templateReason = '你指定的範本'
  } else {
    const picked = pickChecklistTemplate(templates, workItem?.description ?? null)
    if (!picked) {
      return {
        note: '無法判斷該用哪張檢查表範本,請指定 template_id 後重試。',
        templates: templates.map((t) => ({ id: t.id, title: t.title })),
      }
    }
    template = picked.template
    templateReason = picked.reason
  }

  // 當日該工項照片(台北時區界):location 線索(caption)+ 掛照片。
  // 沒指定工項就不撈 —— 不把不相干的照片掛上檢查表。
  let locationHint: string | null = null
  let photoIds: string[] = []
  if (workItem) {
    const { data: photos, error: phErr } = await db
      .from('photos')
      .select('id, caption, taken_at')
      .eq('project_id', projectId)
      .eq('work_item_id', workItem.id)
      .gte('taken_at', `${checkDate}T00:00:00+08:00`)
      .lte('taken_at', `${checkDate}T23:59:59+08:00`)
      .order('taken_at', { ascending: true })
    if (phErr) return toolError('draftInspection', phErr)
    photoIds = (photos ?? []).map((p) => p.id)
    const cap = (photos ?? []).map((p) => (p.caption || '').trim()).find((c) => c)
    if (cap) locationHint = cap.slice(0, 50)
  }

  const built = buildInspectionDraft({
    template: {
      id: template.id,
      title: template.title,
      source: template.source,
      items: (Array.isArray(template.items) ? template.items : []) as ChecklistTemplateItem[],
    },
    templateReason,
    checkDate,
    workItem,
    locationHint,
    photoIds,
    boolSuggestions: input.bool_suggestions,
  })
  if ('error' in built) return { error: built.error }

  // 唯一的寫入:agent_actions(service role)。絕不寫 checklist_records ——
  // 真正的檢查表由使用者在收件匣接受後、前端走 createChecklistRecord 建立。
  const { data: action, error: insErr } = await service
    .from('agent_actions')
    .insert({
      project_id: projectId,
      actor_user: userId,
      agent_role: 'contractor',
      kind: 'draft_inspection',
      target_table: 'checklist_records',
      summary: built.summary,
      rationale: built.rationale,
      evidence: { payload: built.payload },
    })
    .select('id')
    .single()
  if (insErr) return toolError('draftInspection', insErr)

  // 回給模型的是「草稿已放入收件匣」的事實 —— 讓它據實轉述,不可宣稱檢查表已建立
  return {
    ok: true,
    agent_action_id: action.id,
    template_title: template.title,
    check_date: checkDate,
    待填實測項: built.numPending,
    AI建議勾選項: built.boolSuggested,
    照片數: photoIds.length,
    ...(templateReason !== '你指定的範本' ? { 範本挑選依據: `${templateReason}(不對可改指定 template_id 重擬)` } : {}),
    note:
      '草稿已放進使用者的草稿收件匣;檢查表尚未建立,數值實測項須由使用者親自量測填寫,' +
      '合格判定由系統於填畢後自動執行 —— 不可宣稱檢查表已建立、已合格或已判定。',
  }
}
