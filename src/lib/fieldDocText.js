// 監造日誌「廠商施工情形／收件情形」的組字:前端只 re-export,實作只有一份
// (supabase/functions/_shared/fieldDocText.ts;Edge 起稿 buildSupervisorLogDraft 也用同一支)。
// 與 photoMatch.js 同一慣例:Vite 直接 import .ts,零依賴、無 Deno API。
export {
  FORMAL_DAILY_LOG_STATUSES, isFormalDailyLog, formalDailyLogSource, composeContractorSummary, dailyLogReceipt,
} from '../../supabase/functions/_shared/fieldDocText.ts'
