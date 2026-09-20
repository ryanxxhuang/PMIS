// 檢查表範本(checklist_templates)的表單純函式(P3g)。規則的權威在 DB checklist_templates_guard／
// fn_checklist_applies_to／fn_checklist_items_normalize(migration 20260920050000)——這裡是同一組規則的
// 前端鏡像,只負責「送出前就講清楚哪裡不合格」與把畫面上的字串轉成伺服器要的形狀;伺服器仍會再驗一次,
// 兩邊不一致時以伺服器訊息為準(UI 原樣顯示)。
//
// 用途(kind):self_check=廠商第一級自主檢查表;inspection_form=監造第二級查驗表單的查驗項目。
// 查驗階段(stage_key)只有 inspection_form 有意義(沿用 ITP H 點的階段鍵語意,選自該案檢驗停留點)。
// 適用條件(applies_to)是候選推斷的依據:{work_item_ids:[…], keywords:[…]};指名工項是硬條件(範本宣告
// 它只適用這些工項),關鍵字是比對工項描述的提示。兩者皆空 → null(不是空物件)。

export const TEMPLATE_KINDS = Object.freeze([
  { value: 'self_check', label: '自主檢查表', hint: '廠商第一級自主檢查用；每項都要逐項確認後簽署。' },
  { value: 'inspection_form', label: '監造查驗表單', hint: '監造第二級查驗判定用；可綁定查驗階段，只有監造能建立與編輯。' },
])
export const TEMPLATE_KIND_LABEL = Object.freeze(
  Object.fromEntries(TEMPLATE_KINDS.map((k) => [k.value, k.label])))
export const ITEM_KINDS = Object.freeze([
  { value: 'bool', label: '勾選（符合／不符）' },
  { value: 'num', label: '實測值（依上下限判定）' },
])

const text = (v) => String(v ?? '').trim()
// 去空白後比對(與 Edge pickChecklistTemplate 同一個口徑:半形／全形空白不影響關鍵字命中)
const squeeze = (v) => String(v ?? '').replace(/\s+/g, '')

// 「誰可以維護這種用途的範本」:鏡像 DB——自主檢查表吃 can_write(廠商／監造／專案 admin),
// 監造查驗表單另外要求監造成員或 admin_override(與 create_inspection_form_draft 同一條規則,不是新角色)。
export function canAuthorTemplate(kind, can) {
  if (!can?.write) return false
  return kind === 'inspection_form' ? !!can.approve : true
}

export const emptyTemplateItem = () => ({ no: '', group: '', item: '', kind: 'bool', min: '', max: '', unit: '', standard: '', source: '' })
export const emptyTemplateForm = (kind = 'self_check') => ({
  id: null, kind, title: '', source: '', stage_key: '', workItemIds: [], keywords: '', items: [emptyTemplateItem()],
})

// DB 列 → 表單(數字回成字串,空值回成空字串;畫面上沒有 null)
export function templateFormFromRow(row) {
  const applies = row?.applies_to && typeof row.applies_to === 'object' ? row.applies_to : {}
  return {
    id: row?.id ?? null,
    kind: row?.kind || 'self_check',
    title: row?.title || '',
    source: row?.source || '',
    stage_key: row?.stage_key || '',
    workItemIds: Array.isArray(applies.work_item_ids) ? applies.work_item_ids.filter(Boolean) : [],
    keywords: (Array.isArray(applies.keywords) ? applies.keywords : []).join('、'),
    items: (Array.isArray(row?.items) ? row.items : []).map((it) => ({
      no: text(it?.no), group: text(it?.group), item: text(it?.item),
      kind: it?.kind === 'num' ? 'num' : 'bool',
      min: it?.min === 0 || it?.min ? String(it.min) : '',
      max: it?.max === 0 || it?.max ? String(it.max) : '',
      unit: text(it?.unit), standard: text(it?.standard), source: text(it?.source),
    })),
  }
}

// 關鍵字輸入(逗號／頓號／換行分隔)→ 陣列(去空白、去重、排序;與 DB fn_checklist_applies_to 同一結果)
export function parseKeywords(input) {
  const list = String(input ?? '').split(/[,，、;；\n]/).map((s) => s.trim()).filter(Boolean)
  return [...new Set(list)].sort()
}

// 表單的適用條件 → 伺服器形狀;兩者皆空回 null
export function appliesToPayload({ workItemIds = [], keywords = '' } = {}) {
  const ids = [...new Set((workItemIds || []).filter(Boolean))].sort()
  const kws = parseKeywords(keywords)
  if (!ids.length && !kws.length) return null
  const out = {}
  if (ids.length) out.work_item_ids = ids
  if (kws.length) out.keywords = kws
  return out
}

