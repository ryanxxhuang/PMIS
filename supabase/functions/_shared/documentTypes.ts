// 文件分類的單一真相:值域與中文標籤。
// 前端 src/lib/documentClassifier.js 與 classify-document Edge Function 都從
// 這裡 import——W14 加入 AI 分類時抽出來,避免兩份清單各自演化
// (edge function 部署只打包 functions/,所以真相放這一側,前端跨目錄 import,
// 與 sourceVerify.ts 的既有慣例相同)。
export const CLASSIFIABLE_DOCUMENT_TYPES = Object.freeze([
  'contract', 'specification', 'quality_plan', 'itp', 'form_package',
  'submittal_document', 'drawing', 'report', 'other',
] as const)

export const DOCUMENT_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
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
