// extract-requirements 的提示詞與輸出結構(B6 自 extract-requirements/index.ts 純搬移)。
// ---------------------------------------------------------------------------
// PROMPT_VERSION 與 SCHEMA / buildPrompt 綁在同一檔:這個常數的意義就是「這組提示詞
// 的版本」,寫進 document_ingestion_runs.prompt_version 供追溯。改 schema 欄位、列舉
// 值或提示詞措辭都要升版,分開放會讓人改了 prompt 忘了升版。
// 純函式、無 I/O:值域來自 requirementExtraction.ts(與 DB CHECK 約束同一份)。

import {
  REQUIREMENT_TYPES, RESPONSIBLE_PARTY_TYPES, LIFECYCLE_PHASES,
  TRIGGER_TYPES, OFFSET_DIRS, FREQUENCY_TYPES,
} from './requirementExtraction.ts'
import type { BatchPage } from './requirementExtraction.ts'

export const PROMPT_VERSION = 'extract-requirements/v3'

const SOURCE_SCHEMA = {
  type: 'object',
  properties: {
    page_number: { type: 'number', description: '引註所在頁碼,必須是輸入中「=== 第 N 頁 ===」的 N;無可靠頁碼(段落文件)填 0' },
    section: { type: 'string', description: '章節,如「第五章」或「5.2」;沒有就空字串' },
    clause: { type: 'string', description: '條款編號,如 §12.4 或 第九條;沒有就空字串' },
    quotation: { type: 'string', description: '逐字引註文件原文(不可改寫、不可摘要、不可翻譯),20~80 字' },
  },
  required: ['page_number', 'section', 'clause', 'quotation'],
}

const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '需求標題,20 字內' },
    description: { type: 'string', description: '需求內容的中立描述;沒有補充就空字串' },
    requirement_type: { type: 'string', enum: [...REQUIREMENT_TYPES], description: '需求類型' },
    responsible_party_type: { type: 'string', enum: ['', ...RESPONSIBLE_PARTY_TYPES], description: '負責方:agency=機關、supervisor=監造、contractor=施工廠商;不確定就空字串' },
    lifecycle_phase: { type: 'string', enum: ['', ...LIFECYCLE_PHASES], description: '適用階段;不確定就空字串' },
    trigger_type: { type: 'string', enum: ['', ...TRIGGER_TYPES], description: '期限觸發點(僅期限/週期義務適用);沒有就空字串' },
    trigger_config: {
      type: 'object',
      properties: {
        offset_days: { type: 'number', description: '期限天數(相對觸發點);不適用就 0' },
        offset_dir: { type: 'string', enum: [...OFFSET_DIRS], description: '之前或之後' },
        fixed_date: { type: 'string', description: 'trigger_type=fixed 時 YYYY-MM-DD;否則空字串' },
      },
      required: ['offset_days', 'offset_dir', 'fixed_date'],
    },
    frequency_type: { type: 'string', enum: ['', ...FREQUENCY_TYPES], description: '週期性義務的頻率:daily=每日、weekly=每週、monthly=每月、quarterly=每季、yearly=每年;非週期義務空字串' },
    frequency_config: {
      type: 'object',
      properties: {
        day: { type: 'number', description: '每月/每季/每年的幾日(1~31);不適用就 0' },
        weekday: { type: 'number', description: 'weekly 時星期幾:1=週一…7=週日;不適用就 0' },
        month: { type: 'number', description: 'yearly 時幾月(1~12);quarterly 時季內第幾個月(1~3);不適用就 0' },
      },
      required: ['day', 'weekday', 'month'],
    },
    acceptance_criteria: { type: 'string', description: '允收/合格標準(引規範數值);沒有就空字串' },
    evidence_requirement: { type: 'string', description: '應留存的佐證(紀錄/照片/報告/試驗單);沒有就空字串' },
    source: SOURCE_SCHEMA,
    confidence: { type: 'number', description: '這項需求確為文件義務的信心 0~1' },
    candidate_work_items: {
      type: 'array',
      items: { type: 'string' },
      description: '相關 BOQ 工項代號(只能用下方工項清單的 W 代號),最多 3 個;沒有就空陣列',
    },
  },
  required: ['title', 'description', 'requirement_type', 'responsible_party_type',
    'lifecycle_phase', 'trigger_type', 'trigger_config', 'frequency_type',
    'frequency_config', 'acceptance_criteria', 'evidence_requirement', 'source',
    'confidence', 'candidate_work_items'],
}

export const SCHEMA = {
  type: 'object',
  properties: { requirements: { type: 'array', items: SUGGESTION_SCHEMA } },
  required: ['requirements'],
}

// 一批頁 → 模型輸入文字(批已依預算切好,這裡不再截斷)
export function buildBatchText(pages: BatchPage[], paginated: boolean) {
  return pages.map((p) => {
    const header = paginated
      ? `=== 第 ${p.page_number} 頁 ===`
      : `=== 段落 ${p.page_number}(此文件無可靠頁碼)===`
    return `${header}\n${p.extracted_text || ''}\n`
  }).join('\n')
}

export function buildPrompt(opts: {
  title: string
  documentType: string
  paginated: boolean
  documentText: string
  catalogLines: string
  batchNote: string      // 分批時告知模型本段範圍,避免它以為整份文件只有這幾頁
}) {
  const pageRule = opts.paginated
    ? '每項的 source.page_number 必須是上方「=== 第 N 頁 ===」實際出現的 N,引註原文必須出現在該頁。'
    : '此文件沒有可靠頁碼:source.page_number 一律填 0,改以 section / clause 標明出處。'
  return (
    '以下是台灣公共工程專案文件的逐頁文字。\n' +
    `文件名稱:${opts.title}\n文件類型:${opts.documentType}\n` +
    (opts.batchNote ? `${opts.batchNote}\n` : '') + '\n' +
    '任務:通讀全文,抽出「可執行的履約需求」——必須提送/申報、應辦檢驗/試驗、應通知/會同/見證、' +
    '停留點(未查驗不得續作)、應留存的紀錄/照片/報告、期限與週期義務、允收標準、取樣/試驗頻率等。\n' +
    '不要把以下內容當成需求:一般背景說明、純名詞定義、目錄項目、沒有具體義務的敘述性文字。\n' +
    '每一項需求:\n' +
    '- source.quotation 必須是文件原文的逐字引註(不可改寫、不可摘要),20~80 字。\n' +
    `- ${pageRule}\n` +
    '- 各欄位只能使用列舉值;不確定的欄位留空字串或 0,不要臆測。\n' +
    '- 循環義務(如每日施工日誌、每週工安會議、每月月報、每季/每年檢測保養)填 frequency_type 與 frequency_config;' +
    '文件只寫頻率沒寫固定日子時,config 不適用的欄位填 0,不要自己編日期。\n' +
    '- 用中立語言描述義務本身;不要下違法、違約、疏失之類的定性判斷。\n' +
    '- candidate_work_items 只能引用下方工項清單的 W 代號(最多 3 個);沒有明確相關工項就回空陣列。\n\n' +
    (opts.catalogLines
      ? `=== 專案 BOQ 工項清單(代號 → 工項)===\n${opts.catalogLines}\n\n`
      : '=== 專案 BOQ 工項清單 ===\n(此專案尚無工項;candidate_work_items 一律回空陣列)\n\n') +
    `=== 文件內容 ===\n${opts.documentText}`
  )
}
