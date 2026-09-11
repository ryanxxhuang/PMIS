// 擷取審核頁(/requirements/review)的開場白與空狀態文案推導(原本住在
// pages/web/RequirementsReview.jsx,重構波次 8 搬來——這支純函式決定使用者在
// 「0 筆」時被送去哪裡,是要用測試釘死的規則,不該為此把整頁的 store/supabase
// import 圖拉進單元測試)。
import { extractionCoverageWarnings } from './extractRequirements.js'
import { friendlyError } from './errorMessage.js'

// W8-3A(D-014):「AI 整理完了沒」在全站只有一個判定依據——本案有沒有跑完過一次
// 履約要求擷取(`document_ingestion_runs.status = 'completed'`)。首頁初始化清單第 3 步
// 用它,這一頁也必須用它,否則會出現「首頁說整理完成 → 點進來卻叫你重新上傳」的死路。
// ⚠️ 有 Requirement 不等於 AI 跑完過(可能是人工建立或舊 run),絕不可反推成「整理完成」。
export function requirementsIntro(runs = [], rowCount = 0) {
  const ingestionDone = (runs || []).some((r) => r?.status === 'completed')
  // 每個文件版本的最近一次完成整理各自檢查 coverage，不能讓另一份成功
  // 文件蓋掉缺漏警示，也不能把跑完批次當成沒有漏項的證明。
  const warnings = extractionCoverageWarnings(runs)
  const coverageWarning = warnings.length
    ? `注意：目前整理紀錄中有 ${warnings.length} 份文件需要檢查。${warnings.join(' ')}`
    : null
  if (rowCount > 0) {
    return {
      ingestionDone,
      mode: 'list',
      coverageWarning,
      // 沒有 completed run 時只講審查規則,不宣稱 AI 整理完成
      note: ingestionDone
        ? 'AI 已完成整理並自動歸檔;內容如有出入,以契約原文為準。人工補登的項目仍由監造/機關確認,未確認不影響開啟正式模式。'
        : '人工補登的項目由監造/機關確認,未確認不影響開啟正式模式;內容如有出入,以契約原文為準。',
      emptyText: null,
    }
  }
  // 整理完成但 0 筆:這是有效結果(AI 讀完了沒找到),不是失敗,也沒有事情要做——
  // 不能再給「前往上傳」的 CTA 把人送回原點。
  if (ingestionDone) {
    return {
      ingestionDone, mode: 'done-empty', note: null, coverageWarning,
      emptyText: coverageWarning
        ? '本次沒有找到契約重點建議，但文件尚未完整整理；請先查看缺漏範圍。'
        : 'AI 已完成整理，本次沒有找到契約重點建議，不需逐條確認，也不影響開啟正式模式；這不代表已證明文件沒有任何義務。',
    }
  }
  // W10:run 都停了而且有失敗紀錄時要說「失敗了」,不能偽裝成「還沒開始」——
  // 使用者才知道要去重試,而不是空等。還有 run 在跑就維持「處理中」語意。
  const anyActive = (runs || []).some((r) => ['pending', 'processing'].includes(r?.status))
  const latestFailed = (runs || []).find((r) => r?.status === 'failed') || null
  if (latestFailed && !anyActive) {
    return {
      ingestionDone, mode: 'failed', coverageWarning: null,
      note: null,
      emptyText: `最近一次 AI 整理失敗${latestFailed.error_message ? `:${friendlyError(latestFailed.error_message, '請重試')}` : ''}。到「專案文件」的文件清單可重試分析。`,
    }
  }
  return {
    ingestionDone, mode: 'not-started', note: null, coverageWarning: null,
    emptyText: '尚未有完成的 AI 整理。到「專案文件」上傳契約/規範,或查看目前的處理狀態。',
  }
}

