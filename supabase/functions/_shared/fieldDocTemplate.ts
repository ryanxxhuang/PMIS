// 文書範本的純規則(P3b):範本本體只有一份定義在 DB(fn_field_document_template,migration 20260919141500),
// Edge 起稿於執行期向 DB 取回、前端向同一支 RPC 取回、示範模式讀 src/data/demoFieldDocTemplates.js 的 fixture
// (由 Vitest 對 migration 原文釘住)。這裡只放「從範本推導」的確定性規則,兩側同一份實作:
//   * 必填鍵(required)、人填欄(human_only:AI 不得帶入)、須確認欄(confirm_required 或 human_only:filled 不算齊備);
//   * 自主檢查表:檢查項目取自本案 checklist_templates.items,每項 results.<no> 皆必填,規則依框架範本 item_rules
//     (num 只能人填且須確認;bool 可由系統建議但須人逐項確認)——與 DB fn_field_document_self_check_item_keys 同一條規則。
// 與 photoMatch.ts／fieldDocText.ts 同一慣例:零 import、無 Deno／Node API,Vite 直接 import .ts(src/lib/fieldDocs.js re-export)。

export type TemplateItemRule = { human_only?: boolean; confirm_required?: boolean }
export type TemplateField = {
  key: string
  label?: string
  kind?: string
  required?: boolean
  human_only?: boolean
  confirm_required?: boolean
  note?: string
  ref_type?: string
  item_key?: string
  item_rules?: Record<string, TemplateItemRule>
  [extra: string]: unknown
}
export type TemplateSection = { key: string; title: string; fields: TemplateField[] }
export type FieldDocTemplate = {
  key: string
  version: number
  doc_type?: string
  title?: string
  is_demo?: boolean
  demo_label?: string
  disclaimer?: string
  sections: TemplateSection[]
}
// checklist_templates.items 的一項(baseline migration 的形狀)
export type ChecklistItemLike = {
  no: string
  item?: string | null
  kind?: string | null
  group?: string | null
  min?: number | null
  max?: number | null
  unit?: string | null
  standard?: string | null
  source?: string | null
}

const bool = (v: unknown): boolean => v === true

// 範本所有欄位(攤平,帶 section 鍵與標題)
export function templateFields(template: FieldDocTemplate | null | undefined): (TemplateField & { section: string; sectionTitle: string })[] {
  const out: (TemplateField & { section: string; sectionTitle: string })[] = []
  for (const s of Array.isArray(template?.sections) ? template!.sections : []) {
    for (const f of Array.isArray(s?.fields) ? s.fields : []) if (f?.key) out.push({ ...f, section: s.key, sectionTitle: s.title })
  }
  return out
}
export const templateRequiredKeys = (template: FieldDocTemplate | null | undefined): string[] =>
  templateFields(template).filter((f) => bool(f.required)).map((f) => f.key).sort()
export const templateHumanOnlyKeys = (template: FieldDocTemplate | null | undefined): string[] =>
  templateFields(template).filter((f) => bool(f.human_only)).map((f) => f.key).sort()
// 須人確認:human_only 蘊含 confirm_required
export const templateConfirmRequiredKeys = (template: FieldDocTemplate | null | undefined): string[] =>
  templateFields(template).filter((f) => bool(f.human_only) || bool(f.confirm_required)).map((f) => f.key).sort()
export const templateFieldLabels = (template: FieldDocTemplate | null | undefined): Record<string, string> =>
  Object.fromEntries(templateFields(template).filter((f) => f.label).map((f) => [f.key, f.label as string]))

// 自主檢查表:框架範本的 results 欄位帶 item_rules(依項目 kind);沒有框架就沒有規則(全部 false)
export function checklistItemRules(frame: FieldDocTemplate | null | undefined): Record<string, TemplateItemRule> {
  const f = templateFields(frame).find((x) => x.key === 'results')
  return f?.item_rules && typeof f.item_rules === 'object' ? f.item_rules : {}
}

// 項目鍵 results.<no>(排序);rule=null 取全部、'human_only'／'confirm_required' 依 item_rules 取該規則為真的 kind
// (confirm_required 蘊含 human_only)。與 DB fn_field_document_self_check_item_keys 同一條規則。
export function checklistItemKeys(
  items: ChecklistItemLike[] | null | undefined,
  frame: FieldDocTemplate | null | undefined,
  rule: 'human_only' | 'confirm_required' | null = null,
): string[] {
  const rules = checklistItemRules(frame)
  const out: string[] = []
  for (const it of Array.isArray(items) ? items : []) {
    const no = typeof it?.no === 'string' ? it.no.trim() : ''
    if (!no) continue
    if (rule) {
      const r = rules[it.kind || 'bool'] || {}
      const hit = bool(r[rule]) || (rule === 'confirm_required' && bool(r.human_only))
      if (!hit) continue
    }
    out.push(`results.${no}`)
  }
  return out.sort()
}

// 依文書類型推導(施工日誌固定欄不在這裡:公定格式六欄住在 DB fn_field_document_required_fields 與前端 DAILY_LOG_FIXED_REQUIRED)
export function docRequiredKeys(docType: string, template: FieldDocTemplate | null | undefined, checklistItems: ChecklistItemLike[] | null = null): string[] {
  const keys = new Set(templateRequiredKeys(template))
  if (docType === 'self_check') for (const k of checklistItemKeys(checklistItems, template, null)) keys.add(k)
  return [...keys].sort()
}
export function docHumanOnlyKeys(docType: string, template: FieldDocTemplate | null | undefined, checklistItems: ChecklistItemLike[] | null = null): string[] {
  const keys = new Set(templateHumanOnlyKeys(template))
  if (docType === 'self_check') for (const k of checklistItemKeys(checklistItems, template, 'human_only')) keys.add(k)
  return [...keys].sort()
}
export function docConfirmRequiredKeys(docType: string, template: FieldDocTemplate | null | undefined, checklistItems: ChecklistItemLike[] | null = null): string[] {
  const keys = new Set(templateConfirmRequiredKeys(template))
  if (docType === 'self_check') for (const k of checklistItemKeys(checklistItems, template, 'confirm_required')) keys.add(k)
  return [...keys].sort()
}

// 內容裡的範本鍵／版本(簽署時 DB 會驗 key 是否為目前範本)
export const templateStamp = (template: FieldDocTemplate): { key: string; version: number } => ({ key: template.key, version: template.version })
