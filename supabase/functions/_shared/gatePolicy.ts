// AI 功能閘門的判定策略(W3-4/D-010)——純函式,無任何 runtime 依賴,
// 讓 vitest 可直接測(aiGate.ts 有 npm: import,node 端載不進來)。
// aiGate.openAiGate 與 agent-run 的內嵌閘門都必須走這裡,不得各自判定。
//
// D-010(使用者 2026-08-12 定案):ai_feature_allowed 查詢「失敗」時 fail-closed
// ——kill switch 在 DB 故障時仍必須有效;寧可 AI 暫停,不可失控放行。
// 「正常回 false」與「查詢失敗」是兩種擋:前者是平台/方案的明確決定(403),
// 後者是閘門本身不可用(503,請使用者稍後再試)。null/true 視為放行——
// ai_feature_allowed 對未登記功能回 null 是既有行為,不在本次改變範圍。

export type GateVerdict =
  | { allow: true }
  | { allow: false; code: 'gate_unavailable' | 'feature_disabled'; status: number; message: string }

export function gateVerdict(
  label: string,
  allowed: boolean | null | undefined,
  queryFailed: boolean,
): GateVerdict {
  if (queryFailed) {
    return {
      allow: false, code: 'gate_unavailable', status: 503,
      message: `AI 功能開關暫時無法確認(${label}),為安全起見先暫停服務,請稍後再試`,
    }
  }
  if (allowed === false) {
    return {
      allow: false, code: 'feature_disabled', status: 403,
      message: `此 AI 功能未啟用(${label}),請聯絡系統管理者`,
    }
  }
  return { allow: true }
}