// 表單項目 → 伺服器形狀(只留伺服器保留的鍵;數字轉 number)
export function itemsPayload(items = []) {
  return (items || []).map((it) => {
    const kind = it?.kind === 'num' ? 'num' : 'bool'
    const row = { no: text(it?.no), item: text(it?.item), kind }
    for (const k of ['group', 'unit', 'standard', 'source']) if (text(it?.[k])) row[k] = text(it[k])
    if (kind === 'num') {
      if (text(it?.min) !== '') row.min = Number(it.min)
      if (text(it?.max) !== '') row.max = Number(it.max)
    }
    return row
  })
}

// 送出前的檢查(鏡像 DB guard 的每一條;回傳人話清單,空陣列＝可送出)
export function templateFormIssues(form, { canApproveInspection = true } = {}) {
  const issues = []
  if (!text(form?.title)) issues.push('範本必須有標題。')
  if (form?.kind !== 'inspection_form' && text(form?.stage_key)) {
    issues.push('只有監造查驗表單範本可以指定查驗階段。')
  }
  if (form?.kind === 'inspection_form' && !canApproveInspection) {
    issues.push('監造查驗表單範本只有監造成員可建立或編輯。')
  }
  const items = form?.items || []
  const usable = items.filter((it) => text(it?.no) || text(it?.item))
  if (!usable.length) issues.push('至少要有一個檢查項目。')
  const seen = new Set()
  for (const it of usable) {
    const no = text(it?.no)
    const label = no || text(it?.item)
    if (!no) { issues.push(`項目「${text(it?.item)}」缺少項次。`); continue }
    if (seen.has(no)) { issues.push(`項次「${no}」重複。`); continue }
    seen.add(no)
    if (!text(it?.item)) { issues.push(`項次「${no}」缺少檢查內容。`); continue }
    if (it?.kind !== 'num') continue
    const hasMin = text(it?.min) !== ''
    const hasMax = text(it?.max) !== ''
    if (!hasMin && !hasMax) { issues.push(`項次「${label}」是實測值，至少要有下限或上限才判定得了。`); continue }
    if ((hasMin && !Number.isFinite(Number(it.min))) || (hasMax && !Number.isFinite(Number(it.max)))) {
      issues.push(`項次「${label}」的上下限必須是數字。`); continue
    }
    if (hasMin && hasMax && Number(it.min) > Number(it.max)) issues.push(`項次「${label}」的下限大於上限。`)
  }
  return issues
}

// 表單 → 寫入欄位(送出前呼叫端已用 templateFormIssues 擋過;空字串一律轉 null)
export function templateRowPayload(form) {
  return {
    title: text(form?.title),
    source: text(form?.source) || null,
    kind: form?.kind === 'inspection_form' ? 'inspection_form' : 'self_check',
    stage_key: form?.kind === 'inspection_form' ? (text(form?.stage_key) || null) : null,
    applies_to: appliesToPayload(form),
    items: itemsPayload((form?.items || []).filter((it) => text(it?.no) || text(it?.item))),
  }
}

// 清單上的「適用範圍」一句話(沒登錄就說沒登錄,不要讓人以為系統會自己配對)
export function appliesToText(row, leaves = []) {
  const applies = row?.applies_to && typeof row.applies_to === 'object' ? row.applies_to : null
  const ids = Array.isArray(applies?.work_item_ids) ? applies.work_item_ids : []
  const kws = Array.isArray(applies?.keywords) ? applies.keywords : []
  const parts = []
  if (ids.length) {
    const byId = new Map((leaves || []).flatMap((l) => [[l.id, l], [l.item_key, l]]).filter(([k]) => k))
    const names = ids.map((id) => {
      const wi = byId.get(id)
      return wi ? `${wi.item_no || ''} ${wi.description || ''}`.trim() : '（已刪除的工項）'
    })
    parts.push(`指名工項：${names.join('、')}`)
  }
  if (kws.length) parts.push(`關鍵字：${kws.join('、')}`)
  if (row?.stage_key) parts.push(`查驗階段：${row.stage_key}`)
  return parts.length ? parts.join('　') : '未登錄適用條件（起稿時只能用標題相似度猜，挑不出來會請人指定）'
}

// 畫面預覽:這張範本會被哪些工項配到(與 Edge pickChecklistTemplate 的硬條件同口徑——
// 指名工項是「只適用這些」,關鍵字是提示。這裡只回「指名／關鍵字命中」兩種確定的相符,
// 標題相似度不預覽:那是挑不出來時才退而求其次的弱信號,先講給使用者聽反而會誤導)。
export function matchingLeaves(form, leaves = []) {
  const ids = new Set((form?.workItemIds || []).filter(Boolean))
  const kws = parseKeywords(form?.keywords).map(squeeze).filter(Boolean)
  if (!ids.size && !kws.length) return []
  return (leaves || []).filter((l) => {
    if (ids.has(l.id) || ids.has(l.item_key)) return true
    if (ids.size) return false // 指名了工項就只適用那些
    const desc = squeeze(l.description)
    return kws.some((k) => desc.includes(k))
  })
}
