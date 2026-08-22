// AI 功能註冊表(伺服器端共用版)——批 A:AI 平台化資料層。
// ---------------------------------------------------------------------------
// 這份註冊表存在兩份,改動必須兩邊同步(key/label/category/edgeFunction/
// minPlan/isLlm/defaultEnabled 全部一致):
//   1) 本檔 —— edge functions 共用(伺服器端唯一來源、以此為準)
//   2) src/lib/aiFeatures.js —— 前端顯示/開關判斷用
// 為什麼重複一份而不是 import:Deno edge function 部署只打包 functions 目錄,
// 無法 import 專案其他路徑(與 _shared/agentRole.ts 同一個限制、同一個慣例),
// 因此各留一份,並以 src/lib/aiFeatures.test.js 讀取本檔原始碼逐欄比對釘住
// 同步——值域漂移會讓測試紅。⚠ 本檔的物件字面量格式(一列一筆)是測試解析
// 的依據,改排版前先看測試。
//
// 資料庫側的單一真相是 public.ai_features(migration 20260728000100 以本表 seed);
// 執行期的「可不可以用」一律問 DB(ai_feature_allowed),本檔只提供靜態中繼
// 資料(feature_key ↔ edge function 對應、用量記錄時反查)。

export type AiPlan = 'trial' | 'standard' | 'pro'
export type AiFeatureCategory =
  | 'agent'       // 對話式 agent
  | 'document'    // 讀文件/抽取
  | 'draft'       // 產草稿
  | 'vision'      // 看照片
  | 'integration' // 外部 API 介接(非 LLM)
  | 'automation'  // 排程自動化

// isLlm 語意:false=不打 LLM、不算 token/成本(如 fetch-weather 的中央氣象署
// API、send-reminders 的確定性早報寄信),但仍是可獨立開關、需要計次的模組
// ——用量事件照記(record_ai_usage),只是 token 與 cost 為 0。
export interface AiFeature {
  key: string
  label: string
  category: AiFeatureCategory
  edgeFunction: string
  minPlan: AiPlan
  isLlm: boolean
  defaultEnabled: boolean
}

// 方案階序:數字越大方案越高;ai_feature_allowed 的 DB 版用同一套 rank
export const PLAN_RANK: Record<AiPlan, number> = { trial: 0, standard: 1, pro: 2 }

export const AI_FEATURES: AiFeature[] = [
  { key: 'agent.run', label: 'AI Agent 主控台', category: 'agent', edgeFunction: 'agent-run', minPlan: 'standard', isLlm: true, defaultEnabled: true },
  { key: 'assistant.chat', label: 'AI 問答助理', category: 'agent', edgeFunction: 'assistant-chat', minPlan: 'standard', isLlm: true, defaultEnabled: false }, // W3-3 退場:/agent 是唯一對話入口;列保留供用量歷史對帳
  { key: 'contract.parse', label: '契約解析(時程/罰則)', category: 'document', edgeFunction: 'parse-contract', minPlan: 'standard', isLlm: true, defaultEnabled: true },
  { key: 'documents.classify', label: '文件自動分類', category: 'document', edgeFunction: 'classify-document', minPlan: 'trial', isLlm: true, defaultEnabled: true }, // 上傳鏈核心,開放所有方案(W14)
  { key: 'requirements.extract', label: '規範需求抽取', category: 'document', edgeFunction: 'extract-requirements', minPlan: 'trial', isLlm: true, defaultEnabled: true }, // 上傳鏈核心,開放所有方案(20260821000200)
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

export const AI_FEATURE_KEYS: string[] = AI_FEATURES.map((f) => f.key)

export const featureByKey: Record<string, AiFeature> = Object.fromEntries(
  AI_FEATURES.map((f) => [f.key, f]),
)
