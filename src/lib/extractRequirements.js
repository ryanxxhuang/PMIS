// W13:extract-requirements 的前端共用呼叫層——三個呼叫點(契約包上傳、
// 契約頁確認分類/重試、需求頁單檔上傳)一律走這裡,統一三件事:
// 1. 續跑接力:大文件伺服器端分多個 request 跑,收到 in_progress 就帶
//    continue_run_id 再打,直到 completed/failed(有上限,不會無限迴圈)。
// 2. 真錯誤訊息:supabase-js 對 non-2xx 只給 generic 英文
//    「Edge Function returned a non-2xx status code」,伺服器精心寫的中文
//    原因(方案未開、已在解析中、掃描檔…)在 error.context(Response)裡,
//    要自己撈出來。W12 使用者連按重試看不懂發生什麼事,就是這句吞掉的。
// 3. 「已在解析中」(409)不是失敗:回 inProgress 旗標,呼叫端不得把 run
//    蓋寫成 failed——W13 殭屍事故裡,連點重試的 409 一路把活著的解析蓋成失敗。
import { supabase } from './supabase.js'

// 續跑上限:MAX_BATCHES=12、單 request 至少跑一批,再加對半切的餘裕。
// 撞到上限代表伺服器端邏輯有問題(每個 request 都該有進度),誠實回報。
const MAX_CONTINUATIONS = 40

// FunctionsHttpError → { status, message, runId, code }。context 是 fetch
// Response,body 只能讀一次;讀不出來就退回 generic 訊息。code 是伺服器的
// 語意判別:'run_conflict'=別的解析在跑、'restart_required'=終局失敗要重啟。
export async function functionErrorInfo(error) {
  const status = error?.context?.status ?? null
  try {
    const body = await error?.context?.json()
    if (body?.error) {
      return { status, message: body.error, runId: body.run_id || null, code: body.code || null }
    }
  } catch { /* body 不是 JSON 或已被讀過:退回下方判讀 */ }
  // 閘道逾時/上游斷線(502/504)回的是非 JSON 錯誤頁:進度其實已逐批落庫,
  // 給人看得懂的指引,不要丟 generic 英文(2026-08-22 實測 504)
  if (status === 502 || status === 504) {
    return {
      status,
      message: '伺服器處理逾時,已完成的進度已保留;請稍後按「重試」接續',
      runId: null, code: null,
    }
  }
  return { status, message: error?.message || '呼叫 AI 分析服務失敗', runId: null, code: null }
}

// 回傳(擇一):
// * { ok: true, data }                       —— 抽取完成,data 為伺服器完成 payload
// * { ok: false, inProgress: true, message } —— 這份文件已有別的解析在跑(409);
//                                              呼叫端顯示處理中,不可標失敗
// * { ok: false, inProgress: false, message }—— 真失敗,message 是伺服器原話
export async function runRequirementExtraction({ documentVersionId, projectId, onProgress }) {
  let continueRunId = null
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const { data, error } = await supabase.functions.invoke('extract-requirements', {
      body: {
        document_version_id: documentVersionId,
        project_id: projectId,
        ...(continueRunId ? { continue_run_id: continueRunId } : {}),
      },
    })
    if (error) {
      const info = await functionErrorInfo(error)
      // 409 有兩種語意,靠伺服器的 code 分流:run_conflict=「別的解析在跑」
      // → inProgress,呼叫端不得標失敗;restart_required=「終局失敗,要重啟」
      // (計畫變更/run 已死)→ 走失敗收尾,否則 UI 會掛在處理中空轉 20 分鐘。
      // 沒帶 code 的 409(部署空窗的舊版函式)保守當 inProgress,避免蓋寫活解析。
      const inProgress = info.status === 409 && info.code !== 'restart_required'
      return { ok: false, inProgress, message: info.message, runId: info.runId }
    }
    if (data?.error) {
      return { ok: false, inProgress: false, message: data.error, runId: data?.run_id || null }
    }
    if (data?.status === 'in_progress' && data?.run_id) {
      continueRunId = data.run_id
      onProgress?.(data)
      continue
    }
    return { ok: true, data }
  }
  return {
    ok: false, inProgress: false,
    message: `解析接續超過 ${MAX_CONTINUATIONS} 次仍未完成,已中止;請稍後重試或聯絡系統管理者`,
    runId: continueRunId,
  }
}

// 完成 payload → 使用者訊息(W10 揭露截斷:未涵蓋整份文件必須連著講清楚)
export function extractionSuccessMessage(data) {
  return `找到 ${data?.extracted_requirement_count ?? 0} 項契約重點建議${
    data?.coverage_incomplete
      ? `(未涵蓋整份文件:解析至第 ${data?.last_included_page ?? '?'} 頁/共 ${data?.total_page_count ?? '?'} 頁)`
      : ''}`
}

// in_progress payload → 進度短語(面板/清單的「處理中」細節列用)
export function extractionProgressLabel(data) {
  const done = data?.batches_completed ?? 0
  const total = data?.batches_total ?? '?'
  return `正在分析契約重點(第 ${done}/${total} 批)`
}
