// Agent 工具層的共用小工具(B4 由 agentTools.ts 抽出)。
// ---------------------------------------------------------------------------
// 分派器 agentTools.ts 要 import 各工具模組,各模組又要用這幾支 helper ——
// 放回 agentTools.ts 會形成循環 import,所以獨立成檔。內容純函式、無 DB 依賴。
// 輸入一律先驗(型別/範圍/日期/UUID),不合法回 { error } 而非丟例外,
// 讓 agent 迴圈能把錯誤以 tool_result 還給模型自行修正。

import { maskDbError } from './publicError.ts'
import type { DbErrorLike } from './publicError.ts'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ilike 用:跳脫萬用字元;另移除 PostgREST or() 語法的分隔字元(逗號/括號),
// 否則關鍵字會被當成條件分隔符注入額外條件。
export function likePattern(raw: string): string {
  const cleaned = raw.replace(/[,()]/g, ' ').trim().replace(/[%_\\]/g, (c) => '\\' + c)
  return `%${cleaned}%`
}

export const isDate = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v)

// PostgREST 錯誤不得原樣進 tool_result:模型會把 policy / constraint 名稱複述給
// 使用者(B1 / M-9)。統一走遮罩、原文進 log;P0001 業務規則照 maskDbError 規則放行。
export function toolError(scope: string, error: DbErrorLike): { error: string } {
  return { error: maskDbError(`agentTools.${scope}`, error).message }
}

// 限制 embed 明細筆數,避免單一 tool_result 撐爆 context(agent.ts 另有 20000 字元截斷保險)
const EMBED_CAP = 200

export function capList<T>(rows: T[] | null | undefined, cap = EMBED_CAP): { rows: T[]; note?: string } {
  const list = rows ?? []
  if (list.length <= cap) return { rows: list }
  return { rows: list.slice(0, cap), note: `僅列出前 ${cap} 筆(共 ${list.length} 筆)` }
}
