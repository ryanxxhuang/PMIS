// AI 功能閘門的判定策略(W3-4/D-010)——純函式,無任何 runtime 依賴,
// 讓 vitest 可直接測(aiGate.ts 有 npm: import,node 端載不進來)。
// aiGate.openAiGate 與 send-reminders 的逐專案閘門都必須走這裡,不得各自判定
//(agent-run 原本內嵌的第二份閘門自 B1 起改走 openAiGate)。
//
// D-010(使用者 2026-08-12 定案):ai_feature_allowed 查詢「失敗」時 fail-closed
// ——kill switch 在 DB 故障時仍必須有效;寧可 AI 暫停,不可失控放行。
// 「正常回 false」與「查詢失敗」是兩種擋:前者是平台/方案的明確決定(403),
// 後者是閘門本身不可用(503,請使用者稍後再試)。
//
// 只有明確的 true 才放行。原本寫的是「null/true 視為放行」,理由是
// 「ai_feature_allowed 對未登記功能回 null」——2026-09-11 實查推翻:該函式
// 對未登記 key 回的是 false。也就是說 null 分支沒有任何已知觸發路徑,卻在
// 「RPC 成功但回了 null/undefined」時悄悄放行,與 D-010 的 fail-closed 相反。
// 未知狀態要往擋的方向倒,不是往放行倒,所以收成 allowed !== true 一律擋。
// 真的出現 null 代表 DB 端行為與這裡的假設脫節,那時 503(閘門不可用)
// 比 403(明確關閉)誠實——我們並不知道平台是否真的關了這個功能。

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
  // null/undefined:RPC 說成功卻沒給答案,等於閘門沒作用。照 D-010 往擋的方向倒。
  if (allowed !== true) {
    return {
      allow: false, code: 'gate_unavailable', status: 503,
      message: `AI 功能開關暫時無法確認(${label}),為安全起見先暫停服務,請稍後再試`,
    }
  }
  return { allow: true }
}
