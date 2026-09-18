// 示範模式(未設定 Supabase)的文書範本 fixture——真專案一律向伺服器 fn_field_document_template 取
// (DB migration 20260917221000 是唯一定義;介面與列印的「示範範本」標記、必填鍵、人填欄都由它推導)。
// 示範模式沒有 DB,這裡是 demoSeed 之外的另一份「假 DB」資料;為避免漂移,demoFieldDocTemplates.test.js
// 釘住它與 Edge 鏡像(SUPERVISOR_LOG_TEMPLATE／SUPERVISOR_LOG_REQUIRED_KEYS)的鍵、版本與必填鍵一致,
// 而 Edge 鏡像又由 pgTAP supervisor_logs.sql 對 DB 釘住。欄位文案若改,三處要一起改。
const SUPERVISOR_LOG_DEMO = Object.freeze({
  key: 'supervisor_log_demo',
  version: 1,
  doc_type: 'supervisor_log',
  title: '監造日誌',
  is_demo: true,
  demo_label: '示範範本',
  disclaimer: '本表為示範範本:欄位依常見公共工程監造日誌整理,非任何機關公定或法定格式;實案範本提供後另建範本,已簽署文件仍以簽署當時的範本呈現。',
  sections: [
    { key: 'basic', title: '一、基本資料', fields: [
      { key: 'log_date', label: '日期', kind: 'date', required: true, human_only: false },
      { key: 'weather_am', label: '天氣(上午)', kind: 'text', required: true, human_only: false },
      { key: 'weather_pm', label: '天氣(下午)', kind: 'text', required: true, human_only: false } ] },
    { key: 'attendance', title: '二、監造到場人員', fields: [
      { key: 'attendance', label: '到場人員與時段', kind: 'list', required: true, human_only: true,
        note: '只能由監造親自填寫並確認;系統不從任何照片(含監造自己的照片)推定到場。本日未到場請標不適用並填原因。' } ] },
    { key: 'supervision', title: '三、監造事項(抽查、督導)', fields: [
      { key: 'supervision_items', label: '監造事項', kind: 'list', required: true, human_only: false } ] },
    { key: 'inspections', title: '四、查驗情形', fields: [
      { key: 'inspection_ids', label: '當日查驗', kind: 'ref_list', ref_type: 'inspection', required: false, human_only: false } ] },
    { key: 'contractor', title: '五、廠商施工情形', fields: [
      { key: 'contractor_summary', label: '施工情形摘要', kind: 'text', required: true, human_only: false,
        note: '引用同日已簽署／已提送的施工日誌時標來源;廠商未施工請標不適用並填原因。' },
      { key: 'daily_log_receipt', label: '施工日誌收件情形', kind: 'object', required: false, human_only: false } ] },
    { key: 'notices', title: '六、通知／督導事項', fields: [
      { key: 'notices', label: '通知事項', kind: 'list', required: false, human_only: false } ] },
    { key: 'followups', title: '七、追蹤事項', fields: [
      { key: 'followups', label: '追蹤事項', kind: 'list', required: false, human_only: false } ] },
    { key: 'note', title: '八、備註', fields: [
      { key: 'note', label: '備註', kind: 'text', required: false, human_only: false } ] },
  ],
})

export function demoFieldDocumentTemplate(docType) {
  return docType === 'supervisor_log' ? SUPERVISOR_LOG_DEMO : null
}
