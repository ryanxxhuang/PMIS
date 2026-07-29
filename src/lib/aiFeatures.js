// AI 功能註冊表(前端版)——批 A:AI 平台化資料層。
// ---------------------------------------------------------------------------
// 這份註冊表存在兩份,改動必須兩邊同步(key/label/category/edgeFunction/
// minPlan/isLlm/defaultEnabled 全部一致):
//   1) supabase/functions/_shared/aiFeatures.ts —— 伺服器端(edge functions)用
//   2) 本檔 —— 前端顯示/開關判斷用(平台管理後台、據 enabled 隱藏入口)
// 為什麼重複一份而不是 import:Deno edge function 部署只打包 functions 目錄,
// 無法 import 專案其他路徑(與 _shared/agentRole.ts 同一個限制、同一個慣例),
// 因此照 agentRole 的做法各留一份,並以 src/lib/aiFeatures.test.js 讀取 TS 原始碼
// 逐欄比對釘住同步——值域漂移會讓測試紅。
//
// 資料庫側的單一真相是 public.ai_features(migration 20260728000100 以本表 seed);
// 執行期的「可不可以用」一律問 DB(ai_feature_allowed),本檔只是 seed 來源與
// 前端顯示用的靜態中繼資料,絕不做權限判斷。
//
// 欄位語意:
//   key           功能識別碼(DB 主鍵;用量事件 feature_key 也用它)
//   label         中文顯示名(台灣用語)
//   category      分類:agent(對話)/document(讀文件)/draft(產草稿)/
//                 vision(看照片)/integration(外部介接)/automation(排程)
//   edgeFunction  對應的 supabase/functions/<目錄> 名稱
//   minPlan       最低方案:trial < standard < pro(階序見 PLAN_RANK)
//   isLlm         是否呼叫 LLM。false=不打 LLM、不算 token/成本(如中央氣象署
//                 API、確定性早報寄信),但仍是可獨立開關、需要計次的模組——
//                 用量事件照記,只是 token 與 cost 為 0
//   defaultEnabled 平台級預設開關(seed 值;之後由後台 admin RPC 調整 DB)

export const PLAN_RANK = { trial: 0, standard: 1, pro: 2 }

export const AI_FEATURES = [
  { key: 'agent.run', label: 'AI Agent 主控台', category: 'agent', edgeFunction: 'agent-run', minPlan: 'standard', isLlm: true, defaultEnabled: true },
  { key: 'assistant.chat', label: 'AI 問答助理', category: 'agent', edgeFunction: 'assistant-chat', minPlan: 'standard', isLlm: true, defaultEnabled: true },
  { key: 'contract.parse', label: '契約解析(時程/罰則)', category: 'document', edgeFunction: 'parse-contract', minPlan: 'standard', isLlm: true, defaultEnabled: true },
  { key: 'requirements.extract', label: '規範需求抽取', category: 'document', edgeFunction: 'extract-requirements', minPlan: 'pro', isLlm: true, defaultEnabled: true },
  { key: 'submittal.read', label: '送審文件讀取', category: 'document', edgeFunction: 'read-submittal', minPlan: 'pro', isLlm: true, defaultEnabled: true },
  { key: 'submittal.review', label: '監造送審審查意見', category: 'draft', edgeFunction: 'review-submittal', minPlan: 'pro', isLlm: true, defaultEnabled: true },
  { key: 'rfi.draft_reply', label: 'RFI 回覆草稿', category: 'draft', edgeFunction: 'draft-rfi-reply', minPlan: 'pro', isLlm: true, defaultEnabled: true },
  { key: 'audit.summary', label: '機關稽核意見草稿', category: 'draft', edgeFunction: 'audit-summary', minPlan: 'pro', isLlm: true, defaultEnabled: true },
  { key: 'report.monthly', label: '施工月報草稿', category: 'draft', edgeFunction: 'draft-monthly-review', minPlan: 'standard', isLlm: true, defaultEnabled: true },
  { key: 'valuation.summary', label: '估驗施工說明草稿', category: 'draft', edgeFunction: 'draft-valuation-summary', minPlan: 'standard', isLlm: true, defaultEnabled: true },
  { key: 'sitelog.whiteboard', label: '工程告示板辨識', category: 'vision', edgeFunction: 'read-whiteboard', minPlan: 'trial', isLlm: true, defaultEnabled: true },
  { key: 'defect.describe', label: '缺失照片描述', category: 'vision', edgeFunction: 'describe-defect', minPlan: 'trial', isLlm: true, defaultEnabled: true },
  { key: 'photo.classify', label: '施工照片分類', category: 'vision', edgeFunction: 'classify-site-photo', minPlan: 'trial', isLlm: true, defaultEnabled: true },
  { key: 'safety.photo', label: '工安照片判讀', category: 'vision', edgeFunction: 'analyze-safety-photo', minPlan: 'standard', isLlm: true, defaultEnabled: true },
  { key: 'weather.fetch', label: '天氣帶入(中央氣象署)', category: 'integration', edgeFunction: 'fetch-weather', minPlan: 'trial', isLlm: false, defaultEnabled: true },
  { key: 'reminder.daily', label: '每日 agent 早報', category: 'automation', edgeFunction: 'send-reminders', minPlan: 'standard', isLlm: false, defaultEnabled: true },
]

export const AI_FEATURE_KEYS = AI_FEATURES.map((f) => f.key)

export const featureByKey = Object.fromEntries(AI_FEATURES.map((f) => [f.key, f]))
