// P0-07.5 deterministic-assisted document classifier (pure, no AI call).
// Input: filename + the first extracted text of the file. Output: one of the
// EXISTING persistent document types with a confidence and a short reason -
// the classifier can never invent a new type. High-confidence results are
// auto-accepted; everything else lands in the 待確認 queue for a human with
// document-management permission.
//
// Price/BOQ-style files are deliberately caught BEFORE the generic 契約
// keyword and classified as 'other', which is never routed to Requirement
// extraction - a detailed price list must not be read as contract prose.
import { normalizeSourceText } from '../../supabase/functions/_shared/sourceVerify.ts'

export const CLASSIFIABLE_DOCUMENT_TYPES = Object.freeze([
  'contract', 'specification', 'quality_plan', 'itp', 'form_package',
  'submittal_document', 'drawing', 'report', 'other',
])

export const DOCUMENT_TYPE_LABELS = Object.freeze({
  contract: '契約核心文件',
  specification: '施工規範',
  quality_plan: '品質管理文件',
  itp: '檢驗停留點計畫',
  form_package: '表單與附件',
  submittal_document: '送審文件',
  drawing: '圖說',
  report: '報告',
  other: '其他',
})

export const AUTO_ACCEPT_THRESHOLD = 0.8

// Ordered filename rules - first hit wins. The price guard sits above the
// generic contract keyword on purpose.
const FILENAME_RULES = [
  { pattern: /價目|標單|單價分析|單價表|預算書|價格/i, type: 'other', reason: '價格/標單文件' },
  { pattern: /檢驗停留|檢驗及測試|檢驗計畫|itp/i, type: 'itp', reason: '檔名含檢驗停留點' },
  { pattern: /品質計畫|品管計畫|品質管理/i, type: 'quality_plan', reason: '檔名含品質計畫' },
  { pattern: /規範|技術規格|施工說明書/i, type: 'specification', reason: '檔名含規範' },
  { pattern: /送審/i, type: 'submittal_document', reason: '檔名含送審' },
  { pattern: /圖說|平面圖|設計圖|竣工圖|\.dwg/i, type: 'drawing', reason: '檔名含圖說' },
  { pattern: /表單|紀錄表|表格|格式/i, type: 'form_package', reason: '檔名含表單' },
  { pattern: /報告書|月報|報表/i, type: 'report', reason: '檔名含報告' },
  { pattern: /契約|合約|協議書/i, type: 'contract', reason: '檔名含契約' },
]

// Content rules run only when the filename says nothing and text exists.
const CONTENT_RULES = [
  { pattern: /履約保證金|契約總價|契約價金|甲方|立契約書人/, type: 'contract', reason: '內文含契約條款用語' },
  { pattern: /施工規範|材料規範|抽驗頻率|檢驗頻率/, type: 'specification', reason: '內文含規範用語' },
  { pattern: /品質計畫|品管組織|自主檢查/, type: 'quality_plan', reason: '內文含品質計畫用語' },
  { pattern: /檢驗停留點|限止點|見證點/, type: 'itp', reason: '內文含檢驗停留點用語' },
]

const CONTENT_SAMPLE_LENGTH = 1500

export function classifyDocument({ filename = '', firstText = '', analyzable = true }) {
  for (const rule of FILENAME_RULES) {
    if (rule.pattern.test(filename)) {
      return finish({ type: rule.type, confidence: 0.85, reason: rule.reason })
    }
  }
  if (analyzable && firstText) {
    const sample = normalizeSourceText(firstText).slice(0, CONTENT_SAMPLE_LENGTH)
    for (const rule of CONTENT_RULES) {
      if (rule.pattern.test(sample)) {
        return finish({ type: rule.type, confidence: 0.7, reason: rule.reason })
      }
    }
  }
  return finish({ type: 'other', confidence: 0.4, reason: '無法由檔名或內文判斷' })
}

function finish({ type, confidence, reason }) {
  const documentType = CLASSIFIABLE_DOCUMENT_TYPES.includes(type) ? type : 'other'
  return {
    document_type: documentType,
    confidence,
    reason,
    classification_status: confidence >= AUTO_ACCEPT_THRESHOLD ? 'auto_accepted' : 'needs_review',
  }
}

// Requirement extraction routing: only human-usable obligation sources, and
// only once the classification is trusted (auto-accepted or human-confirmed).
// 'other' (including price lists), drawings, forms, submittal copies, and
// reports are stored + classified but never sent to the extraction prompt.
export const EXTRACTABLE_DOCUMENT_TYPES = Object.freeze([
  'contract', 'specification', 'quality_plan', 'itp',
])

export function shouldExtractRequirements({ document_type, classification_status }) {
  return EXTRACTABLE_DOCUMENT_TYPES.includes(document_type)
    && (classification_status === 'auto_accepted' || classification_status === 'confirmed')
}

// Presentation groups for the package file list. These are labels over the
// persistent document types (plus the price-guard reason) - not new enums.
export const PRESENTATION_GROUPS = Object.freeze([
  '契約核心文件', '施工規範', '品質管理文件', '價格與標單', '表單與附件', '圖說', '其他',
])

export function presentationGroup(documentType, reason = '') {
  if (documentType === 'contract') return '契約核心文件'
  if (documentType === 'specification') return '施工規範'
  if (documentType === 'quality_plan' || documentType === 'itp') return '品質管理文件'
  if (documentType === 'form_package' || documentType === 'submittal_document') return '表單與附件'
  if (documentType === 'drawing') return '圖說'
  if (documentType === 'other' && /價格|標單/.test(reason || '')) return '價格與標單'
  return '其他'
}
